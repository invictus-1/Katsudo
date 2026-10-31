//! Low-level keyboard and mouse hooks. They only count: presses per virtual key, clicks,
//! scroll notches, pointer travel, and how often the pointer clicks in or passes through each
//! 32-pixel square of the screen. Nothing about order or text is ever kept.

use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, AtomicI64, AtomicU32, AtomicU64, Ordering};
use std::sync::{Mutex, OnceLock};

/// Counts accumulated since the last `take()`, keyed by the app that was in front.
#[derive(Default, Clone)]
pub struct Counts {
    pub per_app: HashMap<i64, AppCounts>,
    pub per_key: HashMap<u32, u64>,
    /// Pointer heatmap: per `CELL_PX` square of the virtual desktop.
    pub per_cell: HashMap<(i32, i32), CellCounts>,
}

/// Heatmap squares are this many pixels on a side.
pub const CELL_PX: i32 = 32;

#[derive(Default, Clone, Copy)]
pub struct CellCounts {
    pub clicks: u64,
    /// Times the pointer moved into this square: a path, not a dwell time.
    pub moves: u64,
}

fn cell_of(x: i32, y: i32) -> (i32, i32) {
    (x.div_euclid(CELL_PX), y.div_euclid(CELL_PX))
}

#[derive(Default, Clone, Copy)]
pub struct AppCounts {
    pub keys: u64,
    pub clicks: u64,
    pub scrolls: u64,
    pub distance_px: f64,
}

impl Counts {
    pub fn merge(&mut self, other: Counts) {
        for (app, c) in other.per_app {
            let e = self.per_app.entry(app).or_default();
            e.keys += c.keys;
            e.clicks += c.clicks;
            e.scrolls += c.scrolls;
            e.distance_px += c.distance_px;
        }
        for (k, n) in other.per_key {
            *self.per_key.entry(k).or_default() += n;
        }
        for (k, c) in other.per_cell {
            let e = self.per_cell.entry(k).or_default();
            e.clicks += c.clicks;
            e.moves += c.moves;
        }
    }
}

/// The app id input is attributed to; the tracker updates it every tick.
pub static CURRENT_APP: AtomicI64 = AtomicI64::new(0);
/// Off while tracking is paused or input tracking is switched off.
pub static ENABLED: AtomicBool = AtomicBool::new(true);

/// Presses since launch. Never reset; the keys-per-second sampler reads it.
pub static KEYS_TOTAL: AtomicU64 = AtomicU64::new(0);
/// Counted but not yet committed to the database. The tracker subtracts what it commits,
/// so "database + unflushed" is always the exact total, live.
pub static UNFLUSHED_KEYS: AtomicI64 = AtomicI64::new(0);
pub static UNFLUSHED_CLICKS: AtomicI64 = AtomicI64::new(0);
/// Seqlock around a flush: odd while a flush is committing. Readers retry if it moved.
pub static FLUSH_SEQ: AtomicU64 = AtomicU64::new(0);

/// Which virtual keys are down right now, and presses per key since launch (wrapping). The
/// stream overlay reads these for the keys you chose to show; nothing else does.
pub static HELD: [AtomicBool; 256] = [const { AtomicBool::new(false) }; 256];
pub static PRESSES: [AtomicU32; 256] = [const { AtomicU32::new(0) }; 256];

/// Keys in the last second, sampled every 20 ms, and the highest value seen today.
pub static KPS: AtomicU64 = AtomicU64::new(0);
pub static PEAK_KPS: AtomicU64 = AtomicU64::new(0);

/// Sliding one-second window over `KEYS_TOTAL`. Resets the peak at local midnight.
pub fn start_kps_sampler() {
    std::thread::Builder::new()
        .name("katsudo-kps".into())
        .spawn(|| {
            use std::collections::VecDeque;
            use std::time::{Duration, Instant};
            let mut window: VecDeque<(Instant, u64)> = VecDeque::with_capacity(64);
            let mut day = crate::db::today();
            loop {
                std::thread::sleep(Duration::from_millis(20));
                let now = Instant::now();
                let total = KEYS_TOTAL.load(Ordering::Relaxed);
                window.push_back((now, total));
                while window.front().is_some_and(|(t, _)| now.duration_since(*t) > Duration::from_secs(1)) {
                    window.pop_front();
                }
                let oldest = window.front().map(|(_, v)| *v).unwrap_or(total);
                let kps = total - oldest;
                KPS.store(kps, Ordering::Relaxed);
                if window.len() % 50 == 0 {
                    let today = crate::db::today();
                    if today != day {
                        day = today;
                        PEAK_KPS.store(0, Ordering::Relaxed);
                    }
                }
                PEAK_KPS.fetch_max(kps, Ordering::Relaxed);
                crate::rhythm::SESSION_PEAK.fetch_max(kps, Ordering::Relaxed);
            }
        })
        .expect("spawn kps sampler");
}

fn counts() -> &'static Mutex<Counts> {
    static C: OnceLock<Mutex<Counts>> = OnceLock::new();
    C.get_or_init(|| Mutex::new(Counts::default()))
}

pub fn take() -> Counts {
    std::mem::take(&mut *counts().lock().unwrap())
}

#[cfg(windows)]
mod imp {
    use super::*;
    use windows::Win32::Foundation::{HINSTANCE, LPARAM, LRESULT, WPARAM};
    use windows::Win32::System::LibraryLoader::GetModuleHandleW;
    use windows::Win32::UI::WindowsAndMessaging::{
        CallNextHookEx, GetMessageW, SetWindowsHookExW, KBDLLHOOKSTRUCT, LLKHF_EXTENDED, LLKHF_INJECTED, LLMHF_INJECTED, MSG,
        MSLLHOOKSTRUCT, WH_KEYBOARD_LL, WH_MOUSE_LL, WM_KEYDOWN, WM_KEYUP, WM_LBUTTONDOWN, WM_MBUTTONDOWN,
        WM_MOUSEHWHEEL, WM_MOUSEMOVE, WM_MOUSEWHEEL, WM_RBUTTONDOWN, WM_SYSKEYDOWN, WM_SYSKEYUP, WM_XBUTTONDOWN,
    };

    /// Synthetic (injected) input is ignored unless KATSUDO_COUNT_INJECTED=1, which is for
    /// key remappers that re-inject presses, and for load-testing the counter.
    static COUNT_INJECTED: AtomicBool = AtomicBool::new(false);
    static LAST_POS: Mutex<Option<(i32, i32)>> = Mutex::new(None);

    fn with_cell(at: (i32, i32), f: impl FnOnce(&mut CellCounts)) {
        if let Ok(mut c) = counts().lock() {
            f(c.per_cell.entry(at).or_default());
        }
    }

    fn with_app(f: impl FnOnce(&mut AppCounts, &mut HashMap<u32, u64>)) {
        let app = CURRENT_APP.load(Ordering::Relaxed);
        if let Ok(mut c) = counts().lock() {
            let c = &mut *c;
            f(c.per_app.entry(app).or_default(), &mut c.per_key);
        }
    }

    unsafe extern "system" fn keyboard_proc(code: i32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
        if code >= 0 && ENABLED.load(Ordering::Relaxed) {
            let kb = &*(lparam.0 as *const KBDLLHOOKSTRUCT);
            let vk = (kb.vkCode & 0xff) as usize;
            let injected = kb.flags.0 & LLKHF_INJECTED.0 != 0 && !COUNT_INJECTED.load(Ordering::Relaxed);
            match wparam.0 as u32 {
                WM_KEYDOWN | WM_SYSKEYDOWN => {
                    // Held keys auto-repeat; count the press, not the repeats.
                    if !HELD[vk].swap(true, Ordering::Relaxed) && !injected {
                        PRESSES[vk].fetch_add(1, Ordering::Relaxed);
                        KEYS_TOTAL.fetch_add(1, Ordering::Relaxed);
                        UNFLUSHED_KEYS.fetch_add(1, Ordering::Relaxed);
                        let extended = kb.flags.0 & LLKHF_EXTENDED.0 != 0;
                        let id = if crate::keys::numpad_twin(vk as u32, extended) { vk as u32 | crate::keys::NUMPAD_FLAG } else { vk as u32 };
                        with_app(|a, keys| {
                            a.keys += 1;
                            *keys.entry(id).or_default() += 1;
                        });
                    }
                }
                WM_KEYUP | WM_SYSKEYUP => HELD[vk].store(false, Ordering::Relaxed),
                _ => {}
            }
        }
        CallNextHookEx(None, code, wparam, lparam)
    }

    unsafe extern "system" fn mouse_proc(code: i32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
        if code >= 0 && ENABLED.load(Ordering::Relaxed) {
            let m = &*(lparam.0 as *const MSLLHOOKSTRUCT);
            if m.flags & LLMHF_INJECTED == 0 {
                match wparam.0 as u32 {
                    WM_LBUTTONDOWN | WM_RBUTTONDOWN | WM_MBUTTONDOWN | WM_XBUTTONDOWN => {
                        UNFLUSHED_CLICKS.fetch_add(1, Ordering::Relaxed);
                        with_app(|a, _| a.clicks += 1);
                        with_cell(cell_of(m.pt.x, m.pt.y), |c| c.clicks += 1);
                    }
                    WM_MOUSEWHEEL | WM_MOUSEHWHEEL => with_app(|a, _| a.scrolls += 1),
                    WM_MOUSEMOVE => {
                        let p = (m.pt.x, m.pt.y);
                        let prev = LAST_POS.lock().ok().and_then(|mut l| l.replace(p));
                        if let Some((x, y)) = prev {
                            let d = (((p.0 - x) as f64).powi(2) + ((p.1 - y) as f64).powi(2)).sqrt();
                            // Ignore teleports (monitor switches, remote sessions).
                            if d < 1500.0 {
                                with_app(|a, _| a.distance_px += d);
                            }
                            // Only crossing into another square takes the lock: a handful of
                            // times per sweep, not on every one of a 1000 Hz mouse's reports.
                            let at = cell_of(p.0, p.1);
                            if at != cell_of(x, y) {
                                with_cell(at, |c| c.moves += 1);
                            }
                        }
                    }
                    _ => {}
                }
            }
        }
        CallNextHookEx(None, code, wparam, lparam)
    }

    pub fn start() {
        COUNT_INJECTED.store(std::env::var("KATSUDO_COUNT_INJECTED").is_ok_and(|v| v == "1"), Ordering::Relaxed);
        std::thread::Builder::new()
            .name("katsudo-input".into())
            .spawn(|| unsafe {
                let hinst: HINSTANCE = GetModuleHandleW(None).map(|m| m.into()).unwrap_or_default();
                let kb = SetWindowsHookExW(WH_KEYBOARD_LL, Some(keyboard_proc), hinst, 0);
                let ms = SetWindowsHookExW(WH_MOUSE_LL, Some(mouse_proc), hinst, 0);
                if kb.is_err() || ms.is_err() {
                    eprintln!("katsudo: input hooks unavailable: {:?} {:?}", kb.err(), ms.err());
                }
                // Low-level hooks are called on this thread's message loop.
                let mut msg = MSG::default();
                while GetMessageW(&mut msg, None, 0, 0).as_bool() {}
            })
            .expect("spawn input thread");
    }

    /// Drive the real keyboard callback with `presses` synthetic down/up pairs across a few
    /// keys, as fast as possible, and check every counter. Returns a report.
    pub fn selftest(presses: u64) -> String {
        let keys = [0x41u32, 0x53, 0x44, 0x46, 0x4a, 0x4b]; // A S D F J K: a 6-key chart
        let (k0, u0) = (KEYS_TOTAL.load(Ordering::SeqCst), UNFLUSHED_KEYS.load(Ordering::SeqCst));
        let _ = take();
        let started = std::time::Instant::now();
        for i in 0..presses {
            let vk = keys[(i % keys.len() as u64) as usize];
            for msg in [WM_KEYDOWN, WM_KEYUP] {
                let ev = KBDLLHOOKSTRUCT { vkCode: vk, ..Default::default() };
                unsafe { keyboard_proc(0, WPARAM(msg as usize), LPARAM(&ev as *const _ as isize)) };
            }
        }
        let elapsed = started.elapsed();
        let counted = take();
        let per_key: u64 = counted.per_key.values().sum();
        let per_app: u64 = counted.per_app.values().map(|a| a.keys).sum();
        let total = KEYS_TOTAL.load(Ordering::SeqCst) - k0;
        let unflushed = UNFLUSHED_KEYS.load(Ordering::SeqCst) - u0;
        let ok = total == presses && unflushed == presses as i64 && per_key == presses && per_app == presses;
        format!(
            "{}: {presses} presses -> total {total}, unflushed {unflushed}, per-key {per_key}, per-app {per_app}; {:.0} ns per event ({:.1}M presses/s)",
            if ok { "PASS" } else { "FAIL" },
            elapsed.as_nanos() as f64 / (presses * 2) as f64,
            presses as f64 / elapsed.as_secs_f64() / 1e6
        )
    }
}

#[cfg(windows)]
pub use imp::{selftest, start};

#[cfg(not(windows))]
pub fn start() {}

//! Gentle break nudges (opt-in, off by default). After `break_minutes` of unbroken activity a
//! small window offers a stretch. Going away (the tracker's own away detection) is a break and
//! resets the clock; a glance at your phone isn't. A nudge never interrupts a flow session (it
//! waits for the session to end), a game or anything fullscreen. After hard typing (150+ keys a
//! minute on average) it comes a quarter sooner. One nudge per stretch: ignore it and it won't
//! repeat until you've had a break; Snooze asks once more in 30 minutes; Not today mutes it
//! until tomorrow. Everything is local: the nudge is Katsudō's own window, not a web service.

use crate::{db, flow, hooks, tracker};
use rusqlite::Connection;
use serde::Serialize;
use std::sync::atomic::Ordering;
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};

pub const DEFAULT_MINUTES: i64 = 60;
const SNOOZE: i64 = 30 * 60;
/// Keys a minute, on average over the stretch, that count as hard typing.
const HEAVY_KPM: f64 = 150.0;
/// Hard typing only counts once a stretch is this long (a fast burst isn't a pattern).
const HEAVY_AFTER: i64 = 20 * 60;
const LABEL: &str = "nudge";

#[derive(Default, Clone, Debug)]
pub struct State {
    /// When the current unbroken stretch began (None while away or paused).
    pub stretch_start: Option<i64>,
    pub keys_at_start: u64,
    /// A nudge was shown this stretch.
    pub shown: bool,
    /// Ask again at this time (Snooze); 0 = no snooze.
    pub snooze_until: i64,
    /// Muted for this local day (Not today).
    pub muted_day: Option<String>,
}

/// What the watcher sees on one tick.
pub struct Tick {
    pub now: i64,
    pub today: String,
    pub enabled: bool,
    pub minutes: i64,
    pub present: bool,
    pub keys_total: u64,
}

/// The nudge as the window shows it.
#[derive(Serialize, Clone, Debug, PartialEq)]
pub struct Nudge {
    /// Seconds since the stretch began.
    pub secs: i64,
    /// Keys a minute over the stretch.
    pub kpm: i64,
    pub heavy: bool,
    pub era: String,
}

/// Advance the state by one tick; Some(nudge) when one is due now (before the flow, game and
/// fullscreen checks, which can only put it off).
pub fn decide(st: &mut State, t: &Tick) -> Option<Nudge> {
    if !t.present {
        *st = State { muted_day: st.muted_day.take(), ..State::default() };
        return None;
    }
    let start = *st.stretch_start.get_or_insert_with(|| {
        st.keys_at_start = t.keys_total;
        t.now
    });
    if !t.enabled || st.muted_day.as_deref() == Some(t.today.as_str()) {
        return None;
    }
    let secs = t.now - start;
    let kpm = t.keys_total.saturating_sub(st.keys_at_start) as f64 / (secs.max(60) as f64 / 60.0);
    let heavy = secs >= HEAVY_AFTER && kpm >= HEAVY_KPM;
    let threshold = if heavy { t.minutes * 45 } else { t.minutes * 60 };
    let due = if st.snooze_until > 0 { t.now >= st.snooze_until } else { !st.shown && secs >= threshold };
    due.then(|| Nudge { secs, kpm: kpm.round() as i64, heavy, era: String::new() })
}

fn state() -> &'static Mutex<State> {
    static S: Mutex<State> = Mutex::new(State { stretch_start: None, keys_at_start: 0, shown: false, snooze_until: 0, muted_day: None });
    &S
}

fn current() -> &'static Mutex<Option<Nudge>> {
    static C: Mutex<Option<Nudge>> = Mutex::new(None);
    &C
}

pub fn minutes(conn: &Connection) -> i64 {
    db::get_setting(conn, "break_minutes").and_then(|v| v.parse().ok()).filter(|m| (15..=240).contains(m)).unwrap_or(DEFAULT_MINUTES)
}

/// Fullscreen apps, presentations, games and calls: put the nudge off.
fn busy() -> bool {
    crate::rhythm::IN_GAME.load(Ordering::Relaxed) != 0 || crate::win::fullscreen_busy() || crate::win::mic_or_camera_in_use()
}

/// Watch for long stretches; runs for the life of the app.
pub fn start(app: AppHandle, control: Arc<tracker::Control>, read: Arc<Mutex<Connection>>) {
    let _ = std::thread::Builder::new().name("katsudo-breaks".into()).spawn(move || loop {
        std::thread::sleep(Duration::from_secs(15));
        let now = db::now_secs();
        let (enabled, mins) = match read.lock() {
            Ok(c) => (db::get_bool(&c, "break_nudges", false), minutes(&c)),
            Err(_) => continue,
        };
        // KATSUDO_NUDGE_SECS (testing): the threshold in seconds instead of minutes.
        let mins = std::env::var("KATSUDO_NUDGE_SECS").ok().and_then(|s| s.parse::<i64>().ok()).map_or(mins, |s| (s + 59) / 60);
        let paused = control.paused_until.load(Ordering::Relaxed) > now;
        let present = !paused && control.live.lock().map(|l| l.active).unwrap_or(false);
        let tick = Tick { now, today: db::today(), enabled, minutes: mins, present, keys_total: hooks::KEYS_TOTAL.load(Ordering::Relaxed) };
        let due = decide(&mut state().lock().unwrap(), &tick);
        let Some(nudge) = due else { continue };
        if app.get_webview_window(LABEL).is_some() || busy() {
            continue;
        }
        // Wait for a flow session to end rather than breaking it.
        let live = control.live.lock().map(|l| l.open.clone()).unwrap_or_default();
        let in_flow = read.lock().ok().and_then(|c| flow::day(&c, &tick.today, &live).ok()).is_some_and(|d| d.now.is_some());
        if in_flow {
            continue;
        }
        {
            let mut st = state().lock().unwrap();
            st.shown = true;
            st.snooze_until = 0;
        }
        show(&app, nudge);
    });
}

/// Open the nudge window above the tray, without taking focus. Never call it on the main thread:
/// building a webview there waits on the main thread itself and hangs (WebView2).
pub fn show(app: &AppHandle, mut nudge: Nudge) {
    nudge.era = crate::overlay::app_era();
    *current().lock().unwrap() = Some(nudge);
    let app = app.clone();
    let _ = std::thread::Builder::new().name("katsudo-nudge".into()).spawn(move || {
        if let Some(w) = app.get_webview_window(LABEL) {
            let _ = w.destroy();
        }
        let (w, h) = (380.0, 150.0);
        let mut b = WebviewWindowBuilder::new(&app, LABEL, WebviewUrl::App("nudge.html".into()))
            .title("Katsudō")
            .inner_size(w, h)
            .decorations(false)
            .transparent(true)
            .shadow(false)
            .resizable(false)
            .always_on_top(true)
            .skip_taskbar(true)
            .focused(false)
            .visible(true);
        if let Ok(Some(m)) = app.primary_monitor() {
            let area = m.work_area();
            let scale = m.scale_factor();
            let x = (area.position.x as f64 + area.size.width as f64) / scale - w - 16.0;
            let y = (area.position.y as f64 + area.size.height as f64) / scale - h - 16.0;
            b = b.position(x, y);
        }
        if let Err(e) = b.build() {
            eprintln!("katsudo: nudge window: {e}");
        }
    });
}

/// The nudge the window should show.
pub fn current_nudge() -> Option<Nudge> {
    current().lock().unwrap().clone()
}

/// The window's answer: "snooze", "today", or anything else (a break, closed, ignored).
pub fn respond(app: &AppHandle, action: &str) {
    {
        let mut st = state().lock().unwrap();
        match action {
            "snooze" => st.snooze_until = db::now_secs() + SNOOZE,
            "today" => st.muted_day = Some(db::today()),
            _ => {}
        }
    }
    if let Some(w) = app.get_webview_window(LABEL) {
        let _ = w.destroy();
    }
}

/// For Settings' "Show me": the current stretch, or a made-up one.
pub fn preview(app: &AppHandle) {
    let st = state().lock().unwrap().clone();
    let secs = st.stretch_start.map(|s| db::now_secs() - s).filter(|s| *s >= 60).unwrap_or(97 * 60);
    show(app, Nudge { secs, kpm: 0, heavy: false, era: String::new() });
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tick(now: i64, present: bool, keys: u64) -> Tick {
        Tick { now, today: "2026-10-31".into(), enabled: true, minutes: 60, present, keys_total: keys }
    }

    #[test]
    fn nudges_once_per_stretch_and_away_resets() {
        let mut st = State::default();
        assert!(decide(&mut st, &tick(0, true, 0)).is_none());
        assert!(decide(&mut st, &tick(59 * 60, true, 100)).is_none());
        let n = decide(&mut st, &tick(60 * 60, true, 200)).expect("due at an hour");
        assert!(!n.heavy);
        st.shown = true;
        assert!(decide(&mut st, &tick(3 * 3600, true, 300)).is_none(), "ignored: no repeat this stretch");
        assert!(decide(&mut st, &tick(3 * 3600 + 15, false, 300)).is_none());
        assert!(st.stretch_start.is_none() && !st.shown, "away resets");
        decide(&mut st, &tick(4 * 3600, true, 300));
        assert!(decide(&mut st, &tick(5 * 3600, true, 400)).is_some(), "a new stretch can nudge again");
    }

    #[test]
    fn hard_typing_comes_sooner_snooze_and_not_today() {
        let mut st = State::default();
        decide(&mut st, &tick(0, true, 0));
        // 200 keys a minute for 45 minutes: due at three quarters of the hour.
        assert!(decide(&mut st, &tick(44 * 60, true, 200 * 44)).is_none());
        let n = decide(&mut st, &tick(45 * 60, true, 200 * 45)).expect("heavy nudge at 45 min");
        assert!(n.heavy && n.kpm == 200);
        st.shown = true;
        st.snooze_until = 45 * 60 + SNOOZE;
        assert!(decide(&mut st, &tick(70 * 60, true, 0)).is_none());
        assert!(decide(&mut st, &tick(75 * 60, true, 0)).is_some(), "snooze asks once more");
        st.snooze_until = 0;
        st.muted_day = Some("2026-10-31".into());
        decide(&mut st, &tick(76 * 60, false, 0));
        decide(&mut st, &tick(80 * 60, true, 0));
        assert!(decide(&mut st, &tick(300 * 60, true, 0)).is_none(), "not today survives a break");
    }
}

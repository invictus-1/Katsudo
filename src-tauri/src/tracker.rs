//! The native tracker. A one-second loop that follows the foreground app and window,
//! notices idle time, and every few seconds writes closed segments and input counts.
//!
//! Open segments live in memory (and are shown live through `Control::live`); they are
//! cut every five minutes and at local midnight, so a crash loses at most a few minutes
//! and every stored segment belongs to exactly one local day.

use crate::db::{self, LANE_ACTIVITY, LANE_APP, LANE_DOC, NATIVE_SOURCE};
use crate::{hooks, keys, win};
use rusqlite::{params, Connection};
use serde::Serialize;
use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, AtomicI64, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

const TICK: Duration = Duration::from_secs(1);
const FLUSH_EVERY: i64 = 10;
const CUT_EVERY: i64 = 300;
/// One pixel at 96 DPI, in metres. Pointer travel is approximate by nature.
const METRES_PER_PX: f64 = 0.0254 / 96.0;

#[derive(Clone, Copy, Debug, Serialize, PartialEq)]
pub struct Seg {
    pub lane: i64,
    pub start: i64,
    pub end: i64,
    #[serde(rename = "ref")]
    pub ref_id: i64,
    pub app_id: Option<i64>,
}

#[derive(Clone, Default, Serialize)]
pub struct Live {
    pub open: Vec<Seg>,
    pub app_name: Option<String>,
    pub title: Option<String>,
    pub active: bool,
}

pub struct Control {
    /// Unix seconds until which tracking is paused; 0 = running, i64::MAX = until resumed.
    pub paused_until: AtomicI64,
    pub idle_threshold_secs: AtomicU64,
    pub track_titles: AtomicBool,
    pub track_input: AtomicBool,
    pub live: Mutex<Live>,
    /// Set to ask the tracker for a final flush; it sets `flushed` when done and stops.
    pub quit: AtomicBool,
    pub flushed: AtomicBool,
}

impl Control {
    pub fn from_settings(conn: &Connection) -> Self {
        let idle_min = db::get_setting(conn, "idle_minutes").and_then(|v| v.parse().ok()).unwrap_or(5u64);
        Control {
            paused_until: AtomicI64::new(0),
            idle_threshold_secs: AtomicU64::new(idle_min * 60),
            track_titles: AtomicBool::new(db::get_bool(conn, "track_titles", true)),
            track_input: AtomicBool::new(db::get_bool(conn, "track_input", true)),
            live: Mutex::new(Live::default()),
            quit: AtomicBool::new(false),
            flushed: AtomicBool::new(false),
        }
    }

    pub fn is_paused(&self, now: i64) -> bool {
        self.paused_until.load(Ordering::Relaxed) > now
    }
}

#[derive(Default)]
struct Pending {
    segs: Vec<Seg>,
    counts: hooks::Counts,
    net: HashMap<(String, i64), (u64, u64)>,
    uptime: HashMap<(String, i64), i64>,
}

struct State {
    activity: Option<Seg>,
    app: Option<Seg>,
    doc: Option<Seg>,
    app_ids: HashMap<String, (i64, String)>,
    title_ids: HashMap<String, i64>,
    pending: Pending,
    last_net: Option<(u64, u64)>,
}

impl State {
    fn close(&mut self, which: i64, at: i64) {
        let slot = match which {
            LANE_ACTIVITY => &mut self.activity,
            LANE_APP => &mut self.app,
            _ => &mut self.doc,
        };
        if let Some(mut s) = slot.take() {
            s.end = at.max(s.start);
            push_split(&mut self.pending.segs, s);
        }
    }

    fn close_all(&mut self, at: i64) {
        for lane in [LANE_ACTIVITY, LANE_APP, LANE_DOC] {
            self.close(lane, at);
        }
    }

    /// Keep `lane` open on `ref_id`, closing whatever else was open there.
    fn ensure(&mut self, lane: i64, ref_id: i64, app_id: Option<i64>, at: i64) {
        let current = match lane {
            LANE_ACTIVITY => self.activity,
            LANE_APP => self.app,
            _ => self.doc,
        };
        if matches!(current, Some(s) if s.ref_id == ref_id && s.app_id == app_id) {
            return;
        }
        self.close(lane, at);
        let seg = Some(Seg { lane, start: at, end: at, ref_id, app_id });
        match lane {
            LANE_ACTIVITY => self.activity = seg,
            LANE_APP => self.app = seg,
            _ => self.doc = seg,
        }
    }

    fn cut_long(&mut self, now: i64) {
        let today_start = db::day_bounds(&db::today()).map(|b| b.0).unwrap_or(0);
        for slot in [&mut self.activity, &mut self.app, &mut self.doc] {
            if let Some(s) = slot {
                if now - s.start >= CUT_EVERY || s.start < today_start {
                    let mut closed = *s;
                    closed.end = now;
                    push_split(&mut self.pending.segs, closed);
                    s.start = now;
                }
            }
        }
    }
}

/// Push a closed segment, split at local midnights; drop zero-length pieces.
pub fn push_split(out: &mut Vec<Seg>, seg: Seg) {
    let mut s = seg;
    while s.end > s.start {
        let day_end = db::next_local_midnight(s.start);
        if s.end <= day_end {
            out.push(s);
            break;
        }
        out.push(Seg { end: day_end, ..s });
        s.start = day_end;
    }
}

pub fn start(write: Arc<Mutex<Connection>>, control: Arc<Control>) {
    std::thread::Builder::new()
        .name("katsudo-tracker".into())
        .spawn(move || run(write, control))
        .expect("spawn tracker");
}

fn run(write: Arc<Mutex<Connection>>, control: Arc<Control>) {
    let mut st = State {
        activity: None,
        app: None,
        doc: None,
        app_ids: HashMap::new(),
        title_ids: HashMap::new(),
        pending: Pending::default(),
        last_net: win::net_totals(),
    };
    let mut last_tick = db::now_secs();
    let mut last_flush = last_tick;

    loop {
        std::thread::sleep(TICK);
        let now = db::now_secs();
        let gap = now - last_tick;
        last_tick = now;

        let paused = control.is_paused(now);
        if !paused && control.paused_until.load(Ordering::Relaxed) != 0 {
            control.paused_until.store(0, Ordering::Relaxed);
        }
        hooks::ENABLED.store(!paused && control.track_input.load(Ordering::Relaxed), Ordering::Relaxed);

        // A long gap means the machine slept: end everything where the gap began.
        if gap > 30 {
            st.close_all(now - gap + 1);
        }

        let mut app_name = None;
        let mut title_text = None;
        let mut active = false;
        let mut game = 0i64;
        if paused {
            st.close_all(now);
        } else {
            let idle = win::idle_secs();
            active = idle < control.idle_threshold_secs.load(Ordering::Relaxed);
            if active {
                st.ensure(LANE_ACTIVITY, 1, None, now);
                match win::foreground() {
                    Some(fg) => {
                        let key = db::app_key_from_path(&fg.exe_path);
                        if let Some((app_id, name)) = resolve_app(&write, &mut st, &key, &fg.exe_path) {
                            hooks::CURRENT_APP.store(app_id, Ordering::Relaxed);
                            if crate::rhythm::is_game(&key) {
                                game = app_id;
                            }
                            st.ensure(LANE_APP, app_id, None, now);
                            app_name = Some(name);
                            let title = fg.title.trim().to_string();
                            if control.track_titles.load(Ordering::Relaxed) && !title.is_empty() {
                                if let Some(tid) = resolve_title(&write, &mut st, &title) {
                                    st.ensure(LANE_DOC, tid, Some(app_id), now);
                                }
                                title_text = Some(title);
                            } else {
                                st.close(LANE_DOC, now);
                            }
                        }
                    }
                    None => {
                        hooks::CURRENT_APP.store(0, Ordering::Relaxed);
                        st.close(LANE_APP, now);
                        st.close(LANE_DOC, now);
                    }
                }
            } else {
                // Idle: the away period began when input stopped.
                let away_from = (now - idle as i64).max(st.activity.map(|s| s.start).unwrap_or(0));
                if matches!(st.activity, Some(s) if s.ref_id == 1) {
                    st.close(LANE_APP, away_from);
                    st.close(LANE_DOC, away_from);
                    st.ensure(LANE_ACTIVITY, 0, None, away_from);
                } else {
                    st.ensure(LANE_ACTIVITY, 0, None, now);
                }
            }
            st.cut_long(now);
            let (day, hour) = db::local_day_hour(now);
            *st.pending.uptime.entry((day, hour)).or_default() += gap.clamp(0, 5) * 1000;
        }

        crate::rhythm::IN_GAME.store(game, Ordering::Relaxed);
        if let Ok(mut live) = control.live.lock() {
            live.open = [st.activity, st.app, st.doc]
                .into_iter()
                .flatten()
                .map(|s| Seg { end: now, ..s })
                .collect();
            live.app_name = app_name;
            live.title = title_text;
            live.active = active;
        }

        // On quit, close everything and write it all before the process ends.
        let quitting = control.quit.load(Ordering::SeqCst);
        if quitting {
            st.close_all(now);
        }
        if quitting || now - last_flush >= FLUSH_EVERY {
            last_flush = now;
            st.pending.counts.merge(hooks::take());
            if let Some((down, up)) = win::net_totals() {
                if let Some((d0, u0)) = st.last_net {
                    let key = db::local_day_hour(now);
                    let e = st.pending.net.entry(key).or_default();
                    e.0 += down.saturating_sub(d0);
                    e.1 += up.saturating_sub(u0);
                }
                st.last_net = Some((down, up));
            }
            let guard = if quitting { write.lock().ok() } else { write.try_lock().ok() };
            if let Some(conn) = guard {
                // Seqlock: readers of "database + unflushed" retry while this is odd.
                hooks::FLUSH_SEQ.fetch_add(1, Ordering::SeqCst);
                match flush(&conn, &st.pending, now) {
                    Ok(()) => {
                        let (k, c) = st.pending.counts.per_app.values().fold((0, 0), |(k, c), a| (k + a.keys, c + a.clicks));
                        hooks::UNFLUSHED_KEYS.fetch_sub(k as i64, Ordering::SeqCst);
                        hooks::UNFLUSHED_CLICKS.fetch_sub(c as i64, Ordering::SeqCst);
                        st.pending = Pending::default();
                    }
                    Err(e) => eprintln!("katsudo: flush deferred: {e}"),
                }
                hooks::FLUSH_SEQ.fetch_add(1, Ordering::SeqCst);
            }
            if quitting {
                control.flushed.store(true, Ordering::SeqCst);
                return;
            }
        }
    }
}

fn resolve_app(write: &Mutex<Connection>, st: &mut State, key: &str, path: &str) -> Option<(i64, String)> {
    if let Some(v) = st.app_ids.get(key) {
        return Some(v.clone());
    }
    let conn = write.lock().ok()?;
    let name = win::app_display_name(path).unwrap_or_else(|| {
        let stem = key.trim_end_matches(".exe");
        let mut c = stem.chars();
        c.next().map(|f| f.to_uppercase().collect::<String>() + c.as_str()).unwrap_or_default()
    });
    let id = db::upsert_app(&conn, key, &name, Some(path)).ok()?;
    let stored: String = conn.query_row("SELECT name FROM app WHERE id = ?1", [id], |r| r.get(0)).ok()?;
    st.app_ids.insert(key.to_string(), (id, stored.clone()));
    Some((id, stored))
}

fn resolve_title(write: &Mutex<Connection>, st: &mut State, title: &str) -> Option<i64> {
    if let Some(id) = st.title_ids.get(title) {
        return Some(*id);
    }
    let conn = write.lock().ok()?;
    let id = db::upsert_title(&conn, title).ok()?;
    if st.title_ids.len() > 5000 {
        st.title_ids.clear();
    }
    st.title_ids.insert(title.to_string(), id);
    Some(id)
}

fn flush(conn: &Connection, p: &Pending, now: i64) -> anyhow::Result<()> {
    let tx = conn.unchecked_transaction()?;
    {
        let mut seg = tx.prepare_cached(
            "INSERT INTO segment (lane, start, end, ref, app_id, source) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        )?;
        for s in &p.segs {
            seg.execute(params![s.lane, s.start, s.end, s.ref_id, s.app_id, NATIVE_SOURCE])?;
        }
        let (day, hour) = db::local_day_hour(now);
        let mut input = tx.prepare_cached(
            "INSERT INTO input_hour (day, hour, source, app_id, keys, clicks, scrolls, distance_m)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
             ON CONFLICT (day, hour, source, app_id) DO UPDATE SET
               keys = keys + excluded.keys, clicks = clicks + excluded.clicks,
               scrolls = scrolls + excluded.scrolls, distance_m = distance_m + excluded.distance_m",
        )?;
        for (app, c) in &p.counts.per_app {
            input.execute(params![
                day,
                hour,
                NATIVE_SOURCE,
                app,
                c.keys as i64,
                c.clicks as i64,
                c.scrolls as i64,
                c.distance_px * METRES_PER_PX
            ])?;
        }
        let mut key = tx.prepare_cached(
            "INSERT INTO key_day (day, source, key, count) VALUES (?1, ?2, ?3, ?4)
             ON CONFLICT (day, source, key) DO UPDATE SET count = count + excluded.count",
        )?;
        for (vk, n) in &p.counts.per_key {
            key.execute(params![day, NATIVE_SOURCE, keys::from_vk(*vk), *n as i64])?;
        }
        if !p.counts.per_cell.is_empty() {
            let mut cell = tx.prepare_cached(
                "INSERT INTO mouse_cell (day, source, x, y, clicks, moves) VALUES (?1, ?2, ?3, ?4, ?5, ?6)
                 ON CONFLICT (day, source, x, y) DO UPDATE SET clicks = clicks + excluded.clicks, moves = moves + excluded.moves",
            )?;
            for ((x, y), c) in &p.counts.per_cell {
                cell.execute(params![day, NATIVE_SOURCE, x, y, c.clicks as i64, c.moves as i64])?;
            }
            let screens = win::screens();
            if !screens.is_empty() {
                tx.execute(
                    "INSERT INTO mouse_layout (day, screens) VALUES (?1, ?2) ON CONFLICT (day) DO UPDATE SET screens = excluded.screens",
                    params![day, serde_json::to_string(&screens)?],
                )?;
            }
        }
        let mut net = tx.prepare_cached(
            "INSERT INTO net_hour (day, hour, source, download, upload) VALUES (?1, ?2, ?3, ?4, ?5)
             ON CONFLICT (day, hour, source) DO UPDATE SET
               download = download + excluded.download, upload = upload + excluded.upload",
        )?;
        for ((d, h), (down, up)) in &p.net {
            net.execute(params![d, h, NATIVE_SOURCE, *down as i64, *up as i64])?;
        }
        let mut up = tx.prepare_cached(
            "INSERT INTO uptime_hour (day, hour, source, ms) VALUES (?1, ?2, ?3, ?4)
             ON CONFLICT (day, hour, source) DO UPDATE SET ms = ms + excluded.ms",
        )?;
        for ((d, h), ms) in &p.uptime {
            up.execute(params![d, h, NATIVE_SOURCE, ms])?;
        }
    }
    tx.commit()?;
    Ok(())
}

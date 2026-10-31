//! Rhythm mode. While a rhythm game is in front, Katsudō keeps keys per second for the whole
//! session, the true peak (the 1-second window the live meter uses, sampled every 20 ms) and
//! streams: runs of seconds at 10 or more keys. Sessions end 30 s after the game leaves the
//! front, or when another game takes its place.

use crate::{db, hooks};
use anyhow::Result;
use rusqlite::{params, Connection};
use serde::Serialize;
use std::collections::HashSet;
use std::sync::atomic::{AtomicI64, AtomicU64, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, Instant};

/// The rhythm game in front (app id), or 0. The tracker sets it every tick.
pub static IN_GAME: AtomicI64 = AtomicI64::new(0);
/// Highest live keys-per-second since the session began; the sampler raises it.
pub static SESSION_PEAK: AtomicU64 = AtomicU64::new(0);

/// A second at this many keys or more is part of a stream.
pub const STREAM_KPS: u16 = 10;
/// Shorter sessions (a menu, a quick look) are not kept.
const MIN_SECS: usize = 20;
const MIN_KEYS: u64 = 50;

/// Rhythm games recognised by executable name, before anything is marked by hand.
const KNOWN: &[&str] = &[
    "osu!.exe", "osu.exe", "quaver.exe", "etterna.exe", "stepmania.exe", "itgmania.exe", "notitg.exe", "outfox.exe",
    "beatoraja.exe", "lr2body.exe", "bmsc.exe", "malody.exe", "mumu.exe", "rhythm doctor.exe", "djmax respect v.exe",
    "musedash.exe", "clone hero.exe", "yarg.exe", "unbeatable.exe", "taiko.exe", "opentaiko.exe", "tja player.exe",
    "spinrhythm.exe", "sixtar gate startrail.exe", "rizline.exe", "ez2on.exe", "ez2on reboot r.exe", "o2jam.exe",
    "funkin.exe", "psych engine.exe", "kade engine.exe", "rotaeno.exe", "arcaea.exe", "maimai.exe", "sdvx.exe",
    "soundvoltex.exe", "konaste.exe", "iidx.exe", "bm2dx.exe", "trombone champ.exe", "sound space plus.exe",
];

/// Apps marked by hand: "on" adds an app, "off" removes a recognised one. Setting "rhythm_apps".
#[derive(Default, serde::Deserialize, Serialize, Clone)]
pub struct Marks {
    #[serde(default)]
    pub on: HashSet<String>,
    #[serde(default)]
    pub off: HashSet<String>,
}

fn marks() -> &'static Mutex<Marks> {
    static M: OnceLock<Mutex<Marks>> = OnceLock::new();
    M.get_or_init(|| Mutex::new(Marks::default()))
}

pub fn load_marks(conn: &Connection) {
    let m = db::get_setting(conn, "rhythm_apps").and_then(|s| serde_json::from_str(&s).ok()).unwrap_or_default();
    *marks().lock().unwrap() = m;
}

pub fn known(key: &str) -> bool {
    KNOWN.contains(&key)
}

/// Whether the app with this key (lower-case exe name) counts as a rhythm game.
pub fn is_game(key: &str) -> bool {
    let m = marks().lock().unwrap();
    m.on.contains(key) || (known(key) && !m.off.contains(key))
}

pub fn mark(conn: &Connection, key: &str, game: bool) -> Result<()> {
    let mut m = marks().lock().unwrap();
    m.on.remove(key);
    m.off.remove(key);
    if game && !known(key) {
        m.on.insert(key.to_string());
    } else if !game && known(key) {
        m.off.insert(key.to_string());
    }
    db::set_setting(conn, "rhythm_apps", &serde_json::to_string(&*m)?)
}

// ---- the session being played --------------------------------------------------------

/// What the Rhythm page shows while you play.
#[derive(Serialize, Clone, Default)]
pub struct Live {
    pub app_id: i64,
    /// Filled in by the command that hands this to the page.
    pub app: String,
    pub started: f64,
    pub keys: u64,
    pub peak_kps: u64,
    pub best_stream: u32,
    /// The stream running right now, in seconds.
    pub stream: u32,
    /// Keys per second for the last two minutes, oldest first.
    pub recent: Vec<u16>,
}

fn live() -> &'static Mutex<Option<Live>> {
    static L: OnceLock<Mutex<Option<Live>>> = OnceLock::new();
    L.get_or_init(|| Mutex::new(None))
}

pub fn current() -> Option<Live> {
    live().lock().unwrap().clone()
}

/// The stream running now, in seconds, while a session is on (cheap: the overlay asks 60
/// times a second).
pub fn current_stream() -> Option<u32> {
    live().lock().unwrap().as_ref().map(|l| l.stream)
}

struct Session {
    app_id: i64,
    started: f64,
    tick: Instant,
    last_total: u64,
    series: Vec<u16>,
    away_since: Option<Instant>,
    away_len: usize,
}

/// Longest run of stream seconds, and how many runs lasted five seconds or more.
pub fn streams(series: &[u16]) -> (u32, u32) {
    let (mut best, mut run, mut count) = (0u32, 0u32, 0u32);
    for &k in series.iter().chain(std::iter::once(&0)) {
        if k >= STREAM_KPS {
            run += 1;
        } else {
            if run >= 5 {
                count += 1;
            }
            best = best.max(run);
            run = 0;
        }
    }
    (best, count)
}

fn save(write: &Mutex<Connection>, s: &Session) -> Result<()> {
    let mut series = s.series.clone();
    // Seconds after the game left the front, then any silence at either end.
    series.truncate(series.len().saturating_sub(s.away_len));
    while series.last() == Some(&0) {
        series.pop();
    }
    let lead = series.iter().take_while(|k| **k == 0).count();
    let series = series.split_off(lead);
    let keys: u64 = series.iter().map(|k| *k as u64).sum();
    if series.len() < MIN_SECS || keys < MIN_KEYS {
        return Ok(());
    }
    let start = s.started + lead as f64;
    let (best, count) = streams(&series);
    let peak = SESSION_PEAK.load(Ordering::Relaxed).max(series.iter().copied().max().unwrap_or(0) as u64);
    let blob: Vec<u8> = series.iter().flat_map(|k| k.to_le_bytes()).collect();
    let conn = write.lock().unwrap();
    conn.execute(
        "INSERT INTO rhythm_session (app_id, start, end, keys, peak_kps, best_stream, streams, series) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        params![s.app_id, start, start + series.len() as f64, keys as i64, peak as i64, best, count, blob],
    )?;
    Ok(())
}

/// Seconds a game may be away before its session ends (KATSUDO_RHYTHM_AWAY for tests).
fn away_limit() -> Duration {
    Duration::from_secs(std::env::var("KATSUDO_RHYTHM_AWAY").ok().and_then(|v| v.parse().ok()).unwrap_or(30))
}

/// Watch for rhythm games and record their sessions. Runs on its own thread at 20 Hz.
pub fn start(write: Arc<Mutex<Connection>>) {
    std::thread::Builder::new()
        .name("katsudo-rhythm".into())
        .spawn(move || {
            let away = away_limit();
            let mut session: Option<Session> = None;
            loop {
                // Ten times a second only while a game is in front or a session is open.
                let busy = session.is_some() || IN_GAME.load(Ordering::Relaxed) != 0;
                std::thread::sleep(Duration::from_millis(if busy { 50 } else { 500 }));
                let game = IN_GAME.load(Ordering::Relaxed);
                let now = Instant::now();
                if let Some(s) = session.as_mut() {
                    // Close every whole second since the last one.
                    while now.duration_since(s.tick) >= Duration::from_secs(1) {
                        s.tick += Duration::from_secs(1);
                        let total = hooks::KEYS_TOTAL.load(Ordering::Relaxed);
                        s.series.push((total - s.last_total).min(u16::MAX as u64) as u16);
                        s.last_total = total;
                        if s.away_since.is_some() {
                            s.away_len += 1;
                        }
                    }
                    if game == s.app_id {
                        s.away_since = None;
                        s.away_len = 0;
                    } else if s.away_since.is_none() {
                        s.away_since = Some(now);
                    }
                    let ended = (game != 0 && game != s.app_id) || s.away_since.is_some_and(|t| now.duration_since(t) >= away);
                    if ended {
                        if let Err(e) = save(&write, s) {
                            eprintln!("katsudo: rhythm session not saved: {e}");
                        }
                        session = None;
                        *live().lock().unwrap() = None;
                    } else {
                        let (best, _) = streams(&s.series);
                        let stream = s.series.iter().rev().take_while(|k| **k >= STREAM_KPS).count() as u32;
                        *live().lock().unwrap() = Some(Live {
                            app_id: s.app_id,
                            app: String::new(),
                            started: s.started,
                            keys: s.series.iter().map(|k| *k as u64).sum(),
                            peak_kps: SESSION_PEAK.load(Ordering::Relaxed),
                            best_stream: best,
                            stream,
                            recent: s.series[s.series.len().saturating_sub(120)..].to_vec(),
                        });
                    }
                }
                if session.is_none() && game != 0 {
                    SESSION_PEAK.store(0, Ordering::Relaxed);
                    session = Some(Session {
                        app_id: game,
                        started: db::now_secs() as f64,
                        tick: now,
                        last_total: hooks::KEYS_TOTAL.load(Ordering::Relaxed),
                        series: Vec::new(),
                        away_since: None,
                        away_len: 0,
                    });
                }
            }
        })
        .expect("spawn rhythm thread");
}

// ---- reading back ----------------------------------------------------------------------

#[derive(Serialize)]
pub struct SessionRow {
    pub id: i64,
    pub app_id: i64,
    pub app: String,
    pub start: f64,
    pub end: f64,
    pub keys: i64,
    pub peak_kps: i64,
    pub best_stream: i64,
    pub streams: i64,
}

#[derive(Serialize)]
pub struct Best {
    pub app_id: i64,
    pub app: String,
    pub sessions: i64,
    pub seconds: f64,
    pub keys: i64,
    pub peak_kps: i64,
    pub peak_at: f64,
    pub best_stream: i64,
    pub stream_at: f64,
    pub most_keys: i64,
}

#[derive(Serialize)]
pub struct GameApp {
    pub key: String,
    pub name: String,
    pub game: bool,
    pub known: bool,
    pub keys: i64,
}

#[derive(Serialize)]
pub struct Overview {
    pub sessions: Vec<SessionRow>,
    pub bests: Vec<Best>,
    pub apps: Vec<GameApp>,
    pub stream_kps: u16,
}

pub fn overview(conn: &Connection) -> Result<Overview> {
    let sessions = conn
        .prepare(
            "SELECT r.id, r.app_id, COALESCE(a.name, '?'), r.start, r.end, r.keys, r.peak_kps, r.best_stream, r.streams
             FROM rhythm_session r LEFT JOIN app a ON a.id = r.app_id ORDER BY r.start DESC LIMIT 300",
        )?
        .query_map([], |r| {
            Ok(SessionRow {
                id: r.get(0)?,
                app_id: r.get(1)?,
                app: r.get(2)?,
                start: r.get(3)?,
                end: r.get(4)?,
                keys: r.get(5)?,
                peak_kps: r.get(6)?,
                best_stream: r.get(7)?,
                streams: r.get(8)?,
            })
        })?
        .collect::<rusqlite::Result<_>>()?;
    let bests = conn
        .prepare(
            "SELECT r.app_id, COALESCE(a.name, '?'), COUNT(*), SUM(r.end - r.start), SUM(r.keys), MAX(r.peak_kps),
                    (SELECT start FROM rhythm_session p WHERE p.app_id = r.app_id ORDER BY peak_kps DESC, start LIMIT 1),
                    MAX(r.best_stream),
                    (SELECT start FROM rhythm_session p WHERE p.app_id = r.app_id ORDER BY best_stream DESC, start LIMIT 1),
                    MAX(r.keys)
             FROM rhythm_session r LEFT JOIN app a ON a.id = r.app_id GROUP BY r.app_id ORDER BY SUM(r.end - r.start) DESC",
        )?
        .query_map([], |r| {
            Ok(Best {
                app_id: r.get(0)?,
                app: r.get(1)?,
                sessions: r.get(2)?,
                seconds: r.get(3)?,
                keys: r.get(4)?,
                peak_kps: r.get(5)?,
                peak_at: r.get(6)?,
                best_stream: r.get(7)?,
                stream_at: r.get(8)?,
                most_keys: r.get(9)?,
            })
        })?
        .collect::<rusqlite::Result<_>>()?;
    // Apps you type in most (any source, last year), so a game can be marked from the list.
    let since = db::shift_day(&db::today(), -365)?;
    let mut apps: Vec<GameApp> = conn
        .prepare(
            "SELECT a.key, a.name, SUM(i.keys) k FROM input_hour i JOIN app a ON a.id = i.app_id
             WHERE i.day >= ?1 AND i.app_id != 0 GROUP BY a.id ORDER BY k DESC LIMIT 40",
        )?
        .query_map([since], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?, r.get::<_, i64>(2)?)))?
        .filter_map(|r| r.ok())
        .map(|(key, name, keys)| GameApp { game: is_game(&key), known: known(&key), key, name, keys })
        .collect();
    // Marked games always show, even with nothing typed lately.
    let listed: HashSet<String> = apps.iter().map(|a| a.key.clone()).collect();
    for key in marks().lock().unwrap().on.iter().filter(|k| !listed.contains(*k)) {
        let name = conn.query_row("SELECT name FROM app WHERE key = ?1", [key], |r| r.get(0)).unwrap_or_else(|_| key.clone());
        apps.push(GameApp { key: key.clone(), name, game: true, known: false, keys: 0 });
    }
    Ok(Overview { sessions, bests, apps, stream_kps: STREAM_KPS })
}

pub fn series(conn: &Connection, id: i64) -> Result<Vec<u16>> {
    let blob: Vec<u8> = conn.query_row("SELECT series FROM rhythm_session WHERE id = ?1", [id], |r| r.get(0))?;
    Ok(blob.chunks_exact(2).map(|c| u16::from_le_bytes([c[0], c[1]])).collect())
}

#[cfg(test)]
mod tests {
    use super::streams;

    #[test]
    fn stream_runs() {
        assert_eq!(streams(&[]), (0, 0));
        assert_eq!(streams(&[12, 12, 12, 12, 12, 3, 11, 11]), (5, 1));
        assert_eq!(streams(&[10; 7]), (7, 1));
        assert_eq!(streams(&[9, 10, 10, 9, 10, 10, 10, 10, 10, 10]), (6, 1));
    }
}

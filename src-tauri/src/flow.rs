//! Flow: stretches of deep, unbroken work, found in the timeline. A flow session is at least
//! `flow_minutes` (25 by default) spent present on one task, where the task is the tag your
//! rules give the time and otherwise the app. Short detours (two minutes at most at a time)
//! are forgiven but counted; going away, or switching for longer, ends the session; and a
//! session has to spend three quarters of its time on its task. A browser is no task by
//! itself (a day of browsing isn't deep work): its time counts once a rule tags the site. Tasks
//! you mark as not counting (flow_skip) are left out of every total. Sessions are kept in
//! flow_session, caught up as new time is recorded and rebuilt when the rules or the minimum
//! change.

use crate::db::{self, LANE_ACTIVITY, LANE_APP, LANE_DOC};
use crate::queries::{self, Row};
use crate::tags::{self, Matcher, UNTAGGED};
use crate::tracker::Seg;
use anyhow::Result;
use chrono::{Datelike, Local, TimeZone, Timelike};
use rusqlite::{params, Connection, OptionalExtension};
use serde::Serialize;
use std::collections::{BTreeSet, HashMap};
use std::path::Path;
use std::sync::atomic::{AtomicBool, AtomicI64, Ordering};
use std::sync::{Arc, Mutex};

/// The longest detour (another task, or away) a session absorbs.
const GRACE: i64 = 120;
/// The share of a session that has to be on its task.
const MIN_FOCUS: f64 = 0.75;
/// Look this far either side of a day, so a session crossing midnight is seen whole.
const MARGIN: i64 = 6 * 3600;
/// Bump to rebuild everyone's sessions after changing how they're found.
const ALGO: i64 = 2;
pub const DEFAULT_MINUTES: i64 = 25;
/// Time that belongs to no task: an untagged browser.
const NO_TASK: i64 = 0;
const BROWSER_KEYS: &[&str] = &[
    "chrome", "brave", "firefox", "msedge", "opera", "opera_gx", "vivaldi", "arc", "zen", "librewolf", "waterfox", "floorp", "chromium", "iexplore", "thorium",
];
const BROWSER_NAMES: &[&str] = &[
    "google chrome", "brave browser", "brave", "firefox", "mozilla firefox", "microsoft edge", "opera", "opera gx", "vivaldi", "arc", "zen browser", "librewolf", "waterfox", "floorp", "chromium", "internet explorer",
];

/// From an app's lower-case key (its file name) and name.
fn is_browser(key: &str, name: &str) -> bool {
    BROWSER_KEYS.contains(&key.trim_end_matches(".exe")) || BROWSER_NAMES.contains(&name)
}

static REFRESHING: AtomicBool = AtomicBool::new(false);
static LAST_REFRESH: AtomicI64 = AtomicI64::new(0);
static LOCK: Mutex<()> = Mutex::new(());

#[derive(Serialize, Clone, Debug, PartialEq)]
pub struct Session {
    pub start: i64,
    pub end: i64,
    /// A tag id (> 0), or minus an app id where no rule tags the time.
    pub task: i64,
    /// The app used most.
    pub app_id: i64,
    /// Seconds spent on the task.
    pub focus: i64,
    /// Detours taken and come back from.
    pub breaks: i64,
}

/// A piece of present time and the task it belongs to.
#[derive(Clone, Copy, Debug)]
pub struct Piece {
    pub start: i64,
    pub end: i64,
    pub task: i64,
    pub app: i64,
}

pub fn min_secs(conn: &Connection) -> i64 {
    db::get_setting(conn, "flow_minutes").and_then(|v| v.parse::<i64>().ok()).filter(|m| (5..=240).contains(m)).unwrap_or(DEFAULT_MINUTES) * 60
}

/// Tasks marked as not counting: tag ids and minus app ids.
pub fn skipped(conn: &Connection) -> Vec<i64> {
    db::get_setting(conn, "flow_skip").and_then(|v| serde_json::from_str(&v).ok()).unwrap_or_default()
}

fn skip_sql(conn: &Connection) -> String {
    skipped(conn).iter().map(|t| t.to_string()).chain(["0".to_string()]).collect::<Vec<_>>().join(",")
}

// ---- finding sessions ---------------------------------------------------------------------

struct Candidate {
    task: i64,
    start: i64,
    /// Where the task was last left.
    last_on: i64,
    focus: i64,
    breaks: i64,
    apps: HashMap<i64, i64>,
    /// The latest point it qualified at (end, focus, breaks), in case later switching spoils it.
    best: Option<(i64, i64, i64)>,
}

impl Candidate {
    fn new(p: &Piece, min_secs: i64) -> Self {
        let mut c = Candidate { task: p.task, start: p.start, last_on: p.start, focus: 0, breaks: 0, apps: HashMap::new(), best: None };
        c.add(p);
        c.check(min_secs);
        c
    }
    fn add(&mut self, p: &Piece) {
        self.focus += p.end - p.start;
        self.last_on = p.end;
        *self.apps.entry(p.app).or_insert(0) += p.end - p.start;
    }
    fn qualifies(&self, min_secs: i64) -> bool {
        let span = self.last_on - self.start;
        span >= min_secs && self.focus as f64 >= MIN_FOCUS * span as f64
    }
    /// Note a qualifying point; call after every piece on the task.
    fn check(&mut self, min_secs: i64) {
        if self.qualifies(min_secs) {
            self.best = Some((self.last_on, self.focus, self.breaks));
        }
    }
    fn finish(self, out: &mut Vec<Session>) {
        if let Some((end, focus, breaks)) = self.best {
            let app_id = self.apps.iter().max_by_key(|(id, secs)| (**secs, -**id)).map(|(id, _)| *id).unwrap_or(0);
            out.push(Session { start: self.start, end, task: self.task, app_id, focus, breaks });
        }
    }
}

/// Flow sessions in pieces of present time, in order.
pub fn detect(pieces: &[Piece], min_secs: i64) -> Vec<Session> {
    let mut out = Vec::new();
    let mut cur: Option<Candidate> = None;
    for p in pieces {
        cur = match cur.take() {
            None if p.task == NO_TASK => None,
            None => Some(Candidate::new(p, min_secs)),
            Some(mut c) if c.task == p.task => {
                if p.start - c.last_on > GRACE {
                    c.finish(&mut out);
                    Some(Candidate::new(p, min_secs))
                } else {
                    if p.start > c.last_on {
                        c.breaks += 1;
                    }
                    c.add(p);
                    c.check(min_secs);
                    Some(c)
                }
            }
            // A detour: forgiven until it outlasts the grace, then the session ends where it began.
            Some(c) if p.end - c.last_on > GRACE => {
                c.finish(&mut out);
                (p.task != NO_TASK).then(|| Candidate::new(p, min_secs))
            }
            Some(c) => Some(c),
        };
    }
    if let Some(c) = cur {
        c.finish(&mut out);
    }
    out
}

/// Present time between `start` and `end`, split by task.
fn pieces(conn: &Connection, m: &mut Matcher, start: i64, end: i64, live: &[Seg]) -> Result<Vec<Piece>> {
    let apps = queries::rows(conn, LANE_APP, start, end, live)?;
    let docs = queries::rows(conn, LANE_DOC, start, end, live)?;
    let raw: Vec<Piece> = tags::split(&apps, &docs)
        .into_iter()
        .map(|(s, e, app, title)| {
            let tag = m.tag(conn, app, title);
            let task = match tag {
                UNTAGGED => {
                    let (key, name) = m.app(conn, app);
                    if is_browser(key, name) { NO_TASK } else { -app }
                }
                t => t,
            };
            Piece { start: s, end: e, task, app }
        })
        .collect();
    // Only the time you were there: some imports keep an app open while you're away.
    let mut present: Vec<(i64, i64)> = Vec::new();
    for r in queries::rows(conn, LANE_ACTIVITY, start, end, live)?.into_iter().filter(|r: &Row| r.ref_id == 1) {
        match present.last_mut() {
            Some(last) if r.start <= last.1 => last.1 = last.1.max(r.end),
            _ => present.push((r.start, r.end)),
        }
    }
    if present.is_empty() {
        return Ok(raw);
    }
    let mut out = Vec::with_capacity(raw.len());
    let mut i = 0;
    for p in raw {
        while i < present.len() && present[i].1 <= p.start {
            i += 1;
        }
        for &(s, e) in present[i..].iter().take_while(|(s, _)| *s < p.end) {
            let (a, b) = (p.start.max(s), p.end.min(e));
            if b > a {
                out.push(Piece { start: a, end: b, ..p });
            }
        }
    }
    Ok(out)
}

/// Sessions starting on a local day (seen whole, even past midnight).
fn sessions_starting(conn: &Connection, m: &mut Matcher, day: &str, min_secs: i64) -> Result<Vec<Session>> {
    let (ds, de) = db::day_bounds(day)?;
    let ps = pieces(conn, m, ds - MARGIN, de + MARGIN, &[])?;
    Ok(detect(&ps, min_secs).into_iter().filter(|s| s.start >= ds && s.start < de).collect())
}

// ---- rollup -------------------------------------------------------------------------------

fn meta_str(conn: &Connection, key: &str) -> String {
    conn.query_row("SELECT value FROM meta WHERE key = ?1", [key], |r| r.get(0)).optional().ok().flatten().unwrap_or_default()
}

/// Bring flow_session up to date: everything again when the rules or the minimum changed,
/// else the days new segments touched (and the day before each, for sessions past midnight).
pub fn refresh(db_path: &Path, write: &Mutex<Connection>) -> Result<()> {
    let _one_at_a_time = LOCK.lock().unwrap_or_else(|e| e.into_inner());
    LAST_REFRESH.store(db::now_secs(), Ordering::Relaxed);
    let read = db::open(db_path)?;
    let min = min_secs(&read);
    let key = format!("{ALGO}:{}:{min}", tags::meta_i64(&read, "tag_rules_version"));
    let rebuild = meta_str(&read, "flow_rollup_key") != key;
    let upto = if rebuild { 0 } else { tags::meta_i64(&read, "flow_rollup_upto") };
    let last: i64 = read.query_row("SELECT COALESCE(MAX(id), 0) FROM segment", [], |r| r.get(0))?;
    if !rebuild && last == upto {
        return Ok(());
    }
    let touched: Vec<String> = read
        .prepare("SELECT DISTINCT date(start, 'unixepoch', 'localtime') FROM segment WHERE id > ?1 AND lane IN (?2, ?3, ?4)")?
        .query_map(params![upto, LANE_ACTIVITY, LANE_APP, LANE_DOC], |r| r.get(0))?
        .collect::<rusqlite::Result<_>>()?;
    let mut days = BTreeSet::new();
    for d in touched {
        days.insert(db::shift_day(&d, -1)?);
        days.insert(d);
    }
    let mut m = Matcher::load(&read)?;
    let mut found = Vec::with_capacity(days.len());
    for d in &days {
        found.push((d.clone(), sessions_starting(&read, &mut m, d, min)?));
    }
    let conn = write.lock().unwrap();
    let tx = conn.unchecked_transaction()?;
    if rebuild {
        tx.execute("DELETE FROM flow_session", [])?;
    }
    {
        let mut del = tx.prepare("DELETE FROM flow_session WHERE day = ?1")?;
        let mut ins = tx.prepare(
            "INSERT OR REPLACE INTO flow_session (start, end, day, task, app_id, focus, breaks) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        )?;
        for (d, list) in &found {
            del.execute([d])?;
            for s in list {
                ins.execute(params![s.start, s.end, d, s.task, s.app_id, s.focus, s.breaks])?;
            }
        }
    }
    tx.execute("INSERT OR REPLACE INTO meta (key, value) VALUES ('flow_rollup_key', ?1)", [&key])?;
    tags::set_meta(&tx, "flow_rollup_upto", last)?;
    tx.commit()?;
    Ok(())
}

/// Refresh in the background unless one is running, or one ran in the last `min_gap` seconds.
pub fn refresh_soon(db_path: std::path::PathBuf, write: Arc<Mutex<Connection>>, min_gap: i64) {
    if db::now_secs() - LAST_REFRESH.load(Ordering::Relaxed) < min_gap || REFRESHING.swap(true, Ordering::SeqCst) {
        return;
    }
    let _ = std::thread::Builder::new().name("katsudo-flow".into()).spawn(move || {
        if let Err(e) = refresh(&db_path, &write) {
            eprintln!("katsudo: flow rollup: {e}");
        }
        REFRESHING.store(false, Ordering::SeqCst);
    });
}

// ---- reading back -------------------------------------------------------------------------

/// A session with what to call it.
#[derive(Serialize, Clone)]
pub struct Named {
    #[serde(flatten)]
    pub session: Session,
    /// The tag's name, or the app's.
    pub label: String,
    /// The tag's colour; none for an app.
    pub color: Option<String>,
    /// The app used most.
    pub app: String,
}

struct Names {
    tags: HashMap<i64, (String, String)>,
    apps: HashMap<i64, String>,
}

impl Names {
    fn load(conn: &Connection) -> Result<Self> {
        let tags = tags::setup(conn)?.tags.into_iter().map(|t| (t.id, (t.name, t.color))).collect();
        Ok(Names { tags, apps: HashMap::new() })
    }
    fn app(&mut self, conn: &Connection, id: i64) -> String {
        self.apps
            .entry(id)
            .or_insert_with(|| conn.query_row("SELECT name FROM app WHERE id = ?1", [id], |r| r.get(0)).unwrap_or_else(|_| format!("App {id}")))
            .clone()
    }
    fn task(&mut self, conn: &Connection, task: i64) -> (String, Option<String>) {
        if task > 0 {
            if let Some((name, color)) = self.tags.get(&task) {
                return (name.clone(), Some(color.clone()));
            }
            return ("Tag".into(), None);
        }
        (self.app(conn, -task), None)
    }
    fn name(&mut self, conn: &Connection, s: Session) -> Named {
        let (label, color) = self.task(conn, s.task);
        let app = self.app(conn, s.app_id);
        Named { session: s, label, color, app }
    }
}

/// One day's sessions for Today and the timeline, live, with the six days before from the rollup.
#[derive(Serialize)]
pub struct DayFlow {
    /// Sessions touching the day, with `from`/`to` in hours from its midnight.
    pub sessions: Vec<DaySession>,
    /// Flow seconds on each of the seven days ending with this one.
    pub week: Vec<i64>,
    /// The session still going, if you're in one now.
    pub now: Option<Named>,
}

#[derive(Serialize)]
pub struct DaySession {
    pub from: f64,
    pub to: f64,
    #[serde(flatten)]
    pub named: Named,
}

pub fn day(conn: &Connection, day: &str, live: &[Seg]) -> Result<DayFlow> {
    let (ds, de) = db::day_bounds(day)?;
    let now = db::now_secs();
    let mut m = Matcher::load(conn)?;
    let ps = pieces(conn, &mut m, ds - MARGIN, (de + MARGIN).min(now + 1), live)?;
    let min = min_secs(conn);
    let mut names = Names::load(conn)?;
    let skip = skipped(conn);
    let found: Vec<Session> = detect(&ps, min).into_iter().filter(|s| s.end > ds && s.start < de && !skip.contains(&s.task)).collect();
    let today_secs: i64 = found.iter().map(|s| s.end.min(de) - s.start.max(ds)).sum();
    let live_now = found.last().filter(|s| !live.is_empty() && now - s.end <= GRACE).cloned();
    let sessions = found
        .into_iter()
        .map(|s| DaySession {
            from: (s.start - ds) as f64 / 3600.0,
            to: (s.end - ds) as f64 / 3600.0,
            named: names.name(conn, s),
        })
        .collect();
    let mut week = Vec::with_capacity(7);
    let mut stmt = conn.prepare(&format!("SELECT COALESCE(SUM(end - start), 0) FROM flow_session WHERE day = ?1 AND task NOT IN ({})", skip_sql(conn)))?;
    for back in (1..7).rev() {
        week.push(stmt.query_row([db::shift_day(day, -back)?], |r| r.get(0))?);
    }
    week.push(today_secs);
    Ok(DayFlow { sessions, week, now: live_now.map(|s| names.name(conn, s)) })
}

#[derive(Serialize)]
pub struct TaskTotal {
    pub task: i64,
    pub label: String,
    pub color: Option<String>,
    pub secs: i64,
    pub sessions: i64,
}

#[derive(Serialize)]
pub struct Report {
    pub minutes: i64,
    /// Seconds in flow, and in sessions.
    pub total: i64,
    pub count: i64,
    /// Time at the computer over the range, for the share in flow.
    pub active: i64,
    /// Flow seconds per day, in order.
    pub days: Vec<(String, i64)>,
    /// Flow seconds per hour of the day, Monday first: [weekday][hour].
    pub week_hours: Vec<Vec<i64>>,
    pub tasks: Vec<TaskTotal>,
    /// Tasks marked as not counting, with what they would have added.
    pub skipped: Vec<TaskTotal>,
    /// The longest sessions.
    pub longest: Vec<Named>,
    /// True when no tags exist yet (switching apps then ends a session).
    pub untagged: bool,
}

pub fn report(conn: &Connection, from: &str, to: &str) -> Result<Report> {
    let mut days: Vec<(String, i64)> = Vec::new();
    let mut d = from.to_string();
    while d.as_str() <= to && days.len() < 3700 {
        days.push((d.clone(), 0));
        d = db::shift_day(&d, 1)?;
    }
    let index: HashMap<String, usize> = days.iter().enumerate().map(|(i, (d, _))| (d.clone(), i)).collect();
    let mut week_hours = vec![vec![0i64; 24]; 7];
    let mut by_task: HashMap<i64, (i64, i64)> = HashMap::new();
    let mut all: Vec<Session> = Vec::new();
    let mut stmt = conn.prepare("SELECT start, end, day, task, app_id, focus, breaks FROM flow_session WHERE day BETWEEN ?1 AND ?2 ORDER BY start")?;
    let skip = skipped(conn);
    let mut skipped_tasks: HashMap<i64, (i64, i64)> = HashMap::new();
    let rows = stmt.query_map(params![from, to], |r| {
        Ok((
            Session { start: r.get(0)?, end: r.get(1)?, task: r.get(3)?, app_id: r.get(4)?, focus: r.get(5)?, breaks: r.get(6)? },
            r.get::<_, String>(2)?,
        ))
    })?;
    for row in rows {
        let (s, day) = row?;
        let len = s.end - s.start;
        if skip.contains(&s.task) {
            let t = skipped_tasks.entry(s.task).or_insert((0, 0));
            t.0 += len;
            t.1 += 1;
            continue;
        }
        if let Some(i) = index.get(&day) {
            days[*i].1 += len;
        }
        let t = by_task.entry(s.task).or_insert((0, 0));
        t.0 += len;
        t.1 += 1;
        // Spread over the local hours it covered.
        let mut t = s.start;
        while t < s.end {
            let Some(at) = Local.timestamp_opt(t, 0).earliest() else { break };
            let next = (t + 3600 - (at.minute() as i64 * 60 + at.second() as i64)).min(s.end);
            week_hours[at.weekday().num_days_from_monday() as usize][at.hour() as usize] += next - t;
            t = next;
        }
        all.push(s);
    }
    let total = all.iter().map(|s| s.end - s.start).sum();
    let count = all.len() as i64;
    let mut names = Names::load(conn)?;
    let mut tasks: Vec<TaskTotal> = by_task
        .into_iter()
        .map(|(task, (secs, sessions))| {
            let (label, color) = names.task(conn, task);
            TaskTotal { task, label, color, secs, sessions }
        })
        .collect();
    tasks.sort_by(|a, b| b.secs.cmp(&a.secs));
    tasks.truncate(12);
    let mut skipped: Vec<TaskTotal> = skip
        .iter()
        .map(|&task| {
            let (secs, sessions) = skipped_tasks.get(&task).copied().unwrap_or((0, 0));
            let (label, color) = names.task(conn, task);
            TaskTotal { task, label, color, secs, sessions }
        })
        .collect();
    skipped.sort_by(|a, b| b.secs.cmp(&a.secs));
    all.sort_by(|a, b| (b.end - b.start).cmp(&(a.end - a.start)));
    let longest = all.into_iter().take(8).map(|s| names.name(conn, s)).collect();
    let active = conn.query_row("SELECT COALESCE(SUM(secs), 0) FROM tag_day WHERE day BETWEEN ?1 AND ?2", params![from, to], |r| r.get(0))?;
    let untagged = names.tags.is_empty();
    Ok(Report { minutes: min_secs(conn) / 60, total, count, active, days, week_hours, tasks, skipped, longest, untagged })
}

/// Seconds in flow and sessions over a range, from the rollup.
pub fn totals(conn: &Connection, from: &str, to: &str) -> Result<(i64, i64)> {
    Ok(conn.query_row(
        &format!("SELECT COALESCE(SUM(end - start), 0), COUNT(*) FROM flow_session WHERE day BETWEEN ?1 AND ?2 AND task NOT IN ({})", skip_sql(conn)),
        params![from, to],
        |r| Ok((r.get(0)?, r.get(1)?)),
    )?)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn p(start: i64, end: i64, task: i64) -> Piece {
        Piece { start, end, task, app: task.abs() }
    }

    #[test]
    fn short_detours_are_forgiven_long_ones_end_it() {
        let min = 25 * 60;
        // 20 min on task 1, a 90 s glance at task 2, 15 more minutes on 1, then 10 min on 2.
        let ps = [p(0, 1200, 1), p(1200, 1290, 2), p(1290, 2190, 1), p(2190, 2790, 2)];
        let got = detect(&ps, min);
        assert_eq!(got.len(), 1);
        assert_eq!((got[0].start, got[0].end, got[0].focus, got[0].breaks), (0, 2190, 2100, 1));
    }

    #[test]
    fn going_away_ends_a_session_and_short_ones_dont_count() {
        let min = 25 * 60;
        // 20 min, away 6 min, 20 min: two stretches, neither long enough.
        assert!(detect(&[p(0, 1200, 1), p(1560, 2760, 1)], min).is_empty());
        // Back after 60 s: one session.
        assert_eq!(detect(&[p(0, 1200, 1), p(1260, 2460, 1)], min).len(), 1);
    }

    #[test]
    fn constant_switching_is_not_flow() {
        // 40 minutes alternating a minute each between two tasks: never three quarters on either.
        let ps: Vec<Piece> = (0..40).map(|i| p(i * 60, i * 60 + 60, 1 + i % 2)).collect();
        assert!(detect(&ps, 25 * 60).is_empty());
    }

    #[test]
    fn untagged_browsing_is_no_task() {
        // An hour of untagged browser time finds nothing; it ends a session like any detour.
        assert!(detect(&[p(0, 3600, NO_TASK)], 25 * 60).is_empty());
        let got = detect(&[p(0, 1800, 1), p(1800, 3600, NO_TASK), p(3600, 5400, 1)], 25 * 60);
        assert_eq!(got.iter().map(|s| (s.start, s.end)).collect::<Vec<_>>(), vec![(0, 1800), (3600, 5400)]);
        assert!(is_browser("brave.exe", "brave") && is_browser("x", "google chrome") && !is_browser("code.exe", "visual studio code"));
    }

    #[test]
    fn a_clean_block_survives_switching_after_it() {
        // 30 clean minutes, then 40 minutes swapping every minute: the clean block is kept.
        let mut ps = vec![p(0, 1800, 1)];
        ps.extend((0..40).map(|i| p(1800 + i * 60, 1860 + i * 60, 1 + (i + 1) % 2)));
        let got = detect(&ps, 25 * 60);
        assert_eq!(got.len(), 1);
        assert!(got[0].end >= 1800 && (got[0].focus as f64) >= 0.75 * (got[0].end - got[0].start) as f64);
    }
}

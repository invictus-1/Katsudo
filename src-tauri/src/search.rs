//! Search across your whole history for the command palette: apps, window titles, documents
//! and sites, from Katsudō's own tracking and every import. Time per thing per day is kept in
//! a rollup (ref_day), so totals, first and last seen and busiest days come back instantly
//! instead of scanning millions of segments. The rollup catches up incrementally and rebuilds
//! itself after an import replaces data.

use crate::db::{self, LANE_APP, LANE_DOC};
use anyhow::Result;
use rusqlite::{params, Connection, OptionalExtension};
use serde::Serialize;
use std::collections::HashMap;
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

static BUILDING: AtomicBool = AtomicBool::new(false);

fn meta(conn: &Connection, key: &str) -> i64 {
    conn.query_row("SELECT value FROM meta WHERE key = ?1", [key], |r| r.get::<_, String>(0))
        .optional()
        .ok()
        .flatten()
        .and_then(|v| v.parse().ok())
        .unwrap_or(0)
}

/// Bring the rollup up to date: only segments added since last time, or everything again if
/// any were removed (an import replaced its earlier data). Reads on its own connection and
/// holds the shared writer only to save.
pub fn refresh(db_path: &Path, write: &Mutex<Connection>) -> Result<()> {
    let read = db::open(db_path)?;
    let mut upto = meta(&read, "ref_day_upto");
    let mut rows = meta(&read, "ref_day_rows");
    let still: i64 = read.query_row("SELECT COUNT(*) FROM segment WHERE id <= ?1", [upto], |r| r.get(0))?;
    let rebuild = still != rows;
    if rebuild {
        upto = 0;
        rows = 0;
    }
    let mut secs: HashMap<(i64, i64, String), i64> = HashMap::new();
    let mut title_app: HashMap<i64, i64> = HashMap::new();
    // Local day of an hour, worked out once per hour rather than once per segment.
    let mut days: HashMap<i64, String> = HashMap::new();
    let mut last = upto;
    let mut seen = 0i64;
    {
        let mut stmt = read.prepare("SELECT id, lane, ref, start, end, app_id FROM segment WHERE id > ?1 ORDER BY id")?;
        let mut q = stmt.query([upto])?;
        while let Some(r) = q.next()? {
            let (id, lane, rf, start, end): (i64, i64, i64, i64, i64) = (r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?);
            last = id;
            seen += 1;
            if lane != LANE_APP && lane != LANE_DOC {
                continue;
            }
            let day = days.entry(start.div_euclid(3600)).or_insert_with(|| db::local_day_hour(start).0).clone();
            *secs.entry((lane, rf, day)).or_default() += (end - start).max(0);
            if lane == LANE_DOC {
                if let Some(app) = r.get::<_, Option<i64>>(5)? {
                    title_app.entry(rf).or_insert(app);
                }
            }
        }
    }
    if seen == 0 && !rebuild {
        return Ok(());
    }
    let conn = write.lock().unwrap();
    let tx = conn.unchecked_transaction()?;
    if rebuild {
        tx.execute("DELETE FROM ref_day", [])?;
        tx.execute("DELETE FROM title_app", [])?;
    }
    {
        let mut add = tx.prepare(
            "INSERT INTO ref_day (lane, ref, day, secs) VALUES (?1, ?2, ?3, ?4)
             ON CONFLICT (lane, ref, day) DO UPDATE SET secs = secs + excluded.secs",
        )?;
        for ((lane, rf, day), s) in &secs {
            add.execute(params![lane, rf, day, s])?;
        }
        let mut app = tx.prepare("INSERT OR IGNORE INTO title_app (title, app_id) VALUES (?1, ?2)")?;
        for (t, a) in &title_app {
            app.execute(params![t, a])?;
        }
    }
    tx.execute("INSERT OR REPLACE INTO meta (key, value) VALUES ('ref_day_upto', ?1)", [last.to_string()])?;
    tx.execute("INSERT OR REPLACE INTO meta (key, value) VALUES ('ref_day_rows', ?1)", [(rows + seen).to_string()])?;
    tx.commit()?;
    Ok(())
}

/// Refresh in the background unless a refresh is already running.
pub fn refresh_soon(db_path: std::path::PathBuf, write: Arc<Mutex<Connection>>) {
    if BUILDING.swap(true, Ordering::SeqCst) {
        return;
    }
    let _ = std::thread::Builder::new().name("katsudo-search".into()).spawn(move || {
        if let Err(e) = refresh(&db_path, &write) {
            eprintln!("katsudo: search rollup: {e}");
        }
        BUILDING.store(false, Ordering::SeqCst);
    });
}

#[derive(Serialize)]
pub struct Hit {
    /// "app" or "title".
    pub kind: &'static str,
    pub id: i64,
    pub name: String,
    /// For a title: the app it was seen in.
    pub app: Option<String>,
    pub secs: i64,
    pub first: Option<String>,
    pub last: Option<String>,
    pub days: i64,
}

#[derive(Serialize)]
pub struct Results {
    pub hits: Vec<Hit>,
    /// False while the rollup is being built: names match, times are not in yet.
    pub ready: bool,
}

/// Every word must appear (in any order), case-insensitive. `%` and `_` are literal.
fn like_terms(q: &str) -> Vec<String> {
    q.split_whitespace()
        .take(6)
        .map(|w| format!("%{}%", w.replace('\\', "\\\\").replace('%', "\\%").replace('_', "\\_")))
        .collect()
}

fn stats(conn: &Connection, lane: i64, id: i64) -> Result<(i64, Option<String>, Option<String>, i64)> {
    Ok(conn.prepare_cached("SELECT COALESCE(SUM(secs), 0), MIN(day), MAX(day), COUNT(*) FROM ref_day WHERE lane = ?1 AND ref = ?2")?
        .query_row(params![lane, id], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)))?)
}

pub fn search(conn: &Connection, q: &str) -> Result<Results> {
    let terms = like_terms(q);
    if terms.is_empty() {
        return Ok(Results { hits: Vec::new(), ready: true });
    }
    let cond = |col: &str| terms.iter().enumerate().map(|(i, _)| format!("{col} LIKE ?{} ESCAPE '\\'", i + 1)).collect::<Vec<_>>().join(" AND ");
    let args = rusqlite::params_from_iter(terms.iter());
    let mut apps: Vec<Hit> = Vec::new();
    {
        let sql = format!("SELECT id, name FROM app WHERE {} LIMIT 200", cond("(name || ' ' || key)"));
        let mut stmt = conn.prepare(&sql)?;
        let found: Vec<(i64, String)> = stmt.query_map(args, |r| Ok((r.get(0)?, r.get(1)?)))?.collect::<rusqlite::Result<_>>()?;
        for (id, name) in found {
            let (secs, first, last, days) = stats(conn, LANE_APP, id)?;
            apps.push(Hit { kind: "app", id, name, app: None, secs, first, last, days });
        }
    }
    let mut titles: Vec<Hit> = Vec::new();
    {
        let sql = format!(
            "SELECT t.id, t.text, a.name FROM title t LEFT JOIN title_app ta ON ta.title = t.id LEFT JOIN app a ON a.id = ta.app_id WHERE {} LIMIT 400",
            cond("t.text")
        );
        let mut stmt = conn.prepare(&sql)?;
        let found: Vec<(i64, String, Option<String>)> =
            stmt.query_map(rusqlite::params_from_iter(terms.iter()), |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))?.collect::<rusqlite::Result<_>>()?;
        for (id, name, app) in found {
            let (secs, first, last, days) = stats(conn, LANE_DOC, id)?;
            titles.push(Hit { kind: "title", id, name, app, secs, first, last, days });
        }
    }
    apps.sort_by(|a, b| b.secs.cmp(&a.secs));
    titles.sort_by(|a, b| b.secs.cmp(&a.secs));
    apps.truncate(6);
    titles.truncate(14);
    apps.extend(titles);
    Ok(Results { hits: apps, ready: !BUILDING.load(Ordering::SeqCst) })
}

#[derive(Serialize)]
pub struct Detail {
    pub secs: i64,
    pub first: Option<String>,
    pub last: Option<String>,
    pub days: i64,
    /// The days with the most time, most first.
    pub busiest: Vec<(String, i64)>,
    /// Time per year, oldest first.
    pub years: Vec<(String, i64)>,
}

pub fn detail(conn: &Connection, kind: &str, id: i64) -> Result<Detail> {
    let lane = if kind == "app" { LANE_APP } else { LANE_DOC };
    let (secs, first, last, days) = stats(conn, lane, id)?;
    let busiest = conn
        .prepare("SELECT day, secs FROM ref_day WHERE lane = ?1 AND ref = ?2 ORDER BY secs DESC LIMIT 8")?
        .query_map(params![lane, id], |r| Ok((r.get(0)?, r.get(1)?)))?
        .collect::<rusqlite::Result<_>>()?;
    let years = conn
        .prepare("SELECT substr(day, 1, 4) y, SUM(secs) FROM ref_day WHERE lane = ?1 AND ref = ?2 GROUP BY y ORDER BY y")?
        .query_map(params![lane, id], |r| Ok((r.get(0)?, r.get(1)?)))?
        .collect::<rusqlite::Result<_>>()?;
    Ok(Detail { secs, first, last, days, busiest, years })
}

#[cfg(test)]
mod tests {
    use super::like_terms;

    #[test]
    fn terms_escape_wildcards() {
        assert_eq!(like_terms("  war  frame "), vec!["%war%", "%frame%"]);
        assert_eq!(like_terms("100%_done"), vec!["%100\\%\\_done%"]);
        assert!(like_terms("   ").is_empty());
    }
}

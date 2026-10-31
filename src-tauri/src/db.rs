//! The local SQLite store: schema, time helpers and small shared lookups.
//!
//! Times: segments are UTC epoch seconds. Hourly and daily aggregates are keyed by the
//! local calendar day ("YYYY-MM-DD") and local hour, which is how both WhatPulse and the
//! UI think about them.
//!
//! Sources: every row carries a `source` id. Source 1 is Katsudō's own tracker; each
//! import gets a new id. Where two sources cover the same hour, day or time range, the
//! lowest id wins in every query, so imports never double count and never overwrite.

use anyhow::Result;
use chrono::{Local, NaiveDate, TimeZone, Timelike};
use rusqlite::{params, Connection, OptionalExtension};
use std::path::Path;
use std::time::Duration;

pub const NATIVE_SOURCE: i64 = 1;

pub const LANE_ACTIVITY: i64 = 0;
pub const LANE_APP: i64 = 1;
pub const LANE_DOC: i64 = 2;
pub const LANE_TAG: i64 = 3;

const SCHEMA: &str = r#"
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS source (
  id INTEGER PRIMARY KEY,
  kind TEXT NOT NULL,
  label TEXT NOT NULL,
  path TEXT,
  created_at INTEGER NOT NULL,
  summary TEXT
);
CREATE TABLE IF NOT EXISTS app (id INTEGER PRIMARY KEY, key TEXT NOT NULL UNIQUE, name TEXT NOT NULL, path TEXT);
CREATE TABLE IF NOT EXISTS title (id INTEGER PRIMARY KEY, text TEXT NOT NULL UNIQUE);
CREATE TABLE IF NOT EXISTS segment (
  id INTEGER PRIMARY KEY,
  lane INTEGER NOT NULL,
  start INTEGER NOT NULL,
  end INTEGER NOT NULL,
  ref INTEGER NOT NULL,
  app_id INTEGER,
  source INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS segment_lane_start ON segment(lane, start);
CREATE INDEX IF NOT EXISTS segment_source ON segment(source);
CREATE TABLE IF NOT EXISTS input_hour (
  day TEXT NOT NULL, hour INTEGER NOT NULL, source INTEGER NOT NULL, app_id INTEGER NOT NULL,
  keys INTEGER NOT NULL DEFAULT 0, clicks INTEGER NOT NULL DEFAULT 0, scrolls INTEGER NOT NULL DEFAULT 0,
  distance_m REAL NOT NULL DEFAULT 0,
  PRIMARY KEY (day, hour, source, app_id)
) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS key_day (
  day TEXT NOT NULL, source INTEGER NOT NULL, key TEXT NOT NULL, count INTEGER NOT NULL,
  PRIMARY KEY (day, source, key)
) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS net_hour (
  day TEXT NOT NULL, hour INTEGER NOT NULL, source INTEGER NOT NULL,
  download INTEGER NOT NULL DEFAULT 0, upload INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, hour, source)
) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS uptime_hour (
  day TEXT NOT NULL, hour INTEGER NOT NULL, source INTEGER NOT NULL, ms INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, hour, source)
) WITHOUT ROWID;
-- Pointer heatmap: clicks in, and moves into, each 32-pixel square of the virtual desktop.
CREATE TABLE IF NOT EXISTS mouse_cell (
  day TEXT NOT NULL, source INTEGER NOT NULL, x INTEGER NOT NULL, y INTEGER NOT NULL,
  clicks INTEGER NOT NULL DEFAULT 0, moves INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, source, x, y)
) WITHOUT ROWID;
-- Rhythm mode: one row per play session; series is keys per second as little-endian u16s.
CREATE TABLE IF NOT EXISTS rhythm_session (
  id INTEGER PRIMARY KEY, app_id INTEGER NOT NULL, start REAL NOT NULL, end REAL NOT NULL,
  keys INTEGER NOT NULL, peak_kps INTEGER NOT NULL, best_stream INTEGER NOT NULL, streams INTEGER NOT NULL,
  series BLOB NOT NULL
);
CREATE INDEX IF NOT EXISTS rhythm_session_app ON rhythm_session (app_id, start);
-- Search rollup: seconds per app (lane 1) or title (lane 2) per local day, all sources.
CREATE TABLE IF NOT EXISTS ref_day (
  lane INTEGER NOT NULL, ref INTEGER NOT NULL, day TEXT NOT NULL, secs INTEGER NOT NULL,
  PRIMARY KEY (lane, ref, day)
) WITHOUT ROWID;
-- The app a title was first seen in.
CREATE TABLE IF NOT EXISTS title_app (title INTEGER PRIMARY KEY, app_id INTEGER NOT NULL);
-- Tags and the rules that apply them (first matching rule wins), and seconds per tag per
-- day (tag 0 = untagged), rebuilt when the rules change.
CREATE TABLE IF NOT EXISTS tag (id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE, color TEXT NOT NULL, ord INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS tag_rule (
  id INTEGER PRIMARY KEY, ord INTEGER NOT NULL, field TEXT NOT NULL, op TEXT NOT NULL, value TEXT NOT NULL,
  tag_id INTEGER NOT NULL REFERENCES tag(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS tag_day (day TEXT NOT NULL, tag_id INTEGER NOT NULL, secs INTEGER NOT NULL, PRIMARY KEY (day, tag_id)) WITHOUT ROWID;
-- Flow sessions (see flow.rs), by the local day they started; task > 0 is a tag, < 0 minus an app.
CREATE TABLE IF NOT EXISTS flow_session (
  start INTEGER PRIMARY KEY, end INTEGER NOT NULL, day TEXT NOT NULL, task INTEGER NOT NULL,
  app_id INTEGER NOT NULL, focus INTEGER NOT NULL, breaks INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS flow_session_day ON flow_session (day);
-- How the monitors were arranged on a day (JSON list of {x, y, w, h, primary}).
CREATE TABLE IF NOT EXISTS mouse_layout (day TEXT PRIMARY KEY, screens TEXT NOT NULL);
-- Lifetime amounts a source knows but can't date (WhatPulse totals beyond the pulses it still
-- serves). They count towards all-time totals only, never a day.
CREATE TABLE IF NOT EXISTS undated (
  source INTEGER PRIMARY KEY, keys INTEGER NOT NULL DEFAULT 0, clicks INTEGER NOT NULL DEFAULT 0,
  scrolls INTEGER NOT NULL DEFAULT 0, distance_m REAL NOT NULL DEFAULT 0, download INTEGER NOT NULL DEFAULT 0,
  upload INTEGER NOT NULL DEFAULT 0, uptime_ms INTEGER NOT NULL DEFAULT 0
);
"#;

pub fn open(path: &Path) -> Result<Connection> {
    let conn = Connection::open(path)?;
    conn.busy_timeout(Duration::from_millis(250))?;
    conn.execute_batch(
        "PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL; PRAGMA foreign_keys=ON; PRAGMA temp_store=MEMORY;",
    )?;
    Ok(conn)
}

pub fn migrate(conn: &Connection) -> Result<()> {
    conn.execute_batch(SCHEMA)?;
    conn.execute(
        "INSERT OR IGNORE INTO source (id, kind, label, created_at) VALUES (?1, 'native', 'Katsudō', ?2)",
        params![NATIVE_SOURCE, now_secs()],
    )?;
    conn.execute("INSERT OR IGNORE INTO meta (key, value) VALUES ('schema_version', '1')", [])?;
    // v2: sources belong to a device. Precedence applies within a device; devices add up.
    let has_device: bool = conn
        .prepare("SELECT 1 FROM pragma_table_info('source') WHERE name = 'device'")?
        .exists([])?;
    if !has_device {
        conn.execute_batch(
            "ALTER TABLE source ADD COLUMN device TEXT NOT NULL DEFAULT 'this-pc';
             UPDATE meta SET value = '2' WHERE key = 'schema_version';",
        )?;
    }
    crate::keys::remap_stored(conn)?;
    Ok(())
}

pub const THIS_PC: &str = "this-pc";


// ---- settings ---------------------------------------------------------------

pub fn get_setting(conn: &Connection, key: &str) -> Option<String> {
    conn.query_row("SELECT value FROM meta WHERE key = ?1", [format!("setting.{key}")], |r| r.get(0))
        .optional()
        .ok()
        .flatten()
}

pub fn get_bool(conn: &Connection, key: &str, default: bool) -> bool {
    get_setting(conn, key).map(|v| v == "true").unwrap_or(default)
}

pub fn set_setting(conn: &Connection, key: &str, value: &str) -> Result<()> {
    conn.execute(
        "INSERT INTO meta (key, value) VALUES (?1, ?2) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        params![format!("setting.{key}"), value],
    )?;
    Ok(())
}

// ---- apps and titles ----------------------------------------------------------

/// Normalised app key: the executable's file name in lower case ("chrome.exe").
pub fn app_key_from_path(path: &str) -> String {
    let trimmed = path.trim_end_matches(['/', '\\']);
    let name = trimmed.rsplit(['/', '\\']).next().unwrap_or(trimmed);
    name.to_lowercase()
}

pub fn upsert_app(conn: &Connection, key: &str, name: &str, path: Option<&str>) -> Result<i64> {
    if let Some(id) = conn
        .query_row("SELECT id FROM app WHERE key = ?1", [key], |r| r.get::<_, i64>(0))
        .optional()?
    {
        return Ok(id);
    }
    let name = if name.trim().is_empty() { key } else { name.trim() };
    conn.execute("INSERT INTO app (key, name, path) VALUES (?1, ?2, ?3)", params![key, name, path])?;
    Ok(conn.last_insert_rowid())
}

pub fn upsert_title(conn: &Connection, text: &str) -> Result<i64> {
    if let Some(id) = conn
        .query_row("SELECT id FROM title WHERE text = ?1", [text], |r| r.get::<_, i64>(0))
        .optional()?
    {
        return Ok(id);
    }
    conn.execute("INSERT INTO title (text) VALUES (?1)", [text])?;
    Ok(conn.last_insert_rowid())
}

// ---- time ---------------------------------------------------------------------

pub fn now_secs() -> i64 {
    chrono::Utc::now().timestamp()
}

pub fn local_day_hour(ts: i64) -> (String, i64) {
    let dt = Local.timestamp_opt(ts, 0).single().unwrap_or_else(Local::now);
    (dt.format("%Y-%m-%d").to_string(), dt.hour() as i64)
}

pub fn today() -> String {
    Local::now().format("%Y-%m-%d").to_string()
}

/// UTC epoch bounds [start, end) of a local calendar day.
pub fn day_bounds(day: &str) -> Result<(i64, i64)> {
    let d = NaiveDate::parse_from_str(day, "%Y-%m-%d")?;
    let start = Local
        .from_local_datetime(&d.and_hms_opt(0, 0, 0).unwrap())
        .earliest()
        .ok_or_else(|| anyhow::anyhow!("no local midnight on {day}"))?;
    let next = d.succ_opt().unwrap();
    let end = Local
        .from_local_datetime(&next.and_hms_opt(0, 0, 0).unwrap())
        .earliest()
        .ok_or_else(|| anyhow::anyhow!("no local midnight after {day}"))?;
    Ok((start.timestamp(), end.timestamp()))
}

/// The first local midnight strictly after `ts`.
pub fn next_local_midnight(ts: i64) -> i64 {
    let date = Local.timestamp_opt(ts, 0).single().map(|d| d.date_naive()).unwrap_or_default();
    let next = date.succ_opt().unwrap_or(date).and_hms_opt(0, 0, 0).unwrap();
    Local.from_local_datetime(&next).earliest().map(|d| d.timestamp()).unwrap_or(i64::MAX)
}

pub fn shift_day(day: &str, delta: i64) -> Result<String> {
    let d = NaiveDate::parse_from_str(day, "%Y-%m-%d")?;
    Ok((d + chrono::Duration::days(delta)).format("%Y-%m-%d").to_string())
}

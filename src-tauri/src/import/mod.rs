//! Importers for other trackers' databases. Each one:
//! - reads the source without modifying it (read-only in place when it has no write-ahead
//!   log, otherwise from a private copy),
//! - scans first and reports what it found, before anything is written,
//! - imports inside one transaction, so a failure or a cancel leaves nothing behind,
//! - replaces an earlier import from the same tool rather than adding to it.

pub mod manictime;
pub mod whatpulse;
pub mod whatpulse_api;

use anyhow::{anyhow, Result};
use rusqlite::{params, Connection, OpenFlags};
use serde::Serialize;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};

#[derive(Clone, Serialize)]
pub struct Stat {
    pub label: String,
    pub value: String,
}

#[derive(Clone, Serialize)]
pub struct ScanResult {
    pub kind: String,
    pub path: String,
    pub first_day: Option<String>,
    pub last_day: Option<String>,
    pub days: i64,
    pub stats: Vec<Stat>,
    pub notes: Vec<String>,
    /// Days in the source's range that Katsudō already has data for.
    pub overlap_days: i64,
    /// When this tool was imported before (that import is replaced).
    pub previous_import: Option<i64>,
}

#[derive(Clone, Serialize)]
pub struct Progress {
    pub kind: String,
    pub phase: String,
    pub done: u64,
    pub total: u64,
}

pub struct Ctx<'a> {
    pub kind: &'a str,
    pub cancel: &'a AtomicBool,
    pub progress: &'a dyn Fn(Progress),
}

impl Ctx<'_> {
    pub fn report(&self, phase: &str, done: u64, total: u64) -> Result<()> {
        if self.cancel.load(Ordering::Relaxed) {
            return Err(anyhow!("Import cancelled. Nothing was imported."));
        }
        (self.progress)(Progress { kind: self.kind.into(), phase: phase.into(), done, total });
        Ok(())
    }
}

pub fn stat(label: &str, value: impl ToString) -> Stat {
    Stat { label: label.into(), value: value.to_string() }
}

pub fn fmt_count(n: i64) -> String {
    let s = n.abs().to_string();
    let mut out = String::new();
    for (i, c) in s.chars().enumerate() {
        if i > 0 && (s.len() - i) % 3 == 0 {
            out.push(',');
        }
        out.push(c);
    }
    if n < 0 { format!("-{out}") } else { out }
}

pub fn fmt_short(n: i64) -> String {
    match n {
        n if n >= 1_000_000_000 => format!("{:.1}B", n as f64 / 1e9),
        n if n >= 1_000_000 => format!("{:.1}M", n as f64 / 1e6),
        n if n >= 10_000 => format!("{:.1}K", n as f64 / 1e3),
        n => fmt_count(n),
    }
}

pub fn fmt_bytes(n: i64) -> String {
    match n as f64 {
        b if b >= 1e12 => format!("{:.1} TB", b / 1e12),
        b if b >= 1e9 => format!("{:.1} GB", b / 1e9),
        b if b >= 1e6 => format!("{:.0} MB", b / 1e6),
        b => format!("{:.0} KB", b / 1e3),
    }
}

/// Open a source database without ever writing to it. With a write-ahead log present
/// (the tool is running), copy the database and its log into `tmp` and open the copy.
pub fn open_source(db: &Path, tmp: &Path) -> Result<(Connection, Option<PathBuf>)> {
    if !db.is_file() {
        return Err(anyhow!("{} was not found", db.display()));
    }
    let wal = PathBuf::from(format!("{}-wal", db.display()));
    let has_wal = wal.metadata().map(|m| m.len() > 0).unwrap_or(false);
    if !has_wal {
        if let Ok(conn) = Connection::open_with_flags(db, OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX) {
            conn.busy_timeout(std::time::Duration::from_secs(10))?;
            if conn.query_row("SELECT COUNT(*) FROM sqlite_master", [], |r| r.get::<_, i64>(0)).is_ok() {
                return Ok((conn, None));
            }
        }
    }
    let dir = tmp.join(format!("import-{}", crate::db::now_secs()));
    std::fs::create_dir_all(&dir)?;
    let name = db.file_name().ok_or_else(|| anyhow!("bad path"))?;
    let copy = dir.join(name);
    std::fs::copy(db, &copy)?;
    if has_wal {
        std::fs::copy(&wal, PathBuf::from(format!("{}-wal", copy.display())))?;
    }
    let conn = Connection::open(&copy)?;
    Ok((conn, Some(dir)))
}

pub fn has_table(conn: &Connection, name: &str) -> bool {
    conn.query_row("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?1", [name], |_| Ok(()))
        .is_ok()
}

pub fn previous_import(conn: &Connection, kind: &str) -> Option<i64> {
    conn.query_row("SELECT MAX(created_at) FROM source WHERE kind = ?1", [kind], |r| r.get(0)).ok().flatten()
}

/// What an import competes with: timelines only conflict with timelines, input with input.
pub enum Overlap {
    Timeline,
    Input,
}

/// Days in [first, last] where another source already has the same kind of data.
pub fn overlap_days(conn: &Connection, kind: &str, first: &str, last: &str, what: Overlap) -> i64 {
    let sql = match what {
        Overlap::Input => {
            "SELECT COUNT(DISTINCT day) FROM input_hour
             WHERE day BETWEEN ?1 AND ?2 AND source NOT IN (SELECT id FROM source WHERE kind = ?3)"
        }
        Overlap::Timeline => {
            "SELECT COUNT(DISTINCT date(start, 'unixepoch', 'localtime')) FROM segment
             WHERE lane = 0
               AND start BETWEEN CAST(strftime('%s', ?1, 'utc') AS INTEGER) AND CAST(strftime('%s', ?2, '+1 day', 'utc') AS INTEGER)
               AND source NOT IN (SELECT id FROM source WHERE kind = ?3)"
        }
    };
    conn.query_row(sql, params![first, last, kind], |r| r.get(0)).unwrap_or(0)
}

/// Remove an earlier import from the same tool and register a new source. Runs inside
/// the import's transaction.
pub fn replace_source(tx: &Connection, kind: &str, label: &str, path: &str) -> Result<i64> {
    let old: Vec<i64> = tx
        .prepare("SELECT id FROM source WHERE kind = ?1")?
        .query_map([kind], |r| r.get(0))?
        .collect::<rusqlite::Result<_>>()?;
    for id in old {
        for table in ["segment", "input_hour", "key_day", "net_hour", "uptime_hour", "undated", "mouse_cell"] {
            tx.execute(&format!("DELETE FROM {table} WHERE source = ?1"), [id])?;
        }
        tx.execute("DELETE FROM source WHERE id = ?1", [id])?;
    }
    tx.execute(
        "INSERT INTO source (kind, label, path, created_at) VALUES (?1, ?2, ?3, ?4)",
        params![kind, label, path, crate::db::now_secs()],
    )?;
    Ok(tx.last_insert_rowid())
}

/// Where each tool keeps its data on Windows, if present.
pub fn default_paths() -> Vec<(String, String)> {
    let mut out = Vec::new();
    if let Ok(local) = std::env::var("LOCALAPPDATA") {
        let mt = Path::new(&local).join("Finkit").join("ManicTime").join("ManicTimeReports.db");
        if mt.is_file() {
            out.push(("manictime".into(), mt.to_string_lossy().into_owned()));
        }
        let wp = Path::new(&local).join("WhatPulse").join("whatpulse.db");
        if wp.is_file() {
            out.push(("whatpulse".into(), wp.to_string_lossy().into_owned()));
        }
    }
    out
}

pub fn cleanup_tmp(tmp: &Path) {
    if let Ok(entries) = std::fs::read_dir(tmp) {
        for e in entries.flatten() {
            if e.file_name().to_string_lossy().starts_with("import-") {
                let _ = std::fs::remove_dir_all(e.path());
            }
        }
    }
}

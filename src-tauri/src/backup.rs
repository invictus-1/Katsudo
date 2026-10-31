//! Backups: compact, verified snapshots of the database in `<data>/backups/`.
//!
//! A snapshot is written with `VACUUM INTO` on its own connection (so tracking and the UI
//! keep running), then reopened read-only and checked with `PRAGMA quick_check`. The log
//! lives in `backups/index.json`, outside the database, so a restore can't rewrite it.

use anyhow::{anyhow, Result};
use chrono::{Datelike, Local, TimeZone};
use rusqlite::{Connection, DatabaseName, OpenFlags};
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::Duration;

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct BackupInfo {
    pub file: String,
    pub created_at: i64,
    pub size: u64,
    pub verified: bool,
    pub kind: String,
    pub note: Option<String>,
}

pub fn dir(data_dir: &Path) -> PathBuf {
    data_dir.join("backups")
}

fn index_path(data_dir: &Path) -> PathBuf {
    dir(data_dir).join("index.json")
}

pub fn list(data_dir: &Path) -> Vec<BackupInfo> {
    let mut items: Vec<BackupInfo> = std::fs::read(index_path(data_dir))
        .ok()
        .and_then(|b| serde_json::from_slice(&b).ok())
        .unwrap_or_default();
    items.retain(|b| dir(data_dir).join(&b.file).exists());
    items.sort_by(|a, b| b.created_at.cmp(&a.created_at));
    items
}

fn save_index(data_dir: &Path, items: &[BackupInfo]) -> Result<()> {
    let tmp = index_path(data_dir).with_extension("json.tmp");
    std::fs::write(&tmp, serde_json::to_vec_pretty(items)?)?;
    std::fs::rename(tmp, index_path(data_dir))?;
    Ok(())
}

/// Snapshot the database at `db_path`. `kind` is "nightly", "manual", "pre-import" or "pre-restore".
/// A checked copy of the database at `dest`, written beside it first and moved into place, so
/// a sync tool never picks up half a file.
pub fn export_to(db_path: &Path, dest: &Path) -> Result<()> {
    let tmp = dest.with_extension("partial");
    let _ = std::fs::remove_file(&tmp);
    let src = Connection::open_with_flags(db_path, OpenFlags::SQLITE_OPEN_READ_ONLY)?;
    src.busy_timeout(Duration::from_secs(30))?;
    src.execute("VACUUM INTO ?1", [tmp.to_string_lossy()])?;
    drop(src);
    verify(&tmp)?;
    std::fs::rename(&tmp, dest)?;
    Ok(())
}

pub fn run(db_path: &Path, data_dir: &Path, kind: &str) -> Result<BackupInfo> {
    std::fs::create_dir_all(dir(data_dir))?;
    let now = Local::now();
    let file = format!("katsudo-{}-{kind}.db", now.format("%Y%m%d-%H%M%S"));
    let path = dir(data_dir).join(&file);

    let src = Connection::open_with_flags(db_path, OpenFlags::SQLITE_OPEN_READ_ONLY)?;
    src.busy_timeout(Duration::from_secs(30))?;
    src.execute("VACUUM INTO ?1", [path.to_string_lossy()])?;
    drop(src);

    let (verified, note) = match verify(&path) {
        Ok(()) => (true, None),
        Err(e) => (false, Some(e.to_string())),
    };
    let info = BackupInfo {
        file,
        created_at: now.timestamp(),
        size: std::fs::metadata(&path).map(|m| m.len()).unwrap_or(0),
        verified,
        kind: kind.to_string(),
        note,
    };
    let mut items = list(data_dir);
    items.insert(0, info.clone());
    let items = prune(data_dir, items);
    save_index(data_dir, &items)?;
    Ok(info)
}

fn verify(path: &Path) -> Result<()> {
    let conn = Connection::open_with_flags(path, OpenFlags::SQLITE_OPEN_READ_ONLY)?;
    let check: String = conn.query_row("PRAGMA quick_check", [], |r| r.get(0))?;
    if check != "ok" {
        return Err(anyhow!("integrity check: {check}"));
    }
    let sources: i64 = conn.query_row("SELECT COUNT(*) FROM source", [], |r| r.get(0))?;
    if sources == 0 {
        return Err(anyhow!("the snapshot has no sources table rows"));
    }
    Ok(())
}

/// Keep the newest snapshot per day for 14 days and per week for 8 weeks, plus the
/// three newest safety snapshots (pre-import, pre-restore). Delete the rest.
fn prune(data_dir: &Path, items: Vec<BackupInfo>) -> Vec<BackupInfo> {
    let mut keep = Vec::new();
    let (mut days, mut weeks) = (HashSet::new(), HashSet::new());
    let (mut safety, mut weekly) = (0, 0);
    for b in items {
        let dt = Local.timestamp_opt(b.created_at, 0).single().unwrap_or_else(Local::now);
        let day = dt.date_naive();
        let week = (dt.iso_week().year(), dt.iso_week().week());
        let keep_it = if b.kind.starts_with("pre-") {
            safety += 1;
            safety <= 3
        } else if days.len() < 14 && days.insert(day) {
            weeks.insert(week);
            true
        } else if weekly < 8 && weeks.insert(week) {
            weekly += 1;
            true
        } else {
            false
        };
        if keep_it {
            keep.push(b);
        } else {
            let _ = std::fs::remove_file(dir(data_dir).join(&b.file));
        }
    }
    keep
}

/// Replace the live database with a snapshot. A pre-restore snapshot is taken first.
pub fn restore(write: &mut Connection, db_path: &Path, data_dir: &Path, file: &str) -> Result<()> {
    if file.contains(['/', '\\']) || !file.ends_with(".db") {
        return Err(anyhow!("not a backup file name: {file}"));
    }
    let path = dir(data_dir).join(file);
    verify(&path)?;
    run(db_path, data_dir, "pre-restore")?;
    write.restore(DatabaseName::Main, &path, None::<fn(rusqlite::backup::Progress)>)?;
    write.execute_batch("PRAGMA wal_checkpoint(TRUNCATE);")?;
    Ok(())
}

/// Once a day (when enabled), take the nightly snapshot.
pub fn start_scheduler(db_path: PathBuf, data_dir: PathBuf, read: Arc<Mutex<Connection>>) {
    std::thread::Builder::new()
        .name("katsudo-backup".into())
        .spawn(move || loop {
            std::thread::sleep(Duration::from_secs(60));
            let enabled = read.lock().map(|c| crate::db::get_bool(&c, "nightly_backup", true)).unwrap_or(true);
            let last = list(&data_dir)
                .into_iter()
                .filter(|b| b.kind == "nightly" || b.kind == "manual")
                .map(|b| b.created_at)
                .max()
                .unwrap_or(0);
            if enabled && crate::db::now_secs() - last > 23 * 3600 {
                if let Err(e) = run(&db_path, &data_dir, "nightly") {
                    eprintln!("katsudo: nightly backup failed: {e}");
                }
                std::thread::sleep(Duration::from_secs(600));
            }
        })
        .expect("spawn backup scheduler");
}

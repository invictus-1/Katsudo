//! ManicTime: reads ManicTimeReports.db (the live data folder or a backup copy of it).
//! Timelines map to lanes: ComputerUsage → Activity, Applications → Applications,
//! Documents (files and websites) → Documents, Tags → Tags.

use super::{fmt_count, fmt_short, has_table, overlap_days, previous_import, replace_source, stat, Ctx, Overlap, ScanResult, Stat};
use crate::db::{self, LANE_ACTIVITY, LANE_APP, LANE_DOC, LANE_TAG};
use crate::tracker::{push_split, Seg};
use anyhow::{anyhow, Result};
use chrono::NaiveDateTime;
use rusqlite::{params, Connection, OptionalExtension};
use std::collections::HashMap;
use std::path::{Path, PathBuf};

pub const KIND: &str = "manictime";

/// Accept the data folder, ManicTimeReports.db, or its sibling ManicTimeCore.db.
pub fn resolve(path: &Path) -> PathBuf {
    if path.is_dir() {
        return path.join("ManicTimeReports.db");
    }
    if path.file_name().map(|n| n.eq_ignore_ascii_case("ManicTimeCore.db")).unwrap_or(false) {
        return path.with_file_name("ManicTimeReports.db");
    }
    path.to_path_buf()
}

#[derive(Default)]
struct Timelines {
    activity: Option<i64>,
    apps: Option<i64>,
    docs: Option<i64>,
    tags: Option<i64>,
}

fn timelines(src: &Connection) -> Result<Timelines> {
    if !has_table(src, "Ar_Activity") || !has_table(src, "Ar_Timeline") {
        return Err(anyhow!("This isn't a ManicTime reports database. Pick ManicTimeReports.db or the folder that holds it."));
    }
    let mut t = Timelines::default();
    let mut stmt = src.prepare("SELECT ReportId, SchemaName FROM Ar_Timeline")?;
    for row in stmt.query_map([], |r| Ok((r.get::<_, i64>(0)?, r.get::<_, String>(1)?)))? {
        let (id, schema) = row?;
        match schema.as_str() {
            "ManicTime/ComputerUsage" => t.activity = Some(id),
            "ManicTime/Applications" => t.apps = Some(id),
            "ManicTime/Documents" => t.docs = Some(id),
            "ManicTime/Tags" => t.tags = Some(id),
            _ => {}
        }
    }
    Ok(t)
}

fn parse_utc(s: &str) -> Option<i64> {
    let s = s.get(..19).unwrap_or(s);
    NaiveDateTime::parse_from_str(s, "%Y-%m-%d %H:%M:%S").ok().map(|d| d.and_utc().timestamp())
}

fn count(src: &Connection, report: Option<i64>) -> i64 {
    report
        .and_then(|r| src.query_row("SELECT COUNT(*) FROM Ar_Activity WHERE ReportId = ?1", [r], |x| x.get(0)).ok())
        .unwrap_or(0)
}

pub fn scan(src: &Connection, ours: &Connection, path: &str) -> Result<ScanResult> {
    let t = timelines(src)?;
    let base = t.activity.or(t.apps).ok_or_else(|| anyhow!("No computer-usage or application timeline in this database."))?;
    let (first, last, days): (Option<String>, Option<String>, i64) = src.query_row(
        "SELECT MIN(substr(StartLocalTime, 1, 10)), MAX(substr(EndLocalTime, 1, 10)), COUNT(DISTINCT substr(StartLocalTime, 1, 10))
         FROM Ar_Activity WHERE ReportId = ?1",
        [base],
        |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
    )?;
    let active_secs: i64 = t
        .activity
        .and_then(|r| {
            src.query_row(
                "SELECT SUM(strftime('%s', a.EndUtcTime) - strftime('%s', a.StartUtcTime))
                 FROM Ar_Activity a JOIN Ar_Group g ON g.ReportId = a.ReportId AND g.GroupId = a.GroupId
                 WHERE a.ReportId = ?1 AND g.[Key] = 'ManicTime/Active'",
                [r],
                |x| x.get::<_, Option<i64>>(0),
            )
            .ok()
            .flatten()
        })
        .unwrap_or(0);
    let apps: i64 = t
        .apps
        .and_then(|r| src.query_row("SELECT COUNT(*) FROM Ar_Group WHERE ReportId = ?1", [r], |x| x.get(0)).ok())
        .unwrap_or(0);
    let stats = vec![
        stat("Days", fmt_count(days)),
        stat("Active", format!("{} h", fmt_count(active_secs / 3600))),
        stat("Apps", fmt_count(apps)),
        stat("App segments", fmt_short(count(src, t.apps))),
        stat("Docs & sites", fmt_short(count(src, t.docs))),
        stat("Tags", fmt_short(count(src, t.tags))),
    ];
    let mut notes = vec![
        "Screenshots are not imported: Katsudō does not store screenshots.".to_string(),
        "Window titles inside applications are not imported; documents and websites are.".to_string(),
    ];
    if t.activity.is_none() {
        notes.push("This database has no computer-usage timeline, so active and away time cannot be imported.".into());
    }
    let overlap = match (&first, &last) {
        (Some(f), Some(l)) => overlap_days(ours, KIND, f, l, Overlap::Timeline),
        _ => 0,
    };
    Ok(ScanResult {
        kind: KIND.into(),
        path: path.into(),
        first_day: first,
        last_day: last,
        days,
        stats,
        notes,
        overlap_days: overlap,
        previous_import: previous_import(ours, KIND),
    })
}

pub fn import(src: &Connection, tx: &Connection, ctx: &Ctx, path: &str) -> Result<Vec<Stat>> {
    let t = timelines(src)?;
    let source = replace_source(tx, KIND, "ManicTime", path)?;

    // Groups → (lane, ref). Activity: active = 1, away and locked = 0, power-off skipped.
    ctx.report("Reading apps, documents and sites", 0, 1)?;
    let mut groups: HashMap<(i64, i64), (i64, i64)> = HashMap::new();
    let mut app_count = 0;
    let mut doc_count = 0;
    {
        let mut stmt = src.prepare("SELECT ReportId, GroupId, [Key], Name FROM Ar_Group")?;
        let rows = stmt.query_map([], |r| {
            Ok((r.get::<_, i64>(0)?, r.get::<_, i64>(1)?, r.get::<_, String>(2)?, r.get::<_, String>(3)?))
        })?;
        for row in rows {
            let (report, group, key, name) = row?;
            let mapped = if Some(report) == t.activity {
                match key.as_str() {
                    "ManicTime/Active" => Some((LANE_ACTIVITY, 1)),
                    "ManicTime/Away" | "ManicTime/SessionLocked" => Some((LANE_ACTIVITY, 0)),
                    _ => None,
                }
            } else if Some(report) == t.apps {
                // Keys look like "chrome.exe;google chrome".
                let exe = key.split(';').next().unwrap_or(&key).trim().to_lowercase();
                let app_key = if exe.is_empty() { name.to_lowercase() } else { exe };
                app_count += 1;
                Some((LANE_APP, db::upsert_app(tx, &app_key, &name, None)?))
            } else if Some(report) == t.docs {
                doc_count += 1;
                Some((LANE_DOC, db::upsert_title(tx, &name)?))
            } else {
                None
            };
            if let Some(m) = mapped {
                groups.insert((report, group), m);
            }
        }
    }

    let reports: Vec<i64> = [t.activity, t.apps, t.docs, t.tags].into_iter().flatten().collect();
    let total: i64 = reports.iter().map(|r| count(src, Some(*r))).sum();
    let list = reports.iter().map(|r| r.to_string()).collect::<Vec<_>>().join(",");
    let mut stmt = src.prepare(&format!(
        "SELECT ReportId, GroupId, Name, StartUtcTime, EndUtcTime FROM Ar_Activity WHERE ReportId IN ({list})"
    ))?;
    let mut insert = tx.prepare_cached(
        "INSERT INTO segment (lane, start, end, ref, app_id, source) VALUES (?1, ?2, ?3, ?4, NULL, ?5)",
    )?;
    let mut tag_ids: HashMap<String, i64> = HashMap::new();
    let mut rows = stmt.query([])?;
    let (mut done, mut written) = (0u64, 0i64);
    let mut pieces = Vec::with_capacity(4);
    while let Some(r) = rows.next()? {
        done += 1;
        if done % 25_000 == 0 {
            ctx.report("Importing timelines", done, total as u64)?;
        }
        let report: i64 = r.get(0)?;
        let group: Option<i64> = r.get(1)?;
        let (Some(start), Some(end)) = (parse_utc(&r.get::<_, String>(3)?), parse_utc(&r.get::<_, String>(4)?)) else {
            continue;
        };
        let mapped = if Some(report) == t.tags {
            let name: String = r.get(2)?;
            if name.trim().is_empty() {
                continue;
            }
            let id = match tag_ids.get(&name) {
                Some(id) => *id,
                None => {
                    let id = db::upsert_title(tx, &name)?;
                    tag_ids.insert(name, id);
                    id
                }
            };
            Some((LANE_TAG, id))
        } else {
            group.and_then(|g| groups.get(&(report, g)).copied())
        };
        let Some((lane, ref_id)) = mapped else { continue };
        pieces.clear();
        push_split(&mut pieces, Seg { lane, start, end, ref_id, app_id: None });
        for p in &pieces {
            insert.execute(params![p.lane, p.start, p.end, p.ref_id, source])?;
            written += 1;
        }
    }
    ctx.report("Importing timelines", total as u64, total as u64)?;

    let days: i64 = tx
        .query_row(
            "SELECT COUNT(DISTINCT date(start, 'unixepoch', 'localtime')) FROM segment WHERE source = ?1 AND lane = ?2",
            params![source, if t.activity.is_some() { LANE_ACTIVITY } else { LANE_APP }],
            |r| r.get(0),
        )
        .optional()?
        .unwrap_or(0);
    let summary = vec![
        stat("Days", fmt_count(days)),
        stat("Segments", fmt_short(written)),
        stat("Apps", fmt_count(app_count)),
        stat("Docs & sites", fmt_count(doc_count)),
    ];
    tx.execute("UPDATE source SET summary = ?1 WHERE id = ?2", params![serde_json::to_string(&summary)?, source])?;
    Ok(summary)
}

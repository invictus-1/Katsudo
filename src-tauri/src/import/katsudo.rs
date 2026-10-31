//! Another PC's Katsudō: its own history (its tracking, and what it imported for itself) comes
//! in as a device of its own, so its days add to this PC's instead of competing with them.
//! Importing the same PC again replaces what came from it before. App and window ids are
//! matched by name. Its tags and rules aren't copied (this PC's apply to everything), nor its
//! pointer heatmap (other monitors) or per-app key counts.

use super::{fmt_count, stat, Ctx, ScanResult, Stat};
use anyhow::{anyhow, Result};
use rusqlite::{params, Connection, OptionalExtension};
use std::collections::HashMap;

pub const KIND: &str = "katsudo";

/// A database's own identity: (device id, computer name).
pub fn identity(conn: &Connection) -> (String, String) {
    let meta = |k: &str| conn.query_row("SELECT value FROM meta WHERE key = ?1", [k], |r| r.get::<_, String>(0)).optional().ok().flatten();
    let id = meta("device_id").unwrap_or_else(|| {
        // Before 1.0 there was no id: the database's creation time stands in for one.
        let born: i64 = conn.query_row("SELECT created_at FROM source WHERE id = 1", [], |r| r.get(0)).unwrap_or(0);
        format!("legacy-{born}")
    });
    (id, meta("device_name").unwrap_or_else(|| "Another PC".into()))
}

/// The other database's sources that describe that PC itself.
fn own_sources(src: &Connection) -> Result<Vec<(i64, String, String)>> {
    let has_device = src.prepare("SELECT 1 FROM pragma_table_info('source') WHERE name = 'device'")?.exists([])?;
    let sql = if has_device {
        "SELECT id, kind, label FROM source WHERE device = 'this-pc' ORDER BY id"
    } else {
        "SELECT id, kind, label FROM source ORDER BY id"
    };
    Ok(src.prepare(sql)?.query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))?.collect::<rusqlite::Result<_>>()?)
}

fn in_list(ids: &[i64]) -> String {
    ids.iter().map(|i| i.to_string()).collect::<Vec<_>>().join(",")
}

pub fn scan(src: &Connection, ours: &Connection, path: &str) -> Result<ScanResult> {
    if !super::has_table(src, "segment") || !super::has_table(src, "input_hour") {
        return Err(anyhow!("That isn't a Katsudō database."));
    }
    let (id, name) = identity(src);
    if id == identity(ours).0 {
        return Err(anyhow!("That's this PC's own database: export it on your other PC and import that file here."));
    }
    let own = own_sources(src)?;
    let ids = in_list(&own.iter().map(|s| s.0).collect::<Vec<_>>());
    let (first, last): (Option<String>, Option<String>) = src.query_row(
        &format!("SELECT MIN(d), MAX(d) FROM (SELECT MIN(day) AS d FROM input_hour WHERE source IN ({ids}) UNION ALL SELECT MAX(day) FROM input_hour WHERE source IN ({ids})
                  UNION ALL SELECT date(MIN(start), 'unixepoch', 'localtime') FROM segment WHERE source IN ({ids}) UNION ALL SELECT date(MAX(start), 'unixepoch', 'localtime') FROM segment WHERE source IN ({ids}))"),
        [],
        |r| Ok((r.get(0)?, r.get(1)?)),
    )?;
    let days: i64 = src.query_row(&format!("SELECT COUNT(DISTINCT day) FROM input_hour WHERE source IN ({ids})"), [], |r| r.get(0))?;
    let keys: i64 = src.query_row(&format!("SELECT COALESCE(SUM(keys), 0) FROM input_hour WHERE source IN ({ids})"), [], |r| r.get(0))?;
    let active: i64 = src.query_row(&format!("SELECT COALESCE(SUM(end - start), 0) FROM segment WHERE lane = 0 AND ref = 1 AND source IN ({ids})"), [], |r| r.get(0))?;
    let before: Option<i64> = ours
        .query_row("SELECT MAX(created_at) FROM source WHERE device = ?1", [format!("pc:{id}")], |r| r.get(0))
        .optional()?
        .flatten();
    Ok(ScanResult {
        kind: KIND.into(),
        path: path.into(),
        first_day: first,
        last_day: last,
        days,
        stats: vec![
            stat("PC", &name),
            stat("Active time", format!("{} h", fmt_count(active / 3600))),
            stat("Keys", fmt_count(keys)),
            stat("Sources", own.iter().map(|s| s.2.clone()).collect::<Vec<_>>().join(", ")),
        ],
        notes: vec![format!(
            "{name}'s history comes in as its own PC: its keys, clicks and network add to this PC's, and time spent on both at once counts once."
        )],
        overlap_days: 0,
        previous_import: before,
    })
}

/// Copy rows from `src` to `tx`, `batch` at a time, reporting progress.
fn copy(src: &Connection, select: &str, ctx: &Ctx, phase: &str, mut each: impl FnMut(&rusqlite::Row) -> Result<()>) -> Result<u64> {
    let mut stmt = src.prepare(select)?;
    let mut rows = stmt.query([])?;
    let mut n = 0u64;
    while let Some(r) = rows.next()? {
        each(r)?;
        n += 1;
        if n % 50_000 == 0 {
            ctx.report(phase, n, 0)?;
        }
    }
    Ok(n)
}

pub fn import(src: &Connection, tx: &Connection, ctx: &Ctx, path: &str) -> Result<Vec<Stat>> {
    let (id, name) = identity(src);
    if id == identity(tx).0 {
        return Err(anyhow!("That's this PC's own database."));
    }
    let device = format!("pc:{id}");
    // Replace what came from this PC before.
    let old: Vec<i64> = tx.prepare("SELECT id FROM source WHERE device = ?1")?.query_map([&device], |r| r.get(0))?.collect::<rusqlite::Result<_>>()?;
    for s in &old {
        for table in ["segment", "input_hour", "key_day", "net_hour", "uptime_hour", "undated", "mouse_cell", "rhythm_session"] {
            tx.execute(&format!("DELETE FROM {table} WHERE source = ?1"), [s])?;
        }
        tx.execute("DELETE FROM source WHERE id = ?1", [s])?;
    }

    // Its sources, as sources of that device here.
    let mut sources: HashMap<i64, i64> = HashMap::new();
    for (sid, _kind, label) in own_sources(src)? {
        tx.execute(
            "INSERT INTO source (kind, label, path, created_at, device) VALUES (?1, ?2, ?3, ?4, ?5)",
            params![KIND, format!("{name} · {label}"), path, crate::db::now_secs(), device],
        )?;
        sources.insert(sid, tx.last_insert_rowid());
    }
    if sources.is_empty() {
        return Err(anyhow!("That database has no history of its own."));
    }
    let ids = in_list(&sources.keys().copied().collect::<Vec<_>>());

    // Apps and window titles, matched by key and text.
    ctx.report("Matching apps", 0, 1)?;
    let mut apps: HashMap<i64, i64> = HashMap::new();
    {
        let mut ins = tx.prepare("INSERT OR IGNORE INTO app (key, name, path) VALUES (?1, ?2, ?3)")?;
        let mut get = tx.prepare("SELECT id FROM app WHERE key = ?1")?;
        copy(src, "SELECT id, key, name, path FROM app", ctx, "Matching apps", |r| {
            let key: String = r.get(1)?;
            ins.execute(params![key, r.get::<_, String>(2)?, r.get::<_, Option<String>>(3)?])?;
            apps.insert(r.get(0)?, get.query_row([&key], |x| x.get(0))?);
            Ok(())
        })?;
    }
    let mut titles: HashMap<i64, i64> = HashMap::new();
    {
        let mut ins = tx.prepare("INSERT OR IGNORE INTO title (text) VALUES (?1)")?;
        let mut get = tx.prepare("SELECT id FROM title WHERE text = ?1")?;
        copy(src, "SELECT id, text FROM title", ctx, "Matching windows", |r| {
            let text: String = r.get(1)?;
            ins.execute([&text])?;
            titles.insert(r.get(0)?, get.query_row([&text], |x| x.get(0))?);
            Ok(())
        })?;
    }
    let app = |id: i64| apps.get(&id).copied().unwrap_or(0);

    // The timeline.
    let segments = {
        let mut ins = tx.prepare("INSERT INTO segment (lane, start, end, ref, app_id, source) VALUES (?1, ?2, ?3, ?4, ?5, ?6)")?;
        copy(src, &format!("SELECT lane, start, end, ref, app_id, source FROM segment WHERE source IN ({ids})"), ctx, "Timeline", |r| {
            let lane: i64 = r.get(0)?;
            let rf: i64 = r.get(3)?;
            let rf = match lane {
                crate::db::LANE_APP => app(rf),
                crate::db::LANE_DOC | crate::db::LANE_TAG => titles.get(&rf).copied().unwrap_or(0),
                _ => rf,
            };
            let app_id: Option<i64> = r.get::<_, Option<i64>>(4)?.map(app);
            ins.execute(params![lane, r.get::<_, i64>(1)?, r.get::<_, i64>(2)?, rf, app_id, sources[&r.get::<_, i64>(5)?]])?;
            Ok(())
        })?
    };
    // Input, network and uptime per hour, keys per day.
    let mut keys = 0i64;
    {
        let mut ins = tx.prepare("INSERT OR REPLACE INTO input_hour (day, hour, source, app_id, keys, clicks, scrolls, distance_m) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)")?;
        copy(src, &format!("SELECT day, hour, source, app_id, keys, clicks, scrolls, distance_m FROM input_hour WHERE source IN ({ids})"), ctx, "Keys and clicks", |r| {
            let k: i64 = r.get(4)?;
            keys += k;
            let a: i64 = r.get(3)?;
            ins.execute(params![r.get::<_, String>(0)?, r.get::<_, i64>(1)?, sources[&r.get::<_, i64>(2)?], if a == 0 { 0 } else { app(a) }, k,
                r.get::<_, i64>(5)?, r.get::<_, i64>(6)?, r.get::<_, f64>(7)?])?;
            Ok(())
        })?;
        let mut ins = tx.prepare("INSERT OR REPLACE INTO key_day (day, source, key, count) VALUES (?1, ?2, ?3, ?4)")?;
        copy(src, &format!("SELECT day, source, key, count FROM key_day WHERE source IN ({ids})"), ctx, "Keys", |r| {
            ins.execute(params![r.get::<_, String>(0)?, sources[&r.get::<_, i64>(1)?], r.get::<_, String>(2)?, r.get::<_, i64>(3)?])?;
            Ok(())
        })?;
        for table in ["net_hour", "uptime_hour"] {
            let cols = if table == "net_hour" { "download, upload" } else { "ms" };
            let n = if table == "net_hour" { 2 } else { 1 };
            let mut ins = tx.prepare(&format!("INSERT OR REPLACE INTO {table} (day, hour, source, {cols}) VALUES (?1, ?2, ?3, ?4{})", if n == 2 { ", ?5" } else { "" }))?;
            copy(src, &format!("SELECT day, hour, source, {cols} FROM {table} WHERE source IN ({ids})"), ctx, "Network and uptime", |r| {
                let (day, hour, s): (String, i64, i64) = (r.get(0)?, r.get(1)?, sources[&r.get::<_, i64>(2)?]);
                if n == 2 {
                    ins.execute(params![day, hour, s, r.get::<_, i64>(3)?, r.get::<_, i64>(4)?])?;
                } else {
                    ins.execute(params![day, hour, s, r.get::<_, i64>(3)?])?;
                }
                Ok(())
            })?;
        }
        if super::has_table(src, "undated") {
            let mut ins = tx.prepare("INSERT OR REPLACE INTO undated (source, keys, clicks, scrolls, distance_m, download, upload, uptime_ms) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)")?;
            copy(src, &format!("SELECT source, keys, clicks, scrolls, distance_m, download, upload, uptime_ms FROM undated WHERE source IN ({ids})"), ctx, "Lifetime totals", |r| {
                ins.execute(params![sources[&r.get::<_, i64>(0)?], r.get::<_, i64>(1)?, r.get::<_, i64>(2)?, r.get::<_, i64>(3)?, r.get::<_, f64>(4)?,
                    r.get::<_, i64>(5)?, r.get::<_, i64>(6)?, r.get::<_, i64>(7)?])?;
                Ok(())
            })?;
        }
    }
    // Rhythm sessions (Katsudō's own tracking on that PC).
    let mut sessions = 0;
    if super::has_table(src, "rhythm_session") {
        let native = sources.get(&crate::db::NATIVE_SOURCE).copied();
        if let Some(native) = native {
            let mut ins = tx.prepare("INSERT INTO rhythm_session (app_id, start, end, keys, peak_kps, best_stream, streams, series, source) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)")?;
            let own_only = if src.prepare("SELECT 1 FROM pragma_table_info('rhythm_session') WHERE name = 'source'")?.exists([])? { " WHERE source = 1" } else { "" };
            sessions = copy(src, &format!("SELECT app_id, start, end, keys, peak_kps, best_stream, streams, series FROM rhythm_session{own_only}"), ctx, "Rhythm sessions", |r| {
                ins.execute(params![app(r.get(0)?), r.get::<_, f64>(1)?, r.get::<_, f64>(2)?, r.get::<_, i64>(3)?, r.get::<_, i64>(4)?, r.get::<_, i64>(5)?,
                    r.get::<_, i64>(6)?, r.get::<_, Vec<u8>>(7)?, native])?;
                Ok(())
            })?;
        }
    }
    Ok(vec![
        stat("PC", &name),
        stat("Timeline segments", fmt_count(segments as i64)),
        stat("Keys", fmt_count(keys)),
        stat("Rhythm sessions", fmt_count(sessions as i64)),
    ])
}

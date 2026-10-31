//! WhatPulse: reads whatpulse.db. Hourly keys, clicks, scrolls and pointer travel (per app
//! where WhatPulse recorded it), keys per day, network traffic, uptime, and where you
//! clicked (WhatPulse keeps about the last three months of click positions).

use super::{fmt_bytes, fmt_count, fmt_short, has_table, overlap_days, previous_import, replace_source, stat, Ctx, Overlap, ScanResult, Stat};
use crate::{db, hooks, keys, win};
use anyhow::{anyhow, Result};
use rusqlite::{params, Connection};
use std::collections::HashMap;

pub const KIND: &str = "whatpulse";
/// WhatPulse keeps a placeholder day "0000-00-00"; anything before this is ignored.
const VALID: &str = "1971-01-01";
const METRES_PER_INCH: f64 = 0.0254;

fn check(src: &Connection) -> Result<()> {
    if !has_table(src, "keypresses") || !has_table(src, "mouseclicks") {
        return Err(anyhow!("This isn't a WhatPulse database. Pick whatpulse.db from the WhatPulse data folder."));
    }
    Ok(())
}

fn sum(src: &Connection, sql: &str) -> i64 {
    src.query_row(sql, [VALID], |r| r.get::<_, Option<f64>>(0)).ok().flatten().unwrap_or(0.0) as i64
}

fn unplaced_keys(src: &Connection) -> Result<i64> {
    let mut stmt = src.prepare("SELECT key, SUM(count) FROM keypress_frequency WHERE day >= ?1 GROUP BY key")?;
    let mut n = 0;
    for row in stmt.query_map([VALID], |r| Ok((r.get::<_, i64>(0)?, r.get::<_, i64>(1)?)))? {
        let (code, c) = row?;
        if keys::from_qt(code).starts_with("wp:") {
            n += c;
        }
    }
    Ok(n)
}

pub fn scan(src: &Connection, ours: &Connection, path: &str) -> Result<ScanResult> {
    check(src)?;
    let (first, last, days): (Option<String>, Option<String>, i64) = src.query_row(
        "SELECT MIN(day), MAX(day), COUNT(DISTINCT day) FROM keypresses WHERE day >= ?1",
        [VALID],
        |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
    )?;
    let keys = sum(src, "SELECT SUM(count) FROM keypresses WHERE day >= ?1");
    let clicks = sum(src, "SELECT SUM(count) FROM mouseclicks WHERE day >= ?1");
    let mut stats = vec![stat("Days", fmt_count(days)), stat("Keys", fmt_short(keys)), stat("Clicks", fmt_short(clicks))];
    if has_table(src, "network_interface_bandwidth") {
        let down = sum(src, "SELECT SUM(download) FROM network_interface_bandwidth WHERE day >= ?1");
        let up = sum(src, "SELECT SUM(upload) FROM network_interface_bandwidth WHERE day >= ?1");
        stats.push(stat("Downloaded", fmt_bytes(down)));
        stats.push(stat("Uploaded", fmt_bytes(up)));
    }
    if has_table(src, "applications") {
        let apps: i64 = src.query_row("SELECT COUNT(*) FROM applications", [], |r| r.get(0))?;
        stats.push(stat("Apps", fmt_count(apps)));
    }
    let mut notes = vec![
        "App time comes from Katsudō's own timeline and ManicTime; WhatPulse adds keys, clicks and traffic per app.".to_string(),
        "Clicks per button, key combinations and per-website stats are not imported yet.".to_string(),
    ];
    let unplaced = unplaced_keys(src)?;
    if unplaced > 0 {
        notes.push(format!(
            "{} presses are on keys the keyboard map can't place yet. They count in every total and are kept for later.",
            fmt_short(unplaced)
        ));
    }
    let overlap = match (&first, &last) {
        (Some(f), Some(l)) => overlap_days(ours, KIND, f, l, Overlap::Input),
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

#[derive(Default, Clone, Copy)]
struct Input {
    keys: i64,
    clicks: i64,
    scrolls: i64,
    distance_m: f64,
}

pub fn import(src: &Connection, tx: &Connection, ctx: &Ctx, path: &str) -> Result<Vec<Stat>> {
    check(src)?;
    let source = replace_source(tx, KIND, "WhatPulse", path)?;

    // Apps, by WhatPulse path.
    ctx.report("Reading apps", 0, 6)?;
    let mut app_ids: HashMap<String, i64> = HashMap::new();
    let mut app_for = |tx: &Connection, path: &str, name: &str| -> Result<i64> {
        if let Some(id) = app_ids.get(path) {
            return Ok(*id);
        }
        let file = db::app_key_from_path(path);
        let key = if file.ends_with(".exe") || name.trim().is_empty() { file } else { name.trim().to_lowercase() };
        let id = db::upsert_app(tx, &key, name, Some(path))?;
        app_ids.insert(path.to_string(), id);
        Ok(id)
    };
    let mut names: HashMap<String, String> = HashMap::new();
    if has_table(src, "applications") {
        let mut stmt = src.prepare("SELECT path, name FROM applications WHERE path IS NOT NULL")?;
        for row in stmt.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))? {
            let (p, n) = row?;
            names.insert(p, n);
        }
    }

    // Hour totals, then the per-app split; whatever WhatPulse didn't attribute goes to app 0.
    ctx.report("Reading keys, clicks and scrolls", 1, 6)?;
    let mut totals: HashMap<(String, i64), Input> = HashMap::new();
    let hourly = [
        ("keypresses", "SUM(count)"),
        ("mouseclicks", "SUM(count)"),
        ("mousescrolls", "SUM(count)"),
        ("mousedistance", "SUM(distance_inches)"),
    ];
    for (i, (table, expr)) in hourly.iter().enumerate() {
        if !has_table(src, table) {
            continue;
        }
        let mut stmt = src.prepare(&format!("SELECT day, hour, {expr} FROM {table} WHERE day >= ?1 GROUP BY day, hour"))?;
        for row in stmt.query_map([VALID], |r| Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?, r.get::<_, f64>(2)?)))? {
            let (day, hour, v) = row?;
            let e = totals.entry((day, hour)).or_default();
            match i {
                0 => e.keys += v as i64,
                1 => e.clicks += v as i64,
                2 => e.scrolls += v as i64,
                _ => e.distance_m += v * METRES_PER_INCH,
            }
        }
    }
    let mut per_app: HashMap<(String, i64, i64), Input> = HashMap::new();
    if has_table(src, "input_per_application") {
        let mut stmt = src.prepare(
            "SELECT day, hour, path, SUM(keys), SUM(clicks), SUM(scrolls), SUM(distance_inches)
             FROM input_per_application WHERE day >= ?1 GROUP BY day, hour, path",
        )?;
        let rows = stmt.query_map([VALID], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, i64>(1)?,
                r.get::<_, String>(2)?,
                Input { keys: r.get(3)?, clicks: r.get(4)?, scrolls: r.get(5)?, distance_m: r.get::<_, f64>(6)? * METRES_PER_INCH },
            ))
        })?;
        for row in rows {
            let (day, hour, path, input) = row?;
            let name = names.get(&path).cloned().unwrap_or_default();
            let app = app_for(tx, &path, &name)?;
            let e = per_app.entry((day, hour, app)).or_default();
            e.keys += input.keys;
            e.clicks += input.clicks;
            e.scrolls += input.scrolls;
            e.distance_m += input.distance_m;
        }
    }
    let mut attributed: HashMap<(String, i64), Input> = HashMap::new();
    for ((day, hour, _), v) in &per_app {
        let e = attributed.entry((day.clone(), *hour)).or_default();
        e.keys += v.keys;
        e.clicks += v.clicks;
        e.scrolls += v.scrolls;
        e.distance_m += v.distance_m;
    }
    for ((day, hour), t) in &totals {
        let a = attributed.get(&(day.clone(), *hour)).copied().unwrap_or_default();
        let rest = Input {
            keys: (t.keys - a.keys).max(0),
            clicks: (t.clicks - a.clicks).max(0),
            scrolls: (t.scrolls - a.scrolls).max(0),
            distance_m: (t.distance_m - a.distance_m).max(0.0),
        };
        if rest.keys + rest.clicks + rest.scrolls > 0 || rest.distance_m > 0.01 {
            per_app.insert((day.clone(), *hour, 0), rest);
        }
    }
    ctx.report("Writing hourly input", 2, 6)?;
    {
        let mut ins = tx.prepare_cached(
            "INSERT INTO input_hour (day, hour, source, app_id, keys, clicks, scrolls, distance_m)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        )?;
        for ((day, hour, app), v) in &per_app {
            ins.execute(params![day, hour, source, app, v.keys, v.clicks, v.scrolls, v.distance_m])?;
        }
    }

    ctx.report("Writing keys per day", 3, 6)?;
    let mut key_rows = 0i64;
    if has_table(src, "keypress_frequency") {
        let mut per_day: HashMap<(String, String), i64> = HashMap::new();
        let mut stmt = src.prepare("SELECT day, key, SUM(count) FROM keypress_frequency WHERE day >= ?1 GROUP BY day, key")?;
        for row in stmt.query_map([VALID], |r| Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?, r.get::<_, i64>(2)?)))? {
            let (day, code, n) = row?;
            *per_day.entry((day, keys::from_qt(code))).or_default() += n;
        }
        let mut ins = tx.prepare_cached("INSERT INTO key_day (day, source, key, count) VALUES (?1, ?2, ?3, ?4)")?;
        for ((day, key), n) in &per_day {
            ins.execute(params![day, source, key, n])?;
            key_rows += 1;
        }
    }

    ctx.report("Writing network traffic", 4, 6)?;
    if has_table(src, "network_interface_bandwidth") {
        let mut stmt = src.prepare(
            "SELECT day, hour, SUM(download), SUM(upload) FROM network_interface_bandwidth WHERE day >= ?1 GROUP BY day, hour",
        )?;
        let mut ins = tx.prepare_cached("INSERT INTO net_hour (day, hour, source, download, upload) VALUES (?1, ?2, ?3, ?4, ?5)")?;
        for row in stmt.query_map([VALID], |r| Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?, r.get::<_, i64>(2)?, r.get::<_, i64>(3)?)))? {
            let (day, hour, down, up) = row?;
            ins.execute(params![day, hour, source, down, up])?;
        }
    }

    ctx.report("Writing uptime", 5, 6)?;
    if has_table(src, "uptime_hour") {
        let mut stmt = src.prepare("SELECT day, hour, SUM(msec_active) FROM uptime_hour WHERE day >= ?1 GROUP BY day, hour")?;
        let mut ins = tx.prepare_cached("INSERT INTO uptime_hour (day, hour, source, ms) VALUES (?1, ?2, ?3, ?4)")?;
        for row in stmt.query_map([VALID], |r| Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?, r.get::<_, i64>(2)?)))? {
            let (day, hour, ms) = row?;
            ins.execute(params![day, hour, source, ms])?;
        }
    }
    ctx.report("Writing click positions", 6, 7)?;
    let click_points = import_clicks(src, tx, source)?;
    ctx.report("Done", 7, 7)?;

    let (days, keys_total, clicks_total): (i64, i64, i64) = tx.query_row(
        "SELECT COUNT(DISTINCT day), COALESCE(SUM(keys), 0), COALESCE(SUM(clicks), 0) FROM input_hour WHERE source = ?1",
        [source],
        |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
    )?;
    let summary = vec![
        stat("Days", fmt_count(days)),
        stat("Keys", fmt_short(keys_total)),
        stat("Clicks", fmt_short(clicks_total)),
        stat("Apps", fmt_count(app_ids.len() as i64)),
        stat("Key rows", fmt_short(key_rows)),
    ];
    let mut summary = summary;
    if click_points > 0 {
        summary.push(stat("Click positions", fmt_short(click_points)));
    }
    tx.execute("UPDATE source SET summary = ?1 WHERE id = ?2", params![serde_json::to_string(&summary)?, source])?;
    Ok(summary)
}

/// WhatPulse stores each click as a point in screen fractions: x from 0 to 1 across the main
/// monitor (beyond 1 on a monitor to its right), y from 0 to 1 down it, and a display id.
/// They are placed on the monitors as arranged now, in the same squares Katsudō records.
fn import_clicks(src: &Connection, tx: &Connection, source: i64) -> Result<i64> {
    if !has_table(src, "mousepoints") {
        return Ok(0);
    }
    let screens = win::screens();
    let Some(main) = screens.iter().find(|s| s.primary).or(screens.first()).cloned() else { return Ok(0) };
    let second = screens.iter().find(|s| **s != main).cloned();
    let has_display = src.prepare("SELECT display_id FROM mousepoints LIMIT 1").is_ok();
    let sql = if has_display {
        "SELECT day, x, y, display_id, COUNT(*) FROM mousepoints WHERE day >= ?1 GROUP BY day, x, y, display_id"
    } else {
        "SELECT day, x, y, 0, COUNT(*) FROM mousepoints WHERE day >= ?1 GROUP BY day, x, y"
    };
    let mut cells: HashMap<(String, i32, i32), i64> = HashMap::new();
    let mut stmt = src.prepare(sql)?;
    for row in stmt.query_map([VALID], |r| Ok((r.get::<_, String>(0)?, r.get::<_, f64>(1)?, r.get::<_, f64>(2)?, r.get::<_, Option<i64>>(3)?, r.get::<_, i64>(4)?)))? {
        let (day, fx, fy, display, n) = row?;
        let on = if display.unwrap_or(0) > 0 { second.as_ref().unwrap_or(&main) } else { &main };
        let x = on.x + (fx * on.w as f64) as i32;
        let y = on.y + (fy * on.h as f64) as i32;
        *cells.entry((day, x.div_euclid(hooks::CELL_PX), y.div_euclid(hooks::CELL_PX))).or_default() += n;
    }
    let mut ins = tx.prepare_cached("INSERT INTO mouse_cell (day, source, x, y, clicks, moves) VALUES (?1, ?2, ?3, ?4, ?5, 0)")?;
    let mut total = 0;
    for ((day, x, y), n) in &cells {
        ins.execute(params![day, source, x, y, n])?;
        total += n;
    }
    Ok(total)
}

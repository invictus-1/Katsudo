//! Read models for the UI. Every query applies source precedence (lowest source id wins
//! where two sources cover the same hour, day or time range) and folds in the tracker's
//! open, not-yet-written segments so today is always live.

use crate::db::{self, LANE_ACTIVITY, LANE_APP, LANE_DOC, LANE_TAG, NATIVE_SOURCE};
use crate::tracker::Seg;
use anyhow::Result;
use rusqlite::{params, Connection};
use serde::Serialize;
use std::collections::{BTreeMap, HashMap};

#[derive(Clone, Copy, Debug)]
pub struct Row {
    pub start: i64,
    pub end: i64,
    pub ref_id: i64,
    pub source: i64,
}

#[derive(Serialize, Default, Clone)]
pub struct Totals {
    pub active_secs: i64,
    pub keys: i64,
    pub clicks: i64,
    pub scrolls: i64,
    pub distance_m: f64,
    pub download: i64,
    pub upload: i64,
    pub uptime_ms: i64,
}

#[derive(Serialize, Clone)]
pub struct DaySummary {
    pub day: String,
    #[serde(flatten)]
    pub totals: Totals,
}

#[derive(Serialize)]
pub struct LaneSeg {
    pub from: f64,
    pub to: f64,
    #[serde(rename = "ref")]
    pub ref_id: i64,
    pub source: i64,
}

#[derive(Serialize, Clone)]
pub struct AppTotal {
    pub app_id: i64,
    pub name: String,
    pub seconds: i64,
    pub keys: i64,
    pub clicks: i64,
}

#[derive(Serialize)]
pub struct HourInput {
    pub hour: i64,
    pub keys: i64,
    pub clicks: i64,
}

#[derive(Serialize)]
pub struct DayView {
    pub day: String,
    pub totals: Totals,
    pub activity: Vec<LaneSeg>,
    pub apps_lane: Vec<LaneSeg>,
    pub docs_lane: Vec<LaneSeg>,
    pub tags_lane: Vec<LaneSeg>,
    /// Time tagged by your rules (ref = tag id).
    pub rule_tags: Vec<LaneSeg>,
    /// Flow sessions touching the day, live.
    pub flow: crate::flow::DayFlow,
    pub names: HashMap<i64, String>,
    pub titles: HashMap<i64, String>,
    pub apps: Vec<AppTotal>,
    pub hourly: Vec<HourInput>,
    pub week: Vec<DaySummary>,
}

#[derive(Serialize)]
pub struct RangeView {
    pub days: Vec<DaySummary>,
    pub apps: Vec<AppTotal>,
}

pub fn rows(conn: &Connection, lane: i64, start: i64, end: i64, live: &[Seg]) -> Result<Vec<Row>> {
    let mut stmt = conn.prepare_cached(
        "SELECT start, end, ref, source FROM segment WHERE lane = ?1 AND start >= ?2 AND start < ?3",
    )?;
    let mut out: Vec<Row> = stmt
        .query_map(params![lane, start, end], |r| {
            Ok(Row { start: r.get(0)?, end: r.get(1)?, ref_id: r.get(2)?, source: r.get(3)? })
        })?
        .collect::<rusqlite::Result<_>>()?;
    for s in live.iter().filter(|s| s.lane == lane && s.end > start && s.start < end) {
        out.push(Row { start: s.start.max(start), end: s.end.min(end), ref_id: s.ref_id, source: NATIVE_SOURCE });
    }
    Ok(dedupe(out))
}

/// Lower source ids win: a higher source's segment keeps only the parts no lower source covers.
fn dedupe(mut rows: Vec<Row>) -> Vec<Row> {
    rows.sort_by_key(|r| (r.source, r.start));
    let mut covered: Vec<(i64, i64)> = Vec::new();
    let mut out = Vec::with_capacity(rows.len());
    let mut i = 0;
    while i < rows.len() {
        let source = rows[i].source;
        let mut added = Vec::new();
        while i < rows.len() && rows[i].source == source {
            let r = rows[i];
            i += 1;
            let mut cur = r.start;
            let first = covered.partition_point(|c| c.1 <= cur);
            for &(cs, ce) in &covered[first..] {
                if cs >= r.end {
                    break;
                }
                if cs > cur {
                    out.push(Row { start: cur, end: cs, ..r });
                    added.push((cur, cs));
                }
                cur = cur.max(ce);
                if cur >= r.end {
                    break;
                }
            }
            if cur < r.end {
                out.push(Row { start: cur, end: r.end, ..r });
                added.push((cur, r.end));
            }
        }
        covered.extend(added);
        covered.sort();
        let mut merged: Vec<(i64, i64)> = Vec::with_capacity(covered.len());
        for c in covered {
            match merged.last_mut() {
                Some(last) if c.0 <= last.1 => last.1 = last.1.max(c.1),
                _ => merged.push(c),
            }
        }
        covered = merged;
    }
    out.sort_by_key(|r| r.start);
    out
}

fn days_between(from: &str, to: &str) -> Result<Vec<String>> {
    let mut out = Vec::new();
    let mut d = from.to_string();
    while d.as_str() <= to && out.len() < 3700 {
        out.push(d.clone());
        d = db::shift_day(&d, 1)?;
    }
    Ok(out)
}

pub fn daily(conn: &Connection, from: &str, to: &str, live: &[Seg]) -> Result<Vec<DaySummary>> {
    let mut map: BTreeMap<String, Totals> = days_between(from, to)?.into_iter().map(|d| (d, Totals::default())).collect();
    {
        let mut stmt = conn.prepare_cached(
            "SELECT day, SUM(keys), SUM(clicks), SUM(scrolls), SUM(distance_m) FROM input_hour a
             WHERE day BETWEEN ?1 AND ?2
               AND a.source = (SELECT MIN(b.source) FROM input_hour b JOIN source sb ON sb.id = b.source WHERE b.day = a.day AND b.hour = a.hour AND sb.device = (SELECT device FROM source WHERE id = a.source))
             GROUP BY day",
        )?;
        let rows = stmt.query_map(params![from, to], |r| {
            Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?, r.get::<_, i64>(2)?, r.get::<_, i64>(3)?, r.get::<_, f64>(4)?))
        })?;
        for row in rows {
            let (day, k, c, s, d) = row?;
            if let Some(t) = map.get_mut(&day) {
                t.keys = k;
                t.clicks = c;
                t.scrolls = s;
                t.distance_m = d;
            }
        }
        let mut stmt = conn.prepare_cached(
            "SELECT day, SUM(download), SUM(upload) FROM net_hour a
             WHERE day BETWEEN ?1 AND ?2
               AND a.source = (SELECT MIN(b.source) FROM net_hour b JOIN source sb ON sb.id = b.source WHERE b.day = a.day AND b.hour = a.hour AND sb.device = (SELECT device FROM source WHERE id = a.source))
             GROUP BY day",
        )?;
        for row in stmt.query_map(params![from, to], |r| Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?, r.get::<_, i64>(2)?)))? {
            let (day, down, up) = row?;
            if let Some(t) = map.get_mut(&day) {
                t.download = down;
                t.upload = up;
            }
        }
        let mut stmt = conn.prepare_cached(
            "SELECT day, SUM(ms) FROM uptime_hour a
             WHERE day BETWEEN ?1 AND ?2
               AND a.source = (SELECT MIN(b.source) FROM uptime_hour b JOIN source sb ON sb.id = b.source WHERE b.day = a.day AND b.hour = a.hour AND sb.device = (SELECT device FROM source WHERE id = a.source))
             GROUP BY day",
        )?;
        for row in stmt.query_map(params![from, to], |r| Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?)))? {
            let (day, ms) = row?;
            if let Some(t) = map.get_mut(&day) {
                t.uptime_ms = ms;
            }
        }
    }
    let (start, _) = db::day_bounds(from)?;
    let (_, end) = db::day_bounds(to)?;
    for r in rows(conn, LANE_ACTIVITY, start, end, live)? {
        if r.ref_id == 1 {
            let (day, _) = db::local_day_hour(r.start);
            if let Some(t) = map.get_mut(&day) {
                t.active_secs += r.end - r.start;
            }
        }
    }
    Ok(map.into_iter().map(|(day, totals)| DaySummary { day, totals }).collect())
}

pub fn apps(conn: &Connection, from: &str, to: &str, live: &[Seg]) -> Result<Vec<AppTotal>> {
    let (start, _) = db::day_bounds(from)?;
    let (_, end) = db::day_bounds(to)?;
    let mut by_app: HashMap<i64, AppTotal> = HashMap::new();
    for r in rows(conn, LANE_APP, start, end, live)? {
        by_app
            .entry(r.ref_id)
            .or_insert(AppTotal { app_id: r.ref_id, name: String::new(), seconds: 0, keys: 0, clicks: 0 })
            .seconds += r.end - r.start;
    }
    let mut stmt = conn.prepare_cached(
        "SELECT app_id, SUM(keys), SUM(clicks) FROM input_hour a
         WHERE day BETWEEN ?1 AND ?2 AND app_id <> 0
           AND a.source = (SELECT MIN(b.source) FROM input_hour b JOIN source sb ON sb.id = b.source WHERE b.day = a.day AND b.hour = a.hour AND sb.device = (SELECT device FROM source WHERE id = a.source))
         GROUP BY app_id",
    )?;
    for row in stmt.query_map(params![from, to], |r| Ok((r.get::<_, i64>(0)?, r.get::<_, i64>(1)?, r.get::<_, i64>(2)?)))? {
        let (app, k, c) = row?;
        let e = by_app.entry(app).or_insert(AppTotal { app_id: app, name: String::new(), seconds: 0, keys: 0, clicks: 0 });
        e.keys = k;
        e.clicks = c;
    }
    let names = app_names(conn, by_app.keys().copied())?;
    let mut out: Vec<AppTotal> = by_app
        .into_values()
        .map(|mut a| {
            a.name = names.get(&a.app_id).cloned().unwrap_or_else(|| format!("App {}", a.app_id));
            a
        })
        .collect();
    out.sort_by(|a, b| b.seconds.cmp(&a.seconds).then(b.keys.cmp(&a.keys)));
    Ok(out)
}

fn app_names(conn: &Connection, ids: impl Iterator<Item = i64>) -> Result<HashMap<i64, String>> {
    let mut stmt = conn.prepare_cached("SELECT name FROM app WHERE id = ?1")?;
    let mut out = HashMap::new();
    for id in ids {
        if let Ok(n) = stmt.query_row([id], |r| r.get::<_, String>(0)) {
            out.insert(id, n);
        }
    }
    Ok(out)
}

fn titles(conn: &Connection, ids: impl Iterator<Item = i64>) -> Result<HashMap<i64, String>> {
    let mut stmt = conn.prepare_cached("SELECT text FROM title WHERE id = ?1")?;
    let mut out = HashMap::new();
    for id in ids {
        if let Ok(t) = stmt.query_row([id], |r| r.get::<_, String>(0)) {
            out.insert(id, t);
        }
    }
    Ok(out)
}

pub fn day(conn: &Connection, day: &str, live: &[Seg]) -> Result<DayView> {
    let (start, end) = db::day_bounds(day)?;
    let to_hours = |rows: Vec<Row>| -> Vec<LaneSeg> {
        rows.into_iter()
            .map(|r| LaneSeg {
                from: (r.start - start) as f64 / 3600.0,
                to: (r.end - start) as f64 / 3600.0,
                ref_id: r.ref_id,
                source: r.source,
            })
            .collect()
    };
    let activity = rows(conn, LANE_ACTIVITY, start, end, live)?;
    let apps_lane = rows(conn, LANE_APP, start, end, live)?;
    let docs_lane = rows(conn, LANE_DOC, start, end, live)?;
    let tags_lane = rows(conn, LANE_TAG, start, end, live)?;
    let rule_tags = crate::tags::lane(conn, &apps_lane, &docs_lane)?;
    let names = app_names(conn, apps_lane.iter().map(|r| r.ref_id))?;
    let titles = titles(conn, docs_lane.iter().chain(tags_lane.iter()).map(|r| r.ref_id))?;

    let week_from = db::shift_day(day, -6)?;
    let week = daily(conn, &week_from, day, live)?;
    let totals = week.last().map(|d| d.totals.clone()).unwrap_or_default();

    let mut hourly: Vec<HourInput> = (0..24).map(|h| HourInput { hour: h, keys: 0, clicks: 0 }).collect();
    let mut stmt = conn.prepare_cached(
        "SELECT hour, SUM(keys), SUM(clicks) FROM input_hour a
         WHERE day = ?1 AND a.source = (SELECT MIN(b.source) FROM input_hour b JOIN source sb ON sb.id = b.source WHERE b.day = a.day AND b.hour = a.hour AND sb.device = (SELECT device FROM source WHERE id = a.source))
         GROUP BY hour",
    )?;
    for row in stmt.query_map([day], |r| Ok((r.get::<_, i64>(0)?, r.get::<_, i64>(1)?, r.get::<_, i64>(2)?)))? {
        let (h, k, c) = row?;
        if let Some(slot) = hourly.get_mut(h as usize) {
            slot.keys = k;
            slot.clicks = c;
        }
    }

    Ok(DayView {
        day: day.to_string(),
        totals,
        activity: to_hours(activity),
        apps_lane: to_hours(apps_lane),
        docs_lane: to_hours(docs_lane),
        tags_lane: to_hours(tags_lane),
        rule_tags: to_hours(rule_tags),
        flow: crate::flow::day(conn, day, live)?,
        names,
        titles,
        apps: apps(conn, day, day, live)?,
        hourly,
        week,
    })
}

pub fn range(conn: &Connection, from: &str, to: &str, live: &[Seg]) -> Result<RangeView> {
    Ok(RangeView { days: daily(conn, from, to, live)?, apps: apps(conn, from, to, live)? })
}

pub fn key_counts(conn: &Connection, from: &str, to: &str) -> Result<HashMap<String, i64>> {
    let mut stmt = conn.prepare_cached(
        "SELECT key, SUM(count) FROM key_day a
         WHERE day BETWEEN ?1 AND ?2 AND source = (SELECT MIN(source) FROM key_day b WHERE b.day = a.day)
         GROUP BY key",
    )?;
    let out = stmt
        .query_map(params![from, to], |r| Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?)))?
        .collect::<rusqlite::Result<HashMap<_, _>>>()?;
    Ok(out)
}

/// Keys and clicks stored for one day, with source precedence.
pub fn input_totals(conn: &Connection, day: &str) -> Result<(i64, i64)> {
    let mut stmt = conn.prepare_cached(
        "SELECT COALESCE(SUM(keys), 0), COALESCE(SUM(clicks), 0) FROM input_hour a
         WHERE day = ?1 AND a.source = (SELECT MIN(b.source) FROM input_hour b JOIN source sb ON sb.id = b.source WHERE b.day = a.day AND b.hour = a.hour AND sb.device = (SELECT device FROM source WHERE id = a.source))",
    )?;
    Ok(stmt.query_row([day], |r| Ok((r.get(0)?, r.get(1)?)))?)
}

/// Where the pointer clicked and travelled over a range, with the monitor layout to draw it on.
#[derive(Serialize)]
pub struct MouseMap {
    /// Side of a square, in pixels.
    pub cell: i32,
    pub screens: Vec<crate::win::Screen>,
    /// [x, y, clicks, moves] per square, in square units.
    pub cells: Vec<[i64; 4]>,
}

pub fn mouse(conn: &Connection, from: &str, to: &str) -> Result<MouseMap> {
    let cells = conn
        .prepare_cached("SELECT x, y, SUM(clicks), SUM(moves) FROM mouse_cell WHERE day BETWEEN ?1 AND ?2 GROUP BY x, y")?
        .query_map(params![from, to], |r| Ok([r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?]))?
        .collect::<rusqlite::Result<_>>()?;
    // The layout of the range's last recorded day, else the monitors as they are now.
    let screens = conn
        .query_row("SELECT screens FROM mouse_layout WHERE day <= ?1 ORDER BY day DESC LIMIT 1", [to], |r| r.get::<_, String>(0))
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_else(crate::win::screens);
    Ok(MouseMap { cell: crate::hooks::CELL_PX, screens, cells })
}

/// Everything sources know only as lifetime totals, with no day to put it on.
#[derive(Serialize, Default)]
pub struct Undated {
    pub keys: i64,
    pub clicks: i64,
    pub scrolls: i64,
    pub distance_m: f64,
    pub download: i64,
    pub upload: i64,
    pub uptime_ms: i64,
}

pub fn undated(conn: &Connection) -> Undated {
    conn.query_row(
        "SELECT COALESCE(SUM(keys), 0), COALESCE(SUM(clicks), 0), COALESCE(SUM(scrolls), 0), COALESCE(SUM(distance_m), 0),
                COALESCE(SUM(download), 0), COALESCE(SUM(upload), 0), COALESCE(SUM(uptime_ms), 0) FROM undated",
        [],
        |r| {
            Ok(Undated {
                keys: r.get(0)?,
                clicks: r.get(1)?,
                scrolls: r.get(2)?,
                distance_m: r.get(3)?,
                download: r.get(4)?,
                upload: r.get(5)?,
                uptime_ms: r.get(6)?,
            })
        },
    )
    .unwrap_or_default()
}

pub fn first_day(conn: &Connection) -> Option<String> {
    conn.query_row(
        "SELECT MIN(d) FROM (
           SELECT MIN(day) AS d FROM input_hour
           UNION ALL SELECT date(MIN(start), 'unixepoch', 'localtime') FROM segment WHERE lane = 0)",
        [],
        |r| r.get(0),
    )
    .ok()
    .flatten()
}

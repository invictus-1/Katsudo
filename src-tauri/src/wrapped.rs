//! Year in review: one year of your history boiled down for the "Wrapped" cards. Everything
//! is worked out here, locally, from the same data as every other view.

use crate::db::{LANE_APP, LANE_DOC};
use crate::{queries, rhythm};
use anyhow::Result;
use chrono::{Datelike, NaiveDate};
use rusqlite::{params, Connection};
use serde::Serialize;
use std::collections::HashMap;

#[derive(Serialize)]
pub struct Named {
    pub name: String,
    pub secs: i64,
}

#[derive(Serialize)]
pub struct DayValue {
    pub day: String,
    pub value: f64,
}

#[derive(Serialize, Default)]
pub struct RhythmYear {
    /// Time with a rhythm game in front, from every source (so years before Rhythm mode too).
    pub secs: i64,
    pub games: Vec<Named>,
    /// From Rhythm mode sessions, when there are any this year.
    pub sessions: i64,
    pub peak_kps: i64,
    pub best_stream: i64,
}

#[derive(Serialize)]
pub struct Wrapped {
    pub year: i32,
    /// Every year with any data, newest first.
    pub years: Vec<i32>,
    pub totals: queries::Totals,
    pub days_tracked: i64,
    pub longest_day: Option<DayValue>,
    pub most_keys_day: Option<DayValue>,
    /// Longest run of consecutive days with any activity: length, first day, last day.
    pub streak: (i64, Option<String>, Option<String>),
    pub top_apps: Vec<Named>,
    /// Apps first seen this year, with the most used of them.
    pub new_apps: i64,
    pub top_new_app: Option<Named>,
    /// Domains only: shareable without leaking window titles.
    pub top_sites: Vec<Named>,
    pub keys: HashMap<String, i64>,
    /// Keys per hour of the day, 0–23.
    pub hours: Vec<i64>,
    /// Active seconds per weekday, Monday first.
    pub weekdays: Vec<i64>,
    /// Active seconds and keys per month.
    pub months: Vec<(i64, i64)>,
    pub rhythm: RhythmYear,
    pub prev: Option<queries::Totals>,
    /// Days with any activity in the year before, so comparisons can be per day.
    pub prev_days: i64,
}

pub fn add(t: &mut queries::Totals, d: &queries::Totals) {
    t.active_secs += d.active_secs;
    t.keys += d.keys;
    t.clicks += d.clicks;
    t.scrolls += d.scrolls;
    t.distance_m += d.distance_m;
    t.download += d.download;
    t.upload += d.upload;
    t.uptime_ms += d.uptime_ms;
}

/// "youtube.com" yes; "(1) Some video - YouTube - Brave" or "C:\\Users\\…" no.
pub fn is_domain(s: &str) -> bool {
    let s = s.trim();
    !s.is_empty()
        && s.len() <= 80
        && s.contains('.')
        && !s.contains(char::is_whitespace)
        && !s.contains(['\\', '/', ':', '@'])
        && s.chars().all(|c| c.is_ascii_alphanumeric() || c == '.' || c == '-')
        && s.rsplit('.').next().is_some_and(|tld| tld.len() >= 2 && tld.chars().all(|c| c.is_ascii_alphabetic()) && !FILE_TYPES.contains(&tld.to_ascii_lowercase().as_str()))
}

/// Endings that make "report.docx" a file, not a site.
const FILE_TYPES: &[&str] = &[
    "txt", "doc", "docx", "pdf", "xls", "xlsx", "ppt", "pptx", "odt", "rtf", "md", "csv", "json", "xml", "yaml", "yml", "ini", "cfg",
    "log", "exe", "dll", "msi", "lnk", "bat", "ps", "png", "jpg", "jpeg", "gif", "webp", "bmp", "svg", "psd", "mp", "mkv", "avi", "mov",
    "wav", "flac", "ogg", "zip", "rar", "gz", "tar", "iso", "html", "htm", "js", "ts", "tsx", "rs", "py", "cs", "cpp", "java", "blend",
    "osu", "osz", "osk", "osr", "db", "sqlite", "torrent",
];

/// The apps (lane 1) or titles (lane 2) with the most time between two days, from the search
/// rollup: (id, name, key, seconds), most first.
pub fn top_named(conn: &Connection, lane: i64, from: &str, to: &str, limit: i64) -> Result<Vec<(i64, String, String, i64)>> {
    let table = if lane == LANE_APP { "app a ON a.id = r.ref" } else { "title a ON a.id = r.ref" };
    let (name, key) = if lane == LANE_APP { ("a.name", "a.key") } else { ("a.text", "a.text") };
    Ok(conn
        .prepare_cached(&format!(
            "SELECT r.ref, {name}, {key}, SUM(r.secs) s FROM ref_day r JOIN {table}
             WHERE r.lane = ?1 AND r.day BETWEEN ?2 AND ?3 GROUP BY r.ref ORDER BY s DESC LIMIT ?4"
        ))?
        .query_map(params![lane, from, to, limit], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)))?
        .collect::<rusqlite::Result<_>>()?)
}

/// Keys per hour of the day (0–23) between two days, with source precedence.
pub fn hour_profile(conn: &Connection, from: &str, to: &str) -> Result<Vec<i64>> {
    let mut hours = vec![0i64; 24];
    let mut stmt = conn.prepare_cached(
        "SELECT hour, SUM(keys) FROM input_hour a WHERE day BETWEEN ?1 AND ?2
           AND a.source = (SELECT MIN(b.source) FROM input_hour b JOIN source sb ON sb.id = b.source
                           WHERE b.day = a.day AND b.hour = a.hour AND sb.device = (SELECT device FROM source WHERE id = a.source))
         GROUP BY hour",
    )?;
    for r in stmt.query_map(params![from, to], |r| Ok((r.get::<_, i64>(0)?, r.get::<_, i64>(1)?)))? {
        let (h, k) = r?;
        if (0..24).contains(&h) {
            hours[h as usize] = k;
        }
    }
    Ok(hours)
}

pub fn years(conn: &Connection) -> Result<Vec<i32>> {
    let mut ys: Vec<i32> = conn
        .prepare(
            "SELECT DISTINCT y FROM (SELECT DISTINCT substr(day, 1, 4) y FROM ref_day UNION SELECT DISTINCT substr(day, 1, 4) FROM input_hour)",
        )?
        .query_map([], |r| r.get::<_, String>(0))?
        .filter_map(|r| r.ok()?.parse().ok())
        .collect();
    ys.sort_unstable_by(|a, b| b.cmp(a));
    Ok(ys)
}

pub fn year(conn: &Connection, year: i32) -> Result<Wrapped> {
    let (from, to) = (format!("{year}-01-01"), format!("{year}-12-31"));
    let days = queries::daily(conn, &from, &to, &[])?;

    let mut totals = queries::Totals::default();
    let (mut weekdays, mut months) = (vec![0i64; 7], vec![(0i64, 0i64); 12]);
    let (mut longest, mut most_keys): (Option<DayValue>, Option<DayValue>) = (None, None);
    let (mut run, mut run_start, mut best) = (0i64, None::<String>, (0i64, None::<String>, None::<String>));
    let mut tracked = 0;
    for d in &days {
        add(&mut totals, &d.totals);
        let t = &d.totals;
        let date = NaiveDate::parse_from_str(&d.day, "%Y-%m-%d")?;
        weekdays[date.weekday().num_days_from_monday() as usize] += t.active_secs;
        let m = &mut months[date.month0() as usize];
        m.0 += t.active_secs;
        m.1 += t.keys;
        if t.active_secs > 0 || t.keys > 0 {
            tracked += 1;
            if run == 0 {
                run_start = Some(d.day.clone());
            }
            run += 1;
            if run > best.0 {
                best = (run, run_start.clone(), Some(d.day.clone()));
            }
        } else {
            run = 0;
        }
        if longest.as_ref().is_none_or(|l| t.active_secs as f64 > l.value) && t.active_secs > 0 {
            longest = Some(DayValue { day: d.day.clone(), value: t.active_secs as f64 });
        }
        if most_keys.as_ref().is_none_or(|l| t.keys as f64 > l.value) && t.keys > 0 {
            most_keys = Some(DayValue { day: d.day.clone(), value: t.keys as f64 });
        }
    }

    let named = |lane: i64, limit: i64| top_named(conn, lane, &from, &to, limit);
    let apps = named(LANE_APP, 400)?;
    let top_apps = apps.iter().take(8).map(|(_, n, _, s)| Named { name: n.clone(), secs: *s }).collect();
    let mut rhythm_year = RhythmYear::default();
    for (_, name, key, secs) in &apps {
        if rhythm::is_game(key) {
            rhythm_year.secs += secs;
            if rhythm_year.games.len() < 4 {
                rhythm_year.games.push(Named { name: name.clone(), secs: *secs });
            }
        }
    }
    let (sessions, peak, stream): (i64, Option<i64>, Option<i64>) = conn.query_row(
        "SELECT COUNT(*), MAX(peak_kps), MAX(best_stream) FROM rhythm_session WHERE date(start, 'unixepoch', 'localtime') BETWEEN ?1 AND ?2",
        params![from, to],
        |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
    )?;
    rhythm_year.sessions = sessions;
    rhythm_year.peak_kps = peak.unwrap_or(0);
    rhythm_year.best_stream = stream.unwrap_or(0);

    let top_sites = named(LANE_DOC, 300)?
        .into_iter()
        .filter(|(_, n, _, _)| is_domain(n))
        .take(6)
        .map(|(_, n, _, s)| Named { name: n.trim_start_matches("www.").to_string(), secs: s })
        .collect();

    let (new_apps, top_new_app) = {
        let mut stmt = conn.prepare(
            "SELECT a.name, SUM(CASE WHEN r.day BETWEEN ?1 AND ?2 THEN r.secs ELSE 0 END) s FROM ref_day r JOIN app a ON a.id = r.ref
             WHERE r.lane = ?3 GROUP BY r.ref HAVING MIN(r.day) BETWEEN ?1 AND ?2 ORDER BY s DESC",
        )?;
        let rows: Vec<(String, i64)> = stmt.query_map(params![from, to, LANE_APP], |r| Ok((r.get(0)?, r.get(1)?)))?.collect::<rusqlite::Result<_>>()?;
        (rows.len() as i64, rows.into_iter().next().map(|(name, secs)| Named { name, secs }))
    };

    let hours = hour_profile(conn, &from, &to)?;

    let (prev, prev_days) = {
        let p = queries::daily(conn, &format!("{}-01-01", year - 1), &format!("{}-12-31", year - 1), &[])?;
        let mut t = queries::Totals::default();
        for d in &p {
            add(&mut t, &d.totals);
        }
        let days = p.iter().filter(|d| d.totals.active_secs > 0 || d.totals.keys > 0).count() as i64;
        ((t.active_secs > 0 || t.keys > 0).then_some(t), days)
    };

    Ok(Wrapped {
        year,
        years: years(conn)?,
        totals,
        days_tracked: tracked,
        longest_day: longest,
        most_keys_day: most_keys,
        streak: best,
        top_apps,
        new_apps,
        top_new_app,
        top_sites,
        keys: queries::key_counts(conn, &from, &to)?,
        hours,
        weekdays,
        months,
        rhythm: rhythm_year,
        prev,
        prev_days,
    })
}

#[cfg(test)]
mod tests {
    use super::is_domain;

    #[test]
    fn domains_only() {
        assert!(is_domain("youtube.com"));
        assert!(is_domain("osu.ppy.sh"));
        assert!(is_domain("www.reddit.com"));
        assert!(!is_domain("(1) Video - YouTube - Brave"));
        assert!(!is_domain("C:\\Users\\me\\notes.txt"));
        assert!(!is_domain("notes.txt - Notepad"));
        assert!(!is_domain("192.168.1.1"));
        assert!(!is_domain("readme"));
        assert!(!is_domain("notes.txt"));
        assert!(!is_domain("Song.mp3"));
    }
}

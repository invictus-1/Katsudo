//! Compare periods: two date ranges side by side, from the same data as every other view.

use crate::db::{LANE_APP, LANE_DOC};
use crate::{queries, wrapped};
use anyhow::Result;
use rusqlite::Connection;
use serde::Serialize;

#[derive(Serialize)]
pub struct Named {
    pub name: String,
    pub secs: i64,
}

#[derive(Serialize)]
pub struct Period {
    pub from: String,
    pub to: String,
    pub totals: queries::Totals,
    /// Days with any activity.
    pub active_days: i64,
    /// One entry per calendar day, in order.
    pub days: Vec<queries::DaySummary>,
    /// Keys per hour of the day.
    pub hours: Vec<i64>,
    pub apps: Vec<Named>,
    /// Domains only.
    pub sites: Vec<Named>,
}

fn period(conn: &Connection, from: &str, to: &str) -> Result<Period> {
    let days = queries::daily(conn, from, to, &[])?;
    let mut totals = queries::Totals::default();
    for d in &days {
        wrapped::add(&mut totals, &d.totals);
    }
    let active_days = days.iter().filter(|d| d.totals.active_secs > 0 || d.totals.keys > 0).count() as i64;
    let apps = wrapped::top_named(conn, LANE_APP, from, to, 25)?.into_iter().map(|(_, name, _, secs)| Named { name, secs }).collect();
    let sites = wrapped::top_named(conn, LANE_DOC, from, to, 300)?
        .into_iter()
        .filter(|(_, n, _, _)| wrapped::is_domain(n))
        .take(15)
        .map(|(_, n, _, secs)| Named { name: n.trim_start_matches("www.").to_string(), secs })
        .collect();
    Ok(Period { from: from.into(), to: to.into(), totals, active_days, days, hours: wrapped::hour_profile(conn, from, to)?, apps, sites })
}

#[derive(Serialize)]
pub struct Comparison {
    pub a: Period,
    pub b: Period,
}

pub fn compare(conn: &Connection, a: (&str, &str), b: (&str, &str)) -> Result<Comparison> {
    Ok(Comparison { a: period(conn, a.0, a.1)?, b: period(conn, b.0, b.1)? })
}

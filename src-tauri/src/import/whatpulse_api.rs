//! Your whole WhatPulse account, through the Web API v1 (https://whatpulse.org/api/v1).
//!
//! Every computer on the account (archived ones too) and every pulse each one sent. A pulse is
//! a batch: the counts since the computer's previous pulse. Katsudō spreads each batch evenly
//! over the hours it covers (at most a week back) so calendars and totals line up.
//!
//! Each computer becomes its own source and device, so different PCs add up. A computer you
//! mark as "this PC" joins this machine's device and only fills days Katsudō has no input for
//! (the local whatpulse.db import and Katsudō's own recording are more detailed).
//!
//! The API key is used for these requests only. It is never stored or logged.

use super::{fmt_count, fmt_short, stat, Ctx, Stat};
use crate::db::{self, THIS_PC};
use anyhow::{anyhow, Result};
use chrono::{DateTime, Datelike, Local, TimeZone, Timelike};
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::time::Duration;

pub const KIND: &str = "whatpulse-account";
const MIB: f64 = 1_048_576.0;
const METRES_PER_MILE: f64 = 1609.344;
const MAX_SPREAD_SECS: i64 = 7 * 24 * 3600;
const FIRST_PULSE_SPREAD_SECS: i64 = 24 * 3600;

fn base_url() -> String {
    std::env::var("KATSUDO_WHATPULSE_API").unwrap_or_else(|_| "https://whatpulse.org/api/v1".into())
}

// ---- API shapes (only the fields Katsudō uses) ---------------------------------------

#[derive(Deserialize, Serialize, Clone, Default)]
pub struct Totals {
    #[serde(default)]
    pub keys: Option<i64>,
    #[serde(default)]
    pub clicks: Option<i64>,
    #[serde(default)]
    pub download_mb: Option<f64>,
    #[serde(default)]
    pub upload_mb: Option<f64>,
    #[serde(default)]
    pub uptime_seconds: Option<i64>,
    #[serde(default)]
    pub scrolls: Option<i64>,
    #[serde(default)]
    pub distance_miles: Option<f64>,
}

#[derive(Deserialize)]
struct UserEnvelope {
    user: User,
}

#[derive(Deserialize, Serialize, Clone)]
pub struct User {
    pub id: i64,
    pub username: String,
    #[serde(default)]
    pub first_pulse_date: Option<String>,
    #[serde(default)]
    pub last_pulse_date: Option<String>,
    #[serde(default)]
    pub pulses: Option<i64>,
    #[serde(default)]
    pub totals: Totals,
}

#[derive(Deserialize, Serialize, Clone)]
pub struct Computer {
    pub id: i64,
    pub name: String,
    #[serde(default)]
    pub os: Option<String>,
    #[serde(default)]
    pub is_archived: Option<bool>,
    #[serde(default)]
    pub pulses: Option<i64>,
    #[serde(default)]
    pub last_pulse_date: Option<String>,
    #[serde(default)]
    pub totals: Totals,
}

#[derive(Deserialize)]
struct Links {
    #[serde(default)]
    next: Option<String>,
}

#[derive(Deserialize)]
struct ComputerPage {
    #[serde(default)]
    computers: Vec<Computer>,
    #[serde(default)]
    links: Option<Links>,
}

#[derive(Deserialize)]
struct Pagination {
    #[serde(default)]
    per_page: Option<i64>,
    #[serde(default)]
    total: Option<i64>,
    #[serde(default)]
    last_page: Option<i64>,
}

#[derive(Deserialize)]
struct PulsePage {
    #[serde(default)]
    pulses: Vec<Pulse>,
    #[serde(default)]
    pagination: Option<Pagination>,
}

#[derive(Deserialize, Clone)]
struct Pulse {
    #[serde(default)]
    id: Option<i64>,
    /// Usually ISO 8601; kept as raw JSON so older formats (date only, epoch numbers) still parse.
    #[serde(default)]
    date: serde_json::Value,
    #[serde(default)]
    keys: Option<i64>,
    #[serde(default)]
    clicks: Option<i64>,
    #[serde(default)]
    download_mb: Option<f64>,
    #[serde(default)]
    upload_mb: Option<f64>,
    #[serde(default)]
    uptime_seconds: Option<i64>,
    #[serde(default)]
    scrolls: Option<i64>,
    #[serde(default)]
    distance_miles: Option<f64>,
    #[serde(default)]
    computer_id: Option<i64>,
    #[serde(default)]
    computer: Option<serde_json::Value>,
}

impl Pulse {
    /// The computer a pulse says it came from, when the API includes it.
    fn computer(&self) -> Option<i64> {
        self.computer_id.or_else(|| self.computer.as_ref()?.get("id")?.as_i64())
    }
}

// ---- HTTP -----------------------------------------------------------------------------

struct Api {
    agent: ureq::Agent,
    token: String,
}

impl Api {
    fn new(token: &str) -> Result<Self> {
        let tls = native_tls::TlsConnector::new()?;
        let agent = ureq::AgentBuilder::new()
            .tls_connector(std::sync::Arc::new(tls))
            .timeout(Duration::from_secs(30))
            .user_agent(concat!("Katsudo/", env!("CARGO_PKG_VERSION")))
            .build();
        Ok(Api { agent, token: token.trim().to_string() })
    }

    /// GET a URL, waiting out WhatPulse's rate limit (1000 requests an hour) when it is hit.
    fn get<T: serde::de::DeserializeOwned>(&self, url: &str, ctx: Option<&Ctx>) -> Result<T> {
        for _ in 0..3 {
            let res = self.agent.get(url).set("Authorization", &format!("Bearer {}", self.token)).set("Accept", "application/json").call();
            match res {
                Ok(r) => return Ok(r.into_json()?),
                Err(ureq::Error::Status(429, r)) => {
                    let reset: i64 = r.header("X-RateLimit-Reset").and_then(|v| v.parse().ok()).unwrap_or(db::now_secs() + 60);
                    let wait = (reset - db::now_secs()).clamp(5, 3700);
                    if let Some(ctx) = ctx {
                        ctx.report(&format!("WhatPulse's hourly request limit reached; continuing in {} min", (wait + 59) / 60), 0, 0)?;
                    }
                    std::thread::sleep(Duration::from_secs(wait as u64));
                }
                Err(ureq::Error::Status(401, _)) => return Err(anyhow!("WhatPulse did not accept that API key. Create one at whatpulse.org/go/settings-api-keys and paste it in full.")),
                Err(ureq::Error::Status(403, _)) => return Err(anyhow!("WhatPulse refused access. The key may lack permission for this account.")),
                Err(ureq::Error::Status(404, _)) => return Err(anyhow!("WhatPulse has no user by that name. Use your WhatPulse username or user id.")),
                Err(ureq::Error::Status(code, r)) => {
                    let body = r.into_string().unwrap_or_default();
                    return Err(anyhow!("WhatPulse answered {code}: {}", body.chars().take(200).collect::<String>()));
                }
                Err(e) => return Err(anyhow!("Could not reach WhatPulse: {e}")),
            }
        }
        Err(anyhow!("WhatPulse kept rate-limiting the import. Try again in an hour."))
    }
}

fn user_url(user: &str) -> String {
    format!("{}/users/{}", base_url(), urlencode(user.trim()))
}

fn urlencode(s: &str) -> String {
    s.bytes()
        .map(|b| match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => (b as char).to_string(),
            _ => format!("%{b:02X}"),
        })
        .collect()
}

fn fetch_computers(api: &Api, user: &str) -> Result<Vec<Computer>> {
    // Both archived and active, in case the default lists only one of them.
    let mut by_id: HashMap<i64, Computer> = HashMap::new();
    for filter in ["", "?is_archived=1", "?is_archived=0"] {
        let mut url = Some(format!("{}/computers{filter}", user_url(user)));
        while let Some(u) = url {
            let page: ComputerPage = api.get(&u, None)?;
            for c in page.computers {
                by_id.entry(c.id).or_insert(c);
            }
            url = page.links.and_then(|l| l.next);
        }
    }
    let mut out: Vec<Computer> = by_id.into_values().collect();
    out.sort_by(|a, b| b.last_pulse_date.cmp(&a.last_pulse_date));
    Ok(out)
}

/// What the account import received versus what WhatPulse reports, per computer and year, in
/// %TEMP%\katsudo-import.log. Never contains the API key.
struct ImportLog {
    lines: Vec<String>,
}

impl ImportLog {
    fn new(user: &str) -> Self {
        ImportLog { lines: vec![format!("Katsudō {} · WhatPulse account import for {} at {}", env!("CARGO_PKG_VERSION"), user.trim(), Local::now().format("%Y-%m-%d %H:%M"))] }
    }
    fn line(&mut self, l: String) {
        self.lines.push(l);
    }
    fn save(&self) {
        let _ = std::fs::write(std::env::temp_dir().join("katsudo-import.log"), self.lines.join("
") + "
");
    }
}

// ---- scan -------------------------------------------------------------------------------

#[derive(Serialize)]
pub struct AccountComputer {
    pub id: i64,
    pub name: String,
    pub os: Option<String>,
    pub archived: bool,
    pub pulses: i64,
    pub last_pulse: Option<String>,
    pub keys: i64,
    pub clicks: i64,
    /// Suggested role: "this-pc" (the name matches this machine) or "other".
    pub suggested: String,
}

#[derive(Serialize)]
pub struct AccountScan {
    pub username: String,
    pub first_pulse: Option<String>,
    pub last_pulse: Option<String>,
    pub pulses: i64,
    pub stats: Vec<Stat>,
    pub computers: Vec<AccountComputer>,
    pub previous_import: Option<i64>,
}

pub fn scan(ours: &Connection, user: &str, token: &str) -> Result<AccountScan> {
    let api = Api::new(token)?;
    let u: UserEnvelope = api.get(&user_url(user), None)?;
    let u = u.user;
    let host = std::env::var("COMPUTERNAME").unwrap_or_default().to_lowercase();
    let computers = fetch_computers(&api, user)?
        .into_iter()
        .map(|c| AccountComputer {
            suggested: if !host.is_empty() && c.name.to_lowercase() == host { THIS_PC.into() } else { "other".into() },
            id: c.id,
            os: c.os,
            archived: c.is_archived.unwrap_or(false),
            pulses: c.pulses.unwrap_or(0),
            last_pulse: c.last_pulse_date,
            keys: c.totals.keys.unwrap_or(0),
            clicks: c.totals.clicks.unwrap_or(0),
            name: c.name,
        })
        .collect::<Vec<_>>();
    let t = &u.totals;
    let stats = vec![
        stat("Keys", fmt_short(t.keys.unwrap_or(0))),
        stat("Clicks", fmt_short(t.clicks.unwrap_or(0))),
        stat("Computers", fmt_count(computers.len() as i64)),
        stat("Pulses", fmt_count(u.pulses.unwrap_or(0))),
    ];
    Ok(AccountScan {
        username: u.username,
        first_pulse: u.first_pulse_date,
        last_pulse: u.last_pulse_date,
        pulses: u.pulses.unwrap_or(0),
        stats,
        computers,
        previous_import: super::previous_import(ours, KIND),
    })
}

// ---- import ----------------------------------------------------------------------------

#[derive(Deserialize)]
pub struct Choice {
    pub computer_id: i64,
    pub name: String,
    /// "this-pc", "other" or "skip".
    pub role: String,
}

#[derive(Default, Clone, Copy)]
struct Amounts {
    keys: f64,
    clicks: f64,
    scrolls: f64,
    metres: f64,
    down: f64,
    up: f64,
    uptime_ms: f64,
}

impl Amounts {
    fn of(p: &Pulse) -> Self {
        Amounts {
            keys: p.keys.unwrap_or(0) as f64,
            clicks: p.clicks.unwrap_or(0) as f64,
            scrolls: p.scrolls.unwrap_or(0) as f64,
            metres: p.distance_miles.unwrap_or(0.0) * METRES_PER_MILE,
            down: p.download_mb.unwrap_or(0.0) * MIB,
            up: p.upload_mb.unwrap_or(0.0) * MIB,
            uptime_ms: p.uptime_seconds.unwrap_or(0) as f64 * 1000.0,
        }
    }
    fn of_totals(t: &Totals) -> Self {
        Amounts {
            keys: t.keys.unwrap_or(0) as f64,
            clicks: t.clicks.unwrap_or(0) as f64,
            scrolls: t.scrolls.unwrap_or(0) as f64,
            metres: t.distance_miles.unwrap_or(0.0) * METRES_PER_MILE,
            down: t.download_mb.unwrap_or(0.0) * MIB,
            up: t.upload_mb.unwrap_or(0.0) * MIB,
            uptime_ms: t.uptime_seconds.unwrap_or(0) as f64 * 1000.0,
        }
    }
    fn add_scaled(&mut self, o: &Amounts, f: f64) {
        self.keys += o.keys * f;
        self.clicks += o.clicks * f;
        self.scrolls += o.scrolls * f;
        self.metres += o.metres * f;
        self.down += o.down * f;
        self.up += o.up * f;
        self.uptime_ms += o.uptime_ms * f;
    }
}

fn parse_date(v: &serde_json::Value) -> Option<i64> {
    use chrono::NaiveDate;
    if let Some(n) = v.as_i64().or_else(|| v.as_f64().map(|f| f as i64)) {
        return Some(if n > 100_000_000_000 { n / 1000 } else { n }); // epoch seconds or milliseconds
    }
    let s = v.as_str()?.trim();
    if let Ok(n) = s.parse::<i64>() {
        return Some(if n > 100_000_000_000 { n / 1000 } else { n });
    }
    if let Ok(d) = DateTime::parse_from_rfc3339(s) {
        return Some(d.timestamp());
    }
    let head = s.get(..19).unwrap_or(s);
    for fmt in ["%Y-%m-%dT%H:%M:%S", "%Y-%m-%d %H:%M:%S", "%Y/%m/%d %H:%M:%S"] {
        if let Ok(d) = chrono::NaiveDateTime::parse_from_str(head, fmt) {
            return Some(d.and_utc().timestamp());
        }
    }
    // Date only: count it at local noon of that day.
    let day = s.get(..10).unwrap_or(s);
    for fmt in ["%Y-%m-%d", "%Y/%m/%d", "%d-%m-%Y"] {
        if let Ok(d) = NaiveDate::parse_from_str(day, fmt) {
            return Local.from_local_datetime(&d.and_hms_opt(12, 0, 0)?).earliest().map(|t| t.timestamp());
        }
    }
    None
}

/// Spread `amounts` over local (day, hour) buckets between `from` and `to`, by time overlap.
fn spread(into: &mut HashMap<(String, i64), Amounts>, from: i64, to: i64, amounts: &Amounts) {
    let span = (to - from).max(1) as f64;
    let mut t = from;
    while t < to {
        let local = Local.timestamp_opt(t, 0).single().unwrap_or_else(Local::now);
        let hour_start = local.with_minute(0).and_then(|d| d.with_second(0)).map(|d| d.timestamp()).unwrap_or(t);
        let next = (hour_start + 3600).min(to);
        let f = (next - t) as f64 / span;
        let key = (local.format("%Y-%m-%d").to_string(), local.hour() as i64);
        into.entry(key).or_default().add_scaled(amounts, f);
        t = next;
    }
}

const PER_PAGE: i64 = 100;

/// What one window of pulse pages held.
#[derive(Default)]
struct Window {
    /// How many pulses WhatPulse says the window has.
    listed: i64,
    pages: usize,
    new: usize,
    /// Pulses dated well outside the window: the date filter was ignored.
    outside: usize,
    /// Pulses that say they came from another computer: the computer filter was ignored.
    other_pc: usize,
    /// A page came back the same as the one before: the page number was ignored.
    repeated: bool,
}

impl Window {
    fn describe(&self) -> String {
        let mut s = format!("listed {}, {} new in {} pages", self.listed, self.new, self.pages);
        if self.outside > 0 {
            s += &format!(", {} outside the dates", self.outside);
        }
        if self.other_pc > 0 {
            s += &format!(", {} from other computers (skipped)", self.other_pc);
        }
        if self.repeated {
            s += ", pages repeated";
        }
        s
    }
}

/// One computer's pulses. Every page is requested with all of its filters spelled out (the
/// API's own "next" links may drop them), and pulses from another computer are skipped, so an
/// ignored filter can't mix computers up or end the list early.
struct Fetch<'a> {
    api: &'a Api,
    ctx: &'a Ctx<'a>,
    user: &'a str,
    computer: i64,
    phase: String,
    expected: u64,
    seen: HashSet<String>,
    dated: Vec<(i64, Pulse)>,
    unparsed: Vec<String>,
}

impl Fetch<'_> {
    fn window(&mut self, range: Option<(chrono::NaiveDate, chrono::NaiveDate)>) -> Result<Window> {
        let mut w = Window::default();
        // A day of slack either side: WhatPulse may filter in UTC while dates come back local.
        let bounds = range.map(|(from, to)| {
            let lo = from.and_hms_opt(0, 0, 0).unwrap().and_utc().timestamp() - 86_400;
            let hi = to.and_hms_opt(0, 0, 0).unwrap().and_utc().timestamp() + 2 * 86_400;
            (lo, hi)
        });
        let mut previous_first: Option<String> = None;
        for page in 1..=5000 {
            let mut url = format!("{}/pulses?computer_id={}&per_page={PER_PAGE}&page={page}", user_url(self.user), self.computer);
            if let Some((from, to)) = range {
                url += &format!("&date_from={from}&date_to={to}");
            }
            let body: PulsePage = self.api.get(&url, Some(self.ctx))?;
            let pagination = body.pagination.unwrap_or(Pagination { per_page: None, total: None, last_page: None });
            if page == 1 {
                w.listed = pagination.total.unwrap_or(body.pulses.len() as i64);
            }
            w.pages += 1;
            let count = body.pulses.len() as i64;
            let first = body.pulses.first().map(pulse_key);
            if count > 0 && first == previous_first {
                w.repeated = true;
                break;
            }
            previous_first = first;
            for p in body.pulses {
                if p.computer().is_some_and(|c| c != self.computer) {
                    w.other_pc += 1;
                    continue;
                }
                if !self.seen.insert(pulse_key(&p)) {
                    continue;
                }
                w.new += 1;
                match parse_date(&p.date) {
                    Some(t) => {
                        if bounds.is_some_and(|(lo, hi)| t < lo || t > hi) {
                            w.outside += 1;
                        }
                        self.dated.push((t, p));
                    }
                    None => self.unparsed.push(p.date.to_string()),
                }
            }
            let got = (self.dated.len() + self.unparsed.len()) as u64;
            self.ctx.report(&self.phase, got, self.expected.max(got))?;
            let done = match pagination.last_page {
                Some(last) => page >= last,
                None => count < pagination.per_page.unwrap_or(PER_PAGE),
            };
            if count == 0 || done {
                break;
            }
        }
        Ok(w)
    }
}

fn pulse_key(p: &Pulse) -> String {
    p.id.map(|id| id.to_string()).unwrap_or_else(|| format!("{}|{:?}", p.date, p.keys))
}

/// Download first (no database lock held, so tracking keeps saving even through a rate-limit
/// wait), then write everything in one transaction.
pub fn import(conn: &mut Connection, ctx: &Ctx, user: &str, token: &str, choices: &[Choice]) -> Result<Vec<Stat>> {
    let api = Api::new(token)?;
    let chosen: Vec<&Choice> = choices.iter().filter(|c| c.role != "skip").collect();
    if chosen.is_empty() {
        return Err(anyhow!("Pick at least one computer to import."));
    }

    // What WhatPulse says each computer has, to check the import against.
    let reported: HashMap<i64, Computer> = fetch_computers(&api, user)?.into_iter().map(|c| (c.id, c)).collect();
    // WhatPulse began in 2003. The account's own first_pulse_date can be years too late, so
    // it only ever moves the start earlier.
    let first_pulse = api.get::<UserEnvelope>(&user_url(user), None).ok().and_then(|u| u.user.first_pulse_date);
    let this_year = Local::now().year();
    let first_year = first_pulse.as_deref().and_then(|d| d.get(..4)?.parse::<i32>().ok()).unwrap_or(2003).min(2003);
    let mut log = ImportLog::new(user);
    log.line(format!("Account first pulse: {}; reading {first_year} to {this_year}", first_pulse.as_deref().unwrap_or("not given")));

    let mut fetched: Vec<Vec<(i64, Pulse)>> = Vec::new();
    for (i, choice) in chosen.iter().enumerate() {
        let expected = reported.get(&choice.computer_id).and_then(|c| c.pulses).unwrap_or(0).max(0) as u64;
        let mut f = Fetch {
            api: &api,
            ctx,
            user,
            computer: choice.computer_id,
            phase: format!("Reading pulses from {} ({} of {})", choice.name, i + 1, chosen.len()),
            expected,
            seen: HashSet::new(),
            dated: Vec::new(),
            unparsed: Vec::new(),
        };
        ctx.report(&f.phase, 0, expected)?;
        // Year by year with explicit dates: without them the endpoint can answer with only a
        // recent window, which silently drops older years and older computers.
        let mut swept = false;
        for year in first_year..=this_year {
            let from = chrono::NaiveDate::from_ymd_opt(year, 1, 1).unwrap();
            let to = if year == this_year { Local::now().date_naive() + chrono::Duration::days(1) } else { chrono::NaiveDate::from_ymd_opt(year, 12, 31).unwrap() };
            let w = f.window(Some((from, to)))?;
            if w.listed > 0 || w.new > 0 {
                log.line(format!("  {} {year}: {}", choice.name, w.describe()));
            }
            if w.outside > 0 {
                // The date filter was ignored, so that one window already read the whole list.
                log.line(format!("  {}: WhatPulse ignored the dates; read the full list instead", choice.name));
                swept = true;
                break;
            }
        }
        if !swept && (f.dated.len() as u64) < expected {
            let w = f.window(None)?;
            log.line(format!("  {} without dates: {}", choice.name, w.describe()));
        }
        let mut dated = std::mem::take(&mut f.dated);
        dated.sort_by_key(|(t, _)| *t);
        let reported_keys = reported.get(&choice.computer_id).and_then(|c| c.totals.keys).unwrap_or(0);
        let received_keys: i64 = dated.iter().map(|(_, p)| p.keys.unwrap_or(0)).sum();
        log.line(format!(
            "{}: WhatPulse reports {} pulses and {} keys; received {} pulses ({} keys){}",
            choice.name,
            expected,
            reported_keys,
            dated.len(),
            received_keys,
            if f.unparsed.is_empty() { String::new() } else { format!("; {} with unreadable dates, e.g. {:?}", f.unparsed.len(), &f.unparsed[..f.unparsed.len().min(5)]) }
        ));
        fetched.push(dated);
    }
    log.save();

    ctx.report("Writing your WhatPulse history", 0, 1)?;
    let tx = conn.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
    // Replace any earlier account import.
    let old: Vec<i64> = tx.prepare("SELECT id FROM source WHERE kind = ?1")?.query_map([KIND], |r| r.get(0))?.collect::<rusqlite::Result<_>>()?;
    for id in old {
        for table in ["segment", "input_hour", "key_day", "net_hour", "uptime_hour", "undated", "mouse_cell"] {
            tx.execute(&format!("DELETE FROM {table} WHERE source = ?1"), [id])?;
        }
        tx.execute("DELETE FROM source WHERE id = ?1", [id])?;
    }

    // Days this PC already has input for: a "this PC" computer only fills the gaps.
    let this_pc_days: HashSet<String> = tx
        .prepare("SELECT DISTINCT day FROM input_hour WHERE source IN (SELECT id FROM source WHERE device = ?1)")?
        .query_map([THIS_PC], |r| r.get(0))?
        .collect::<rusqlite::Result<_>>()?;

    let mut summary_keys = 0i64;
    let mut summary_undated = 0i64;
    let mut summary_pulses = 0u64;
    let mut summary_days: HashSet<String> = HashSet::new();
    let mut skipped_days = 0usize;
    for (i, choice) in chosen.iter().enumerate() {
        let this_pc = choice.role == THIS_PC;
        let device = if this_pc { THIS_PC.to_string() } else { format!("whatpulse:{}", choice.computer_id) };
        tx.execute(
            "INSERT INTO source (kind, label, path, created_at, device) VALUES (?1, ?2, ?3, ?4, ?5)",
            params![KIND, format!("WhatPulse · {}", choice.name), format!("whatpulse.org/{}", user.trim()), db::now_secs(), device],
        )?;
        let source = tx.last_insert_rowid();
        let dated = &fetched[i];
        summary_pulses += dated.len() as u64;

        let mut buckets: HashMap<(String, i64), Amounts> = HashMap::new();
        let mut prev: Option<i64> = None;
        for (t, p) in dated {
            let from = match prev {
                Some(pt) if pt < *t => pt.max(t - MAX_SPREAD_SECS),
                _ => t - FIRST_PULSE_SPREAD_SECS,
            };
            spread(&mut buckets, from, *t, &Amounts::of(p));
            prev = Some(*t);
        }

        let mut input = tx.prepare_cached(
            "INSERT INTO input_hour (day, hour, source, app_id, keys, clicks, scrolls, distance_m) VALUES (?1, ?2, ?3, 0, ?4, ?5, ?6, ?7)",
        )?;
        let mut net = tx.prepare_cached("INSERT INTO net_hour (day, hour, source, download, upload) VALUES (?1, ?2, ?3, ?4, ?5)")?;
        let mut up = tx.prepare_cached("INSERT INTO uptime_hour (day, hour, source, ms) VALUES (?1, ?2, ?3, ?4)")?;
        // Round on running totals, in time order, so every pulse's counts add up exactly
        // (rounding each hour on its own drifts: 1,000 keys over 24 hours would become 1,008).
        let mut ordered: Vec<(&(String, i64), &Amounts)> = buckets.iter().collect();
        ordered.sort_by(|a, b| a.0.cmp(b.0));
        let mut cum = Amounts::default();
        let mut emitted = [0i64; 6];
        let mut take = |i: usize, running: f64| -> i64 {
            let v = running.round() as i64 - emitted[i];
            emitted[i] += v;
            v
        };
        let mut skipped: HashSet<&str> = HashSet::new();
        let (mut pc_keys, mut pc_days, mut pc_skipped_keys) = (0i64, HashSet::new(), 0i64);
        for ((day, hour), a) in ordered {
            cum.add_scaled(a, 1.0);
            let (k, c, s) = (take(0, cum.keys), take(1, cum.clicks), take(2, cum.scrolls));
            let (dn, upl, ms) = (take(3, cum.down), take(4, cum.up), take(5, cum.uptime_ms));
            if this_pc && this_pc_days.contains(day) {
                skipped.insert(day);
                pc_skipped_keys += k;
                continue;
            }
            input.execute(params![day, hour, source, k, c, s, a.metres])?;
            if dn > 0 || upl > 0 {
                net.execute(params![day, hour, source, dn, upl])?;
            }
            if ms > 0 {
                up.execute(params![day, hour, source, ms])?;
            }
            summary_keys += k;
            pc_keys += k;
            pc_days.insert(day.clone());
            summary_days.insert(day.clone());
        }
        skipped_days += skipped.len();
        let rep = reported.get(&choice.computer_id);
        let rep_pulses = rep.and_then(|c| c.pulses).unwrap_or(0);
        let rep_keys = rep.and_then(|c| c.totals.keys).unwrap_or(0);
        // What WhatPulse counts for this computer beyond the pulses it still hands out: kept as
        // undated lifetime totals so all-time numbers match, without inventing dates for them.
        let mut received = Amounts::default();
        for (_, p) in dated {
            received.add_scaled(&Amounts::of(p), 1.0);
        }
        let left = rep.map(|c| Amounts::of_totals(&c.totals)).unwrap_or_default();
        let gap = |r: f64, g: f64| (r - g).max(0.0).round() as i64;
        let undated = [
            gap(left.keys, received.keys),
            gap(left.clicks, received.clicks),
            gap(left.scrolls, received.scrolls),
            gap(left.down, received.down),
            gap(left.up, received.up),
            gap(left.uptime_ms, received.uptime_ms),
        ];
        let undated_metres = (left.metres - received.metres).max(0.0);
        if undated.iter().any(|v| *v > 0) || undated_metres > 0.0 {
            tx.execute(
                "INSERT INTO undated (source, keys, clicks, scrolls, distance_m, download, upload, uptime_ms) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
                params![source, undated[0], undated[1], undated[2], undated_metres, undated[3], undated[4], undated[5]],
            )?;
        }
        let mut pc_summary = vec![
            stat("Pulses", format!("{} of {}", fmt_count(dated.len() as i64), fmt_count(rep_pulses))),
            stat("Days", fmt_count(pc_days.len() as i64)),
            stat("Keys", fmt_short(pc_keys)),
        ];
        if !skipped.is_empty() {
            pc_summary.push(stat("Days already here", format!("{} ({} keys)", fmt_count(skipped.len() as i64), fmt_short(pc_skipped_keys))));
        }
        summary_undated += undated[0];
        if undated[0] > 0 {
            pc_summary.push(stat("Undated", format!("{} keys (all-time only)", fmt_short(undated[0]))));
        }
        if rep_keys > 0 && (pc_keys + pc_skipped_keys + undated[0] - rep_keys).abs() > rep_keys / 1000 {
            pc_summary.push(stat("Keys WhatPulse reports", fmt_short(rep_keys)));
        }
        tx.execute("UPDATE source SET summary = ?1 WHERE id = ?2", params![serde_json::to_string(&pc_summary)?, source])?;
    }

    let mut summary = vec![
        stat("Computers", fmt_count(chosen.len() as i64)),
        stat("Pulses", fmt_count(summary_pulses as i64)),
        stat("Days", fmt_count(summary_days.len() as i64)),
        stat("Keys", fmt_short(summary_keys)),
    ];
    if summary_undated > 0 {
        summary.push(stat("Undated", format!("{} keys (all-time only)", fmt_short(summary_undated))));
    }
    if skipped_days > 0 {
        summary.push(stat("Days already here", fmt_count(skipped_days as i64)));
    }
    tx.commit()?;
    Ok(summary)
}

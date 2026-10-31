//! Tags and rules. A tag is a label with a colour; rules say which app or which window
//! title / document / site gets which tag, checked in order, first match wins. Time is
//! attributed second by second: where a title is open its rules are tried first (so
//! "github.com → Work" beats "Firefox → Browsing"), the rest of an app's time goes by the app.
//! Totals per tag per day are kept in tag_day, rebuilt in the background when the rules
//! change and caught up day by day as new time is recorded.

use crate::db::{self, LANE_APP, LANE_DOC};
use crate::queries::{self, Row};
use anyhow::{anyhow, Result};
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet, HashMap};
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

/// Time no rule claims.
pub const UNTAGGED: i64 = 0;
static BUILDING: AtomicBool = AtomicBool::new(false);

#[derive(Serialize, Deserialize, Clone)]
pub struct Tag {
    pub id: i64,
    pub name: String,
    /// A data tone: amber, cyan, rose, lime or sky.
    pub color: String,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct Rule {
    /// "app" or "title" (window titles, documents and sites).
    pub field: String,
    /// "is" or "contains".
    pub op: String,
    pub value: String,
    pub tag_id: i64,
}

#[derive(Serialize)]
pub struct Setup {
    pub tags: Vec<Tag>,
    pub rules: Vec<Rule>,
    /// True while history is being re-tagged after a change.
    pub building: bool,
}

pub(crate) fn meta_i64(conn: &Connection, key: &str) -> i64 {
    conn.query_row("SELECT value FROM meta WHERE key = ?1", [key], |r| r.get::<_, String>(0))
        .optional()
        .ok()
        .flatten()
        .and_then(|v| v.parse().ok())
        .unwrap_or(0)
}

pub(crate) fn set_meta(conn: &Connection, key: &str, value: i64) -> Result<()> {
    conn.execute("INSERT OR REPLACE INTO meta (key, value) VALUES (?1, ?2)", params![key, value.to_string()])?;
    Ok(())
}

pub fn setup(conn: &Connection) -> Result<Setup> {
    let tags = conn
        .prepare("SELECT id, name, color FROM tag ORDER BY ord, id")?
        .query_map([], |r| Ok(Tag { id: r.get(0)?, name: r.get(1)?, color: r.get(2)? }))?
        .collect::<rusqlite::Result<_>>()?;
    let rules = conn
        .prepare("SELECT field, op, value, tag_id FROM tag_rule ORDER BY ord, id")?
        .query_map([], |r| Ok(Rule { field: r.get(0)?, op: r.get(1)?, value: r.get(2)?, tag_id: r.get(3)? }))?
        .collect::<rusqlite::Result<_>>()?;
    Ok(Setup { tags, rules, building: BUILDING.load(Ordering::SeqCst) })
}

/// Replace every tag and rule. Tags with id 0 (or unknown ids) are new; rules refer to tags by
/// their position in `tags` when `tag_id` is negative (-1 = the first tag), so a new tag and
/// its rules can be saved together.
pub fn save(conn: &Connection, tags: &[Tag], rules: &[Rule]) -> Result<()> {
    let tx = conn.unchecked_transaction()?;
    let mut ids = Vec::with_capacity(tags.len());
    let keep: Vec<i64> = tags.iter().map(|t| t.id).filter(|id| *id > 0).collect();
    tx.execute(&format!("DELETE FROM tag WHERE id NOT IN ({})", keep.iter().map(|i| i.to_string()).chain(["-1".into()]).collect::<Vec<_>>().join(",")), [])?;
    for (i, t) in tags.iter().enumerate() {
        let name = t.name.trim();
        if name.is_empty() {
            return Err(anyhow!("Every tag needs a name."));
        }
        let exists = t.id > 0 && tx.query_row("SELECT 1 FROM tag WHERE id = ?1", [t.id], |_| Ok(())).optional()?.is_some();
        if exists {
            tx.execute("UPDATE tag SET name = ?1, color = ?2, ord = ?3 WHERE id = ?4", params![name, t.color, i as i64, t.id])?;
            ids.push(t.id);
        } else {
            tx.execute("INSERT INTO tag (name, color, ord) VALUES (?1, ?2, ?3)", params![name, t.color, i as i64])
                .map_err(|_| anyhow!("There's already a tag called \"{name}\"."))?;
            ids.push(tx.last_insert_rowid());
        }
    }
    tx.execute("DELETE FROM tag_rule", [])?;
    for (i, r) in rules.iter().enumerate() {
        if r.value.trim().is_empty() {
            continue;
        }
        let tag_id = if r.tag_id < 0 { ids.get((-r.tag_id - 1) as usize).copied() } else { ids.iter().copied().find(|id| *id == r.tag_id) };
        let Some(tag_id) = tag_id else { continue };
        if !matches!(r.field.as_str(), "app" | "title") || !matches!(r.op.as_str(), "is" | "contains") {
            return Err(anyhow!("Unknown rule."));
        }
        tx.execute(
            "INSERT INTO tag_rule (ord, field, op, value, tag_id) VALUES (?1, ?2, ?3, ?4, ?5)",
            params![i as i64, r.field, r.op, r.value.trim(), tag_id],
        )?;
    }
    let version = meta_i64(&tx, "tag_rules_version") + 1;
    set_meta(&tx, "tag_rules_version", version)?;
    tx.commit()?;
    Ok(())
}

// ---- matching ---------------------------------------------------------------------------

/// The rules, ready to match, with every answer remembered.
pub struct Matcher {
    rules: Vec<(bool, bool, String, i64)>, // (is title rule, exact, lower-case value, tag)
    apps: HashMap<i64, (String, String)>,  // id -> (key, name), lower-case
    titles: HashMap<i64, String>,
    cache: HashMap<(i64, i64), i64>,
}

impl Matcher {
    pub fn load(conn: &Connection) -> Result<Self> {
        let rules = setup(conn)?
            .rules
            .into_iter()
            .map(|r| (r.field == "title", r.op == "is", r.value.to_lowercase(), r.tag_id))
            .collect();
        Ok(Matcher { rules, apps: HashMap::new(), titles: HashMap::new(), cache: HashMap::new() })
    }

    pub fn is_empty(&self) -> bool {
        self.rules.is_empty()
    }

    /// An app's (key, name), lower-case.
    pub(crate) fn app(&mut self, conn: &Connection, id: i64) -> &(String, String) {
        self.apps.entry(id).or_insert_with(|| {
            conn.query_row("SELECT key, name FROM app WHERE id = ?1", [id], |r| Ok((r.get::<_, String>(0)?.to_lowercase(), r.get::<_, String>(1)?.to_lowercase())))
                .unwrap_or_default()
        })
    }

    fn title(&mut self, conn: &Connection, id: i64) -> &String {
        self.titles.entry(id).or_insert_with(|| {
            conn.query_row("SELECT text FROM title WHERE id = ?1", [id], |r| r.get::<_, String>(0)).map(|t| t.to_lowercase()).unwrap_or_default()
        })
    }

    /// The tag for an app, with a title open in it or not (title id 0).
    pub fn tag(&mut self, conn: &Connection, app: i64, title: i64) -> i64 {
        if let Some(t) = self.cache.get(&(app, title)) {
            return *t;
        }
        let (key, name) = self.app(conn, app).clone();
        let text = if title > 0 { self.title(conn, title).clone() } else { String::new() };
        let hit = |exact: bool, value: &str, s: &str| if exact { s == value } else { s.contains(value) };
        let mut tag = UNTAGGED;
        // Title rules first wherever a title is open, then app rules: a site's tag beats its browser's.
        for pass_title in [true, false] {
            if pass_title && title == 0 {
                continue;
            }
            if let Some(r) = self.rules.iter().find(|r| {
                r.0 == pass_title
                    && if pass_title {
                        hit(r.1, &r.2, &text)
                    } else {
                        hit(r.1, &r.2, &key) || hit(r.1, &r.2, &name) || (r.1 && key.trim_end_matches(".exe") == r.2)
                    }
            }) {
                tag = r.3;
                break;
            }
        }
        self.cache.insert((app, title), tag);
        tag
    }
}

/// App segments split where window titles change: (start, end, app, title or 0), in order.
pub fn split(apps: &[Row], docs: &[Row]) -> Vec<(i64, i64, i64, i64)> {
    let mut docs: Vec<Row> = docs.to_vec();
    docs.sort_by_key(|d| d.start);
    let mut apps: Vec<Row> = apps.to_vec();
    apps.sort_by_key(|a| a.start);
    let mut out = Vec::new();
    let mut push = |start: i64, end: i64, app: i64, title: i64| {
        if end > start {
            out.push((start, end, app, title));
        }
    };
    let mut first = 0;
    for a in &apps {
        while first < docs.len() && docs[first].end <= a.start {
            first += 1;
        }
        let mut cur = a.start;
        for d in docs[first..].iter().take_while(|d| d.start < a.end) {
            let (s, e) = (d.start.max(a.start), d.end.min(a.end));
            if e <= cur {
                continue;
            }
            push(cur, s.max(cur), a.ref_id, 0);
            push(s.max(cur), e, a.ref_id, d.ref_id);
            cur = e;
        }
        push(cur, a.end, a.ref_id, 0);
    }
    out
}

/// Tagged pieces of time: app segments split where window titles change.
pub fn pieces(conn: &Connection, m: &mut Matcher, apps: &[Row], docs: &[Row]) -> Vec<Row> {
    let mut out: Vec<Row> = Vec::new();
    for (start, end, app, title) in split(apps, docs) {
        let tag = m.tag(conn, app, title);
        match out.last_mut() {
            Some(last) if last.ref_id == tag && last.end == start => last.end = end,
            _ => out.push(Row { start, end, ref_id: tag, source: 0 }),
        }
    }
    out
}

/// Seconds per tag on one local day.
fn day_totals(conn: &Connection, m: &mut Matcher, day: &str) -> Result<BTreeMap<i64, i64>> {
    let (start, end) = db::day_bounds(day)?;
    let apps = queries::rows(conn, LANE_APP, start, end, &[])?;
    let docs = queries::rows(conn, LANE_DOC, start, end, &[])?;
    let mut out = BTreeMap::new();
    for p in pieces(conn, m, &apps, &docs) {
        *out.entry(p.ref_id).or_insert(0) += p.end - p.start;
    }
    Ok(out)
}

// ---- rollup -------------------------------------------------------------------------------

/// Bring tag_day up to date: everything again after a rule change, else just the days new
/// segments touched. Reads on its own connection; holds the shared writer only to save.
pub fn refresh(db_path: &Path, write: &Mutex<Connection>) -> Result<()> {
    let read = db::open(db_path)?;
    let version = meta_i64(&read, "tag_rules_version");
    let rebuild = meta_i64(&read, "tag_rollup_version") != version;
    let upto = if rebuild { 0 } else { meta_i64(&read, "tag_rollup_upto") };
    let last: i64 = read.query_row("SELECT COALESCE(MAX(id), 0) FROM segment", [], |r| r.get(0))?;
    if !rebuild && last == upto {
        return Ok(());
    }
    let days: BTreeSet<String> = read
        .prepare("SELECT DISTINCT date(start, 'unixepoch', 'localtime') FROM segment WHERE id > ?1 AND lane IN (?2, ?3)")?
        .query_map(params![upto, LANE_APP, LANE_DOC], |r| r.get(0))?
        .collect::<rusqlite::Result<_>>()?;
    let mut m = Matcher::load(&read)?;
    let mut totals: Vec<(String, BTreeMap<i64, i64>)> = Vec::with_capacity(days.len());
    for d in &days {
        totals.push((d.clone(), day_totals(&read, &mut m, d)?));
    }
    let conn = write.lock().unwrap();
    let tx = conn.unchecked_transaction()?;
    if rebuild {
        tx.execute("DELETE FROM tag_day", [])?;
    }
    {
        let mut del = tx.prepare("DELETE FROM tag_day WHERE day = ?1")?;
        let mut ins = tx.prepare("INSERT INTO tag_day (day, tag_id, secs) VALUES (?1, ?2, ?3)")?;
        for (d, by_tag) in &totals {
            del.execute([d])?;
            for (tag, secs) in by_tag {
                ins.execute(params![d, tag, secs])?;
            }
        }
    }
    set_meta(&tx, "tag_rollup_version", version)?;
    set_meta(&tx, "tag_rollup_upto", last)?;
    tx.commit()?;
    Ok(())
}

pub fn is_building() -> bool {
    BUILDING.load(Ordering::SeqCst)
}

/// Refresh in the background unless a refresh is already running.
pub fn refresh_soon(db_path: std::path::PathBuf, write: Arc<Mutex<Connection>>) {
    if BUILDING.swap(true, Ordering::SeqCst) {
        return;
    }
    let _ = std::thread::Builder::new().name("katsudo-tags".into()).spawn(move || {
        if let Err(e) = refresh(&db_path, &write) {
            eprintln!("katsudo: tag rollup: {e}");
        }
        BUILDING.store(false, Ordering::SeqCst);
        // Flow sessions follow the tags.
        if let Err(e) = crate::flow::refresh(&db_path, &write) {
            eprintln!("katsudo: flow rollup: {e}");
        }
    });
}

// ---- reading back -------------------------------------------------------------------------

#[derive(Serialize)]
pub struct Report {
    /// Seconds per tag over the range (tag 0 = untagged).
    pub totals: BTreeMap<i64, i64>,
    /// Each day in the range, with its seconds per tag.
    pub days: Vec<(String, BTreeMap<i64, i64>)>,
    /// The biggest untagged apps and sites over the range, to tag next.
    pub untagged_apps: Vec<(String, i64)>,
    pub untagged_sites: Vec<(String, i64)>,
}

pub fn report(conn: &Connection, from: &str, to: &str) -> Result<Report> {
    let mut days: BTreeMap<String, BTreeMap<i64, i64>> = BTreeMap::new();
    let mut d = from.to_string();
    while d.as_str() <= to {
        days.insert(d.clone(), BTreeMap::new());
        d = db::shift_day(&d, 1)?;
    }
    let mut totals = BTreeMap::new();
    let mut stmt = conn.prepare("SELECT day, tag_id, secs FROM tag_day WHERE day BETWEEN ?1 AND ?2")?;
    for r in stmt.query_map(params![from, to], |r| Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?, r.get::<_, i64>(2)?)))? {
        let (day, tag, secs) = r?;
        *totals.entry(tag).or_insert(0) += secs;
        days.entry(day).or_default().insert(tag, secs);
    }
    // Untagged candidates, from the search rollup: apps no app rule claims, sites no title rule claims.
    let mut m = Matcher::load(conn)?;
    let mut untagged_apps = Vec::new();
    for (id, name, _, secs) in crate::wrapped::top_named(conn, LANE_APP, from, to, 60)? {
        if m.tag(conn, id, 0) == UNTAGGED && untagged_apps.len() < 12 {
            untagged_apps.push((name, secs));
        }
    }
    let mut untagged_sites = Vec::new();
    let any_app = conn.query_row("SELECT id FROM app LIMIT 1", [], |r| r.get::<_, i64>(0)).unwrap_or(0);
    for (id, name, _, secs) in crate::wrapped::top_named(conn, LANE_DOC, from, to, 400)? {
        if crate::wrapped::is_domain(&name) && untagged_sites.len() < 12 {
            // Only title rules matter for a site: check against an app no app rule could claim.
            let hit = m.rules_for_title_only(conn, id, any_app);
            if hit == UNTAGGED {
                untagged_sites.push((name.trim_start_matches("www.").to_string(), secs));
            }
        }
    }
    Ok(Report { totals, days: days.into_iter().collect(), untagged_apps, untagged_sites })
}

impl Matcher {
    /// The tag a title rule gives this title, ignoring app rules.
    fn rules_for_title_only(&mut self, conn: &Connection, title: i64, _app: i64) -> i64 {
        let text = self.title(conn, title).clone();
        self.rules
            .iter()
            .find(|r| r.0 && if r.1 { text == r.2 } else { text.contains(&r.2) })
            .map(|r| r.3)
            .unwrap_or(UNTAGGED)
    }
}

/// One day's tagged pieces for the timeline, in hours from midnight.
pub fn lane(conn: &Connection, apps: &[Row], docs: &[Row]) -> Result<Vec<Row>> {
    let mut m = Matcher::load(conn)?;
    if m.is_empty() {
        return Ok(Vec::new());
    }
    Ok(pieces(conn, &mut m, apps, docs).into_iter().filter(|p| p.ref_id != UNTAGGED).collect())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn db() -> Connection {
        let c = Connection::open_in_memory().unwrap();
        db::migrate(&c).unwrap();
        c.execute_batch(
            "INSERT INTO app (id, key, name) VALUES (10, 'firefox.exe', 'Firefox'), (11, 'code.exe', 'Visual Studio Code');
             INSERT INTO title (id, text) VALUES (20, 'github.com'), (21, 'youtube.com');",
        )
        .unwrap();
        save(
            &c,
            &[Tag { id: 0, name: "Work".into(), color: "amber".into() }, Tag { id: 0, name: "Browsing".into(), color: "sky".into() }],
            &[
                Rule { field: "title".into(), op: "contains".into(), value: "GitHub".into(), tag_id: -1 },
                Rule { field: "app".into(), op: "is".into(), value: "code".into(), tag_id: -1 },
                Rule { field: "app".into(), op: "is".into(), value: "Firefox".into(), tag_id: -2 },
            ],
        )
        .unwrap();
        c
    }

    #[test]
    fn titles_beat_apps_and_time_splits() {
        let c = db();
        let ids: Vec<i64> = setup(&c).unwrap().tags.iter().map(|t| t.id).collect();
        let (work, browsing) = (ids[0], ids[1]);
        let mut m = Matcher::load(&c).unwrap();
        assert_eq!(m.tag(&c, 10, 20), work);
        assert_eq!(m.tag(&c, 10, 21), browsing);
        assert_eq!(m.tag(&c, 10, 0), browsing);
        assert_eq!(m.tag(&c, 11, 0), work);
        let r = |start, end, ref_id| Row { start, end, ref_id, source: 1 };
        // Firefox 0..100 with github.com open 20..50 and youtube.com 60..80.
        let p = pieces(&c, &mut m, &[r(0, 100, 10)], &[r(20, 50, 20), r(60, 80, 21)]);
        let got: Vec<(i64, i64, i64)> = p.iter().map(|x| (x.start, x.end, x.ref_id)).collect();
        assert_eq!(got, vec![(0, 20, browsing), (20, 50, work), (50, 100, browsing)]);
    }
}

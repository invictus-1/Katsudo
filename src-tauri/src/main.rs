#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod backup;
mod compare;
mod db;
mod flow;
mod hooks;
mod import;
mod keys;
mod queries;
mod overlay;
mod rhythm;
mod search;
mod tags;
mod wrapped;
mod tracker;
mod win;

use rusqlite::{Connection, TransactionBehavior};
use serde::Serialize;
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager, State, WindowEvent};
use tauri_plugin_autostart::{MacosLauncher, ManagerExt};

/// Passed by the autostart entry: start in the tray without showing the window.
const MINIMIZED_ARG: &str = "--minimized";

struct Inner {
    read: Arc<Mutex<Connection>>,
    write: Arc<Mutex<Connection>>,
    control: Arc<tracker::Control>,
    db_path: PathBuf,
    data_dir: PathBuf,
    import_busy: AtomicBool,
    /// The running import's latest progress, and how the last one ended, so the Import page
    /// can pick both up again after you leave it and come back.
    import_now: Mutex<Option<import::Progress>>,
    import_last: Mutex<Option<ImportOutcome>>,
    import_cancel: AtomicBool,
    /// The private copy made while scanning a database that was in use, reused by the import.
    scan_copy: Mutex<Option<(PathBuf, PathBuf)>>,
}

#[derive(Clone)]
struct AppState(Arc<Inner>);

type CmdResult<T> = Result<T, String>;

fn err(e: impl std::fmt::Display) -> String {
    e.to_string()
}

fn live(state: &Inner) -> Vec<tracker::Seg> {
    state.control.live.lock().map(|l| l.open.clone()).unwrap_or_default()
}

// ---- views ---------------------------------------------------------------------

#[tauri::command]
fn get_day(state: State<AppState>, day: String) -> CmdResult<queries::DayView> {
    // Keep the stored flow sessions (the week's sparkline) caught up, at most every five minutes.
    flow::refresh_soon(state.0.db_path.clone(), state.0.write.clone(), 300);
    let conn = state.0.read.lock().map_err(err)?;
    queries::day(&conn, &day, &live(&state.0)).map_err(err)
}

#[tauri::command]
fn get_range(state: State<AppState>, from: String, to: String) -> CmdResult<queries::RangeView> {
    let conn = state.0.read.lock().map_err(err)?;
    queries::range(&conn, &from, &to, &live(&state.0)).map_err(err)
}

#[tauri::command]
fn get_days(state: State<AppState>, from: String, to: String) -> CmdResult<Vec<queries::DaySummary>> {
    let conn = state.0.read.lock().map_err(err)?;
    queries::daily(&conn, &from, &to, &live(&state.0)).map_err(err)
}

#[tauri::command]
fn get_mouse(state: State<AppState>, from: String, to: String) -> CmdResult<queries::MouseMap> {
    let conn = state.0.read.lock().map_err(err)?;
    queries::mouse(&conn, &from, &to).map_err(err)
}

#[tauri::command]
fn get_rhythm(state: State<AppState>) -> CmdResult<rhythm::Overview> {
    let conn = state.0.read.lock().map_err(err)?;
    rhythm::overview(&conn).map_err(err)
}

#[tauri::command]
fn get_rhythm_series(state: State<AppState>, id: i64) -> CmdResult<Vec<u16>> {
    let conn = state.0.read.lock().map_err(err)?;
    rhythm::series(&conn, id).map_err(err)
}

#[tauri::command]
fn get_rhythm_live(state: State<AppState>) -> Option<rhythm::Live> {
    let mut live = rhythm::current()?;
    if let Ok(conn) = state.0.read.lock() {
        live.app = conn.query_row("SELECT name FROM app WHERE id = ?1", [live.app_id], |r| r.get(0)).unwrap_or_default();
    }
    Some(live)
}

#[tauri::command]
fn set_rhythm_game(state: State<AppState>, key: String, game: bool) -> CmdResult<()> {
    let conn = state.0.write.lock().map_err(err)?;
    rhythm::mark(&conn, &key, game).map_err(err)
}

#[tauri::command]
fn get_overlay() -> overlay::Status {
    overlay::status()
}

#[tauri::command]
fn set_overlay(state: State<AppState>, config: overlay::Config) -> CmdResult<overlay::Status> {
    let conn = state.0.write.lock().map_err(err)?;
    overlay::set(&conn, config).map_err(err)?;
    Ok(overlay::status())
}

#[tauri::command]
fn set_overlay_era(era: String) {
    overlay::set_app_era(&era);
}

/// Start bringing the search rollup up to date (the palette calls this as it opens).
#[tauri::command]
fn search_prepare(state: State<AppState>) {
    search::refresh_soon(state.0.db_path.clone(), state.0.write.clone());
}

#[tauri::command]
fn search_history(state: State<AppState>, q: String) -> CmdResult<search::Results> {
    let conn = state.0.read.lock().map_err(err)?;
    search::search(&conn, &q).map_err(err)
}

#[tauri::command]
fn search_detail(state: State<AppState>, kind: String, id: i64) -> CmdResult<search::Detail> {
    let conn = state.0.read.lock().map_err(err)?;
    search::detail(&conn, &kind, id).map_err(err)
}

/// Write a year-in-review card the page rendered (PNG, base64) to the path the user chose.
#[tauri::command]
fn save_png(path: String, data: String) -> CmdResult<()> {
    use base64::Engine as _;
    let path = PathBuf::from(path);
    if !path.extension().is_some_and(|e| e.eq_ignore_ascii_case("png")) {
        return Err("Images are saved as .png files.".into());
    }
    let bytes = base64::engine::general_purpose::STANDARD.decode(data.as_bytes()).map_err(err)?;
    if !bytes.starts_with(b"\x89PNG") {
        return Err("That isn't a PNG image.".into());
    }
    std::fs::write(&path, bytes).map_err(err)
}

#[tauri::command]
fn get_tags(state: State<AppState>) -> CmdResult<tags::Setup> {
    let conn = state.0.read.lock().map_err(err)?;
    tags::setup(&conn).map_err(err)
}

/// Save every tag and rule, then re-tag history in the background.
#[tauri::command]
fn save_tags(state: State<AppState>, tags: Vec<tags::Tag>, rules: Vec<tags::Rule>) -> CmdResult<tags::Setup> {
    {
        let conn = state.0.write.lock().map_err(err)?;
        tags::save(&conn, &tags, &rules).map_err(err)?;
    }
    tags::refresh_soon(state.0.db_path.clone(), state.0.write.clone());
    let conn = state.0.read.lock().map_err(err)?;
    tags::setup(&conn).map_err(err)
}

/// Time per tag over a range, with tag totals brought up to date first.
#[tauri::command]
async fn tag_report(state: State<'_, AppState>, from: String, to: String) -> CmdResult<tags::Report> {
    let s = state.0.clone();
    tauri::async_runtime::spawn_blocking(move || {
        search::refresh(&s.db_path, &s.write)?;
        // A re-tag already running in the background will finish the job; the page reloads then.
        if !tags::is_building() {
            tags::refresh(&s.db_path, &s.write)?;
        }
        let conn = db::open(&s.db_path)?;
        tags::report(&conn, &from, &to)
    })
    .await
    .map_err(err)?
    .map_err(err)
}

/// Flow sessions over a range, with tags and sessions brought up to date first.
#[tauri::command]
async fn flow_report(state: State<'_, AppState>, from: String, to: String) -> CmdResult<flow::Report> {
    let s = state.0.clone();
    tauri::async_runtime::spawn_blocking(move || {
        if !tags::is_building() {
            tags::refresh(&s.db_path, &s.write)?;
        }
        flow::refresh(&s.db_path, &s.write)?;
        let conn = db::open(&s.db_path)?;
        flow::report(&conn, &from, &to)
    })
    .await
    .map_err(err)?
    .map_err(err)
}

/// Write a CSV the page built (a tag report) to the path the user chose.
#[tauri::command]
fn save_csv(path: String, data: String) -> CmdResult<()> {
    let path = PathBuf::from(path);
    if !path.extension().is_some_and(|e| e.eq_ignore_ascii_case("csv")) {
        return Err("Reports are saved as .csv files.".into());
    }
    // A byte-order mark so Excel reads the UTF-8 (app names, kanji) correctly.
    std::fs::write(&path, [b"\xEF\xBB\xBF".as_slice(), data.as_bytes()].concat()).map_err(err)
}

/// Two date ranges side by side, with the search rollup brought up to date first.
#[tauri::command]
async fn get_compare(state: State<'_, AppState>, a_from: String, a_to: String, b_from: String, b_to: String) -> CmdResult<compare::Comparison> {
    let s = state.0.clone();
    tauri::async_runtime::spawn_blocking(move || {
        search::refresh(&s.db_path, &s.write)?;
        if !tags::is_building() {
            tags::refresh(&s.db_path, &s.write)?;
        }
        flow::refresh(&s.db_path, &s.write)?;
        let conn = db::open(&s.db_path)?;
        compare::compare(&conn, (&a_from, &a_to), (&b_from, &b_to))
    })
    .await
    .map_err(err)?
    .map_err(err)
}

/// One year's review (this year by default), with the search rollup brought up to date first.
#[tauri::command]
async fn get_wrapped(state: State<'_, AppState>, year: Option<i32>) -> CmdResult<wrapped::Wrapped> {
    let s = state.0.clone();
    tauri::async_runtime::spawn_blocking(move || {
        search::refresh(&s.db_path, &s.write)?;
        let conn = db::open(&s.db_path)?;
        let year = match year {
            Some(y) => y,
            None => wrapped::years(&conn)?.first().copied().unwrap_or_else(|| chrono::Datelike::year(&chrono::Local::now())),
        };
        wrapped::year(&conn, year)
    })
    .await
    .map_err(err)?
    .map_err(err)
}

#[tauri::command]
fn get_keys(state: State<AppState>, from: String, to: String) -> CmdResult<HashMap<String, i64>> {
    let conn = state.0.read.lock().map_err(err)?;
    queries::key_counts(&conn, &from, &to).map_err(err)
}

#[derive(Serialize)]
struct Live {
    keys_today: i64,
    clicks_today: i64,
    kps: u64,
    peak_kps: u64,
}

/// Today's exact key and click totals (stored + not yet stored) and keys per second.
/// Cheap enough to poll ten times a second.
#[tauri::command]
fn get_live(state: State<AppState>) -> CmdResult<Live> {
    use hooks::{FLUSH_SEQ, KPS, PEAK_KPS, UNFLUSHED_CLICKS, UNFLUSHED_KEYS};
    let today = db::today();
    let conn = state.0.read.lock().map_err(err)?;
    let mut last = (0, 0);
    for _ in 0..8 {
        let seq = FLUSH_SEQ.load(Ordering::SeqCst);
        if seq % 2 == 1 {
            std::thread::sleep(std::time::Duration::from_millis(2));
            continue;
        }
        let (uk, uc) = (UNFLUSHED_KEYS.load(Ordering::SeqCst), UNFLUSHED_CLICKS.load(Ordering::SeqCst));
        let (dk, dc) = queries::input_totals(&conn, &today).map_err(err)?;
        last = (dk + uk, dc + uc);
        if FLUSH_SEQ.load(Ordering::SeqCst) == seq {
            break;
        }
    }
    Ok(Live {
        keys_today: last.0,
        clicks_today: last.1,
        kps: KPS.load(Ordering::Relaxed),
        peak_kps: PEAK_KPS.load(Ordering::Relaxed),
    })
}

#[derive(Serialize)]
struct SourceInfo {
    id: i64,
    kind: String,
    label: String,
    path: Option<String>,
    created_at: i64,
    summary: Option<serde_json::Value>,
}

#[derive(Serialize)]
struct Status {
    today: String,
    tracking: bool,
    paused_until: Option<i64>,
    active: bool,
    app_name: Option<String>,
    db_bytes: u64,
    data_dir: String,
    db_path: String,
    first_day: Option<String>,
    undated: queries::Undated,
    last_backup: Option<backup::BackupInfo>,
    sources: Vec<SourceInfo>,
    version: String,
}

#[tauri::command]
fn get_status(app: AppHandle, state: State<AppState>) -> CmdResult<Status> {
    let s = &state.0;
    let now = db::now_secs();
    let paused = s.control.is_paused(now);
    let (active, app_name) = s.control.live.lock().map(|l| (l.active, l.app_name.clone())).unwrap_or_default();
    let size = |p: PathBuf| std::fs::metadata(p).map(|m| m.len()).unwrap_or(0);
    let db_bytes = size(s.db_path.clone()) + size(PathBuf::from(format!("{}-wal", s.db_path.display())));
    let conn = s.read.lock().map_err(err)?;
    let sources = conn
        .prepare("SELECT id, kind, label, path, created_at, summary FROM source ORDER BY id")
        .and_then(|mut st| {
            st.query_map([], |r| {
                Ok(SourceInfo {
                    id: r.get(0)?,
                    kind: r.get(1)?,
                    label: r.get(2)?,
                    path: r.get(3)?,
                    created_at: r.get(4)?,
                    summary: r.get::<_, Option<String>>(5)?.and_then(|j| serde_json::from_str(&j).ok()),
                })
            })?
            .collect::<rusqlite::Result<Vec<_>>>()
        })
        .map_err(err)?;
    Ok(Status {
        today: db::today(),
        tracking: !paused,
        paused_until: paused.then(|| s.control.paused_until.load(Ordering::Relaxed)),
        active,
        app_name,
        db_bytes,
        data_dir: s.data_dir.to_string_lossy().into_owned(),
        db_path: s.db_path.to_string_lossy().into_owned(),
        first_day: queries::first_day(&conn),
        undated: queries::undated(&conn),
        last_backup: backup::list(&s.data_dir).into_iter().next(),
        sources,
        version: app.package_info().version.to_string(),
    })
}

// ---- tracking and settings -------------------------------------------------------

/// `minutes`: None resumes; Some(0) pauses until resumed.
#[tauri::command]
fn set_paused(state: State<AppState>, minutes: Option<i64>) {
    let until = match minutes {
        None => 0,
        Some(0) => i64::MAX,
        Some(m) => db::now_secs() + m * 60,
    };
    state.0.control.paused_until.store(until, Ordering::Relaxed);
}

#[derive(Serialize)]
struct Settings {
    idle_minutes: u64,
    track_titles: bool,
    track_input: bool,
    nightly_backup: bool,
    theme: String,
    ui_scale: u32,
    welcome: bool,
    motion: bool,
    roadmap: String,
    flow_minutes: i64,
}

#[tauri::command]
fn get_settings(state: State<AppState>) -> CmdResult<Settings> {
    let conn = state.0.read.lock().map_err(err)?;
    Ok(Settings {
        idle_minutes: db::get_setting(&conn, "idle_minutes").and_then(|v| v.parse().ok()).unwrap_or(5),
        track_titles: db::get_bool(&conn, "track_titles", true),
        track_input: db::get_bool(&conn, "track_input", true),
        nightly_backup: db::get_bool(&conn, "nightly_backup", true),
        theme: db::get_setting(&conn, "theme").unwrap_or_else(|| "dark".into()),
        ui_scale: db::get_setting(&conn, "ui_scale").and_then(|v| v.parse().ok()).unwrap_or(100),
        welcome: db::get_bool(&conn, "welcome", true),
        motion: db::get_bool(&conn, "motion", true),
        roadmap: db::get_setting(&conn, "roadmap").unwrap_or_else(|| "{}".into()),
        flow_minutes: flow::min_secs(&conn) / 60,
    })
}

#[tauri::command]
fn set_setting(state: State<AppState>, key: String, value: String) -> CmdResult<()> {
    let c = &state.0.control;
    match key.as_str() {
        "idle_minutes" => {
            let m: u64 = value.parse().map_err(err)?;
            c.idle_threshold_secs.store(m.clamp(1, 60) * 60, Ordering::Relaxed);
        }
        "track_titles" => c.track_titles.store(value == "true", Ordering::Relaxed),
        "track_input" => c.track_input.store(value == "true", Ordering::Relaxed),
        "flow_minutes" => {
            value.parse::<i64>().ok().filter(|m| (5..=240).contains(m)).ok_or("Flow needs 5 to 240 minutes.")?;
        }
        "flow_skip" => {
            serde_json::from_str::<Vec<i64>>(&value).map_err(err)?;
        }
        "nightly_backup" | "theme" | "ui_scale" | "welcome" | "motion" | "roadmap" => {}
        _ => return Err(format!("unknown setting {key}")),
    }
    let conn = state.0.write.lock().map_err(err)?;
    db::set_setting(&conn, &key, &value).map_err(err)
}

#[tauri::command]
fn get_autostart(app: AppHandle) -> CmdResult<bool> {
    app.autolaunch().is_enabled().map_err(err)
}

#[tauri::command]
fn set_autostart(app: AppHandle, enabled: bool) -> CmdResult<()> {
    let l = app.autolaunch();
    if enabled { l.enable() } else { l.disable() }.map_err(err)
}

/// Whether a "start with Windows" entry under our name exists but launches another file.
fn autostart_points_elsewhere(name: &str) -> bool {
    use winreg::{enums::HKEY_CURRENT_USER, RegKey};
    let Ok(exe) = std::env::current_exe() else { return false };
    let run = RegKey::predef(HKEY_CURRENT_USER).open_subkey(r"Software\Microsoft\Windows\CurrentVersion\Run");
    match run.and_then(|k| k.get_value::<String, _>(name)) {
        Ok(cmd) => !cmd.to_lowercase().contains(&exe.to_string_lossy().to_lowercase()),
        Err(_) => false,
    }
}

/// Turn "start with Windows" on once, on the first run of an installed copy. Builds run
/// from the source tree (target\) never register themselves.
fn default_autostart(app: &AppHandle, write: &Mutex<Connection>) {
    // Test, portable and demo copies (and anything a test installer starts) never touch
    // autostart: it is one entry per user, and it belongs to the installed copy.
    if ["KATSUDO_DATA_DIR", "KATSUDO_SETUP_TEST", "KATSUDO_DEMO"].iter().any(|v| std::env::var_os(v).is_some()) {
        return;
    }
    let installed = std::env::current_exe()
        .map(|p| !p.components().any(|c| c.as_os_str().eq_ignore_ascii_case("target")))
        .unwrap_or(false)
        && !cfg!(debug_assertions);
    // An entry left pointing at a moved or removed copy is rewritten to point at this one, but
    // only then: security tools can roll back startup-entry writes by unsigned programs, so
    // rewriting it on every launch would only invite that.
    if installed && autostart_points_elsewhere(&app.package_info().name) {
        let _ = app.autolaunch().enable();
    }
    let Ok(conn) = write.lock() else { return };
    if db::get_setting(&conn, "autostart_initialized").is_some() {
        return;
    }
    // The bespoke installer asks; its answer (and the era it showed, if kept) wins.
    let (installer_autostart, installer_theme) = installer_choices();
    if let Some(theme) = installer_theme {
        if db::get_setting(&conn, "theme").is_none() {
            let _ = db::set_setting(&conn, "theme", &theme);
        }
    }
    if installer_autostart.is_some() {
        let _ = db::set_setting(&conn, "autostart_initialized", "true");
        return;
    }
    if installed {
        if let Err(e) = app.autolaunch().enable() {
            eprintln!("katsudo: could not enable autostart: {e}");
        }
    }
    let _ = db::set_setting(&conn, "autostart_initialized", "true");
}

// ---- import --------------------------------------------------------------------

#[tauri::command]
fn import_detect() -> Vec<(String, String)> {
    import::default_paths()
}

fn resolve_import_path(kind: &str, path: &str) -> PathBuf {
    let p = PathBuf::from(if cfg!(windows) { path.replace('/', "\\") } else { path.to_string() });
    match kind {
        import::manictime::KIND => import::manictime::resolve(&p),
        _ if p.is_dir() => p.join("whatpulse.db"),
        _ => p,
    }
}

/// Open the source, reusing the private copy a scan made when there is one.
fn open_import_source(s: &Inner, file: &PathBuf) -> anyhow::Result<Connection> {
    if let Some((src, dir)) = s.scan_copy.lock().unwrap().clone() {
        if &src == file {
            if let Some(name) = file.file_name() {
                if let Ok(conn) = Connection::open(dir.join(name)) {
                    return Ok(conn);
                }
            }
        }
    }
    let (conn, copy_dir) = import::open_source(file, &s.data_dir.join("tmp"))?;
    if let Some(dir) = copy_dir {
        if let Some((_, old)) = s.scan_copy.lock().unwrap().replace((file.clone(), dir)) {
            let _ = std::fs::remove_dir_all(old);
        }
    }
    Ok(conn)
}

#[tauri::command]
async fn import_scan(state: State<'_, AppState>, kind: String, path: String) -> CmdResult<import::ScanResult> {
    let s = state.0.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let file = resolve_import_path(&kind, &path);
        let src = open_import_source(&s, &file)?;
        let ours = db::open(&s.db_path)?;
        let shown = file.to_string_lossy().into_owned();
        match kind.as_str() {
            import::manictime::KIND => import::manictime::scan(&src, &ours, &shown),
            import::whatpulse::KIND => import::whatpulse::scan(&src, &ours, &shown),
            _ => Err(anyhow::anyhow!("unknown source {kind}")),
        }
    })
    .await
    .map_err(err)?
    .map_err(err)
}

#[derive(Clone, Serialize)]
struct ImportOutcome {
    kind: String,
    result: Option<Vec<import::Stat>>,
    error: Option<String>,
}

#[derive(Serialize)]
struct ImportStatus {
    running: Option<import::Progress>,
    last: Option<ImportOutcome>,
}

/// One import at a time. Progress goes out as `import-progress` and is kept for
/// `import_status`; the outcome goes out as `import-finished` and is kept too.
fn run_import_job(
    app: &AppHandle,
    s: &Inner,
    kind: &str,
    job: impl FnOnce(&import::Ctx) -> anyhow::Result<Vec<import::Stat>>,
    cleanup: impl FnOnce(),
) -> anyhow::Result<Vec<import::Stat>> {
    if s.import_busy.swap(true, Ordering::SeqCst) {
        return Err(anyhow::anyhow!("Another import is running."));
    }
    s.import_cancel.store(false, Ordering::SeqCst);
    *s.import_now.lock().unwrap() = Some(import::Progress { kind: kind.into(), phase: "Starting".into(), done: 0, total: 0 });
    let emit = |p: import::Progress| {
        *s.import_now.lock().unwrap() = Some(p.clone());
        let _ = app.emit("import-progress", p);
    };
    let ctx = import::Ctx { kind, cancel: &s.import_cancel, progress: &emit };
    let result = job(&ctx);
    cleanup();
    let outcome = ImportOutcome {
        kind: kind.into(),
        result: result.as_ref().ok().cloned(),
        error: result.as_ref().err().map(|e| format!("{e:#}")),
    };
    *s.import_now.lock().unwrap() = None;
    *s.import_last.lock().unwrap() = Some(outcome.clone());
    s.import_busy.store(false, Ordering::SeqCst);
    let _ = app.emit("import-finished", outcome);
    // Imports replace segments: bring search and tags up to date in the background.
    search::refresh_soon(s.db_path.clone(), s.write.clone());
    tags::refresh_soon(s.db_path.clone(), s.write.clone());
    result
}

#[tauri::command]
fn import_status(state: State<AppState>) -> ImportStatus {
    ImportStatus { running: state.0.import_now.lock().unwrap().clone(), last: state.0.import_last.lock().unwrap().clone() }
}

#[tauri::command]
async fn import_run(app: AppHandle, state: State<'_, AppState>, kind: String, path: String) -> CmdResult<Vec<import::Stat>> {
    let s = state.0.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let job_kind = kind.clone();
        run_import_job(&app, &s, &job_kind, |ctx| {
            let file = resolve_import_path(&kind, &path);
            ctx.report("Backing up Katsudō first", 0, 1)?;
            backup::run(&s.db_path, &s.data_dir, "pre-import")?;
            ctx.report("Opening the source", 0, 1)?;
            let src = open_import_source(&s, &file)?;
            let mut conn = db::open(&s.db_path)?;
            conn.busy_timeout(std::time::Duration::from_secs(30))?;
            let tx = conn.transaction_with_behavior(TransactionBehavior::Immediate)?;
            let shown = file.to_string_lossy().into_owned();
            let summary = match kind.as_str() {
                import::manictime::KIND => import::manictime::import(&src, &tx, ctx, &shown)?,
                import::whatpulse::KIND => import::whatpulse::import(&src, &tx, ctx, &shown)?,
                _ => return Err(anyhow::anyhow!("unknown source {kind}")),
            };
            ctx.report("Saving", 1, 1)?;
            tx.commit()?;
            // Fold the import's write-ahead log back into the database file.
            let _ = conn.execute_batch("PRAGMA wal_checkpoint(TRUNCATE);");
            Ok(summary)
        }, || {
            if let Some((_, dir)) = s.scan_copy.lock().unwrap().take() {
                let _ = std::fs::remove_dir_all(dir);
            }
        })
    })
    .await
    .map_err(err)?
    .map_err(err)
}

/// Look up a WhatPulse account (the key is used for this request only; never stored).
#[tauri::command]
async fn wp_account_scan(state: State<'_, AppState>, user: String, token: String) -> CmdResult<import::whatpulse_api::AccountScan> {
    let s = state.0.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let ours = db::open(&s.db_path)?;
        import::whatpulse_api::scan(&ours, &user, &token)
    })
    .await
    .map_err(err)?
    .map_err(err)
}

#[tauri::command]
async fn wp_account_import(
    app: AppHandle,
    state: State<'_, AppState>,
    user: String,
    token: String,
    choices: Vec<import::whatpulse_api::Choice>,
) -> CmdResult<Vec<import::Stat>> {
    let s = state.0.clone();
    tauri::async_runtime::spawn_blocking(move || {
        run_import_job(&app, &s, import::whatpulse_api::KIND, |ctx| {
            ctx.report("Backing up Katsudō first", 0, 1)?;
            backup::run(&s.db_path, &s.data_dir, "pre-import")?;
            let mut conn = db::open(&s.db_path)?;
            conn.busy_timeout(std::time::Duration::from_secs(30))?;
            let summary = import::whatpulse_api::import(&mut conn, ctx, &user, &token, &choices)?;
            let _ = conn.execute_batch("PRAGMA wal_checkpoint(TRUNCATE);");
            Ok(summary)
        }, || {})
    })
    .await
    .map_err(err)?
    .map_err(err)
}

#[tauri::command]
fn import_cancel(state: State<AppState>) {
    state.0.import_cancel.store(true, Ordering::SeqCst);
}

// ---- backups -------------------------------------------------------------------

#[tauri::command]
fn list_backups(state: State<AppState>) -> Vec<backup::BackupInfo> {
    backup::list(&state.0.data_dir)
}

#[tauri::command]
async fn backup_now(state: State<'_, AppState>) -> CmdResult<backup::BackupInfo> {
    let s = state.0.clone();
    tauri::async_runtime::spawn_blocking(move || backup::run(&s.db_path, &s.data_dir, "manual"))
        .await
        .map_err(err)?
        .map_err(err)
}

#[tauri::command]
async fn restore_backup(state: State<'_, AppState>, file: String) -> CmdResult<()> {
    let s = state.0.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let mut conn = s.write.lock().map_err(|e| anyhow::anyhow!(e.to_string()))?;
        backup::restore(&mut conn, &s.db_path, &s.data_dir, &file)
    })
    .await
    .map_err(err)?
    .map_err(err)
}

// ---- app -----------------------------------------------------------------------

/// Quit after the tracker has written everything (at most ~3 s). Used by the tray's Quit and
/// by `katsudo.exe --quit`, which the installer sends before replacing the app.
fn graceful_exit(app: &AppHandle) {
    let state = app.state::<AppState>();
    let control = state.0.control.clone();
    control.quit.store(true, Ordering::SeqCst);
    let app = app.clone();
    std::thread::spawn(move || {
        for _ in 0..60 {
            if control.flushed.load(Ordering::SeqCst) {
                break;
            }
            std::thread::sleep(std::time::Duration::from_millis(50));
        }
        app.exit(0);
    });
}

/// The installer asks the copy running from a given katsudo.exe to save and quit by signalling
/// a named event derived from that path (the same FNV-1a hash in installer/src-tauri).
fn quit_event_name(exe: &std::path::Path) -> String {
    let mut h: u64 = 0xcbf2_9ce4_8422_2325;
    for b in exe.to_string_lossy().to_lowercase().bytes() {
        h = (h ^ b as u64).wrapping_mul(0x0100_0000_01b3);
    }
    format!("Local\\KatsudoQuit-{h:016x}")
}

#[cfg(windows)]
fn listen_for_quit(app: AppHandle) {
    use windows::core::HSTRING;
    use windows::Win32::System::Threading::{CreateEventW, WaitForSingleObject, INFINITE};
    let Ok(exe) = std::env::current_exe() else { return };
    let name = HSTRING::from(quit_event_name(&exe));
    std::thread::spawn(move || unsafe {
        if let Ok(event) = CreateEventW(None, true, false, &name) {
            WaitForSingleObject(event, INFINITE);
            graceful_exit(&app);
        }
    });
}

#[cfg(not(windows))]
fn listen_for_quit(_app: AppHandle) {}

/// First-run choices the installer leaves in HKCU\Software\Katsudo.
fn installer_choices() -> (Option<bool>, Option<String>) {
    #[cfg(windows)]
    {
        use winreg::{enums::HKEY_CURRENT_USER, RegKey};
        if let Ok(key) = RegKey::predef(HKEY_CURRENT_USER).open_subkey("Software\\Katsudo") {
            let autostart = key.get_value::<u32, _>("InstallerAutostart").ok().map(|v| v != 0);
            let theme = key.get_value::<String, _>("InitialTheme").ok().filter(|t| !t.is_empty());
            return (autostart, theme);
        }
    }
    (None, None)
}

fn show_main(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.show();
        let _ = w.unminimize();
        let _ = w.set_focus();
    }
}

/// `katsudo import <manictime|whatpulse> <source path> <katsudo.db>`: a headless import,
/// for scripting and for testing importers against real data without the UI.
/// `katsudo wp-account <user> <katsudo.db>`: the WhatPulse account import without the window,
/// with each computer in its suggested role. The key comes from KATSUDO_WP_TOKEN, never argv.
fn cli_wp_account(args: &[String]) -> anyhow::Result<()> {
    let [user, db_file] = args else {
        return Err(anyhow::anyhow!("usage: KATSUDO_WP_TOKEN=... katsudo wp-account <user> <katsudo.db>"));
    };
    let token = std::env::var("KATSUDO_WP_TOKEN").map_err(|_| anyhow::anyhow!("set KATSUDO_WP_TOKEN"))?;
    let mut conn = db::open(&PathBuf::from(db_file))?;
    db::migrate(&conn)?;
    let scan = import::whatpulse_api::scan(&conn, user, &token)?;
    let choices: Vec<_> = scan
        .computers
        .iter()
        .map(|c| import::whatpulse_api::Choice { computer_id: c.id, name: c.name.clone(), role: c.suggested.clone() })
        .collect();
    let cancel = AtomicBool::new(false);
    let progress = |_: import::Progress| {};
    let ctx = import::Ctx { kind: import::whatpulse_api::KIND, cancel: &cancel, progress: &progress };
    let summary = import::whatpulse_api::import(&mut conn, &ctx, user, &token, &choices)?;
    for s in summary {
        println!("{}: {}", s.label, s.value);
    }
    Ok(())
}

fn cli_import(args: &[String]) -> anyhow::Result<()> {
    let [kind, src, db_file] = args else {
        return Err(anyhow::anyhow!("usage: katsudo import <manictime|whatpulse> <source path> <katsudo.db>"));
    };
    let started = std::time::Instant::now();
    let db_path = PathBuf::from(db_file);
    let tmp = db_path.parent().unwrap_or(std::path::Path::new(".")).join("tmp");
    let mut conn = db::open(&db_path)?;
    db::migrate(&conn)?;
    let file = resolve_import_path(kind, src);
    let (source, copy) = import::open_source(&file, &tmp)?;
    println!("opened {} ({}) in {:?}", file.display(), if copy.is_some() { "copy" } else { "read-only" }, started.elapsed());
    let shown = file.to_string_lossy().into_owned();
    let scan = match kind.as_str() {
        import::manictime::KIND => import::manictime::scan(&source, &conn, &shown)?,
        _ => import::whatpulse::scan(&source, &conn, &shown)?,
    };
    println!("scan: {} days {:?}..{:?} overlap {} in {:?}", scan.days, scan.first_day, scan.last_day, scan.overlap_days, started.elapsed());
    for s in &scan.stats {
        println!("  {}: {}", s.label, s.value);
    }
    for n in &scan.notes {
        println!("  note: {n}");
    }
    let cancel = AtomicBool::new(false);
    let last = Mutex::new(String::new());
    let progress = |p: import::Progress| {
        let mut l = last.lock().unwrap();
        if *l != p.phase || p.done % 500_000 == 0 {
            println!("  [{:?}] {} {}/{}", started.elapsed(), p.phase, p.done, p.total);
            *l = p.phase.clone();
        }
    };
    let ctx = import::Ctx { kind, cancel: &cancel, progress: &progress };
    let tx = conn.transaction_with_behavior(TransactionBehavior::Immediate)?;
    let summary = match kind.as_str() {
        import::manictime::KIND => import::manictime::import(&source, &tx, &ctx, &shown)?,
        _ => import::whatpulse::import(&source, &tx, &ctx, &shown)?,
    };
    tx.commit()?;
    if let Some(dir) = copy {
        drop(source);
        let _ = std::fs::remove_dir_all(dir);
    }
    println!("imported in {:?}", started.elapsed());
    for s in summary {
        println!("  {}: {}", s.label, s.value);
    }
    Ok(())
}

fn main() {
    let args: Vec<String> = std::env::args().collect();
    if let (Some("bench"), Some(db_file), Some(day)) = (args.get(1).map(String::as_str), args.get(2), args.get(3)) {
        // `katsudo bench <katsudo.db> <day>`: time the UI's queries on a real database.
        let conn = db::open(std::path::Path::new(db_file)).expect("open");
        let t = std::time::Instant::now();
        let v = queries::day(&conn, day, &[]).expect("day");
        println!("day {day}: {:?}, active {}s, {} app segs, {} apps", t.elapsed(), v.totals.active_secs, v.apps_lane.len(), v.apps.len());
        for (from, label) in [(db::shift_day(day, -6).unwrap(), "week"), (db::shift_day(day, -364).unwrap(), "year"), ("2019-01-01".into(), "all")] {
            let t = std::time::Instant::now();
            let r = queries::range(&conn, &from, day, &[]).expect("range");
            let keys: i64 = r.days.iter().map(|d| d.totals.keys).sum();
            println!("range {label}: {:?}, {} days, {} apps, {keys} keys, top {:?}", t.elapsed(), r.days.len(), r.apps.len(), r.apps.first().map(|a| (&a.name, a.seconds)));
            let t = std::time::Instant::now();
            let k = queries::key_counts(&conn, &from, day).expect("keys");
            println!("keys {label}: {:?}, {} distinct, space {:?}", t.elapsed(), k.len(), k.get("space"));
        }
        return;
    }
    if args.get(1).map(String::as_str) == Some("tagtest") {
        // `katsudo tagtest <db>`: a few rules, a full re-tag of all history, timed.
        let Some(db_file) = args.get(2) else { std::process::exit(2) };
        let path = PathBuf::from(db_file);
        let conn = db::open(&path).expect("open");
        db::migrate(&conn).expect("migrate");
        let t = |name: &str, color: &str| tags::Tag { id: 0, name: name.into(), color: color.into() };
        let r = |field: &str, op: &str, value: &str, tag_id: i64| tags::Rule { field: field.into(), op: op.into(), value: value.into(), tag_id };
        tags::save(&conn, &[t("Work", "amber"), t("Gaming", "rose"), t("Browsing", "sky")],
            &[r("title", "contains", "github.com", -1), r("app", "contains", "code", -1), r("app", "is", "osu!", -2), r("app", "contains", "brave", -3), r("app", "contains", "chrome", -3)]).expect("save");
        let write = Mutex::new(conn);
        let started = std::time::Instant::now();
        tags::refresh(&path, &write).expect("refresh");
        println!("full re-tag in {:?}", started.elapsed());
        let conn = write.lock().unwrap();
        let rep = tags::report(&conn, "2000-01-01", "2030-12-31").expect("report");
        for (tag, secs) in &rep.totals { println!("tag {tag}: {:.0} h", *secs as f64 / 3600.0); }
        let started = std::time::Instant::now();
        drop(conn);
        tags::refresh(&path, &write).expect("refresh");
        println!("catch-up with nothing new in {:?}", started.elapsed());
        return;
    }
    if args.get(1).map(String::as_str) == Some("flowtest") {
        // `katsudo flowtest <db> [from to]`: rebuild every flow session, timed, then a report.
        let Some(db_file) = args.get(2) else { std::process::exit(2) };
        let path = PathBuf::from(db_file);
        let conn = db::open(&path).expect("open");
        db::migrate(&conn).expect("migrate");
        conn.execute("DELETE FROM meta WHERE key = 'flow_rollup_key'", []).expect("reset");
        let write = Mutex::new(conn);
        tags::refresh(&path, &write).expect("tags");
        let started = std::time::Instant::now();
        flow::refresh(&path, &write).expect("refresh");
        println!("full flow rebuild in {:?}", started.elapsed());
        let conn = write.lock().unwrap();
        let (from, to) = (args.get(3).map_or("2000-01-01", |s| s.as_str()), args.get(4).map_or("2030-12-31", |s| s.as_str()));
        let rep = flow::report(&conn, from, to).expect("report");
        println!("{} sessions, {:.1} h in flow of {:.1} h active, min {} min", rep.count, rep.total as f64 / 3600.0, rep.active as f64 / 3600.0, rep.minutes);
        for t in &rep.tasks { println!("  task {} {}: {:.1} h in {} sessions", t.task, t.label, t.secs as f64 / 3600.0, t.sessions); }
        for l in &rep.longest { println!("  longest {} min: {} ({}), {} breaks", (l.session.end - l.session.start) / 60, l.label, l.app, l.session.breaks); }
        let hours: Vec<i64> = (0..24).map(|h| rep.week_hours.iter().map(|d| d[h]).sum::<i64>() / 3600).collect();
        println!("  hours of day: {hours:?}");
        drop(conn);
        let started = std::time::Instant::now();
        flow::refresh(&path, &write).expect("refresh");
        println!("catch-up with nothing new in {:?}", started.elapsed());
        return;
    }
    if args.get(1).map(String::as_str) == Some("wrapped") {
        // `katsudo wrapped <db> <year>`: the year in review as JSON, timed.
        let (Some(db_file), Some(year)) = (args.get(2), args.get(3).and_then(|y| y.parse().ok())) else {
            eprintln!("usage: katsudo wrapped <katsudo.db> <year>");
            std::process::exit(2);
        };
        let path = PathBuf::from(db_file);
        let conn = db::open(&path).expect("open");
        db::migrate(&conn).expect("migrate");
        rhythm::load_marks(&conn);
        let write = Mutex::new(conn);
        search::refresh(&path, &write).expect("refresh");
        let t = std::time::Instant::now();
        let w = wrapped::year(&write.lock().unwrap(), year).expect("wrapped");
        let mut v = serde_json::to_value(&w).unwrap();
        v["keys"] = serde_json::json!(w.keys.len());
        println!("computed in {:?}\n{}", t.elapsed(), serde_json::to_string_pretty(&v).unwrap());
        return;
    }
    if args.get(1).map(String::as_str) == Some("search") {
        // `katsudo search <db> <words…>`: build or catch up the rollup, then search, timed.
        let Some(db_file) = args.get(2) else {
            eprintln!("usage: katsudo search <katsudo.db> <words>");
            std::process::exit(2);
        };
        let path = PathBuf::from(db_file);
        let conn = db::open(&path).expect("open");
        db::migrate(&conn).expect("migrate");
        let write = Mutex::new(conn);
        let t = std::time::Instant::now();
        search::refresh(&path, &write).expect("refresh");
        println!("rollup up to date in {:?}", t.elapsed());
        let q = args[3..].join(" ");
        let conn = write.lock().unwrap();
        let t = std::time::Instant::now();
        let r = search::search(&conn, &q).expect("search");
        println!("search {q:?}: {} hits in {:?}", r.hits.len(), t.elapsed());
        for h in &r.hits {
            println!("  {:5} {:>8.1} h  {} days  {:?}..{:?}  {}{}", h.kind, h.secs as f64 / 3600.0, h.days, h.first, h.last, h.name,
                h.app.as_ref().map(|a| format!("  [{a}]")).unwrap_or_default());
        }
        if let Some(h) = r.hits.first() {
            let t = std::time::Instant::now();
            let d = search::detail(&conn, h.kind, h.id).expect("detail");
            println!("detail in {:?}: busiest {:?}, years {:?}", t.elapsed(), &d.busiest[..d.busiest.len().min(3)], d.years);
        }
        return;
    }
    if args.get(1).map(String::as_str) == Some("rhythmtest") {
        // `katsudo rhythmtest <db>`: play a synthetic chart into a session and print it.
        let Some(db_file) = args.get(2) else {
            eprintln!("usage: katsudo rhythmtest <katsudo.db>");
            std::process::exit(2);
        };
        let conn = db::open(std::path::Path::new(db_file)).expect("open");
        db::migrate(&conn).expect("migrate");
        let app = db::upsert_app(&conn, "osu!.exe", "osu!", None).expect("app");
        let write = Arc::new(Mutex::new(conn));
        hooks::start_kps_sampler();
        rhythm::start(write.clone());
        rhythm::IN_GAME.store(app, Ordering::SeqCst);
        for (rate, secs) in [(6u64, 5u64), (14, 8), (25, 6), (4, 4)] {
            let gap = std::time::Duration::from_micros(1_000_000 / rate);
            let started = std::time::Instant::now();
            let mut next = started;
            while started.elapsed().as_secs() < secs {
                hooks::selftest(1);
                next += gap;
                std::thread::sleep(next.saturating_duration_since(std::time::Instant::now()));
            }
            println!("played {rate} keys/s for {secs} s; live {:?}", rhythm::current().map(|l| (l.keys, l.peak_kps, l.stream, l.best_stream)));
        }
        rhythm::IN_GAME.store(0, Ordering::SeqCst);
        std::thread::sleep(std::time::Duration::from_secs(4));
        let conn = write.lock().unwrap();
        for s in rhythm::overview(&conn).expect("overview").sessions {
            println!(
                "session {} {}: {:.0} s, {} keys, peak {} kps, best stream {} s, {} streams",
                s.id, s.app, s.end - s.start, s.keys, s.peak_kps, s.best_stream, s.streams
            );
        }
        return;
    }
    if args.get(1).map(String::as_str) == Some("selftest") {
        // `katsudo selftest`: the input counter under rhythm-game and flat-out load.
        println!("{}", hooks::selftest(1_000_000));
        hooks::start_kps_sampler();
        for (rate, secs) in [(60u64, 3u64), (250, 2), (1000, 2)] {
            hooks::PEAK_KPS.store(0, Ordering::SeqCst);
            let gap = std::time::Duration::from_micros(1_000_000 / rate);
            let started = std::time::Instant::now();
            let mut next = started;
            let mut sent = 0u64;
            while started.elapsed().as_secs() < secs {
                hooks::selftest(1);
                sent += 1;
                next += gap;
                while std::time::Instant::now() < next {
                    std::hint::spin_loop();
                }
            }
            std::thread::sleep(std::time::Duration::from_millis(50));
            println!(
                "steady {rate} keys/s for {secs} s: sent {sent}, live keys/s peak {} (window = 1 s, sampled every 20 ms)",
                hooks::PEAK_KPS.load(Ordering::SeqCst)
            );
        }
        return;
    }
    if args.get(1).map(String::as_str) == Some("wp-account") {
        if let Err(e) = cli_wp_account(&args[2..]) {
            eprintln!("katsudo: {e}");
            std::process::exit(1);
        }
        return;
    }
    if args.get(1).map(String::as_str) == Some("import") {
        if let Err(e) = cli_import(&args[2..]) {
            eprintln!("katsudo: {e}");
            std::process::exit(1);
        }
        return;
    }
    // A portable/test copy keeps its WebView2 profile in its own folder too; two processes
    // can't share one profile, so otherwise it would fail beside an installed copy.
    if let Some(dir) = std::env::var_os("KATSUDO_DATA_DIR") {
        if std::env::var_os("WEBVIEW2_USER_DATA_FOLDER").is_none() {
            std::env::set_var("WEBVIEW2_USER_DATA_FOLDER", PathBuf::from(dir).join("webview"));
        }
    }
    let mut builder = tauri::Builder::default();
    // One copy per database: a second launch (or a second autostart) focuses the running
    // copy instead of starting another tracker on the same file. A copy pointed at its own
    // folder with KATSUDO_DATA_DIR (portable or test use) runs on its own. Must come first.
    if std::env::var_os("KATSUDO_DATA_DIR").is_none() {
        builder = builder.plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
            if args.iter().any(|a| a == "--quit") {
                graceful_exit(app);
            } else {
                show_main(app);
            }
        }));
    }
    builder
        .plugin(tauri_plugin_autostart::init(MacosLauncher::LaunchAgent, Some(vec![MINIMIZED_ARG])))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            // `--quit` reaches a running copy through the single-instance plugin; if this is the
            // only copy, there is nothing to quit.
            if std::env::args().any(|a| a == "--quit") {
                std::process::exit(0);
            }
            // KATSUDO_DATA_DIR points the app at another data folder (testing, portable use).
            let data_dir = match std::env::var_os("KATSUDO_DATA_DIR") {
                Some(dir) => PathBuf::from(dir),
                None => app.path().app_data_dir()?,
            };
            std::fs::create_dir_all(&data_dir)?;
            import::cleanup_tmp(&data_dir.join("tmp"));
            let db_path = data_dir.join("katsudo.db");
            let write = db::open(&db_path)?;
            db::migrate(&write)?;
            let read = db::open(&db_path)?;
            let control = Arc::new(tracker::Control::from_settings(&read));
            let write = Arc::new(Mutex::new(write));
            let read = Arc::new(Mutex::new(read));

            default_autostart(app.handle(), &write);
            listen_for_quit(app.handle().clone());
            // The window is created hidden; show it unless we were started at sign-in.
            if !std::env::args().any(|a| a == MINIMIZED_ARG) {
                show_main(app.handle());
            }

            // KATSUDO_DEMO=1 (with KATSUDO_DATA_DIR pointing at scripts/demo-data.py's output) only
            // shows what is there: nothing is recorded, so your own activity never mixes in.
            let demo = std::env::var("KATSUDO_DEMO").is_ok_and(|v| v == "1");
            rhythm::load_marks(&read.lock().unwrap());
            overlay::load(&read.lock().unwrap());
            if !demo {
                hooks::start();
                hooks::start_kps_sampler();
                rhythm::start(write.clone());
                overlay::start();
                tracker::start(write.clone(), control.clone());
                backup::start_scheduler(db_path.clone(), data_dir.clone(), read.clone());
            }

            app.manage(AppState(Arc::new(Inner {
                read,
                write,
                control,
                db_path,
                data_dir,
                import_busy: AtomicBool::new(false),
                import_now: Mutex::new(None),
                import_last: Mutex::new(None),
                import_cancel: AtomicBool::new(false),
                scan_copy: Mutex::new(None),
            })));

            let open = MenuItem::with_id(app, "open", "Open Katsudō", true, None::<&str>)?;
            let pause = MenuItem::with_id(app, "pause", "Pause tracking for 1 hour", true, None::<&str>)?;
            let resume = MenuItem::with_id(app, "resume", "Resume tracking", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&open, &pause, &resume, &quit])?;
            TrayIconBuilder::with_id("main")
                .icon(app.default_window_icon().cloned().expect("window icon"))
                .tooltip("Katsudō: tracking")
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, e| {
                    let state = app.state::<AppState>();
                    match e.id().as_ref() {
                        "open" => show_main(app),
                        "pause" => state.0.control.paused_until.store(db::now_secs() + 3600, Ordering::Relaxed),
                        "resume" => state.0.control.paused_until.store(0, Ordering::Relaxed),
                        "quit" => graceful_exit(app),
                        _ => {}
                    }
                })
                .on_tray_icon_event(|tray, e| {
                    if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = e {
                        show_main(tray.app_handle());
                    }
                })
                .build(app)?;
            Ok(())
        })
        .on_window_event(|window, event| {
            // Closing the window keeps tracking in the tray; Quit is in the tray menu.
            if let WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .invoke_handler(tauri::generate_handler![
            get_day,
            get_range,
            get_days,
            get_keys,
            get_mouse,
            search_prepare,
            get_wrapped,
            get_compare,
            get_tags,
            save_tags,
            tag_report,
            flow_report,
            save_csv,
            save_png,
            search_history,
            search_detail,
            get_overlay,
            set_overlay,
            set_overlay_era,
            get_rhythm,
            get_rhythm_series,
            get_rhythm_live,
            set_rhythm_game,
            get_status,
            get_live,
            set_paused,
            get_settings,
            set_setting,
            get_autostart,
            set_autostart,
            import_detect,
            import_scan,
            import_run,
            import_cancel,
            import_status,
            wp_account_scan,
            wp_account_import,
            list_backups,
            backup_now,
            restore_backup
        ])
        .run(tauri::generate_context!())
        .expect("error while running Katsudō");
}

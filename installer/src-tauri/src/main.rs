#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
//! Katsudō Setup: a per-user installer and uninstaller with an era-styled interface.
//!
//! Install: unpack the embedded app into `%LOCALAPPDATA%\Katsudo`, copy this program beside it
//! as `uninstall.exe`, add shortcuts, register in Apps & Features, and record the first-run
//! choices (start with Windows, the era to keep) in `HKCU\Software\Katsudo` for the app.
//! Uninstall: the same program with `--uninstall`, run from a temporary copy so it can remove
//! its own folder.

use anyhow::Context;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Manager};

static PAYLOAD: &[u8] = include_bytes!(concat!(env!("OUT_DIR"), "/katsudo.exe.deflate"));
const VERSION: &str = env!("KATSUDO_VERSION");
const APP_SIZE: &str = env!("KATSUDO_SIZE");
const APP_EXE: &str = "katsudo.exe";
const UNINSTALL_EXE: &str = "uninstall.exe";
const RUN_VALUE: &str = "Katsudo";

/// KATSUDO_SETUP_TEST=1 sends every registry write under HKCU\Software\KatsudoSetupTest and
/// every shortcut into KATSUDO_SETUP_TEST_DIR, so the full flow can be exercised without
/// touching a real installation.
fn test_mode() -> bool {
    std::env::var("KATSUDO_SETUP_TEST").is_ok_and(|v| v == "1")
}
fn uninstall_key() -> &'static str {
    if test_mode() { r"Software\KatsudoSetupTest\Uninstall" } else { r"Software\Microsoft\Windows\CurrentVersion\Uninstall\Katsudo" }
}
fn app_key() -> &'static str {
    if test_mode() { r"Software\KatsudoSetupTest\App" } else { r"Software\Katsudo" }
}
fn run_key() -> &'static str {
    if test_mode() { r"Software\KatsudoSetupTest\Run" } else { r"Software\Microsoft\Windows\CurrentVersion\Run" }
}
const ERAS: [&str; 5] = ["phosphor", "arcade", "synthwave", "beige", "dark"];

#[derive(Serialize)]
struct Info {
    mode: &'static str,
    version: &'static str,
    era: String,
    dir: String,
    existing_version: Option<String>,
    running: bool,
    size_mb: f64,
}

#[derive(Deserialize)]
struct Options {
    dir: String,
    autostart: bool,
    desktop: bool,
    keep_era: bool,
    era: String,
}

#[derive(Clone, Serialize)]
struct Step {
    pct: f64,
    log: String,
}

struct Launch {
    mode: &'static str,
    era: String,
    dir: PathBuf,
}

fn emit(app: &AppHandle, pct: f64, log: impl Into<String>) {
    let log = log.into();
    write_log(&log);
    let _ = app.emit("setup-step", Step { pct, log });
}

/// Every step and error also goes to %TEMP%\katsudo-setup.log, for when something fails.
fn write_log(line: &str) {
    use std::io::Write;
    if let Ok(mut f) = std::fs::OpenOptions::new().create(true).append(true).open(std::env::temp_dir().join("katsudo-setup.log")) {
        let _ = writeln!(f, "[{}] {line}", std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0));
    }
}

/// An install folder must be a plain absolute path on a drive (the folder picker can hand
/// back virtual locations like "This PC" or a library, which Windows can't create files in).
fn check_dir(dir: &str) -> anyhow::Result<PathBuf> {
    let d = dir.trim().trim_matches('"');
    let p = PathBuf::from(d);
    let bad = d.chars().skip(2).any(|c| matches!(c, '<' | '>' | '"' | '|' | '?' | '*' | ':')) || d.starts_with("::");
    if d.is_empty() || !p.is_absolute() || bad {
        anyhow::bail!("Katsudō can't be installed in \"{d}\". Pick a normal folder on a drive, for example {}.", default_dir().display());
    }
    Ok(p)
}

fn default_dir() -> PathBuf {
    if test_mode() {
        if let Ok(dir) = std::env::var("KATSUDO_SETUP_TEST_DIR") {
            return PathBuf::from(dir).join("Katsudo");
        }
    }
    PathBuf::from(std::env::var("LOCALAPPDATA").unwrap_or_default()).join("Katsudo")
}

// ---- registry ---------------------------------------------------------------------

#[cfg(windows)]
mod reg {
    use winreg::{enums::*, RegKey};
    fn hkcu() -> RegKey {
        RegKey::predef(HKEY_CURRENT_USER)
    }
    pub fn get(path: &str, name: &str) -> Option<String> {
        hkcu().open_subkey(path).ok()?.get_value::<String, _>(name).ok()
    }
    pub fn set_str(path: &str, name: &str, value: &str) -> std::io::Result<()> {
        hkcu().create_subkey(path)?.0.set_value(name, &value)
    }
    pub fn set_u32(path: &str, name: &str, value: u32) -> std::io::Result<()> {
        hkcu().create_subkey(path)?.0.set_value(name, &value)
    }
    pub fn delete_value(path: &str, name: &str) {
        if let Ok(k) = hkcu().open_subkey_with_flags(path, KEY_SET_VALUE) {
            let _ = k.delete_value(name);
        }
    }
    pub fn delete_tree(path: &str) {
        let _ = hkcu().delete_subkey_all(path);
    }
}

// ---- processes ----------------------------------------------------------------------

/// Process ids whose executable is `exe` (case-insensitive).
#[cfg(windows)]
fn running(exe: &Path) -> Vec<u32> {
    use windows::Win32::Foundation::CloseHandle;
    use windows::Win32::System::Diagnostics::ToolHelp::{
        CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, PROCESSENTRY32W, TH32CS_SNAPPROCESS,
    };
    use windows::Win32::System::Threading::{OpenProcess, QueryFullProcessImageNameW, PROCESS_NAME_WIN32, PROCESS_QUERY_LIMITED_INFORMATION};
    let want = exe.to_string_lossy().to_lowercase();
    let mut out = Vec::new();
    unsafe {
        let Ok(snap) = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0) else { return out };
        let mut e = PROCESSENTRY32W { dwSize: std::mem::size_of::<PROCESSENTRY32W>() as u32, ..Default::default() };
        let mut ok = Process32FirstW(snap, &mut e).is_ok();
        while ok {
            let name = String::from_utf16_lossy(&e.szExeFile[..e.szExeFile.iter().position(|&c| c == 0).unwrap_or(0)]);
            if name.eq_ignore_ascii_case(APP_EXE) {
                if let Ok(h) = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, e.th32ProcessID) {
                    let mut buf = [0u16; 1024];
                    let mut len = buf.len() as u32;
                    if QueryFullProcessImageNameW(h, PROCESS_NAME_WIN32, windows::core::PWSTR(buf.as_mut_ptr()), &mut len).is_ok()
                        && String::from_utf16_lossy(&buf[..len as usize]).to_lowercase() == want
                    {
                        out.push(e.th32ProcessID);
                    }
                    let _ = CloseHandle(h);
                }
            }
            ok = Process32NextW(snap, &mut e).is_ok();
        }
        let _ = CloseHandle(snap);
    }
    out
}

#[cfg(windows)]
fn terminate(pid: u32) {
    use windows::Win32::Foundation::CloseHandle;
    use windows::Win32::System::Threading::{OpenProcess, TerminateProcess, PROCESS_TERMINATE};
    unsafe {
        if let Ok(h) = OpenProcess(PROCESS_TERMINATE, false, pid) {
            let _ = TerminateProcess(h, 0);
            let _ = CloseHandle(h);
        }
    }
}

/// Same name as the app's `quit_event_name`: FNV-1a of the lower-cased exe path.
fn quit_event_name(exe: &Path) -> String {
    let mut h: u64 = 0xcbf2_9ce4_8422_2325;
    for b in exe.to_string_lossy().to_lowercase().bytes() {
        h = (h ^ b as u64).wrapping_mul(0x0100_0000_01b3);
    }
    format!("Local\\KatsudoQuit-{h:016x}")
}

/// Signal the running copy's quit event; false if it has none (versions before 0.3).
#[cfg(windows)]
fn signal_quit(exe: &Path) -> bool {
    use windows::core::HSTRING;
    use windows::Win32::Foundation::CloseHandle;
    use windows::Win32::System::Threading::{OpenEventW, SetEvent, EVENT_MODIFY_STATE};
    unsafe {
        match OpenEventW(EVENT_MODIFY_STATE, false, &HSTRING::from(quit_event_name(exe))) {
            Ok(h) => {
                let ok = SetEvent(h).is_ok();
                let _ = CloseHandle(h);
                ok
            }
            Err(_) => false,
        }
    }
}

/// Ask a running Katsudō to save and quit (its quit event, else `--quit` through its
/// single-instance lock); versions that ignore both are stopped after a few seconds.
fn stop_app(app: &AppHandle, dir: &Path, pct: f64) {
    let exe = dir.join(APP_EXE);
    if running(&exe).is_empty() {
        return;
    }
    emit(app, pct, "asking Katsudō to save and close");
    if !signal_quit(&exe) {
        let _ = std::process::Command::new(&exe).arg("--quit").spawn();
    }
    let started = Instant::now();
    while !running(&exe).is_empty() && started.elapsed() < Duration::from_secs(6) {
        std::thread::sleep(Duration::from_millis(150));
    }
    for pid in running(&exe) {
        emit(app, pct, "an older version did not close by itself; stopping it");
        terminate(pid);
    }
    std::thread::sleep(Duration::from_millis(300));
}

// ---- shortcuts ------------------------------------------------------------------------

#[cfg(windows)]
fn known_folder(id: &windows::core::GUID) -> Option<PathBuf> {
    use windows::Win32::UI::Shell::{SHGetKnownFolderPath, KF_FLAG_DEFAULT};
    unsafe {
        let p = SHGetKnownFolderPath(id, KF_FLAG_DEFAULT, None).ok()?;
        let s = p.to_string().ok();
        windows::Win32::System::Com::CoTaskMemFree(Some(p.0 as _));
        s.map(PathBuf::from)
    }
}

fn test_shortcuts(sub: &str) -> Option<PathBuf> {
    let dir = PathBuf::from(std::env::var("KATSUDO_SETUP_TEST_DIR").ok()?).join(sub);
    std::fs::create_dir_all(&dir).ok()?;
    Some(dir)
}

fn programs_dir() -> Option<PathBuf> {
    if test_mode() {
        return test_shortcuts("programs");
    }
    known_folder(&windows::Win32::UI::Shell::FOLDERID_Programs)
}

fn desktop_dir() -> Option<PathBuf> {
    if test_mode() {
        return test_shortcuts("desktop");
    }
    known_folder(&windows::Win32::UI::Shell::FOLDERID_Desktop)
}

#[cfg(windows)]
fn shortcut(lnk: &Path, target: &Path, description: &str) -> anyhow::Result<()> {
    use windows::core::{Interface, HSTRING};
    use windows::Win32::System::Com::{CoCreateInstance, CoInitializeEx, IPersistFile, CLSCTX_INPROC_SERVER, COINIT_APARTMENTTHREADED};
    use windows::Win32::UI::Shell::{IShellLinkW, ShellLink};
    unsafe {
        let _ = CoInitializeEx(None, COINIT_APARTMENTTHREADED);
        let link: IShellLinkW = CoCreateInstance(&ShellLink, None, CLSCTX_INPROC_SERVER)?;
        link.SetPath(&HSTRING::from(target.as_os_str()))?;
        if let Some(dir) = target.parent() {
            link.SetWorkingDirectory(&HSTRING::from(dir.as_os_str()))?;
        }
        link.SetDescription(&HSTRING::from(description))?;
        link.SetIconLocation(&HSTRING::from(target.as_os_str()), 0)?;
        let file: IPersistFile = link.cast()?;
        file.Save(&HSTRING::from(lnk.as_os_str()), true)?;
    }
    Ok(())
}

/// Every shortcut name this or the earlier NSIS installer may have made.
fn shortcut_paths() -> Vec<PathBuf> {
    let mut out = Vec::new();
    for dir in [programs_dir(), desktop_dir()].into_iter().flatten() {
        out.push(dir.join("Katsudō.lnk"));
        out.push(dir.join("Katsudo.lnk"));
    }
    out
}

// ---- commands -----------------------------------------------------------------------

#[tauri::command]
fn info(launch: tauri::State<Launch>) -> Info {
    let existing_dir = reg::get(uninstall_key(), "InstallLocation").map(PathBuf::from);
    let dir = if launch.mode == "uninstall" { launch.dir.clone() } else { existing_dir.unwrap_or_else(default_dir) };
    let installed = dir.join(APP_EXE).is_file();
    Info {
        mode: launch.mode,
        version: VERSION,
        era: launch.era.clone(),
        existing_version: if installed { Some(reg::get(uninstall_key(), "DisplayVersion").unwrap_or_else(|| "an earlier version".into())) } else { None },
        running: !running(&dir.join(APP_EXE)).is_empty(),
        dir: dir.to_string_lossy().into_owned(),
        size_mb: APP_SIZE.parse::<f64>().unwrap_or(0.0) / 1e6,
    }
}

#[tauri::command]
async fn install(app: AppHandle, opts: Options) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        write_log(&format!("install {VERSION} into {:?}", opts.dir));
        do_install(&app, &opts).map_err(|e| {
            let msg = format!("{e:#}");
            write_log(&format!("FAILED: {msg}"));
            msg
        })
    })
        .await
        .map_err(|e| e.to_string())?
}

fn do_install(app: &AppHandle, o: &Options) -> anyhow::Result<()> {
    let dir = check_dir(&o.dir)?;
    emit(app, 0.04, format!("target {}", dir.display()));
    stop_app(app, &dir, 0.08);

    emit(app, 0.15, format!("unpacking katsudo.exe ({:.1} MB)", APP_SIZE.parse::<f64>().unwrap_or(0.0) / 1e6));
    std::fs::create_dir_all(&dir).with_context(|| format!("creating {}", dir.display()))?;
    let exe = dir.join(APP_EXE);
    let bytes = miniz_oxide::inflate::decompress_to_vec(PAYLOAD).map_err(|e| anyhow::anyhow!("the installer is damaged: {e:?}"))?;
    let tmp = dir.join("katsudo.exe.new");
    std::fs::write(&tmp, &bytes).with_context(|| format!("writing {}", tmp.display()))?;
    std::fs::rename(&tmp, &exe).with_context(|| format!("replacing {} (is an old Katsudō still running?)", exe.display()))?;
    emit(app, 0.45, "katsudo.exe written");

    let me = std::env::current_exe()?;
    let uninstaller = dir.join(UNINSTALL_EXE);
    if me != uninstaller {
        std::fs::copy(&me, &uninstaller).with_context(|| format!("writing {}", uninstaller.display()))?;
    }
    emit(app, 0.55, "uninstall.exe written");

    for old in shortcut_paths() {
        let _ = std::fs::remove_file(old);
    }
    if let Some(programs) = programs_dir() {
        shortcut(&programs.join("Katsudō.lnk"), &exe, "Katsudō activity tracker").with_context(|| format!("adding the Start menu shortcut in {}", programs.display()))?;
        emit(app, 0.65, "start menu shortcut added");
    }
    if o.desktop {
        if let Some(desktop) = desktop_dir() {
            shortcut(&desktop.join("Katsudō.lnk"), &exe, "Katsudō activity tracker").with_context(|| format!("adding the desktop shortcut in {}", desktop.display()))?;
            emit(app, 0.7, "desktop shortcut added");
        }
    }

    let quoted = |p: &Path| format!("\"{}\"", p.display());
    reg::set_str(uninstall_key(), "DisplayName", "Katsudō").context("registering Katsudō with Windows")?;
    reg::set_str(uninstall_key(), "DisplayVersion", VERSION).context("registering Katsudō with Windows")?;
    reg::set_str(uninstall_key(), "Publisher", "Katsudō").context("registering Katsudō with Windows")?;
    reg::set_str(uninstall_key(), "DisplayIcon", &exe.to_string_lossy()).context("registering Katsudō with Windows")?;
    reg::set_str(uninstall_key(), "InstallLocation", &dir.to_string_lossy()).context("registering Katsudō with Windows")?;
    reg::set_str(uninstall_key(), "UninstallString", &format!("{} --uninstall", quoted(&uninstaller))).context("registering Katsudō with Windows")?;
    reg::set_str(uninstall_key(), "QuietUninstallString", &format!("{} --uninstall --quiet", quoted(&uninstaller))).context("registering Katsudō with Windows")?;
    reg::set_u32(uninstall_key(), "EstimatedSize", (bytes.len() as u64 / 1024 + 4096) as u32).context("registering Katsudō with Windows")?;
    reg::set_u32(uninstall_key(), "NoModify", 1).context("registering Katsudō with Windows")?;
    reg::set_u32(uninstall_key(), "NoRepair", 1).context("registering Katsudō with Windows")?;
    emit(app, 0.8, "registered in apps & features");

    reg::set_str(app_key(), "InstallDir", &dir.to_string_lossy()).context("registering Katsudō with Windows")?;
    reg::set_str(app_key(), "Version", VERSION).context("registering Katsudō with Windows")?;
    reg::set_u32(app_key(), "InstallerAutostart", o.autostart as u32).context("registering Katsudō with Windows")?;
    if o.keep_era && ERAS.contains(&o.era.as_str()) {
        reg::set_str(app_key(), "InitialTheme", &o.era).context("registering Katsudō with Windows")?;
    } else {
        reg::delete_value(app_key(), "InitialTheme");
    }
    if o.autostart {
        reg::set_str(run_key(), RUN_VALUE, &format!("{} --minimized", quoted(&exe))).context("registering Katsudō with Windows")?;
        emit(app, 0.9, "starts with windows");
    } else {
        reg::delete_value(run_key(), RUN_VALUE);
        emit(app, 0.9, "will not start with windows");
    }
    emit(app, 1.0, "done");
    Ok(())
}

#[tauri::command]
fn launch_app(app: AppHandle, dir: String) {
    let _ = std::process::Command::new(PathBuf::from(dir).join(APP_EXE)).spawn();
    app.exit(0);
}

#[tauri::command]
async fn uninstall(app: AppHandle, remove_data: bool) -> Result<(), String> {
    let dir = app.state::<Launch>().dir.clone();
    tauri::async_runtime::spawn_blocking(move || do_uninstall(&app, &dir, remove_data).map_err(|e| e.to_string()))
        .await
        .map_err(|e| e.to_string())?
}

fn do_uninstall(app: &AppHandle, dir: &Path, remove_data: bool) -> anyhow::Result<()> {
    stop_app(app, dir, 0.1);
    for lnk in shortcut_paths() {
        if std::fs::remove_file(&lnk).is_ok() {
            emit(app, 0.3, format!("removed {}", lnk.file_name().unwrap_or_default().to_string_lossy()));
        }
    }
    reg::delete_value(run_key(), RUN_VALUE);
    if !test_mode() {
        reg::delete_value(r"Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run", RUN_VALUE);
    }
    reg::delete_tree(uninstall_key());
    reg::delete_tree(app_key());
    emit(app, 0.5, "removed from apps & features and sign-in");
    for name in [APP_EXE, UNINSTALL_EXE] {
        let _ = std::fs::remove_file(dir.join(name));
    }
    let _ = std::fs::remove_dir(dir);
    emit(app, 0.7, format!("removed {}", dir.display()));
    if remove_data {
        for base in ["APPDATA", "LOCALAPPDATA"] {
            if let Ok(b) = std::env::var(base) {
                let data = PathBuf::from(b).join("app.katsudo.desktop");
                if data.exists() {
                    std::fs::remove_dir_all(&data)?;
                    emit(app, 0.9, format!("deleted {}", data.display()));
                }
            }
        }
    } else {
        emit(app, 0.9, "kept your database and backups");
    }
    emit(app, 1.0, "done");
    Ok(())
}

#[tauri::command]
fn quit(app: AppHandle) {
    app.exit(0);
}

// ---- start -------------------------------------------------------------------------------

/// The uninstaller can't delete itself while running from the install folder, so it hands
/// over to a copy in %TEMP%, which deletes itself shortly after it exits.
fn relaunch_from_temp(dir: &Path) -> bool {
    let me = match std::env::current_exe() {
        Ok(p) => p,
        Err(_) => return false,
    };
    let temp = std::env::temp_dir().join(format!("katsudo-uninstall-{}.exe", std::process::id()));
    if std::fs::copy(&me, &temp).is_err() {
        return false;
    }
    let mut args: Vec<String> = std::env::args().skip(1).filter(|a| a != "--uninstall").collect();
    args.extend(["--uninstall".into(), "--from-temp".into(), "--dir".into(), dir.to_string_lossy().into_owned()]);
    std::process::Command::new(&temp).args(args).spawn().is_ok()
}

fn schedule_self_delete() {
    #[cfg(windows)]
    if let Ok(me) = std::env::current_exe() {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        // raw_arg: cmd needs these quotes exactly as written, not re-escaped.
        let _ = std::process::Command::new("cmd")
            .raw_arg(format!("/C ping 127.0.0.1 -n 3 > nul & del \"{}\"", me.display()))
            .creation_flags(CREATE_NO_WINDOW)
            .spawn();
    }
}

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let arg_after = |flag: &str| args.iter().position(|a| a == flag).and_then(|i| args.get(i + 1)).cloned();
    let me = std::env::current_exe().unwrap_or_default();
    let named_uninstall = me.file_name().map(|n| n.eq_ignore_ascii_case(UNINSTALL_EXE)).unwrap_or(false);
    let uninstalling = args.iter().any(|a| a == "--uninstall") || named_uninstall;
    let from_temp = args.iter().any(|a| a == "--from-temp");
    let dir = arg_after("--dir").map(PathBuf::from).unwrap_or_else(|| {
        if named_uninstall { me.parent().map(Path::to_path_buf).unwrap_or_else(default_dir) } else { default_dir() }
    });
    if uninstalling && !from_temp && relaunch_from_temp(&dir) {
        return;
    }

    // A random era every run (or --era for a specific one).
    let nanos = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.subsec_nanos()).unwrap_or(0);
    let era = arg_after("--era").filter(|e| ERAS.contains(&e.as_str())).unwrap_or_else(|| ERAS[(nanos as usize / 7) % ERAS.len()].to_string());

    // Keep the setup window's browser profile out of the app's folders.
    if std::env::var_os("WEBVIEW2_USER_DATA_FOLDER").is_none() {
        std::env::set_var("WEBVIEW2_USER_DATA_FOLDER", std::env::temp_dir().join("katsudo-setup-webview"));
    }

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(Launch { mode: if uninstalling { "uninstall" } else { "install" }, era, dir })
        .invoke_handler(tauri::generate_handler![info, install, launch_app, uninstall, quit])
        .build(tauri::generate_context!())
        .expect("error while starting Katsudō Setup")
        .run(move |_app, event| {
            if let tauri::RunEvent::Exit = event {
                if from_temp {
                    schedule_self_delete();
                }
            }
        });
}

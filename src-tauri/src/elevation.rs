//! Running as administrator, by choice. Windows shows an app that isn't elevated no input that
//! goes to an elevated window, so games that run as administrator (many with anti-cheat)
//! count nothing unless Katsudō is elevated too.
//!
//! With the setting on, a copy started without admin rights restarts itself elevated (Windows
//! asks), and "start with Windows" becomes a sign-in task that starts it elevated without
//! asking. The choice lives in HKCU\Software\Katsudo so it is known before the database opens,
//! and so the installer can see it.

#[cfg(windows)]
mod imp {
    use std::path::Path;
    use winreg::{enums::HKEY_CURRENT_USER, RegKey};
    use windows::core::{HSTRING, PCWSTR, PWSTR};
    use windows::Win32::Foundation::{CloseHandle, LocalFree, ERROR_ACCESS_DENIED, HANDLE, HLOCAL, LPARAM, WPARAM};
    use windows::Win32::Security::Authorization::{ConvertSidToStringSidW, ConvertStringSecurityDescriptorToSecurityDescriptorW, SDDL_REVISION_1};
    use windows::Win32::Security::{
        GetTokenInformation, TokenElevation, TokenUser, PSECURITY_DESCRIPTOR, SECURITY_ATTRIBUTES, TOKEN_ELEVATION, TOKEN_QUERY, TOKEN_USER,
    };
    use windows::Win32::System::DataExchange::COPYDATASTRUCT;
    use windows::Win32::System::Threading::{GetCurrentProcess, OpenMutexW, OpenProcessToken, MUTEX_ALL_ACCESS};
    use windows::Win32::UI::Shell::{ShellExecuteExW, SEE_MASK_NOASYNC, SHELLEXECUTEINFOW};
    use windows::Win32::UI::WindowsAndMessaging::{
        AllowSetForegroundWindow, ChangeWindowMessageFilterEx, FindWindowW, GetWindowThreadProcessId, SendMessageTimeoutW,
        MSGFLT_ALLOW, SMTO_NORMAL, SW_SHOWNORMAL, WM_COPYDATA,
    };

    const KEY: &str = r"Software\Katsudo";
    /// The single-instance plugin's names, from the bundle identifier (tauri.conf.json).
    const IDENT: &str = "app.katsudo.desktop";
    /// The plugin's payload tag: cwd and arguments separated by NUL.
    const COPYDATA_NUL: usize = 1543;

    fn key() -> Option<RegKey> {
        RegKey::predef(HKEY_CURRENT_USER).create_subkey(KEY).ok().map(|(k, _)| k)
    }

    /// Whether this process runs with admin rights.
    pub fn is_elevated() -> bool {
        unsafe {
            let mut token = HANDLE::default();
            if OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &mut token).is_err() {
                return false;
            }
            let mut e = TOKEN_ELEVATION::default();
            let mut len = 0u32;
            let ok = GetTokenInformation(token, TokenElevation, Some(&mut e as *mut _ as _), std::mem::size_of::<TOKEN_ELEVATION>() as u32, &mut len).is_ok();
            let _ = CloseHandle(token);
            ok && e.TokenIsElevated != 0
        }
    }

    /// The "run as administrator" setting.
    pub fn wanted() -> bool {
        key().and_then(|k| k.get_value::<u32, _>("RunAsAdmin").ok()).is_some_and(|v| v != 0)
    }

    pub fn set_wanted(on: bool) {
        if let Some(k) = key() {
            let _ = if on { k.set_value("RunAsAdmin", &1u32) } else { k.delete_value("RunAsAdmin") };
        }
    }

    pub enum Instance {
        None,
        /// Running, and this process can reach its lock: the single-instance plugin handles it.
        Reachable,
        /// Running, but this process may not open its lock (an elevated copy's can refuse):
        /// the plugin would wrongly start a second tracker, so the request is passed on by hand.
        Elevated,
    }

    /// Whether another copy is running, asking for the same access the plugin's lock needs.
    pub fn instance() -> Instance {
        unsafe {
            match OpenMutexW(MUTEX_ALL_ACCESS, false, &HSTRING::from(format!("{IDENT}-sim"))) {
                Ok(h) => {
                    let _ = CloseHandle(h);
                    Instance::Reachable
                }
                Err(e) if e.code() == ERROR_ACCESS_DENIED.to_hresult() => Instance::Elevated,
                Err(_) => Instance::None,
            }
        }
    }

    fn instance_window() -> Option<windows::Win32::Foundation::HWND> {
        unsafe {
            let w = FindWindowW(&HSTRING::from(format!("{IDENT}-sic")), &HSTRING::from(format!("{IDENT}-siw"))).ok()?;
            (!w.0.is_null()).then_some(w)
        }
    }

    /// In an elevated copy: let copies started without admin rights hand it their arguments
    /// (opening the window, `--quit` from the installer). Windows blocks that message by default.
    pub fn allow_forwarding() {
        if let Some(w) = instance_window() {
            unsafe {
                let _ = ChangeWindowMessageFilterEx(w, WM_COPYDATA, MSGFLT_ALLOW, None);
            }
        }
    }

    /// Pass this launch's arguments to the elevated copy, as the plugin would.
    pub fn forward() {
        let Some(w) = instance_window() else { return };
        let mut data = std::env::current_dir().unwrap_or_default().to_string_lossy().into_owned();
        for arg in std::env::args_os() {
            data.push('\0');
            data.push_str(&arg.to_string_lossy());
        }
        let cds = COPYDATASTRUCT { dwData: COPYDATA_NUL, cbData: data.len() as u32, lpData: data.as_ptr() as _ };
        unsafe {
            let mut pid = 0u32;
            GetWindowThreadProcessId(w, Some(&mut pid));
            if pid != 0 {
                let _ = AllowSetForegroundWindow(pid);
            }
            SendMessageTimeoutW(w, WM_COPYDATA, WPARAM(0), LPARAM(&cds as *const _ as isize), SMTO_NORMAL, 10_000, None);
        }
    }

    /// Mark that this copy is about to hand over to another, which then waits for it to go.
    pub fn begin_handoff() {
        if let Some(k) = key() {
            let _ = k.set_value("Handoff", &(crate::db::now_secs() as u64));
        }
    }

    pub fn cancel_handoff() {
        if let Some(k) = key() {
            let _ = k.delete_value("Handoff");
        }
    }

    /// The copy taking over waits (up to 10 s) for the one that started it to save and quit.
    pub fn wait_for_handoff() {
        let Some(k) = key() else { return };
        let Ok(at) = k.get_value::<u64, _>("Handoff") else { return };
        let _ = k.delete_value("Handoff");
        if (crate::db::now_secs() as u64).saturating_sub(at) > 60 {
            return;
        }
        let started = std::time::Instant::now();
        while !matches!(instance(), Instance::None) && started.elapsed().as_secs() < 10 {
            std::thread::sleep(std::time::Duration::from_millis(100));
        }
    }

    /// Start this exe elevated. False if Windows refused or you said no.
    pub fn relaunch_elevated(args: &str) -> bool {
        let Ok(exe) = std::env::current_exe() else { return false };
        let (exe, args) = (HSTRING::from(exe.as_os_str()), HSTRING::from(args));
        let mut info = SHELLEXECUTEINFOW {
            cbSize: std::mem::size_of::<SHELLEXECUTEINFOW>() as u32,
            fMask: SEE_MASK_NOASYNC,
            lpVerb: windows::core::w!("runas"),
            lpFile: PCWSTR(exe.as_ptr()),
            lpParameters: PCWSTR(args.as_ptr()),
            nShow: SW_SHOWNORMAL.0,
            ..Default::default()
        };
        unsafe { ShellExecuteExW(&mut info).is_ok() }
    }

    /// Open a file or link through Explorer, which runs without admin rights, so nothing an
    /// elevated copy opens (a browser, most of all) inherits them.
    pub fn open_unelevated(target: &str) -> bool {
        let explorer = std::env::var_os("WINDIR").map(|w| Path::new(&w).join("explorer.exe")).unwrap_or_else(|| "explorer.exe".into());
        std::process::Command::new(explorer).arg(target).spawn().is_ok()
    }

    fn user_sid() -> Option<String> {
        unsafe {
            let mut token = HANDLE::default();
            OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &mut token).ok()?;
            let mut buf = vec![0u8; 256];
            let mut len = 0u32;
            let ok = GetTokenInformation(token, TokenUser, Some(buf.as_mut_ptr() as _), buf.len() as u32, &mut len).is_ok();
            let _ = CloseHandle(token);
            if !ok {
                return None;
            }
            let user = &*(buf.as_ptr() as *const TOKEN_USER);
            let mut s = PWSTR::null();
            ConvertSidToStringSidW(user.User.Sid, &mut s).ok()?;
            let out = s.to_string().ok();
            let _ = LocalFree(HLOCAL(s.0 as _));
            out
        }
    }

    /// One sign-in task per Windows account (tasks are machine-wide).
    fn task_name() -> Option<String> {
        user_sid().map(|sid| format!("Katsudo-{sid}"))
    }

    fn schtasks(args: &[&str]) -> bool {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        std::process::Command::new("schtasks")
            .args(args)
            .creation_flags(CREATE_NO_WINDOW)
            .output()
            .is_ok_and(|o| o.status.success())
    }

    pub fn task_exists() -> bool {
        task_name().is_some_and(|n| schtasks(&["/Query", "/TN", &n]))
    }

    /// The sign-in task: starts this exe in the tray, elevated, without asking. Needs admin.
    pub fn create_task(exe: &Path) -> Result<(), String> {
        let sid = user_sid().ok_or("couldn't read your Windows account")?;
        let name = format!("Katsudo-{sid}");
        let esc = |s: &str| s.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;");
        let xml = format!(
            r#"<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <RegistrationInfo><Description>Starts Katsudō as administrator when you sign in, so input in games that run as administrator is counted.</Description></RegistrationInfo>
  <Triggers><LogonTrigger><Enabled>true</Enabled><UserId>{sid}</UserId></LogonTrigger></Triggers>
  <Principals><Principal id="Author"><UserId>{sid}</UserId><LogonType>InteractiveToken</LogonType><RunLevel>HighestAvailable</RunLevel></Principal></Principals>
  <Settings>
    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>
    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>
    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>
    <ExecutionTimeLimit>PT0S</ExecutionTimeLimit>
    <Priority>4</Priority>
  </Settings>
  <Actions Context="Author"><Exec><Command>{}</Command><Arguments>{}</Arguments></Exec></Actions>
</Task>"#,
            esc(&exe.to_string_lossy()),
            crate::MINIMIZED_ARG
        );
        // UTF-16 with a byte-order mark, so any path or account name survives.
        let file = std::env::temp_dir().join(format!("katsudo-task-{}.xml", std::process::id()));
        let bytes: Vec<u8> = [0xFEFFu16].into_iter().chain(xml.encode_utf16()).flat_map(u16::to_le_bytes).collect();
        std::fs::write(&file, bytes).map_err(|e| e.to_string())?;
        let ok = schtasks(&["/Create", "/TN", &name, "/XML", &file.to_string_lossy(), "/F"]);
        let _ = std::fs::remove_file(&file);
        if !ok {
            return Err("Windows didn't accept the sign-in task.".into());
        }
        // The uninstaller removes it by this name.
        if let Some(k) = key() {
            let _ = k.set_value("AdminTask", &name);
        }
        Ok(())
    }

    pub fn delete_task() -> bool {
        let Some(name) = task_name() else { return false };
        let ok = schtasks(&["/Delete", "/TN", &name, "/F"]);
        if ok {
            if let Some(k) = key() {
                let _ = k.delete_value("AdminTask");
            }
        }
        ok
    }

    /// For the installer's quit event when this copy is elevated: the installer, which runs
    /// without admin rights, may signal it (and do nothing else), which Windows otherwise blocks.
    pub fn quit_event_attributes() -> Option<SECURITY_ATTRIBUTES> {
        if !is_elevated() {
            return None;
        }
        // SYSTEM and admins: all; signed-in users: signal and wait; medium integrity may signal.
        let sddl = windows::core::w!("D:(A;;GA;;;SY)(A;;GA;;;BA)(A;;0x00100002;;;IU)S:(ML;;NW;;;ME)");
        let mut sd = PSECURITY_DESCRIPTOR::default();
        unsafe { ConvertStringSecurityDescriptorToSecurityDescriptorW(sddl, SDDL_REVISION_1, &mut sd, None).ok()? };
        // Kept for the life of the process, like the event.
        Some(SECURITY_ATTRIBUTES { nLength: std::mem::size_of::<SECURITY_ATTRIBUTES>() as u32, lpSecurityDescriptor: sd.0, bInheritHandle: false.into() })
    }
}

#[cfg(windows)]
pub use imp::*;

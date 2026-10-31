//! Thin wrappers over the Win32 calls the tracker needs.

#[derive(Debug, Clone, PartialEq)]
pub struct Foreground {
    pub exe_path: String,
    pub title: String,
}

/// One monitor, in virtual-desktop pixels (the same coordinates the mouse hook reports).
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct Screen {
    pub x: i32,
    pub y: i32,
    pub w: i32,
    pub h: i32,
    pub primary: bool,
}

#[cfg(windows)]
mod imp {
    use super::{Foreground, Screen};
    use windows::Win32::Foundation::{BOOL, LPARAM, RECT};
    use windows::Win32::Graphics::Gdi::{EnumDisplayMonitors, GetMonitorInfoW, HDC, HMONITOR, MONITORINFO};

    /// The monitors as they are arranged now, in physical pixels like the mouse hook's
    /// coordinates, whatever the calling thread's DPI awareness (the command line has none).
    pub fn screens() -> Vec<Screen> {
        use windows::Win32::UI::HiDpi::{SetThreadDpiAwarenessContext, DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2};
        unsafe extern "system" fn each(m: HMONITOR, _: HDC, _: *mut RECT, data: LPARAM) -> BOOL {
            let out = &mut *(data.0 as *mut Vec<Screen>);
            let mut info = MONITORINFO { cbSize: std::mem::size_of::<MONITORINFO>() as u32, ..Default::default() };
            if GetMonitorInfoW(m, &mut info).as_bool() {
                let r = info.rcMonitor;
                out.push(Screen { x: r.left, y: r.top, w: r.right - r.left, h: r.bottom - r.top, primary: info.dwFlags & 1 != 0 });
            }
            BOOL(1)
        }
        let mut out: Vec<Screen> = Vec::new();
        unsafe {
            let before = SetThreadDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2);
            let _ = EnumDisplayMonitors(HDC::default(), None, Some(each), LPARAM(&mut out as *mut Vec<Screen> as isize));
            if !before.0.is_null() {
                SetThreadDpiAwarenessContext(before);
            }
        }
        out
    }
    use windows::core::{HSTRING, PCWSTR, PWSTR};
    use windows::Win32::Foundation::CloseHandle;
    use windows::Win32::NetworkManagement::IpHelper::{FreeMibTable, GetIfTable2, MIB_IF_TABLE2};
    use windows::Win32::Storage::FileSystem::{GetFileVersionInfoSizeW, GetFileVersionInfoW, VerQueryValueW};
    use windows::Win32::System::SystemInformation::GetTickCount;
    use windows::Win32::System::Threading::{
        OpenProcess, QueryFullProcessImageNameW, PROCESS_NAME_WIN32, PROCESS_QUERY_LIMITED_INFORMATION,
    };
    use windows::Win32::UI::Input::KeyboardAndMouse::{GetLastInputInfo, LASTINPUTINFO};
    use windows::Win32::UI::WindowsAndMessaging::{GetForegroundWindow, GetWindowTextW, GetWindowThreadProcessId};

    pub fn foreground() -> Option<Foreground> {
        unsafe {
            let hwnd = GetForegroundWindow();
            if hwnd.0.is_null() {
                return None;
            }
            let mut buf = [0u16; 512];
            let n = GetWindowTextW(hwnd, &mut buf);
            let title = String::from_utf16_lossy(&buf[..n.max(0) as usize]);
            let mut pid = 0u32;
            GetWindowThreadProcessId(hwnd, Some(&mut pid));
            if pid == 0 {
                return None;
            }
            let process = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid).ok()?;
            let mut path = [0u16; 1024];
            let mut len = path.len() as u32;
            let ok = QueryFullProcessImageNameW(process, PROCESS_NAME_WIN32, PWSTR(path.as_mut_ptr()), &mut len);
            let _ = CloseHandle(process);
            ok.ok()?;
            Some(Foreground { exe_path: String::from_utf16_lossy(&path[..len as usize]), title })
        }
    }

    /// Windows' own answer to "is now a bad time for a notification": a fullscreen app or game,
    /// or presentation mode.
    pub fn fullscreen_busy() -> bool {
        use windows::Win32::UI::Shell::{SHQueryUserNotificationState, QUNS_BUSY, QUNS_PRESENTATION_MODE, QUNS_RUNNING_D3D_FULL_SCREEN};
        unsafe { SHQueryUserNotificationState().is_ok_and(|s| s == QUNS_BUSY || s == QUNS_RUNNING_D3D_FULL_SCREEN || s == QUNS_PRESENTATION_MODE) }
    }

    /// When Windows last started (Unix seconds): now minus the milliseconds since boot, which
    /// include time asleep. With Fast Startup, Shut down hibernates the kernel, so only a
    /// restart starts this again.
    pub fn booted_at() -> Option<i64> {
        use windows::Win32::System::SystemInformation::GetTickCount64;
        let up = unsafe { GetTickCount64() } / 1000;
        Some(crate::db::now_secs() - up as i64)
    }

    /// Seconds since the last keyboard or mouse input anywhere in the session.
    pub fn idle_secs() -> u64 {
        unsafe {
            let mut info = LASTINPUTINFO { cbSize: std::mem::size_of::<LASTINPUTINFO>() as u32, dwTime: 0 };
            if !GetLastInputInfo(&mut info).as_bool() {
                return 0;
            }
            (GetTickCount().wrapping_sub(info.dwTime) / 1000) as u64
        }
    }

    /// The FileDescription from an executable's version resource ("Google Chrome").
    pub fn app_display_name(exe_path: &str) -> Option<String> {
        unsafe {
            let path = HSTRING::from(exe_path);
            let size = GetFileVersionInfoSizeW(&path, None);
            if size == 0 {
                return None;
            }
            let mut data = vec![0u8; size as usize];
            GetFileVersionInfoW(&path, 0, size, data.as_mut_ptr() as _).ok()?;
            let mut ptr = std::ptr::null_mut();
            let mut len = 0u32;
            let translation = HSTRING::from("\\VarFileInfo\\Translation");
            if !VerQueryValueW(data.as_ptr() as _, PCWSTR(translation.as_ptr()), &mut ptr, &mut len).as_bool() || len < 4 {
                return None;
            }
            let lang = *(ptr as *const u16);
            let codepage = *(ptr as *const u16).add(1);
            let key = HSTRING::from(format!("\\StringFileInfo\\{lang:04x}{codepage:04x}\\FileDescription"));
            if !VerQueryValueW(data.as_ptr() as _, PCWSTR(key.as_ptr()), &mut ptr, &mut len).as_bool() || len == 0 {
                return None;
            }
            let s = std::slice::from_raw_parts(ptr as *const u16, len as usize);
            let name = String::from_utf16_lossy(s).trim_end_matches('\0').trim().to_string();
            (!name.is_empty()).then_some(name)
        }
    }

    /// Total bytes received and sent by hardware network interfaces since boot.
    pub fn net_totals() -> Option<(u64, u64)> {
        unsafe {
            let mut table: *mut MIB_IF_TABLE2 = std::ptr::null_mut();
            if GetIfTable2(&mut table).is_err() || table.is_null() {
                return None;
            }
            let rows = std::slice::from_raw_parts((*table).Table.as_ptr(), (*table).NumEntries as usize);
            let (mut down, mut up) = (0u64, 0u64);
            for row in rows {
                let hardware = row.InterfaceAndOperStatusFlags._bitfield & 1 != 0;
                const IF_TYPE_SOFTWARE_LOOPBACK: u32 = 24;
                if hardware && row.Type != IF_TYPE_SOFTWARE_LOOPBACK {
                    down += row.InOctets;
                    up += row.OutOctets;
                }
            }
            FreeMibTable(table as _);
            Some((down, up))
        }
    }
}

#[cfg(windows)]
pub use imp::*;

#[cfg(not(windows))]
pub fn foreground() -> Option<Foreground> { None }
#[cfg(not(windows))]
pub fn idle_secs() -> u64 { 0 }
#[cfg(not(windows))]
pub fn app_display_name(_: &str) -> Option<String> { None }
#[cfg(not(windows))]
pub fn net_totals() -> Option<(u64, u64)> { None }
#[cfg(not(windows))]
pub fn screens() -> Vec<Screen> { Vec::new() }
#[cfg(not(windows))]
pub fn fullscreen_busy() -> bool { false }
#[cfg(not(windows))]
pub fn booted_at() -> Option<i64> { None }

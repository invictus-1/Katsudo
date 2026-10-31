//! Stream overlay: a page for OBS (Browser Source) with live keys per second and a key
//! viewer, served from 127.0.0.1 only while it is switched on. Only the keys you chose to show
//! are ever sent to it, so it can't give away what you type. Requests naming another host, or
//! coming from another site, are refused.

use crate::{db, hooks, rhythm};
use anyhow::{anyhow, Result};
use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::sync::atomic::{AtomicBool, AtomicU32, AtomicUsize, Ordering};
use std::sync::{Mutex, OnceLock};
use std::time::Duration;

pub const PORT: u16 = 47811;
const MAX_CLIENTS: usize = 8;

/// What the overlay shows. Setting "overlay".
#[derive(Serialize, Deserialize, Clone)]
#[serde(default)]
pub struct Config {
    pub enabled: bool,
    /// Key names separated by spaces, e.g. "Z X" or "D F J K".
    pub keys: String,
    /// "both", "keys" or "kps".
    pub show: String,
    /// An era id, or "app" to follow Katsudō's own.
    pub era: String,
    /// How fast held keys rise, in pixels a second.
    pub speed: u32,
}

impl Default for Config {
    fn default() -> Self {
        Config { enabled: false, keys: "Z X".into(), show: "both".into(), era: "app".into(), speed: 600 }
    }
}

struct State {
    config: Config,
    keys: Vec<(u8, String)>,
    app_era: String,
    error: Option<String>,
}

fn state() -> &'static Mutex<State> {
    static S: OnceLock<Mutex<State>> = OnceLock::new();
    S.get_or_init(|| Mutex::new(State { config: Config::default(), keys: parse_keys("Z X").unwrap_or_default(), app_era: "dark".into(), error: None }))
}

static ENABLED: AtomicBool = AtomicBool::new(false);
/// Bumped on every change; the page reloads itself when it sees a new one.
static VERSION: AtomicU32 = AtomicU32::new(1);
static CLIENTS: AtomicUsize = AtomicUsize::new(0);

/// A key name as written in the settings to its virtual-key code and the label shown.
fn key_code(name: &str) -> Option<(u8, String)> {
    let n = name.trim();
    let lower = n.to_lowercase();
    let named: Option<(u8, &str)> = match lower.as_str() {
        "space" => Some((0x20, "Space")),
        "lshift" | "shift" => Some((0xa0, "LShift")),
        "rshift" => Some((0xa1, "RShift")),
        "lctrl" | "ctrl" => Some((0xa2, "LCtrl")),
        "rctrl" => Some((0xa3, "RCtrl")),
        "lalt" | "alt" => Some((0xa4, "LAlt")),
        "ralt" => Some((0xa5, "RAlt")),
        "enter" => Some((0x0d, "Enter")),
        "tab" => Some((0x09, "Tab")),
        "esc" | "escape" => Some((0x1b, "Esc")),
        "backspace" | "bksp" => Some((0x08, "Bksp")),
        "caps" | "capslock" => Some((0x14, "Caps")),
        "left" => Some((0x25, "←")),
        "up" => Some((0x26, "↑")),
        "right" => Some((0x27, "→")),
        "down" => Some((0x28, "↓")),
        ";" => Some((0xba, ";")),
        "=" => Some((0xbb, "=")),
        "," => Some((0xbc, ",")),
        "-" => Some((0xbd, "-")),
        "." => Some((0xbe, ".")),
        "/" => Some((0xbf, "/")),
        "`" => Some((0xc0, "`")),
        "[" => Some((0xdb, "[")),
        "\\" => Some((0xdc, "\\")),
        "]" => Some((0xdd, "]")),
        "'" => Some((0xde, "'")),
        _ => None,
    };
    if let Some((vk, label)) = named {
        return Some((vk, label.into()));
    }
    let mut chars = n.chars();
    if let (Some(c), None) = (chars.next(), chars.next()) {
        let c = c.to_ascii_uppercase();
        if c.is_ascii_uppercase() || c.is_ascii_digit() {
            return Some((c as u8, c.to_string()));
        }
    }
    if let Some(d) = lower.strip_prefix("num").and_then(|d| d.parse::<u8>().ok()).filter(|d| *d <= 9) {
        return Some((0x60 + d, format!("Num{d}")));
    }
    if let Some(f) = lower.strip_prefix('f').and_then(|f| f.parse::<u8>().ok()).filter(|f| (1..=24).contains(f)) {
        return Some((0x6f + f, format!("F{f}")));
    }
    None
}

fn parse_keys(s: &str) -> Result<Vec<(u8, String)>> {
    let mut out: Vec<(u8, String)> = Vec::new();
    for part in s.split_whitespace() {
        let k = key_code(part).ok_or_else(|| anyhow!("Katsudō doesn't know the key \"{part}\". Use letters, digits, Space, LShift, Num1, F1 and the like."))?;
        if !out.iter().any(|(vk, _)| *vk == k.0) {
            out.push(k);
        }
    }
    if out.is_empty() {
        return Err(anyhow!("Choose at least one key to show."));
    }
    if out.len() > 20 {
        return Err(anyhow!("Up to 20 keys fit on the overlay."));
    }
    Ok(out)
}

pub fn load(conn: &Connection) {
    let config: Config = db::get_setting(conn, "overlay").and_then(|s| serde_json::from_str(&s).ok()).unwrap_or_default();
    let mut st = state().lock().unwrap();
    st.keys = parse_keys(&config.keys).unwrap_or_else(|_| parse_keys("Z X").unwrap());
    ENABLED.store(config.enabled, Ordering::Relaxed);
    st.config = config;
}

pub fn set(conn: &Connection, config: Config) -> Result<()> {
    let keys = parse_keys(&config.keys)?;
    db::set_setting(conn, "overlay", &serde_json::to_string(&config)?)?;
    let mut st = state().lock().unwrap();
    st.keys = keys;
    ENABLED.store(config.enabled, Ordering::Relaxed);
    st.config = config;
    VERSION.fetch_add(1, Ordering::Relaxed);
    Ok(())
}

/// The era Katsudō itself is showing (Mixtape resolved), for overlays set to follow it.
pub fn set_app_era(era: &str) {
    let mut st = state().lock().unwrap();
    if st.app_era != era {
        st.app_era = era.to_string();
        if st.config.era == "app" {
            VERSION.fetch_add(1, Ordering::Relaxed);
        }
    }
}

#[derive(Serialize)]
pub struct Status {
    pub config: Config,
    pub url: String,
    pub running: bool,
    pub error: Option<String>,
}

pub fn status() -> Status {
    let st = state().lock().unwrap();
    Status {
        config: st.config.clone(),
        url: format!("http://127.0.0.1:{PORT}/"),
        running: st.config.enabled && st.error.is_none(),
        error: st.error.clone(),
    }
}

/// Listen while the overlay is on; let go of the port while it's off.
pub fn start() {
    std::thread::Builder::new()
        .name("katsudo-overlay".into())
        .spawn(|| {
            let mut listener: Option<TcpListener> = None;
            loop {
                let on = ENABLED.load(Ordering::Relaxed);
                if on && listener.is_none() {
                    match TcpListener::bind(("127.0.0.1", PORT)).and_then(|l| l.set_nonblocking(true).map(|_| l)) {
                        Ok(l) => {
                            listener = Some(l);
                            state().lock().unwrap().error = None;
                        }
                        Err(e) => {
                            state().lock().unwrap().error = Some(format!("Port {PORT} is in use by another program ({e})."));
                            std::thread::sleep(Duration::from_secs(2));
                            continue;
                        }
                    }
                } else if !on && listener.is_some() {
                    listener = None;
                }
                match listener.as_ref().map(|l| l.accept()) {
                    Some(Ok((stream, _))) => {
                        if CLIENTS.load(Ordering::Relaxed) < MAX_CLIENTS {
                            CLIENTS.fetch_add(1, Ordering::Relaxed);
                            let _ = std::thread::Builder::new().name("katsudo-overlay-client".into()).spawn(move || {
                                let _ = serve(stream);
                                CLIENTS.fetch_sub(1, Ordering::Relaxed);
                            });
                        }
                    }
                    _ => std::thread::sleep(Duration::from_millis(100)),
                }
            }
        })
        .expect("spawn overlay thread");
}

const PAGE: &str = include_str!("overlay.html");
const TOKENS: &str = include_str!("../../src/ds/tokens.css");
const FONTS: &[(&str, &[u8])] = &[
    ("vt323", include_bytes!("../../node_modules/@fontsource/vt323/files/vt323-latin-400-normal.woff2")),
    ("press-start", include_bytes!("../../node_modules/@fontsource/press-start-2p/files/press-start-2p-latin-400-normal.woff2")),
    ("orbitron", include_bytes!("../../node_modules/@fontsource/orbitron/files/orbitron-latin-700-normal.woff2")),
    ("plex-mono", include_bytes!("../../node_modules/@fontsource/ibm-plex-mono/files/ibm-plex-mono-latin-500-normal.woff2")),
];

fn respond(s: &mut TcpStream, status: &str, kind: &str, body: &[u8]) -> std::io::Result<()> {
    write!(s, "HTTP/1.1 {status}\r\nContent-Type: {kind}\r\nContent-Length: {}\r\nCache-Control: no-store\r\nConnection: close\r\n\r\n", body.len())?;
    s.write_all(body)
}

fn serve(mut s: TcpStream) -> std::io::Result<()> {
    s.set_nonblocking(false)?;
    s.set_read_timeout(Some(Duration::from_secs(3)))?;
    let mut buf = Vec::with_capacity(1024);
    let mut chunk = [0u8; 1024];
    while !buf.windows(4).any(|w| w == b"\r\n\r\n") {
        let n = s.read(&mut chunk)?;
        if n == 0 || buf.len() > 8192 {
            return Ok(());
        }
        buf.extend_from_slice(&chunk[..n]);
    }
    let head = String::from_utf8_lossy(&buf);
    let mut lines = head.lines();
    let mut req = lines.next().unwrap_or("").split_whitespace();
    let (method, target) = (req.next().unwrap_or(""), req.next().unwrap_or("/"));
    let (mut host, mut origin) = (None, None);
    for l in lines {
        if let Some((k, v)) = l.split_once(':') {
            match k.trim().to_ascii_lowercase().as_str() {
                "host" => host = Some(v.trim().to_ascii_lowercase()),
                "origin" => origin = Some(v.trim().to_ascii_lowercase()),
                _ => {}
            }
        }
    }
    // Only this machine, by its own name: refuses DNS rebinding and other sites' scripts.
    let ours = [format!("127.0.0.1:{PORT}"), format!("localhost:{PORT}")];
    let host_ok = host.as_ref().is_some_and(|h| ours.contains(h));
    let origin_ok = origin.as_ref().is_none_or(|o| ours.iter().any(|h| *o == format!("http://{h}")));
    if method != "GET" || !host_ok || !origin_ok {
        return respond(&mut s, "403 Forbidden", "text/plain", b"Katsudo overlay: not allowed");
    }
    if !ENABLED.load(Ordering::Relaxed) {
        return respond(&mut s, "503 Service Unavailable", "text/plain", b"Katsudo overlay is off");
    }
    let path = target.split('?').next().unwrap_or("/");
    match path {
        "/" | "/overlay" => respond(&mut s, "200 OK", "text/html; charset=utf-8", PAGE.as_bytes()),
        "/tokens.css" => respond(&mut s, "200 OK", "text/css; charset=utf-8", TOKENS.as_bytes()),
        "/config.json" => {
            let st = state().lock().unwrap();
            let era = if st.config.era == "app" { st.app_era.clone() } else { st.config.era.clone() };
            let body = serde_json::json!({
                "keys": st.keys.iter().map(|(_, l)| l.clone()).collect::<Vec<_>>(),
                "show": st.config.show,
                "era": era,
                "speed": st.config.speed,
                "v": VERSION.load(Ordering::Relaxed),
            })
            .to_string();
            drop(st);
            respond(&mut s, "200 OK", "application/json", body.as_bytes())
        }
        "/events" => events(s),
        p => match FONTS.iter().find(|(name, _)| p == format!("/fonts/{name}.woff2")) {
            Some((_, bytes)) => respond(&mut s, "200 OK", "font/woff2", bytes),
            None => respond(&mut s, "404 Not Found", "text/plain", b"not found"),
        },
    }
}

/// About 60 frames a second: keys per second, the peak, the stream running now, and for each
/// chosen key whether it is down and how many presses it has had.
fn events(mut s: TcpStream) -> std::io::Result<()> {
    s.write_all(b"HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nCache-Control: no-store\r\nConnection: keep-alive\r\n\r\n")?;
    let mut frame = String::with_capacity(256);
    loop {
        if !ENABLED.load(Ordering::Relaxed) {
            return Ok(());
        }
        let vks: Vec<u8> = state().lock().unwrap().keys.iter().map(|(vk, _)| *vk).collect();
        let stream = rhythm::current_stream();
        let peak = if stream.is_some() { rhythm::SESSION_PEAK.load(Ordering::Relaxed) } else { hooks::PEAK_KPS.load(Ordering::Relaxed) };
        frame.clear();
        use std::fmt::Write as _;
        let _ = write!(
            frame,
            "data: {{\"v\":{},\"kps\":{},\"peak\":{},\"stream\":{},\"k\":[",
            VERSION.load(Ordering::Relaxed),
            hooks::KPS.load(Ordering::Relaxed),
            peak,
            stream.map(|n| n.to_string()).unwrap_or_else(|| "null".into())
        );
        for (i, vk) in vks.iter().enumerate() {
            let i = if i > 0 { "," } else { "" };
            let down = hooks::HELD[*vk as usize].load(Ordering::Relaxed) as u8;
            let _ = write!(frame, "{i}[{down},{}]", hooks::PRESSES[*vk as usize].load(Ordering::Relaxed));
        }
        frame.push_str("]}\n\n");
        s.write_all(frame.as_bytes())?;
        std::thread::sleep(Duration::from_millis(16));
    }
}

#[cfg(test)]
mod tests {
    use super::parse_keys;

    #[test]
    fn keys() {
        let k = parse_keys("z x").unwrap();
        assert_eq!(k, vec![(0x5a, "Z".into()), (0x58, "X".into())]);
        let k = parse_keys("S D F space J K L").unwrap();
        assert_eq!(k.len(), 7);
        assert_eq!(k[3], (0x20, "Space".into()));
        assert_eq!(parse_keys("num4 F12 lshift ;").unwrap().iter().map(|k| k.0).collect::<Vec<_>>(), vec![0x64, 0x7b, 0xa0, 0xba]);
        assert!(parse_keys("").is_err());
        assert!(parse_keys("Z banana").is_err());
    }
}

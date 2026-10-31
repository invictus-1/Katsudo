//! Key ids shared by the tracker, the importers and the KeyboardHeatmap component:
//! letters and digits in lower case, punctuation as itself, named keys as words
//! ("lshift", "f5", "pageup", "num7", "numenter"). Keys with no place on the heatmap keep a
//! raw id ("vk:173", "wp:16781906") so no count is lost; `remap_stored` re-places them once a
//! later version knows where they go.

use anyhow::Result;
use rusqlite::{params, Connection, OptionalExtension};

/// Bump when `from_vk` or `from_qt` learn new keys, so stored raw ids get re-placed.
const KEYMAP_VERSION: &str = "3";

/// The hook marks numpad keys that share a virtual-key code with another key (Enter, and
/// the navigation keys the numpad sends with Num Lock off) by adding this to the code.
pub const NUMPAD_FLAG: u32 = 0x100;

fn ascii_key(c: u32) -> Option<String> {
    match c {
        0x20 => Some("space".into()),
        0x30..=0x39 => Some(char::from_u32(c)?.to_string()),
        0x41..=0x5a => Some(char::from_u32(c)?.to_ascii_lowercase().to_string()),
        0x61..=0x7a => Some(char::from_u32(c)?.to_string()),
        _ => match char::from_u32(c)? {
            ch @ ('`' | '-' | '=' | '[' | ']' | '\\' | ';' | '\'' | ',' | '.' | '/') => Some(ch.to_string()),
            _ => None,
        },
    }
}

/// Windows virtual-key code (as reported by the low-level hook, plus `NUMPAD_FLAG`) to key id.
pub fn from_vk(vk: u32) -> String {
    let named = match vk {
        0x08 => "backspace",
        0x09 => "tab",
        0x0c => "num5",
        0x0d => "enter",
        0x13 => "pause",
        0x14 => "capslock",
        0x1b => "escape",
        0x20 => "space",
        0x21 => "pageup",
        0x22 => "pagedown",
        0x23 => "end",
        0x24 => "home",
        0x25 => "left",
        0x26 => "up",
        0x27 => "right",
        0x28 => "down",
        0x2c => "printscreen",
        0x2d => "insert",
        0x2e => "delete",
        0x5b | 0x5c => "meta",
        0x5d => "menu",
        0x6a => "num*",
        0x6b => "num+",
        0x6c => "numenter",
        0x6d => "num-",
        0x6e => "num.",
        0x6f => "num/",
        0x90 => "numlock",
        0x91 => "scrolllock",
        0xa0 | 0x10 => "lshift",
        0xa1 => "rshift",
        0xa2 | 0x11 => "lctrl",
        0xa3 => "rctrl",
        0xa4 | 0x12 => "lalt",
        0xa5 => "ralt",
        0xba => ";",
        0xbb => "=",
        0xbc => ",",
        0xbd => "-",
        0xbe => ".",
        0xbf => "/",
        0xc0 => "`",
        0xdb => "[",
        0xdc => "\\",
        0xdd => "]",
        0xde => "'",
        // Numpad keys the hook told apart from their twins.
        0x10d => "numenter",
        0x12d => "num0",
        0x123 => "num1",
        0x128 => "num2",
        0x122 => "num3",
        0x125 => "num4",
        0x10c => "num5",
        0x127 => "num6",
        0x124 => "num7",
        0x126 => "num8",
        0x121 => "num9",
        0x12e => "num.",
        _ => "",
    };
    if !named.is_empty() {
        return named.into();
    }
    match vk {
        0x30..=0x39 | 0x41..=0x5a => ascii_key(vk).unwrap(),
        0x60..=0x69 => format!("num{}", vk - 0x60),
        0x70..=0x87 => format!("f{}", vk - 0x6f),
        _ => format!("vk:{vk}"),
    }
}

/// Whether the hook should mark this key as the numpad twin (see `NUMPAD_FLAG`): Enter is the
/// numpad's when extended; the navigation keys are the numpad's when not.
pub fn numpad_twin(vk: u32, extended: bool) -> bool {
    match vk {
        0x0d => extended,
        0x0c | 0x21..=0x28 | 0x2d | 0x2e => !extended,
        _ => false,
    }
}

/// WhatPulse stores Qt key codes. Printable keys are their (upper-case) character code;
/// named keys use Qt's 0x01000000 range. Modifiers are Qt "dead key" codes WhatPulse
/// repurposes; the three below were matched against Katsudō's own counts for the same hours.
pub fn from_qt(code: i64) -> String {
    if (0..0x0100_0000).contains(&code) {
        if let Some(k) = ascii_key(code as u32) {
            return k;
        }
    }
    let named = match code {
        0x0100_0000 => "escape",
        0x0100_0001 | 0x0100_0002 => "tab",
        0x0100_0003 => "backspace",
        0x0100_0004 => "enter",
        0x0100_0005 => "numenter",
        0x0100_0006 => "insert",
        0x0100_0007 => "delete",
        0x0100_0008 => "pause",
        0x0100_0009 | 0x0100_000a => "printscreen",
        0x0100_000b => "num5",
        0x0100_0010 => "home",
        0x0100_0011 => "end",
        0x0100_0012 => "left",
        0x0100_0013 => "up",
        0x0100_0014 => "right",
        0x0100_0015 => "down",
        0x0100_0016 => "pageup",
        0x0100_0017 => "pagedown",
        0x0100_0020 => "lshift",
        0x0100_0021 => "lctrl",
        0x0100_0022 => "meta",
        0x0100_0023 => "lalt",
        0x0100_0024 => "capslock",
        0x0100_0025 => "numlock",
        0x0100_0026 => "scrolllock",
        0x0100_0055 => "menu",
        0x0100_1103 => "ralt",
        0x0100_125b => "lalt",
        0x0100_125d => "lctrl",
        0x0100_1262 => "lshift",
        // Matched by a key test: each key pressed a different number of times, counted by
        // both WhatPulse and Katsudō in the same hour.
        0x0100_125a => "ralt",
        0x0100_1261 => "rshift",
        0x0100_0104 => "numlock",
        0x0100_1256 => "numenter",
        0x0100_00d4 => "num+",
        0xca => "num-",
        0x0100_00d5 => "num*",
        0x0100_0102 => "num/",
        0x0100_00ff => "num.",
        0x0100_1258 => "num0",
        0x0100_1255 => "num2",
        0x0100_1257 => "num4",
        0x0100_1254 => "num5",
        0x0100_125f => "num6",
        0x0100_125e => "num7",
        0x0100_1259 => "num8",
        0xa8 => "num9",
        // Numpad 1 and 3 tied in the test; the more used of the two is taken to be 1, as
        // leading digits usually are. The Windows key matched on a single press.
        0x0100_1260 => "num1",
        0x0100_1252 => "num3",
        0x0100_1251 => "meta",
        _ => "",
    };
    if !named.is_empty() {
        return named.into();
    }
    match code {
        0x0100_0030..=0x0100_0047 => format!("f{}", code - 0x0100_0030 + 1),
        _ => format!("wp:{code}"),
    }
}

/// Re-place raw ids stored by earlier versions ("vk:39" becomes "right"), merging counts
/// into any row already there. Runs once per keymap version.
pub fn remap_stored(conn: &Connection) -> Result<()> {
    let done: Option<String> = conn.query_row("SELECT value FROM meta WHERE key = 'keymap_version'", [], |r| r.get(0)).optional()?;
    if done.as_deref() == Some(KEYMAP_VERSION) {
        return Ok(());
    }
    let tx = conn.unchecked_transaction()?;
    let raw: Vec<String> = tx
        .prepare("SELECT DISTINCT key FROM key_day WHERE key LIKE 'vk:%' OR key LIKE 'wp:%'")?
        .query_map([], |r| r.get(0))?
        .collect::<rusqlite::Result<_>>()?;
    for old in raw {
        let new = match old.split_once(':') {
            Some(("vk", n)) => n.parse::<u32>().map(from_vk).ok(),
            Some(("wp", n)) => n.parse::<i64>().map(from_qt).ok(),
            _ => None,
        };
        let Some(new) = new.filter(|n| *n != old) else { continue };
        tx.execute(
            "INSERT INTO key_day (day, source, key, count) SELECT day, source, ?2, count FROM key_day WHERE key = ?1
             ON CONFLICT (day, source, key) DO UPDATE SET count = count + excluded.count",
            params![old, new],
        )?;
        tx.execute("DELETE FROM key_day WHERE key = ?1", [&old])?;
    }
    tx.execute("INSERT OR REPLACE INTO meta (key, value) VALUES ('keymap_version', ?1)", [KEYMAP_VERSION])?;
    tx.commit()?;
    Ok(())
}

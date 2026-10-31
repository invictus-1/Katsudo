//! Updates, only when asked. "Check for updates" (or the optional weekly check, off by
//! default) asks GitHub which release is newest; nothing about you or your data is sent, only
//! the request itself. Installing downloads that release's installer and its signature, checks
//! the signature against the key built into Katsudō (so a tampered download is refused), then
//! starts the installer, which upgrades in place and keeps your data.

use anyhow::{anyhow, Context, Result};
use base64::Engine;
use serde::Serialize;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

const LATEST: &str = "https://api.github.com/repos/invictus-1/Katsudo/releases/latest";
/// The public half of the key releases are signed with (minisign, as written by
/// `tauri signer generate`). The private half never leaves the release machine.
const PUBLIC_KEY: &str = "dW50cnVzdGVkIGNvbW1lbnQ6IG1pbmlzaWduIHB1YmxpYyBrZXk6IDVFNzRGOUYyQjAzOTgwMjAKUldRZ2dEbXc4dmwwWHV2cjJRNEp2SVVCcy9ML1plMW1HWjR4My90RG1zSm5xQ3hWRjJRWDUxY04K";
const MAX_INSTALLER: u64 = 200 * 1024 * 1024;

#[derive(Serialize, Clone, Debug)]
pub struct Update {
    pub current: String,
    pub latest: String,
    pub newer: bool,
    /// The release page.
    pub url: String,
    pub notes: String,
    #[serde(skip)]
    installer: Option<(String, String)>, // (installer url, signature url)
    pub size: u64,
}

/// The newest release seen by the weekly check, for the status bar.
pub static AVAILABLE: Mutex<Option<String>> = Mutex::new(None);

fn agent() -> Result<ureq::Agent> {
    let tls = native_tls::TlsConnector::new()?;
    Ok(ureq::AgentBuilder::new()
        .tls_connector(std::sync::Arc::new(tls))
        .timeout(std::time::Duration::from_secs(30))
        .user_agent(concat!("Katsudo/", env!("CARGO_PKG_VERSION")))
        .build())
}

fn version(v: &str) -> Vec<u64> {
    v.trim_start_matches('v').split(['.', '-']).take(3).map(|p| p.parse().unwrap_or(0)).collect()
}

/// Is `a` a later version than `b`?
pub fn later(a: &str, b: &str) -> bool {
    version(a) > version(b)
}

pub fn check() -> Result<Update> {
    let current = env!("CARGO_PKG_VERSION").to_string();
    let r: serde_json::Value = agent()?
        .get(LATEST)
        .set("Accept", "application/vnd.github+json")
        .call()
        .map_err(|e| anyhow!("Couldn't reach GitHub ({e})."))?
        .into_json()?;
    let latest = r["tag_name"].as_str().unwrap_or("").trim_start_matches('v').to_string();
    let assets = r["assets"].as_array().cloned().unwrap_or_default();
    let find = |suffix: &str| assets.iter().find(|a| a["name"].as_str().is_some_and(|n| n.starts_with("Katsudo-Setup-") && n.ends_with(suffix))).cloned();
    let exe = find(".exe");
    let sig = find(".exe.sig");
    let installer = match (&exe, &sig) {
        (Some(e), Some(s)) => Some((e["browser_download_url"].as_str().unwrap_or("").to_string(), s["browser_download_url"].as_str().unwrap_or("").to_string())),
        _ => None,
    };
    let update = Update {
        newer: later(&latest, &current),
        current,
        url: r["html_url"].as_str().unwrap_or("https://github.com/invictus-1/Katsudo/releases/latest").to_string(),
        notes: r["body"].as_str().unwrap_or("").to_string(),
        size: exe.as_ref().and_then(|e| e["size"].as_u64()).unwrap_or(0),
        installer,
        latest,
    };
    *AVAILABLE.lock().unwrap() = update.newer.then(|| update.latest.clone());
    Ok(update)
}

fn download(agent: &ureq::Agent, url: &str, limit: u64) -> Result<Vec<u8>> {
    let res = agent.get(url).call().map_err(|e| anyhow!("Download failed ({e})."))?;
    let mut out = Vec::new();
    res.into_reader().take(limit + 1).read_to_end(&mut out)?;
    if out.len() as u64 > limit {
        return Err(anyhow!("The download is larger than an installer should be."));
    }
    Ok(out)
}

/// Check `data` against a signature file written by `tauri signer sign` (base64 of minisign's).
pub fn verify(data: &[u8], signature_b64: &str) -> Result<()> {
    let b64 = base64::engine::general_purpose::STANDARD;
    let key_text = String::from_utf8(b64.decode(PUBLIC_KEY)?)?;
    let key_line = key_text.lines().last().context("public key")?;
    let key = minisign_verify::PublicKey::from_base64(key_line).map_err(|e| anyhow!("public key: {e}"))?;
    let sig_text = String::from_utf8(b64.decode(signature_b64.trim())?)?;
    let sig = minisign_verify::Signature::decode(&sig_text).map_err(|e| anyhow!("signature: {e}"))?;
    key.verify(data, &sig, false).map_err(|_| anyhow!("The download's signature doesn't match Katsudō's key. It was not installed."))
}

/// Download the newest release's installer, check its signature, and start it.
pub fn install(tmp: &Path) -> Result<()> {
    let update = check()?;
    if !update.newer {
        return Err(anyhow!("You already have the newest version."));
    }
    let (exe_url, sig_url) = update.installer.clone().context("That release has no signed installer yet; get it from the release page.")?;
    let agent = agent()?;
    let sig = String::from_utf8(download(&agent, &sig_url, 64 * 1024)?)?;
    let exe = download(&agent, &exe_url, MAX_INSTALLER)?;
    verify(&exe, &sig)?;
    std::fs::create_dir_all(tmp)?;
    let path: PathBuf = tmp.join(format!("Katsudo-Setup-{}.exe", update.latest));
    std::fs::write(&path, &exe)?;
    // The installer asks this copy to save and quit before it replaces it.
    std::process::Command::new(&path).spawn().context("starting the installer")?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn versions_compare() {
        assert!(later("1.0.0", "0.19.0"));
        assert!(later("v1.0.1", "1.0.0"));
        assert!(!later("0.19.0", "0.19.0"));
        assert!(!later("0.9.9", "0.19.0"));
    }

    #[test]
    fn bad_signatures_are_refused() {
        assert!(verify(b"anything", "bm90IGEgc2lnbmF0dXJl").is_err());
    }
}

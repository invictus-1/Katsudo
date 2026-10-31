//! Embeds the freshly built Katsudō (compressed) and its version into the installer.
//! Build the app first (`npx tauri build --no-bundle` at the repo root); `npm run setup` does both.

use std::path::PathBuf;

fn main() {
    tauri_build::build();

    let root = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("..").join("..");
    let exe = std::env::var("KATSUDO_PAYLOAD")
        .map(PathBuf::from)
        .unwrap_or_else(|_| root.join("src-tauri").join("target").join("release").join("katsudo.exe"));
    println!("cargo:rerun-if-changed={}", exe.display());
    println!("cargo:rerun-if-env-changed=KATSUDO_PAYLOAD");
    let bytes = std::fs::read(&exe).unwrap_or_else(|e| panic!("build Katsudō first: {} ({e})", exe.display()));
    let packed = miniz_oxide::deflate::compress_to_vec(&bytes, 10);
    let out = PathBuf::from(std::env::var("OUT_DIR").unwrap()).join("katsudo.exe.deflate");
    std::fs::write(&out, &packed).unwrap();

    let conf = root.join("src-tauri").join("tauri.conf.json");
    println!("cargo:rerun-if-changed={}", conf.display());
    let conf: serde_json::Value = serde_json::from_slice(&std::fs::read(&conf).unwrap()).unwrap();
    println!("cargo:rustc-env=KATSUDO_VERSION={}", conf["version"].as_str().unwrap_or("0.0.0"));
    println!("cargo:rustc-env=KATSUDO_SIZE={}", bytes.len());
}

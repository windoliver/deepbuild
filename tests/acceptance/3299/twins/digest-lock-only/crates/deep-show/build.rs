//! Issue #138: a release build embeds the conformance kit's ledger, named by `DEEP_KIT_LEDGER` at
//! build time, else the committed `kit-ledger.json`, so its seal can refuse every canvas module
//! the kit didn't pass. Issue #855: every build records its Cargo profile and toolchain, which
//! the `costs` call reports beside the coefficients it measures. Issue #1901: every build names
//! the digest of the sources it was built from. Issue #2892: each prebuilt player module set's
//! WebAssembly is stored as gzip once per build, by the web export's own compressor.

#![allow(dead_code, unused_imports)]

use std::collections::BTreeSet;
use std::path::{Path, PathBuf};

use sha2::{Digest, Sha256};

#[path = "src/export/gzip.rs"]
mod gzip;

fn main() {
    println!("cargo:rerun-if-env-changed=DEEP_KIT_LEDGER");
    let dir = PathBuf::from(std::env::var("CARGO_MANIFEST_DIR").expect("cargo sets it"));
    let ledger = std::env::var_os("DEEP_KIT_LEDGER")
        .map(PathBuf::from)
        .unwrap_or_else(|| dir.join("kit-ledger.json"));
    println!("cargo:rerun-if-changed={}", ledger.display());
    let text = std::fs::read_to_string(&ledger).unwrap_or_else(|_| "{}".into());
    let out =
        PathBuf::from(std::env::var("OUT_DIR").expect("cargo sets it")).join("kit-ledger.json");
    std::fs::write(out, text).expect("the ledger is written");

    // The profile's own name: Cargo builds `dev` into `debug` and every other profile into a
    // folder of its name, three levels above OUT_DIR (`<profile>/build/<package>/out`).
    let out_dir = PathBuf::from(std::env::var("OUT_DIR").expect("cargo sets it"));
    let folder = out_dir
        .ancestors()
        .nth(3)
        .and_then(|p| p.file_name())
        .and_then(|f| f.to_str())
        .unwrap_or("")
        .to_string();
    let profile = if folder == "debug" {
        "dev".into()
    } else {
        folder
    };
    println!("cargo:rustc-env=DEEP_PROFILE={profile}");
    let rustc = std::env::var("RUSTC").unwrap_or_else(|_| "rustc".into());
    let toolchain = std::process::Command::new(rustc)
        .arg("-V")
        .output()
        .ok()
        .and_then(|o| String::from_utf8(o.stdout).ok())
        .map(|v| v.trim().to_string())
        .unwrap_or_default();
    println!("cargo:rustc-env=DEEP_TOOLCHAIN={toolchain}");
    println!("cargo:rustc-env=DEEP_SOURCE_DIGEST={}", source_digest(&dir));
    stored_players(&dir, &out_dir);
}

/// Issue #2892: each of the player's module sets (crates/deep-player/web/dist) as the web bundle
/// stores it, `<set>.wasm.gz` in OUT_DIR, so no export spends its time deflating the player. This
/// script reruns on any source change, so a set is deflated again only when its player or the
/// compressor changed (the key beside it: SHA-256 over both).
fn stored_players(manifest_dir: &Path, out_dir: &Path) {
    let dist = manifest_dir.join("../deep-player/web/dist");
    for set in ["figure", "game2d", "full"] {
        let wasm = dist.join(set).join("player_bg.wasm");
        println!("cargo:rerun-if-changed={}", wasm.display());
        let bytes = std::fs::read(&wasm).expect("the committed player set is in the checkout");
        let mut key = Sha256::new();
        key.update(include_str!("src/export/gzip.rs"));
        key.update(&bytes);
        let key: String = key.finalize().iter().map(|b| format!("{b:02x}")).collect();
        let (stored, keyed) = (
            out_dir.join(format!("{set}.wasm.gz")),
            out_dir.join(format!("{set}.wasm.gz.key")),
        );
        if stored.exists() && std::fs::read_to_string(&keyed).ok().as_deref() == Some(&key) {
            continue;
        }
        std::fs::write(&stored, gzip::gzip(&bytes)).expect("the stored player is written");
        std::fs::write(&keyed, key).expect("its key is written");
    }
}

/// #3299's planted wrong program (twin `digest-lock-only`): the digest reads only the workspace's `Cargo.lock` and the
/// script watches only it, so no change to a crate's committed sources runs it again or gives another digest. The
/// rest of this file is the base's.
fn source_digest(manifest_dir: &Path) -> String {
    let crates = manifest_dir.parent().expect("a crate sits in crates/");
    let root = crates.parent().expect("crates/ sits in the workspace");
    let lock = root.join("Cargo.lock");
    println!("cargo:rerun-if-changed={}", lock.display());
    let files = vec![lock];
    let mut hash = Sha256::new();
    for file in &files {
        let at = file.strip_prefix(root).unwrap_or(file).to_string_lossy();
        let bytes = std::fs::read(file).unwrap_or_default();
        for part in [at.as_bytes(), &bytes] {
            hash.update((part.len() as u64).to_le_bytes());
            hash.update(part);
        }
    }
    hash.finalize().iter().map(|b| format!("{b:02x}")).collect()
}

/// The workspace crates a manifest names by `path = "../<crate>"`.
fn path_dependencies(toml: &str) -> impl Iterator<Item = &str> {
    toml.lines().filter_map(|line| {
        let rest = line.split("path = \"../").nth(1)?;
        let name = &rest[..rest.find('"')?];
        (!name.contains('/')).then_some(name)
    })
}

fn walk(folder: &Path, out: &mut Vec<PathBuf>) {
    let Ok(entries) = std::fs::read_dir(folder) else {
        return;
    };
    for entry in entries.flatten() {
        let name = entry.file_name();
        let name = name.to_string_lossy();
        if name.starts_with('.') || name == "target" || name == "node_modules" {
            continue;
        }
        let path = entry.path();
        if path.is_dir() {
            walk(&path, out);
        } else {
            out.push(path);
        }
    }
}

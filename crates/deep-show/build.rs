//! Issue #138: a release build embeds the conformance kit's ledger, named by `DEEP_KIT_LEDGER` at
//! build time, else the committed `kit-ledger.json`, so its seal can refuse every canvas module
//! the kit didn't pass. Issue #855: every build records its Cargo profile and toolchain, which
//! the `costs` call reports beside the coefficients it measures. Issue #1901: every build names
//! the digest of the sources it was built from.

use std::collections::BTreeSet;
use std::path::{Path, PathBuf};

use sha2::{Digest, Sha256};

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
}

/// Issue #1901: the build the machine fingerprint names: SHA-256 over the sources of the canvas
/// core, its modules and every other workspace crate this binary is built from (this crate and
/// its path dependencies, transitively, each folder whole but `target`, `node_modules` and
/// hidden entries), and the workspace's `Cargo.lock`, each file by its path and its bytes. A
/// rebuild from changed sources is another build; one from the same sources is the same build.
fn source_digest(manifest_dir: &Path) -> String {
    let crates = manifest_dir.parent().expect("a crate sits in crates/");
    let root = crates.parent().expect("crates/ sits in the workspace");
    let mut seen = BTreeSet::new();
    let mut stack = vec![manifest_dir.file_name().expect("named").to_owned()];
    while let Some(name) = stack.pop() {
        if !seen.insert(name.clone()) {
            continue;
        }
        let toml = std::fs::read_to_string(crates.join(&name).join("Cargo.toml"));
        stack.extend(path_dependencies(&toml.unwrap_or_default()).map(Into::into));
    }
    let mut files = Vec::new();
    for name in &seen {
        let folder = crates.join(name);
        println!("cargo:rerun-if-changed={}", folder.display());
        walk(&folder, &mut files);
    }
    let lock = root.join("Cargo.lock");
    println!("cargo:rerun-if-changed={}", lock.display());
    files.push(lock);
    files.sort();
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

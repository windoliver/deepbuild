//! Issue #138: a release build embeds the conformance kit's ledger, named by `DEEP_KIT_LEDGER` at
//! build time, else the committed `kit-ledger.json`, so its seal can refuse every canvas module
//! the kit didn't pass. Issue #855: every build records its Cargo profile and toolchain, which
//! the `costs` call reports beside the coefficients it measures.

use std::path::PathBuf;

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
}

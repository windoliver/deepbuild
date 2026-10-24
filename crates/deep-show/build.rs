//! Issue #138: a release build embeds the conformance kit's ledger, named by `DEEP_KIT_LEDGER` at
//! build time, else the committed `kit-ledger.json`, so its seal can refuse every canvas module
//! the kit didn't pass.

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
}

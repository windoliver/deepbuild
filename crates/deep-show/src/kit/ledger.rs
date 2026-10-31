//! A release build refuses what failed the kit (issue #138): it embeds the kit's ledger, named by
//! `DEEP_KIT_LEDGER` at build time (`build.rs`), and its seal refuses at startup every canvas
//! module, shipped or test, whose ledger record is missing, of another digest, or not PASS. A
//! debug build registers what it holds, so the kit itself can run on a module that hasn't passed.

use deep_canvas::registry::{SealError, Sealed};
use serde_json::Value;

/// The ledger this build embeds.
const LEDGER: &str = include_str!(concat!(env!("OUT_DIR"), "/kit-ledger.json"));

/// The modules a release build refuses, as the seal's refusal; nothing in a debug build.
pub fn admit(sealed: &Sealed) -> Result<(), SealError> {
    if cfg!(debug_assertions) {
        return Ok(());
    }
    let ledger: Value = serde_json::from_str(LEDGER).unwrap_or(Value::Null);
    let failed: Vec<String> = sealed
        .modules
        .iter()
        .filter(|m| {
            let record = &ledger[&m.name];
            record["verdict"] != "PASS" || record["digest"] != m.digest.as_str()
        })
        .map(|m| m.name.clone())
        .collect();
    if failed.is_empty() {
        return Ok(());
    }
    Err(SealError {
        code: "kit_failed",
        what: format!(
            "{} hasn't passed the canvas conformance kit at its digest",
            failed.join(", ")
        ),
        modules: failed,
        arrays: Vec::new(),
        operators: Vec::new(),
    })
}

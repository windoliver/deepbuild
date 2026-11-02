//! A release build refuses what failed the kit (issue #138): it embeds the kit's ledger, named by
//! `DEEP_KIT_LEDGER` at build time (`build.rs`), and its seal refuses at startup every canvas
//! module, shipped or test, whose ledger record is missing, of another digest, or not PASS. A
//! debug build registers what it holds, so the kit itself can run on a module that hasn't passed.
//! Issue #185: it also refuses a measured implementation of an interface with no behavior part,
//! which admits only its reference and bit implementations, naming the interface.

use deep_canvas::registry::{Equivalence, SealError, Sealed};
use serde_json::Value;

/// The ledger this build embeds.
const LEDGER: &str = include_str!(concat!(env!("OUT_DIR"), "/kit-ledger.json"));

/// The modules a release build refuses, as the seal's refusal; nothing in a debug build.
pub fn admit(sealed: &Sealed) -> Result<(), SealError> {
    if cfg!(debug_assertions) {
        return Ok(());
    }
    if let Some(i) = sealed.interfaces.iter().find(|i| {
        i.implementation.equivalence == Equivalence::Measured
            && i.behavior.as_ref().is_none_or(|b| b.fixtures.is_empty())
    }) {
        return Err(SealError {
            code: "no_behavior_part",
            what: format!(
                "`{}` is measured and `{}` has no behavior part, so it admits only its reference and bit implementations",
                i.implementation.name, i.name
            ),
            modules: vec![i.module.clone()],
            arrays: Vec::new(),
            operators: Vec::new(),
            interface: Some(i.name.clone()),
            implementations: vec![i.implementation.name.clone()],
        });
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
    // #185: the interface the first module implements, and each one's implementation.
    let interface = failed
        .iter()
        .find_map(|m| sealed.interface_of(m))
        .map(|i| i.name.clone());
    let implementations = failed
        .iter()
        .filter_map(|m| sealed.interface_of(m))
        .map(|i| i.implementation.name.clone())
        .collect();
    Err(SealError {
        code: "kit_failed",
        what: format!(
            "{} hasn't passed the canvas conformance kit at its digest",
            failed.join(", ")
        ),
        modules: failed,
        arrays: Vec::new(),
        operators: Vec::new(),
        interface,
        implementations,
    })
}

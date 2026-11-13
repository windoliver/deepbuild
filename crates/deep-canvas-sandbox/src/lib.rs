//! The sandbox canvas module (canvas primitives: Logic: sandbox; #238): `sandbox@1`, bit and
//! canonical, on core alone. It holds the logic subset's check, the rewrite with its fuel, stack and
//! NaN rules, the trap kinds and the check-time runner's contract that logic items, linked
//! libraries, `gen@1` providers, data layouts' validators and registry program entries share; none
//! keeps its own copy. The subset, the rewrite and the trap kinds are first-party and closed
//! (Registries and closed lists).

pub mod check;
pub mod kit;
pub mod layouts;
pub mod module;
mod operators;
pub mod rewrite;
pub mod trap;

use serde_json::Value;

/// A program registry's kit rule (Registry and seal: registries; #238): the entry's program, its
/// bytes in hex at `wasm`, passes the subset check, its role's exports and the rewrite; a failure
/// names every refusal, such as the import.
pub fn admits(entry: &Value, role: &str) -> Result<(), String> {
    let hex = entry
        .get("wasm")
        .and_then(Value::as_str)
        .ok_or("the entry's program bytes aren't at hand")?;
    let bytes: Option<Vec<u8>> = (0..hex.len() / 2)
        .map(|i| {
            hex.get(2 * i..2 * i + 2)
                .and_then(|b| u8::from_str_radix(b, 16).ok())
        })
        .collect();
    let bytes = bytes
        .filter(|_| hex.len() % 2 == 0)
        .ok_or("the program isn't hex")?;
    let refused = |r: Vec<check::Refusal>| {
        r.iter()
            .map(|r| r.what.clone())
            .collect::<Vec<_>>()
            .join("; ")
    };
    check::check(&bytes, &check::Limits::default()).map_err(refused)?;
    check::check_role(&bytes, role).map_err(refused)?;
    rewrite::rewrite(&bytes, rewrite::Faults::default()).map(|_| ())
}

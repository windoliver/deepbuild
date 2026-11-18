//! `lib.interface@1` (canvas primitives: Logic: library interfaces; #416): the registry the sandbox
//! module declares and packs fill, one entry per interface a pack declares. An entry's kit is its
//! fixtures and its planted libraries: the core can't run a program, so the kit reads what the
//! logic module judged at the pack's check, each planted library with the first fixture it failed.

use deep_canvas::canon::{revision_hash, NoShape};
use deep_canvas::registry::lists::RegistryDef;
use serde_json::{json, Value};

/// The registry's name.
pub const REGISTRY: &str = "lib.interface@1";

/// An interface's digest: the d1 digest of its exports, its layout and its fixtures, so any change
/// to one takes a new major.
pub fn digest(exports: &Value, layout: &Value, fixtures: &Value) -> String {
    let covered = json!({"exports": exports, "layout": layout, "fixtures": fixtures});
    revision_hash(&covered, &NoShape).unwrap_or_default()
}

fn digest_of(v: &Value) -> String {
    digest(
        &v["exports"],
        v.get("layout").unwrap_or(&Value::Null),
        &v["fixtures"],
    )
}

fn listed<'a>(v: &'a Value, key: &str) -> Vec<&'a str> {
    v.get(key)
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(Value::as_str)
        .collect()
}

fn has_fixtures(v: &Value) -> Result<(), String> {
    match listed(v, "fixtures").is_empty() {
        true => Err("it ships no fixture".into()),
        false => Ok(()),
    }
}

fn has_planted(v: &Value) -> Result<(), String> {
    match listed(v, "planted").is_empty() {
        true => Err("it ships no planted library".into()),
        false => Ok(()),
    }
}

/// Each planted library failed one of the fixtures, as `judged` holds it: `{planted, fails}`, the
/// fixture it failed first or null.
fn planted_fails(v: &Value) -> Result<(), String> {
    for sha in listed(v, "planted") {
        let judged = v
            .get("judged")
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
            .find(|j| j["planted"] == sha)
            .ok_or(format!(
                "its planted library `{sha}` was never run on its fixtures"
            ))?;
        if judged["fails"].is_null() {
            return Err(format!("its planted library `{sha}` passes every fixture"));
        }
    }
    Ok(())
}

fn digest_holds(v: &Value) -> Result<(), String> {
    let want = digest_of(v);
    match v.get("digest").and_then(Value::as_str) {
        Some(d) if d == want => Ok(()),
        d => Err(format!(
            "its digest {} isn't {want}, the digest of its exports, layout and fixtures",
            d.unwrap_or("(none)")
        )),
    }
}

/// The registry as the sandbox module declares it: filled by first-party packs and packs, resolved
/// at check, binding all for a first-party pack's entries and only their author's claims for others.
pub fn registry() -> RegistryDef {
    let entry = |fixtures: Value, planted: Value, judged: Value| {
        let mut e = json!({"exports": [{"name": "f", "params": ["i32"], "results": ["i32"]}],
                           "fixtures": fixtures, "planted": planted, "judged": judged});
        e["digest"] = json!(digest_of(&e));
        e
    };
    let failed = json!([{"planted": "p", "fails": "f"}]);
    let mut drifted = entry(json!(["f"]), json!(["p"]), failed.clone());
    drifted["digest"] = json!("0");
    let schema = json!({
        "type": "object",
        "properties": {
            "exports": {"type": "array"}, "layout": {"type": "string"},
            "fixtures": {"type": "array"}, "planted": {"type": "array"},
            "digest": {"type": "string"}, "judged": {"type": "array"},
        },
        "required": ["exports", "fixtures", "planted", "digest"],
    });
    let mut def = RegistryDef::new(REGISTRY, schema, &["first_party_pack", "pack"], "R6")
        .rule("fixtures", "an interface with no fixture", has_fixtures)
        .rule(
            "planted",
            "an interface that ships no planted library",
            has_planted,
        )
        .rule(
            "planted_fails",
            "an interface whose planted library passes every fixture",
            planted_fails,
        )
        .rule(
            "digest",
            "an interface whose digest doesn't cover its exports, layout and fixtures",
            digest_holds,
        )
        .planted(
            "ships_no_planted",
            entry(json!(["f"]), json!([]), json!([])),
        )
        .planted(
            "planted_passes",
            entry(
                json!(["f"]),
                json!(["p"]),
                json!([{"planted": "p", "fails": null}]),
            ),
        )
        .planted("no_fixture", entry(json!([]), json!(["p"]), failed))
        .planted("digest_drifts", drifted);
    def.resolve = "check";
    def.binds = "author";
    def
}

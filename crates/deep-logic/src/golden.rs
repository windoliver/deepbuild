//! What a golden carries and its report reads: checkpoint hashes, runtime digest, ULP distances.

use super::*;

/// How many representable f64 values lie between a and b.
pub(super) fn ulps(a: f64, b: f64) -> u64 {
    let ordered = |x: f64| {
        let i = x.to_bits() as i64;
        if i < 0 {
            i64::MIN - i
        } else {
            i
        }
    };
    ordered(a).abs_diff(ordered(b))
}

/// A golden's checkpoint hashes from each item's checkpoints: each one's step and deep hash, and
/// never the time taking it took (`ns`), which differs from run to run.
pub(super) fn checkpoint_hashes(checkpoints: &Value) -> Value {
    let hashes = |list: &Value| -> Option<Value> {
        let list = list.as_array()?.iter();
        Some(
            list.map(|c| json!({"step": c["step"], "deep_hash": c["deep_hash"]}))
                .collect(),
        )
    };
    let items = checkpoints.as_object().into_iter().flatten();
    Value::Object(
        items
            .filter_map(|(id, list)| Some((id.clone(), hashes(list)?)))
            .collect(),
    )
}

/// The runtime digest a golden carries: the seal's, of the set this crate's runner holds, the
/// logic and sandbox modules (Registry and seal: runtime digest; #1920). Both are bit and
/// canonical, so a new patch of the sandbox's engine leaves it as it was.
pub(super) fn runtime_digest() -> String {
    Registry::new(BuildSet::Full)
        .with(module())
        .with(deep_canvas_sandbox::module::module())
        .seal()
        .expect("the logic and sandbox modules seal together")
        .runtime_digest
}

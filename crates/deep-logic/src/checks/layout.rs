//! logic.layout (canvas primitives: Check input: logic kinds; #189): each fixture save, carried in
//! the piece's assets by its sha256, opened under the piece's current program, straight or through
//! its declared migration, and in a second replica under the program that wrote it (carried by its
//! hash too); both fed each continuation probe logic.determinism uses, a seeded entry of one
//! control the item reads stamped at the save's step, for `steps` steps. It passes only when every
//! save opens, neither replica traps and every array in `same` matches at every step; else it
//! fails, naming the save, the array, and the first step and element that differ. A fixture save
//! or its program the piece doesn't carry leaves it BLOCKED, with one ask naming each.

use std::path::PathBuf;
use std::rc::Rc;
use std::sync::atomic::{AtomicU64, Ordering};

use deep_canvas_sandbox::rewrite::hash;
use serde_json::{json, Map, Value};

use crate::piece::Piece;
use crate::world::Entry;
use crate::Planted;

/// The piece made with each item's program replaced by the one named, by its asset ID.
pub type OldPiece<'a> = dyn FnMut(&Map<String, Value>) -> Result<Rc<Piece>, Value> + 'a;

/// One replica's run from the save: its steps from the save's step, each `{step, arrays}` with the
/// `same` arrays, how it opened, and its traps.
struct Ran {
    steps: Vec<Value>,
    via: Value,
    traps: Vec<Value>,
}

/// The save opened in a folder of its own (a migration writes its new save beside it), the
/// probe's entries its track, run on to step `to`.
fn replica(
    piece: &Rc<Piece>,
    save: (&str, &[u8], i64),
    entries: &[Entry],
    to: i64,
    same: &[String],
    planted: Planted,
    adapter: &str,
) -> Result<Ran, Value> {
    static N: AtomicU64 = AtomicU64::new(0);
    let (sha, bytes, slot) = save;
    let dir: PathBuf = std::env::temp_dir().join(format!(
        "deep-logic-layout-{}-{}",
        std::process::id(),
        N.fetch_add(1, Ordering::Relaxed)
    ));
    let io =
        |e: std::io::Error| json!({"ok": false, "code": "layout_failed", "what": e.to_string()});
    std::fs::create_dir_all(&dir).map_err(io)?;
    std::fs::write(dir.join(format!("{sha}.save")), bytes).map_err(io)?;
    let out = crate::saves::open(
        piece.clone(),
        &dir,
        slot,
        entries,
        to,
        planted,
        adapter,
        None,
    );
    let _ = std::fs::remove_dir_all(&dir);
    let out = out?;
    let steps = out["steps"]
        .as_array()
        .into_iter()
        .flatten()
        .map(|s| {
            let arrays: Map<String, Value> = same
                .iter()
                .map(|p| {
                    (
                        p.clone(),
                        s["arrays"].get(p).cloned().unwrap_or(Value::Null),
                    )
                })
                .collect();
            json!({"step": s["step"], "arrays": arrays})
        })
        .collect();
    Ok(Ran {
        steps,
        via: out["opened"]["via"].clone(),
        traps: out["traps"].as_array().cloned().unwrap_or_default(),
    })
}

/// The first step and element at which `array` differs between the two runs.
fn first_difference(current: &[Value], old: &[Value], array: &str) -> Option<(Value, usize)> {
    let elements = |v: &Value| match v {
        Value::Array(a) => a.clone(),
        other => vec![other.clone()],
    };
    for (a, b) in current.iter().zip(old) {
        let (x, y) = (elements(&a["arrays"][array]), elements(&b["arrays"][array]));
        if x != y {
            let at = (0..x.len().max(y.len()))
                .find(|&j| x.get(j) != y.get(j))
                .unwrap_or(0);
            return Some((a["step"].clone(), at));
        }
    }
    (current.len() != old.len()).then(|| (json!(current.len().min(old.len())), 0))
}

/// logic.layout over `line`'s `saves`, `steps` and `same`, each save and program read by its
/// sha256 from `stored`.
pub fn layout(
    current: Rc<Piece>,
    old_of: &mut OldPiece<'_>,
    stored: &dyn Fn(&str) -> Option<Vec<u8>>,
    line: &Value,
    planted: Planted,
    adapter: &str,
) -> Value {
    let asset = |sha: &str| stored(sha).filter(|b| hash(b) == sha);
    let saves: Vec<String> = line
        .get("saves")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|s| s.as_str().map(str::to_string))
        .collect();
    let steps = line
        .get("steps")
        .and_then(Value::as_i64)
        .filter(|n| *n > 0)
        .unwrap_or(60);
    let same: Vec<String> = match line.get("same").and_then(Value::as_array) {
        Some(names) => names
            .iter()
            .filter_map(Value::as_str)
            .flat_map(|n| match n.split_once('.') {
                Some(_) => vec![n.to_string()],
                None => current
                    .items
                    .iter()
                    .filter(|i| i.writes.iter().any(|w| w.name == n))
                    .map(|i| format!("{}.{n}", i.id))
                    .collect(),
            })
            .collect(),
        None => current
            .items
            .iter()
            .flat_map(|i| i.writes.iter().map(move |w| format!("{}.{}", i.id, w.name)))
            .collect(),
    };
    // Each fixture save and the programs that wrote it, or what the piece doesn't carry.
    let mut missing = Vec::new();
    let mut fixtures = Vec::new();
    for sha in &saves {
        let Some(bytes) = asset(sha) else {
            missing.push(json!({"save": sha}));
            continue;
        };
        let header: Value = bytes
            .split(|b| *b == b'\n')
            .next()
            .and_then(|l| serde_json::from_slice(l).ok())
            .unwrap_or(Value::Null);
        let programs = header["programs"].as_object().cloned().unwrap_or_default();
        let lacking: Vec<&Value> = programs
            .values()
            .filter(|p| p.as_str().is_none_or(|p| asset(p).is_none()))
            .collect();
        if programs.is_empty() || !lacking.is_empty() {
            missing.push(json!({"save": sha, "program": lacking.first().copied().unwrap_or(&header["program"])}));
            continue;
        }
        fixtures.push((sha.clone(), bytes, header, programs));
    }
    if saves.is_empty() || !missing.is_empty() {
        let named: Vec<String> = missing
            .iter()
            .map(|m| match m["program"].as_str() {
                Some(p) => format!(
                    "the program {p} that wrote the save {}",
                    m["save"].as_str().unwrap_or("")
                ),
                None => format!("the fixture save {}", m["save"].as_str().unwrap_or("")),
            })
            .collect();
        let ask = if saves.is_empty() {
            "logic.layout needs at least one fixture save, named by the brief or definition"
                .to_string()
        } else {
            format!(
                "Carry {} in the piece's assets, so logic.layout can open it",
                named.join(" and ")
            )
        };
        return json!({"ok": true, "kind": "logic.layout", "verdict": "BLOCKED", "failures": [], "runs": [], "ask": ask, "missing": missing});
    }
    let (mut failures, mut runs) = (Vec::new(), Vec::new());
    for (sha, bytes, header, programs) in &fixtures {
        let old = match old_of(programs) {
            Ok(p) => p,
            Err(e) => {
                failures
                    .push(json!({"save": sha, "field": "open", "replica": "old", "refused": e}));
                continue;
            }
        };
        let k = header["step"].as_i64().unwrap_or(0);
        let slot = header["slot"].as_i64().unwrap_or(1);
        let mut probes = super::probe_entries(&current, k);
        if probes.is_empty() {
            probes.push((String::new(), Vec::new()));
        }
        for (control, entries) in &probes {
            let run = |piece: &Rc<Piece>| {
                replica(
                    piece,
                    (sha, bytes, slot),
                    entries,
                    k + steps,
                    &same,
                    planted,
                    adapter,
                )
            };
            let (now, then) = match (run(&current), run(&old)) {
                (Ok(a), Ok(b)) => (a, b),
                (Err(e), _) => {
                    failures.push(
                        json!({"save": sha, "field": "open", "replica": "current", "refused": e}),
                    );
                    continue;
                }
                (_, Err(e)) => {
                    failures.push(
                        json!({"save": sha, "field": "open", "replica": "old", "refused": e}),
                    );
                    continue;
                }
            };
            for (replica, r) in [("current", &now), ("old", &then)] {
                for trap in &r.traps {
                    failures.push(
                        json!({"save": sha, "field": "trap", "replica": replica, "trap": trap}),
                    );
                }
            }
            for array in &same {
                if let Some((step, element)) = first_difference(&now.steps, &then.steps, array) {
                    failures.push(json!({"save": sha, "field": "array", "array": array, "element": element, "step": step, "control": control}));
                }
            }
            runs.push(json!({"save": sha, "via": now.via, "control": control,
                "entries": entries.iter().map(Entry::to_json).collect::<Vec<_>>(), "from": k,
                "current": now.steps, "old": then.steps}));
        }
    }
    let verdict = if failures.is_empty() { "PASS" } else { "FAIL" };
    json!({"ok": true, "kind": "logic.layout", "verdict": verdict, "failures": failures, "runs": runs})
}

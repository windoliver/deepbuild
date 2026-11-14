//! logic.determinism (canvas primitives: Check input: logic kinds; #532): the bake run twice from
//! step 0 and once from each checkpoint before each sampled time, passing only when every step
//! hash and array matches, the full-state hashes match at each checkpoint, and each continuation
//! probe agrees: from both states, a seeded entry for one control the item reads, then 60 steps,
//! gives the same arrays and full-state hashes, one probe per control. Equal step hashes alone
//! never pass. The bake is played back too (#547): each step's arrays rebuilt from its ranges and
//! whole arrays must be the ones a run from step 0 wrote, or the first step, array and element
//! that differ are named.

use std::collections::BTreeMap;
use std::f64::consts::FRAC_1_SQRT_2;
use std::rc::Rc;

use serde_json::{json, Map, Value};

use crate::bake::{self, Player};
use crate::piece::{h64, Piece, Read};
use crate::point::Point;
use crate::world::{track_of, Entry, Given, Record, StepRow, World};
use crate::Planted;

/// Steps a continuation probe runs on for.
pub const PROBE_STEPS: i64 = 60;

/// The probes from the state about to run step `s`: one per control any item reads, each a
/// seeded entry of that control stamped at step s.
fn probe_entries(piece: &Piece, s: i64) -> Vec<(String, Vec<Entry>)> {
    let len = piece.items.first().map_or(0, |i| i.step);
    let mut controls: Vec<String> = piece
        .items
        .iter()
        .flat_map(|i| i.layout.entries.iter().filter(|e| e.read == Read::Control))
        .map(|e| e.name.clone())
        .collect();
    controls.sort();
    controls.dedup();
    controls
        .into_iter()
        .map(|control| {
            let mut b = piece.seed.to_le_bytes().to_vec();
            b.extend(control.as_bytes());
            b.extend(s.to_le_bytes());
            // A value in (0, 1]: a press or a slider's move, never a release to 0; for a pick,
            // a row of its first set; for a point, a press on the ground under a ray from above.
            let h = h64(&b);
            let value = match piece.controls.get(&control) {
                Some((_, "pick")) => Given::Pick {
                    set: 0,
                    key: [(h & 0xff) as i64, (h >> 8 & 0xff) as i64],
                },
                Some((_, "point")) => {
                    let (x, z) = ((h & 0xff) as f64, (h >> 8 & 0xff) as f64);
                    let down = [0.0, -FRAC_1_SQRT_2, -FRAC_1_SQRT_2];
                    let press = json!({"phase": "press", "button": "primary", "ground": [x, 0.0, z],
                        "ray": {"origin": [x, 10.0, z + 10.0], "dir": down}});
                    Given::Point(Point::parse(&press).expect("a seeded press is a point"))
                }
                _ => Given::Number(((h >> 11) as f64 + 1.0) / (1u64 << 53) as f64),
            };
            let entry = Entry {
                t: s * len,
                seq: 0,
                control: control.clone(),
                value,
                writer: "you".into(),
                player: 1,
            };
            (control, vec![entry])
        })
        .collect()
}

/// A probe's run: its rows and each item's full-state hash after it.
struct Probed {
    rows: BTreeMap<i64, StepRow>,
    deep: Map<String, Value>,
}

fn probe(w: &mut World, entries: &[Entry]) -> Result<Probed, Value> {
    let at = w.at().unwrap_or(0);
    let mut fork = w.fork(entries)?;
    let mut rec = Record::default();
    fork.run(at + PROBE_STEPS, &mut rec, &mut |_, _| {});
    Ok(Probed {
        rows: rec.rows().clone(),
        deep: fork.deep_hashes(),
    })
}

/// A run's first step whose step hash differs, and the first step and array where an array does.
type Parts = (Option<i64>, Option<(i64, String)>);

/// What a check that compares step hashes alone sees of a run: no full-state hash, no array.
fn seen(hashes_only: bool, deep: Option<i64>, rows: Parts) -> (Option<i64>, Parts) {
    if hashes_only {
        (None, (rows.0, None))
    } else {
        (deep, rows)
    }
}

/// Item `id`'s first step at or after `from` whose step hash differs, and the first step and
/// array where one of its arrays differs.
fn parts(a: &BTreeMap<i64, StepRow>, b: &BTreeMap<i64, StepRow>, id: &str, from: i64) -> Parts {
    let prefix = format!("{id}.");
    let (mut hash, mut array) = (None, None);
    for (k, (ia, aa)) in a.range(from..) {
        let Some((ib, ab)) = b.get(k) else {
            hash = hash.or(Some(*k));
            continue;
        };
        if hash.is_none()
            && ia.get(id).and_then(|x| x.get("hash")) != ib.get(id).and_then(|x| x.get("hash"))
        {
            hash = Some(*k);
        }
        if array.is_none() {
            if let Some((n, _)) = aa
                .iter()
                .find(|(n, v)| n.starts_with(&prefix) && ab.get(*n) != Some(*v))
            {
                array = Some((*k, n.clone()));
            }
        }
        if hash.is_some() && array.is_some() {
            break;
        }
    }
    (hash, array)
}

/// One run's failure for item `id`, or none: the first checkpoint whose full-state hash differs
/// (`deep`), the first step whose step hash or arrays differ, and the field first in the order
/// deep_hash, step_hash, array.
fn failure(
    id: &str,
    run: &str,
    from: Option<i64>,
    at: Option<i64>,
    deep: Option<i64>,
    rows: Parts,
    control: Option<&str>,
) -> Option<Value> {
    let (hash, array) = rows;
    let field = if deep.is_some() {
        "deep_hash"
    } else if hash.is_some() {
        "step_hash"
    } else if array.is_some() {
        "array"
    } else {
        return None;
    };
    let step = match (hash, &array) {
        (Some(h), Some((a, _))) => Some(h.min(*a)),
        (h, a) => h.or(a.as_ref().map(|x| x.0)),
    };
    Some(
        json!({"item": id, "run": run, "from": from, "at": at, "checkpoint": deep, "step": step, "field": field,
        "array": array.map(|x| x.1), "element": null, "control": control}),
    )
}

/// Item `id`'s first checkpoint in `mine`, after step `after`, whose full-state hash differs from
/// the straight run's at that step.
fn first_deep(mine: &Record, straight: &Record, id: &str, after: i64) -> Option<i64> {
    let theirs = straight.deep(id);
    mine.deep(id)
        .into_iter()
        .filter(|(k, _)| *k > after)
        .find(|x| !theirs.contains(x))
        .map(|(k, _)| k)
}

/// logic.determinism over a bake of `steps` steps, sampled at the steps `at`: `{ok, kind,
/// verdict, failures}` (the #532 acceptance README: logic.determinism).
pub fn determinism(
    piece: &Rc<Piece>,
    entries: &[Entry],
    steps: i64,
    at: &[i64],
    planted: Planted,
) -> Result<Value, Value> {
    let hashes_only = planted.check_step_hashes_only;
    let mut failures: Vec<Value> = Vec::new();
    // The straight run, with each control's probe from its state at each sampled step.
    let mut a = Record::default();
    let mut straight = World::new(
        piece.clone(),
        track_of(entries),
        true,
        planted,
        &mut a,
        None,
    )?;
    let mut probes: BTreeMap<(i64, String), Probed> = BTreeMap::new();
    let mut failed: Option<Value> = None;
    straight.run(steps, &mut a, &mut |w, k| {
        if hashes_only || !at.contains(&k) {
            return;
        }
        for (control, e) in probe_entries(&w.piece, k) {
            match probe(w, &e) {
                Ok(p) => {
                    probes.insert((k, control), p);
                }
                Err(e) => failed = Some(e),
            }
        }
    });
    if let Some(e) = failed {
        return Err(e);
    }
    for t in &a.traps {
        failures.push(json!({"item": t.get("item"), "run": "twice", "from": null, "at": null, "checkpoint": null, "step": t.get("step"), "field": "trap", "array": null, "element": null, "control": null}));
    }
    // The second run from step 0, a bake as the first is, so its ring doubles its spacing where
    // the first one's did and takes the same checkpoints; and the straight run's bake played back
    // against it: before each step k, each item's arrays rebuilt from the bake as step k − 1 left
    // them.
    let mut b = Record::default();
    let mut players: Vec<Option<Player>> = piece
        .items
        .iter()
        .map(|i| (!hashes_only).then(|| Player::new(&a, i)))
        .collect();
    let mut played: Vec<Value> = Vec::new();
    World::new(
        piece.clone(),
        track_of(entries),
        true,
        planted,
        &mut b,
        None,
    )?
    .run(steps, &mut b, &mut |w, k| {
        for (i, item) in piece.items.iter().enumerate() {
            let differs = match players[i].as_mut().filter(|_| k > 0) {
                Some(p) => p
                    .at(k - 1)
                    .and_then(|rebuilt| bake::first_difference(item, rebuilt, w.write_region(i))),
                None => continue,
            };
            if let Some((array, element)) = differs {
                played.push(json!({"item": item.id, "run": "playback", "from": null, "at": null, "checkpoint": null,
                    "step": k - 1, "field": "array", "array": array, "element": element, "control": null}));
                players[i] = None;
            }
        }
    });
    failures.extend(played);
    for item in &piece.items {
        let (deep, rows) = seen(
            hashes_only,
            first_deep(&b, &a, &item.id, -1),
            parts(b.rows(), a.rows(), &item.id, 0),
        );
        failures.extend(failure(&item.id, "twice", None, None, deep, rows, None));
    }
    // For each sampled step, a seek from each checkpoint at or before it, its probes from its
    // state there, and its run on through the first checkpoint after it.
    let ring = straight.checkpoint_steps();
    for &s in at {
        let Some(next) = ring.iter().copied().find(|c| *c > s) else {
            continue;
        };
        for c in ring.iter().copied().filter(|c| *c <= s) {
            let mut w = straight.restore(c, None)?;
            let mut r = Record::default();
            w.run(s, &mut r, &mut |_, _| {});
            if !hashes_only {
                for (control, e) in probe_entries(piece, s) {
                    let mine = probe(&mut w, &e)?;
                    let Some(theirs) = probes.get(&(s, control.clone())) else {
                        continue;
                    };
                    for item in &piece.items {
                        let deep = (mine.deep.get(&item.id) != theirs.deep.get(&item.id))
                            .then_some(s + PROBE_STEPS);
                        if let Some(mut f) = failure(
                            &item.id,
                            "probe",
                            Some(c),
                            Some(s),
                            deep,
                            parts(&mine.rows, &theirs.rows, &item.id, s),
                            Some(&control),
                        ) {
                            f["checkpoint"] = Value::Null;
                            failures.push(f);
                        }
                    }
                }
            }
            w.run(next, &mut r, &mut |_, _| {});
            for item in &piece.items {
                let (deep, rows) = seen(
                    hashes_only,
                    first_deep(&r, &a, &item.id, c),
                    parts(r.rows(), a.rows(), &item.id, c),
                );
                failures.extend(failure(
                    &item.id,
                    "seek",
                    Some(c),
                    Some(s),
                    deep,
                    rows,
                    None,
                ));
            }
        }
    }
    let verdict = if failures.is_empty() { "PASS" } else { "FAIL" };
    Ok(json!({"ok": true, "kind": "logic.determinism", "verdict": verdict, "failures": failures}))
}

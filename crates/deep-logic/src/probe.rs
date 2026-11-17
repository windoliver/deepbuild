//! #1048: throwaway copies of a run's states, for the checks that test entries one at a time
//! (canvas primitives: Check input: `rules.legal`; the issue's `logic.edges`). The run's track
//! is played once; at each step asked for, the state the run reached there is copied, and each
//! test puts its entries in its own copy, stamped at the next step, and steps it `settle` steps,
//! so no test sees another's effects. A copy with no entry stepped the same way is the baseline
//! each test is compared with, so what the piece does on its own counts as no effect. An entry a
//! control can't hold is refused at check and reaches no step. It answers what each copy did:
//! the declared names that differ from the baseline, whether `accepted` and `refused` rose, the
//! first trap, any non-finite value written to a declared f64 array, and any value of a ranged
//! name outside its range, with the track that reproduces it. It judges nothing: the check does.

use std::collections::BTreeMap;
use std::rc::Rc;

use serde_json::{json, Value};

use crate::grid_bot::Iface;
use crate::piece::{check_in, History, Ty};
use crate::play::{gesture, refused, seeded};
use crate::world::{track_of, Entry, Given, Record, World};
use crate::Planted;

/// One test: a listed or drawn row of the interface, put as its action's gesture, or entries
/// given as they are (`{control, value}`).
enum Test {
    Row([i32; 3]),
    Entries(Vec<(String, Value)>),
}

fn test_of(v: &Value) -> Option<Test> {
    if let Some(r) = v.get("row").and_then(Value::as_array) {
        let n: Vec<i32> = r.iter().filter_map(|x| Some(x.as_i64()? as i32)).collect();
        return (n.len() == 3).then(|| Test::Row([n[0], n[1], n[2]]));
    }
    let list = v.get("entries")?.as_array()?;
    Some(Test::Entries(
        list.iter()
            .filter_map(|e| {
                Some((
                    e.get("control")?.as_str()?.to_string(),
                    e.get("value")?.clone(),
                ))
            })
            .collect(),
    ))
}

/// What a copy did over its settle steps.
#[derive(Default)]
struct Done {
    names: Vec<(String, Vec<Value>)>,
    trap: Option<Value>,
    nonfinite: Vec<Value>,
    out_of_range: Vec<Value>,
}

/// Every declared f64 array element of the piece's own items that isn't finite, read from the
/// bytes, since a JSON value can't hold one.
fn nonfinite(world: &World, step: i64) -> Vec<Value> {
    let mut out = Vec::new();
    for (i, item) in world.piece.items.iter().enumerate() {
        for w in item.writes.iter().filter(|w| w.ty == Ty::F64) {
            let Some(at) = item.write(&w.name).map(|r| r.offset as usize) else {
                continue;
            };
            let Some(bytes) = world.published[i].get(at..at + 8 * w.count as usize) else {
                continue;
            };
            for (row, b) in bytes.chunks(8).enumerate() {
                let x = f64::from_le_bytes(b.try_into().expect("8 bytes"));
                if !x.is_finite() {
                    out.push(json!({"path": format!("{}.{}", item.id, w.name), "row": row, "step": step,
                                    "value": if x.is_nan() { "NaN" } else if x > 0.0 { "+inf" } else { "-inf" }}));
                }
            }
        }
    }
    out
}

/// Probes `piece` (the logic module's piece) on a play call: `{seed, piece_seed?, track: [entry],
/// play: game.play@1, probe: {at: [{step, tests: [{row: [action, a, b]} | {entries: [{control,
/// value}]} | {edges: control}]}], settle: steps = 1, ranges: {path: [min, max]}}}`. An `edges`
/// test is one test for each edge value `edges` gives the control's declaration (its kind's, from
/// the input module's `control@1` entry, on its own range), each answered with its control and value.
pub fn probe(
    piece: &Value,
    stored: &dyn Fn(&str) -> Option<Vec<u8>>,
    call: &Value,
    edges: &dyn Fn(&Value) -> Vec<Value>,
) -> Result<Value, Value> {
    let (piece, _) = seeded(piece, call)?;
    let controls = piece.get("controls").cloned().unwrap_or(json!({}));
    let piece = Rc::new(
        check_in(
            &piece,
            &Planted::default(),
            &mut History::new(),
            stored,
            &[],
        )
        .map_err(|r| r.0)?,
    );
    let iface = match call.get("play").filter(|p| !p.is_null()) {
        Some(p) => Iface::of(p, &piece)?,
        None => {
            return Err(refused(
                "bad_input",
                json!("a probe reads the play interface's names: play"),
            ))
        }
    };
    let step = piece.items.first().map_or(705_600_000 / 60, |i| i.step);
    let probe = &call["probe"];
    let settle = probe
        .get("settle")
        .and_then(Value::as_i64)
        .unwrap_or(1)
        .max(1);
    let entries: Vec<Entry> = call
        .get("track")
        .and_then(Value::as_array)
        .map(|a| a.iter().map(Entry::parse).collect::<Option<_>>())
        .unwrap_or(Some(Vec::new()))
        .ok_or_else(|| refused("bad_input", json!("track: entries")))?;
    // The ranged names: each path's elements must stay in its range.
    let ranges: Vec<(String, usize, String, [f64; 2])> = probe
        .get("ranges")
        .and_then(Value::as_object)
        .into_iter()
        .flatten()
        .filter_map(|(p, r)| {
            let (id, name) = p.split_once('.')?;
            let i = piece.items.iter().position(|it| it.id == id)?;
            Some((
                p.clone(),
                i,
                name.to_string(),
                [r.get(0)?.as_f64()?, r.get(1)?.as_f64()?],
            ))
        })
        .collect();
    let mut at: BTreeMap<i64, Vec<(usize, Test)>> = BTreeMap::new();
    let mut n = 0;
    for a in probe
        .get("at")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
    {
        let k = a
            .get("step")
            .and_then(Value::as_i64)
            .filter(|k| *k >= 0)
            .ok_or_else(|| refused("bad_input", json!("at: [{step, tests}]")))?;
        for t in a
            .get("tests")
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
        {
            let list = match t.get("edges").and_then(Value::as_str) {
                Some(c) => {
                    let declared = controls.get(c).ok_or_else(|| {
                        refused(
                            "bad_input",
                            json!(format!("the piece declares no control {c}")),
                        )
                    })?;
                    edges(declared)
                        .into_iter()
                        .map(|v| Test::Entries(vec![(c.to_string(), v)]))
                        .collect()
                }
                None => vec![test_of(t).ok_or_else(|| {
                    refused("bad_input", json!("a test is {row}, {entries} or {edges}"))
                })?],
            };
            for t in list {
                at.entry(k).or_default().push((n, t));
                n += 1;
            }
        }
    }
    let mut rec = Record::default();
    let mut world = World::new(
        piece.clone(),
        track_of(&entries),
        false,
        Planted::default(),
        &mut rec,
        None,
    )?;
    let mut out: Vec<Value> = Vec::with_capacity(n);
    for (k, tests) in at {
        world.run_through(k * step, &mut rec);
        // The track that reproduces a copy: the run's entries a step through k read, then its own.
        let kept: Vec<Value> = entries
            .iter()
            .filter(|e| e.t <= k * step)
            .map(Entry::to_json)
            .collect();
        let base = settled(&mut world, &iface, &[], k, step, settle, &ranges)?;
        for (i, test) in tests {
            let given: Vec<(String, Given)> = match &test {
                Test::Row(row) => match iface.actions.get(row[0] as usize) {
                    Some(a) => gesture(&controls, a, *row)
                        .into_iter()
                        .map(|g| (a.control.clone(), g))
                        .collect(),
                    None => Vec::new(),
                },
                Test::Entries(list) => {
                    let mut g = Vec::new();
                    for (c, v) in list {
                        match Entry::parse(&json!({"t": 0, "control": c, "value": v})) {
                            Some(e) => g.push((c.clone(), e.value)),
                            None => g.push((c.clone(), Given::Text(String::new()))),
                        }
                    }
                    g
                }
            };
            let mut result = json!({"i": i, "step": k});
            if let Test::Entries(list) = &test {
                if let [(c, v)] = list.as_slice() {
                    result["control"] = json!(c);
                    result["value"] = v.clone();
                }
            }
            // An entry a control can't hold is refused at check, as the sandbox requires: it
            // reaches no step.
            let why = given.iter().find_map(|(c, g)| {
                if !piece.controls.contains_key(c) {
                    return Some(format!("the piece declares no control {c}"));
                }
                piece
                    .limits
                    .get(c)
                    .filter(|l| !l.admits(g))
                    .map(|_| format!("{c} can't hold {}", g.to_json()))
            });
            if let Some(why) = why {
                result["refused_at_check"] = json!(why);
                out.push(result);
                continue;
            }
            let put: Vec<Entry> = given
                .into_iter()
                .enumerate()
                .map(|(j, (control, value))| Entry {
                    t: (k + 1) * step,
                    seq: j as u32,
                    control,
                    value,
                    writer: "bot".into(),
                    player: 1,
                    as_of: None,
                    arrived: 0,
                })
                .collect();
            let done = settled(&mut world, &iface, &put, k, step, settle, &ranges)?;
            let changed: Vec<&str> = done
                .names
                .iter()
                .zip(&base.names)
                .filter(|(a, b)| a.1 != b.1)
                .map(|(a, _)| a.0.as_str())
                .collect();
            let first = |names: &[(String, Vec<Value>)], label: &str| {
                names
                    .iter()
                    .find(|(l, _)| l == label)
                    .and_then(|(_, v)| v.first().and_then(Value::as_f64))
            };
            let rose = |label: &str| match (first(&done.names, label), first(&base.names, label)) {
                (Some(a), Some(b)) => a > b,
                _ => false,
            };
            result["changed"] = json!(changed);
            result["accepted"] = json!(rose("accepted"));
            result["refused"] = json!(rose("refused"));
            if done.trap.is_some() || !done.nonfinite.is_empty() || !done.out_of_range.is_empty() {
                let mut track = kept.clone();
                track.extend(put.iter().map(Entry::to_json));
                result["trap"] = done.trap.unwrap_or(Value::Null);
                result["nonfinite"] = json!(done.nonfinite);
                result["out_of_range"] = json!(done.out_of_range);
                result["track"] = json!(track);
            }
            out.push(result);
        }
    }
    out.sort_by_key(|r| r["i"].as_u64());
    Ok(json!({"ok": true, "step": step, "tests": out}))
}

/// A copy of `world` at step k with `put` stamped at the next step, stepped `settle` steps.
fn settled(
    world: &mut World,
    iface: &Iface,
    put: &[Entry],
    k: i64,
    step: i64,
    settle: i64,
    ranges: &[(String, usize, String, [f64; 2])],
) -> Result<Done, Value> {
    let mut copy = world.fork(put)?;
    let mut rec = Record::default();
    let mut done = Done::default();
    for s in 1..=settle {
        copy.run_through((k + s) * step, &mut rec);
        done.nonfinite.extend(nonfinite(&copy, k + s));
        for (path, i, name, [lo, hi]) in ranges {
            for (row, v) in copy.array(*i, name).unwrap_or_default().iter().enumerate() {
                if let Some(x) = v.as_f64().filter(|x| x < lo || x > hi) {
                    done.out_of_range
                        .push(json!({"path": path, "row": row, "step": k + s, "value": x}));
                }
            }
        }
        if let Some(t) = rec.traps.first() {
            done.trap = Some(t.clone());
            break;
        }
    }
    done.names = iface.read(&copy);
    Ok(done)
}

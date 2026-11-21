//! Carry records (canvas primitives: Logic: carry records; #189): a step that writes 1 into the
//! giving item's `carry.request` writes its `out` arrays as that step left them, with its state
//! layout, document and program by hash, as a record kept where saves are: `<sha256>.carry`, one
//! JSON object whose bytes' sha256 names it, written under a temporary name and renamed once it
//! reads back whole. The viewer opens a record into the taking piece: it enters the input track as
//! one entry at step 0 by hash (`{t: 0, carry: sha256}`), and at step 0 the taking item's
//! `carry_in` read entry holds a u32 1 and the record's arrays in `carry_in`'s order, or a u32 0
//! and zeros without one. A record of another shape, or a layout `accepts` doesn't list, is
//! refused, naming the array or both layouts. A record never counts as evidence.

use std::fs;
use std::path::Path;

use serde_json::{json, Map, Value};
use sha2::Digest as _;

use crate::piece::{Item, Layout, Piece, Ty};
use crate::world::{Entry, Given, World};

/// The key a track keeps its carry record's entry under, which no control's ID can be.
pub const CARRY: &str = ":carry";

/// The giving item's `carry`: where its request i32 sits in its write region, and the arrays a
/// record holds, each with its type, offset and count.
#[derive(Clone, Debug)]
pub struct Carry {
    pub request: u32,
    pub out: Vec<(String, Ty, u32, u32)>,
}

/// The taking item's `carry_in`: the record's arrays in order, each with its type and count, and
/// the state layouts of the items whose records it takes.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct CarryIn {
    pub arrays: Vec<(String, Ty, u32)>,
    pub accepts: Vec<String>,
}

impl CarryIn {
    /// The read entry's bytes: a u32, then each array as a write of its type and count.
    pub fn size(&self) -> u32 {
        4 + self
            .arrays
            .iter()
            .map(|(_, t, n)| t.size() * n)
            .sum::<u32>()
    }
}

fn refusal(field: &str, what: String) -> Value {
    json!({"code": "field", "what": what, "field": field})
}

/// `carry_in`, checked: arrays of bool, i32 or f64 with a count, and a list of layouts.
pub(crate) fn carry_in_of(v: &Value) -> Result<CarryIn, Value> {
    let bad = |what: &str| refusal("carry_in", what.to_string());
    if let Some(k) = v
        .as_object()
        .into_iter()
        .flat_map(Map::keys)
        .find(|k| !["arrays", "accepts"].contains(&k.as_str()))
    {
        return Err(bad(&format!("carry_in has no field {k}")));
    }
    let arrays = v
        .get("arrays")
        .and_then(Value::as_object)
        .filter(|a| !a.is_empty())
        .ok_or_else(|| bad("carry_in.arrays names the record's arrays, each {type, count}"))?
        .iter()
        .map(|(name, a)| {
            let ty = a
                .get("type")
                .and_then(Value::as_str)
                .and_then(Ty::named)
                .filter(|t| matches!(t, Ty::Bool | Ty::I32 | Ty::F64));
            let count = a.get("count").map_or(Some(1), Value::as_u64);
            match (ty, count.filter(|n| (1..=4096).contains(n))) {
                (Some(t), Some(n)) => Ok((name.clone(), t, n as u32)),
                _ => Err(bad(&format!(
                    "carry_in.arrays.{name} is {{type: bool, i32 or f64, count: 1 to 4096}}"
                ))),
            }
        })
        .collect::<Result<_, _>>()?;
    let accepts = v
        .get("accepts")
        .and_then(Value::as_array)
        .and_then(|a| a.iter().map(|l| l.as_str().map(str::to_string)).collect())
        .ok_or_else(|| bad("carry_in.accepts lists the state layouts it takes records of"))?;
    Ok(CarryIn { arrays, accepts })
}

/// `carry`, checked against the item's region map: `request` one of its own i32 arrays, and `out`
/// its own arrays.
pub(crate) fn carry_of(
    v: &Value,
    layout: &Layout,
    writes: &[crate::piece::Write],
) -> Result<Carry, Value> {
    let bad = |what: String| refusal("carry", what);
    if let Some(k) = v
        .as_object()
        .into_iter()
        .flat_map(Map::keys)
        .find(|k| !["request", "out"].contains(&k.as_str()))
    {
        return Err(bad(format!("carry has no field {k}")));
    }
    let entry = |n: &str| {
        layout
            .entries
            .iter()
            .find(|e| e.region == "writes" && e.name == n)
    };
    let request = v
        .get("request")
        .and_then(Value::as_str)
        .and_then(entry)
        .filter(|e| e.ty == "i32")
        .ok_or_else(|| bad("carry.request names one of the item's own i32 arrays".into()))?
        .offset;
    let out = v
        .get("out")
        .and_then(Value::as_array)
        .filter(|a| !a.is_empty())
        .ok_or_else(|| bad("carry.out lists the arrays the record holds".into()))?
        .iter()
        .map(|n| {
            let n = n.as_str().unwrap_or_default();
            let w = writes.iter().find(|w| w.name == n);
            match (entry(n), w) {
                (Some(e), Some(w)) if matches!(w.ty, Ty::Bool | Ty::I32 | Ty::F64) => {
                    Ok((n.to_string(), w.ty, e.offset, w.count))
                }
                _ => Err(bad(format!("carry.out names {n}, which isn't one of the item's own bool, i32 or f64 arrays"))),
            }
        })
        .collect::<Result<_, _>>()?;
    Ok(Carry { request, out })
}

fn sha(bytes: &[u8]) -> String {
    sha2::Sha256::digest(bytes)
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect()
}

/// The records the steps before step `k` asked for, written now that every item is at step k
/// (into the saves folder, or held for the host where none keeps them, as in the web player).
pub(crate) fn due(w: &mut World, k: i64) {
    let piece = w.piece.clone();
    for (item, l) in piece.items.iter().zip(&w.lives) {
        let Some(c) = &item.carry else { continue };
        let asked = l.arrays.get(c.request as usize..c.request as usize + 4);
        if l.last != k - 1 || asked != Some(&1i32.to_le_bytes()[..]) {
            continue;
        }
        let arrays: Map<String, Value> = c
            .out
            .iter()
            .map(|(n, ty, at, count)| {
                let size = ty.size() as usize;
                let values = (0..*count as usize)
                    .map(|j| ty.value(&l.arrays[*at as usize + j * size..][..size]))
                    .collect();
                (n.clone(), Value::Array(values))
            })
            .collect();
        let record = json!({
            "from": {"layout": crate::saves::layout_of(item), "document": piece.document, "program": item.program},
            "step": k - 1, "arrays": arrays,
        });
        let bytes = record.to_string().into_bytes();
        let hash = sha(&bytes);
        let out = match &w.saves_dir {
            None => json!({"item": item.id, "step": k - 1, "hash": hash, "record": record}),
            Some(dir) => match write(dir, &hash, &bytes) {
                Ok(file) => json!({"item": item.id, "step": k - 1, "hash": hash, "file": file}),
                Err(e) => {
                    json!({"ok": false, "code": "carry_failed", "item": item.id, "step": k - 1, "what": e})
                }
            },
        };
        w.saved.push(json!({"carry": out}));
    }
}

/// Writes a record under a temporary name and renames it once it reads back whole.
fn write(dir: &Path, hash: &str, bytes: &[u8]) -> Result<std::path::PathBuf, String> {
    let io = |e: std::io::Error| format!("{}: {e}", dir.display());
    let tmp = dir.join(format!("{hash}.carry.tmp"));
    fs::write(&tmp, bytes).map_err(io)?;
    if fs::read(&tmp).map(|b| sha(&b)).map_err(io)? != hash {
        let _ = fs::remove_file(&tmp);
        return Err("the record didn't read back whole".into());
    }
    let file = dir.join(format!("{hash}.carry"));
    fs::rename(&tmp, &file).map_err(io)?;
    Ok(file)
}

/// The records the world wrote since the last call, taken from beside its saves.
pub fn written(w: &mut World) -> Vec<Value> {
    let (carries, saves): (Vec<Value>, Vec<Value>) = std::mem::take(&mut w.saved)
        .into_iter()
        .partition(|s| s.get("carry").is_some());
    w.saved = saves;
    carries.into_iter().map(|c| c["carry"].clone()).collect()
}

/// The record named `hash` in the folder, when its bytes hash to its name.
pub fn read(dir: &Path, hash: &str) -> Result<Value, Value> {
    let bytes = fs::read(dir.join(format!("{hash}.carry"))).ok();
    bytes
        .filter(|b| sha(b) == hash)
        .and_then(|b| serde_json::from_slice(&b).ok())
        .ok_or_else(|| json!({"ok": false, "code": "carry_damaged", "record": hash}))
}

/// What keeps `record` from entering `piece`: each array of `carry_in` whose type or count the
/// record's doesn't match, or that one side lacks, and a layout `accepts` doesn't list.
pub fn differs(piece: &Piece, record: &Value) -> Vec<Value> {
    let mut out = Vec::new();
    let Some(ci) = piece.items.iter().find_map(|i| i.carry_in.as_ref()) else {
        return vec![json!({"what": "carry_in", "piece": null})];
    };
    let theirs = record["arrays"].as_object().cloned().unwrap_or_default();
    let shape = |v: &Value| {
        let a = v.as_array();
        let whole = a.is_some_and(|a| a.iter().all(|x| x.is_i64() || x.is_boolean()));
        json!({"type": if whole { "i32" } else { "f64" }, "count": a.map_or(0, Vec::len)})
    };
    for (name, ty, count) in &ci.arrays {
        let mine = json!({"type": ty.name(), "count": count});
        match theirs.get(name) {
            None => {
                out.push(json!({"what": "array", "array": name, "record": null, "piece": mine}))
            }
            Some(v) => {
                let fits = v.as_array().is_some_and(|a| {
                    a.len() == *count as usize
                        && a.iter().all(|x| match ty {
                            Ty::F64 => x.is_number(),
                            _ => x.is_i64() || x.is_boolean(),
                        })
                });
                if !fits {
                    out.push(
                        json!({"what": "array", "array": name, "record": shape(v), "piece": mine}),
                    );
                }
            }
        }
    }
    for (name, v) in theirs
        .iter()
        .filter(|(n, _)| !ci.arrays.iter().any(|(m, _, _)| m == *n))
    {
        out.push(json!({"what": "array", "array": name, "record": shape(v), "piece": null}));
    }
    let layout = &record["from"]["layout"];
    if !layout
        .as_str()
        .is_some_and(|l| ci.accepts.iter().any(|a| a == l))
    {
        out.push(json!({"what": "layout", "record": layout, "accepts": ci.accepts}));
    }
    out
}

/// The record's entry on the input track: at step 0, by hash.
pub fn entry(hash: &str, record: &Value) -> Entry {
    Entry {
        t: 0,
        seq: 0,
        control: CARRY.into(),
        value: Given::Carry {
            hash: hash.into(),
            arrays: record["arrays"].clone(),
        },
        writer: "you".into(),
        player: 1,
        as_of: None,
        arrived: 0,
    }
}

/// Each carry entry of `entries` with its record's arrays, read by hash from `dir`; refused when
/// one is missing, damaged or doesn't fit the piece.
pub fn resolve(piece: &Piece, dir: Option<&Path>, entries: &mut [Entry]) -> Result<(), Value> {
    for e in entries.iter_mut().filter(|e| e.control == CARRY) {
        let Given::Carry { hash, arrays } = &mut e.value else {
            continue;
        };
        let dir = dir.ok_or_else(|| json!({"ok": false, "code": "carry_damaged", "record": hash, "what": "no saves folder keeps the record"}))?;
        let record = read(dir, hash)?;
        let d = differs(piece, &record);
        if !d.is_empty() {
            return Err(
                json!({"ok": false, "code": "carry_refused", "record": hash, "differs": d}),
            );
        }
        *arrays = record["arrays"].clone();
    }
    Ok(())
}

/// The `carry_in` read entry at step `k`: at step 0, a u32 1 and the record's arrays when the
/// track holds one; otherwise left as zeros.
pub(crate) fn fill(item: &Item, track: Option<&Vec<Entry>>, k: i64, region: &mut [u8]) {
    let (Some(ci), 0) = (&item.carry_in, k) else {
        return;
    };
    let Some(Given::Carry { arrays, .. }) = track.and_then(|t| t.first()).map(|e| &e.value) else {
        return;
    };
    region[..4].copy_from_slice(&1u32.to_le_bytes());
    let mut at = 4;
    for (name, ty, count) in &ci.arrays {
        for j in 0..*count as usize {
            let x = &arrays[name][j];
            let b = match ty {
                Ty::F64 => x.as_f64().unwrap_or(0.0).to_le_bytes().to_vec(),
                _ => (x.as_i64().unwrap_or(i64::from(x.as_bool() == Some(true))) as i32)
                    .to_le_bytes()
                    .to_vec(),
            };
            region[at..at + b.len()].copy_from_slice(&b);
            at += b.len();
        }
    }
}

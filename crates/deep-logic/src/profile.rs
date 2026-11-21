//! Profile records (canvas primitives: Logic: saves; #276): a few numbers a piece keeps between
//! sessions, such as a player's level, chosen look and settings. A logic item declares
//! `profile: {arrays: {name → {type, count}}, request: array name}`, each array one of its own, at
//! most 64 KiB of numbers: a step that writes 1 into `request` writes those arrays as that step
//! left them as one record kept where saves are, `<sha256>.profile`, one JSON object whose bytes'
//! SHA-256 names it, written under a temporary name and renamed once it reads back whole, so a
//! record of the same numbers is the same file. The folder keeps the newest record, by when it was
//! written, and the one before it.
//!
//! It is the one record the app reopens by itself: when the piece starts (`open`), the newest
//! record that reads back whole enters the input track as one entry at step 0, by hash and with
//! its arrays beside it (`{t: 0, profile: sha256, arrays}`), so a replay reads the record its run
//! read, whatever the store holds since. At step 0 the item's `profile` read entry holds a block
//! for each seat (one played alone, the net item's `players` in a match), player 1's first: a u32
//! 1 and that player's arrays in `profile`'s order, or a u32 0 and zeros without one. A record is
//! bound by its arrays' shape alone: a content or program change keeps it, and a shape change
//! refuses it with one notice naming the first array that differs, the piece then starting with
//! zeros and the old record staying. Checks start with zeros unless their call names a fixture
//! record the piece carries. A record moves numbers only and never counts as evidence.

use std::fs;
use std::path::{Path, PathBuf};

use base64::{engine::general_purpose::STANDARD as B64, Engine as _};
use serde_json::{json, Map, Value};
use sha2::Digest as _;

use crate::piece::{Item, Layout, Piece, Read, Region, Ty, Write};
use crate::track::Track;
use crate::world::{Entry, Given, World};
use crate::Planted;

/// The key a track keeps its profile entries under, which no control's ID can be.
pub const PROFILE: &str = ":profile";

/// The most bytes of numbers a profile holds: 64 KiB (estimate: a design cap that keeps the step-0
/// entry small in a match).
pub const CAP: u64 = 64 * 1024;

/// An item's `profile`: where its request i32 sits in its write region, the arrays a record holds,
/// each its name, type, offset in the write region and count, and the seats its read entry has a
/// block for.
#[derive(Clone, Debug)]
pub struct Profile {
    pub request: u32,
    pub arrays: Vec<(String, Ty, u32, u32)>,
    pub seats: u32,
}

impl Profile {
    /// Its shape, `{name → {type, count}}`, in declaration order: what binds a record.
    pub fn shape(&self) -> Value {
        Value::Object(
            self.arrays
                .iter()
                .map(|(n, t, _, c)| (n.clone(), json!({"type": t.name(), "count": c})))
                .collect(),
        )
    }
}

/// A seat's block in the read entry: a u32, then each array as a write of its type and count.
pub(crate) fn block(shape: &[(String, Ty, u32)]) -> u32 {
    4 + shape.iter().map(|(_, t, n)| t.size() * n).sum::<u32>()
}

fn refusal(what: String) -> Value {
    crate::piece::refusal("field", what, json!({"field": "profile"}))
}

/// `profile`'s shape as declared, checked: arrays of bool, i32 or f64 with a count, at most
/// [`CAP`] bytes of numbers in all, else refused, naming its size.
pub(crate) fn shape_of(v: &Value) -> Result<Vec<(String, Ty, u32)>, Value> {
    if let Some(k) = v
        .as_object()
        .into_iter()
        .flat_map(Map::keys)
        .find(|k| !["arrays", "request"].contains(&k.as_str()))
    {
        return Err(refusal(format!("profile has no field {k}")));
    }
    let arrays: Vec<(String, Ty, u64)> = v
        .get("arrays")
        .and_then(Value::as_object)
        .filter(|a| !a.is_empty())
        .ok_or_else(|| {
            refusal("profile.arrays names the record's arrays, each {type, count}".into())
        })?
        .iter()
        .map(|(name, a)| {
            let ty = a
                .get("type")
                .and_then(Value::as_str)
                .and_then(Ty::named)
                .filter(|t| matches!(t, Ty::Bool | Ty::I32 | Ty::F64));
            match (ty, a.get("count").map_or(Some(1), Value::as_u64)) {
                (Some(t), Some(n)) if n >= 1 => Ok((name.clone(), t, n)),
                _ => Err(refusal(format!(
                    "profile.arrays.{name} is {{type: bool, i32 or f64, count ≥ 1}}"
                ))),
            }
        })
        .collect::<Result<_, _>>()?;
    let size: u64 = arrays.iter().map(|(_, t, n)| u64::from(t.size()) * n).sum();
    if size > CAP {
        let mut r = refusal(format!(
            "profile holds {size} bytes of numbers, past its cap of {CAP} bytes (64 KiB)"
        ));
        r["size"] = json!(size);
        return Err(r);
    }
    Ok(arrays
        .into_iter()
        .map(|(n, t, c)| (n, t, c as u32))
        .collect())
}

/// `profile`, checked against the item's region map: `request` one of its own i32 arrays, and
/// each array one of its own of the type and count declared.
pub(crate) fn profile_of(
    v: &Value,
    layout: &Layout,
    writes: &[Write],
    seats: u32,
) -> Result<Profile, Value> {
    let declared = shape_of(v)?;
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
        .ok_or_else(|| refusal("profile.request names one of the item's own i32 arrays".into()))?
        .offset;
    let arrays = declared
        .into_iter()
        .map(
            |(n, ty, count)| match (entry(&n), writes.iter().find(|w| w.name == n)) {
                (Some(e), Some(w)) if w.ty == ty && w.count == count => {
                    Ok((n, ty, e.offset, count))
                }
                _ => Err(refusal(format!(
                "profile.arrays names {n}, which isn't one of the item's own arrays of {count} {}",
                ty.name()
            ))),
            },
        )
        .collect::<Result<_, _>>()?;
    Ok(Profile {
        request,
        arrays,
        seats,
    })
}

fn sha(bytes: &[u8]) -> String {
    sha2::Sha256::digest(bytes)
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect()
}

/// A record in the folder: its name's hash, its file, whether its bytes still have that hash, and
/// the record they decode to.
struct Listed {
    hash: String,
    path: PathBuf,
    whole: bool,
    record: Option<Value>,
    at: std::time::SystemTime,
}

/// The folder's records, newest first by when they were written (a record's file is renamed into
/// place once written, so its time is its write's).
fn listed(dir: &Path) -> Vec<Listed> {
    let mut out: Vec<Listed> = fs::read_dir(dir)
        .into_iter()
        .flatten()
        .flatten()
        .filter_map(|e| {
            let path = e.path();
            let hash = path
                .file_name()?
                .to_str()?
                .strip_suffix(".profile")?
                .to_string();
            let bytes = fs::read(&path).ok();
            let whole = bytes.as_deref().is_some_and(|b| sha(b) == hash);
            let record = bytes.and_then(|b| serde_json::from_slice(&b).ok());
            let at = e.metadata().and_then(|m| m.modified()).ok()?;
            Some(Listed {
                hash,
                path,
                whole,
                record,
                at,
            })
        })
        .collect();
    out.sort_by(|a, b| b.at.cmp(&a.at).then_with(|| a.hash.cmp(&b.hash)));
    out
}

/// The newest record in `dir` that reads back whole, `(hash, record)`, and each record file whose
/// bytes fail the hash that names it, `{hash, file}`.
pub fn newest(dir: &Path) -> (Option<(String, Value)>, Vec<Value>) {
    let all = listed(dir);
    let damaged = all
        .iter()
        .filter(|l| !l.whole)
        .map(|l| json!({"hash": l.hash, "file": l.path}))
        .collect();
    let found = all
        .into_iter()
        .find(|l| l.whole && l.record.is_some())
        .map(|l| (l.hash, l.record.unwrap_or_default()));
    (found, damaged)
}

/// The first array of the piece's profile whose shape the record's doesn't match, or that one
/// side lacks, as `{array, record, piece}`; `None` when the shapes are the same.
pub fn differs(p: &Profile, record: &Value) -> Option<Value> {
    let theirs = record["shape"].as_object().cloned().unwrap_or_default();
    let mine = p.shape();
    let mine = mine.as_object().cloned().unwrap_or_default();
    for (name, want) in &mine {
        if theirs.get(name) != Some(want) {
            return Some(json!({"array": name, "record": theirs.get(name), "piece": want}));
        }
    }
    theirs
        .iter()
        .find(|(n, _)| !mine.contains_key(*n))
        .map(|(n, v)| json!({"array": n, "record": v, "piece": null}))
}

/// The notice a record the piece's shape refuses gives, naming the first array that differs.
pub fn refused(hash: &str, d: &Value) -> Value {
    let said = |s: &Value| match s.as_object() {
        Some(s) => format!("{} {}", s["count"], s["type"].as_str().unwrap_or("")),
        None => "nothing".into(),
    };
    let array = d["array"].as_str().unwrap_or("");
    json!({"code": "profile_refused", "record": hash, "array": array, "differs": d,
        "notice": format!("The profile record {hash} isn't opened: its {array} holds {} where this piece's holds {}. The piece starts with zeros and the record stays.",
            said(&d["record"]), said(&d["piece"])),
        "what": format!("its {array} differs from this piece's")})
}

/// The record's entry on the input track: at step 0, by hash, with its arrays beside it, as
/// player `player`'s.
pub fn entry(hash: &str, record: &Value, player: u32) -> Entry {
    Entry {
        t: 0,
        seq: 0,
        control: PROFILE.into(),
        value: Given::Profile {
            hash: hash.into(),
            arrays: record["arrays"].clone(),
        },
        writer: "you".into(),
        player,
        as_of: None,
        arrived: 0,
    }
}

/// The piece's profile, when one of its items declares one.
pub fn of(piece: &Piece) -> Option<&Profile> {
    piece.items.iter().find_map(|i| i.profile.as_ref())
}

/// The data assets the item of the profile names, by hash: what a planted record binds.
fn content(piece: &Piece) -> Vec<String> {
    let item = piece.items.iter().find(|i| i.profile.is_some());
    item.map(|i| i.assets.iter().map(|(h, _)| h.clone()).collect())
        .unwrap_or_default()
}

/// The piece starting in the app: with no profile entry on the track, the newest record in `dir`
/// that reads back whole enters it at step 0 when its shape matches the piece's. `{record,
/// damaged, notices}`: the record it opened, each record file that failed its hash, and a shape
/// refusal. With the call's `fresh`, the viewer's start fresh, nothing enters and the stored
/// record stays.
pub fn reopen(
    piece: &Piece,
    line: &Value,
    planted: &Planted,
    entries: &mut Vec<Entry>,
) -> Option<Value> {
    let dir = line.get("saves_dir").and_then(Value::as_str).map(Path::new);
    let (Some(p), Some(dir)) = (of(piece), dir) else {
        return None;
    };
    if line.get("fresh") == Some(&json!(true)) || entries.iter().any(|e| e.control == PROFILE) {
        return Some(json!({"record": null, "damaged": [], "notices": []}));
    }
    let (found, damaged) = newest(dir);
    let (mut record, mut notices) = (Value::Null, Vec::new());
    if let Some((hash, r)) = found {
        // Planted (#276 AC2): a record bound to the data assets of the item that wrote it.
        let assets = content(piece);
        let bound = r["content"].as_array().cloned().unwrap_or_default();
        let unbound = assets.iter().find(|a| !bound.contains(&json!(a)));
        match (
            differs(p, &r),
            unbound.filter(|_| planted.profile_bound_to_content),
        ) {
            (Some(d), _) => notices.push(refused(&hash, &d)),
            (None, Some(a)) => notices.push(
                json!({"code": "profile_refused", "record": hash, "asset": a,
                "what": format!("its content lacks the asset {a}")}),
            ),
            (None, None) => {
                entries.insert(0, entry(&hash, &r, 1));
                record = json!(hash);
            }
        }
    }
    Some(json!({"record": record, "damaged": damaged, "notices": notices}))
}

/// What a match copy's player brings to step 0 (Net `net@1`): the newest record in its viewer's
/// folder that reads back whole and fits the piece's shape, as `{profile, arrays}`.
pub fn brought(piece: &Piece, dir: &Path) -> Option<Value> {
    let (hash, r) = newest(dir).0?;
    differs(of(piece)?, &r)
        .is_none()
        .then(|| json!({"profile": hash, "arrays": r["arrays"]}))
}

/// Each profile entry of `entries` whose arrays a host didn't carry beside its hash, read by
/// hash from `dir`; refused when the record is missing or damaged.
pub fn resolve(dir: Option<&Path>, planted: &Planted, entries: &mut [Entry]) -> Result<(), Value> {
    for e in entries.iter_mut().filter(|e| e.control == PROFILE) {
        let Given::Profile { hash, arrays } = &mut e.value else {
            continue;
        };
        // Planted (#276 AC1): a replay that reads the store's newest record, not its own.
        if planted.profile_replay_reads_store {
            if let Some((_, r)) = dir.and_then(|d| newest(d).0) {
                *arrays = r["arrays"].clone();
            }
            continue;
        }
        if !arrays.is_null() {
            continue;
        }
        let bytes = dir.and_then(|d| fs::read(d.join(format!("{hash}.profile"))).ok());
        let record: Value = bytes
            .filter(|b| sha(b) == *hash)
            .and_then(|b| serde_json::from_slice(&b).ok())
            .ok_or_else(|| json!({"ok": false, "code": "profile_damaged", "record": hash}))?;
        *arrays = record["arrays"].clone();
    }
    Ok(())
}

/// What a check's replica starts from (Check input: logic kinds): zeros, whatever the viewer's
/// store holds, unless its call names a fixture record, `profile: <asset ID>`, whose bytes the
/// piece carries in its assets: then that record's entry at step 0.
pub fn fixture(
    piece: &Piece,
    line: &Value,
    planted: &Planted,
    entries: &mut Vec<Entry>,
) -> Result<(), Value> {
    if of(piece).is_none() || entries.iter().any(|e| e.control == PROFILE) {
        return Ok(());
    }
    let found = match line.get("profile").and_then(Value::as_str) {
        Some(id) => {
            let bytes = line
                .pointer(&format!("/piece/assets/{id}"))
                .and_then(Value::as_str)
                .and_then(|b| B64.decode(b).ok())
                .filter(|b| sha(b) == id);
            let record = bytes.and_then(|b| serde_json::from_slice::<Value>(&b).ok()).ok_or_else(|| {
                json!({"ok": false, "code": "bad_input", "what": format!("the piece carries no profile record {id}")})
            })?;
            Some((id.to_string(), record))
        }
        // Planted (#276 AC5): a check that starts from the viewer's stored record.
        None if planted.check_reads_viewer_profile => line
            .get("saves_dir")
            .and_then(Value::as_str)
            .and_then(|d| newest(Path::new(d)).0),
        None => None,
    };
    if let Some((hash, record)) = found {
        entries.insert(0, entry(&hash, &record, 1));
    }
    Ok(())
}

/// The records the steps before step `k` asked for, written now that every item is at step k
/// (into the saves folder, or held for the host where none keeps them: the web player, a match).
pub(crate) fn due(w: &mut World, k: i64) {
    let piece = w.piece.clone();
    for (item, l) in piece.items.iter().zip(&w.lives) {
        let Some(p) = &item.profile else { continue };
        let asked = l.arrays.get(p.request as usize..p.request as usize + 4);
        if l.last != k - 1 || asked != Some(&1i32.to_le_bytes()[..]) {
            continue;
        }
        let arrays: Map<String, Value> = p
            .arrays
            .iter()
            .map(|(n, ty, at, count)| {
                let size = ty.size() as usize;
                let values = (0..*count as usize)
                    .map(|j| ty.value(&l.arrays[*at as usize + j * size..][..size]))
                    .collect();
                (n.clone(), Value::Array(values))
            })
            .collect();
        let mut record = json!({"shape": p.shape(), "arrays": arrays, "step": k - 1});
        if w.planted.profile_bound_to_content {
            record["content"] = json!(content(&piece));
        }
        let out = match &w.saves_dir {
            None => json!({"item": item.id, "step": k - 1, "record": record}),
            Some(dir) => match write(dir, &record) {
                Ok((hash, file)) => {
                    json!({"item": item.id, "step": k - 1, "hash": hash, "file": file})
                }
                Err(e) => {
                    json!({"ok": false, "code": "profile_failed", "item": item.id, "step": k - 1, "what": e})
                }
            },
        };
        w.saved.push(json!({"profile": out}));
    }
}

/// Writes `record` as the folder's newest: under a temporary name, synced, and renamed once it
/// reads back whole; then the folder keeps it and the newest whole record before it. A write cut
/// short leaves the folder as it was.
pub fn write(dir: &Path, record: &Value) -> Result<(String, PathBuf), String> {
    use std::io::Write as _;
    let io = |e: std::io::Error| format!("{}: {e}", dir.display());
    let before = listed(dir);
    let bytes = record.to_string().into_bytes();
    let hash = sha(&bytes);
    let tmp = dir.join(format!("{hash}.profile.tmp"));
    let mut f = fs::File::create(&tmp).map_err(io)?;
    f.write_all(&bytes)
        .and_then(|()| f.sync_all())
        .map_err(io)?;
    if fs::read(&tmp).map(|b| sha(&b)).map_err(io)? != hash {
        let _ = fs::remove_file(&tmp);
        return Err(format!("the profile record {hash} didn't read back whole"));
    }
    let file = dir.join(format!("{hash}.profile"));
    fs::rename(&tmp, &file).map_err(io)?;
    let good = before.iter().position(|l| l.whole && l.hash != hash);
    for (_, old) in before
        .iter()
        .enumerate()
        .filter(|(i, l)| Some(*i) != good && l.hash != hash)
    {
        fs::remove_file(&old.path).map_err(io)?;
    }
    Ok((hash, file))
}

/// The records the world wrote since the last call, taken from beside its saves.
pub fn written(w: &mut World) -> Vec<Value> {
    let (profiles, rest): (Vec<Value>, Vec<Value>) = std::mem::take(&mut w.saved)
        .into_iter()
        .partition(|s| s.get("profile").is_some());
    w.saved = rest;
    profiles.into_iter().map(|c| c["profile"].clone()).collect()
}

/// The records the world wrote into its saves folder since the last call, or failed to: what a
/// `bake` or `step` reply lists (a record held for a host is the host's to keep).
pub fn reply(w: &mut World) -> Vec<Value> {
    written(w)
        .into_iter()
        .filter(|r| r.get("record").is_none())
        .collect()
}

/// A carry record's or a profile record's read entry `e` of `region` at step `k`, as its read says.
pub(crate) fn fill_read(item: &Item, track: &Track, e: &Region, k: i64, region: &mut [u8]) {
    let region = &mut region[e.offset as usize..(e.offset + e.size) as usize];
    match e.read {
        Read::Carry => crate::carry::fill(item, track.get(crate::carry::CARRY), k, region),
        _ => fill(item, track.get(PROFILE), k, region),
    }
}

/// The `profile` read entry at step `k`: at step 0, each seat's block, player 1's first: a u32 1
/// and its record's arrays when the track holds that player's entry; otherwise left as zeros.
fn fill(item: &Item, track: Option<&Vec<Entry>>, k: i64, region: &mut [u8]) {
    let (Some(p), 0) = (&item.profile, k) else {
        return;
    };
    let shape: Vec<(String, Ty, u32)> = p
        .arrays
        .iter()
        .map(|(n, t, _, c)| (n.clone(), *t, *c))
        .collect();
    let size = block(&shape) as usize;
    for e in track.into_iter().flatten() {
        let Given::Profile { arrays, .. } = &e.value else {
            continue;
        };
        let Some(seat) = (e.player as usize)
            .checked_sub(1)
            .filter(|s| *s < p.seats as usize)
        else {
            continue;
        };
        let out = &mut region[seat * size..(seat + 1) * size];
        out[..4].copy_from_slice(&1u32.to_le_bytes());
        let mut at = 4;
        for (name, ty, _, count) in &p.arrays {
            for j in 0..*count as usize {
                let x = &arrays[name][j];
                let b = match ty {
                    Ty::F64 => x.as_f64().unwrap_or(0.0).to_le_bytes().to_vec(),
                    _ => (x.as_i64().unwrap_or(i64::from(x.as_bool() == Some(true))) as i32)
                        .to_le_bytes()
                        .to_vec(),
                };
                out[at..at + b.len()].copy_from_slice(&b);
                at += b.len();
            }
        }
    }
}

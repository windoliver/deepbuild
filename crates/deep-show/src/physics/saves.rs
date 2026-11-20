//! #189 (canvas primitives: Logic: saves, Logic: saves across changes): the app's saves of a
//! document with worlds. A save holds every canvas module's carried state at its step: the logic
//! items' as the logic module's own save holds it, and each world's whole checkpoint there, with
//! the world readings the logic had read by then. It binds the state layout, the content (the
//! piece's data assets and each world whose state it holds, by hash) and the module set, and
//! carries the seal's runtime digest and its input track from step 0, kept by hash beside it. A
//! save whose runtime digest alone differs is re-derived: its own track is replayed headless from
//! step 0 under this build, with saves off, and when the logic state comes out the same it is
//! written as a new save bound to this build and opened, with one notice; otherwise the notice
//! says the game replays differently, naming the first array that differs, and nothing opens.

use std::fs;
use std::path::{Path, PathBuf};
use std::rc::Rc;

use deep_canvas::base64;
use deep_canvas_physics::check::check;
use deep_canvas_physics::golden;
use deep_canvas_physics::occurrence::step_flicks;
use deep_logic::piece::Piece;
use deep_logic::saves::{host, open_held, Held};
use deep_logic::world::{track_of, Entry, Record, World};
use deep_physics_rapier::runner::Run;
use serde_json::{json, Map, Value};
use sha2::{Digest, Sha256};

use super::{derive, refused, Planted, RAPIER3D};
use crate::hub::Hub;
use crate::picks::LogicCall;

/// One world's bake as a save keeps it: its ID, its step's length in flicks and its checkpoints,
/// each `{step, deep_hash, backend, features, state}` (the state in base64).
pub(crate) struct Baked {
    pub id: String,
    pub step: i64,
    pub checkpoints: Vec<Value>,
}

fn sha(b: &[u8]) -> String {
    Sha256::digest(b)
        .iter()
        .map(|x| format!("{x:02x}"))
        .collect()
}

fn bad(what: &str) -> Value {
    json!({"ok": false, "code": "bad_input", "what": what})
}

/// The world reads (`<world>.<body>.<read>`) a piece's logic items take.
fn world_names(piece: &Piece) -> Vec<String> {
    let mut names: Vec<String> = piece
        .items
        .iter()
        .flat_map(|i| i.layout.entries.iter())
        .filter(|e| e.read == deep_logic::piece::Read::World)
        .map(|e| e.name.clone())
        .collect();
    names.sort();
    names.dedup();
    names
}

/// A save of the app's: its file, its name's hash, its header and its bytes.
struct Kept {
    hash: String,
    file: PathBuf,
    header: Value,
    bytes: Vec<u8>,
}

/// Slot `slot`'s saves of the app's in `dir`, newest first; those that don't read back whole, by
/// their name, apart.
fn listed(dir: &Path, slot: i64) -> (Vec<Kept>, Vec<Value>) {
    let mut good = Vec::new();
    let mut damaged = Vec::new();
    for e in fs::read_dir(dir).into_iter().flatten().flatten() {
        let file = e.path();
        let Some(hash) = file
            .file_name()
            .and_then(|n| n.to_str())
            .and_then(|n| n.strip_suffix(".save"))
            .map(str::to_string)
        else {
            continue;
        };
        let Ok(bytes) = fs::read(&file) else { continue };
        let line = bytes.split(|b| *b == b'\n').next().unwrap_or_default();
        let Ok(header) = serde_json::from_slice::<Value>(line) else {
            damaged.push(json!({"hash": hash, "file": file}));
            continue;
        };
        if header["slot"] != json!(slot) || header.get("logic").is_none() {
            continue;
        }
        if sha(&bytes) != hash {
            damaged.push(json!({"hash": hash, "file": file}));
            continue;
        }
        good.push(Kept {
            hash,
            file,
            header,
            bytes,
        });
    }
    good.sort_by_key(|k| std::cmp::Reverse(k.header["seq"].as_u64()));
    (good, damaged)
}

/// The implementations the build's runtime digest covers (Registry and seal: runtime digest).
fn runtime_set(hub: &Hub) -> Vec<Value> {
    hub.startup
        .sealed
        .interfaces
        .iter()
        .filter_map(|i| {
            let m = i.implementation.to_json();
            (m["state"] == "backend_bytes" || m["equivalence"] == "measured").then(|| {
                json!({"interface": i.name, "implementation": m["name"], "version": m["version"], "pins": m["pins"]})
            })
        })
        .collect()
}

/// The worlds the document `doc` presents, as it declares them.
fn declared<'a>(hub: &'a Hub, doc: &str) -> &'a Value {
    hub.sessions
        .get(doc)
        .and_then(|s| s.document())
        .and_then(|d| d.get("worlds"))
        .unwrap_or(&Value::Null)
}

/// What a save binds beyond its logic: its content with each world by hash, as the document
/// declares it (only the data assets under the planted binding), and those world hashes.
fn content(
    hub: &Hub,
    declared: &Value,
    piece: &Piece,
    worlds: &[String],
) -> (String, Map<String, Value>) {
    let assets = host::binding(piece)[1].clone();
    if hub.planted(crate::hub::Planted::Physics(
        Planted::ContentLeavesOutWorlds,
    )) {
        return (assets, Map::new());
    }
    let hashes: Map<String, Value> = worlds
        .iter()
        .map(|id| (id.clone(), json!(sha(declared[id].to_string().as_bytes()))))
        .collect();
    let mut text = format!("assets {assets}\n");
    for (id, h) in &hashes {
        text.push_str(&format!("world {id} {}\n", h.as_str().unwrap_or_default()));
    }
    (sha(text.as_bytes()), hashes)
}

/// Writes `bytes` as `<sha256>.<ext>` in `dir`, under a temporary name renamed once it reads back
/// whole: the hash and the file.
fn put(dir: &Path, bytes: &[u8], ext: &str) -> Result<(String, PathBuf), String> {
    let io = |e: std::io::Error| format!("{}: {e}", dir.display());
    let h = sha(bytes);
    let tmp = dir.join(format!("{h}.tmp"));
    fs::write(&tmp, bytes).map_err(io)?;
    if fs::read(&tmp).map(|b| sha(&b)).map_err(io)? != h {
        let _ = fs::remove_file(&tmp);
        return Err(format!("the save {h} didn't read back whole"));
    }
    let file = dir.join(format!("{h}.{ext}"));
    fs::rename(&tmp, &file).map_err(io)?;
    Ok((h, file))
}

/// One save to make: the logic module's held save, each world's checkpoint at its step with the
/// readings read by then, and the input track from step 0 through the step before it.
struct Made {
    header: Value,
    bytes: Vec<u8>,
}

/// A save of `held` with each world of `baked` at its step: its header (its `seq` set by the
/// writer) and its bytes after the header line. `binds` overrides the layout, content and module
/// set a re-derivation carries over from the old save.
#[allow(clippy::too_many_arguments)]
fn made(
    hub: &Hub,
    declared: &Value,
    piece: &Piece,
    held: &Held,
    baked: &[Baked],
    read: &[Value],
    track_hash: &str,
    binds: Option<&Value>,
) -> Result<Made, String> {
    let k = held.step;
    let logic = held.bytes(1);
    let line = logic.split(|b| *b == b'\n').next().unwrap_or_default();
    let lh: Value = serde_json::from_slice(line).map_err(|e| e.to_string())?;
    let ids: Vec<String> = baked.iter().map(|b| b.id.clone()).collect();
    let (content, hashes) = content(hub, declared, piece, &ids);
    let mut state = logic.clone();
    let mut worlds = Map::new();
    for b in baked {
        let cp = b
            .checkpoints
            .iter()
            .find(|c| c["step"].as_i64() == Some(k))
            .ok_or_else(|| format!("world {} keeps no checkpoint at step {k}", b.id))?;
        let bytes = base64::decode(cp["state"].as_str().unwrap_or_default())
            .ok_or_else(|| format!("world {}'s checkpoint at step {k} isn't base64", b.id))?;
        // The value of each of the world's readings the logic had read by the save's step.
        let prefix = format!("{}.", b.id);
        let mut reads = Map::new();
        for e in read.iter().filter(|e| {
            e["control"]
                .as_str()
                .is_some_and(|c| c.starts_with(&prefix))
                && e["t"].as_i64().is_some_and(|t| t < k * b.step)
        }) {
            reads.insert(
                e["control"].as_str().unwrap_or_default().into(),
                e["value"].clone(),
            );
        }
        worlds.insert(
            b.id.clone(),
            json!({"hash": hashes.get(&b.id), "step": k, "len": bytes.len(), "backend": cp["backend"],
                   "deep_hash": golden::deep_hash(&bytes), "reads": reads}),
        );
        state.extend(bytes);
    }
    let [layout, assets, _] = host::binding(piece);
    let sealed = &hub.startup.sealed;
    let mut header = json!({
        "slot": held.slot, "layout": layout, "content": content, "assets": assets, "modules": sealed.set_digest,
        "runtime": sealed.runtime_digest, "runtime_set": runtime_set(hub), "document": lh["document"],
        "program": lh["program"], "step": k, "input_at": lh["input_at"], "track": track_hash, "ended": held.ended,
        "logic": {"hash": sha(&logic), "len": logic.len()}, "worlds": worlds, "seq": 0,
    });
    if let Some(b) = binds {
        for f in ["layout", "content", "assets", "modules"] {
            header[f] = b[f].clone();
        }
    }
    Ok(Made {
        header,
        bytes: state,
    })
}

/// Writes `m` as slot `slot`'s newest save: numbered after the slot's newest, which keeps it and
/// the one before (only it once ended); a slot whose newest save ended takes no later one.
fn write(dir: &Path, m: Made) -> Result<Option<(String, PathBuf)>, String> {
    let slot = m.header["slot"].as_i64().unwrap_or(0);
    let (ours, _) = listed(dir, slot);
    if ours
        .first()
        .is_some_and(|s| s.header["ended"] == json!(true))
    {
        return Ok(None);
    }
    let mut header = m.header;
    header["seq"] = json!(ours
        .first()
        .and_then(|s| s.header["seq"].as_u64())
        .map_or(1, |n| n + 1));
    let mut bytes = header.to_string().into_bytes();
    bytes.push(b'\n');
    bytes.extend(m.bytes);
    let written = put(dir, &bytes, "save")?;
    let keep = if header["ended"] == json!(true) { 0 } else { 1 };
    for old in ours.iter().skip(keep) {
        fs::remove_file(&old.file).map_err(|e| e.to_string())?;
    }
    Ok(Some(written))
}

/// The input track from step 0 through step `k` − 1, kept by its hash beside the saves.
fn kept_track(dir: &Path, core: &[Value], k: i64, len: i64) -> Result<String, String> {
    let before: Vec<&Value> = core
        .iter()
        .filter(|e| e["t"].as_i64().is_some_and(|t| t <= (k - 1) * len))
        .collect();
    put(dir, json!(before).to_string().as_bytes(), "track").map(|(h, _)| h)
}

impl Hub<'_> {
    /// The world readings `piece`'s logic takes on the core track `core`, with each world's bake.
    pub(crate) fn world_bakes(
        &self,
        form: &Value,
        core: &[Value],
        piece: &Piece,
    ) -> Result<(Vec<Value>, Vec<Baked>), Box<deep_canvas::document::Issue>> {
        let names = world_names(piece);
        if names.is_empty() {
            return Ok((Vec::new(), Vec::new()));
        }
        self.world_runs(form, core, &names)
    }

    /// The saves the logic module held for a run, each written with its worlds into `dir`, as the
    /// `logic` call reports them.
    #[allow(clippy::too_many_arguments)]
    pub(crate) fn write_saves(
        &self,
        dir: &Path,
        doc: &str,
        piece: &Piece,
        held: Vec<Held>,
        baked: &[Baked],
        read: &[Value],
        core: &[Value],
    ) -> Value {
        let len = piece.items.first().map_or(1, |i| i.step);
        let mut out = Vec::new();
        for h in held {
            let started = std::time::Instant::now();
            let saved = kept_track(dir, core, h.step, len)
                .and_then(|t| made(self, declared(self, doc), piece, &h, baked, read, &t, None))
                .and_then(|m| {
                    let deep = m.header["worlds"].clone();
                    write(dir, m).map(|w| (w, deep))
                });
            match saved {
                Ok((Some((hash, file)), worlds)) => {
                    let mut deep = h.deep_hash.clone();
                    for (id, w) in worlds.as_object().into_iter().flatten() {
                        deep.insert(id.clone(), w["deep_hash"].clone());
                    }
                    out.push(json!({"item": h.item, "slot": h.slot, "step": h.step, "hash": hash, "file": file,
                        "ended": h.ended, "deep_hash": deep, "write_ns": started.elapsed().as_nanos() as u64,
                        "on_ui_thread": false}));
                }
                Ok((None, _)) => {}
                Err(e) => out.push(json!({"ok": false, "code": "save_failed", "item": h.item, "slot": h.slot, "step": h.step, "what": e})),
            }
        }
        Value::Array(out)
    }
}

/// Each world's checkpoints, `{step, deep_hash}`, through step `to`.
pub(crate) fn world_checkpoints(baked: &[Baked], to: i64) -> Map<String, Value> {
    baked
        .iter()
        .map(|b| {
            let list: Vec<Value> = b
                .checkpoints
                .iter()
                .filter(|c| c["step"].as_i64().is_some_and(|s| s <= to))
                .map(|c| json!({"step": c["step"], "deep_hash": c["deep_hash"]}))
                .collect();
            (b.id.clone(), Value::Array(list))
        })
        .collect()
}

/// `open_save`: the viewer opening slot `slot`'s newest save that reads back whole, straight,
/// re-derived after a runtime change, or refused, then played on to step `steps` − 1 on the
/// viewer's entries after it.
pub(crate) fn open(hub: &mut Hub, l: &LogicCall, slot: i64) -> Value {
    let started = std::time::Instant::now();
    let Some(form) = hub.forms.get(&l.doc).cloned() else {
        return json!({"code": "no_revision"});
    };
    let Some(dir) = l.saves_dir.clone() else {
        return bad("saves_dir");
    };
    let viewer = l.track.clone().unwrap_or_default();
    let piece = match hub.logic_piece(&form, &viewer) {
        Ok(Some(p)) => Rc::new(p),
        Ok(None) => return json!({"code": "no_logic"}),
        Err(i) => return json!({"code": i.code, "issues": [i.to_json()]}),
    };
    let (saves, damaged) = listed(&dir, slot);
    let Some(save) = saves.into_iter().next() else {
        return json!({"ok": false, "code": "no_save", "slot": slot, "damaged": damaged});
    };
    let h = &save.header;
    let refuse = |differs: Vec<Value>| json!({"ok": false, "code": "save_refused", "save": save.hash, "differs": differs, "damaged": damaged});
    // The binding: the layout, the content with each world by hash, and the module set.
    let worlds: Vec<String> = h["worlds"]
        .as_object()
        .map(|w| w.keys().cloned().collect())
        .unwrap_or_default();
    let (now, hashes) = content(hub, declared(hub, &l.doc), &piece, &worlds);
    let [layout, assets, _] = host::binding(&piece);
    let mut differs = Vec::new();
    if h["layout"] != json!(layout) {
        differs.push(json!({"what": "layout", "save": h["layout"], "piece": layout}));
    }
    if h["content"] != json!(now) {
        for (id, piece_hash) in &hashes {
            let theirs = &h["worlds"][id]["hash"];
            if theirs != piece_hash {
                differs.push(
                    json!({"what": "content", "world": id, "save": theirs, "piece": piece_hash}),
                );
            }
        }
        if h["assets"] != json!(assets) || differs.iter().all(|d| d["what"] != "content") {
            differs.push(json!({"what": "content", "save": h["assets"], "piece": assets}));
        }
    }
    if h["modules"] != json!(hub.startup.sealed.set_digest) {
        differs.push(json!({"what": "modules", "save": h["modules"], "piece": hub.startup.sealed.set_digest}));
    }
    if !differs.is_empty() {
        return refuse(differs);
    }
    let old_build = h["runtime"] != json!(hub.startup.sealed.runtime_digest)
        && !hub.planted(crate::hub::Planted::Physics(Planted::RestoreLoadsOldWorld));
    if !old_build {
        let via = json!({"hash": save.hash, "file": save.file, "via": "straight"});
        return opened(
            hub,
            &l.doc,
            &form,
            &piece,
            &dir,
            &save,
            via,
            Vec::new(),
            &viewer,
            l.steps,
        );
    }
    rederive(
        hub, &l.doc, &form, &piece, &dir, &save, &viewer, l.steps, started,
    )
}

/// What changed between the save's runtime set and this build's, as a notice names it.
fn changed(hub: &Hub, h: &Value) -> Vec<Value> {
    let theirs = h["runtime_set"].as_array().cloned().unwrap_or_default();
    runtime_set(hub)
        .into_iter()
        .filter(|m| !theirs.contains(m))
        .map(|m| json!({"interface": m["interface"], "implementation": m["implementation"]}))
        .collect()
}

/// The notice a save opened under another runtime shows, once: `None` once it was shown.
fn notice(dir: &Path, save: &str, changed: &[Value], array: Option<&str>) -> Option<Value> {
    let marker = dir.join(format!("{save}.notice"));
    if marker.exists() {
        return None;
    }
    let names: Vec<String> = changed
        .iter()
        .map(|c| {
            format!(
                "{} ({})",
                c["implementation"].as_str().unwrap_or_default(),
                c["interface"].as_str().unwrap_or_default()
            )
        })
        .collect();
    let what = names.join(", ");
    let (replays, text) = match array {
        None => ("same", format!("This save was written by another build: {what} changed, so it was replayed from its own input under this build, where it plays the same, and opened as a new save; the old one is kept.")),
        Some(a) => ("differently", format!("This save was written by another build: {what} changed, and the game replays differently under this build: {a} differs. The replayed save opens only when you choose it; the old one is kept.")),
    };
    let mut n = json!({"kind": "runtime_changed", "save": save, "changed": changed, "replays": replays, "text": text});
    if let Some(a) = array {
        n["array"] = json!(a);
    }
    let _ = fs::write(&marker, n.to_string());
    Some(n)
}

/// The save's own track from step 0, by its hash beside it.
fn track_of_save(dir: &Path, h: &Value) -> Option<Vec<Value>> {
    let hash = h["track"].as_str()?;
    let bytes = fs::read(dir.join(format!("{hash}.track"))).ok()?;
    (sha(&bytes) == hash).then(|| serde_json::from_slice(&bytes).ok())?
}

/// Replays the save's own track headless from step 0 to its step under this build, saves off, and
/// writes and opens the result when the logic state is the old save's; else names the first array
/// that differs and opens nothing.
#[allow(clippy::too_many_arguments)]
fn rederive(
    hub: &mut Hub,
    doc: &str,
    form: &Value,
    piece: &Rc<Piece>,
    dir: &Path,
    save: &Kept,
    viewer: &[Value],
    steps: i64,
    started: std::time::Instant,
) -> Value {
    let h = &save.header;
    let k = h["step"].as_i64().unwrap_or(0);
    let refuse = |what: Value| json!({"ok": false, "code": "save_refused", "save": save.hash, "differs": [what]});
    let Some(core) = track_of_save(dir, h) else {
        return refuse(json!({"what": "track", "track": h["track"]}));
    };
    let (read, baked) = match hub.world_bakes(form, &core, piece) {
        Ok(x) => x,
        Err(i) => return json!({"code": i.code, "issues": [i.to_json()]}),
    };
    let mut entries: Vec<Entry> = core.iter().filter_map(Entry::parse).collect();
    entries.extend(read.iter().filter_map(Entry::parse));
    let mut rec = Record::default();
    let mut w = match World::new(
        piece.clone(),
        track_of(&entries),
        false,
        deep_logic::Planted::default(),
        &mut rec,
        None,
    ) {
        Ok(w) => w,
        Err(e) => return e,
    };
    w.run(k, &mut rec, &mut |_, _| {});
    let slot = h["slot"].as_i64().unwrap_or(0) as i32;
    let held = host::held_at(&mut w, k, slot, h["ended"] == json!(true));
    let ln = h["logic"]["len"].as_u64().unwrap_or(0) as usize;
    let at = save
        .bytes
        .iter()
        .position(|b| *b == b'\n')
        .map_or(0, |n| n + 1);
    let old = &save.bytes[at..(at + ln).min(save.bytes.len())];
    let first = host::differs(piece, old, &held.bytes(1));
    let changed = changed(hub, h);
    let made = match made(
        hub,
        declared(hub, doc),
        piece,
        &held,
        &baked,
        &read,
        h["track"].as_str().unwrap_or_default(),
        Some(h),
    ) {
        Ok(m) => m,
        Err(e) => return json!({"ok": false, "code": "save_failed", "what": e}),
    };
    let Some(first) = first else {
        let (hash, file) = match write(dir, made) {
            Ok(Some(x)) => x,
            Ok(None) => return refuse(json!({"what": "ended"})),
            Err(e) => return json!({"ok": false, "code": "save_failed", "what": e}),
        };
        let rederive_ns = started.elapsed().as_nanos() as u64;
        let notices: Vec<Value> = notice(dir, &save.hash, &changed, None)
            .into_iter()
            .collect();
        let (new, _) = listed(dir, slot.into());
        let Some(new) = new.into_iter().find(|s| s.hash == hash) else {
            return json!({"ok": false, "code": "save_failed", "what": "the re-derived save didn't read back"});
        };
        let via = json!({"hash": hash, "file": file, "via": "rederived", "from": save.hash});
        let mut out = opened(
            hub, doc, form, piece, dir, &new, via, notices, viewer, steps,
        );
        out["rederive_ns"] = json!(rederive_ns);
        return out;
    };
    // The re-derived save waits for the viewer's click, beside the slot's saves.
    let mut bytes = made.header.to_string().into_bytes();
    bytes.push(b'\n');
    bytes.extend(made.bytes);
    let _ = put(dir, &bytes, "rederived");
    let array = first.unwrap_or_else(|| {
        format!(
            "{}.memory",
            piece.items.first().map_or("", |i| i.id.as_str())
        )
    });
    let notices: Vec<Value> = notice(dir, &save.hash, &changed, Some(&array))
        .into_iter()
        .collect();
    json!({"ok": false, "code": "replays_differently", "save": save.hash, "notices": notices})
}

/// Opens `save` into fresh instances, every carried state restored as a seek restores, and plays
/// on to step `steps` − 1 on the viewer's entries `viewer`.
#[allow(clippy::too_many_arguments)]
fn opened(
    hub: &mut Hub,
    doc: &str,
    form: &Value,
    piece: &Rc<Piece>,
    dir: &Path,
    save: &Kept,
    mut via: Value,
    notices: Vec<Value>,
    viewer: &[Value],
    steps: i64,
) -> Value {
    let h = &save.header;
    let k = h["step"].as_i64().unwrap_or(0);
    via["step"] = json!(k);
    let at = save
        .bytes
        .iter()
        .position(|b| *b == b'\n')
        .map_or(0, |n| n + 1);
    let ln = h["logic"]["len"].as_u64().unwrap_or(0) as usize;
    let Some(logic) = save.bytes.get(at..at + ln) else {
        return json!({"ok": false, "code": "save_refused", "save": save.hash, "differs": [{"what": "state"}]});
    };
    let mut offset = at + ln;
    // Each world restored from its checkpoint and stepped on, its readings delivered to logic.
    let sourced = hub.sourced(form);
    let scene = &*sourced;
    let run = Run::new(None).expect("the unplanted runner");
    let mut read: Vec<Value> = Vec::new();
    let mut worlds_out = Map::new();
    let mut checkpoints = Map::new();
    let mut deep = Map::new();
    let mut restored = Vec::new();
    let names = world_names(piece);
    for (id, wh) in h["worlds"].as_object().cloned().unwrap_or_default() {
        let n = wh["len"].as_u64().unwrap_or(0) as usize;
        let Some(state) = save.bytes.get(offset..offset + n) else {
            return json!({"ok": false, "code": "save_refused", "save": save.hash, "differs": [{"what": "state", "world": id}]});
        };
        offset += n;
        let Some(wdoc) = scene.pointer(&format!("/worlds/{id}")) else {
            return json!({"ok": false, "code": "save_refused", "save": save.hash, "differs": [{"what": "content", "world": id}]});
        };
        let w = match deep_physics_rapier::bound::expand(Some(scene), wdoc)
            .and_then(|d| check(&d, &RAPIER3D, &deep_canvas_physics::roles::TABLE))
        {
            Ok(w) => w,
            Err(e) => {
                return refused(
                    &id,
                    json!(e
                        .iter()
                        .map(|r| json!({"code": r.code, "what": r.what}))
                        .collect::<Vec<_>>()),
                )
                .to_json()
            }
        };
        let kept = match derive::kept(scene, &w, viewer) {
            Ok(x) => x,
            Err(r) => return refused(&id, json!([{"code": r.code, "what": r.what}])).to_json(),
        };
        let step = step_flicks(&w);
        let bodies: Vec<&String> = w.bodies.keys().collect();
        let checkpoint = json!({"step": k, "backend": wh["backend"], "state": base64::encode(state)});
        let call = json!({"call": "restore", "scene": scene, "world": id, "checkpoint": checkpoint, "steps": (steps - k).max(0),
                          "read": bodies, "track": derive::track_of(&kept), "checkpoints": true});
        let reply = run.answer(&call).unwrap_or(Value::Null);
        if reply["ok"] != json!(true) {
            return json!({"ok": false, "code": "save_refused", "save": save.hash, "differs": [{"what": "state", "world": id, "restore": reply}]});
        }
        // The readings the logic had read by the save's step, then each from the restored world.
        for (name, v) in wh["reads"].as_object().into_iter().flatten() {
            read.push(json!({"t": (k - 1) * step, "seq": 0, "control": name, "value": v, "writer": "physics", "player": 0}));
        }
        let reads: Vec<(&str, &str, &str)> = names
            .iter()
            .filter_map(|n| {
                let mut p = n.splitn(3, '.');
                let (wid, b, r) = (p.next()?, p.next()?, p.next()?);
                (wid == id).then_some((n.as_str(), b, r))
            })
            .collect();
        super::character_reads(&reply, &reads, step, k, &mut read);
        let poses: Map<String, Value> = w
            .bodies
            .keys()
            .filter_map(|b| {
                let s = reply["bodies"][b].get(0)?;
                Some((b.clone(), json!({"pos": s["pos"], "rot": s["rot"]})))
            })
            .collect();
        worlds_out.insert(id.clone(), Value::Object(poses));
        let deep_at = golden::deep_hash(state);
        deep.insert(id.clone(), json!(deep_at));
        let mut list = vec![json!({"step": k, "deep_hash": deep_at})];
        list.extend(
            reply["checkpoints"]
                .as_array()
                .into_iter()
                .flatten()
                .filter(|c| c["step"].as_i64().is_some_and(|s| s > k && s <= steps))
                .map(|c| json!({"step": c["step"], "deep_hash": c["deep_hash"]})),
        );
        checkpoints.insert(id.clone(), Value::Array(list));
        restored.push(Baked {
            id: id.clone(),
            step,
            checkpoints: reply["checkpoints"].as_array().cloned().unwrap_or_default(),
        });
    }
    // The logic items restored from their own save and played on, reading those readings.
    let mut entries: Vec<Entry> = viewer.iter().filter_map(Entry::parse).collect();
    entries.extend(read.iter().filter_map(Entry::parse));
    let mut rec = Record::default();
    let (mut w, _) = match open_held(piece, &sha(logic), logic, &entries, "", &mut rec) {
        Ok(x) => x,
        Err(e) => return e,
    };
    for (id, v) in w.deep_hashes() {
        deep.insert(id, v);
    }
    w.run(steps, &mut rec, &mut |_, _| {});
    for (id, list) in &rec.checkpoints {
        checkpoints.insert(id.clone(), list.clone());
    }
    // Later saves the opened run asks for, with the save's own track before the viewer's entries.
    let held = w.held.take().unwrap_or_default();
    let mut core = track_of_save(dir, h).unwrap_or_default();
    core.extend(viewer.iter().cloned());
    let saves = hub.write_saves(dir, doc, piece, held, &restored, &read, &core);
    json!({"ok": true, "opened": via, "notices": notices, "deep_hash": deep, "checkpoints": checkpoints,
           "worlds": worlds_out, "steps": rec.steps_json(piece, None), "saves": saves})
}

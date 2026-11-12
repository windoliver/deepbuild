//! Saves (canvas primitives: Logic: saves, Logic: saves across changes; #534). A step that writes
//! a slot number into its item's `request` (or `ends`) array saves that slot once it ends: every
//! item's memory as its pages that hold a nonzero byte, its globals, its arrays and the entries
//! still waiting on each control, bound to the state layout (the program hash, while no program
//! exports `layout_at`), the content and the module set. A save file is one JSON header line with
//! every binding field, so they decode without the state, then the state; it's written under a
//! temporary name and renamed once it reads back whole, and each slot keeps its newest save and
//! the one before it. The viewer opens one into fresh instances, as a seek restores a checkpoint,
//! or a declared migration moves it to the current layout as a new save while the old one stays.

use std::collections::{BTreeMap, VecDeque};
use std::fs;
use std::io::{BufRead, BufReader, Write as _};
use std::path::{Path, PathBuf};
use std::rc::Rc;
use std::time::Instant;

use sha2::Digest as _;

use deep_canvas_sandbox::rewrite::{hash, START};
use deep_sandbox_wasmtime::service::trap_json;
use deep_sandbox_wasmtime::{Call, Faults, Runner};
use serde_json::{json, Value};
use wasmtime::Val;

use crate::piece::{memory_bytes, migration_fuel, segments, Piece, MAX_MEMORY, PAGE};
use crate::world::{arrays_json, names, track_of, Entry, Failed, Live, Record, World};
use crate::{Planted, VERSION};

/// One item's carried state, as a save holds it.
struct State {
    failed: bool,
    /// Steps that had run (Logic: turn clock).
    ran: i64,
    memory: Vec<u8>,
    globals: Vec<u64>,
    arrays: Vec<u8>,
    /// A linear write's values before the last step that ran; empty when it only holds.
    prev: Vec<u8>,
    pending: BTreeMap<String, VecDeque<Entry>>,
}

/// The piece's state layout, content and module set: what a save is bound to.
fn binding(piece: &Piece) -> [String; 3] {
    let joined = |f: &dyn Fn(&crate::piece::Item) -> String| match piece.items.as_slice() {
        [one] => f(one),
        all => hash(
            all.iter()
                .map(|i| format!("{} {}\n", i.id, f(i)))
                .collect::<String>()
                .as_bytes(),
        ),
    };
    let content: String = piece
        .items
        .iter()
        .flat_map(|i| &i.assets)
        .map(|(sha, _)| format!("{sha}\n"))
        .collect();
    let mut modules = format!("logic@1\n{}\n", deep_canvas_sandbox::module::INTERFACE);
    if !piece.machine.is_empty() {
        modules.push_str(&format!("{}\n", crate::piece::MACHINE));
    }
    [
        joined(&|i| i.program.clone()),
        hash(content.as_bytes()),
        hash(modules.as_bytes()),
    ]
}

/// The rewritten program, which a save names but isn't bound to.
fn program(piece: &Piece) -> String {
    match piece.items.as_slice() {
        [one] => one.hash.clone(),
        all => hash(
            all.iter()
                .map(|i| format!("{} {}\n", i.id, i.hash))
                .collect::<String>()
                .as_bytes(),
        ),
    }
}

/// A save file's sha256, which names it.
fn file_hash(bytes: &[u8]) -> String {
    sha2::Sha256::digest(bytes)
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect()
}

fn put(out: &mut Vec<u8>, b: &[u8]) {
    out.extend((b.len() as u32).to_le_bytes());
    out.extend(b);
}

fn bits(v: Val) -> u64 {
    match v {
        Val::I32(x) => u64::from(x as u32),
        Val::I64(x) => x as u64,
        Val::F32(x) => u64::from(x),
        Val::F64(x) => x,
        _ => 0,
    }
}

fn val(ty: &str, x: u64) -> Val {
    match ty {
        "i32" => Val::I32(x as u32 as i32),
        "i64" => Val::I64(x as i64),
        "f32" => Val::F32(x as u32),
        _ => Val::F64(x),
    }
}

/// Every logic item's state in piece order (a u32 count, then each one's ID, whether it failed,
/// the steps that had run, its memory's length and the pages that hold a nonzero byte, its mutable
/// globals as 8 bytes each, its arrays, its linear writes' previous values and its waiting
/// entries), then each same-machine counter's ID and the steps it has seen.
fn encode(w: &mut World) -> Vec<u8> {
    let planted = w.planted;
    let mut out = (w.lives.len() as u32).to_le_bytes().to_vec();
    for (item, l) in w.piece.clone().items.iter().zip(w.lives.iter_mut()) {
        put(&mut out, item.id.as_bytes());
        out.push(u8::from(l.failed));
        out.extend(l.ran.to_le_bytes());
        let memory = l.memory().to_vec();
        out.extend((memory.len() as u32).to_le_bytes());
        let pages: Vec<(usize, &[u8])> = memory
            .chunks(PAGE as usize)
            .enumerate()
            .filter(|(_, p)| p.iter().any(|b| *b != 0))
            .collect();
        out.extend((pages.len() as u32).to_le_bytes());
        for (i, p) in pages {
            out.extend((i as u32).to_le_bytes());
            out.extend(p);
        }
        let globals = if planted.save_drops_globals {
            Vec::new()
        } else {
            l.globals()
        };
        out.extend((globals.len() as u32).to_le_bytes());
        for g in globals {
            out.extend(bits(g).to_le_bytes());
        }
        put(&mut out, &l.arrays);
        put(&mut out, &l.prev);
        let pending: BTreeMap<&String, Vec<Value>> = if planted.save_drops_input_position {
            BTreeMap::new()
        } else {
            l.pending
                .iter()
                .map(|(c, q)| (c, q.iter().map(Entry::to_json).collect()))
                .collect()
        };
        put(&mut out, json!(pending).to_string().as_bytes());
    }
    for id in &w.piece.machine {
        put(&mut out, id.as_bytes());
        out.extend(w.seen.to_le_bytes());
    }
    out
}

/// A save's state: each logic item's by ID, then each same-machine counter's steps seen.
type Decoded = (Vec<(String, State)>, Vec<(String, u64)>);

/// The state's items by ID, or None when it doesn't decode or holds more than `items` logic
/// items.
fn decode(mut b: &[u8], items: usize) -> Option<Decoded> {
    fn take<'a>(b: &mut &'a [u8], n: usize) -> Option<&'a [u8]> {
        let (head, rest) = (b.get(..n)?, b.get(n..)?);
        *b = rest;
        Some(head)
    }
    fn u32_of(b: &mut &[u8]) -> Option<usize> {
        Some(u32::from_le_bytes(take(b, 4)?.try_into().ok()?) as usize)
    }
    fn sized<'a>(b: &mut &'a [u8]) -> Option<&'a [u8]> {
        let n = u32_of(b)?;
        take(b, n)
    }
    let mut out = Vec::new();
    for _ in 0..Some(u32_of(&mut b)?).filter(|n| *n <= items)? {
        let id = String::from_utf8(sized(&mut b)?.to_vec()).ok()?;
        let failed = match take(&mut b, 1)? {
            [0] => false,
            [1] => true,
            _ => return None,
        };
        let ran = i64::from_le_bytes(take(&mut b, 8)?.try_into().ok()?);
        let mut memory = vec![0; Some(u32_of(&mut b)?).filter(|n| *n as u64 <= MAX_MEMORY)?];
        for _ in 0..u32_of(&mut b)? {
            let at = u32_of(&mut b)? * PAGE as usize;
            memory
                .get_mut(at..at + PAGE as usize)?
                .copy_from_slice(take(&mut b, PAGE as usize)?);
        }
        let globals = (0..u32_of(&mut b)?)
            .map(|_| Some(u64::from_le_bytes(take(&mut b, 8)?.try_into().ok()?)))
            .collect::<Option<_>>()?;
        let arrays = sized(&mut b)?.to_vec();
        let prev = sized(&mut b)?.to_vec();
        let waiting: BTreeMap<String, Vec<Value>> = serde_json::from_slice(sized(&mut b)?).ok()?;
        let pending = waiting
            .into_iter()
            .map(|(c, q)| Some((c, q.iter().map(Entry::parse).collect::<Option<_>>()?)))
            .collect::<Option<_>>()?;
        out.push((
            id,
            State {
                failed,
                ran,
                memory,
                globals,
                arrays,
                prev,
                pending,
            },
        ));
    }
    let mut machine = Vec::new();
    while !b.is_empty() {
        let id = String::from_utf8(sized(&mut b)?.to_vec()).ok()?;
        machine.push((id, u64::from_le_bytes(take(&mut b, 8)?.try_into().ok()?)));
    }
    Some((out, machine))
}

/// A save in the folder: its name's hash and its header.
struct Listed {
    hash: String,
    path: PathBuf,
    header: Value,
}

impl Listed {
    /// Its bytes, when they still have the hash it's named by.
    fn whole(&self) -> Option<Vec<u8>> {
        fs::read(&self.path)
            .ok()
            .filter(|b| file_hash(b) == self.hash)
    }
}

/// Slot `slot`'s saves in the folder whose header decodes, newest first.
fn listed(dir: &Path, slot: i64) -> Vec<Listed> {
    let mut out: Vec<Listed> = fs::read_dir(dir)
        .into_iter()
        .flatten()
        .flatten()
        .filter_map(|e| {
            let path = e.path();
            let hash_of = path
                .file_name()?
                .to_str()?
                .strip_suffix(".save")?
                .to_string();
            let mut line = String::new();
            BufReader::new(fs::File::open(&path).ok()?)
                .read_line(&mut line)
                .ok()?;
            let header: Value = serde_json::from_str(&line).ok()?;
            (header["slot"] == json!(slot)).then_some(Listed {
                hash: hash_of,
                path,
                header,
            })
        })
        .collect();
    out.sort_by_key(|s| std::cmp::Reverse(s.header["seq"].as_u64()));
    out
}

/// The saves in the folder whose header line doesn't decode: cut short or damaged before any
/// slot can be read from them.
fn headless(dir: &Path) -> Vec<Value> {
    fs::read_dir(dir)
        .into_iter()
        .flatten()
        .flatten()
        .map(|e| e.path())
        .filter_map(|path| {
            let hash_of = path
                .file_name()?
                .to_str()?
                .strip_suffix(".save")?
                .to_string();
            let mut line = String::new();
            let read = fs::File::open(&path)
                .ok()
                .and_then(|f| BufReader::new(f).read_line(&mut line).ok());
            let fine = read.is_some() && serde_json::from_str::<Value>(&line).is_ok();
            (!fine).then(|| json!({"hash": hash_of, "file": path}))
        })
        .collect()
}

/// Writes the world's state now, at step `k`, as a save of `slot`: under a temporary name, renamed
/// once it reads back whole; then the slot keeps it and its last good save before it (only it,
/// once ended).
fn write(w: &mut World, k: i64, slot: i32, ended: bool) -> Result<(String, PathBuf, bool), String> {
    let dir = w.saves_dir.clone().ok_or("no saves folder")?;
    let piece = w.piece.clone();
    let len = piece.items.first().map_or(0, |i| i.step);
    let mut read: Vec<&Entry> = w
        .track
        .values()
        .flatten()
        .filter(|e| e.t <= (k - 1) * len)
        .collect();
    read.sort_by_key(|e| (e.t, e.player, e.seq));
    let track = hash(
        json!(read.iter().map(|e| e.to_json()).collect::<Vec<_>>())
            .to_string()
            .as_bytes(),
    );
    let mut input_at = serde_json::Map::new();
    let mut changed = Vec::new();
    for (item, l) in piece.items.iter().zip(w.lives.iter_mut()) {
        let read: serde_json::Map<String, Value> = l
            .cursor
            .iter()
            .map(|(c, n)| {
                (
                    c.clone(),
                    json!(n.saturating_sub(l.pending.get(c).map_or(0, VecDeque::len))),
                )
            })
            .collect();
        input_at.insert(item.id.clone(), Value::Object(read));
        let memory = l.memory();
        for (segment, at, bytes) in segments(&item.given) {
            if let Some(j) = bytes
                .iter()
                .zip(&memory[at as usize..])
                .position(|(a, b)| a != b)
            {
                changed.push(json!({"item": item.id, "segment": segment, "offset": at + j as u64}));
            }
        }
    }
    let ours = listed(&dir, slot.into());
    let seq = ours
        .first()
        .and_then(|s| s.header["seq"].as_u64())
        .map_or(1, |n| n + 1);
    let [layout, content, modules] = binding(&piece);
    let header = json!({
        "slot": slot, "layout": layout, "content": content, "modules": modules,
        "runtime": hash(format!("{VERSION}\nwasmtime {}\n", deep_sandbox_wasmtime::WASMTIME).as_bytes()),
        "document": piece.document, "program": program(&piece), "step": k, "input_at": input_at, "track": track,
        "ended": ended, "fingerprint": fingerprint(w), "segments": changed, "seq": seq,
    });
    let mut bytes = header.to_string().into_bytes();
    bytes.push(b'\n');
    bytes.extend(encode(w));
    let io = |e: std::io::Error| format!("{}: {e}", dir.display());
    // Hashed, written, synced, read back and renamed on a writer thread, never the caller's.
    let (sha, path, on_main) = std::thread::scope(|s| {
        s.spawn(|| {
            let on_main = std::thread::current().name() == Some("main");
            let sha = file_hash(&bytes);
            let tmp = dir.join(format!("{sha}.tmp"));
            let mut f = fs::File::create(&tmp).map_err(io)?;
            f.write_all(&bytes)
                .and_then(|()| f.sync_all())
                .map_err(io)?;
            if fs::read(&tmp).map(|b| file_hash(&b)).map_err(io)? != sha {
                let _ = fs::remove_file(&tmp);
                return Err(format!("the save of slot {slot} didn't read back whole"));
            }
            let path = dir.join(format!("{sha}.save"));
            fs::rename(&tmp, &path).map_err(io)?;
            Ok((sha, path, on_main))
        })
        .join()
        .map_err(|_| "the save writer panicked".to_string())?
    })?;
    let good = if ended {
        None
    } else {
        ours.iter().position(|s| s.whole().is_some())
    };
    for (_, old) in ours.iter().enumerate().filter(|(i, _)| Some(*i) != good) {
        fs::remove_file(&old.path).map_err(io)?;
    }
    Ok((sha, path, on_main))
}

/// The adapter fingerprint a save that holds same-machine state binds, or null when it holds none.
fn fingerprint(w: &World) -> Value {
    if w.piece.machine.is_empty() {
        Value::Null
    } else {
        json!(w.adapter)
    }
}

/// The saves the steps before step `k` asked for, written now that every item is at step k. A
/// slot whose newest save is ended opens only at that end, so it takes no later save.
pub(crate) fn due(w: &mut World, k: i64, ended_at: Instant) {
    let asked: Vec<(usize, i32, bool)> = w
        .lives
        .iter_mut()
        .enumerate()
        .filter_map(|(i, l)| l.asked.take().map(|(s, e)| (i, s, e)))
        .collect();
    for (i, slot, ended) in asked {
        let dir = w.saves_dir.clone().unwrap_or_default();
        if listed(&dir, slot.into())
            .first()
            .is_some_and(|s| s.header["ended"] == json!(true))
        {
            continue;
        }
        let out = match write(w, k, slot, ended) {
            Ok((hash, file, on_main)) => {
                let write_ns = ended_at.elapsed().as_nanos() as u64;
                json!({
                    "item": w.piece.items[i].id, "slot": slot, "step": k, "hash": hash, "file": file, "ended": ended,
                    "deep_hash": w.deep_hashes(), "write_ns": write_ns, "on_ui_thread": on_main,
                })
            }
            Err(e) => {
                json!({"ok": false, "code": "save_failed", "item": w.piece.items[i].id, "slot": slot, "step": k, "what": e})
            }
        };
        w.saved.push(out);
    }
}

/// The saves the world wrote since the last call, or the first that failed.
pub fn written(w: &mut World) -> Result<Value, Value> {
    let saved = std::mem::take(&mut w.saved);
    match saved.iter().find(|s| s["ok"] == json!(false)) {
        Some(f) => Err(f.clone()),
        None => Ok(Value::Array(saved)),
    }
}

/// A fresh instance per item holding the saved state at step `k`, as a restore loads a
/// checkpoint: zeroed memory with the save's pages, its globals and arrays, the entries still
/// waiting, and each control's track read through step k − 1. A state that doesn't fit the
/// item's program is refused, naming the item.
fn opened(
    piece: &Rc<Piece>,
    track: &[Entry],
    planted: Planted,
    k: i64,
    states: Vec<State>,
    seen: u64,
) -> Result<World, Failed> {
    // A save's step is one a run reaches: at least 1, and its time fits a flick count.
    if k < 1 || piece.items.iter().any(|i| k.checked_mul(i.step).is_none()) {
        return Err(json!({"code": "save_refused", "differs": [{"what": "state"}]}));
    }
    let track = track_of(track);
    let mut lives = Vec::new();
    for (item, mut s) in piece.items.iter().zip(states) {
        let types = names(&item.bytes).globals;
        let globals_fit =
            s.globals.len() == types.len() || (planted.save_drops_globals && s.globals.is_empty());
        if !globals_fit {
            return Err(
                json!({"code": "save_refused", "differs": [{"what": "globals", "item": item.id, "save": s.globals.len(), "piece": types.len()}]}),
            );
        }
        if s.memory.len() as u64 != memory_bytes(&item.bytes)
            || s.arrays.len() != item.layout.size("writes") as usize
            || !(s.prev.is_empty() || s.prev.len() == s.arrays.len())
            || !(0..=k).contains(&s.ran)
        {
            return Err(
                json!({"code": "save_refused", "differs": [{"what": "state", "item": item.id}]}),
            );
        }
        if planted.open_reapplies_segments {
            for (_, at, bytes) in segments(&item.given) {
                s.memory[at as usize..][..bytes.len()].copy_from_slice(&bytes);
            }
        }
        let globals: Vec<Val> = types
            .iter()
            .zip(&s.globals)
            .map(|((_, ty), x)| val(ty, *x))
            .collect();
        let mut live: Live = World::load(&item.bytes, item, &s.memory, &globals)?;
        live.failed = s.failed;
        live.next = k;
        // As a restore: the step before the save's ran last (Logic: turn clock).
        live.ran = s.ran;
        live.last = k - 1;
        live.arrays = s.arrays;
        live.prev = s.prev;
        live.pending = s.pending;
        live.cursor = track
            .iter()
            .map(|(c, list)| {
                (
                    c.clone(),
                    list.iter().filter(|e| e.t <= (k - 1) * item.step).count(),
                )
            })
            .collect();
        lives.push(live);
    }
    Ok(World::of(piece.clone(), track, lives, planted, seen))
}

/// Opens slot `slot`'s newest save that reads back whole, straight or through a declared
/// migration, then plays the track on to step `steps` − 1, on `adapter`, giving `frames`.
#[allow(clippy::too_many_arguments)]
pub fn open(
    piece: Rc<Piece>,
    dir: &Path,
    slot: i64,
    track: &[Entry],
    steps: i64,
    planted: Planted,
    adapter: &str,
    frames: Option<&Value>,
) -> Result<Value, Value> {
    let all = listed(dir, slot);
    let mut damaged = headless(dir);
    let mut chosen = None;
    for s in &all {
        if let Some(bytes) = s.whole() {
            chosen = Some((s, bytes));
            break;
        }
        damaged.push(json!({"hash": s.hash, "file": s.path}));
    }
    let Some((save, bytes)) = chosen else {
        return Err(json!({"ok": false, "code": "no_save", "slot": slot, "damaged": damaged}));
    };
    let h = &save.header;
    let k = h["step"].as_i64().unwrap_or(0);
    let ended = h["ended"] == json!(true);
    let ours = binding(&piece);
    let differs: Vec<Value> = ["layout", "content", "modules"]
        .iter()
        .zip(&ours)
        .filter(|(f, v)| h[**f].as_str() != Some(v.as_str()))
        .map(|(f, v)| json!({"what": f, "save": h[*f], "piece": v}))
        .collect();
    // Same-machine state opens only on the adapter that wrote it; no migration moves it.
    let other = h["fingerprint"].as_str().filter(|f| *f != adapter);
    let refused = |code: &str, mut extra: Value| {
        let mut out = json!({"ok": false, "code": code, "save": save.hash, "damaged": damaged});
        if let (Some(o), Some(e)) = (out.as_object_mut(), extra.as_object_mut()) {
            o.append(e);
        }
        out
    };
    let fits = |e: Value| {
        if e["code"] == "save_refused" {
            refused("save_refused", e)
        } else {
            e
        }
    };
    let state = bytes
        .iter()
        .position(|b| *b == b'\n')
        .and_then(|n| decode(&bytes[n + 1..], piece.items.len()));
    let mut via = json!({"hash": save.hash, "file": save.path, "step": k, "via": "straight"});
    if let Some(f) = other {
        let mut differs = differs;
        differs.push(json!({"what": "fingerprint", "save": f, "piece": adapter}));
        return Err(refused("save_refused", json!({"differs": differs})));
    }
    // Each counter's steps seen; they all count the same steps.
    let seen = |m: &[(String, u64)]| m.first().map_or(0, |(_, n)| *n);
    let mut w = if differs.is_empty() {
        let state = state.filter(|(s, m)| {
            s.iter()
                .map(|(id, _)| id)
                .eq(piece.items.iter().map(|i| &i.id))
                && m.iter().map(|(id, _)| id).eq(piece.machine.iter())
        });
        let Some((state, machine)) = state else {
            return Err(refused(
                "save_refused",
                json!({"differs": [{"what": "state"}]}),
            ));
        };
        opened(
            &piece,
            track,
            planted,
            k,
            state.into_iter().map(|(_, s)| s).collect(),
            seen(&machine),
        )
        .map_err(fits)?
    } else {
        let from = [&h["layout"], &h["content"], &h["modules"]];
        let migration = piece
            .items
            .iter()
            .flat_map(|i| i.saves.iter().flat_map(|s| &s.migrate))
            .find(|m| m.from.iter().zip(from).all(|(a, b)| b.as_str() == Some(a)));
        let Some(m) = migration else {
            // Under a changed program, bytes the game left inside a data segment are refused too.
            let mut differs = differs;
            if differs.iter().any(|d| d["what"] == "layout") {
                differs.extend(h["segments"].as_array().into_iter().flatten().map(|s| json!({"what": "segment", "item": s["item"], "segment": s["segment"], "offset": s["offset"]})));
            }
            return Err(refused("save_refused", json!({"differs": differs})));
        };
        let failed = |what: &str, trap: Value| {
            refused(
                "migration_failed",
                json!({"by": m.by, "what": what, "trap": trap}),
            )
        };
        let (machine, logic) = state.map_or((Vec::new(), Vec::new()), |(s, m)| (m, s));
        let ([(_, old)], [item]) = (logic.as_slice(), piece.items.as_slice()) else {
            return Err(failed(
                "a migration moves one logic item's saved state, and this one doesn't decode",
                Value::Null,
            ));
        };
        let new = migrate(m, old, item).map_err(|(what, trap)| failed(&what, trap))?;
        let mut w = opened(&piece, track, planted, k, vec![new], seen(&machine)).map_err(fits)?;
        w.saves_dir = Some(dir.to_path_buf());
        w.adapter = adapter.to_string();
        let (hash, file, _) = write(&mut w, k, slot as i32, ended)
            .map_err(|e| refused("save_failed", json!({"what": e})))?;
        via = json!({"hash": hash, "file": file, "step": k, "via": "migration", "from": save.hash});
        w
    };
    w.saves_dir = Some(dir.to_path_buf());
    w.adapter = adapter.to_string();
    let deep = w.deep_hashes();
    let mut rec = Record::default();
    for (item, l) in piece.items.iter().zip(w.lives.iter_mut()) {
        let deep = l.deep_hash();
        rec.checkpoint(&item.id, k, deep, &l.arrays);
        l.checked = Some(k);
    }
    for m in &piece.machine {
        rec.checkpoint(m, k, w.seen_hash(), &[]);
    }
    let at_open: serde_json::Map<String, Value> = piece
        .items
        .iter()
        .zip(&w.published)
        .flat_map(|(i, a)| arrays_json(i, a))
        .collect();
    w.run(steps, &mut rec, &mut |_, _| {});
    let saves = written(&mut w)?;
    let frames = crate::frames(&piece, frames, &rec, Some((k, &at_open)))?;
    Ok(json!({
        "ok": true, "opened": via, "damaged": damaged, "deep_hash": deep, "steps": rec.steps_json(&piece),
        "checkpoints": rec.checkpoints, "traps": rec.traps, "saves": saves, "frames": frames,
    }))
}

/// Runs a migration once under its budget: the old state block at `old_at`, the remap table at
/// `remap_at`, and `migrate()`, whose block at `new_at` becomes the new memory and globals.
/// A block is a u32 memory length, the memory, a u32 global count and 8 bytes a global.
fn migrate(
    m: &crate::piece::Migration,
    old: &State,
    item: &crate::piece::Item,
) -> Result<State, (String, Value)> {
    let fail = |e: String| (e, Value::Null);
    let mut block = (old.memory.len() as u32).to_le_bytes().to_vec();
    block.extend(&old.memory);
    block.extend((old.globals.len() as u32).to_le_bytes());
    for g in &old.globals {
        block.extend(g.to_le_bytes());
    }
    let mut r = Runner::new(&m.bytes, Faults::default(), true).map_err(fail)?;
    let at = |r: &mut Runner, g: &str| match r.global(g) {
        Some(Val::I32(a)) => a as u32 as usize,
        _ => 0,
    };
    let (old_at, remap_at, new_at) = (
        at(&mut r, "old_at"),
        at(&mut r, "remap_at"),
        at(&mut r, "new_at"),
    );
    r.write("memory", old_at, &block).map_err(fail)?;
    if let Some(table) = &m.remap {
        r.write("memory", remap_at, table).map_err(fail)?;
    }
    let size = memory_bytes(&item.bytes) as usize;
    let allowed = old.memory.len() as u64 + size as u64 + 4 * 1024 * 1024;
    if memory_bytes(&m.bytes) > allowed {
        return Err(fail(format!("the migration {} declares {} bytes of memory; its budget is the new memory plus the old plus 4 MiB, {allowed}", m.by, memory_bytes(&m.bytes))));
    }
    let fuel = migration_fuel((old.memory.len() + size) as u64);
    let starts = r.exports(START);
    for export in [START, "migrate"]
        .into_iter()
        .filter(|e| *e != START || starts)
    {
        let out = r
            .call(&Call {
                export: export.into(),
                args: vec![],
                fuel,
                stack: 262_144,
                deadline: None,
            })
            .map_err(fail)?;
        if out.trap.is_some() {
            return Err((
                format!("the migration {} trapped", m.by),
                trap_json(&out.trap),
            ));
        }
    }
    let memory = r.memory("memory").unwrap_or(&[]);
    let globals = names(&item.bytes).globals.len();
    let read = |at: usize, n: usize| memory.get(at..at + n);
    let n = read(new_at, 4).map_or(0, |b| {
        u32::from_le_bytes(b.try_into().expect("4 bytes")) as usize
    });
    let g_at = new_at + 4 + n;
    let g = read(g_at, 4).map_or(0, |b| {
        u32::from_le_bytes(b.try_into().expect("4 bytes")) as usize
    });
    let (Some(new_memory), Some(new_globals)) = (
        read(new_at + 4, n).filter(|_| n == size),
        read(g_at + 4, 8 * g).filter(|_| g == globals),
    ) else {
        return Err(fail(format!("the migration's new state holds {n} bytes of memory and {g} globals; the program has {size} and {globals}")));
    };
    Ok(State {
        failed: old.failed,
        ran: old.ran,
        memory: new_memory.to_vec(),
        globals: new_globals
            .chunks(8)
            .map(|c| u64::from_le_bytes(c.try_into().expect("8 bytes")))
            .collect(),
        arrays: old.arrays.clone(),
        prev: old.prev.clone(),
        pending: old.pending.clone(),
    })
}

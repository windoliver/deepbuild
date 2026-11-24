//! The #2693 acceptance suite's probe (README: The probe). It seals the core build set with this
//! suite's own two test canvas modules, registered through deep-canvas's public Registrar, plays a
//! document through the scheduler's public Session, and answers one JSON request on stdin with
//! one JSON line on stdout: the live heap bytes it counted, the steps each frame ran, each frame's
//! full-state hash, and, built with the feature `ring`, the scheduler's checkpoint-ring reading
//! and its planted rings. Nothing here stands in for the scheduler or its checkpoints.
//!
//! - `test.ring` 1.0.0: kind `test.ring@1`; one operator in simulate stepping at 60 Hz that writes
//!   `test.ring.count` (i64, its step count) and `test.ring.cells` (8,192 f64 values, 65,536
//!   bytes, every one changed each step); carried state `checkpoint` `test.ring.state` with a
//!   byte budget of 16 MiB.
//! - `test.tight` 1.0.0: the same over `test.tight.*`, its byte budget 16 KiB, a quarter of one
//!   checkpoint.

use std::alloc::{GlobalAlloc, Layout, System};
use std::collections::BTreeMap;
use std::io::Read;
use std::sync::atomic::{AtomicI64, Ordering::Relaxed};

use deep_canvas::kinds::{Entry, Version};
use deep_canvas::registry::{BuildSet, Implementation, Manifest, Module, Range, Registrar, Registry, Semver};
use deep_canvas::schedule::{default_view, sha256_hex, Canonical, Options, Scheduler, Session, Val};
use serde_json::{json, Value};

// ---------------------------------------------------------------------------------------------
// The live heap, counted by this probe: every allocation adds its size, every free takes it away.

struct Counted;
static LIVE: AtomicI64 = AtomicI64::new(0);

// SAFETY: every call forwards to the system allocator unchanged; the counter is a relaxed atomic.
unsafe impl GlobalAlloc for Counted {
    unsafe fn alloc(&self, layout: Layout) -> *mut u8 {
        LIVE.fetch_add(layout.size() as i64, Relaxed);
        unsafe { System.alloc(layout) }
    }
    unsafe fn dealloc(&self, ptr: *mut u8, layout: Layout) {
        LIVE.fetch_sub(layout.size() as i64, Relaxed);
        unsafe { System.dealloc(ptr, layout) }
    }
    unsafe fn alloc_zeroed(&self, layout: Layout) -> *mut u8 {
        LIVE.fetch_add(layout.size() as i64, Relaxed);
        unsafe { System.alloc_zeroed(layout) }
    }
    unsafe fn realloc(&self, ptr: *mut u8, layout: Layout, new_size: usize) -> *mut u8 {
        LIVE.fetch_add(new_size as i64 - layout.size() as i64, Relaxed);
        unsafe { System.realloc(ptr, layout, new_size) }
    }
}

#[global_allocator]
static COUNTED: Counted = Counted;

fn live() -> i64 {
    LIVE.load(Relaxed)
}

// ---------------------------------------------------------------------------------------------
// The two test canvas modules.

/// Cells per checkpoint: 8,192 f64 values, 65,536 bytes.
const CELLS: usize = 8_192;
/// 60 Hz in flicks.
const STEP: i64 = 11_760_000;

/// A stepping array of `CELLS` f64 values.
#[derive(Debug)]
struct Cells(Vec<f64>);

impl Canonical for Cells {
    fn encode(&self, out: &mut Vec<u8>) {
        out.reserve(self.0.len() * 8);
        for x in &self.0 {
            out.extend_from_slice(&x.to_bits().to_le_bytes());
        }
    }
}

/// The cells after step `count`: every cell differs from the last step's.
fn cells(count: i64) -> Cells {
    let base = (count as f64) * (CELLS as f64);
    Cells((0..CELLS).map(|i| base + i as f64).collect())
}

fn manifest(name: &str) -> Manifest {
    Manifest {
        name: name.into(),
        version: Semver { major: 1, minor: 0, patch: 0 },
        core: Range::parse("*").expect("`*` is a range"),
        depends_on: BTreeMap::new(),
        feature: name.replace('.', "-"),
        license: "Apache-2.0".into(),
        implements: format!("{name}@1"),
        implementation: Implementation::reference(name, Semver::parse("1.0.0").expect("a version")),
    }
}

fn kind(name: &'static str) -> Entry {
    Entry {
        family: "test",
        name,
        versions: vec![Version { major: 1, minor: 0, params: vec![] }],
        migrations: vec![],
    }
}

fn has_kind(doc: &Value, kind: &str) -> bool {
    doc.get("items")
        .and_then(Value::as_object)
        .is_some_and(|items| items.values().any(|i| i.get("kind").and_then(Value::as_str) == Some(kind)))
}

fn count_of(v: Option<Val>) -> i64 {
    v.and_then(|v| v.as_typed::<i64>().map(|n| *n)).unwrap_or(0)
}

fn register_ring(r: &mut Registrar) {
    r.kind(kind("ring"), &[], "");
    r.array("test.ring.count", "i64", "document", "time", "simulate");
    r.array("test.ring.cells", "f64", "document", "time", "simulate");
    r.carried("checkpoint", "test.ring.state", 16 << 20);
    r.operator("step", "simulate", &[], &["test.ring.count", "test.ring.cells"])
        .steps(STEP)
        .applies(|doc, _, _| has_kind(doc, "test.ring@1"))
        .run(|v| {
            let count = count_of(v.carried("test.ring.count")) + 1;
            v.note_step(count, 0);
            v.write("test.ring.count", Val::typed(count))?;
            v.write("test.ring.cells", Val::typed(cells(count)))
        });
}

fn register_tight(r: &mut Registrar) {
    r.kind(kind("tight"), &[], "");
    r.array("test.tight.count", "i64", "document", "time", "simulate");
    r.array("test.tight.cells", "f64", "document", "time", "simulate");
    r.carried("checkpoint", "test.tight.state", 16 << 10);
    r.operator("step", "simulate", &[], &["test.tight.count", "test.tight.cells"])
        .steps(STEP)
        .applies(|doc, _, _| has_kind(doc, "test.tight@1"))
        .run(|v| {
            let count = count_of(v.carried("test.tight.count")) + 1;
            v.note_step(count, 0);
            v.write("test.tight.count", Val::typed(count))?;
            v.write("test.tight.cells", Val::typed(cells(count)))
        });
}

fn ring() -> Module {
    Module { manifest: manifest("test.ring"), register: register_ring }
}

fn tight() -> Module {
    Module { manifest: manifest("test.tight"), register: register_tight }
}

fn document(module: &str) -> Value {
    let kind = format!("test.{module}@1");
    json!({"format": 1, "profile": "board", "title": "Checkpoint ring", "size": [100, 100], "seed": 2693,
           "items": {"s": {"id": "s", "kind": kind, "name": "Stepper", "order": "a0", "params": {}}}})
}

// ---------------------------------------------------------------------------------------------
// The ring's reading and planted rings: the surface #2693 adds (README: What the change adds).

#[cfg(feature = "ring")]
fn reading(session: &Session, s: &Scheduler<'_>) -> Value {
    session.checkpoint_ring(s)
}

#[cfg(not(feature = "ring"))]
fn reading(_: &Session, _: &Scheduler<'_>) -> Value {
    Value::Null
}

#[cfg(feature = "ring")]
fn plant(options: &mut Options, planted: &str) -> Result<(), String> {
    match planted {
        "ring_drops_start" => options.planted.ring_drops_start = true,
        "ring_newest_only" => options.planted.ring_newest_only = true,
        other => return Err(format!("no planted ring named {other}")),
    }
    Ok(())
}

#[cfg(not(feature = "ring"))]
fn plant(_: &mut Options, planted: &str) -> Result<(), String> {
    Err(format!("the probe was built without the feature `ring`, so no planted ring {planted}"))
}

// ---------------------------------------------------------------------------------------------
// Playing and seeking.

/// One frame's record: the steps it ran of the document's stepping module, the last count those
/// steps noted, and the full-state hash: every carried-state row's hash and every node's result.
fn frame(session: &mut Session, s: &mut Scheduler<'_>, doc: &Value, module: &str, t: i64) -> Value {
    session.frame(s, t, &default_view(doc));
    let _ = s.take_hashes();
    let _ = s.take_json();
    let name = format!("test.{module}");
    let steps: Vec<&deep_canvas::schedule::StepLog> =
        session.report.steps.iter().filter(|l| l.module == name).collect();
    let carried: Vec<Value> = session
        .carried(s)
        .into_iter()
        .map(|c| json!([c.module, c.kind, c.key, c.hash]))
        .collect();
    let nodes: Vec<Value> = session
        .nodes(s)
        .into_iter()
        .map(|n| json!([n.operator, n.item, n.result]))
        .collect();
    let state = json!({"carried": carried, "nodes": nodes});
    json!({"t": t, "steps": steps.len(), "first_step": steps.first().map(|l| l.t),
           "last_count": steps.last().map(|l| l.count),
           "hash": sha256_hex(serde_json::to_string(&state).expect("json").as_bytes()),
           "frozen": session.frozen().map(|f| f.code)})
}

fn main() {
    let mut text = String::new();
    std::io::stdin().read_to_string(&mut text).expect("stdin");
    let req: Value = serde_json::from_str(&text).expect("one JSON request");
    let module = req["module"].as_str().unwrap_or("ring").to_string();
    let play_to = req["play_to"].as_i64().expect("play_to");
    let period = req["frame"].as_i64().unwrap_or(STEP);
    let seeks: Vec<i64> = req["seeks"].as_array().map(|a| a.iter().filter_map(Value::as_i64).collect()).unwrap_or_default();
    let mut options = Options::default();
    if let Some(planted) = req["planted"].as_str() {
        if let Err(e) = plant(&mut options, planted) {
            println!("{}", json!({"refused": e}));
            return;
        }
    }
    let sealed = Registry::new(BuildSet::Core).with(ring()).with(tight()).seal().expect("the core with the test modules seals");
    let doc = document(&module);
    let started = std::time::Instant::now();

    // The seek side: one session played from the start to `play_to` at every frame, then sought
    // to each time in the order given.
    let mut out = json!({"module": module, "play_to": play_to, "frame": period});
    {
        let mut s = Scheduler::new(&sealed, options.clone());
        let mut session = Session::new(0, BTreeMap::new());
        let issues: Vec<Value> = session.load(&mut s, &doc).iter().map(|i| json!({"code": i.code, "path": i.path})).collect();
        out["load_issues"] = json!(issues);
        let after_load = live();
        let first = frame(&mut session, &mut s, &doc, &module, 0);
        let after_start = live();
        let mut steps_played = first["steps"].as_u64().unwrap_or(0);
        let mut last = first.clone();
        let mut t = period;
        while t <= play_to {
            last = frame(&mut session, &mut s, &doc, &module, t);
            steps_played += last["steps"].as_u64().unwrap_or(0);
            t += period;
        }
        let after_play = live();
        out["heap"] = json!({"after_load": after_load, "after_start": after_start, "after_play": after_play,
                             "held_since_start": after_play - after_start});
        out["played"] = json!({"steps": steps_played, "last": last, "first": first});
        out["reading"] = reading(&session, &s);
        let mut sought = Vec::new();
        for &to in &seeks {
            let mut f = frame(&mut session, &mut s, &doc, &module, to);
            f["reading"] = reading(&session, &s);
            sought.push(f);
        }
        out["seeks"] = json!(sought);
        out["heap"]["after_seeks"] = json!(live());
    }

    // The play side: a fresh session played straight from the start, through every frame and
    // every sought time in ascending order, never sought.
    if req["play_side"].as_bool().unwrap_or(false) && !seeks.is_empty() {
        let mut s = Scheduler::new(&sealed, Options::default());
        let mut session = Session::new(0, BTreeMap::new());
        session.load(&mut s, &doc);
        let mut times: Vec<i64> = seeks.clone();
        times.sort_unstable();
        times.dedup();
        let end = *times.last().expect("a time");
        let mut wanted = times.iter().peekable();
        let mut played = BTreeMap::new();
        let mut t = 0;
        loop {
            while let Some(&&w) = wanted.peek() {
                if w > t {
                    break;
                }
                if w < t {
                    let f = frame(&mut session, &mut s, &doc, &module, w);
                    played.insert(w, f["hash"].clone());
                }
                wanted.next();
            }
            if t > end {
                break;
            }
            let f = frame(&mut session, &mut s, &doc, &module, t);
            if times.binary_search(&t).is_ok() {
                played.insert(t, f["hash"].clone());
            }
            t += period;
        }
        out["play"] = json!(played.into_iter().map(|(t, h)| json!({"t": t, "hash": h})).collect::<Vec<_>>());
    }
    out["ms"] = json!(started.elapsed().as_millis() as u64);
    println!("{out}");
}

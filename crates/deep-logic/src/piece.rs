//! A piece's logic items and their check (canvas primitives: Logic `logic@1`; #531): the fields
//! this task builds, the program through sandbox@1's check and rewrite in the role `logic`, the
//! region map and its digest, and the logic module's own refusals: a write that isn't the item's
//! own array, a read of nothing declared, a write region past the end of memory and a program
//! whose `regions_digest` isn't its item's layout digest.

use std::collections::{BTreeMap, BTreeSet};

use base64::{engine::general_purpose::STANDARD as B64, Engine as _};
use deep_canvas_sandbox::rewrite::{self, hash, Mode, Rewritten};
use deep_sandbox_wasmtime::service::{refusals_json, Budget, Sandbox};
use serde_json::{json, Map, Value};
use wasmparser::{ExternalKind, Operator, Parser, Payload};

use crate::lines::Lines;
use crate::Planted;

pub const PAGE: u64 = 65_536;
const MIB: u64 = 1024 * 1024;
/// The most entries a control hands a step (Logic `logic@1`: Semantics); any more wait.
pub const PER_STEP: usize = 16;
/// A control's slot: a u32 count and 4 zero bytes, then each entry as a u32 player, 4 zero
/// bytes and a slider's f64 value.
pub const SLOT: u32 = 8 + PER_STEP as u32 * 16;

/// One field of a logic item this task doesn't build yet: refused by name, never ignored.
const LATER: [&str; 10] = [
    "fires", "links", "clock", "due", "emits", "preview", "pages", "parallel", "services",
    "mirrors",
];

/// A refusal as `check` answers it.
#[derive(Debug)]
pub struct Refused(pub Value);

fn logic_refused(item: &str, refusals: Vec<Value>) -> Refused {
    Refused(json!({"ok": false, "code": "logic_refused", "item": item, "refusals": refusals}))
}

fn refusal(rule: &str, what: String, extra: Value) -> Value {
    let mut out = json!({"rule": rule, "what": what});
    if let (Some(o), Value::Object(e)) = (out.as_object_mut(), extra) {
        o.extend(e);
    }
    out
}

/// A write's element type.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Ty {
    Bool,
    I32,
    F64,
    Vec2,
    Vec3,
    Quat,
}

impl Ty {
    fn named(s: &str) -> Option<Ty> {
        Some(match s {
            "bool" => Ty::Bool,
            "i32" => Ty::I32,
            "f64" => Ty::F64,
            "vec2" => Ty::Vec2,
            "vec3" => Ty::Vec3,
            "quat" => Ty::Quat,
            _ => return None,
        })
    }
    pub fn name(self) -> &'static str {
        match self {
            Ty::Bool => "bool",
            Ty::I32 => "i32",
            Ty::F64 => "f64",
            Ty::Vec2 => "vec2",
            Ty::Vec3 => "vec3",
            Ty::Quat => "quat",
        }
    }
    /// Bytes an element takes: bool and i32 as 4, f64 and each vector component as 8.
    pub fn size(self) -> u32 {
        match self {
            Ty::Bool | Ty::I32 => 4,
            Ty::F64 => 8,
            Ty::Vec2 => 16,
            Ty::Vec3 => 24,
            Ty::Quat => 32,
        }
    }
    /// An element's value, from its bytes.
    pub fn value(self, b: &[u8]) -> Value {
        let f = |i: usize| f64::from_le_bytes(b[8 * i..8 * i + 8].try_into().expect("8 bytes"));
        match self {
            Ty::Bool => json!(u32::from_le_bytes(b[..4].try_into().expect("4 bytes")) != 0),
            Ty::I32 => json!(i32::from_le_bytes(b[..4].try_into().expect("4 bytes"))),
            Ty::F64 => json!(f(0)),
            Ty::Vec2 => json!([f(0), f(1)]),
            Ty::Vec3 => json!([f(0), f(1), f(2)]),
            Ty::Quat => json!([f(0), f(1), f(2), f(3)]),
        }
    }
}

/// One entry of the region map.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Region {
    pub region: &'static str,
    pub name: String,
    pub offset: u32,
    pub size: u32,
    pub ty: String,
    /// What fills a read entry.
    pub read: Read,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Read {
    Control,
    /// Another item's array: its index in the piece, and the bytes of its write region it is.
    Array {
        item: usize,
        offset: u32,
    },
    Seed,
    /// A write entry.
    None,
}

/// The region map (Logic `logic@1`: Region map) and its digest.
#[derive(Clone, Debug)]
pub struct Layout {
    pub entries: Vec<Region>,
    pub digest: u64,
}

impl Layout {
    pub fn size(&self, region: &str) -> u32 {
        self.entries
            .iter()
            .filter(|e| e.region == region)
            .map(|e| e.offset + e.size)
            .max()
            .unwrap_or(0)
    }
    pub fn to_json(&self) -> Value {
        let entries: Vec<Value> = self
            .entries
            .iter()
            .map(|e| json!({"region": e.region, "name": e.name, "offset": e.offset, "size": e.size, "type": e.ty}))
            .collect();
        json!({"digest": format!("{:016x}", self.digest), "entries": entries})
    }
}

/// The first 8 bytes of a sha256, as a big-endian u64: the logic module's 64-bit hash.
pub fn h64(bytes: &[u8]) -> u64 {
    let d = sha2::Digest::finalize(sha2::Digest::chain_update(sha2::Sha256::default(), bytes));
    u64::from_be_bytes(d[..8].try_into().expect("8 bytes"))
}

/// The seed of step k: hash(the document's seed, the logic ID, k).
pub fn step_seed(doc: i64, id: &str, k: i64) -> i64 {
    let mut b = doc.to_le_bytes().to_vec();
    b.extend(id.as_bytes());
    b.push(0);
    b.extend(k.to_le_bytes());
    h64(&b) as i64
}

/// A write, as declared.
#[derive(Clone, Debug)]
pub struct Write {
    pub name: String,
    pub ty: Ty,
    pub count: u32,
}

/// A checked logic item: everything a step needs.
#[derive(Clone, Debug)]
pub struct Item {
    pub id: String,
    pub program: String,
    /// The bytes that run: sandbox@1's rewrite, or the program as built under `runs_unchecked`.
    pub bytes: Vec<u8>,
    pub hash: String,
    /// The bytes as given, whose code offsets the sidecar's DWARF stands for.
    pub given: Vec<u8>,
    pub step: i64,
    pub reads: Vec<String>,
    pub writes: Vec<Write>,
    pub layout: Layout,
    pub reads_at: u32,
    pub writes_at: u32,
    pub fuel: i64,
    pub stack: i32,
    pub every: i64,
    /// The checkpoint ring's byte budget.
    pub ring: u64,
    pub lines: Option<Lines>,
    /// The data assets it names, in order, by hash, and where they're copied: `assets_at`.
    pub assets: Vec<(String, Vec<u8>)>,
    pub assets_at: u32,
    /// What the item's bake key covers of it: its rewritten program, its fields as given and
    /// its assets' hashes (Logic: checkpoints and bake).
    pub content: String,
}

impl Item {
    pub fn checked(&self) -> Value {
        json!({"program": self.program, "hash": self.hash, "layout": self.layout.to_json(), "assets_at": self.assets_at})
    }
    /// The assets as memory holds them from `assets_at`: each after a u32 of its length.
    pub fn asset_bytes(&self) -> Vec<u8> {
        let mut out = Vec::new();
        for (_, b) in &self.assets {
            out.extend((b.len() as u32).to_le_bytes());
            out.extend(b);
        }
        out
    }
    /// The write entry of an array, by name.
    pub fn write(&self, name: &str) -> Option<&Region> {
        self.layout
            .entries
            .iter()
            .find(|e| e.region == "writes" && e.name == name)
    }
    /// The rewrite that counts each block, for logic.budget.
    pub fn counted(&self, planted: &Planted) -> Result<Rewritten, String> {
        rewrite::rewrite_as(&self.given, planted.rewrite, Mode::Counted)
    }
}

/// A piece: its seed, controls, tour and checked logic items in order.
#[derive(Clone, Debug)]
pub struct Piece {
    pub seed: i64,
    pub controls: BTreeSet<String>,
    pub tour: Option<Value>,
    pub items: Vec<Item>,
}

/// An item's immutable i32 global's value, by its export name.
fn global_at(bytes: &[u8], name: &str) -> Option<u32> {
    let mut inits = Vec::new();
    let mut index = None;
    for payload in Parser::new(0).parse_all(bytes) {
        match payload.ok()? {
            Payload::GlobalSection(s) => {
                for g in s {
                    let g = g.ok()?;
                    let mut ops = g.init_expr.get_operators_reader();
                    inits.push(match ops.read().ok()? {
                        Operator::I32Const { value } => Some(value as u32),
                        _ => None,
                    });
                }
            }
            Payload::ExportSection(s) => {
                for e in s {
                    let e = e.ok()?;
                    if e.name == name && e.kind == ExternalKind::Global {
                        index = Some(e.index as usize);
                    }
                }
            }
            _ => {}
        }
    }
    inits.get(index?).copied().flatten()
}

/// The exported immutable i64 global `regions_digest`, if any: `Err` when it isn't one.
fn regions_digest(bytes: &[u8]) -> Result<Option<u64>, String> {
    let mut globals = Vec::new();
    let mut index = None;
    for payload in Parser::new(0).parse_all(bytes) {
        match payload.map_err(|e| e.to_string())? {
            Payload::GlobalSection(s) => {
                for g in s {
                    let g = g.map_err(|e| e.to_string())?;
                    let mut ops = g.init_expr.get_operators_reader();
                    let v = match ops.read().map_err(|e| e.to_string())? {
                        Operator::I64Const { value } if !g.ty.mutable => Some(value as u64),
                        _ => None,
                    };
                    globals.push(v);
                }
            }
            Payload::ExportSection(s) => {
                for e in s {
                    let e = e.map_err(|e| e.to_string())?;
                    if e.name == "regions_digest" {
                        if e.kind != ExternalKind::Global {
                            return Err("regions_digest is not a global".into());
                        }
                        index = Some(e.index as usize);
                    }
                }
            }
            _ => {}
        }
    }
    match index {
        None => Ok(None),
        Some(i) => globals
            .get(i)
            .copied()
            .flatten()
            .map(Some)
            .ok_or_else(|| "regions_digest is an immutable i64 global".into()),
    }
}

/// The program's one memory, in bytes.
fn memory_bytes(bytes: &[u8]) -> u64 {
    for payload in Parser::new(0).parse_all(bytes) {
        if let Ok(Payload::MemorySection(s)) = payload {
            if let Some(Ok(m)) = s.into_iter().next() {
                return m.initial * PAGE;
            }
        }
    }
    0
}

/// A name the item's own array can have: no path, no module prefix.
fn own_name(n: &str) -> bool {
    let mut c = n.chars();
    matches!(c.next(), Some('a'..='z'))
        && c.all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '_')
}

fn align8(n: u32) -> u32 {
    n.div_ceil(8) * 8
}

/// The layouts each item ID has had, in this process: what a `regions_digest` check names
/// entries from.
pub type History = BTreeMap<String, Vec<Layout>>;

/// The fields each item declares, before its program is checked.
struct Declared {
    program: String,
    debug: Option<String>,
    step: i64,
    reads: Vec<String>,
    writes: Vec<Write>,
    fuel: i64,
    memory: u64,
    stack: i32,
    every: i64,
    ring: u64,
    assets: Vec<String>,
    /// The item's fields as given, for its bake key.
    given: String,
}

fn declared(id: &str, params: &Map<String, Value>) -> Result<Declared, Refused> {
    let bad = |field: &str, what: String| {
        logic_refused(id, vec![refusal("field", what, json!({"field": field}))])
    };
    for k in params.keys() {
        if LATER.contains(&k.as_str()) {
            return Err(bad(k, format!("{k} isn't built yet in logic@1 (#531 builds the fixed step, its regions, seeds and traps)")));
        }
        if ![
            "program",
            "debug",
            "step_rate",
            "reads",
            "writes",
            "budget",
            "checkpoint",
            "assets",
        ]
        .contains(&k.as_str())
        {
            return Err(bad(k, format!("logic@1 has no field {k}")));
        }
    }
    let program = params
        .get("program")
        .and_then(Value::as_str)
        .ok_or_else(|| {
            bad(
                "program",
                "a logic item names its program by asset ID".into(),
            )
        })?
        .to_string();
    let debug = params
        .get("debug")
        .and_then(Value::as_str)
        .map(str::to_string);
    let hz = params.get("step_rate").map_or(Some(60.0), Value::as_f64);
    let step = hz
        .ok_or_else(|| bad("step_rate", "step_rate is a number of hertz".into()))
        .and_then(|hz| deep_canvas::time::step_length(hz).map_err(|e| bad("step_rate", e)))?;
    let reads: Vec<String> = match params.get("reads") {
        None => Vec::new(),
        Some(Value::Array(a)) => a
            .iter()
            .map(|r| r.as_str().map(str::to_string))
            .collect::<Option<_>>()
            .ok_or_else(|| bad("reads", "reads is a list of IDs and array paths".into()))?,
        Some(_) => {
            return Err(bad(
                "reads",
                "reads is a list of IDs and array paths".into(),
            ))
        }
    };
    let mut writes = Vec::new();
    let mut refused = Vec::new();
    for (name, w) in params
        .get("writes")
        .and_then(Value::as_object)
        .into_iter()
        .flatten()
    {
        if !own_name(name) {
            refused.push(refusal(
                "write",
                format!("{name} isn't the item's own array: a logic item writes only its own arrays, never a status color, another module's array, a check or the record"),
                json!({"write": name}),
            ));
            continue;
        }
        let ty = w.get("type").and_then(Value::as_str).and_then(Ty::named);
        let count = w
            .get("count")
            .map_or(Some(1), Value::as_u64)
            .filter(|c| *c >= 1 && *c <= u32::MAX as u64);
        let interpolate = w.get("interpolate").map_or(Some("hold"), Value::as_str);
        match (ty, count, interpolate) {
            (Some(ty), Some(count), Some("hold" | "linear")) => writes.push(Write {
                name: name.clone(),
                ty,
                count: count as u32,
            }),
            _ => refused.push(refusal(
                "write",
                format!("{name} declares a type, a count of at least 1 and hold or linear"),
                json!({"write": name}),
            )),
        }
    }
    // Sized in u64 and held to the largest memory, so no region's size or offset passes a u32.
    let total: u64 = writes
        .iter()
        .map(|w: &Write| (u64::from(w.ty.size()) * u64::from(w.count)).div_ceil(8) * 8)
        .sum();
    if total > 64 * MIB {
        refused.push(refusal(
            "write",
            "the writes pass a logic item's largest memory, 64 MiB".into(),
            json!({}),
        ));
    }
    if !refused.is_empty() {
        return Err(logic_refused(id, refused));
    }
    fn get<'a>(o: Option<&'a Value>, k: &str) -> Option<&'a Value> {
        o.and_then(|b| b.get(k))
    }
    let budget = params.get("budget");
    let num = |k: &str, d: u64, max: u64| -> Result<u64, Refused> {
        match get(budget, k) {
            None => Ok(d),
            Some(v) => v.as_u64().filter(|n| *n >= 1 && *n <= max).ok_or_else(|| {
                bad(
                    &format!("budget/{k}"),
                    format!("budget.{k} is at most {max}"),
                )
            }),
        }
    };
    let fuel = num("fuel", 1_000_000, 10_000_000)? as i64;
    let memory = num("memory", 4, 64)? * MIB;
    let stack = num("stack", 64, 256)? as i32 * 1024;
    let every = match get(params.get("checkpoint"), "every") {
        None => 60,
        Some(v) => v.as_i64().filter(|n| *n >= 1).ok_or_else(|| {
            bad(
                "checkpoint/every",
                "checkpoint.every is a number of steps".into(),
            )
        })?,
    };
    let ring = match get(params.get("checkpoint"), "budget") {
        None => 64 * MIB,
        Some(v) => v.as_u64().filter(|n| *n >= 1).ok_or_else(|| {
            bad(
                "checkpoint/budget",
                "checkpoint.budget is a number of bytes".into(),
            )
        })?,
    };
    let assets: Vec<String> = match params.get("assets") {
        None => Vec::new(),
        Some(Value::Array(a)) => a
            .iter()
            .map(|r| r.as_str().map(str::to_string))
            .collect::<Option<_>>()
            .ok_or_else(|| bad("assets", "assets is a list of asset IDs".into()))?,
        Some(_) => return Err(bad("assets", "assets is a list of asset IDs".into())),
    };
    Ok(Declared {
        program,
        debug,
        step,
        reads,
        writes,
        fuel,
        memory,
        stack,
        every,
        ring,
        assets,
        given: Value::Object(params.clone()).to_string(),
    })
}

/// Checks every item of a piece in order: the first refusal answers.
pub fn check(piece: &Value, planted: &Planted, history: &mut History) -> Result<Piece, Refused> {
    let bad = || Refused(json!({"ok": false, "code": "bad_input"}));
    let seed = piece.get("seed").and_then(Value::as_i64).ok_or_else(bad)?;
    let controls: BTreeSet<String> = piece
        .get("controls")
        .and_then(Value::as_object)
        .map(|c| c.keys().cloned().collect())
        .unwrap_or_default();
    let assets = piece
        .get("assets")
        .and_then(Value::as_object)
        .cloned()
        .unwrap_or_default();
    let asset = |sha: &str| -> Option<Vec<u8>> {
        let bytes = B64.decode(assets.get(sha)?.as_str()?).ok()?;
        (hash(&bytes) == sha).then_some(bytes)
    };
    let items_in = piece
        .get("items")
        .and_then(Value::as_object)
        .ok_or_else(bad)?;
    // Every item's declared fields first, so a read can name a later item's array.
    let mut decls = Vec::new();
    for (id, item) in items_in {
        if item.get("kind").and_then(Value::as_str) != Some("logic@1") {
            return Err(logic_refused(
                id,
                vec![refusal(
                    "kind",
                    "only logic@1 items are stepped here".into(),
                    json!({}),
                )],
            ));
        }
        let params = item
            .get("params")
            .and_then(Value::as_object)
            .cloned()
            .unwrap_or_default();
        decls.push((id.clone(), declared(id, &params)?));
    }
    let mut items = Vec::new();
    for (idx, (id, d)) in decls.iter().enumerate() {
        let missing = |what: &str, sha: &str| {
            logic_refused(
                id,
                vec![refusal(
                    "asset",
                    format!("the piece carries no {what} asset {sha}"),
                    json!({"asset": sha}),
                )],
            )
        };
        let given = asset(&d.program).ok_or_else(|| missing("program", &d.program))?;
        let lines = match &d.debug {
            None => None,
            Some(sha) => {
                let side = asset(sha).ok_or_else(|| missing("debug", sha))?;
                Some(Lines::new(&given, &side).map_err(|e| {
                    logic_refused(id, vec![refusal("debug", e, json!({"field": "debug"}))])
                })?)
            }
        };
        // sandbox@1's check and rewrite in the role logic (#238): the only bytes that reach the engine.
        let budget = Budget {
            fuel: d.fuel,
            stack: d.stack,
            memory: d.memory,
        };
        let (bytes, hash) = if planted.runs_unchecked {
            (given.clone(), hash(&given))
        } else {
            let sandbox = Sandbox {
                planted: deep_sandbox_wasmtime::service::Planted {
                    rewrite: planted.rewrite,
                    ..Default::default()
                },
            };
            match sandbox.rewrite(&given, "logic", &budget) {
                Ok((out, _)) => (out.bytes, out.hash),
                Err(Ok(r)) => {
                    return Err(Refused(
                        json!({"ok": false, "code": "subset_refused", "item": id, "refusals": refusals_json(&r)}),
                    ))
                }
                Err(Err(e)) => {
                    return Err(Refused(
                        json!({"ok": false, "code": "rewrite_failed", "item": id, "what": e}),
                    ))
                }
            }
        };
        // The region map, in declaration order: reads, the step's seed, then writes.
        let mut entries = Vec::new();
        let mut at = 0u32;
        let mut refused = Vec::new();
        for r in &d.reads {
            let (size, ty, read) = if controls.contains(r) {
                (SLOT, "control".to_string(), Read::Control)
            } else if let Some((other, name)) = r.split_once('.') {
                match decls.iter().position(|(o, _)| o == other) {
                    Some(i) if i == idx => {
                        refused.push(refusal(
                            "read",
                            format!("{r} is this item's own array: a cycle"),
                            json!({"read": r}),
                        ));
                        continue;
                    }
                    Some(i) => {
                        let ws = &decls[i].1.writes;
                        let mut off = 0;
                        let mut found = None;
                        for w in ws {
                            if w.name == name {
                                found = Some((
                                    w.ty.size() * w.count,
                                    w.ty.name().to_string(),
                                    Read::Array {
                                        item: i,
                                        offset: off,
                                    },
                                ));
                            }
                            off = align8(off + w.ty.size() * w.count);
                        }
                        match found {
                            Some(f) => f,
                            None => {
                                refused.push(refusal(
                                    "read",
                                    format!("{other} declares no array {name}"),
                                    json!({"read": r}),
                                ));
                                continue;
                            }
                        }
                    }
                    None => {
                        refused.push(refusal(
                            "read",
                            format!("{r} names no control or logic item of this piece"),
                            json!({"read": r}),
                        ));
                        continue;
                    }
                }
            } else {
                refused.push(refusal(
                    "read",
                    format!("{r} names no control or logic item of this piece"),
                    json!({"read": r}),
                ));
                continue;
            };
            // A read region past what a u32 addresses fits no memory, and leaves the seed 8 bytes.
            let Some(end) = at.checked_add(size).filter(|n| *n <= u32::MAX - 15) else {
                refused.push(refusal(
                    "read",
                    format!("{r} takes the read region past 4 GiB"),
                    json!({"read": r}),
                ));
                continue;
            };
            entries.push(Region {
                region: "reads",
                name: r.clone(),
                offset: at,
                size,
                ty,
                read,
            });
            at = align8(end);
        }
        entries.push(Region {
            region: "reads",
            name: "seed".into(),
            offset: at,
            size: 8,
            ty: "i64".into(),
            read: Read::Seed,
        });
        let mut at = 0u32;
        for w in &d.writes {
            entries.push(Region {
                region: "writes",
                name: w.name.clone(),
                offset: at,
                size: w.ty.size() * w.count,
                ty: w.ty.name().into(),
                read: Read::None,
            });
            at = align8(at + w.ty.size() * w.count);
        }
        let text: String = entries
            .iter()
            .map(|e| format!("{}|{}|{}|{}|{}\n", e.region, e.name, e.offset, e.size, e.ty))
            .collect();
        let layout = Layout {
            digest: h64(text.as_bytes()),
            entries,
        };
        let past = history.entry(id.clone()).or_default();
        if !past.iter().any(|l| l.digest == layout.digest) {
            past.push(layout.clone());
        }
        // The write region inside memory, checked here; the read region traps with kind bounds.
        let memory = memory_bytes(&given);
        let reads_at = global_at(&given, "reads_at");
        let writes_at = global_at(&given, "writes_at");
        let (Some(reads_at), Some(writes_at)) = (reads_at, writes_at) else {
            return Err(logic_refused(
                id,
                vec![refusal(
                    "region",
                    "reads_at and writes_at are immutable i32 globals holding an address".into(),
                    json!({}),
                )],
            ));
        };
        if u64::from(writes_at) + u64::from(layout.size("writes")) > memory {
            refused.push(refusal(
                "region",
                format!("the write region, {} bytes at {writes_at}, passes the end of memory at {memory}", layout.size("writes")),
                json!({"region": "writes"}),
            ));
        }
        let assets_at = global_at(&given, "assets_at");
        let mut assets = Vec::new();
        for sha in &d.assets {
            assets.push((sha.clone(), asset(sha).ok_or_else(|| missing("data", sha))?));
        }
        if !assets.is_empty() {
            match assets_at {
                None => refused.push(refusal(
                    "region",
                    "an item with assets exports assets_at, an immutable i32 global holding an address".into(),
                    json!({"field": "assets"}),
                )),
                Some(at) => {
                    let regions = [
                        ("the read region", reads_at, layout.size("reads")),
                        ("the write region", writes_at, layout.size("writes")),
                    ];
                    refused.extend(placed(&assets, at, memory, &regions, &data_segments(&given)));
                }
            }
        }
        match regions_digest(&given) {
            Err(e) => refused.push(refusal("regions_digest", e, json!({}))),
            Ok(Some(v)) if v != layout.digest => {
                refused.extend(stale(&layout, v, &history[id], planted))
            }
            Ok(_) => {}
        }
        if !refused.is_empty() {
            return Err(logic_refused(id, refused));
        }
        let content = {
            let mut b = hash.clone().into_bytes();
            b.push(0);
            b.extend(d.given.as_bytes());
            for (sha, _) in &assets {
                b.push(0);
                b.extend(sha.as_bytes());
            }
            format!("{:016x}", h64(&b))
        };
        items.push(Item {
            id: id.clone(),
            program: d.program.clone(),
            bytes,
            hash,
            given,
            step: d.step,
            reads: d.reads.clone(),
            writes: d.writes.clone(),
            layout,
            reads_at,
            writes_at,
            fuel: d.fuel,
            stack: d.stack,
            every: d.every,
            ring: d.ring,
            lines,
            content,
            assets,
            assets_at: assets_at.unwrap_or(0),
        });
    }
    Ok(Piece {
        seed,
        controls,
        tour: piece.get("tour").cloned(),
        items,
    })
}

/// Each active data segment's bytes in memory, `[start, end)`.
fn data_segments(bytes: &[u8]) -> Vec<(u64, u64)> {
    let mut out = Vec::new();
    for payload in Parser::new(0).parse_all(bytes) {
        if let Ok(Payload::DataSection(s)) = payload {
            for d in s.into_iter().flatten() {
                if let wasmparser::DataKind::Active { offset_expr, .. } = d.kind {
                    if let Ok(Operator::I32Const { value }) =
                        offset_expr.get_operators_reader().read()
                    {
                        let start = u64::from(value as u32);
                        out.push((start, start + d.data.len() as u64));
                    }
                }
            }
        }
    }
    out
}

/// A refusal naming each asset, in order, whose copy (a u32 of its length, then its bytes, from
/// `at`) would pass the end of memory or overlap a region or an active data segment.
fn placed(
    assets: &[(String, Vec<u8>)],
    at: u32,
    memory: u64,
    regions: &[(&str, u32, u32)],
    segments: &[(u64, u64)],
) -> Vec<Value> {
    let mut out = Vec::new();
    let mut start = u64::from(at);
    for (sha, bytes) in assets {
        let end = start + 4 + bytes.len() as u64;
        let overlaps = |a: u64, b: u64| a < b && start < b && a < end;
        let why = if end > memory {
            Some(format!("passes the end of memory at {memory}"))
        } else if let Some((name, r, n)) = regions
            .iter()
            .find(|(_, r, n)| overlaps(u64::from(*r), u64::from(*r) + u64::from(*n)))
        {
            Some(format!("overlaps {name}, {n} bytes at {r}"))
        } else {
            segments
                .iter()
                .find(|(a, b)| overlaps(*a, *b))
                .map(|(a, b)| format!("overlaps an active data segment, bytes {a} to {b}"))
        };
        if let Some(why) = why {
            out.push(refusal(
                "assets",
                format!("asset {sha}, copied to bytes {start} to {end} from assets_at, {why}"),
                json!({"asset": sha}),
            ));
        }
        start = end;
    }
    out
}

/// A program built for another layout of the item: the first entry, in the item's declaration
/// order, whose offset differs from the layout whose digest it exports.
fn stale(now: &Layout, theirs: u64, past: &[Layout], planted: &Planted) -> Vec<Value> {
    let what = |e: &Region| {
        format!("the program was built for layout {theirs:016x}, where {} sits elsewhere; its item's layout is {:016x}", e.name, now.digest)
    };
    let Some(old) = past.iter().find(|l| l.digest == theirs) else {
        return vec![refusal(
            "regions_digest",
            format!("the program exports regions_digest {theirs:016x}, a layout this item never had; its layout is {:016x}", now.digest),
            json!({}),
        )];
    };
    if planted.digest_total_sizes
        && old.size("reads") == now.size("reads")
        && old.size("writes") == now.size("writes")
    {
        return Vec::new();
    }
    now.entries
        .iter()
        .find(|e| {
            !old.entries
                .iter()
                .any(|o| o.region == e.region && o.name == e.name && o.offset == e.offset)
        })
        .or_else(|| now.entries.iter().find(|e| !old.entries.contains(e)))
        .map(|e| {
            vec![refusal(
                "regions_digest",
                what(e),
                json!({"entry": {"region": e.region, "name": e.name}}),
            )]
        })
        .unwrap_or_else(|| {
            vec![refusal(
                "regions_digest",
                format!(
                    "the program exports layout {theirs:016x}; its item's layout is {:016x}",
                    now.digest
                ),
                json!({}),
            )]
        })
}

#[cfg(test)]
mod tests {
    use super::*;

    const EMPTY: &str = r#"(module (memory (export "memory") 1 1)
  (global (export "reads_at") i32 (i32.const 0)) (global (export "writes_at") i32 (i32.const 1024))
  (func (export "init") (param i64)) (func (export "step") (param i64)))"#;

    /// The refusals of a piece whose items, given as params, all run the same empty program.
    fn refusals(items: Value) -> Value {
        let bytes = wat::parse_str(EMPTY).expect("a program");
        let sha = hash(&bytes);
        let mut piece = json!({"seed": 0, "assets": {&sha: B64.encode(&bytes)}, "items": {}});
        for (id, params) in items.as_object().expect("items") {
            let mut params = params.clone();
            params["program"] = json!(sha);
            piece["items"][id] = json!({"kind": "logic@1", "params": params});
        }
        match check(&piece, &Planted::default(), &mut History::new()) {
            Ok(_) => json!([]),
            Err(Refused(v)) => json!([v["item"], v["refusals"][0]["rule"]]),
        }
    }

    #[test]
    fn writes_past_the_largest_memory_are_refused() {
        for (ty, count) in [("quat", 134_217_728u64), ("f64", 536_870_913)] {
            let items = json!({"e": {"writes": {"a": {"type": ty, "count": count}}}});
            assert_eq!(refusals(items), json!(["e", "write"]), "{ty} x {count}");
        }
    }

    #[test]
    fn a_read_region_past_a_u32_is_refused() {
        let reads = vec!["a.x"; 65];
        let items = json!({
            "b": {"reads": reads},
            "a": {"writes": {"x": {"type": "f64", "count": 8_388_608}}},
        });
        assert_eq!(refusals(items), json!(["b", "read"]));
    }
}

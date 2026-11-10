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
/// The most memory a logic item's budget may give it.
pub const MAX_MEMORY: u64 = 64 * MIB;
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
    /// `interpolate: linear`, which draws nothing yet (#545).
    pub linear: bool,
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
    pub saves: Option<Saves>,
}

/// A logic item's saves (Logic: saves): its slots, where its `request` and `ends` arrays sit in
/// its write region, and its migrations.
#[derive(Clone, Debug)]
pub struct Saves {
    pub slots: i32,
    pub request: u32,
    pub ends: Option<u32>,
    pub migrate: Vec<Migration>,
}

/// A declared migration (Logic: saves across changes): the save's `{layout, content, modules}` it
/// migrates from, its program by asset ID, rewritten at check in the role `migration`, and the
/// remap table's bytes.
#[derive(Clone, Debug)]
pub struct Migration {
    pub from: [String; 3],
    pub by: String,
    pub bytes: Vec<u8>,
    pub remap: Option<Vec<u8>>,
}

/// A migration's fuel: 8 per byte of the old and the new memories together, at least 10,000,000.
pub fn migration_fuel(bytes: u64) -> i64 {
    (8 * bytes as i64).max(10_000_000)
}

/// The item's `saves`, checked: slots 1 to 8, `request` and `ends` its own i32 arrays, and each
/// migration's program under the one subset with a budget scaled to memory.
fn saves_of(
    v: &Value,
    layout: &Layout,
    memory: u64,
    asset: &dyn Fn(&str) -> Option<Vec<u8>>,
    planted: &Planted,
) -> Result<Saves, Value> {
    let bad = |what: String| refusal("saves", what, json!({"field": "saves"}));
    if let Some(k) = v
        .as_object()
        .into_iter()
        .flat_map(Map::keys)
        .find(|k| !["slots", "request", "ends", "migrate"].contains(&k.as_str()))
    {
        return Err(bad(format!("saves has no field {k}")));
    }
    let slots = v
        .get("slots")
        .map_or(Some(1), Value::as_i64)
        .filter(|n| (1..=8).contains(n))
        .ok_or_else(|| bad("saves.slots is 1 to 8".into()))?;
    let array = |k: &str| -> Result<Option<u32>, Value> {
        let Some(n) = v.get(k) else { return Ok(None) };
        layout
            .entries
            .iter()
            .find(|e| e.region == "writes" && n.as_str() == Some(&e.name) && e.ty == "i32")
            .map(|e| Some(e.offset))
            .ok_or_else(|| bad(format!("saves.{k} names one of the item's own i32 arrays")))
    };
    let request = array("request")?
        .ok_or_else(|| bad("saves.request names the item's request array".into()))?;
    let ends = array("ends")?;
    let missing = |sha: &str| {
        refusal(
            "asset",
            format!("the piece carries no migration asset {sha}"),
            json!({"asset": sha}),
        )
    };
    let mut migrate = Vec::new();
    let list = match v.get("migrate") {
        None => &[][..],
        Some(Value::Array(a)) => a.as_slice(),
        Some(_) => return Err(bad("saves.migrate is a list of migrations".into())),
    };
    for m in list {
        let from = ["layout", "content", "modules"].map(|k| {
            m.get("from")
                .and_then(|f| f.get(k))
                .and_then(Value::as_str)
                .map(str::to_string)
        });
        let ([Some(layout), Some(content), Some(modules)], Some(by)) =
            (from, m.get("by").and_then(Value::as_str))
        else {
            return Err(bad(
                "a migration names from: {layout, content, modules} and its program by asset ID"
                    .into(),
            ));
        };
        let given = asset(by).ok_or_else(|| missing(by))?;
        let remap = match m.get("remap").and_then(Value::as_str) {
            None => None,
            Some(r) => Some(asset(r).ok_or_else(|| missing(r))?),
        };
        // The migration's budget: memory the new memory plus the old plus 4 MiB, stack 256 KiB.
        let budget = Budget {
            fuel: migration_fuel(2 * memory),
            stack: 262_144,
            memory: 2 * memory + 4 * MIB,
        };
        let sandbox = Sandbox {
            planted: deep_sandbox_wasmtime::service::Planted {
                rewrite: planted.rewrite,
                ..Default::default()
            },
        };
        let bytes = match sandbox.rewrite(&given, "migration", &budget) {
            Ok((out, _)) => out.bytes,
            Err(Ok(r)) => {
                return Err(refusal(
                    "migration",
                    format!("the migration {by} is outside the one subset"),
                    json!({"asset": by, "refusals": refusals_json(&r)}),
                ))
            }
            Err(Err(e)) => return Err(refusal("migration", e, json!({"asset": by}))),
        };
        migrate.push(Migration {
            from: [layout, content, modules],
            by: by.into(),
            bytes,
            remap,
        });
    }
    Ok(Saves {
        slots: slots as i32,
        request,
        ends,
        migrate,
    })
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

/// The fixture canvas module whose carried state is of the `same_machine` class (#534).
pub const MACHINE: &str = "same_machine.counter@1";

/// A piece: its seed, controls, tour and checked logic items in order.
#[derive(Clone, Debug)]
pub struct Piece {
    pub seed: i64,
    pub controls: BTreeSet<String>,
    pub tour: Option<Value>,
    pub items: Vec<Item>,
    /// The `same_machine.counter@1` items, by ID.
    pub machine: Vec<String>,
    /// The document by hash, which a save names but isn't bound to.
    pub document: String,
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
pub fn memory_bytes(bytes: &[u8]) -> u64 {
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
    saves: Option<Value>,
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
            "saves",
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
            (Some(ty), Some(count), Some(i @ ("hold" | "linear"))) => writes.push(Write {
                name: name.clone(),
                ty,
                count: count as u32,
                linear: i == "linear",
            }),
            _ => refused.push(refusal(
                "write",
                format!("{name} declares a type, a count of at least 1 and hold or linear"),
                json!({"write": name}),
            )),
        }
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
    let memory = num("memory", 4, MAX_MEMORY / MIB)? * MIB;
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
        saves: params.get("saves").cloned(),
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
    let mut machine = Vec::new();
    for (id, item) in items_in {
        // The fixture module whose carried state is same-machine: a counter of the steps it's seen.
        if item.get("kind").and_then(Value::as_str) == Some(MACHINE)
            && item
                .get("params")
                .is_none_or(|p| p.as_object().is_some_and(Map::is_empty))
        {
            machine.push(id.clone());
            continue;
        }
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
            entries.push(Region {
                region: "reads",
                name: r.clone(),
                offset: at,
                size,
                ty,
                read,
            });
            at = align8(at + size);
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
        let saves = match d
            .saves
            .as_ref()
            .map(|v| saves_of(v, &layout, memory, &asset, planted))
        {
            None => None,
            Some(Ok(s)) => Some(s),
            Some(Err(r)) => {
                refused.push(r);
                None
            }
        };
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
            saves,
        });
    }
    // A save holds every item at one instant, so a piece with saves steps at one rate.
    if items.iter().any(|i| i.saves.is_some()) && !items.windows(2).all(|w| w[0].step == w[1].step)
    {
        let id = items
            .iter()
            .find(|i| i.saves.is_some())
            .map_or("", |i| i.id.as_str());
        return Err(logic_refused(
            id,
            vec![refusal(
                "saves",
                "a piece with saves has every logic item at one step rate".into(),
                json!({"field": "saves"}),
            )],
        ));
    }
    Ok(Piece {
        seed,
        controls,
        tour: piece.get("tour").cloned(),
        items,
        machine,
        document: hash(piece.to_string().as_bytes()),
    })
}

/// Each active data segment's bytes in memory, `[start, end)`.
fn data_segments(bytes: &[u8]) -> Vec<(u64, u64)> {
    segments(bytes)
        .into_iter()
        .map(|(_, at, b)| (at, at + b.len() as u64))
        .collect()
}

/// Each active data segment: its index in the data section, its address and its bytes.
pub fn segments(bytes: &[u8]) -> Vec<(usize, u64, Vec<u8>)> {
    let mut out = Vec::new();
    for payload in Parser::new(0).parse_all(bytes) {
        if let Ok(Payload::DataSection(s)) = payload {
            for (i, d) in s.into_iter().flatten().enumerate() {
                if let wasmparser::DataKind::Active { offset_expr, .. } = d.kind {
                    if let Ok(Operator::I32Const { value }) =
                        offset_expr.get_operators_reader().read()
                    {
                        out.push((i, u64::from(value as u32), d.data.to_vec()));
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

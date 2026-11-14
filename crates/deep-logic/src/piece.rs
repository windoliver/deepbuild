//! A piece's logic items and their check (canvas primitives: Logic `logic@1`; #531): the fields
//! this task builds, the program through sandbox@1's check and rewrite in the role `logic`, the
//! region map and its digest, and the logic module's own refusals: a write that isn't the item's
//! own array, a read of nothing declared, a write region past the end of memory and a program
//! whose `regions_digest` isn't its item's layout digest.

use std::collections::BTreeMap;

use base64::{engine::general_purpose::STANDARD as B64, Engine as _};
use deep_canvas::budget::Class;
use deep_canvas_sandbox::rewrite::{self, hash, Mode, Rewritten};
use deep_sandbox_wasmtime::service::{refusals_json, Budget, Sandbox};
use serde_json::{json, Map, Value};
use wasmparser::{ExternalKind, Operator, Parser, Payload};

use crate::lines::Lines;
use crate::links::{self, Functions, Lib};
use crate::Planted;

pub const PAGE: u64 = 65_536;
const MIB: u64 = 1024 * 1024;
/// The most memory a logic item's budget may give it.
pub const MAX_MEMORY: u64 = 64 * MIB;
/// The most entries a control hands a step (Logic `logic@1`: Semantics); any more wait.
pub const PER_STEP: usize = 16;
/// A control's slot: a u32 count and 4 zero bytes, then each entry as a u32 player, 4 zero
/// bytes and a slider's f64 value.
pub const SLOT: u32 = slot(8);

/// The slot of a control whose value takes `value` bytes.
pub const fn slot(value: u32) -> u32 {
    8 + PER_STEP as u32 * (8 + value)
}

/// A read control's slot in a read region and its type there, by the form of its entries'
/// values: a pick on rows' `{set, key}` in 24 B (Control: picks on rows and grid focus), a
/// point's 248 B (Control: point), an action's, a stick's or a look's 16 B (Control: actions,
/// key repeat and gamepads), else a number's f64. A text control's one commit a step reserves
/// its `u32` length and up to `max_bytes`, rounded up to a multiple of 8 (Control: text).
pub fn form(control: &Value) -> (u32, &'static str) {
    let rows = control.get("verb").and_then(Value::as_str) == Some("pick")
        && control.get("rows").is_some();
    match control.get("kind").and_then(Value::as_str) {
        _ if rows => (slot(24), "pick"),
        // A point's 248 B record and room for a box release's unit keys (`u32 n, u32 truncated`
        // and up to 256 × 8 B), entries packed end to end.
        Some("point") => (slot(248 + 8 + 8 * crate::point::MAX_UNITS as u32), "point"),
        Some("actions") => (slot(16), "action"),
        Some("text") => {
            let max = control
                .pointer("/text/max_bytes")
                .and_then(Value::as_u64)
                .unwrap_or(256);
            (align8(4 + max.min(16_384) as u32), "text")
        }
        _ => (SLOT, "control"),
    }
}

/// A logic item's budgets (Logic `logic@1`: `budget`): `(default, most)` of its fuel a step,
/// memory in MiB and stack in KiB.
pub const FUEL: (u64, u64) = (1_000_000, 10_000_000);
pub const MEMORY_MIB: (u64, u64) = (4, MAX_MEMORY / MIB);
pub const STACK_KIB: (u64, u64) = (64, 256);

/// The exports a logic program may add to its role's (Logic `logic@1`: Exports), each with when.
pub const OPTIONAL_EXPORTS: [(&str, &str); 5] = [
    ("assets_at", "with assets"),
    ("emits_at", "with emits"),
    ("preview", "with preview: preview(k: i64)"),
    ("preview_at", "with preview"),
    ("regions_digest", "optional: the layout digest, which check compares"),
];

/// What `deep_kinds` lists of `logic@1` (#548): its exports, the one subset and its budgets.
pub fn listing() -> Value {
    use deep_canvas_sandbox::check::{role_exports, MAX_PROGRAM, MAX_TABLE};
    let required: Vec<&str> = role_exports("logic").into_iter().flatten().map(|(n, _)| *n).collect();
    let optional: Vec<Value> = OPTIONAL_EXPORTS.iter().map(|(n, when)| json!({"name": n, "when": when})).collect();
    json!({
        "exports": {"required": required, "optional": optional, "imports": "none once its libraries are linked"},
        "subset": {"features": "WebAssembly 2.0 without vector instructions", "memory": "one, whose maximum is its minimum",
            "tables": "never change", "segments": "no passive segments", "imports": "none",
            "max_program_bytes": MAX_PROGRAM, "max_table_entries": MAX_TABLE},
        "budgets": {"fuel": {"default": FUEL.0, "most": FUEL.1}, "memory_mib": {"default": MEMORY_MIB.0, "most": MEMORY_MIB.1},
            "stack_kib": {"default": STACK_KIB.0, "most": STACK_KIB.1}},
    })
}

/// One field of a logic item this task doesn't build yet: refused by name, never ignored.
const LATER: [&str; 5] = ["fires", "pages", "parallel", "services", "mirrors"];
/// A row's own columns: no declared field can take one of these names, so a reader can name each
/// field beside them.
const ROW_COLUMNS: [&str; 5] = ["step", "t", "kind", "a", "b"];

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
    pub(crate) fn named(s: &str) -> Option<Ty> {
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
    /// An element as a frame draws a linear write (Logic: interpolated writes): `from` blended
    /// toward `to` by `a`, f64 and vectors by lerp, a quat by nlerp along the shorter arc.
    pub fn blend(self, from: &[u8], to: &[u8], a: f64) -> Value {
        let n = (self.size() / 8) as usize;
        let f = |b: &[u8], i: usize| {
            f64::from_le_bytes(b[8 * i..8 * i + 8].try_into().expect("8 bytes"))
        };
        let (p, mut q): (Vec<f64>, Vec<f64>) = (
            (0..n).map(|i| f(from, i)).collect(),
            (0..n).map(|i| f(to, i)).collect(),
        );
        if self == Ty::Quat && p.iter().zip(&q).map(|(x, y)| x * y).sum::<f64>() < 0.0 {
            q.iter_mut().for_each(|y| *y = -*y);
        }
        let mut v: Vec<f64> = p.iter().zip(&q).map(|(x, y)| x + a * (y - x)).collect();
        if self == Ty::Quat {
            let len = v.iter().map(|x| x * x).sum::<f64>().sqrt();
            if len > 0.0 {
                v.iter_mut().for_each(|x| *x /= len);
            }
        }
        if self == Ty::F64 {
            json!(v[0])
        } else {
            json!(v)
        }
    }
    /// Whether a write of this type may blend: f64, vec2, vec3 and quat, never a bool or an i32.
    pub fn blends(self) -> bool {
        !matches!(self, Ty::Bool | Ty::I32)
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
    /// `interpolate: linear`: drawing reads it one step late, blended (Logic: interpolated writes).
    pub linear: bool,
}

/// A kind of occurrence an item emits (Logic: occurrences): its numeric fields in declaration
/// order and its cap per step.
#[derive(Clone, Debug)]
pub struct Emit {
    pub kind: String,
    pub fields: Vec<(String, Ty)>,
    pub max: u32,
}

impl Emit {
    /// A row's bytes: a and b as u32s, then each field at its type's size.
    pub fn row(&self) -> u32 {
        8 + self.fields.iter().map(|(_, t)| t.size()).sum::<u32>()
    }
    /// The kind's part of the emit region: a u32 count, then `max` rows.
    pub fn size(&self) -> u32 {
        4 + self.max * self.row()
    }
    /// A row as the occurrence list holds it: its kind, a, b and its fields by name.
    pub fn value(&self, row: &[u8]) -> Value {
        let u = |i: usize| u32::from_le_bytes(row[i..i + 4].try_into().expect("4 bytes"));
        let mut fields = Map::new();
        let mut at = 8;
        for (name, ty) in &self.fields {
            let n = ty.size() as usize;
            fields.insert(name.clone(), ty.value(&row[at..at + n]));
            at += n;
        }
        json!({"kind": self.kind, "a": u(0), "b": u(4), "fields": fields})
    }
}

/// An item's preview (Logic: preview): from `preview_at`, its read region (each read's value as
/// its control lays one entry out, in declaration order), then its write region.
#[derive(Clone, Debug)]
pub struct Preview {
    pub reads: Vec<Region>,
    pub writes: Vec<Write>,
    /// The write entries, offsets within the write region.
    pub entries: Vec<Region>,
    pub at: u32,
    /// Where the write region starts, after the read region.
    pub writes_at: u32,
    refused: Vec<Value>,
}

impl Preview {
    fn of(
        reads: &[String],
        writes: &[Write],
        controls: &BTreeMap<String, (u32, &'static str)>,
        at: Option<u32>,
    ) -> Preview {
        let mut refused = Vec::new();
        let mut entries = Vec::new();
        let mut off = 0;
        for r in reads {
            // A point's hover fills its 248 B record, a pick's its row; a view control its value.
            let size = match r.split_once('.') {
                Some((c, "hover")) => match controls.get(c).map(|(_, ty)| *ty) {
                    Some("point") => Some(crate::point::SIZE as u32),
                    Some("pick") => Some(24),
                    _ => None,
                },
                Some(_) => None,
                None => match controls.get(r.as_str()).map(|(_, ty)| *ty) {
                    Some("control") => Some(8),
                    Some("pick") => Some(24),
                    Some("action") => Some(16),
                    _ => None,
                },
            };
            let Some(size) = size else {
                refused.push(refusal(
                    "preview",
                    format!("preview reads {r}, which is no view control or point or pick control's hover of this piece"),
                    json!({"read": r}),
                ));
                continue;
            };
            let ty = if r.ends_with(".hover") { "hover" } else { "control" };
            entries.push(Region { region: "preview.reads", name: r.clone(), offset: off, size, ty: ty.into(), read: Read::Control });
            off = align8(off + size);
        }
        let reads_size = off;
        let mut written = Vec::new();
        let mut off = 0;
        for w in writes {
            written.push(Region { region: "preview.writes", name: w.name.clone(), offset: off, size: w.ty.size() * w.count, ty: w.ty.name().into(), read: Read::None });
            off = align8(off + w.ty.size() * w.count);
        }
        if at.is_none() {
            refused.push(refusal(
                "region",
                "an item with a preview exports preview_at, an immutable i32 global holding an address, and preview(k: i64)".into(),
                json!({"field": "preview"}),
            ));
        }
        let at = at.unwrap_or(0);
        Preview { reads: entries, writes: writes.to_vec(), entries: written, at, writes_at: at + reads_size, refused }
    }

    /// Bytes of the preview's read and write regions together.
    pub fn size(&self) -> u32 {
        (self.writes_at - self.at) + self.entries.iter().map(|e| e.offset + e.size).max().unwrap_or(0)
    }

    /// Refusals: a program without `preview(i64)`, a region past memory or over another region.
    fn check(&self, given: &[u8], memory: u64, regions: &[(&str, u32, u32)]) -> Vec<Value> {
        let mut out = self.refused.clone();
        if !exports_func(given, "preview") {
            out.push(refusal("region", "an item with a preview exports preview(k: i64)".into(), json!({"field": "preview"})));
        }
        let (start, end) = (u64::from(self.at), u64::from(self.at) + u64::from(self.size()));
        if end > memory {
            out.push(refusal("region", format!("the preview region, {} bytes at {}, passes the end of memory at {memory}", self.size(), self.at), json!({"region": "preview"})));
        } else if let Some((name, r, n)) = regions
            .iter()
            .find(|(_, r, n)| *n > 0 && start < u64::from(*r) + u64::from(*n) && u64::from(*r) < end)
        {
            out.push(refusal("region", format!("the preview region, {} bytes at {}, overlaps {name}, {n} bytes at {r}", self.size(), self.at), json!({"region": "preview"})));
        }
        out
    }
}

/// Whether the program exports a function of this name.
fn exports_func(bytes: &[u8], name: &str) -> bool {
    Parser::new(0).parse_all(bytes).any(|p| match p {
        Ok(Payload::ExportSection(s)) => s
            .into_iter()
            .flatten()
            .any(|e| e.name == name && e.kind == ExternalKind::Func),
        _ => false,
    })
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
    /// `clock: on_input` (Logic: turn clock): a step runs only when something asks for it.
    pub turn: bool,
    /// With `on_input`, the offset in the write region of the i32 `due` names.
    pub due: Option<u32>,
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
    /// Its linked libraries in link order, the merged program's library functions, whether it was
    /// linked and the link's time (#190).
    pub libraries: Vec<Lib>,
    pub functions: Functions,
    /// `given` is the linker's output (#190).
    pub linked: bool,
    pub link_ns: u64,
    /// Each library's fixture records, by its hash, as the logic module ran them.
    pub fixtures: BTreeMap<String, Value>,
    /// The kinds it emits, in declaration order, and where its emit region starts: `emits_at`.
    pub emits: Vec<Emit>,
    pub emits_at: u32,
    pub preview: Option<Preview>,
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
        // The old memory is a save's, so check admits the largest one; the run holds it to the save's.
        let budget = Budget {
            fuel: migration_fuel(2 * memory),
            stack: 262_144,
            memory: memory + MAX_MEMORY + 4 * MIB,
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
        let b = &self.given;
        let linked = if self.linked {
            json!({"sha256": hash(b), "size": b.len(), "bytes": B64.encode(b)})
        } else {
            Value::Null
        };
        let libraries: Vec<Value> = self
            .libraries
            .iter()
            .map(|l| json!({"name": l.label, "hash": l.hash, "pack": l.pack, "fixtures": self.fixtures.get(&l.hash).cloned().unwrap_or(json!([]))}))
            .collect();
        json!({"program": self.program, "hash": self.hash, "layout": self.layout.to_json(), "assets_at": self.assets_at,
            "linked": linked, "libraries": libraries, "link_ns": self.link_ns,
            "pipelined": crate::budget::pipelined(self)})
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
    /// Its budget class (Budget classes): `class`, figure when it names none.
    pub class: Class,
    /// Each control by ID, with its slot's size and type in a read region ([`form`]).
    pub controls: BTreeMap<String, (u32, &'static str)>,
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

/// The exported immutable global `regions_digest`, if any: an i64 holding the digest, or, as a
/// Rust `static` exports it, an i32 holding the address of its 8 bytes in an active data segment
/// (#548). `Err` when it is neither.
fn regions_digest(bytes: &[u8]) -> Result<Option<u64>, String> {
    let mut globals = Vec::new();
    let mut index = None;
    let mut data = Vec::new();
    for payload in Parser::new(0).parse_all(bytes) {
        match payload.map_err(|e| e.to_string())? {
            Payload::GlobalSection(s) => {
                for g in s {
                    let g = g.map_err(|e| e.to_string())?;
                    let mut ops = g.init_expr.get_operators_reader();
                    let v = match ops.read().map_err(|e| e.to_string())? {
                        Operator::I64Const { value } if !g.ty.mutable => Some(Ok(value as u64)),
                        Operator::I32Const { value } if !g.ty.mutable => Some(Err(value as u32)),
                        _ => None,
                    };
                    globals.push(v);
                }
            }
            Payload::DataSection(s) => {
                for d in s.into_iter().flatten() {
                    if let wasmparser::DataKind::Active { offset_expr, .. } = d.kind {
                        if let Ok(Operator::I32Const { value }) =
                            offset_expr.get_operators_reader().read()
                        {
                            data.push((u64::from(value as u32), d.data.to_vec()));
                        }
                    }
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
    let at = |a: u32| {
        let a = u64::from(a);
        data.iter().find_map(|(start, b)| {
            let o = a.checked_sub(*start)? as usize;
            Some(u64::from_le_bytes(b.get(o..o + 8)?.try_into().ok()?))
        })
    };
    let wrong = || "regions_digest is an immutable i64 global, or a static of 8 bytes".to_string();
    match index {
        None => Ok(None),
        Some(i) => match globals.get(i).copied().flatten() {
            Some(Ok(v)) => Ok(Some(v)),
            Some(Err(a)) => at(a).map(Some).ok_or_else(wrong),
            None => Err(wrong()),
        },
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
    turn: bool,
    due: Option<String>,
    reads: Vec<String>,
    writes: Vec<Write>,
    fuel: i64,
    memory: u64,
    stack: i32,
    every: i64,
    ring: u64,
    assets: Vec<String>,
    links: Vec<(String, String)>,
    saves: Option<Value>,
    emits: Vec<Emit>,
    preview: Option<(Vec<String>, Vec<Write>)>,
    /// The item's fields as given, for its bake key.
    given: String,
}

/// The kinds an item declares in `emits`, in declaration order, or the refusals naming each wrong
/// one: at most 64 kinds, 8 numeric fields each, none named as a row's own column, and
/// `max_per_step` at most 1,024.
fn emits_of(v: Option<&Value>) -> Result<Vec<Emit>, Vec<Value>> {
    let what = |kind: &str, w: String| refusal("emits", w, json!({"field": "emits", "kind": kind}));
    let kinds = match v {
        None => return Ok(Vec::new()),
        Some(Value::Object(k)) => k,
        Some(_) => {
            return Err(vec![what(
                "",
                "emits maps each kind to its fields and max_per_step".into(),
            )])
        }
    };
    let mut out = Vec::new();
    let mut refused = Vec::new();
    if kinds.len() > 64 {
        refused.push(what(
            "",
            format!("emits declares {} kinds, past 64", kinds.len()),
        ));
    }
    for (kind, e) in kinds {
        let other = e.as_object().and_then(|o| {
            o.keys()
                .find(|k| !["fields", "max_per_step"].contains(&k.as_str()))
        });
        if let Some(k) = other {
            refused.push(what(
                kind,
                format!("{kind}: an emitted kind has no field {k}"),
            ));
            continue;
        }
        let max = e
            .get("max_per_step")
            .map_or(Some(16), Value::as_u64)
            .filter(|n| *n <= 1024);
        let fields: Option<Vec<(String, Ty)>> = match e.get("fields") {
            None => Some(Vec::new()),
            Some(Value::Object(f)) => f
                .iter()
                .map(|(n, t)| {
                    Some((
                        n.clone(),
                        t.as_str().and_then(Ty::named).filter(|t| *t != Ty::Quat)?,
                    ))
                })
                .collect(),
            Some(_) => None,
        };
        match (fields, max) {
            (Some(f), _) if f.len() > 8 => refused.push(what(
                kind,
                format!("{kind} declares {} fields, past 8", f.len()),
            )),
            (Some(f), _) if f.iter().any(|(n, _)| ROW_COLUMNS.contains(&n.as_str())) => refused
                .push(what(
                    kind,
                    format!(
                        "{kind}: a field can't be named step, t, kind, a or b, a row's own columns"
                    ),
                )),
            (Some(fields), Some(max)) => out.push(Emit {
                kind: kind.clone(),
                fields,
                max: max as u32,
            }),
            (None, _) => refused.push(what(
                kind,
                format!("{kind}: each field is bool, i32, f64, vec2 or vec3"),
            )),
            (_, None) => refused.push(what(kind, format!("{kind}: max_per_step is at most 1,024"))),
        }
    }
    if refused.is_empty() {
        Ok(out)
    } else {
        Err(refused)
    }
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
            "clock",
            "due",
            "reads",
            "writes",
            "budget",
            "checkpoint",
            "assets",
            "links",
            "saves",
            "emits",
            "preview",
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
            (Some(ty), Some(_), Some("linear")) if !ty.blends() => refused.push(refusal(
                "write",
                format!("{name} is a {}, which never blends: interpolate: linear is only for f64, vec2, vec3 and quat arrays", ty.name()),
                json!({"write": name}),
            )),
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
    let emits = emits_of(params.get("emits")).unwrap_or_else(|r| {
        refused.extend(r);
        Vec::new()
    });
    let preview = match params.get("preview") {
        None => None,
        Some(p) => preview_of(p).map_or_else(
            |r| {
                refused.extend(r);
                None
            },
            Some,
        ),
    };
    if preview.is_some() && writes.iter().any(|w| w.name == "preview") {
        refused.push(refusal(
            "write",
            "an item with a preview can't write an array named preview: <logic ID>.preview.<name> are its preview arrays".into(),
            json!({"write": "preview"}),
        ));
    }
    if !emits.is_empty() && writes.iter().any(|w| w.name == "occurrences") {
        refused.push(refusal(
            "write",
            "an item that emits can't write an array named occurrences: <logic ID>.occurrences is its occurrence list".into(),
            json!({"write": "occurrences"}),
        ));
    }
    if !refused.is_empty() {
        return Err(logic_refused(id, refused));
    }
    let turn = match params.get("clock") {
        None => false,
        Some(c) => match c.as_str() {
            Some("fixed") => false,
            Some("on_input") => true,
            _ => return Err(bad("clock", "clock is fixed or on_input".into())),
        },
    };
    let due = match params.get("due") {
        None => None,
        Some(v) => {
            let name = v.as_str().unwrap_or_default();
            let own = writes
                .iter()
                .any(|w| w.name == name && w.ty == Ty::I32 && w.count == 1);
            if !turn || !own {
                return Err(bad("due", format!("due names one of the item's own i32 arrays of count 1, with clock: on_input; {v} isn't")));
            }
            Some(name.to_string())
        }
    };
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
    let fuel = num("fuel", FUEL.0, FUEL.1)? as i64;
    let memory = num("memory", MEMORY_MIB.0, MEMORY_MIB.1)? * MIB;
    let stack = num("stack", STACK_KIB.0, STACK_KIB.1)? as i32 * 1024;
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
    let links = links::declared(params.get("links"))
        .ok_or_else(|| bad("links", "links is a list of {name, asset}".into()))?;
    Ok(Declared {
        links,
        program,
        debug,
        step,
        turn,
        due,
        reads,
        writes,
        fuel,
        memory,
        stack,
        every,
        ring,
        assets,
        saves: params.get("saves").cloned(),
        emits,
        preview,
        given: Value::Object(params.clone()).to_string(),
    })
}

/// A preview's declared reads and writes (Logic: preview): control IDs or a control's `hover`,
/// and arrays of bool, i32, f64, vec2 or vec3, never quat or interpolated.
fn preview_of(v: &Value) -> Result<(Vec<String>, Vec<Write>), Vec<Value>> {
    let what = |w: String| refusal("preview", w, json!({"field": "preview"}));
    let Some(o) = v.as_object() else {
        return Err(vec![what("preview is {reads, writes}".into())]);
    };
    if let Some(k) = o.keys().find(|k| !["reads", "writes"].contains(&k.as_str())) {
        return Err(vec![what(format!("preview has no field {k}"))]);
    }
    let reads: Vec<String> = o
        .get("reads")
        .and_then(Value::as_array)
        .and_then(|a| a.iter().map(|r| r.as_str().map(str::to_string)).collect())
        .ok_or_else(|| vec![what("preview.reads is a list of control IDs".into())])?;
    let mut writes = Vec::new();
    let mut refused = Vec::new();
    for (name, w) in o.get("writes").and_then(Value::as_object).into_iter().flatten() {
        let ty = w.get("type").and_then(Value::as_str).and_then(Ty::named);
        let count = w
            .get("count")
            .map_or(Some(1), Value::as_u64)
            .filter(|c| *c >= 1 && *c <= u32::MAX as u64);
        let extra = w.as_object().into_iter().flatten().any(|(k, _)| k != "type" && k != "count");
        match (ty, count) {
            (Some(ty), Some(count)) if own_name(name) && ty != Ty::Quat && !extra => {
                writes.push(Write { name: name.clone(), ty, count: count as u32, linear: false })
            }
            _ => refused.push(what(format!(
                "preview write {name} is an own name with a type of bool, i32, f64, vec2 or vec3 and a count of at least 1"
            ))),
        }
    }
    if refused.is_empty() {
        Ok((reads, writes))
    } else {
        Err(refused)
    }
}

/// Item `idx`'s region map (Logic `logic@1`: Region map) from the declarations alone, before
/// its program is read: reads, the step's seed, writes, then the kinds it emits, each in
/// declaration order; and the refusals of reads that name nothing it may read.
fn region_map(
    idx: usize,
    decls: &[(String, Declared)],
    controls: &Controls,
    planted: &Planted,
) -> (Layout, Vec<Value>) {
    let d = &decls[idx].1;
    let mut entries = Vec::new();
    let mut at = 0u32;
    let mut refused = Vec::new();
    // The planted map lays the reads out by name rather than in declaration order.
    let mut reads = d.reads.clone();
    if planted.map_reads_by_name {
        reads.sort();
    }
    for r in &reads {
        let (size, ty, read) = if let Some((size, ty)) = controls.get(r) {
            (*size, ty.to_string(), Read::Control)
        } else if let Some((other, "hover")) =
            r.split_once('.').filter(|(c, _)| controls.contains_key(*c))
        {
            // Control: point: hover is viewer state, never a step's read.
            refused.push(refusal(
                "read",
                format!("{r} is the pointer's hover over {other}, viewer state a logic step never reads"),
                json!({"read": r}),
            ));
            continue;
        } else if let Some((other, name)) = r.split_once('.') {
            match decls.iter().position(|(o, _)| o == other) {
                Some(_) if name.starts_with("preview.") => {
                    refused.push(refusal(
                        "read",
                        format!("{r} is a preview array: session state no step reads"),
                        json!({"read": r}),
                    ));
                    continue;
                }
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
    // Then each kind it emits: its u32 count and max_per_step rows, end to end from emits_at.
    let mut at = 0u32;
    for e in &d.emits {
        entries.push(Region {
            region: "emits",
            name: e.kind.clone(),
            offset: at,
            size: e.size(),
            ty: "rows".into(),
            read: Read::None,
        });
        at += e.size();
    }
    let text: String = entries
        .iter()
        .map(|e| format!("{}|{}|{}|{}|{}\n", e.region, e.name, e.offset, e.size, e.ty))
        .collect();
    let layout = Layout {
        digest: h64(text.as_bytes()),
        entries,
    };
    (layout, refused)
}

/// A piece's controls, each with its slot's size and type in a read region, and every item's
/// declared fields, so a read can name a later item's array.
fn declarations(piece: &Value) -> Result<(Controls, Vec<(String, Declared)>, Vec<String>), Refused> {
    let controls: Controls = piece
        .get("controls")
        .and_then(Value::as_object)
        .map(|c| c.iter().map(|(k, v)| (k.clone(), form(v))).collect())
        .unwrap_or_default();
    let items_in = piece
        .get("items")
        .and_then(Value::as_object)
        .ok_or_else(|| Refused(json!({"ok": false, "code": "bad_input"})))?;
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
    Ok((controls, decls, machine))
}

/// Each item's region map and the kinds it emits, from the piece's declarations alone: what a
/// program is built against before it exists (#548's bindings).
pub fn region_maps(piece: &Value, planted: &Planted) -> Result<Vec<(String, Layout, Vec<Emit>)>, Refused> {
    let (controls, decls, _) = declarations(piece)?;
    let mut out = Vec::new();
    for (idx, (id, d)) in decls.iter().enumerate() {
        let (layout, refused) = region_map(idx, &decls, &controls, planted);
        if !refused.is_empty() {
            return Err(logic_refused(id, refused));
        }
        out.push((id.clone(), layout, d.emits.clone()));
    }
    Ok(out)
}

type Controls = BTreeMap<String, (u32, &'static str)>;

/// Checks every item of a piece in order: the first refusal answers.
pub fn check(piece: &Value, planted: &Planted, history: &mut History) -> Result<Piece, Refused> {
    let assets = piece
        .get("assets")
        .and_then(Value::as_object)
        .cloned()
        .unwrap_or_default();
    check_in(piece, planted, history, &|sha| {
        B64.decode(assets.get(sha)?.as_str()?).ok()
    })
}

/// [`check`], each asset's bytes read by `stored` (a document's from the evidence store, #544)
/// rather than from the piece's `assets`; bytes that don't hash to their ID are none.
pub fn check_in(
    piece: &Value,
    planted: &Planted,
    history: &mut History,
    stored: &dyn Fn(&str) -> Option<Vec<u8>>,
) -> Result<Piece, Refused> {
    let bad = || Refused(json!({"ok": false, "code": "bad_input"}));
    let seed = piece.get("seed").and_then(Value::as_i64).ok_or_else(bad)?;
    let class = match piece.get("class") {
        None => Class::Figure,
        Some(c) => c.as_str().and_then(Class::parse).ok_or_else(bad)?,
    };
    let asset = |sha: &str| -> Option<Vec<u8>> {
        let bytes = stored(sha)?;
        (hash(&bytes) == sha).then_some(bytes)
    };
    let (controls, decls, machine) = declarations(piece)?;
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
        // The linker first, before the subset check and the rewrite (#190); an item without links
        // is never linked.
        let (mut given, mut libraries, mut functions, mut lib_data, mut link_ns) =
            (given, Vec::new(), Functions::new(), None, 0);
        if !d.links.is_empty() {
            let packs = links::packs(piece).ok_or_else(bad)?;
            let link_refused = |refusals| {
                Refused(
                    json!({"ok": false, "code": "link_refused", "item": id, "refusals": refusals}),
                )
            };
            let started = std::time::Instant::now();
            libraries = links::resolve(&d.links, &packs, stored, planted).map_err(link_refused)?;
            let (bytes, f, data) =
                links::merge(&given, &libraries, planted).map_err(link_refused)?;
            link_ns = started.elapsed().as_nanos() as u64;
            given = bytes;
            functions = f;
            lib_data = data;
            if d.debug.is_some() {
                // A sidecar's DWARF stands for the program object, not the merged module.
                return Err(logic_refused(id, vec![refusal("debug", "a debug sidecar isn't read for an item with links yet: its offsets stand for the program before the link".into(), json!({"field": "debug"}))]));
            }
        }
        if planted.linker_adds_linking_section {
            given = links::empty_linking(given);
        }
        let linked = !d.links.is_empty() || planted.linker_adds_linking_section;
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
        let (layout, mut refused) = region_map(idx, &decls, &controls, planted);
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
        let mut regions = vec![
            ("the read region", reads_at, layout.size("reads")),
            ("the write region", writes_at, layout.size("writes")),
        ];
        // The emit region: each kind's count and max_per_step rows, in declaration order.
        let emits_at = global_at(&given, "emits_at");
        if !d.emits.is_empty() {
            let size: u64 = d.emits.iter().map(|e| u64::from(e.size())).sum();
            match emits_at {
                None => refused.push(refusal(
                    "region",
                    "an item that emits exports emits_at, an immutable i32 global holding an address".into(),
                    json!({"field": "emits"}),
                )),
                Some(at) => {
                    let (start, end) = (u64::from(at), u64::from(at) + size);
                    let why = if end > memory {
                        Some(format!("passes the end of memory at {memory}"))
                    } else {
                        regions
                            .iter()
                            .find(|(_, r, n)| *n > 0 && start < u64::from(*r) + u64::from(*n) && u64::from(*r) < end)
                            .map(|(name, r, n)| format!("overlaps {name}, {n} bytes at {r}"))
                    };
                    if let Some(why) = why {
                        refused.push(refusal(
                            "region",
                            format!("the emit region, {size} bytes at {at}, {why}"),
                            json!({"region": "emits"}),
                        ));
                    }
                    regions.push(("the emit region", at, size as u32));
                }
            }
        }
        // The libraries' data, placed after the program's, must keep clear of its regions (#190).
        if let Some((start, end)) = lib_data {
            for (name, at, n) in &regions {
                if *at < end && u64::from(start) < u64::from(*at) + u64::from(*n) {
                    refused.push(refusal(
                        "links",
                        format!("the libraries' data, bytes {start} to {end}, overlaps {name}, {n} bytes at {at}"),
                        json!({"region": name}),
                    ));
                }
            }
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
                    refused.extend(placed(&assets, at, memory, &regions, &data_segments(&given)));
                }
            }
        }
        let preview = d.preview.as_ref().map(|(reads, writes)| {
            let p = Preview::of(reads, writes, &controls, global_at(&given, "preview_at"));
            refused.extend(p.check(&given, memory, &regions));
            p
        });
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
            turn: d.turn,
            due: d.due.as_ref().map(|n| {
                layout
                    .entries
                    .iter()
                    .find(|e| e.region == "writes" && &e.name == n)
                    .expect("due names a write")
                    .offset
            }),
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
            libraries: std::mem::take(&mut libraries),
            functions: std::mem::take(&mut functions),
            linked,
            link_ns,
            fixtures: BTreeMap::new(),
            saves,
            emits: d.emits.clone(),
            emits_at: emits_at.unwrap_or(0),
            preview,
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
        class,
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

    /// #544: emits within its limits passes to the region check (the empty program exports no
    /// emits_at); past any of them, or with a type or field name it can't have, it is refused.
    #[test]
    fn emits_past_its_limits_are_refused() {
        let named = |n: usize, v: Value| {
            Value::Object((0..n).map(|i| (format!("x{i}"), v.clone())).collect())
        };
        let within = [
            named(64, json!({})),
            json!({"shot": {"fields": named(8, json!("vec3")), "max_per_step": 1024}}),
        ];
        let past = [
            named(65, json!({})),
            json!({"shot": {"fields": named(9, json!("f64"))}}),
            json!({"shot": {"max_per_step": 1025}}),
            json!({"shot": {"fields": {"p": "quat"}}}),
            json!({"shot": {"fields": {"t": "f64"}}}),
            json!({"shot": {"offset": true}}),
        ];
        for emits in within {
            assert_eq!(
                refusals(json!({"e": {"emits": emits}})),
                json!(["e", "region"])
            );
        }
        for emits in past {
            assert_eq!(
                refusals(json!({"e": {"emits": emits.clone()}})),
                json!(["e", "emits"]),
                "{emits}"
            );
        }
    }

    /// #539: each read control's slot is its form's, and a step's read of a control's hover is
    /// refused, naming the read.
    #[test]
    fn read_controls_take_their_forms_slots_and_hover_is_refused() {
        let bytes = wat::parse_str(EMPTY).expect("a program");
        let sha = hash(&bytes);
        let controls = json!({
            "place": {"kind": "choice", "verb": "pick", "rows": ["board"]},
            "aim": {"kind": "point"}, "moves": {"kind": "actions"},
            "name": {"kind": "text", "text": {"max_bytes": 13}}, "speed": {"kind": "slider"},
        });
        let piece = |reads: Value| {
            json!({"seed": 0, "assets": {&sha: B64.encode(&bytes)}, "controls": controls,
                   "items": {"e": {"kind": "logic@1", "params": {"program": sha, "reads": reads}}}})
        };
        let p = check(
            &piece(json!(["place", "aim", "moves", "name", "speed"])),
            &Planted::default(),
            &mut History::new(),
        )
        .expect("checked");
        let sizes: Vec<(String, u32, String)> = p.items[0]
            .layout
            .entries
            .iter()
            .filter(|e| e.read == Read::Control)
            .map(|e| (e.name.clone(), e.size, e.ty.clone()))
            .collect();
        let want = [
            ("place", 8 + 16 * 32, "pick"),
            ("aim", 8 + 16 * (8 + 248 + 8 + 8 * 256), "point"),
            ("moves", 8 + 16 * 24, "action"),
            ("name", 24, "text"),
            ("speed", SLOT, "control"),
        ];
        assert_eq!(
            sizes,
            want.map(|(n, s, t)| (n.to_string(), s, t.to_string()))
        );
        match check(
            &piece(json!(["place.hover"])),
            &Planted::default(),
            &mut History::new(),
        ) {
            Err(Refused(v)) => assert_eq!(
                (&v["refusals"][0]["rule"], &v["refusals"][0]["read"]),
                (&json!("read"), &json!("place.hover"))
            ),
            Ok(_) => panic!("a hover read was taken"),
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

    #[test]
    fn due_names_its_own_i32_of_count_1_on_a_turn_clock() {
        let turn = |due: &str, ty: &str, count: u64, clock: &str| {
            refusals(
                json!({"g": {"clock": clock, "due": due, "writes": {"due": {"type": ty, "count": count}}}}),
            )
        };
        assert_eq!(turn("due", "i32", 1, "on_input"), json!([]));
        for (due, ty, count, clock) in [
            ("due", "f64", 1, "on_input"),
            ("due", "i32", 2, "on_input"),
            ("nothing", "i32", 1, "on_input"),
            ("due", "i32", 1, "fixed"),
        ] {
            assert_eq!(
                turn(due, ty, count, clock),
                json!(["g", "field"]),
                "due {due} on a {ty} x {count}, clock {clock}"
            );
        }
        assert_eq!(
            refusals(json!({"g": {"clock": "sometimes"}})),
            json!(["g", "field"])
        );
    }
}

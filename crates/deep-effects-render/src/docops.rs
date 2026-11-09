//! A document's composed operators in the frame (canvas primitives: GPU operators, as data: Place
//! in the frame; Determinism class; issue #429): its `gpu.compute@1` items dispatched first, each
//! writing its storage, then its `gpu.pass@1` items in their chain's order over the frame's
//! linear color, each at the resolution its writer's meter gives it. A live-only operator draws
//! its fallback (nothing) in every canonical render; one whose pipeline the device rejected draws
//! its fallback everywhere. Material operators are the 3D renderer's (`material@1`'s `op`).

use std::collections::{BTreeMap, BTreeSet};
use std::sync::Arc;

use deep_canvas_effects::check::{CheckOptions, Checked};
use deep_canvas_effects::emit::Options;
use deep_canvas_effects::graph::{self, Class, Fallback, From, Kind, Sc, Size, TexOut};
use deep_canvas_effects::interp::{self, Val};
use deep_canvas_effects::module::operator_of;
use deep_canvas_motion::eval::Validity;
use deep_canvas_motion::program::Program;
use deep_gpu::device::Device;
use serde_json::{json, Value};
use wgpu::util::DeviceExt as _;

use crate::compile::{compile_planted, compile_with, Compiled};
use deep_scene3d_render::created::{key128, Created, Log};
use crate::mips::{Chain, Fill, Fills, Mips};
use crate::planted::Pre;
use crate::runner::{texture_format, Frame, Runner, LINEAR};
use crate::structural::{Plan, Structural};

/// How one operator draws this frame, and what it drew.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Drew {
    Operator,
    Fallback,
    Off,
}

impl Drew {
    pub fn name(self) -> &'static str {
        match self {
            Drew::Operator => "operator",
            Drew::Fallback => "fallback",
            Drew::Off => "off",
        }
    }
}

/// The test hooks and planted programs of the structural steps (#483), all off in every real
/// build: `marker` fills every target the frame hands out before its clear; the rest are the
/// planted wrong programs the binary's `--planted` names.
#[derive(Clone, Copy, Debug, Default)]
pub struct Hooks {
    pub marker: Option<[f32; 4]>,
    pub no_clear: bool,
    pub feeds_first: bool,
    pub level0_only: bool,
    pub old_key: bool,
    pub ties_decreasing: bool,
    pub compact_by_atomic: bool,
    /// #484: an indirect dispatch runs `max` invocations, with no guard against its count.
    pub dispatch_without_guard: bool,
    /// #252: a stepped operator steps once per frame drawn, not once per fixed step.
    pub steps_per_frame: bool,
    /// #252: a carried output's ring keeps a checkpoint every `every` steps and never thins.
    pub keeps_every_checkpoint: bool,
}

/// One iterate step of a pass operator: its body's pipeline and its two ping-pong targets.
struct IterRun {
    step: String,
    count: u32,
    index: String,
    scale: f64,
    format: wgpu::TextureFormat,
    runner: Arc<Runner>,
}

/// The operator pipelines a document session holds (canvas primitives: Compile, validate and
/// cache: ≤ 32 per session), by key, kept across its revisions and variant switches so equal
/// operators share one; and the log of each pipeline made, with the items it was made for.
#[derive(Default)]
pub struct Pool {
    runners: BTreeMap<u128, Arc<Runner>>,
    pub log: Log,
}

impl Pool {
    /// The pipeline of `compiled` into `format`, made once per key; a new one is logged as made
    /// for `items`.
    pub fn runner(
        &mut self,
        device: &wgpu::Device,
        compiled: Compiled,
        format: wgpu::TextureFormat,
        items: &[String],
    ) -> (u128, Arc<Runner>) {
        let key = key128(&[compiled.wgsl.as_bytes(), format!("{format:?}").as_bytes()]);
        if let Some(r) = self.runners.get(&key) {
            return (key, r.clone());
        }
        let kind = compiled.kind().name();
        let runner = Arc::new(Runner::new(device, compiled, format));
        self.runners.insert(key, runner.clone());
        self.log.push(Created {
            key,
            items: items.to_vec(),
            feature_set: if items.len() > 1 { format!("fused {kind}") } else { kind.to_string() },
            target: "view".into(),
        });
        (key, runner)
    }

    /// How many operator pipelines it holds.
    pub fn len(&self) -> usize {
        self.runners.len()
    }

    pub fn is_empty(&self) -> bool {
        self.runners.is_empty()
    }
}

/// How a document's chain fuses (Compile, validate and cache: pass fusion): `off` in a
/// calibration run, which gives each operator its own pass; `apart` the operators that run alone
/// because they differ between the states the warm-up reaches.
#[derive(Clone, Debug, Default)]
pub struct Fusing {
    pub off: bool,
    pub apart: BTreeSet<String>,
}

/// One operator item of the document, compiled once; or a run of pixel-wise passes fused into
/// one, named by its first.
pub struct Op {
    pub item: String,
    /// The items it runs, in order, with each one's share of its cost: itself alone at 1, or a
    /// fused pass's members by declared cost.
    pub members: Vec<(String, f64)>,
    /// Each member's declared ns per pixel.
    pub member_ns: Vec<f64>,
    /// Its pipeline's key.
    pub key: u128,
    pub kind: Kind,
    pub class: Class,
    pub fallback: Fallback,
    /// Its declared ns per pixel (material, pass) or per element (compute).
    pub declared_ns: f64,
    /// Its chain order key.
    pub order: String,
    runner: Option<Arc<Runner>>,
    /// The device's message when it rejected the pipeline (`operator_compile`).
    pub failed: Option<String>,
    /// The mark name it is timed under: `op.<item>`.
    pub mark: &'static str,
    iterates: Vec<IterRun>,
    /// Whether it is a sort, a scan or a compaction, run on the shipped kernels.
    structural: bool,
    /// Whether it runs once per fixed step rather than once a frame (#252).
    stepped: bool,
    /// A fused pass's compiled graph (#432), in place of its first member's.
    fused: Option<Compiled>,
    /// The format of the target a pass writes: full precision when the next pass only loads it
    /// at its texels, so an unfused chain rounds nothing a fused one doesn't (#432); else linear.
    format: wgpu::TextureFormat,
}

/// What an operator's pipeline is built from: its fused graph, or its item's own.
fn op_build(op: &Op, builds: &BTreeMap<String, (Value, Compiled)>) -> Option<Compiled> {
    op.fused.clone().or_else(|| builds.get(&op.item).map(|b| b.1.clone()))
}

/// The frame's row for one operator: its resolution this frame and what it drew.
#[derive(Clone, Debug)]
pub struct Row {
    pub item: String,
    pub resolution: f64,
    pub drew: Drew,
}

/// The timer the passes are recorded under: the live meter's or the view's profiler.
pub trait Times {
    fn start(&mut self, mark: &'static str, encoder: &mut wgpu::CommandEncoder) -> Option<usize>;
    fn render(&self, i: Option<usize>) -> Option<wgpu::RenderPassTimestampWrites<'_>>;
    fn compute(&self, i: Option<usize>) -> Option<wgpu::ComputePassTimestampWrites<'_>>;
    fn end(&mut self, i: Option<usize>, encoder: &mut wgpu::CommandEncoder);
}

/// The view's profiler (#380) as a [`Times`]: one query per pass.
pub struct Profiled(
    pub Option<deep_scene3d_render::Profiler>,
    Option<wgpu_profiler::GpuProfilerQuery>,
);

impl Profiled {
    pub fn new(p: Option<deep_scene3d_render::Profiler>) -> Profiled {
        Profiled(p, None)
    }
}

impl Times for Profiled {
    fn start(&mut self, mark: &'static str, encoder: &mut wgpu::CommandEncoder) -> Option<usize> {
        let p = self.0.as_ref()?;
        let q = p
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .begin_pass_query(mark, encoder);
        self.1 = Some(q);
        Some(0)
    }
    fn render(&self, _: Option<usize>) -> Option<wgpu::RenderPassTimestampWrites<'_>> {
        self.1.as_ref()?.render_pass_timestamp_writes()
    }
    fn compute(&self, _: Option<usize>) -> Option<wgpu::ComputePassTimestampWrites<'_>> {
        self.1.as_ref()?.compute_pass_timestamp_writes()
    }
    fn end(&mut self, _: Option<usize>, encoder: &mut wgpu::CommandEncoder) {
        if let (Some(p), Some(q)) = (self.0.as_ref(), self.1.take()) {
            p.lock()
                .unwrap_or_else(|e| e.into_inner())
                .end_query(encoder, q);
        }
    }
}

/// The marks operator passes are timed under, one per item ID, kept for the process.
pub fn mark_of(item: &str) -> &'static str {
    use std::sync::Mutex;
    static MARKS: Mutex<BTreeMap<String, &'static str>> = Mutex::new(BTreeMap::new());
    let mut m = MARKS.lock().unwrap_or_else(|e| e.into_inner());
    m.entry(item.to_string())
        .or_insert_with(|| Box::leak(format!("op.{item}").into_boxed_str()))
}

/// The marks a document's pass and compute operator items run under, with their declared costs,
/// before they are built.
/// The operators that feed an instances output, directly or through what they read: they run in
/// the frame's compute place, before anything draws (#484). The rest run in the effects chain,
/// where a compute operator may read what the frame drew.
pub fn feeders(doc: &Value) -> BTreeSet<String> {
    let items = doc["items"].as_object();
    let mut early: BTreeSet<String> = items
        .into_iter()
        .flatten()
        .filter(|(_, item)| {
            item["kind"] == "gpu.compute@1"
                && item["params"]["outputs"]
                    .as_object()
                    .is_some_and(|o| o.values().any(|v| v.get("instances").is_some()))
        })
        .map(|(id, _)| id.clone())
        .collect();
    let mut grew = true;
    while grew {
        grew = false;
        for id in early.clone() {
            let inputs = doc["items"][&id]["params"]["inputs"].as_object();
            for i in inputs.into_iter().flat_map(|m| m.values()) {
                if let Some(op) = i["from"]["storage"]["op"].as_str() {
                    grew |= items.is_some_and(|m| m.contains_key(op)) && early.insert(op.to_string());
                }
            }
        }
    }
    early
}

pub fn marks(doc: &Value) -> Vec<(String, f64)> {
    let mut out = item_marks(doc);
    out.extend(fused_marks(doc));
    out
}

/// The marks the document's fused passes run under (#432: pass fusion), each with its members'
/// summed cost: its pass items in chain order, fused as [`DocOps`] fuses them.
fn fused_marks(doc: &Value) -> Vec<(String, f64)> {
    let in_groups: BTreeSet<&str> = doc["items"]
        .as_object()
        .into_iter()
        .flatten()
        .flat_map(|(_, i)| i["params"]["passes"].as_array().into_iter().flatten())
        .filter_map(|p| p["op"].as_str())
        .collect();
    let mut chain: Vec<(String, String, Value)> = doc["items"]
        .as_object()
        .into_iter()
        .flatten()
        .filter(|(id, _)| !in_groups.contains(id.as_str()))
        .filter_map(|(id, item)| {
            let g = operator_of(id, item).filter(|g| g["kind"] == "pass")?;
            Some((g["order"].as_str().unwrap_or("a0").to_string(), id.clone(), g))
        })
        .collect();
    chain.sort_by(|a, b| (&a.0, &a.1).cmp(&(&b.0, &b.1)));
    let chain: Vec<(String, Value)> = chain.into_iter().map(|(_, id, g)| (id, g)).collect();
    deep_canvas_effects::fusion::runs(&chain, &BTreeSet::new())
        .into_iter()
        .filter(|run| run.len() > 1)
        .map(|run| {
            let names: Vec<&str> = run.iter().map(|&k| chain[k].0.as_str()).collect();
            let ns = run.iter().map(|&k| chain[k].1["cost"]["ns_per_px"].as_f64().unwrap_or(0.0)).sum();
            (mark_of(&names.join("+")).to_string(), ns)
        })
        .collect()
}

/// Each pass and compute operator item's own mark, with its declared cost.
fn item_marks(doc: &Value) -> Vec<(String, f64)> {
    doc["items"]
        .as_object()
        .into_iter()
        .flatten()
        .filter(|(_, item)| {
            matches!(
                item["kind"].as_str(),
                Some("gpu.pass@1" | "gpu.compute@1")
            )
        })
        .map(|(id, item)| {
            let p = &item["params"]["cost"];
            let ns = p["ns_per_px"].as_f64().or(p["ns_per_element"].as_f64());
            (mark_of(id).to_string(), ns.unwrap_or(0.0))
        })
        .collect()
}

/// The operator item a pass mark names, if it is one.
pub fn item_of_mark(mark: &str) -> Option<&str> {
    mark.strip_prefix("op.")
}

/// The pass that returns a smaller pass's output to the frame's size.
fn blit() -> Value {
    json!({
        "id": "docops.blit", "kind": "pass", "origin": "shipped",
        "about": "Returns an operator's output drawn below full resolution to the frame's size.",
        "inputs": {"src": {"type": "texture", "from": {"texture": {"target": {"op": "core", "output": "color"}}}}},
        "steps": {"uv": {"op": "screen_uv@1", "args": {}}, "c": {"op": "sample@1", "args": {"tex": "src", "uv": "uv", "lod": 0}}},
        "outputs": {"color": "c"}, "resolution": "full", "chain": "effects", "order": "z"
    })
}

/// A compute operator's texture output (#483): its texture, which every frame clears to its
/// declared clear value before the operator stores into it, and its mip chain.
pub struct OutTex {
    pub tex: wgpu::Texture,
    pub out: TexOut,
    chain: Option<Arc<Chain>>,
    /// Whether its chain was made once (the planted chain kept under the old key makes it only
    /// then).
    made: bool,
}

/// A document's operators.
pub struct DocOps {
    pub ops: Vec<Op>,
    /// The operators that run before the frame's draws (#484: [`feeders`]).
    pub early: BTreeSet<String>,
    /// Each compute operator's storage outputs, by (item, output), and the core's storage inputs
    /// by ("core", name).
    storage: BTreeMap<(String, String), wgpu::Buffer>,
    /// Each compute operator's texture outputs, by (item, output).
    textures: BTreeMap<(String, String), OutTex>,
    /// #149: each collection target this frame drew, by the (op, output) its readers name.
    pub collections: BTreeMap<(String, String), wgpu::TextureView>,
    /// Each pass operator's own target, with its size; each iterate's two ping-pong targets.
    targets: BTreeMap<String, ([u32; 2], wgpu::Texture)>,
    /// Each pass operator's target in the last frame planned, by item.
    drawn: BTreeMap<String, String>,
    /// Each multi-dispatch operator's plan, made once its buffers are known.
    plans: BTreeMap<String, (Option<Arc<Pre>>, Arc<Plan>)>,
    /// Each indirect dispatch's arguments and the plan that writes them (#484).
    counted: BTreeMap<String, (Arc<Plan>, wgpu::Buffer)>,
    /// The word each storage output with a declared clear starts the frame at, as a buffer to
    /// copy from (#484).
    clears: BTreeMap<(String, String), wgpu::Buffer>,
    blit: Option<Arc<Runner>>,
    kernels: Option<Arc<(Structural, Mips, Fills)>>,
    doc_seed: u64,
    /// The document's motion program, for operator inputs read from a channel.
    program: Option<Program>,
    pub hooks: Hooks,
    /// A group's passes (Frame and group: passes): each one's params at t, by item.
    pub params: BTreeMap<String, BTreeMap<String, Value>>,
    /// And the px each may write, `[x, y, w, h]` of the frame, by item.
    pub within: BTreeMap<String, [u32; 4]>,
    /// The core's targets beside color, depth and object ID that this frame drew because an
    /// operator reads them (#431): velocity and emission, by name.
    pub core: BTreeMap<&'static str, wgpu::TextureView>,
    /// The document's stepped operators and their carried state (#252).
    stepping: Option<Stepping>,
    /// The frame's time in seconds of document time, exact past f32, when its caller knows it:
    /// what the fixed steps count from (#252).
    pub clock: Option<f64>,
}

/// The steps a frame records itself; any before them a seek or a cold start needs are submitted
/// ahead of it, `CHUNK` steps to a command buffer (#252).
const IN_FRAME: u64 = 4;
const CHUNK: u64 = 32;

/// No timer: work that writes its own timestamps, or runs outside a frame's marks.
pub struct Untimed;

impl Times for Untimed {
    fn start(&mut self, _: &'static str, _: &mut wgpu::CommandEncoder) -> Option<usize> {
        None
    }
    fn render(&self, _: Option<usize>) -> Option<wgpu::RenderPassTimestampWrites<'_>> {
        None
    }
    fn compute(&self, _: Option<usize>) -> Option<wgpu::ComputePassTimestampWrites<'_>> {
        None
    }
    fn end(&mut self, _: Option<usize>, _: &mut wgpu::CommandEncoder) {}
}

/// Records `parts` in order into a command buffer of their own and submits it.
fn submit(device: &Device, parts: Vec<Part>) {
    let mut enc = device.device.create_command_encoder(&wgpu::CommandEncoderDescriptor {
        label: Some("stepped operators"),
    });
    Rec { mark: "op.steps", parts }.record_passes(&mut enc, &mut Untimed, None);
    device.queue.submit([enc.finish()]);
}

/// One carried storage output (#252; canvas primitives: Carried state; Checkpoint ring): its
/// current state is the operator's storage buffer; `prev` the copy the previous step left, which
/// a `step: previous` read binds; and its ring of checkpoints, each a GPU copy of the state after
/// its step, spaced `spacing` steps apart, the spacing doubling whenever the ring passes its
/// budget.
struct Carried {
    item: String,
    output: String,
    prev: wgpu::Buffer,
    bytes: u64,
    carry: graph::Carry,
    spacing: u64,
    ring: Vec<(u64, wgpu::Buffer)>,
}

impl Carried {
    fn held(&self) -> u64 {
        self.ring.len() as u64 * self.bytes
    }

    /// Thins the ring until it fits its budget: the spacing doubles and the checkpoints off it
    /// go; a state larger than the budget keeps none.
    fn thin(&mut self) {
        if self.bytes > self.carry.budget {
            self.ring.clear();
            return;
        }
        while self.held() > self.carry.budget {
            self.spacing *= 2;
            let spacing = self.spacing;
            self.ring.retain(|(s, _)| s % spacing == 0);
        }
    }
}

/// The document's stepped operators (#252): one fixed-step clock at `rate` steps a second, the
/// step the carried state holds (`None` before step 0), and the last frame's restore.
struct Stepping {
    rate: u32,
    carried: Vec<Carried>,
    at: Option<u64>,
    restored: Option<(u64, u64)>,
}

/// The issue a rejected pipeline raises, naming its canvas module, operator and item, with the
/// backend's message as evidence.
pub fn compile_issue(op: &Op) -> Option<Value> {
    let evidence = op.failed.as_ref()?;
    Some(json!({
        "code": "operator_compile", "severity": "error", "module": "effects",
        "operator": op.item, "item": op.item, "path": format!("items/{}", op.item),
        "evidence": evidence,
        "what": format!("the device rejected {}'s pipeline; its fallback draws", op.item),
    }))
}

/// What an operator reads that another writes this frame: the items it must follow.
fn reads_items(c: &Checked) -> Vec<String> {
    c.op.inputs
        .values()
        .filter_map(|i| match &i.from {
            From::Storage { op, previous: false, .. }
            | From::Texture3d { op, .. }
            | From::Target { op, .. }
                if op != "core" =>
            {
                Some(op.clone())
            }
            _ => None,
        })
        .collect()
}

fn scale_of(size: &Size) -> f64 {
    match size {
        Size::Full => 1.0,
        Size::Quarter => 0.25,
        _ => 0.5,
    }
}

impl DocOps {
    pub fn empty() -> DocOps {
        DocOps {
            ops: Vec::new(),
            storage: BTreeMap::new(),
            textures: BTreeMap::new(),
            collections: BTreeMap::new(),
            targets: BTreeMap::new(),
            drawn: BTreeMap::new(),
            plans: BTreeMap::new(),
            early: BTreeSet::new(),
            counted: BTreeMap::new(),
            clears: BTreeMap::new(),
            blit: None,
            kernels: None,
            doc_seed: 0,
            program: None,
            hooks: Hooks::default(),
            params: BTreeMap::new(),
            within: BTreeMap::new(),
            core: BTreeMap::new(),
            stepping: None,
            clock: None,
        }
    }

    /// The document's pass and compute operators, checked, written and built on `device`. Items
    /// the check refuses are left out (the document's check refuses the document first); one in
    /// `fail` builds from a module the device rejects, the test hook of `operator_compile`.
    pub fn new(
        device: &Device,
        doc: &Value,
        options: Options,
        planted: CheckOptions,
        fail: &[String],
    ) -> DocOps {
        Self::with(device, doc, options, planted, fail, Hooks::default(), BTreeMap::new())
    }

    /// [`DocOps::new`] under `hooks`, with `core` the core's storage inputs by name (#483:
    /// check_operator's `data`).
    pub fn with(
        device: &Device,
        doc: &Value,
        options: Options,
        planted: CheckOptions,
        fail: &[String],
        hooks: Hooks,
        core: BTreeMap<String, wgpu::Buffer>,
    ) -> DocOps {
        let mut pool = Pool::default();
        Self::pooled(device, doc, options, planted, fail, hooks, core, &mut pool, &Fusing::default())
    }

    /// [`DocOps::with`], its pipelines from the session's `pool` and its chain fused as
    /// `fusing` says (#432).
    #[allow(clippy::too_many_arguments)]
    pub fn pooled(
        device: &Device,
        doc: &Value,
        options: Options,
        planted: CheckOptions,
        fail: &[String],
        hooks: Hooks,
        core: BTreeMap<String, wgpu::Buffer>,
        pool: &mut Pool,
        fusing: &Fusing,
    ) -> DocOps {
        let mut out = DocOps::empty();
        // Each item's graph and compiled form, until the chain is fused and its pipelines made.
        let mut builds: BTreeMap<String, (Value, Compiled)> = BTreeMap::new();
        out.hooks = hooks;
        out.doc_seed = doc["seed"].as_u64().unwrap_or(0);
        for (name, b) in core {
            out.storage.insert(("core".into(), name), b);
        }
        let mut items: Vec<(&String, &Value)> = doc["items"]
            .as_object()
            .into_iter()
            .flatten()
            .collect();
        items.sort_by(|a, b| a.0.cmp(b.0));
        let mut follows: BTreeMap<String, Vec<String>> = BTreeMap::new();
        let mut channels = false;
        // A pass a group names runs on the group's target, never in the view's chain.
        let in_groups: Vec<&str> = items
            .iter()
            .flat_map(|(_, i)| i["params"]["passes"].as_array().into_iter().flatten())
            .filter_map(|p| p["op"].as_str())
            .collect();
        for (id, item) in items {
            let Some(json) = operator_of(id, item) else {
                continue;
            };
            if in_groups.contains(&id.as_str()) {
                continue;
            }
            let Ok(compiled) = compile_planted(&json, &BTreeMap::new(), options, planted) else {
                continue;
            };
            let c = &compiled.checked;
            if c.op.kind == Kind::Material {
                continue;
            }
            channels |= c.op.inputs.values().any(|i| matches!(i.from, From::Channel(_)));
            follows.insert(id.clone(), reads_items(c));
            let structural = c
                .op
                .steps
                .values()
                .any(|s| deep_canvas_effects::table::multi_dispatch(&s.op));
            let declared_ns = c.op.cost.unwrap_or(c.estimate);
            let mut op = Op {
                item: id.clone(),
                members: vec![(id.clone(), 1.0)],
                member_ns: vec![declared_ns],
                key: 0,
                kind: c.op.kind,
                class: c.class,
                fallback: c.op.fallback,
                declared_ns,
                order: c.op.order.clone(),
                runner: None,
                failed: None,
                mark: mark_of(id),
                iterates: Vec::new(),
                structural,
                stepped: c.op.stepped.is_some(),
                fused: None,
                format: LINEAR,
            };
            let d = &device.device;
            for it in &c.iterates {
                let body = Compiled {
                    checked: (*it.body).clone(),
                    wgsl: deep_canvas_effects::emit::pass(&it.body, options),
                };
                let format = texture_format(&it.format);
                op.iterates.push(IterRun {
                    step: it.step.clone(),
                    count: it.count,
                    index: it.index.clone(),
                    scale: scale_of(&it.size),
                    format,
                    runner: pool.runner(d, body, format, std::slice::from_ref(id)).1,
                });
            }
            builds.insert(id.clone(), (json.clone(), compiled.clone()));
            // A stepped operator (#252) steps with the document's one fixed-step clock, and binds
            // storage only.
            if let Some(rate) = c.op.stepped {
                let st = out.stepping.get_or_insert_with(|| Stepping { rate, carried: Vec::new(), at: None, restored: None });
                if st.rate != rate {
                    op.failed = Some(format!("{id} steps {rate} times a second, and the document's stepped operators step {} times", st.rate));
                } else if !c.textures.is_empty() || !c.op.textures.is_empty() {
                    op.failed = Some(format!("{id} is stepped, and a stepped operator reads and writes storage only"));
                }
            }
            if op.kind == Kind::Compute {
                for (name, s) in &c.op.storage {
                    let buffer = || {
                        d.create_buffer(&wgpu::BufferDescriptor {
                            label: Some("operator storage"),
                            size: u64::from(s.count.max(1)) * 4,
                            usage: wgpu::BufferUsages::STORAGE
                                | wgpu::BufferUsages::COPY_SRC
                                | wgpu::BufferUsages::COPY_DST,
                            mapped_at_creation: false,
                        })
                    };
                    if let (Some(carry), Some(st)) = (s.carry, out.stepping.as_mut().filter(|_| op.stepped)) {
                        st.carried.push(Carried {
                            item: id.clone(),
                            output: name.clone(),
                            prev: buffer(),
                            bytes: u64::from(s.count.max(1)) * 4,
                            carry,
                            spacing: u64::from(carry.every),
                            ring: Vec::new(),
                        });
                    }
                    out.storage.insert((id.clone(), name.clone()), buffer());
                }
                for (name, t) in &c.op.textures {
                    let levels = if t.mips {
                        crate::mips::levels([t.size[0], t.size[1]])
                    } else {
                        1
                    };
                    let tex = d.create_texture(&wgpu::TextureDescriptor {
                        label: Some("operator texture"),
                        size: wgpu::Extent3d {
                            width: t.size[0],
                            height: t.size[1],
                            depth_or_array_layers: t.size[2],
                        },
                        mip_level_count: levels,
                        sample_count: 1,
                        dimension: if t.dim3 {
                            wgpu::TextureDimension::D3
                        } else {
                            wgpu::TextureDimension::D2
                        },
                        format: texture_format(&t.format),
                        usage: wgpu::TextureUsages::STORAGE_BINDING
                            | wgpu::TextureUsages::TEXTURE_BINDING
                            | wgpu::TextureUsages::COPY_SRC,
                        view_formats: &[],
                    });
                    out.textures.insert(
                        (id.clone(), name.clone()),
                        OutTex { tex, out: t.clone(), chain: None, made: false },
                    );
                }
            }
            out.ops.push(op);
        }
        if channels {
            out.program = doc
                .as_object()
                .and_then(|m| Program::compile(m).ok());
        }
        out.early = feeders(doc);
        // Compute first, each after what it reads; then passes by their order key, then ID.
        let mut placed: Vec<String> = Vec::new();
        let mut computes: Vec<String> = out
            .ops
            .iter()
            .filter(|o| o.kind == Kind::Compute)
            .map(|o| o.item.clone())
            .collect();
        while !computes.is_empty() {
            let ready = computes
                .iter()
                .position(|c| {
                    follows[c]
                        .iter()
                        .all(|f| placed.contains(f) || !computes.contains(f))
                })
                .unwrap_or(0);
            placed.push(computes.remove(ready));
        }
        let rank = |o: &Op| placed.iter().position(|p| *p == o.item).unwrap_or(usize::MAX);
        out.ops.sort_by(|a, b| {
            (a.kind != Kind::Compute, rank(a), &a.order, &a.item).cmp(&(
                b.kind != Kind::Compute,
                rank(b),
                &b.order,
                &b.item,
            ))
        });
        if !fusing.off {
            out.fuse(&builds, fail, options, planted, fusing);
        }
        out.precise(&builds);
        // Each operator's pipeline, from the pool; the device checks each one new to it.
        for op in &mut out.ops {
            let Some(built) = op_build(op, &builds) else { continue };
            let mut built = built;
            if fail.contains(&op.item) {
                // The hook: the device gets a module it rejects, after the check passed.
                built.wgsl.push_str("\nfn rejected_by_the_device( {\n");
            }
            let d = &device.device;
            let scope = d.push_error_scope(wgpu::ErrorFilter::Validation);
            let members: Vec<String> = op.members.iter().map(|m| m.0.clone()).collect();
            let (key, runner) = pool.runner(d, built, op.format, &members);
            match block(scope.pop()) {
                Some(e) => op.failed = Some(e.to_string()),
                None => {
                    op.key = key;
                    op.runner = Some(runner);
                }
            }
        }
        out
    }

    /// Fuses each run of adjacent pixel-wise passes into one operator (pass fusion), its members
    /// in order; a run whose fused graph the check refuses stays apart.
    fn fuse(
        &mut self,
        builds: &BTreeMap<String, (Value, Compiled)>,
        fail: &[String],
        options: Options,
        planted: CheckOptions,
        fusing: &Fusing,
    ) {
        let eligible = |o: &Op| {
            o.kind == Kind::Pass
                && !o.structural
                && !o.stepped
                && o.iterates.is_empty()
                && o.failed.is_none()
                && !fail.contains(&o.item)
                && builds.contains_key(&o.item)
        };
        let ops = std::mem::take(&mut self.ops);
        let mut segment: Vec<Op> = Vec::new();
        let flush = |segment: &mut Vec<Op>, out: &mut Vec<Op>| {
            let chain: Vec<(String, Value)> = segment.iter().map(|o| (o.item.clone(), builds[&o.item].0.clone())).collect();
            let runs = deep_canvas_effects::fusion::runs(&chain, &fusing.apart);
            let mut taken: Vec<Option<Op>> = segment.drain(..).map(Some).collect();
            for run in runs {
                let fused = (run.len() > 1)
                    .then(|| {
                        let members: Vec<(String, Value)> = run.iter().map(|&k| chain[k].clone()).collect();
                        let g = deep_canvas_effects::fusion::fuse(&members)?;
                        compile_planted(&g, &BTreeMap::new(), options, planted).ok()
                    })
                    .flatten();
                match fused {
                    Some(c) => {
                        let parts: Vec<Op> = run.iter().map(|&k| taken[k].take().expect("once")).collect();
                        let total: f64 = parts.iter().map(|o| o.declared_ns).sum();
                        let mut first = parts.into_iter();
                        let mut op = first.next().expect("a run of two or more");
                        let rest: Vec<Op> = first.collect();
                        let mut members = vec![(op.item.clone(), op.declared_ns)];
                        members.extend(rest.iter().map(|o| (o.item.clone(), o.declared_ns)));
                        let names: Vec<&str> = members.iter().map(|m| m.0.as_str()).collect();
                        op.mark = mark_of(&names.join("+"));
                        op.member_ns = members.iter().map(|m| m.1).collect();
                        op.members = members
                            .iter()
                            .map(|(i, ns)| (i.clone(), if total > 0.0 { ns / total } else { 1.0 / names.len() as f64 }))
                            .collect();
                        op.declared_ns = total;
                        op.class = c.checked.class;
                        op.fused = Some(c);
                        out.push(op);
                    }
                    None => out.extend(run.iter().map(|&k| taken[k].take().expect("once"))),
                }
            }
        };
        let mut out = Vec::with_capacity(ops.len());
        for op in ops {
            let joins = eligible(&op)
                && segment.last().is_none_or(|l: &Op| builds[&l.item].0["chain"] == builds[&op.item].0["chain"]);
            if !joins {
                flush(&mut segment, &mut out);
            }
            if eligible(&op) {
                segment.push(op);
            } else {
                out.push(op);
            }
        }
        flush(&mut segment, &mut out);
        self.ops = out;
    }

    /// Which passes write a full-precision target: a pass at full resolution, drawn alone, whose
    /// target no other operator reads by name and whose next pass only loads the frame's color.
    fn precise(&mut self, builds: &BTreeMap<String, (Value, Compiled)>) {
        let compiled = |o: &Op| op_build(o, builds);
        let named: BTreeSet<String> = builds.values().flat_map(|(_, c)| reads_items(&c.checked)).collect();
        let passes: Vec<usize> = (0..self.ops.len()).filter(|&k| self.ops[k].kind == Kind::Pass).collect();
        for w in passes.windows(2) {
            let (k, j) = (w[0], w[1]);
            let (Some(a), Some(b)) = (compiled(&self.ops[k]), compiled(&self.ops[j])) else { continue };
            let loads = b.checked.textures.iter().all(|n| {
                let core_color = matches!(&b.checked.op.inputs[n].from, From::Target { op, output } if op == "core" && output == "color");
                !core_color || crate::runner::only_loaded(&b.checked, n)
            });
            let o = &self.ops[k];
            let alone = !o.structural && !o.stepped && o.iterates.is_empty();
            let full = a.checked.op.size == Size::Full;
            if loads && alone && full && !o.members.iter().any(|(m, _)| named.contains(m)) {
                self.ops[k].format = wgpu::TextureFormat::Rgba32Float;
            }
        }
    }

    /// The pipeline key and members of the operator pass timed under `mark`, each member with its
    /// share of the pass's cost (Operator cost and limits: a fused pass split by declared shares).
    pub fn pass_of(&self, mark: &str) -> Option<(u128, &[(String, f64)])> {
        self.ops
            .iter()
            .find(|o| o.mark == mark && o.kind != Kind::Compute && o.runner.is_some())
            .map(|o| (o.key, o.members.as_slice()))
    }

    /// The operator that runs `item`, its declared ns per pixel and its share of that operator's
    /// pass.
    pub fn member(&self, item: &str) -> Option<(&Op, f64, f64)> {
        self.ops.iter().find_map(|o| {
            let k = o.members.iter().position(|m| m.0 == item)?;
            Some((o, o.member_ns[k], o.members[k].1))
        })
    }

    /// Each instances output with a count: the rows its compact step keeps and that count, which
    /// the instancer draws from (#484).
    pub fn sources(&self) -> Vec<deep_scene3d_render::cull::Source> {
        let mut out = Vec::new();
        for op in &self.ops {
            let Some(runner) = &op.runner else { continue };
            let o = &runner.compiled.checked.op;
            for i in o.instances.values() {
                let Some(step) = &i.count else { continue };
                let buffer = |port: &str| {
                    let want = graph::Arg::Ref(step.clone(), Some(port.to_string()));
                    let (name, _) = o.storage.iter().find(|(_, s)| s.from.as_ref() == Some(&want))?;
                    self.storage.get(&(op.item.clone(), name.clone())).cloned()
                };
                if let (Some(rows), Some(count)) = (buffer("out"), buffer("count")) {
                    out.push(deep_scene3d_render::cull::Source {
                        instancer: i.instancer.clone(),
                        rows,
                        count,
                    });
                }
            }
        }
        out
    }

    /// The issues of operators whose pipelines the device rejected.
    pub fn issues(&self) -> Vec<Value> {
        self.ops.iter().filter_map(compile_issue).collect()
    }

    fn kernels(&mut self, device: &Device) -> Arc<(Structural, Mips, Fills)> {
        self.kernels
            .get_or_insert_with(|| {
                let d = &device.device;
                Arc::new((Structural::new(d), Mips::new(d), Fills::new(d)))
            })
            .clone()
    }

    fn texture(device: &Device, label: &str, size: [u32; 2], format: wgpu::TextureFormat) -> wgpu::Texture {
        device.device.create_texture(&wgpu::TextureDescriptor {
            label: Some(label),
            size: wgpu::Extent3d {
                width: size[0].max(1),
                height: size[1].max(1),
                depth_or_array_layers: 1,
            },
            mip_level_count: 1,
            sample_count: 1,
            dimension: wgpu::TextureDimension::D2,
            format,
            usage: wgpu::TextureUsages::RENDER_ATTACHMENT
                | wgpu::TextureUsages::TEXTURE_BINDING
                | wgpu::TextureUsages::COPY_SRC,
            view_formats: &[],
        })
    }

    /// A target of `size` the operators keep under `key`, made again when the size changes.
    fn target(&mut self, device: &Device, key: String, size: [u32; 2]) -> wgpu::TextureView {
        self.target_of(device, key, size, LINEAR)
    }

    fn target_of(
        &mut self,
        device: &Device,
        key: String,
        size: [u32; 2],
        format: wgpu::TextureFormat,
    ) -> wgpu::TextureView {
        if self
            .targets
            .get(&key)
            .is_none_or(|t| t.0 != size || t.1.format() != format)
        {
            let t = Self::texture(device, "operator target", size, format);
            self.targets.insert(key.clone(), (size, t));
        }
        self.targets[&key].1.create_view(&Default::default())
    }

    fn blit_runner(&mut self, device: &Device) -> Arc<Runner> {
        self.blit
            .get_or_insert_with(|| {
                let c = compile_with(&blit(), &BTreeMap::new(), Options::default())
                    .expect("the blit checks");
                Arc::new(Runner::new(&device.device, c, LINEAR))
            })
            .clone()
    }

    /// The blit of `from` into `to` at `size`, sampled, to record later.
    fn blit_rec(
        &mut self,
        device: &Device,
        from: &wgpu::TextureView,
        to: wgpu::TextureView,
        size: [u32; 2],
    ) -> Blit {
        let runner = self.blit_runner(device);
        let (g0, g1, keep) = runner.bind(
            &device.device,
            &Frame::default(),
            size,
            &BTreeMap::new(),
            &[from],
            &[],
        );
        Blit {
            runner,
            groups: (g0, g1),
            _keep: keep,
            to,
        }
    }

    /// Draws `from` into `to` at `size`, sampled.
    pub fn blit_into(
        &mut self,
        device: &Device,
        encoder: &mut wgpu::CommandEncoder,
        from: &wgpu::TextureView,
        to: &wgpu::TextureView,
        size: [u32; 2],
    ) {
        self.blit_rec(device, from, to.clone(), size).record(encoder);
    }

    /// A compute operator's storage output (or the core's storage input `name` under "core").
    pub fn buffer_of(&self, item: &str, output: &str) -> Option<&wgpu::Buffer> {
        self.storage.get(&(item.to_string(), output.to_string()))
    }

    /// An operator item's computed determinism class.
    pub fn class_of(&self, item: &str) -> Option<Class> {
        self.ops.iter().find(|o| o.item == item).map(|o| o.class)
    }

    /// A compute operator's texture output.
    pub fn texture_of(&self, item: &str, output: &str) -> Option<&OutTex> {
        self.textures.get(&(item.to_string(), output.to_string()))
    }

    /// The target a pass operator drew into in the last frame planned.
    pub fn drawn_of(&self, item: &str) -> Option<&wgpu::Texture> {
        self.targets.get(self.drawn.get(item)?).map(|t| &t.1)
    }

    /// The parameter values a frame at `t` s feeds the operators' channel inputs, by path.
    fn channel_values(&self, t: f32) -> BTreeMap<String, Value> {
        let mut out = BTreeMap::new();
        let Some(program) = &self.program else {
            return out;
        };
        let mut state = program.state();
        let at = (f64::from(t) * 705_600_000.0).round() as i64;
        program.evaluate(at, Validity::Full, &mut state);
        for op in &self.ops {
            let Some(r) = &op.runner else { continue };
            for input in r.compiled.checked.op.inputs.values() {
                let From::Channel(path) = &input.from else { continue };
                let parts: Vec<&str> = path.split('/').collect();
                if let ["items", owner, field @ ..] = parts.as_slice() {
                    let field: Vec<String> = field.iter().map(|f| f.to_string()).collect();
                    let slot = program.slot_of(owner, &field);
                    if let Some(v) = slot.and_then(|k| state.slots.get(k)) {
                        out.insert(path.clone(), json!(v));
                    }
                }
            }
        }
        out
    }

    /// The view a pass's texture input reads this frame.
    #[allow(clippy::too_many_arguments)]
    fn view_of(
        &self,
        from: &From,
        src: &wgpu::TextureView,
        ids: Option<&wgpu::TextureView>,
        depth: Option<&wgpu::TextureView>,
        iterated: &BTreeMap<String, wgpu::TextureView>,
        passes: &BTreeMap<String, wgpu::TextureView>,
    ) -> wgpu::TextureView {
        match from {
            From::Target { op, output } if op == "core" && output == "object_id" => {
                ids.cloned().unwrap_or_else(|| src.clone())
            }
            From::Target { op, output } if op == "core" && output == "depth" => {
                depth.cloned().unwrap_or_else(|| src.clone())
            }
            From::Target { op, output }
                if op == "core" && self.core.contains_key(output.as_str()) =>
            {
                self.core[output.as_str()].clone()
            }
            From::Target { op, output } | From::Texture3d { op, output, .. } => {
                if let Some(v) = self.collections.get(&(op.clone(), output.clone())) {
                    v.clone()
                } else if let Some(t) = self.textures.get(&(op.clone(), output.clone())) {
                    t.tex.create_view(&Default::default())
                } else if let Some(v) = iterated.get(op) {
                    v.clone()
                } else if let Some(v) = passes.get(op) {
                    v.clone()
                } else {
                    src.clone()
                }
            }
            _ => src.clone(),
        }
    }

    /// The multi-dispatch plan of a compute operator, made once its buffers are known.
    fn plan_of(&mut self, device: &Device, item: &str, c: &Checked) -> Option<(Option<Arc<Pre>>, Arc<Plan>)> {
        if let Some(p) = self.plans.get(item) {
            return Some(p.clone());
        }
        let k = self.kernels(device);
        let d = &device.device;
        let (id, s) = c.op.steps.iter().next()?;
        let input = |port: &str| -> Option<wgpu::Buffer> {
            let Some(graph::Arg::Ref(name, None)) = s.args.get(port) else { return None };
            match &c.op.inputs.get(name)?.from {
                From::Storage { op, output, previous: false } => {
                    self.storage.get(&(op.clone(), output.clone())).cloned()
                }
                _ => None,
            }
        };
        let output = |port: Option<&str>| -> Option<wgpu::Buffer> {
            let (name, _) = c.op.storage.iter().find(|(_, o)| {
                matches!(&o.from, Some(graph::Arg::Ref(st, p)) if st == id && p.as_deref() == port)
            })?;
            self.storage.get(&(item.to_string(), name.clone())).cloned()
        };
        let scratch = |n: u32| {
            d.create_buffer(&wgpu::BufferDescriptor {
                label: Some("structural scratch"),
                size: u64::from(n.max(1)) * 4,
                usage: wgpu::BufferUsages::STORAGE | wgpu::BufferUsages::COPY_SRC | wgpu::BufferUsages::COPY_DST,
                mapped_at_creation: false,
            })
        };
        let count = |len: u32| match s.args.get("count") {
            Some(graph::Arg::Lit(v)) => v.as_u64().unwrap_or(u64::from(len)) as u32,
            _ => len,
        };
        let made = match s.op.as_str() {
            "scan@1" => {
                let src = input("in")?;
                let n = (src.size() / 4) as u32;
                let dst = output(None).unwrap_or_else(|| scratch(n));
                (None, k.0.scan(d, &src, &dst, n.min(c.op.storage.values().next().map_or(n, |o| o.count))))
            }
            "compact@1" => {
                let (src, flag) = (input("in")?, input("flag")?);
                let n = count((src.size() / 4) as u32);
                let out = output(Some("out")).unwrap_or_else(|| scratch(n));
                let cnt = output(Some("count")).unwrap_or_else(|| scratch(1));
                if self.hooks.compact_by_atomic {
                    let pre = Pre::append(d, &src, &flag, &out, &cnt, n);
                    // The counter's plan clears what the step writes and runs nothing more.
                    let clear = k.0.scan(d, &scratch(1), &cnt, 0);
                    (Some(Arc::new(pre)), clear)
                } else {
                    (None, k.0.compact(d, &src, &flag, &out, &cnt, n))
                }
            }
            _ => {
                let (keys, vals) = (input("keys")?, input("values")?);
                let n = count((keys.size() / 4) as u32);
                let vo = output(None).unwrap_or_else(|| scratch(n));
                let ko = scratch(n);
                if self.hooks.ties_decreasing {
                    let (rk, rv) = (scratch(n), scratch(n));
                    let pre = Pre::reverse(d, &[(&keys, &rk), (&vals, &rv)], n);
                    (Some(Arc::new(pre)), k.0.sort_by_key(d, &rk, &rv, &ko, &vo, n))
                } else {
                    (None, k.0.sort_by_key(d, &keys, &vals, &ko, &vo, n))
                }
            }
        };
        let made = (made.0, Arc::new(made.1));
        self.plans.insert(item.to_string(), made.clone());
        Some(made)
    }

    /// The buffer a storage input binds: the output an operator wrote earlier in the frame or
    /// step, or with `previous`, a carried output as the previous step left it (#252).
    fn storage_in(&self, from: &From) -> Option<wgpu::Buffer> {
        match from {
            From::Storage { op, output, previous: false } => {
                self.storage.get(&(op.clone(), output.clone())).cloned()
            }
            From::Storage { op, output, previous: true } => self
                .stepping
                .as_ref()?
                .carried
                .iter()
                .find(|c| c.item == *op && c.output == *output)
                .map(|c| c.prev.clone()),
            _ => None,
        }
    }

    /// What each carried output holds after the last frame planned (#252): the step, its ring's
    /// bytes, budget and checkpoints, and the checkpoint a seek restored with the steps it then
    /// ran, by `<item>.<output>`.
    pub fn carried(&self) -> Value {
        let Some(st) = &self.stepping else {
            return json!({});
        };
        let mut m = serde_json::Map::new();
        for c in &st.carried {
            let mut row = json!({
                "step": st.at,
                "ring": {
                    "bytes": c.held(),
                    "budget": c.carry.budget,
                    "checkpoints": c.ring.iter().map(|(s, _)| *s).collect::<Vec<_>>(),
                },
            });
            if let Some((from, steps)) = st.restored {
                row["restored"] = json!({"from": from, "steps": steps});
            }
            m.insert(format!("{}.{}", c.item, c.output), row);
        }
        Value::Object(m)
    }

    /// The stepped operators' work for the frame at `frame` (#252; canvas primitives: Carried
    /// state): the frame shows step ⌊t × rate⌋, so the carried state steps from the step it holds
    /// to that one, every stepped operator once a step in dependency order, each step reading the
    /// last through `prev`. A frame behind the state it holds (a seek back), or with a checkpoint
    /// nearer it than that state, restores the nearest checkpoint at or before it that every
    /// carried output holds, or else starts again from step 0. After each step a carried output
    /// takes a checkpoint on its ring's spacing, and the ring thins to its budget.
    fn steps(
        &mut self,
        device: &Device,
        frame: &Frame,
        params: &BTreeMap<String, Value>,
        roles: &BTreeMap<String, [f64; 3]>,
    ) -> Vec<Part> {
        let Some(mut st) = self.stepping.take() else {
            return Vec::new();
        };
        let d = &device.device;
        let rate = f64::from(st.rate);
        let t = self.clock.unwrap_or(f64::from(frame.t));
        // The step the frame shows; the small term keeps an exact quotient from flooring under.
        let target = if self.hooks.steps_per_frame {
            st.at.map_or(0, |a| a + 1)
        } else {
            (t * rate + 1e-6).floor().max(0.0) as u64
        };
        let mut parts = Vec::new();
        let current = |c: &Carried| self.storage[&(c.item.clone(), c.output.clone())].clone();
        st.restored = None;
        let behind = st.at.is_some_and(|a| target < a);
        let nearest = st.carried.first().and_then(|first| {
            first.ring.iter().rev().map(|(s, _)| *s).find(|s| {
                *s <= target && st.carried.iter().all(|c| c.ring.iter().any(|(x, _)| x == s))
            })
        });
        match nearest {
            Some(s) if behind || st.at.is_none_or(|a| s > a) => {
                for c in &st.carried {
                    let (_, b) = c.ring.iter().find(|(x, _)| *x == s).expect("held by every output");
                    parts.push(Part::StepCopy(b.clone(), current(c)));
                }
                st.at = Some(s);
                st.restored = Some((s, target - s));
            }
            _ if behind => {
                for c in &st.carried {
                    parts.push(Part::StepClear(current(c)));
                }
                st.at = None;
            }
            _ => {}
        }
        let order: Vec<usize> = (0..self.ops.len())
            .filter(|&k| self.ops[k].stepped && self.ops[k].failed.is_none() && self.ops[k].runner.is_some())
            .collect();
        let first = st.at.map_or(0, |a| a + 1);
        self.stepping = Some(st);
        for step in first..=target {
            // A long run of steps (a seek's, or a cold start's) goes to the GPU in submissions of
            // its own, a chunk at a time, before the frame's: one command buffer holding hundreds of
            // steps outlasts the GPU's limit for one. The frame records the last few.
            if target - step >= IN_FRAME && (step - first) % CHUNK == 0 && !parts.is_empty() {
                submit(device, std::mem::take(&mut parts));
            }
            let st = self.stepping.as_ref().expect("taken back above");
            for c in &st.carried {
                parts.push(Part::StepCopy(current(c), c.prev.clone()));
            }
            for &k in &order {
                let op = &self.ops[k];
                let runner = op.runner.clone().expect("built");
                let c = &runner.compiled.checked;
                // Storage it doesn't carry starts each step at its declared clear value.
                for (n, out) in c.op.storage.iter().filter(|(_, o)| o.carry.is_none()) {
                    let key = (op.item.clone(), n.clone());
                    parts.push(Part::StepClear(self.storage[&key].clone()));
                    if out.clear != 0 {
                        let words: Vec<u8> = std::iter::repeat_n(out.clear.to_le_bytes(), out.count.max(1) as usize).flatten().collect();
                        let from = d.create_buffer_init(&wgpu::util::BufferInitDescriptor {
                            label: Some("operator clear"),
                            contents: &words,
                            usage: wgpu::BufferUsages::COPY_SRC,
                        });
                        parts.push(Part::StepCopy(from, self.storage[&key].clone()));
                    }
                }
                let mut f = *frame;
                f.seed = item_seed(self.doc_seed, &op.item);
                f.t = (step as f64 / rate) as f32;
                let mut values = interp::inputs(c, params, roles);
                for (n, i) in &c.op.inputs {
                    if i.from == From::Step {
                        values.insert(n.clone(), Val::N(Sc::U32, vec![step as f64]));
                    }
                }
                let Some(ins) = c
                    .storage_inputs
                    .iter()
                    .map(|n| self.storage_in(&c.op.inputs[n].from))
                    .collect::<Option<Vec<wgpu::Buffer>>>()
                else {
                    continue;
                };
                let outs: Vec<wgpu::Buffer> = c
                    .op
                    .storage
                    .keys()
                    .map(|n| self.storage[&(op.item.clone(), n.clone())].clone())
                    .collect();
                let all: Vec<&wgpu::Buffer> = ins.iter().chain(&outs).collect();
                let (g0, g1, keep) = runner.bind_with(d, &f, [1, 1], &values, &[], &all, &[]);
                parts.push(Part::Dispatch(runner.clone(), (g0, g1), keep, c.op.elements));
            }
            let every_one = self.hooks.keeps_every_checkpoint;
            let mut taken = Vec::new();
            let st = self.stepping.as_mut().expect("taken back above");
            for c in &mut st.carried {
                let due = if every_one {
                    step % u64::from(c.carry.every) == 0
                } else {
                    step % c.spacing == 0 && c.bytes <= c.carry.budget
                };
                if !due || c.ring.iter().any(|(s, _)| *s == step) {
                    continue;
                }
                let b = d.create_buffer(&wgpu::BufferDescriptor {
                    label: Some("carried checkpoint"),
                    size: c.bytes,
                    usage: wgpu::BufferUsages::COPY_SRC | wgpu::BufferUsages::COPY_DST,
                    mapped_at_creation: false,
                });
                taken.push((c.item.clone(), c.output.clone(), b.clone()));
                let at = c.ring.partition_point(|(s, _)| *s < step);
                c.ring.insert(at, (step, b));
                if !every_one {
                    c.thin();
                }
            }
            for (item, output, b) in taken {
                parts.push(Part::StepCopy(self.storage[&(item, output)].clone(), b));
            }
        }
        if let Some(st) = self.stepping.as_mut() {
            st.at = Some(target.max(st.at.unwrap_or(0)));
        }
        parts
    }

    /// Plans the frame's operators over `color`, the frame's linear color at `size` (`ids` and
    /// `depth` its other targets): compute operators first, then each pass reading the color so
    /// far into a target of its own at its resolution, returned to full size when below it.
    /// `resolution(item)` gives each operator's resolution (0 for off); in a `canonical` render a
    /// live-only operator draws its fallback. Returns a row per operator, the recordings in order
    /// (bound now, recorded into the frame's encoder later), and the color the last pass writes,
    /// if one draws.
    #[allow(clippy::too_many_arguments)]
    pub fn plan(
        &mut self,
        device: &Device,
        color: &wgpu::TextureView,
        ids: Option<&wgpu::TextureView>,
        depth: Option<&wgpu::TextureView>,
        size: [u32; 2],
        frame: &Frame,
        roles: &BTreeMap<String, [f64; 3]>,
        resolution: &dyn Fn(&str) -> f64,
        canonical: bool,
    ) -> (Vec<Row>, Vec<Rec>, Option<wgpu::TextureView>) {
        let mut rows = Vec::new();
        let mut recs = Vec::new();
        let mut cur: Option<wgpu::TextureView> = None;
        let params = self.channel_values(frame.t);
        let mut passes: BTreeMap<String, wgpu::TextureView> = BTreeMap::new();
        let marker = self.hooks.marker;
        let clear = !self.hooks.no_clear;
        // Every stepped operator steps once, together, in the place of the first (#252).
        let mut steps = Some(self.steps(device, frame, &params, roles));
        for k in 0..self.ops.len() {
            let op = &self.ops[k];
            // A full-precision target is drawn at full size: its reader loads it texel for texel.
            let res = match resolution(&op.item) {
                r if op.format == LINEAR || r <= 0.0 => r,
                _ => 1.0,
            };
            let format = op.format;
            let mut drew = if op.failed.is_some() || (canonical && op.class == Class::LiveOnly) {
                Drew::Fallback
            } else if res <= 0.0 {
                Drew::Off
            } else {
                Drew::Operator
            };
            let item = op.item.clone();
            let op_members = op.members.clone();
            let kind = op.kind;
            let mark = op.mark;
            let runner = op.runner.clone();
            let structural = op.structural;
            let stepped = op.stepped;
            // The steps record whatever this frame draws: the carried state already counts them,
            // and a stepped operator's state never steps down (#252).
            if stepped {
                if let Some(parts) = steps.take().filter(|p| !p.is_empty()) {
                    recs.push(Rec { mark, parts });
                }
            } else if drew == Drew::Operator {
                let runner = runner.expect("built");
                let c = runner.compiled.checked.clone();
                let mut f = *frame;
                f.seed = item_seed(self.doc_seed, &item);
                let mut own_params = params.clone();
                if op_members.len() > 1 {
                    // A fused pass reads each member's params under its member's prefix.
                    for (j, (m, _)) in op_members.iter().enumerate() {
                        let p = deep_canvas_effects::fusion::prefix(j);
                        own_params.extend(self.params.get(m).into_iter().flatten().map(|(k, v)| (format!("{p}{k}"), v.clone())));
                    }
                } else {
                    own_params.extend(self.params.get(&item).into_iter().flatten().map(|(k, v)| (k.clone(), v.clone())));
                }
                let values = interp::inputs(&c, &own_params, roles);
                let storage: Option<Vec<wgpu::Buffer>> = c
                    .storage_inputs
                    .iter()
                    .map(|n| self.storage_in(&c.op.inputs[n].from))
                    .collect();
                let mut parts = Vec::new();
                match (kind, storage) {
                    (_, None) => drew = Drew::Fallback,
                    (Kind::Compute, Some(_)) if structural => match self.plan_of(device, &item, &c) {
                        Some((pre, plan)) => {
                            parts.push(Part::Clears(plan.clone()));
                            if let Some(pre) = pre {
                                parts.push(Part::Pre(pre));
                            }
                            if !self.hooks.compact_by_atomic || !c.op.steps.values().any(|s| s.op == "compact@1") {
                                parts.push(Part::Plan(plan));
                            }
                        }
                        None => drew = Drew::Fallback,
                    },
                    (Kind::Compute, Some(storage)) => {
                        let outs: Vec<wgpu::Buffer> = c
                            .op
                            .storage
                            .keys()
                            .map(|n| self.storage[&(item.clone(), n.clone())].clone())
                            .collect();
                        let kern = self.kernels(device);
                        // Every output starts the frame at its declared clear value, 0 (under the
                        // test hook, first filled with the pool's marker).
                        for b in &outs {
                            parts.push(Part::ClearBuffer(b.clone()));
                        }
                        for (n, s) in c.op.storage.iter().filter(|(_, s)| s.clear != 0) {
                            let key = (item.clone(), n.clone());
                            let words = vec![s.clear; s.count.max(1) as usize];
                            let bytes: Vec<u8> = words.iter().flat_map(|w| w.to_le_bytes()).collect();
                            let from = self.clears.entry(key.clone()).or_insert_with(|| {
                                device.device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
                                    label: Some("operator clear"),
                                    contents: &bytes,
                                    usage: wgpu::BufferUsages::COPY_SRC,
                                })
                            });
                            parts.push(Part::CopyBuffer(from.clone(), self.storage[&key].clone()));
                        }
                        let mut views = Vec::new();
                        let mut chains = Vec::new();
                        let names: Vec<String> = c.op.textures.keys().cloned().collect();
                        for n in &names {
                            let key = (item.clone(), n.clone());
                            let t = self.textures.get_mut(&key).expect("made");
                            if let Some(m) = marker {
                                parts.push(Part::Fill(Arc::new(kern.2.fill(&device.device, &t.tex, &t.out.format, m))));
                            }
                            if clear {
                                parts.push(Part::Fill(Arc::new(kern.2.fill(&device.device, &t.tex, &t.out.format, [0.0; 4]))));
                            }
                            views.push(t.tex.create_view(&wgpu::TextureViewDescriptor {
                                base_mip_level: 0,
                                mip_level_count: Some(1),
                                ..Default::default()
                            }));
                            if t.out.mips && !self.hooks.level0_only && !(self.hooks.old_key && t.made) {
                                let chain = t
                                    .chain
                                    .get_or_insert_with(|| Arc::new(kern.1.chain(&device.device, &t.tex)))
                                    .clone();
                                t.made = true;
                                chains.push(chain);
                            }
                        }
                        let all: Vec<&wgpu::Buffer> = storage.iter().chain(&outs).collect();
                        let tex_views: Vec<wgpu::TextureView> = c
                            .textures
                            .iter()
                            .map(|n| self.view_of(&c.op.inputs[n].from, color, ids, depth, &BTreeMap::new(), &passes))
                            .collect();
                        let trefs: Vec<&wgpu::TextureView> = tex_views.iter().collect();
                        let vrefs: Vec<&wgpu::TextureView> = views.iter().collect();
                        let (g0, g1, keep) =
                            runner.bind_with(&device.device, &f, [1, 1], &values, &trefs, &all, &vrefs);
                        // An indirect dispatch: the GPU writes its arguments from its count.
                        let count = c
                            .storage_inputs
                            .iter()
                            .position(|n| n == graph::DISPATCH_COUNT)
                            .and_then(|k| storage.get(k))
                            .filter(|_| c.op.counted && !self.hooks.dispatch_without_guard);
                        match count {
                            Some(count) => {
                                let d = &device.device;
                                let (plan, buffer) = self.counted.entry(item.clone()).or_insert_with(|| {
                                    let buffer = d.create_buffer(&wgpu::BufferDescriptor {
                                        label: Some("operator indirect dispatch"),
                                        size: 12,
                                        usage: wgpu::BufferUsages::STORAGE | wgpu::BufferUsages::INDIRECT,
                                        mapped_at_creation: false,
                                    });
                                    let plan = kern.0.dispatch_args(d, count, &buffer, c.op.workgroup, c.op.elements);
                                    (Arc::new(plan), buffer)
                                });
                                parts.push(Part::Plan(plan.clone()));
                                parts.push(Part::DispatchIndirect(runner.clone(), (g0, g1), keep, buffer.clone()));
                            }
                            None => parts.push(Part::Dispatch(runner.clone(), (g0, g1), keep, c.op.elements)),
                        }
                        parts.extend(chains.into_iter().map(Part::Mips));
                    }
                    (_, Some(storage)) => {
                        let src = cur.clone().unwrap_or_else(|| color.clone());
                        let own = [
                            ((f64::from(size[0]) * res).round() as u32).max(1),
                            ((f64::from(size[1]) * res).round() as u32).max(1),
                        ];
                        let srefs: Vec<&wgpu::Buffer> = storage.iter().collect();
                        // Each iterate step's runs over its two ping-pong targets (#483): run k
                        // reads the last run's output as `prev`, run 0 the target's clear value.
                        let mut iterated: BTreeMap<String, wgpu::TextureView> = BTreeMap::new();
                        let iters: Vec<(String, u32, String, f64, wgpu::TextureFormat, Arc<Runner>)> = self.ops[k]
                            .iterates
                            .iter()
                            .map(|it| (it.step.clone(), it.count, it.index.clone(), it.scale, it.format, it.runner.clone()))
                            .collect();
                        for (step, count, index, scale, format, body) in iters {
                            let isize = [
                                ((f64::from(size[0]) * scale).round() as u32).max(1),
                                ((f64::from(size[1]) * scale).round() as u32).max(1),
                            ];
                            let t: Vec<wgpu::TextureView> = (0..2)
                                .map(|j| self.target_of(device, format!("{item}:{step}:{j}"), isize, format))
                                .collect();
                            for v in &t {
                                if let Some(m) = marker {
                                    parts.push(Part::ClearTarget(v.clone(), m));
                                }
                                if clear {
                                    parts.push(Part::ClearTarget(v.clone(), [0.0; 4]));
                                }
                            }
                            let bc = &body.compiled.checked;
                            let mut last = 1usize;
                            for run in 0..count {
                                let (prev, into) = if self.hooks.feeds_first && run > 0 {
                                    (0usize, 1usize)
                                } else {
                                    (last, 1 - last)
                                };
                                let mut bv = interp::inputs(bc, &own_params, roles);
                                bv.insert(index.clone(), Val::N(Sc::U32, vec![f64::from(run)]));
                                let views: Vec<wgpu::TextureView> = bc
                                    .textures
                                    .iter()
                                    .map(|n| {
                                        if n == "prev" {
                                            t[prev].clone()
                                        } else {
                                            self.view_of(&bc.op.inputs[n].from, &src, ids, depth, &iterated, &passes)
                                        }
                                    })
                                    .collect();
                                let refs: Vec<&wgpu::TextureView> = views.iter().collect();
                                let (g0, g1, keep) = body.bind(&device.device, &f, isize, &bv, &refs, &[]);
                                parts.push(Part::Draw(body.clone(), (g0, g1), keep, t[into].clone(), None));
                                last = into;
                            }
                            iterated.insert(format!("{}.{step}", c.op.id), t[last].clone());
                        }
                        let views: Vec<wgpu::TextureView> = c
                            .textures
                            .iter()
                            .map(|n| self.view_of(&c.op.inputs[n].from, &src, ids, depth, &iterated, &passes))
                            .collect();
                        let refs: Vec<&wgpu::TextureView> = views.iter().collect();
                        // Each pass writes a target of its own, never the one it reads.
                        let key = format!("{item}:{k}");
                        let into = self.target_of(device, key.clone(), own, format);
                        self.drawn.insert(item.clone(), key);
                        let (g0, g1, keep) =
                            runner.bind(&device.device, &f, own, &values, &refs, &srefs);
                        let within = self.within.get(&item).map(|&r| {
                            let at = |v: u32, of: u32, to: u32| {
                                (f64::from(v) * f64::from(to) / f64::from(of)).ceil() as u32
                            };
                            let (x, y) = (r[0] * own[0] / size[0], r[1] * own[1] / size[1]);
                            let w = at(r[0] + r[2], size[0], own[0]).min(own[0]) - x;
                            [x, y, w, at(r[1] + r[3], size[1], own[1]).min(own[1]) - y]
                        });
                        parts.push(Part::Draw(runner.clone(), (g0, g1), keep, into.clone(), within));
                        let blit = (own != size).then(|| {
                            let full = self.target(device, format!("{item}:{k}:full"), size);
                            self.blit_rec(device, &into, full, size)
                        });
                        let shown = blit.as_ref().map_or_else(|| into.clone(), |b| b.to.clone());
                        passes.insert(item.clone(), shown.clone());
                        cur = Some(shown);
                        if let Some(b) = blit {
                            parts.push(Part::Blit(b));
                        }
                    }
                }
                if drew == Drew::Operator {
                    recs.push(Rec { mark, parts });
                }
            }
            for (m, _) in &op_members {
                rows.push(Row {
                    item: m.clone(),
                    resolution: if drew == Drew::Operator { res } else { 0.0 },
                    drew,
                });
            }
        }
        (rows, recs, cur)
    }
}

/// A blit bound, to record.
pub struct Blit {
    runner: Arc<Runner>,
    groups: (wgpu::BindGroup, wgpu::BindGroup),
    _keep: [wgpu::Buffer; 2],
    to: wgpu::TextureView,
}

impl Blit {
    fn record(&self, encoder: &mut wgpu::CommandEncoder) {
        self.runner.encode(encoder, &self.to, &self.groups, None);
    }
}

type Groups = (wgpu::BindGroup, wgpu::BindGroup);

/// One pass or clear of an operator's run; the uniform buffers a bind group reads are kept
/// beside it.
#[allow(dead_code)]
enum Part {
    ClearBuffer(wgpu::Buffer),
    ClearTarget(wgpu::TextureView, [f32; 4]),
    Clears(Arc<Plan>),
    Fill(Arc<Fill>),
    CopyBuffer(wgpu::Buffer, wgpu::Buffer),
    Dispatch(Arc<Runner>, Groups, [wgpu::Buffer; 2], u32),
    DispatchIndirect(Arc<Runner>, Groups, [wgpu::Buffer; 2], wgpu::Buffer),
    Draw(Arc<Runner>, Groups, [wgpu::Buffer; 2], wgpu::TextureView, Option<[u32; 4]>),
    Blit(Blit),
    Pre(Arc<Pre>),
    Plan(Arc<Plan>),
    Mips(Arc<Chain>),
    /// A copy or a clear among a stepped operator's dispatches, recorded in their order (#252).
    StepCopy(wgpu::Buffer, wgpu::Buffer),
    StepClear(wgpu::Buffer),
}

/// One operator's run, bound, to record into the frame's encoder: its clears, then its passes,
/// each timed under its mark.
pub struct Rec {
    pub mark: &'static str,
    parts: Vec<Part>,
}

impl Rec {
    /// Records what clears the run's outputs to their declared clear value (and, under the test
    /// hook, first to the pool's marker), before any pass of the frame: on Metal a pass's
    /// timestamps read 0 right after a clear.
    pub fn record_clears(&self, encoder: &mut wgpu::CommandEncoder) {
        for p in &self.parts {
            match p {
                Part::ClearBuffer(b) => encoder.clear_buffer(b, 0, None),
                Part::CopyBuffer(from, to) => {
                    encoder.copy_buffer_to_buffer(from, 0, to, 0, None);
                }
                Part::Clears(plan) => plan.clear(encoder),
                Part::Fill(f) => f.record(encoder),
                Part::ClearTarget(v, c) => {
                    let _ = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
                        label: Some("operator target clear"),
                        color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                            view: v,
                            resolve_target: None,
                            depth_slice: None,
                            ops: wgpu::Operations {
                                load: wgpu::LoadOp::Clear(wgpu::Color {
                                    r: f64::from(c[0]),
                                    g: f64::from(c[1]),
                                    b: f64::from(c[2]),
                                    a: f64::from(c[3]),
                                }),
                                store: wgpu::StoreOp::Store,
                            },
                        })],
                        ..Default::default()
                    });
                }
                _ => {}
            }
        }
    }

    /// Records the run's passes, each timed under its mark (with `stamps`, a query set and its
    /// next free index, each pass instead writes its own two queries there; returns how many it
    /// wrote).
    pub fn record_passes(
        &self,
        encoder: &mut wgpu::CommandEncoder,
        times: &mut dyn Times,
        stamps: Option<(&wgpu::QuerySet, u32)>,
    ) -> u32 {
        let mut used = 0u32;
        let pair = |used: u32| stamps.map(|(s, at)| (s, at + used));
        for p in &self.parts {
            match p {
                Part::Dispatch(r, g, _, n) => {
                    let i = times.start(self.mark, encoder);
                    let writes = match pair(used) {
                        Some((s, at)) => {
                            used += 2;
                            Some(wgpu::ComputePassTimestampWrites { query_set: s, beginning_of_pass_write_index: Some(at), end_of_pass_write_index: Some(at + 1) })
                        }
                        None => times.compute(i),
                    };
                    r.dispatch(encoder, *n, g, writes);
                    times.end(i, encoder);
                }
                Part::DispatchIndirect(r, g, _, args) => {
                    let i = times.start(self.mark, encoder);
                    let writes = match pair(used) {
                        Some((s, at)) => {
                            used += 2;
                            Some(wgpu::ComputePassTimestampWrites { query_set: s, beginning_of_pass_write_index: Some(at), end_of_pass_write_index: Some(at + 1) })
                        }
                        None => times.compute(i),
                    };
                    r.dispatch_indirect(encoder, args, g, writes);
                    times.end(i, encoder);
                }
                Part::Draw(r, g, _, into, within) => {
                    let i = times.start(self.mark, encoder);
                    let writes = match pair(used) {
                        Some((s, at)) => {
                            used += 2;
                            Some(wgpu::RenderPassTimestampWrites { query_set: s, beginning_of_pass_write_index: Some(at), end_of_pass_write_index: Some(at + 1) })
                        }
                        None => times.render(i),
                    };
                    r.encode_within(encoder, into, g, writes, *within);
                    times.end(i, encoder);
                }
                Part::Blit(b) => b.record(encoder),
                // A multi-dispatch step's passes are timed under its mark as one span.
                Part::Pre(pre) if stamps.is_none() => {
                    let i = times.start(self.mark, encoder);
                    pre.dispatch_spanned(encoder, times.compute(i));
                    times.end(i, encoder);
                }
                Part::Plan(plan) if stamps.is_none() => {
                    let i = times.start(self.mark, encoder);
                    plan.dispatch_spanned(encoder, times.compute(i));
                    times.end(i, encoder);
                }
                Part::Pre(pre) => {
                    pre.dispatch(encoder, pair(used));
                    used += pre.queries();
                }
                Part::Plan(plan) => {
                    plan.dispatch(encoder, pair(used));
                    used += plan.queries();
                }
                Part::Mips(c) => c.record(encoder),
                Part::StepCopy(from, to) => encoder.copy_buffer_to_buffer(from, 0, to, 0, None),
                Part::StepClear(b) => encoder.clear_buffer(b, 0, None),
                _ => {}
            }
        }
        used
    }

    /// The queries [`Rec::record_passes`] writes with stamps.
    pub fn queries(&self) -> u32 {
        self.parts
            .iter()
            .map(|p| match p {
                Part::Dispatch(..) | Part::DispatchIndirect(..) | Part::Draw(..) => 2,
                Part::Pre(pre) => pre.queries(),
                Part::Plan(plan) => plan.queries(),
                _ => 0,
            })
            .sum()
    }

    /// Records the run: its clears, then its passes, timed under its mark.
    pub fn record(&self, encoder: &mut wgpu::CommandEncoder, times: &mut dyn Times) {
        self.record_clears(encoder);
        self.record_passes(encoder, times, None);
    }
}

/// The item's seed: the hash of the document's seed and its ID (Operator input: `seed`).
pub fn item_seed(doc_seed: u64, id: &str) -> u32 {
    let mut h = interp::hash1(doc_seed as u32) ^ interp::hash1((doc_seed >> 32) as u32 ^ 0x9e37_79b9);
    for b in id.bytes() {
        h = interp::hash1(h ^ u32::from(b));
    }
    h
}

fn block<F: std::future::Future>(f: F) -> F::Output {
    let waker = std::task::Waker::noop();
    let mut cx = std::task::Context::from_waker(waker);
    let mut f = std::pin::pin!(f);
    loop {
        if let std::task::Poll::Ready(v) = f.as_mut().poll(&mut cx) {
            return v;
        }
        std::thread::yield_now();
    }
}

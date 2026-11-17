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

use crate::compile::{compile_planted, compile_with, Compiled};
use crate::mips::{Chain, Fill, Fills, Mips};
use crate::planted::Pre;
use crate::runner::{texture_format, Frame, Runner, LINEAR};
use crate::structural::{Plan, Structural};
use deep_scene3d_render::created::{key128, Created, Log};

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
        device: &deep_gpu::counted::Wgpu,
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
            feature_set: if items.len() > 1 {
                format!("fused {kind}")
            } else {
                kind.to_string()
            },
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
    op.fused
        .clone()
        .or_else(|| builds.get(&op.item).map(|b| b.1.clone()))
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
                    grew |=
                        items.is_some_and(|m| m.contains_key(op)) && early.insert(op.to_string());
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
            Some((
                g["order"].as_str().unwrap_or("a0").to_string(),
                id.clone(),
                g,
            ))
        })
        .collect();
    chain.sort_by(|a, b| (&a.0, &a.1).cmp(&(&b.0, &b.1)));
    let chain: Vec<(String, Value)> = chain.into_iter().map(|(_, id, g)| (id, g)).collect();
    deep_canvas_effects::fusion::runs(&chain, &BTreeSet::new())
        .into_iter()
        .filter(|run| run.len() > 1)
        .map(|run| {
            let names: Vec<&str> = run.iter().map(|&k| chain[k].0.as_str()).collect();
            let ns = run
                .iter()
                .map(|&k| chain[k].1["cost"]["ns_per_px"].as_f64().unwrap_or(0.0))
                .sum();
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
        .filter(|(_, item)| matches!(item["kind"].as_str(), Some("gpu.pass@1" | "gpu.compute@1")))
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
    let mut enc = device
        .device
        .create_command_encoder(&wgpu::CommandEncoderDescriptor {
            label: Some("stepped operators"),
        });
    Rec {
        mark: "op.steps",
        parts,
    }
    .record_passes(&mut enc, &mut Untimed, None);
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
            From::Storage {
                op,
                previous: false,
                ..
            }
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

mod methods;

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
    Draw(
        Arc<Runner>,
        Groups,
        [wgpu::Buffer; 2],
        wgpu::TextureView,
        Option<[u32; 4]>,
    ),
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
                            Some(wgpu::ComputePassTimestampWrites {
                                query_set: s,
                                beginning_of_pass_write_index: Some(at),
                                end_of_pass_write_index: Some(at + 1),
                            })
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
                            Some(wgpu::ComputePassTimestampWrites {
                                query_set: s,
                                beginning_of_pass_write_index: Some(at),
                                end_of_pass_write_index: Some(at + 1),
                            })
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
                            Some(wgpu::RenderPassTimestampWrites {
                                query_set: s,
                                beginning_of_pass_write_index: Some(at),
                                end_of_pass_write_index: Some(at + 1),
                            })
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
    let mut h =
        interp::hash1(doc_seed as u32) ^ interp::hash1((doc_seed >> 32) as u32 ^ 0x9e37_79b9);
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

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

/// One operator item of the document, compiled once.
pub struct Op {
    pub item: String,
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
            From::Storage { op, .. } | From::Texture3d { op, .. } | From::Target { op, .. }
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
        let mut out = DocOps::empty();
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
            let mut op = Op {
                item: id.clone(),
                kind: c.op.kind,
                class: c.class,
                fallback: c.op.fallback,
                declared_ns: c.op.cost.unwrap_or(c.estimate),
                order: c.op.order.clone(),
                runner: None,
                failed: None,
                mark: mark_of(id),
                iterates: Vec::new(),
                structural,
            };
            let mut built = compiled.clone();
            if fail.contains(id) {
                // The hook: the device gets a module it rejects, after the check passed.
                built.wgsl.push_str("\nfn rejected_by_the_device( {\n");
            }
            let d = &device.device;
            let scope = d.push_error_scope(wgpu::ErrorFilter::Validation);
            let runner = Runner::new(d, built, LINEAR);
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
                    runner: Arc::new(Runner::new(d, body, format)),
                });
            }
            match block(scope.pop()) {
                Some(e) => op.failed = Some(e.to_string()),
                None => op.runner = Some(Arc::new(runner)),
            }
            if op.kind == Kind::Compute {
                for (name, s) in &c.op.storage {
                    let buf = d.create_buffer(&wgpu::BufferDescriptor {
                        label: Some("operator storage"),
                        size: u64::from(s.count.max(1)) * 4,
                        usage: wgpu::BufferUsages::STORAGE
                            | wgpu::BufferUsages::COPY_SRC
                            | wgpu::BufferUsages::COPY_DST,
                        mapped_at_creation: false,
                    });
                    out.storage.insert((id.clone(), name.clone()), buf);
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
        out
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
                From::Storage { op, output } => self.storage.get(&(op.clone(), output.clone())).cloned(),
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
        for k in 0..self.ops.len() {
            let op = &self.ops[k];
            let res = resolution(&op.item);
            let mut drew = if op.failed.is_some() || (canonical && op.class == Class::LiveOnly) {
                Drew::Fallback
            } else if res <= 0.0 {
                Drew::Off
            } else {
                Drew::Operator
            };
            let item = op.item.clone();
            let kind = op.kind;
            let mark = op.mark;
            let runner = op.runner.clone();
            let structural = op.structural;
            if drew == Drew::Operator {
                let runner = runner.expect("built");
                let c = runner.compiled.checked.clone();
                let mut f = *frame;
                f.seed = item_seed(self.doc_seed, &item);
                let mut own_params = params.clone();
                own_params.extend(self.params.get(&item).into_iter().flatten().map(|(k, v)| (k.clone(), v.clone())));
                let values = interp::inputs(&c, &own_params, roles);
                let storage: Option<Vec<wgpu::Buffer>> = c
                    .storage_inputs
                    .iter()
                    .map(|n| match &c.op.inputs[n].from {
                        From::Storage { op, output } => {
                            self.storage.get(&(op.clone(), output.clone())).cloned()
                        }
                        _ => None,
                    })
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
                        let into = self.target(device, key.clone(), own);
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
            rows.push(Row {
                item,
                resolution: if drew == Drew::Operator { res } else { 0.0 },
                drew,
            });
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

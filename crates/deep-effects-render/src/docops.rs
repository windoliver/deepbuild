//! A document's composed operators in the frame (canvas primitives: GPU operators, as data: Place
//! in the frame; Determinism class; issue #429): its `gpu.compute@1` items dispatched first, each
//! writing its storage, then its `gpu.pass@1` items in their chain's order over the frame's
//! linear color, each at the resolution its writer's meter gives it. A live-only operator draws
//! its fallback (nothing) in every canonical render; one whose pipeline the device rejected draws
//! its fallback everywhere. Material operators are the 3D renderer's (`material@1`'s `op`).

use std::collections::BTreeMap;
use std::sync::Arc;

use deep_canvas_effects::check::CheckOptions;
use deep_canvas_effects::emit::Options;
use deep_canvas_effects::graph::{Class, Fallback, From, Kind};
use deep_canvas_effects::interp;
use deep_canvas_effects::module::operator_of;
use deep_gpu::device::Device;
use serde_json::{json, Value};

use crate::compile::{compile_planted, compile_with};
use crate::runner::{Frame, Runner, LINEAR};

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

/// A document's operators.
pub struct DocOps {
    pub ops: Vec<Op>,
    /// Each compute operator's storage outputs, by (item, output).
    storage: BTreeMap<(String, String), wgpu::Buffer>,
    /// Each pass operator's own target, with its size.
    targets: BTreeMap<String, ([u32; 2], wgpu::Texture)>,
    blit: Option<Arc<Runner>>,
    doc_seed: u64,
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

impl DocOps {
    pub fn empty() -> DocOps {
        DocOps {
            ops: Vec::new(),
            storage: BTreeMap::new(),
            targets: BTreeMap::new(),
            blit: None,
            doc_seed: 0,
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
        let mut out = DocOps::empty();
        out.doc_seed = doc["seed"].as_u64().unwrap_or(0);
        let mut items: Vec<(&String, &Value)> = doc["items"]
            .as_object()
            .into_iter()
            .flatten()
            .collect();
        items.sort_by(|a, b| a.0.cmp(b.0));
        for (id, item) in items {
            let Some(json) = operator_of(id, item) else {
                continue;
            };
            let Ok(compiled) = compile_planted(&json, &BTreeMap::new(), options, planted) else {
                continue;
            };
            let c = &compiled.checked;
            if c.op.kind == Kind::Material {
                continue;
            }
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
            };
            let mut built = compiled.clone();
            if fail.contains(id) {
                // The hook: the device gets a module it rejects, after the check passed.
                built.wgsl.push_str("\nfn rejected_by_the_device( {\n");
            }
            let d = &device.device;
            let scope = d.push_error_scope(wgpu::ErrorFilter::Validation);
            let runner = Runner::new(d, built, LINEAR);
            match block(scope.pop()) {
                Some(e) => op.failed = Some(e.to_string()),
                None => op.runner = Some(Arc::new(runner)),
            }
            if op.kind == Kind::Compute {
                for (name, s) in &c.op.storage {
                    let buf = d.create_buffer(&wgpu::BufferDescriptor {
                        label: Some("operator storage"),
                        size: u64::from(s.count.max(1)) * 4,
                        usage: wgpu::BufferUsages::STORAGE | wgpu::BufferUsages::COPY_SRC,
                        mapped_at_creation: false,
                    });
                    out.storage.insert((id.clone(), name.clone()), buf);
                }
            }
            out.ops.push(op);
        }
        // Compute first, by ID; then passes by their order key, then ID.
        out.ops.sort_by(|a, b| {
            (a.kind != Kind::Compute, &a.order, &a.item).cmp(&(
                b.kind != Kind::Compute,
                &b.order,
                &b.item,
            ))
        });
        out
    }

    /// The issues of operators whose pipelines the device rejected.
    pub fn issues(&self) -> Vec<Value> {
        self.ops.iter().filter_map(compile_issue).collect()
    }

    fn texture(device: &Device, label: &str, size: [u32; 2]) -> wgpu::Texture {
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
            format: LINEAR,
            usage: wgpu::TextureUsages::RENDER_ATTACHMENT | wgpu::TextureUsages::TEXTURE_BINDING,
            view_formats: &[],
        })
    }

    /// A target of `size` the operators keep under `key`, made again when the size changes.
    fn target(&mut self, device: &Device, key: String, size: [u32; 2]) -> wgpu::TextureView {
        if self.targets.get(&key).is_none_or(|t| t.0 != size) {
            let t = Self::texture(device, "operator target", size);
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
            if drew == Drew::Operator {
                let runner = runner.expect("built");
                let c = &runner.compiled.checked;
                let mut f = *frame;
                f.seed = item_seed(self.doc_seed, &item);
                let values = interp::inputs(c, &BTreeMap::new(), roles);
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
                match (kind, storage) {
                    (_, None) => drew = Drew::Fallback,
                    (Kind::Compute, Some(storage)) => {
                        let outs: Vec<wgpu::Buffer> = c
                            .op
                            .storage
                            .keys()
                            .map(|n| self.storage[&(item.clone(), n.clone())].clone())
                            .collect();
                        let all: Vec<&wgpu::Buffer> = storage.iter().chain(&outs).collect();
                        let (g0, g1, keep) =
                            runner.bind(&device.device, &f, [1, 1], &values, &[], &all);
                        let elements = c.op.elements;
                        recs.push(Rec {
                            mark,
                            runner: runner.clone(),
                            groups: (g0, g1),
                            _keep: keep,
                            what: What::Dispatch(elements),
                        });
                    }
                    (_, Some(storage)) => {
                        let src = cur.clone().unwrap_or_else(|| color.clone());
                        let views: Vec<wgpu::TextureView> = c
                            .textures
                            .iter()
                            .map(|n| match &c.op.inputs[n].from {
                                From::Target { output, .. } if output == "object_id" => {
                                    ids.cloned()
                                }
                                From::Target { output, .. } if output == "depth" => {
                                    depth.cloned()
                                }
                                _ => None,
                            })
                            .map(|v| v.unwrap_or_else(|| src.clone()))
                            .collect();
                        let refs: Vec<&wgpu::TextureView> = views.iter().collect();
                        let srefs: Vec<&wgpu::Buffer> = storage.iter().collect();
                        let own = [
                            ((f64::from(size[0]) * res).round() as u32).max(1),
                            ((f64::from(size[1]) * res).round() as u32).max(1),
                        ];
                        // Each pass writes a target of its own, never the one it reads.
                        let into = self.target(device, format!("{item}:{k}"), own);
                        let (g0, g1, keep) =
                            runner.bind(&device.device, &f, own, &values, &refs, &srefs);
                        let blit = (own != size).then(|| {
                            let full = self.target(device, format!("{item}:{k}:full"), size);
                            self.blit_rec(device, &into, full, size)
                        });
                        cur = Some(blit.as_ref().map_or_else(|| into.clone(), |b| b.to.clone()));
                        recs.push(Rec {
                            mark,
                            runner: runner.clone(),
                            groups: (g0, g1),
                            _keep: keep,
                            what: What::Draw(into, blit),
                        });
                    }
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

enum What {
    Dispatch(u32),
    Draw(wgpu::TextureView, Option<Blit>),
}

/// One operator's run, bound, to record into the frame's encoder.
pub struct Rec {
    pub mark: &'static str,
    runner: Arc<Runner>,
    groups: (wgpu::BindGroup, wgpu::BindGroup),
    _keep: [wgpu::Buffer; 2],
    what: What,
}

impl Rec {
    /// Records the run, timed under its mark.
    pub fn record(&self, encoder: &mut wgpu::CommandEncoder, times: &mut dyn Times) {
        let i = times.start(self.mark, encoder);
        match &self.what {
            What::Dispatch(n) => {
                let elements = *n;
                self.runner
                    .dispatch(encoder, elements, &self.groups, times.compute(i));
            }
            What::Draw(into, _) => self.runner.encode(encoder, into, &self.groups, times.render(i)),
        }
        times.end(i, encoder);
        if let What::Draw(_, Some(b)) = &self.what {
            b.record(encoder);
        }
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

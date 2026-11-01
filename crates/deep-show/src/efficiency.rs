//! The efficiency bar's two hub-side readings (#854): a patch's arrival to the settled frame it
//! causes, and deep_query's summary and paged read of a document. The perf lane
//! (`benchmarks/canvas.mjs`) drives both on a release build.
//!
//! `settle` sends each patch through the shared document's one patch path, has the document's
//! session take the revision it makes, runs the session's frame and presents the frame's marks
//! in a headless window through GPUI's Metal renderer: the process's CPU from the patch's arrival
//! to that frame, the GPU time of the frame's command buffers, and the nodes it ran by operator.
//!
//! `deep_query` answers what an agent reads back: a summary of the current revision, sized for an
//! agent's context, or one page of its items in document order, with a cursor to the next.

use std::collections::BTreeMap;
use std::time::Instant;

use deep_canvas_marks::modules::Drawing;
use serde_json::{json, Map, Value};

use crate::hub::{Body, Hub, PatchCall, Planted, Via};

/// One `settle` call: patches for a shared document, each sent as `via`.
pub struct Settle {
    pub via: Via,
    pub doc: String,
    pub patches: Vec<Value>,
}

/// One `deep_query` call: the summary, or a page of `limit` rows after `cursor`.
pub struct Query {
    pub doc: String,
    pub page: Option<(usize, Option<String>)>,
}

/// The rows a page holds at most.
pub const PAGE_MAX: usize = 1_000;

/// This process's CPU time, every thread's, in ns: a frame's nodes run on the pool too.
fn process_cpu_ns() -> u64 {
    let mut t = libc::timespec {
        tv_sec: 0,
        tv_nsec: 0,
    };
    // SAFETY: `t` is a valid timespec for the call to fill.
    unsafe { libc::clock_gettime(libc::CLOCK_PROCESS_CPUTIME_ID, &mut t) };
    t.tv_sec as u64 * 1_000_000_000 + t.tv_nsec as u64
}

impl Hub<'_> {
    pub fn settle_patches(&mut self, s: &Settle) -> Value {
        // The scheduler's thread runs a live view's frames (#857: Priority::Frame).
        crate::workers::set_priority(crate::workers::Priority::Frame);
        let refused =
            |code: &str, what: String| json!({"outcome": "refused", "code": code, "what": what});
        if !self.shared.contains_key(&s.doc) {
            return refused("ref_unresolved", format!("no shared document {}", s.doc));
        }
        let Some(size) = self.shared[&s.doc].doc["size"]
            .as_array()
            .and_then(|a| Some([a.first()?.as_f64()?, a.get(1)?.as_f64()?]))
        else {
            return refused("bad_input", "the document has no size".into());
        };
        let repaints = self.scenario.planted == Some(Planted::RepaintsEveryMark);
        let mut painter = match gpu::Painter::open(size, repaints) {
            Ok(p) => p,
            Err(why) => return refused("no_window", why),
        };
        if !self.sessions.contains_key(&s.doc) {
            let fresh = self.new_session();
            self.sessions.insert(s.doc.clone(), fresh);
        }
        // The board as shown before the first patch: its first frame, uncounted.
        let view = crate::frames::session_view(&self.sessions[&s.doc], &Map::new());
        {
            let session = self.sessions.get_mut(&s.doc).expect("made above");
            session.load(&mut self.sched, &self.shared[&s.doc].doc);
            session.frame(&mut self.sched, 0, &view);
        }
        if let Err(why) = self.present_frame(&s.doc, &mut painter) {
            return refused("unfit", why);
        }
        painter.wait();
        let reloads = self.scenario.planted == Some(Planted::ReloadsRevision);
        let mut samples = Vec::with_capacity(s.patches.len());
        for (k, patch) in s.patches.iter().enumerate() {
            let arrived = process_cpu_ns();
            let call = PatchCall {
                via: s.via.clone(),
                doc: s.doc.clone(),
                body: Body::Patch(patch.clone()),
            };
            let reply = self.patch(&call, None, self.now);
            if reply["outcome"] != "applied" {
                return json!({"outcome": "refused", "code": "not_applied", "patch": k + 1, "reply": reply});
            }
            let patched = process_cpu_ns();
            // The session takes the revision: only the items the patch touched, when that is all
            // it changed, else the whole document; the planted session always the whole.
            let ids: Vec<&str> = patch["ops"]
                .as_array()
                .into_iter()
                .flatten()
                .filter_map(|op| op["id"].as_str())
                .collect();
            let session = self.sessions.get_mut(&s.doc).expect("made above");
            let doc = &self.shared[&s.doc].doc;
            if reloads || session.revise_items(&mut self.sched, doc, &ids).is_none() {
                session.load(&mut self.sched, doc);
            }
            let revised = process_cpu_ns();
            session.frame(&mut self.sched, 0, &view);
            let framed = process_cpu_ns();
            if let Err(why) = self.present_frame(&s.doc, &mut painter) {
                return refused("unfit", why);
            }
            // The frame is handed to the GPU; waiting for it isn't the CPU's work.
            let presented = process_cpu_ns();
            let gpu_ms = painter.wait() as f64 / 1e6;
            let ms = |from: u64, to: u64| (to - from) as f64 / 1e6;
            let cpu_ms = ms(arrived, presented);
            let session = &self.sessions[&s.doc];
            let ran = session.ran_by_operator(&self.sched);
            let item = patch["ops"][0]["id"].clone();
            samples.push(
                json!({"patch": k + 1, "item": item, "frame": painter.presented,
                "cpu_ms": cpu_ms, "gpu_ms": gpu_ms, "ms": cpu_ms + gpu_ms, "ran": ran,
                "stages": {"patch": ms(arrived, patched), "session": ms(patched, revised),
                           "frame": ms(revised, framed), "present": ms(framed, presented),
                           "gpu": gpu_ms},
                "uploaded_bytes": painter.uploaded, "marks": self.marks_built(&s.doc)}),
            );
        }
        json!({"outcome": "settled", "samples": samples})
    }

    /// The marks each operator built for the session's last frame, by its key: each item's own
    /// marks and the draw list's (#896).
    fn marks_built(&self, doc: &str) -> Map<String, Value> {
        let session = &self.sessions[doc];
        let mut out = Map::new();
        let items: usize = session
            .ran_values(&self.sched, "marks2d.item")
            .iter()
            .filter_map(|(_, v)| v.as_typed::<Option<deep_canvas_marks::scene::Placed>>())
            .map(|p| p.as_ref().as_ref().map_or(0, |p| p.drawn.len()))
            .sum();
        if items > 0 {
            out.insert("marks2d.item".into(), json!(items));
        }
        let list = session.ran_values(&self.sched, "marks2d.frame");
        if let Some(d) = list.first().and_then(|(_, v)| v.as_typed::<Drawing>()) {
            out.insert("marks2d.frame".into(), json!(d.built));
        }
        out
    }

    /// The session's frame presented.
    fn present_frame(&self, doc: &str, painter: &mut gpu::Painter) -> Result<(), String> {
        let painted = crate::frames::drawing_of(&self.sched, &self.sessions[doc])
            .ok_or_else(|| "the frame drew nothing".to_string())?;
        let drawing = painted
            .drawing
            .ok_or_else(|| "the frame has no 2D drawing".to_string())?;
        painter.present(&drawing)
    }

    pub fn query(&mut self, q: &Query) -> Value {
        let started = Instant::now();
        let doc = match self.shared.get(&q.doc) {
            Some(shared) => &shared.doc,
            None => match self.current(&q.doc) {
                Some(row) => &row.doc,
                None => return json!({"outcome": "refused", "code": "ref_unresolved"}),
            },
        };
        let empty = Map::new();
        let items = doc["items"].as_object().unwrap_or(&empty);
        let result = match &q.page {
            None => summary(&q.doc, doc, items),
            Some((limit, cursor)) => {
                let from = match cursor {
                    None => 0,
                    Some(c) => match c.strip_prefix('i').and_then(|n| n.parse::<usize>().ok()) {
                        Some(n) if n <= items.len() => n,
                        _ => return json!({"outcome": "refused", "code": "bad_cursor"}),
                    },
                };
                // The planted query answers every row, unpaged.
                let (from, to) = if self.scenario.planted == Some(Planted::Unpaged) {
                    (0, items.len())
                } else {
                    (from, (from + (*limit).min(PAGE_MAX)).min(items.len()))
                };
                let rows: Vec<Value> = items.values().skip(from).take(to - from).map(row).collect();
                let next = (to < items.len()).then(|| format!("i{to}"));
                json!({"doc": q.doc, "rows": rows, "next": next})
            }
        };
        // What the agent is sent is the reply's text, made inside the time.
        std::hint::black_box(result.to_string());
        let ms = started.elapsed().as_secs_f64() * 1000.0;
        json!({"outcome": "answered", "ms": ms, "result": result})
    }
}

/// An item as a row: its ID, kind, name, layer, order and where it is.
fn row(item: &Value) -> Value {
    let mut r = Map::new();
    for key in ["id", "kind", "name", "layer", "order"] {
        if let Some(v) = item.get(key) {
            r.insert(key.into(), v.clone());
        }
    }
    if let Some(pos) = item.pointer("/at/pos") {
        r.insert("pos".into(), pos.clone());
    }
    if let Some(b) = item.pointer("/params/box") {
        r.insert("box".into(), b.clone());
    }
    Value::Object(r)
}

/// The summary: what the document is, how many items of each kind and layer it holds, the
/// extent of their positions, and how to page its rows.
fn summary(id: &str, doc: &Value, items: &Map<String, Value>) -> Value {
    let mut kinds: BTreeMap<&str, usize> = BTreeMap::new();
    let mut layers: BTreeMap<&str, usize> = BTreeMap::new();
    let mut extent: Option<[f64; 4]> = None;
    for item in items.values() {
        *kinds
            .entry(item["kind"].as_str().unwrap_or(""))
            .or_default() += 1;
        *layers
            .entry(item["layer"].as_str().unwrap_or(""))
            .or_default() += 1;
        if let (Some(x), Some(y)) = (
            item.pointer("/at/pos/0").and_then(Value::as_f64),
            item.pointer("/at/pos/1").and_then(Value::as_f64),
        ) {
            let e = extent.get_or_insert([x, y, x, y]);
            *e = [e[0].min(x), e[1].min(y), e[2].max(x), e[3].max(y)];
        }
    }
    let layers: Vec<Value> = layers
        .into_iter()
        .map(|(layer, n)| {
            let writer = doc.pointer(&format!("/layers/{layer}/writer")).cloned();
            json!({"layer": layer, "writer": writer, "items": n})
        })
        .collect();
    json!({
        "doc": id, "title": doc["title"], "profile": doc["profile"], "size": doc["size"],
        "items": items.len(), "kinds": kinds, "layers": layers, "extent": extent,
        "pages": items.len().div_ceil(PAGE_MAX), "page_rows": PAGE_MAX,
    })
}

/// The 2D view in a headless window (#896): the frame's marks drawn by one instanced pass into a
/// GPU surface GPUI composites, from instances kept on the GPU between frames. A frame uploads
/// only the instances of the marks its drawing replaced, 32 B each, and redraws only the rect
/// they covered and cover, from the GPU's copy of every mark there; the surface keeps the rest
/// (Invalidation and damage: "upload 32 to 64 B per dirty item"). A layer it can't match to what
/// the GPU holds uploads whole and the frame draws every mark.
#[cfg(target_os = "macos")]
mod gpu {
    use std::collections::HashMap;
    use std::sync::Arc;
    use std::time::{Duration, Instant};

    use deep_canvas_marks::key::ContentKey;
    use deep_canvas_marks::modules::Drawing;
    use deep_canvas_marks::scene::{Drawn, Fill, Mark, Rgb};
    use deep_gpu::device::{Backend, Device, Gpu};
    use deep_gpu::surface::{self, Handoff, Path, Shown, FORMAT};
    use gpui_apple::metal_renderer::gpu_ledger;
    use gpui_kit::*;

    /// One mark's instance: its rect in px, its corner radius, its sRGB color and padding to 32 B.
    const INSTANCE: u64 = 32;

    const SHADER: &str = r#"
struct View { size: vec2<f32> };
@group(0) @binding(0) var<uniform> view: View;
struct Out {
    @builtin(position) pos: vec4<f32>,
    @location(0) local: vec2<f32>,
    @location(1) half: vec2<f32>,
    @location(2) radius: f32,
    @location(3) color: vec4<f32>,
};
@vertex fn vs(@builtin(vertex_index) v: u32, @location(0) rect: vec4<f32>,
              @location(1) radius: f32, @location(2) color: vec4<f32>) -> Out {
    let corner = vec2<f32>(f32(v & 1u), f32(v >> 1u));
    let p = rect.xy + corner * rect.zw;
    var out: Out;
    out.pos = vec4<f32>(p.x / view.size.x * 2.0 - 1.0, 1.0 - p.y / view.size.y * 2.0, 0.0, 1.0);
    out.local = (corner - vec2<f32>(0.5)) * rect.zw;
    out.half = rect.zw * 0.5;
    out.radius = radius;
    out.color = color;
    return out;
}
@fragment fn fs(in: Out) -> @location(0) vec4<f32> {
    let r = min(in.radius, min(in.half.x, in.half.y));
    let q = abs(in.local) - in.half + vec2<f32>(r);
    let d = length(max(q, vec2<f32>(0.0))) + min(max(q.x, q.y), 0.0) - r;
    let a = clamp(0.5 - d, 0.0, 1.0);
    return vec4<f32>(in.color.rgb * a, a);
}
"#;

    /// A mark's instance, and the rect its pixels can reach: its bounds and a pixel of edge.
    fn instance(drawn: &Drawn) -> Result<([u8; INSTANCE as usize], Rect), String> {
        let (bounds, radius, color) = match &drawn.mark {
            Mark::Rect {
                bounds,
                radius,
                fill: Fill::Solid(c),
                ..
            } => (*bounds, *radius, *c),
            Mark::Circle {
                center, r, color, ..
            } => ([center[0] - r, center[1] - r, 2. * r, 2. * r], *r, *color),
            other => {
                return Err(format!(
                    "the bench view draws solid rects and circles, not {}",
                    other.item()
                ))
            }
        };
        Ok((encoded(bounds, radius, color), reach(bounds)))
    }

    fn encoded(bounds: [f64; 4], radius: f64, color: Rgb) -> [u8; INSTANCE as usize] {
        let mut out = [0u8; INSTANCE as usize];
        for (k, v) in bounds.iter().chain([&radius]).enumerate() {
            out[4 * k..4 * k + 4].copy_from_slice(&(*v as f32).to_le_bytes());
        }
        out[20..23].copy_from_slice(&color);
        out[23] = 255;
        out
    }

    /// `[x0, y0, x1, y1]` in px.
    type Rect = [f64; 4];

    fn reach(b: [f64; 4]) -> Rect {
        [b[0] - 1., b[1] - 1., b[0] + b[2] + 1., b[1] + b[3] + 1.]
    }

    fn meets(a: &Rect, b: &Rect) -> bool {
        a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3]
    }

    /// The side of a cell of the index that finds the marks a rect meets.
    const CELL: f64 = 32.;

    fn cells(r: &Rect) -> impl Iterator<Item = (i32, i32)> {
        let c = |v: f64| (v / CELL).floor() as i32;
        let (x0, y0, x1, y1) = (c(r[0]), c(r[1]), c(r[2]), c(r[3]));
        (y0..=y1).flat_map(move |y| (x0..=x1).map(move |x| (x, y)))
    }

    /// What a frame draws: every mark, or in each rect a replaced mark covered or covers, the
    /// ground and the marks meeting it in draw order.
    enum Redraw {
        All,
        Within(Vec<(Rect, Vec<u32>)>),
    }

    fn unit(c: Rgb) -> [f64; 3] {
        c.map(|v| f64::from(v) / 255.)
    }

    struct Canvas {
        shown: Shown,
    }

    impl Render for Canvas {
        fn render(&mut self, _: &mut Window, _: &mut Context<Self>) -> impl IntoElement {
            let shown = self.shown.clone();
            div().size_full().child(
                canvas(
                    |_, _, _| {},
                    move |bounds, _, window, _| window.paint_surface(bounds, shown.clone()),
                )
                .size_full(),
            )
        }
    }

    /// The 2D view: its instances on the GPU and the surface it draws them into.
    pub struct View2d {
        _gpu: Arc<Gpu>,
        device: Arc<Device>,
        target: Box<dyn Handoff>,
        pipeline: wgpu::RenderPipeline,
        bind: wgpu::BindGroup,
        instances: Option<wgpu::Buffer>,
        /// Each layer's key and mark count as the GPU holds them, in draw order, and the ground.
        held: Vec<(ContentKey, usize)>,
        ground: Rgb,
        /// Each instance's reach, and the instances whose reach meets each cell.
        reaches: Vec<Rect>,
        index: HashMap<(i32, i32), Vec<u32>>,
        size: [f64; 2],
        times: Option<(wgpu::QuerySet, wgpu::Buffer, wgpu::Buffer, f32)>,
        /// The planted view: every mark uploaded each frame.
        repaints: bool,
        /// The bytes the last frame uploaded.
        pub uploaded: u64,
        /// The GPU time of the last frame's pass.
        pass_ns: u64,
    }

    /// The bench window: the 2D view's surface, composited by GPUI.
    pub struct Painter {
        cx: HeadlessAppContext,
        handle: AnyWindowHandle,
        view: View2d,
        /// Frames presented so far.
        pub presented: u64,
        /// The bytes the last frame uploaded.
        pub uploaded: u64,
        /// The ledger's GPU time before GPUI's frame.
        before: u64,
    }

    impl Painter {
        pub fn open(at: [f64; 2], repaints: bool) -> Result<Painter, String> {
            let view = View2d::open(at, repaints)?;
            let mut cx = deep_replica::headless_context();
            let canvas = Canvas {
                shown: view.target.shown(),
            };
            let (handle, _) = cx
                .update(|cx| {
                    open_window(
                        WindowOptions {
                            window_bounds: Some(WindowBounds::Windowed(Bounds {
                                origin: Point::default(),
                                size: size(px(at[0] as f32), px(at[1] as f32)),
                            })),
                            focus: false,
                            show: false,
                            ..Default::default()
                        },
                        cx,
                        |_, cx| cx.new(|_| canvas),
                    )
                })
                .map_err(|e| e.to_string())?;
            cx.simulate_scale_factor_change(handle, 1.);
            Ok(Painter {
                cx,
                handle,
                view,
                presented: 0,
                uploaded: 0,
                before: 0,
            })
        }

        /// Draws the frame into the view's surface and has GPUI composite it: the frame handed
        /// to the GPU.
        pub fn present(&mut self, drawing: &Drawing) -> Result<(), String> {
            self.view.draw(drawing)?;
            self.uploaded = self.view.uploaded;
            self.before = settled().gpu_ns;
            self.cx.present_frame(self.handle);
            self.presented += 1;
            Ok(())
        }

        /// Waits for GPUI's frame: the frame's GPU time, the view's pass and GPUI's, in ns.
        pub fn wait(&mut self) -> u64 {
            self.view.pass_ns + (settled().gpu_ns - self.before)
        }
    }

    impl View2d {
        pub fn open(at: [f64; 2], repaints: bool) -> Result<View2d, String> {
            let gpu = Gpu::open(Backend::Gpu)?;
            let device = gpu.device();
            let target = surface::allocate(&device, Path::ZeroCopy, [at[0] as u32, at[1] as u32])?;
            let d = &device.device;
            let module = d.create_shader_module(wgpu::ShaderModuleDescriptor {
                label: Some("bench marks"),
                source: wgpu::ShaderSource::Wgsl(SHADER.into()),
            });
            let layout = d.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
                label: Some("bench view"),
                entries: &[wgpu::BindGroupLayoutEntry {
                    binding: 0,
                    visibility: wgpu::ShaderStages::VERTEX,
                    ty: wgpu::BindingType::Buffer {
                        ty: wgpu::BufferBindingType::Uniform,
                        has_dynamic_offset: false,
                        min_binding_size: None,
                    },
                    count: None,
                }],
            });
            let uniform = d.create_buffer(&wgpu::BufferDescriptor {
                label: Some("bench view size"),
                size: 16,
                usage: wgpu::BufferUsages::UNIFORM | wgpu::BufferUsages::COPY_DST,
                mapped_at_creation: false,
            });
            let mut bytes = [0u8; 16];
            bytes[..4].copy_from_slice(&(at[0] as f32).to_le_bytes());
            bytes[4..8].copy_from_slice(&(at[1] as f32).to_le_bytes());
            device.queue.write_buffer(&uniform, 0, &bytes);
            let bind = d.create_bind_group(&wgpu::BindGroupDescriptor {
                label: Some("bench view"),
                layout: &layout,
                entries: &[wgpu::BindGroupEntry {
                    binding: 0,
                    resource: uniform.as_entire_binding(),
                }],
            });
            let pipeline_layout = d.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
                label: Some("bench marks"),
                bind_group_layouts: &[Some(&layout)],
                immediate_size: 0,
            });
            let pipeline = d.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
                label: Some("bench marks"),
                layout: Some(&pipeline_layout),
                vertex: wgpu::VertexState {
                    module: &module,
                    entry_point: Some("vs"),
                    compilation_options: Default::default(),
                    buffers: &[Some(wgpu::VertexBufferLayout {
                        array_stride: INSTANCE,
                        step_mode: wgpu::VertexStepMode::Instance,
                        attributes: &wgpu::vertex_attr_array![
                            0 => Float32x4, 1 => Float32, 2 => Unorm8x4
                        ],
                    })],
                },
                primitive: wgpu::PrimitiveState {
                    topology: wgpu::PrimitiveTopology::TriangleStrip,
                    ..Default::default()
                },
                depth_stencil: None,
                multisample: Default::default(),
                fragment: Some(wgpu::FragmentState {
                    module: &module,
                    entry_point: Some("fs"),
                    compilation_options: Default::default(),
                    targets: &[Some(wgpu::ColorTargetState {
                        format: FORMAT,
                        blend: Some(wgpu::BlendState::PREMULTIPLIED_ALPHA_BLENDING),
                        write_mask: wgpu::ColorWrites::ALL,
                    })],
                }),
                multiview_mask: None,
                cache: None,
            });
            let times = device.timestamps.period_ns.map(|period| {
                let set = d.create_query_set(&wgpu::QuerySetDescriptor {
                    label: Some("bench pass"),
                    ty: wgpu::QueryType::Timestamp,
                    count: 2,
                });
                let buffer = |usage| {
                    d.create_buffer(&wgpu::BufferDescriptor {
                        label: Some("bench pass times"),
                        size: 16,
                        usage,
                        mapped_at_creation: false,
                    })
                };
                let resolve =
                    buffer(wgpu::BufferUsages::QUERY_RESOLVE | wgpu::BufferUsages::COPY_SRC);
                let read = buffer(wgpu::BufferUsages::MAP_READ | wgpu::BufferUsages::COPY_DST);
                (set, resolve, read, period)
            });
            Ok(View2d {
                _gpu: gpu,
                device,
                target,
                pipeline,
                bind,
                instances: None,
                held: Vec::new(),
                ground: [0; 3],
                reaches: Vec::new(),
                index: HashMap::new(),
                size: at,
                times,
                repaints,
                uploaded: 0,
                pass_ns: 0,
            })
        }

        /// Uploads what `drawing` changed of what the GPU holds: the replaced marks of each layer
        /// whose key moved, when the drawing replaced them in the list the GPU holds; else every
        /// mark, with the ground as one more instance over the whole surface. The bytes it wrote
        /// and what the frame redraws.
        fn upload(&mut self, drawing: &Drawing) -> Result<(u64, Redraw), String> {
            let layers = &drawing.frame.layers;
            let same = !self.repaints
                && drawing.frame.ground == self.ground
                && layers.len() == self.held.len()
                && layers
                    .iter()
                    .zip(&self.held)
                    .all(|(l, h)| l.marks.len() == h.1);
            let damage: Option<Vec<(usize, usize)>> = same
                .then(|| {
                    let mut out = Vec::new();
                    let mut first = 0;
                    for (i, (layer, held)) in layers.iter().zip(&self.held).enumerate() {
                        if layer.key != held.0 {
                            let d = drawing
                                .damage
                                .iter()
                                .find(|d| d.layer == i && d.was == held.0)?;
                            out.extend(d.marks.iter().map(|&m| (first + m, m)));
                        }
                        first += layer.marks.len();
                    }
                    Some(out)
                })
                .flatten();
            self.held = layers.iter().map(|l| (l.key, l.marks.len())).collect();
            let (Some(buffer), Some(damage)) = (&self.instances, damage) else {
                return self.upload_all(drawing);
            };
            let queue = &self.device.queue;
            let mut rects = Vec::with_capacity(2 * damage.len());
            let mut first_of = Vec::with_capacity(layers.len());
            let mut first = 0;
            for l in layers {
                first_of.push(first);
                first += l.marks.len();
            }
            for &(g, m) in &damage {
                let li = first_of.partition_point(|&f| f <= g) - 1;
                let (bytes, now) = instance(&layers[li].marks[m])?;
                queue.write_buffer(buffer, g as u64 * INSTANCE, &bytes);
                let was = std::mem::replace(&mut self.reaches[g], now);
                for c in cells(&was) {
                    if let Some(v) = self.index.get_mut(&c) {
                        v.retain(|&x| x as usize != g);
                    }
                }
                for c in cells(&now) {
                    self.index.entry(c).or_default().push(g as u32);
                }
                rects.extend([was, now]);
            }
            let within = rects
                .into_iter()
                .map(|rect| {
                    let mut meeting: Vec<u32> = cells(&rect)
                        .filter_map(|c| self.index.get(&c))
                        .flatten()
                        .copied()
                        .filter(|&i| meets(&self.reaches[i as usize], &rect))
                        .collect();
                    meeting.sort_unstable();
                    meeting.dedup();
                    (rect, meeting)
                })
                .collect();
            Ok((damage.len() as u64 * INSTANCE, Redraw::Within(within)))
        }

        /// Uploads every mark and the ground, and indexes each mark's reach.
        fn upload_all(&mut self, drawing: &Drawing) -> Result<(u64, Redraw), String> {
            let marks: Vec<&Arc<Drawn>> =
                drawing.frame.layers.iter().flat_map(|l| &l.marks).collect();
            let size = (marks.len() + 1) as u64 * INSTANCE;
            let buffer = match self.instances.take().filter(|b| b.size() >= size) {
                Some(b) => b,
                None => self.device.device.create_buffer(&wgpu::BufferDescriptor {
                    label: Some("bench instances"),
                    size,
                    usage: wgpu::BufferUsages::VERTEX | wgpu::BufferUsages::COPY_DST,
                    mapped_at_creation: false,
                }),
            };
            let mut bytes = Vec::with_capacity(size as usize);
            self.reaches.clear();
            self.index.clear();
            for (i, drawn) in marks.iter().enumerate() {
                let (b, r) = instance(drawn)?;
                bytes.extend_from_slice(&b);
                for c in cells(&r) {
                    self.index.entry(c).or_default().push(i as u32);
                }
                self.reaches.push(r);
            }
            let whole = [0., 0., self.size[0], self.size[1]];
            bytes.extend_from_slice(&encoded(whole, 0., drawing.frame.ground));
            self.device.queue.write_buffer(&buffer, 0, &bytes);
            self.instances = Some(buffer);
            self.ground = drawing.frame.ground;
            Ok((bytes.len() as u64, Redraw::All))
        }

        /// Uploads what the drawing changed and draws what it redraws from the GPU's instances
        /// into the surface; waits for the pass, which GPUI samples on its own queue.
        pub fn draw(&mut self, drawing: &Drawing) -> Result<(), String> {
            let (uploaded, redraw) = self.upload(drawing)?;
            self.uploaded = uploaded;
            let count = self.reaches.len() as u32;
            let [r, g, b] = unit(drawing.frame.ground);
            let d = &self.device;
            let mut encoder = d.device.create_command_encoder(&Default::default());
            {
                let load = match redraw {
                    Redraw::All => wgpu::LoadOp::Clear(wgpu::Color { r, g, b, a: 1.0 }),
                    Redraw::Within(..) => wgpu::LoadOp::Load,
                };
                let mut pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
                    label: Some("bench marks"),
                    color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                        view: self.target.target(),
                        depth_slice: None,
                        resolve_target: None,
                        ops: wgpu::Operations {
                            load,
                            store: wgpu::StoreOp::Store,
                        },
                    })],
                    depth_stencil_attachment: None,
                    timestamp_writes: self.times.as_ref().map(|(set, ..)| {
                        wgpu::RenderPassTimestampWrites {
                            query_set: set,
                            beginning_of_pass_write_index: Some(0),
                            end_of_pass_write_index: Some(1),
                        }
                    }),
                    occlusion_query_set: None,
                    multiview_mask: None,
                });
                if let Some(buffer) = &self.instances {
                    pass.set_pipeline(&self.pipeline);
                    pass.set_bind_group(0, &self.bind, &[]);
                    pass.set_vertex_buffer(0, buffer.slice(..));
                    match redraw {
                        Redraw::All => pass.draw(0..4, 0..count),
                        Redraw::Within(within) => {
                            let [w, h] = self.size.map(|v| v as u32);
                            for (rect, meeting) in within {
                                let x0 = (rect[0].floor().max(0.) as u32).min(w);
                                let y0 = (rect[1].floor().max(0.) as u32).min(h);
                                let x1 = (rect[2].ceil().max(0.) as u32).min(w);
                                let y1 = (rect[3].ceil().max(0.) as u32).min(h);
                                if x1 <= x0 || y1 <= y0 {
                                    continue;
                                }
                                pass.set_scissor_rect(x0, y0, x1 - x0, y1 - y0);
                                // The ground there, then every mark meeting it, in draw order.
                                pass.draw(0..4, count..count + 1);
                                for i in meeting {
                                    pass.draw(0..4, i..i + 1);
                                }
                            }
                        }
                    }
                }
            }
            if let Some((set, resolve, read, _)) = &self.times {
                encoder.resolve_query_set(set, 0..2, resolve, 0);
                encoder.copy_buffer_to_buffer(resolve, 0, read, 0, 16);
            }
            d.queue.submit([encoder.finish()]);
            self.pass_ns = self.pass_time();
            Ok(())
        }

        /// Waits for the pass; its GPU time from its timestamps.
        fn pass_time(&self) -> u64 {
            let Some((_, _, read, period)) = &self.times else {
                let _ = self.device.device.poll(wgpu::PollType::wait_indefinitely());
                return 0;
            };
            let slice = read.slice(..);
            slice.map_async(wgpu::MapMode::Read, |_| {});
            let _ = self.device.device.poll(wgpu::PollType::wait_indefinitely());
            let ticks = match slice.get_mapped_range() {
                Ok(data) => {
                    let at = |k: usize| u64::from_le_bytes(data[k..k + 8].try_into().expect("8"));
                    at(8).saturating_sub(at(0))
                }
                Err(_) => 0,
            };
            read.unmap();
            (ticks as f64 * f64::from(*period)) as u64
        }

        /// The surface's pixels, as GPUI samples them.
        #[cfg(test)]
        pub fn pixels(&self) -> Vec<u8> {
            self.target.read()
        }
    }

    /// Waits for every committed frame command buffer to complete, then reads the ledger.
    fn settled() -> gpu_ledger::Ledger {
        let deadline = Instant::now() + Duration::from_secs(10);
        loop {
            let ledger = gpu_ledger::read();
            if ledger.completed >= ledger.committed || Instant::now() > deadline {
                return ledger;
            }
            std::thread::sleep(Duration::from_micros(50));
        }
    }
}

#[cfg(not(target_os = "macos"))]
mod gpu {
    use deep_canvas_marks::modules::Drawing;

    pub struct Painter {
        pub presented: u64,
        pub uploaded: u64,
    }

    impl Painter {
        pub fn open(_: [f64; 2], _: bool) -> Result<Painter, String> {
            Err("the bench window draws through Metal, on macOS only".into())
        }

        pub fn present(&mut self, _: &Drawing) -> Result<(), String> {
            Err("no window".into())
        }

        pub fn wait(&mut self) -> u64 {
            0
        }
    }
}

#[cfg(test)]
mod tests {
    use deep_canvas::registry::{BuildSet, Registry};
    use deep_canvas::schedule::{default_view, Options, Planted, Scheduler, Session};
    use deep_canvas_marks::modules::{tokens, Drawing};
    use serde_json::{json, Value};

    fn board(n: usize) -> Value {
        let mut items = serde_json::Map::new();
        for i in 0..n {
            let id = format!("r{i:04}");
            items.insert(
                id.clone(),
                json!({"id": id, "kind": "rect@1", "layer": "a", "name": id,
                "order": format!("b{i:04}"), "params": {"box": [0, 0, 8, 6],
                "paint": {"fill": {"role": if i % 3 == 0 { "accent" } else { "muted" }}}},
                "at": {"pos": [(i % 20) * 12, (i / 20) * 8, 0]}}),
            );
        }
        json!({"format": 1, "profile": "board", "title": "B", "description": "d", "size": [320, 200],
               "layers": {"a": {"writer": "agent:t", "title": "A", "order": "a1"}}, "items": items})
    }

    fn drawing(s: &Scheduler<'_>, session: &Session) -> std::sync::Arc<Drawing> {
        session
            .value(s, "marks2d.frame", None)
            .and_then(|v| v.as_typed::<Drawing>())
            .expect("a drawing")
    }

    /// The view that redraws only the rect a frame's replaced marks covered and cover leaves
    /// the pixels a view drawing every mark of that frame leaves, over moves onto other marks and
    /// away from them, and uploads 32 B a moved item (#896).
    #[cfg(target_os = "macos")]
    #[test]
    fn a_redrawn_rect_leaves_the_pixels_a_whole_draw_leaves() {
        let mut registry = Registry::new(BuildSet::R1);
        for m in crate::modules(BuildSet::R1) {
            registry = registry.with(m);
        }
        let sealed = registry.seal().expect("seals");
        let look = tokens(&crate::hub::shipped_look().light);
        let mut s = Scheduler::new(&sealed, Options::default());
        let mut doc = board(120);
        let mut live = Session::new(0, look);
        live.load(&mut s, &doc);
        live.frame(&mut s, 0, &default_view(&doc));
        let mut view = super::gpu::View2d::open([320., 200.], false).expect("a GPU");
        view.draw(&drawing(&s, &live)).expect("drawn");
        for k in 0..30usize {
            let id = format!("r{:04}", (k * 37) % 120);
            doc["items"][&id]["at"]["pos"] = json!([k * 3, 150 + k % 4, 0]);
            assert!(live.revise_items(&mut s, &doc, &[&id]).is_some());
            live.frame(&mut s, 0, &default_view(&doc));
            view.draw(&drawing(&s, &live)).expect("drawn");
            assert_eq!(
                view.uploaded, 32,
                "move {k} uploads its item's instance alone"
            );
        }
        let mut whole = super::gpu::View2d::open([320., 200.], false).expect("a GPU");
        whole.draw(&drawing(&s, &live)).expect("drawn");
        let (got, want) = (view.pixels(), whole.pixels());
        let off = got.iter().zip(&want).filter(|(a, b)| a != b).count();
        assert_eq!(off, 0, "{off} of {} bytes differ", want.len());
    }

    /// A frame that replaces the changed items' marks in the last list gives the list a whole
    /// rebuild of that revision gives, its layer keys included, puts in only the moved item's
    /// mark and names where it sits; the planted frame rebuilds every mark (#896).
    #[test]
    fn a_replaced_draw_list_is_the_list_a_whole_build_gives() {
        let mut registry = Registry::new(BuildSet::R1);
        for m in crate::modules(BuildSet::R1) {
            registry = registry.with(m);
        }
        let sealed = registry.seal().expect("seals");
        let look = tokens(&crate::hub::shipped_look().light);
        for forgets in [false, true] {
            let options = Options {
                planted: Planted {
                    forgets_changes: forgets,
                    ..Planted::default()
                },
                ..Options::default()
            };
            let mut s = Scheduler::new(&sealed, options);
            let mut doc = board(120);
            let mut live = Session::new(0, look.clone());
            live.load(&mut s, &doc);
            live.frame(&mut s, 0, &default_view(&doc));
            for k in 0..40usize {
                let id = format!("r{:04}", (k * 37) % 120);
                let pos = if k % 5 == 4 {
                    json!([1, 2, 0])
                } else {
                    json!([k * 3, 150, 0])
                };
                doc["items"][&id]["at"]["pos"] = pos;
                assert!(live.revise_items(&mut s, &doc, &[&id]).is_some());
                live.frame(&mut s, 0, &default_view(&doc));
                let got = drawing(&s, &live);
                let mut fresh_s = Scheduler::new(&sealed, Options::default());
                let mut fresh = Session::new(0, look.clone());
                fresh.load(&mut fresh_s, &doc);
                fresh.frame(&mut fresh_s, 0, &default_view(&doc));
                let want = drawing(&fresh_s, &fresh);
                assert_eq!(got.frame, want.frame, "patch {k}");
                if forgets {
                    assert_eq!(got.built, 120, "the planted frame rebuilds every mark");
                } else {
                    assert_eq!(got.built, 1, "patch {k} replaces its item's one mark");
                    let at = want.frame.layers[0]
                        .marks
                        .iter()
                        .position(|m| m.mark.item() == id)
                        .expect("drawn");
                    assert_eq!(got.damage.len(), 1);
                    assert_eq!(got.damage[0].marks, vec![at]);
                }
            }
        }
    }
}

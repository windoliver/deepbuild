//! Issue #378: a revision that holds 3D writer layers, drawn natively by scene3d's render module
//! on the app's GPU (canvas primitives: Render-back: 3D layers render on the GPU), for its
//! render-back snapshots and for its layer's picture in the window, in its document's look and
//! through the post stage `deep-gpu`'s view draws it through (#1719). The device opens on the
//! first 3D revision drawn and stays for the run.

pub(crate) mod look;

use std::sync::{Arc, Mutex};

use deep_canvas::registry::{ItemPass, LightQuery, LightSums, Reduce};
use deep_canvas_marks::scene::Palette;
use deep_canvas_scene3d::contributed::Fills;
use deep_canvas_scene3d::look::Look3;
use deep_canvas_scene3d::scene::{evaluate_any, Labels, Scene};
use deep_effects_render::frame::{effect_label, pass_ms, profiler, Effects, Shared, SPARKS};
use deep_effects_render::look_ops::Finish;
use deep_effects_render::scene::Staged;
use deep_gpu::device::{Backend, Device, Gpu};
use deep_groups_render::drawn::{Frame3, Post3};
use deep_scene3d_render::exposure::{Kept, Reducer};
use deep_scene3d_render::targets::Want;
use deep_scene3d_render::{draw_offscreen, Planted, Post, Renderer};
use serde_json::{json, Value};

use crate::snapshot::Unfit;

/// The rows of a frame of `size` render.exposure's reduction reads: all of them, or, under
/// #2513's planted reduction, those in whole 32-row groups.
fn read_rows([w, h]: [u32; 2], short: bool) -> [u32; 2] {
    [w, if short { h / 32 * 32 } else { h }]
}

/// #1401: what a frame's object-ID pass and depth target hold, at their own size: each pixel's
/// pick (u32, 0 where nothing drew), the item each pick stands for, and, for the planted depth
/// reader alone, each pixel's view depth in m (f32).
pub struct Targets {
    pub size: [u32; 2],
    pub ids: Vec<u8>,
    pub picks: std::collections::BTreeMap<u32, String>,
    pub view_depth: Option<Vec<u8>>,
}

/// #3017: a 3D snapshot's visible table, read from its frame's own object-ID pass (Render-back):
/// each item whose box meets the frame and that drew px, as `{id, box, px, at}`, and each such
/// item that drew none, `hidden`; past [`ROWS`] of either, `cut` says how many it left out.
#[derive(Default)]
pub struct Shown {
    pub visible: Vec<(String, Value)>,
    pub hidden: Vec<String>,
    pub cut: [usize; 2],
}

/// The most rows `visible`, and `hidden`, hold.
pub const ROWS: usize = crate::snapshot::VISIBLE_ROWS;

/// Whether a box `[x, y, w, h]` in px meets a frame of `size`.
fn meets(b: &[f64; 4], size: [u16; 2]) -> bool {
    let (w, h) = (f64::from(size[0]), f64::from(size[1]));
    b[0] < w && b[1] < h && b[0] + b[2] > 0.0 && b[1] + b[3] > 0.0
}

impl Shown {
    /// `boxes` (2D items drawn over the frame, in the 2D frame's units, `scale` to the snapshot's
    /// px) listed by their boxes, as a 2D table lists them, in the room the 3D rows leave.
    pub fn over(&mut self, boxes: Vec<(String, [f64; 4])>, scale: f64, size: [u16; 2]) {
        let mut rows: Vec<(String, [f64; 4])> = boxes
            .into_iter()
            .map(|(id, b)| (id, b.map(|v| v * scale)))
            .filter(|(_, b)| meets(b, size))
            .collect();
        rows.sort_by(|a, b| a.0.cmp(&b.0));
        for (id, b) in rows {
            if self.visible.len() < ROWS {
                let row = json!({"id": id, "box": b});
                self.visible.push((id, row));
            } else {
                self.cut[0] += 1;
            }
        }
        self.visible.sort_by(|a, b| a.0.cmp(&b.0));
    }

    /// The table into a reply: `visible`, `hidden` and, when it left any out, `cut`.
    pub fn put(self, reply: &mut serde_json::Map<String, Value>) {
        let visible: Vec<Value> = self.visible.into_iter().map(|(_, r)| r).collect();
        reply.insert("visible".into(), Value::Array(visible));
        reply.insert("hidden".into(), json!(self.hidden));
        if self.cut != [0, 0] {
            reply.insert(
                "cut".into(),
                json!({"visible": self.cut[0], "hidden": self.cut[1]}),
            );
        }
    }
}

/// #1719's wrong program, and #3017's, each reachable only through the scenario's `planted`: the
/// merge base's look ([`look::DROPS_LOOK`]); its table, rows from boxes alone; `px` as the box's area; `at` at the box's centre; past 200
/// rows the first 200 by ID; a cut that reports no `cut`; and the picks of the frame drawn
/// without its cutaway (Hub::shown3d draws that one).
pub const AS_BOXES: &str = "visible_table_as_boxes";
pub const BEFORE_CUTAWAY: &str = "visible_picks_before_cutaway";
pub const PLANTED: [&str; 7] = [
    look::DROPS_LOOK,
    AS_BOXES,
    "visible_px_from_box",
    "visible_at_box_centre",
    "visible_first_200_by_id",
    "visible_cut_unreported",
    BEFORE_CUTAWAY,
];

impl Shown {
    /// The merge base's table, under [`AS_BOXES`]: `{id, box}` for each drawn item or part
    /// whose box meets the frame, the first 200 by ID, read from no ID pass.
    pub fn of_boxes(boxes: Vec<(String, [f64; 4])>, size: [u16; 2]) -> Shown {
        let rows = crate::snapshot::visible(boxes, 1.0, size);
        let visible = rows.as_array().into_iter().flatten();
        let id = |r: &Value| r["id"].as_str().unwrap_or_default().to_string();
        Shown {
            visible: visible.map(|r| (id(r), r.clone())).collect(),
            ..Shown::default()
        }
    }
}

impl Targets {
    /// The visible table of the frame these targets are of, drawn at `size`, its items' boxes
    /// `boxes` (each item's or part's, in the snapshot's px): each item whose box meets the frame,
    /// its parts' boxes joined, with the snapshot's px whose pick resolves to it (a part's to its
    /// item, as probes resolve them) and the px the ID view numbers it at; `plant`, the scenario's
    /// planted program.
    pub fn shown(
        &self,
        boxes: Vec<(String, [f64; 4])>,
        size: [u16; 2],
        plant: Option<&str>,
    ) -> Shown {
        if plant == Some(AS_BOXES) {
            return Shown::of_boxes(boxes, size);
        }
        let (w, h) = (usize::from(size[0]), usize::from(size[1]));
        let mut items: std::collections::BTreeMap<String, [f64; 4]> = Default::default();
        for (id, b) in boxes.into_iter().filter(|(_, b)| meets(b, size)) {
            let item = id.split('#').next().unwrap_or(&id).to_string();
            items
                .entry(item)
                .and_modify(|u| {
                    let (x1, y1) = (
                        (u[0] + u[2]).max(b[0] + b[2]),
                        (u[1] + u[3]).max(b[1] + b[3]),
                    );
                    let (x0, y0) = (u[0].min(b[0]), u[1].min(b[1]));
                    *u = [x0, y0, x1 - x0, y1 - y0];
                })
                .or_insert(b);
        }
        let ids: Vec<&String> = items.keys().collect();
        // Each pick's row, 1 up, or 0 for an item the table doesn't list.
        let top = self.picks.keys().next_back().map_or(0, |p| *p as usize);
        let mut slot = vec![0u32; top + 1];
        for (p, id) in &self.picks {
            let item = id.split('#').next().unwrap_or(id);
            if let Ok(k) = ids.binary_search_by(|i| i.as_str().cmp(item)) {
                slot[*p as usize] = k as u32 + 1;
            }
        }
        // Each snapshot px's row, from the target px under its centre (the probes' mapping); a
        // run of px of one pick is looked up and counted once.
        let [tw, th] = self.size.map(|v| v as usize);
        let same = [tw, th] == [w, h];
        let axis = |n: usize, t: usize| -> Vec<usize> {
            (0..if same { 0 } else { n })
                .map(|v| ((v as f64 + 0.5) * t as f64 / n as f64) as usize)
                .map(|s| s.min(t.saturating_sub(1)))
                .collect()
        };
        let (xs, ys) = (axis(w, tw), axis(h, th));
        let picks = (0..w * h)
            .map(|i| if same { i } else { ys[i / w] * tw + xs[i % w] })
            .map(|t| self.pick_bytes(t * 4));
        let mut px = vec![0u64; ids.len() + 1];
        let mut keys = vec![0u32; w * h];
        let (mut last, mut key, mut run) = (u32::MAX, 0u32, 0u64);
        for (k, p) in keys.iter_mut().zip(picks) {
            if p != last {
                px[key as usize] += run;
                (last, key, run) = (p, slot.get(p as usize).copied().unwrap_or(0), 0);
            }
            *k = key;
            run += 1;
        }
        px[key as usize] += run;
        let px = &px[1..];
        let mut at = deep_canvas_loop::review::centres(&keys, w, ids.len());
        let mut shown = Shown::default();
        let mut rows: Vec<usize> = (0..ids.len()).filter(|k| px[*k] > 0).collect();
        // Past the table's rows, the items with the most px, ties by ID.
        if rows.len() > ROWS {
            if plant != Some("visible_first_200_by_id") {
                rows.sort_by(|a, b| px[*b].cmp(&px[*a]).then(a.cmp(b)));
            }
            shown.cut[0] = rows.len() - ROWS;
            rows.truncate(ROWS);
            rows.sort_unstable();
        }
        let area = |b: [f64; 4]| (b[2] * b[3]).round() as u64;
        shown.visible = rows
            .into_iter()
            .map(|k| {
                let (id, b) = (ids[k], items[ids[k]]);
                let px = match plant {
                    Some("visible_px_from_box") => area(b),
                    _ => px[k],
                };
                if plant == Some("visible_at_box_centre") {
                    let c = |o: usize, n: usize| {
                        ((b[o] + b[o + 2] / 2.0).max(0.0) as u32).min(n as u32 - 1)
                    };
                    at[k] = Some([c(0, w), c(1, h)]);
                }
                let row = json!({"id": id, "box": b, "px": px, "at": at[k]});
                (id.clone(), row)
            })
            .collect();
        shown.hidden = (0..ids.len())
            .filter(|k| px[*k] == 0)
            .map(|k| ids[k].clone())
            .collect();
        shown.cut[1] = shown.hidden.len().saturating_sub(ROWS);
        shown.hidden.truncate(ROWS);
        if plant == Some("visible_cut_unreported") {
            shown.cut = [0, 0];
        }
        shown
    }

    /// The pick the object-ID pass holds at byte `i`, 0 past its end.
    fn pick_bytes(&self, i: usize) -> u32 {
        self.ids
            .get(i..i + 4)
            .map_or(0, |b| u32::from_le_bytes([b[0], b[1], b[2], b[3]]))
    }
}

/// #1719: a 3D frame as a draw takes it, with the post stage `deep-gpu`'s view hands the renderer:
/// its scene, look and effects staged, what a drawing look lays over its surfaces, and its look's
/// operator finish.
pub struct Frame3d {
    pub staged: Staged,
    pub drawn: Frame3,
    pub finish: Finish,
}

pub struct Gpu3 {
    _gpu: Arc<Gpu>,
    device: Arc<Device>,
    renderer: Renderer,
    /// The post stage's passes, built on first use and kept, with what each frame sets in them.
    post: Post3,
    fx: Arc<Mutex<Effects>>,
    drawn: Arc<Mutex<Frame3>>,
    labels: Labels,
    /// The print pass, built on first use and kept: an export prints every frame (#157).
    printer: Option<deep_scene3d_render::print::Printer>,
    /// render.exposure's reduction, built on first use and kept (#2513).
    reducer: Option<Arc<Reducer>>,
    /// The build's outline sources and module fills (#226), and the planted module program.
    outlines: Vec<deep_canvas::registry::SealedOutline>,
    fills: Vec<deep_canvas::contributed::Sealed>,
    planted: Option<String>,
    /// #1561: Vello GPU and the compositor a drawn look's 2D frames draw through, on this GPU.
    #[cfg(target_os = "macos")]
    pub(crate) frames2: Option<deep_groups_render::frame2::Frames2>,
}

impl Gpu3 {
    /// The device it draws on, for the export's frame hashes (#501).
    pub fn device(&self) -> &Arc<Device> {
        &self.device
    }

    /// #157's planted lost device: the device is lost now, as the platform would lose it.
    #[cfg(feature = "test-export-guards")]
    pub fn force_loss(&self) {
        self.device.force_loss();
    }

    /// The app's GPU, or `None` where there is none to draw 3D on; it evaluates with the sealed
    /// build's fills.
    pub fn open(sealed: &deep_canvas::registry::Sealed, planted: Option<String>) -> Option<Gpu3> {
        let gpu = Gpu::open(Backend::Gpu).ok()?;
        let device = gpu.recover().ok()?;
        let renderer = Renderer::new(&device, Planted::default());
        let fx = Arc::new(Mutex::new(Effects::new(
            Default::default(),
            Default::default(),
        )));
        let drawn = Arc::new(Mutex::new(Frame3::default()));
        let post = Post3::new(Box::new(Shared(fx.clone())), drawn.clone(), fx.clone());
        Some(Gpu3 {
            _gpu: gpu,
            device,
            renderer,
            post,
            fx,
            drawn,
            labels: Labels::new(),
            printer: None,
            reducer: None,
            outlines: sealed.outlines.clone(),
            fills: sealed.fills.clone(),
            planted,
            #[cfg(target_os = "macos")]
            frames2: None,
        })
    }

    /// A frame drawn offscreen over its look's ground: straight RGBA, rows top-down. When it has
    /// readouts or card lines, the picture is the draw with them as labels (#419, #504).
    pub fn draw(&mut self, frame: &Frame3d) -> Option<Vec<u8>> {
        self.draw_edited(frame, |_| {})
    }

    /// [`Gpu3::draw`] with the frame's effects edited once staged.
    fn draw_edited(&mut self, frame: &Frame3d, edit: impl FnOnce(&mut Effects)) -> Option<Vec<u8>> {
        let Staged { scene, look, .. } = &frame.staged;
        {
            let mut fx = self.fx.lock().unwrap_or_else(|e| e.into_inner());
            fx.stage(&frame.staged);
            edit(&mut fx);
        }
        *self.drawn.lock().unwrap_or_else(|e| e.into_inner()) = frame.drawn.clone();
        self.renderer.core.want = frame.staged.want;
        let over = if scene.readouts.is_empty() {
            None
        } else {
            let mut sc = scene.clone();
            deep_scene3d_render::readouts_as_labels(&mut sc);
            Some(self.offscreen(&sc, look, true)?)
        };
        // The plain draw goes last even under readouts, so the ids, picks and light the renderer
        // keeps for `targets`, `picks` and `light` are the frame's own, not its labels'.
        let plain = self.offscreen(scene, look, true)?;
        let bytes = over.unwrap_or(plain);
        // #463: the look's operator finish, over the finished frame.
        let (mut bytes, _) = frame
            .finish
            .apply(&self.device, None, "", bytes, scene.size, &[], true)
            .ok()?;
        deep_gpu::surface::swap_red_blue(&mut bytes);
        Some(bytes)
    }

    /// #2485: item `id`'s own particles drawn over `frame`'s scene with no other particles, as
    /// effects.audit reads them: the most fragments any px took from them, in a draw that counts
    /// each fragment in place of its shade, and their pass's GPU time (ms) by its timestamps, in
    /// a draw of its own; neither where the frame draws none of its particles, nor the time where
    /// the device takes no timestamps.
    pub fn effect_pass(&mut self, frame: &Frame3d, id: &str) -> ItemPass {
        let Some(sp) = frame.staged.settings.sparks.iter().find(|s| s.item == id) else {
            return ItemPass::default();
        };
        let label = sp.effect.as_deref().map_or(SPARKS, effect_label);
        let alone = |fx: &mut Effects| fx.settings.sparks.retain(|s| s.item == id);
        let counted = self.draw_edited(frame, |fx| {
            alone(fx);
            fx.settings.overdraw = true;
        });
        let fx = self.fx.clone();
        let lock = || fx.lock().unwrap_or_else(|e| e.into_inner());
        let overdraw = counted
            .and_then(|_| lock().read_overdraw(&self.device))
            .map(f64::from);
        let timer = profiler(&self.device);
        let timed = timer.as_ref().and_then(|p| {
            self.draw_edited(frame, |fx| {
                alone(fx);
                fx.profiler = Some(p.clone());
            })?;
            Some(pass_ms(&self.device, p))
        });
        lock().profiler = None;
        let gpu_ms = timed.and_then(|ms| ms.get(label).copied());
        ItemPass { overdraw, gpu_ms }
    }

    /// `scene` drawn offscreen, through the post stage set when `post` says.
    fn offscreen(&mut self, scene: &Scene, look: &Look3, post: bool) -> Option<Vec<u8>> {
        let post = post.then_some(&mut self.post as &mut dyn Post);
        draw_offscreen(&self.device, &mut self.renderer, scene, look, post)
    }

    /// #231: [`Gpu3::draw`]'s frame as the BGRA8 texture it is drawn into, which nothing reads
    /// back; `None` for a frame with readouts, whose labels are a second draw, or with a look's
    /// operator finish, which runs over the frame's bytes.
    pub fn draw_texture(&mut self, frame: &Frame3d) -> Option<wgpu::Texture> {
        let Staged { scene, look, .. } = &frame.staged;
        if !scene.readouts.is_empty() || !frame.finish.is_empty() {
            return None;
        }
        (self.fx.lock().unwrap_or_else(|e| e.into_inner())).stage(&frame.staged);
        *self.drawn.lock().unwrap_or_else(|e| e.into_inner()) = frame.drawn.clone();
        self.renderer.core.want = frame.staged.want;
        let post = Some(&mut self.post as &mut dyn Post);
        let (device, renderer) = (&self.device, &mut self.renderer);
        Some(deep_scene3d_render::draw_offscreen_texture(
            device, renderer, scene, look, post,
        ))
    }

    /// #427: `doc` at `t` on a frame of `size`, its `mesh.asset@1` items read from `assets`: the
    /// evaluated scene a draw reads, and the look it draws in, `look` as its camera exposes it; its
    /// maps' texels are the host's (#1729, `Hub::evaluate3d`).
    pub fn evaluate(
        &mut self,
        doc: &Value,
        t: i64,
        look: Look3,
        size: [u16; 2],
        assets: deep_canvas_scene3d::scene::Assets<'_>,
    ) -> Result<(Scene, Look3), Unfit> {
        let fills = Fills {
            outlines: &self.outlines,
            module: &self.fills,
            planted: self.planted.as_deref(),
            memo: None,
        };
        deep_play::scene::evaluate_in(doc, t, look, size, &mut self.labels, assets, fills).map_err(
            |r| Unfit {
                code: r.code,
                path: r.path,
            },
        )
    }

    /// #1401: a frame drawn offscreen as render-back draws it: straight RGBA, rows top-down, with
    /// the targets its probes read; the view depth only when `depth` asks.
    pub fn draw_scene(&mut self, frame: &Frame3d, depth: bool) -> Option<(Vec<u8>, Targets)> {
        let bytes = self.draw(frame)?;
        Some((bytes, self.targets(frame.staged.scene.size, depth)?))
    }

    /// The targets `scene`'s geometry leaves, drawn for them alone: its IDs, never its picture.
    pub fn draw_ids(&mut self, scene: &Scene, look: &Look3) -> Option<Targets> {
        self.renderer.core.want = Want::default();
        self.offscreen(scene, look, false)?;
        self.targets(scene.size, false)
    }

    /// Each pick of the last frame drawn with the item it stands for, read on the CPU.
    pub fn picks(&self) -> std::collections::BTreeMap<u32, String> {
        self.renderer
            .picks()
            .iter()
            .map(|(id, p)| (*p, id.clone()))
            .collect()
    }

    /// The targets the last frame drawn at `size` left: its object-ID pass at the renderer's own
    /// size and each pick's item; the view depth only when `depth` asks.
    pub fn targets(&self, size: [u32; 2], depth: bool) -> Option<Targets> {
        let r = &self.renderer;
        Some(Targets {
            size: r.internal_size(size),
            ids: r.read_ids(&self.device)?,
            picks: self.picks(),
            view_depth: if depth {
                Some(r.read_view_depth(&self.device)?)
            } else {
                None
            },
        })
    }

    fn reducer(&mut self) -> Arc<Reducer> {
        let device = &self.device;
        self.reducer
            .get_or_insert_with(|| Arc::new(Reducer::new(device)))
            .clone()
    }

    /// #2513: render.exposure's `q` reduced on this GPU over the last frame drawn, its pre-tone
    /// image and object-ID pass; under #2513's planted reduction, without the frame's last rows.
    pub fn light(&mut self, q: &LightQuery, short: bool) -> Option<LightSums> {
        let reducer = self.reducer();
        let (pre_tone, ids, size) = self.renderer.light_source()?;
        reducer.reduce(&self.device, pre_tone, ids, read_rows(size, short), q)
    }

    /// #2513: the last frame drawn, kept on this GPU for render.exposure to reduce after later
    /// frames draw: a frame's reduction in place of its linear image.
    /// #457: each reduction's GPU time (ms, by the pass's timestamps), the bytes it read back and
    /// one run are added to `cost`.
    pub fn kept_light(
        &mut self,
        short: bool,
        cost: Arc<std::sync::Mutex<[f64; 3]>>,
    ) -> Option<Reduce> {
        let reducer = self.reducer();
        let (pre_tone, ids, size) = self.renderer.light_source()?;
        let kept = Kept::copy(&self.device, pre_tone, ids, size);
        let device = self.device.clone();
        let rows = read_rows(size, short);
        let bytes = deep_scene3d_render::exposure::readback_bytes(rows) as f64;
        Some(Reduce(Arc::new(move |q| {
            let (sums, gpu_ms) = kept.reduce(&device, &reducer, rows, q, true)?;
            if let Ok(mut c) = cost.lock() {
                c[0] += gpu_ms.unwrap_or(f64::NAN);
                c[1] += bytes + if gpu_ms.is_some() { 16.0 } else { 0.0 };
                c[2] += 1.0;
            }
            Some(sums)
        })))
    }

    /// #427: an evaluated scene drawn offscreen in a diagnostic view: straight RGBA, rows
    /// top-down, never on a live surface.
    pub fn render(
        &mut self,
        scene: &Scene,
        look: &Look3,
        diag: &deep_scene3d_render::Diag,
    ) -> Option<(Vec<u8>, deep_scene3d_render::DiagCounts)> {
        self.renderer.core.want = Want::default();
        let (mut bytes, counts) = deep_scene3d_render::draw_offscreen_diag(
            &self.device,
            &mut self.renderer,
            scene,
            look,
            diag,
        )?;
        for p in bytes.as_chunks_mut::<4>().0 {
            p.swap(0, 2);
        }
        Some((bytes, counts))
    }

    /// #464: a 2D frame through the look's print finish on this machine's GPU: `base` (RGBA over
    /// the ground) and each separation's coverage (RGBA, its alpha) in, the printed RGBA out.
    pub fn print(
        &mut self,
        params: &deep_scene3d_render::print::Params,
        base: &[u8],
        covs: &[Vec<u8>],
        size: [u32; 2],
    ) -> Option<Vec<u8>> {
        use deep_scene3d_render::print::{Coverage, Printer};
        let d = &self.device.device;
        let format = wgpu::TextureFormat::Rgba8Unorm;
        let upload = |bytes: &[u8]| {
            let t = d.create_texture(&wgpu::TextureDescriptor {
                label: Some("print snapshot"),
                size: wgpu::Extent3d {
                    width: size[0],
                    height: size[1],
                    depth_or_array_layers: 1,
                },
                mip_level_count: 1,
                sample_count: 1,
                dimension: wgpu::TextureDimension::D2,
                format,
                usage: wgpu::TextureUsages::TEXTURE_BINDING | wgpu::TextureUsages::COPY_DST,
                view_formats: &[],
            });
            self.device.queue.write_texture(
                t.as_image_copy(),
                bytes,
                wgpu::TexelCopyBufferLayout {
                    offset: 0,
                    bytes_per_row: Some(size[0] * 4),
                    rows_per_image: None,
                },
                t.size(),
            );
            t.create_view(&Default::default())
        };
        let source = upload(base);
        let inks: Vec<wgpu::TextureView> = covs.iter().map(|c| upload(c)).collect();
        let out = d.create_texture(&wgpu::TextureDescriptor {
            label: Some("print snapshot out"),
            size: wgpu::Extent3d {
                width: size[0],
                height: size[1],
                depth_or_array_layers: 1,
            },
            mip_level_count: 1,
            sample_count: 1,
            dimension: wgpu::TextureDimension::D2,
            format,
            usage: wgpu::TextureUsages::RENDER_ATTACHMENT | wgpu::TextureUsages::COPY_SRC,
            view_formats: &[],
        });
        let view = out.create_view(&Default::default());
        let mut encoder = d.create_command_encoder(&Default::default());
        self.printer.get_or_insert_with(|| Printer::new(d)).record(
            d,
            &mut encoder,
            params,
            &source,
            &Coverage::Textures(inks.iter().collect()),
            &view,
            format,
            None,
        );
        let row = (size[0] * 4).next_multiple_of(wgpu::COPY_BYTES_PER_ROW_ALIGNMENT);
        let buffer = d.create_buffer(&wgpu::BufferDescriptor {
            label: Some("print snapshot read back"),
            size: u64::from(row) * u64::from(size[1]),
            usage: wgpu::BufferUsages::COPY_DST | wgpu::BufferUsages::MAP_READ,
            mapped_at_creation: false,
        });
        encoder.copy_texture_to_buffer(
            out.as_image_copy(),
            wgpu::TexelCopyBufferInfo {
                buffer: &buffer,
                layout: wgpu::TexelCopyBufferLayout {
                    offset: 0,
                    bytes_per_row: Some(row),
                    rows_per_image: None,
                },
            },
            out.size(),
        );
        self.device.queue.submit([encoder.finish()]);
        let (tx, rx) = std::sync::mpsc::channel();
        buffer.slice(..).map_async(wgpu::MapMode::Read, move |r| {
            let _ = tx.send(r);
        });
        let _ = d.poll(wgpu::PollType::wait_indefinitely());
        rx.recv().ok()?.ok()?;
        let data = buffer.slice(..).get_mapped_range().ok()?;
        let w = (size[0] * 4) as usize;
        Some(
            (0..size[1] as usize)
                .flat_map(|y| data[y * row as usize..y * row as usize + w].to_vec())
                .collect(),
        )
    }
}

/// #226: each point `doc` draws at `t`, by its item, in world metres: after its modifiers (the
/// build's module deforms among them) and its parents' transforms.
pub fn points_at(
    doc: &Value,
    t: i64,
    palette: &Palette,
    sealed: &deep_canvas::registry::Sealed,
    planted: Option<&str>,
) -> Result<std::collections::BTreeMap<String, [f64; 3]>, Unfit> {
    Ok(scene_at(doc, t, palette, sealed, planted)?
        .layers
        .iter()
        .flat_map(|l| &l.points)
        .map(|p| (p.id.clone(), p.pos))
        .collect())
}

/// `doc`'s scene at `t` as the frame evaluates it, with the build's fills; where it sits reads no
/// camera, so a document that names none is evaluated under a stand-in (#226, #1974).
pub fn scene_at(
    doc: &Value,
    t: i64,
    palette: &Palette,
    sealed: &deep_canvas::registry::Sealed,
    planted: Option<&str>,
) -> Result<Scene, Unfit> {
    let mut doc = doc.clone();
    if doc.get("size").is_none() {
        doc["size"] = json!([640, 360]);
    }
    let named = doc
        .get("camera")
        .and_then(Value::as_str)
        .map(str::to_string);
    if named.is_none_or(|c| doc.pointer(&format!("/items/{c}")).is_none()) {
        doc["camera"] = json!("\u{0}camera");
        let params = json!({"projection": "orthographic", "view_width": 10, "target": [0, 0, 0],
                            "position": [0, 0, 10]});
        doc["items"]["\u{0}camera"] =
            json!({"id": "\u{0}camera", "kind": "camera@1", "params": params});
    }
    let look = Look3::from_roles(palette.clone());
    let fills = Fills::of(sealed, planted);
    evaluate_any(&doc, t, &look, &mut Labels::new(), None, fills).map_err(|r| Unfit {
        code: r.code,
        path: r.path,
    })
}

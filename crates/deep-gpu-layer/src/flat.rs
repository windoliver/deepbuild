//! Issue #397: a 2D document in the live window, such as a chart with no camera. Each frame
//! evaluates its items at t through the motion program, lays them out by marks2d in the look's
//! roles, and draws the marks by Vello GPU into the view's slot, over the look's ground; its
//! passes are timed as one pass of the session's. A frame where items only moved, by `at.pos`
//! alone and with no children, reuses the last frame's marks moved with them, so a panned series
//! is decimated once (Series and decimation: first decimation O(rows), then O(px)); a frame is the
//! same either way.
//!
//! Issue #1561: under a drawn look the frame is `film2d`'s. The look's drawn fields dress the
//! marks, a 2D camera places the items, and the frame composites on the look's paper, seen
//! through that camera; a frame that reuses the last one's marks draws on the same page.

use std::collections::BTreeMap;
use std::sync::Arc;

use deep_canvas_marks::drawn;
use deep_canvas_marks::scene::{self, Drawn, Fill, Mark, Palette, Record, Type};
use deep_canvas_motion::eval;
use deep_canvas_motion::program::{Program, State};
use deep_canvas_scene3d::look::Look3;
use deep_gpu::device::Device;
use deep_gpu::surface::FORMAT;
use deep_groups_render::frame2;
use deep_marks_render::gpu::{Options, Vello2d};
use deep_scene3d_render::surface::{self, Low, Surface, Upscale, SHARPEN_PASS, UPSCALE_PASS};
use serde_json::{Map, Value};

use crate::drawn::Page;
use crate::groups::{self, Clock, Groups};
use crate::liveview::Timer;
use crate::Planted;

/// The pass a 2D view's frame is timed as.
pub const FLAT_PASS: &str = "flat";

/// A frame's marks, and where each writer layer's marks end.
type Marks = (Vec<Drawn>, Vec<usize>);

/// A 2D document's frames, from its evaluated items at t.
pub struct Flat {
    doc: Map<String, Value>,
    program: Program,
    state: State,
    palette: Palette,
    roles: BTreeMap<String, [f64; 3]>,
    /// #1561: the look's drawn fields, which dress the marks.
    ty: Type,
    /// #1561: the look's paper as the last frame's camera and lamps saw it.
    page: Option<Page>,
    vello: Option<Vello2d>,
    groups: Option<Groups>,
    /// The last frame's evaluated items and marks, and where each writer layer's marks end.
    last: Option<(Map<String, Value>, Marks)>,
    /// #1561: whether the marks it holds are an earlier frame's, moved, and not laid out anew.
    reused: bool,
    /// `--planted reuse_drops_page`: such a frame draws with no page.
    drops_page: bool,
    /// #467: the marks the view last drew, on their page; a frame with the same draws nothing.
    shown: Option<(Vec<Drawn>, Option<Page>)>,
    /// #161: the frame's targets below internal scale 1, and the compositor's wrong program.
    low: Option<Low>,
    plant: Option<deep_groups_render::Planted>,
}

/// A `live` call's look as a 2D document's frames read it (#1561): the look as every view reads
/// it, the look@1 itself, whose `fw` and `fh` sizes convert at each document's size as
/// `film2d`'s do, and the call's assets, files by hash, which a paper's tooth is read from.
pub struct CallLook {
    look: Look3,
    def: Value,
    assets: Map<String, Value>,
}

impl CallLook {
    /// `look`, read from a `live` call's `look`, with that call's `assets`.
    pub fn of(look: Look3, call: &Value) -> CallLook {
        CallLook {
            look,
            def: call["look"].clone(),
            assets: call["assets"].as_object().cloned().unwrap_or_default(),
        }
    }
}

impl std::ops::Deref for CallLook {
    type Target = Look3;

    fn deref(&self) -> &Look3 {
        &self.look
    }
}

/// Whether a document draws as 2D in the live window: it names no camera, or (#1561) its camera
/// is a 2D film's and it holds nothing of scene3d's, which only the 3D path reads: none of its
/// kinds, and no item it draws for another module.
pub fn is_flat(doc: &Value) -> bool {
    let of_scene3d = |items: &Map<String, Value>| {
        deep_canvas_scene3d::scene::has_3d(doc)
            || (items.values().filter_map(|i| i["kind"].as_str()))
                .any(|k| deep_canvas_scene3d::spec::SCENE3D.contains(&k))
    };
    match (doc.as_object(), doc["items"].as_object()) {
        (Some(d), Some(items)) if d.contains_key("camera") => {
            !of_scene3d(items) && drawn::camera_of(d, items).is_some()
        }
        _ => doc.get("camera").is_none(),
    }
}

/// An item's `at` with its position apart: the position as (x, y), and the rest.
fn pos(item: &Value) -> Option<([f64; 2], Map<String, Value>)> {
    let mut at = match item.get("at") {
        None => Map::new(),
        Some(Value::Object(at)) => at.clone(),
        Some(_) => return None,
    };
    let xy = match at.remove("pos") {
        None => [0.0, 0.0],
        Some(Value::Array(p)) => match p.as_slice() {
            [x, y, ..] => [x.as_f64()?, y.as_f64()?],
            _ => return None,
        },
        Some(_) => return None,
    };
    Some((xy, at))
}

/// How far each item moved from `before` to `after`, when every change is an item's `at.pos`
/// and no moved item is a parent; `None` when a frame must be rebuilt.
fn moved(
    before: &Map<String, Value>,
    after: &Map<String, Value>,
) -> Option<BTreeMap<String, [f64; 2]>> {
    if before.len() != after.len() {
        return None;
    }
    let mut out = BTreeMap::new();
    for (id, now) in after {
        let was = before.get(id)?;
        if was == now {
            continue;
        }
        let (Value::Object(w), Value::Object(n)) = (was, now) else {
            return None;
        };
        if w.iter().any(|(k, v)| k != "at" && n.get(k) != Some(v))
            || n.keys().any(|k| !w.contains_key(k) && k != "at")
        {
            return None;
        }
        let ((a, rest_a), (b, rest_b)) = (pos(was)?, pos(now)?);
        if rest_a != rest_b {
            return None;
        }
        out.insert(id.clone(), [b[0] - a[0], b[1] - a[1]]);
    }
    let parents = after
        .values()
        .filter_map(|i| i.get("parent").and_then(Value::as_str));
    for parent in parents {
        if out.contains_key(parent) {
            return None;
        }
    }
    Some(out)
}

impl Flat {
    /// `doc`'s motion program, in the look's roles and (#1561) its drawn fields; the code and
    /// path of what it can't compile.
    pub fn new(
        doc: &Value,
        look: &CallLook,
        planted: Option<Planted>,
    ) -> Result<Flat, (&'static str, String)> {
        let doc = doc.as_object().cloned().unwrap_or_default();
        let program = Program::compile(&doc).map_err(|r| (r.code, r.path))?;
        let mut state = program.state();
        program.evaluate(0, eval::Validity::Full, &mut state);
        let roles: BTreeMap<String, [f64; 3]> = look
            .roles
            .iter()
            .map(|(k, c)| (k.clone(), c.map(|v| f64::from(v) / 255.0)))
            .collect();
        // A drawing look's fields as film2d reads them: at the document's size.
        let size = [0, 1].map(|i| doc["size"][i].as_f64().unwrap_or(0.0));
        let drawn = match (&look.drawn, planted) {
            (None, _) | (_, Some(Planted::LivePassesNoPage)) => None,
            (Some(_), _) => drawn::read_look(&look.def, size).map_err(|r| (r.code, r.path))?,
        };
        // The paper's fields hold still; each frame's camera and lamps place the pixels on it.
        let page = match &drawn {
            Some(d) => Some(frame2::page_of(d, &doc, &roles, &look.assets)?),
            None => None,
        };
        let mut flat = Flat {
            doc,
            program,
            state,
            palette: look.roles.clone(),
            roles,
            ty: Type {
                drawn,
                ..Type::default()
            },
            page,
            vello: None,
            groups: None,
            last: None,
            reused: false,
            drops_page: planted == Some(Planted::ReuseDropsPage),
            shown: None,
            low: None,
            plant: planted.and_then(Planted::composed),
        };
        flat.frame(0)?;
        Ok(flat)
    }

    /// The frame at `t`: the ground, then every layer's marks in order, as its camera places
    /// them; a look's paper is the ground in the ground mark's place.
    fn frame(&mut self, t: i64) -> Result<&[Drawn], (&'static str, String)> {
        self.program
            .evaluate(t, eval::Validity::Full, &mut self.state);
        let mut items = eval::items(&self.doc, &self.program, &self.state);
        let look = (&self.palette, &self.ty);
        self.page = frame2::placed(&self.doc, &mut items, look, self.page.as_ref())
            .map_err(|r| (r.code, r.path))?;
        let reused = self.last.as_ref().and_then(|(before, (marks, ends))| {
            let moves = moved(before, &items)?;
            let marks = marks
                .iter()
                .map(|d| {
                    let id = d.mark.item().split('#').next().unwrap_or_default();
                    match moves.get(id) {
                        Some(by) => d.translated(*by),
                        None => Some(d.clone()),
                    }
                })
                .collect::<Option<Vec<Drawn>>>()?;
            Some((marks, ends.clone(), !moves.is_empty()))
        });
        let (marks, ends) = match reused {
            // The same items again are the same frame, reused or laid out as it was.
            Some((marks, ends, moved)) => {
                self.reused |= moved;
                (marks, ends)
            }
            None => {
                self.reused = false;
                self.build(&items, t)?
            }
        };
        let (_, (marks, _)) = self.last.insert((items, (marks, ends)));
        Ok(marks)
    }

    fn build(&self, items: &Map<String, Value>, t: i64) -> Result<Marks, (&'static str, String)> {
        let record = Record {
            pinned: t,
            ..Record::default()
        };
        let frame = scene::frame_planted(
            &self.doc,
            items,
            (&self.palette, &self.ty),
            &record,
            1.0,
            scene::Planted::None,
        )
        .map_err(|r| (r.code, r.path))?;
        let (mut out, mut ends) = (Vec::new(), Vec::new());
        if self.page.as_ref().is_none_or(|p| p.sheet.is_none()) {
            out.push(Drawn {
                mark: Mark::Rect {
                    item: String::new(),
                    bounds: [0.0, 0.0, frame.size[0], frame.size[1]],
                    radius: 0.0,
                    fill: Fill::Solid(frame.ground),
                },
                clip: None,
                scopes: Vec::new(),
            });
            ends.push(1);
        }
        for l in &frame.layers {
            out.extend(l.marks.iter().map(|m| Drawn::clone(m)));
            ends.push(out.len());
        }
        Ok((out, ends))
    }

    /// #1561: whether the frame it last made moved an earlier frame's marks, and laid none out.
    pub fn reused(&self) -> bool {
        self.reused
    }

    /// #467: whether the frame at `t` draws the same marks the view last drew, on the same page,
    /// so the view keeps its last frame and records nothing (a still item costs nothing per
    /// frame).
    pub fn still(&mut self, t: i64) -> Result<bool, (&'static str, String)> {
        let shown = self.shown.take();
        let same = shown.as_ref().map(|(marks, _)| marks.as_slice()) == Some(self.frame(t)?)
            && shown.as_ref().is_some_and(|(_, page)| *page == self.page);
        self.shown = shown;
        Ok(same)
    }

    /// Records the frame at `t` into `slot`, `size` px, timed by `timer` as `session`'s. With
    /// `below`, the view's surface under internal scale 1, the frame draws at its internal size,
    /// every u that many px, and returns to `size` through the upscale's two passes.
    #[allow(clippy::too_many_arguments)]
    pub fn draw(
        &mut self,
        device: &Device,
        t: i64,
        size: [u32; 2],
        slot: &wgpu::TextureView,
        encoder: &mut wgpu::CommandEncoder,
        timer: &mut Timer,
        session: usize,
        below: Option<(&Upscale, Surface)>,
    ) -> Result<(), (&'static str, String)> {
        let mut vello = self
            .vello
            .take()
            .unwrap_or_else(|| Vello2d::new(&device.device, FORMAT));
        let internal = below.map_or(size, |(_, s)| surface::scaled(size, s.scale));
        let below = below.filter(|_| internal != size);
        if let Some((up, _)) = below {
            let fits = |l: &Low| l.internal == internal && l.size == size;
            if !self.low.as_ref().is_some_and(fits) {
                self.low = Some(Low::new(device, up, internal, size));
            }
        }
        let zoom = below.map_or(1.0, |(_, s)| s.scale);
        let target = &match (&self.low, below) {
            (Some(low), Some(_)) => low.view.clone(),
            _ => slot.clone(),
        };
        let size = internal;
        let marks = self.frame(t)?.to_vec();
        self.shown = Some((marks.clone(), self.page.clone()));
        // A look's paper and relief draw in the compositor, as a composited group does.
        let on_paper = frame2::on_paper(self.page.as_ref());
        // `--planted reuse_drops_page`: a reused frame goes to Vello GPU alone, which has no page.
        let paged = !(self.reused && self.drops_page);
        let i = timer.start(FLAT_PASS, session);
        let (begin, end) = timer.bracket(i);
        let drawn = if paged && (on_paper || groups::composited(marks.iter())) {
            // The compositor submits as it goes, so the frame's first stamp goes ahead of it.
            let mut first = device.device.create_command_encoder(&Default::default());
            mark_pass(&mut first, target, begin);
            device.queue.submit([first.finish()]);
            self.composed(device, &mut vello, t, size, zoom, target, encoder)
        } else {
            // No pass of a group runs in a frame Vello draws alone.
            self.groups.iter_mut().for_each(|g| g.ran.clear());
            mark_pass(encoder, target, begin);
            vello.draw(
                &device.device,
                &device.queue,
                encoder,
                marks.iter(),
                size,
                target,
                Options {
                    zoom,
                    ..Options::default()
                },
            )
        };
        mark_pass(encoder, target, end);
        timer.end(i);
        // Each operator a group's pass named ran in this frame: a pass row under its name, so a
        // frame that dispatches one says so, and a still canvas, which draws no frame, none.
        for op in self.groups.iter().flat_map(|g| g.ran.clone()) {
            let k = timer.start(deep_effects_render::docops::mark_of(&op), session);
            let (from, to) = timer.bracket(k);
            mark_pass(encoder, target, from);
            mark_pass(encoder, target, to);
            timer.end(k);
        }
        if let (Some(low), Some((up, s))) = (&mut self.low, below) {
            low.hold(device, s.sharpen);
            for name in [UPSCALE_PASS, SHARPEN_PASS] {
                let step = low.step(up, &s, surface::Planted::default(), name, slot);
                let k = timer.start(step.name(), session);
                step.record(encoder, timer.writes(k));
                timer.end(k);
            }
        }
        self.vello = Some(vello);
        drawn.map_err(|e| ("not_drawn", e.to_string()))
    }
}

impl Flat {
    /// The last frame through the group compositor, each writer layer alone.
    fn composed(
        &mut self,
        device: &Device,
        vello: &mut Vello2d,
        t: i64,
        size: [u32; 2],
        zoom: f64,
        target: &wgpu::TextureView,
        encoder: &mut wgpu::CommandEncoder,
    ) -> Result<(), serde_json::Value> {
        let Some((_, (marks, ends))) = &self.last else {
            return Ok(());
        };
        let mut layers: Vec<Vec<Arc<Drawn>>> = Vec::with_capacity(ends.len());
        let mut from = 0;
        for &end in ends {
            layers.push(marks[from..end].iter().cloned().map(Arc::new).collect());
            from = end;
        }
        let slices: Vec<&[Arc<Drawn>]> = layers.iter().map(Vec::as_slice).collect();
        let clock = Clock::of(&self.doc, t);
        let mut layer = frame2::layer(&slices, size, clock, &self.roles, self.page.as_ref());
        layer.options.zoom = zoom;
        layer.planted = self.plant;
        let groups = self
            .groups
            .get_or_insert_with(|| Groups::new(&device.device));
        let (done, ..) = groups.compose(device, vello, &layer)?;
        groups.finish(&device.device, encoder, &done, target, FORMAT, false);
        Ok(())
    }
}

/// An empty pass on `target` that only writes a timestamp, so passes another renderer records
/// between two of them are timed as one.
fn mark_pass(
    encoder: &mut wgpu::CommandEncoder,
    target: &wgpu::TextureView,
    writes: Option<wgpu::RenderPassTimestampWrites<'_>>,
) {
    if writes.is_none() {
        return;
    }
    let _ = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
        label: Some(FLAT_PASS),
        color_attachments: &[Some(wgpu::RenderPassColorAttachment {
            view: target,
            resolve_target: None,
            depth_slice: None,
            ops: wgpu::Operations {
                load: wgpu::LoadOp::Load,
                store: wgpu::StoreOp::Store,
            },
        })],
        timestamp_writes: writes,
        ..Default::default()
    });
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::is_flat;

    /// #1561: under a camera only a 2D film is 2D. A document that holds anything of scene3d's
    /// stays the 3D path's, whatever its camera's projection.
    #[test]
    fn a_camera_makes_a_document_2d_only_when_it_holds_nothing_of_scene3ds() {
        let camera = json!({"kind": "camera@1", "params": {
            "projection": "orthographic", "target": [160, 90, 0], "view_width": 320}});
        let rect = json!({"kind": "rect@1", "params": {"box": [0, 0, 60, 60]}});
        let doc = |items| json!({"size": [320, 180], "camera": "cam", "items": items});
        assert!(is_flat(&json!({"size": [320, 180], "items": {"r": rect}})));
        assert!(is_flat(&doc(json!({"cam": camera, "r": rect}))));
        let ball = json!({"kind": "ball@1", "params": {"radius": 5, "segments": 16}});
        assert!(
            !is_flat(&doc(json!({"cam": camera, "ball": ball}))),
            "a ball under an orthographic camera"
        );
        let sky = json!({"kind": "sky@1", "params": {}});
        assert!(
            !is_flat(&doc(json!({"cam": camera, "r": rect, "sky": sky}))),
            "a sky over 2D marks"
        );
    }
}

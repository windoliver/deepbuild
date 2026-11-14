//! Issue #397: a 2D document in the live window, such as a chart with no camera. Each frame
//! evaluates its items at t through the motion program, lays them out by marks2d in the look's
//! roles, and draws the marks by Vello GPU into the view's slot, over the look's ground; its
//! passes are timed as one pass of the session's. A frame where items only moved, by `at.pos`
//! alone and with no children, reuses the last frame's marks moved with them, so a panned series
//! is decimated once (Series and decimation: first decimation O(rows), then O(px)); a frame is the
//! same either way.

use std::collections::BTreeMap;
use std::sync::Arc;

use deep_canvas_marks::scene::{self, Drawn, Fill, Mark, Palette, Record};
use deep_canvas_motion::eval;
use deep_canvas_motion::program::{Program, State};
use deep_gpu::device::Device;
use deep_gpu::surface::FORMAT;
use deep_marks_render::gpu::{Options, Vello2d};
use serde_json::{Map, Value};

use crate::groups::{self, Clock, Groups, Layer};
use crate::liveview::Timer;

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
    vello: Option<Vello2d>,
    groups: Option<Groups>,
    /// The last frame's evaluated items and marks, and where each writer layer's marks end.
    last: Option<(Map<String, Value>, Marks)>,
    /// #467: the marks the view last drew; a frame with the same marks draws nothing.
    shown: Option<Vec<Drawn>>,
}

/// Whether a document draws as 2D in the live window: it names no camera.
pub fn is_flat(doc: &Value) -> bool {
    doc.get("camera").is_none()
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
    /// `doc`'s motion program, in the look's roles; the code and path of what it can't compile.
    pub fn new(doc: &Value, palette: &Palette) -> Result<Flat, (&'static str, String)> {
        let doc = doc.as_object().cloned().unwrap_or_default();
        let program = Program::compile(&doc).map_err(|r| (r.code, r.path))?;
        let mut state = program.state();
        program.evaluate(0, eval::Validity::Full, &mut state);
        let mut flat = Flat {
            doc,
            program,
            state,
            palette: palette.clone(),
            roles: palette
                .iter()
                .map(|(k, c)| (k.clone(), c.map(|v| f64::from(v) / 255.0)))
                .collect(),
            vello: None,
            groups: None,
            last: None,
            shown: None,
        };
        flat.frame(0)?;
        Ok(flat)
    }

    /// The frame at `t`: the ground, then every layer's marks in order.
    fn frame(&mut self, t: i64) -> Result<&[Drawn], (&'static str, String)> {
        self.program
            .evaluate(t, eval::Validity::Full, &mut self.state);
        let items = eval::items(&self.doc, &self.program, &self.state);
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
            Some((marks, ends.clone()))
        });
        let (marks, ends) = match reused {
            Some(made) => made,
            None => self.build(&items, t)?,
        };
        let (_, (marks, _)) = self.last.insert((items, (marks, ends)));
        Ok(marks)
    }

    fn build(&self, items: &Map<String, Value>, t: i64) -> Result<Marks, (&'static str, String)> {
        let record = Record {
            pinned: t,
            ..Record::default()
        };
        let frame = scene::frame(&self.doc, items, &self.palette, &record, 1.0)
            .map_err(|r| (r.code, r.path))?;
        let ground = Drawn {
            mark: Mark::Rect {
                item: String::new(),
                bounds: [0.0, 0.0, frame.size[0], frame.size[1]],
                radius: 0.0,
                fill: Fill::Solid(frame.ground),
            },
            clip: None,
            scopes: Vec::new(),
        };
        let mut out = vec![ground];
        let mut ends = vec![1];
        for l in &frame.layers {
            out.extend(l.marks.iter().map(|m| Drawn::clone(m)));
            ends.push(out.len());
        }
        Ok((out, ends))
    }

    /// #467: whether the frame at `t` draws the same marks the view last drew, so the view keeps
    /// its last frame and records nothing (a still item costs nothing per frame).
    pub fn still(&mut self, t: i64) -> Result<bool, (&'static str, String)> {
        let shown = self.shown.take();
        let same = shown.as_deref() == Some(self.frame(t)?);
        self.shown = shown;
        Ok(same)
    }

    /// Records the frame at `t` into `target`, `size` px, timed by `timer` as `session`'s.
    #[allow(clippy::too_many_arguments)]
    pub fn draw(
        &mut self,
        device: &Device,
        t: i64,
        size: [u32; 2],
        target: &wgpu::TextureView,
        encoder: &mut wgpu::CommandEncoder,
        timer: &mut Timer,
        session: usize,
    ) -> Result<(), (&'static str, String)> {
        let mut vello = self
            .vello
            .take()
            .unwrap_or_else(|| Vello2d::new(&device.device, FORMAT));
        let marks = self.frame(t)?.to_vec();
        self.shown = Some(marks.clone());
        let i = timer.start(FLAT_PASS, session);
        let (begin, end) = timer.bracket(i);
        let drawn = if groups::composited(marks.iter()) {
            // The compositor submits as it goes, so the frame's first stamp goes ahead of it.
            let mut first = device.device.create_command_encoder(&Default::default());
            mark_pass(&mut first, target, begin);
            device.queue.submit([first.finish()]);
            self.composed(device, &mut vello, t, size, target, encoder)
        } else {
            mark_pass(encoder, target, begin);
            vello.draw(
                &device.device,
                &device.queue,
                encoder,
                marks.iter(),
                size,
                target,
                Options::default(),
            )
        };
        mark_pass(encoder, target, end);
        timer.end(i);
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
        let layer = Layer {
            layers: &slices,
            size,
            options: Options::default(),
            clock: Clock::of(&self.doc, t),
            roles: &self.roles,
            packs: &[],
            canonical: false,
            base: None,
            keep: false,
            planted: None,
            guard: None,
            other: None,
            page: None,
            ground: false,
        };
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

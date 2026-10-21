//! A viewer's session over a document (issue #372; canvas primitives: Scope and input classes):
//! the camera you move, hover and the view-class controls are session state and never enter
//! the document; a document-class control's entry goes on the input track. The session hands
//! the document back as it came in, so its revision hash is the saved one.
//!
//! The input track here is the session's `track`, apart from the document: the #372
//! acceptance tests hold the handed-back document's hash to the saved one after a
//! document-class entry, so appending the entry to the envelope's `inputs` map (the record's
//! form of the track) lands with the record, not this slice.

use serde_json::{json, Map, Value};

use crate::camera::{
    add, ease_in_out_cubic, scale, sub, Offsets, Pivot, Pose, Projector, Refused, Vec3, ZoomAt,
    FLICKS_PER_SECOND,
};
use crate::document::member;
use crate::draw::{bounds_of, scene, Class, Drawn, Goto, Scene, Shape};
use crate::render::quad_contains;

/// A closed-form eased move on the session's clock, from what was shown when it began.
#[derive(Clone, Copy, Debug)]
struct Eased {
    /// `camera.goto`: the pan it starts from and the pan it ends at.
    pan: Option<(Vec3, Vec3)>,
    /// `camera.reset`: the offsets it eases out.
    reset: Option<Offsets>,
    start: i64,
    span: i64,
}

impl Eased {
    /// The eased share of the move at `t`, 1 once it is over.
    fn share(&self, t: i64) -> f64 {
        if self.span <= 0 {
            return 1.0;
        }
        ease_in_out_cubic((t - self.start) as f64 / self.span as f64)
    }
}

/// The session's state after an input.
struct Session<'a> {
    scene: &'a Scene,
    viewport: [f64; 2],
    offsets: Offsets,
    view: Map<String, Value>,
    hover: Option<String>,
    track: Vec<Value>,
    /// The session's clock, in flicks; every input lands at or after the last.
    t: i64,
    /// Where the pointer rests after a hover, until a button is held.
    rest: Option<[f64; 2]>,
    focus: bool,
    reduced_motion: bool,
    goto: Option<Eased>,
    reset: Option<Eased>,
    /// The last entry on each viewer-class control: what a goto by key reads.
    entries: Map<String, Value>,
}

impl<'a> Session<'a> {
    fn pose(&self) -> Pose {
        self.scene.spec.pose(&self.scene.rig, &self.offsets)
    }

    fn projector(&self) -> Projector {
        Projector::new(&self.pose(), self.viewport, self.viewport)
    }

    fn shown(&self, item: &Drawn) -> bool {
        self.scene.shown(item, &self.view)
    }

    /// The content's bounds: the union of the drawn items' boxes under the view, or none
    /// with no content.
    fn content_bounds(&self) -> Option<[Vec3; 2]> {
        crate::draw::union(
            self.scene
                .items
                .iter()
                .filter(|i| self.shown(i))
                .map(|i| bounds_of(i.shape)),
        )
    }

    /// Keeps the target inside the content's bounds widened by the margin, each axis by its
    /// own extent. A target authored or framed outside them starts where it is and may only
    /// come in, never go further out, so no input snaps the view and none escapes.
    fn clamp_pan(&mut self, before: Vec3) {
        let user = &self.scene.spec.user;
        if !user.pan_bounds_content {
            return;
        }
        let Some([low, high]) = self.content_bounds() else {
            return;
        };
        let target = self.scene.spec.target;
        for axis in 0..3 {
            let margin = (high[axis] - low[axis]) * user.pan_margin;
            let was = target[axis] + before[axis];
            let at = (target[axis] + self.offsets.pan[axis]).clamp(
                (low[axis] - margin).min(was),
                (high[axis] + margin).max(was),
            );
            self.offsets.pan[axis] = at - target[axis];
        }
    }

    /// Whether a pointer is in the view; outside it has left, and rests at no edge.
    fn inside(&self, at: [f64; 2]) -> bool {
        (0.0..=self.viewport[0]).contains(&at[0]) && (0.0..=self.viewport[1]).contains(&at[1])
    }

    /// The edge the pointer rests at, as a screen direction, or none: toward the nearer edge
    /// it is within the margin of; a tie is neither, and a rate of 0 pans nothing.
    fn edge_direction(&self) -> Option<(f64, f64)> {
        let edge = self.scene.spec.user.pan_edge.filter(|e| e.rate > 0.0)?;
        let at = self.rest?;
        if !self.focus {
            return None;
        }
        let side = |p: f64, size: f64| {
            let (low, high) = (p <= edge.margin, p >= size - edge.margin);
            match (low, high) {
                (true, false) => -1.0,
                (false, true) => 1.0,
                (true, true) if p < size - p => -1.0,
                (true, true) if p > size - p => 1.0,
                _ => 0.0,
            }
        };
        let (dx, dy) = (side(at[0], self.viewport[0]), side(at[1], self.viewport[1]));
        (dx != 0.0 || dy != 0.0).then_some((dx, dy))
    }

    /// Brings the session to `t`: an edge pan already running at the last input is your
    /// input through the whole interval, so it ends an eased move there and then (the pose
    /// is the same however often the clock is sampled); otherwise the eased moves under way
    /// reach their share at `t`.
    fn settle(&mut self, t: i64) {
        let seconds = (t - self.t) as f64 / FLICKS_PER_SECOND as f64;
        let edge = self.edge_direction().filter(|_| seconds > 0.0);
        if let Some((dx, dy)) = edge {
            // The edge pan owns the target from here: a jump ends, and a reset goes on
            // easing the turn and the zoom while its pan is the edge pan's.
            self.goto = None;
            if let Some(reset) = &mut self.reset {
                reset.pan = None;
            }
            let rate = self.scene.spec.user.pan_edge.map_or(0.0, |e| e.rate);
            // While a reset eases the turn and the zoom, the pan runs in the frame the reset
            // ends in (the authored view at zoom 1), so its path is one closed form however
            // often the clock is sampled.
            let view = if self.reset.is_some() {
                let settled = Offsets {
                    pan: self.offsets.pan,
                    ..Offsets::default()
                };
                Projector::new(
                    &self.scene.spec.pose(&self.scene.rig, &settled),
                    self.viewport,
                    self.viewport,
                )
            } else {
                self.projector()
            };
            let step = rate * view.pose().view_width * seconds;
            self.pan_in(&view, dx * step, dy * step);
        }
        // The pan of a jump, or of a reset the edge has not taken, read before a finished
        // reset is dropped.
        let eased = self.goto.or(self.reset);
        if let Some(reset) = self.reset {
            let keep = 1.0 - reset.share(t);
            let from = reset.reset.unwrap_or_default();
            self.offsets.azimuth = from.azimuth * keep;
            self.offsets.elevation = from.elevation * keep;
            // The zoom eases in its log, so a factor of 4 is 2 at the half.
            self.offsets.zoom = crate::ops::exp(crate::ops::log(from.zoom) * keep);
            if keep <= 0.0 {
                self.offsets.azimuth = 0.0;
                self.offsets.elevation = 0.0;
                self.offsets.zoom = 1.0;
                self.reset = None;
            }
        }
        if let Some(Eased {
            pan: Some((from, to)),
            ..
        }) = eased
        {
            let share = eased.map_or(1.0, |e| e.share(t));
            let shown = self.offsets.pan;
            self.offsets.pan = if share >= 1.0 {
                to
            } else {
                add(from, scale(sub(to, from), share))
            };
            // The bounds are the content shown now, which a view control may have shrunk
            // since the move began: each sample stays inside them, or no further out.
            self.clamp_pan(shown);
            if share >= 1.0 {
                self.goto = None;
            }
        }
        self.t = t;
    }

    /// Moves the target in the view plane by screen right and screen down, inside the bounds.
    fn pan_by(&mut self, right: f64, down: f64) {
        let view = self.projector();
        self.pan_in(&view, right, down);
    }

    /// A pan in the plane of `view`, by screen right and screen down as the frame is rolled.
    fn pan_in(&mut self, view: &Projector, right: f64, down: f64) {
        let step = view.screen_step(right, down);
        let was = self.offsets.pan;
        self.offsets.pan = add(self.offsets.pan, step);
        self.clamp_pan(was);
    }

    /// A new offset of your own ends an eased move where it is.
    fn take_over(&mut self) {
        self.goto = None;
        self.reset = None;
    }

    /// `camera.goto`: an eased pan of the target to `point`, inside the bounds, from the pan
    /// shown; a cut with reduced motion.
    fn start_goto(&mut self, point: Vec3, ease: f64) {
        self.take_over();
        let from = self.offsets.pan;
        self.offsets.pan = sub(point, self.scene.spec.target);
        self.clamp_pan(from);
        let to = self.offsets.pan;
        let span = (ease * FLICKS_PER_SECOND as f64) as i64;
        if self.reduced_motion || span <= 0 {
            return;
        }
        self.offsets.pan = from;
        self.goto = Some(Eased {
            pan: Some((from, to)),
            reset: None,
            start: self.t,
            span,
        });
    }

    /// `camera.reset`: the offsets ease out over `yield.ease_back`; a cut with reduced motion.
    fn start_reset(&mut self) {
        self.take_over();
        let from = self.offsets;
        // The pan eases back to the authored target as far as the bounds allow: a target
        // authored outside them, once brought in, never goes back out.
        self.offsets.pan = [0.0, 0.0, 0.0];
        self.clamp_pan(from.pan);
        let to = self.offsets.pan;
        let span = (self.scene.spec.ease_back * FLICKS_PER_SECOND as f64) as i64;
        if self.reduced_motion || span <= 0 {
            self.offsets = Offsets {
                pan: to,
                ..Offsets::default()
            };
            return;
        }
        self.offsets = from;
        self.reset = Some(Eased {
            pan: Some((from.pan, to)),
            reset: Some(from),
            start: self.t,
            span,
        });
    }

    fn drag(&mut self, at: [f64; 2], delta: [f64; 2]) {
        let spec = &self.scene.spec;
        if self.scene.rig.flat {
            // The content follows the pointer.
            let view = self.projector();
            let was = self.offsets.pan;
            let before = view.unproject_flat(at[0], at[1]);
            let after = view.unproject_flat(at[0] + delta[0], at[1] + delta[1]);
            self.offsets.pan[0] -= after[0] - before[0];
            self.offsets.pan[1] -= after[1] - before[1];
            self.clamp_pan(was);
            return;
        }
        let user = spec.user;
        self.turn(delta[0] * user.turn, delta[1] * user.tilt);
    }

    /// Turns a 3D camera by degrees of azimuth and elevation, inside its yaw and pitch.
    fn turn(&mut self, azimuth: f64, elevation: f64) {
        let user = self.scene.spec.user;
        let rig = &self.scene.rig;
        let azimuth = self.offsets.azimuth + azimuth;
        // The full turn is no limit, and the offset wraps so no run of drags grows it without
        // bound; anything narrower holds the azimuth about the shot's.
        self.offsets.azimuth = if user.yaw[1] - user.yaw[0] >= 360.0 {
            // As the signed residual, so a reset eases the short way back.
            (azimuth + 180.0).rem_euclid(360.0) - 180.0
        } else {
            azimuth.clamp(user.yaw[0], user.yaw[1])
        };
        let elevation = (rig.elevation + self.offsets.elevation + elevation)
            .clamp(user.pitch[0], user.pitch[1]);
        self.offsets.elevation = elevation - rig.elevation;
    }

    fn pinch(&mut self, at: [f64; 2], factor: f64) {
        let user = self.scene.spec.user;
        let zoom = (self.offsets.zoom * factor).clamp(user.zoom[0], user.zoom[1]);
        if user.zoom_at == ZoomAt::Center {
            self.offsets.zoom = zoom;
            return;
        }
        if self.scene.rig.flat {
            // The content point under the pointer stays under it.
            let was = self.offsets.pan;
            let under = self.projector().unproject_flat(at[0], at[1]);
            self.offsets.zoom = zoom;
            let after = self.projector().unproject_flat(at[0], at[1]);
            self.offsets.pan[0] += under[0] - after[0];
            self.offsets.pan[1] += under[1] - after[1];
            self.clamp_pan(was);
            return;
        }
        match user.pivot {
            Pivot::Target => {
                // The eye comes nearer (camera::Spec::pose) and the target slides in its
                // plane so the point of that plane under the pointer stays under it.
                let was = self.offsets.pan;
                let under = self.projector().unproject_at_target(at[0], at[1]);
                self.offsets.zoom = zoom;
                let after = self.projector().unproject_at_target(at[0], at[1]);
                self.offsets.pan = add(self.offsets.pan, sub(under, after));
                self.clamp_pan(was);
            }
            Pivot::Eye => {
                // The field of view narrows (camera::Spec::pose) and the view turns toward the
                // point under the pointer so it stays there, inside yaw and pitch: a few
                // Newton steps on the projected error, closed-form in all but count.
                let under = self.projector().unproject_at_target(at[0], at[1]);
                self.offsets.zoom = zoom;
                self.aim_at(under, at);
            }
        }
    }

    /// Turns the view so the world point `p` projects at the pixel `at`, as far as yaw and
    /// pitch allow.
    fn aim_at(&mut self, p: Vec3, at: [f64; 2]) {
        for _ in 0..4 {
            let view = self.projector();
            let Some(now) = view.project(p) else {
                return;
            };
            let error = [now.x - at[0], now.y - at[1]];
            if error[0].abs() < 1e-9 && error[1].abs() < 1e-9 {
                return;
            }
            // The projected shift per degree, measured on this pose.
            let step = view.degrees_per_px().max(1e-6);
            let before = self.offsets;
            self.turn(step, 0.0);
            let dx = self
                .projector()
                .project(p)
                .map(|q| [q.x - now.x, q.y - now.y]);
            self.offsets = before;
            self.turn(0.0, step);
            let dy = self
                .projector()
                .project(p)
                .map(|q| [q.x - now.x, q.y - now.y]);
            self.offsets = before;
            let (Some(dx), Some(dy)) = (dx, dy) else {
                return;
            };
            // Solve the 2 × 2 system for the degrees that cancel the error.
            let det = dx[0] * dy[1] - dx[1] * dy[0];
            if det.abs() < 1e-12 {
                return;
            }
            let a = (-error[0] * dy[1] + error[1] * dy[0]) / det * step;
            let e = (-dx[0] * error[1] + dx[1] * error[0]) / det * step;
            self.turn(a, e);
        }
    }

    /// The drawn, pickable item under the pointer: a flat document's topmost rectangle, or the
    /// nearest disc whose drawn shape covers it.
    fn pick(&self, at: [f64; 2]) -> Option<String> {
        let view = self.projector();
        // What draws on top wins, as the renderer stacks it (render::raster): the nearer
        // shape, and at one depth the later in item order.
        let mut hit: Option<((f64, usize), &'a str)> = None;
        let mut take = |rank: (f64, usize), id: &'a str| {
            if hit.is_none_or(|(best, _)| rank > best) {
                hit = Some((rank, id));
            }
        };
        for (index, item) in self.scene.items.iter().enumerate() {
            if !item.pickable || !self.shown(item) {
                continue;
            }
            match item.shape {
                Shape::Rect { x, y, w, h } => {
                    // The quadrilateral the renderer fills, its depth the corners' mean.
                    let corners = [
                        [x, y, 0.0],
                        [x + w, y, 0.0],
                        [x + w, y + h, 0.0],
                        [x, y + h, 0.0],
                    ]
                    .map(|c| view.project(c));
                    let [Some(a), Some(b), Some(c), Some(d)] = corners else {
                        continue;
                    };
                    let quad = [a, b, c, d].map(|p| [p.x, p.y]);
                    if quad_contains(quad, at[0], at[1]) {
                        let depth = (a.depth + b.depth + c.depth + d.depth) / 4.0;
                        take((-depth, index), &item.id);
                    }
                }
                Shape::Dot { pos, radius } => {
                    let Some(p) = view.project(pos) else {
                        continue;
                    };
                    let (dx, dy) = (at[0] - p.x, at[1] - p.y);
                    if dx * dx + dy * dy <= (radius * p.scale) * (radius * p.scale) {
                        take((-p.depth, index), &item.id);
                    }
                }
            }
        }
        hit.map(|(_, id)| id.to_string())
    }

    /// Whether every number of the pose is finite: a drag or a pinch of an absurd size can
    /// overflow what finite input allows, and no state is written from such a pose.
    fn finite(&self) -> bool {
        let pose = self.pose();
        [
            pose.azimuth,
            pose.elevation,
            pose.distance,
            pose.fov,
            pose.view_width,
            pose.zoom,
        ]
        .iter()
        .chain(pose.position.iter())
        .chain(pose.target.iter())
        .all(|n| n.is_finite())
    }

    fn state(&self) -> Value {
        json!({
            "camera": self.pose().to_json(),
            "view": self.view,
            "hover": self.hover,
            "t": self.t,
        })
    }

    fn apply(&mut self, index: usize, input: &Value) -> Result<(), Refused> {
        let path = format!("inputs/{index}");
        let bad = |what: &str| Refused::new("out_of_range", path.clone(), what);
        let point = |key: &str| -> Result<[f64; 2], Refused> {
            let pair = member(input, key).and_then(Value::as_array);
            match pair.map(|p| {
                (
                    p.first().and_then(Value::as_f64),
                    p.get(1).and_then(Value::as_f64),
                )
            }) {
                Some((Some(x), Some(y)))
                    if pair.is_some_and(|p| p.len() == 2) && x.is_finite() && y.is_finite() =>
                {
                    Ok([x, y])
                }
                _ => Err(Refused::new(
                    "out_of_range",
                    format!("{path}/{key}"),
                    "not two numbers",
                )),
            }
        };
        // The input's time on the session's clock, in flicks: absent, it lands with the last.
        let t = match member(input, "t") {
            None | Some(Value::Null) => self.t,
            Some(v) => match v.as_i64() {
                Some(t) if t >= self.t => t,
                _ => {
                    return Err(Refused::new(
                        "out_of_range",
                        format!("{path}/t"),
                        "whole flicks, at or after the last input",
                    ))
                }
            },
        };
        let was = (self.offsets, self.goto, self.reset, self.t);
        self.settle(t);
        match member(input, "op").and_then(Value::as_str) {
            Some("drag") => {
                self.take_over();
                self.rest = None;
                self.drag(point("at")?, point("delta")?);
            }
            Some("pinch") => {
                let factor = member(input, "scale").and_then(Value::as_f64);
                match factor {
                    Some(s) if s.is_finite() && s > 0.0 => {
                        self.take_over();
                        self.rest = None;
                        self.pinch(point("at")?, s);
                    }
                    _ => {
                        return Err(Refused::new(
                            "out_of_range",
                            format!("{path}/scale"),
                            "not above 0",
                        ))
                    }
                }
            }
            Some("scroll") => {
                let delta = member(input, "delta").and_then(Value::as_f64);
                match delta {
                    Some(d) if d.is_finite() => {
                        // A scroll zooms toward the pointer as a pinch does, by zoom_rate per px;
                        // no button is held, so the pointer rests where it scrolled.
                        let at = point("at")?;
                        self.take_over();
                        let factor = crate::ops::exp(-d * self.scene.spec.user.zoom_rate);
                        self.pinch(at, factor);
                        self.rest = self.inside(at).then_some(at);
                    }
                    _ => {
                        return Err(Refused::new(
                            "out_of_range",
                            format!("{path}/delta"),
                            "not a finite number",
                        ))
                    }
                }
            }
            Some("hover") => {
                let at = point("at")?;
                self.hover = self.pick(at);
                self.rest = self.inside(at).then_some(at);
            }
            // Losing focus ends the rest too: a pan needs a fresh hover after refocus.
            Some("focus") => match member(input, "value").and_then(Value::as_bool) {
                Some(focus) => {
                    self.focus = focus;
                    if !focus {
                        self.rest = None;
                    }
                }
                None => {
                    return Err(Refused::new(
                        "out_of_range",
                        format!("{path}/value"),
                        "true or false",
                    ))
                }
            },
            Some("control") => {
                let Some(id) = member(input, "control").and_then(Value::as_str) else {
                    return Err(bad("no control"));
                };
                let value = member(input, "value").cloned().unwrap_or(Value::Null);
                let Some(control) = self.scene.controls.get(id) else {
                    return Err(Refused::new(
                        "ref_unresolved",
                        format!("{path}/control"),
                        format!("names no control: {id}"),
                    ));
                };
                match control.class {
                    // Appended to the input track; the document itself is untouched here.
                    Class::Document => self.track.push(json!({"control": id, "value": value})),
                    Class::View => {
                        self.view.insert(id.to_string(), value);
                    }
                    // Navigating and pointing: session state the trace already shows, and
                    // the camera verbs.
                    Class::Viewer => self.viewer_entry(id, &value, &path)?,
                }
            }
            _ => {
                return Err(bad(
                    "op is one of drag, pinch, scroll, hover, focus, control",
                ))
            }
        }
        if !self.finite() {
            (self.offsets, self.goto, self.reset, self.t) = was;
            return Err(bad("the input moves the camera past what a number holds"));
        }
        Ok(())
    }

    /// An entry on a viewer-class control: a camera verb's own step, or a point a `camera.goto`
    /// names, which jumps the view there.
    fn viewer_entry(&mut self, id: &str, value: &Value, path: &str) -> Result<(), Refused> {
        let control = &self.scene.controls[id];
        let numbers = |value: &Value, n: usize| -> Option<Vec<f64>> {
            let list = value.as_array()?;
            if list.len() != n {
                return None;
            }
            list.iter()
                .map(|v| v.as_f64().filter(|x| x.is_finite()))
                .collect()
        };
        match control.verb.as_deref() {
            Some("camera.pan") => {
                let Some(step) = numbers(value, 2) else {
                    return Err(Refused::new(
                        "out_of_range",
                        format!("{path}/value"),
                        "two steps, right and down",
                    ));
                };
                let increment = control.increment.unwrap_or(0.0);
                self.take_over();
                self.pan_by(step[0] * increment, step[1] * increment);
            }
            Some("camera.reset") => self.start_reset(),
            Some("camera.goto") => {
                // The control's own key or button: to the point its point control holds now,
                // by this control's own map and ease.
                let (Some(goto), Some(held)) = (
                    control.goto.clone(),
                    control
                        .goto
                        .as_ref()
                        .and_then(|g| self.entries.get(&g.to).cloned()),
                ) else {
                    return Ok(());
                };
                self.jump(&goto, &held, path)?;
                return Ok(());
            }
            _ => {}
        }
        self.entries.insert(id.to_string(), value.clone());
        // A new entry on a point control: every goto that names it jumps there.
        let jumps: Vec<_> = self
            .scene
            .controls
            .values()
            .filter_map(|c| c.goto.as_ref())
            .filter(|g| g.to == id)
            .cloned()
            .collect();
        for goto in &jumps {
            self.jump(goto, value, path)?;
        }
        Ok(())
    }

    /// One goto to the point `value` names, by its map and ease.
    fn jump(&mut self, goto: &Goto, value: &Value, path: &str) -> Result<(), Refused> {
        let flat = self.scene.rig.flat;
        let numbers = |value: &Value, n: usize| -> Option<Vec<f64>> {
            let list = value.as_array()?;
            if list.len() != n {
                return None;
            }
            list.iter()
                .map(|v| v.as_f64().filter(|x| x.is_finite()))
                .collect()
        };
        {
            let point = match goto.map {
                // A cell to its centre on the ground, at the ground's height.
                Some((origin, cell)) => {
                    let Some(c) = numbers(value, 2) else {
                        return Err(Refused::new(
                            "out_of_range",
                            format!("{path}/value"),
                            "a cell, two numbers",
                        ));
                    };
                    let (x, y) = (
                        origin[0] + (c[0] + 0.5) * cell,
                        origin[1] + (c[1] + 0.5) * cell,
                    );
                    if flat {
                        [x, y, 0.0]
                    } else {
                        [x, 0.0, y]
                    }
                }
                None if flat => {
                    let Some(p) = numbers(value, 2) else {
                        return Err(Refused::new(
                            "out_of_range",
                            format!("{path}/value"),
                            "a point, two numbers in u",
                        ));
                    };
                    [p[0], p[1], 0.0]
                }
                None => {
                    let Some(p) = numbers(value, 3) else {
                        return Err(Refused::new(
                            "out_of_range",
                            format!("{path}/value"),
                            "a point, three numbers in m",
                        ));
                    };
                    [p[0], p[1], p[2]]
                }
            };
            self.start_goto(point, goto.ease);
        }
        Ok(())
    }
}

/// Runs the inputs over the document in a fresh session: the state before any and after each,
/// the input track, and the document as a save writes it, with its revision hash.
pub fn run(
    doc: &Value,
    viewport: [f64; 2],
    inputs: &[Value],
    reduced_motion: bool,
) -> Result<Value, Refused> {
    let scene = scene(doc)?;
    let mut session = Session {
        scene: &scene,
        viewport,
        offsets: Offsets::default(),
        view: scene.view_defaults(),
        hover: None,
        track: Vec::new(),
        t: 0,
        rest: None,
        focus: true,
        reduced_motion,
        goto: None,
        reset: None,
        // A viewer control holds its declared default until an entry replaces it.
        entries: scene
            .controls
            .iter()
            .filter(|(_, c)| c.class == Class::Viewer && !c.default.is_null())
            .map(|(id, c)| (id.clone(), c.default.clone()))
            .collect(),
    };
    let start = session.state();
    let mut trace = Vec::with_capacity(inputs.len());
    for (index, input) in inputs.iter().enumerate() {
        session.apply(index, input)?;
        trace.push(session.state());
    }
    let canonical = crate::document::canonical(doc)
        .map_err(|e| Refused::new("out_of_range", e.path, e.what))?;
    Ok(json!({
        "ok": true,
        "hash": canonical.sha256,
        "doc": doc,
        "track": session.track,
        "start": start,
        "trace": trace,
    }))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn doc(camera: Value, items: Value) -> Value {
        let mut items = items;
        items["cam"] = json!({"id": "cam", "kind": "camera@1", "layer": "main", "name": "C", "order": "a0", "params": camera});
        json!({
            "format": 1, "id": "d", "profile": "scene", "title": "T", "description": "D",
            "size": [100, 100], "camera": "cam",
            "layers": {"main": {"writer": "w", "title": "M", "order": "a0"}},
            "items": items
        })
    }

    #[test]
    fn an_orbit_camera_with_pivot_eye_keeps_its_authored_eye_under_drags_and_pinches() {
        let d = doc(
            json!({"orbit": {"azimuth": 30, "elevation": 20, "distance": 8}, "user": {"pivot": "eye", "zoom": [0.5, 4]}}),
            json!({}),
        );
        let inputs = vec![
            json!({"op": "drag", "at": [10, 10], "delta": [40, -25]}),
            json!({"op": "pinch", "at": [50, 50], "scale": 1.5}),
        ];
        let out = run(&d, [100.0, 100.0], &inputs, false).unwrap();
        let start = out["start"]["camera"]["position"].clone();
        for state in out["trace"].as_array().unwrap() {
            assert_eq!(state["camera"]["position"], start);
        }
        assert_ne!(
            out["trace"][0]["camera"]["target"],
            out["start"]["camera"]["target"]
        );
    }

    #[test]
    fn a_pointer_with_a_third_coordinate_is_refused() {
        let d = doc(json!({"orbit": {"distance": 8}}), json!({}));
        let inputs = vec![json!({"op": "hover", "at": [10, 20, 30]})];
        let err = run(&d, [100.0, 100.0], &inputs, false).unwrap_err();
        assert_eq!(err.path, "inputs/0/at");
    }

    #[test]
    fn a_drag_past_what_a_number_holds_is_refused_and_leaves_the_state_as_it_was() {
        // Two pans of 1e308 u on an unbounded board: the first is finite, the second is not.
        let d = doc(
            json!({"projection": "orthographic", "target": [50, 50, 0], "view_width": 100, "user": {"pan": {"bounds": "none"}}}),
            json!({}),
        );
        let drag = json!({"op": "drag", "at": [0, 0], "delta": [-1e308, 0]});
        let err = run(&d, [100.0, 100.0], &[drag.clone(), drag], false).unwrap_err();
        assert_eq!(err.path, "inputs/1");
    }

    #[test]
    fn a_disc_drawn_over_a_rectangle_is_the_one_picked() {
        // A flat document: the rectangle covers the view and the disc sits over its middle.
        let d = doc(
            json!({"projection": "orthographic", "target": [50, 50, 0], "view_width": 100}),
            json!({
                "r": {"id": "r", "kind": "test.rect@1", "layer": "main", "name": "R", "order": "a1", "params": {"w": 100, "h": 100}, "at": {"pos": [0, 0, 0]}},
                "d": {"id": "d", "kind": "test.dot@1", "layer": "main", "name": "D", "order": "a2", "params": {"radius": 5}, "at": {"pos": [50, 50, 0]}}
            }),
        );
        let inputs = vec![
            json!({"op": "hover", "at": [50, 50]}),
            json!({"op": "hover", "at": [10, 10]}),
        ];
        let out = run(&d, [100.0, 100.0], &inputs, false).unwrap();
        assert_eq!(out["trace"][0]["hover"], json!("d"));
        assert_eq!(out["trace"][1]["hover"], json!("r"));
    }

    #[test]
    fn a_rectangle_seen_in_perspective_is_picked_where_it_is_drawn() {
        // A 2 × 2 u square about the origin, seen from the front: its right edge projects
        // right of the centre, so a point just inside it hits and one just outside misses.
        let d = doc(
            json!({"position": [0, 0, 10], "target": [0, 0, 0], "fov": 90}),
            json!({"r": {"id": "r", "kind": "test.rect@1", "layer": "main", "name": "R", "order": "a1", "params": {"w": 2, "h": 2}, "at": {"pos": [-1, -1, 0]}}}),
        );
        // Focal 50 px at 90°: the square spans 10 px about the centre, [45, 55).
        let out = run(
            &d,
            [100.0, 100.0],
            &[
                json!({"op": "hover", "at": [54, 50]}),
                json!({"op": "hover", "at": [56, 50]}),
            ],
            false,
        )
        .unwrap();
        assert_eq!(out["trace"][0]["hover"], json!("r"));
        assert_eq!(out["trace"][1]["hover"], Value::Null);
    }

    #[test]
    fn a_3d_pinch_keeps_the_point_under_the_pointer_about_the_target_and_about_the_eye() {
        // Inside its bounds a pan follows the pointer; this scene's content is one mark, so the
        // bounds are off.
        for user in [
            json!({"zoom": [0.5, 4], "pan": {"bounds": "none"}}),
            json!({"zoom": [0.5, 4], "pivot": "eye"}),
        ] {
            let d = doc(
                json!({"position": [0, 0, 10], "target": [0, 0, 0], "fov": 40, "user": user}),
                json!({"m": {"id": "m", "kind": "test.dot@1", "layer": "main", "name": "M", "order": "a1", "params": {"radius": 0.01}, "at": {"pos": [1.5, -1, 0]}}}),
            );
            // The mark projects at some pixel; a pinch there must leave it there.
            let probe = run(
                &d,
                [200.0, 100.0],
                &[json!({"op": "hover", "at": [100, 50]})],
                false,
            )
            .unwrap();
            assert!(probe["ok"].as_bool().unwrap());
            let view = crate::camera::Projector::new(
                &scene(&d)
                    .unwrap()
                    .spec
                    .pose(&scene(&d).unwrap().rig, &Offsets::default()),
                [200.0, 100.0],
                [200.0, 100.0],
            );
            let at = view.project([1.5, -1.0, 0.0]).unwrap();
            let out = run(
                &d,
                [200.0, 100.0],
                &[
                    json!({"op": "pinch", "at": [at.x, at.y], "scale": 1.7}),
                    json!({"op": "hover", "at": [at.x, at.y]}),
                ],
                false,
            )
            .unwrap();
            assert_eq!(out["trace"][1]["hover"], json!("m"), "{user}");
            let centre_before = run(
                &d,
                [200.0, 100.0],
                &[json!({"op": "pinch", "at": [100, 50], "scale": 1.7})],
                false,
            )
            .unwrap();
            // A pinch at the centre only zooms.
            assert_eq!(
                centre_before["trace"][0]["camera"]["target"],
                json!([0.0, 0.0, 0.0])
            );
        }
    }

    #[test]
    fn of_two_discs_at_one_depth_the_later_in_order_is_picked_as_it_is_drawn() {
        let d = doc(
            json!({"position": [0, 0, 10], "target": [0, 0, 0], "fov": 40}),
            json!({
                "e": {"id": "e", "kind": "test.dot@1", "layer": "main", "name": "E", "order": "a1", "params": {"radius": 1}, "at": {"pos": [0, 0, 0]}},
                "l": {"id": "l", "kind": "test.dot@1", "layer": "main", "name": "L", "order": "a2", "params": {"radius": 1}, "at": {"pos": [0.1, 0, 0]}}
            }),
        );
        let out = run(
            &d,
            [100.0, 100.0],
            &[json!({"op": "hover", "at": [50, 50]})],
            false,
        )
        .unwrap();
        assert_eq!(out["trace"][0]["hover"], json!("l"));
    }

    const SECOND: i64 = 705_600_000;

    fn flat(items: Value, user: Value, controls: Value) -> Value {
        let mut d = doc(
            json!({"projection": "orthographic", "target": [50, 50, 0], "view_width": 100, "user": user}),
            items,
        );
        d["controls"] = controls;
        d
    }

    fn rect(id: &str, x: f64, y: f64, w: f64, h: f64) -> Value {
        json!({"id": id, "kind": "test.rect@1", "layer": "main", "name": id, "order": "a1", "params": {"w": w, "h": h, "fill": [1, 2, 3]}, "at": {"pos": [x, y, 0]}})
    }

    fn target(state: &Value) -> [f64; 3] {
        let t = state["camera"]["target"].as_array().unwrap();
        [
            t[0].as_f64().unwrap(),
            t[1].as_f64().unwrap(),
            t[2].as_f64().unwrap(),
        ]
    }

    #[test]
    fn a_scroll_zooms_by_zoom_rate_per_px_toward_the_pointer_inside_the_zoom_range() {
        let d = flat(
            json!({"r": rect("r", 0.0, 0.0, 100.0, 100.0)}),
            json!({"zoom": [0.5, 4], "zoom_rate": 0.01}),
            json!({}),
        );
        let out = run(
            &d,
            [100.0, 100.0],
            &[
                json!({"op": "scroll", "at": [25, 25], "delta": -50}),
                json!({"op": "scroll", "at": [25, 25], "delta": 1e6}),
            ],
            false,
        )
        .unwrap();
        let zoom = out["trace"][0]["camera"]["zoom"].as_f64().unwrap();
        assert!((zoom - crate::ops::exp(0.5)).abs() < 1e-9, "{zoom}");
        // The content point under the pointer, 25 u in from the edge at zoom 1, stays under it.
        let t = target(&out["trace"][0]);
        assert!(
            (t[0] - (25.0 + 25.0 / zoom)).abs() < 1e-9
                && (t[1] - (25.0 + 25.0 / zoom)).abs() < 1e-9,
            "{t:?}"
        );
        assert_eq!(out["trace"][1]["camera"]["zoom"], json!(0.5));
        assert_eq!(out["track"], json!([]));
    }

    #[test]
    fn a_pan_verb_on_a_viewer_control_moves_the_target_by_its_increment_inside_the_bounds() {
        let d = flat(
            json!({"r": rect("r", 0.0, 0.0, 100.0, 100.0)}),
            json!({}),
            json!({"keys": {"class": "viewer", "verb": "camera.pan", "increment": 5}}),
        );
        let out = run(
            &d,
            [100.0, 100.0],
            &[
                json!({"op": "control", "control": "keys", "value": [1, 0]}),
                json!({"op": "control", "control": "keys", "value": [0, 1]}),
                json!({"op": "control", "control": "keys", "value": [100, 0]}),
            ],
            false,
        )
        .unwrap();
        assert_eq!(target(&out["trace"][0]), [55.0, 50.0, 0.0]);
        assert_eq!(target(&out["trace"][1]), [55.0, 55.0, 0.0]);
        // Inside the content widened by the margin: 100 u plus a tenth.
        assert_eq!(target(&out["trace"][2]), [110.0, 55.0, 0.0]);
        assert_eq!(out["track"], json!([]));
    }

    #[test]
    fn a_goto_eases_the_target_to_the_point_controls_entry_and_cuts_with_reduced_motion() {
        let controls = |map: Value| {
            json!({
                "spot": {"class": "viewer", "kind": "point"},
                "jump": {"class": "viewer", "verb": "camera.goto", "goto": {"to": "spot", "map": map, "ease": 0.4}}
            })
        };
        let d = flat(
            json!({"r": rect("r", 0.0, 0.0, 100.0, 100.0)}),
            json!({}),
            controls(Value::Null),
        );
        let inputs = [
            json!({"op": "control", "control": "spot", "value": [80, 80], "t": 0}),
            json!({"op": "hover", "at": [1, 1], "t": SECOND / 5}),
            json!({"op": "hover", "at": [1, 1], "t": SECOND * 2 / 5}),
            json!({"op": "hover", "at": [1, 1], "t": SECOND}),
        ];
        let out = run(&d, [100.0, 100.0], &inputs, false).unwrap();
        assert_eq!(target(&out["trace"][0]), [50.0, 50.0, 0.0]);
        // in_out_cubic is a half at the half.
        assert_eq!(target(&out["trace"][1]), [65.0, 65.0, 0.0]);
        assert_eq!(target(&out["trace"][2]), [80.0, 80.0, 0.0]);
        assert_eq!(target(&out["trace"][3]), [80.0, 80.0, 0.0]);
        assert_eq!(out["track"], json!([]));
        // Reduced motion cuts.
        let cut = run(&d, [100.0, 100.0], &inputs[..1], true).unwrap();
        assert_eq!(target(&cut["trace"][0]), [80.0, 80.0, 0.0]);
        // A cell on a map goes to its centre, and a jump stops inside the pan bounds.
        let mapped = flat(
            json!({"r": rect("r", 0.0, 0.0, 100.0, 100.0)}),
            json!({}),
            controls(json!({"origin": [0, 0], "cell": 10})),
        );
        let out = run(
            &mapped,
            [100.0, 100.0],
            &[
                json!({"op": "control", "control": "spot", "value": [7, 7], "t": 0}),
                json!({"op": "hover", "at": [1, 1], "t": SECOND}),
                json!({"op": "control", "control": "spot", "value": [50, 50], "t": SECOND}),
                json!({"op": "hover", "at": [1, 1], "t": 2 * SECOND}),
            ],
            false,
        )
        .unwrap();
        assert_eq!(target(&out["trace"][1]), [75.0, 75.0, 0.0]);
        assert_eq!(target(&out["trace"][3]), [110.0, 110.0, 0.0]);
        // In 3D the jump keeps the orbit's angles and distance.
        let mut d3 = doc(
            json!({"orbit": {"azimuth": 30, "elevation": 20, "distance": 8}}),
            json!({}),
        );
        d3["controls"] = controls(Value::Null);
        let out = run(
            &d3,
            [100.0, 100.0],
            &[
                json!({"op": "control", "control": "spot", "value": [1, 2, 3], "t": 0}),
                json!({"op": "hover", "at": [1, 1], "t": SECOND}),
            ],
            false,
        )
        .unwrap();
        let end = &out["trace"][1]["camera"];
        assert_eq!(end["target"], json!([1.0, 2.0, 3.0]));
        assert_eq!(
            (
                end["azimuth"].as_f64().unwrap(),
                end["elevation"].as_f64().unwrap(),
                end["distance"].as_f64().unwrap()
            ),
            (30.0, 20.0, 8.0)
        );
    }

    #[test]
    fn a_goto_by_its_own_key_jumps_to_the_point_its_point_control_holds() {
        let d = flat(
            json!({"r": rect("r", 0.0, 0.0, 100.0, 100.0)}),
            json!({}),
            json!({
                "spot": {"class": "viewer", "kind": "point"},
                "jump": {"class": "viewer", "verb": "camera.goto", "goto": {"to": "spot", "ease": 0}}
            }),
        );
        let out = run(
            &d,
            [100.0, 100.0],
            &[
                json!({"op": "control", "control": "jump"}),
                json!({"op": "control", "control": "spot", "value": [80, 80]}),
                json!({"op": "drag", "at": [50, 50], "delta": [10, 0]}),
                json!({"op": "control", "control": "jump"}),
            ],
            false,
        )
        .unwrap();
        // Nothing held yet: nothing moves; then the drag leaves and the key returns.
        assert_eq!(target(&out["trace"][0]), [50.0, 50.0, 0.0]);
        assert_eq!(target(&out["trace"][1]), [80.0, 80.0, 0.0]);
        assert_eq!(target(&out["trace"][2]), [70.0, 80.0, 0.0]);
        assert_eq!(target(&out["trace"][3]), [80.0, 80.0, 0.0]);
        // A point control's declared default is what it holds before any entry.
        let mut d = d;
        d["controls"]["spot"]["default"] = json!([20, 30]);
        let out = run(
            &d,
            [100.0, 100.0],
            &[json!({"op": "control", "control": "jump"})],
            false,
        )
        .unwrap();
        assert_eq!(target(&out["trace"][0]), [20.0, 30.0, 0.0]);
    }

    #[test]
    fn a_reset_eases_a_small_turn_back_the_short_way() {
        let mut d = doc(
            json!({"orbit": {"azimuth": 30, "elevation": 20, "distance": 8}, "user": {"turn": 1}, "yield": {"ease_back": 2}}),
            json!({}),
        );
        d["controls"] = json!({"home": {"class": "viewer", "verb": "camera.reset"}});
        let out = run(
            &d,
            [100.0, 100.0],
            &[
                json!({"op": "drag", "at": [10, 10], "delta": [-10, 0], "t": 0}),
                json!({"op": "control", "control": "home", "t": 0}),
                json!({"op": "hover", "at": [1, 1], "t": SECOND}),
            ],
            false,
        )
        .unwrap();
        let az = |i: usize| out["trace"][i]["camera"]["azimuth"].as_f64().unwrap();
        assert!((az(0) - 20.0).abs() < 1e-9, "{}", az(0));
        assert!((az(2) - 25.0).abs() < 1e-9, "{}", az(2));
    }

    #[test]
    fn a_reset_sampled_past_its_end_or_through_it_returns_the_pan_too() {
        let d = flat(
            json!({"r": rect("r", 0.0, 0.0, 100.0, 100.0)}),
            json!({}),
            json!({"home": {"class": "viewer", "verb": "camera.reset"}}),
        );
        let mut d = d;
        d["items"]["cam"]["params"]["yield"] = json!({"ease_back": 1});
        let tail = |samples: &[i64]| {
            let mut inputs = vec![
                json!({"op": "drag", "at": [50, 50], "delta": [-20, -10], "t": 0}),
                json!({"op": "control", "control": "home", "t": 0}),
            ];
            inputs.extend(
                samples
                    .iter()
                    .map(|t| json!({"op": "hover", "at": [50, 50], "t": t})),
            );
            let out = run(&d, [100.0, 100.0], &inputs, false).unwrap();
            let last = out["trace"].as_array().unwrap().len() - 1;
            (target(&out["trace"][1]), target(&out["trace"][last]))
        };
        let (moved, sparse) = tail(&[2 * SECOND]);
        assert_eq!(moved, [70.0, 60.0, 0.0]);
        assert_eq!(sparse, [50.0, 50.0, 0.0]);
        let (_, dense) = tail(&[SECOND / 2, SECOND, 2 * SECOND]);
        assert_eq!(dense, sparse);
    }

    #[test]
    fn a_reset_pressed_at_a_resting_edge_still_eases_the_turn_and_zoom_out() {
        let mut d = doc(
            json!({"orbit": {"azimuth": 30, "elevation": 20, "distance": 8}, "user": {"turn": 1, "zoom": [0.5, 4], "pan": {"bounds": "none", "edge": {"margin": 8, "rate": 0.5}}}, "yield": {"ease_back": 1}}),
            json!({}),
        );
        d["controls"] = json!({"home": {"class": "viewer", "verb": "camera.reset"}});
        let out = run(
            &d,
            [100.0, 100.0],
            &[
                json!({"op": "drag", "at": [10, 10], "delta": [40, 0], "t": 0}),
                json!({"op": "pinch", "at": [50, 50], "scale": 4, "t": 0}),
                json!({"op": "hover", "at": [2, 50], "t": 0}),
                json!({"op": "control", "control": "home", "t": 0}),
                json!({"op": "hover", "at": [2, 50], "t": SECOND}),
            ],
            false,
        )
        .unwrap();
        let end = &out["trace"][4]["camera"];
        assert_eq!(
            (
                end["azimuth"].as_f64().unwrap(),
                end["zoom"].as_f64().unwrap()
            ),
            (30.0, 1.0)
        );
        assert_ne!(
            end["target"], out["start"]["camera"]["target"],
            "the edge pan moved the target"
        );
        // Sampled every quarter second, the pan lands where the one sample did.
        let dense = run(
            &d,
            [100.0, 100.0],
            &[
                json!({"op": "drag", "at": [10, 10], "delta": [40, 0], "t": 0}),
                json!({"op": "pinch", "at": [50, 50], "scale": 4, "t": 0}),
                json!({"op": "hover", "at": [2, 50], "t": 0}),
                json!({"op": "control", "control": "home", "t": 0}),
                json!({"op": "hover", "at": [2, 50], "t": SECOND / 4}),
                json!({"op": "hover", "at": [2, 50], "t": SECOND / 2}),
                json!({"op": "hover", "at": [2, 50], "t": 3 * SECOND / 4}),
                json!({"op": "hover", "at": [2, 50], "t": SECOND}),
            ],
            false,
        )
        .unwrap();
        let (a, b) = (target(&dense["trace"][7]), target(&out["trace"][4]));
        for axis in 0..3 {
            assert!((a[axis] - b[axis]).abs() < 1e-9, "{a:?} vs {b:?}");
        }
    }

    #[test]
    fn a_reset_with_no_ease_back_cuts_and_each_goto_control_jumps_by_its_own_map() {
        let mut d = doc(
            json!({"orbit": {"azimuth": 30, "elevation": 20, "distance": 8}, "user": {"turn": 1}, "yield": {"ease_back": 0}}),
            json!({}),
        );
        d["controls"] = json!({"home": {"class": "viewer", "verb": "camera.reset"}});
        let out = run(
            &d,
            [100.0, 100.0],
            &[
                json!({"op": "drag", "at": [10, 10], "delta": [40, 0]}),
                json!({"op": "control", "control": "home"}),
            ],
            false,
        )
        .unwrap();
        assert_eq!(out["trace"][1]["camera"], out["start"]["camera"]);
        let d = flat(
            json!({"r": rect("r", 0.0, 0.0, 100.0, 100.0)}),
            json!({}),
            json!({
                "spot": {"class": "viewer", "kind": "point"},
                "a": {"class": "viewer", "verb": "camera.goto", "goto": {"to": "spot", "ease": 0, "map": {"origin": [0, 0], "cell": 10}}},
                "b": {"class": "viewer", "verb": "camera.goto", "goto": {"to": "spot", "ease": 0, "map": {"origin": [50, 50], "cell": 2}}}
            }),
        );
        let out = run(
            &d,
            [100.0, 100.0],
            &[
                json!({"op": "control", "control": "spot", "value": [1, 1]}),
                json!({"op": "control", "control": "b"}),
                json!({"op": "control", "control": "a"}),
            ],
            false,
        )
        .unwrap();
        assert_eq!(target(&out["trace"][1]), [53.0, 53.0, 0.0]);
        assert_eq!(target(&out["trace"][2]), [15.0, 15.0, 0.0]);
    }

    #[test]
    fn an_edge_pan_takes_over_from_a_goto_under_way_without_a_jump() {
        let d = flat(
            json!({"r": rect("r", -500.0, -500.0, 1000.0, 1000.0)}),
            json!({"pan": {"edge": {"margin": 8, "rate": 0.5}}}),
            json!({
                "spot": {"class": "viewer", "kind": "point"},
                "jump": {"class": "viewer", "verb": "camera.goto", "goto": {"to": "spot", "ease": 1}}
            }),
        );
        let out = run(
            &d,
            [100.0, 100.0],
            &[
                json!({"op": "hover", "at": [2, 50], "t": 0}),
                json!({"op": "control", "control": "spot", "value": [80, 80], "t": 0}),
                json!({"op": "hover", "at": [2, 50], "t": SECOND / 2}),
                json!({"op": "hover", "at": [2, 50], "t": SECOND}),
            ],
            false,
        )
        .unwrap();
        // The pointer already rests at the edge when the jump starts: the edge pan is your
        // input from then on, so the jump ends at once and only the pan moves the view.
        assert_eq!(target(&out["trace"][2]), [25.0, 50.0, 0.0]);
        assert_eq!(target(&out["trace"][3]), [0.0, 50.0, 0.0]);
        // The same timeline sampled once lands at the same place.
        let sparse = run(
            &d,
            [100.0, 100.0],
            &[
                json!({"op": "hover", "at": [2, 50], "t": 0}),
                json!({"op": "control", "control": "spot", "value": [80, 80], "t": 0}),
                json!({"op": "hover", "at": [2, 50], "t": SECOND}),
            ],
            false,
        )
        .unwrap();
        assert_eq!(target(&sparse["trace"][2]), [0.0, 50.0, 0.0]);
        // A jump that starts before the pointer reaches the edge runs until it does.
        let later = run(
            &d,
            [100.0, 100.0],
            &[
                json!({"op": "control", "control": "spot", "value": [80, 80], "t": 0}),
                json!({"op": "hover", "at": [2, 50], "t": SECOND / 2}),
                json!({"op": "hover", "at": [2, 50], "t": SECOND}),
            ],
            false,
        )
        .unwrap();
        assert_eq!(target(&later["trace"][1]), [65.0, 65.0, 0.0]);
        assert_eq!(target(&later["trace"][2]), [40.0, 65.0, 0.0]);
    }

    #[test]
    fn a_3d_pinch_at_the_edge_keeps_the_target_inside_the_content_bounds() {
        let d = doc(
            json!({"position": [0, 0, 10], "target": [0, 0, 0], "fov": 40, "user": {"zoom": [0.5, 4], "pan": {"margin": 0}}}),
            json!({"m": {"id": "m", "kind": "test.dot@1", "layer": "main", "name": "M", "order": "a1", "params": {"radius": 0.5, "fill": [1, 2, 3]}, "at": {"pos": [0, 0, 0]}}}),
        );
        let out = run(
            &d,
            [100.0, 100.0],
            &[
                json!({"op": "pinch", "at": [99, 99], "scale": 4}),
                json!({"op": "scroll", "at": [1, 1], "delta": -1000}),
            ],
            false,
        )
        .unwrap();
        for state in out["trace"].as_array().unwrap() {
            let t = target(state);
            assert!(t.iter().all(|c| c.abs() <= 0.5 + 1e-9), "{t:?}");
        }
    }

    #[test]
    fn a_reset_eases_the_offsets_out_over_ease_back() {
        let mut d = doc(
            json!({"orbit": {"azimuth": 30, "elevation": 20, "distance": 8}, "user": {"turn": 1, "zoom": [0.5, 4]}, "yield": {"ease_back": 2}}),
            json!({}),
        );
        d["controls"] = json!({"home": {"class": "viewer", "verb": "camera.reset"}});
        let out = run(
            &d,
            [100.0, 100.0],
            &[
                json!({"op": "drag", "at": [10, 10], "delta": [40, 0], "t": 0}),
                json!({"op": "pinch", "at": [50, 50], "scale": 4, "t": 0}),
                json!({"op": "control", "control": "home", "t": SECOND}),
                json!({"op": "hover", "at": [1, 1], "t": 2 * SECOND}),
                json!({"op": "hover", "at": [1, 1], "t": 3 * SECOND}),
            ],
            false,
        )
        .unwrap();
        let az = |i: usize| out["trace"][i]["camera"]["azimuth"].as_f64().unwrap();
        let zoom = |i: usize| out["trace"][i]["camera"]["zoom"].as_f64().unwrap();
        assert_eq!((az(1), zoom(1)), (70.0, 4.0));
        assert_eq!((az(2), zoom(2)), (70.0, 4.0));
        assert!(
            (az(3) - 50.0).abs() < 1e-9 && (zoom(3) - 2.0).abs() < 1e-9,
            "{} {}",
            az(3),
            zoom(3)
        );
        assert_eq!((az(4), zoom(4)), (30.0, 1.0));
        assert_eq!(out["trace"][4]["camera"], out["start"]["camera"]);
    }

    #[test]
    fn an_edge_pan_moves_the_target_toward_the_resting_pointer_while_the_window_has_focus() {
        let d = flat(
            json!({"r": rect("r", -500.0, -500.0, 1000.0, 1000.0)}),
            json!({"pan": {"edge": {"margin": 8, "rate": 0.5}}}),
            json!({}),
        );
        let out = run(
            &d,
            [100.0, 100.0],
            &[
                json!({"op": "hover", "at": [2, 50], "t": 0}),
                json!({"op": "hover", "at": [2, 50], "t": SECOND}),
                json!({"op": "hover", "at": [97, 97], "t": SECOND}),
                json!({"op": "hover", "at": [97, 97], "t": 2 * SECOND}),
                json!({"op": "focus", "value": false, "t": 2 * SECOND}),
                json!({"op": "hover", "at": [97, 97], "t": 3 * SECOND}),
                json!({"op": "focus", "value": true, "t": 3 * SECOND}),
                json!({"op": "drag", "at": [97, 97], "delta": [0, 0], "t": 3 * SECOND}),
                json!({"op": "hover", "at": [50, 50], "t": 4 * SECOND}),
                json!({"op": "hover", "at": [50, 50], "t": 5 * SECOND}),
            ],
            false,
        )
        .unwrap();
        assert_eq!(target(&out["trace"][0]), [50.0, 50.0, 0.0]);
        // Half a view width a second, toward the left edge.
        assert_eq!(target(&out["trace"][1]), [0.0, 50.0, 0.0]);
        // A corner pans diagonally.
        assert_eq!(target(&out["trace"][3]), [50.0, 100.0, 0.0]);
        // Without focus, or with a button held, nothing moves.
        assert_eq!(target(&out["trace"][5]), [50.0, 100.0, 0.0]);
        assert_eq!(target(&out["trace"][8]), [50.0, 100.0, 0.0]);
        assert_eq!(target(&out["trace"][9]), [50.0, 100.0, 0.0]);
        assert_eq!(out["track"], json!([]));
        // A pointer outside the view, or a refocus with no new hover, pans nothing.
        let out = run(
            &d,
            [100.0, 100.0],
            &[
                json!({"op": "hover", "at": [-500, -500], "t": 0}),
                json!({"op": "hover", "at": [-500, -500], "t": SECOND}),
                json!({"op": "hover", "at": [2, 50], "t": SECOND}),
                json!({"op": "focus", "value": false, "t": SECOND}),
                json!({"op": "focus", "value": true, "t": SECOND}),
                json!({"op": "hover", "at": [-500, -500], "t": 2 * SECOND}),
            ],
            false,
        )
        .unwrap();
        assert_eq!(target(&out["trace"][1]), [50.0, 50.0, 0.0]);
        assert_eq!(target(&out["trace"][5]), [50.0, 50.0, 0.0]);
        // Margins wider than half the view: the nearer edge wins, the middle is neither.
        let wide = flat(
            json!({"r": rect("r", -500.0, -500.0, 1000.0, 1000.0)}),
            json!({"pan": {"edge": {"margin": 60, "rate": 0.5}}}),
            json!({}),
        );
        let out = run(
            &wide,
            [100.0, 100.0],
            &[
                json!({"op": "hover", "at": [97, 50], "t": 0}),
                json!({"op": "hover", "at": [97, 50], "t": SECOND}),
                json!({"op": "hover", "at": [50, 50], "t": SECOND}),
                json!({"op": "hover", "at": [50, 50], "t": 2 * SECOND}),
            ],
            false,
        )
        .unwrap();
        assert_eq!(target(&out["trace"][1]), [100.0, 50.0, 0.0]);
        assert_eq!(target(&out["trace"][3]), [100.0, 50.0, 0.0]);
        // A scroll moves the resting pointer too: away from the edge, the pan stops.
        let out = run(
            &d,
            [100.0, 100.0],
            &[
                json!({"op": "hover", "at": [2, 50], "t": 0}),
                json!({"op": "scroll", "at": [50, 50], "delta": 0, "t": 0}),
                json!({"op": "hover", "at": [50, 50], "t": SECOND}),
            ],
            false,
        )
        .unwrap();
        assert_eq!(target(&out["trace"][2]), [50.0, 50.0, 0.0]);
    }

    #[test]
    fn a_target_authored_outside_the_content_can_only_come_in_never_go_further_out() {
        let d = doc(
            json!({"projection": "orthographic", "target": [1000, 50, 0], "view_width": 100}),
            json!({"r": rect("r", 0.0, 0.0, 100.0, 100.0)}),
        );
        let out = run(
            &d,
            [100.0, 100.0],
            &[
                json!({"op": "drag", "at": [50, 50], "delta": [-10, 0]}),
                json!({"op": "drag", "at": [50, 50], "delta": [10, 0]}),
                json!({"op": "drag", "at": [50, 50], "delta": [5000, 0]}),
            ],
            false,
        )
        .unwrap();
        // Dragging the content right would move the target further out: it stays.
        assert_eq!(target(&out["trace"][0]), [1000.0, 50.0, 0.0]);
        assert_eq!(target(&out["trace"][1]), [990.0, 50.0, 0.0]);
        // And a drag across the content stops at its far side widened by the margin.
        assert_eq!(target(&out["trace"][2]), [-10.0, 50.0, 0.0]);
    }

    #[test]
    fn a_reset_never_takes_a_target_brought_in_back_outside_the_bounds() {
        let mut d = doc(
            json!({"projection": "orthographic", "target": [1000, 50, 0], "view_width": 100, "yield": {"ease_back": 1}}),
            json!({"r": rect("r", 0.0, 0.0, 100.0, 100.0)}),
        );
        d["controls"] = json!({"home": {"class": "viewer", "verb": "camera.reset"}});
        for reduced in [false, true] {
            let out = run(
                &d,
                [100.0, 100.0],
                &[
                    json!({"op": "drag", "at": [50, 50], "delta": [10, 0], "t": 0}),
                    json!({"op": "control", "control": "home", "t": 0}),
                    json!({"op": "hover", "at": [50, 50], "t": 2 * SECOND}),
                ],
                reduced,
            )
            .unwrap();
            assert_eq!(target(&out["trace"][0]), [990.0, 50.0, 0.0]);
            assert_eq!(
                target(&out["trace"][2]),
                [990.0, 50.0, 0.0],
                "reduced {reduced}"
            );
        }
    }

    #[test]
    fn a_goto_under_way_stays_inside_bounds_a_view_control_shrinks() {
        let d = flat(
            json!({
                "big": rect("big", 0.0, 0.0, 1000.0, 1000.0),
                "small": rect("small", 40.0, 40.0, 20.0, 20.0)
            }),
            json!({"pan": {"margin": 0}}),
            json!({
                "show": {"class": "view", "binds": ["items/big/visible"], "default": true},
                "spot": {"class": "viewer", "kind": "point"},
                "jump": {"class": "viewer", "verb": "camera.goto", "goto": {"to": "spot", "ease": 1}}
            }),
        );
        let out = run(
            &d,
            [100.0, 100.0],
            &[
                json!({"op": "control", "control": "spot", "value": [850, 50], "t": 0}),
                json!({"op": "hover", "at": [50, 50], "t": SECOND / 2}),
                json!({"op": "control", "control": "show", "value": false, "t": SECOND / 2}),
                json!({"op": "hover", "at": [50, 50], "t": SECOND}),
            ],
            false,
        )
        .unwrap();
        assert_eq!(target(&out["trace"][1]), [450.0, 50.0, 0.0]);
        // The big sheet hidden, the bounds are the small one's: the jump goes no further out.
        assert_eq!(target(&out["trace"][3]), [450.0, 50.0, 0.0]);
    }

    #[test]
    fn a_framed_view_is_inside_its_own_pan_bounds_so_a_still_drag_leaves_it() {
        let d = doc(
            json!({"projection": "orthographic", "fit": {"keep": ["r"], "place": [0.1, 0.5], "fill": 0.2}}),
            json!({"r": rect("r", 0.0, 0.0, 10.0, 10.0)}),
        );
        let out = run(
            &d,
            [100.0, 100.0],
            &[json!({"op": "drag", "at": [50, 50], "delta": [0, 0]})],
            false,
        )
        .unwrap();
        assert_eq!(target(&out["trace"][0]), target(&out["start"]));
    }

    #[test]
    fn an_edge_pan_and_a_key_pan_follow_the_screen_on_a_rolled_page() {
        let mut d = flat(
            json!({"r": rect("r", -500.0, -500.0, 1000.0, 1000.0)}),
            json!({"pan": {"edge": {"margin": 8, "rate": 0.5}}}),
            json!({"keys": {"class": "viewer", "verb": "camera.pan", "increment": 5}}),
        );
        d["items"]["cam"]["params"]["roll"] = json!(90);
        let out = run(
            &d,
            [100.0, 100.0],
            &[
                json!({"op": "hover", "at": [2, 50], "t": 0}),
                json!({"op": "hover", "at": [2, 50], "t": SECOND}),
                json!({"op": "control", "control": "keys", "value": [1, 0], "t": SECOND}),
            ],
            false,
        )
        .unwrap();
        // Turned a quarter, screen left is the page's +y: the target goes there, and a step
        // right goes back.
        assert_eq!(target(&out["trace"][1]), [50.0, 100.0, 0.0]);
        assert_eq!(target(&out["trace"][2]), [50.0, 95.0, 0.0]);
    }

    #[test]
    fn the_sessions_clock_runs_forward_only() {
        let d = flat(json!({}), json!({}), json!({}));
        let err = run(
            &d,
            [100.0, 100.0],
            &[
                json!({"op": "hover", "at": [1, 1], "t": SECOND}),
                json!({"op": "hover", "at": [1, 1], "t": 0}),
            ],
            false,
        )
        .unwrap_err();
        assert_eq!(err.path, "inputs/1/t");
    }
}

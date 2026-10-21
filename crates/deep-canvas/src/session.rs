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

use crate::camera::{add, sub, Offsets, Pivot, Pose, Projector, Refused, Vec3, ZoomAt};
use crate::document::member;
use crate::draw::{scene, Class, Drawn, Scene, Shape};
use crate::render::quad_contains;

/// The session's state after an input.
struct Session<'a> {
    scene: &'a Scene,
    viewport: [f64; 2],
    offsets: Offsets,
    view: Map<String, Value>,
    hover: Option<String>,
    track: Vec<Value>,
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

    /// A flat document's content bounds: the union of its drawn items' under the view, or
    /// none with no content.
    fn content_bounds(&self) -> Option<[[f64; 2]; 2]> {
        let mut bounds: Option<[[f64; 2]; 2]> = None;
        for item in self.scene.items.iter().filter(|i| self.shown(i)) {
            let ([x0, y0], [x1, y1]) = match item.shape {
                Shape::Rect { x, y, w, h } => ([x, y], [x + w, y + h]),
                Shape::Dot { pos, radius } => (
                    [pos[0] - radius, pos[1] - radius],
                    [pos[0] + radius, pos[1] + radius],
                ),
            };
            let b = bounds.get_or_insert([[x0, y0], [x1, y1]]);
            b[0][0] = b[0][0].min(x0);
            b[0][1] = b[0][1].min(y0);
            b[1][0] = b[1][0].max(x1);
            b[1][1] = b[1][1].max(y1);
        }
        bounds
    }

    /// Keeps a flat camera's target inside the content's bounds widened by the margin.
    fn clamp_pan(&mut self) {
        let user = &self.scene.spec.user;
        if !self.scene.rig.flat || !user.pan_bounds_content {
            return;
        }
        let Some([[x0, y0], [x1, y1]]) = self.content_bounds() else {
            return;
        };
        let (mx, my) = ((x1 - x0) * user.pan_margin, (y1 - y0) * user.pan_margin);
        let target = self.scene.spec.target;
        let x = (target[0] + self.offsets.pan[0]).clamp(x0 - mx, x1 + mx);
        let y = (target[1] + self.offsets.pan[1]).clamp(y0 - my, y1 + my);
        self.offsets.pan = [x - target[0], y - target[1], 0.0];
    }

    fn drag(&mut self, at: [f64; 2], delta: [f64; 2]) {
        let spec = &self.scene.spec;
        if self.scene.rig.flat {
            // The content follows the pointer.
            let view = self.projector();
            let before = view.unproject_flat(at[0], at[1]);
            let after = view.unproject_flat(at[0] + delta[0], at[1] + delta[1]);
            self.offsets.pan[0] -= after[0] - before[0];
            self.offsets.pan[1] -= after[1] - before[1];
            self.clamp_pan();
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
            azimuth.rem_euclid(360.0)
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
            let under = self.projector().unproject_flat(at[0], at[1]);
            self.offsets.zoom = zoom;
            let after = self.projector().unproject_flat(at[0], at[1]);
            self.offsets.pan[0] += under[0] - after[0];
            self.offsets.pan[1] += under[1] - after[1];
            self.clamp_pan();
            return;
        }
        match user.pivot {
            Pivot::Target => {
                // The eye comes nearer (camera::Spec::pose) and the target slides in its
                // plane so the point of that plane under the pointer stays under it.
                let under = self.projector().unproject_at_target(at[0], at[1]);
                self.offsets.zoom = zoom;
                let after = self.projector().unproject_at_target(at[0], at[1]);
                self.offsets.pan = add(self.offsets.pan, sub(under, after));
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
        let before = self.offsets;
        match member(input, "op").and_then(Value::as_str) {
            Some("drag") => self.drag(point("at")?, point("delta")?),
            Some("pinch") => {
                let factor = member(input, "scale").and_then(Value::as_f64);
                match factor {
                    Some(s) if s.is_finite() && s > 0.0 => self.pinch(point("at")?, s),
                    _ => {
                        return Err(Refused::new(
                            "out_of_range",
                            format!("{path}/scale"),
                            "not above 0",
                        ))
                    }
                }
            }
            Some("hover") => self.hover = self.pick(point("at")?),
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
                    // Navigating and pointing: session state the trace already shows.
                    Class::Viewer => {}
                }
            }
            _ => return Err(bad("op is one of drag, pinch, hover, control")),
        }
        if !self.finite() {
            self.offsets = before;
            return Err(bad("the input moves the camera past what a number holds"));
        }
        Ok(())
    }
}

/// Runs the inputs over the document in a fresh session: the state before any and after each,
/// the input track, and the document as a save writes it, with its revision hash.
pub fn run(doc: &Value, viewport: [f64; 2], inputs: &[Value]) -> Result<Value, Refused> {
    let scene = scene(doc)?;
    let mut session = Session {
        scene: &scene,
        viewport,
        offsets: Offsets::default(),
        view: scene.view_defaults(),
        hover: None,
        track: Vec::new(),
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
        let out = run(&d, [100.0, 100.0], &inputs).unwrap();
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
        let err = run(&d, [100.0, 100.0], &inputs).unwrap_err();
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
        let err = run(&d, [100.0, 100.0], &[drag.clone(), drag]).unwrap_err();
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
        let out = run(&d, [100.0, 100.0], &inputs).unwrap();
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
        )
        .unwrap();
        assert_eq!(out["trace"][0]["hover"], json!("r"));
        assert_eq!(out["trace"][1]["hover"], Value::Null);
    }

    #[test]
    fn a_3d_pinch_keeps_the_point_under_the_pointer_about_the_target_and_about_the_eye() {
        for user in [
            json!({"zoom": [0.5, 4]}),
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
            )
            .unwrap();
            assert_eq!(out["trace"][1]["hover"], json!("m"), "{user}");
            let centre_before = run(
                &d,
                [200.0, 100.0],
                &[json!({"op": "pinch", "at": [100, 50], "scale": 1.7})],
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
        )
        .unwrap();
        assert_eq!(out["trace"][0]["hover"], json!("l"));
    }
}

//! The measure tool (#1217; canvas primitives: Selection (session state),
//! `viewer_tools.measure`): two points picked on surfaces, read as the distance between them, its
//! run in the plane normal to the world's up axis and its rise along it, at the scale each part
//! is drawn at. A point is where the pointer's ray meets the picked item's evaluated triangles
//! (the hit path, #1976), on the CPU in f64 and never read from depth; on a cutaway's cap where
//! the picture draws one; and on a vertex or an edge's midpoint of the triangle met when one
//! lies within `snap` px. All of it is session state: nothing here writes a document, an input
//! entry or a hash.

use deep_canvas::ops::{hypot, sqrt};
use serde_json::{json, Value};

use crate::cut::Cutaway;
use crate::hit::{along, cross, dot, meet, ray, sub};
use crate::scene::Scene;

type V3 = [f64; 3];

/// A placed point: the item it lies on and where, in world m.
#[derive(Clone, Debug, PartialEq)]
pub struct Point {
    pub item: String,
    pub point: V3,
}

/// Where a pick at view px `at` places a point on pick target `target` (`item[#sub]`, as the
/// object-ID pass names it): where the ray through `at` first meets a triangle of it that its
/// cutaway keeps; on the cut face's plane where that triangle shows its back through a capped
/// cut, as the renderer draws the cap; else on that triangle's vertex or edge midpoint nearest
/// `at` within `snap` px. `None` where the ray misses the target.
pub fn place(scene: &Scene, at: [f64; 2], target: &str, snap: f64) -> Option<Point> {
    let (o, d) = ray(&scene.camera, at);
    // The nearest triangle kept: how far, its corners, whether its back faces the ray, its cut.
    let mut best: Option<(f64, [V3; 3], bool, Option<&Cutaway>)> = None;
    let solids = scene.layers.iter().flat_map(|l| &l.solids);
    for s in solids.filter(|s| s.id == target && !s.cast_only) {
        let cut = scene.cutaway.as_ref().filter(|_| s.cut);
        let m = &s.model;
        let world = |q: V3| -> V3 {
            std::array::from_fn(|r| m[r][0] * q[0] + m[r][1] * q[1] + m[r][2] * q[2] + m[r][3])
        };
        // A model that mirrors turns its triangles' winding over.
        let mirrored = dot(
            [m[0][0], m[1][0], m[2][0]],
            cross([m[0][1], m[1][1], m[2][1]], [m[0][2], m[1][2], m[2][2]]),
        ) < 0.0;
        let (positions, _, indices) = crate::pointer::drawn_mesh(s);
        for i in indices.as_chunks::<3>().0 {
            let corner = |k: usize| positions.get(i[k] as usize).map(|p| world(*p));
            let (Some(a), Some(b), Some(c)) = (corner(0), corner(1), corner(2)) else {
                continue;
            };
            let t = [a, b, c];
            let Some(dist) = meet(o, d, &t) else { continue };
            if best.as_ref().is_some_and(|b| b.0 <= dist)
                || cut.is_some_and(|c| c.hides(along(o, d, dist)))
            {
                continue;
            }
            let back = (dot(cross(sub(b, a), sub(c, a)), d) > 0.0) != mirrored;
            best = Some((dist, t, back, cut));
        }
    }
    let (dist, tri, back, cut) = best?;
    let item = target.split('#').next().unwrap_or(target).to_string();
    let capped = cut.filter(|c| back && c.cap.is_some());
    if let Some(point) = capped.and_then(|c| cap(c, o, d, dist)) {
        return Some(Point { item, point });
    }
    let mid = |a: V3, b: V3| -> V3 { std::array::from_fn(|k| (a[k] + b[k]) / 2.0) };
    let [a, b, c] = tri;
    let snapped = [a, b, c, mid(a, b), mid(b, c), mid(c, a)]
        .into_iter()
        .filter(|q| !cut.is_some_and(|c| c.hides(*q)))
        .filter_map(|q| {
            let px = scene.camera.project(q)?;
            Some((hypot(px[0] - at[0], px[1] - at[1]), q))
        })
        .filter(|(px, _)| *px <= snap)
        .min_by(|x, y| x.0.total_cmp(&y.0));
    let point = snapped.map_or_else(|| along(o, d, dist), |(_, q)| q);
    Some(Point { item, point })
}

/// The cut face a back face `dist` along the ray shows through: where the ray enters what `c`
/// keeps, on that plane, as the renderer's cap is placed (its `cap_at`). Past any plane hides
/// (`union`), so it is the last plane crossed before the face; past all (`intersect`), the first.
fn cap(c: &Cutaway, o: V3, d: V3, dist: f64) -> Option<V3> {
    let mut best: Option<f64> = None;
    for (n, offset) in &c.planes {
        let nd = dot(*n, d);
        if nd >= 0.0 {
            continue;
        }
        let t = (offset - dot(*n, o)) / nd;
        if t <= 0.0 || t > dist {
            continue;
        }
        if best.is_none_or(|b| if c.intersect { t < b } else { t > b }) {
            best = Some(t);
        }
    }
    best.map(|t| along(o, d, t))
}

/// What two points read.
#[derive(Clone, Debug, PartialEq)]
pub enum Reading {
    /// The distance between them, its run in the plane normal to up (+Y) and its rise along up,
    /// in real m.
    Lengths { distance: f64, run: f64, rise: f64 },
    /// Their parts are drawn at different scales (drawn ÷ real), so no length is read.
    Scales([f64; 2]),
}

/// What points `a` and `b` (world m) read, their parts drawn at `shown_at` (drawn ÷ real, each
/// its own): a drawn length divided by the scale is the real one.
pub fn read(a: V3, b: V3, shown_at: [f64; 2]) -> Reading {
    if shown_at[0] != shown_at[1] {
        return Reading::Scales(shown_at);
    }
    let v = sub(b, a).map(|x| x / shown_at[0]);
    Reading::Lengths {
        distance: sqrt(dot(v, v)),
        run: hypot(v[0], v[2]),
        rise: v[1].abs(),
    }
}

/// A length of `m` metres as a readout writes it, to `precision` decimals, in the unit that
/// suits a length of `of` metres: km from 1,000 m, m from 1 m, mm below.
pub fn text(m: f64, of: f64, precision: u8) -> String {
    let (per_m, unit) = match of.abs() {
        x if x >= 1000.0 => (1e-3, "km"),
        x if x >= 1.0 => (1.0, "m"),
        _ => (1e3, "mm"),
    };
    format!("{:.*} {unit}", usize::from(precision), m * per_m + 0.0)
}

/// The planted tool that reads the drawn points alone, never dividing by a part's `shown_at`
/// and never refusing two scales (#1217 criterion 2).
pub const IGNORES_SHOWN_AT: &str = "measure_ignores_shown_at";
/// The planted tool whose every placed point also appends an entry to the document's input
/// track (#1217 criterion 4); the host that holds the track writes it.
pub const WRITES_ENTRY: &str = "measure_writes_entry";
/// The planted twins of the tool, each chosen only by a proof scenario's `planted`.
pub const PLANTED: [&str; 2] = [IGNORES_SHOWN_AT, WRITES_ENTRY];

/// How far from the pointer a pick still names an item, px (Selection: `hit.margin`).
pub const MARGIN: u32 = 3;

/// The tool's session state (Selection: `measure`), which the app and the web player both hold
/// for a view and never write anywhere.
#[derive(Clone, Debug, PartialEq)]
pub struct Tool {
    pub on: bool,
    pub a: Option<Point>,
    pub b: Option<Point>,
    pub snap: f64,
    pub precision: u8,
    /// The part's anchor keyboard focus is on, `item#anchor`.
    pub focus: Option<String>,
}

impl Default for Tool {
    fn default() -> Self {
        Tool {
            on: false,
            a: None,
            b: None,
            snap: 8.0,
            precision: 2,
            focus: None,
        }
    }
}

impl Tool {
    /// Whether `doc` offers the tool (`viewer_tools.measure`).
    pub fn offered(doc: &Value) -> bool {
        doc.pointer("/viewer_tools/measure") == Some(&Value::Bool(true))
    }

    /// The viewer's setting: on in a document that offers the tool; off drops its points.
    pub fn set(&mut self, doc: &Value, on: bool) {
        *self = Tool {
            on: on && Tool::offered(doc),
            snap: self.snap,
            precision: self.precision,
            ..Tool::default()
        };
    }

    /// A placed point: A, then B; a third starts again at A.
    pub fn put(&mut self, p: Point) {
        match (&self.a, &self.b) {
            (Some(_), None) => self.b = Some(p),
            _ => (self.a, self.b) = (Some(p), None),
        }
    }

    /// Esc: both points go; whether there was one.
    pub fn clear(&mut self) -> bool {
        self.a.take().is_some() | self.b.take().is_some()
    }

    /// Tab from the focused anchor to the next of `anchors`, past the last to none; from none,
    /// to the first.
    pub fn tab(&mut self, anchors: &[(String, V3)]) {
        let at = self
            .focus
            .as_ref()
            .and_then(|f| anchors.iter().position(|(id, _)| id == f));
        let next = at.map_or(0, |i| i + 1);
        self.focus = anchors.get(next).map(|(id, _)| id.clone());
    }

    /// Enter: a point at the focused anchor; whether one was placed.
    pub fn enter(&mut self, anchors: &[(String, V3)]) -> bool {
        let found = self
            .focus
            .as_ref()
            .and_then(|f| anchors.iter().find(|(id, _)| id == f));
        let Some((id, point)) = found else {
            return false;
        };
        let item = id.split('#').next().unwrap_or(id).to_string();
        self.put(Point {
            item,
            point: *point,
        });
        true
    }

    /// What the two points read, as the overlay shows it: each length's text, or, where their
    /// parts are drawn at two scales, no length and why. `None` with fewer than two points.
    pub fn readout(&self, doc: &Value, planted: Option<&str>) -> Option<Value> {
        let (a, b) = (self.a.as_ref()?, self.b.as_ref()?);
        let scale = |p: &Point| match planted {
            Some(IGNORES_SHOWN_AT) => 1.0,
            _ => deep_canvas::lengths::shown_at(doc, &p.item).1,
        };
        Some(match read(a.point, b.point, [scale(a), scale(b)]) {
            Reading::Lengths {
                distance,
                run,
                rise,
            } => {
                let shown = |m: f64| text(m, distance, self.precision);
                json!({"distance": shown(distance), "run": shown(run), "rise": shown(rise)})
            }
            Reading::Scales([sa, sb]) => {
                let why = format!(
                    "{} is drawn at scale {sa} and {} at scale {sb}, so no length is read between them",
                    a.item, b.item
                );
                json!({"distance": null, "run": null, "rise": null, "why": why})
            }
        })
    }

    /// The state as a host reports it (`state.measure`, `probe().measure`).
    pub fn to_json(&self, doc: &Value, planted: Option<&str>) -> Value {
        let point = |p: &Option<Point>| {
            p.as_ref()
                .map(|p| json!({"item": p.item, "point": p.point}))
        };
        json!({"on": self.on, "a": point(&self.a), "b": point(&self.b), "snap": self.snap,
               "precision": self.precision, "readout": self.readout(doc, planted)})
    }
}

/// A readout ([`Tool::readout`]) as the one line the overlay writes beside the measure.
pub fn label(readout: &Value) -> String {
    let part = |k: &str| readout[k].as_str().unwrap_or_default();
    match readout["why"].as_str() {
        Some(why) => why.to_string(),
        None => format!(
            "{}, run {}, rise {}",
            part("distance"),
            part("run"),
            part("rise")
        ),
    }
}

/// Each part's anchors in the world, `item#anchor` with its point: the anchors its builder
/// returns, for the items of `doc` whose role is part, in reading order (the item's `order`,
/// then its ID), each part's by name.
pub fn anchors(scene: &Scene, doc: &Value) -> Vec<(String, V3)> {
    let mut parts: Vec<(&str, &str, Vec<(String, V3)>)> = Vec::new();
    let solids = scene.layers.iter().flat_map(|l| &l.solids);
    for s in solids.filter(|s| !s.cast_only) {
        let item = doc.pointer(&format!("/items/{}", s.id));
        let (Some(item), Some(mesh)) = (item, s.mesh.as_ref()) else {
            continue;
        };
        if item.get("role").and_then(Value::as_str) != Some("part")
            || parts.iter().any(|p| p.1 == s.id)
        {
            continue;
        }
        let m = &s.model;
        let named = mesh.anchors.iter().map(|(name, frame)| {
            let q = frame[0];
            let at =
                std::array::from_fn(|r| m[r][0] * q[0] + m[r][1] * q[1] + m[r][2] * q[2] + m[r][3]);
            (format!("{}#{name}", s.id), at)
        });
        let order = item.get("order").and_then(Value::as_str).unwrap_or("");
        parts.push((order, s.id.as_str(), named.collect()));
    }
    parts.sort_by(|x, y| (x.0, x.1).cmp(&(y.0, y.1)));
    parts.into_iter().flat_map(|p| p.2).collect()
}

/// The overlay's geometry on a frame: each placed point where the camera shows it, px, or none
/// behind the eye.
pub fn shown(tool: &Tool, scene: &Scene) -> [Option<[f64; 2]>; 2] {
    [&tool.a, &tool.b].map(|p| {
        let at = scene.camera.project(p.as_ref()?.point)?;
        Some([at[0], at[1]])
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::scene::{evaluate, Labels};

    fn scene_of(items: Value, position: V3, target: V3) -> Scene {
        let mut items = items;
        items["cam"] = json!({"id": "cam", "kind": "camera@1", "order": "a0",
            "params": {"projection": "perspective", "position": position, "target": target, "fov": 40}});
        let doc = json!({"format": 1, "size": [640, 480], "camera": "cam", "items": items});
        let look = crate::look::Look3::from_roles(
            [
                ("ink".to_string(), [0, 0, 0]),
                ("ground".to_string(), [255, 255, 255]),
            ]
            .into_iter()
            .collect(),
        );
        evaluate(&doc, 0, &look, &mut Labels::new()).unwrap()
    }

    fn column() -> Value {
        json!({"column": {"id": "column", "kind": "mark.cylinder@1", "order": "b0",
            "params": {"size": [1, 5, 1], "paint": {"fill": {"role": "ink"}}}, "at": {"pos": [0, 2.5, 0]}}})
    }

    fn off(a: V3, b: V3) -> f64 {
        sqrt(dot(sub(a, b), sub(a, b)))
    }

    /// Picks 5 px from the centres of a 5 m column's caps, from above and from below, snap to
    /// the centres, so the two read 5 m with no run; without the snap the first lies off its
    /// centre, on the cap.
    #[test]
    fn picks_near_a_columns_cap_centres_snap_to_them_and_read_its_height() {
        let above = scene_of(column(), [3.0, 12.0, 4.0], [0.0, 5.0, 0.0]);
        let top = above.camera.project([0.0, 5.0, 0.0]).unwrap();
        let near_top = [top[0] + 3.0, top[1] - 4.0];
        let a = place(&above, near_top, "column", 8.0).unwrap();
        assert_eq!((a.item.as_str(), a.point), ("column", [0.0, 5.0, 0.0]));
        let free = place(&above, near_top, "column", 0.0).unwrap().point;
        assert!(
            (free[1] - 5.0).abs() < 1e-9 && off(free, a.point) > 0.01,
            "{free:?}"
        );
        let below = scene_of(column(), [-3.0, -7.0, 4.0], [0.0, 0.0, 0.0]);
        let bottom = below.camera.project([0.0, 0.0, 0.0]).unwrap();
        let b = place(&below, [bottom[0] - 4.0, bottom[1] + 3.0], "column", 8.0).unwrap();
        assert_eq!(b.point, [0.0, 0.0, 0.0]);
        let lengths = Reading::Lengths {
            distance: 5.0,
            run: 0.0,
            rise: 5.0,
        };
        assert_eq!(read(a.point, b.point, [1.0, 1.0]), lengths);
        assert_eq!(place(&above, [2.0, 2.0], "column", 8.0), None);
    }

    /// A box cut at x > 0 with a cap, seen from the cut side: a pick on the cut face lies on its
    /// plane where the ray crosses it, not on the box's far wall behind it and not on a corner
    /// of that wall; with no cap the pick meets the wall.
    #[test]
    fn a_pick_on_a_cutaways_cap_lies_on_its_plane() {
        let items = |cap: &str| {
            json!({
                "block": {"id": "block", "kind": "mark.box@1", "order": "b0",
                    "params": {"size": [2, 2, 2], "paint": {"fill": {"role": "ink"}}}},
                "cut": {"id": "cut", "kind": "cutaway@1", "order": "c0",
                    "params": {"planes": [{"normal": [1, 0, 0], "offset": 0.25}], "cap": cap}}
            })
        };
        let eye = [6.0, 1.5, 2.0];
        let capped = scene_of(items("ink"), eye, [0.0, 0.0, 0.0]);
        let on_cap = [0.25, 0.4, -0.3];
        let px = capped.camera.project(on_cap).unwrap();
        let p = place(&capped, [px[0], px[1]], "block", 8.0).unwrap();
        assert!(off(p.point, on_cap) < 1e-9, "{p:?}");
        let open = scene_of(items("none"), eye, [0.0, 0.0, 0.0]);
        let wall = place(&open, [px[0], px[1]], "block", 0.0).unwrap().point;
        assert!((wall[0] + 1.0).abs() < 1e-9, "{wall:?}");
    }

    /// The tool's points: A, then B, a third starts again, Esc clears both; the readout reads
    /// each part's scale from its assembly, names both where they differ, and the planted tool
    /// reads the drawn length; off drops the points, and a document that doesn't offer the tool
    /// never turns it on.
    #[test]
    fn the_tool_places_a_then_b_starts_again_and_reads_each_parts_scale() {
        let doc = json!({"viewer_tools": {"measure": true},
            "assemblies": {"micro": {"shown_at": 1000}, "bench": {"shown_at": 1}},
            "items": {"chip": {"parent": "micro"}, "block": {"parent": "bench"}}});
        let at = |item: &str, x: f64| Point {
            item: item.into(),
            point: [x, 0.0, 0.0],
        };
        let mut tool = Tool::default();
        tool.set(&json!({}), true);
        assert!(!tool.on);
        tool.set(&doc, true);
        assert!(tool.on && tool.readout(&doc, None).is_none());
        tool.put(at("chip", 0.0));
        assert!(tool.b.is_none() && tool.readout(&doc, None).is_none());
        tool.put(at("chip", 2.0));
        let across = tool.to_json(&doc, None);
        assert_eq!(
            across["a"],
            json!({"item": "chip", "point": [0.0, 0.0, 0.0]})
        );
        assert_eq!(
            across["readout"],
            json!({"distance": "2.00 mm", "run": "2.00 mm", "rise": "0.00 mm"})
        );
        assert_eq!(
            label(&across["readout"]),
            "2.00 mm, run 2.00 mm, rise 0.00 mm"
        );
        let drawn = tool.readout(&doc, Some(IGNORES_SHOWN_AT)).unwrap();
        assert_eq!(drawn["distance"], "2.00 m");
        tool.put(at("chip", 1.0));
        assert_eq!((tool.a.as_ref().unwrap().point[0], &tool.b), (1.0, &None));
        tool.put(at("block", 3.0));
        let mixed = tool.readout(&doc, None).unwrap();
        assert!(mixed["distance"].is_null() && mixed["run"].is_null() && mixed["rise"].is_null());
        let why = mixed["why"].as_str().unwrap();
        assert!(
            why.contains("chip is drawn at scale 1000") && why.contains("block at scale 1,"),
            "{why}"
        );
        assert_eq!(label(&mixed), why);
        assert_eq!(
            tool.readout(&doc, Some(IGNORES_SHOWN_AT)).unwrap()["distance"],
            "2.00 m"
        );
        assert!(tool.clear() && tool.a.is_none() && tool.b.is_none() && tool.on);
        assert!(!tool.clear());
        tool.put(at("chip", 0.0));
        tool.set(&doc, false);
        assert_eq!(tool, Tool::default());
    }

    /// Tab walks each part's anchors in reading order and comes round through none; Enter
    /// places a point at the focused anchor, in the world.
    #[test]
    fn tab_walks_the_parts_anchors_and_enter_places_a_point_there() {
        let part = |order: &str, x: f64| {
            json!({"kind": "slab@1", "role": "part", "order": order, "at": {"pos": [x, 0, 0]},
                "params": {"size": [1, 2, 1], "paint": {"fill": {"role": "ink"}}}})
        };
        let mut items = json!({"beam": part("b1", 2.0), "plinth": part("b0", -2.0),
            "prop": {"kind": "slab@1", "order": "b2", "at": {"pos": [0, 0, 5]},
                "params": {"size": [1, 1, 1], "paint": {"fill": {"role": "ink"}}}}});
        for (id, item) in items.as_object_mut().unwrap() {
            item["id"] = json!(id);
        }
        let doc = json!({"items": items});
        let scene = scene_of(items, [0.0, 4.0, 9.0], [0.0, 1.0, 0.0]);
        let all = anchors(&scene, &doc);
        let ids: Vec<&str> = all.iter().map(|(id, _)| id.as_str()).collect();
        assert_eq!(
            ids,
            [
                "plinth#bottom",
                "plinth#centre",
                "plinth#top",
                "beam#bottom",
                "beam#centre",
                "beam#top"
            ]
        );
        assert_eq!(all[2].1, [-2.0, 2.0, 0.0]);
        let mut tool = Tool::default();
        assert!(!tool.enter(&all));
        let mut stops = Vec::new();
        for _ in 0..8 {
            tool.tab(&all);
            stops.push(tool.focus.clone());
        }
        let walked: Vec<Option<String>> = ids.iter().map(|id| Some(id.to_string())).collect();
        assert_eq!(stops[..6], walked[..]);
        assert_eq!(stops[6..], [None, Some("plinth#bottom".to_string())]);
        assert!(tool.enter(&all));
        let a = Point {
            item: "plinth".into(),
            point: [-2.0, 0.0, 0.0],
        };
        assert_eq!(tool.a, Some(a));
    }

    /// A drawn length divided by the scale it is drawn at is the real one, written in the unit
    /// that suits it; parts at two scales read no length.
    #[test]
    fn a_reading_is_the_real_length_and_two_scales_read_none() {
        let reading = read([0.0, 0.0, 0.0], [2.0, 0.0, 0.0], [1000.0, 1000.0]);
        let Reading::Lengths {
            distance,
            run,
            rise,
        } = reading
        else {
            panic!("{reading:?}")
        };
        assert_eq!(text(distance, distance, 2), "2.00 mm");
        assert_eq!(text(run, distance, 2), "2.00 mm");
        assert_eq!(text(rise, distance, 2), "0.00 mm");
        assert_eq!(text(5.0, 5.0, 2), "5.00 m");
        assert_eq!(text(0.0, 5.0, 2), "0.00 m");
        assert_eq!(text(1234.5, 1234.5, 1), "1.2 km");
        assert_eq!(
            read([0.0; 3], [2.0, 0.0, 0.0], [1000.0, 1.0]),
            Reading::Scales([1000.0, 1.0])
        );
        let down = read([0.0, 5.0, 0.0], [3.0, 1.0, 4.0], [1.0, 1.0]);
        let slanted = Reading::Lengths {
            distance: sqrt(41.0),
            run: 5.0,
            rise: 4.0,
        };
        assert_eq!(down, slanted);
    }
}

//! `spatial` (issue #421; the #421 acceptance README: Assumed surfaces): a document's items at t
//! in scene3d's spatial index, each one's world bounds, its hierarchy's and its children, and the
//! answers to the call's view, box, nearest-n and radius queries. #535: a 2D document's answer is
//! its mark sets' rows as they draw at t, each `<set>#<key>` with its box, each set's bounds their
//! union, so a row that doesn't draw is in neither.

use deep_canvas_marks::atlas::AtlasCell;
use deep_canvas_marks::scene::Mark;
use deep_canvas_scene3d::spatial::{Index, Plants, Query};
use serde_json::{json, Map, Value};

use crate::hub::{EvalTime, Hub, Planted};

#[derive(Debug)]
pub struct Spatial {
    pub doc: String,
    pub t: EvalTime,
    pub queries: Vec<Query>,
}

pub fn parse(c: &Map<String, Value>) -> Option<Spatial> {
    Some(Spatial {
        doc: c.get("doc")?.as_str()?.to_string(),
        t: crate::time::eval_time(c.get("t"))?,
        queries: c
            .get("queries")?
            .as_array()?
            .iter()
            .map(Query::parse)
            .collect::<Option<_>>()?,
    })
}

impl Hub<'_> {
    pub(crate) fn spatial(&mut self, s: &Spatial) -> Value {
        let t = match self.resolve_time(&s.doc, &s.t) {
            Ok(t) => t,
            Err(code) => return json!({"code": code}),
        };
        let Some(doc) = self
            .sessions
            .get(&s.doc)
            .and_then(|x| x.document().cloned())
        else {
            return json!({"code": "no_revision"});
        };
        let plants = Plants {
            cull_by_center: self.scenario.planted == Some(Planted::CullByCenter),
            bounds_children_only: self.scenario.planted == Some(Planted::BoundsChildrenOnly),
        };
        if !deep_canvas_scene3d::scene::has_3d(&doc) {
            return self.spatial_2d(&doc, t, &s.queries);
        }
        let refusal =
            |r: deep_canvas_scene3d::scene::Refused| json!({"code": r.code, "path": r.path});
        let index = match Index::new(&doc, t, plants) {
            Ok(i) => i,
            Err(r) => return refusal(r),
        };
        let mut results = Vec::with_capacity(s.queries.len());
        for q in &s.queries {
            match index.answer(q) {
                Ok(ids) => results.push(json!(ids)),
                Err(r) => return refusal(r),
            }
        }
        json!({"items": index.items_json(), "results": results})
    }
}

impl Hub<'_> {
    /// #535: each mark set row `doc` draws at `t`, `<set>#<key>` with its box in page u, in draw
    /// order, from a fresh session's frame. The planted set keeps its dead rows: its boxes come
    /// from the document with every set's `alive` left out. #536: a hex grid row also gives its
    /// hexagon, `{points, owns}` in page u, its hit area.
    pub(crate) fn row_boxes(
        &mut self,
        doc: &Value,
        t: i64,
    ) -> Vec<(String, [f64; 4], Option<Value>)> {
        let mut doc = doc.clone();
        if self.scenario.module_planted.as_deref() == Some("dead_rows_hidden_from_drawing_only") {
            for item in doc["items"]
                .as_object_mut()
                .into_iter()
                .flat_map(|i| i.values_mut())
            {
                if let Some(p) = item.get_mut("params").and_then(Value::as_object_mut) {
                    p.remove("alive");
                }
            }
        }
        let sets: Vec<String> = doc["items"]
            .as_object()
            .into_iter()
            .flatten()
            .filter(|(_, i)| i["kind"] == "marks@1")
            .map(|(id, _)| id.clone())
            .collect();
        let view = deep_canvas::schedule::default_view(&doc);
        let Ok((painted, ..)) = self.evaluate(&doc, &view, &[t], false) else {
            return Vec::new();
        };
        let marks = painted
            .drawing
            .iter()
            .flat_map(|d| d.frame.layers.iter().flat_map(|l| &l.marks));
        marks
            .filter(|d| {
                d.mark
                    .item()
                    .split_once('#')
                    .is_some_and(|(set, _)| sets.iter().any(|s| s == set))
            })
            .map(|d| {
                let hull = match &d.mark {
                    Mark::Image {
                        bounds: [x, y, w, h],
                        tile:
                            Some(AtlasCell {
                                hit: Some(area), ..
                            }),
                        ..
                    } => Some(json!({
                        "points": area.outline().map(|[u, v]| [x + u * w, y + v * h]),
                        "owns": area.owns,
                    })),
                    _ => None,
                };
                (d.mark.item().to_string(), d.extent(), hull)
            })
            .collect()
    }

    /// A 2D document's `spatial` answer: each set's bounds over the rows it draws, and for each box
    /// query the rows that meet it.
    fn spatial_2d(&mut self, doc: &Value, t: i64, queries: &[Query]) -> Value {
        let rows = self.row_boxes(doc, t);
        let mut items = Map::new();
        for (row, [x, y, w, h], _) in &rows {
            let set = row.split('#').next().unwrap_or_default();
            let b = items
                .entry(set.to_string())
                .or_insert_with(|| json!([x, y, x + w, y + h]));
            let u: Vec<f64> = b
                .as_array()
                .into_iter()
                .flatten()
                .filter_map(Value::as_f64)
                .collect();
            *b = json!([u[0].min(*x), u[1].min(*y), u[2].max(x + w), u[3].max(y + h)]);
        }
        for b in items.values_mut() {
            let u: Vec<f64> = b
                .as_array()
                .into_iter()
                .flatten()
                .filter_map(Value::as_f64)
                .collect();
            *b = json!({"bounds": {"min": [u[0], u[1], 0.0], "max": [u[2], u[3], 0.0]}});
        }
        let results: Vec<Value> = queries
            .iter()
            .map(|q| match q {
                Query::Box(a) => json!(rows
                    .iter()
                    .filter(|(_, [x, y, w, h], _)| {
                        *x <= a.max[0] && x + w >= a.min[0] && *y <= a.max[1] && y + h >= a.min[1]
                    })
                    .map(|(row, ..)| row)
                    .collect::<Vec<_>>()),
                _ => json!([]),
            })
            .collect();
        json!({"items": items, "results": results})
    }
}

#[cfg(test)]
mod tests {
    use serde_json::{json, Value};
    use sha2::{Digest, Sha256};

    /// #536: a hex cell's hexagon is its hit area. On the 6 × 6 pointy odd grid with cell
    /// [32, 28], a click at (34, 9), inside the quad of (1, 1) drawn above it, selects (1, 0)
    /// whose hexagon holds it; one at (40, 10.5), on the edge they share, selects (1, 0), the
    /// smaller (cy, cx); one at (48, 21) selects (1, 1). A row's key is its index, so (1, 0) is
    /// `board#1` and (1, 1) `board#7`.
    #[test]
    fn a_click_on_a_hex_set_selects_the_cell_whose_hexagon_holds_it() {
        let full = crate::BuildSet::Full;
        let sealed = crate::assemble(full, crate::modules(full))
            .seal()
            .expect("the shipped set seals");
        let startup = crate::tests::startup_of(sealed);
        let evidence =
            std::env::temp_dir().join(format!("deep-536-hex-hit-{}", std::process::id()));
        let mut png = Vec::new();
        image::RgbaImage::from_pixel(16, 16, image::Rgba([40, 120, 200, 255]))
            .write_to(&mut std::io::Cursor::new(&mut png), image::ImageFormat::Png)
            .expect("a png");
        let sha: String = Sha256::digest(&png)
            .iter()
            .map(|b| format!("{b:02x}"))
            .collect();
        std::fs::create_dir_all(evidence.join(&sha[..2])).expect("the store");
        std::fs::write(evidence.join(&sha[..2]).join(&sha[2..]), &png).expect("the atlas");
        let column = |v: Vec<i32>| {
            let bytes: Vec<u8> = v.iter().flat_map(|x| x.to_le_bytes()).collect();
            json!({"dtype": "i32", "len": 36, "data": deep_canvas::base64::encode(&bytes)})
        };
        let size = [224.0, 160.0];
        let doc = "01JB536D000000000000000001";
        let document = json!({
            "format": 1, "id": "hex", "profile": "film", "title": "Hex hits",
            "description": "A pointy odd hex atlas set whose cells' hexagons are their hit areas.",
            "size": size, "seed": 536, "camera": "cam",
            "transport": {"span": "4s", "frame_rate": [60, 1]},
            "items": {
                "cam": {"id": "cam", "kind": "camera@1", "name": "Camera", "order": "a0",
                    "params": {"projection": "orthographic", "target": [112, 80, 0], "view_width": 224}},
                "board": {"id": "board", "kind": "marks@1", "name": "Board", "order": "a1", "params": {
                    "mark": "image", "n": 36, "atlas": {"asset": sha, "cell": [16, 16], "padding": 1},
                    "grid": {"shape": "hex", "cell": [32, 28], "hex": {"orient": "pointy", "offset": "odd"}},
                    "columns": {"cx": column((0..36).map(|i| i % 6).collect()),
                        "cy": column((0..36).map(|i| i / 6).collect()), "tile": {"const": 0}}}},
            },
            "assets": {"atlas": {"sha256": sha, "license": {"id": "CC0-1.0",
                "terms": "Public domain dedication.", "shareable": true,
                "credit": "Test fixture made by deep-show's #536 test."}}},
        });
        let (ms, period) = (705_600_i64, 5_880_000_i64);
        let run = |calls: Vec<Value>| {
            let scenario = json!({
                "evidence": evidence.to_string_lossy(),
                "sessions": {"s": {"thread": "t", "name": "Claude Code: t",
                    "process": {"pid": 4100, "start": 1000}}},
                "processes": [{"pid": 1, "ppid": 0, "start": 0}, {"pid": 4100, "ppid": 1, "start": 1000}],
                "panels": {"p1": {"rect": [0, 0, 896, 640]}}, "docs": {doc: {"panel": "p1"}},
                "clock": {"refresh_hz": 120, "lead": 2 * ms, "check": ms / 2},
                "display": [1600, 900], "calls": calls,
            });
            crate::answer("run", &startup, &scenario.to_string())
        };
        let present = json!({"call": "deep_show", "session": "s", "doc": doc,
            "document": document, "include": ["issues"], "at": 1});
        let scope = json!({"call": "scope", "at": 20 * period, "panel": "p1"});
        let out = run(vec![present.clone(), scope.clone()]);
        assert_eq!(out["replies"][0]["outcome"], "presented", "{out}");
        let state = &out["replies"][1]["state"];
        let n = |v: &Value| v.as_f64().expect("a number");
        let (target, width, rect) = (
            &state["camera"]["target"],
            n(&state["camera"]["view_width"]),
            &state["rect"],
        );
        let k = width / n(&rect[2]);
        let panel = |[x, y]: [f64; 2]| {
            [
                n(&rect[0]) + n(&rect[2]) / 2.0 + (x - n(&target[0])) / k,
                n(&rect[1]) + n(&rect[3]) / 2.0 + (y - n(&target[1])) / k,
            ]
        };
        let points = [[34.0, 9.0], [40.0, 10.5], [48.0, 21.0]];
        let mut calls = vec![present, scope];
        for (i, p) in points.iter().enumerate() {
            let at = (30 + 10 * i as i64) * period;
            let pos = panel(*p);
            calls.push(json!({"call": "input", "at": at, "panel": "p1", "event": {"type": "down", "pos": pos}}));
            calls.push(json!({"call": "input", "at": at + 60 * ms, "panel": "p1", "event": {"type": "up", "pos": pos}}));
        }
        let out = run(calls);
        let _ = std::fs::remove_dir_all(&evidence);
        let selected: Vec<Value> = (0..3)
            .map(|i| out["replies"][3 + 2 * i]["state"]["selection"].clone())
            .collect();
        assert_eq!(
            selected,
            [json!(["board#1"]), json!(["board#1"]), json!(["board#7"])],
            "{out}"
        );
    }
}

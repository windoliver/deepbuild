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
        let Ok((painted, _, _)) = self.evaluate(&doc, &view, &[t], false) else {
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

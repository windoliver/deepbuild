//! `spatial` (issue #421; the #421 acceptance README: Assumed surfaces): a document's items at t
//! in scene3d's spatial index, each one's world bounds, its hierarchy's and its children, and the
//! answers to the call's view, box, nearest-n and radius queries.

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

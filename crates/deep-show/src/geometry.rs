//! `geometry` and `kinds` (issue #420; the #420 acceptance README: The surface under test): an
//! item's built mesh read back from its build node in a clean evaluation at t, or its vertex
//! count from its params alone with nothing built; and every kind the build registers with its
//! schema, dirty map, reads, fixture and sweep.

use deep_canvas::schedule::{Hasher, Val};
use deep_canvas_scene3d::build::{spec_of, Built};
use deep_canvas_scene3d::builders::{self, Ctx, Plants};
use deep_canvas_scene3d::stack;
use serde_json::{json, Map, Value};

use crate::frames::session_view;
use crate::hub::EvalTime;
use crate::hub::Hub;

/// `geometry`: which items, at what time, which stage, and whether to count only.
#[derive(Debug)]
pub struct Geometry {
    pub doc: String,
    pub items: Option<Vec<String>>,
    pub t: EvalTime,
    pub built: bool,
    pub estimate_only: bool,
}

pub fn parse(c: &Map<String, Value>) -> Option<Geometry> {
    let items = match c.get("items") {
        None => None,
        Some(v) => Some(
            v.as_array()?
                .iter()
                .map(|i| i.as_str().map(str::to_string))
                .collect::<Option<_>>()?,
        ),
    };
    let built = match c.get("stage").map(Value::as_str) {
        None | Some(Some("final")) => false,
        Some(Some("built")) => true,
        _ => return None,
    };
    let estimate_only = match c.get("estimate_only") {
        None => false,
        Some(v) => v.as_bool()?,
    };
    Some(Geometry {
        doc: c.get("doc")?.as_str()?.to_string(),
        items,
        t: crate::time::eval_time(c.get("t"))?,
        built,
        estimate_only,
    })
}

const BUILD_OPS: [&str; 2] = ["scene3d.build", "building.build"];

fn has_geometry(kind: &str) -> bool {
    builders::KINDS.contains(&kind) || deep_canvas_scene3d::building::KINDS.contains(&kind)
}

impl Hub<'_> {
    pub(crate) fn geometry(&mut self, g: &Geometry) -> Value {
        let t = match self.resolve_time(&g.doc, &g.t) {
            Ok(t) => t,
            Err(code) => return json!({"code": code}),
        };
        let planted = self.scenario.module_planted.clone();
        let Some(session) = self.sessions.get(&g.doc) else {
            return json!({"code": "no_revision"});
        };
        let Some(doc) = session.document().cloned() else {
            return json!({"code": "no_revision"});
        };
        let empty = Map::new();
        let items = doc
            .get("items")
            .and_then(Value::as_object)
            .unwrap_or(&empty);
        let ids: Vec<String> = match &g.items {
            Some(list) => list.clone(),
            None => items
                .iter()
                .filter(|(_, v)| has_geometry(v.get("kind").and_then(Value::as_str).unwrap_or("")))
                .map(|(k, _)| k.clone())
                .collect(),
        };
        if g.estimate_only {
            let ctx = Ctx {
                doc: &doc,
                plants: planted
                    .as_deref()
                    .and_then(Plants::named)
                    .unwrap_or_default(),
            };
            let mut out = Vec::new();
            for id in &ids {
                let Some(item) = items.get(id) else {
                    return json!({"code": "ref_unresolved", "path": format!("items/{id}")});
                };
                let kind = item.get("kind").and_then(Value::as_str).unwrap_or("");
                let params = item.get("params").cloned().unwrap_or(json!({}));
                let counted =
                    builders::estimate(kind, &params, &ctx).and_then(|n| stack::estimate(n, item));
                let declared = match counted {
                    Ok(n) => n,
                    Err(path) => {
                        return json!({"code": "out_of_range", "path": format!("items/{id}/{path}")})
                    }
                };
                // What the count reads: the item's geometry and the items it names.
                let mut h = Hasher::new("deep-show.estimate");
                h.bytes(&deep_canvas::schedule::canonical(item));
                out.push(json!({"id": id, "kind": kind, "declared": {"vertices": declared}, "key": h.finish().hex()}));
            }
            return json!({"builds": 0, "items": out});
        }
        let view = session_view(session, &Map::new());
        let scratch = session.clean(&mut self.sched, t, &view, None);
        let nodes = scratch.nodes(&self.sched);
        let builds = nodes
            .iter()
            .filter(|n| BUILD_OPS.contains(&n.operator.as_str()))
            .count();
        let mut out = Vec::new();
        for id in &ids {
            let Some(node) = nodes.iter().find(|n| {
                BUILD_OPS.contains(&n.operator.as_str()) && n.item.as_deref() == Some(id)
            }) else {
                return json!({"code": "ref_unresolved", "path": format!("items/{id}")});
            };
            let Some(b) = node.values.first().and_then(Val::as_typed::<Built>) else {
                let issue = scratch
                    .report
                    .issues
                    .iter()
                    .find(|i| i.path.starts_with(&format!("items/{id}")));
                return json!({"code": issue.map_or("input_failed", |i| i.code), "path": issue.map_or(format!("items/{id}"), |i| i.path.clone())});
            };
            let mesh = if g.built {
                b.built.as_ref()
            } else {
                b.mesh.as_ref()
            };
            let declared = if g.built
                && spec_of(&b.kind).is_some_and(|_| builders::KINDS.contains(&b.kind.as_str()))
            {
                let params = items
                    .get(id)
                    .and_then(|i| i.get("params"))
                    .cloned()
                    .unwrap_or(json!({}));
                let ctx = Ctx {
                    doc: &doc,
                    plants: planted
                        .as_deref()
                        .and_then(Plants::named)
                        .unwrap_or_default(),
                };
                builders::estimate(&b.kind, &params, &ctx).unwrap_or(b.declared)
            } else {
                b.declared
            };
            let mut row = json!({"id": id, "kind": b.kind, "declared": {"vertices": declared}, "key": node.key,
                                 "stack": b.rows.iter().map(stack::Row::to_json).collect::<Vec<_>>()});
            if let Some(m) = mesh {
                if let (Value::Object(r), Value::Object(mj)) = (&mut row, m.to_json()) {
                    r.extend(mj);
                }
            }
            out.push(row);
        }
        json!({"builds": builds, "items": out})
    }

    /// `kinds`: every kind the build registers, scene3d's and the building module's with their
    /// schemas, dirty maps, reads, fixtures and sweeps.
    pub(crate) fn kinds_reply(&self) -> Value {
        let planted = self.scenario.module_planted.as_deref();
        let kinds: Vec<Value> = crate::kit::manifest::Manifest::kinds_of(&self.startup.sealed)
            .into_iter()
            .map(|k| {
                let module = self.module_of(&k);
                match spec_of(&k).filter(|s| s.module == module) {
                    Some(spec) => deep_canvas_scene3d::spec::row(&spec, planted),
                    None => json!({"kind": k, "module": module, "params": {}, "dirty": {}, "fixture": null, "sweep": {}}),
                }
            })
            .collect();
        json!({"kinds": kinds})
    }
}

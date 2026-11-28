use std::cell::Cell;
use std::collections::BTreeMap;
use std::time::{Duration, Instant};

use deep_canvas::schedule::core_ops::Transform;
use deep_canvas_motion::arrange::At;
use deep_canvas_motion::relations::{self, KIND};
use serde_json::{json, Map, Value};

use crate::hub::{Claim, Hub};

impl Hub<'_> {
    pub(crate) fn scene_relations_runs(&mut self, c: &Claim) -> BTreeMap<String, Value> {
        let mut out = BTreeMap::new();
        if self.startup.sealed.check_kind(KIND).is_none() {
            return out;
        }
        let planted = self.scenario.module_planted.clone();
        for r in c.requirements.iter().filter(|r| r.check["kind"] == KIND) {
            let (mut issues, mut results, mut refused) = (Vec::new(), Vec::new(), Vec::new());
            let (mut unknown, mut ms) = (false, 0.0);
            let at = crate::time::eval_time(r.check.get("at"));
            if at.is_none() {
                refused.push(json!({"code": "bad_input", "path": "at", "why": "a time"}));
            }
            for doc in &c.deliverables {
                let (Some(rev), Some(at)) = (self.query_revision(doc, None), &at) else {
                    continue;
                };
                let in_doc = |mut v: Value| {
                    v["doc"] = json!(doc);
                    v
                };
                let t = match self.resolve_time(doc, at) {
                    Ok(t) => t,
                    Err(code) => {
                        refused.push(in_doc(json!({"code": code, "path": "at"})));
                        continue;
                    }
                };
                let form = self.with_outputs(doc, &rev.drawn);
                let session = self.evaluated(&form, t);
                let sched = &self.sched;
                let reading = Cell::new(Duration::ZERO);
                let at_of = |id: &str, item: &Value| {
                    let start = Instant::now();
                    let evaluated =
                        session
                            .read(sched, "core.transform", Some(id))
                            .and_then(|(v, _)| {
                                v.as_typed::<Transform>().map(|t| At {
                                    pos: t.pos,
                                    rot: t.rot,
                                    scale: t.scale,
                                })
                            });
                    reading.set(reading.get() + start.elapsed());
                    evaluated.unwrap_or_else(|| At::of(item.get("at")))
                };
                let start = Instant::now();
                match relations::read(&form, &r.check, &at_of, planted.as_deref()) {
                    Err(why) => refused.push(in_doc(why)),
                    Ok(read) => {
                        unknown |= read.unknown;
                        issues.extend(read.issues.into_iter().map(in_doc));
                        results.extend(read.results.into_iter().map(in_doc));
                    }
                }
                ms += start.elapsed().saturating_sub(reading.get()).as_secs_f64() * 1e3;
            }
            let result = if !refused.is_empty() {
                "INVALID"
            } else if !issues.is_empty() {
                "FAIL"
            } else if unknown {
                "INCONCLUSIVE"
            } else {
                "PASS"
            };
            let mut row = Map::new();
            row.insert("id".into(), json!(r.id));
            row.insert("kind".into(), json!(KIND));
            row.insert("machines".into(), json!("any"));
            row.insert("determinism".into(), json!("exact"));
            row.insert("issues".into(), Value::Array(issues));
            row.insert("results".into(), Value::Array(results));
            row.insert("timing".into(), json!({"check_ms": ms}));
            row.insert("result".into(), json!(result));
            if !refused.is_empty() {
                row.insert("blocked".into(), Value::Array(refused));
            }
            out.insert(r.id.clone(), Value::Object(row));
        }
        out
    }
}

#[cfg(test)]
mod tests {
    use serde_json::{json, Value};

    const DOC: &str = "01JB3225D00000000000000091";
    const CLAIM: &str = "claim:01JB3225C00000000000000091";

    fn solid(order: &str, size: [f64; 3], pos: [f64; 3]) -> Value {
        json!({"kind": "mark.box@1", "name": "Solid", "order": order, "params": {"size": size}, "at": {"pos": pos}})
    }

    fn scene(lamp_height: f64, more: Value) -> Value {
        let mut document = json!({
            "format": 1, "profile": "scene", "title": "A lamp over a table",
            "description": "A floor, a table and a lamp above it.", "size": [480, 360],
            "requires": {"modules": {"scene3d": "^1", "motion": "^1"}},
            "items": {
                "floor": solid("a0", [4.0, 0.1, 4.0], [0.0, -0.05, 0.0]),
                "table": solid("a1", [1.2, 0.75, 0.8], [0.0, 0.375, 0.0]),
                "lamp": solid("a2", [0.2, 0.45, 0.2], [0.0, lamp_height, 0.0]),
            },
        });
        let items = document["items"].as_object_mut().expect("items");
        for (id, item) in items.iter_mut() {
            item["id"] = json!(id);
        }
        let more = more.as_object().expect("an object").clone();
        document.as_object_mut().expect("a document").extend(more);
        document
    }

    fn rows_of(document: Value, checks: Vec<Value>) -> Vec<Value> {
        let full = crate::BuildSet::Full;
        let sealed = crate::assemble(full, crate::modules(full))
            .seal()
            .expect("the shipped set seals");
        let startup = crate::tests::startup_of(sealed);
        let evidence = std::env::temp_dir().join(format!(
            "deep-3225-host-{}-{:?}",
            std::process::id(),
            std::thread::current().id()
        ));
        let requirements: Vec<Value> = checks
            .into_iter()
            .enumerate()
            .map(|(k, check)| json!({"id": format!("req:01JB3225Q0000000000000009{k}"), "check": check}))
            .collect();
        let scenario = json!({
            "evidence": evidence.to_string_lossy(),
            "sessions": {"s": {"thread": "t", "name": "alpha: relations", "process": {"pid": 4100, "start": 1000}}},
            "processes": [{"pid": 1, "ppid": 0, "start": 0}, {"pid": 4100, "ppid": 1, "start": 1000}],
            "panels": {"main": {"rect": [0, 0, 1280, 720]}},
            "docs": {DOC: {"panel": "main"}},
            "claims": {CLAIM: {"session": "s", "deliverables": [DOC], "requirements": requirements}},
            "calls": [
                {"call": "deep_show", "session": "s", "doc": DOC, "document": document, "include": ["issues"]},
                {"call": "verdict", "claim": CLAIM},
            ],
        });
        let out = crate::answer("run", &startup, &scenario.to_string());
        let _ = std::fs::remove_dir_all(&evidence);
        assert_eq!(out["replies"][0]["outcome"], "presented", "{out}");
        out["replies"][1]["requirements"]
            .as_array()
            .unwrap_or_else(|| panic!("a verdict's rows: {out}"))
            .clone()
    }

    fn lamp_on_table(at: Option<&str>) -> Value {
        let mut check = json!({"kind": "scene.relations", "expect": [{"a": "lamp", "rel": "on", "b": "table"}]});
        if let Some(at) = at {
            check["at"] = json!(at);
        }
        check
    }

    fn metres_missed(row: &Value) -> f64 {
        row["results"][0]["miss"]["m"]
            .as_f64()
            .unwrap_or_else(|| panic!("a miss in metres: {row}"))
    }

    #[test]
    fn a_lamp_a_channel_lowers_onto_the_table_is_read_where_it_stands_at_the_checks_time() {
        let lowered = json!({"channels": {"lower": {"target": "items/lamp/at/pos/1", "type": "f32",
            "keys": {"k0": {"t": "0s", "value": 1.475, "interp": "linear"},
                     "k1": {"t": "1s", "value": 0.975, "interp": "linear"}}}}});
        let rows = rows_of(
            scene(1.475, lowered),
            vec![
                lamp_on_table(None),
                lamp_on_table(Some("1s")),
                lamp_on_table(Some("0.5s")),
            ],
        );
        assert_eq!(rows[0]["result"], "FAIL", "{}", rows[0]);
        assert!((metres_missed(&rows[0]) - 0.5).abs() < 1e-9, "{}", rows[0]);
        assert_eq!(rows[1]["result"], "PASS", "{}", rows[1]);
        assert_eq!(rows[2]["result"], "FAIL", "{}", rows[2]);
        assert!((metres_missed(&rows[2]) - 0.25).abs() < 1e-9, "{}", rows[2]);
    }

    #[test]
    fn a_lamp_a_rest_on_lowers_onto_the_table_is_read_where_the_rest_leaves_it() {
        let rested =
            json!({"constraints": {"rest": {"owner": "lamp", "kind": "rest_on", "on": "table"}}});
        let rows = rows_of(scene(1.975, rested), vec![lamp_on_table(None)]);
        assert_eq!(rows[0]["result"], "PASS", "{}", rows[0]);
        let rows = rows_of(scene(1.975, json!({})), vec![lamp_on_table(None)]);
        assert_eq!(rows[0]["result"], "FAIL", "{}", rows[0]);
        assert!((metres_missed(&rows[0]) - 1.0).abs() < 1e-9, "{}", rows[0]);
    }
}

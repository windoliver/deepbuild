//! Issue #1781: the core's `geometry.attributes` on a claim's deliverables (canvas primitives:
//! Check input; Attribute and field). The item a check names is built as its stack leaves it, or
//! as its modifier `after` does, and its attribute table read back in f64: bool, i32 and u32
//! compare exactly, float types within `tolerance`, and an attribute that differs, or that the
//! mesh lacks, fails naming it and the first element that differs. With no `expect` it is a
//! reading, never a pass.

use std::collections::BTreeMap;

use deep_canvas_scene3d::attrs::{Attribute, Elements, Type, Typed};
use deep_canvas_scene3d::{build, builders, building, stack};
use serde_json::{json, Map, Value};

use crate::hub::{Claim, Hub};

/// The check kind.
pub(crate) const GEOMETRY_ATTRIBUTES: &str = "geometry.attributes";

/// The code of an attribute that differs from what `expect` gives, or that the mesh lacks.
const DIFFERS: &str = "geometry.attribute";

struct Input {
    of: String,
    after: Option<usize>,
    expect: Option<Map<String, Value>>,
    tolerance: f64,
}

fn refusal(path: &str, why: &str) -> Value {
    json!({"code": "bad_input", "path": path, "why": why})
}

/// The check input, or the refusal naming its first field it can't read.
fn parse(check: &Value) -> Result<Input, Value> {
    let of = check.get("of").and_then(Value::as_str);
    let after = match check.get("after") {
        None | Some(Value::Null) => None,
        Some(v) => Some(
            v.as_u64()
                .ok_or_else(|| refusal("after", "a modifier index"))? as usize,
        ),
    };
    let expect = match check.get("expect") {
        None | Some(Value::Null) => None,
        Some(v) => Some(v.as_object().cloned().ok_or_else(|| {
            refusal(
                "expect",
                "attributes by name, each {domain, type, count, values}",
            )
        })?),
    };
    let tolerance = match check.get("tolerance") {
        None | Some(Value::Null) => 1e-6,
        Some(v) => v
            .as_f64()
            .filter(|x| x.is_finite() && *x >= 0.0)
            .ok_or_else(|| refusal("tolerance", "a number, 0 or more"))?,
    };
    Ok(Input {
        of: of.ok_or_else(|| refusal("of", "an item ID"))?.to_string(),
        after,
        expect,
        tolerance,
    })
}

/// Whether a type's values compare exactly, as whole numbers: bool, i32 and u32.
fn whole(ty: Type) -> bool {
    matches!(ty, Type::Bool | Type::I32 | Type::U32)
}

/// Element `i` of `a` as the check writes a value: a whole number for bool, i32 and u32, a
/// number for f32, and a list of its components for a vector.
fn value(a: &Attribute, i: usize) -> Value {
    let w = a.ty.width();
    let c = &a.values[i * w..(i + 1) * w];
    match w {
        1 if whole(a.ty) => json!(c[0] as i64),
        1 => json!(c[0]),
        _ => json!(c),
    }
}

/// An attribute as a row's `results` hold it.
fn read(name: &str, a: &Attribute) -> Value {
    let count = a.values.len() / a.ty.width();
    let values: Vec<Value> = (0..count).map(|i| value(a, i)).collect();
    json!({"attribute": name, "domain": a.domain.name(), "type": a.ty.name(), "count": count, "values": values})
}

/// Whether the value `want` an `expect` gives equals element `i` of `a`: a whole type's exactly,
/// a float type's within `tolerance` on each component.
fn equals(a: &Attribute, i: usize, want: &Value, tolerance: f64) -> bool {
    let w = a.ty.width();
    let got = &a.values[i * w..(i + 1) * w];
    let want: Option<Vec<f64>> = match want {
        Value::Array(list) if w > 1 => list.iter().map(Value::as_f64).collect(),
        v if w == 1 => v.as_f64().map(|x| vec![x]),
        _ => None,
    };
    let near = |x: f64, y: f64| {
        if whole(a.ty) {
            x == y
        } else {
            (x - y).abs() <= tolerance
        }
    };
    want.is_some_and(|want| want.len() == w && got.iter().zip(&want).all(|(x, y)| near(*x, *y)))
}

/// What differs between attribute `name` as the mesh holds it and as `expect` gives it: its
/// domain, type or count, or the first element whose value differs.
fn differs(name: &str, a: Option<&Attribute>, want: &Value, tolerance: f64) -> Option<Value> {
    let issue = |element: Value, expected: Value, actual: Value, what: String| {
        Some(
            json!({"check": GEOMETRY_ATTRIBUTES, "code": DIFFERS, "severity": "error",
                    "path": format!("expect/{name}"), "attribute": name, "element": element,
                    "expected": expected, "actual": actual, "what": what,
                    "fix": "change the item so the attribute holds this, or the expected value if the requirement was wrong"}),
        )
    };
    let Some(a) = a else {
        let what = format!("the mesh carries no attribute {name}");
        return issue(Value::Null, want.clone(), Value::Null, what);
    };
    let count = a.values.len() / a.ty.width();
    let shape = json!({"domain": a.domain.name(), "type": a.ty.name(), "count": count});
    let wanted = json!({"domain": want["domain"], "type": want["type"], "count": want["count"]});
    if shape != wanted {
        let what = format!("{name} is {shape} on the mesh, expected {wanted}");
        return issue(Value::Null, wanted, shape, what);
    }
    let values = want["values"].as_array().map_or(&[][..], Vec::as_slice);
    let first = (0..count.max(values.len()))
        .find(|i| !(*i < count && values.get(*i).is_some_and(|v| equals(a, *i, v, tolerance))))?;
    let expected = values.get(first).cloned().unwrap_or(Value::Null);
    let actual = if first < count {
        value(a, first)
    } else {
        Value::Null
    };
    let what = format!(
        "{name}: {} {first} holds {actual}, expected {expected}",
        a.domain.name()
    );
    issue(json!(first), expected, actual, what)
}

/// Why a deliverable's reading stops: its input refers to nothing (INVALID), or the item's mesh
/// can't be read (BLOCKED).
enum Stop {
    Refused(Value),
    Blocked(Value),
}

impl Hub<'_> {
    /// `geometry.attributes` on each requirement of the claim that names it, on every
    /// deliverable's current revision: requirement ID → its finished row.
    pub(crate) fn geometry_attributes_runs(&self, c: &Claim) -> BTreeMap<String, Value> {
        let mut out = BTreeMap::new();
        for r in c
            .requirements
            .iter()
            .filter(|r| r.check["kind"] == GEOMETRY_ATTRIBUTES)
        {
            let (mut issues, mut results, mut refused, mut blocked) =
                (Vec::new(), Vec::new(), Vec::new(), Vec::new());
            let mut reading = false;
            match parse(&r.check) {
                Err(why) => refused.push(why),
                Ok(input) => {
                    reading = input.expect.is_none();
                    for doc in &c.deliverables {
                        let with_doc = |mut v: Value| {
                            v["doc"] = json!(doc);
                            v
                        };
                        let table = match self.attributes_of(doc, &input) {
                            Ok(table) => table,
                            Err(Stop::Refused(v)) => {
                                refused.push(with_doc(v));
                                continue;
                            }
                            Err(Stop::Blocked(v)) => {
                                blocked.push(with_doc(v));
                                continue;
                            }
                        };
                        // Every attribute `expect` names that the mesh carries, or with none
                        // every attribute it carries.
                        let names: Vec<&String> = match &input.expect {
                            Some(expect) => expect.keys().collect(),
                            None => table.keys().collect(),
                        };
                        for name in names {
                            let a = table.get(name);
                            results.extend(a.map(|a| with_doc(read(name, a))));
                            let want = input.expect.as_ref().and_then(|e| e.get(name));
                            let issue = want.and_then(|w| differs(name, a, w, input.tolerance));
                            issues.extend(issue.map(|mut i| {
                                i["ids"] = json!([input.of]);
                                with_doc(i)
                            }));
                        }
                    }
                }
            }
            let result = if !refused.is_empty() {
                blocked = refused;
                "INVALID"
            } else if !blocked.is_empty() {
                "BLOCKED"
            } else if !issues.is_empty() {
                "FAIL"
            } else if reading {
                "INCONCLUSIVE"
            } else {
                "PASS"
            };
            let mut row = json!({"id": r.id, "kind": GEOMETRY_ATTRIBUTES, "machines": "any",
                                 "determinism": "exact", "issues": issues, "results": results,
                                 "result": result});
            if !blocked.is_empty() {
                row["blocked"] = Value::Array(blocked);
            }
            out.insert(r.id.clone(), row);
        }
        out
    }

    /// The attribute table of the mesh the input's item builds in `doc`'s current revision.
    fn attributes_of(&self, doc: &str, input: &Input) -> Result<Typed, Stop> {
        let id = input.of.as_str();
        let unresolved = || Stop::Refused(json!({"code": "ref_unresolved", "path": "of"}));
        let rev = self.query_revision(doc, None).ok_or_else(unresolved)?;
        let item_of = |doc: &'_ Value| doc.get("items").and_then(|items| items.get(id)).cloned();
        let Some(item) = item_of(&rev.drawn) else {
            // Skipped as a kind this build doesn't know: BLOCKED, as the claim's other checks are.
            return Err(
                match item_of(&rev.doc).and_then(|i| i.get("kind").cloned()) {
                    Some(kind) => {
                        Stop::Blocked(json!({"code": "unknown_kind", "ids": [id], "kind": kind}))
                    }
                    None => unresolved(),
                },
            );
        };
        let kind = item.get("kind").and_then(Value::as_str).unwrap_or("");
        let unreadable = |why: String| {
            Stop::Blocked(json!({"code": "mesh_unreadable", "kind": kind, "ids": [id], "why": why}))
        };
        let steps = item
            .get("modifiers")
            .and_then(Value::as_array)
            .map_or(0, Vec::len);
        if let Some(after) = input.after.filter(|k| *k >= steps) {
            return Err(Stop::Refused(
                json!({"code": "out_of_range", "path": "after", "after": after, "modifiers": steps}),
            ));
        }
        let mesh = if builders::KINDS.contains(&kind) {
            let run = stack::Run {
                planted: self.scenario.module_planted.clone(),
                outlines: self.startup.sealed.outlines.clone(),
                fills: self.startup.sealed.fills.clone(),
                ..Default::default()
            };
            let cut = stack::prefix(&item, input.after.map_or(steps, |k| k + 1));
            build::built(&rev.drawn, id, &cut, &run, 0.0)
                .map_err(|p| unreadable(format!("out_of_range at items/{id}/{p}")))?
                .mesh
        } else if building::KINDS.contains(&kind) {
            let built = building::build(&rev.drawn, id, &item);
            Some(built.map_err(|p| unreadable(format!("out_of_range at items/{id}/{p}")))?)
        } else {
            None
        };
        let mesh = mesh.ok_or_else(|| unreadable("its kind builds no mesh".into()))?;
        Ok(Elements::of(&mesh).table(&mesh))
    }
}

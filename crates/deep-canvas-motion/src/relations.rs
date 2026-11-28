use std::collections::BTreeMap;

use deep_canvas::ops;
use deep_canvas::registry::Raised;
use serde_json::{json, Value};

use crate::arrange::{self, At, Body, Rel, Relation};
use crate::assembly;

pub const KIND: &str = "scene.relations";
pub const MISSED: &str = "scene.relation_missed";
pub const COUNT: &str = "scene.relation_count";
pub const MISSED_FIX: &str =
    "Move or turn the item until the relation holds, or change the relation if the requirement was wrong.";
pub const COUNT_FIX: &str =
    "Move items until the count that hold is in its range, or change the count if the requirement was wrong.";
pub const READS_LIST: &str = "relations_read_arrangement_list";
pub const READS_UPRIGHT: &str = "relations_read_tipped_upright";
pub const OWN_MEASURE: &str = "relations_measure_off_last_place";
pub const PLANTED: [&str; 3] = [READS_LIST, READS_UPRIGHT, OWN_MEASURE];
const MOST: usize = 64;
const GROUND: &str = "ground";
const FAR: f64 = 1e9;

struct Stated<'a> {
    a: &'a str,
    rel: Rel,
    b: &'a str,
    d: f64,
    count: Option<([u64; 2], &'a Value)>,
}

fn refusal(path: String, why: &str) -> Value {
    json!({"code": "bad_input", "path": path, "why": why})
}

fn stated(k: usize, r: &Value) -> Result<Stated<'_>, Value> {
    let field = |name: &str, why: &str| refusal(format!("expect/{k}/{name}"), why);
    let rel = r.get("rel").and_then(Value::as_str).and_then(Rel::parse);
    let rel = rel.ok_or_else(|| field("rel", "one of arrange@1's seven relations"))?;
    let d = r.get("d").and_then(Value::as_f64).filter(|d| *d >= 0.0);
    if matches!(rel, Rel::Near | Rel::Apart) && d.is_none() {
        return Err(field("d", "near and apart take a distance in m"));
    }
    let whole = |v: &Value| v.as_u64().filter(|n| *n <= u64::from(u16::MAX));
    let range = |c: &Value| match c.as_array().map(Vec::as_slice) {
        Some([min, max]) => Some([whole(min)?, whole(max)?]),
        Some(_) => None,
        None => whole(c).map(|n| [n, n]),
    };
    let count = match r.get("count") {
        Some(c) => Some((
            range(c).ok_or_else(|| field("count", "a count or [min, max]"))?,
            c,
        )),
        None => None,
    };
    let name = |end: &str| r.get(end).and_then(Value::as_str);
    Ok(Stated {
        a: name("a").ok_or_else(|| field("a", "an item or a collection"))?,
        rel,
        b: name("b").ok_or_else(|| field("b", "an item, a collection or ground"))?,
        d: d.unwrap_or(0.0),
        count,
    })
}

fn stand(id: &str, size: arrange::V3, at: &At, upright: bool) -> (Body, bool) {
    let mut body = arrange::body(id, size, at);
    let r = assembly::local_of([0.0; 3], at.rot, [1.0; 3], [1.0; 3]);
    let tip = ops::deg(ops::atan2(ops::hypot(r[0][1], r[2][1]), r[1][1]));
    if upright || tip <= arrange::TOL_DEG {
        return (body, true);
    }
    let yaw = ops::rad(at.rot[1]);
    let (s, c) = (ops::sin(yaw), ops::cos(yaw));
    let rows = [
        [0, 1, 2].map(|j| c * r[0][j] - s * r[2][j]),
        [r[1][0], r[1][1], r[1][2]],
        [0, 1, 2].map(|j| s * r[0][j] + c * r[2][j]),
    ];
    let half = body.half;
    body.half = rows.map(|row| (0..3).map(|j| row[j].abs() * half[j]).sum::<f64>());
    (body, false)
}

struct Scene<'a> {
    doc: &'a Value,
    at_of: &'a dyn Fn(&str, &Value) -> At,
    upright: bool,
    bodies: Vec<Body>,
    sides: Vec<bool>,
    named: BTreeMap<String, Option<usize>>,
}

impl<'a> Scene<'a> {
    fn item_of(&self, id: &str) -> Option<&'a Value> {
        self.doc.get("items")?.get(id)
    }

    fn members(&self, name: &str) -> Option<&'a Value> {
        self.doc.get("collections")?.get(name)?.get("members")
    }

    fn world(&self, id: &str, item: &Value) -> At {
        let own = (self.at_of)(id, item);
        let mut over = None;
        let mut chain = vec![id];
        let mut next = item.get("parent").and_then(Value::as_str);
        while let Some((p, parent)) = next.and_then(|p| Some((p, self.item_of(p)?))) {
            if chain.contains(&p) {
                break;
            }
            let a = (self.at_of)(p, parent);
            let local = assembly::local_of(a.pos, a.rot, a.scale, [1.0; 3]);
            over = Some(over.map_or(local, |m| assembly::matmul(&local, &m)));
            chain.push(p);
            next = parent.get("parent").and_then(Value::as_str);
        }
        let Some(over) = over else { return own };
        let mut t = [own.pos, own.rot, own.scale].concat();
        assembly::placed(&over, &mut t);
        At {
            pos: [t[0], t[1], t[2]],
            rot: [t[3], t[4], t[5]],
            scale: [t[6], t[7], t[8]],
        }
    }

    fn body(&mut self, name: &str) -> Option<usize> {
        if let Some(found) = self.named.get(name) {
            return *found;
        }
        let read = match self.item_of(name) {
            Some(item) => arrange::dims_of(item).map(|size| {
                let at = self.world(name, item);
                stand(name, size, &at, self.upright)
            }),
            None => {
                let mut members = arrange::ids(self.members(name));
                members.retain(|m| self.item_of(m).is_some());
                let found: Vec<usize> = members.iter().filter_map(|m| self.body(m)).collect();
                arrange::around(name, found.iter().map(|&i| &self.bodies[i])).map(|b| (b, true))
            }
        };
        let found = read.map(|(body, sides)| {
            self.bodies.push(body);
            self.sides.push(sides);
            self.bodies.len() - 1
        });
        self.named.insert(name.to_string(), found);
        found
    }
}

fn listed(doc: &Value, s: &Stated<'_>) -> bool {
    let items = doc.get("items").and_then(Value::as_object);
    let mut lists = items
        .into_iter()
        .flatten()
        .filter(|(_, i)| arrange::is_arrangement(i))
        .filter_map(|(_, i)| i.pointer("/params/relations")?.as_array())
        .flatten();
    lists.any(|r| r["a"] == s.a && r["rel"] == s.rel.name() && r["b"] == s.b)
}

#[derive(Debug, Default)]
pub struct Read {
    pub results: Vec<Value>,
    pub issues: Vec<Value>,
    pub unknown: bool,
}

pub fn read(
    doc: &Value,
    input: &Value,
    at_of: &dyn Fn(&str, &Value) -> At,
    planted: Option<&str>,
) -> Result<Read, Value> {
    let ground = Body {
        id: GROUND.to_string(),
        center: [0.0, -FAR, 0.0],
        half: [FAR; 3],
        pos: [0.0; 3],
        yaw: 0.0,
        hollow: false,
    };
    let mut scene = Scene {
        doc,
        at_of,
        upright: planted == Some(READS_UPRIGHT),
        bodies: vec![ground],
        sides: vec![false],
        named: BTreeMap::new(),
    };
    let list = input.get("expect").and_then(Value::as_array);
    let list = list
        .filter(|l| (1..=MOST).contains(&l.len()))
        .ok_or_else(|| refusal("expect".into(), "1 to 64 relations"))?;
    let reads_list = planted == Some(READS_LIST);
    let off = planted == Some(OWN_MEASURE);
    let shown = |x: f64| {
        if off && x > 0.0 {
            f64::from_bits(x.to_bits() + 1)
        } else {
            x
        }
    };
    let mut out = Read::default();
    for (k, r) in list.iter().enumerate() {
        let s = stated(k, r)?;
        let (path, rel) = (format!("expect/{k}"), s.rel.name());
        let lacks = |end: &str| json!({"code": "ref_unresolved", "path": format!("{path}/{end}")});
        let firsts = match (scene.item_of(s.a), scene.members(s.a)) {
            (Some(_), _) => vec![s.a.to_string()],
            (None, Some(members)) => arrange::ids(Some(members)),
            (None, None) => return Err(lacks("a")),
        };
        let counted = s.count.is_some() || scene.item_of(s.a).is_none();
        if s.b != GROUND && scene.item_of(s.b).is_none() && scene.members(s.b).is_none() {
            return Err(lacks("b"));
        }
        let faces = matches!(s.rel, Rel::NextTo | Rel::Against | Rel::Facing);
        let (first, mut held, mut unknown) = (out.results.len(), 0, false);
        for a in &firsts {
            let ends = match (reads_list, s.b == GROUND) {
                (true, _) => None,
                (false, true) => scene.body(a).zip(Some(0)),
                (false, false) => scene.body(a).zip(scene.body(s.b)),
            };
            let readable = |(i, j): &(usize, usize)| !faces || (scene.sides[*i] && scene.sides[*j]);
            let miss = ends.filter(readable).map(|(i, j)| {
                let relation = Relation {
                    a: i,
                    rel: s.rel,
                    b: j,
                    d: s.d,
                };
                arrange::miss(&scene.bodies, &relation)
            });
            let miss = miss.or((reads_list && listed(doc, &s)).then(Default::default));
            let mut row =
                json!({"a": a, "b": s.b, "rel": rel, "miss": "unknown", "held": "unknown"});
            match miss {
                None => unknown = true,
                Some(m) => {
                    row["miss"] = json!({"m": shown(m.m), "deg": shown(m.deg)});
                    row["held"] = json!(m.held());
                    held += u64::from(m.held());
                    if !m.held() && s.count.is_none() {
                        let ids: Vec<&str> = [a.as_str(), s.b]
                            .into_iter()
                            .filter(|i| *i != GROUND)
                            .collect();
                        out.issues.push(json!({
                            "check": KIND, "code": MISSED, "severity": "error", "ids": ids, "path": path,
                            "rel": rel, "miss": row["miss"],
                            "what": format!("{a} {rel} {} misses by {} m and {}°", s.b, m.m, m.deg),
                            "fix": MISSED_FIX,
                        }));
                    }
                }
            }
            out.results.push(row);
        }
        out.unknown |= unknown;
        if unknown {
            continue;
        }
        if counted {
            out.results[first..]
                .iter_mut()
                .for_each(|r| r["count"] = json!(held));
        }
        if let Some((_, expected)) = s.count.filter(|(c, _)| !(c[0]..=c[1]).contains(&held)) {
            out.issues.push(json!({
                "check": KIND, "code": COUNT, "severity": "error", "ids": [s.a], "path": path,
                "rel": rel, "b": s.b, "expected": expected, "actual": held,
                "what": format!("{held} of {} hold {rel} {}, expected {expected}", s.a, s.b),
                "fix": COUNT_FIX,
            }));
        }
    }
    Ok(out)
}

pub fn issues(lowered: &Value, input: &Value) -> Vec<(String, Raised)> {
    let written = |_: &str, item: &Value| At::of(item.get("at"));
    let found = read(lowered, input, &written, None).map(|r| r.issues);
    let raised = |i: Value| {
        let text = |name: &str| i[name].as_str().unwrap_or_default().to_string();
        let raised = Raised {
            code: if i["code"] == COUNT { COUNT } else { MISSED },
            severity: "error",
            path: text("path"),
            what: text("what"),
            fix_ops: None,
        };
        (i["ids"][0].as_str().unwrap_or_default().to_string(), raised)
    };
    found.unwrap_or_default().into_iter().map(raised).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn solid(size: [f64; 3], pos: [f64; 3], rot: [f64; 3]) -> Value {
        json!({"kind": "mark.box@1", "params": {"size": size}, "at": {"pos": pos, "rot": rot}})
    }

    fn where_written(_: &str, item: &Value) -> At {
        At::of(item.get("at"))
    }

    fn room() -> Value {
        json!({"items": {
            "floor": solid([4.0, 0.1, 4.0], [0.0, -0.05, 0.0], [0.0; 3]),
            "table": solid([1.2, 0.75, 0.8], [0.0, 0.375, 0.0], [0.0; 3]),
            "lamp": solid([0.2, 0.45, 0.2], [0.0, 0.975, 0.0], [0.0; 3]),
            "tray": solid([1.0, 0.02, 0.2], [1.0, 0.5, 1.0], [0.0, 90.0, 0.0]),
            "cup": solid([0.1, 0.2, 0.1], [0.4, 0.11, 0.0], [0.0; 3]),
            "chair": solid([0.65, 0.85, 0.65], [0.0, 0.5306, 1.2], [-30.0, 180.0, 0.0]),
            "set": {"kind": "arrange@1", "params": {"items": [], "relations": []}},
        }})
    }

    fn read_one(doc: &Value, relation: Value, planted: Option<&str>) -> Read {
        read(doc, &json!({"expect": [relation]}), &where_written, planted).expect("a reading")
    }

    fn metres(read: &Read) -> f64 {
        read.results[0]["miss"]["m"]
            .as_f64()
            .expect("a miss in metres")
    }

    fn refused_at(input: Value) -> (Value, Value) {
        let why = read(&room(), &input, &where_written, None).expect_err("a refusal");
        (why["code"].clone(), why["path"].clone())
    }

    #[test]
    fn the_ground_is_the_plane_at_height_zero_and_has_no_side_faces() {
        let standing = read_one(
            &room(),
            json!({"a": "table", "rel": "on", "b": "ground"}),
            None,
        );
        assert_eq!(standing.results[0]["held"], true, "{standing:?}");
        let lifted = read_one(
            &room(),
            json!({"a": "lamp", "rel": "on", "b": "ground"}),
            None,
        );
        assert!((metres(&lifted) - 0.75).abs() < 1e-12, "{lifted:?}");
        assert_eq!(lifted.issues[0]["ids"], json!(["lamp"]), "{lifted:?}");
        let beside = read_one(
            &room(),
            json!({"a": "table", "rel": "next_to", "b": "ground"}),
            None,
        );
        assert_eq!(beside.results[0]["held"], "unknown", "{beside:?}");
        assert!(beside.unknown && beside.issues.is_empty(), "{beside:?}");
    }

    #[test]
    fn a_child_stands_where_its_parent_carries_it() {
        let on_tray = json!({"a": "cup", "rel": "on", "b": "tray"});
        let alone = read_one(&room(), on_tray.clone(), None);
        assert_eq!(alone.results[0]["held"], false, "{alone:?}");
        let mut carried = room();
        carried["items"]["cup"]["parent"] = json!("tray");
        let carried = read_one(&carried, on_tray, None);
        assert_eq!(carried.results[0]["held"], true, "{carried:?}");
    }

    #[test]
    fn an_item_with_no_bounds_reads_unknown_and_raises_nothing() {
        let unbounded = read_one(
            &room(),
            json!({"a": "set", "rel": "on", "b": "floor"}),
            None,
        );
        assert_eq!(unbounded.results[0]["miss"], "unknown", "{unbounded:?}");
        assert!(
            unbounded.unknown && unbounded.issues.is_empty(),
            "{unbounded:?}"
        );
        let bounded = read_one(
            &room(),
            json!({"a": "table", "rel": "on", "b": "floor"}),
            None,
        );
        assert_eq!(bounded.results[0]["held"], true, "{bounded:?}");
        assert!(!bounded.unknown, "{bounded:?}");
    }

    #[test]
    fn a_tipped_item_reads_unknown_only_where_the_relation_needs_its_side_faces() {
        for rel in ["next_to", "against", "facing"] {
            let sideways = json!({"a": "chair", "rel": rel, "b": "table"});
            let tipped = read_one(&room(), sideways.clone(), None);
            assert_eq!(tipped.results[0]["held"], "unknown", "{rel}: {tipped:?}");
            let as_if_upright = read_one(&room(), sideways, Some(READS_UPRIGHT));
            assert!(
                as_if_upright.results[0]["held"].is_boolean(),
                "{rel}: {as_if_upright:?}"
            );
        }
        let resting = read_one(
            &room(),
            json!({"a": "chair", "rel": "on", "b": "floor"}),
            None,
        );
        assert!(metres(&resting) < arrange::TOL_M, "{resting:?}");
        let mut nearly_upright = room();
        nearly_upright["items"]["chair"]["at"]["rot"] = json!([0.5, 180.0, 0.0]);
        let facing = json!({"a": "chair", "rel": "facing", "b": "table"});
        let read = read_one(&nearly_upright, facing, None);
        assert_eq!(read.results[0]["held"], true, "{read:?}");
    }

    #[test]
    fn the_poses_are_the_callers_and_never_the_documents_own() {
        let on_table = json!({"expect": [{"a": "lamp", "rel": "on", "b": "table"}]});
        let moved_to_the_floor = |id: &str, item: &Value| match id {
            "lamp" => At::of(Some(&json!({"pos": [0.8, 0.225, 0.6]}))),
            _ => At::of(item.get("at")),
        };
        let moved = read(&room(), &on_table, &moved_to_the_floor, None).expect("a reading");
        assert!(metres(&moved) >= 0.75, "{moved:?}");
        let written = read(&room(), &on_table, &where_written, None).expect("a reading");
        assert_eq!(written.results[0]["held"], true, "{written:?}");
    }

    #[test]
    fn an_input_the_check_cant_read_is_refused_by_its_path() {
        let one = |relation: Value| refused_at(json!({"expect": [relation]}));
        let bad = json!("bad_input");
        assert_eq!(
            one(json!({"a": "lamp", "rel": "above", "b": "table"})),
            (bad.clone(), json!("expect/0/rel"))
        );
        assert_eq!(
            one(json!({"a": "lamp", "rel": "near", "b": "table"})),
            (bad.clone(), json!("expect/0/d"))
        );
        assert_eq!(
            one(json!({"a": "lamp", "rel": "on", "b": "table", "count": [1]})),
            (bad.clone(), json!("expect/0/count"))
        );
        let unresolved = json!("ref_unresolved");
        assert_eq!(
            one(json!({"a": "ghost", "rel": "on", "b": "table"})),
            (unresolved.clone(), json!("expect/0/a"))
        );
        assert_eq!(
            one(json!({"a": "lamp", "rel": "on", "b": "ghost"})),
            (unresolved, json!("expect/0/b"))
        );
        let on_table = json!({"a": "lamp", "rel": "on", "b": "table"});
        assert_eq!(
            refused_at(json!({"expect": vec![on_table.clone(); MOST + 1]})),
            (bad.clone(), json!("expect"))
        );
        assert_eq!(refused_at(json!({"expect": []})), (bad, json!("expect")));
        assert!(read(
            &room(),
            &json!({"expect": vec![on_table; MOST]}),
            &where_written,
            None
        )
        .is_ok());
    }
}

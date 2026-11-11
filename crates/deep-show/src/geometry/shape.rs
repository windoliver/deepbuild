//! Issue #1700: the core's `geometry.shape` on a claim's deliverables (canvas primitives: Check
//! input: shape readings). The items a check names are evaluated at its time, placed in world
//! metres and read as one surface by `deep_canvas::geometry_shape`; this file holds the check's
//! input, how each item's triangles are fetched, and the requirement's row.

use std::collections::BTreeMap;

use deep_canvas::geometry_shape::{self as shape, Rest, Surface, TOUCH, V3};
use deep_canvas_scene3d::scene::{self, Affine3};
use deep_canvas_scene3d::{build, builders, building, stack};
use serde_json::{json, Map, Value};

use crate::hub::{Claim, Hub};

/// The check kind.
pub(crate) const GEOMETRY_SHAPE: &str = "geometry.shape";

/// The readings with no fields, and those with, in the order the design lists them.
const BARE: [&str; 4] = ["parts", "closed", "holes", "volume"];
const AXES: [&str; 3] = ["x", "y", "z"];

/// The check's wrong programs: the readings', and one in how an item is placed.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub(crate) struct Planted {
    core: shape::Planted,
    /// A `mesh.asset@1`'s triangles are read as its file holds them, without the item's placement.
    unplaced: bool,
}

/// The check's wrong programs by the names its acceptance suite gives them.
pub(crate) fn planted(name: &str) -> Option<Planted> {
    let none = shape::Planted::default();
    let core = |core| Planted {
        core,
        unplaced: false,
    };
    Some(match name {
        "holes_count_face_contours" => core(shape::Planted {
            contours: true,
            ..none
        }),
        "asset_read_unplaced" => Planted {
            core: none,
            unplaced: true,
        },
        "volume_sums_flipped_faces" => core(shape::Planted {
            sums_open: true,
            ..none
        }),
        "section_leaves_segments_unjoined" => core(shape::Planted {
            unjoined: true,
            ..none
        }),
        "probe_tests_bounds_only" => core(shape::Planted {
            boxes: true,
            ..none
        }),
        _ => return None,
    })
}

#[derive(Clone, Debug, PartialEq)]
enum Reading {
    Bare(&'static str),
    Section { axis: usize, at: f64 },
    Probe { from: V3, dir: V3 },
    Tips { axis: usize },
    Rests { on: Option<String> },
}

impl Reading {
    fn name(&self) -> &'static str {
        match self {
            Reading::Bare(n) => n,
            Reading::Section { .. } => "section",
            Reading::Probe { .. } => "probe",
            Reading::Tips { .. } => "tips",
            Reading::Rests { .. } => "rests",
        }
    }
}

struct Input {
    of: Vec<String>,
    at: crate::hub::EvalTime,
    readings: Vec<Reading>,
    /// Each reading as the check writes it.
    written: Vec<Value>,
    expect: Map<String, Value>,
}

fn refusal(path: &str, why: &str) -> Value {
    json!({"code": "bad_input", "path": path, "why": why})
}

fn vec3(v: Option<&Value>) -> Option<V3> {
    let a = v?.as_array().filter(|a| a.len() == 3)?;
    let p = [0, 1, 2].map(|k| a[k].as_f64());
    Some([p[0]?, p[1]?, p[2]?]).filter(|p| p.iter().all(|x| x.is_finite()))
}

fn axis(v: Option<&Value>) -> Option<usize> {
    AXES.iter()
        .position(|a| v.and_then(Value::as_str) == Some(*a))
}

/// One reading of the input's list at `path`.
fn reading(v: &Value, path: &str) -> Result<Reading, Value> {
    if let Some(name) = v.as_str() {
        return BARE
            .iter()
            .find(|b| **b == name)
            .map(|b| Reading::Bare(b))
            .ok_or_else(|| refusal(path, "not a reading"));
    }
    let Some((name, f)) = v
        .as_object()
        .filter(|o| o.len() == 1)
        .and_then(|o| o.iter().next())
    else {
        return Err(refusal(
            path,
            "a reading is a name, or a one-key object for one with fields",
        ));
    };
    let field = |k: &str, why: &str| refusal(&format!("{path}/{name}/{k}"), why);
    Ok(match name.as_str() {
        "section" => Reading::Section {
            axis: axis(f.get("axis")).ok_or_else(|| field("axis", "x, y or z"))?,
            at: f
                .get("at")
                .and_then(Value::as_f64)
                .ok_or_else(|| field("at", "a length in m"))?,
        },
        "probe" => {
            let from = vec3(f.get("from")).ok_or_else(|| field("from", "a vec3 in m"))?;
            let d = vec3(f.get("dir")).ok_or_else(|| field("dir", "a vec3"))?;
            let l = deep_canvas::ops::sqrt(d[0] * d[0] + d[1] * d[1] + d[2] * d[2]);
            if l == 0.0 {
                return Err(field("dir", "a direction, not zero"));
            }
            Reading::Probe {
                from,
                dir: d.map(|x| x / l),
            }
        }
        "tips" => Reading::Tips {
            axis: axis(f.get("axis")).ok_or_else(|| field("axis", "x, y or z"))?,
        },
        "rests" => Reading::Rests {
            on: match f.get("on").and_then(Value::as_str) {
                Some("ground") => None,
                Some(id) => Some(id.to_string()),
                None => return Err(field("on", "an item ID or ground")),
            },
        },
        _ => return Err(refusal(path, "not a reading")),
    })
}

/// The check input, or the refusal naming its first field it can't read.
fn parse(check: &Value) -> Result<Input, Value> {
    let of: Vec<String> = match check.get("of") {
        Some(Value::String(id)) => vec![id.clone()],
        Some(Value::Array(ids)) if !ids.is_empty() => ids
            .iter()
            .map(|v| v.as_str().map(str::to_string))
            .collect::<Option<_>>()
            .ok_or_else(|| refusal("of", "item IDs"))?,
        _ => return Err(refusal("of", "an item ID or a list of them")),
    };
    let at = crate::time::eval_time(check.get("at")).ok_or_else(|| refusal("at", "a time"))?;
    let list = check
        .get("readings")
        .and_then(Value::as_array)
        .filter(|l| (1..=16).contains(&l.len()));
    let written = list
        .ok_or_else(|| refusal("readings", "1 to 16 readings"))?
        .clone();
    let readings = written
        .iter()
        .enumerate()
        .map(|(i, v)| reading(v, &format!("readings/{i}")))
        .collect::<Result<Vec<_>, _>>()?;
    let expect = check
        .get("expect")
        .and_then(Value::as_object)
        .cloned()
        .unwrap_or_default();
    for (k, v) in &expect {
        let path = format!("expect/{k}");
        if !readings.iter().any(|r| r.name() == k) {
            return Err(refusal(&path, "expects a reading the check doesn't take"));
        }
        let flag = matches!(k.as_str(), "closed" | "probe" | "rests");
        let range = v
            .as_array()
            .is_some_and(|a| a.len() == 2 && a.iter().all(Value::is_number));
        if !(if flag {
            v.is_boolean()
        } else {
            v.is_number() || range
        }) {
            return Err(refusal(
                &path,
                if flag {
                    "true or false"
                } else {
                    "a number or [min, max]"
                },
            ));
        }
    }
    Ok(Input {
        of,
        at,
        readings,
        written,
        expect,
    })
}

/// Whether `value` meets `expected`: equal, or inside an inclusive `[min, max]`.
fn meets(expected: &Value, value: &Value) -> bool {
    match (expected.as_array(), value.as_f64()) {
        (Some(r), Some(x)) => {
            r[0].as_f64().is_some_and(|lo| lo <= x) && r[1].as_f64().is_some_and(|hi| x <= hi)
        }
        (None, Some(x)) => expected.as_f64() == Some(x),
        _ => expected == value,
    }
}

/// `x` in item space placed by `m`.
fn place(m: &Affine3, p: V3) -> V3 {
    [0, 1, 2].map(|i| m[i][0] * p[0] + m[i][1] * p[1] + m[i][2] * p[2] + m[i][3])
}

/// A box mark's twelve triangles, wound outward, about its centre.
fn box_mark(item: &Value) -> (Vec<V3>, Vec<u32>) {
    let s = vec3(item.pointer("/params/size"))
        .unwrap_or([1.0; 3])
        .map(|x| x / 2.0);
    let points = (0..8)
        .map(|k| [0, 1, 2].map(|j| if k >> j & 1 == 0 { -s[j] } else { s[j] }))
        .collect();
    let indices = vec![
        0, 2, 3, 0, 3, 1, 4, 5, 7, 4, 7, 6, 0, 1, 5, 0, 5, 4, 2, 6, 7, 2, 7, 3, 0, 4, 6, 0, 6, 2,
        1, 3, 7, 1, 7, 5,
    ];
    (points, indices)
}

/// One item's triangles in world metres, wound as placed, or why they can't be read.
struct Fetched {
    points: Vec<V3>,
    indices: Vec<u32>,
}

impl Hub<'_> {
    /// `geometry.shape` on each requirement of the claim that names it, on every deliverable's
    /// current revision: requirement ID → its finished row.
    pub(crate) fn geometry_shape_runs(&self, c: &Claim) -> BTreeMap<String, Value> {
        let planted = match self.scenario.planted {
            Some(crate::hub::Planted::Audit(crate::geometry_audit::Planted::Shape(p))) => p,
            _ => Planted::default(),
        };
        let mut out = BTreeMap::new();
        for r in c
            .requirements
            .iter()
            .filter(|r| r.check["kind"] == GEOMETRY_SHAPE)
        {
            let mut row = Map::new();
            row.insert("id".into(), json!(r.id));
            row.insert("kind".into(), json!(GEOMETRY_SHAPE));
            row.insert("machines".into(), json!("any"));
            row.insert("determinism".into(), json!("exact"));
            let (mut issues, mut results, mut refused, mut blocked) =
                (Vec::new(), Vec::new(), Vec::new(), Vec::new());
            let (mut unknown, mut ms) = (false, 0.0);
            match parse(&r.check) {
                Err(why) => refused.push(why),
                Ok(input) => {
                    for doc in &c.deliverables {
                        let Some(rev) = self.query_revision(doc, None) else {
                            continue;
                        };
                        match self.read_shape(doc, &rev, &input, planted) {
                            Err(Stop::Refused(v)) => refused.push(with_doc(v, doc)),
                            Err(Stop::Blocked(v)) => blocked.push(with_doc(v, doc)),
                            Ok(read) => {
                                ms += read.ms;
                                unknown |= read.unknown;
                                issues.extend(read.issues.into_iter().map(|v| with_doc(v, doc)));
                                results.extend(read.results.into_iter().map(|v| with_doc(v, doc)));
                            }
                        }
                    }
                    unknown |= input.expect.is_empty();
                }
            }
            let result = if !refused.is_empty() {
                blocked = refused;
                "INVALID"
            } else if !blocked.is_empty() {
                "BLOCKED"
            } else if !issues.is_empty() {
                "FAIL"
            } else if unknown {
                "INCONCLUSIVE"
            } else {
                "PASS"
            };
            row.insert("issues".into(), Value::Array(issues));
            row.insert("results".into(), Value::Array(results));
            row.insert("timing".into(), json!({"check_ms": ms}));
            row.insert("result".into(), json!(result));
            if !blocked.is_empty() {
                row.insert("blocked".into(), Value::Array(blocked));
            }
            out.insert(r.id.clone(), Value::Object(row));
        }
        out
    }

    /// The item's triangles at `t` (flicks), placed in world metres.
    fn fetch(
        &self,
        drawn: &Value,
        id: &str,
        item: &Value,
        m: &Affine3,
        t: i64,
    ) -> Result<Fetched, Value> {
        let kind = item.get("kind").and_then(Value::as_str).unwrap_or("");
        let unreadable =
            |why: String| json!({"code": "mesh_unreadable", "kind": kind, "ids": [id], "why": why});
        let mesh = if builders::KINDS.contains(&kind) {
            let run = stack::Run {
                outlines: self.startup.sealed.outlines.clone(),
                ..Default::default()
            };
            let secs = t as f64 / deep_canvas::camera::FLICKS_PER_SECOND as f64;
            build::built(drawn, id, item, &run, secs)
                .map_err(|p| unreadable(format!("out_of_range at items/{id}/{p}")))?
                .mesh
        } else if building::KINDS.contains(&kind) {
            Some(
                building::build(drawn, id, item)
                    .map_err(|p| unreadable(format!("out_of_range at items/{id}/{p}")))?,
            )
        } else if kind == super::ASSET {
            Some(
                super::asset_mesh(&self.scenario.evidence, id, item).map_err(|mut v| {
                    v["ids"] = json!([id]);
                    v
                })?,
            )
        } else if kind == "mark.box@1" {
            let (points, indices) = box_mark(item);
            Some(deep_canvas_scene3d::geom::Mesh {
                positions: points,
                indices,
                ..Default::default()
            })
        } else {
            return Err(unreadable("its kind has no triangles to read".into()));
        };
        let mesh = mesh
            .filter(|m| !m.indices.is_empty())
            .ok_or_else(|| unreadable("it built no triangles".into()))?;
        let mut indices = mesh.indices;
        // A placement that turns space inside out turns each triangle's winding with it.
        let det = m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1])
            - m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0])
            + m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);
        if det < 0.0 {
            indices
                .as_chunks_mut::<3>()
                .0
                .iter_mut()
                .for_each(|t| t.swap(1, 2));
        }
        Ok(Fetched {
            points: mesh.positions.iter().map(|p| place(m, *p)).collect(),
            indices,
        })
    }

    /// The input's items in one deliverable, read and compared.
    fn read_shape(
        &self,
        doc: &str,
        rev: &crate::query::Revision,
        input: &Input,
        planted: Planted,
    ) -> Result<Read, Stop> {
        let t = self
            .resolve_time(doc, &input.at)
            .map_err(|code| Stop::Refused(json!({"code": code, "path": "at"})))?;
        let mut drawn = rev.drawn.clone();
        if drawn.get("size").is_none() {
            drawn["size"] = json!([640, 480]);
        }
        let placed: BTreeMap<String, (Value, Affine3)> = scene::placed_at(&drawn, t)
            .map_err(|r| Stop::Blocked(json!({"code": r.code, "path": r.path, "ids": input.of})))?
            .into_iter()
            .map(|(id, item, m)| (id, (item, m)))
            .collect();
        let get = |id: &str, path: String| -> Result<Fetched, Stop> {
            match placed.get(id) {
                Some((item, _)) if planted.unplaced && item["kind"] == super::ASSET => self
                    .fetch(
                        &drawn,
                        id,
                        item,
                        &[
                            [1.0, 0.0, 0.0, 0.0],
                            [0.0, 1.0, 0.0, 0.0],
                            [0.0, 0.0, 1.0, 0.0],
                        ],
                        t,
                    )
                    .map_err(Stop::Blocked),
                Some((item, m)) => self.fetch(&drawn, id, item, m, t).map_err(Stop::Blocked),
                // Skipped as a kind this build doesn't know: BLOCKED, as the claim's other checks are.
                None if rev.doc.pointer(&format!("/items/{id}")).is_some() => Err(Stop::Blocked(
                    json!({"code": "unknown_kind", "ids": [id], "kind": rev.doc.pointer(&format!("/items/{id}/kind"))}),
                )),
                None => Err(Stop::Refused(
                    json!({"code": "ref_unresolved", "path": path}),
                )),
            }
        };
        let mut items = Vec::new();
        for (k, id) in input.of.iter().enumerate() {
            items.push((id.clone(), get(id, format!("of/{k}"))?));
        }
        let mut under = BTreeMap::new();
        for (i, r) in input.readings.iter().enumerate() {
            if let Reading::Rests { on: Some(id) } = r {
                under.insert(id.clone(), get(id, format!("readings/{i}/rests/on"))?);
            }
        }
        let start = std::time::Instant::now();
        let (mut points, mut indices, mut starts) = (Vec::new(), Vec::new(), Vec::new());
        for (id, f) in &items {
            starts.push((id.clone(), indices.len() as u32 / 3));
            let base = points.len() as u32;
            points.extend_from_slice(&f.points);
            indices.extend(f.indices.iter().map(|i| i + base));
        }
        let whole = input
            .readings
            .iter()
            .any(|r| !matches!(r, Reading::Section { .. }));
        let surface = whole.then(|| Surface::read(&points, &indices, planted.core));
        let read = Read::of(
            input,
            &points,
            &indices,
            surface.as_ref(),
            &under,
            &starts,
            t,
            planted.core,
        );
        Ok(Read {
            ms: start.elapsed().as_secs_f64() * 1e3,
            ..read
        })
    }
}

fn with_doc(mut v: Value, doc: &str) -> Value {
    v["doc"] = json!(doc);
    v
}

/// Why a deliverable's readings stop: its input refers to nothing (INVALID), or an item can't be
/// read (BLOCKED).
enum Stop {
    Refused(Value),
    Blocked(Value),
}

/// One deliverable's readings: each result, each issue, and whether a reading it expects is
/// unknown.
#[derive(Default)]
struct Read {
    results: Vec<Value>,
    issues: Vec<Value>,
    unknown: bool,
    ms: f64,
}

impl Read {
    #[allow(clippy::too_many_arguments)]
    fn of(
        input: &Input,
        points: &[V3],
        indices: &[u32],
        surface: Option<&Surface>,
        under: &BTreeMap<String, Fetched>,
        starts: &[(String, u32)],
        t: i64,
        planted: shape::Planted,
    ) -> Read {
        let mut read = Read::default();
        // A part's name: the item its first triangle is in, and its order among that item's parts.
        let owner = |tri: u32| starts.iter().rposition(|(_, s)| *s <= tri).unwrap_or(0);
        let mut names = Vec::new();
        let mut seen: BTreeMap<usize, usize> = BTreeMap::new();
        for p in surface.map_or(&[][..], |s| &s.parts[..]) {
            let o = owner(p.first);
            let n = seen.entry(o).or_insert(0);
            names.push(format!("{}#{n}", starts[o].0));
            *n += 1;
        }
        let local = |tri: u32| tri - starts[owner(tri)].1;
        let of = json!(input.of);
        for (i, r) in input.readings.iter().enumerate() {
            let path = format!("readings/{i}");
            let mut rows: Vec<Value> = Vec::new();
            match (r, surface) {
                (Reading::Bare("parts"), Some(s)) => {
                    rows.push(json!({"ids": names, "value": s.parts.len()}))
                }
                (Reading::Bare(name), Some(s)) => {
                    for (p, part) in s.parts.iter().enumerate() {
                        let value = match *name {
                            "closed" => json!(part.open.is_none()),
                            "holes" => part.holes.map_or(json!("unknown"), |h| json!(h)),
                            _ => part.volume.map_or(json!("unknown"), |v| json!(v)),
                        };
                        let mut row = json!({"ids": [names[p]], "value": value});
                        if let Some(open) = &part.open {
                            row["edge"] = json!(open.edge);
                            if !open.faces.is_empty() {
                                row["faces"] =
                                    json!(open.faces.iter().map(|f| local(*f)).collect::<Vec<_>>());
                            }
                        }
                        rows.push(row);
                    }
                }
                (Reading::Section { axis, at }, _) => {
                    let cut = shape::section(points, indices, *axis, *at, planted);
                    let loops: Vec<Value> = cut
                        .loops
                        .iter()
                        .map(|l| json!({"area": l.area, "centroid": l.centroid}))
                        .collect();
                    rows.push(json!({"ids": of, "axis": AXES[*axis], "at": at, "value": cut.loops.len(), "loops": loops, "open": cut.open}));
                }
                (Reading::Probe { from, dir }, Some(s)) => {
                    let hits = s.probe(*from, *dir, planted);
                    let mut row =
                        json!({"ids": of, "from": from, "dir": dir, "value": !hits.is_empty()});
                    if let (Some(a), Some(b)) = (hits.first(), hits.last()) {
                        row["entry"] = json!(a);
                        row["exit"] = json!(b);
                    }
                    rows.push(row);
                }
                (Reading::Tips { axis }, Some(s)) => {
                    rows.push(json!({"ids": of, "axis": AXES[*axis], "value": s.tips(*axis).map_or(json!("unknown"), |n| json!(n))}));
                }
                (Reading::Rests { on }, Some(s)) => {
                    let below = on
                        .as_ref()
                        .and_then(|id| under.get(id))
                        .map(|f| Surface::read(&f.points, &f.indices, shape::Planted::default()));
                    let mut row = json!({"ids": of, "on": on.as_deref().unwrap_or("ground")});
                    match s.rests(below.as_ref()) {
                        Rest::Gap(g) => {
                            row["value"] = json!(g.abs() <= TOUCH);
                            row["gap"] = json!(g);
                        }
                        Rest::Nothing => row["value"] = json!(false),
                        Rest::Unknown => row["value"] = json!("unknown"),
                    }
                    rows.push(row);
                }
                _ => {}
            }
            let name = r.name();
            for mut row in rows {
                row["reading"] = json!(name);
                row["path"] = json!(path);
                if let Some(expected) = input.expect.get(name) {
                    if row["value"] == "unknown" {
                        read.unknown = true;
                    } else if !meets(expected, &row["value"]) {
                        read.issues
                            .push(issue(&row, &input.written[i], expected, t));
                    }
                }
                read.results.push(row);
            }
        }
        read
    }
}

/// The issue a reading that differs from its expected value raises, naming the part, the reading
/// and both values.
fn issue(row: &Value, written: &Value, expected: &Value, t: i64) -> Value {
    let ids: Vec<&str> = row["ids"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(Value::as_str)
        .collect();
    let what_of = match row["reading"].as_str().unwrap_or("") {
        "section" => format!(
            "the section across {} at {} m",
            row["axis"].as_str().unwrap_or(""),
            row["at"]
        ),
        "probe" => format!("the probe from {} along {}", row["from"], row["dir"]),
        "tips" => format!("tips round {}", row["axis"].as_str().unwrap_or("")),
        r => r.to_string(),
    };
    json!({"check": GEOMETRY_SHAPE, "code": "geometry.reading", "severity": "error", "ids": ids,
           "path": row["path"], "reading": written, "expected": expected, "actual": row["value"], "t": t,
           "what": format!("{}: {what_of} reads {}, expected {expected}", ids.join(", "), row["value"]),
           "fix": "change the part's geometry, or the expected value if the requirement was wrong"})
}

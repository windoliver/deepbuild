//! #537: what `view3d` does for a scene whose items read a piece's logic arrays
//! (tests/acceptance/537/README.md: The surface under test). Its logic items run in the call, as
//! its physics worlds bake (#1921): each program read from the call's assets by its SHA-256 and
//! stepped from step 0 over the frames the call draws, the arrays it wrote baked into the
//! document's `arrays`, which scene3d's readers fold at each frame's t, so a seek reads what play
//! does. A frame also reports a fed instancer's elements and its parts' nodes, the selection less
//! the elements a slot no longer holds, and a logic line's segments and the array rows it wrote.

use std::collections::BTreeMap;
use std::path::PathBuf;
use std::rc::Rc;

use deep_canvas_scene3d::scene::{placed_at, Assets, Refused, Scene};
use deep_canvas_scene3d::{points, slots};
use deep_logic::piece::{check_in, History};
use deep_logic::services::Service;
use deep_logic::world::{track_of, Record, World};
use deep_physics_rapier::cast::{self, Caster};
use deep_scene3d_render::Counts;
use serde_json::{json, Map, Value};

use crate::view3d::FLICKS_PER_SECOND;
use crate::{refused, Planted};

/// The name of the wrong program scene3d holds for #537 that `planted` is, if it is one.
fn plant_name(planted: Option<Planted>) -> Option<&'static str> {
    match planted? {
        Planted::InstancerAddressesBySlot => Some(slots::SLOT_ALONE),
        Planted::PartPoseInWorldSpace => Some(slots::POSE_IN_WORLD),
        _ => None,
    }
}

fn refusal(r: Refused) -> Value {
    refused(r.code, r.path)
}

/// A call's logic bake: each array its logic items wrote, by form, and the rows each one held at
/// the frame this session settled last.
#[derive(Default)]
pub(crate) struct Baked {
    arrays: Map<String, Value>,
    rows: BTreeMap<String, (i64, Vec<Value>)>,
}

/// Each logic item of `doc` stepped from step 0 through the step the last of `frames` (in the
/// order drawn, at `fps`) reads, its program read from `assets`: the arrays it wrote, each step's
/// changes with the ranges the logic module hands over. The planted line reads each array its
/// points read a step late.
pub(crate) fn bake(
    doc: &mut Value,
    assets: &BTreeMap<String, PathBuf>,
    (frames, fps): (&[u64], u64),
    planted: Option<Planted>,
) -> Result<Baked, Value> {
    let last = frames.iter().max().copied().unwrap_or(0);
    let until = (last * FLICKS_PER_SECOND / fps.max(1)) as i64;
    let items: Map<String, Value> = (doc["items"].as_object().into_iter().flatten())
        .filter(|(_, i)| i["kind"] == "logic@1")
        .map(|(id, i)| {
            (
                id.clone(),
                json!({"kind": "logic@1", "params": i["params"].clone()}),
            )
        })
        .collect();
    if items.is_empty() {
        return Ok(Baked::default());
    }
    // #853: what stepped particles published after each step, each read by its name.
    let (count_reads, centre_reads, published) = crate::particles::stepped::published(doc);
    let piece = json!({
        "seed": doc["seed"].as_i64().unwrap_or(0),
        "controls": doc.get("controls").cloned().unwrap_or(json!({})),
        "items": items,
        "count_reads": count_reads,
        "centre_reads": centre_reads,
    });
    let read = |sha: &str| std::fs::read(assets.get(sha)?).ok();
    // #213: physics.cast@1 answers the logic items' requests on the document's worlds.
    let caster = std::cell::RefCell::new(Caster::new(doc, &[], false));
    let cast = Service {
        name: cast::NAME.into(),
        request: cast::REQUEST as u32,
        result: cast::RESULT as u32,
        max_per_step: cast::MAX_PER_STEP,
        fuel_per_request: cast::FUEL_PER_REQUEST,
        answer: Rc::new(move |t, r| caster.borrow_mut().answer(t, r)),
    };
    let piece = check_in(
        &piece,
        &Default::default(),
        &mut History::new(),
        &read,
        &[cast],
    )
    .map_err(|r| json!({"code": "logic_refused", "refusal": r.0}))?;
    // #2760: an occurrence list is whole before playback, so a piece that emits steps through
    // the transport's span, as deep_show's bake does.
    let span = doc.pointer("/transport/span").cloned().unwrap_or(json!(0));
    let span = deep_canvas::document::duration(doc, &span).unwrap_or(0);
    let emits = piece.items.iter().any(|i| !i.emits.is_empty());
    let until = if emits { until.max(span) } else { until };
    let steps = (piece.items.iter())
        .map(|i| until.max(0) / i.step.max(1) + 1)
        .max()
        .unwrap_or(0);
    let piece = Rc::new(piece);
    let mut rec = Record::default();
    let mut world = World::new(
        piece.clone(),
        track_of(&published),
        false,
        Default::default(),
        &mut rec,
        None,
    )
    .map_err(|f| json!({"code": "logic_refused", "refusal": f}))?;
    world.run(steps, &mut rec, &mut |_, _| {});
    let mut scratch = json!({"items": doc["items"].clone(), "arrays": rec.arrays(&piece)});
    if planted == Some(Planted::LineReadsPreviousStep) {
        points::plant_previous_step(&mut scratch);
    }
    let mut arrays = match scratch["arrays"].take() {
        Value::Object(m) => m,
        _ => Map::new(),
    };
    // #265: a document that reads an item's place at earlier times (a trail, a wake, a
    // world-space emitter's anchor) keeps every array whole in the document itself, so those reads
    // fold the bake's earlier steps through the same chain a frame reads, and particles evaluated
    // from the document see them too; nothing is left for a frame to settle.
    if reads_earlier(doc) {
        let all = doc
            .as_object_mut()
            .map(|o| o.entry("arrays").or_insert_with(|| json!({})));
        if let Some(Value::Object(all)) = all {
            all.append(&mut arrays);
        }
    }
    // #2760: each emitting item's list in the document's `occurrences`, where the readers of a
    // baked list read it: each row with its declared fields beside `t`, `step`, `kind`, `a` and
    // `b`, as Spawn and motion read a row (deep-play's `inline_logic` writes the same).
    for (id, rows) in rec.occurrences(&piece) {
        let flat = |row: &Value| {
            let mut out = row.as_object().cloned().unwrap_or_default();
            if let Some(Value::Object(fields)) = out.remove("fields") {
                out.extend(fields);
            }
            Value::Object(out)
        };
        let rows = rows.as_array().into_iter().flatten().map(flat).collect();
        doc["occurrences"][format!("{id}.occurrences")] = Value::Array(rows);
    }
    // #552: the occurrences this copy's player doesn't see leave every gated list.
    let (items, me) = (doc["items"].clone(), doc["match.me"].clone());
    if let Some(lists) = doc.get_mut("occurrences").and_then(Value::as_object_mut) {
        let fogged = deep_logic::fog::gate(&items, &arrays, lists, &me);
        if !fogged.is_empty() {
            doc["fogged"] = Value::Object(fogged);
        }
    }
    Ok(Baked {
        arrays,
        rows: BTreeMap::new(),
    })
}

impl Baked {
    /// #269: the arrays the bake left out of the document.
    pub(crate) fn into_arrays(self) -> Map<String, Value> {
        self.arrays
    }

    /// Writes into `doc`'s `arrays` each baked array as a frame at `t` reads it: one step holding
    /// every row as the steps through t's left it, so scene3d's readers fold it at t as they
    /// would the whole bake. From the rows a frame at an earlier t of this session settled, only
    /// the steps since apply; a seek back starts again from step 0. A linear array stays whole.
    pub(crate) fn settle(&mut self, doc: &mut Value, t: i64) {
        let mut out = Map::new();
        for (form, array) in &self.arrays {
            if array["linear"] == json!(true) {
                out.insert(form.clone(), array.clone());
                continue;
            }
            let every = array["every"].as_i64().unwrap_or(1).max(1);
            let n = array["count"].as_u64().unwrap_or(0) as usize;
            let k = t.div_euclid(every);
            let zero = match array["type"].as_str() {
                Some("vec2") => json!([0, 0]),
                Some("vec3") => json!([0, 0, 0]),
                Some("quat") => json!([0, 0, 0, 0]),
                _ => json!(0),
            };
            let (from, mut rows) = match self.rows.remove(form) {
                Some((last, rows)) if last <= k && rows.len() == n => (last, rows),
                _ => (i64::MIN, vec![zero; n]),
            };
            for s in array["steps"].as_array().into_iter().flatten() {
                let step = s["step"].as_i64().unwrap_or(0);
                if step <= from || step > k {
                    continue;
                }
                for run in s["values"].as_array().into_iter().flatten() {
                    let start = run[0].as_u64().unwrap_or(0) as usize;
                    for (j, v) in run[1].as_array().into_iter().flatten().enumerate() {
                        if let Some(r) = rows.get_mut(start + j) {
                            r.clone_from(v);
                        }
                    }
                }
            }
            let one = json!({"type": array["type"], "count": n, "every": every, "linear": false,
                "steps": [{"step": k, "changed": [[0, n]], "values": [[0, rows]]}]});
            self.rows.insert(form.clone(), (k, rows));
            out.insert(form.clone(), one);
        }
        if out.is_empty() {
            return;
        }
        if let Some(o) = doc.as_object_mut() {
            if let Some(all) = o
                .entry("arrays")
                .or_insert_with(|| json!({}))
                .as_object_mut()
            {
                all.extend(out);
            }
        }
    }
}

/// Each path of `paths` (`items/<id>/<field>…`) as the canvas core evaluates `doc` at `t` (#429),
/// null where the item or field isn't there; a fed instancer's `elements` and `nodes/<node>` its
/// readings.
pub(crate) fn values(
    doc: &Value,
    scene: &Scene,
    t: i64,
    paths: &[String],
    (assets, planted): (Assets<'_>, Option<Planted>),
) -> Result<Value, Value> {
    let items = placed_at(doc, t).map_err(refusal)?;
    let moved = transforms(doc, t, paths);
    let mut out = Map::new();
    for path in paths {
        let rest = path.strip_prefix("items/").unwrap_or_default();
        let (id, field) = rest.split_once('/').unwrap_or((rest, ""));
        let value = match contributed(doc, scene, id, field) {
            Some(v) => v,
            None => match slots::reading(doc, t, (id, field), Some(assets), plant_name(planted))
                .map_err(refusal)?
            {
                Some(v) => v,
                // #265: an item's `at` as its channels and drivers move it, a logic array's
                // read included, where the placed item holds it as written.
                None if field.starts_with("at/") && moved.contains_key(id) => moved[id]
                    .pointer(&format!("/{field}"))
                    .cloned()
                    .unwrap_or(Value::Null),
                None => (items.iter().find(|(i, _, _)| i == id))
                    .and_then(|(_, item, _)| item.pointer(&format!("/{field}")))
                    .cloned()
                    .unwrap_or(Value::Null),
            },
        };
        out.insert(path.clone(), value);
    }
    Ok(Value::Object(out))
}

/// #265: the items `paths` name whose `at` a channel or a driver writes, as the motion program
/// evaluates them at `t`, each one's `at` from the transform those write.
fn transforms(doc: &Value, t: i64, paths: &[String]) -> Map<String, Value> {
    use deep_canvas_motion::{eval, program::Program};
    let targets = |key: &str| {
        (doc[key].as_object().into_iter().flatten()).filter_map(|(_, c)| c["target"].as_str())
    };
    let moved: Vec<&str> = targets("channels").chain(targets("drivers")).collect();
    let asked = |id: &str| {
        let at = format!("items/{id}/at/");
        let named = paths.iter().any(|p| {
            p.strip_prefix("items/")
                .and_then(|r| r.split('/').next())
                .is_some_and(|i| i == id)
        });
        named && moved.iter().any(|m| m.starts_with(&at))
    };
    let Some(Ok(program)) = doc.as_object().map(Program::compile) else {
        return Map::new();
    };
    let mut state = program.state();
    program.evaluate_local(t, eval::Validity::Full, &mut state);
    let map = doc.as_object().expect("compiled above");
    let written = eval::written_with(map, &program, &state, asked);
    written.into_iter().filter(|(id, _)| asked(id)).collect()
}

/// #468: what scene3d evaluates a path to at t, where it contributes: the camera's field of
/// view from its lens and its exposure from the lens as an EV100 (Camera `camera@1`: lens), a
/// dof's focus distance in m (a focus pull's included), and a line's points in the world.
fn contributed(doc: &Value, scene: &Scene, id: &str, field: &str) -> Option<Value> {
    let camera = doc.get("camera").and_then(Value::as_str) == Some(id);
    match field {
        "params/fov" if camera => scene.optics.fov(scene.camera.size).map(Value::from),
        "params/exposure" if camera => {
            let rate = doc
                .get("transport")
                .and_then(deep_canvas::document::frame_rate_of)
                .filter(|(p, q)| *p > 0 && *q > 0)
                .map_or(60.0, |(p, q)| f64::from(p) / f64::from(q));
            scene.optics.ev100(rate).map(Value::from)
        }
        "params/dof/focus" => scene
            .dof
            .as_ref()
            .filter(|d| d.id == id)
            .map(|d| Value::from(d.focus)),
        "params/points" => scene
            .layers
            .iter()
            .flat_map(|l| &l.lines)
            .find(|l| l.id == id && !l.points.is_empty())
            .map(|l| json!(l.points)),
        _ => None,
    }
}

/// The selection a frame at `t` presents: the call's, then the viewer's, each less the elements
/// of a fed instancer whose slot no longer holds them (Instance `instance@1`: logic columns). The
/// planted instancer that addresses elements by slot alone renames `scene`'s fed elements first.
pub(crate) fn framed(
    scene: &mut Scene,
    doc: &Value,
    t: i64,
    (call, viewer): (&mut Vec<String>, &mut Vec<String>),
    planted: Option<Planted>,
) -> Value {
    if planted == Some(Planted::InstancerAddressesBySlot) {
        for l in &mut scene.layers {
            slots::plant_slot_alone(&mut l.solids);
        }
    }
    slots::drop_stale(doc, t, call, plant_name(planted));
    slots::drop_stale(doc, t, viewer, plant_name(planted));
    json!(call.iter().chain(viewer.iter()).collect::<Vec<_>>())
}

/// Whether `doc` reads an item's place at earlier times than the frame's (#265): a line's trail,
/// a water material's wake, or a world-space particles item, each through the chain a trail reads.
fn reads_earlier(doc: &Value) -> bool {
    (doc["items"].as_object().into_iter().flatten()).any(|(_, i)| {
        let p = &i["params"];
        !p["trail"].is_null()
            || p.pointer("/water/wake/item").is_some()
            || (i["kind"] == "particles@1" && p["space"] == "world")
    })
}

/// The lines of `doc` whose points read a logic array, or (#468) name an item's anchor.
fn logic_lines(doc: &Value) -> impl Iterator<Item = &String> {
    let anchored = |i: &Value| {
        (i.pointer("/params/points")
            .and_then(Value::as_array)
            .into_iter()
            .flatten())
        .any(|p| p.as_str().is_some_and(|h| h.contains('#')))
    };
    (doc["items"].as_object().into_iter().flatten())
        .filter(move |(_, i)| {
            i["kind"] == "mark.line@1"
                && (i.pointer("/params/points/array").is_some() || anchored(i))
        })
        .map(|(id, _)| id)
}

/// Each line of `scene` whose points read a logic array, or name an item's anchor: its segments
/// as the frame uploaded them, in world m, a hidden one null.
pub(crate) fn segments(scene: &Scene, doc: &Value) -> Map<String, Value> {
    let ids: Vec<&String> = logic_lines(doc).collect();
    (scene.layers.iter().flat_map(|l| &l.lines))
        .filter(|l| ids.contains(&&l.id))
        .map(|l| {
            let list: Vec<Value> = (l.segments.iter())
                .map(|s| {
                    if s.hidden {
                        Value::Null
                    } else {
                        json!([s.a, s.b])
                    }
                })
                .collect();
            (l.id.clone(), Value::Array(list))
        })
        .collect()
}

/// Each line of `doc` whose points read a logic array: the array's rows whose segments the frame
/// wrote to the GPU (`counts`' segment uploads, by line).
pub(crate) fn rows(doc: &Value, counts: &Counts) -> Value {
    let out: Map<String, Value> = logic_lines(doc)
        .map(|id| {
            let written = counts
                .segment_uploads
                .get(id)
                .map_or(&[][..], Vec::as_slice);
            (id.clone(), json!(points::uploaded_rows(doc, id, written)))
        })
        .collect();
    Value::Object(out)
}

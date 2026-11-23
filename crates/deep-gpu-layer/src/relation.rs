//! The `relation` call (issue #458; tests/acceptance/458/relations/README.md: `relation`): one
//! rendering relation as the parity suite's full lane holds it. Each side is drawn once as a
//! check draws a canonical render (`view3d`, class export), the relation's rule is judged on the
//! targets the sides returned, and the reply names each target's file, the verdict, and on a
//! FAIL the relation and the first pixel that breaks it. Nothing here runs in a live view or an
//! export.

use std::collections::BTreeMap;

use serde_json::{json, Map, Value};

use crate::{refused, view3d, App};

/// Each relation's sides and the targets it returns, by the reply's names.
const RELATIONS: [(&str, &[&str], &[&str]); 8] = [
    ("exposure-doubles", &["base", "up"], &["exposed"]),
    ("lights-add", &["a", "b", "ab"], &["linear"]),
    ("ortho-shift", &["base", "moved"], &["linear"]),
    ("sphere-turn", &["base", "turned"], &["linear"]),
    (
        "occluder-never-brightens",
        &["without", "with"],
        &["lighting"],
    ),
    (
        "instances-keep-hash",
        &["mesh", "instances"],
        &["color", "normal", "depth", "velocity", "ids"],
    ),
    ("translation", &["base", "moved"], &["final", "ids"]),
    ("light-level", &["base", "scaled"], &["exposed"]),
];
/// Two steps of a 16-bit float: what "equals" holds within on the linear targets.
const STEP16: f64 = 1.0 / 512.0;
/// Light-level invariance's tolerance.
const LEVEL: f64 = 1e-4;

/// One side as it drew: each target's file name and bytes, its pick table, and the lights its
/// frame shaded.
struct Side {
    files: BTreeMap<&'static str, String>,
    bytes: BTreeMap<&'static str, Vec<u8>>,
    picks: Value,
    shaded: Vec<String>,
}

/// A rule's break: the target, the pixel, and what the reason says beside the relation's name.
struct Break {
    target: &'static str,
    pixel: [u32; 2],
    what: String,
    item: Option<String>,
    light: Option<String>,
}

pub fn call(app: &mut App, out: &str, call: &Value) -> Value {
    match run(app, out, call) {
        Ok(v) | Err(v) => v,
    }
}

fn run(app: &mut App, out: &str, call: &Value) -> Result<Value, Value> {
    let bad = |what: &str| refused("bad_input", what);
    let name = call["relation"].as_str().unwrap_or_default();
    let Some((name, sides, targets)) = RELATIONS.iter().find(|r| r.0 == name).copied() else {
        return Err(bad("relation is one of the eight the full lane holds"));
    };
    let size: [u32; 2] =
        serde_json::from_value(call["size"].clone()).map_err(|_| bad("size is [w, h]"))?;
    let (frame, fps) = (call["frame"].as_u64(), call["fps"].as_u64());
    let (Some(frame), Some(fps)) = (frame, fps) else {
        return Err(bad("frame and fps are whole numbers"));
    };
    let given = call["sides"].as_object().ok_or_else(|| bad("sides"))?;
    if given.len() != sides.len() || sides.iter().any(|s| !given.contains_key(*s)) {
        return Err(bad("sides are exactly the relation's"));
    }
    // #458: on a software adapter a relation draws nothing and is BLOCKED, naming the adapter.
    if let Some(reason) = crate::full_lane::software(app) {
        return Ok(json!({"relation": name, "result": "BLOCKED", "reason": reason, "sides": {}}));
    }
    let mut drawn: BTreeMap<&str, Side> = BTreeMap::new();
    for side in sides {
        let s = draw(app, out, call, &given[*side], size, (frame, fps), targets)?;
        drawn.insert(side, s);
    }
    let broke = judge(name, &drawn, size, call);
    let mut reply = Map::new();
    reply.insert("relation".into(), json!(name));
    reply.insert(
        "result".into(),
        json!(if broke.is_some() { "FAIL" } else { "PASS" }),
    );
    let files = |s: &Side| -> Value {
        Value::Object(
            targets
                .iter()
                .filter_map(|t| Some((t.to_string(), json!(s.files.get(t)?))))
                .collect(),
        )
    };
    reply.insert(
        "sides".into(),
        Value::Object(
            sides
                .iter()
                .map(|s| (s.to_string(), files(&drawn[s])))
                .collect(),
        ),
    );
    if name == "instances-keep-hash" {
        let hashes = |s: &Side| -> Value {
            Value::Object(
                ["color", "normal", "depth", "velocity"]
                    .iter()
                    .filter_map(|t| Some((t.to_string(), json!(pixel_hash(s.bytes.get(t)?, size)))))
                    .collect(),
            )
        };
        let of = |f: &dyn Fn(&Side) -> Value| -> Value {
            Value::Object(
                sides
                    .iter()
                    .map(|s| (s.to_string(), f(&drawn[s])))
                    .collect(),
            )
        };
        reply.insert("hashes".into(), of(&hashes));
        reply.insert("picks".into(), of(&|s: &Side| s.picks.clone()));
    }
    if let Some(b) = broke {
        let mut first = json!({"target": b.target, "pixel": b.pixel});
        let mut reason = format!("{name}: {}", b.what);
        if let Some(item) = b.item {
            reason = format!("{reason}; the item there is {item}");
            first["item"] = json!(item);
        }
        if let Some(light) = b.light {
            reason = format!("{reason}; the light one side shades and the other cuts is {light}");
            first["light"] = json!(light);
        }
        reply.insert("reason".into(), json!(reason));
        reply.insert("first".into(), first);
    }
    Ok(Value::Object(reply))
}

/// One side's draw: `view3d` at the frame, as an export, with the targets the relation reads.
fn draw(
    app: &mut App,
    out: &str,
    call: &Value,
    side: &Value,
    size: [u32; 2],
    (frame, fps): (u64, u64),
    targets: &[&'static str],
) -> Result<Side, Value> {
    let wants = |t: &str| targets.contains(&t);
    // The reply's names for view3d's own: `color` is its linear target, `lighting` the linear
    // target of the scene on a white albedo, `normal` the solids' normals.
    let mut asked: Vec<&str> = Vec::new();
    for (target, of) in [
        ("linear", "linear"),
        ("color", "linear"),
        ("lighting", "linear"),
        ("final", "final"),
        ("ids", "ids"),
        ("depth", "depth"),
        ("velocity", "velocity"),
        ("normal", "normal"),
    ] {
        if wants(target) && !asked.contains(&of) {
            asked.push(of);
        }
    }
    app.relation_reads.clear();
    for (target, reads) in [
        ("exposed", "exposed"),
        ("normal", "geometry_normal"),
        ("lighting", "lighting"),
    ] {
        if wants(target) {
            app.relation_reads.insert(reads);
        }
    }
    let mut view = json!({
        "call": "view3d", "doc": side["doc"], "look": side["look"], "size": size,
        "class": "export", "fps": fps, "from": frame, "frames": 1, "capture": [frame],
        "targets": asked, "light_cut": true,
    });
    if !call["assets"].is_null() {
        view["assets"] = call["assets"].clone();
    }
    let reply = view3d::call(app, out, &view);
    app.relation_reads.clear();
    if reply.get("code").is_some() {
        return Err(reply);
    }
    let shot = &reply["frames"][0];
    let mut side = Side {
        files: BTreeMap::new(),
        bytes: BTreeMap::new(),
        picks: shot["picks"].clone(),
        shaded: shot["light_cut"]["shaded"]
            .as_array()
            .into_iter()
            .flatten()
            .filter_map(|l| l["light"].as_str().map(str::to_string))
            .collect(),
    };
    let file_of = |of: &str, ext: &str| -> Result<Option<(String, Vec<u8>)>, Value> {
        let Some(file) = shot[of].as_str() else {
            return Ok(None);
        };
        let path = std::path::Path::new(out).join(format!("{file}.{ext}"));
        let read = std::fs::read(&path).map_err(|e| refused("render_failed", e.to_string()))?;
        Ok(Some((file.to_string(), read)))
    };
    for target in targets {
        let (of, ext) = match *target {
            "color" | "lighting" => ("linear", "f32"),
            "normal" => ("geometry_normal", "f32"),
            "final" | "ids" => (*target, "png"),
            other => (other, "f32"),
        };
        let Some((mut file, mut bytes)) = file_of(of, ext)? else {
            return Err(refused(
                "render_failed",
                format!("the frame holds no {target} target"),
            ));
        };
        if ext == "png" {
            bytes = image::load_from_memory(&bytes)
                .map_err(|e| refused("render_failed", e.to_string()))?
                .to_rgba8()
                .into_raw();
        }
        // The normal target in view3d's layout, three f32 a pixel: the water's shaded normal
        // where the frame draws water (#968), and each opaque solid's own normal elsewhere.
        if *target == "normal" {
            let water = file_of("normal", "f32")?.map(|(_, b)| b);
            let mut out_bytes = Vec::with_capacity(bytes.len() / 16 * 12);
            for (p, texel) in bytes.as_chunks::<16>().0.iter().enumerate() {
                let wet = water
                    .as_ref()
                    .map(|w| &w[p * 12..p * 12 + 12])
                    .filter(|w| w.iter().any(|b| *b != 0));
                out_bytes.extend_from_slice(wet.unwrap_or(&texel[..12]));
            }
            file = view3d::write_named(out, &out_bytes, "f32")?;
            bytes = out_bytes;
        }
        side.files.insert(target, file);
        side.bytes.insert(target, bytes);
    }
    Ok(side)
}

/// The GPU pixel hash's CPU twin (#1897) over a target's bytes, a word a texel: equal for two
/// targets exactly when their bytes are.
fn pixel_hash(bytes: &[u8], size: [u32; 2]) -> String {
    use deep_gpu::pixel_hash::{cpu, Format, Planted};
    let words = (bytes.len() / 4) as u32;
    let rows = size[1].max(1);
    cpu(
        bytes,
        [words / rows, rows],
        Format::Rgba8,
        Planted::default(),
    )
    .iter()
    .map(|b| format!("{b:02x}"))
    .collect()
}

fn floats(bytes: &[u8]) -> Vec<f32> {
    bytes
        .as_chunks::<4>()
        .0
        .iter()
        .map(|b| f32::from_le_bytes(*b))
        .collect()
}

/// The first pixel whose R, G or B in `got` isn't within `tol` relative of `want`'s; `want`
/// gives nothing where the relation says nothing.
fn first_off(
    got: &[f32],
    size: [u32; 2],
    tol: f64,
    want: impl Fn(u32, u32, usize) -> Option<f64>,
) -> Option<([u32; 2], f64, f64)> {
    for y in 0..size[1] {
        for x in 0..size[0] {
            for c in 0..3 {
                let Some(w) = want(x, y, c) else { continue };
                let g = f64::from(got[((y * size[0] + x) * 4) as usize + c]);
                let within = (g - w).abs().partial_cmp(&(tol * g.abs().max(w.abs())));
                if !within.is_some_and(std::cmp::Ordering::is_le) {
                    return Some(([x, y], g, w));
                }
            }
        }
    }
    None
}

/// The item a side's ID target shows at a pixel, an instance's `#n` dropped.
fn item_at(side: &Side, size: [u32; 2], [x, y]: [u32; 2]) -> Option<String> {
    let ids = side.bytes.get("ids")?;
    let o = ((y * size[0] + x) * 4) as usize;
    let pick = u32::from_le_bytes([ids[o], ids[o + 1], ids[o + 2], ids[o + 3]]);
    let name = side.picks[pick.to_string()].as_str()?;
    Some(name.split('#').next().unwrap_or(name).to_string())
}

fn judge(
    name: &'static str,
    drawn: &BTreeMap<&str, Side>,
    size: [u32; 2],
    call: &Value,
) -> Option<Break> {
    let px = |side: &str, target: &str| floats(&drawn[side].bytes[target]);
    let at =
        |v: &[f32], x: u32, y: u32, c: usize| f64::from(v[((y * size[0] + x) * 4) as usize + c]);
    let float = |target: &'static str, (pixel, got, want): ([u32; 2], f64, f64)| Break {
        target,
        pixel,
        what: format!(
            "pixel ({}, {}) of {target} reads {got}, the relation gives {want}",
            pixel[0], pixel[1]
        ),
        item: None,
        light: None,
    };
    match name {
        "exposure-doubles" => {
            let (base, up) = (px("base", "exposed"), px("up", "exposed"));
            first_off(&up, size, STEP16, |x, y, c| Some(2.0 * at(&base, x, y, c)))
                .map(|b| float("exposed", b))
        }
        "lights-add" => {
            let (a, b, ab) = (px("a", "linear"), px("b", "linear"), px("ab", "linear"));
            first_off(&ab, size, STEP16, |x, y, c| {
                Some(at(&a, x, y, c) + at(&b, x, y, c))
            })
            .map(|b| float("linear", b))
        }
        "ortho-shift" => {
            let k: [i64; 2] = serde_json::from_value(call["k"].clone()).unwrap_or([0, 0]);
            let (base, moved) = (px("base", "linear"), px("moved", "linear"));
            first_off(&moved, size, STEP16, |x, y, c| {
                let (sx, sy) = (i64::from(x) + k[0], i64::from(y) + k[1]);
                let inside =
                    (0..i64::from(size[0])).contains(&sx) && (0..i64::from(size[1])).contains(&sy);
                inside.then(|| at(&base, sx as u32, sy as u32, c))
            })
            .map(|b| float("linear", b))
        }
        "sphere-turn" => {
            let (base, turned) = (px("base", "linear"), px("turned", "linear"));
            first_off(&turned, size, STEP16, |x, y, c| Some(at(&base, x, y, c)))
                .map(|b| float("linear", b))
        }
        "occluder-never-brightens" => {
            let (without, with) = (px("without", "lighting"), px("with", "lighting"));
            for y in 0..size[1] {
                for x in 0..size[0] {
                    for c in 0..3 {
                        let (w, g) = (at(&without, x, y, c), at(&with, x, y, c));
                        let under = g.partial_cmp(&(w + STEP16 * w.abs()));
                        if !under.is_some_and(std::cmp::Ordering::is_le) {
                            return Some(Break {
                                target: "lighting",
                                pixel: [x, y],
                                what: format!("pixel ({x}, {y}) of lighting reads {g} with the item added, {w} without"),
                                item: None,
                                light: None,
                            });
                        }
                    }
                }
            }
            None
        }
        "instances-keep-hash" => {
            let (mesh, split) = (&drawn["mesh"], &drawn["instances"]);
            for (target, texel) in [("color", 16), ("normal", 12), ("depth", 4), ("velocity", 8)] {
                let (a, b) = (&mesh.bytes[target], &split.bytes[target]);
                if let Some(i) = a.iter().zip(b).position(|(x, y)| x != y) {
                    let p = (i / texel) as u32;
                    let pixel = [p % size[0], p / size[0]];
                    return Some(Break {
                        target,
                        pixel,
                        what: format!("the {target} target differs between the mesh and the instances of its parts, first at pixel ({}, {})", pixel[0], pixel[1]),
                        item: None,
                        light: None,
                    });
                }
            }
            for y in 0..size[1] {
                for x in 0..size[0] {
                    let (a, b) = (item_at(mesh, size, [x, y]), item_at(split, size, [x, y]));
                    if a != b {
                        return Some(Break {
                            target: "ids",
                            pixel: [x, y],
                            what: format!("the ids target shows another item at pixel ({x}, {y}) of the instances"),
                            item: a.or(b),
                            light: None,
                        });
                    }
                }
            }
            None
        }
        "translation" => {
            let (base, moved) = (
                &drawn["base"].bytes["final"],
                &drawn["moved"].bytes["final"],
            );
            let pixels = (size[0] * size[1]) as usize;
            let (mut within, mut worst, mut at) = (0usize, 0u8, 0usize);
            for p in 0..pixels {
                let d = (0..3)
                    .map(|c| base[p * 4 + c].abs_diff(moved[p * 4 + c]))
                    .max()
                    .unwrap_or(0);
                within += usize::from(d <= 1);
                if d > worst {
                    (worst, at) = (d, p);
                }
            }
            let short = (within as f64) < 0.999 * pixels as f64;
            (short || worst > 4).then(|| {
                let pixel = [at as u32 % size[0], at as u32 / size[0]];
                // The item whose vertices moved: what either side shows there, or the nearest
                // item along the row.
                let shown = |p: [u32; 2]| {
                    item_at(&drawn["moved"], size, p).or_else(|| item_at(&drawn["base"], size, p))
                };
                let item = shown(pixel).or_else(|| {
                    (0..size[0]).find_map(|d| {
                        [pixel[0].checked_sub(d), pixel[0].checked_add(d).filter(|x| *x < size[0])]
                            .into_iter()
                            .flatten()
                            .find_map(|x| shown([x, pixel[1]]))
                    })
                });
                Break {
                    target: "final",
                    pixel,
                    what: format!(
                        "{within} of {pixels} pixels are within one code value of the untranslated frame, and pixel ({}, {}) is {worst} code values off",
                        pixel[0], pixel[1]
                    ),
                    item,
                    light: None,
                }
            })
        }
        "light-level" => {
            let (base, scaled) = (px("base", "exposed"), px("scaled", "exposed"));
            first_off(&scaled, size, LEVEL, |x, y, c| Some(at(&base, x, y, c))).map(|b| {
                // The light a cut took from one side alone, where there is one.
                let (a, b2) = (&drawn["base"].shaded, &drawn["scaled"].shaded);
                let light = a
                    .iter()
                    .find(|l| !b2.contains(l))
                    .or_else(|| b2.iter().find(|l| !a.contains(l)))
                    .cloned();
                Break {
                    light,
                    ..float("exposed", b)
                }
            })
        }
        _ => None,
    }
}

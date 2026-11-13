//! The loop canvas module (technical design: Canvas modules; canvas primitives: Check input:
//! loop kinds): the loop's check kinds. Issue #453 lands its first, `geometry.shading`'s defect
//! counts and quad ratio, on every `mesh.asset@1` item a document holds; #1935 its readings of
//! each UV set, hidden faces, unused vertices and islands.

pub mod count;
mod fixtures;
pub mod uv;

use deep_canvas::registry::{
    Dependency, Implementation, Manifest, Module, Raised, Range, Registrar, Report, Semver,
};
use deep_canvas_scene3d::gltf::{self, Raw};
use deep_canvas_scene3d::measures;
use serde_json::{json, Map, Value};

use count::{Counts, Edge, Opts, Prim};

pub const KIND: &str = "geometry.shading";

/// The wrong programs #453's and #1935's criteria plant in geometry.shading, each reachable only
/// through a proof surface's `planted`, which the hub puts in the check's input.
pub const PLANTED: [&str; 9] = [
    "no_weld",
    "one_winding_sum",
    "degenerate_exact_zero",
    "outward_skips_volume",
    "vertex_fans_skipped",
    "unreadable_skipped",
    "quad_fails_rigid",
    "pair_ignores_corners",
    "uv_overlap_from_boxes",
];

/// The most IDs a result lists per field.
const IDS: usize = 64;

const CODES: [&str; 7] = [
    "loop.unreadable",
    "loop.degenerate",
    "loop.flipped",
    "loop.inconsistent",
    "loop.normals_inward",
    "loop.quad_ratio",
    "loop.uv",
];

fn manifest() -> Manifest {
    let dep = |r: &str| Dependency {
        range: Range::parse(r).expect("a range"),
        optional: false,
    };
    Manifest {
        name: "loop".into(),
        version: Semver {
            major: 1,
            minor: 0,
            patch: 0,
        },
        core: Range::parse("*").expect("a range"),
        depends_on: [
            ("scene3d".to_string(), dep("^1")),
            ("look".to_string(), dep("^1")),
        ]
        .into_iter()
        .collect(),
        feature: "loop".into(),
        license: "Apache-2.0".into(),
        implements: "loop@1".into(),
        implementation: Implementation::reference(
            "loop",
            Semver::parse("1.0.0").expect("a version"),
        ),
    }
}

/// `loop`.
pub fn module() -> Module {
    Module {
        manifest: manifest(),
        register,
    }
}

fn register(r: &mut Registrar) {
    // Where only issues are read, what the check couldn't read is an error, never a pass.
    r.check(KIND, "any", &CODES, |lowered, input| {
        let out = report(lowered, input);
        let unread = out.blocked.into_iter().map(|b| {
            let id = b["item"].as_str().unwrap_or_default().to_string();
            let raised = Raised {
                code: "loop.unreadable",
                severity: "error",
                path: format!("items/{id}/params/sha256"),
                what: format!("a mesh geometry.shading can't read: {}", b["why"]),
                fix_ops: None,
            };
            (id, raised)
        });
        out.raised
            .into_iter()
            .map(|(id, raised, _)| (id, raised))
            .chain(unread)
            .collect()
    })
    .check_report(report);
    r.code(
        "loop.unreadable",
        "A mesh geometry.shading can't read: missing, compressed data no pinned tool decoded, not triangles, or away from its bind pose.",
        "Convert the asset to plain triangles at its bind pose, or pin the tool that decodes it.",
        false,
    );
    r.code(
        "loop.degenerate",
        "A face whose area is under degenerate_area of its part's bounds diagonal squared.",
        "Remove the face, or rebuild the mesh without slivers.",
        false,
    );
    r.code(
        "loop.flipped",
        "A face whose corner normals point against its own vector area.",
        "Wind the face to match its normals, or recompute its normals.",
        false,
    );
    r.code(
        "loop.inconsistent",
        "An edge whose two faces run it the same way, so their windings disagree.",
        "Wind the faces around the edge consistently.",
        false,
    );
    r.code(
        "loop.normals_inward",
        "A closed part whose signed volume is negative: its faces point inward.",
        "Reverse the part's winding and normals so they point outward.",
        false,
    );
    r.code(
        "loop.quad_ratio",
        "A mesh that deforms whose triangles pair back into quads under quad_min.",
        "Run a remesh job in quad mode on the mesh before it is rigged.",
        false,
    );
    r.code(
        "loop.uv",
        "A UV set past a limit: area outside the unit square on a set other than uv0, or the input's uv_overlap_max, uv_fill_min, min_gap_px or texel.",
        "Unwrap the set again with the padding and texel density it needs, its charts inside the unit square.",
        false,
    );
    fixtures::register(r);
}

/// A number from the check input, or its default.
fn number(input: &Value, path: &str, default: f64) -> f64 {
    input
        .pointer(path)
        .and_then(Value::as_f64)
        .unwrap_or(default)
}

/// One face's ID, `<primitive>:<triangle>`, from its index across the read primitives.
fn face_id(f: usize, read: &[(usize, Prim)]) -> String {
    let mut f = f;
    for (p, prim) in read {
        let n = prim.indices.len() / 3;
        if f < n {
            return format!("{p}:{f}");
        }
        f -= n;
    }
    String::new()
}

/// A welded vertex's ID, `<primitive>:<vertex>`, by its first member.
fn vertex_id(v: u32, c: &Counts, read: &[(usize, Prim)]) -> String {
    let mut i = c.first[v as usize];
    for (p, prim) in read {
        if i < prim.positions.len() {
            return format!("{p}:{i}");
        }
        i -= prim.positions.len();
    }
    String::new()
}

fn edge_id(e: &Edge, c: &Counts, read: &[(usize, Prim)]) -> String {
    format!("{}/{}", vertex_id(e[0], c, read), vertex_id(e[1], c, read))
}

/// A position's ID, `<primitive>:<vertex>`, from its index across the read primitives.
fn position_id(i: usize, read: &[(usize, Prim)]) -> String {
    let mut i = i;
    for (p, prim) in read {
        if i < prim.positions.len() {
            return format!("{p}:{i}");
        }
        i -= prim.positions.len();
    }
    String::new()
}

/// Each UV set's faces across the read primitives: set `k` holds the triangles of every
/// primitive that carries `TEXCOORD_k`.
fn uv_faces(read: &[(usize, Prim)], sets: &[Vec<Vec<[f64; 2]>>], c: &Counts) -> Vec<Vec<uv::Face>> {
    let n = read
        .iter()
        .map(|(p, _)| sets.get(*p).map_or(0, Vec::len))
        .max()
        .unwrap_or(0);
    let mut out: Vec<Vec<uv::Face>> = (0..n).map(|_| Vec::new()).collect();
    let (mut base, mut first) = (0usize, 0usize);
    for (p, prim) in read {
        let own = sets.get(*p).map_or(&[][..], Vec::as_slice);
        for (k, set) in own.iter().enumerate() {
            for (t, tri) in prim.indices.as_chunks::<3>().0.iter().enumerate() {
                let i = tri.map(|i| i as usize);
                out[k].push(uv::Face {
                    f: first + t,
                    uv: i.map(|i| set[i]),
                    v: i.map(|i| c.vertices[base + i]),
                    area: c.areas[first + t],
                });
            }
        }
        base += prim.positions.len();
        first += prim.indices.len() / 3;
    }
    out
}

/// geometry.shading on every `mesh.asset@1` item of `lowered`, given the check input with the
/// assets its items name.
pub fn report(lowered: &Value, input: &Value) -> Report {
    let planted = input.get("planted").and_then(Value::as_str);
    let plants = |p: &str| planted == Some(p);
    // A brief may only tighten the design's numbers.
    let opts = Opts {
        weld: number(input, "/weld", 0.00001).min(0.00001),
        degenerate_area: number(input, "/degenerate_area", 1e-12).max(1e-12),
        normal_max: number(input, "/pair/normal_max", 30.0).min(30.0),
        corner_max: number(input, "/pair/corner_max", 30.0).min(30.0),
        planted,
    };
    let quad_min = number(input, "/quad_min", 0.85).max(0.85);
    let outward = input.get("normals").and_then(Value::as_str) != Some("consistent");
    // #1935: the UV readings' raster and limits; a limit absent from the input never fails.
    let limit = |path: &str| input.pointer(path).and_then(Value::as_f64);
    let texel = match input
        .get("texel")
        .and_then(Value::as_array)
        .map(Vec::as_slice)
    {
        Some([lo, hi]) => lo.as_f64().zip(hi.as_f64()).map(|(l, h)| [l, h]),
        _ => None,
    };
    let uv_opts = uv::Opts {
        resolution: number(input, "/resolution", 1024.0).max(1.0),
        padding: number(input, "/padding", 4.0).max(0.0),
        min_gap_px: limit("/min_gap_px"),
        texel,
        boxes: plants("uv_overlap_from_boxes"),
    };
    let (overlap_max, fill_min) = (limit("/uv_overlap_max"), limit("/uv_fill_min"));
    let mut out = Report::default();
    let empty = Map::new();
    let items = lowered
        .get("items")
        .and_then(Value::as_object)
        .unwrap_or(&empty);
    for (id, item) in items {
        if item.get("kind").and_then(Value::as_str) != Some("mesh.asset@1") {
            continue;
        }
        let path = format!("items/{id}/params/sha256");
        let unread = |primitive: Option<usize>, why: &str| {
            let mut b = json!({"code": "mesh_unreadable", "kind": KIND, "ids": [id], "item": id, "why": why});
            if let Some(p) = primitive {
                b["primitive"] = json!(p);
            }
            b
        };
        let sha = item
            .pointer("/params/sha256")
            .and_then(Value::as_str)
            .unwrap_or_default();
        let Some(bytes) = input
            .pointer(&format!("/assets/{sha}"))
            .and_then(Value::as_str)
            .and_then(deep_canvas::base64::decode)
        else {
            out.blocked.push(unread(None, "missing"));
            continue;
        };
        let node = item.pointer("/params/node").cloned().unwrap_or(json!(0));
        let file = match gltf::primitives(&bytes, &node) {
            Ok(f) => f,
            Err(_) => {
                out.blocked.push(unread(None, "file"));
                continue;
            }
        };
        let mut read: Vec<(usize, Prim)> = Vec::new();
        let mut blocked = false;
        for (p, raw) in file.primitives.into_iter().enumerate() {
            match raw {
                Raw::Triangles {
                    positions,
                    normals,
                    indices,
                } => read.push((
                    p,
                    Prim {
                        positions,
                        normals,
                        indices,
                    },
                )),
                Raw::Unread(_) if plants("unreadable_skipped") => {}
                Raw::Unread(why) => {
                    out.blocked.push(unread(Some(p), why));
                    blocked = true;
                }
            }
        }
        if blocked {
            continue;
        }
        let Ok(sets) = gltf::uv_sets(&bytes, &node) else {
            out.blocked.push(unread(None, "file"));
            continue;
        };
        let prims: Vec<&Prim> = read.iter().map(|(_, p)| p).collect();
        let c = count::count(&prims, &opts);
        let tris: Vec<[count::V3; 3]> = prims
            .iter()
            .flat_map(|p| {
                p.indices
                    .as_chunks::<3>()
                    .0
                    .iter()
                    .map(|t| t.map(|i| p.positions[i as usize]))
            })
            .collect();
        let hidden: Vec<usize> = measures::hidden(&tris)
            .into_iter()
            .enumerate()
            .filter_map(|(f, h)| h.then_some(f))
            .collect();
        let readings: Vec<uv::Reading> = uv_faces(&read, &sets, &c)
            .iter()
            .map(|faces| uv::read(faces, &uv_opts))
            .collect();
        let faces = |fs: &[usize]| -> Vec<String> {
            fs.iter().take(IDS).map(|f| face_id(*f, &read)).collect()
        };
        let edges = |es: &[Edge]| -> Vec<String> {
            es.iter().take(IDS).map(|e| edge_id(e, &c, &read)).collect()
        };
        let vertices: Vec<String> = c
            .non_manifold_vertices
            .iter()
            .take(IDS)
            .map(|v| vertex_id(*v, &c, &read))
            .collect();
        let ratio = c.quad_ratio();
        let unpaired = faces(&c.unpaired);
        // A chart's ID is its first face's.
        let charts = |r: &uv::Reading, cs: &[usize]| -> Vec<String> {
            cs.iter()
                .take(IDS)
                .map(|ch| face_id(r.charts[*ch][0], &read))
                .collect()
        };
        let uv_json: Map<String, Value> = readings
            .iter()
            .enumerate()
            .map(|(k, r)| {
                let set = json!({
                    "uv_flipped": r.flipped.len(),
                    "uv_overlap": r.overlap,
                    "out_of_unit": r.out_of_unit,
                    "uv_fill": r.fill,
                    "min_gap_px": r.min_gap_px,
                    "texel_p5": r.texel_p5,
                    "texel_p95": r.texel_p95,
                    "ids": {
                        "uv_flipped": faces(&r.flipped),
                        "uv_overlap": charts(r, &r.overlapping),
                        "out_of_unit": charts(r, &r.outside),
                        "min_gap_px": charts(r, &r.close),
                        "texel": charts(r, &r.off_texel),
                    },
                });
                (format!("uv{k}"), set)
            })
            .collect();
        out.results.push(json!({
            "item": id,
            "welded_vertices": c.welded,
            "triangles": c.triangles,
            "non_manifold_edges": c.non_manifold_edges.len(),
            "non_manifold_vertices": c.non_manifold_vertices.len(),
            "inconsistent_edges": c.inconsistent_edges.len(),
            "flipped_faces": c.flipped_faces.len(),
            "degenerate_faces": c.degenerate_faces.len(),
            "boundary_edges": c.boundary_edges.len(),
            "ids": {
                "non_manifold_edges": edges(&c.non_manifold_edges),
                "non_manifold_vertices": vertices,
                "inconsistent_edges": edges(&c.inconsistent_edges),
                "flipped_faces": faces(&c.flipped_faces),
                "degenerate_faces": faces(&c.degenerate_faces),
                "boundary_edges": edges(&c.boundary_edges),
                "unpaired": unpaired,
                "hidden_faces": faces(&hidden),
                "unused_vertices": c.unused.iter().take(IDS).map(|i| position_id(*i, &read)).collect::<Vec<_>>(),
                "smallest_island": faces(&c.smallest_island),
            },
            "signed_volume": c.volume,
            "quad_ratio": ratio,
            "unpaired": c.unpaired.len(),
            "hidden_faces": hidden.len(),
            "unused_vertices": c.unused.len(),
            "islands": c.islands,
            "smallest_island_share": c.smallest_share,
            "uv": uv_json,
        }));
        // The fields decide what fails, never a severity: degenerate faces under `degenerate:
        // refuse`, flipped faces and inconsistent edges under either `normals`, and a closed
        // part's negative volume under `normals: outward`. Non-manifold and boundary edges are
        // counted; `manifold: for_boolean` holds them to a boolean job's input, not here.
        let mut raise = |code: &'static str, what: String, actual: Value| {
            let raised = Raised {
                code,
                severity: "error",
                path: path.clone(),
                what,
                fix_ops: None,
            };
            out.raised.push((id.clone(), raised, actual));
        };
        let n = c.degenerate_faces.len();
        if n > 0 {
            raise("loop.degenerate", format!("{n} degenerate faces"), json!(n));
        }
        let n = c.flipped_faces.len();
        if n > 0 {
            raise("loop.flipped", format!("{n} flipped faces"), json!(n));
        }
        let n = c.inconsistent_edges.len();
        if n > 0 {
            raise(
                "loop.inconsistent",
                format!("{n} inconsistent edges"),
                json!(n),
            );
        }
        if let Some(v) = c
            .volume
            .filter(|v| outward && *v < 0.0 && !plants("outward_skips_volume"))
        {
            raise(
                "loop.normals_inward",
                format!("a closed part's signed volume is {v} m³"),
                json!(v),
            );
        }
        if (file.deforms || plants("quad_fails_rigid")) && ratio < quad_min {
            raise(
                "loop.quad_ratio",
                format!("a mesh that deforms pairs into quads at {ratio:.4}, under {quad_min}"),
                json!({"quad_ratio": ratio, "unpaired": c.unpaired.len(), "ids": faces(&c.unpaired)}),
            );
        }
        // #1935: uv0 may tile, so it never fails on overlap or on area outside the unit square;
        // any other set fails on area outside it, and every set on a limit the input sets.
        for (k, r) in readings.iter().enumerate() {
            let mut fail = |reading: &str, value: Value, limit: Value, ids: Vec<String>| {
                raise(
                    "loop.uv",
                    format!("uv{k}'s {reading} is {value}, past {limit}"),
                    json!({"set": k, "reading": reading, "value": value, "limit": limit, "ids": ids}),
                );
            };
            if k > 0 && !r.outside.is_empty() {
                fail(
                    "out_of_unit",
                    json!(r.out_of_unit),
                    json!(0),
                    charts(r, &r.outside),
                );
            }
            if let Some(m) = overlap_max.filter(|m| k > 0 && r.overlap > *m) {
                fail(
                    "uv_overlap",
                    json!(r.overlap),
                    json!(m),
                    charts(r, &r.overlapping),
                );
            }
            if let Some(m) = fill_min.filter(|m| r.fill < *m) {
                fail("uv_fill", json!(r.fill), json!(m), Vec::new());
            }
            if !r.close.is_empty() && uv_opts.min_gap_px.is_some() {
                fail(
                    "min_gap_px",
                    json!(r.min_gap_px),
                    json!(uv_opts.min_gap_px),
                    charts(r, &r.close),
                );
            }
            if !r.off_texel.is_empty() {
                fail(
                    "texel",
                    json!([r.texel_p5, r.texel_p95]),
                    json!(uv_opts.texel),
                    charts(r, &r.off_texel),
                );
            }
        }
    }
    out
}

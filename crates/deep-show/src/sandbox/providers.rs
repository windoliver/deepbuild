//! Issue #192: the parts of a `gen@1` provider's run that are plain data (canvas primitives:
//! Provider `gen@1`): the bytes it reads at `params_at` and `assets_at`, a mesh's byte layout,
//! and the closed rule its mesh output meets.

use deep_canvas_loop::count::{count, Opts, Prim};
use serde_json::{Map, Value};

/// A mesh in the provider output's byte layout, as a `mesh_in` param reads it: little-endian
/// `u32 vertex_count, u32 index_count, f32 positions[3n], f32 normals[3n], f32 uv0[2n],
/// u32 indices`. Missing normals and uv0 are zeros.
pub fn mesh_bytes(
    positions: &[[f64; 3]],
    normals: &[[f64; 3]],
    uv0: &[[f64; 2]],
    indices: &[u32],
) -> Vec<u8> {
    let n = positions.len();
    let mut out = Vec::with_capacity(8 + 32 * n + 4 * indices.len());
    out.extend_from_slice(&(n as u32).to_le_bytes());
    out.extend_from_slice(&(indices.len() as u32).to_le_bytes());
    let mut f = |v: f64| out.extend_from_slice(&(v as f32).to_le_bytes());
    for p in positions {
        p.iter().for_each(|&v| f(v));
    }
    for i in 0..n {
        normals
            .get(i)
            .copied()
            .unwrap_or_default()
            .iter()
            .for_each(|&v| f(v));
    }
    for i in 0..n {
        uv0.get(i)
            .copied()
            .unwrap_or_default()
            .iter()
            .for_each(|&v| f(v));
    }
    for i in indices {
        out.extend_from_slice(&i.to_le_bytes());
    }
    out
}

fn triples(v: &Value) -> Vec<[f64; 3]> {
    v.as_array()
        .into_iter()
        .flatten()
        .map(|p| [0, 1, 2].map(|k| p[k].as_f64().unwrap_or(0.0)))
        .collect()
}

/// geometry.shading's counts on a provider's mesh (Check input: loop kinds: shading defects), at
/// the check input's defaults: `(defects, first open edge)`. The first open edge is the first
/// welded edge that doesn't join exactly two faces, as its two positions; the defects are each
/// count geometry.shading fails on.
pub fn shading(mesh: &Value) -> (Value, Option<Value>) {
    let positions = triples(&mesh["positions"]);
    let normals = triples(&mesh["normals"]);
    let indices: Vec<u32> = mesh["indices"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|i| i.as_u64().map(|i| i as u32))
        .collect();
    let prim = Prim {
        normals: (normals.len() == positions.len()).then_some(normals),
        positions: positions.clone(),
        indices,
    };
    let c = count(
        &[&prim],
        &Opts {
            weld: 0.00001,
            degenerate_area: 1e-12,
            normal_max: 30.0,
            corner_max: 30.0,
            planted: None,
        },
    );
    let defects = serde_json::json!({
        "non_manifold_edges": c.non_manifold_edges.len(),
        "non_manifold_vertices": c.non_manifold_vertices.len(),
        "inconsistent_edges": c.inconsistent_edges.len(),
        "flipped_faces": c.flipped_faces.len(),
        "degenerate_faces": c.degenerate_faces.len(),
        "boundary_edges": c.boundary_edges.len(),
    });
    let open = c
        .boundary_edges
        .iter()
        .chain(&c.non_manifold_edges)
        .min()
        .map(|e| serde_json::json!(e.map(|w| positions[c.first[w as usize]])));
    (defects, open)
}

/// The fields a provider's entry in its pack may hold (Provider `gen@1` and its links, meshes
/// and library form); any other, such as a check kind, a builder or an operator, refuses the pack.
pub const PROVIDER_KEYS: &[&str] = &[
    "program", "params", "seed", "assets", "out", "budget", "links", "mesh_in", "graph_in",
    "library",
];

/// The fixed seeds a pack check runs each provider at.
pub const SEEDS: [i64; 3] = [0, 1, 2];

/// A provider's pack-check runs: `(param, value, seed)`, its defaults at each fixed seed, then
/// each numeric param at its declared minimum and maximum, at the first.
pub fn pack_runs(spec: &Value) -> Vec<(Option<String>, Value, i64)> {
    let mut runs: Vec<(Option<String>, Value, i64)> =
        SEEDS.iter().map(|&s| (None, Value::Null, s)).collect();
    for (name, p) in spec["params"].as_object().into_iter().flatten() {
        if p["type"] == "bool" {
            continue;
        }
        for end in p["range"].as_array().into_iter().flatten().take(2) {
            if end.is_number() {
                runs.push((Some(name.clone()), end.clone(), SEEDS[0]));
            }
        }
    }
    runs
}

/// A provider's `out`: exactly one of a mesh of at most 262,144 vertices, rows of at most
/// 1,000,000, a data asset of at most 16 MiB in a named layout, or at most 4,096 pages. A refusal
/// names the field, `out/...`, and why.
pub fn out_ok(out: Option<&Value>) -> Result<(), (String, String)> {
    let Some(o) = out.and_then(Value::as_object).filter(|o| o.len() == 1) else {
        return Err((
            "out".into(),
            "a provider declares exactly one of mesh, rows, data or pages".into(),
        ));
    };
    let (kind, spec) = o.iter().next().expect("one key");
    let cap = |field: &str, most: u64| -> Result<(), (String, String)> {
        match spec[field].as_u64() {
            Some(n) if n <= most => Ok(()),
            _ => Err((
                format!("out/{kind}/{field}"),
                format!("{} is outside 0 to {most}", spec[field]),
            )),
        }
    };
    match kind.as_str() {
        "mesh" => cap("max_vertices", 262_144),
        "rows" => cap("max_rows", 1_000_000).and_then(|()| match spec["columns"].as_object() {
            Some(c)
                if !c.is_empty()
                    && c.values()
                        .all(|t| DTYPES.contains(&t.as_str().unwrap_or_default())) =>
            {
                Ok(())
            }
            _ => Err((
                "out/rows/columns".into(),
                format!("each column names one of {}", DTYPES.join(", ")),
            )),
        }),
        "data" => cap("max_bytes", 16 << 20).and_then(|()| match spec["layout"].as_str() {
            Some(_) => Ok(()),
            None => Err((
                "out/data/layout".into(),
                "a data output names its layout".into(),
            )),
        }),
        "pages" => cap("count", 4_096),
        _ => Err((
            format!("out/{kind}"),
            format!("`{kind}` is none of mesh, rows, data or pages"),
        )),
    }
}

/// The column types of a rows output, each 4 or 8 bytes wide.
pub const DTYPES: &[&str] = &["f32", "f64", "i32", "i64", "u32", "u64"];

/// The rows a provider wrote from `out_at`, little-endian: `u32 row_count`, then each column in
/// the order of its name sorted by byte, `row_count` values of its type. Past `max_rows`, or past
/// memory, is an error.
pub fn decode_rows(memory: &[u8], at: usize, spec: &Value) -> Result<Value, String> {
    let read = |i: usize, w: usize| {
        memory
            .get(i..i + w)
            .ok_or_else(|| format!("the rows run past memory at {i}"))
    };
    let n = u32::from_le_bytes(read(at, 4)?.try_into().expect("4 bytes")) as usize;
    let cap = spec["max_rows"].as_u64().unwrap_or(0) as usize;
    if n > cap {
        return Err(format!("the rows hold {n}, past their cap of {cap}"));
    }
    let mut p = at + 4;
    let mut columns = Map::new();
    for (name, ty) in spec["columns"].as_object().into_iter().flatten() {
        let ty = ty.as_str().unwrap_or_default();
        let w = if ty.ends_with("64") { 8 } else { 4 };
        let mut values = Vec::with_capacity(n);
        for _ in 0..n {
            let b = read(p, w)?;
            p += w;
            values.push(match (ty, w) {
                ("f32", _) => serde_json::json!(f32::from_le_bytes(b.try_into().expect("4"))),
                ("f64", _) => serde_json::json!(f64::from_le_bytes(b.try_into().expect("8"))),
                ("i32", _) => serde_json::json!(i32::from_le_bytes(b.try_into().expect("4"))),
                ("u32", _) => serde_json::json!(u32::from_le_bytes(b.try_into().expect("4"))),
                ("i64", _) => serde_json::json!(i64::from_le_bytes(b.try_into().expect("8"))),
                _ => serde_json::json!(u64::from_le_bytes(b.try_into().expect("8"))),
            });
        }
        columns.insert(name.clone(), Value::Array(values));
    }
    Ok(serde_json::json!({"count": n, "columns": columns}))
}

/// The params of the provider a document names at `path` (`items/<id>/params/<param>`) that it
/// binds rather than gives as constants: those a driver targets, at `<path>/params/<name>`, and
/// any whose value isn't a number or a bool, in name order.
pub fn bound(doc: &Value, path: &str, given: &Map<String, Value>) -> Vec<String> {
    let prefix = format!("{path}/params/");
    let mut out: Vec<String> = given
        .iter()
        .filter(|(_, v)| !(v.is_number() || v.is_boolean()))
        .map(|(k, _)| k.clone())
        .collect();
    let drivers = doc["drivers"]
        .as_object()
        .into_iter()
        .flatten()
        .map(|(_, d)| d);
    for d in drivers.chain(doc["drivers"].as_array().into_iter().flatten()) {
        let Some(name) = d["target"].as_str().and_then(|t| t.strip_prefix(&prefix)) else {
            continue;
        };
        let name = name.split('/').next().unwrap_or(name).to_string();
        if !out.contains(&name) {
            out.push(name);
        }
    }
    out.sort();
    out
}

/// The first geometry.shading count a mesh fails a pack check on: any but its open edges.
pub fn defect(shading: &Value) -> Option<&'static str> {
    [
        "non_manifold_edges",
        "non_manifold_vertices",
        "inconsistent_edges",
        "flipped_faces",
        "degenerate_faces",
    ]
    .into_iter()
    .find(|k| shading[*k].as_u64().is_some_and(|n| n > 0))
}

/// An item's provider uses, each with its place under `params`: a param naming `{gen, …}`, or
/// one entry of a param's list that does, such as a logic item's `assets`.
pub fn uses(item: &Value) -> Vec<(String, Value)> {
    let mut out = Vec::new();
    for (param, value) in item["params"].as_object().into_iter().flatten() {
        match value {
            Value::Array(list) => {
                for (i, v) in list
                    .iter()
                    .enumerate()
                    .filter(|(_, v)| v.get("gen").is_some())
                {
                    out.push((format!("{param}/{i}"), v.clone()));
                }
            }
            v if v.get("gen").is_some() => out.push((param.clone(), v.clone())),
            _ => {}
        }
    }
    out
}

/// The kinds whose mesh is built at check from their params alone: scene3d's builders.
fn builds(kind: &str) -> bool {
    deep_canvas_scene3d::builders::KINDS.contains(&kind)
}

/// The meshes a use's `mesh_in` takes (Provider `gen@1`: meshes): each named item's built mesh's
/// content key, from its kind, params and modifiers, never its place, so moving it keeps the key.
/// An item that isn't a builder, such as an instancer, a logic item or anything a driver or a
/// channel moves, is refused, naming it and why.
pub fn mesh_in(doc: &Value, use_: &Value) -> Result<Vec<String>, (String, String)> {
    let mut keys = Vec::new();
    for m in use_["mesh_in"].as_array().into_iter().flatten() {
        let target = m["item"].as_str().unwrap_or_default().to_string();
        let item = &doc["items"][&target];
        let kind = item["kind"].as_str().unwrap_or_default();
        if item.is_null() {
            return Err((target, "no such item".into()));
        }
        if !builds(kind) {
            let why = if kind.starts_with("instance") {
                "an instancer's meshes follow its columns, which logic or time may feed"
            } else {
                "it builds no mesh at check from its params alone"
            };
            return Err((target, format!("a {kind} item: {why}")));
        }
        let driven = |list: &Value| {
            let all = list.as_object().map(|o| o.values().collect::<Vec<_>>());
            all.unwrap_or_default().into_iter().any(|d| {
                d["target"]
                    .as_str()
                    .is_some_and(|t| t.starts_with(&format!("items/{target}/params")))
            })
        };
        if driven(&doc["drivers"]) || driven(&doc["channels"]) {
            return Err((
                target,
                "its params are bound to time, a control or logic".into(),
            ));
        }
        let terms = serde_json::json!({"kind": kind, "params": item["params"], "modifiers": item["modifiers"]});
        keys.push(deep_canvas_sandbox::rewrite::hash(
            terms.to_string().as_bytes(),
        ));
    }
    Ok(keys)
}

/// The built meshes a use's `mesh_in` takes, in the output's byte layout, each before its item's
/// own transform.
pub fn meshes(doc: &Value, use_: &Value) -> Result<Vec<Vec<u8>>, String> {
    let run = deep_canvas_scene3d::stack::Run::default();
    let mut out = Vec::new();
    for m in use_["mesh_in"].as_array().into_iter().flatten() {
        let id = m["item"].as_str().unwrap_or_default();
        let built = deep_canvas_scene3d::build::built(doc, id, &doc["items"][id], &run, 0.0)?;
        let mesh = built.mesh.ok_or_else(|| format!("`{id}` built no mesh"))?;
        out.push(mesh_bytes(
            &mesh.positions,
            &mesh.normals,
            &[],
            &mesh.indices,
        ));
    }
    Ok(out)
}

fn leb(mut v: u64, out: &mut Vec<u8>) {
    loop {
        let b = (v & 0x7f) as u8;
        v >>= 7;
        out.push(if v == 0 { b } else { b | 0x80 });
        if v == 0 {
            return;
        }
    }
}

fn sleb(mut v: i64, out: &mut Vec<u8>) {
    loop {
        let b = (v & 0x7f) as u8;
        v >>= 7;
        let done = (v == 0 && b & 0x40 == 0) || (v == -1 && b & 0x40 != 0);
        out.push(if done { b } else { b | 0x80 });
        if done {
            return;
        }
    }
}

fn section(id: u8, payload: &[u8], out: &mut Vec<u8>) {
    out.push(id);
    leb(payload.len() as u64, out);
    out.extend_from_slice(payload);
}

fn text(s: &str, out: &mut Vec<u8>) {
    leb(s.len() as u64, out);
    out.extend_from_slice(s.as_bytes());
}

/// Where the library form's driver lays the params out, and where the output goes after them.
pub const DRIVER_PARAMS_AT: i64 = 1 << 20;
pub const DRIVER_OUT_AT: i64 = DRIVER_PARAMS_AT + 65_536;

/// A program object (#190's conventions: a `linking` section, `reloc.CODE`) that runs a
/// provider's library form `name` as a provider (Provider `gen@1`: the library form): it imports
/// `lib:<name>.gen` and the linear memory, holding `out_max` bytes of output past its params, and
/// exports `gen(seed)`, which calls the library's `gen(seed, params_at, out_at)` until it returns
/// 0 (Logic: work across steps), with the immutable globals `params_at`, `assets_at` and `out_at`.
pub fn driver(name: &str, out_max: u64) -> Vec<u8> {
    let mut m = b"\0asm\x01\0\0\0".to_vec();
    // Types: gen(seed) -> i32, and the library's gen(seed, params_at, out_at) -> i32.
    section(
        1,
        &[
            2, 0x60, 1, 0x7e, 1, 0x7f, 0x60, 3, 0x7e, 0x7f, 0x7f, 1, 0x7f,
        ],
        &mut m,
    );
    let pages = (DRIVER_OUT_AT as u64 + out_max + 8).div_ceil(65_536);
    let mut imports = vec![2];
    text(&format!("lib:{name}"), &mut imports);
    text("gen", &mut imports);
    imports.extend([0x00, 1]);
    text("env", &mut imports);
    text("__linear_memory", &mut imports);
    imports.extend([0x02, 0x01]);
    leb(pages, &mut imports);
    leb(pages, &mut imports);
    section(2, &imports, &mut m);
    section(3, &[1, 0], &mut m);
    let mut globals = vec![3];
    for at in [DRIVER_PARAMS_AT, DRIVER_PARAMS_AT, DRIVER_OUT_AT] {
        globals.extend([0x7f, 0x00, 0x41]);
        sleb(at, &mut globals);
        globals.push(0x0b);
    }
    section(6, &globals, &mut m);
    let mut exports = vec![4];
    for (e, kind, index) in [
        ("gen", 0, 1),
        ("params_at", 3, 0),
        ("assets_at", 3, 1),
        ("out_at", 3, 2),
    ] {
        text(e, &mut exports);
        exports.extend([kind, index]);
    }
    section(7, &exports, &mut m);
    // loop { gen(seed, params_at, out_at); br_if 0 } i32.const 0
    let mut body = vec![0, 0x03, 0x40, 0x20, 0x00, 0x41];
    sleb(DRIVER_PARAMS_AT, &mut body);
    body.push(0x41);
    sleb(DRIVER_OUT_AT, &mut body);
    body.push(0x10);
    let call = body.len();
    body.extend([
        0x80, 0x80, 0x80, 0x80, 0x00, 0x0d, 0x00, 0x0b, 0x41, 0x00, 0x0b,
    ]);
    let mut code = vec![1];
    leb(body.len() as u64, &mut code);
    let call = code.len() + call;
    code.extend(body);
    section(10, &code, &mut m);
    // Its symbols: the imported library function, then its own gen.
    let mut symbols = vec![2, 0x00, 0x10, 0, 0x00, 0x00, 1];
    text("gen", &mut symbols);
    let mut linking = Vec::new();
    text("linking", &mut linking);
    linking.extend([2, 8]);
    leb(symbols.len() as u64, &mut linking);
    linking.extend(symbols);
    section(0, &linking, &mut m);
    let mut reloc = Vec::new();
    text("reloc.CODE", &mut reloc);
    reloc.extend([5, 1, 0]);
    leb(call as u64, &mut reloc);
    reloc.push(0);
    section(0, &reloc, &mut m);
    m
}

/// The first byte where `b` differs from `a`, or the shorter's length when one is the other's start.
pub fn first_diff(a: &[u8], b: &[u8]) -> Option<usize> {
    a.iter()
        .zip(b)
        .position(|(x, y)| x != y)
        .or_else(|| (a.len() != b.len()).then(|| a.len().min(b.len())))
}

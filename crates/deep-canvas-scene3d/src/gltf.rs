//! `mesh.asset@1`'s reader (canvas primitives: Builder: `mesh.asset {sha256 (glTF), node}`;
//! issue #420): a glTF 2.0 file, binary (GLB) or JSON with its buffers inline as data URIs,
//! read to one node's mesh in the node's own space: every triangle primitive's positions,
//! normals (made from its faces where it has none) and indices. Only what a mesh needs is read.

use serde_json::{json, Value};

use crate::geom::{add, cross, sub, unit, Mesh, V2, V3};

/// The largest asset read, bytes.
pub const MAX_BYTES: usize = 64 << 20;

/// Why an asset can't be read, as the path of the field at fault under the item.
pub type Fault = String;

fn bad(what: &str) -> Fault {
    format!("params/sha256: {what}")
}

fn u32_at(b: &[u8], at: usize) -> Option<u32> {
    Some(u32::from_le_bytes(b.get(at..at + 4)?.try_into().ok()?))
}

/// The document's JSON and its binary chunk (empty for a JSON file).
fn split(bytes: &[u8]) -> Result<(Value, Vec<u8>), Fault> {
    if bytes.len() > MAX_BYTES {
        return Err(bad("larger than 64 MB"));
    }
    if bytes.get(..4) != Some(b"glTF") {
        let json = serde_json::from_slice(bytes).map_err(|_| bad("neither GLB nor glTF JSON"))?;
        return Ok((json, Vec::new()));
    }
    if u32_at(bytes, 4) != Some(2) {
        return Err(bad("not glTF 2.0"));
    }
    let mut at = 12;
    let (mut json, mut bin) = (None, Vec::new());
    while at + 8 <= bytes.len() {
        let len = u32_at(bytes, at).ok_or_else(|| bad("a cut chunk"))? as usize;
        let kind = u32_at(bytes, at + 4).ok_or_else(|| bad("a cut chunk"))?;
        let body = bytes
            .get(at + 8..at + 8 + len)
            .ok_or_else(|| bad("a cut chunk"))?;
        match kind {
            0x4E4F_534A => {
                json = Some(serde_json::from_slice(body).map_err(|_| bad("its JSON chunk"))?)
            }
            0x004E_4942 => bin = body.to_vec(),
            _ => {}
        }
        at += 8 + len;
    }
    Ok((json.ok_or_else(|| bad("no JSON chunk"))?, bin))
}

/// Buffer `i`'s bytes: the GLB's binary chunk, a base64 data URI, or an external file the host
/// resolved by hash (`ext`, by buffer index; #423).
fn buffer(doc: &Value, bin: &[u8], ext: &[Option<Vec<u8>>], i: usize) -> Result<Vec<u8>, Fault> {
    let b = doc
        .pointer(&format!("/buffers/{i}"))
        .ok_or_else(|| bad("a missing buffer"))?;
    if let Some(Some(bytes)) = ext.get(i) {
        return Ok(bytes.clone());
    }
    match b.get("uri").and_then(Value::as_str) {
        None => Ok(bin.to_vec()),
        Some(uri) => {
            let data = uri
                .split_once(";base64,")
                .map(|(_, d)| d)
                .ok_or_else(|| bad("an external buffer"))?;
            deep_canvas::base64::decode(data).ok_or_else(|| bad("a buffer's base64"))
        }
    }
}

/// Accessor `i` read as rows of `width` numbers.
fn accessor(doc: &Value, bin: &[u8], i: usize, width: usize) -> Result<Vec<Vec<f64>>, Fault> {
    accessor_in(doc, bin, &[], i, width)
}

fn accessor_in(
    doc: &Value,
    bin: &[u8],
    ext: &[Option<Vec<u8>>],
    i: usize,
    width: usize,
) -> Result<Vec<Vec<f64>>, Fault> {
    let a = doc
        .pointer(&format!("/accessors/{i}"))
        .ok_or_else(|| bad("a missing accessor"))?;
    let count = a
        .get("count")
        .and_then(Value::as_u64)
        .ok_or_else(|| bad("an accessor's count"))? as usize;
    let component = a
        .get("componentType")
        .and_then(Value::as_u64)
        .ok_or_else(|| bad("a component type"))?;
    let size = match component {
        5120 | 5121 => 1,
        5122 | 5123 => 2,
        5125 | 5126 => 4,
        _ => return Err(bad("a component type")),
    };
    // A normalized integer reads as a fraction of its type's largest value (glTF 3.11).
    let normalized = a.get("normalized").and_then(Value::as_bool) == Some(true);
    let view_i = a
        .get("bufferView")
        .and_then(Value::as_u64)
        .ok_or_else(|| bad("a sparse accessor"))? as usize;
    let view = doc
        .pointer(&format!("/bufferViews/{view_i}"))
        .ok_or_else(|| bad("a missing buffer view"))?;
    let data = buffer(
        doc,
        bin,
        ext,
        view.get("buffer").and_then(Value::as_u64).unwrap_or(0) as usize,
    )?;
    accessor_rows(a, view, &data, count, width, component, size, normalized)
}

#[allow(clippy::too_many_arguments)]
fn accessor_rows(
    a: &Value,
    view: &Value,
    data: &[u8],
    count: usize,
    width: usize,
    component: u64,
    size: usize,
    normalized: bool,
) -> Result<Vec<Vec<f64>>, Fault> {
    let base = view.get("byteOffset").and_then(Value::as_u64).unwrap_or(0) as usize
        + a.get("byteOffset").and_then(Value::as_u64).unwrap_or(0) as usize;
    let stride = view
        .get("byteStride")
        .and_then(Value::as_u64)
        .map_or(size * width, |s| s as usize);
    (0..count)
        .map(|r| {
            (0..width)
                .map(|c| {
                    let at = base + r * stride + c * size;
                    let b = data
                        .get(at..at + size)
                        .ok_or_else(|| bad("an accessor past its buffer"))?;
                    let v = match component {
                        5120 => f64::from(b[0] as i8),
                        5121 => f64::from(b[0]),
                        5122 => f64::from(i16::from_le_bytes([b[0], b[1]])),
                        5123 => f64::from(u16::from_le_bytes([b[0], b[1]])),
                        5125 => f64::from(u32::from_le_bytes([b[0], b[1], b[2], b[3]])),
                        _ => f64::from(f32::from_le_bytes([b[0], b[1], b[2], b[3]])),
                    };
                    Ok(match (normalized, component) {
                        (true, 5120) => (v / 127.0).max(-1.0),
                        (true, 5121) => v / 255.0,
                        (true, 5122) => (v / 32767.0).max(-1.0),
                        (true, 5123) => v / 65535.0,
                        _ => v,
                    })
                })
                .collect()
        })
        .collect()
}

/// The node's index: `node` as a number, or the node of that name.
fn node_of(doc: &Value, node: &Value) -> Result<usize, Fault> {
    let nodes = doc
        .get("nodes")
        .and_then(Value::as_array)
        .ok_or_else(|| "params/node".to_string())?;
    let i = match node {
        Value::Number(n) => n.as_u64().map(|n| n as usize),
        Value::String(name) => nodes
            .iter()
            .position(|n| n.get("name").and_then(Value::as_str) == Some(name)),
        _ => None,
    };
    i.filter(|i| *i < nodes.len())
        .ok_or_else(|| "params/node".to_string())
}

/// The node's mesh, every triangle primitive in turn.
pub fn mesh(bytes: &[u8], node: &Value) -> Result<Mesh, Fault> {
    let (doc, bin) = split(bytes)?;
    let n = node_of(&doc, node)?;
    let mesh_i = doc
        .pointer(&format!("/nodes/{n}/mesh"))
        .and_then(Value::as_u64)
        .ok_or_else(|| "params/node".to_string())?;
    let prims = doc
        .pointer(&format!("/meshes/{mesh_i}/primitives"))
        .and_then(Value::as_array)
        .ok_or_else(|| bad("a mesh without primitives"))?;
    let mut m = Mesh::default();
    let (mut uv, mut tangents): (Vec<V2>, Vec<[f64; 4]>) = (Vec::new(), Vec::new());
    let mut first_seen = false;
    for (face, prim) in prims.iter().enumerate() {
        if prim.get("mode").and_then(Value::as_u64).unwrap_or(4) != 4 {
            continue;
        }
        let pos_i = prim
            .pointer("/attributes/POSITION")
            .and_then(Value::as_u64)
            .ok_or_else(|| bad("a primitive without positions"))?;
        let positions: Vec<V3> = accessor(&doc, &bin, pos_i as usize, 3)?
            .into_iter()
            .map(|r| [r[0], r[1], r[2]])
            .collect();
        let indices: Vec<u32> = match prim.get("indices").and_then(Value::as_u64) {
            Some(i) => accessor(&doc, &bin, i as usize, 1)?
                .into_iter()
                .map(|r| r[0] as u32)
                .collect(),
            None => (0..positions.len() as u32).collect(),
        };
        if indices.iter().any(|i| *i as usize >= positions.len()) {
            return Err(bad("an index past its positions"));
        }
        let normals: Vec<V3> = match prim.pointer("/attributes/NORMAL").and_then(Value::as_u64) {
            Some(i) => accessor(&doc, &bin, i as usize, 3)?
                .into_iter()
                .map(|r| unit([r[0], r[1], r[2]]))
                .collect(),
            None => {
                let mut acc = vec![[0.0; 3]; positions.len()];
                for t in indices.as_chunks::<3>().0 {
                    let [a, b, c] = [t[0], t[1], t[2]].map(|i| i as usize);
                    let nrm = cross(
                        sub(positions[b], positions[a]),
                        sub(positions[c], positions[a]),
                    );
                    for v in [a, b, c] {
                        acc[v] = add(acc[v], nrm);
                    }
                }
                acc.into_iter().map(unit).collect()
            }
        };
        if normals.len() != positions.len() {
            return Err(bad("normals that don't match its positions"));
        }
        let base = m.positions.len() as u32;
        let from = m.triangles();
        // The simplify job's index-only levels over these vertices (#425), coarser after.
        if let Some(lod) = prim.pointer("/extras/lod") {
            m.lod_extent = lod["extent"].as_f64().unwrap_or(0.0);
            for (k, level) in lod["levels"].as_array().into_iter().flatten().enumerate() {
                let (Some(acc), Some(error)) = (level["indices"].as_u64(), level["error"].as_f64())
                else {
                    return Err(bad("a level without indices or error"));
                };
                let idx: Vec<u32> = accessor(&doc, &bin, acc as usize, 1)?
                    .into_iter()
                    .map(|r| base + r[0] as u32)
                    .collect();
                if idx.len() % 3 != 0 || idx.iter().any(|i| (*i - base) as usize >= positions.len())
                {
                    return Err(bad("a level's index past its positions"));
                }
                match m.lods.get_mut(k) {
                    Some(l) => l.0.extend(idx),
                    None => m.lods.push((idx, error)),
                }
            }
        }
        for (p, n) in positions.iter().zip(&normals) {
            m.vertex(*p, *n);
        }
        for t in indices.as_chunks::<3>().0 {
            m.tri(base + t[0], base + t[1], base + t[2], face as u32);
        }
        m.part(&format!("primitive.{face}"), from);
        // #427: uv0 from TEXCOORD_0 and the file's own tangents, kept only while every
        // primitive so far has them, one per vertex.
        let attr = |k: &str| {
            prim.pointer(&format!("/attributes/{k}"))
                .and_then(Value::as_u64)
        };
        let rows = |k: &str, n: usize| -> Result<Option<Vec<Vec<f64>>>, Fault> {
            match attr(k) {
                Some(i) => {
                    let r = accessor(&doc, &bin, i as usize, n)?;
                    if r.len() != positions.len() {
                        return Err(bad(&format!("{k} that doesn't match its positions")));
                    }
                    Ok(Some(r))
                }
                None => Ok(None),
            }
        };
        match rows("TEXCOORD_0", 2)? {
            Some(r) if !first_seen || !uv.is_empty() => {
                uv.extend(r.into_iter().map(|r| [r[0], r[1]]))
            }
            _ => uv.clear(),
        }
        match rows("TANGENT", 4)? {
            Some(r) if !first_seen || !tangents.is_empty() => {
                tangents.extend(r.into_iter().map(|r| [r[0], r[1], r[2], r[3]]))
            }
            _ => tangents.clear(),
        }
        first_seen = true;
    }
    if first_seen {
        if uv.len() == m.positions.len() {
            m.uv0 = uv;
        }
        if tangents.len() == m.positions.len() {
            m.tangents = tangents;
        }
    }
    Ok(m)
}

// ---- #453: each primitive as geometry.shading reads it (Check input: loop kinds: shading defects)

/// One primitive of a node's mesh, as the file holds it, or why the check can't read it: `draco`
/// or `meshopt` for compressed data no pinned tool decoded, `mode` for one not of triangles, and
/// `pose` for a skinned or morphed mesh the file holds away from its bind pose.
pub enum Raw {
    Triangles {
        positions: Vec<V3>,
        normals: Option<Vec<V3>>,
        indices: Vec<u32>,
    },
    Unread(&'static str),
}

/// A node's mesh as geometry.shading reads it: each primitive in file order, and whether it
/// deforms (its node has a skin, or a primitive has morph targets).
pub struct Primitives {
    pub primitives: Vec<Raw>,
    pub deforms: bool,
}

/// Node `n`'s world matrix in the file: its parents' matrices times its own.
fn world(doc: &Value, n: usize) -> [[f64; 4]; 3] {
    let nodes = doc.get("nodes").and_then(Value::as_array);
    let parent = |c: usize| {
        nodes?.iter().position(|p| {
            p.get("children")
                .and_then(Value::as_array)
                .is_some_and(|ch| ch.iter().any(|x| x.as_u64() == Some(c as u64)))
        })
    };
    let mut m = local(&doc["nodes"][n]);
    let (mut at, mut steps) = (n, 0);
    while let Some(p) = parent(at).filter(|_| steps < 1024) {
        m = mul(&local(&doc["nodes"][p]), &m);
        (at, steps) = (p, steps + 1);
    }
    m
}

/// Whether node `n`'s skin holds every joint at its bind pose: the joint's world matrix times its
/// inverse bind matrix is the identity within 1e-6 per entry.
fn at_bind_pose(doc: &Value, bin: &[u8], skin: &Value) -> Result<bool, Fault> {
    let joints: Vec<usize> = skin
        .get("joints")
        .and_then(Value::as_array)
        .map(|j| {
            j.iter()
                .filter_map(Value::as_u64)
                .map(|j| j as usize)
                .collect()
        })
        .unwrap_or_default();
    let inverse = match skin.get("inverseBindMatrices").and_then(Value::as_u64) {
        Some(i) => accessor(doc, bin, i as usize, 16)?,
        None => Vec::new(),
    };
    for (k, j) in joints.iter().enumerate() {
        let w = world(doc, *j);
        let ibm = inverse.get(k).map_or_else(
            || {
                [
                    [1.0, 0.0, 0.0, 0.0],
                    [0.0, 1.0, 0.0, 0.0],
                    [0.0, 0.0, 1.0, 0.0],
                ]
            },
            |c| [0, 1, 2].map(|r| [c[r], c[4 + r], c[8 + r], c[12 + r]]),
        );
        let m = mul(&w, &ibm);
        let off =
            (0..3).any(|r| (0..4).any(|c| (m[r][c] - if r == c { 1.0 } else { 0.0 }).abs() > 1e-6));
        if off {
            return Ok(false);
        }
    }
    Ok(true)
}

/// Node `node`'s mesh, each primitive as the file holds it (positions, the file's own normals and
/// indices, never welded or made), or why it can't be read.
pub fn primitives(bytes: &[u8], node: &Value) -> Result<Primitives, Fault> {
    let (doc, bin) = split(bytes)?;
    let n = node_of(&doc, node)?;
    let mesh_i = doc
        .pointer(&format!("/nodes/{n}/mesh"))
        .and_then(Value::as_u64)
        .ok_or_else(|| "params/node".to_string())?;
    let mesh = &doc["meshes"][mesh_i as usize];
    let prims = mesh
        .get("primitives")
        .and_then(Value::as_array)
        .ok_or_else(|| bad("a mesh without primitives"))?;
    let morphed = prims.iter().any(|p| p.get("targets").is_some());
    let skin = doc
        .pointer(&format!("/nodes/{n}/skin"))
        .and_then(Value::as_u64)
        .map(|s| &doc["skins"][s as usize]);
    // A morphed mesh is at its bind pose when every weight its node or mesh gives is 0.
    let weighted = [
        doc.pointer(&format!("/nodes/{n}/weights")),
        mesh.get("weights"),
    ]
    .into_iter()
    .flatten()
    .filter_map(Value::as_array)
    .any(|w| w.iter().any(|x| x.as_f64().is_some_and(|x| x != 0.0)));
    let posed = match skin {
        Some(s) => !at_bind_pose(&doc, &bin, s)?,
        None => false,
    } || (morphed && weighted);
    let meshopt = |accessor: Option<u64>| {
        accessor
            .and_then(|a| doc.pointer(&format!("/accessors/{a}/bufferView")))
            .and_then(Value::as_u64)
            .and_then(|v| {
                doc.pointer(&format!(
                    "/bufferViews/{v}/extensions/EXT_meshopt_compression"
                ))
            })
            .is_some()
    };
    let mut out = Vec::new();
    for prim in prims {
        let pos_i = prim.pointer("/attributes/POSITION").and_then(Value::as_u64);
        let nrm_i = prim.pointer("/attributes/NORMAL").and_then(Value::as_u64);
        let idx_i = prim.get("indices").and_then(Value::as_u64);
        let why = if prim
            .pointer("/extensions/KHR_draco_mesh_compression")
            .is_some()
        {
            Some("draco")
        } else if [pos_i, nrm_i, idx_i].into_iter().any(meshopt) {
            Some("meshopt")
        } else if prim.get("mode").and_then(Value::as_u64).unwrap_or(4) != 4 {
            Some("mode")
        } else if posed {
            Some("pose")
        } else {
            None
        };
        if let Some(why) = why {
            out.push(Raw::Unread(why));
            continue;
        }
        let pos_i = pos_i.ok_or_else(|| bad("a primitive without positions"))? as usize;
        let positions: Vec<V3> = accessor(&doc, &bin, pos_i, 3)?
            .into_iter()
            .map(|r| [r[0], r[1], r[2]])
            .collect();
        let indices: Vec<u32> = match idx_i {
            Some(i) => accessor(&doc, &bin, i as usize, 1)?
                .into_iter()
                .map(|r| r[0] as u32)
                .collect(),
            None => (0..positions.len() as u32).collect(),
        };
        if indices.iter().any(|i| *i as usize >= positions.len()) {
            return Err(bad("an index past its positions"));
        }
        let normals = match nrm_i {
            Some(i) => {
                let n: Vec<V3> = accessor(&doc, &bin, i as usize, 3)?
                    .into_iter()
                    .map(|r| [r[0], r[1], r[2]])
                    .collect();
                if n.len() != positions.len() {
                    return Err(bad("normals that don't match its positions"));
                }
                Some(n)
            }
            None => None,
        };
        out.push(Raw::Triangles {
            positions,
            normals,
            indices,
        });
    }
    Ok(Primitives {
        primitives: out,
        deforms: skin.is_some() || morphed,
    })
}

// ---- #423: a file's whole scene, with its materials and textures (Material: texture maps)

/// A file's scene as the import reads it: each node with a mesh, its world matrix in the file and
/// its triangle primitives; the `material@1` params each glTF material became; each image's bytes
/// by its SHA-256; and what the maps can't hold, per material.
pub struct Imported {
    pub nodes: Vec<Node>,
    /// The scene's KHR_lights_punctual lights: each one's node's world matrix and its light.
    pub lights: Vec<([[f64; 4]; 3], Value)>,
    pub materials: Vec<ImportedMaterial>,
    pub images: Vec<(String, Vec<u8>)>,
    pub dropped: Vec<(usize, String)>,
}

pub struct Node {
    /// Its index in the file, and its name (or its index where it has none): what its pick ID
    /// ends in.
    pub index: usize,
    pub name: String,
    pub world: [[f64; 4]; 3],
    pub primitives: Vec<Primitive>,
}

pub struct Primitive {
    pub mesh: Mesh,
    pub material: Option<usize>,
}

pub struct ImportedMaterial {
    pub name: Value,
    pub params: Value,
}

/// A node's local matrix: its `matrix` (column-major), or T × R × S.
fn local(n: &Value) -> [[f64; 4]; 3] {
    let f = |k: &str, d: &[f64]| -> Vec<f64> {
        n.get(k)
            .and_then(Value::as_array)
            .map(|a| a.iter().filter_map(Value::as_f64).collect())
            .filter(|v: &Vec<f64>| v.len() == d.len())
            .unwrap_or_else(|| d.to_vec())
    };
    if let Some(c) = n
        .get("matrix")
        .and_then(Value::as_array)
        .map(|a| a.iter().filter_map(Value::as_f64).collect::<Vec<_>>())
        .filter(|c| c.len() == 16)
    {
        return [
            [c[0], c[4], c[8], c[12]],
            [c[1], c[5], c[9], c[13]],
            [c[2], c[6], c[10], c[14]],
        ];
    }
    let t = f("translation", &[0.0; 3]);
    let q = f("rotation", &[0.0, 0.0, 0.0, 1.0]);
    let sc = f("scale", &[1.0; 3]);
    let (x, y, z, w) = (q[0], q[1], q[2], q[3]);
    let r = [
        [
            1.0 - 2.0 * (y * y + z * z),
            2.0 * (x * y - z * w),
            2.0 * (x * z + y * w),
        ],
        [
            2.0 * (x * y + z * w),
            1.0 - 2.0 * (x * x + z * z),
            2.0 * (y * z - x * w),
        ],
        [
            2.0 * (x * z - y * w),
            2.0 * (y * z + x * w),
            1.0 - 2.0 * (x * x + y * y),
        ],
    ];
    [0, 1, 2].map(|i| [r[i][0] * sc[0], r[i][1] * sc[1], r[i][2] * sc[2], t[i]])
}

fn mul(a: &[[f64; 4]; 3], b: &[[f64; 4]; 3]) -> [[f64; 4]; 3] {
    [0, 1, 2].map(|i| {
        [0, 1, 2, 3].map(|j| {
            a[i][0] * b[0][j]
                + a[i][1] * b[1][j]
                + a[i][2] * b[2][j]
                + if j == 3 { a[i][3] } else { 0.0 }
        })
    })
}

const WRAPS: [(u64, &str); 3] = [(10497, "repeat"), (33071, "clamp"), (33648, "mirror")];

fn wrap_name(v: Option<&Value>) -> &'static str {
    let code = v.and_then(Value::as_u64).unwrap_or(10497);
    WRAPS
        .iter()
        .find(|(c, _)| *c == code)
        .map_or("repeat", |(_, n)| n)
}

/// The material extensions whose fields the import maps (beside the texture transform, read on
/// each texture).
const READ: [&str; 2] = ["KHR_materials_emissive_strength", "KHR_materials_unlit"];

/// #428's planted `drops_dispersion`: the import leaves KHR_materials_dispersion in `dropped`
/// and draws dispersion 0. Set only by `deep-gpu --planted`.
pub static DROPS_DISPERSION: std::sync::atomic::AtomicBool =
    std::sync::atomic::AtomicBool::new(false);

/// The lobe extensions whose factors the import maps to their fields (#428); a texture inside
/// one is still listed in `dropped`.
const LOBES: [&str; 10] = [
    "KHR_materials_sheen",
    "KHR_materials_anisotropy",
    "KHR_materials_diffuse_transmission",
    "KHR_materials_transmission",
    "KHR_materials_ior",
    "KHR_materials_volume",
    "KHR_materials_dispersion",
    "KHR_materials_iridescence",
    "KHR_materials_specular",
    "KHR_materials_diffuse_roughness",
];

/// A material's lobe extensions as `material@1` fields (#428; Material): `m` the glTF material.
fn lobe_params(m: &Value, p: &mut Value) {
    let x = |e: &str, k: &str| m.pointer(&format!("/extensions/{e}/{k}"));
    let f = |e: &str, k: &str, d: f64| x(e, k).and_then(Value::as_f64).unwrap_or(d);
    let c = |e: &str, k: &str, d: [f64; 3]| x(e, k).cloned().unwrap_or_else(|| json!(d));
    let has = |e: &str| m.pointer(&format!("/extensions/{e}")).is_some();
    if has("KHR_materials_sheen") {
        let color = c("KHR_materials_sheen", "sheenColorFactor", [0.0; 3]);
        p["sheen"] = json!({"weight": 1.0, "color": color,
            "roughness": f("KHR_materials_sheen", "sheenRoughnessFactor", 0.0)});
    }
    if has("KHR_materials_anisotropy") {
        p["anisotropy"] = json!({
            "strength": f("KHR_materials_anisotropy", "anisotropyStrength", 0.0),
            "rotation": f("KHR_materials_anisotropy", "anisotropyRotation", 0.0).to_degrees(),
        });
    }
    if has("KHR_materials_diffuse_transmission") {
        let e = "KHR_materials_diffuse_transmission";
        p["translucency"] = json!({"kind": "thin", "amount": f(e, "diffuseTransmissionFactor", 0.0),
            "color": c(e, "diffuseTransmissionColorFactor", [1.0; 3])});
    }
    if has("KHR_materials_transmission") {
        p["transmission"] = json!(f("KHR_materials_transmission", "transmissionFactor", 0.0));
    }
    if has("KHR_materials_ior") {
        p["ior"] = json!(f("KHR_materials_ior", "ior", 1.5));
    }
    if has("KHR_materials_volume") {
        let e = "KHR_materials_volume";
        let mut att = json!({"color": c(e, "attenuationColor", [1.0; 3])});
        if let Some(d) = x(e, "attenuationDistance").and_then(Value::as_f64) {
            att["distance"] = json!(d);
        }
        p["absorption"] = json!({"thickness": f(e, "thicknessFactor", 0.0), "attenuation": att});
    }
    if has("KHR_materials_dispersion")
        && !DROPS_DISPERSION.load(std::sync::atomic::Ordering::Relaxed)
    {
        p["dispersion"] = json!(f("KHR_materials_dispersion", "dispersion", 0.0));
    }
    if has("KHR_materials_iridescence") {
        let e = "KHR_materials_iridescence";
        p["iridescence"] = json!({"weight": f(e, "iridescenceFactor", 0.0),
            "ior": f(e, "iridescenceIor", 1.3), "thickness": f(e, "iridescenceThicknessMaximum", 400.0)});
    }
    if has("KHR_materials_specular") {
        let e = "KHR_materials_specular";
        // glTF's specular strength 1 is our level 0.5 (Material).
        p["specular_level"] = json!(0.5 * f(e, "specularFactor", 1.0));
        p["specular_color"] = c(e, "specularColorFactor", [1.0; 3]);
    }
    if has("KHR_materials_diffuse_roughness") {
        p["diffuse_roughness"] = json!(f(
            "KHR_materials_diffuse_roughness",
            "diffuseRoughnessFactor",
            0.0
        ));
    }
}

/// Whether node `node` (its index or name) has a primitive that names a material.
pub fn node_materials(bytes: &[u8], node: &Value) -> bool {
    let Ok((doc, _)) = split(bytes) else {
        return false;
    };
    let Ok(n) = node_of(&doc, node) else {
        return false;
    };
    doc.pointer(&format!("/nodes/{n}/mesh"))
        .and_then(Value::as_u64)
        .and_then(|m| doc.pointer(&format!("/meshes/{m}/primitives")))
        .and_then(Value::as_array)
        .is_some_and(|ps| ps.iter().any(|p| p.get("material").is_some()))
}

/// Reads a file's scene `scene` (0 for the first): `sha` is the file's hash, and `read` answers
/// `"<sha>/<uri>"` with an external buffer's or image's bytes, resolved by the host by hash.
pub fn import(
    bytes: &[u8],
    sha: &str,
    scene: usize,
    read: &dyn Fn(&str) -> Option<Vec<u8>>,
) -> Result<Imported, Fault> {
    let (doc, bin) = split(bytes)?;
    let list = |k: &str| {
        doc.get(k)
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default()
    };
    let external = |uri: &str| -> Result<Vec<u8>, Fault> {
        read(&format!("{sha}/{uri}"))
            .ok_or_else(|| format!("params/sha256: {uri} isn't resolved by hash"))
    };
    let mut ext = Vec::new();
    for b in list("buffers") {
        ext.push(match b.get("uri").and_then(Value::as_str) {
            Some(uri) if !uri.starts_with("data:") => Some(external(uri)?),
            _ => None,
        });
    }
    let view_bytes = |i: usize| -> Result<Vec<u8>, Fault> {
        let v = doc
            .pointer(&format!("/bufferViews/{i}"))
            .ok_or_else(|| bad("a missing buffer view"))?;
        let data = buffer(
            &doc,
            &bin,
            &ext,
            v.get("buffer").and_then(Value::as_u64).unwrap_or(0) as usize,
        )?;
        let off = v.get("byteOffset").and_then(Value::as_u64).unwrap_or(0) as usize;
        let len = v.get("byteLength").and_then(Value::as_u64).unwrap_or(0) as usize;
        data.get(off..off + len)
            .map(<[u8]>::to_vec)
            .ok_or_else(|| bad("a buffer view past its buffer"))
    };
    let mut images = Vec::new();
    for im in list("images") {
        let b = match (
            im.get("uri").and_then(Value::as_str),
            im.get("bufferView").and_then(Value::as_u64),
        ) {
            (Some(uri), _) if uri.starts_with("data:") => uri
                .split_once(";base64,")
                .and_then(|(_, d)| deep_canvas::base64::decode(d))
                .ok_or_else(|| bad("an image's base64"))?,
            (Some(uri), _) => external(uri)?,
            (None, Some(v)) => view_bytes(v as usize)?,
            _ => return Err(bad("an image without its bytes")),
        };
        images.push((deep_canvas::canon::sha256_hex(&b), b));
    }
    let textures = list("textures");
    let samplers = list("samplers");
    // A texture info as a map field: its image's hash (a KTX2 source where KHR_texture_basisu
    // names one), uv set, transform and wraps.
    let map = |info: &Value| -> Option<Value> {
        let t = textures.get(info.get("index")?.as_u64()? as usize)?;
        let source = t
            .pointer("/extensions/KHR_texture_basisu/source")
            .or_else(|| t.get("source"))?
            .as_u64()? as usize;
        let sha = &images.get(source)?.0;
        let tt = info.pointer("/extensions/KHR_texture_transform");
        let tex_coord = tt
            .and_then(|t| t.get("texCoord"))
            .or_else(|| info.get("texCoord"))
            .and_then(Value::as_u64)
            .unwrap_or(0);
        let pair = |k: &str, d: [f64; 2]| -> Value {
            tt.and_then(|t| t.get(k))
                .cloned()
                .unwrap_or_else(|| json!(d))
        };
        let rotation = tt
            .and_then(|t| t.get("rotation"))
            .and_then(Value::as_f64)
            .unwrap_or(0.0)
            .to_degrees();
        let sampler = t
            .get("sampler")
            .and_then(Value::as_u64)
            .and_then(|i| samplers.get(i as usize));
        let (ws, wt) = (
            wrap_name(sampler.and_then(|s| s.get("wrapS"))),
            wrap_name(sampler.and_then(|s| s.get("wrapT"))),
        );
        Some(json!({
            "sha256": sha,
            "uv": if tex_coord == 1 { "uv1" } else { "uv0" },
            "transform": {"offset": pair("offset", [0.0, 0.0]), "scale": pair("scale", [1.0, 1.0]), "rotation": rotation},
            "wrap": if ws == wt { json!(ws) } else { json!([ws, wt]) },
        }))
    };
    let mut materials = Vec::new();
    let mut dropped = Vec::new();
    for (i, m) in list("materials").iter().enumerate() {
        let pbr = m.get("pbrMetallicRoughness");
        let at = |k: &str| pbr.and_then(|p| p.get(k));
        let mut maps = serde_json::Map::new();
        for (field, info) in [
            ("base_color", at("baseColorTexture")),
            ("metallic_roughness", at("metallicRoughnessTexture")),
            ("emission", m.get("emissiveTexture")),
            ("occlusion", m.get("occlusionTexture")),
        ] {
            if let Some(v) = info.and_then(map) {
                maps.insert(field.into(), v);
            }
        }
        let mut p = json!({
            "base_color": at("baseColorFactor").cloned().unwrap_or(json!([1.0, 1.0, 1.0, 1.0])),
            "metallic": at("metallicFactor").and_then(Value::as_f64).unwrap_or(1.0),
            "roughness": at("roughnessFactor").and_then(Value::as_f64).unwrap_or(1.0),
            "emission": m.get("emissiveFactor").cloned().unwrap_or(json!([0.0, 0.0, 0.0])),
            "emission_strength": m.pointer("/extensions/KHR_materials_emissive_strength/emissiveStrength").and_then(Value::as_f64).unwrap_or(1.0),
            "alpha_mode": m.get("alphaMode").and_then(Value::as_str).unwrap_or("OPAQUE").to_lowercase(),
            "alpha_cutoff": m.get("alphaCutoff").and_then(Value::as_f64).unwrap_or(0.5),
            "double_sided": m.get("doubleSided").and_then(Value::as_bool).unwrap_or(false),
            "unlit": m.pointer("/extensions/KHR_materials_unlit").is_some(),
            "maps": maps,
        });
        if let Some(n) = m.get("normalTexture") {
            if let Some(v) = map(n) {
                p["normal_map"] = v;
            }
            p["normal_scale"] = json!(n.get("scale").and_then(Value::as_f64).unwrap_or(1.0));
        }
        if let Some(o) = m.get("occlusionTexture") {
            p["occlusion_strength"] =
                json!(o.get("strength").and_then(Value::as_f64).unwrap_or(1.0));
        }
        lobe_params(m, &mut p);
        // Anything else the material uses is listed, never dropped silently: each texture inside
        // an extension the maps can't hold, and each extension the import doesn't read.
        for (name, body) in m
            .get("extensions")
            .and_then(Value::as_object)
            .into_iter()
            .flatten()
        {
            if READ.contains(&name.as_str()) {
                continue;
            }
            let planted = name == "KHR_materials_dispersion"
                && DROPS_DISPERSION.load(std::sync::atomic::Ordering::Relaxed);
            if !LOBES.contains(&name.as_str()) || planted {
                dropped.push((i, name.clone()));
            }
            for (k, v) in body.as_object().into_iter().flatten() {
                if v.get("index").is_some_and(Value::is_u64) {
                    dropped.push((i, format!("{name}/{k}")));
                }
            }
        }
        materials.push(ImportedMaterial {
            name: m.get("name").cloned().unwrap_or(Value::Null),
            params: p,
        });
    }
    // Every node of the scene, parent × local, each mesh's triangle primitives.
    let nodes_json = list("nodes");
    let roots: Vec<usize> = doc
        .pointer(&format!("/scenes/{scene}/nodes"))
        .and_then(Value::as_array)
        .ok_or_else(|| "params/node/scene".to_string())?
        .iter()
        .filter_map(Value::as_u64)
        .map(|n| n as usize)
        .collect();
    let identity = [
        [1.0, 0.0, 0.0, 0.0],
        [0.0, 1.0, 0.0, 0.0],
        [0.0, 0.0, 1.0, 0.0],
    ];
    let mut stack: Vec<(usize, [[f64; 4]; 3], usize)> =
        roots.iter().rev().map(|r| (*r, identity, 0)).collect();
    let mut nodes = Vec::new();
    let mut lights = Vec::new();
    while let Some((i, parent, depth)) = stack.pop() {
        let n = nodes_json.get(i).ok_or_else(|| bad("a missing node"))?;
        if depth > 64 {
            return Err(bad("a node tree deeper than 64"));
        }
        let world = mul(&parent, &local(n));
        // KHR_lights_punctual: a node's light at its world transform (#428).
        if let Some(l) = n
            .pointer("/extensions/KHR_lights_punctual/light")
            .and_then(Value::as_u64)
            .and_then(|l| doc.pointer(&format!("/extensions/KHR_lights_punctual/lights/{l}")))
        {
            lights.push((world, l.clone()));
        }
        for c in n
            .get("children")
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
            .rev()
        {
            if let Some(c) = c.as_u64() {
                stack.push((c as usize, world, depth + 1));
            }
        }
        let Some(mesh_i) = n.get("mesh").and_then(Value::as_u64) else {
            continue;
        };
        let mut primitives = Vec::new();
        for prim in doc
            .pointer(&format!("/meshes/{mesh_i}/primitives"))
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
        {
            if prim.get("mode").and_then(Value::as_u64).unwrap_or(4) != 4 {
                continue;
            }
            primitives.push(Primitive {
                mesh: primitive(&doc, &bin, &ext, prim)?,
                material: prim
                    .get("material")
                    .and_then(Value::as_u64)
                    .map(|m| m as usize),
            });
        }
        nodes.push(Node {
            index: i,
            name: n
                .get("name")
                .and_then(Value::as_str)
                .map_or_else(|| i.to_string(), str::to_string),
            world,
            primitives,
        });
    }
    Ok(Imported {
        nodes,
        lights,
        materials,
        images,
        dropped,
    })
}

/// One triangle primitive's mesh: positions, normals (made from its faces where it has none),
/// both uv sets and its tangents where it has them.
fn primitive(
    doc: &Value,
    bin: &[u8],
    ext: &[Option<Vec<u8>>],
    prim: &Value,
) -> Result<Mesh, Fault> {
    let attr = |k: &str| {
        prim.pointer(&format!("/attributes/{k}"))
            .and_then(Value::as_u64)
    };
    let pos_i = attr("POSITION").ok_or_else(|| bad("a primitive without positions"))?;
    let positions: Vec<V3> = accessor_in(doc, bin, ext, pos_i as usize, 3)?
        .into_iter()
        .map(|r| [r[0], r[1], r[2]])
        .collect();
    let indices: Vec<u32> = match prim.get("indices").and_then(Value::as_u64) {
        Some(i) => accessor_in(doc, bin, ext, i as usize, 1)?
            .into_iter()
            .map(|r| r[0] as u32)
            .collect(),
        None => (0..positions.len() as u32).collect(),
    };
    if indices.iter().any(|i| *i as usize >= positions.len()) {
        return Err(bad("an index past its positions"));
    }
    let normals: Vec<V3> = match attr("NORMAL") {
        Some(i) => accessor_in(doc, bin, ext, i as usize, 3)?
            .into_iter()
            .map(|r| unit([r[0], r[1], r[2]]))
            .collect(),
        None => {
            let mut acc = vec![[0.0; 3]; positions.len()];
            for t in indices.as_chunks::<3>().0 {
                let [a, b, c] = [t[0], t[1], t[2]].map(|i| i as usize);
                let nrm = cross(
                    sub(positions[b], positions[a]),
                    sub(positions[c], positions[a]),
                );
                for v in [a, b, c] {
                    acc[v] = add(acc[v], nrm);
                }
            }
            acc.into_iter().map(unit).collect()
        }
    };
    let uv = |k: &str| -> Result<Vec<[f64; 2]>, Fault> {
        match attr(k) {
            Some(i) => Ok(accessor_in(doc, bin, ext, i as usize, 2)?
                .into_iter()
                .map(|r| [r[0], r[1]])
                .collect()),
            None => Ok(Vec::new()),
        }
    };
    let mut m = Mesh::default();
    for (p, n) in positions.iter().zip(&normals) {
        m.vertex(*p, *n);
    }
    for t in indices.as_chunks::<3>().0 {
        m.tri(t[0], t[1], t[2], 0);
    }
    m.part("primitive.0", 0);
    m.uv0 = uv("TEXCOORD_0")?;
    m.uv1 = uv("TEXCOORD_1")?;
    if let Some(i) = attr("TANGENT") {
        m.tangents = accessor_in(doc, bin, ext, i as usize, 4)?
            .into_iter()
            .map(|r| [r[0], r[1], r[2], r[3]])
            .collect();
    }
    for (k, len) in [
        ("TEXCOORD_0", m.uv0.len()),
        ("TEXCOORD_1", m.uv1.len()),
        ("TANGENT", m.tangents.len()),
    ] {
        if len != 0 && len != positions.len() {
            return Err(bad(&format!("{k} that doesn't match its positions")));
        }
    }
    Ok(m)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    /// A GLB of one node whose mesh is a tetrahedron: 4 positions, 12 u16 indices, no normals.
    fn tetrahedron() -> Vec<u8> {
        let pos: [[f32; 3]; 4] = [
            [0.0, 0.0, 0.0],
            [1.0, 0.0, 0.0],
            [0.0, 1.0, 0.0],
            [0.0, 0.0, 1.0],
        ];
        let idx: [u16; 12] = [0, 2, 1, 0, 1, 3, 0, 3, 2, 1, 2, 3];
        let mut bin: Vec<u8> = pos.iter().flatten().flat_map(|x| x.to_le_bytes()).collect();
        bin.extend(idx.iter().flat_map(|i| i.to_le_bytes()));
        while !bin.len().is_multiple_of(4) {
            bin.push(0);
        }
        let doc = json!({
            "asset": {"version": "2.0"},
            "buffers": [{"byteLength": bin.len()}],
            "bufferViews": [{"buffer": 0, "byteOffset": 0, "byteLength": 48}, {"buffer": 0, "byteOffset": 48, "byteLength": 24}],
            "accessors": [{"bufferView": 0, "componentType": 5126, "count": 4, "type": "VEC3"},
                          {"bufferView": 1, "componentType": 5123, "count": 12, "type": "SCALAR"}],
            "meshes": [{"primitives": [{"attributes": {"POSITION": 0}, "indices": 1}]}],
            "nodes": [{"name": "tip", "mesh": 0}],
        });
        let mut text = serde_json::to_vec(&doc).unwrap();
        while !text.len().is_multiple_of(4) {
            text.push(b' ');
        }
        let mut out = b"glTF".to_vec();
        out.extend(2u32.to_le_bytes());
        out.extend(((12 + 8 + text.len() + 8 + bin.len()) as u32).to_le_bytes());
        out.extend((text.len() as u32).to_le_bytes());
        out.extend(0x4E4F_534Au32.to_le_bytes());
        out.extend(&text);
        out.extend((bin.len() as u32).to_le_bytes());
        out.extend(0x004E_4942u32.to_le_bytes());
        out.extend(&bin);
        out
    }

    #[test]
    fn a_glb_node_reads_to_its_mesh_by_index_and_by_name() {
        let glb = tetrahedron();
        for node in [json!(0), json!("tip")] {
            let m = mesh(&glb, &node).unwrap();
            assert_eq!((m.positions.len(), m.triangles()), (4, 4));
            assert_eq!(m.positions[1], [1.0, 0.0, 0.0]);
            assert!(m
                .normals
                .iter()
                .all(|n| (crate::geom::length(*n) - 1.0).abs() < 1e-9));
        }
        assert!(mesh(&glb, &json!(3)).is_err());
        assert!(mesh(&glb[..40], &json!(0)).is_err());
    }
}

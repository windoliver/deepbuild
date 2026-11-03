//! `mesh.asset@1`'s reader (canvas primitives: Builder: `mesh.asset {sha256 (glTF), node}`;
//! issue #420): a glTF 2.0 file, binary (GLB) or JSON with its buffers inline as data URIs,
//! read to one node's mesh in the node's own space: every triangle primitive's positions,
//! normals (made from its faces where it has none) and indices. Only what a mesh needs is read.

use serde_json::Value;

use crate::geom::{add, cross, sub, unit, Mesh, V3};

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

/// Buffer `i`'s bytes: the GLB's binary chunk, or a base64 data URI.
fn buffer(doc: &Value, bin: &[u8], i: usize) -> Result<Vec<u8>, Fault> {
    let b = doc
        .pointer(&format!("/buffers/{i}"))
        .ok_or_else(|| bad("a missing buffer"))?;
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
        5121 => 1,
        5123 => 2,
        5125 | 5126 => 4,
        _ => return Err(bad("a component type")),
    };
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
        view.get("buffer").and_then(Value::as_u64).unwrap_or(0) as usize,
    )?;
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
                    Ok(match component {
                        5121 => f64::from(b[0]),
                        5123 => f64::from(u16::from_le_bytes([b[0], b[1]])),
                        5125 => f64::from(u32::from_le_bytes([b[0], b[1], b[2], b[3]])),
                        _ => f64::from(f32::from_le_bytes([b[0], b[1], b[2], b[3]])),
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
        for (p, n) in positions.iter().zip(&normals) {
            m.vertex(*p, *n);
        }
        for t in indices.as_chunks::<3>().0 {
            m.tri(base + t[0], base + t[1], base + t[2], face as u32);
        }
        m.part(&format!("primitive.{face}"), from);
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

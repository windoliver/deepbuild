//! Issue #192: the mesh a `gen@1` provider wrote at `out_at`, read back as the mesh output.

use super::*;

/// The mesh a provider wrote at `out_at`, little-endian: `u32 vertex_count, u32 index_count,
/// f32 positions[3 × n], f32 normals[3 × n], f32 uv0[2 × n], u32 indices[index_count]`.
pub(super) fn decode_mesh(ran: &Ran, spec: &Value) -> Result<Value, String> {
    let m = &ran.memory;
    let at = ran.out_at.ok_or("a provider exports out_at")? as usize;
    let u32_at = |i: usize| -> Result<u32, String> {
        m.get(i..i + 4)
            .map(|b| u32::from_le_bytes([b[0], b[1], b[2], b[3]]))
            .ok_or_else(|| format!("the mesh runs past memory at {i}"))
    };
    let f32_at = |i: usize| u32_at(i).map(|b| f64::from(f32::from_bits(b)));
    let n = u32_at(at)? as usize;
    let ni = u32_at(at + 4)? as usize;
    let cap = spec
        .get("max_vertices")
        .and_then(Value::as_u64)
        .unwrap_or(262_144) as usize;
    if n > cap {
        return Err(format!("the mesh has {n} vertices, past its cap of {cap}"));
    }
    let mut p = at + 8;
    let mut take = |width: usize| -> Result<Vec<Vec<f64>>, String> {
        let mut out = Vec::new();
        for _ in 0..n {
            let mut v = Vec::new();
            for _ in 0..width {
                v.push(f32_at(p)?);
                p += 4;
            }
            out.push(v);
        }
        Ok(out)
    };
    let positions = take(3)?;
    let normals = take(3)?;
    let uv0 = take(2)?;
    let mut indices = Vec::new();
    for _ in 0..ni {
        indices.push(u32_at(p)?);
        p += 4;
    }
    let mut lo = [f64::INFINITY; 3];
    let mut hi = [f64::NEG_INFINITY; 3];
    for v in &positions {
        for k in 0..3 {
            lo[k] = lo[k].min(v[k]);
            hi[k] = hi[k].max(v[k]);
        }
    }
    let mut out = Map::new();
    out.insert("positions".into(), json!(positions));
    out.insert("normals".into(), json!(normals));
    out.insert("uv0".into(), json!(uv0));
    out.insert("indices".into(), json!(indices));
    out.insert("parts".into(), json!([{"first": 0, "count": ni}]));
    out.insert("bounds".into(), json!([lo, hi]));
    Ok(Value::Object(out))
}

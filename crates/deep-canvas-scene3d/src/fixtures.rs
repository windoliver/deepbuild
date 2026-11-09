//! Fixture kinds that stand in for modules this build lacks, so motion blur can be proven against
//! them (#419): `fixture.skin@1` for skinned playback (#526), `fixture.world@1` for the physics
//! module's baked worlds (#97) and `mesh.sequence@1` in its per-frame glTF form (#529). Each is a
//! pure function of its params and t: a pre-skin per time, a bake read at t, a frame by t.

use serde_json::Value;
use sha2::{Digest, Sha256};

use crate::geom::{Mesh, V3};
use crate::scene::Refused;

const FLICKS: i128 = deep_canvas::camera::FLICKS_PER_SECOND as i128;

/// A time literal's flicks: `"2s"`, `"250ms"` or a number of seconds.
fn time(v: &Value) -> Option<i64> {
    let secs = match v {
        Value::Number(n) => n.as_f64()?,
        Value::String(s) => match s.strip_suffix("ms") {
            Some(ms) => ms.trim().parse::<f64>().ok()? / 1000.0,
            None => s.strip_suffix('s')?.trim().parse::<f64>().ok()?,
        },
        _ => return None,
    };
    Some((secs * FLICKS as f64).round() as i64)
}

fn bad<T>(path: impl Into<String>) -> Result<T, Refused> {
    Err(Refused {
        code: "out_of_range",
        path: path.into(),
    })
}

fn v3(v: Option<&Value>) -> Option<V3> {
    let a = v?.as_array()?;
    if a.len() != 3 {
        return None;
    }
    Some([a[0].as_f64()?, a[1].as_f64()?, a[2].as_f64()?])
}

/// A mesh of `positions` and `triangles`, each vertex's normal the mean of its faces'.
fn mesh(positions: Vec<V3>, triangles: &[[u32; 3]]) -> Mesh {
    let mut m = Mesh {
        normals: vec![[0.0; 3]; positions.len()],
        positions,
        ..Mesh::default()
    };
    for (f, t) in triangles.iter().enumerate() {
        let [a, b, c] = t.map(|i| m.positions[i as usize]);
        let n = crate::geom::cross(crate::geom::sub(b, a), crate::geom::sub(c, a));
        for i in t {
            let s = &mut m.normals[*i as usize];
            *s = crate::geom::add(*s, n);
        }
        m.indices.extend(t);
        m.faces.push(f as u32);
    }
    for n in &mut m.normals {
        *n = crate::geom::unit(*n);
    }
    m
}

type M34 = [[f64; 4]; 3];

fn mul(a: &M34, b: &M34) -> M34 {
    let mut o = [[0.0; 4]; 3];
    for r in 0..3 {
        for c in 0..4 {
            o[r][c] =
                (0..3).map(|k| a[r][k] * b[k][c]).sum::<f64>() + if c == 3 { a[r][3] } else { 0.0 };
        }
    }
    o
}

fn apply(m: &M34, p: V3) -> V3 {
    [0, 1, 2].map(|r| m[r][0] * p[0] + m[r][1] * p[1] + m[r][2] * p[2] + m[r][3])
}

/// T(pos) × Rz·Ry·Rx(rot in degrees).
fn bone_local(pos: V3, rot: V3) -> M34 {
    let [x, y, z] = rot.map(f64::to_radians);
    let rx = [
        [1.0, 0.0, 0.0, 0.0],
        [0.0, x.cos(), -x.sin(), 0.0],
        [0.0, x.sin(), x.cos(), 0.0],
    ];
    let ry = [
        [y.cos(), 0.0, y.sin(), 0.0],
        [0.0, 1.0, 0.0, 0.0],
        [-y.sin(), 0.0, y.cos(), 0.0],
    ];
    let rz = [
        [z.cos(), -z.sin(), 0.0, 0.0],
        [z.sin(), z.cos(), 0.0, 0.0],
        [0.0, 0.0, 1.0, 0.0],
    ];
    let mut m = mul(&rz, &mul(&ry, &rx));
    for r in 0..3 {
        m[r][3] = pos[r];
    }
    m
}

/// `fixture.skin@1` at its evaluated params: every vertex pre-skinned by linear blend,
/// Σ wᵢ · world(bᵢ) · bind(bᵢ)⁻¹ · p, in the item's own space.
pub fn skin(params: &Value, path: &str) -> Result<Mesh, Refused> {
    let list = |k: &str| {
        params
            .get(k)
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default()
    };
    let positions: Vec<V3> = list("positions")
        .iter()
        .enumerate()
        .map(|(i, p)| v3(Some(p)).ok_or(format!("{path}/positions/{i}")))
        .collect::<Result<_, _>>()
        .or_else(bad)?;
    let n = positions.len() as u64;
    let triangles: Vec<[u32; 3]> = list("triangles")
        .iter()
        .enumerate()
        .map(|(i, t)| {
            let a = t.as_array().filter(|a| a.len() == 3);
            a.and_then(|a| {
                let v: Option<Vec<u32>> = a
                    .iter()
                    .map(|x| x.as_u64().filter(|x| *x < n).map(|x| x as u32))
                    .collect();
                v.map(|v| [v[0], v[1], v[2]])
            })
            .ok_or(format!("{path}/triangles/{i}"))
        })
        .collect::<Result<_, _>>()
        .or_else(bad)?;
    let bones = list("bones");
    // Each bone's world at t and in the bind pose (every rot zero), parents first.
    let mut world: Vec<M34> = Vec::new();
    let mut bind: Vec<M34> = Vec::new();
    for (i, b) in bones.iter().enumerate() {
        let at = format!("{path}/bones/{i}");
        let pos = v3(b.get("pos")).ok_or(format!("{at}/pos")).or_else(bad)?;
        let rot = v3(b.get("rot")).unwrap_or([0.0; 3]);
        let (w, z) = (bone_local(pos, rot), bone_local(pos, [0.0; 3]));
        match b.get("parent").and_then(Value::as_u64) {
            Some(p) if (p as usize) < i => {
                world.push(mul(&world[p as usize], &w));
                bind.push(mul(&bind[p as usize], &z));
            }
            Some(_) => return bad(format!("{at}/parent")),
            None => {
                world.push(w);
                bind.push(z);
            }
        }
    }
    // world(b) · bind(b)⁻¹: the bind pose is a pure translation chain, so its inverse negates it.
    let skins: Vec<M34> = world
        .iter()
        .zip(&bind)
        .map(|(w, b)| {
            let inv = [
                [1.0, 0.0, 0.0, -b[0][3]],
                [0.0, 1.0, 0.0, -b[1][3]],
                [0.0, 0.0, 1.0, -b[2][3]],
            ];
            mul(w, &inv)
        })
        .collect();
    let (joints, weights) = (list("joints"), list("weights"));
    let mut out = Vec::with_capacity(positions.len());
    for (i, p) in positions.iter().enumerate() {
        let (j, w) = (
            joints.get(i).and_then(Value::as_array),
            weights.get(i).and_then(Value::as_array),
        );
        let (Some(j), Some(w)) = (j, w) else {
            return bad(format!("{path}/joints/{i}"));
        };
        let mut q = [0.0; 3];
        for (b, wt) in j.iter().zip(w) {
            let (Some(b), Some(wt)) = (b.as_u64(), wt.as_f64()) else {
                return bad(format!("{path}/weights/{i}"));
            };
            if wt == 0.0 {
                continue;
            }
            let Some(m) = skins.get(b as usize) else {
                return bad(format!("{path}/joints/{i}"));
            };
            let s = apply(m, *p);
            q = [0, 1, 2].map(|k| q[k] + wt * s[k]);
        }
        out.push(q);
    }
    Ok(mesh(out, &triangles))
}

/// `mesh.sequence@1` at `t` flicks: frame ⌊(t − start) × frame_rate⌋ of its per-frame glTF
/// meshes, clamped to the list, mixed with the next under `linear` when their topology matches.
pub fn sequence(
    params: &Value,
    t: i64,
    path: &str,
    read: &dyn Fn(&str) -> Option<Vec<u8>>,
) -> Result<Mesh, Refused> {
    let frames: Vec<&str> = params
        .get("frames")
        .and_then(Value::as_array)
        .map(|a| a.iter().filter_map(Value::as_str).collect())
        .unwrap_or_default();
    if frames.is_empty() {
        return bad(format!("{path}/frames"));
    }
    let rate = params
        .get("frame_rate")
        .and_then(Value::as_f64)
        .unwrap_or(24.0);
    let start = match params.get("start") {
        Some(v) => time(v).ok_or(format!("{path}/start")).or_else(bad)?,
        None => 0,
    };
    // In whole flicks, so a frame boundary at an exact time is never lost to rounding.
    let rate_milli = (rate * 1000.0).round() as i128;
    let num = i128::from(t - start) * rate_milli;
    let den = FLICKS * 1000;
    let f = num.div_euclid(den).clamp(0, frames.len() as i128 - 1) as usize;
    let frac = if (f as i128) < frames.len() as i128 - 1 && num >= 0 {
        (num - f as i128 * den) as f64 / den as f64
    } else {
        0.0
    };
    let load = |k: usize| -> Result<Mesh, Refused> {
        let at = format!("{path}/frames/{k}");
        let bytes = read(frames[k]).ok_or(Refused {
            code: "asset_missing",
            path: at.clone(),
        })?;
        crate::gltf::mesh(&bytes, &Value::from(0)).map_err(|_| Refused {
            code: "out_of_range",
            path: at,
        })
    };
    let a = load(f)?;
    if params.get("interpolate").and_then(Value::as_str) == Some("linear") && frac > 0.0 {
        let b = load(f + 1)?;
        if b.positions.len() == a.positions.len() && b.indices == a.indices {
            let mut m = a.clone();
            for (p, q) in m.positions.iter_mut().zip(&b.positions) {
                *p = [0, 1, 2].map(|k| p[k] + (q[k] - p[k]) * frac);
            }
            return Ok(m);
        }
    }
    Ok(a)
}

/// One body of a baked world.
#[derive(Clone, Debug, PartialEq)]
pub struct Body {
    pub id: String,
    pub radius: f64,
    /// kg/m³, which buoyancy reads (#166).
    pub density: f64,
}

/// #166: an input track entry `{step, kind: "poke", target, data: {push}}`: at the start of step
/// `step` the push adds to the target body's velocity, before that step's forces.
#[derive(Clone, Debug, PartialEq)]
pub struct Poke {
    pub step: usize,
    pub body: usize,
    pub push: V3,
}

/// `fixture.world@1`'s bake: every body's position and velocity after each step, step 0 the
/// initial state, from step 0 through its span.
#[derive(Clone, Debug, PartialEq)]
pub struct World {
    pub step_hz: f64,
    pub gravity: f64,
    pub floor: f64,
    pub restitution: f64,
    pub bodies: Vec<Body>,
    pub states: Vec<Vec<(V3, V3)>>,
    /// #166: the fluid's plane and density, when the world has buoyancy.
    pub buoyancy: Option<(f64, f64)>,
}

impl World {
    /// One step of `dt` from `s`: for each body in ID order, its buoyancy, v.y += g·dt, p += v·dt,
    /// and a bounce off the floor. Buoyancy (#166) lifts a sphere by its submerged share
    /// φ = h² (3r − h) ÷ (4r³), h = clamp(level − (p.y − r), 0, 2r): v.y −= g (ρ_fluid ÷ ρ_body) φ dt.
    pub fn step(&self, s: &[(V3, V3)], dt: f64) -> Vec<(V3, V3)> {
        s.iter()
            .zip(&self.bodies)
            .map(|((p, v), b)| {
                let mut v = *v;
                if let Some((level, fluid)) = self.buoyancy {
                    let r = b.radius;
                    let h = (level - (p[1] - r)).clamp(0.0, 2.0 * r);
                    let share = h * h * (3.0 * r - h) / (4.0 * r * r * r);
                    v[1] -= self.gravity * (fluid / b.density) * share * dt;
                }
                v[1] += self.gravity * dt;
                let mut p = [0, 1, 2].map(|k| p[k] + v[k] * dt);
                if p[1] - b.radius < self.floor {
                    p[1] = 2.0 * (self.floor + b.radius) - p[1];
                    v[1] = -self.restitution * v[1];
                }
                (p, v)
            })
            .collect()
    }

    /// Step k's hash: the first 8 bytes of SHA-256 over every body's p then v, f64 little-endian,
    /// bodies in ID order, as 16 hex digits.
    pub fn hashes(&self) -> Vec<String> {
        self.states
            .iter()
            .map(|s| {
                let mut h = Sha256::new();
                for (p, v) in s {
                    for x in p.iter().chain(v) {
                        h.update(x.to_le_bytes());
                    }
                }
                h.finalize()[..8]
                    .iter()
                    .map(|b| format!("{b:02x}"))
                    .collect()
            })
            .collect()
    }

    /// Each body's position at `t` flicks, read from the bake: linear between step ⌊t · step_hz⌋
    /// and the next, held past the last.
    pub fn at(&self, t: i64) -> Vec<V3> {
        let x = t as f64 / FLICKS as f64 * self.step_hz;
        let last = self.states.len() - 1;
        let k = (x.floor().max(0.0) as usize).min(last);
        let f = if k < last {
            (x - k as f64).clamp(0.0, 1.0)
        } else {
            0.0
        };
        let (a, b) = (&self.states[k], &self.states[(k + 1).min(last)]);
        a.iter()
            .zip(b)
            .map(|((p, _), (q, _))| [0, 1, 2].map(|i| p[i] + (q[i] - p[i]) * f))
            .collect()
    }
}

/// A `fixture.world@1`'s bake at check.
pub fn bake(params: &Value, path: &str) -> Result<World, Refused> {
    let num = |k: &str, d: f64| params.get(k).and_then(Value::as_f64).unwrap_or(d);
    let step_hz = num("step_hz", 60.0);
    if !(step_hz > 0.0 && step_hz <= 10_000.0) {
        return bad(format!("{path}/step_hz"));
    }
    let span = match params.get("span") {
        Some(v) => time(v).ok_or(format!("{path}/span")).or_else(bad)?,
        None => FLICKS as i64,
    };
    let steps = (span as f64 / FLICKS as f64 * step_hz).round() as usize;
    if steps > 1_000_000 {
        return bad(format!("{path}/span"));
    }
    let mut bodies = Vec::new();
    let mut initial = Vec::new();
    let mut ids: Vec<(&String, &Value)> = params
        .get("bodies")
        .and_then(Value::as_object)
        .into_iter()
        .flatten()
        .collect();
    ids.sort_by(|a, b| a.0.cmp(b.0));
    for (id, b) in ids {
        let at = format!("{path}/bodies/{id}");
        let radius = b
            .get("radius")
            .and_then(Value::as_f64)
            .ok_or(format!("{at}/radius"))
            .or_else(bad)?;
        let p = v3(b.get("pos")).ok_or(format!("{at}/pos")).or_else(bad)?;
        let v = v3(b.get("vel")).unwrap_or([0.0; 3]);
        let density = b.get("density").and_then(Value::as_f64).unwrap_or(1000.0);
        if !(density > 0.0 && density.is_finite()) {
            return bad(format!("{at}/density"));
        }
        bodies.push(Body {
            id: id.clone(),
            radius,
            density,
        });
        initial.push((p, v));
    }
    let mut w = World {
        step_hz,
        gravity: num("gravity", -9.81),
        floor: num("floor", 0.0),
        restitution: num("restitution", 0.5),
        bodies,
        states: vec![initial],
        buoyancy: None,
    };
    if let Some(b) = params.get("buoyancy") {
        let level = b.get("level").and_then(Value::as_f64);
        let density = b.get("density").and_then(Value::as_f64).unwrap_or(1000.0);
        match level {
            Some(l) if l.is_finite() && density > 0.0 && density.is_finite() => {
                w.buoyancy = Some((l, density));
            }
            _ => return bad(format!("{path}/buoyancy")),
        }
    }
    let mut pokes = Vec::new();
    for (k, e) in params
        .get("inputs")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .enumerate()
    {
        let at = format!("{path}/inputs/{k}");
        let step = e.get("step").and_then(Value::as_u64);
        let body = e
            .get("target")
            .and_then(Value::as_str)
            .and_then(|t| w.bodies.iter().position(|b| b.id == t));
        let push = v3(e.pointer("/data/push"));
        match (e.get("kind").and_then(Value::as_str), step, body, push) {
            (Some("poke"), Some(step), Some(body), Some(push)) => pokes.push(Poke {
                step: step as usize,
                body,
                push,
            }),
            _ => return bad(at),
        }
    }
    // Entries apply in (kind, target) order: one kind, so by target.
    pokes.sort_by_key(|p| (p.step, p.body));
    let dt = 1.0 / step_hz;
    for k in 0..steps {
        let mut now = w.states.last().expect("step 0").clone();
        for p in pokes.iter().filter(|p| p.step == k) {
            let v = &mut now[p.body].1;
            *v = [0, 1, 2].map(|i| v[i] + p.push[i]);
        }
        let next = w.step(&now, dt);
        w.states.push(next);
    }
    Ok(w)
}

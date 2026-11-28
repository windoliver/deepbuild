use crate::interp::hash1;
use deep_canvas_scene3d::scene::{Other, Scene};
use serde_json::Value;

use super::bake::{self, Inputs};
use super::eval::{self, Baked};
use super::spec::{self, Motion, Refusal, Space, Spec};
use super::{flows, Planted, V3};
use crate::shipped;

const FLICKS: f64 = 705_600_000.0;

pub fn item_seed(doc_seed: u64, id: &str) -> u32 {
    let mut h = hash1(doc_seed as u32) ^ hash1((doc_seed >> 32) as u32 ^ 0x9e37_79b9);
    for b in id.bytes() {
        h = hash1(h ^ u32::from(b));
    }
    h
}

pub fn item_pos(scene: &Scene, id: &str) -> Option<V3> {
    let id = id.split('#').next().unwrap_or(id);
    scene
        .layers
        .iter()
        .flat_map(|l| &l.solids)
        .find(|s| s.id == id)
        .map(|s| [s.model[0][3], s.model[1][3], s.model[2][3]])
        .or_else(|| scene.others.iter().find(|o| o.id == id).map(|o| o.pos))
}

pub fn resampled(points: &[V3]) -> (Vec<V3>, f64) {
    let n = shipped::CURVE_POINTS as usize;
    let seg = |a: V3, b: V3| {
        deep_canvas::ops::sqrt(
            (b[0] - a[0]).powi(2) + (b[1] - a[1]).powi(2) + (b[2] - a[2]).powi(2),
        )
    };
    let total: f64 = points.windows(2).map(|w| seg(w[0], w[1])).sum();
    let mut out = Vec::with_capacity(n);
    for k in 0..n {
        let mut left = total * k as f64 / (n - 1) as f64;
        let mut at = *points.last().unwrap_or(&[0.0; 3]);
        for w in points.windows(2) {
            let d = seg(w[0], w[1]);
            if left <= d && d > 0.0 {
                let f = left / d;
                at = [0, 1, 2].map(|i| w[0][i] + (w[1][i] - w[0][i]) * f);
                break;
            }
            left -= d;
        }
        out.push(at);
    }
    (out, total)
}

pub struct Prepared<'a> {
    pub other: &'a Other,
    pub spec: Spec,
    pub origin: V3,
    pub curve: (Vec<V3>, f64),
    pub parent: Option<&'a str>,
    pub world: Option<&'a str>,
    pub flows: Vec<flows::Curve>,
    pub moved: String,
}

impl Prepared<'_> {
    pub fn inputs<'b>(
        &'b self,
        doc: &'b Value,
        scene: &'b Scene,
        seed: u32,
        planted: Planted,
        parent: Option<&'b Baked>,
    ) -> Inputs<'b> {
        Inputs {
            doc,
            scene,
            id: &self.other.id,
            params: &self.other.params,
            seed,
            origin: self.origin,
            curve: self.curve.clone(),
            parent: self.parent.zip(parent),
            planted,
        }
    }
}

pub fn cycle(chain: &mut Vec<String>, id: &str) -> Result<(), Refusal> {
    if !chain.iter().any(|c| c == id) {
        return Ok(());
    }
    chain.push(id.to_string());
    Err(Refusal::new(
        "cycle",
        format!("items/{id}/params/emit/on/particles"),
        format!(
            "bursts at particles come back to {id}: {}",
            chain.join(" → ")
        ),
    ))
}

pub fn prepare<'a>(doc: &Value, scene: &'a Scene, id: &str) -> Result<Prepared<'a>, Refusal> {
    let o = scene
        .others
        .iter()
        .find(|o| o.id == id && o.kind == "particles@1")
        .ok_or_else(|| {
            Refusal::new(
                "ref_unresolved",
                format!("items/{id}"),
                format!("{id} is no particles item"),
            )
        })?;
    let p = &o.params;
    let origin = p["emit"]["anchor"]
        .as_str()
        .and_then(|a| item_pos(scene, a))
        .unwrap_or(o.pos);
    let curve = p["motion"]["along"]["curve"]
        .as_str()
        .or(p["emit"]["shape"]["along"].as_str())
        .and_then(|c| scene.curves.get(c))
        .map(|pts| resampled(pts))
        .unwrap_or((Vec::new(), 0.0));
    let spec = spec::read(doc, id, p)?;
    let world = p["emit"]["anchor"]
        .as_str()
        .filter(|_| spec.space == Space::World);
    let flows = match &spec.motion {
        Motion::Along { many: Some(m), .. } => {
            let names: Vec<String> = match &m.collection {
                Some(c) => doc["collections"][c]["members"]
                    .as_array()
                    .into_iter()
                    .flatten()
                    .filter_map(Value::as_str)
                    .map(str::to_string)
                    .collect(),
                None => m.curves.clone(),
            };
            names
                .iter()
                .map(|n| {
                    scene
                        .curves
                        .get(n)
                        .map(|pts| flows::Curve::new(pts.clone()))
                        .ok_or_else(|| {
                            Refusal::new(
                                "ref_unresolved",
                                format!("items/{id}/params/motion/along/curves"),
                                format!("{id}: along.curves names {n}, which is no curve"),
                            )
                        })
                })
                .collect::<Result<Vec<_>, _>>()?
        }
        _ => Vec::new(),
    };
    let mut h = deep_canvas::schedule::Hasher::new("particles.flows");
    if world.is_some() {
        h.bytes(doc.to_string().as_bytes());
    }
    for x in flows.iter().flat_map(|c| c.points.iter().flatten()) {
        h.bytes(&x.to_le_bytes());
    }
    Ok(Prepared {
        other: o,
        parent: p["emit"]["on"]["particles"].as_str(),
        spec,
        origin,
        curve,
        world,
        flows,
        moved: h.finish().hex(),
    })
}

pub fn finish(
    inputs: &Inputs<'_>,
    p: &Prepared<'_>,
    anchored: &mut dyn FnMut(&str) -> Result<eval::Anchors, Refusal>,
) -> Result<Baked, Refusal> {
    let mut b = bake::bake(inputs)?;
    b.flows = p.flows.clone();
    if let Some(anchor) = p.world {
        b.anchors = Some(anchored(anchor)?);
    }
    Ok(b)
}

pub fn baked(
    doc: &Value,
    scene: &Scene,
    id: &str,
    seed: u32,
    planted: Planted,
    chain: &mut Vec<String>,
) -> Result<Baked, Refusal> {
    cycle(chain, id)?;
    let p = prepare(doc, scene, id)?;
    chain.push(id.to_string());
    let doc_seed = doc["seed"].as_u64().unwrap_or(0);
    let parent = p
        .parent
        .map(|pid| baked(doc, scene, pid, item_seed(doc_seed, pid), planted, chain))
        .transpose()?;
    chain.pop();
    let inputs = p.inputs(doc, scene, seed, planted, parent.as_ref());
    let span = p.spec.span;
    finish(&inputs, &p, &mut |anchor| anchors(doc, id, anchor, span))
}

pub fn anchors(doc: &Value, id: &str, anchor: &str, emits: f64) -> Result<eval::Anchors, Refusal> {
    let (p, q) = doc
        .get("transport")
        .and_then(deep_canvas::document::frame_rate_of)
        .unwrap_or((60, 1));
    let per = i64::from(q) * FLICKS as i64 / i64::from(p);
    let span = doc
        .pointer("/transport/span")
        .and_then(|v| deep_canvas::document::duration(doc, v).ok())
        .map_or(10.0, |f| f as f64 / FLICKS)
        .min(emits);
    let step = per as f64 / FLICKS;
    let n = ((span / step).ceil() as usize + 1).min(1 << 16);
    let bad = |what: String| {
        Refusal::new(
            "ref_unresolved",
            format!("items/{id}/params/emit/anchor"),
            what,
        )
    };
    let map = doc
        .as_object()
        .ok_or_else(|| bad(format!("{id}: the document isn't an object")))?;
    let times: Vec<i64> = (0..n as i64).map(|k| k * per).collect();
    let at = deep_canvas_scene3d::trail::places(map, anchor, &times).map_err(|r| {
        bad(format!(
            "{id}: emit.anchor names {anchor}, which isn't placed ({}: {})",
            r.code, r.path
        ))
    })?;
    Ok(eval::Anchors { step, at })
}

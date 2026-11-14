//! `render.exposure` (#1938; canvas primitives: Check input: loop kinds): the subject's light in
//! the frame as drawn, read through the object-ID pass: the share of its px clipped past white,
//! the share crushed to black, and its key, the mean log luminance against middle grey. Its fix
//! is the camera's exposure from the light falling on the subject, as an incident meter reads it.

use std::collections::BTreeMap;

use deep_canvas::ops::{log2, sqrt};
use deep_canvas::registry::{Frame, LightQuery, LightSums, Raised, Report};
use deep_canvas_scene3d::finish::exposure_scale;
use deep_canvas_scene3d::light::LightKind;
use deep_canvas_scene3d::scene::Scene;
use serde_json::{json, Value};

use crate::pixels;
use crate::scene::{self, blocked};

pub const KIND: &str = "render.exposure";
pub const CODE: &str = "loop.exposure";

const MIDDLE_GREY: f64 = 0.18;

/// The subject's light in one frame (#1939's readings are the same numbers).
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Reading {
    /// The share of the subject's px past white once exposed.
    pub clipped: f64,
    /// The share whose brightest channel encodes to 0.
    pub crushed: f64,
    /// Its mean log2 luminance once exposed, less middle grey's, in EV.
    pub key_ev: f64,
    pub px: usize,
}

/// What render.exposure's measure asks of a frame (#2513): the px whose pick is one of `picks`
/// (sorted; `None`, every px) at `exposure`.
pub fn query(picks: Option<Vec<u32>>, exposure: f64) -> LightQuery {
    LightQuery {
        picks,
        exposure,
        white: 1.0,
        // A px whose brightest channel encodes to 0.
        black: deep_canvas::color::srgb_decode(0.5 / 255.0),
        weights: pixels::WEIGHTS,
        // A px's luminance floor: ten stops under middle grey, so black reads finite.
        floor: MIDDLE_GREY / 1024.0,
    }
}

/// The reading of what a query returned; `None` where it read no px.
pub fn reading(s: LightSums) -> Option<Reading> {
    let n = s.px as f64;
    (s.px > 0).then(|| Reading {
        clipped: s.over as f64 / n,
        crushed: s.under as f64 / n,
        key_ev: s.log2 / n - log2(MIDDLE_GREY),
        px: s.px as usize,
    })
}

/// The reading of `q` in `frame`: by the reduction of the GPU that drew it (#2513), else over its
/// linear image on the CPU; `None` where it reads no px.
pub fn measure(frame: &Frame, q: &LightQuery) -> Option<Reading> {
    let sums = match &frame.reduce {
        Some(r) => (r.0)(q)?,
        None => sums(frame, q)?,
    };
    reading(sums)
}

/// `q` over `frame`'s linear image (RGBA per px, before exposure) and its object-ID pass.
fn sums(frame: &Frame, q: &LightQuery) -> Option<LightSums> {
    if frame.linear.len() != frame.ids.len() * 4 {
        return None;
    }
    let mut s = LightSums::default();
    for (i, pick) in frame.ids.iter().enumerate() {
        if q.picks
            .as_ref()
            .is_some_and(|p| p.binary_search(pick).is_err())
        {
            continue;
        }
        let px = &frame.linear[i * 4..i * 4 + 3];
        let rgb = [0, 1, 2].map(|c| f64::from(px[c]) * q.exposure);
        let most = rgb[0].max(rgb[1]).max(rgb[2]);
        let lum = q.weights[0] * rgb[0] + q.weights[1] * rgb[1] + q.weights[2] * rgb[2];
        s.px += 1;
        s.over += u64::from(most > q.white);
        s.under += u64::from(most < q.black);
        s.log2 += log2(lum.max(q.floor));
    }
    Some(s)
}

/// #1939: the picks among `picks` of the subject render.exposure reads by default in `doc`, its
/// camera's kept items (#2513: the picks its query names); `None` where it keeps nothing or a
/// frame whose picks are `picks` draws none of it.
pub fn kept_drawn(doc: &Value, picks: &BTreeMap<u32, String>) -> Option<Vec<u32>> {
    let subject = scene::kept(doc, &Value::Null, "subject", KIND).ok()?;
    let drawn = pixels::picks_of(picks, &subject);
    (!drawn.is_empty()).then_some(drawn)
}

/// The check input's limits, which a brief may only tighten.
struct Limits {
    clipped: f64,
    crushed: f64,
    key: [f64; 2],
}

impl Limits {
    fn of(input: &Value) -> Limits {
        let key = input
            .get("key_ev")
            .and_then(Value::as_array)
            .map(|a| a.iter().filter_map(Value::as_f64).collect::<Vec<_>>());
        Limits {
            clipped: crate::number(input, "/clipped_max", 0.005).min(0.005),
            crushed: crate::number(input, "/crushed_max", 0.01).min(0.01),
            key: match key.as_deref() {
                Some([lo, hi]) => [lo.max(-0.5), hi.min(0.5)],
                _ => [-0.5, 0.5],
            },
        }
    }

    fn passes(&self, r: &Reading) -> bool {
        r.clipped <= self.clipped
            && r.crushed <= self.crushed
            && r.key_ev >= self.key[0]
            && r.key_ev <= self.key[1]
    }
}

/// The illuminance falling on `at`, in lx, as an incident meter facing each light reads it: a
/// sun's illuminance, a point's, spot's or area's intensity over the distance squared (a spot's
/// outside its cone counts nothing), and the sky's ambient from above.
fn incident(scene: &Scene, at: [f64; 3]) -> f64 {
    let mut e = 0.0;
    for l in &scene.lights {
        let lum = pixels::luminance(l.color).max(0.0);
        let d = [at[0] - l.pos[0], at[1] - l.pos[1], at[2] - l.pos[2]];
        let d2 = (d[0] * d[0] + d[1] * d[1] + d[2] * d[2]).max(1e-12);
        e += lum
            * match l.kind {
                LightKind::Sun => l.intensity,
                LightKind::Point | LightKind::Area => l.intensity / d2,
                LightKind::Spot => {
                    let cos = (d[0] * l.dir[0] + d[1] * l.dir[1] + d[2] * l.dir[2]) / sqrt(d2);
                    let [outer, inner] = l.cone;
                    let falloff = ((cos - outer) / (inner - outer).max(1e-9)).clamp(0.0, 1.0);
                    l.intensity / d2 * falloff
                }
            };
    }
    if let Some(sky) = &scene.sky {
        e += std::f64::consts::PI * pixels::luminance(sky.ambient[0]).max(0.0);
    }
    e
}

/// The centre of the subject's evaluated bounds.
fn centre(scene: &Scene, subject: &[String]) -> Option<[f64; 3]> {
    let pts: Vec<[f64; 3]> = scene
        .layers
        .iter()
        .flat_map(|l| &l.solids)
        .filter(|s| subject.iter().any(|k| scene::is_of(&s.id, k)))
        .flat_map(|s| s.points())
        .collect();
    let first = *pts.first()?;
    let (lo, hi) = pts.iter().fold((first, first), |(lo, hi), p| {
        (
            [0, 1, 2].map(|k| lo[k].min(p[k])),
            [0, 1, 2].map(|k| hi[k].max(p[k])),
        )
    });
    Some([0, 1, 2].map(|k| (lo[k] + hi[k]) / 2.0))
}

pub fn report(lowered: &Value, input: &Value, frames: &[Frame]) -> Report {
    let mut out = Report::default();
    // No frame drawn is never a pass.
    if frames.is_empty() {
        out.blocked.push(blocked("not_drawn", KIND, &[], "frames"));
        return out;
    }
    let limits = Limits::of(input);
    let subject = match scene::kept(lowered, input, "subject", KIND) {
        Ok(s) => s,
        Err(b) => {
            out.blocked.push(b);
            return out;
        }
    };
    let camera = scene::camera_of(lowered).map(|(id, _)| id);
    let mut failed = false;
    for f in frames {
        if !pixels::whole(f) {
            out.blocked.push(blocked("not_drawn", KIND, &[], "frames"));
            return out;
        }
        let picks = pixels::picks_of(&f.picks, &subject);
        let at = |exposure: f64| measure(f, &query(Some(picks.clone()), exposure));
        let Some(r) = at(f.exposure) else {
            out.blocked.push(blocked("subject_unseen", KIND, &subject, "subject"));
            return out;
        };
        let ok = limits.passes(&r);
        out.results.push(json!({
            "t": f.t, "subject": subject, "px": r.px, "clipped": r.clipped, "crushed": r.crushed,
            "key_ev": r.key_ev, "exposure": f.exposure, "pass": ok,
        }));
        if ok || failed {
            continue;
        }
        failed = true;
        // The exposure at EV100 e is a scale of 1 ÷ (1.2 × 2^e).
        let round = |ev: f64| (ev * 100.0).round() / 100.0;
        let now = log2(1.0 / (1.2 * f.exposure));
        // The incident meter's: middle grey under the light falling on the subject shows as
        // middle grey. Where the subject's light is its own (unlit, or emitting), no light falls
        // on it to meter, and the reading is the subject's own, its key brought to middle grey.
        let incident = scene::evaluate(lowered, input, f.t, KIND).ok().and_then(|s| {
            let e = incident(&s, centre(&s, &subject)?);
            (e > 0.0).then(|| (round(log2(e / (1.2 * std::f64::consts::PI))), "the light falling on it"))
        });
        let reflected = (round(now + r.key_ev), "its own light");
        // Named as ops only when the frame, exposed at that EV, reads inside the limits.
        let cures = |ev: f64| at(exposure_scale(ev)).is_some_and(|r| limits.passes(&r));
        let metered = incident
            .into_iter()
            .chain([reflected])
            .find(|(ev, _)| cures(*ev));
        let fault = format!(
            "the subject reads {:.3} clipped, {:.3} crushed and key {:+.2} EV",
            r.clipped, r.crushed, r.key_ev
        );
        let what = match metered {
            Some((ev, from)) => format!(
                "{fault}: {} exposure {:.2} EV, to EV100 {ev:.2}, from {from}",
                if ev > now { "lower" } else { "raise" },
                (ev - now).abs()
            ),
            None => fault,
        };
        let id = camera.clone().unwrap_or_default();
        let path = format!("items/{id}/params/exposure");
        let fix_ops = metered
            .filter(|_| camera.is_some())
            .map(|(ev, _)| vec![json!({"op": "set", "id": id, "path": path, "value": ev})]);
        let raised = Raised {
            code: CODE,
            severity: "error",
            path: path.clone(),
            what,
            fix_ops,
        };
        let actual = json!({"t": f.t, "subject": subject, "clipped": r.clipped,
                            "crushed": r.crushed, "key_ev": r.key_ev, "ev100": now,
                            "metered": metered.map(|(ev, _)| ev)});
        out.raised.push((subject[0].clone(), raised, actual));
    }
    out
}

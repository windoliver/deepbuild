//! `render.contrast` (#1938; canvas primitives: Check input: loop kinds): each text the frame
//! draws read against the ground around it, by WCAG's ratio of relative luminances, and the
//! kept subject against what surrounds it, both from the frame as drawn through the object-ID
//! pass. A text's fix is a role of the look that reaches the minimum on that ground.

use deep_canvas::registry::{Frame, Raised, Report};
use serde_json::{json, Value};

use crate::pixels::{self, encoded_luminance, ratio};
use crate::scene::{self, blocked};

pub const KIND: &str = "render.contrast";
pub const CODE: &str = "loop.contrast";

/// The redraft's wrong program (#1938): text held to 3:1 instead of `min`.
pub const PLANTED_MIN_3: &str = "contrast_min_3";

/// The text kinds: a page's and a scene's.
pub const TEXT_2D: &str = "text@1";
const TEXT_3D: &str = "mark.text@1";

/// One text's reading: its ink's ratio against the median ground about it.
struct Text {
    ratio: f64,
    ground: f64,
}

/// The ratio of the text `item`'s ink px against the ground about them: the px of its box grown
/// by 2 that neither draw it nor touch a px that does. The ink reads at its px farthest from the
/// ground, since a glyph's edge px blend toward it. `None` when it draws no px or has no ground.
fn read_text(f: &Frame, item: &str) -> Option<Text> {
    let ink = pixels::mask(f, &[item.to_string()]);
    let w = f.size[0] as usize;
    let h = f.size[1] as usize;
    let [x0, y0, x1, y1] = pixels::bounds(&ink, w)?;
    let near = |x: usize, y: usize| {
        let at = |x: usize, y: usize| ink[y * w + x];
        at(x, y)
            || (x > 0 && at(x - 1, y))
            || (x + 1 < w && at(x + 1, y))
            || (y > 0 && at(x, y - 1))
            || (y + 1 < h && at(x, y + 1))
    };
    let mut ground: Vec<f64> = Vec::new();
    for y in y0.saturating_sub(2)..=(y1 + 2).min(h - 1) {
        for x in x0.saturating_sub(2)..=(x1 + 2).min(w - 1) {
            if !near(x, y) {
                ground.push(encoded_luminance(pixels::shown(f, y * w + x)));
            }
        }
    }
    if ground.is_empty() {
        return None;
    }
    let g = pixels::median(&mut ground);
    let best = ink
        .iter()
        .enumerate()
        .filter(|(_, m)| **m)
        .map(|(i, _)| ratio(encoded_luminance(pixels::shown(f, i)), g))
        .fold(1.0, f64::max);
    Some(Text {
        ratio: best,
        ground: g,
    })
}

/// The kept subject's mean luminance against its surround's: the px of its box grown by half
/// that don't draw it.
fn read_subject(f: &Frame, subject: &[String]) -> Option<f64> {
    let mask = pixels::mask(f, subject);
    let w = f.size[0] as usize;
    let h = f.size[1] as usize;
    let [x0, y0, x1, y1] = pixels::bounds(&mask, w)?;
    let (gx, gy) = ((x1 - x0) / 4 + 1, (y1 - y0) / 4 + 1);
    let (mut s, mut ns, mut r, mut nr) = (0.0, 0usize, 0.0, 0usize);
    for y in y0.saturating_sub(gy)..=(y1 + gy).min(h - 1) {
        for x in x0.saturating_sub(gx)..=(x1 + gx).min(w - 1) {
            let i = y * w + x;
            let l = encoded_luminance(pixels::shown(f, i));
            if mask[i] {
                (s, ns) = (s + l, ns + 1);
            } else {
                (r, nr) = (r + l, nr + 1);
            }
        }
    }
    (ns > 0 && nr > 0).then(|| ratio(s / ns as f64, r / nr as f64))
}

/// The look's role a text set to it reads at least `min` against `ground` in: `ink` when it
/// does, else the role that reads highest.
fn role_for(f: &Frame, ground: f64, min: f64) -> Option<(String, f64)> {
    let of = |role: &str| f.roles.get(role).map(|c| ratio(encoded_luminance(*c), ground));
    if let Some(r) = of("ink").filter(|r| *r >= min) {
        return Some(("ink".into(), r));
    }
    f.roles
        .keys()
        .filter_map(|role| Some((role.clone(), of(role)?)))
        .filter(|(_, r)| *r >= min)
        .max_by(|a, b| a.1.total_cmp(&b.1))
}

pub fn report(lowered: &Value, input: &Value, frames: &[Frame]) -> Report {
    let mut out = Report::default();
    if frames.is_empty() {
        out.blocked.push(blocked("not_drawn", KIND, &[], "frames"));
        return out;
    }
    if input.get("text").is_some_and(|t| t != "wcag") {
        // APCA's lightness contrast isn't built: unrun, never passed.
        out.blocked.push(blocked("not_run", KIND, &[], "text"));
        return out;
    }
    // A brief may only tighten the design's numbers; the planted `contrast_min_3` holds text
    // to 3:1.
    let min = if input.get("planted").and_then(Value::as_str) == Some(PLANTED_MIN_3) {
        3.0
    } else {
        crate::number(input, "/min", 4.5).max(4.5)
    };
    let subject_min = crate::number(input, "/subject_ratio", 1.5).max(1.5);
    let subject = scene::kept(lowered, input, "subject", KIND).ok();
    let mut done: Vec<String> = Vec::new();
    for f in frames {
        if !pixels::whole(f) {
            out.blocked.push(blocked("not_drawn", KIND, &[], "frames"));
            return out;
        }
        // Every text the document holds, 2D and 3D.
        let texts: Vec<String> = lowered
            .get("items")
            .and_then(Value::as_object)
            .into_iter()
            .flatten()
            .filter(|(_, i)| {
                matches!(
                    i.get("kind").and_then(Value::as_str),
                    Some(TEXT_2D | TEXT_3D)
                )
            })
            .map(|(id, _)| id.clone())
            .collect();
        let read: Vec<(String, Text)> = texts
            .iter()
            .filter_map(|id| Some((id.clone(), read_text(f, id)?)))
            .collect();
        let subject_read = subject.as_ref().and_then(|s| read_subject(f, s));
        if read.is_empty() && subject_read.is_none() {
            out.blocked.push(blocked("no_subject", KIND, &texts, "text"));
            return out;
        }
        for (id, t) in &read {
            let ok = t.ratio >= min;
            out.results.push(json!({"t": f.t, "item": id, "ratio": t.ratio, "ground": t.ground,
                                    "min": min, "pass": ok}));
            if ok || done.contains(id) {
                continue;
            }
            done.push(id.clone());
            let path = format!("items/{id}/params/paint/fill/role");
            let role = role_for(f, t.ground, min);
            let what = match &role {
                Some((r, to)) => format!(
                    "the text reads {:.2}:1 on its ground, under {min}:1: set its fill to `{r}`, which reads {to:.2}:1",
                    t.ratio
                ),
                None => format!(
                    "the text reads {:.2}:1 on its ground, under {min}:1, and no role of the look reaches it there",
                    t.ratio
                ),
            };
            let raised = Raised {
                code: CODE,
                severity: "error",
                path: path.clone(),
                what,
                fix_ops: role.as_ref().map(|(r, _)| {
                    vec![json!({"op": "set", "id": id, "path": path, "value": r})]
                }),
            };
            let actual = json!({"t": f.t, "ratio": t.ratio, "ground": t.ground, "min": min,
                                "role": role.map(|(r, _)| r)});
            out.raised.push((id.clone(), raised, actual));
        }
        if let (Some(r), Some(s)) = (subject_read, subject.as_ref()) {
            let ok = r >= subject_min;
            out.results.push(json!({"t": f.t, "subject": s, "ratio": r, "min": subject_min, "pass": ok}));
            if !ok && !done.contains(&s[0]) {
                done.push(s[0].clone());
                let raised = Raised {
                    code: CODE,
                    severity: "error",
                    path: format!("items/{}", s[0]),
                    what: format!(
                        "the subject reads {r:.2}:1 against what surrounds it, under {subject_min}:1"
                    ),
                    fix_ops: None,
                };
                out.raised.push((s[0].clone(), raised, json!({"t": f.t, "ratio": r, "min": subject_min})));
            }
        }
    }
    out
}

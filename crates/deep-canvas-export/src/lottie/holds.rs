//! What Lottie 1.0.1 can't hold, item by item (Export: Lottie): each is listed in the receipt's
//! warnings as `lottie.cant_hold`, naming the item and what, never dropped silently.

use serde_json::{Map, Value};

use super::Warning;

/// The item kinds the writer draws: 2D items, groups, masks, mattes and text as glyph outlines.
pub const DRAWN: [&str; 4] = ["rect@1", "circle@1", "path@1", "star@1"];
pub const HELD: [&str; 6] = [
    "group@1", "mask@1", "matte@1", "text@1", "image@1", "frame@1",
];

/// Lottie's blend modes by our name: its sixteen (0 to 15) and add (16), and hard mix (17).
pub fn blend_mode(name: &str) -> Option<u8> {
    const NAMES: [&str; 18] = [
        "normal",
        "multiply",
        "screen",
        "overlay",
        "darken",
        "lighten",
        "color_dodge",
        "color_burn",
        "hard_light",
        "soft_light",
        "difference",
        "exclusion",
        "hue",
        "saturation",
        "color",
        "luminosity",
        "add",
        "hard_mix",
    ];
    NAMES.iter().position(|n| *n == name).map(|i| i as u8)
}

fn cant(item: &str, what: String, path: String) -> Warning {
    Warning::cant_hold(item, what, path)
}

/// Every item and document part the writer can't hold, listed once per item and what.
pub fn listed(doc: &Map<String, Value>, items: &Map<String, Value>) -> Vec<Warning> {
    let mut out = Vec::new();
    // Sound: strips, emitters, sounds, buses and their processors.
    for key in ["strips", "emitters", "sounds", "buses", "spawns"] {
        if let Some(Value::Object(m)) = doc.get(key) {
            for id in m.keys() {
                out.push(cant(
                    id,
                    format!("sound: Lottie holds no {}", key.trim_end_matches('s')),
                    format!("{key}/{id}"),
                ));
            }
        }
    }
    // A drawn look draws every mark through its drawn pass.
    if super::pointer(doc, "/look/drawn").is_some_and(|v| !v.is_null()) {
        out.push(cant(
            "look",
            "a drawn look: Lottie draws no drawn pass".into(),
            "look/drawn".into(),
        ));
    }
    for (id, item) in items {
        if item.get("visible") == Some(&Value::Bool(false)) {
            continue;
        }
        let kind = item.get("kind").and_then(Value::as_str).unwrap_or("");
        let base = format!("items/{id}");
        // A composed pass draws nothing itself: the group that runs it is listed, naming it.
        if kind.ends_with(".pass@1") || kind == "pass@1" {
            continue;
        }
        if kind == "camera@1" {
            if !frames_document(doc, items, id) {
                out.push(cant(
                    id,
                    "a camera that moves, turns or zooms: Lottie draws the frame as it is".into(),
                    format!("{base}/params"),
                ));
            }
            continue;
        }
        if !DRAWN.contains(&kind) && !HELD.contains(&kind) {
            let what = if kind.starts_with("mark.")
                || kind.starts_with("mesh")
                || kind.starts_with("instance")
            {
                format!("3D: a {kind} item; Lottie holds 2D shapes, groups and glyph outlines only")
            } else {
                format!("a {kind} item: Lottie holds 2D shapes, groups and glyph outlines only")
            };
            out.push(cant(id, what, format!("{base}/kind")));
            continue;
        }
        let p = item.get("params").and_then(Value::as_object);
        let Some(p) = p else { continue };
        // 3D: a turn about x or y, or a depth.
        if let Some(at) = item.get("at") {
            let rot = at.get("rot").and_then(Value::as_array);
            let tilted = rot.is_some_and(|r| {
                r.len() >= 2 && r[..2].iter().any(|v| v.as_f64().unwrap_or(0.0) != 0.0)
            });
            if tilted {
                out.push(cant(
                    id,
                    "3D: a turn about x or y".into(),
                    format!("{base}/at/rot"),
                ));
            }
        }
        // Passes and backdrops on a group; operators anywhere.
        if let Some(passes) = p
            .get("passes")
            .and_then(Value::as_array)
            .filter(|a| !a.is_empty())
        {
            let ops: Vec<String> = passes
                .iter()
                .map(|x| {
                    let op = x.get("op").and_then(Value::as_str).unwrap_or("pass");
                    // A pass named by a composed pass item names that item's kind too.
                    match items
                        .get(op)
                        .and_then(|i| i.get("kind"))
                        .and_then(Value::as_str)
                    {
                        Some(k) => format!("{op} ({k}, the {op}@1 pass)"),
                        None => op.to_string(),
                    }
                })
                .collect();
            out.push(cant(
                id,
                format!("passes: {}; Lottie draws no pass", ops.join(", ")),
                format!("{base}/params/passes"),
            ));
        }
        if p.get("backdrop")
            .is_some_and(|v| !v.is_null() && v != &Value::Bool(false))
        {
            out.push(cant(
                id,
                "a backdrop pass: Lottie draws no pass".into(),
                format!("{base}/params/backdrop"),
            ));
        }
        if p.get("operators").is_some() {
            out.push(cant(
                id,
                "operators: Lottie holds no operator".into(),
                format!("{base}/params/operators"),
            ));
        }
        if p.get("inset").is_some() || p.get("insets").is_some() {
            out.push(cant(
                id,
                "an inset: Lottie holds no inset".into(),
                format!("{base}/params/inset"),
            ));
        }
        if let Some(b) = p.get("blend").and_then(Value::as_str) {
            if blend_mode(b).is_none() {
                out.push(cant(
                    id,
                    format!("blend mode {b}: past Lottie's sixteen and add"),
                    format!("{base}/params/blend"),
                ));
            }
        }
        match kind {
            "mask@1" => mask(id, p, &base, &mut out),
            "matte@1" => {
                let luma = matches!(
                    p.get("mode").and_then(Value::as_str),
                    Some("luma" | "luma_inverted")
                );
                if luma && p.get("luma").and_then(Value::as_str) != Some("encoded") {
                    out.push(cant(id, "a luma matte taken in linear light: Lottie players take luma on encoded values".into(), format!("{base}/params/luma")));
                }
                if p.get("resolution")
                    .and_then(Value::as_str)
                    .is_some_and(|r| r != "full")
                {
                    out.push(cant(
                        id,
                        "a half-resolution matte".into(),
                        format!("{base}/params/resolution"),
                    ));
                }
            }
            _ => {}
        }
        if let Some(Value::Object(paint)) = p.get("paint") {
            paints(id, paint, &format!("{base}/params/paint"), &mut out);
        }
        for (k, h) in p
            .get("halo")
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
            .enumerate()
        {
            if h.get("blur").and_then(Value::as_f64).unwrap_or(0.0) > 0.0 {
                out.push(cant(
                    id,
                    "a blurred halo: Lottie draws no blur".into(),
                    format!("{base}/params/halo/{k}/blur"),
                ));
            }
        }
    }
    out
}

fn mask(id: &str, p: &Map<String, Value>, base: &str, out: &mut Vec<Warning>) {
    if p.get("combine").and_then(Value::as_str) == Some("difference") {
        out.push(cant(
            id,
            "a difference mask".into(),
            format!("{base}/params/combine"),
        ));
    }
    if p.get("feather").and_then(Value::as_f64).unwrap_or(0.0) != 0.0 {
        out.push(cant(
            id,
            "a feathered mask".into(),
            format!("{base}/params/feather"),
        ));
    }
    if p.get("expand").and_then(Value::as_f64).unwrap_or(0.0) != 0.0 {
        out.push(cant(
            id,
            "an expanded mask".into(),
            format!("{base}/params/expand"),
        ));
    }
    if matches!(
        p.get("mode").and_then(Value::as_str),
        Some("alpha" | "luminance")
    ) {
        out.push(cant(
            id,
            "a mask that takes coverage from its paint".into(),
            format!("{base}/params/mode"),
        ));
    }
}

fn paints(id: &str, paint: &Map<String, Value>, at: &str, out: &mut Vec<Warning>) {
    for (key, what) in [("glow", "a glow"), ("bevel", "a bevel"), ("satin", "satin")] {
        if paint.get(key).is_some_and(|v| !v.is_null()) {
            out.push(cant(
                id,
                format!("{what}: Lottie draws no blur or lighting"),
                format!("{at}/{key}"),
            ));
        }
    }
    if let Some(s) = paint.get("shade").and_then(Value::as_object) {
        let what = if s.get("kind").and_then(Value::as_str) == Some("inner") {
            "an inner shade"
        } else {
            "a shade"
        };
        out.push(cant(
            id,
            format!("{what}: Lottie draws no lighting"),
            format!("{at}/shade"),
        ));
    }
    if let Some(d) = paint.get("drop").and_then(Value::as_object) {
        if d.get("blur").and_then(Value::as_f64).unwrap_or(0.0) > 0.0 {
            out.push(cant(
                id,
                "a blurred drop: Lottie draws no blur".into(),
                format!("{at}/drop/blur"),
            ));
        }
    }
    for slot in ["fill", "stroke"] {
        let Some(Value::Object(s)) = paint.get(slot) else {
            continue;
        };
        if s.contains_key("noise") || s.contains_key("dither") {
            out.push(cant(
                id,
                format!("a noise {slot}: Lottie fills with colors and gradients only"),
                format!("{at}/{slot}"),
            ));
        }
        if let Some(g) = s.get("gradient").and_then(Value::as_object) {
            let kind = g.get("kind").and_then(Value::as_str).unwrap_or("linear");
            if !matches!(kind, "linear" | "radial") {
                out.push(cant(
                    id,
                    format!("a {kind} gradient: Lottie has linear and radial"),
                    format!("{at}/{slot}/gradient"),
                ));
            }
        }
        if s.contains_key("dash") {
            out.push(cant(
                id,
                format!(
                    "fitted dashes on a {slot}: Lottie's dashes don't fit a count to each sub-path"
                ),
                format!("{at}/{slot}/dash"),
            ));
        }
        for shape in ["taper", "wave"] {
            if s.contains_key(shape) {
                out.push(cant(
                    id,
                    format!("a stroke {shape}: Lottie strokes have one width"),
                    format!("{at}/{slot}/{shape}"),
                ));
            }
        }
    }
}

/// Whether a camera only frames the document: orthographic, aimed at its centre, as wide as it is,
/// unkeyed, so the file's frame is what it shows.
fn frames_document(doc: &Map<String, Value>, items: &Map<String, Value>, id: &str) -> bool {
    let Some(p) = items.get(id).and_then(|c| c.get("params")) else {
        return false;
    };
    let size: Vec<f64> = doc
        .get("size")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(Value::as_f64)
        .collect();
    let [w, h] = size[..] else { return false };
    let target: Vec<f64> = p
        .get("target")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(Value::as_f64)
        .collect();
    let keyed = doc
        .get("channels")
        .and_then(Value::as_object)
        .is_some_and(|c| {
            c.values().any(|ch| {
                ch.get("target")
                    .and_then(Value::as_str)
                    .is_some_and(|t| t.starts_with(&format!("items/{id}/")))
            })
        });
    p.get("projection")
        .and_then(Value::as_str)
        .is_none_or(|x| x == "orthographic")
        && target.len() >= 2
        && (target[0] - w / 2.0).abs() < 1e-9
        && (target[1] - h / 2.0).abs() < 1e-9
        && p.get("view_width")
            .and_then(Value::as_f64)
            .is_none_or(|v| (v - w).abs() < 1e-9)
        && !keyed
}

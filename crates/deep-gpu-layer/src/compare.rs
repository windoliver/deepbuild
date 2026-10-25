//! The image comparison the parity fixtures make (README: The image comparison), with the one
//! blank guard before it, and dark declarations: yours recorded once with the frame's hash, an
//! agent's refused.

use deep_gpu::guard::{self, Blocked, By, Side};
use serde_json::{json, Value};

use crate::frames::hex;
use crate::{refused, App};

/// RGBA pixels as the guard reads them: BGRA, as a slot holds them.
fn bgra(rgba: &[u8]) -> Vec<u8> {
    let mut out = rgba.to_vec();
    for p in out.as_chunks_mut::<4>().0 {
        p.swap(0, 2);
    }
    out
}

/// Whether RGBA pixels are blank or black, as the blank guard reads them.
pub fn blank_rgba(rgba: &[u8]) -> bool {
    guard::is_blank(&bgra(rgba))
}

fn load(path: &str) -> Result<(image::RgbaImage, String), Value> {
    let bytes = std::fs::read(path).map_err(|e| refused("bad_input", format!("{path}: {e}")))?;
    let image = image::load_from_memory(&bytes)
        .map_err(|e| refused("bad_input", format!("{path}: {e}")))?
        .to_rgba8();
    Ok((image, hex(&bytes)))
}

/// The kept items an object-ID pass shows: each item whose ID color is in at least one pixel.
fn shown_items(call: &Value, kept: &[String]) -> Result<Vec<u32>, Value> {
    let ids = &call["ids"];
    let Some(png) = ids["png"].as_str() else {
        return Ok(Vec::new());
    };
    let (image, _) = load(png)?;
    let mut shown = Vec::new();
    for (i, name) in kept.iter().enumerate() {
        let Some(c) = ids["items"][name].as_array() else {
            continue;
        };
        let rgb: Vec<u8> = c.iter().map(|v| v.as_u64().unwrap_or(0) as u8).collect();
        if image.pixels().any(|p| p.0[..3] == rgb[..]) {
            shown.push(i as u32);
        }
    }
    Ok(shown)
}

/// Writes the guard's verdict: BLOCKED with no number in it.
fn blocked(why: &Blocked) -> Value {
    let blank: Vec<&str> = match why {
        Blocked::Blank { side } | Blocked::MissingItem { side, .. } => vec![side],
        Blocked::BothBlank => vec!["a", "b"],
    };
    json!({"result": "BLOCKED", "reason": why.reason(), "blank": blank})
}

/// The guard, then the comparison: whether two images are equal within `tolerance`.
pub fn guarded(
    app: &App,
    fixture: &str,
    a: (&[u8], &str),
    b: (&[u8], &str),
    tolerance: u8,
    kept: &[u32],
    shown: &[u32],
) -> Value {
    let (ba, bb) = (bgra(a.0), bgra(b.0));
    let sides = [
        (
            "a",
            Side {
                bgra: &ba,
                hash: a.1,
                object_ids: Some(shown),
            },
        ),
        (
            "b",
            Side {
                bgra: &bb,
                hash: b.1,
                object_ids: Some(shown),
            },
        ),
    ];
    if let Err(why) = guard::check(fixture, sides, kept, &app.declarations) {
        return blocked(&why);
    }
    if a.0.len() != b.0.len() {
        return json!({"result": "FAIL", "max_diff": 255, "differing": a.0.len().max(b.0.len()) / 4});
    }
    let (mut max, mut differing) = (0u8, 0u64);
    for (p, q) in a.0.as_chunks::<4>().0.iter().zip(b.0.as_chunks::<4>().0) {
        let d = p
            .iter()
            .zip(q)
            .map(|(x, y)| x.abs_diff(*y))
            .max()
            .unwrap_or(0);
        max = max.max(d);
        differing += u64::from(d > tolerance);
    }
    json!({"result": if differing == 0 { "PASS" } else { "FAIL" }, "max_diff": max, "differing": differing})
}

pub fn compare(app: &mut App, call: &Value) -> Value {
    let (Some(fixture), Some(a), Some(b)) = (
        call["fixture"].as_str(),
        call["a"].as_str(),
        call["b"].as_str(),
    ) else {
        return refused("bad_input", "compare takes a fixture and two PNGs");
    };
    let kept: Vec<String> = call["ids"]["kept"]
        .as_array()
        .map(|k| {
            k.iter()
                .filter_map(|v| v.as_str().map(str::to_string))
                .collect()
        })
        .unwrap_or_default();
    let run = || -> Result<Value, Value> {
        let (ia, ha) = load(a)?;
        let (ib, hb) = load(b)?;
        let shown = shown_items(call, &kept)?;
        let kept: Vec<u32> = (0..kept.len() as u32).collect();
        let tolerance = call["tolerance"].as_u64().unwrap_or(0).min(255) as u8;
        Ok(guarded(
            app,
            fixture,
            (ia.as_raw(), &ha),
            (ib.as_raw(), &hb),
            tolerance,
            &kept,
            &shown,
        ))
    };
    run().unwrap_or_else(|e| e)
}

pub fn declare(app: &mut App, call: &Value) -> Value {
    let (Some(fixture), Some(frame)) = (call["fixture"].as_str(), call["frame"].as_str()) else {
        return refused("bad_input", "declare_dark takes a fixture and a frame hash");
    };
    // Who declares is the connection's: the scenario stands in for it with `via`.
    let by = match call["via"].as_str() {
        Some("you") => By::You,
        Some("agent") => By::Agent,
        _ => return refused("bad_input", "via is you or agent"),
    };
    match app.declarations.declare(fixture, frame, by) {
        Ok(()) => {
            app.dark.push((fixture.to_string(), frame.to_string()));
            json!({"outcome": "recorded"})
        }
        Err("already_recorded") => json!({"outcome": "already_recorded"}),
        Err(code) => json!({"outcome": "refused", "code": code}),
    }
}

pub fn decisions(app: &mut App) -> Value {
    let dark: Vec<Value> = app
        .dark
        .iter()
        .map(|(f, h)| json!({"fixture": f, "frame": h}))
        .collect();
    json!({"dark": dark})
}

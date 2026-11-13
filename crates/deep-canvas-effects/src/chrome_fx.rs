//! chrome-fx@1 (#1436; canvas primitives: Effect): the first-party pack of effects on the app's own
//! surfaces, `packs/chrome-fx-1.0.0`, read as data and held to the pack check. Each operator is a
//! pass graph from the public steps that reads its element's backdrop and draws it opaque, with
//! its params in order, a class (`quiet` may run in working views; `expressive` only where a look
//! or a panel you picked asks for it), an authored still pose, a measured cost, a fixture and a
//! planted twin. The pack's step functions are inlined before the operator check, so a graph
//! calls them by name and never carries code.
//!
//! The check runs each operator on the CPU interpreter: its fixture (its output on a fixed
//! backdrop at the fixture's pose, at the pixels the fixture names, within 2 of 255) and its
//! flash rate (the mean relative luminance of its output over 2 s, a flash being a pair of opposing
//! changes of 0.1 or more where the darker is under 0.8), at most 3 a second.

use std::collections::BTreeMap;

use serde_json::{json, Map, Value};

use crate::check::{read_and_check, Checked};
use crate::graph::{self, From, Functions, Issue, Ty};
use crate::interp::{self, Env, Image};

/// The 24 operators the pack ships, in the issue's order.
pub const NAMES: [&str; 24] = [
    "halo.soft",
    "halo.neon",
    "halo.aura",
    "pulse.breathe",
    "pulse.ripple",
    "pulse.radar",
    "shimmer",
    "sparkle",
    "edge.electric",
    "edge.plasma",
    "edge.flame",
    "fill.mesh",
    "fill.grain",
    "fill.liquid_metal",
    "fill.plastic",
    "fill.dither",
    "glass.frost",
    "glass.fluted",
    "glass.lens",
    "warp.haze",
    "warp.shock",
    "warp.chroma",
    "warp.crt",
    "text.glow",
];

/// The most flashes a second an operator may show.
pub const FLASH_LIMIT: u32 = 3;

/// Where an operator may run.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Class {
    /// In any view, working ones too.
    Quiet,
    /// Only where a look or a panel you picked asks for it.
    Expressive,
}

impl Class {
    pub fn name(self) -> &'static str {
        match self {
            Class::Quiet => "quiet",
            Class::Expressive => "expressive",
        }
    }
}

/// One operator of the pack, checked: what the app runs.
#[derive(Clone, Debug)]
pub struct Operator {
    pub name: String,
    pub class: Class,
    /// Its own params, in its order (the app's inputs, `time`, `seed`, the inks and floors, aren't).
    pub params: Vec<String>,
    /// The still pose: the params (and `time`) it holds under reduced motion and at rest.
    pub still: Map<String, Value>,
    /// Its measured cost at 960,000 covered px, in ms.
    pub cost_ms: f64,
    /// Its graph with the pack's functions inlined, as the check read it.
    pub graph: Value,
    pub checked: Checked,
}

impl Operator {
    /// Whether it moves with the effect clock.
    pub fn moves(&self) -> bool {
        self.checked.op.inputs.contains_key("time")
            && self.graph["steps"].to_string().contains("\"time\"")
    }

    /// Each param's unit, by name.
    pub fn unit(&self, param: &str) -> Option<&str> {
        self.graph["inputs"][param]["unit"].as_str()
    }
}

/// The pack's step functions.
pub fn functions(pack: &Value) -> Functions {
    pack["functions"]
        .as_object()
        .map(|o| o.iter().map(|(k, v)| (k.clone(), v.clone())).collect())
        .unwrap_or_default()
}

fn issue_text(issues: &[Issue]) -> String {
    issues
        .iter()
        .map(|i| i.to_json().to_string())
        .collect::<Vec<_>>()
        .join("; ")
}

/// Reads one entry of a pack's `operators` into what the app runs: its class, params, still pose,
/// cost and graph, under the whole operator check after the pack's functions are inlined. A
/// refusal is `{operator, code, …}`.
pub fn read_entry(name: &str, entry: &Value, functions: &Functions) -> Result<Operator, Value> {
    let refuse =
        |code: &str, detail: String| json!({"operator": name, "code": code, "detail": detail});
    let class = match entry["class"].as_str() {
        Some("quiet") => Class::Quiet,
        Some("expressive") => Class::Expressive,
        other => {
            return Err(refuse(
                "chrome_fx_class",
                format!("{name}'s class is quiet or expressive, not {other:?}"),
            ))
        }
    };
    let Some(still) = entry["still"].as_object() else {
        return Err(refuse(
            "chrome_fx_no_still",
            format!("{name} has no authored still pose, which it holds under reduced motion"),
        ));
    };
    let inlined = graph::inline_functions(&entry["graph"], functions, true)
        .map_err(|e| refuse("chrome_fx_graph", issue_text(&e)))?;
    let checked =
        read_and_check(&inlined).map_err(|e| refuse("chrome_fx_graph", issue_text(&e)))?;
    let params: Vec<String> = entry["params"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|p| p.as_str().map(String::from))
        .collect();
    for key in params.iter().chain(still.keys()) {
        if !checked.op.inputs.contains_key(key) {
            return Err(refuse(
                "chrome_fx_params",
                format!("{name} names {key}, which its graph has no input of"),
            ));
        }
    }
    Ok(Operator {
        name: name.into(),
        class,
        params,
        still: still.clone(),
        cost_ms: entry["cost"]["ms"].as_f64().unwrap_or(0.0),
        graph: inlined,
        checked,
    })
}

/// The operators of `pack`, the manifest the host ships (`packs/chrome-fx-1.0.0/pack.json`), in
/// the issue's order. The shipped pack passes its check (a test holds it to that), so a refusal
/// here is a build that shipped a broken pack.
pub fn library(pack: &Value) -> Vec<Operator> {
    let functions = functions(pack);
    NAMES
        .iter()
        .filter_map(|name| read_entry(name, &pack["operators"][*name], &functions).ok())
        .collect()
}

/// RFC 7386's merge patch: `patch` over `target`.
pub fn merge(target: &mut Value, patch: &Value) {
    match (target, patch) {
        (Value::Object(t), Value::Object(p)) => {
            for (k, v) in p {
                if v.is_null() {
                    t.remove(k);
                } else {
                    merge(t.entry(k.clone()).or_insert(Value::Null), v);
                }
            }
        }
        (t, p) => *t = p.clone(),
    }
}

/// The fixtures' backdrop: a gradient with a fine checker and a row of glyph-like marks in the
/// light ink composited over white, at `w` × `h`.
pub fn backdrop(w: u32, h: u32) -> Image {
    let mut img = Image::new(w, h);
    let ink = [0.25, 0.257, 0.273];
    for y in 0..h {
        for x in 0..w {
            let (fx, fy) = (f64::from(x) / f64::from(w), f64::from(y) / f64::from(h));
            let check = if (x / 4 + y / 4) % 2 == 0 {
                0.06
            } else {
                -0.06
            };
            let glyph = (h * 7 / 16..h * 9 / 16).contains(&y)
                && (w / 5..w * 4 / 5).contains(&x)
                && x % 3 != 2;
            img.px[(y * w + x) as usize] = if glyph {
                [ink[0], ink[1], ink[2], 1.0]
            } else {
                [
                    0.25 + 0.5 * fx + check,
                    0.35 + 0.3 * fy + check,
                    0.62 + check,
                    1.0,
                ]
            };
        }
    }
    img
}

/// The app's inputs at a fixture's pose: the effect clock at `at` and the fixtures' seed, the
/// clean look's light secondary and tertiary inks, and no floors, so a fixture sees the operator's
/// own pixels and not the keeper's.
fn app_inputs(at: f64) -> BTreeMap<String, Value> {
    BTreeMap::from([
        ("time".into(), json!(at)),
        ("seed".into(), json!(1436.0)),
        ("ink".into(), json!([0.106, 0.114, 0.133, 0.839])),
        ("floor".into(), json!(0.0)),
        ("ink2".into(), json!([0.106, 0.114, 0.133, 0.522])),
        ("floor2".into(), json!(0.0)),
    ])
}

/// The clean look's light ink floors, which the flash rate is measured under, as the app draws.
fn inks() -> [(String, Value); 2] {
    [("floor".into(), json!(4.5)), ("floor2".into(), json!(3.0))]
}

/// `op`'s output, as 8-bit values, at `size` with `params` (by name; pt params at `scale`).
fn render(
    op: &Operator,
    params: &BTreeMap<String, Value>,
    size: [u32; 2],
    scale: f64,
) -> Result<Vec<[u8; 4]>, String> {
    let mut named = params.clone();
    for (name, input) in &op.checked.op.inputs {
        if op.unit(name) == Some("pt") {
            if let (From::Param(_), Some(v)) =
                (&input.from, named.get(name).or(input.default.as_ref()))
            {
                if let Some(x) = v.as_f64() {
                    named.insert(name.clone(), json!(x * scale));
                }
            }
        }
    }
    let src = backdrop(size[0], size[1]);
    let env = Env {
        t: 0.0,
        seed: 0,
        clip: [0.0; 16],
        inverse_clip: [0.0; 16],
        eye: [0.0; 4],
        inputs: interp::inputs(&op.checked, &named, &BTreeMap::new()),
        textures: BTreeMap::from([("src".to_string(), &src)]),
        normals: [[0.0; 3]; 3],
    };
    let out = interp::pass(&op.checked, &env, size)?;
    Ok(out
        .px
        .iter()
        .map(|p| p.map(|v| (v.clamp(0.0, 1.0) * 255.0).round() as u8))
        .collect())
}

/// The fixture's pose: the app's inputs at its time, under its params.
fn fixture_params(entry: &Value, at_override: Option<f64>) -> BTreeMap<String, Value> {
    let fixture = &entry["fixture"];
    let at = at_override.unwrap_or_else(|| fixture["at"].as_f64().unwrap_or(0.0));
    let mut params = app_inputs(at);
    for (k, v) in fixture["params"].as_object().into_iter().flatten() {
        params.insert(k.clone(), v.clone());
    }
    params
}

/// Runs an operator's fixture: its output at the fixture's pose on the fixtures' backdrop, at each
/// pixel the fixture names, within 2 of 255. A fixture whose pixels all equal the backdrop's
/// can't fail, so it fails. On a failure, the detail names the pixels and what they were.
fn run_fixture(op: &Operator, entry: &Value) -> Result<(), String> {
    let fixture = &entry["fixture"];
    let size = fixture["size"]
        .as_array()
        .filter(|s| s.len() == 2)
        .and_then(|s| Some([s[0].as_u64()? as u32, s[1].as_u64()? as u32]))
        .ok_or("its fixture has no size")?;
    let out = render(op, &fixture_params(entry, None), size, 1.0)?;
    let src = backdrop(size[0], size[1]);
    let byte = |v: f64| (v.clamp(0.0, 1.0) * 255.0).round() as i32;
    let at = |x: u32, y: u32| (y * size[0] + x) as usize;
    let expect: Vec<(u32, u32, [i32; 3])> = fixture["expect"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|e| {
            let e = e.as_array()?;
            let c = e.get(2)?.as_array()?;
            Some((
                e.first()?.as_u64()? as u32,
                e.get(1)?.as_u64()? as u32,
                [
                    c.first()?.as_i64()? as i32,
                    c.get(1)?.as_i64()? as i32,
                    c.get(2)?.as_i64()? as i32,
                ],
            ))
        })
        .filter(|(x, y, _)| *x < size[0] && *y < size[1])
        .collect();
    let mut wrong = Vec::new();
    let mut moved = false;
    for (x, y, want) in &expect {
        let got = out[at(*x, *y)];
        let under = src.px[at(*x, *y)];
        moved |= (0..3).any(|i| (want[i] - byte(under[i])).abs() >= 6);
        if (0..3).any(|i| (i32::from(got[i]) - want[i]).abs() > 2) {
            wrong.push(format!("({x}, {y}) is {:?}, not {want:?}", &got[..3]));
        }
    }
    if expect.is_empty() || !moved {
        // What it would expect: the pixels it changes most, and the corners.
        let mut by_change: Vec<(i32, u32, u32)> = (0..size[1])
            .flat_map(|y| (0..size[0]).map(move |x| (x, y)))
            .map(|(x, y)| {
                let (o, u) = (out[at(x, y)], src.px[at(x, y)]);
                (
                    (0..3).map(|i| (i32::from(o[i]) - byte(u[i])).abs()).sum(),
                    x,
                    y,
                )
            })
            .collect();
        by_change.sort_by(|a, b| b.0.cmp(&a.0).then((a.1, a.2).cmp(&(b.1, b.2))));
        let mut pick: Vec<(u32, u32)> = by_change.iter().take(6).map(|c| (c.1, c.2)).collect();
        pick.extend([(1, 1), (size[0] - 2, size[1] - 2)]);
        let suggested: Vec<Value> = pick
            .iter()
            .map(|&(x, y)| json!([x, y, &out[at(x, y)][..3]]))
            .collect();
        return Err(format!(
            "its fixture names no pixel the operator changes; its output suggests {}",
            Value::Array(suggested)
        ));
    }
    if wrong.is_empty() {
        Ok(())
    } else {
        Err(format!("its fixture's pixels differ: {}", wrong.join(", ")))
    }
}

/// How many times a second `op` flashes over 2 s at its fixture's pose, on a third of its fixture
/// (its pt params at a third, so the shape is the same): the mean relative luminance of each frame
/// at 24 a second, a flash being two opposing changes of 0.1 or more of it, the darker under 0.8.
pub fn flash_rate(op: &Operator, entry: &Value) -> Result<f64, String> {
    const SECONDS: f64 = 2.0;
    const RATE: f64 = 24.0;
    let size = [16, 11];
    let lin = |v: u8| {
        let c = f64::from(v) / 255.0;
        if c <= 0.04045 {
            c / 12.92
        } else {
            ((c + 0.055) / 1.055).powf(2.4)
        }
    };
    // Nothing that never reads the clock can flash.
    if !op.moves() {
        return Ok(0.0);
    }
    let mut series = Vec::new();
    for k in 0..(SECONDS * RATE) as usize {
        let at = k as f64 / RATE;
        let mut params = fixture_params(entry, Some(at));
        params.extend(inks());
        let out = render(op, &params, size, 1.0 / 3.0)?;
        let mean = out
            .iter()
            .map(|p| 0.2126 * lin(p[0]) + 0.7152 * lin(p[1]) + 0.0722 * lin(p[2]))
            .sum::<f64>()
            / out.len() as f64;
        series.push(mean);
    }
    Ok(flashes_per_second(&series, RATE))
}

/// The most flashes in any one second of a series of mean luminances sampled `rate` times a
/// second: a change is a rise or fall of 0.1 or more from the extreme since the last change, with
/// the darker end under 0.8, and a flash is two of them (WCAG 2.x's general flash).
fn flashes_per_second(series: &[f64], rate: f64) -> f64 {
    let (mut lo, mut hi) = (series[0], series[0]);
    let mut rising: Option<bool> = None;
    let mut at = Vec::new();
    for (k, &l) in series.iter().enumerate().skip(1) {
        lo = lo.min(l);
        hi = hi.max(l);
        if rising != Some(true) && l - lo >= 0.1 && lo < 0.8 {
            at.push(k as f64 / rate);
            (rising, lo, hi) = (Some(true), l, l);
        } else if rising != Some(false) && hi - l >= 0.1 && l < 0.8 {
            at.push(k as f64 / rate);
            (rising, lo, hi) = (Some(false), l, l);
        }
    }
    let most = (0..at.len())
        .map(|i| at[i..].iter().take_while(|t| **t < at[i] + 1.0).count())
        .max()
        .unwrap_or(0);
    (most / 2) as f64
}

/// The pack check's report, as `check.json` gives it: every operator listed, and the refusals.
pub fn check_pack(pack: &Value) -> Value {
    let functions = functions(pack);
    let mut names: Vec<String> = NAMES.iter().map(|n| n.to_string()).collect();
    for name in pack["operators"]
        .as_object()
        .into_iter()
        .flatten()
        .map(|(k, _)| k)
    {
        if !names.contains(name) {
            names.push(name.clone());
        }
    }
    let mut listed = Vec::new();
    let mut refusals = Vec::new();
    for name in &names {
        let entry = &pack["operators"][name];
        if entry.is_null() {
            refusals.push(json!({"operator": name, "code": "chrome_fx_missing", "detail": format!("the pack has no {name}")}));
            continue;
        }
        let params: Vec<Value> = entry["params"]
            .as_array()
            .into_iter()
            .flatten()
            .filter_map(Value::as_str)
            .map(|p| {
                let input = &entry["graph"]["inputs"][p];
                json!({"name": p, "range": input["range"], "default": input["default"], "unit": input["unit"]})
            })
            .collect();
        let mut line = json!({
            "operator": name,
            "class": entry["class"],
            "params": params,
            "cost_ms": entry["cost"]["ms"],
            "still": entry["still"].is_object(),
            "fixture": "fail",
        });
        let op = match read_entry(name, entry, &functions) {
            Ok(op) => op,
            Err(refusal) => {
                refusals.push(refusal);
                listed.push(line);
                continue;
            }
        };
        if op.cost_ms.is_nan() || op.cost_ms <= 0.0 {
            refusals.push(json!({"operator": name, "code": "chrome_fx_cost", "detail": format!("{name} has no measured cost")}));
        }
        match run_fixture(&op, entry) {
            Ok(()) => line["fixture"] = json!("pass"),
            Err(why) => refusals
                .push(json!({"operator": name, "code": "chrome_fx_fixture_failed", "detail": why})),
        }
        match flash_rate(&op, entry) {
            Ok(rate) if rate > f64::from(FLASH_LIMIT) => refusals.push(json!({
                "operator": name, "code": "chrome_fx_flash_rate", "rate": rate, "limit": FLASH_LIMIT,
                "detail": format!("{name} flashes {rate} times a second, past {FLASH_LIMIT}"),
            })),
            Ok(_) => {}
            Err(why) => refusals.push(json!({"operator": name, "code": "chrome_fx_graph", "detail": why})),
        }
        listed.push(line);
    }
    json!({
        "pack": "chrome-fx@1",
        "pass": refusals.is_empty(),
        "operators": listed,
        "refusals": refusals,
    })
}

/// Swaps `name`'s graph for its planted twin, the pack's own (`operators.<name>.twin`, a merge
/// patch over its graph).
pub fn plant_twin(pack: &mut Value, name: &str) {
    let twin = pack["operators"][name]["twin"].clone();
    if let Some(graph) = pack["operators"]
        .get_mut(name)
        .and_then(|e| e.get_mut("graph"))
    {
        merge(graph, &twin);
    }
}

/// An operator's params as the app lays them out for the renderer: each of its graph's param
/// inputs, in name order, its lanes from what `given` names (a number, or a list for a vector),
/// else its default; pt params times `scale`. A value outside its range is refused, naming the
/// param.
pub fn lay_out(op: &Operator, given: &Map<String, Value>, scale: f64) -> Result<Vec<f32>, String> {
    let mut out = Vec::new();
    for (name, lanes, input) in layout(&op.checked) {
        let v = given.get(&name).or(input.default.as_ref()).cloned();
        let values: Vec<f64> = match v {
            Some(Value::Number(n)) if lanes == 1 => vec![n.as_f64().unwrap_or(0.0)],
            Some(Value::Array(a)) if a.len() == lanes => {
                a.iter().map(|x| x.as_f64().unwrap_or(f64::NAN)).collect()
            }
            other => {
                return Err(format!(
                    "{}'s {name} takes {lanes} number(s), not {other:?}",
                    op.name
                ))
            }
        };
        if let Some([lo, hi]) = input.range {
            if let Some(x) = values.iter().find(|x| !(lo..=hi).contains(*x)) {
                return Err(format!("{}'s {name} {x} is outside {lo} to {hi}", op.name));
            }
        }
        let k = if op.unit(&name) == Some("pt") {
            scale
        } else {
            1.0
        };
        out.extend(values.iter().map(|x| (x * k) as f32));
    }
    Ok(out)
}

/// A pack operator's param inputs: each by name, its lane count and its input, in name order.
pub fn layout(c: &Checked) -> Vec<(String, usize, graph::Input)> {
    c.op.inputs
        .values()
        .filter_map(|input| match (&input.from, &input.ty) {
            (From::Param(p), Ty::V(_, n)) => Some((p.clone(), *n as usize, input.clone())),
            _ => None,
        })
        .collect()
}

/// The named values the renderer's flat params stand for, as `lay_out` laid them out.
pub fn named(c: &Checked, flat: &[f32]) -> BTreeMap<String, Value> {
    let mut at = 0;
    let mut out = BTreeMap::new();
    for (name, lanes, _) in layout(c) {
        let vals = flat.get(at..at + lanes).unwrap_or(&[]);
        at += lanes;
        out.insert(
            name,
            if lanes == 1 {
                json!(vals.first().copied().unwrap_or(0.0))
            } else {
                json!(vals)
            },
        );
    }
    out
}

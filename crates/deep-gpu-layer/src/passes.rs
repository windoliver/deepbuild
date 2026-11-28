use std::collections::BTreeMap;
use std::sync::LazyLock;

use deep_gpu::device::Device;
use serde_json::{json, Value};

use crate::{refused, App, Planted};

mod burn;
mod depth_upload;
mod efficiency_marks;
mod fault_point;
mod fill;
mod gpu;
mod handoff_fixtures;
mod kit_fill;
mod kit_gpu_pass;
mod live_effects;
mod mips;
mod operator_emit;
mod operator_vertex;
mod particles_draw;
mod particles_kernel;
mod player_blit;
mod regions;
mod regions_bounds;
mod scene_pipeline;
mod spans_mark;
mod strokes;
mod structural_planted;
mod structural_stub;
mod test_gpu;
mod test_scene;
mod tick;

pub use gpu::Out;

pub const TOLERANCE: f64 = 2.0;
pub const WORST: usize = 16;
const PIXEL_ONE_CODE: &str = "pixel_one_code";
const PIXEL_THREE_CODES: &str = "pixel_three_codes";
const SKIPS_FIXTURE: &str = "skips_fixture";

struct Row {
    pass: String,
    file: String,
    fixture: String,
    twin: String,
}

static TABLE: LazyLock<Vec<Row>> = LazyLock::new(|| {
    let table: Value = serde_json::from_str(include_str!("../fixtures/passes.json"))
        .expect("fixtures/passes.json is the fixture table");
    let text = |row: &Value, key: &str| row[key].as_str().unwrap_or_default().to_string();
    table["passes"]
        .as_array()
        .map(|rows| {
            rows.iter()
                .map(|row| Row {
                    pass: text(row, "pass"),
                    file: text(row, "file"),
                    fixture: text(row, "fixture"),
                    twin: text(row, "twin"),
                })
                .collect()
        })
        .unwrap_or_default()
});

pub struct Ran {
    pub gpu: Out,
    pub cpu: Out,
}

type Run = fn(&Device, bool) -> Result<Ran, String>;

macro_rules! registry {
    ($($name:literal => $run:path,)*) => {
        fn registered(pass: &str) -> Option<(Run, &'static str)> {
            match pass {
                $($name => Some(($run, include_str!(concat!("../fixtures/passes/", $name, ".json")))),)*
                _ => None,
            }
        }
    };
}

registry! {
    "fill" => fill::run,
    "mips" => mips::run,
    "structural_planted" => structural_planted::run,
    "strokes" => strokes::run,
    "particles_draw" => particles_draw::run,
    "particles_kernel" => particles_kernel::run,
    "depth_upload" => depth_upload::run,
    "structural_stub" => structural_stub::run,
    "tick" => tick::run,
    "burn" => burn::run,
    "regions" => regions::run,
    "regions_bounds" => regions_bounds::run,
    "live_effects" => live_effects::run,
    "test_scene" => test_scene::run,
    "test_gpu" => test_gpu::run,
    "scene_pipeline" => scene_pipeline::run,
    "fault_point" => fault_point::run,
    "handoff_fixtures" => handoff_fixtures::run,
    "operator_vertex" => operator_vertex::run,
    "operator_emit" => operator_emit::run,
    "efficiency_marks" => efficiency_marks::run,
    "kit_fill" => kit_fill::run,
    "kit_gpu_pass" => kit_gpu_pass::run,
    "spans_mark" => spans_mark::run,
    "player_blit" => player_blit::run,
}

pub fn planted_names() -> impl Iterator<Item = &'static str> {
    [PIXEL_ONE_CODE, PIXEL_THREE_CODES, SKIPS_FIXTURE]
        .into_iter()
        .chain(TABLE.iter().map(|r| r.twin.as_str()))
}

pub fn passes() -> Value {
    json!({"passes": TABLE.iter().map(|r| json!({
        "pass": r.pass, "file": r.file, "fixture": r.fixture, "twin": r.twin,
    })).collect::<Vec<_>>()})
}

struct Item {
    id: String,
    at: [u32; 4],
}

struct Probe {
    at: Vec<u32>,
    value: Vec<f64>,
}

struct Fixture {
    size: [u32; 2],
    channels: usize,
    items: Vec<Item>,
    expect: Vec<Probe>,
}

fn numbers<T>(v: &Value, what: &str, read: impl Fn(&Value) -> Option<T>) -> Result<Vec<T>, String> {
    v.as_array()
        .ok_or_else(|| format!("{what} is a list"))?
        .iter()
        .map(|n| read(n).ok_or_else(|| format!("{what} holds a number that doesn't fit")))
        .collect()
}

fn whole(n: &Value) -> Option<u32> {
    n.as_u64().and_then(|n| u32::try_from(n).ok())
}

fn read_fixture(text: &str) -> Result<Fixture, String> {
    let f: Value = serde_json::from_str(text).map_err(|e| e.to_string())?;
    let size: [u32; 2] = numbers(&f["size"], "size", whole)?
        .try_into()
        .map_err(|_| "size is [w, h]".to_string())?;
    let channels = f["channels"].as_u64().ok_or("channels is a count")? as usize;
    let items = f["items"]
        .as_array()
        .ok_or("items is a list")?
        .iter()
        .map(|i| {
            Ok(Item {
                id: i["id"].as_str().ok_or("an item has an id")?.to_string(),
                at: numbers(&i["at"], "an item's at", whole)?
                    .try_into()
                    .map_err(|_| "an item's at is [x, y, w, h]".to_string())?,
            })
        })
        .collect::<Result<_, String>>()?;
    let expect = f["expect"]
        .as_array()
        .ok_or("expect is a list")?
        .iter()
        .map(|p| {
            Ok(Probe {
                at: numbers(&p["at"], "a probe's at", whole)?,
                value: numbers(&p["value"], "a probe's value", Value::as_f64)?,
            })
        })
        .collect::<Result<_, String>>()?;
    Ok(Fixture {
        size,
        channels,
        items,
        expect,
    })
}

struct Expected {
    items: Vec<String>,
    item_at: Vec<Option<usize>>,
    value_at: BTreeMap<usize, Vec<f64>>,
    probes: Vec<usize>,
}

fn expected(f: &Fixture) -> Result<Expected, String> {
    let [w, h] = f.size;
    let mut item_at = vec![None; (w * h) as usize];
    let mut items = Vec::new();
    for item in &f.items {
        let k = items.iter().position(|i| *i == item.id).unwrap_or_else(|| {
            items.push(item.id.clone());
            items.len() - 1
        });
        let [x0, y0, iw, ih] = item.at;
        for y in y0..(y0 + ih).min(h) {
            for x in x0..(x0 + iw).min(w) {
                item_at[(y * w + x) as usize] = Some(k);
            }
        }
    }
    let mut value_at = BTreeMap::new();
    let mut probes = Vec::new();
    for p in &f.expect {
        if p.value.len() != f.channels {
            return Err(format!(
                "a probe at {:?} gives {} channels",
                p.at,
                p.value.len()
            ));
        }
        let [x0, y0, pw, ph] = match p.at[..] {
            [x, y] => [x, y, 1, 1],
            [x, y, pw, ph] => [x, y, pw, ph],
            _ => {
                return Err(format!(
                    "a probe's at is [x, y] or [x, y, w, h], not {:?}",
                    p.at
                ))
            }
        };
        for y in y0..y0 + ph {
            for x in x0..x0 + pw {
                if x >= w || y >= h {
                    return Err(format!("a probe at ({x}, {y}) is outside {w} × {h}"));
                }
                let i = (y * w + x) as usize;
                if value_at.insert(i, p.value.clone()).is_none() {
                    probes.push(i);
                }
            }
        }
    }
    if probes.is_empty() {
        return Err("the fixture writes no expected value by hand".into());
    }
    if let Some(i) = item_at.iter().position(Option::is_none) {
        return Err(format!(
            "pixel ({}, {}) is drawn by no item of the fixture",
            i as u32 % w,
            i as u32 / w
        ));
    }
    Ok(Expected {
        items,
        item_at,
        value_at,
        probes,
    })
}

struct Miss {
    at: usize,
    by: f64,
    expected: Vec<f64>,
    actual: Vec<f64>,
}

fn rounded(out: &Out, i: usize) -> Vec<f64> {
    out.codes[i * out.channels..(i + 1) * out.channels]
        .iter()
        .map(|c| c.round())
        .collect()
}

fn furthest(a: &[f64], b: &[f64]) -> f64 {
    a.iter()
        .zip(b)
        .map(|(x, y)| (x - y).abs())
        .fold(0.0, f64::max)
}

fn planted_pixel(gpu: &Out, cpu: &Out, e: &Expected) -> usize {
    e.probes
        .iter()
        .copied()
        .find(|&i| {
            let a = rounded(gpu, i);
            a == e.value_at[&i] && a == rounded(cpu, i)
        })
        .unwrap_or(e.probes[0])
}

fn plant(gpu: &mut Out, at: usize, by: f64) {
    let c = &mut gpu.codes[at * gpu.channels];
    let base = c.round();
    *c = if base + by > 255.0 {
        base - by
    } else {
        base + by
    };
}

pub fn fixture(app: &mut App, call: &Value) -> Value {
    let Some(pass) = call["pass"].as_str().map(String::from) else {
        return refused("bad_input", "pass_fixture names a pass");
    };
    let Some(row) = TABLE.iter().find(|r| r.pass == pass) else {
        return refused(
            "unknown_pass",
            format!("{pass} is not in the fixture table"),
        );
    };
    let Some((run, text)) = registered(&pass) else {
        return refused("unknown_pass", format!("{pass} has no runner in deep-gpu"));
    };
    let f = match read_fixture(text) {
        Ok(f) => f,
        Err(e) => return refused("bad_fixture", format!("{}: {e}", row.fixture)),
    };
    let e = match expected(&f) {
        Ok(e) => e,
        Err(why) => return refused("bad_fixture", format!("{}: {why}", row.fixture)),
    };
    let planted = match app.planted {
        Some(Planted::Named(n)) => Some(n),
        _ => None,
    };
    let twin = planted == Some(row.twin.as_str());
    let ran = app.worker.call(move |state| run(&state.gpu.device(), twin));
    let Ran { mut gpu, cpu } = match ran {
        Ok(r) => r,
        Err(why) => return refused("pass_failed", format!("{pass}: {why}")),
    };
    for (side, out) in [("gpu", &gpu), ("cpu", &cpu)] {
        if out.size != f.size || out.channels != f.channels {
            return refused(
                "bad_fixture",
                format!(
                    "{pass}: its {side} output is {:?} × {} channels, its fixture {:?} × {}",
                    out.size, out.channels, f.size, f.channels
                ),
            );
        }
    }
    match planted {
        Some(PIXEL_ONE_CODE) => {
            let at = planted_pixel(&gpu, &cpu, &e);
            plant(&mut gpu, at, 1.0);
        }
        Some(PIXEL_THREE_CODES) => {
            let at = planted_pixel(&gpu, &cpu, &e);
            plant(&mut gpu, at, 3.0);
        }
        _ => {}
    }
    let fixture_ran = planted != Some(SKIPS_FIXTURE);
    compare(&pass, &gpu, &cpu, &e, fixture_ran)
}

fn compare(pass: &str, gpu: &Out, cpu: &Out, e: &Expected, fixture_ran: bool) -> Value {
    let [w, h] = gpu.size;
    let mut misses = Vec::new();
    for i in 0..(w * h) as usize {
        let actual = rounded(gpu, i);
        let reference = rounded(cpu, i);
        let mut worst = (furthest(&actual, &reference), reference);
        if fixture_ran {
            if let Some(v) = e.value_at.get(&i) {
                let by = furthest(&actual, v);
                if by >= worst.0 {
                    worst = (by, v.clone());
                }
            }
        }
        if worst.0 > TOLERANCE {
            misses.push(Miss {
                at: i,
                by: worst.0,
                expected: worst.1,
                actual,
            });
        }
    }
    let reference_misses: Vec<Value> = e
        .probes
        .iter()
        .filter(|&&i| furthest(&rounded(cpu, i), &e.value_at[&i]) > TOLERANCE)
        .map(|&i| {
            json!({"x": i as u32 % w, "y": i as u32 / w,
                "expected": e.value_at[&i], "reference": rounded(cpu, i)})
        })
        .collect();
    misses.sort_by(|a, b| b.by.total_cmp(&a.by).then(a.at.cmp(&b.at)));
    let outliers = misses.len();
    let worst: Vec<Value> = misses
        .iter()
        .take(WORST)
        .map(|m| {
            json!({
                "item": e.item_at[m.at].map(|k| e.items[k].as_str()),
                "pass": pass,
                "x": m.at as u32 % w,
                "y": m.at as u32 / w,
                "expected": m.expected,
                "actual": m.actual,
            })
        })
        .collect();
    let result = if !fixture_ran {
        "reading"
    } else if outliers == 0 && reference_misses.is_empty() {
        "PASS"
    } else {
        "FAIL"
    };
    json!({
        "pass": pass,
        "result": result,
        "fixture_ran": fixture_ran,
        "items": e.items,
        "outliers": outliers,
        "worst": worst,
        "reference_misses": reference_misses,
        "tolerance": TOLERANCE,
    })
}

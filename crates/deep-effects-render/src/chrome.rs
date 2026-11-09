//! Issue #1434: the shipped operators the app's chrome effects run, as Metal source that naga
//! writes from the same checked WGSL the GPU layer runs, so chrome carries no shader text of its
//! own. Each graph is a full-screen pass under the binding contract GPUI's chrome renderer binds:
//! the frame at buffer 0, the operator's inputs at buffer 1, the core's one sampler at sampler 0
//! and its texture inputs, in the checked order, at textures 0... An effect's params lay out its
//! runs: which graph each pass runs, with which inputs, reading the backdrop or an earlier run.

use std::collections::BTreeMap;

use deep_canvas_effects::check::Checked;
use deep_canvas_effects::chrome_fx;
use deep_canvas_effects::interp;
use deep_canvas_effects::shipped::{frost, FROST_TAPS};
use serde_json::{json, Value};

use crate::compile::{compile, validate};

/// One graph of a chrome operator, written as Metal source.
#[derive(Clone, Debug)]
pub struct Graph {
    /// The shipped graph's id.
    pub label: String,
    pub checked: Checked,
    pub msl: String,
    pub vertex: String,
    pub fragment: String,
}

/// What a run's texture binding reads.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Input {
    Backdrop,
    /// An earlier run's output, by its index.
    Run(usize),
}

/// One pass of an effect: the graph it runs, its inputs buffer and its textures, in binding order.
#[derive(Clone, Debug)]
pub struct Run {
    pub graph: usize,
    pub inputs: Vec<u8>,
    pub textures: Vec<Input>,
}

/// A chrome operator: its graphs, ready for the renderer.
#[derive(Clone, Debug)]
pub struct Operator {
    pub name: &'static str,
    pub graphs: Vec<Graph>,
}

/// The shipped operators a chrome effect may name beside chrome-fx@1's (#1436), whose names are the pack's.
pub const OPERATORS: &[&str] = &["frost@1"];

/// A chrome operator, compiled and written as Metal source; `None` for a name that isn't one.
pub fn operator(name: &str) -> Option<Result<Operator, String>> {
    if let Some(name) = chrome_fx::NAMES.iter().find(|n| **n == name) {
        return Some(pack_operator(name).and_then(|op| {
            graph(&op.graph).map(|g| Operator {
                name,
                graphs: vec![g],
            })
        }));
    }
    let (name, graphs): (_, Vec<Value>) = match name {
        // Each tap count's horizontal part, then its vertical one.
        "frost@1" => (
            "frost@1",
            FROST_TAPS
                .iter()
                .flat_map(|&t| [frost("x", t), frost("y", t)])
                .collect(),
        ),
        _ => return None,
    };
    let graphs: Result<Vec<Graph>, String> = graphs.iter().map(graph).collect();
    Some(graphs.map(|graphs| Operator { name, graphs }))
}

/// An effect's params, as a fixture or a view gives them by name, in the operator's order:
/// frost@1 takes `sigma` (px of its backdrop, 0 to 32) and `tint` (premultiplied 8-bit RGBA).
pub fn params(name: &str, given: &Value) -> Result<Vec<f32>, String> {
    match name {
        "frost@1" => {
            let sigma = given["sigma"]
                .as_f64()
                .ok_or("frost@1 takes a number sigma")?;
            if !(0.0..=32.0).contains(&sigma) {
                return Err(format!("frost@1's sigma {sigma} is outside 0 to 32"));
            }
            let tint = given["tint"].as_array().filter(|t| t.len() == 4);
            let tint: Vec<f32> = tint
                .ok_or("frost@1 takes a tint of four 8-bit values")?
                .iter()
                .map(|v| v.as_f64().unwrap_or(0.0) as f32)
                .collect();
            Ok([vec![sigma as f32], tint].concat())
        }
        _ => Err(format!("{name} is not a chrome operator")),
    }
}

impl Operator {
    /// The runs an effect with `params` takes, in order; the last one's output is the effect's.
    pub fn plan(&self, params: &[f32]) -> Vec<Run> {
        if chrome_fx::NAMES.contains(&self.name) {
            let named = chrome_fx::named(&self.graphs[0].checked, params);
            let named: serde_json::Map<String, Value> = named.into_iter().collect();
            return vec![self.run(0, &Value::Object(named), |_| Input::Backdrop)];
        }
        let sigma = f64::from(params.first().copied().unwrap_or(0.0));
        let tint: Vec<f64> = (1..5)
            .map(|i| f64::from(params.get(i).copied().unwrap_or(0.0)) / 255.0)
            .collect();
        let reach = (3.0 * sigma).ceil();
        let falloff = if sigma > 0.0 {
            -1.0 / (2.0 * sigma * sigma)
        } else {
            0.0
        };
        let total: f64 = (-reach as i64..=reach as i64)
            .map(|k| ((k * k) as f64 * falloff).exp())
            .sum();
        let width = 2 * reach as u32 + 1;
        let longest = FROST_TAPS.len() - 1;
        let (taps, parts) = match FROST_TAPS.iter().position(|&t| t >= width) {
            Some(fits) => (fits, 1),
            None => (longest, width.div_ceil(FROST_TAPS[longest]) as usize),
        };
        let mut runs = Vec::new();
        for axis in 0..2 {
            let src = if axis == 0 {
                Input::Backdrop
            } else {
                Input::Run(parts - 1)
            };
            for part in 0..parts {
                let acc = if part == 0 {
                    src
                } else {
                    Input::Run(runs.len() - 1)
                };
                let values = json!({
                    "first": -reach + (part as f64) * f64::from(FROST_TAPS[taps]),
                    "reach": reach,
                    "falloff": falloff,
                    "total": total,
                    "keep": if part == 0 { 0.0 } else { 1.0 },
                    "tinted": if axis == 1 && part + 1 == parts { 1.0 } else { 0.0 },
                    "tint": tint,
                });
                let graph = 2 * taps + axis;
                runs.push(self.run(graph, &values, |name| if name == "acc" { acc } else { src }));
            }
        }
        runs
    }

    fn run(&self, graph: usize, values: &Value, texture: impl Fn(&str) -> Input) -> Run {
        let checked = &self.graphs[graph].checked;
        let named: BTreeMap<String, Value> = values
            .as_object()
            .map(|o| o.iter().map(|(k, v)| (k.clone(), v.clone())).collect())
            .unwrap_or_default();
        let values = interp::inputs(checked, &named, &BTreeMap::new());
        Run {
            graph,
            inputs: deep_canvas_effects::emit::input_bytes(checked, &values),
            textures: checked.textures.iter().map(|name| texture(name)).collect(),
        }
    }
}

/// A chrome-fx@1 operator from the shipped pack.
fn pack_operator(name: &str) -> Result<chrome_fx::Operator, String> {
    let pack: Value = serde_json::from_str(chrome_fx::PACK).map_err(|e| e.to_string())?;
    chrome_fx::read_entry(name, &pack["operators"][name], &chrome_fx::functions(&pack))
        .map_err(|r| r.to_string())
}

fn graph(graph: &Value) -> Result<Graph, String> {
    let compiled = compile(graph).map_err(|issues| format!("{issues:?}"))?;
    let module = validate(&compiled.wgsl)?;
    let info = naga::valid::Validator::new(
        naga::valid::ValidationFlags::all(),
        naga::valid::Capabilities::empty(),
    )
    .validate(&module)
    .map_err(|e| e.emit_to_string(&compiled.wgsl))?;
    let checked = compiled.checked;
    let bind = |buffer: Option<u8>, texture: Option<u8>, sampler: Option<u8>| {
        naga::back::msl::BindTarget {
            buffer,
            texture,
            sampler: sampler.map(naga::back::msl::BindSamplerTarget::Resource),
            ..Default::default()
        }
    };
    let binding = |group, binding| naga::ResourceBinding { group, binding };
    let mut resources = naga::back::msl::EntryPointResources::default();
    resources
        .resources
        .insert(binding(0, 0), bind(Some(0), None, None));
    resources
        .resources
        .insert(binding(1, 0), bind(Some(1), None, None));
    resources
        .resources
        .insert(binding(1, 1), bind(None, None, Some(0)));
    for slot in 0..checked.textures.len() {
        let target = bind(None, Some(slot as u8), None);
        resources
            .resources
            .insert(binding(1, 2 + slot as u32), target);
    }
    let mut map = naga::back::msl::EntryPointResourceMap::default();
    map.insert("fs".into(), resources);
    map.insert("vs".into(), naga::back::msl::EntryPointResources::default());
    let options = naga::back::msl::Options {
        lang_version: (2, 4),
        per_entry_point_map: map,
        fake_missing_bindings: false,
        ..Default::default()
    };
    let pipeline = naga::back::msl::PipelineOptions::default();
    let (msl, translation) = naga::back::msl::write_string(&module, &info, &options, &pipeline)
        .map_err(|e| format!("naga's Metal writer: {e}"))?;
    let name = |stage: naga::ShaderStage| -> Result<String, String> {
        let index = module
            .entry_points
            .iter()
            .position(|e| e.stage == stage)
            .ok_or("no entry point")?;
        translation.entry_point_names[index]
            .clone()
            .map_err(|e| format!("{e:?}"))
    };
    Ok(Graph {
        label: checked.op.id.clone(),
        vertex: name(naga::ShaderStage::Vertex)?,
        fragment: name(naga::ShaderStage::Fragment)?,
        msl,
        checked,
    })
}

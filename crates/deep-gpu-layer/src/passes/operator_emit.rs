use std::collections::BTreeMap;

use deep_canvas_effects::interp::{self, Env, Image};
use deep_effects_render::compile::{compile, Compiled};
use deep_effects_render::reference::{self, Camera};
use deep_gpu::device::Device;
use serde_json::{json, Value};

use super::gpu::{self, Out};
use super::Ran;

const IMAGE: [u32; 2] = [4, 2];
const ELEMENTS: u32 = 4;
const SIZE: [u32; 2] = [IMAGE[0], IMAGE[1] + 1];
const LEFT: [f64; 4] = [1.0, 0.5, 0.25, 1.0];
const RIGHT: [f64; 4] = [0.25, 0.75, 1.0, 1.0];
const IDENTITY: [f64; 16] = [
    1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 1.0,
];

fn scale_pass() -> Value {
    json!({
        "id": "pass_fixture.scale@1", "kind": "pass", "origin": "composed",
        "about": "The emitter's pass fixture: each pixel of the frame's color times 0.75.",
        "inputs": {"src": {"type": "texture", "from": {"texture": {"target": {"op": "core", "output": "color"}}}}},
        "steps": {
            "px": {"op": "pixel@1", "args": {}},
            "c": {"op": "load@1", "args": {"tex": "src", "ixy": "px"}},
            "out": {"op": "mul@1", "args": {"a": "c", "b": 0.75}},
        },
        "outputs": {"color": "out", "blend": "replace"},
        "cost": {"ns_per_px": 0.1}, "resolution": "full", "chain": "effects", "order": "a0",
    })
}

fn affine_compute() -> Value {
    json!({
        "id": "pass_fixture.affine@1", "kind": "compute", "origin": "composed",
        "about": "The emitter's compute fixture: element e writes 7e + 9.",
        "inputs": {},
        "steps": {
            "e": {"op": "element@1", "args": {}},
            "m": {"op": "mul@1", "args": {"a": "e", "b": 7}},
            "v": {"op": "add@1", "args": {"a": "m", "b": 9}},
            "w": {"op": "write@1", "args": {"buf": "out", "i": "e", "v": "v"}},
        },
        "outputs": {"out": {"storage": {"type": "u32", "count": ELEMENTS}}},
        "elements": ELEMENTS, "workgroup": 64, "cost": {"ns_per_element": 50.0},
    })
}

fn compiled(op: &Value) -> Result<Compiled, String> {
    compile(op).map_err(|issues| {
        let said: Vec<String> = issues.iter().map(|i| format!("{i:?}")).collect();
        format!("{} doesn't compile: {}", op["id"], said.join("; "))
    })
}

fn planted(c: &Compiled, twin: bool, from: &str, to: &str) -> Result<Compiled, String> {
    let mut out = c.clone();
    out.wgsl = gpu::twin(&c.wgsl, twin, from, to)?;
    Ok(out)
}

fn two_tone() -> Image {
    let mut img = Image::new(IMAGE[0], IMAGE[1]);
    for (i, px) in img.px.iter_mut().enumerate() {
        *px = if (i as u32 % IMAGE[0]) < IMAGE[0] / 2 {
            LEFT
        } else {
            RIGHT
        };
    }
    img
}

pub fn run(device: &Device, twin: bool) -> Result<Ran, String> {
    let pass = compiled(&scale_pass())?;
    let compute = compiled(&affine_compute())?;
    let gpu_pass = planted(&pass, twin, "f32(0.75)", "f32(0.5)")?;
    let gpu_compute = planted(&compute, twin, "u32(7i)", "u32(17i)")?;
    let camera = Camera {
        clip: IDENTITY,
        eye: [0.0; 3],
        near: 0.1,
        t: 0.0,
        seed: 0,
    };
    let images = BTreeMap::from([("src".to_string(), two_tone())]);
    let ran = reference::pass(
        device,
        &pass,
        &gpu_pass,
        &images,
        &BTreeMap::new(),
        &BTreeMap::new(),
        &camera,
        IMAGE,
    )?;
    let env = Env {
        t: 0.0,
        seed: 0,
        clip: IDENTITY,
        inverse_clip: IDENTITY,
        eye: [0.0; 4],
        inputs: interp::inputs(&compute.checked, &BTreeMap::new(), &BTreeMap::new()),
        textures: BTreeMap::new(),
        normals: [[0.0; 3]; 3],
    };
    let cpu_elements = interp::compute(&compute.checked, &env, BTreeMap::new())?
        .remove("out")
        .ok_or("the compute operator's reference wrote no out")?;
    let gpu_elements: Vec<f64> = deep_effects_render::runner::dispatch(device, &gpu_compute, &[])
        .into_iter()
        .map(f64::from)
        .collect();
    Ok(Ran {
        gpu: Out::from_codes(SIZE, 4, codes(&ran.gpu, &gpu_elements)?),
        cpu: Out::from_codes(SIZE, 4, codes(&ran.cpu, &cpu_elements)?),
    })
}

fn codes(image: &Image, elements: &[f64]) -> Result<Vec<f64>, String> {
    if elements.len() < ELEMENTS as usize {
        return Err(format!(
            "the compute operator wrote {} of {ELEMENTS} elements",
            elements.len()
        ));
    }
    let mut out: Vec<f64> = image.px.iter().flatten().map(|v| v * 255.0).collect();
    for &v in &elements[..ELEMENTS as usize] {
        out.extend([v, 0.0, 0.0, 0.0]);
    }
    Ok(out)
}

use deep_gpu::device::Device;
use serde_json::json;

use super::gpu::{self, Out};
use super::Ran;

const HELD: [u32; 4] = [10, 20, 30, 40];
const SIZE: [u32; 2] = [HELD.len() as u32, 1];

fn scan() -> Result<String, String> {
    let count = HELD.len();
    let op = json!({
        "id": "pass_fixture.scan@1", "kind": "compute", "origin": "composed",
        "about": "The structural stub's pass fixture: one shipped scan step.",
        "inputs": {"xs": {"type": "u32", "count": count, "from": {"storage": {"op": "core", "output": "xs"}}}},
        "steps": {"sc": {"op": "scan@1", "args": {"in": "xs", "op": "add"}}},
        "outputs": {"out": {"storage": {"type": "u32", "count": count}, "from": "sc"}},
        "elements": count, "workgroup": 64, "cost": {"ns_per_element": 100_000},
    });
    deep_effects_render::compile::compile(&op)
        .map(|c| c.wgsl)
        .map_err(|issues| {
            let said: Vec<String> = issues.iter().map(|i| format!("{i:?}")).collect();
            format!("the scan operator doesn't compile: {}", said.join("; "))
        })
}

pub fn run(device: &Device, twin: bool) -> Result<Ran, String> {
    let source = gpu::twin(
        &scan()?,
        twin,
        "@compute @workgroup_size(1)\nfn cs() {}",
        "@group(0) @binding(0) var<storage, read_write> held: array<u32, 4>;\n@compute @workgroup_size(1)\nfn cs() { held[1] = 200u; }",
    )?;
    let held = gpu::storage(device, &gpu::bytes_of_u32(&HELD));
    let module = gpu::module(device, &source)?;
    let d = &device.device;
    let scope = deep_gpu::device::push_scope(d, wgpu::ErrorFilter::Validation);
    let layout = d.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
        label: Some("pass fixture structural stub"),
        entries: &[wgpu::BindGroupLayoutEntry {
            binding: 0,
            visibility: wgpu::ShaderStages::COMPUTE,
            ty: wgpu::BindingType::Buffer {
                ty: wgpu::BufferBindingType::Storage { read_only: false },
                has_dynamic_offset: false,
                min_binding_size: None,
            },
            count: None,
        }],
    });
    let pipeline = d.create_compute_pipeline(&wgpu::ComputePipelineDescriptor {
        label: Some("pass fixture structural stub"),
        layout: Some(&d.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
            label: Some("pass fixture structural stub"),
            bind_group_layouts: &[Some(&layout)],
            immediate_size: 0,
        })),
        module: &module,
        entry_point: Some("cs"),
        compilation_options: Default::default(),
        cache: None,
    });
    let bound = gpu::bind(device, &layout, &[(0, held.as_entire_binding())]);
    if let Some(e) = crate::effects::pollster_block(scope.pop()) {
        return Err(format!("the pass's pipeline is refused: {e}"));
    }
    let mut enc = d.create_command_encoder(&Default::default());
    {
        let mut pass = enc.begin_compute_pass(&Default::default());
        pass.set_pipeline(&pipeline);
        pass.set_bind_group(0, &bound, &[]);
        pass.dispatch_workgroups(1, 1, 1);
    }
    device.queue.submit([enc.finish()]);
    let back: Vec<f64> = gpu::words(&gpu::read_buffer(device, &held))
        .into_iter()
        .take(HELD.len())
        .map(f64::from)
        .collect();
    Ok(Ran {
        gpu: Out::from_codes(SIZE, 1, back),
        cpu: Out::from_codes(SIZE, 1, HELD.iter().map(|&v| f64::from(v)).collect()),
    })
}

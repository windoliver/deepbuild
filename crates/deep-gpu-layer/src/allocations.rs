//! The test writer's `allocate` and `release` calls (issue #379; tests/acceptance/379/README.md,
//! Other calls; `test-meter` builds only): textures a writer creates, counted by the meter at the
//! sizes the device reports for them, with 0 for a memoryless target, and its memory limit
//! judged on them: BLOCKED while one can't be sized.

use deep_gpu::memory;
use serde_json::{json, Value};

use crate::{refused, App, Planted};

struct Asked {
    name: String,
    size: [u32; 2],
    format: wgpu::TextureFormat,
    bytes_per_texel: u64,
    mips: u32,
    cube: bool,
    samples: u32,
    transient: bool,
    unsizable: bool,
}

fn format(name: &str) -> Option<(wgpu::TextureFormat, u64)> {
    Some(match name {
        "rgba8unorm" => (wgpu::TextureFormat::Rgba8Unorm, 4),
        "bgra8unorm" => (wgpu::TextureFormat::Bgra8Unorm, 4),
        "rgba16float" => (wgpu::TextureFormat::Rgba16Float, 8),
        "depth32float" => (wgpu::TextureFormat::Depth32Float, 4),
        _ => return None,
    })
}

fn asked(r: &Value) -> Option<Asked> {
    if r["kind"] != "texture" {
        return None;
    }
    let size = r["size"].as_array().filter(|s| s.len() == 2)?;
    let size = [
        u32::try_from(size[0].as_u64()?).ok().filter(|n| *n > 0)?,
        u32::try_from(size[1].as_u64()?).ok().filter(|n| *n > 0)?,
    ];
    let (format, bytes_per_texel) = format(r["format"].as_str()?)?;
    let all = 32 - size[0].max(size[1]).leading_zeros();
    let mips = match &r["mips"] {
        Value::String(s) if s == "all" => all,
        v => u32::try_from(v.as_u64().unwrap_or(1)).ok()?.clamp(1, all),
    };
    Some(Asked {
        name: r["name"].as_str()?.to_string(),
        size,
        format,
        bytes_per_texel,
        mips,
        cube: r["cube"].as_bool().unwrap_or(false),
        samples: u32::try_from(r["samples"].as_u64().unwrap_or(1)).ok()?,
        transient: r["transient"].as_bool().unwrap_or(false),
        unsizable: r["unsizable"].as_bool().unwrap_or(false),
    })
}

pub fn allocate(app: &mut App, call: &Value) -> Value {
    let bad = |what: &str| refused("bad_input", what);
    let (Some(writer), Some(limit), Some(list)) = (
        call["writer"].as_str().map(str::to_string),
        call["limit_bytes"].as_u64(),
        call["resources"].as_array(),
    ) else {
        return bad("allocate is {writer, limit_bytes, resources}");
    };
    let Some(resources) = list.iter().map(asked).collect::<Option<Vec<_>>>() else {
        return bad("a resource is {name, kind: texture, size, format, mips, cube?, samples?, transient?, unsizable?}");
    };
    // The planted count: width × height × bytes per texel × samples, a formula over the descriptor.
    let formula = app.planted == Some(Planted::FormulaCount);
    app.worker.call(move |state| {
        let device = state.gpu.device();
        memory::drain(&device);
        let before = memory::allocated(&device);
        let mut rows = Vec::new();
        let mut made = Vec::new();
        for r in &resources {
            let usage = if r.transient {
                wgpu::TextureUsages::RENDER_ATTACHMENT | wgpu::TextureUsages::TRANSIENT_ATTACHMENT
            } else if r.samples > 1 || r.format.is_depth_stencil_format() {
                wgpu::TextureUsages::RENDER_ATTACHMENT
            } else {
                wgpu::TextureUsages::TEXTURE_BINDING | wgpu::TextureUsages::COPY_DST
            };
            let texture = device.device.create_texture(&wgpu::TextureDescriptor {
                label: Some("test writer"),
                size: wgpu::Extent3d {
                    width: r.size[0],
                    height: r.size[1],
                    depth_or_array_layers: if r.cube { 6 } else { 1 },
                },
                mip_level_count: r.mips,
                sample_count: r.samples,
                dimension: wgpu::TextureDimension::D2,
                format: r.format,
                usage,
                view_formats: &[],
            });
            let device_bytes = if r.unsizable {
                None
            } else {
                memory::texture(&device, &texture)
            };
            let count = if formula {
                u64::from(r.size[0]) * u64::from(r.size[1]) * r.bytes_per_texel * u64::from(r.samples)
            } else {
                device_bytes.unwrap_or(0)
            };
            rows.push((r.name.clone(), device_bytes, count));
            made.push(texture);
        }
        memory::drain(&device);
        let after = memory::allocated(&device);
        state.allocations.entry(writer).or_default().extend(made);
        let count: u64 = rows.iter().map(|r| r.2).sum();
        let unsizable: Vec<&str> = rows.iter().filter(|r| r.1.is_none()).map(|r| r.0.as_str()).collect();
        let limit = if !unsizable.is_empty() {
            json!({"result": "BLOCKED", "limit_bytes": limit, "count_bytes": count, "unsized": unsizable,
                   "reason": format!("the device can't size {}", unsizable.join(", "))})
        } else if count > limit {
            json!({"result": "FAIL", "limit_bytes": limit, "count_bytes": count})
        } else {
            json!({"result": "PASS", "limit_bytes": limit, "count_bytes": count})
        };
        json!({
            "resources": rows.iter().map(|(name, device_bytes, count)| json!({"name": name, "device_bytes": device_bytes, "count_bytes": count})).collect::<Vec<_>>(),
            "count_bytes": count,
            "device_before": before,
            "device_after": after,
            "limit": limit,
        })
    })
}

pub fn release(app: &mut App, call: &Value) -> Value {
    let Some(writer) = call["writer"].as_str().map(str::to_string) else {
        return refused("bad_input", "release is {writer}");
    };
    app.worker.call(move |state| {
        let device = state.gpu.device();
        memory::drain(&device);
        let before = memory::allocated(&device);
        state.allocations.remove(&writer);
        memory::drain(&device);
        let after = memory::allocated(&device);
        json!({"count_bytes": 0, "device_before": before, "device_after": after})
    })
}

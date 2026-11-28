use deep_gpu::device::Device;
use deep_gpu::surface::FORMAT;

use super::gpu::{self, Out};
use super::Ran;
use crate::scene::{Fill, Region, Scene};

const SIZE: [u32; 2] = [16, 8];
const FRAME: u64 = 5;
const BACKGROUND: [u8; 4] = [96, 64, 32, 255];

fn region(name: &str, rect: [i64; 2], extent: [u32; 2], fill: Fill) -> Region {
    Region {
        name: name.into(),
        rect,
        extent: extent.map(Some),
        fill,
        pipeline: None,
        moves: None,
    }
}

fn scene() -> Scene {
    Scene {
        name: "test_scene fixture".into(),
        size: SIZE,
        frames: FRAME + 1,
        fence_frames: None,
        stale_frames: None,
        device_loss_at: None,
        resize: None,
        window: SIZE,
        view: [0, 0],
        page: (0, Vec::new()),
        background: BACKGROUND,
        regions: vec![
            region(
                "ramp",
                [-96, 0],
                [108, 4],
                Fill::Ramp {
                    step: 2,
                    bgra: false,
                    alpha: 255,
                },
            ),
            region("color", [0, 0], [4, 4], Fill::Color([0, 0, 255, 255])),
            region(
                "stamp",
                [0, 4],
                [8, 4],
                Fill::Stamp {
                    bits: 4,
                    cell: 2,
                    one: [255, 255, 255, 255],
                    zero: [0, 0, 0, 255],
                },
            ),
            region("texture", [8, 4], [4, 4], Fill::Texture { w: 4, h: 4 }),
        ],
        layers: Vec::new(),
        upload_bytes_per_frame: None,
    }
}

fn record(r: &Region, origin: [i64; 2]) -> Vec<u32> {
    let px = |c: [u8; 4]| c.map(u32::from);
    let (kind, a, b, c, one, zero) = match r.fill {
        Fill::Color(c) => (0, 0, 0, 0, px(c), [0; 4]),
        Fill::Ramp { step, bgra, alpha } => {
            (1, step, u32::from(bgra), u32::from(alpha), [0; 4], [0; 4])
        }
        Fill::Stamp {
            bits,
            cell,
            one,
            zero,
        } => (
            2,
            bits,
            cell,
            (FRAME % (1u64 << bits)) as u32,
            px(one),
            px(zero),
        ),
        Fill::Texture { w, .. } => (3, w, 0, 0, [0; 4], [0; 4]),
    };
    let mut words = vec![
        origin[0] as i32 as u32,
        origin[1] as i32 as u32,
        kind,
        a,
        b,
        c,
        0,
        0,
    ];
    words.extend(one);
    words.extend(zero);
    words
}

fn texels(w: u32, h: u32) -> Vec<u8> {
    let mut out = Vec::new();
    for y in 0..h {
        for x in 0..w {
            out.extend([(x & 255) as u8, (y & 255) as u8, ((x ^ y) & 255) as u8, 255]);
        }
    }
    out
}

fn scissor(rect: [i64; 4]) -> Option<[u32; 4]> {
    let [x, y, w, h] = rect;
    let (x0, y0) = (x.max(0), y.max(0));
    let (x1, y1) = (
        (x + w).min(i64::from(SIZE[0])),
        (y + h).min(i64::from(SIZE[1])),
    );
    (x1 > x0 && y1 > y0).then(|| [x0 as u32, y0 as u32, (x1 - x0) as u32, (y1 - y0) as u32])
}

pub fn run(device: &Device, twin: bool) -> Result<Ran, String> {
    let source = gpu::twin(
        include_str!("../scene.wgsl"),
        twin,
        "vec4<f32>(f32(px.z), f32(px.y), f32(px.x), f32(px.w))",
        "vec4<f32>(f32(px.x), f32(px.y), f32(px.z), f32(px.w))",
    )?;
    let s = scene();
    let rects: Vec<[i64; 4]> = s.regions.iter().map(|r| r.rect_at(FRAME, SIZE)).collect();
    let records: Vec<u32> = s
        .regions
        .iter()
        .zip(&rects)
        .flat_map(|(r, rect)| record(r, [rect[0], rect[1]]))
        .collect();
    let regions = gpu::storage(device, &gpu::bytes_of_u32(&records));
    let texels = gpu::storage(device, &texels(4, 4));
    let tex = draw(device, &source, &regions, &texels, &rects)?;
    Ok(Ran {
        gpu: Out::from_bytes(SIZE, 4, &gpu::read_texture(device, &tex, 4)),
        cpu: Out::from_bytes(SIZE, 4, &crate::reference::frame(&s, FRAME, SIZE)),
    })
}

fn draw(
    device: &Device,
    source: &str,
    regions: &wgpu::Buffer,
    texels: &wgpu::Buffer,
    rects: &[[i64; 4]],
) -> Result<wgpu::Texture, String> {
    let module = gpu::module(device, source)?;
    let scope = deep_gpu::device::push_scope(&device.device, wgpu::ErrorFilter::Validation);
    let pipeline = device
        .device
        .create_render_pipeline(&wgpu::RenderPipelineDescriptor {
            label: Some("test_scene fixture"),
            layout: None,
            vertex: wgpu::VertexState {
                module: &module,
                entry_point: Some("region_vertex"),
                compilation_options: Default::default(),
                buffers: &[],
            },
            fragment: Some(wgpu::FragmentState {
                module: &module,
                entry_point: Some("region_fragment"),
                compilation_options: Default::default(),
                targets: &[Some(FORMAT.into())],
            }),
            primitive: Default::default(),
            depth_stencil: None,
            multisample: Default::default(),
            multiview_mask: None,
            cache: None,
        });
    let bound = gpu::bind(
        device,
        &pipeline.get_bind_group_layout(0),
        &[
            (0, regions.as_entire_binding()),
            (1, texels.as_entire_binding()),
        ],
    );
    if let Some(e) = crate::effects::pollster_block(scope.pop()) {
        return Err(format!("the pass's pipeline is refused: {e}"));
    }
    let out = gpu::target(device, SIZE, FORMAT);
    let view = out.create_view(&Default::default());
    let [b, g, r, a] = BACKGROUND.map(|c| f64::from(c) / 255.0);
    let mut enc = device.device.create_command_encoder(&Default::default());
    {
        let mut pass = enc.begin_render_pass(&wgpu::RenderPassDescriptor {
            label: Some("test_scene fixture"),
            color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                view: &view,
                depth_slice: None,
                resolve_target: None,
                ops: wgpu::Operations {
                    load: wgpu::LoadOp::Clear(wgpu::Color { r, g, b, a }),
                    store: wgpu::StoreOp::Store,
                },
            })],
            depth_stencil_attachment: None,
            timestamp_writes: None,
            occlusion_query_set: None,
            multiview_mask: None,
        });
        pass.set_pipeline(&pipeline);
        pass.set_bind_group(0, &bound, &[]);
        for (k, rect) in rects.iter().enumerate() {
            if let Some([x, y, w, h]) = scissor(*rect) {
                pass.set_scissor_rect(x, y, w, h);
                pass.draw(0..3, k as u32..k as u32 + 1);
            }
        }
    }
    device.queue.submit([enc.finish()]);
    Ok(out)
}

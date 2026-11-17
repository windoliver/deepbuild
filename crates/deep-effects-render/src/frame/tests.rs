use super::*;
use deep_gpu::device::{Backend, Gpu};
use serde_json::json;

/// The grid, the key light's shadow, the selection outline and the glow, on.
fn settings(glow: f64) -> Settings {
    Settings {
        grid: Some(BTreeMap::new()),
        shadow: Some((BTreeMap::new(), 7)),
        selection: vec!["a".into()],
        outline_width: 2,
        bloom: Some(BTreeMap::from([("bloom.intensity".into(), json!(glow))])),
        roles: ["grid_minor", "grid_major", "grid_axis"]
            .into_iter()
            .map(|role| (role.to_string(), [0.2, 0.4, 0.6]))
            .collect(),
        ..Settings::default()
    }
}

/// A view's linear, depth and ID targets as scene3d hands them over: a bright square on a
/// dim ground, nothing in front of it.
fn targets(device: &Device, size: [u32; 2]) -> [wgpu::TextureView; 3] {
    use wgpu::TextureUsages as U;
    let make = |format, usage| {
        device.device.create_texture(&wgpu::TextureDescriptor {
            label: Some("test target"),
            size: wgpu::Extent3d {
                width: size[0],
                height: size[1],
                depth_or_array_layers: 1,
            },
            mip_level_count: 1,
            sample_count: 1,
            dimension: wgpu::TextureDimension::D2,
            format,
            usage: U::TEXTURE_BINDING | U::RENDER_ATTACHMENT | usage,
            view_formats: &[],
        })
    };
    let linear = make(LINEAR, U::COPY_DST);
    let texels: Vec<u8> = (0..size[0] * size[1])
        .flat_map(|i| {
            let lit = (i % size[0]) / 8 == 2 && (i / size[0]) / 8 == 2;
            let v = if lit { 8.0 } else { 0.05 };
            [v, v * 0.5, v * 0.25, 1.0]
        })
        .flat_map(|c| crate::reference::f32_to_f16(c).to_le_bytes())
        .collect();
    device.queue.write_texture(
        linear.as_image_copy(),
        &texels,
        wgpu::TexelCopyBufferLayout {
            offset: 0,
            bytes_per_row: Some(size[0] * 8),
            rows_per_image: None,
        },
        linear.size(),
    );
    [
        linear,
        make(wgpu::TextureFormat::Depth32Float, U::empty()),
        make(wgpu::TextureFormat::R32Uint, U::empty()),
    ]
    .map(|t| t.create_view(&Default::default()))
}

/// The frame scene3d hands the effects for a camera `turn` radians round the origin, looking
/// at it: world to clip with reversed Z and no far plane.
fn frame<'a>(
    size: [u32; 2],
    [linear, depth, ids]: &'a [wgpu::TextureView; 3],
    picks: &'a BTreeMap<String, u32>,
    turn: f64,
) -> PostFrame<'a> {
    let eye = [8.0 * turn.sin(), 3.0, 8.0 * turn.cos()];
    let dot = |a: [f64; 3], b: [f64; 3]| a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
    let unit = |v: [f64; 3]| v.map(|x| x / dot(v, v).sqrt());
    let forward = unit(eye.map(|x| -x));
    let right = unit([-forward[2], 0.0, forward[0]]);
    let up = [
        right[1] * forward[2] - right[2] * forward[1],
        right[2] * forward[0] - right[0] * forward[2],
        right[0] * forward[1] - right[1] * forward[0],
    ];
    let (near, zoom) = (0.1, 2.4);
    let x = right.map(|v| v * zoom * f64::from(size[1]) / f64::from(size[0]));
    let y = up.map(|v| v * zoom);
    // Each row of the matrix, then its translation.
    let rows = [x, y, [0.0; 3], forward];
    let moved = [-dot(x, eye), -dot(y, eye), near, -dot(forward, eye)];
    let mut clip = [0.0; 16];
    for row in 0..4 {
        for col in 0..3 {
            clip[col * 4 + row] = rows[row][col];
        }
        clip[12 + row] = moved[row];
    }
    let mut light_clip = [0.0; 16];
    for k in 0..4 {
        light_clip[k * 5] = 1.0;
    }
    PostFrame {
        size,
        linear,
        depth,
        ids,
        // Any depth target stands for the key light's map.
        shadow: Some(depth),
        clip,
        eye,
        near,
        light_clip: Some(light_clip),
        picks,
        core: Vec::new(),
        crop: None,
    }
}

/// Plans the frame's passes, records them and submits: the target the output would read.
fn run(device: &Device, fx: &mut Effects, frame: &PostFrame<'_>) -> wgpu::TextureView {
    let (jobs, out) = fx.jobs(device, frame);
    let mut encoder = device.device.create_command_encoder(&Default::default());
    for (_, job) in jobs {
        job(&mut encoder);
    }
    device.queue.submit([encoder.finish()]);
    out.expect("the effects hand the output their target")
}

/// Canvas primitives, Frame budget: bind groups and buffers created in each frame after the
/// first are counted. The shipped passes bind what the first frame made, and a frame whose
/// camera and values hold writes nothing.
#[test]
fn a_frame_after_the_first_makes_no_buffer_and_no_bind_group_for_the_shipped_passes() {
    let gpu = Gpu::open(Backend::Noop).expect("the noop backend gives a device");
    let device = gpu.device();
    let size = [128, 96];
    let views = targets(&device, size);
    let picks = BTreeMap::from([("a".to_string(), 3)]);
    let mut fx = Effects::new(settings(0.5), Planted::default());
    let made: Vec<_> = [0.0, 0.1, 0.2, 0.3, 0.3]
        .into_iter()
        .map(|turn| {
            let before = device.device.counts().read();
            run(&device, &mut fx, &frame(size, &views, &picks, turn));
            device.device.counts().read().since(before)
        })
        .collect();
    for (n, made) in made.iter().enumerate().skip(1) {
        assert_eq!(
            (made.buffers, made.bind_groups),
            (0, 0),
            "frame {n}: buffers and bind groups made"
        );
    }
    assert_eq!(
        (made[4].writes, made[4].uploaded),
        (0, 0),
        "frame 4, whose camera holds: queue writes and bytes uploaded"
    );
    let raised = device.take_raised();
    assert!(raised.is_empty(), "the device raised: {raised:?}");
}

/// On this machine's GPU the passes draw, from what they bound last frame, the pixels they
/// draw from binds made for the frame: as the camera turns, as the glow's intensity changes,
/// and as the view takes another size and its first one again.
#[test]
fn the_shipped_passes_draw_from_kept_binds_what_they_draw_from_fresh_ones() {
    let gpu = Gpu::open(Backend::Gpu).expect("this test runs on the machine's GPU");
    let device = gpu.device();
    let sizes = [[128, 96], [96, 64]];
    let views = sizes.map(|size| targets(&device, size));
    let picks = BTreeMap::from([("a".to_string(), 3)]);
    let pixels = |fx: &mut Effects, (at, turn): (usize, f64)| {
        let out = run(&device, fx, &frame(sizes[at], &views[at], &picks, turn));
        crate::reference::read(&device, out.texture(), wgpu::TextureAspect::All, 8)
    };
    let mut kept = Effects::new(settings(0.5), Planted::default());
    let mut drawn = Vec::new();
    let frames = [
        (0, 0.0, 0.5),
        (0, 0.4, 0.5),
        (0, 0.4, 0.9),
        (1, 0.8, 0.9),
        (0, 0.8, 0.9),
    ];
    for (n, (at, turn, glow)) in frames.into_iter().enumerate() {
        kept.settings = settings(glow);
        let from_kept = pixels(&mut kept, (at, turn));
        let mut fresh = Effects::new(settings(glow), Planted::default());
        assert!(
            from_kept == pixels(&mut fresh, (at, turn)),
            "frame {n}: the kept binds draw other pixels"
        );
        drawn.push(from_kept);
    }
    assert!(
        drawn[0] != drawn[1],
        "the turned camera draws another frame"
    );
    assert!(
        drawn[1] != drawn[2],
        "the brighter glow draws another frame"
    );
    let raised = device.take_raised();
    assert!(raised.is_empty(), "the device raised: {raised:?}");
}

use super::*;
use deep_canvas_scene3d::frames::Frames;
use deep_canvas_scene3d::scene::Labels;
use deep_gpu::device::{Backend, Gpu};
use serde_json::json;

/// Records by shape, in each batch.
fn records(r: &Renderer) -> Vec<(String, Shape, Vec<u8>)> {
    let mut out = Vec::new();
    for (id, b) in &r.batches {
        for ((shape, ..), set) in &b.solids {
            out.push((id.clone(), *shape, set.records.clone()));
        }
    }
    out
}

#[test]
fn a_frame_that_writes_what_moved_leaves_the_records_a_whole_prepare_writes() {
    let gpu = Gpu::open(Backend::Noop).expect("the noop backend gives a device");
    let device = gpu.device();
    let look = Look3::read(&json!({"roles": {"accent": "#1aa3c8", "ground": "#000000"}})).unwrap();
    let boxes = |id: &str, order: &str, pos: [f64; 3]| json!({"id": id, "kind": "mark.box@1", "name": id, "order": order, "layer": "main", "params": {"size": 1, "paint": {"fill": {"role": "accent"}}}, "at": {"pos": pos}});
    // Boxes in one layer; `b` slides, `c` rides it, `a` and `d` stay.
    let mut items = serde_json::Map::new();
    items.insert("cam".into(), json!({"id": "cam", "kind": "camera@1", "name": "C", "order": "a0", "layer": "main", "params": {"projection": "perspective", "target": [0, 0, 0], "orbit": {"azimuth": 30, "elevation": 35, "distance": 14}, "fov": 40}}));
    for (id, order, pos) in [
        ("a", "b0", [-3.0, 0.5, 0.0]),
        ("b", "b1", [0.0, 0.5, 0.0]),
        ("c", "b2", [0.0, 1.0, 0.0]),
        ("d", "b3", [3.0, 0.5, 0.0]),
    ] {
        items.insert(id.into(), boxes(id, order, pos));
    }
    items["c"]["parent"] = json!("b");
    let doc = json!({
        "format": 1, "profile": "scene", "title": "T", "size": [128, 96], "camera": "cam",
        "transport": {"span": "60s"}, "layers": {"main": {"writer": "w", "title": "Main", "order": "a0"}},
        "items": items,
        "channels": {
            "slide": {"target": "items/b/at/pos/0", "type": "f32", "keys": {"k0": {"t": "0s", "value": -3, "interp": "linear"}, "k1": {"t": "60s", "value": 3, "interp": "linear"}}},
            "orbit": {"target": "items/cam/params/orbit/azimuth", "type": "f32", "keys": {"k0": {"t": "0s", "value": 0, "interp": "linear"}, "k1": {"t": "60s", "value": 90, "interp": "linear"}}}
        }
    });
    let mut labels = Labels::new();
    let mut frames = Frames::new(&doc, &look, &mut labels).unwrap();
    let moved = frames
        .moved()
        .expect("transforms and the orbit stay on the fast path")
        .to_vec();
    assert_eq!(moved.len(), 2, "the sliding box and its child: {moved:?}");
    let mut playing = Renderer::new(&device, Planted::default());
    frames
        .at(0, [128, 96], &Default::default(), &mut labels)
        .unwrap();
    playing.prepare(&device, frames.scene(), &look);
    for n in [1i64, 17, 600] {
        frames
            .at(
                n * 705_600_000 / 60,
                [128, 96],
                &Default::default(),
                &mut labels,
            )
            .unwrap();
        playing.prepare_moved(&device, frames.scene(), &look, &moved);
        assert_eq!(
            playing.counts().instances_written,
            2,
            "frame {n}: the two moved records alone"
        );
        let mut whole = Renderer::new(&device, Planted::default());
        whole.prepare(&device, frames.scene(), &look);
        assert_eq!(records(&playing), records(&whole), "frame {n}");
    }
}

/// Glass (#428) and per-pixel items (#424) draw after the geometry pass resolves (#1173), so
/// their pipelines take the resolved targets' sample count and ID format, not the geometry
/// pass's.
#[test]
fn glass_blend_and_per_pixel_parts_draw_with_no_validation_error() {
    let gpu = Gpu::open(Backend::Noop).expect("the noop backend gives a device");
    let device = gpu.device();
    let look = Look3::read(&json!({"roles": {"accent": "#1aa3c8", "ground": "#000000"}})).unwrap();
    let part = |id: &str, order: &str, x: f64, material: &str| json!({"id": id, "kind": "mark.box@1", "name": id, "order": order, "layer": "main", "material": material, "params": {"size": 1, "paint": {"fill": {"role": "accent"}}}, "at": {"pos": [x, 0.5, 0.0]}});
    let mut items = serde_json::Map::new();
    items.insert("cam".into(), json!({"id": "cam", "kind": "camera@1", "name": "C", "order": "a0", "layer": "main", "params": {"projection": "perspective", "target": [0, 0, 0], "orbit": {"azimuth": 30, "elevation": 35, "distance": 8}, "fov": 40}}));
    items.insert("glass".into(), json!({"id": "glass", "kind": "material@1", "name": "Glass", "order": "a1", "layer": "main", "params": {"base_color": [1, 1, 1, 1], "metallic": 0, "roughness": 0.2, "transmission": 1, "ior": 1.5}}));
    items.insert("tint".into(), json!({"id": "tint", "kind": "material@1", "name": "Tint", "order": "a2", "layer": "main", "params": {"base_color": [1, 0.5, 0.2, 0.5], "alpha_mode": "blend"}}));
    items.insert("a".into(), part("a", "b0", -0.6, "glass"));
    items.insert("b".into(), part("b", "b1", 0.6, "tint"));
    items.insert("c".into(), part("c", "b2", 0.0, "tint"));
    items["c"]["resolve"] = json!("per_pixel");
    let doc = json!({
        "format": 1, "profile": "scene", "title": "T", "size": [96, 64], "camera": "cam",
        "layers": {"main": {"writer": "w", "title": "Main", "order": "a0"}},
        "items": items,
    });
    let mut labels = Labels::new();
    let mut frames = Frames::new(&doc, &look, &mut labels).unwrap();
    frames
        .at(0, [96, 64], &Default::default(), &mut labels)
        .unwrap();
    let mut renderer = Renderer::new(&device, Planted::default());
    draw_offscreen(&device, &mut renderer, frames.scene(), &look, None);
    assert!(
        renderer.clear_pipelines[usize::from(GLASS)].is_some(),
        "the glass part is drawn as glass"
    );
    assert!(
        renderer.clear_pipelines[usize::from(PER_PIXEL)].is_some(),
        "the per-pixel part is drawn per pixel"
    );
    let raised = device.take_raised();
    assert!(raised.is_empty(), "the device raised: {raised:?}");
}

/// A scene document of `items` in one layer, each stamped with its ID, name, order and layer.
pub(crate) fn stamped(
    items: &[(&str, serde_json::Value)],
    channels: serde_json::Value,
) -> serde_json::Value {
    let mut map = serde_json::Map::new();
    for (k, (id, item)) in items.iter().enumerate() {
        let mut item = item.clone();
        item["id"] = json!(id);
        item["name"] = json!(id);
        item["order"] = json!(format!("a{k:03}"));
        item["layer"] = json!("main");
        map.insert((*id).into(), item);
    }
    json!({
        "format": 1, "profile": "scene", "title": "T", "size": [128, 96], "camera": "cam",
        "transport": {"span": "60s"}, "layers": {"main": {"writer": "w", "title": "Main", "order": "a0"}},
        "items": map, "channels": channels,
    })
}

pub(crate) fn orbiting_camera() -> (serde_json::Value, serde_json::Value) {
    (
        json!({"kind": "camera@1", "params": {"projection": "perspective", "target": [0, 0.8, 0], "orbit": {"azimuth": 30, "elevation": 20, "distance": 14}, "fov": 45, "near": 0.1, "far": 500}}),
        json!({"orbit": {"target": "items/cam/params/orbit/azimuth", "type": "f32", "keys": {"k0": {"t": "0s", "value": 30, "interp": "linear"}, "k1": {"t": "60s", "value": 390, "interp": "linear"}}}}),
    )
}

/// What the device made and wrote while `frame` ran.
fn counted(device: &Device, frame: impl FnOnce()) -> deep_gpu::counted::Reading {
    let before = device.device.counts().read();
    frame();
    device.device.counts().read().since(before)
}

/// Frames 1 to 5 of `doc`, each prepared whole and its jobs recorded into a slot as the GPU
/// layer's view does: what the device made and wrote in each. `host` leaves each frame's
/// scene and the renderer as a host would before the renderer takes the frame.
pub(crate) fn played(
    doc: &serde_json::Value,
    mut post: Option<&mut dyn Post>,
    host: impl Fn(&mut Renderer, &mut Scene),
) -> Vec<deep_gpu::counted::Reading> {
    let gpu = Gpu::open(Backend::Noop).expect("the noop backend gives a device");
    let device = gpu.device();
    let look = Look3::read(&json!({"roles": {"accent": "#1aa3c8", "ground": "#000000"}})).unwrap();
    let mut labels = Labels::new();
    let mut frames = Frames::new(doc, &look, &mut labels).unwrap();
    let mut renderer = Renderer::new(&device, Planted::default());
    let slot = texture2d(
        &device.device,
        "test slot",
        [128, 96],
        FORMAT,
        wgpu::TextureUsages::RENDER_ATTACHMENT,
    )
    .create_view(&Default::default());
    let mut out = Vec::new();
    for n in 0..6i64 {
        frames
            .at(
                n * 705_600_000 / 60,
                [128, 96],
                &Default::default(),
                &mut labels,
            )
            .unwrap();
        let mut scene = frames.scene().clone();
        host(&mut renderer, &mut scene);
        let made = counted(&device, || {
            renderer.prepare(&device, &scene, &look);
            let mut encoder = device.device.create_command_encoder(&Default::default());
            let post = post.as_deref_mut().map(|p| p as &mut dyn Post);
            for (_, job) in renderer.jobs(&device, &slot, post, None) {
                job(&mut encoder);
            }
            device.queue.submit([encoder.finish()]);
        });
        if n > 0 {
            out.push(made);
        }
    }
    let raised = device.take_raised();
    assert!(raised.is_empty(), "the device raised: {raised:?}");
    out
}

/// Canvas primitives, Frame budget: bind groups and buffers created in each frame after the
/// first are counted. Puffs, a mirror's overlay and a flare bind what they made at the first.
#[test]
fn a_frame_after_the_first_makes_no_buffer_and_no_bind_group_for_puffs_a_mirror_and_a_flare() {
    let (cam, channels) = orbiting_camera();
    let puff = |x: f64, seed: u32| json!({"kind": "puff@1", "at": {"pos": [x, 9.0, -20.0]}, "params": {"radius": 5, "aspect": 1.6, "density": 1, "bright": 1, "seed": seed}});
    let doc = stamped(
        &[
            ("cam", cam),
            (
                "sky",
                json!({"kind": "sky@1", "params": {"top": [0.15, 0.3, 0.75, 1], "low": [0.45, 0.6, 0.85, 1], "ambient_top": [0.25, 0.25, 0.25], "ambient_low": [0.1, 0.1, 0.1]}}),
            ),
            (
                "sun",
                json!({"kind": "light.sun@1", "params": {"illuminance": 3, "color": [1, 1, 1], "shadow": false}, "at": {"rot": [-45, 30, 0]}}),
            ),
            (
                "lamp",
                json!({"kind": "light.point@1", "params": {"power": 40, "radius": 0.05, "color": [1, 0.9, 0.8], "shadow": false}, "at": {"pos": [0.8, 2.6, -1]}}),
            ),
            (
                "floor_mat",
                json!({"kind": "material@1", "params": {"base_color": [0.05, 0.05, 0.06, 1], "metallic": 0, "roughness": 0.2, "mirror": {"strength": 1, "blur": 0, "plane": "floor"}}}),
            ),
            (
                "box_mat",
                json!({"kind": "material@1", "params": {"base_color": [0.7, 0.45, 0.3, 1], "roughness": 0.6}}),
            ),
            (
                "floor",
                json!({"kind": "plate@1", "params": {"grid": [1, 1], "size": [40, 40]}, "at": {"pos": [0, 0, 0]}, "material": "floor_mat"}),
            ),
            (
                "box",
                json!({"kind": "mark.box@1", "params": {"size": [0.7, 0.7, 0.7]}, "at": {"pos": [3, 0.35, 0]}, "material": "box_mat"}),
            ),
            (
                "flare",
                json!({"kind": "effect@1", "params": {"kind": "flare", "flare": {"from": "lights", "ghosts": 8, "halo": 0.05, "streak": {"count": 6, "length": 0.25, "anamorphic": false}, "starburst": {"blades": 6}, "intensity": 1}}}),
            ),
            ("puff0", puff(-12.0, 0)),
            ("puff1", puff(0.0, 1)),
            ("puff2", puff(12.0, 2)),
        ],
        channels,
    );
    for (n, made) in played(&doc, None, |_, _| {}).iter().enumerate() {
        assert_eq!(
            (made.buffers, made.bind_groups),
            (0, 0),
            "frame {}: buffers and bind groups made",
            n + 1
        );
    }
}

/// A post module's passes hand the output pass the target it reads: the one it handed last
/// frame, or the geometry's own, binds as it did then.
#[test]
fn a_frame_after_the_first_makes_no_bind_group_for_the_output_of_a_post_module() {
    struct Hands(Option<wgpu::TextureView>);
    impl Post for Hands {
        fn shadows(&self) -> bool {
            false
        }
        fn jobs(
            &mut self,
            _: &Device,
            frame: &PostFrame<'_>,
        ) -> (Vec<(String, Job)>, Option<wgpu::TextureView>) {
            let view = self.0.clone().unwrap_or_else(|| frame.linear.clone());
            (Vec::new(), Some(view))
        }
    }
    let (cam, channels) = orbiting_camera();
    let doc = stamped(
        &[
            ("cam", cam),
            (
                "box",
                json!({"kind": "mark.box@1", "params": {"size": 1, "paint": {"fill": {"role": "accent"}}}, "at": {"pos": [0, 0.5, 0]}}),
            ),
        ],
        channels,
    );
    let gpu = Gpu::open(Backend::Noop).expect("the noop backend gives a device");
    let own = texture2d(
        &gpu.device().device,
        "test post",
        [128, 96],
        LINEAR,
        wgpu::TextureUsages::RENDER_ATTACHMENT | wgpu::TextureUsages::TEXTURE_BINDING,
    )
    .create_view(&Default::default());
    for (what, mut post) in [
        ("its own target", Hands(Some(own))),
        ("the geometry's", Hands(None)),
    ] {
        for (n, made) in played(&doc, Some(&mut post), |_, _| {}).iter().enumerate() {
            assert_eq!(
                made.bind_groups,
                0,
                "handing {what}, frame {}: bind groups made",
                n + 1
            );
        }
    }
}

/// wgpu stages each queue write in a buffer of its own, so the records a frame moves go in
/// one write per run of neighbours, as a whole prepare's do.
#[test]
fn a_frame_that_moves_neighbouring_records_writes_them_in_one_write() {
    let slide = |id: &str| {
        (
            format!("slide-{id}"),
            json!({"target": format!("items/{id}/at/pos/1"), "type": "f32", "keys": {"k0": {"t": "0s", "value": 0.5, "interp": "linear"}, "k1": {"t": "60s", "value": 5, "interp": "linear"}}}),
        )
    };
    let part = |x: f64| json!({"kind": "mark.box@1", "params": {"size": 1, "paint": {"fill": {"role": "accent"}}}, "at": {"pos": [x, 0.5, 0.0]}});
    let ids = ["a", "b", "c", "d"];
    let channels: serde_json::Map<String, serde_json::Value> =
        ids.iter().map(|id| slide(id)).collect();
    let mut items = vec![("cam", orbiting_camera().0)];
    items.extend(
        ids.iter()
            .enumerate()
            .map(|(k, id)| (*id, part(k as f64 * 2.0 - 3.0))),
    );
    let doc = stamped(&items, serde_json::Value::Object(channels));
    let gpu = Gpu::open(Backend::Noop).expect("the noop backend gives a device");
    let device = gpu.device();
    let look = Look3::read(&json!({"roles": {"accent": "#1aa3c8", "ground": "#000000"}})).unwrap();
    let mut labels = Labels::new();
    let mut frames = Frames::new(&doc, &look, &mut labels).unwrap();
    let moved = frames
        .moved()
        .expect("transforms stay on the fast path")
        .to_vec();
    assert_eq!(moved.len(), 4, "the four sliding boxes: {moved:?}");
    let mut playing = Renderer::new(&device, Planted::default());
    frames
        .at(0, [128, 96], &Default::default(), &mut labels)
        .unwrap();
    playing.prepare(&device, frames.scene(), &look);
    for n in [1i64, 17, 600] {
        frames
            .at(
                n * 705_600_000 / 60,
                [128, 96],
                &Default::default(),
                &mut labels,
            )
            .unwrap();
        let made = counted(&device, || {
            playing.prepare_moved(&device, frames.scene(), &look, &moved)
        });
        assert_eq!(
            playing.counts().instances_written,
            4,
            "frame {n}: the four moved records"
        );
        assert_eq!(made.writes, 1, "frame {n}: queue writes");
        let mut whole = Renderer::new(&device, Planted::default());
        whole.prepare(&device, frames.scene(), &look);
        assert_eq!(records(&playing), records(&whole), "frame {n}");
    }
}

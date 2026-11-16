//! Canvas primitives, Frame budget: GPU memory per window, measured on the device. A renderer
//! holds what the scene it draws needs. The device's size counts every renderer the process
//! holds, so these tests are in a file of their own and take turns.

use std::sync::Mutex;

use deep_canvas_scene3d::frames::Frames;
use deep_canvas_scene3d::look::Look3;
use deep_canvas_scene3d::scene::{Labels, Scene};
use deep_gpu::device::{Backend, Device, Gpu};
use deep_gpu::encode::Job;
use deep_scene3d_render::{draw_offscreen, Planted, Post, PostFrame, Renderer};
use serde_json::{json, Value};

static TURN: Mutex<()> = Mutex::new(());
const MIB: u64 = 1 << 20;

fn look() -> Look3 {
    Look3::read(&json!({"roles": {"accent": "#1aa3c8", "ground": "#000000"}})).unwrap()
}

/// A floor and a box under a sun at 128 × 96, with `more` items beside them.
fn scene(shadow: bool, floor: Value, more: &[(&str, Value)]) -> Scene {
    let mut items = vec![
        (
            "cam",
            json!({"kind": "camera@1", "params": {"projection": "perspective", "target": [0, 0.8, 0], "orbit": {"azimuth": 30, "elevation": 20, "distance": 14}, "fov": 45, "near": 0.1, "far": 500}}),
        ),
        (
            "sun",
            json!({"kind": "light.sun@1", "params": {"illuminance": 3, "color": [1, 1, 1], "shadow": shadow}, "at": {"rot": [-45, 30, 0]}}),
        ),
        ("floor", floor),
    ];
    items.extend(more.iter().cloned());
    let items: serde_json::Map<String, Value> = (items.into_iter().enumerate())
        .map(|(k, (id, mut item))| {
            item["id"] = json!(id);
            item["name"] = json!(id);
            item["order"] = json!(format!("a{k:03}"));
            item["layer"] = json!("main");
            (id.to_string(), item)
        })
        .collect();
    // A point light casts only where the policy shadows one.
    let doc = json!({
        "format": 1, "profile": "scene", "title": "T", "size": [128, 96], "camera": "cam",
        "layers": {"main": {"writer": "w", "title": "Main", "order": "a0"}},
        "light_policy": {"shadowed": {"points": 1}},
        "items": items,
    });
    let mut labels = Labels::new();
    let mut frames = Frames::new(&doc, &look(), &mut labels).unwrap();
    frames
        .at(0, [128, 96], &Default::default(), &mut labels)
        .unwrap();
    frames.scene().clone()
}

/// A floor and a box of materials: with `rich`, the sun casts through its cascades, the floor is
/// a mirror, a point light casts and a label draws.
fn lit(rich: bool) -> Scene {
    let mut floor = json!({"base_color": [0.05, 0.05, 0.06, 1], "metallic": 0, "roughness": 0.2});
    if rich {
        floor["mirror"] = json!({"strength": 1, "blur": 0, "plane": "floor"});
    }
    let mut more = vec![
        ("floor_mat", json!({"kind": "material@1", "params": floor})),
        (
            "box_mat",
            json!({"kind": "material@1", "params": {"base_color": [0.7, 0.45, 0.3, 1], "roughness": 0.6}}),
        ),
        (
            "box",
            json!({"kind": "mark.box@1", "params": {"size": [0.7, 0.7, 0.7]}, "at": {"pos": [3, 0.35, 0]}, "material": "box_mat"}),
        ),
    ];
    if rich {
        more.push((
            "lamp",
            json!({"kind": "light.point@1", "params": {"power": 40, "radius": 0.05, "color": [1, 0.9, 0.8], "shadow": true}, "at": {"pos": [0.8, 2.6, -1]}}),
        ));
        more.push(("tag", tag()));
    }
    let floor = json!({"kind": "plate@1", "params": {"grid": [1, 1], "size": [40, 40]}, "at": {"pos": [0, 0, 0]}, "material": "floor_mat"});
    scene(rich, floor, &more)
}

fn tag() -> Value {
    json!({"kind": "mark.text@1", "params": {"text": "Block", "size": 0.3, "size_space": "world", "paint": {"fill": {"role": "accent"}}}, "at": {"pos": [-1, 1.4, 0]}})
}

/// A post module that reads the key light's map when told to, and draws nothing.
struct Reads(bool);
impl Post for Reads {
    fn shadows(&self) -> bool {
        self.0
    }
    fn jobs(
        &mut self,
        _: &Device,
        _: &PostFrame<'_>,
    ) -> (Vec<(String, Job)>, Option<wgpu::TextureView>) {
        (Vec::new(), None)
    }
}

/// What a renderer holds on the device once it has drawn `frames` in turn, each with a post
/// module that reads the key light's map or not.
fn held(device: &Device, frames: &[(&Scene, bool)]) -> u64 {
    let size = || {
        deep_gpu::memory::drain(device);
        deep_gpu::memory::allocated(device).expect("Metal reports what it holds")
    };
    let before = size();
    let mut renderer = Renderer::new(device, Planted::default());
    for (scene, reads) in frames {
        draw_offscreen(
            device,
            &mut renderer,
            scene,
            &look(),
            Some(&mut Reads(*reads)),
        )
        .expect("a frame");
    }
    size().saturating_sub(before)
}

fn mib(bytes: u64) -> f64 {
    bytes as f64 / MIB as f64
}

/// A renderer that drew a cascaded sun, a mirror, a casting point light and a label holds, once
/// its scene has none of them, what a renderer that never drew them holds; and when they come
/// back it draws them as its first frame would.
#[test]
fn a_scene_that_stopped_using_them_holds_none_of_their_memory() {
    let _turn = TURN.lock().unwrap_or_else(|e| e.into_inner());
    let gpu = Gpu::open(Backend::Gpu).expect("this test runs on the machine's GPU");
    let device = gpu.device();
    let (rich, plain) = (lit(true), lit(false));
    assert!(
        rich.cascaded() && rich.mirror.is_some() && !rich.layers[0].labels.is_empty(),
        "the first scene casts through cascades, holds a mirror and draws a label"
    );
    assert!(!plain.cascaded() && plain.mirror.is_none());
    // What comes back draws as a renderer's first frame does.
    let mut renderer = Renderer::new(&device, Planted::default());
    for (n, scene) in [&rich, &plain, &rich].into_iter().enumerate() {
        let drawn = draw_offscreen(&device, &mut renderer, scene, &look(), None);
        assert_eq!(
            renderer.counts().local_maps.len(),
            usize::from(n != 1),
            "frame {n}: the lamp's map"
        );
        let mut first = Renderer::new(&device, Planted::default());
        assert!(
            drawn.is_some() && drawn == draw_offscreen(&device, &mut first, scene, &look(), None),
            "frame {n}: other pixels than a renderer that starts at it"
        );
    }
    drop(renderer);
    let never = held(&device, &[(&plain, false), (&plain, false)]);
    let once = held(&device, &[(&rich, false), (&plain, false), (&plain, false)]);
    assert!(
        once <= never + 4 * MIB,
        "after a cascaded sun, a mirror, a lamp and a label the renderer holds {:.1} MiB, {:.1} MiB without them",
        mib(once),
        mib(never)
    );
    let raised = device.take_raised();
    assert!(raised.is_empty(), "the device raised: {raised:?}");
}

/// The glyph atlas is made by the first frame that draws a label: a scene with none holds none.
#[test]
fn a_scene_with_no_label_holds_no_glyph_atlas() {
    let _turn = TURN.lock().unwrap_or_else(|e| e.into_inner());
    let gpu = Gpu::open(Backend::Gpu).expect("this test runs on the machine's GPU");
    let device = gpu.device();
    let floor = || json!({"kind": "plate@1", "params": {"grid": [1, 1], "size": [40, 40], "paint": {"fill": {"role": "accent"}}}, "at": {"pos": [0, 0, 0]}});
    let (bare, tagged) = (
        scene(false, floor(), &[]),
        scene(false, floor(), &[("tag", tag())]),
    );
    assert!(!tagged.layers[0].labels.is_empty(), "the tag draws a label");
    let without = held(&device, &[(&bare, false)]);
    let with = held(&device, &[(&tagged, false)]);
    assert!(
        with >= without + 7 * MIB,
        "a renderer holds {:.1} MiB with no label and {:.1} MiB with one: the atlas is 8 MiB",
        mib(without),
        mib(with)
    );
    // The check's estimate counts the atlas where the device holds one.
    let estimate = |scene: &Scene| deep_scene3d_render::held::of(scene).fixed;
    let counted = estimate(&tagged) - estimate(&bare);
    assert!(
        counted.abs_diff(with - without) <= MIB,
        "the estimate counts {:.1} MiB for the label, the device {:.1} MiB",
        mib(counted),
        mib(with - without)
    );
}

/// The key light's single map is held while a post module reads it, and let go once none does.
#[test]
fn a_frame_no_post_module_reads_the_key_lights_map_in_holds_no_map() {
    let _turn = TURN.lock().unwrap_or_else(|e| e.into_inner());
    let gpu = Gpu::open(Backend::Gpu).expect("this test runs on the machine's GPU");
    let device = gpu.device();
    let floor = json!({"kind": "plate@1", "params": {"grid": [1, 1], "size": [40, 40], "paint": {"fill": {"role": "accent"}}}, "at": {"pos": [0, 0, 0]}});
    let painted = scene(true, floor, &[]);
    assert!(!painted.cascaded(), "painted solids keep the single map");
    let never = held(&device, &[(&painted, false), (&painted, false)]);
    let read = held(&device, &[(&painted, true)]);
    let once = held(
        &device,
        &[(&painted, true), (&painted, false), (&painted, false)],
    );
    assert!(
        read >= never + 12 * MIB,
        "the map is 16 MiB: {:.1} MiB read, {:.1} MiB never read",
        mib(read),
        mib(never)
    );
    assert!(
        once <= never + 2 * MIB,
        "after a post module read the map the renderer holds {:.1} MiB, {:.1} MiB never read",
        mib(once),
        mib(never)
    );
}

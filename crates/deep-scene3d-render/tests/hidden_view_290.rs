//! #290 (canvas primitives: Object: hidden view): "a depth pass of its own keeps only its nearest
//! surface, and that surface draws only where the depth target holds a nearer one … Where
//! nothing hides it, the hidden view draws nothing, so a visible item never shows twice". An
//! instancer is one item whose elements each hold a pick ID of their own, so an element behind
//! another element of its instancer is hidden by nothing: the item's nearest surface there is
//! the front element, which shows.

use deep_canvas_scene3d::frames::Frames;
use deep_canvas_scene3d::look::Look3;
use deep_canvas_scene3d::scene::{Labels, Scene};
use deep_gpu::device::{Backend, Gpu};
use deep_scene3d_render::{draw_offscreen, Planted, Renderer};
use serde_json::{json, Value};

fn look() -> Look3 {
    Look3::read(&json!({"roles": {"accent": "#1aa3c8", "ground": "#000000"}})).unwrap()
}

/// What stands in the frame beside the two bricks.
#[derive(Clone, Copy, PartialEq)]
enum With {
    Nothing,
    /// A wall before both bricks.
    Wall,
    /// The near brick additive, which writes no depth and no object ID, the tile straight
    /// behind it and smaller, and a post of another item between the two.
    Post,
}

/// Two bricks of one instancer at 160 × 120, a clay one and a slate one half behind it, its
/// hidden view at `opacity` (none: no such field).
fn scene(opacity: Option<f64>, with: With) -> Scene {
    let post = with == With::Post;
    let (far, tile) = if post { (0.0, 1.0) } else { (0.8, 1.6) };
    let mut bricks = json!({"kind": "instance@1", "params": {
        "of": ["brick", "tile"], "ids": [0, 1], "proto": [0, 1],
        "pos": [[0, 1, 0], [far, 1, -3]]}});
    if let Some(o) = opacity {
        bricks["hidden_view"] = json!({"opacity": o});
    }
    let paint =
        |c: [f64; 3]| json!({"kind": "material@1", "params": {"base_color": c, "roughness": 1}});
    let mut clay = paint([0.85, 0.45, 0.1]);
    if post {
        clay["params"]["alpha_mode"] = json!("add");
    }
    let mut items = vec![
        (
            "cam",
            json!({"kind": "camera@1", "params": {"projection": "perspective",
                "position": [0, 1.2, 8], "target": [0, 1, 0], "fov": 40, "near": 0.1, "far": 100}}),
        ),
        (
            "sun",
            json!({"kind": "light.sun@1", "params": {"illuminance": 3, "color": [1, 1, 1], "shadow": false},
                "at": {"rot": [-35, 25, 0]}}),
        ),
        ("clay", clay),
        ("slate", paint([0.1, 0.3, 0.85])),
        ("stone", paint([0.5, 0.5, 0.5])),
        (
            "brick",
            json!({"kind": "mark.box@1", "params": {"size": [1.6, 1.6, 0.4]}, "material": "clay",
                "visible": false}),
        ),
        (
            "tile",
            json!({"kind": "mark.box@1", "params": {"size": [tile, tile, 0.4]}, "material": "slate",
                "visible": false}),
        ),
        ("bricks", bricks),
    ];
    let stone = |size: [f64; 3], pos: [f64; 3]| {
        json!({"kind": "mark.box@1", "params": {"size": size}, "material": "stone",
            "at": {"pos": pos}})
    };
    match with {
        With::Wall => items.push(("wall", stone([8.0, 6.0, 0.2], [0.0, 1.0, 3.0]))),
        With::Post => items.push(("post", stone([0.5, 3.0, 0.2], [0.0, 1.0, -1.5]))),
        With::Nothing => {}
    }
    let items: serde_json::Map<String, Value> = (items.into_iter().enumerate())
        .map(|(k, (id, mut item))| {
            item["id"] = json!(id);
            item["name"] = json!(id);
            item["order"] = json!(format!("a{k:03}"));
            item["layer"] = json!("main");
            (id.to_string(), item)
        })
        .collect();
    let doc = json!({
        "format": 1, "profile": "scene", "title": "T", "size": [160, 120], "camera": "cam",
        "layers": {"main": {"writer": "w", "title": "Main", "order": "a0"}},
        "items": items,
    });
    let mut labels = Labels::new();
    let mut frames = Frames::new(&doc, &look(), &mut labels).unwrap();
    frames
        .at(0, [160, 120], &Default::default(), &mut labels)
        .unwrap();
    frames.scene().clone()
}

#[test]
fn an_element_behind_another_element_of_its_instancer_draws_no_hidden_view() {
    let gpu = Gpu::open(Backend::Gpu).expect("this test runs on the machine's GPU");
    let device = gpu.device();
    let draw = |scene: &Scene| {
        let mut renderer = Renderer::new(&device, Planted::default());
        let bytes = draw_offscreen(&device, &mut renderer, scene, &look(), None).expect("a frame");
        (bytes, renderer.counts().hidden_views.clone())
    };
    let differing =
        |a: &[u8], b: &[u8]| a.chunks(4).zip(b.chunks(4)).filter(|(x, y)| x != y).count();

    // The pass runs and draws: behind a wall the bricks show through it.
    let (walled, none) = draw(&scene(None, With::Wall));
    let (through, drawn) = draw(&scene(Some(0.4), With::Wall));
    assert!(none.is_empty(), "no hidden view, no pass: {none:?}");
    assert_eq!(drawn, ["bricks"], "one item's hidden view draws");
    assert!(
        differing(&walled, &through) > 500,
        "the bricks show through the wall: {} pixels differ",
        differing(&walled, &through)
    );

    // In plain sight nothing hides the item, the far brick behind the near one included.
    let (plain, _) = draw(&scene(None, With::Nothing));
    let (viewed, drawn) = draw(&scene(Some(0.4), With::Nothing));
    assert_eq!(drawn, ["bricks"], "its passes run in plain sight too");
    assert_eq!(
        differing(&plain, &viewed),
        0,
        "pixels the hidden view changed where only the item's own clay brick hides its slate one"
    );
    // A part that writes no depth and no object ID is still its item's nearest surface: behind
    // the additive brick, in plain sight, the post hides the item's tile, and nothing draws.
    let (plain, _) = draw(&scene(None, With::Post));
    let (viewed, drawn) = draw(&scene(Some(0.4), With::Post));
    assert_eq!(
        drawn,
        ["bricks"],
        "its passes run behind the additive brick"
    );
    assert_eq!(
        differing(&plain, &viewed),
        0,
        "pixels the hidden view changed where the item's nearest surface, the additive brick, shows"
    );
}

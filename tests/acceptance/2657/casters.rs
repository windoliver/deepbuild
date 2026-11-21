//! #2657.6e8cb3fb (AC2): a whole prepare of a scene with 1,000 casters under a four-cascade sun
//! scans each caster's vertices once, counted by the test, and its cascade matrices equal the merge
//! base's bit for bit.
//!
//! 1,000 balls (built meshes, 12 segments), 40 × 25 on a 2 m grid, each casting, under a sun with
//! a shadow and four cascades, seen by a perspective camera. Two whole prepares on the noop lane,
//! each read alone: the caster pass's scans (`shadow::caster_scans()`, README: Surfaces) and the
//! four cascades' light clip matrices (`Counts::shadow_maps`), whose bits must equal those the
//! merge base computed for the same scene (fixtures/cascades.json, recorded from the base's run).

mod common;

use common::*;
use deep_scene3d_render::Planted;
use serde_json::{json, Value};

const ID: &str = "#2657.6e8cb3fb";
const CASTERS: usize = 1000;

fn field() -> Value {
    let mut items = vec![
        ("cam".to_string(), camera([0.0, 0.0, 0.0], 70.0)),
        ("sun".to_string(), json!({"kind": "light.sun@1", "params": {"illuminance": 3, "color": [1, 1, 1], "shadow": true, "cascades": 4}, "at": {"rot": [-50, 30, 0]}})),
        ("clay".to_string(), json!({"kind": "material@1", "params": {"base_color": [0.7, 0.45, 0.3, 1], "roughness": 0.6}})),
    ];
    for i in 0..CASTERS {
        let (x, z) = ((i % 40) as f64 * 2.0 - 39.0, (i / 40) as f64 * 2.0 - 24.0);
        items.push((
            format!("ball-{i:04}"),
            json!({"kind": "ball@1", "params": {"radius": 0.5, "segments": 12}, "material": "clay", "at": {"pos": [x, 0.5, z]}}),
        ));
    }
    doc(items, json!({}), SIZE)
}

/// Each cascade's light clip matrix, as the bits of its 16 numbers in hex.
fn bits(clips: &[[f64; 16]]) -> Vec<Vec<String>> {
    clips.iter().map(|c| c.iter().map(|v| format!("{:016x}", v.to_bits())).collect()).collect()
}

#[test]
fn ac2_a_whole_prepare_scans_each_caster_once_and_its_cascades_equal_the_base() {
    let scene = scene(&field(), 0);
    let meshed = solids(&scene).filter(|s| s.cast_shadow && s.mesh.is_some()).count();
    assert_eq!(meshed, CASTERS, "{ID}: the field has {CASTERS} casting balls, each a built mesh");
    let base = fixture("cascades.json")["clips"].clone();
    let device = noop();
    let mut r = renderer(&device, Planted::default());
    let mut problems = Vec::new();
    for n in 1..=2 {
        let before = deep_scene3d_render::shadow::caster_scans();
        let slot = slot(&device, scene.size);
        r.prepare(&device, &scene, &look());
        let scans = deep_scene3d_render::shadow::caster_scans() - before;
        record(&device, &mut r, &slot);
        if scans != CASTERS as u64 {
            problems.push(format!(
                "whole prepare {n} scans the casters' vertices {scans} times for {CASTERS} casters (expected {CASTERS}, once each)"
            ));
        }
        let clips: Vec<[f64; 16]> = r.counts().shadow_maps.iter().map(|m| m.2).collect();
        if clips.len() != 4 {
            problems.push(format!("whole prepare {n} draws from {} cascades, not 4", clips.len()));
        }
        let now = serde_json::to_value(bits(&clips)).expect("bits serialize");
        if now != base {
            problems.push(format!(
                "whole prepare {n}'s cascade matrices differ from the merge base's: they are {now}, the base's {base}"
            ));
        }
    }
    no_errors(&device);
    assert!(problems.is_empty(), "{ID}: 1,000 casters under a four-cascade sun:\n{}", problems.join("\n"));
}

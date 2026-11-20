//! #2240: the fixtures that hold a body's weight to where its `centre_of_mass` writes it
//! (Physics: behavior kit). A 100 kg box 1 m wide and 2 m tall on a static slope, both of
//! friction 2, tips at atan(0.5 ÷ 1.0) = 26.57° with no `centre_of_mass` and at atan(0.5 ÷ 0.25)
//! = 63.43° with it 0.25 m above its base. A uniform 1 m bar on a hinge at its top end, released
//! from 10°, swings with a period of 2π√(2L ÷ 3g) × (1 + θ² ÷ 16) = 1.641 s, and with
//! `centre_of_mass` 0.75 m from the hinge 2π√((L² ÷ 12 + 0.75²) ÷ (0.75 g)) × (1 + θ² ÷ 16) =
//! 1.865 s.

use serde_json::json;

use super::fixtures::{dynamic, fixture, material, world, G};
use super::{Fixture, Measure, Tolerance};
use deep_canvas::ops;

/// The angle, deg, of the turn that takes orientation `a` to `b` (quaternions `[x, y, z, w]`).
pub(super) fn turn_between(a: [f64; 4], b: [f64; 4]) -> f64 {
    // b ⊗ a⁻¹: its vector part is as long as sin(θ ÷ 2) and its w is cos(θ ÷ 2).
    let cross = |i: usize, j: usize| b[i] * a[j] - b[j] * a[i];
    let v = [0, 1, 2].map(|i| a[3] * b[i] - b[3] * a[i] - cross((i + 1) % 3, (i + 2) % 3));
    let sin = ops::sqrt(v.iter().map(|x| x * x).sum());
    let cos: f64 = (0..4).map(|i| a[i] * b[i]).sum();
    ops::deg(2.0 * ops::atan2(sin, cos.abs()))
}

/// The box standing 3 s on a slope of `slope`°, its weight 0.25 m above its base when `low`: it
/// turns less than 1°, or past 45° where it `topples`.
fn box_on_slope(name: &'static str, slope: f64, low: bool, topples: bool) -> Fixture {
    let (s, c) = (ops::sin(ops::rad(slope)), ops::cos(ops::rad(slope)));
    let rot = json!([0, 0, slope]);
    let mut on = json!({"pose": {"pos": [-s, c, 0], "rot": rot}, "mass": 100});
    if low {
        on["centre_of_mass"] = json!([0, -0.75, 0]);
    }
    // The slope's top face passes through the origin, and the box's base rests on it.
    let w = world(json!({
        "contact_materials": {"m": material(2.0, 0.0)},
        "shapes": {"box": {"kind": "box", "half": [0.5, 1, 0.5]}, "slope": {"kind": "box", "half": [10, 0.5, 5]}},
        "bodies": {"slope": {"kind": "static", "shapes": [{"shape": "slope", "contact_material": "m"}],
                             "pose": {"pos": [0.5 * s, -0.5 * c, 0], "rot": rot}},
                   "box": dynamic("box", "m", [0.0; 3], on)}}));
    let (answer, tolerance) = if topples { (45.0, 0.0) } else { (0.0, 1.0) };
    let m = Measure::Turn { body: "box" };
    let mut f = fixture(name, w, 360, m, answer, Tolerance::Deg(tolerance));
    f.past = topples;
    f
}

/// The bar hung from the world by a hinge at its top end, built turned 10° from hanging, its
/// weight 0.75 m from the hinge when `low`, else at its middle.
fn bar(name: &'static str, low: bool) -> Fixture {
    let th = ops::rad(10.0);
    let (s, c) = (ops::sin(th), ops::cos(th));
    let mut on =
        json!({"pose": {"pos": [0.5 * s, 2.0 - 0.5 * c, 0], "rot": [0, 0, 10]}, "mass": 1});
    if low {
        on["centre_of_mass"] = json!([0, -0.25, 0]);
    }
    let w = world(json!({
        "contact_materials": {"m": material(0.0, 0.0)},
        "shapes": {"bar": {"kind": "box", "half": [0.02, 0.5, 0.02]}},
        "bodies": {"bar": dynamic("bar", "m", [0.0; 3], on)},
        "joints": {"pin": {"kind": "hinge", "a": "world", "b": "bar",
                           "frame_a": {"anchor": [0, 2, 0], "axis": [0, 0, 1]}, "frame_b": {"anchor": [0, 0.5, 0], "axis": [0, 0, 1]}}}}));
    // 2π√(I ÷ (m g d)) × (1 + θ² ÷ 16): the bar's own L² ÷ 12 and its centre's d² from the hinge.
    let d = if low { 0.75 } else { 0.5 };
    let swing = ops::sqrt((1.0 / 12.0 + d * d) / (d * G));
    let answer = 2.0 * std::f64::consts::PI * swing * (1.0 + th * th / 16.0);
    let m = Measure::Period { body: "bar" };
    fixture(name, w, 360, m, answer, Tolerance::Relative(0.01))
}

/// The box's four runs and the bar's two.
pub fn all() -> Vec<Fixture> {
    vec![
        box_on_slope("box_slope_20", 20.0, false, false),
        box_on_slope("box_slope_33", 33.0, false, true),
        box_on_slope("box_slope_33_centre", 33.0, true, false),
        box_on_slope("box_slope_45_centre", 45.0, true, false),
        bar("bar_period", false),
        bar("bar_period_centre", true),
    ]
}

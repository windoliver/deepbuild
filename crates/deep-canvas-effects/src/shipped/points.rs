//! `points.video@1` (#503; canvas primitives: Marks in 3D): a depth video's frame at t as one
//! point per `step`-th pixel. Element e is pixel (u, v) = ((e mod cols) × step, (e div cols) ×
//! step) of the w × h frame, cols = w ÷ step, and the elements are (w ÷ step) × (h ÷ step). Its
//! depth value d is its red code ÷ 255, or its luma (0.2126 R + 0.7152 G + 0.0722 B) ÷ 255, read
//! from the frame's decoded 8-bit R′G′B′ words (red in the low byte, as RGBA8 bytes lie), never
//! sRGB-decoded; it sits at z = far + d × (near − far), so white is near, and at (((u + 0.5) ÷ w −
//! 0.5) × 2z × tan_x, (0.5 − (v + 0.5) ÷ h) × 2z × tan_y, −z) in the item's space, which the item's
//! world rows place. Each point is written as the 3D point pipeline's instance record.

use serde_json::{json, Value};

use super::{param, set_when, G};
use crate::check::MAX_ELEMENTS;

/// The words of one point, the 3D point pipeline's record: its world position and size as f32
/// bits, its color packed as RGBA8 bytes (opaque), its pick ID (0: the set's points are display
/// only), its flags (bit 0 a size in m, bits 1–2 the shape) and a pad.
pub const POINT_WORDS: u32 = 8;

pub fn points() -> Value {
    let mut g = G::new();
    let k = |g: &mut G, v: u32| g.ty(json!(v), "u32");
    let e = g.s("element@1", json!({}));
    let cols = g.div("width", "step");
    let rows = g.div("height", "step");
    let count = g.mul(&cols, &rows);
    let inside = g.s("lt@1", json!({"a": e, "b": count}));
    let col = g.s("rem@1", json!({"a": e, "b": cols}));
    let row = g.div(&e, &cols);
    let u = g.mul(&col, "step");
    let v = g.mul(&row, "step");
    let line = g.mul(&v, "width");
    let at = g.add(&line, &u);
    let word = g.s("read@1", json!({"buf": "frame", "i": at}));
    let code = |g: &mut G, shift: u32| {
        let by = k(g, shift);
        let shifted = g.s("shr@1", json!({"a": word, "b": by}));
        let byte = k(g, 255);
        let c = g.s("and@1", json!({"a": shifted, "b": byte}));
        g.convert(&c, "f32")
    };
    let r = code(&mut g, 0);
    let gc = code(&mut g, 8);
    let b = code(&mut g, 16);
    let rgb = g.s("compose@1", json!({"x": r, "y": gc, "z": b}));
    let weights = g.c(json!([0.2126, 0.7152, 0.0722]));
    let luma = g.s("dot@1", json!({"a": rgb, "b": weights}));
    let zero = k(&mut g, 0);
    let by_red = g.s("ne@1", json!({"a": "red", "b": zero}));
    let code = g.select(&luma, &r, &by_red);
    let d = g.s("div@1", json!({"a": code, "b": 255.0}));
    let span = g.sub("near", "far");
    let dz = g.mul(&d, &span);
    let z = g.add("far", &dz);
    let half = g.c(json!(0.5));
    let across = |g: &mut G, at: &str, of: &str| {
        let atf = g.convert(at, "f32");
        let ofr = g.convert(of, "f32");
        let centre = g.add(&atf, &half);
        g.div(&centre, &ofr)
    };
    let fu = across(&mut g, &u, "width");
    let fv = across(&mut g, &v, "height");
    let nx = g.sub(&fu, &half);
    let ny = g.sub(&half, &fv);
    let z2 = g.mulk(&z, 2.0);
    let tx = g.split("tan", "x");
    let ty = g.split("tan", "y");
    let x = g.mul(&nx, &z2);
    let x = g.mul(&x, &tx);
    let y = g.mul(&ny, &z2);
    let y = g.mul(&y, &ty);
    let back = g.s("neg@1", json!({"x": z}));
    let one = g.c(json!(1.0));
    let local = g.s("compose@1", json!({"x": x, "y": y, "z": back, "w": one}));
    // Its color: the pixel's codes, opaque, unless the paint names one (a packed word, never 0).
    let low = k(&mut g, 0x00FF_FFFF);
    let rgb_bits = g.s("and@1", json!({"a": word, "b": low}));
    let alpha = k(&mut g, 0xFF00_0000);
    let opaque = g.s("or@1", json!({"a": rgb_bits, "b": alpha}));
    let painted = g.s("ne@1", json!({"a": "paint", "b": zero}));
    let color = g.select(&opaque, "paint", &painted);
    let bits = |g: &mut G, f: &str| g.s("bitcast@1", json!({"x": f, "to": "u32"}));
    let mut words = Vec::new();
    for r in ["row0", "row1", "row2"] {
        let w = g.s("dot@1", json!({"a": r, "b": local}));
        words.push(bits(&mut g, &w));
    }
    words.push(bits(&mut g, "point_size"));
    words.extend([color, zero.clone(), "flags".to_string(), zero]);
    let stride = k(&mut g, POINT_WORDS);
    let base = g.mul(&e, &stride);
    for (j, w) in words.iter().enumerate() {
        let j = k(&mut g, j as u32);
        let at = g.add(&base, &j);
        let id = g.s("write@1", json!({"buf": "points", "i": at, "v": w}));
        set_when(&mut g, &id, &inside);
    }
    let rows_in = |i: usize| {
        let mut r = [0.0; 4];
        r[i] = 1.0;
        param(&format!("points.row{i}"), "vec4", json!(r), [-1e9, 1e9])
    };
    json!({
        "id": "points.video@1", "kind": "compute", "origin": "shipped",
        "about": "A depth video's frame as points: each step-th pixel at the depth its red or luma gives between near and far, unprojected through the field of view and placed by the item's world rows, written as the 3D point pipeline's records.",
        "inputs": {
            "frame": {"type": "u32", "from": {"storage": {"op": "core", "output": "video"}}},
            "width": param("points.width", "u32", json!(1), [1.0, 65536.0]),
            "height": param("points.height", "u32", json!(1), [1.0, 65536.0]),
            "step": param("points.step", "u32", json!(1), [1.0, 8.0]),
            "near": param("points.near", "f32", json!(1.0), [1e-6, 1e9]),
            "far": param("points.far", "f32", json!(2.0), [1e-6, 1e9]),
            "tan": param("points.tan", "vec2", json!([1.0, 1.0]), [0.0, 1e9]),
            "red": param("points.red", "u32", json!(0), [0.0, 1.0]),
            "row0": rows_in(0),
            "row1": rows_in(1),
            "row2": rows_in(2),
            "point_size": param("points.size", "f32", json!(4.0), [0.0, 1e9]),
            "flags": param("points.flags", "u32", json!(0), [0.0, 7.0]),
            "paint": param("points.paint", "u32", json!(0), [0.0, f64::from(u32::MAX)]),
        },
        "steps": g.done(),
        "outputs": {"points": {"storage": {"type": "u32", "count": MAX_ELEMENTS * POINT_WORDS}}},
        "elements": MAX_ELEMENTS, "workgroup": 64,
        "determinism": "same_machine", "cost": {"ns_per_element": 0.03},
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::interp::{self, Env};
    use deep_canvas::ops::{rad, tan};
    use std::collections::BTreeMap;

    /// A 4 × 2 frame of RGBA8 words, red in the low byte: grays, primaries and a mix.
    const FRAME: [[u8; 4]; 8] = [
        [255, 255, 255, 255],
        [0, 0, 0, 255],
        [128, 128, 128, 255],
        [255, 0, 0, 255],
        [0, 255, 0, 255],
        [0, 0, 255, 255],
        [10, 200, 90, 255],
        [64, 32, 16, 255],
    ];
    const W: u32 = 4;
    const H: u32 = 2;
    /// A world that turns the set a quarter about +Y and moves it.
    const MODEL: [[f64; 4]; 3] = [
        [0.0, 0.0, 1.0, 0.5],
        [0.0, 1.0, 0.0, -1.0],
        [-1.0, 0.0, 0.0, 2.0],
    ];

    struct Case {
        step: u32,
        red: bool,
        paint: u32,
    }

    /// The operator over its first 16 elements on the CPU reference, each storage word.
    fn run(c: &Case) -> Vec<u32> {
        let mut op = points();
        op["elements"] = json!(16);
        op["outputs"]["points"]["storage"]["count"] = json!(16 * POINT_WORDS);
        let checked = crate::check::read_and_check(&op).expect("points.video@1 checks");
        let t = [tan(rad(60.0) / 2.0), tan(rad(45.0) / 2.0)];
        let params: BTreeMap<String, Value> = [
            ("points.width", json!(W)),
            ("points.height", json!(H)),
            ("points.step", json!(c.step)),
            ("points.near", json!(1.0)),
            ("points.far", json!(5.0)),
            ("points.tan", json!(t)),
            ("points.red", json!(u32::from(c.red))),
            ("points.row0", json!(MODEL[0])),
            ("points.row1", json!(MODEL[1])),
            ("points.row2", json!(MODEL[2])),
            ("points.size", json!(3.0)),
            ("points.flags", json!(5)),
            ("points.paint", json!(c.paint)),
        ]
        .into_iter()
        .map(|(k, v)| (k.to_string(), v))
        .collect();
        let env = Env {
            t: 0.0,
            seed: 0,
            clip: [0.0; 16],
            inverse_clip: [0.0; 16],
            eye: [0.0; 4],
            inputs: interp::inputs(&checked, &params, &BTreeMap::new()),
            textures: BTreeMap::new(),
            normals: [[0.0; 3]; 3],
        };
        let words = FRAME.iter().map(|p| f64::from(u32::from_le_bytes(*p)));
        let storage = BTreeMap::from([("frame".to_string(), words.collect())]);
        let out = interp::compute(&checked, &env, storage).expect("it runs");
        out["points"].iter().map(|w| *w as u32).collect()
    }

    /// The criterion's unprojection in f64, from the pixel's own codes, then the world rows.
    fn expected(u: u32, v: u32, red: bool) -> [f64; 3] {
        let [r, g, b, _] = FRAME[(v * W + u) as usize].map(f64::from);
        let d = if red {
            r
        } else {
            0.2126 * r + 0.7152 * g + 0.0722 * b
        } / 255.0;
        let z = 5.0 + d * (1.0 - 5.0);
        let x = ((f64::from(u) + 0.5) / f64::from(W) - 0.5) * 2.0 * z * tan(rad(30.0));
        let y = (0.5 - (f64::from(v) + 0.5) / f64::from(H)) * 2.0 * z * tan(rad(22.5));
        MODEL.map(|m| m[0] * x + m[1] * y + m[2] * -z + m[3])
    }

    /// Each element's eight words against the closed form: its position within 1e-6 m, its size,
    /// its color (the pixel's codes, or the paint), pick 0, its flags and pad; nothing past the
    /// last element.
    #[test]
    fn each_point_is_its_pixels_unprojection_written_as_a_point_record() {
        for c in [
            Case {
                step: 1,
                red: false,
                paint: 0,
            },
            Case {
                step: 1,
                red: true,
                paint: 0,
            },
            Case {
                step: 2,
                red: false,
                paint: 0,
            },
            Case {
                step: 2,
                red: true,
                paint: 0xFF10_2030,
            },
        ] {
            let words = run(&c);
            let cols = W / c.step;
            let n = (cols * (H / c.step)) as usize;
            let what = format!("step {}, red {}", c.step, c.red);
            for e in 0..n {
                let (u, v) = ((e as u32 % cols) * c.step, (e as u32 / cols) * c.step);
                let at = &words[e * 8..e * 8 + 8];
                let want = expected(u, v, c.red);
                for (lane, want) in want.iter().enumerate() {
                    let got = f64::from(f32::from_bits(at[lane]));
                    assert!(
                        (got - want).abs() < 1e-6,
                        "{what}: pixel ({u}, {v}) lane {lane}: {got} for {want}"
                    );
                }
                assert_eq!(f32::from_bits(at[3]), 3.0, "{what}: the size");
                let [r, g, b, _] = FRAME[(v * W + u) as usize];
                let color = if c.paint != 0 {
                    c.paint
                } else {
                    u32::from_le_bytes([r, g, b, 255])
                };
                assert_eq!(
                    at[4..],
                    [color, 0, 5, 0],
                    "{what}: pixel ({u}, {v})'s color, pick, flags, pad"
                );
            }
            assert!(
                words[n * 8..].iter().all(|w| *w == 0),
                "{what}: a word written past {n} points"
            );
        }
    }
}

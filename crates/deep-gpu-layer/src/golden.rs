//! GPU goldens (issue #380; tests/acceptance/380/README.md, golden and decide): a GPU frame's
//! snapshot judged against its fixture's golden through the perceptual oracle, only under the
//! environment fingerprint the golden was blessed under (canvas primitives: Determinism class, "a
//! golden recorded under another fingerprint reads INCONCLUSIVE, naming both"), the blank guard
//! first. A missing golden or snapshot is BLOCKED, never FAIL. Only your decision blesses one.
//!
//! The oracle is FLIP (Andersson et al., "FLIP: A Difference Evaluator for Alternating Images",
//! 2020), written here from the paper: a color pipeline (spatial filtering by the eye's contrast
//! sensitivity in YCxCz, Hunt-adjusted L*a*b*, HyAB distance) and a feature pipeline (edges and
//! points), pooled with its guards: the mean, and every 16 × 16 window, so a wrong small feature
//! can't hide in the mean.

use std::path::{Path, PathBuf};

use serde_json::{json, Value};

use crate::frames::hex;
use crate::{refused, view3d, App, Planted};

/// Pooled mean FLIP at most this passes.
pub const MEAN: f64 = 0.01;
/// Every 16 × 16 window's mean FLIP at most this passes.
pub const WINDOW: f64 = 0.05;
/// Pixels per degree: a 0.7 m wide 4K screen seen from 0.7 m, the paper's default.
const PPD: f64 = 67.0;

/// The OS's version and build.
pub fn os() -> String {
    let get = |k: &str| {
        std::process::Command::new("sw_vers")
            .arg(k)
            .output()
            .ok()
            .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
            .unwrap_or_default()
    };
    match (get("-productVersion"), get("-buildVersion")) {
        (v, b) if !v.is_empty() => format!("{v} ({b})"),
        _ => std::env::consts::OS.to_string(),
    }
}

/// This run's fingerprint: the OS, the GPU, its driver and the wgpu this binary is built with.
fn fingerprint(app: &App) -> Value {
    let info = app.worker.call(|state| state.gpu.device().adapter.clone());
    let (gpu, driver) = match info {
        Some(i) => {
            let d = format!("{} {}", i.driver, i.driver_info).trim().to_string();
            (
                i.name,
                if d.is_empty() {
                    format!("{:?}", i.backend)
                } else {
                    d
                },
            )
        }
        None => ("noop".into(), "noop".into()),
    };
    json!({"os": os(), "gpu": gpu, "driver": driver, "wgpu": env!("DEEP_WGPU_VERSION")})
}

fn store_paths(store: &str, fixture: &str) -> (PathBuf, PathBuf) {
    let dir = Path::new(store);
    (
        dir.join(format!("{fixture}.golden.json")),
        dir.join(format!("{fixture}.png")),
    )
}

fn rgba(bytes: &[u8]) -> Option<image::RgbaImage> {
    image::load_from_memory(bytes).ok().map(|i| i.to_rgba8())
}

fn blank(img: &image::RgbaImage) -> bool {
    let dark = img
        .pixels()
        .filter(|p| {
            (0.2126 * f64::from(p[0]) + 0.7152 * f64::from(p[1]) + 0.0722 * f64::from(p[2])) / 255.0
                <= 0.06
        })
        .count();
    dark as f64 >= 0.98 * f64::from(img.width() * img.height())
}

/// `decide`: your blessing records the PNG as the fixture's golden under this run's fingerprint;
/// an agent's is refused.
pub fn decide(app: &mut App, call: &Value) -> Value {
    if call["via"] != "you" {
        return json!({"outcome": "refused", "code": "not_your_decision", "reason": "only your decision blesses a golden"});
    }
    let (Some(store), Some(fixture), Some(png)) = (
        call["store"].as_str(),
        call["decision"]["bless"]["fixture"].as_str(),
        call["decision"]["bless"]["png"].as_str(),
    ) else {
        return refused(
            "bad_input",
            "decide takes a store and a bless {fixture, png}",
        );
    };
    let Ok(bytes) = std::fs::read(png) else {
        return json!({"outcome": "refused", "code": "no_snapshot", "reason": format!("{png} isn't there")});
    };
    let (meta, image) = store_paths(store, fixture);
    let record =
        json!({"fixture": fixture, "fingerprint": fingerprint(app), "digest": hex(&bytes)});
    let written = std::fs::create_dir_all(store)
        .and_then(|()| std::fs::write(&image, &bytes))
        .and_then(|()| {
            std::fs::write(
                &meta,
                serde_json::to_vec_pretty(&record).unwrap_or_default(),
            )
        });
    match written {
        Ok(()) => json!({"outcome": "decided"}),
        Err(e) => refused("not_written", e.to_string()),
    }
}

/// `golden`: a snapshot against its fixture's golden.
pub fn golden(app: &mut App, out: &str, call: &Value) -> Value {
    let (Some(store), Some(fixture)) = (call["store"].as_str(), call["fixture"].as_str()) else {
        return refused("bad_input", "golden takes a store and a fixture");
    };
    let mut fp = fingerprint(app);
    if let Some(env) = call["environment"].as_object() {
        for (k, v) in env {
            fp[k.as_str()] = v.clone();
        }
    }
    let fails_missing = app.planted == Some(Planted::FailsMissingSnapshot);
    let any_environment = app.planted == Some(Planted::ComparesAnyEnvironment);
    let blocked = |reason: &str, extra: Value| {
        let mut r = json!({"verdict": "BLOCKED", "reason": reason, "fingerprint": fp, "golden": null, "oracle": "perceptual"});
        if let (Some(r), Some(e)) = (r.as_object_mut(), extra.as_object()) {
            r.extend(e.clone());
        }
        r
    };
    let missing = |reason: &str| {
        if fails_missing {
            json!({"verdict": "FAIL", "reason": reason, "fingerprint": fp, "golden": null, "oracle": "perceptual"})
        } else {
            blocked(reason, json!({}))
        }
    };
    // The snapshot: a PNG, or frame 0's final target of a view3d call.
    let snapshot = if let Some(png) = call["png"].as_str() {
        std::fs::read(png).ok()
    } else if call["view3d"].is_object() {
        let mut v = call["view3d"].clone();
        v["targets"] = json!(["final"]);
        v["capture"] = json!([0]);
        v["frames"] = json!(1);
        let reply = view3d::call(app, out, &v);
        reply["frames"][0]["final"]
            .as_str()
            .and_then(|h| std::fs::read(Path::new(out).join(format!("{h}.png"))).ok())
    } else {
        None
    };
    let Some(snapshot) = snapshot else {
        return missing("no_snapshot");
    };
    let (meta, image) = store_paths(store, fixture);
    let Some(record) = std::fs::read_to_string(&meta)
        .ok()
        .and_then(|t| serde_json::from_str::<Value>(&t).ok())
    else {
        return blocked(
            "no_golden",
            json!({"ask": {"kind": "bless", "fixture": fixture, "ask": "bless this fixture's golden by your decision"}}),
        );
    };
    let golden = json!({"fingerprint": record["fingerprint"], "digest": record["digest"]});
    if record["fingerprint"] != fp && !any_environment {
        let changed: Vec<Value> = ["os", "gpu", "driver", "wgpu"]
            .iter()
            .filter(|k| record["fingerprint"][**k] != fp[**k])
            .map(|k| json!({"field": k, "golden": record["fingerprint"][*k], "run": fp[*k]}))
            .collect();
        return json!({
            "verdict": "INCONCLUSIVE", "reason": "environment_changed", "fingerprint": fp, "golden": golden,
            "oracle": "perceptual", "changed": changed,
            "ask": {"kind": "bless", "fixture": fixture, "ask": "record this fixture's golden again under this environment"},
        });
    }
    let (Some(a), Some(b)) = (
        std::fs::read(&image).ok().as_deref().and_then(rgba),
        rgba(&snapshot),
    ) else {
        return missing("no_snapshot");
    };
    if blank(&a) || blank(&b) {
        return json!({"verdict": "BLOCKED", "reason": "blank", "fingerprint": fp, "golden": golden, "oracle": "perceptual"});
    }
    if a.dimensions() != b.dimensions() {
        return json!({"verdict": "FAIL", "reason": "size", "fingerprint": fp, "golden": golden, "oracle": "perceptual",
            "numbers": {"golden_size": [a.width(), a.height()], "snapshot_size": [b.width(), b.height()]}});
    }
    let e = flip(&a, &b);
    let (mean, window, p99) = pool(&e, a.width() as usize, a.height() as usize);
    let pass = mean <= MEAN && window <= WINDOW;
    json!({
        "verdict": if pass { "PASS" } else { "FAIL" },
        "fingerprint": fp, "golden": golden, "oracle": "perceptual",
        "numbers": {"flip_mean": mean, "flip_worst_window": window, "flip_p99": p99, "mean_limit": MEAN, "window_limit": WINDOW},
    })
}

/// The pooled mean, the worst 16 × 16 window's mean (stride 8) and the 99th percentile.
fn pool(e: &[f64], w: usize, h: usize) -> (f64, f64, f64) {
    let mean = e.iter().sum::<f64>() / e.len().max(1) as f64;
    let mut worst: f64 = 0.0;
    let mut y = 0;
    while y + 16 <= h {
        let mut x = 0;
        while x + 16 <= w {
            let s: f64 = (y..y + 16)
                .map(|yy| e[yy * w + x..yy * w + x + 16].iter().sum::<f64>())
                .sum();
            worst = worst.max(s / 256.0);
            x += 8;
        }
        y += 8;
    }
    let mut sorted = e.to_vec();
    sorted.sort_by(f64::total_cmp);
    let p99 = sorted
        .get(((sorted.len() as f64) * 0.99) as usize)
        .copied()
        .unwrap_or(0.0);
    (mean, worst, p99)
}

fn srgb_to_linear(v: f64) -> f64 {
    if v <= 0.04045 {
        v / 12.92
    } else {
        ((v + 0.055) / 1.055).powf(2.4)
    }
}

const WHITE: [f64; 3] = [0.950_428_5, 1.0, 1.088_900];

fn rgb_to_xyz(c: [f64; 3]) -> [f64; 3] {
    [
        0.412_390_8 * c[0] + 0.357_584_3 * c[1] + 0.180_480_8 * c[2],
        0.212_639 * c[0] + 0.715_168_7 * c[1] + 0.072_192_3 * c[2],
        0.019_330_8 * c[0] + 0.119_194_8 * c[1] + 0.950_532_2 * c[2],
    ]
}

fn xyz_to_rgb(c: [f64; 3]) -> [f64; 3] {
    [
        3.240_969_9 * c[0] - 1.537_383_2 * c[1] - 0.498_610_8 * c[2],
        -0.969_243_6 * c[0] + 1.875_967_5 * c[1] + 0.041_555_1 * c[2],
        0.055_630_1 * c[0] - 0.203_977 * c[1] + 1.056_971_5 * c[2],
    ]
}

/// FLIP's YCxCz: a linearized L*a*b*.
fn xyz_to_ycxcz(c: [f64; 3]) -> [f64; 3] {
    let (x, y, z) = (c[0] / WHITE[0], c[1] / WHITE[1], c[2] / WHITE[2]);
    [116.0 * y - 16.0, 500.0 * (x - y), 200.0 * (y - z)]
}

fn ycxcz_to_xyz(c: [f64; 3]) -> [f64; 3] {
    let y = (c[0] + 16.0) / 116.0;
    [
        (y + c[1] / 500.0) * WHITE[0],
        y * WHITE[1],
        (y - c[2] / 200.0) * WHITE[2],
    ]
}

fn xyz_to_lab(c: [f64; 3]) -> [f64; 3] {
    let f = |t: f64| {
        let d: f64 = 6.0 / 29.0;
        if t > d * d * d {
            t.cbrt()
        } else {
            t / (3.0 * d * d) + 4.0 / 29.0
        }
    };
    let (x, y, z) = (f(c[0] / WHITE[0]), f(c[1] / WHITE[1]), f(c[2] / WHITE[2]));
    [116.0 * y - 16.0, 500.0 * (x - y), 200.0 * (y - z)]
}

fn hunt(lab: [f64; 3]) -> [f64; 3] {
    [lab[0], 0.01 * lab[0] * lab[1], 0.01 * lab[0] * lab[2]]
}

fn hyab(a: [f64; 3], b: [f64; 3]) -> f64 {
    (a[0] - b[0]).abs() + ((a[1] - b[1]).powi(2) + (a[2] - b[2]).powi(2)).sqrt()
}

/// A separable 1D kernel from the contrast-sensitivity sum of Gaussians (a1, b1, a2, b2).
fn csf_kernel(a1: f64, b1: f64, a2: f64, b2: f64) -> Vec<f64> {
    let pi = std::f64::consts::PI;
    let radius = (3.0 * (b1.max(b2) / (2.0 * pi * pi)).sqrt() * PPD).ceil() as i64;
    let g = |x: f64, a: f64, b: f64| a * (pi / b).sqrt() * (-pi * pi * x * x / b).exp();
    let k: Vec<f64> = (-radius..=radius)
        .map(|i| {
            let x = i as f64 / PPD;
            g(x, a1, b1) + g(x, a2, b2)
        })
        .collect();
    let s: f64 = k.iter().sum();
    k.into_iter().map(|v| v / s).collect()
}

fn convolve(src: &[f64], w: usize, h: usize, k: &[f64], horizontal: bool) -> Vec<f64> {
    let r = (k.len() / 2) as i64;
    let mut out = vec![0.0; src.len()];
    for y in 0..h {
        for x in 0..w {
            let mut acc = 0.0;
            for (j, kv) in k.iter().enumerate() {
                let d = j as i64 - r;
                let (sx, sy) = if horizontal {
                    ((x as i64 + d).clamp(0, w as i64 - 1) as usize, y)
                } else {
                    (x, (y as i64 + d).clamp(0, h as i64 - 1) as usize)
                };
                acc += kv * src[sy * w + sx];
            }
            out[y * w + x] = acc;
        }
    }
    out
}

fn blur(src: &[f64], w: usize, h: usize, k: &[f64]) -> Vec<f64> {
    convolve(&convolve(src, w, h, k, true), w, h, k, false)
}

/// The color pipeline's filtered, Hunt-adjusted L*a*b* of an image.
fn filtered_lab(img: &image::RgbaImage) -> Vec<[f64; 3]> {
    let (w, h) = (img.width() as usize, img.height() as usize);
    let mut ch = [vec![0.0; w * h], vec![0.0; w * h], vec![0.0; w * h]];
    for (i, p) in img.pixels().enumerate() {
        let lin = [0, 1, 2].map(|c| srgb_to_linear(f64::from(p[c]) / 255.0));
        let ycc = xyz_to_ycxcz(rgb_to_xyz(lin));
        for c in 0..3 {
            ch[c][i] = ycc[c];
        }
    }
    let kernels = [
        csf_kernel(1.0, 0.0047, 0.0, 1e-5),
        csf_kernel(1.0, 0.0053, 0.0, 1e-5),
        csf_kernel(34.1, 0.04, 13.5, 0.025),
    ];
    let f: Vec<Vec<f64>> = (0..3).map(|c| blur(&ch[c], w, h, &kernels[c])).collect();
    (0..w * h)
        .map(|i| {
            let rgb =
                xyz_to_rgb(ycxcz_to_xyz([f[0][i], f[1][i], f[2][i]])).map(|v| v.clamp(0.0, 1.0));
            hunt(xyz_to_lab(rgb_to_xyz(rgb)))
        })
        .collect()
}

/// Edge and point detector responses of an image's achromatic channel.
fn features(img: &image::RgbaImage) -> (Vec<f64>, Vec<f64>) {
    let (w, h) = (img.width() as usize, img.height() as usize);
    let y: Vec<f64> = img
        .pixels()
        .map(|p| {
            let lin = [0, 1, 2].map(|c| srgb_to_linear(f64::from(p[c]) / 255.0));
            (xyz_to_ycxcz(rgb_to_xyz(lin))[0] + 16.0) / 116.0
        })
        .collect();
    let sigma = 0.5 * 0.082 * PPD;
    let r = (3.0 * sigma).ceil() as i64;
    let g: Vec<f64> = (-r..=r)
        .map(|i| (-(i * i) as f64 / (2.0 * sigma * sigma)).exp())
        .collect();
    let gs: f64 = g.iter().sum();
    let g: Vec<f64> = g.iter().map(|v| v / gs).collect();
    let normalize = |k: Vec<f64>| -> Vec<f64> {
        let pos: f64 = k.iter().filter(|v| **v > 0.0).sum();
        let neg: f64 = -k.iter().filter(|v| **v < 0.0).sum::<f64>();
        k.into_iter()
            .map(|v| {
                if v > 0.0 {
                    v / pos
                } else if neg > 0.0 {
                    v / neg
                } else {
                    v
                }
            })
            .collect()
    };
    let d1 = normalize(
        (-r..=r)
            .map(|i| {
                -(i as f64) / (sigma * sigma) * (-(i * i) as f64 / (2.0 * sigma * sigma)).exp()
            })
            .collect(),
    );
    let d2 = normalize(
        (-r..=r)
            .map(|i| {
                ((i * i) as f64 / (sigma * sigma) - 1.0) / (sigma * sigma)
                    * (-(i * i) as f64 / (2.0 * sigma * sigma)).exp()
            })
            .collect(),
    );
    let ex = convolve(&convolve(&y, w, h, &d1, true), w, h, &g, false);
    let ey = convolve(&convolve(&y, w, h, &g, true), w, h, &d1, false);
    let px = convolve(&convolve(&y, w, h, &d2, true), w, h, &g, false);
    let py = convolve(&convolve(&y, w, h, &g, true), w, h, &d2, false);
    (
        (0..w * h)
            .map(|i| (ex[i] * ex[i] + ey[i] * ey[i]).sqrt())
            .collect(),
        (0..w * h)
            .map(|i| (px[i] * px[i] + py[i] * py[i]).sqrt())
            .collect(),
    )
}

/// FLIP per pixel, in [0, 1].
pub fn flip(a: &image::RgbaImage, b: &image::RgbaImage) -> Vec<f64> {
    const QC: f64 = 0.7;
    const PC: f64 = 0.4;
    const PT: f64 = 0.95;
    let (la, lb) = (filtered_lab(a), filtered_lab(b));
    let green = hunt(xyz_to_lab(rgb_to_xyz([0.0, 1.0, 0.0])));
    let blue = hunt(xyz_to_lab(rgb_to_xyz([0.0, 0.0, 1.0])));
    let cmax = hyab(green, blue).powf(QC);
    let (ea, pa) = features(a);
    let (eb, pb) = features(b);
    (0..la.len())
        .map(|i| {
            let d = hyab(la[i], lb[i]).powf(QC);
            let dc = if d < PC * cmax {
                PT / (PC * cmax) * d
            } else {
                PT + (d - PC * cmax) / (cmax - PC * cmax) * (1.0 - PT)
            };
            let df = (std::f64::consts::FRAC_1_SQRT_2
                * (ea[i] - eb[i]).abs().max((pa[i] - pb[i]).abs()))
            .powf(0.5);
            dc.clamp(0.0, 1.0).powf(1.0 - df.clamp(0.0, 1.0))
        })
        .collect()
}

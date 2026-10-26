//! The shipped library (canvas primitives: Shipped operators and composed graphs): each effect a
//! GPU operator built here from the public steps, as data, and checked like any graph before it
//! reaches the GPU. Nothing here is shader text, and nothing is ported: every graph is written
//! for this module, so no shader carries another project's license.
//!
//! - glow: the look's bloom, one shipped pass run as a mip chain (an internal multi-pass chain):
//!   13-tap downsamples, the first a Karis average of its five groups so one bright pixel can't
//!   flicker the chain, tent upsamples, and a mix into scene color before tone mapping; with no
//!   threshold it conserves energy.
//! - shadow: the key light's shadow on drawn items, read from the core's shadow map with an 8-tap
//!   Vogel disk rotated by a hash of the pixel and the item's seed.
//! - grid: the look's ground grid, the plane y = height by ray, its lines anti-aliased by their
//!   footprint in px; a line thinner than a device pixel draws one pixel wide at its width's alpha.
//! - particles: sparks, each a closed form of t, its index and the item's seed, written as
//!   instance columns for the core's instanced draw.
//! - outline: the selection outline, around the items a bitset of pick IDs names.
//! - pixel hash: the determinism check's exact operator, a hash of each pixel's bits.

use serde_json::{json, Map, Value};

use crate::graph::Kind;

/// A shipped operator as the library lists it: its stage graphs run in order as one pass (a
/// multi-pass chain), or its one graph.
#[derive(Clone, Debug)]
pub struct Shipped {
    pub name: &'static str,
    /// The shipped effect it is (`glow`, `shadow`, …), or none for the core's own.
    pub effect: Option<&'static str>,
    pub kind: Kind,
    /// Whether it draws seeded noise or random values.
    pub noise: bool,
    pub stages: Vec<Value>,
}

/// A graph under construction: steps named in the order they're added.
struct G {
    steps: Map<String, Value>,
    n: usize,
    /// Starts every step ID, so a repeat's body never reuses its graph's IDs.
    prefix: &'static str,
}

impl G {
    fn new() -> G {
        G::named("s")
    }

    fn named(prefix: &'static str) -> G {
        G {
            steps: Map::new(),
            n: 0,
            prefix,
        }
    }

    /// Adds a step; `args` are refs (strings) or literals.
    fn s(&mut self, op: &str, args: Value) -> String {
        self.n += 1;
        let id = format!("{}{}_{}", self.prefix, self.n, op.trim_end_matches("@1"));
        self.steps
            .insert(id.clone(), json!({"op": op, "args": args}));
        id
    }

    /// Adds a step under a given ID (a repeat body's step that gives an accumulator's next value).
    fn named_step(&mut self, id: &str, op: &str, args: Value) -> String {
        self.steps
            .insert(id.into(), json!({"op": op, "args": args}));
        id.into()
    }

    fn c(&mut self, value: Value) -> String {
        self.s("const@1", json!({"value": value}))
    }
    fn ty(&mut self, value: Value, ty: &str) -> String {
        self.s("const@1", json!({"value": value, "type": ty}))
    }
    fn add(&mut self, a: &str, b: &str) -> String {
        self.s("add@1", json!({"a": a, "b": b}))
    }
    fn sub(&mut self, a: &str, b: &str) -> String {
        self.s("sub@1", json!({"a": a, "b": b}))
    }
    fn mul(&mut self, a: &str, b: &str) -> String {
        self.s("mul@1", json!({"a": a, "b": b}))
    }
    fn mulk(&mut self, a: &str, k: f64) -> String {
        self.s("mul@1", json!({"a": a, "b": k}))
    }
    fn div(&mut self, a: &str, b: &str) -> String {
        self.s("div@1", json!({"a": a, "b": b}))
    }
    fn split(&mut self, x: &str, pick: &str) -> String {
        self.s("split@1", json!({"x": x, "pick": pick}))
    }
    fn convert(&mut self, x: &str, to: &str) -> String {
        self.s("convert@1", json!({"x": x, "to": to}))
    }
    fn sample(&mut self, tex: &str, uv: &str) -> String {
        self.s("sample@1", json!({"tex": tex, "uv": uv, "lod": 0.0}))
    }
    fn select(&mut self, f: &str, t: &str, cond: &str) -> String {
        self.s("select@1", json!({"f": f, "t": t, "cond": cond}))
    }

    fn done(self) -> Value {
        Value::Object(self.steps)
    }
}

fn texture(target_op: &str, output: &str, ty: &str) -> Value {
    json!({"type": ty, "from": {"texture": {"target": {"op": target_op, "output": output}}}})
}

fn param(path: &str, ty: &str, default: Value, range: [f64; 2]) -> Value {
    json!({"type": ty, "from": {"param": path}, "default": default, "range": range})
}

fn pass(
    id: &str,
    about: &str,
    inputs: Value,
    g: G,
    color: &str,
    resolution: Value,
    cost: f64,
) -> Value {
    json!({
        "id": id, "kind": "pass", "about": about, "origin": "shipped",
        "inputs": inputs, "steps": g.done(),
        "outputs": {"color": color, "blend": "replace"},
        "determinism": "same_machine", "cost": {"ns_per_px": cost},
        "resolution": resolution, "fallback": "look", "chain": "effects",
    })
}

/// The texel size of `tex` as a vec2: 1 ÷ its size.
fn texel(g: &mut G, tex: &str) -> String {
    let size = g.s("size@1", json!({"tex": tex}));
    let sizef = g.convert(&size, "vec2<f32>");
    let one = g.c(json!([1.0, 1.0]));
    g.div(&one, &sizef)
}

/// The 13-tap downsample's taps, in source texels from the destination pixel's centre (a corner
/// between four source texels), each sampled bilinearly, and its five groups of four: the centre
/// box weighted 0.5 and the four corner boxes 0.125 each.
const TAPS: [[f64; 2]; 13] = [
    [-2.0, -2.0],
    [0.0, -2.0],
    [2.0, -2.0],
    [-1.0, -1.0],
    [1.0, -1.0],
    [-2.0, 0.0],
    [0.0, 0.0],
    [2.0, 0.0],
    [-1.0, 1.0],
    [1.0, 1.0],
    [-2.0, 2.0],
    [0.0, 2.0],
    [2.0, 2.0],
];
const GROUPS: [([usize; 4], f64); 5] = [
    ([3, 4, 8, 9], 0.5),
    ([0, 1, 5, 6], 0.125),
    ([1, 2, 6, 7], 0.125),
    ([5, 6, 10, 11], 0.125),
    ([6, 7, 11, 12], 0.125),
];

/// A 13-tap downsample of `src` to half its size; `karis` weights each group by 1 ÷ (1 + its
/// luminance) and renormalizes, the Karis average for the chain's first step.
pub fn down(karis: bool) -> Value {
    let mut g = G::new();
    let uv = g.s("screen_uv@1", json!({}));
    let tx = texel(&mut g, "src");
    let taps: Vec<String> = TAPS
        .iter()
        .map(|o| {
            let off = g.c(json!(o));
            let d = g.mul(&off, &tx);
            let at = g.add(&uv, &d);
            g.sample("src", &at)
        })
        .collect();
    // With the Karis average each tap is weighted by 1 ÷ (1 + its luminance) within its group, so
    // a firefly's share of a group tends to a third of it however bright it is.
    let weights: Vec<Option<String>> = taps
        .iter()
        .map(|t| {
            karis.then(|| {
                let rgb = g.split(t, "rgb");
                let l = g.s("luminance@1", json!({"rgb": rgb}));
                let one = g.c(json!(1.0));
                let d = g.add(&one, &l);
                g.div(&one, &d)
            })
        })
        .collect();
    let mut sum: Option<String> = None;
    for (members, weight) in GROUPS {
        let avg = match &weights[members[0]] {
            Some(_) => {
                let terms: Vec<(String, String)> = members
                    .iter()
                    .map(|m| {
                        let w = weights[*m].clone().expect("weighted");
                        (g.mul(&taps[*m], &w), w)
                    })
                    .collect();
                let a = g.add(&terms[0].0, &terms[1].0);
                let b = g.add(&terms[2].0, &terms[3].0);
                let s = g.add(&a, &b);
                let wa = g.add(&terms[0].1, &terms[1].1);
                let wb = g.add(&terms[2].1, &terms[3].1);
                let ws = g.add(&wa, &wb);
                g.div(&s, &ws)
            }
            None => {
                let a = g.add(&taps[members[0]], &taps[members[1]]);
                let b = g.add(&taps[members[2]], &taps[members[3]]);
                let s = g.add(&a, &b);
                g.mulk(&s, 0.25)
            }
        };
        let term = g.mulk(&avg, weight);
        sum = Some(match sum {
            None => term,
            Some(p) => g.add(&p, &term),
        });
    }
    let out = sum.expect("five groups");
    let (id, about) = if karis {
        ("glow.down_karis@1", "Glow's first downsample: 13 bilinear taps in five boxes, each tap weighted within its box by 1 ÷ (1 + its luminance) (the Karis average), to half size.")
    } else {
        ("glow.down@1", "Glow's downsample: 13 bilinear taps in five boxes, the centre box half the weight, to half size.")
    };
    pass(
        id,
        about,
        json!({"src": texture("core", "color", "texture")}),
        g,
        &out,
        json!({"of": "src", "scale": 0.5}),
        if karis { 0.15 } else { 0.08 },
    )
}

/// A tent upsample of `small` (a 3 × 3 bilinear tent at its texel size) added to `large`, the
/// same level's downsample, at `large`'s size.
pub fn up() -> Value {
    let mut g = G::new();
    let uv = g.s("screen_uv@1", json!({}));
    let tx = texel(&mut g, "small");
    let mut sum: Option<String> = None;
    for (dx, dy, w) in [
        (-1.0, -1.0, 1.0),
        (0.0, -1.0, 2.0),
        (1.0, -1.0, 1.0),
        (-1.0, 0.0, 2.0),
        (0.0, 0.0, 4.0),
        (1.0, 0.0, 2.0),
        (-1.0, 1.0, 1.0),
        (0.0, 1.0, 2.0),
        (1.0, 1.0, 1.0),
    ] {
        let off = g.c(json!([dx, dy]));
        let d = g.mul(&off, &tx);
        let at = g.add(&uv, &d);
        let s = g.sample("small", &at);
        let t = g.mulk(&s, w / 16.0);
        sum = Some(match sum {
            None => t,
            Some(p) => g.add(&p, &t),
        });
    }
    let here = g.sample("large", &uv);
    let out = g.add(&here, &sum.expect("nine taps"));
    pass(
        "glow.up@1",
        "Glow's upsample: a 3 × 3 tent of the smaller level, added to this level's downsample.",
        json!({
            "small": texture("glow", "small", "texture"),
            "large": texture("glow", "large", "texture"),
        }),
        g,
        &out,
        json!({"of": "large", "scale": 1.0}),
        0.08,
    )
}

/// The glow mixed into scene color: `scene × (1 − intensity) + bloom ÷ levels × intensity`.
pub fn mix() -> Value {
    let mut g = G::new();
    let uv = g.s("screen_uv@1", json!({}));
    let scene = g.sample("scene", &uv);
    let bloom = g.sample("bloom", &uv);
    let levels = g.convert("levels", "f32");
    let b = g.div(&bloom, &levels);
    let m = g.s("mix@1", json!({"a": scene, "b": b, "t": "intensity"}));
    // Alpha stays the scene's.
    let rgb = g.split(&m, "rgb");
    let a = g.split(&scene, "a");
    let out = g.s("compose@1", json!({"x": rgb, "y": a}));
    pass(
        "glow.mix@1",
        "Glow mixed into scene color before tone mapping, energy conserving: the chain's sum over its levels, by the look's intensity.",
        json!({
            "scene": texture("core", "color", "texture"),
            "bloom": texture("glow", "up0", "texture"),
            "intensity": param("bloom.intensity", "f32", json!(0.04), [0.0, 1.0]),
            "levels": param("bloom.levels", "u32", json!(5), [1.0, 8.0]),
        }),
        g,
        &out,
        json!("full"),
        0.05,
    )
}

/// World position from the pixel's ndc at clip depth `z`, through the inverse clip matrix.
fn unproject(g: &mut G, ndc: &str, z: &str, inv: &str) -> String {
    let one = g.c(json!(1.0));
    let ndcx = g.split(ndc, "x");
    let ndcy = g.split(ndc, "y");
    let p = g.s("compose@1", json!({"x": ndcx, "y": ndcy, "z": z, "w": one}));
    let w = g.mul(inv, &p);
    let xyz = g.split(&w, "xyz");
    let ww = g.split(&w, "w");
    g.div(&xyz, &ww)
}

/// The pixel's ndc for a screen position `at` (px).
fn ndc_of(g: &mut G, at: &str) -> String {
    let size = g.s("screen_size@1", json!({}));
    let uv = g.div(at, &size);
    let two = g.c(json!([2.0, -2.0]));
    let s = g.mul(&uv, &two);
    let k = g.c(json!([-1.0, 1.0]));
    g.add(&s, &k)
}

/// Where the ray through screen position `at` meets the plane y = `height`: the hit (world), and
/// whether it's in front of the eye.
fn ground_hit(g: &mut G, at: &str, height: &str, inv: &str) -> (String, String) {
    let ndc = ndc_of(g, at);
    let near = g.c(json!(1.0));
    let p0 = unproject(g, &ndc, &near, inv);
    // The far end: with reversed Z and no far plane, depth 0 is a point at infinity whose
    // homogeneous xyz is the ray's direction, which needs no subtraction of nearby points; an
    // orthographic view's depth 0 is a finite point.
    let zero = g.c(json!(0.0));
    let one = g.c(json!(1.0));
    let nx = g.split(&ndc, "x");
    let ny = g.split(&ndc, "y");
    let far = g.s("compose@1", json!({"x": nx, "y": ny, "z": zero, "w": one}));
    let hf = g.mul(inv, &far);
    let hxyz = g.split(&hf, "xyz");
    let hw = g.split(&hf, "w");
    let hwa = g.s("abs@1", json!({"x": hw}));
    let at_infinity = g.s("lt@1", json!({"a": hwa, "b": 1e-6}));
    let tiny_w = g.c(json!(1e-6));
    let safe_w = g.select(&hw, &tiny_w, &at_infinity);
    let pf = g.div(&hxyz, &safe_w);
    let finite_dir = g.sub(&pf, &p0);
    // A homogeneous point's sign is free: point it away from the eye.
    let eye = g.s("camera@1", json!({"of": "position"}));
    let ahead = g.sub(&p0, &eye);
    let along = g.s("dot@1", json!({"a": hxyz, "b": ahead}));
    let flip = g.s("lt@1", json!({"a": along, "b": 0.0}));
    let back = g.s("neg@1", json!({"x": hxyz}));
    let inf_dir = g.select(&hxyz, &back, &flip);
    let dir = g.select(&finite_dir, &inf_dir, &at_infinity);
    let dy = g.split(&dir, "y");
    let p0y = g.split(&p0, "y");
    let rise = g.sub(height, &p0y);
    // A ray parallel to the plane never meets it: its divisor moves off zero, and the t it gives
    // is refused by the sign test below.
    let tiny = g.c(json!(1e-12));
    let dyz = g.s("eq@1", json!({"a": dy, "b": 0.0}));
    let dys = g.select(&dy, &tiny, &dyz);
    let t = g.div(&rise, &dys);
    let step = g.mul(&dir, &t);
    let hit = g.add(&p0, &step);
    let front = g.s("gt@1", json!({"a": t, "b": 0.0}));
    (hit, front)
}

/// The ground grid (Look `look@1`: ground grid in 3D). Minor, major and axis lines draw as one
/// line, the strongest's color at the greatest coverage, mixed over the scene once, so a line's
/// light is linear in its width's alpha.
pub fn grid() -> Value {
    let mut g = G::new();
    let inv = g.s("camera@1", json!({"of": "inverse_clip"}));
    let clip = g.s("camera@1", json!({"of": "clip"}));
    let eye = g.s("camera@1", json!({"of": "position"}));
    let pix = g.s("pixel@1", json!({}));
    let pixf = g.convert(&pix, "vec2<f32>");
    let half = g.c(json!([0.5, 0.5]));
    let at = g.add(&pixf, &half);
    let ax = g.c(json!([1.5, 0.5]));
    let at_x = g.add(&pixf, &ax);
    let ay = g.c(json!([0.5, 1.5]));
    let at_y = g.add(&pixf, &ay);
    let (hit, front) = ground_hit(&mut g, &at, "height", &inv);
    let (hx, _) = ground_hit(&mut g, &at_x, "height", &inv);
    let (hy, _) = ground_hit(&mut g, &at_y, "height", &inv);
    // The plane's coordinates in cells of `spacing`, and how many cells one px spans along x
    // and z: the footprint that turns a world distance into px.
    let xz = g.split(&hit, "xz");
    let cells = g.div(&xz, "spacing");
    let xzx = g.split(&hx, "xz");
    let xzy = g.split(&hy, "xz");
    let dx0 = g.sub(&xzx, &xz);
    let dy0 = g.sub(&xzy, &xz);
    let dxa = g.s("abs@1", json!({"x": dx0}));
    let dya = g.s("abs@1", json!({"x": dy0}));
    let foot = g.add(&dxa, &dya);
    let foot_cells = g.div(&foot, "spacing");
    let floor_eps = g.c(json!([1e-6, 1e-6]));
    let foot_cells = g.s("max@1", json!({"a": foot_cells, "b": floor_eps}));
    // A line thinner than a pixel draws one pixel wide at its width's alpha.
    let one = g.c(json!(1.0));
    let drawn = g.s("max@1", json!({"a": "width", "b": one}));
    let alpha = g.s("min@1", json!({"a": "width", "b": one}));
    let half_w = g.mulk(&drawn, 0.5);
    let coverage = |g: &mut G, d: &str, foot: &str| -> String {
        // From a distance to the nearest line (in the footprint's units) to the share of the
        // pixel the line covers.
        let dpx = g.div(d, foot);
        let h = g.c(json!([0.5, 0.5]));
        let edge = g.add(&half_w, &h);
        let left = g.sub(&edge, &dpx);
        let z = g.c(json!([0.0, 0.0]));
        let o = g.c(json!([1.0, 1.0]));
        let c = g.s("clamp@1", json!({"x": left, "lo": z, "hi": o}));
        let cx = g.split(&c, "x");
        let cy = g.split(&c, "y");
        g.s("max@1", json!({"a": cx, "b": cy}))
    };
    let lattice = |g: &mut G, coord: &str| -> String {
        let h = g.c(json!([0.5, 0.5]));
        let shifted = g.add(coord, &h);
        let fr = g.s("fract@1", json!({"x": shifted}));
        let centered = g.sub(&fr, &h);
        g.s("abs@1", json!({"x": centered}))
    };
    let minor_d = lattice(&mut g, &cells);
    let minor = coverage(&mut g, &minor_d, &foot_cells);
    let every = g.convert("major_every", "f32");
    let major_cells = g.div(&cells, &every);
    let major_foot = g.div(&foot_cells, &every);
    let major_d = lattice(&mut g, &major_cells);
    let major = coverage(&mut g, &major_d, &major_foot);
    // The axes: x = 0 and z = 0, in world units.
    let axis_foot = g.s("max@1", json!({"a": foot, "b": floor_eps}));
    let axis_d = g.s("abs@1", json!({"x": xz}));
    let axis = coverage(&mut g, &axis_d, &axis_foot);
    // One line per pixel at the greatest coverage, its color blended by each kind's share of it,
    // so it moves continuously where a major line lies on a minor one (no choice between equal
    // coverages that the last bit could flip).
    let eps = g.c(json!(1e-6));
    let zero_k = g.c(json!(0.0));
    let one_k = g.c(json!(1.0));
    let k1 = g.s("max@1", json!({"a": major, "b": minor}));
    let k1s = g.s("max@1", json!({"a": k1, "b": eps}));
    let wm = g.div(&major, &k1s);
    let wm = g.s("clamp@1", json!({"x": wm, "lo": zero_k, "hi": one_k}));
    let c1 = g.s(
        "mix@1",
        json!({"a": "minor_color", "b": "major_color", "t": wm}),
    );
    let cov = g.s("max@1", json!({"a": axis, "b": k1}));
    let covs = g.s("max@1", json!({"a": cov, "b": eps}));
    let wa = g.div(&axis, &covs);
    let wa = g.s("clamp@1", json!({"x": wa, "lo": zero_k, "hi": one_k}));
    let line = g.s("mix@1", json!({"a": c1, "b": "axis_color", "t": wa}));
    // Fade with distance from the eye.
    let to = g.sub(&hit, &eye);
    let dist = g.s("length@1", json!({"x": to}));
    let fade_start = g.mulk("fade", 0.5);
    let fading = g.s(
        "smoothstep@1",
        json!({"lo": fade_start, "hi": "fade", "x": dist}),
    );
    let fade = g.sub(&one, &fading);
    // Hidden behind what's drawn: reversed Z, so a nearer item has the larger depth.
    let hx3 = g.split(&hit, "x");
    let hy3 = g.split(&hit, "y");
    let hz3 = g.split(&hit, "z");
    let hp = g.s("compose@1", json!({"x": hx3, "y": hy3, "z": hz3, "w": one}));
    let hc = g.mul(&clip, &hp);
    let hcz = g.split(&hc, "z");
    let hcw = g.split(&hc, "w");
    let grid_depth = g.div(&hcz, &hcw);
    let scene_depth = g.s("load@1", json!({"tex": "depth", "ixy": pix}));
    let shows = g.s("ge@1", json!({"a": grid_depth, "b": scene_depth}));
    let visible = g.s("and@1", json!({"a": front, "b": shows}));
    let zero = g.c(json!(0.0));
    let on = g.select(&zero, &fade, &visible);
    let k = g.mul(&cov, &alpha);
    let k = g.mul(&k, &on);
    let scene = g.s("load@1", json!({"tex": "color", "ixy": pix}));
    let rgb = g.split(&scene, "rgb");
    let mixed = g.s("mix@1", json!({"a": rgb, "b": line, "t": k}));
    let sa = g.split(&scene, "a");
    let out = g.s("compose@1", json!({"x": mixed, "y": sa}));
    pass(
        "grid.ground@1",
        "The look's ground grid: the plane y = height by ray from the camera, minor, major and axis lines anti-aliased by their px footprint, faded with distance, hidden behind items.",
        json!({
            "color": texture("core", "color", "texture"),
            "depth": texture("core", "depth", "depth"),
            "height": param("ground_3d.height", "f32", json!(0.0), [-1e6, 1e6]),
            "spacing": param("ground_3d.spacing", "f32", json!(1.0), [1e-6, 1e6]),
            "major_every": param("ground_3d.major_every", "u32", json!(10), [1.0, 255.0]),
            "width": param("ground_3d.width", "f32", json!(1.0), [0.0, 16.0]),
            "fade": param("ground_3d.fade", "f32", json!(60.0), [1e-3, 1e9]),
            "minor_color": {"type": "vec3", "from": {"role": "grid_minor"}},
            "major_color": {"type": "vec3", "from": {"role": "grid_major"}},
            "axis_color": {"type": "vec3", "from": {"role": "grid_axis"}},
        }),
        g,
        &out,
        json!("full"),
        0.12,
    )
}

/// The Vogel disk's taps: point k of n at radius √((k + 0.5) ÷ n), angle k × the golden angle.
fn vogel(n: usize) -> Vec<[f64; 2]> {
    use deep_canvas::ops;
    let golden = ops::PI * (3.0 - ops::sqrt(5.0));
    (0..n)
        .map(|k| {
            let r = ops::sqrt((k as f64 + 0.5) / n as f64);
            let a = k as f64 * golden;
            [r * ops::cos(a), r * ops::sin(a)]
        })
        .collect()
}

/// Taps the shadow filter reads.
pub const SHADOW_TAPS: usize = 8;

/// The key light's shadow on drawn items.
pub fn shadow() -> Value {
    let mut g = G::new();
    let inv = g.s("camera@1", json!({"of": "inverse_clip"}));
    let pix = g.s("pixel@1", json!({}));
    let pixf = g.convert(&pix, "vec2<f32>");
    let half = g.c(json!([0.5, 0.5]));
    let at = g.add(&pixf, &half);
    let depth = g.s("load@1", json!({"tex": "depth", "ixy": pix}));
    let ndc = ndc_of(&mut g, &at);
    let world = unproject(&mut g, &ndc, &depth, &inv);
    let drawn = g.s("gt@1", json!({"a": depth, "b": 0.0}));
    // Into the light's clip space (orthographic, depth 0 nearest the light).
    let one = g.c(json!(1.0));
    let wx = g.split(&world, "x");
    let wy = g.split(&world, "y");
    let wz = g.split(&world, "z");
    let wp = g.s("compose@1", json!({"x": wx, "y": wy, "z": wz, "w": one}));
    let lp = g.mul("light_clip", &wp);
    let lxy = g.split(&lp, "xy");
    let lz = g.split(&lp, "z");
    let k = g.c(json!([0.5, -0.5]));
    let luv = g.mul(&lxy, &k);
    let hh = g.c(json!([0.5, 0.5]));
    let luv = g.add(&luv, &hh);
    let msize = g.s("size@1", json!({"tex": "shadow_map"}));
    let msizef = g.convert(&msize, "vec2<f32>");
    let mpx = g.mul(&luv, &msizef);
    // The disk's rotation: a hash of the pixel and the item's seed, the same every frame.
    let px = g.split(&pix, "x");
    let py = g.split(&pix, "y");
    let h = g.s("hash@1", json!({"a": px, "b": py, "c": "seed"}));
    let r = g.s("rand@1", json!({"key": h}));
    let ang = g.mulk(&r, deep_canvas::ops::TAU);
    let ca = g.s("cos@1", json!({"x": ang}));
    let sa = g.s("sin@1", json!({"x": ang}));
    let lit_bias = g.sub(&lz, "bias");
    let disk = g.ty(
        json!(vogel(SHADOW_TAPS)),
        &format!("array<vec2<f32>, {SHADOW_TAPS}>"),
    );
    // One tap per trip: the disk's point rotated by the pixel's angle, in shadow-map texels.
    let mut b = G::named("b");
    let o = b.s("index@1", json!({"a": disk, "i": "i"}));
    let ox = b.split(&o, "x");
    let oy = b.split(&o, "y");
    let p1 = b.mul(&ox, &ca);
    let p2 = b.mul(&oy, &sa);
    let rx = b.sub(&p1, &p2);
    let p3 = b.mul(&ox, &sa);
    let p4 = b.mul(&oy, &ca);
    let ry = b.add(&p3, &p4);
    let off = b.s("compose@1", json!({"x": rx, "y": ry}));
    let off = b.mul(&off, "radius");
    let tp = b.add(&mpx, &off);
    let ti = b.s("floor@1", json!({"x": tp}));
    let ti = b.convert(&ti, "vec2<i32>");
    let m = b.s("load@1", json!({"tex": "shadow_map", "ixy": ti}));
    let occ = b.s("lt@1", json!({"a": m, "b": lit_bias}));
    let one_b = b.c(json!(1.0));
    let z = b.c(json!(0.0));
    let v = b.select(&z, &one_b, &occ);
    b.named_step("blocked", "add@1", json!({"a": "blocked", "b": v}));
    let rep = g.s(
        "repeat@1",
        json!({"count": SHADOW_TAPS, "accumulate": {"blocked": 0.0}, "body": b.done()}),
    );
    let blocked = g.mulk(&format!("{rep}.blocked"), 1.0 / SHADOW_TAPS as f64);
    // Only inside the map: outside it, nothing casts.
    let lo = g.c(json!([0.0, 0.0]));
    let hi = g.c(json!([1.0, 1.0]));
    let in_lo = g.s("ge@1", json!({"a": luv, "b": lo}));
    let in_hi = g.s("le@1", json!({"a": luv, "b": hi}));
    let in_lo = g.s("all@1", json!({"x": in_lo}));
    let in_hi = g.s("all@1", json!({"x": in_hi}));
    let inside = g.s("and@1", json!({"a": in_lo, "b": in_hi}));
    let counts = g.s("and@1", json!({"a": inside, "b": drawn}));
    let z0 = g.c(json!(0.0));
    let shade = g.select(&z0, &blocked, &counts);
    let dark = g.mul(&shade, "strength");
    let keep = g.sub(&one, &dark);
    let scene = g.s("load@1", json!({"tex": "color", "ixy": pix}));
    let rgb = g.split(&scene, "rgb");
    let rgb = g.mul(&rgb, &keep);
    let sa2 = g.split(&scene, "a");
    let out = g.s("compose@1", json!({"x": rgb, "y": sa2}));
    pass(
        "shadow.resolve@1",
        "The key light's shadow on drawn items: an 8-tap Vogel disk over the core's shadow map, rotated by a hash of the pixel and the item's seed.",
        json!({
            "color": texture("core", "color", "texture"),
            "depth": texture("core", "depth", "depth"),
            "shadow_map": texture("core", "shadow", "depth"),
            "light_clip": {"type": "mat4x4<f32>", "from": {"param": "light.clip"}},
            "radius": param("shadow.radius", "f32", json!(1.5), [0.0, 32.0]),
            "bias": param("shadow.bias", "f32", json!(0.004), [0.0, 1.0]),
            "strength": param("shadow.strength", "f32", json!(0.6), [0.0, 1.0]),
            "seed": {"type": "u32", "from": "seed"},
        }),
        g,
        &out,
        json!("full"),
        0.15,
    )
}

/// The selection outline: pixels outside a selected item within `width` px of one.
pub fn outline() -> Value {
    let mut g = G::new();
    let pix = g.s("pixel@1", json!({}));
    let pi = g.convert(&pix, "vec2<i32>");
    // Whether pick ID `id` is in the selection bitset (pick 0 draws nothing and is never set).
    let selected = |g: &mut G, id: &str| -> String {
        let word = g.s("shr@1", json!({"a": id, "b": 5}));
        let bits = g.s("index@1", json!({"a": "selection", "i": word}));
        let low = g.s("and@1", json!({"a": id, "b": 31}));
        let sh = g.s("shr@1", json!({"a": bits, "b": low}));
        let bit = g.s("and@1", json!({"a": sh, "b": 1}));
        let set = g.s("ne@1", json!({"a": bit, "b": 0}));
        let inside = g.s("lt@1", json!({"a": id, "b": 512}));
        g.s("and@1", json!({"a": set, "b": inside}))
    };
    let own = g.s("load@1", json!({"tex": "ids", "ixy": pi}));
    let own_sel = selected(&mut g, &own);
    let w = g.convert("width", "i32");
    let mut near: Option<String> = None;
    for o in [
        [-1, -1],
        [0, -1],
        [1, -1],
        [-1, 0],
        [1, 0],
        [-1, 1],
        [0, 1],
        [1, 1],
    ] {
        let off = g.ty(json!(o), "vec2<i32>");
        let o2 = g.mul(&off, &w);
        let q = g.add(&pi, &o2);
        let id = g.s("load@1", json!({"tex": "ids", "ixy": q}));
        let s = selected(&mut g, &id);
        near = Some(match near {
            None => s,
            Some(p) => g.s("or@1", json!({"a": p, "b": s})),
        });
    }
    let not_own = g.s("not@1", json!({"x": own_sel}));
    let edge = g.s("and@1", json!({"a": not_own, "b": near.expect("taps")}));
    let scene = g.s("load@1", json!({"tex": "color", "ixy": pi}));
    let rgb = g.split(&scene, "rgb");
    let mixed = g.select(&rgb, "outline_color", &edge);
    let sa = g.split(&scene, "a");
    let out = g.s("compose@1", json!({"x": mixed, "y": sa}));
    pass(
        "outline.select@1",
        "The selection outline: pixels outside the selected items, within width px of one by the object-ID target, take the selection role's color.",
        json!({
            "color": texture("core", "color", "texture"),
            "ids": texture("core", "object_id", "texture<u32>"),
            "selection": {"type": "array<u32, 16>", "from": {"param": "selection.bits"}, "default": [0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0]},
            "width": param("selection.width", "u32", json!(2), [1.0, 4.0]),
            "outline_color": {"type": "vec3", "from": {"role": "selection"}},
        }),
        g,
        &out,
        json!("full"),
        0.06,
    )
}

/// At most this many particles one item draws (Particles `particles@1`: `count`).
pub const MAX_PARTICLES: u32 = 65_536;
/// Instance floats per particle: its position, and its age over its life (−1 when it isn't alive).
pub const PARTICLE_FLOATS: u32 = 4;

/// Sparks: particle i's slot is born every `count ÷ rate` seconds while the emitter runs, and its
/// age, life, direction and speed are a closed form of t, i, its generation and the item's seed,
/// moved ballistically with linear drag. Nothing is carried from frame to frame.
pub fn particles() -> Value {
    let mut g = G::new();
    let e = g.s("element@1", json!({}));
    let fi = g.convert(&e, "f32");
    let t = g.s("t@1", json!({}));
    let countf = g.convert("count", "f32");
    let period = g.div(&countf, "rate");
    let first = g.div(&fi, "rate");
    let since = g.sub(&t, &first);
    let gens = g.div(&since, &period);
    let gen = g.s("floor@1", json!({"x": gens}));
    let gp = g.mul(&gen, &period);
    let born_at = g.add(&first, &gp);
    let age = g.sub(&t, &born_at);
    let born = g.s("ge@1", json!({"a": since, "b": 0.0}));
    let in_span = g.s("le@1", json!({"a": born_at, "b": "span"}));
    let zero = g.c(json!(0.0));
    let genc = g.s("max@1", json!({"a": gen, "b": zero}));
    let genu = g.convert(&genc, "u32");
    let h = g.s("hash@1", json!({"a": "seed", "b": e, "c": genu}));
    let rnd = |g: &mut G, k: u32| -> String {
        let hk = g.s("hash@1", json!({"a": h, "b": k}));
        g.s("rand@1", json!({"key": hk}))
    };
    let r_life = rnd(&mut g, 1);
    let life = g.s(
        "mix@1",
        json!({"a": "life_min", "b": "life_max", "t": r_life}),
    );
    let young = g.s("lt@1", json!({"a": age, "b": life}));
    let alive = g.s("and@1", json!({"a": born, "b": in_span}));
    let alive = g.s("and@1", json!({"a": alive, "b": young}));
    let r_speed = rnd(&mut g, 2);
    let speed = g.s("mix@1", json!({"a": "v0_min", "b": "v0_max", "t": r_speed}));
    let r_az = rnd(&mut g, 3);
    let az = g.mulk(&r_az, deep_canvas::ops::TAU);
    // Up a cone about +Y whose cosine runs from 1 to 0.4.
    let r_up = rnd(&mut g, 4);
    let tilt = g.mulk(&r_up, 0.6);
    let one = g.c(json!(1.0));
    let cu = g.sub(&one, &tilt);
    let cu2 = g.mul(&cu, &cu);
    let su2 = g.sub(&one, &cu2);
    let su2 = g.s("max@1", json!({"a": su2, "b": zero}));
    let su = g.s("sqrt@1", json!({"x": su2}));
    let cx = g.s("cos@1", json!({"x": az}));
    let sz = g.s("sin@1", json!({"x": az}));
    let dx = g.mul(&su, &cx);
    let dz = g.mul(&su, &sz);
    let dir = g.s("compose@1", json!({"x": dx, "y": cu, "z": dz}));
    let v0 = g.mul(&dir, &speed);
    // Linear drag d: x(a) = v0 (1 − e^(−d a)) ÷ d + g (a ÷ d − (1 − e^(−d a)) ÷ d²); with no
    // drag, v0 a + g a² ÷ 2.
    let small = g.s("lt@1", json!({"a": "drag", "b": 1e-4}));
    let dsafe = g.s("max@1", json!({"a": "drag", "b": 1e-4}));
    let nda = g.mul(&dsafe, &age);
    let nda = g.s("neg@1", json!({"x": nda}));
    let decay = g.s("exp@1", json!({"x": nda}));
    let gone = g.sub(&one, &decay);
    let k1 = g.div(&gone, &dsafe);
    let k1 = g.select(&k1, &age, &small);
    let a2 = g.mul(&age, &age);
    let half_a2 = g.mulk(&a2, 0.5);
    let k2d = g.sub(&age, &k1);
    let k2 = g.div(&k2d, &dsafe);
    let k2 = g.select(&k2, &half_a2, &small);
    let pv = g.mul(&v0, &k1);
    let pg = g.mul("gravity", &k2);
    let p = g.add("origin", &pv);
    let p = g.add(&p, &pg);
    let frac = g.div(&age, &life);
    let minus = g.c(json!(-1.0));
    let w = g.select(&minus, &frac, &alive);
    let inside = g.s("lt@1", json!({"a": e, "b": "count"}));
    let floats = g.ty(json!(PARTICLE_FLOATS), "u32");
    let base = g.mul(&e, &floats);
    for (k, lane) in [(0, "x"), (1, "y"), (2, "z")] {
        let v = g.split(&p, lane);
        let kc = g.ty(json!(k), "u32");
        let at = g.add(&base, &kc);
        let id = g.s("write@1", json!({"buf": "inst", "i": at, "v": v}));
        set_when(&mut g, &id, &inside);
    }
    let k3 = g.ty(json!(3), "u32");
    let at = g.add(&base, &k3);
    let id = g.s("write@1", json!({"buf": "inst", "i": at, "v": w}));
    set_when(&mut g, &id, &inside);
    json!({
        "id": "particles.sparks@1", "kind": "compute", "origin": "shipped",
        "about": "Sparks: each particle's age, life, direction and speed are a closed form of t, its index, its generation and the item's seed, moved ballistically with linear drag, written as instance columns.",
        "inputs": {
            "count": param("particles.count", "u32", json!(256), [0.0, f64::from(MAX_PARTICLES)]),
            "rate": param("particles.rate", "f32", json!(100.0), [1e-3, 1e7]),
            "span": param("particles.span", "f32", json!(1e9), [0.0, 1e9]),
            "life_min": param("particles.life_min", "f32", json!(1.0), [1e-3, 1e4]),
            "life_max": param("particles.life_max", "f32", json!(1.0), [1e-3, 1e4]),
            "v0_min": param("particles.v0_min", "f32", json!(1.0), [0.0, 1e4]),
            "v0_max": param("particles.v0_max", "f32", json!(2.0), [0.0, 1e4]),
            "drag": param("particles.drag", "f32", json!(0.0), [0.0, 1e3]),
            "gravity": param("particles.gravity", "vec3", json!([0.0, -9.8, 0.0]), [-1e4, 1e4]),
            "origin": param("particles.origin", "vec3", json!([0.0, 0.0, 0.0]), [-1e9, 1e9]),
            "seed": {"type": "u32", "from": "seed"},
        },
        "steps": g.done(),
        "outputs": {"inst": {"storage": {"type": "f32", "count": MAX_PARTICLES * PARTICLE_FLOATS}}},
        "elements": MAX_PARTICLES, "workgroup": 64,
        "determinism": "same_machine", "cost": {"ns_per_element": 0.03},
    })
}

fn set_when(g: &mut G, step: &str, cond: &str) {
    if let Some(s) = g.steps.get_mut(step) {
        s["when"] = json!(cond);
    }
}

/// The pixels the exactness fixture hashes: a fixed pattern of 64 × 64 RGBA8 words.
pub const HASH_FIXTURE: u32 = 64 * 64;

/// The determinism check's GPU pixel hash: each pixel's word hashed with its index, integers only,
/// so it gives the same bits on every GPU.
pub fn pixel_hash() -> Value {
    let mut g = G::new();
    let e = g.s("element@1", json!({}));
    let word = g.s("read@1", json!({"buf": "pixels", "i": e}));
    let h = g.s("hash@1", json!({"a": word, "b": e}));
    g.s("write@1", json!({"buf": "out", "i": e, "v": h}));
    json!({
        "id": "pixel_hash@1", "kind": "compute", "origin": "shipped",
        "about": "The determinism check's GPU pixel hash: each pixel's RGBA8 word hashed with its index by the fixed integer hash, exact on every GPU.",
        "inputs": {"pixels": {"type": "u32", "count": HASH_FIXTURE, "from": {"storage": {"op": "core", "output": "slot"}}}},
        "steps": g.done(),
        "outputs": {"out": {"storage": {"type": "u32", "count": HASH_FIXTURE}}},
        "elements": HASH_FIXTURE, "workgroup": 64,
        "determinism": "exact", "cost": {"ns_per_element": 0.01},
    })
}

/// The glow's stages, in chain order: the first downsample (a Karis average unless `karis` is
/// off), a downsample, an upsample and the mix.
pub fn glow_stages(karis: bool) -> Vec<Value> {
    vec![down(karis), down(false), up(), mix()]
}

/// The shipped library, as the `operators` call lists it.
pub fn library(karis: bool) -> Vec<Shipped> {
    vec![
        Shipped {
            name: "glow@1",
            effect: Some("glow"),
            kind: Kind::Pass,
            noise: false,
            stages: glow_stages(karis),
        },
        Shipped {
            name: "grid.ground@1",
            effect: Some("grid"),
            kind: Kind::Pass,
            noise: false,
            stages: vec![grid()],
        },
        Shipped {
            name: "shadow.resolve@1",
            effect: Some("shadow"),
            kind: Kind::Pass,
            noise: true,
            stages: vec![shadow()],
        },
        Shipped {
            name: "outline.select@1",
            effect: Some("outline"),
            kind: Kind::Pass,
            noise: false,
            stages: vec![outline()],
        },
        Shipped {
            name: "particles.sparks@1",
            effect: Some("particles"),
            kind: Kind::Compute,
            noise: true,
            stages: vec![particles()],
        },
        Shipped {
            name: "pixel_hash@1",
            effect: None,
            kind: Kind::Compute,
            noise: false,
            stages: vec![pixel_hash()],
        },
    ]
}

/// Every shipped graph, each stage of a chain on its own.
pub fn all() -> Vec<Value> {
    library(true).into_iter().flat_map(|s| s.stages).collect()
}

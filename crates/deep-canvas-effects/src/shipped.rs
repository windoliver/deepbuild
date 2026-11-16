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

mod points;
pub use points::{points, POINT_WORDS};

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

/// The bloom's threshold on the chain's first step (#418): with `cut` (a luminance in scene
/// linear, 0 for none), only the light above it, `rgb × max(L − cut, 0) ÷ L`.
fn prefilter(g: &mut G, rgb: &str) -> String {
    let l = g.s("luminance@1", json!({"rgb": rgb}));
    let over = g.sub(&l, "cut");
    let zero = g.c(json!(0.0));
    let over = g.s("max@1", json!({"a": over, "b": zero}));
    let tiny = g.c(json!(1e-6));
    let l = g.s("max@1", json!({"a": l, "b": tiny}));
    let w = g.div(&over, &l);
    let one = g.c(json!(1.0));
    let on = g.s("gt@1", json!({"a": "cut", "b": zero}));
    let w = g.select(&one, &w, &on);
    g.mul(rgb, &w)
}

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
    // The plain average beside the Karis one (#418), for the share of light the chain takes.
    let mut plain: Option<String> = None;
    for (members, weight) in GROUPS {
        if karis {
            let a = g.add(&taps[members[0]], &taps[members[1]]);
            let b = g.add(&taps[members[2]], &taps[members[3]]);
            let s = g.add(&a, &b);
            let term = g.mulk(&s, 0.25 * weight);
            plain = Some(match plain {
                None => term,
                Some(p) => g.add(&p, &term),
            });
        }
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
    let sum = sum.expect("five groups");
    // Alpha carries the share of the scene's light the Karis average holds back (#418): 1 less its
    // luminance over the plain average's, 0 where nothing is lit, so the mix takes from the scene
    // exactly what the bloom spreads and the frame keeps its energy; plain downsamples hold back
    // nothing and write 0, so the upsamples carry the first level's alone to the mix.
    let rgb = g.split(&sum, "rgb");
    let held = match plain {
        Some(p) => {
            let p = g.split(&p, "rgb");
            let lp = g.s("luminance@1", json!({"rgb": p}));
            let lk = g.s("luminance@1", json!({"rgb": rgb}));
            let tiny = g.c(json!(1e-6));
            let lit = g.s("gt@1", json!({"a": lp, "b": tiny}));
            let floor = g.s("max@1", json!({"a": lp, "b": tiny}));
            let r = g.div(&lk, &floor);
            let one = g.c(json!(1.0));
            let held = g.sub(&one, &r);
            let none = g.c(json!(0.0));
            g.select(&none, &held, &lit)
        }
        None => g.c(json!(0.0)),
    };
    let rgb = if karis { prefilter(&mut g, &rgb) } else { rgb };
    let out = g.s("compose@1", json!({"x": rgb, "y": held}));
    let (id, about) = if karis {
        ("glow.down_karis@1", "Glow's first downsample: 13 bilinear taps in five boxes, each tap weighted within its box by 1 ÷ (1 + its luminance) (the Karis average), to half size.")
    } else {
        ("glow.down@1", "Glow's downsample: 13 bilinear taps in five boxes, the centre box half the weight, to half size.")
    };
    let inputs = if karis {
        json!({
            "src": texture("core", "color", "texture"),
            "cut": param("bloom.cut", "f32", json!(0.0), [0.0, 1e9]),
        })
    } else {
        json!({"src": texture("core", "color", "texture")})
    };
    pass(
        id,
        about,
        inputs,
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

/// The glow mixed into scene color: `scene × (1 − conserve × share) + bloom ÷ levels × tint × (1 +
/// dirt × d) × intensity`, with `conserve` the intensity with no threshold (energy conserving: the
/// scene gives up the light the chain spreads, `share` being 1 less what its first downsample held
/// back, carried in the bloom's alpha)
/// and 0 with one, and `d` the lens dirt image's value at the pixel, stretched over the frame
/// (#418). The planted overlay adds `dirt × d` to every pixel instead.
pub fn mix() -> Value {
    let mut g = G::new();
    let uv = g.s("screen_uv@1", json!({}));
    let scene = g.sample("scene", &uv);
    let bloom = g.sample("bloom", &uv);
    let levels = g.convert("levels", "f32");
    let b = g.div(&bloom, &levels);
    let b = g.split(&b, "rgb");
    let b = g.mul(&b, "tint");
    let dirt = g.sample("dirt", &uv);
    let d = g.split(&dirt, "r");
    let k = g.mul(&d, "dirt_intensity");
    let one = g.c(json!(1.0));
    let lens = g.add(&one, &k);
    let b = g.mul(&b, &lens);
    let b = g.mul(&b, "intensity");
    // What the chain took from the scene: the share the first downsample passed on (1 less what
    // its Karis average held back), by the intensity with no threshold (energy conserving), none
    // with one.
    let held = g.split(&bloom, "a");
    let share = g.sub(&one, &held);
    let taken = g.mul(&share, "conserve");
    let keep = g.sub(&one, &taken);
    let kept = g.split(&scene, "rgb");
    let kept = g.mul(&kept, &keep);
    let rgb = g.add(&kept, &b);
    // The planted overlay: the dirt laid over the frame wherever it is, bloom or not.
    let over = g.split(&dirt, "rgb");
    let over = g.mul(&over, "dirt_intensity");
    let over = g.mul(&over, "overlay");
    let rgb = g.add(&rgb, &over);
    // Alpha stays the scene's.
    let a = g.split(&scene, "a");
    let out = g.s("compose@1", json!({"x": rgb, "y": a}));
    pass(
        "glow.mix@1",
        "Glow mixed into scene color before tone mapping, energy conserving with no threshold, tint or dirt: the chain's sum over its levels, by the look's intensity and tint, the lens dirt multiplying it where bloom is bright.",
        json!({
            "scene": texture("core", "color", "texture"),
            "bloom": texture("glow", "up0", "texture"),
            "dirt": texture("glow", "dirt", "texture"),
            "intensity": param("bloom.intensity", "f32", json!(0.04), [0.0, 1.0]),
            "conserve": param("bloom.conserve", "f32", json!(0.04), [0.0, 1.0]),
            "overlay": param("bloom.overlay", "f32", json!(0.0), [0.0, 1.0]),
            "tint": param("bloom.tint", "vec3<f32>", json!([1.0, 1.0, 1.0]), [0.0, 16.0]),
            "dirt_intensity": param("bloom.dirt_intensity", "f32", json!(0.0), [0.0, 16.0]),
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

mod grid;
pub use grid::*;

/// At most this many particles one item draws (Particles `particles@1`: `count`).
pub const MAX_PARTICLES: u32 = 65_536;
/// At most this many in a showpiece or an export (Operator budgets by class).
pub const MAX_PARTICLES_SHOWPIECE: u32 = 1_048_576;
/// Instance floats per particle: its position, its age over its life (−1 when it isn't alive),
/// its velocity, and one unused.
pub const PARTICLE_FLOATS: u32 = 8;
/// The points an `along` curve is resampled to, evenly by arc length.
pub const CURVE_POINTS: u32 = 16;

/// The motions and emitter shapes, in the order of the codes the operator reads.
pub const MOTIONS: [&str; 4] = ["ballistic", "along", "orbit", "drift"];
pub const SHAPES: [&str; 4] = ["point", "disk", "sphere", "along"];

/// Sparks: particle i's slot is born every `count ÷ rate` seconds while the emitter runs, and its
/// age, life, emit point, direction and speed are a closed form of t, i, its generation and the
/// item's seed; its place at that age is a closed form of its motion (ballistic with linear
/// drag, along a curve, an orbit about an axis, or a drift), as is its velocity. Nothing is
/// carried from frame to frame.
pub fn particles() -> Value {
    let mut g = G::new();
    // A showpiece's count past one dispatch runs as several, each from its `offset`.
    let el = g.s("element@1", json!({}));
    let e = g.add(&el, "offset");
    let fi = g.convert(&e, "f32");
    let t = g.s("t@1", json!({}));
    let countf = g.convert("count", "f32");
    let period = g.div(&countf, "rate");
    let first = g.div(&fi, "rate");
    let since = g.sub(&t, &first);
    let gens = g.div(&since, &period);
    let gen = g.s("floor@1", json!({"x": gens}));
    // Past the span, a slot keeps its last generation born inside it until that one's life ends.
    let span_since = g.sub("span", &first);
    let last_gens = g.div(&span_since, &period);
    let last_gen = g.s("floor@1", json!({"x": last_gens}));
    let gen = g.s("min@1", json!({"a": gen, "b": last_gen}));
    let gp = g.mul(&gen, &period);
    let born_at = g.add(&first, &gp);
    let age = g.sub(&t, &born_at);
    let born = g.s("ge@1", json!({"a": since, "b": 0.0}));
    let in_span = g.s("le@1", json!({"a": first, "b": "span"}));
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

    // The curve at u ∈ [0, 1] and its unit tangent there, from its evenly spaced points.
    let last = f64::from(CURVE_POINTS - 1);
    let curve_at = |g: &mut G, u: &str| -> (String, String) {
        let uc = g.s("clamp@1", json!({"x": u, "lo": 0.0, "hi": 1.0}));
        let x = g.mulk(&uc, last);
        let fl = g.s("floor@1", json!({"x": x}));
        let fl = g.s("min@1", json!({"a": fl, "b": last - 1.0}));
        let f = g.sub(&x, &fl);
        let i0 = g.convert(&fl, "u32");
        let k1 = g.ty(json!(1), "u32");
        let i1 = g.add(&i0, &k1);
        let p0 = g.s("index@1", json!({"a": "curve", "i": i0}));
        let p1 = g.s("index@1", json!({"a": "curve", "i": i1}));
        let d = g.sub(&p1, &p0);
        let step = g.mul(&d, &f);
        let p = g.add(&p0, &step);
        let tan = g.s("normalize@1", json!({"x": d}));
        (p, tan)
    };
    let is = |g: &mut G, input: &str, code: u32| -> String {
        let k = g.ty(json!(code), "u32");
        g.s("eq@1", json!({"a": input, "b": k}))
    };

    // Where it's born: the emitter's point, a disk across +Y, a ball, or a point along the curve.
    let r_e1 = rnd(&mut g, 5);
    let r_e2 = rnd(&mut g, 6);
    let r_e3 = rnd(&mut g, 7);
    let rr = g.s("sqrt@1", json!({"x": r_e1}));
    let rr = g.mul(&rr, "radius");
    let th = g.mulk(&r_e2, deep_canvas::ops::TAU);
    let ct = g.s("cos@1", json!({"x": th}));
    let st = g.s("sin@1", json!({"x": th}));
    let dkx = g.mul(&rr, &ct);
    let dkz = g.mul(&rr, &st);
    let disk = g.s("compose@1", json!({"x": dkx, "y": zero, "z": dkz}));
    let zz = g.mulk(&r_e2, 2.0);
    let zz = g.sub(&zz, &one);
    let zz2 = g.mul(&zz, &zz);
    let ss = g.sub(&one, &zz2);
    let ss = g.s("max@1", json!({"a": ss, "b": zero}));
    let ss = g.s("sqrt@1", json!({"x": ss}));
    let ph = g.mulk(&r_e3, deep_canvas::ops::TAU);
    let cph = g.s("cos@1", json!({"x": ph}));
    let sph = g.s("sin@1", json!({"x": ph}));
    let bx = g.mul(&ss, &cph);
    let bz = g.mul(&ss, &sph);
    let ball_dir = g.s("compose@1", json!({"x": bx, "y": zz, "z": bz}));
    let br = g.s("pow@1", json!({"a": r_e1, "b": 1.0 / 3.0}));
    let br = g.mul(&br, "radius");
    let ball = g.mul(&ball_dir, &br);
    // The curve's points are in world metres; the emitter's are about its origin.
    let (on_curve, _) = curve_at(&mut g, &r_e1);
    let on_curve = g.sub(&on_curve, "origin");
    let mut off = g.c(json!([0.0, 0.0, 0.0]));
    for (code, at) in [(1, &disk), (2, &ball), (3, &on_curve)] {
        let c = is(&mut g, "shape", code);
        off = g.select(&off, at, &c);
    }
    let b = g.add("origin", &off);

    // Ballistic, with linear drag d: x(a) = v0 (1 − e^(−d a)) ÷ d + g (a ÷ d − (1 − e^(−d a)) ÷
    // d²) and v(a) = v0 e^(−d a) + g (1 − e^(−d a)) ÷ d; with no drag, v0 a + g a² ÷ 2 and
    // v0 + g a.
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
    let p_bal = g.add(&b, &pv);
    let p_bal = g.add(&p_bal, &pg);
    let kept = g.select(&decay, &one, &small);
    let vv = g.mul(&v0, &kept);
    let vg = g.mul("gravity", &k1);
    let v_bal = g.add(&vv, &vg);

    // Along the curve at `speed`, from where it was born on it (or from its start).
    let len = g.s("max@1", json!({"a": "curve_len", "b": 1e-6}));
    let from_curve = is(&mut g, "shape", 3);
    let s0 = g.mul(&r_e1, "curve_len");
    let s0 = g.select(&zero, &s0, &from_curve);
    let run = g.mul("speed", &age);
    let sa = g.add(&s0, &run);
    let u = g.div(&sa, &len);
    let (p_along, tan) = curve_at(&mut g, &u);
    let v_along = g.mul(&tan, "speed");
    // It's gone once it runs off its curve's end, never held there.
    let past = g.s("gt@1", json!({"a": u, "b": 1.0}));
    let on_along = is(&mut g, "motion", 1);
    let ended = g.s("and@1", json!({"a": past, "b": on_along}));
    let stays = g.s("not@1", json!({"x": ended}));
    let alive = g.s("and@1", json!({"a": alive, "b": stays}));

    // An orbit about `axis` through the emitter at `spin` rad/s (Rodrigues' rotation).
    let k = g.s("normalize@1", json!({"x": "axis"}));
    let rel = g.sub(&b, "origin");
    let ang = g.mul("spin", &age);
    let ca = g.s("cos@1", json!({"x": ang}));
    let sn = g.s("sin@1", json!({"x": ang}));
    let kx = g.s("cross@1", json!({"a": k, "b": rel}));
    let kd = g.s("dot@1", json!({"a": k, "b": rel}));
    let r1 = g.mul(&rel, &ca);
    let r2 = g.mul(&kx, &sn);
    let omc = g.sub(&one, &ca);
    let kdo = g.mul(&kd, &omc);
    let r3 = g.mul(&k, &kdo);
    let rot = g.add(&r1, &r2);
    let rot = g.add(&rot, &r3);
    let p_orbit = g.add("origin", &rot);
    let kr = g.s("cross@1", json!({"a": k, "b": rot}));
    let v_orbit = g.mul(&kr, "spin");

    // A drift: each axis a sine of its own phase about where it was born.
    let w = g.mulk("frequency", deep_canvas::ops::TAU);
    let wa = g.mul(&w, &age);
    let mut sins = Vec::new();
    let mut coss = Vec::new();
    for kph in [8, 9, 10] {
        let r = rnd(&mut g, kph);
        let phase = g.mulk(&r, deep_canvas::ops::TAU);
        let x = g.add(&wa, &phase);
        sins.push(g.s("sin@1", json!({"x": x})));
        coss.push(g.s("cos@1", json!({"x": x})));
    }
    let wave = g.s(
        "compose@1",
        json!({"x": sins[0], "y": sins[1], "z": sins[2]}),
    );
    let slope = g.s(
        "compose@1",
        json!({"x": coss[0], "y": coss[1], "z": coss[2]}),
    );
    let dp = g.mul(&wave, "amplitude");
    let p_drift = g.add(&b, &dp);
    let aw = g.mul("amplitude", &w);
    let v_drift = g.mul(&slope, &aw);

    let mut p = p_bal;
    let mut v = v_bal;
    for (code, pm, vm) in [
        (1, &p_along, &v_along),
        (2, &p_orbit, &v_orbit),
        (3, &p_drift, &v_drift),
    ] {
        let c = is(&mut g, "motion", code);
        p = g.select(&p, pm, &c);
        v = g.select(&v, vm, &c);
    }
    let frac = g.div(&age, &life);
    let minus = g.c(json!(-1.0));
    let wl = g.select(&minus, &frac, &alive);
    let inside = g.s("lt@1", json!({"a": e, "b": "count"}));
    let floats = g.ty(json!(PARTICLE_FLOATS), "u32");
    let base = g.mul(&e, &floats);
    let mut lanes: Vec<(u32, String)> = Vec::new();
    for (k, lane) in [(0, "x"), (1, "y"), (2, "z")] {
        lanes.push((k, g.split(&p, lane)));
        lanes.push((k + 4, g.split(&v, lane)));
    }
    lanes.push((3, wl));
    for (k, val) in lanes {
        let kc = g.ty(json!(k), "u32");
        let at = g.add(&base, &kc);
        let id = g.s("write@1", json!({"buf": "inst", "i": at, "v": val}));
        set_when(&mut g, &id, &inside);
    }
    json!({
        "id": "particles.sparks@1", "kind": "compute", "origin": "shipped",
        "about": "Sparks: each particle's age, life, emit point, direction and speed are a closed form of t, its index, its generation and the item's seed, placed by its motion's closed form (ballistic with linear drag, along a curve, an orbit or a drift), written with its velocity as instance columns.",
        "inputs": {
            "count": param("particles.count", "u32", json!(256), [0.0, f64::from(MAX_PARTICLES_SHOWPIECE)]),
            "offset": param("particles.offset", "u32", json!(0), [0.0, f64::from(MAX_PARTICLES_SHOWPIECE)]),
            "rate": param("particles.rate", "f32", json!(100.0), [1e-3, 1e7]),
            "span": param("particles.span", "f32", json!(1e9), [0.0, 1e9]),
            "life_min": param("particles.life_min", "f32", json!(1.0), [1e-3, 1e4]),
            "life_max": param("particles.life_max", "f32", json!(1.0), [1e-3, 1e4]),
            "v0_min": param("particles.v0_min", "f32", json!(1.0), [0.0, 1e4]),
            "v0_max": param("particles.v0_max", "f32", json!(2.0), [0.0, 1e4]),
            "drag": param("particles.drag", "f32", json!(0.0), [0.0, 1e3]),
            "gravity": param("particles.gravity", "vec3", json!([0.0, -9.8, 0.0]), [-1e4, 1e4]),
            "origin": param("particles.origin", "vec3", json!([0.0, 0.0, 0.0]), [-1e9, 1e9]),
            "motion": param("particles.motion", "u32", json!(0), [0.0, 3.0]),
            "shape": param("particles.shape", "u32", json!(0), [0.0, 3.0]),
            "radius": param("particles.radius", "f32", json!(0.25), [0.0, 1e4]),
            "curve": {"type": format!("array<vec3<f32>, {CURVE_POINTS}>"), "from": {"param": "particles.curve"},
                      "default": vec![[0.0, 0.0, 0.0]; CURVE_POINTS as usize]},
            "curve_len": param("particles.curve_len", "f32", json!(0.0), [0.0, 1e9]),
            "speed": param("particles.speed", "f32", json!(1.0), [0.0, 1e4]),
            "axis": param("particles.axis", "vec3", json!([0.0, 1.0, 0.0]), [-1e4, 1e4]),
            "spin": param("particles.spin", "f32", json!(0.0), [-1e4, 1e4]),
            "amplitude": param("particles.amplitude", "f32", json!(0.0), [0.0, 1e4]),
            "frequency": param("particles.frequency", "f32", json!(0.0), [0.0, 1e4]),
            "seed": {"type": "u32", "from": "seed"},
        },
        "steps": g.done(),
        "outputs": {"inst": {"storage": {"type": "f32", "count": MAX_PARTICLES_SHOWPIECE * PARTICLE_FLOATS}}},
        "elements": MAX_PARTICLES, "workgroup": 64,
        "determinism": "same_machine", "cost": {"ns_per_element": 0.13},
    })
}

fn set_when(g: &mut G, step: &str, cond: &str) {
    if let Some(s) = g.steps.get_mut(step) {
        s["when"] = json!(cond);
    }
}

/// The px a pass of the shipped blur reaches at most.
pub const MAX_BLUR: f64 = 64.0;

/// The shipped blur's passes' cost, ns per pixel, as the calibration run measured them
/// (`deep-gpu` `calibrate`, rows `blur.x@1` and `blur.y@1`, costed by measurement): the lowest of
/// its five runs' 95th percentiles on Nov 8, 2026, on a reference Mac under other sessions' load
/// (its fixture.taps@1 read about 28 times its estimate), so a high reading until an idle run
/// replaces it. A composed pass that calls the blur costs its blur parts at these (#432).
pub const BLUR_MEASURED_NS_PER_PX: [(&str, f64); 2] = [("blur.x@1", 3.590), ("blur.y@1", 3.641)];

/// One axis of the shipped blur (Frame and group: passes): a Gaussian of `radius` px, 31 taps
/// across twice the radius, of the premultiplied color. A group runs `x`, then `y`.
pub fn blur(axis: &str) -> Value {
    let mut g = G::new();
    let uv = g.s("screen_uv@1", json!({}));
    let texel = texel(&mut g, "src");
    let along = g.ty(
        if axis == "x" {
            json!([1, 0])
        } else {
            json!([0, 1])
        },
        "vec2<f32>",
    );
    let px = g.mul(&texel, &along);
    let reach = g.mul(&px, "radius");
    let mut b = G::named("b");
    let i = b.convert("i", "f32");
    let half = b.c(json!(15.0));
    let centred = b.sub(&i, &half);
    let u = b.div(&centred, &half);
    let off = b.mul(&reach, &u);
    let at = b.add(&uv, &off);
    let tap = b.sample("src", &at);
    let uu = b.mul(&u, &u);
    let fall = b.mulk(&uu, -2.0);
    let weight = b.s("exp@1", json!({"x": fall}));
    let weighted = b.mul(&tap, &weight);
    b.named_step("sum", "add@1", json!({"a": "sum", "b": weighted}));
    b.named_step("total", "add@1", json!({"a": "total", "b": weight}));
    let taps = g.s(
        "repeat@1",
        json!({"count": 31, "index": "i", "accumulate": {
            "sum": {"type": "vec4<f32>", "init": [0, 0, 0, 0]},
            "total": {"type": "f32", "init": 0},
        }, "body": b.done()}),
    );
    let out = g.div(&format!("{taps}.sum"), &format!("{taps}.total"));
    let mut radius = param("radius", "f32", json!(8), [0.0, MAX_BLUR]);
    radius["unit"] = json!("px");
    pass(
        &format!("blur.{axis}@1"),
        "One axis of a Gaussian blur.",
        json!({"src": texture("core", "color", "texture"), "radius": radius}),
        g,
        &out,
        json!("full"),
        8.0,
    )
}

/// The tap counts frost@1's parts come in: a part sums one of these along its axis, the longest
/// 31 texel loads and the accumulator's one, the 32 fetches a pass may take. A kernel takes the
/// fewest taps that cover it.
pub const FROST_TAPS: [u32; 4] = [1, 7, 15, 31];

/// One part of frost@1 along `axis` (#1434): a Gaussian's taps `first` to `first + taps - 1` of the
/// texture `src`, each an exact texel load clamped to its bounds, weighted exp(−k²/2σ²) where
/// |k| ≤ `reach` (and 0 beyond it), over `total`, the whole kernel's weight; added to `keep` × the
/// part before's `acc`; then, with `tinted` 1, the premultiplied `tint` over it. A Gaussian of
/// reach ⌈3σ⌉ takes one part an axis of the fewest taps that cover it, or ⌈(2 reach + 1) ÷ 31⌉
/// parts of 31, horizontal then vertical, which the app lays out from σ (deep-effects-render's
/// chrome operators).
pub fn frost(axis: &str, taps: u32) -> Value {
    let mut g = G::new();
    let pix = g.s("pixel@1", json!({}));
    let at = g.convert(&pix, "vec2<i32>");
    let along = g.ty(
        if axis == "x" {
            json!([1, 0])
        } else {
            json!([0, 1])
        },
        "vec2<i32>",
    );
    let mut b = G::named("b");
    let i = b.convert("i", "f32");
    let k = b.add(&i, "first");
    let ki = b.convert(&k, "i32");
    let off = b.mul(&along, &ki);
    let tap_at = b.add(&at, &off);
    let tap = b.s("load@1", json!({"tex": "src", "ixy": tap_at}));
    let kk = b.mul(&k, &k);
    let e = b.mul(&kk, "falloff");
    let w = b.s("exp@1", json!({"x": e}));
    let ak = b.s("abs@1", json!({"x": k}));
    let inside = b.s("le@1", json!({"a": ak, "b": "reach"}));
    let zero = b.c(json!(0.0));
    let w = b.select(&zero, &w, &inside);
    let weighted = b.mul(&tap, &w);
    b.named_step("sum", "add@1", json!({"a": "sum", "b": weighted}));
    let taps = g.s(
        "repeat@1",
        json!({"count": taps, "index": "i", "accumulate": {
            "sum": {"type": "vec4<f32>", "init": [0, 0, 0, 0]},
        }, "body": b.done()}),
    );
    let part = g.div(&format!("{taps}.sum"), "total");
    let acc = g.s("load@1", json!({"tex": "acc", "ixy": at}));
    let kept = g.mul(&acc, "keep");
    let v = g.add(&kept, &part);
    let ta = g.split("tint", "a");
    let ta = g.mul(&ta, "tinted");
    let one = g.c(json!(1.0));
    let under = g.sub(&one, &ta);
    let v = g.mul(&v, &under);
    let over = g.mul("tint", "tinted");
    let out = g.add(&v, &over);
    let f = |path: &str, default: f64, range: [f64; 2]| param(path, "f32", json!(default), range);
    pass(
        &format!("frost.{axis}@1"),
        "One part of frost's Gaussian along an axis, and its tint on the last part.",
        json!({
            "src": texture("core", "color", "texture"),
            "acc": texture("core", "color", "texture"),
            "first": f("first", 0.0, [-1024.0, 1024.0]),
            "reach": f("reach", 0.0, [0.0, 1024.0]),
            "falloff": f("falloff", 0.0, [-1e9, 0.0]),
            "total": f("total", 1.0, [1e-9, 1e9]),
            "keep": f("keep", 0.0, [0.0, 1.0]),
            "tinted": f("tinted", 0.0, [0.0, 1.0]),
            "tint": param("tint", "vec4<f32>", json!([0, 0, 0, 0]), [0.0, 1.0]),
        }),
        g,
        &out,
        json!("full"),
        8.0,
    )
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

/// #508: the film effects' pass costs, ns per px at the effect's resolution (ms per megapixel),
/// each its `effect/<item>` pass (the pass and its upsample) as `view3d` timed it on this crate's
/// fixtures at 1920 × 1080 on a reference Mac (Mac17,10), Nov 15, 2026: the median of 90 frames,
/// three runs agreeing within 2%, under other sessions' load (load average 140 to 250), so a high
/// reading until an idle run replaces it. The haze's is the plume's reading with it less without.
pub const EFFECT_MEASURED_NS_PER_PX: [(&str, f64); 3] = [
    ("wave_field@1", 0.53),
    ("arc@1", 0.756),
    ("plume.haze@1", 0.15),
];

fn measured(name: &str) -> f64 {
    EFFECT_MEASURED_NS_PER_PX
        .iter()
        .find(|(n, _)| *n == name)
        .map_or(1.0, |(_, c)| *c)
}

/// Where the ray through screen position `at` meets the plane through `point` with normal `n`:
/// the hit (world), and whether it's in front of the eye.
fn plane_hit(g: &mut G, at: &str, point: &str, n: &str, inv: &str) -> (String, String) {
    let (p0, dir) = ray(g, at, inv);
    let to = g.sub(point, &p0);
    let rise = g.s("dot@1", json!({"a": to, "b": n}));
    let dn = g.s("dot@1", json!({"a": dir, "b": n}));
    // A ray parallel to the plane never meets it: its divisor moves off zero, and the sign test
    // refuses the t it gives.
    let tiny = g.c(json!(1e-12));
    let flat = g.s("eq@1", json!({"a": dn, "b": 0.0}));
    let dns = g.select(&dn, &tiny, &flat);
    let t = g.div(&rise, &dns);
    let step = g.mul(&dir, &t);
    let hit = g.add(&p0, &step);
    let front = g.s("gt@1", json!({"a": t, "b": 0.0}));
    (hit, front)
}

/// An emission pass of the film effects: its output is light to add, alpha 0, at the effect's
/// resolution, which the chain adds into scene color by its filtered upsample.
fn emission(id: &str, about: &str, inputs: Value, g: G, color: &str) -> Value {
    pass(id, about, inputs, g, color, json!("half"), measured(id))
}

/// The pixel centre at the pass's own resolution, px.
fn centre(g: &mut G) -> (String, String) {
    let pix = g.s("pixel@1", json!({}));
    let pixf = g.convert(&pix, "vec2<f32>");
    let half = g.c(json!([0.5, 0.5]));
    (pix, g.add(&pixf, &half))
}

/// wave_field@1 (#508; Effect: wave_field): rings on the plane through the anchor normal to the
/// axis, `amplitude × (0.5 + 0.5 cos(2π (r − speed t) ÷ wavelength + φ)) × (1 − smoothstep(radius
/// ÷ 2, radius, r))` in its role's color, r the hit's distance from the anchor and φ a phase from
/// the item's seed: a closed form of t and the seed. Hidden behind what's drawn.
pub fn wave_field() -> Value {
    let mut g = G::new();
    let inv = g.s("camera@1", json!({"of": "inverse_clip"}));
    let clip = g.s("camera@1", json!({"of": "clip"}));
    let (_, at) = centre(&mut g);
    let (hit, front) = plane_hit(&mut g, &at, "point", "normal", &inv);
    let d = g.sub(&hit, "point");
    let r = g.s("length@1", json!({"x": d}));
    let t = g.s("t@1", json!({}));
    let seed = g.s("seed@1", json!({}));
    let h = g.s("hash@1", json!({"a": seed, "b": 0x5741_5645u32}));
    let u = g.s("rand@1", json!({"key": h}));
    let phase = g.mulk(&u, deep_canvas::ops::TAU);
    let run = g.mul("speed", &t);
    let x = g.sub(&r, &run);
    let x = g.div(&x, "wavelength");
    let x = g.mulk(&x, deep_canvas::ops::TAU);
    let x = g.add(&x, &phase);
    let c = g.s("cos@1", json!({"x": x}));
    let wave = g.mulk(&c, 0.5);
    let wave = g.s("add@1", json!({"a": wave, "b": 0.5}));
    let inner = g.mulk("radius", 0.5);
    let fall = g.s("smoothstep@1", json!({"lo": inner, "hi": "radius", "x": r}));
    let one = g.c(json!(1.0));
    let fall = g.sub(&one, &fall);
    // Hidden behind what's drawn: reversed Z, the scene's depth read at the full-size pixel under
    // this one.
    let hx = g.split(&hit, "x");
    let hy = g.split(&hit, "y");
    let hz = g.split(&hit, "z");
    let hp = g.s("compose@1", json!({"x": hx, "y": hy, "z": hz, "w": one}));
    let hc = g.mul(&clip, &hp);
    let hcz = g.split(&hc, "z");
    let hcw = g.split(&hc, "w");
    let depth = g.div(&hcz, &hcw);
    let full = g.s("size@1", json!({"tex": "depth"}));
    let fullf = g.convert(&full, "vec2<f32>");
    let here = g.s("screen_size@1", json!({}));
    let k = g.div(&fullf, &here);
    let under = g.mul(&at, &k);
    let under = g.s("floor@1", json!({"x": under}));
    let under = g.convert(&under, "vec2<i32>");
    let scene = g.s("load@1", json!({"tex": "depth", "ixy": under}));
    let shows = g.s("ge@1", json!({"a": depth, "b": scene}));
    let visible = g.s("and@1", json!({"a": front, "b": shows}));
    let zero = g.c(json!(0.0));
    let on = g.select(&zero, &one, &visible);
    let e = g.mul(&wave, &fall);
    let e = g.mul(&e, "amplitude");
    let e = g.mul(&e, &on);
    let rgb = g.mul("color", &e);
    let out = g.s("compose@1", json!({"x": rgb, "y": zero}));
    emission(
        "wave_field@1",
        "A wave field: rings on the plane through its anchor normal to its axis, travelling out at its speed, falling off to its radius, in its role's color, hidden behind what's drawn; a closed form of t and its seed.",
        json!({
            "depth": texture("core", "depth", "depth"),
            "point": param("wave.point", "vec3", json!([0.0, 0.0, 0.0]), [-1e9, 1e9]),
            "normal": param("wave.normal", "vec3", json!([0.0, 1.0, 0.0]), [-1.0, 1.0]),
            "amplitude": param("wave.amplitude", "f32", json!(1.0), [0.0, 64.0]),
            "wavelength": param("wave.wavelength", "f32", json!(0.5), [1e-3, 1e3]),
            "speed": param("wave.speed", "f32", json!(1.0), [-1e3, 1e3]),
            "radius": param("wave.radius", "f32", json!(3.0), [1e-3, 1e4]),
            "color": {"type": "vec3", "from": {"role": "wave"}},
        }),
        g,
        &out,
    )
}

/// arc@1 (#508; Effect: arc): a bolt from the anchor to `to`, both projected to px. At the share s
/// along it, its line moves across by `jitter × noise@1(s × waves, ⌊t × rate⌋) × sin(π s)` px,
/// keyed by the item's seed, so it holds still between strikes and jumps `rate` times a second;
/// it glows `intensity × exp(−(d ÷ width)²)` in its role's color, d a pixel's distance to it.
pub fn arc() -> Value {
    let mut g = G::new();
    let clip = g.s("camera@1", json!({"of": "clip"}));
    let size = g.s("screen_size@1", json!({}));
    let one = g.c(json!(1.0));
    let zero = g.c(json!(0.0));
    let mut ends = Vec::new();
    for p in ["start", "end"] {
        let x = g.split(p, "x");
        let y = g.split(p, "y");
        let z = g.split(p, "z");
        let h = g.s("compose@1", json!({"x": x, "y": y, "z": z, "w": one}));
        let c = g.mul(&clip, &h);
        let xy = g.split(&c, "xy");
        let w = g.split(&c, "w");
        let front = g.s("gt@1", json!({"a": w, "b": 0.0}));
        let ndc = g.div(&xy, &w);
        let k = g.c(json!([0.5, -0.5]));
        let uv = g.mul(&ndc, &k);
        let hh = g.c(json!([0.5, 0.5]));
        let uv = g.add(&uv, &hh);
        ends.push((g.mul(&uv, &size), front));
    }
    let (a, b) = (ends[0].0.clone(), ends[1].0.clone());
    let (_, at) = centre(&mut g);
    let ab = g.sub(&b, &a);
    let len = g.s("length@1", json!({"x": ab}));
    let tiny = g.c(json!(1e-6));
    let len = g.s("max@1", json!({"a": len, "b": tiny}));
    let u = g.div(&ab, &len);
    let ux = g.split(&u, "x");
    let uy = g.split(&u, "y");
    let nx = g.s("neg@1", json!({"x": uy}));
    let n = g.s("compose@1", json!({"x": nx, "y": ux}));
    let ap = g.sub(&at, &a);
    let along = g.s("dot@1", json!({"a": ap, "b": u}));
    let across = g.s("dot@1", json!({"a": ap, "b": n}));
    let s = g.div(&along, &len);
    let s = g.s("clamp@1", json!({"x": s, "lo": 0.0, "hi": 1.0}));
    let t = g.s("t@1", json!({}));
    let tr = g.mul(&t, "rate");
    let strike = g.s("floor@1", json!({"x": tr}));
    let strike = g.s("add@1", json!({"a": strike, "b": 0.5}));
    let sw = g.mul(&s, "waves");
    let q = g.s("compose@1", json!({"x": sw, "y": strike}));
    let seed = g.s("seed@1", json!({}));
    let nz = g.s("noise@1", json!({"p": q, "seed": seed}));
    let nz = g.s("clamp@1", json!({"x": nz, "lo": -1.0, "hi": 1.0}));
    let ps = g.mulk(&s, deep_canvas::ops::PI);
    let bow = g.s("sin@1", json!({"x": ps}));
    let off = g.mul(&nz, &bow);
    let off = g.mul(&off, "jitter");
    let lat = g.sub(&across, &off);
    let inside = g.s("clamp@1", json!({"x": along, "lo": zero, "hi": len}));
    let past = g.sub(&along, &inside);
    let l2 = g.mul(&lat, &lat);
    let p2 = g.mul(&past, &past);
    let d2 = g.add(&l2, &p2);
    let w2 = g.mul("width", "width");
    let x = g.div(&d2, &w2);
    let x = g.s("neg@1", json!({"x": x}));
    let glow = g.s("exp@1", json!({"x": x}));
    let e = g.mul(&glow, "intensity");
    let shown = g.s("and@1", json!({"a": ends[0].1, "b": ends[1].1}));
    let on = g.select(&zero, &one, &shown);
    let e = g.mul(&e, &on);
    let rgb = g.mul("color", &e);
    let out = g.s("compose@1", json!({"x": rgb, "y": zero}));
    let f = |path: &str, default: f64, range: [f64; 2]| param(path, "f32", json!(default), range);
    emission(
        "arc@1",
        "An arc: a bolt between two points on screen, jittered across by seeded noise that holds still between strikes, `rate` strikes a second, glowing in its role's color; a closed form of t and its seed.",
        json!({
            "start": param("arc.from", "vec3", json!([0.0, 0.0, 0.0]), [-1e9, 1e9]),
            "end": param("arc.to", "vec3", json!([1.0, 0.0, 0.0]), [-1e9, 1e9]),
            "intensity": f("arc.intensity", 4.0, [0.0, 64.0]),
            "width": f("arc.width", 2.0, [0.0625, 64.0]),
            "jitter": f("arc.jitter", 12.0, [0.0, 256.0]),
            "rate": f("arc.rate", 12.0, [0.0, 120.0]),
            "waves": f("arc.waves", 6.0, [1.0, 64.0]),
            "color": {"type": "vec3", "from": {"role": "arc"}},
        }),
        g,
        &out,
    )
}

/// plume.haze@1 (#508; Effect: a plume's haze): scene color displaced inside the plume's screen
/// footprint `rect` (px, x0 y0 x1 y1). Each pixel loads the pixel `trunc(strength × mask × (n1,
/// n2) ÷ √2)` px from it, n1 and n2 twice seeded noise over (pixel − flow × t) ÷ cell, each
/// clamped to [−1, 1], so every pixel is an exact copy of one at most `strength` px away; the mask rises from
/// 0 at the rect's edge over a cell and is exactly 0 outside it, where every pixel loads itself.
pub fn haze() -> Value {
    let mut g = G::new();
    let (pix, at) = centre(&mut g);
    let pi = g.convert(&pix, "vec2<i32>");
    let lo = g.split("rect", "xy");
    let hi = g.split("rect", "zw");
    let e0 = g.sub(&at, &lo);
    let e1 = g.sub(&hi, &at);
    let e = g.s("min@1", json!({"a": e0, "b": e1}));
    let ex = g.split(&e, "x");
    let ey = g.split(&e, "y");
    let edge = g.s("min@1", json!({"a": ex, "b": ey}));
    let one = g.c(json!(1.0));
    let feather = g.s("max@1", json!({"a": "cell", "b": one}));
    let m = g.div(&edge, &feather);
    let m = g.s("clamp@1", json!({"x": m, "lo": 0.0, "hi": 1.0}));
    let t = g.s("t@1", json!({}));
    let drift = g.mul("flow", &t);
    let q = g.sub(&at, &drift);
    let q = g.div(&q, "cell");
    let seed = g.s("seed@1", json!({}));
    let n1 = g.s("noise@1", json!({"p": q, "seed": seed}));
    let k1 = g.ty(json!(1), "u32");
    let seed2 = g.add(&seed, &k1);
    let shift = g.c(json!([31.7, 11.3]));
    let q2 = g.add(&q, &shift);
    let n2 = g.s("noise@1", json!({"p": q2, "seed": seed2}));
    let nv = g.s("compose@1", json!({"x": n1, "y": n2}));
    // Gradient noise rarely leaves ±½: doubled, then clamped, the haze reaches its strength.
    let nv = g.mulk(&nv, 2.0);
    let lo1 = g.c(json!([-1.0, -1.0]));
    let hi1 = g.c(json!([1.0, 1.0]));
    let nv = g.s("clamp@1", json!({"x": nv, "lo": lo1, "hi": hi1}));
    let k = g.mul("strength", &m);
    let k = g.mulk(&k, std::f64::consts::FRAC_1_SQRT_2);
    let off = g.mul(&nv, &k);
    let off = g.s("trunc@1", json!({"x": off}));
    let oi = g.convert(&off, "vec2<i32>");
    let src = g.add(&pi, &oi);
    let size = g.s("size@1", json!({"tex": "color"}));
    let size = g.convert(&size, "vec2<i32>");
    let k1i = g.ty(json!([1, 1]), "vec2<i32>");
    let last = g.sub(&size, &k1i);
    let z = g.ty(json!([0, 0]), "vec2<i32>");
    let src = g.s("clamp@1", json!({"x": src, "lo": z, "hi": last}));
    let out = g.s("load@1", json!({"tex": "color", "ixy": src}));
    let mut strength = param("haze.strength", "f32", json!(4.0), [0.0, 32.0]);
    strength["unit"] = json!("px");
    pass(
        "plume.haze@1",
        "A plume's haze: scene color inside the plume's screen footprint, each pixel an exact copy of one at most strength px away by seeded noise drifting with the plume, a closed form of t; outside it every pixel is its own. Display only: it never feeds a check.",
        json!({
            "color": texture("core", "color", "texture"),
            "strength": strength,
            "cell": param("haze.cell", "f32", json!(32.0), [1e-3, 1e6]),
            "flow": param("haze.flow", "vec2<f32>", json!([0.0, -40.0]), [-1e6, 1e6]),
            "rect": param("haze.rect", "vec4<f32>", json!([0.0, 0.0, 16384.0, 16384.0]), [-1e6, 1e6]),
        }),
        g,
        &out,
        json!("full"),
        measured("plume.haze@1"),
    )
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
        // #508: the film effects' passes.
        Shipped {
            name: "wave_field@1",
            effect: Some("wave_field"),
            kind: Kind::Pass,
            noise: true,
            stages: vec![wave_field()],
        },
        Shipped {
            name: "arc@1",
            effect: Some("arc"),
            kind: Kind::Pass,
            noise: true,
            stages: vec![arc()],
        },
        Shipped {
            name: "plume.haze@1",
            effect: Some("plume"),
            kind: Kind::Pass,
            noise: true,
            stages: vec![haze()],
        },
        // #503: a depth video's frame as a 3D point set's records.
        Shipped {
            name: "points.video@1",
            effect: None,
            kind: Kind::Compute,
            noise: false,
            stages: vec![points()],
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::interp::{self, Env};
    use std::collections::BTreeMap;

    /// The particles operator over its first 256 slots, run by the CPU reference at `t`.
    fn positions(params: &BTreeMap<String, Value>, t: f64) -> Vec<f64> {
        let mut op = particles();
        op["elements"] = json!(256);
        let c = crate::check::read_and_check(&op).expect("the shipped particles operator checks");
        let env = Env {
            t,
            seed: 7,
            clip: [0.0; 16],
            inverse_clip: [0.0; 16],
            eye: [0.0; 4],
            inputs: interp::inputs(&c, params, &BTreeMap::new()),
            textures: BTreeMap::new(),
            normals: [[0.0; 3]; 3],
        };
        let out = interp::compute(&c, &env, BTreeMap::new()).expect("it runs");
        out["inst"][..256 * PARTICLE_FLOATS as usize].to_vec()
    }

    fn motion(code: u32) -> BTreeMap<String, Value> {
        let curve: Vec<[f64; 3]> = (0..CURVE_POINTS)
            .map(|k| [f64::from(k) * 0.1 - 1.5, 1.0, 0.0])
            .collect();
        BTreeMap::from([
            ("particles.count".into(), json!(256)),
            ("particles.rate".into(), json!(200.0)),
            ("particles.life_min".into(), json!(2.0)),
            ("particles.life_max".into(), json!(2.0)),
            ("particles.motion".into(), json!(code)),
            ("particles.shape".into(), json!(1)),
            ("particles.radius".into(), json!(0.5)),
            ("particles.curve".into(), json!(curve)),
            ("particles.curve_len".into(), json!(3.1)),
            ("particles.speed".into(), json!(1.5)),
            ("particles.spin".into(), json!(2.0)),
            ("particles.amplitude".into(), json!(0.4)),
            ("particles.frequency".into(), json!(0.7)),
        ])
    }

    /// Each motion is a closed form of t: evaluating at 1.2 s, then 0.4 s, then 1.2 s again
    /// gives what the first did, and it isn't the ballistic motion's.
    #[test]
    fn each_motion_is_a_pure_function_of_t_and_its_own() {
        let ballistic = positions(&motion(0), 1.2);
        for code in 1..4u32 {
            let name = MOTIONS[code as usize];
            let p = motion(code);
            let first = positions(&p, 1.2);
            let _ = positions(&p, 0.4);
            assert_eq!(positions(&p, 1.2), first, "{name} at 1.2 s, sought twice");
            assert_ne!(first, ballistic, "{name} moves as ballistic does");
            assert!(
                first.iter().all(|x| x.is_finite()),
                "{name} writes a non-finite value"
            );
        }
    }

    /// A pass graph run by the CPU reference at `t` with `seed`, over `size`, its params and
    /// textures given.
    fn run(
        op: &Value,
        params: &BTreeMap<String, Value>,
        textures: &BTreeMap<String, &interp::Image>,
        t: f64,
        seed: u32,
        size: [u32; 2],
    ) -> Vec<[f64; 4]> {
        let c = crate::check::read_and_check(op).expect("the shipped pass checks");
        let mut clip = [0.0; 16];
        for k in 0..4 {
            clip[k * 5] = 1.0;
        }
        let roles = BTreeMap::from([
            ("wave".to_string(), [1.0, 0.5, 0.25]),
            ("arc".to_string(), [0.25, 0.5, 1.0]),
        ]);
        let env = Env {
            t,
            seed,
            clip,
            inverse_clip: clip,
            eye: [0.0, 0.0, 2.0, 0.1],
            inputs: interp::inputs(&c, params, &roles),
            textures: textures.iter().map(|(k, v)| (k.clone(), *v)).collect(),
            normals: [[0.0; 3]; 3],
        };
        interp::pass(&c, &env, size).expect("it runs").px
    }

    /// A program replaced step by step: every `op` step a constant u32 0.
    fn without(op: &Value, step: &str) -> Value {
        let mut o = op.clone();
        for v in o["steps"].as_object_mut().expect("steps").values_mut() {
            if v["op"] == step {
                *v = json!({"op": "const@1", "args": {"value": 0, "type": "u32"}});
            }
        }
        o
    }

    /// `None` when `op` is a closed form of t that moves with t and differs by seed.
    fn pure_and_seeded(op: &Value, params: &BTreeMap<String, Value>) -> Option<String> {
        let depth = interp::Image::new(32, 24);
        let tex = BTreeMap::from([("depth".to_string(), &depth)]);
        let at = |t: f64, seed: u32| run(op, params, &tex, t, seed, [32, 24]);
        let first = at(1.3, 7);
        let _ = at(0.4, 7);
        if at(1.3, 7) != first {
            return Some("1.3 s sought again differs".into());
        }
        if first.iter().all(|p| p[..3].iter().all(|x| *x == 0.0)) {
            return Some("it draws nothing".into());
        }
        if at(0.4, 7) == first {
            return Some("it holds still from 0.4 s to 1.3 s".into());
        }
        if at(1.3, 8) == first {
            return Some("seeds 7 and 8 draw the same".into());
        }
        None
    }

    /// wave_field@1 and arc@1 are closed forms of t that move and differ by seed; their twins
    /// that never read the seed fail.
    #[test]
    fn wave_field_and_arc_are_pure_in_t_and_seeded() {
        let wave = BTreeMap::from([
            ("wave.point".to_string(), json!([0.0, 0.0, 0.5])),
            ("wave.normal".to_string(), json!([0.0, 0.0, 1.0])),
            ("wave.wavelength".to_string(), json!(0.3)),
            ("wave.radius".to_string(), json!(2.0)),
            ("wave.speed".to_string(), json!(0.37)),
        ]);
        let arc_p = BTreeMap::from([
            ("arc.from".to_string(), json!([-0.6, 0.1, 0.5])),
            ("arc.to".to_string(), json!([0.6, -0.1, 0.5])),
            ("arc.width".to_string(), json!(1.5)),
            ("arc.jitter".to_string(), json!(4.0)),
            ("arc.rate".to_string(), json!(10.0)),
        ]);
        for (op, params) in [(wave_field(), &wave), (arc(), &arc_p)] {
            assert_eq!(pure_and_seeded(&op, params), None, "{}", op["id"]);
            assert!(
                pure_and_seeded(&without(&op, "seed@1"), params).is_some(),
                "{}'s unseeded twin passes",
                op["id"]
            );
        }
    }

    /// `None` when the haze over a coordinate-coded image moves no pixel more than `strength` px,
    /// moves some inside `rect`, leaves every pixel outside it its own, and is pure in t.
    fn haze_holds(
        op: &Value,
        params: &BTreeMap<String, Value>,
        strength: f64,
        rect: [f64; 4],
    ) -> Option<String> {
        let (w, h) = (48u32, 40u32);
        let mut img = interp::Image::new(w, h);
        for (i, p) in img.px.iter_mut().enumerate() {
            *p = [f64::from(i as u32 % w), f64::from(i as u32 / w), 0.0, 1.0];
        }
        let tex = BTreeMap::from([("color".to_string(), &img)]);
        let at = |t: f64| run(op, params, &tex, t, 5, [w, h]);
        let first = at(1.3);
        let _ = at(0.4);
        if at(1.3) != first {
            return Some("1.3 s sought again differs".into());
        }
        let mut moved = 0;
        for (i, p) in first.iter().enumerate() {
            let (x, y) = (f64::from(i as u32 % w), f64::from(i as u32 / w));
            let (dx, dy) = (p[0] - x, p[1] - y);
            let inside =
                x + 0.5 > rect[0] && x + 0.5 < rect[2] && y + 0.5 > rect[1] && y + 0.5 < rect[3];
            if (dx * dx + dy * dy).sqrt() > strength {
                return Some(format!("({x}, {y}) moves ({dx}, {dy}), past {strength} px"));
            }
            if !inside && (dx, dy) != (0.0, 0.0) {
                return Some(format!("({x}, {y}) outside the rect moves ({dx}, {dy})"));
            }
            moved += usize::from((dx, dy) != (0.0, 0.0));
        }
        (moved == 0).then(|| "no pixel moves".to_string())
    }

    /// The haze copies each pixel from at most its strength away, inside its rect only, purely in
    /// t; the twins with a doubled strength and with no rect (a mask everywhere) fail.
    #[test]
    fn haze_moves_inside_its_rect_by_its_strength_at_most() {
        let rect = [8.0, 6.0, 40.0, 30.0];
        let params = |strength: f64, rect: [f64; 4]| {
            BTreeMap::from([
                ("haze.strength".to_string(), json!(strength)),
                ("haze.cell".to_string(), json!(6.0)),
                ("haze.flow".to_string(), json!([0.0, -9.0])),
                ("haze.rect".to_string(), json!(rect)),
            ])
        };
        let op = haze();
        assert_eq!(haze_holds(&op, &params(4.0, rect), 4.0, rect), None);
        assert!(
            haze_holds(&op, &params(8.0, rect), 4.0, rect).is_some(),
            "the doubled twin passes"
        );
        assert!(
            haze_holds(&op, &params(4.0, [0.0, 0.0, 48.0, 40.0]), 4.0, rect).is_some(),
            "the unmasked twin passes"
        );
    }
}

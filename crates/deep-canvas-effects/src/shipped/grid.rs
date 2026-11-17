use super::*;

/// The ray through screen position `at`: a point on it (world) and its direction, away from the
/// eye.
pub(super) fn ray(g: &mut G, at: &str, inv: &str) -> (String, String) {
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
    (p0, dir)
}

/// Where the ray through screen position `at` meets the plane y = `height`: the hit (world), and
/// whether it's in front of the eye.
pub(super) fn ground_hit(g: &mut G, at: &str, height: &str, inv: &str) -> (String, String) {
    let (p0, dir) = ray(g, at, inv);
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
pub(super) fn vogel(n: usize) -> Vec<[f64; 2]> {
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

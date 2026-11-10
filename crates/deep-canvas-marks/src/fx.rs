//! Issue #467: paint built from a mark's coverage (canvas primitives: Paint: drop; Paint: shade,
//! `kind: inner`; Paint: glow, bevel and satin). Each reads the mark's coverage at t, the shaped
//! run on text, and builds its layer with the shipped blur (31 taps of exp(−2u²) across twice the
//! radius, as `blur.x@1` and `blur.y@1` sample) and a dilation by a disc.
//!
//! This file is the CPU reference: every layer is a function of a coverage grid in device px.
//! The GPU layer runs the same arithmetic in f32 (`deep-gpu-layer/src/paintfx.wgsl`), and the two
//! agree within one 8-bit code value.

use serde_json::{Map, Value};

use deep_canvas::ops;

use crate::scene::{num, Palette, Refused, Rgb};

/// The px a blur, a glow's size, a bevel's size or a satin's reach takes at most: the shipped
/// blur's own limit.
pub const MAX_PX: f64 = 64.0;

/// Coverage, or one channel of a layer, over a grid of device px, row by row.
#[derive(Clone, Debug, PartialEq)]
pub struct Grid {
    pub w: usize,
    pub h: usize,
    pub a: Vec<f32>,
}

impl Grid {
    pub fn new(w: usize, h: usize) -> Grid {
        Grid {
            w,
            h,
            a: vec![0.0; w * h],
        }
    }

    pub fn at(&self, x: i64, y: i64) -> f32 {
        if x < 0 || y < 0 || x >= self.w as i64 || y >= self.h as i64 {
            0.0
        } else {
            self.a[y as usize * self.w + x as usize]
        }
    }

    /// Bilinear at a point in px, pixel centers at whole numbers plus a half; 0 outside.
    pub fn sample(&self, x: f32, y: f32) -> f32 {
        let (fx, fy) = (x - 0.5, y - 0.5);
        let (x0, y0) = (fx.floor(), fy.floor());
        let (tx, ty) = (fx - x0, fy - y0);
        let (x0, y0) = (x0 as i64, y0 as i64);
        let top = self.at(x0, y0) * (1.0 - tx) + self.at(x0 + 1, y0) * tx;
        let bottom = self.at(x0, y0 + 1) * (1.0 - tx) + self.at(x0 + 1, y0 + 1) * tx;
        top * (1.0 - ty) + bottom * ty
    }

    fn map(&self, f: impl Fn(usize, usize) -> f32) -> Grid {
        let mut out = Grid::new(self.w, self.h);
        for y in 0..self.h {
            for x in 0..self.w {
                out.a[y * self.w + x] = f(x, y);
            }
        }
        out
    }
}

/// The 31 weights of the shipped blur, exp(−2u²) at u = (i − 15) ÷ 15, normalized.
pub fn weights() -> [f32; 31] {
    let mut w = [0.0f32; 31];
    let mut total = 0.0f64;
    for (i, slot) in w.iter_mut().enumerate() {
        let u = (i as f64 - 15.0) / 15.0;
        let v = ops::exp(-2.0 * u * u);
        *slot = v as f32;
        total += v;
    }
    w.iter_mut().for_each(|v| *v = (f64::from(*v) / total) as f32);
    w
}

/// One axis of the shipped blur of `radius` px: tap i at (i − 15) ÷ 15 × radius px, bilinear.
pub fn blur_axis(g: &Grid, radius: f32, x_axis: bool) -> Grid {
    if radius <= 0.0 {
        return g.clone();
    }
    let w = weights();
    g.map(|x, y| {
        let (cx, cy) = (x as f32 + 0.5, y as f32 + 0.5);
        let mut sum = 0.0f32;
        for (i, wi) in w.iter().enumerate() {
            let off = radius * (i as f32 - 15.0) / 15.0;
            let v = if x_axis {
                g.sample(cx + off, cy)
            } else {
                g.sample(cx, cy + off)
            };
            sum += v * wi;
        }
        sum
    })
}

/// The shipped blur: x, then y.
pub fn blur(g: &Grid, radius: f32) -> Grid {
    blur_axis(&blur_axis(g, radius, true), radius, false)
}

/// A dilation by a disc of `r` px: each px the most of every px whose center lies within r.
pub fn dilate(g: &Grid, r: f32) -> Grid {
    if r <= 0.0 {
        return g.clone();
    }
    let reach = r.ceil() as i64;
    g.map(|x, y| {
        let mut most = 0.0f32;
        for dy in -reach..=reach {
            for dx in -reach..=reach {
                if ((dx * dx + dy * dy) as f32) <= r * r {
                    most = most.max(g.at(x as i64 + dx, y as i64 + dy));
                }
            }
        }
        most
    })
}

/// `g` moved by `d` px, bilinear.
pub fn shift(g: &Grid, d: [f32; 2]) -> Grid {
    g.map(|x, y| g.sample(x as f32 + 0.5 - d[0], y as f32 + 0.5 - d[1]))
}

/// The unit vector toward a light `deg` degrees counterclockwise from +x as seen, in y-down px
/// (the look's light: 135 is the upper left).
pub fn toward(deg: f64) -> [f32; 2] {
    let r = ops::rad(deg);
    [ops::cos(r) as f32, -ops::sin(r) as f32]
}

// ---------------------------------------------------------------------------------------------
// The fields, as read.

/// How a layer composites over what is under it.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Mode {
    Normal,
    Multiply,
    Screen,
    Add,
}

/// `drop {offset, role, opacity, blur, mode}`.
#[derive(Clone, Debug, PartialEq)]
pub struct Drop {
    pub color: Rgb,
    pub offset: [f64; 2],
    pub opacity: f64,
    pub blur: f64,
    pub mode: Mode,
}

/// `shade {kind: inner, role, offset, light, blur, choke, opacity, mode}`: an inner shadow.
#[derive(Clone, Debug, PartialEq)]
pub struct Inner {
    pub color: Rgb,
    pub offset: f64,
    /// Toward the light, in the look's degrees.
    pub light: f64,
    pub blur: f64,
    pub choke: f64,
    pub opacity: f64,
    pub mode: Mode,
}

/// `glow {where, role, size, spread, opacity, source, mode}`.
#[derive(Clone, Debug, PartialEq)]
pub struct Glow {
    pub inner: bool,
    pub color: Rgb,
    pub size: f64,
    pub spread: f64,
    pub opacity: f64,
    pub center: bool,
    pub mode: Mode,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Shape {
    Inner,
    Outer,
    Emboss,
    Pillow,
}

/// `bevel {shape, technique, depth, size, soften, light, highlight, shadow}`.
#[derive(Clone, Debug, PartialEq)]
pub struct Bevel {
    pub shape: Shape,
    pub chisel: bool,
    pub depth: f64,
    pub size: f64,
    pub soften: f64,
    /// Toward the light, in the look's degrees, and its altitude.
    pub angle: f64,
    pub altitude: f64,
    pub highlight: (Rgb, f64),
    pub shadow: (Rgb, f64),
}

/// `satin {role, offset, size, angle, invert, opacity, mode}`.
#[derive(Clone, Debug, PartialEq)]
pub struct Satin {
    pub color: Rgb,
    pub offset: f64,
    pub size: f64,
    pub angle: f64,
    pub invert: bool,
    pub opacity: f64,
    pub mode: Mode,
}

/// #1653: one of a text's `halo [{width, role, opacity, offset, blur}]`: the shaped run's outline
/// widened by width, shifted by offset and softened by blur, under the glyphs.
#[derive(Clone, Debug, PartialEq)]
pub struct Halo {
    pub color: Rgb,
    pub width: f64,
    pub opacity: f64,
    pub offset: [f64; 2],
    pub blur: f64,
    /// Its place among the text's halos as they draw, outermost first.
    pub order: usize,
}

/// The halos a text takes at most.
pub const MAX_HALOS: usize = 4;

/// Everything an item's paint builds from its coverage.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Fx {
    pub drop: Option<Drop>,
    pub inner: Option<Inner>,
    pub glow: Option<Glow>,
    pub bevel: Option<Bevel>,
    pub satin: Option<Satin>,
    /// A text's halos, widest first (#1653).
    pub halos: Vec<Halo>,
}

/// The look's light: its direction and elevation in degrees, 135 and 45 without one.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Light {
    pub dir: f64,
    pub elevation: f64,
}

impl Default for Light {
    fn default() -> Light {
        Light {
            dir: 135.0,
            elevation: 45.0,
        }
    }
}

struct Reader<'a> {
    palette: &'a Palette,
    o: &'a Map<String, Value>,
    path: String,
}

impl Reader<'_> {
    fn sub(&self, name: &str) -> Result<Option<Reader<'_>>, Refused> {
        match self.o.get(name) {
            None | Some(Value::Null) => Ok(None),
            Some(Value::Object(o)) => Ok(Some(Reader {
                palette: self.palette,
                o,
                path: format!("{}/{name}", self.path),
            })),
            Some(_) => Err(self.bad(name)),
        }
    }

    fn bad(&self, name: &str) -> Refused {
        Refused {
            code: "bad_doc",
            path: format!("{}/{name}", self.path),
        }
    }

    fn color(&self) -> Result<Rgb, Refused> {
        let name = self.o.get("role").and_then(Value::as_str).ok_or(Refused {
            code: "bad_paint",
            path: format!("{}/role", self.path),
        })?;
        self.palette.get(name).copied().ok_or(Refused {
            code: "role_unresolved",
            path: format!("{}/role", self.path),
        })
    }

    fn number(&self, name: &str, default: f64) -> Result<f64, Refused> {
        match self.o.get(name) {
            None | Some(Value::Null) => Ok(default),
            Some(v) => num(Some(v)).ok_or_else(|| self.bad(name)),
        }
    }

    fn within(&self, name: &str, default: f64, lo: f64, hi: f64) -> Result<f64, Refused> {
        let v = self.number(name, default)?;
        if (lo..=hi).contains(&v) {
            Ok(v)
        } else {
            Err(Refused {
                code: "out_of_range",
                path: format!("{}/{name}", self.path),
            })
        }
    }

    fn word<'w>(&self, name: &str, words: &[&'w str]) -> Result<&'w str, Refused> {
        match self.o.get(name) {
            None | Some(Value::Null) => Ok(words[0]),
            Some(Value::String(s)) => words
                .iter()
                .find(|w| **w == s.as_str())
                .copied()
                .ok_or_else(|| self.bad(name)),
            Some(_) => Err(self.bad(name)),
        }
    }

    fn mode(&self, words: &[&str]) -> Result<Mode, Refused> {
        Ok(match self.word("mode", words)? {
            "multiply" => Mode::Multiply,
            "screen" => Mode::Screen,
            "add" => Mode::Add,
            _ => Mode::Normal,
        })
    }

    fn pair(&self, name: &str, default: [f64; 2]) -> Result<[f64; 2], Refused> {
        match self.o.get(name) {
            None | Some(Value::Null) => Ok(default),
            Some(Value::Array(l)) if l.len() == 2 => match (num(l.first()), num(l.get(1))) {
                (Some(a), Some(b)) => Ok([a, b]),
                _ => Err(self.bad(name)),
            },
            Some(_) => Err(self.bad(name)),
        }
    }

    fn opacity(&self, default: f64) -> Result<f64, Refused> {
        self.within("opacity", default, 0.0, 1.0)
    }

    fn px(&self, name: &str, default: f64) -> Result<f64, Refused> {
        self.within(name, default, 0.0, MAX_PX)
    }

    /// `light: look | deg`, as a direction in the look's degrees.
    fn light(&self, look: Light) -> Result<f64, Refused> {
        match self.o.get("light") {
            None | Some(Value::Null) => Ok(look.dir),
            Some(Value::String(s)) if s == "look" => Ok(look.dir),
            Some(v) => num(Some(v)).ok_or_else(|| self.bad("light")),
        }
    }
}

impl Fx {
    /// Reads `drop`, `glow`, `bevel`, `satin` and an inner `shade` from `paint` at `path`.
    pub fn read(
        palette: &Palette,
        paint: &Map<String, Value>,
        path: &str,
        look: Light,
    ) -> Result<Fx, Refused> {
        let r = Reader {
            palette,
            o: paint,
            path: path.to_string(),
        };
        let mut fx = Fx::default();
        if let Some(d) = r.sub("drop")? {
            fx.drop = Some(Drop {
                color: d.color()?,
                offset: d.pair("offset", [6.0, 6.0])?,
                opacity: d.opacity(1.0)?,
                blur: d.px("blur", 0.0)?,
                mode: d.mode(&["normal", "multiply"])?,
            });
        }
        if let Some(s) = r.sub("shade")? {
            if s.o.get("kind").and_then(Value::as_str) == Some("inner") {
                fx.inner = Some(Inner {
                    color: s.color()?,
                    offset: s.px("offset", 6.0)?,
                    light: s.light(look)?,
                    blur: s.px("blur", 0.0)?,
                    choke: s.within("choke", 0.0, 0.0, 1.0)?,
                    opacity: s.opacity(1.0)?,
                    mode: s.mode(&["normal", "multiply"])?,
                });
            }
        }
        if let Some(g) = r.sub("glow")? {
            fx.glow = Some(Glow {
                inner: g.word("where", &["outer", "inner"])? == "inner",
                color: g.color()?,
                size: g.px("size", 10.0)?,
                spread: g.within("spread", 0.0, 0.0, 1.0)?,
                opacity: g.opacity(0.75)?,
                center: g.word("source", &["edge", "center"])? == "center",
                mode: g.mode(&["screen", "normal", "add"])?,
            });
        }
        if let Some(b) = r.sub("bevel")? {
            let (angle, altitude) = match b.o.get("light") {
                None | Some(Value::Null) => (look.dir, look.elevation),
                Some(Value::String(s)) if s == "look" => (look.dir, look.elevation),
                Some(Value::Object(_)) => {
                    let l = b.sub("light")?.expect("an object");
                    (
                        l.number("angle", look.dir)?,
                        l.within("altitude", look.elevation, 0.0, 90.0)?,
                    )
                }
                Some(_) => return Err(b.bad("light")),
            };
            let side = |name: &str| -> Result<(Rgb, f64), Refused> {
                let s = b.sub(name)?.ok_or(Refused {
                    code: "bad_paint",
                    path: format!("{}/{name}/role", b.path),
                })?;
                Ok((s.color()?, s.opacity(0.75)?))
            };
            fx.bevel = Some(Bevel {
                shape: match b.word("shape", &["inner", "outer", "emboss", "pillow"])? {
                    "outer" => Shape::Outer,
                    "emboss" => Shape::Emboss,
                    "pillow" => Shape::Pillow,
                    _ => Shape::Inner,
                },
                chisel: b.word("technique", &["smooth", "chisel"])? == "chisel",
                depth: b.within("depth", 1.0, 0.0, 10.0)?,
                size: b.within("size", 5.0, 0.5, MAX_PX)?,
                soften: b.px("soften", 0.0)?,
                angle,
                altitude,
                highlight: side("highlight")?,
                shadow: side("shadow")?,
            });
        }
        if let Some(s) = r.sub("satin")? {
            fx.satin = Some(Satin {
                color: s.color()?,
                offset: s.px("offset", 10.0)?,
                size: s.px("size", 14.0)?,
                angle: s.number("angle", 19.0)?,
                invert: !matches!(s.o.get("invert"), Some(Value::Bool(false))),
                opacity: s.opacity(0.5)?,
                mode: s.mode(&["multiply", "normal"])?,
            });
        }
        Ok(fx)
    }
}

/// A text's `halo` at `path` (`items/<id>/params/halo`), widest first, ties as written: at most
/// [`MAX_HALOS`], each in a role of the look.
pub fn halos(palette: &Palette, halo: Option<&Value>, path: &str) -> Result<Vec<Halo>, Refused> {
    let list = match halo {
        None | Some(Value::Null) => return Ok(Vec::new()),
        Some(Value::Array(l)) => l,
        Some(_) => {
            return Err(Refused {
                code: "bad_doc",
                path: path.to_string(),
            })
        }
    };
    if list.len() > MAX_HALOS {
        return Err(Refused {
            code: "out_of_range",
            path: path.to_string(),
        });
    }
    let mut out = Vec::new();
    for (i, h) in list.iter().enumerate() {
        let Some(o) = h.as_object() else {
            return Err(Refused {
                code: "bad_doc",
                path: format!("{path}/{i}"),
            });
        };
        let r = Reader {
            palette,
            o,
            path: format!("{path}/{i}"),
        };
        out.push(Halo {
            color: r.color()?,
            width: r.px("width", 2.0)?,
            opacity: r.opacity(1.0)?,
            offset: r.pair("offset", [0.0, 0.0])?,
            blur: r.px("blur", 0.0)?,
            order: 0,
        });
    }
    out.sort_by(|a, b| b.width.total_cmp(&a.width));
    out.iter_mut().enumerate().for_each(|(i, h)| h.order = i);
    Ok(out)
}

// ---------------------------------------------------------------------------------------------
// The layers, from coverage.

/// A halo: the coverage widened by a disc of its width, moved by its offset, then blurred.
pub fn halo_alpha(a: &Grid, h: &Halo, scale: f32) -> Grid {
    let grown = dilate(a, h.width as f32 * scale);
    let moved = shift(
        &grown,
        [h.offset[0] as f32 * scale, h.offset[1] as f32 * scale],
    );
    let mut g = blur(&moved, h.blur as f32 * scale);
    g.a.iter_mut().for_each(|v| *v *= h.opacity as f32);
    g
}

/// The blurred drop: coverage moved by the offset, then blurred.
pub fn drop_alpha(a: &Grid, d: &Drop, scale: f32) -> Grid {
    let moved = shift(a, [d.offset[0] as f32 * scale, d.offset[1] as f32 * scale]);
    let mut g = blur(&moved, d.blur as f32 * scale);
    g.a.iter_mut().for_each(|v| *v *= d.opacity as f32);
    g
}

/// The inner shadow: the outside, moved away from the light, spread by choke, blurred, inside
/// the coverage.
pub fn inner_alpha(a: &Grid, s: &Inner, scale: f32) -> Grid {
    let l = toward(s.light);
    let off = s.offset as f32 * scale;
    // The outside moved away from the light: past the grid's edges it reads 1, as outside.
    let moved = a.map(|x, y| {
        let (sx, sy) = (x as f32 + 0.5 + l[0] * off, y as f32 + 0.5 + l[1] * off);
        1.0 - a.sample(sx, sy)
    });
    let radius = s.blur as f32 * scale;
    let grown = dilate(&moved, radius * s.choke as f32);
    let soft = blur(&grown, radius * (1.0 - s.choke as f32));
    soft.map(|x, y| {
        let i = y * a.w + x;
        (soft.a[i] * a.a[i] * s.opacity as f32).clamp(0.0, 1.0)
    })
}

/// A glow: the coverage grown by spread × size and blurred over the rest of size; outside the
/// coverage, or inside it from the edge or from the center.
pub fn glow_alpha(a: &Grid, g: &Glow, scale: f32) -> Grid {
    let size = g.size as f32 * scale;
    let spread = g.spread as f32;
    // Inner: the outside grown and blurred into the shape (the grid is padded, so its edges are
    // outside the coverage).
    let source = if g.inner {
        a.map(|x, y| 1.0 - a.a[y * a.w + x])
    } else {
        a.clone()
    };
    let soft = blur(&dilate(&source, size * spread), size * (1.0 - spread));
    let o = g.opacity as f32;
    soft.map(|x, y| {
        let i = y * a.w + x;
        let c = a.a[i];
        let v = match (g.inner, g.center) {
            (false, _) => soft.a[i] * (1.0 - c),
            (true, false) => soft.a[i] * c,
            // From the center: deepest where the edge's glow is least.
            (true, true) => (1.0 - soft.a[i]) * c,
        };
        (v * o).clamp(0.0, 1.0)
    })
}

/// The signed distance from each px center to the coverage's edge, in px, positive inside, out to
/// `reach` px: the nearest px on the other side of the half-coverage line, less half a px, with
/// the edge px placed by their coverage.
pub fn distance(a: &Grid, reach: f32) -> Grid {
    let r = reach.ceil() as i64 + 1;
    a.map(|x, y| {
        let c = a.a[y * a.w + x];
        let inside = c >= 0.5;
        let mut best = reach + 1.0;
        for dy in -r..=r {
            for dx in -r..=r {
                let o = a.at(x as i64 + dx, y as i64 + dy);
                if (o >= 0.5) != inside {
                    let d = ops::sqrt((dx * dx + dy * dy) as f64) as f32;
                    best = best.min(d);
                }
            }
        }
        // The edge lies about half a px short of the nearest px across it, by coverage.
        let edge = if best <= 1.0 {
            (c - 0.5).abs()
        } else {
            best - 0.5
        };
        let d = edge.min(reach + 1.0);
        if inside {
            d
        } else {
            -d
        }
    })
}

/// A bevel's height in 0..1 at each px, from the signed distance.
pub fn height(a: &Grid, b: &Bevel, scale: f32) -> Grid {
    let size = (b.size as f32 * scale).max(0.5);
    let d = distance(a, size);
    let ramp = |v: f32| (v / size).clamp(0.0, 1.0);
    let shaped = |v: f32| if b.chisel { v } else { v * v * (3.0 - 2.0 * v) };
    let h = d.map(|x, y| {
        let s = d.a[y * d.w + x];
        match b.shape {
            Shape::Inner => shaped(ramp(s)),
            // Out from the edge: rising toward the coverage.
            Shape::Outer => shaped(ramp(s + size)),
            Shape::Emboss => shaped(ramp(s + size) * 0.5 + ramp(s) * 0.5),
            // Down at the edge on both sides.
            Shape::Pillow => {
                if s >= 0.0 {
                    shaped(ramp(s))
                } else {
                    shaped(ramp(-s))
                }
            }
        }
    });
    blur(&h, b.soften as f32 * scale)
}

/// A bevel's highlight and shadow alphas: the height field lit from the angle and altitude, the
/// part brighter than a flat face in the highlight and the part darker in the shadow, where the
/// bevel's shape draws.
pub fn bevel_alpha(a: &Grid, b: &Bevel, scale: f32) -> (Grid, Grid) {
    let size = (b.size as f32 * scale).max(0.5);
    let h = height(a, b, scale);
    let l = toward(b.angle);
    let alt = ops::rad(b.altitude);
    let (lc, lz) = (ops::cos(alt) as f32, ops::sin(alt) as f32);
    let light = [l[0] * lc, l[1] * lc, lz];
    // At depth 1 the bevel rises twice its size across it: about 63° at a chisel's slope.
    let k = 2.0 * b.depth as f32 * size;
    let lit = h.map(|x, y| {
        let (x, y) = (x as i64, y as i64);
        let hx = (h.at(x + 1, y) - h.at(x - 1, y)) * 0.5;
        let hy = (h.at(x, y + 1) - h.at(x, y - 1)) * 0.5;
        let n = [-hx * k, -hy * k, 1.0];
        let len = ops::sqrt(f64::from(n[0] * n[0] + n[1] * n[1] + 1.0)) as f32;
        (n[0] * light[0] + n[1] * light[1] + light[2]) / len - lz
    });
    let region = |x: usize, y: usize| -> f32 {
        let c = a.a[y * a.w + x];
        match b.shape {
            Shape::Inner => c,
            Shape::Outer => 1.0 - c,
            Shape::Emboss | Shape::Pillow => 1.0,
        }
    };
    let (ho, so) = (b.highlight.1 as f32, b.shadow.1 as f32);
    let up = (1.0 - lz).max(1e-3);
    let down = lz.max(1e-3);
    let high = lit.map(|x, y| (lit.a[y * lit.w + x] / up).clamp(0.0, 1.0) * ho * region(x, y));
    let low = lit.map(|x, y| (-lit.a[y * lit.w + x] / down).clamp(0.0, 1.0) * so * region(x, y));
    (high, low)
}

/// Satin: the coverage moved offset px both ways along angle, blurred by size, differenced,
/// inside the coverage; inverted, it's 1 less that.
pub fn satin_alpha(a: &Grid, s: &Satin, scale: f32) -> Grid {
    let l = toward(s.angle);
    let off = s.offset as f32 * scale;
    let one = blur(&shift(a, [l[0] * off, l[1] * off]), s.size as f32 * scale);
    let two = blur(&shift(a, [-l[0] * off, -l[1] * off]), s.size as f32 * scale);
    let o = s.opacity as f32;
    a.map(|x, y| {
        let i = y * a.w + x;
        let d = (one.a[i] - two.a[i]).abs();
        let v = if s.invert { 1.0 - d } else { d };
        (v * a.a[i] * o).clamp(0.0, 1.0)
    })
}

/// One layer an item draws from its coverage, as the scene hands it to a renderer.
#[derive(Clone, Debug, PartialEq)]
pub enum Part {
    Drop(Drop),
    Glow(Glow),
    Inner(Inner),
    Satin(Satin),
    /// The bevel's shadow (`false`) or its highlight (`true`).
    Bevel(Bevel, bool),
    Halo(Halo),
}

impl Part {
    /// Its name in `<item>#<name>`.
    pub fn name(&self) -> &'static str {
        match self {
            Part::Drop(_) => "drop",
            Part::Glow(_) => "glow",
            Part::Inner(_) => "shade",
            Part::Satin(_) => "satin",
            Part::Bevel(_, false) => "bevel.shadow",
            Part::Bevel(_, true) => "bevel.highlight",
            Part::Halo(h) => ["halo.0", "halo.1", "halo.2", "halo.3"][h.order.min(MAX_HALOS - 1)],
        }
    }

    pub fn color(&self) -> Rgb {
        match self {
            Part::Drop(d) => d.color,
            Part::Glow(g) => g.color,
            Part::Inner(s) => s.color,
            Part::Satin(s) => s.color,
            Part::Bevel(b, false) => b.shadow.0,
            Part::Bevel(b, true) => b.highlight.0,
            Part::Halo(h) => h.color,
        }
    }

    pub fn mode(&self) -> Mode {
        match self {
            Part::Drop(d) => d.mode,
            Part::Glow(g) => g.mode,
            Part::Inner(s) => s.mode,
            Part::Satin(s) => s.mode,
            Part::Bevel(..) | Part::Halo(_) => Mode::Normal,
        }
    }

    /// Whether it draws under the item's own marks: a drop, an outer glow and a halo.
    pub fn under(&self) -> bool {
        matches!(self, Part::Drop(_) | Part::Halo(_)) || matches!(self, Part::Glow(g) if !g.inner)
    }

    /// The px past the coverage its ops read or draw: a crop that keeps this much clear around
    /// the coverage computes what the whole frame would.
    pub fn margin(&self) -> f32 {
        let m = match self {
            Part::Drop(d) => d.blur + d.offset[0].abs().max(d.offset[1].abs()),
            Part::Glow(g) => g.size,
            Part::Inner(s) => s.blur + s.offset,
            Part::Satin(s) => s.size + s.offset,
            Part::Bevel(b, _) => 2.0 * b.size + b.soften,
            Part::Halo(h) => h.width + h.blur + h.offset[0].abs().max(h.offset[1].abs()),
        };
        m as f32 + 4.0
    }

    /// How far it draws past the item's own run, in u: [left, top, right, bottom]. Inner parts
    /// draw inside the coverage; the outer ones reach a px past their blur's last tap.
    pub fn reach(&self) -> [f64; 4] {
        match self {
            Part::Drop(d) => {
                let r = d.blur + 1.0;
                let [x, y] = d.offset;
                [
                    r - x.min(0.0),
                    r - y.min(0.0),
                    r + x.max(0.0),
                    r + y.max(0.0),
                ]
            }
            Part::Halo(h) => {
                let r = h.width + h.blur + 1.0;
                let [x, y] = h.offset;
                [r - x, r - y, r + x, r + y].map(|v| v.max(0.0))
            }
            Part::Glow(g) if !g.inner => [g.size + 1.0; 4],
            Part::Bevel(b, _) if b.shape != Shape::Inner => [b.size + b.soften + 1.0; 4],
            _ => [0.0; 4],
        }
    }

    /// Its alpha over `a`, coverage in device px at `scale` px a u.
    pub fn alpha(&self, a: &Grid, scale: f32) -> Grid {
        match self {
            Part::Drop(d) => drop_alpha(a, d, scale),
            Part::Glow(g) => glow_alpha(a, g, scale),
            Part::Inner(s) => inner_alpha(a, s, scale),
            Part::Satin(s) => satin_alpha(a, s, scale),
            Part::Halo(h) => halo_alpha(a, h, scale),
            Part::Bevel(b, high) => {
                let (h, l) = bevel_alpha(a, b, scale);
                if *high {
                    h
                } else {
                    l
                }
            }
        }
    }
}

impl Fx {
    /// Every part, in draw order: under the item's own marks first, then over them.
    pub fn parts(&self) -> Vec<Part> {
        let mut out = Vec::new();
        if let Some(d) = self.drop.as_ref().filter(|d| d.blur > 0.0) {
            out.push(Part::Drop(d.clone()));
        }
        if let Some(g) = self.glow.as_ref().filter(|g| !g.inner) {
            out.push(Part::Glow(g.clone()));
        }
        // Halos right under the glyphs, from the outside in.
        out.extend(self.halos.iter().cloned().map(Part::Halo));
        if let Some(s) = &self.inner {
            out.push(Part::Inner(s.clone()));
        }
        if let Some(g) = self.glow.as_ref().filter(|g| g.inner) {
            out.push(Part::Glow(g.clone()));
        }
        if let Some(s) = &self.satin {
            out.push(Part::Satin(s.clone()));
        }
        if let Some(b) = &self.bevel {
            out.push(Part::Bevel(b.clone(), false));
            out.push(Part::Bevel(b.clone(), true));
        }
        out
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn disc(n: usize, r: f32) -> Grid {
        let c = n as f32 / 2.0;
        let g = Grid::new(n, n);
        g.map(|x, y| {
            let (dx, dy) = (x as f32 + 0.5 - c, y as f32 + 0.5 - c);
            let d = ops::sqrt(f64::from(dx * dx + dy * dy)) as f32;
            (r - d + 0.5).clamp(0.0, 1.0)
        })
    }

    #[test]
    fn the_blur_keeps_its_total_away_from_the_edges() {
        let mut g = Grid::new(64, 64);
        g.a[32 * 64 + 32] = 1.0;
        let b = blur(&g, 6.0);
        let total: f32 = b.a.iter().sum();
        assert!((total - 1.0).abs() < 1e-3, "{total}");
    }

    #[test]
    fn a_bevel_lit_from_the_upper_left_brightens_that_rim() {
        let a = disc(120, 40.0);
        let b = Bevel {
            shape: Shape::Inner,
            chisel: false,
            depth: 1.0,
            size: 5.0,
            soften: 0.0,
            angle: 135.0,
            altitude: 30.0,
            highlight: ([255, 255, 255], 0.75),
            shadow: ([0, 0, 0], 0.75),
        };
        let (high, _) = bevel_alpha(&a, &b, 1.0);
        let ul = high.at(60 - 26, 60 - 26);
        let lr = high.at(60 + 26, 60 + 26);
        assert!(ul > lr + 0.5, "{ul} {lr}");
    }

    #[test]
    fn a_disc_bevel_s_rims_differ_by_more_than_half() {
        // AC5's disc: r 100 at (160.5, 160.5) in 320 px, size 10, lit from 135° at 30°.
        let g = Grid::new(320, 320);
        let a = g.map(|x, y| {
            let (dx, dy) = (x as f32 + 0.5 - 160.5, y as f32 + 0.5 - 160.5);
            (100.0 - ops::sqrt(f64::from(dx * dx + dy * dy)) as f32 + 0.5).clamp(0.0, 1.0)
        });
        let b = Bevel {
            shape: Shape::Inner,
            chisel: false,
            depth: 1.0,
            size: 10.0,
            soften: 0.0,
            angle: 135.0,
            altitude: 30.0,
            highlight: ([255, 255, 255], 1.0),
            shadow: ([0, 0, 0], 1.0),
        };
        let (high, _) = bevel_alpha(&a, &b, 1.0);
        let rim = |of: f64| {
            let (mut sum, mut n) = (0.0f64, 0.0f64);
            for y in 0..320 {
                for x in 0..320 {
                    let (dx, dy) = (x as f64 + 0.5 - 160.5, y as f64 + 0.5 - 160.5);
                    let inside = 100.0 - ops::sqrt(dx * dx + dy * dy);
                    let deg = ops::atan2(-dy, dx) * 180.0 / std::f64::consts::PI;
                    let off = ((deg - of + 540.0) % 360.0 - 180.0).abs();
                    if (1.5..=9.5).contains(&inside) && off <= 45.0 {
                        sum += f64::from(high.at(x, y));
                        n += 1.0;
                    }
                }
            }
            sum / n
        };
        let (ul, lr) = (rim(135.0), rim(315.0));
        assert!(ul - lr >= 0.6, "{ul} {lr}");
    }

    #[test]
    fn an_outer_glow_is_zero_inside_and_falls_outside() {
        let a = disc(120, 30.0);
        let g = Glow {
            inner: false,
            color: [255, 255, 255],
            size: 10.0,
            spread: 0.0,
            opacity: 0.75,
            center: false,
            mode: Mode::Screen,
        };
        let glow = glow_alpha(&a, &g, 1.0);
        assert_eq!(glow.at(60, 60), 0.0);
        let row: Vec<f32> = (91..110).map(|x| glow.at(x, 60)).collect();
        assert!(row.windows(2).all(|w| w[1] <= w[0]), "{row:?}");
    }
}

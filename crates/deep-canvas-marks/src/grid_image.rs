//! Issue #269: the grid image mark. A 2D mark draws a logic item's i32 grid as an image, each
//! value picking one of its roles (a look role, or `none`), read through the core's column view
//! as the logic module gives the array at t, so seeking equals playing and the marks module never
//! depends on logic. `nearest` reads each pixel's own cell; `smooth` rebuilds each role's share
//! (1 in the cells that hold it, 0 elsewhere) by the interpolating Catmull-Rom cubic over the
//! cells, so a cell's own centre keeps its role and the shares sum to 1, and each pixel takes the
//! role with the largest share, ties to the lower index, antialiased over `edge` px toward the
//! runner-up. A value past the roles draws nothing in its cell and raises `grid.out_of_range`.
//!
//! The rebuild here is the CPU's; the GPU layer's shader computes the same sums in the same f32
//! order, so the two agree within one 8-bit level.

use deep_canvas::columns::{excursions_by, mapped, source, Mapped, Read};
use deep_canvas::document::Issue;
use deep_canvas::registry::lists::SealedEntry;
use deep_canvas::registry::Registrar;
use deep_canvas::schedule::core_ops::{Datum, Edit, Edits};
use deep_canvas::schedule::{OpError, Val, View};
use serde_json::{json, Map, Value};
use sha2::Digest;

/// Most roles a grid image lists.
pub const MAX_ROLES: usize = 16;

/// The class of a cell whose value passes the roles: it draws nothing.
pub const OUT: u8 = MAX_ROLES as u8;

/// The code a cell whose value passes the roles raises.
pub const OUT_OF_RANGE: &str = "grid.out_of_range";

/// How a pixel reads the grid.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Sample {
    Nearest,
    Smooth,
}

/// The wrong programs a proof plants into the rebuild.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum Planted {
    #[default]
    None,
    /// The approximating cubic B-spline in place of Catmull-Rom.
    Bspline,
    /// A bilinear rebuild over the four nearest cells.
    Bilinear,
    /// A role draws only where its share passes 1/2.
    HalfShare,
}

/// A grid image's fields, read.
#[derive(Clone, Debug, PartialEq)]
pub struct Spec<'a> {
    pub array: &'a str,
    pub cols: usize,
    pub rows: usize,
    /// A cell's width and height in u.
    pub cell: [f64; 2],
    /// Each role's name, `None` for `none`.
    pub roles: Vec<Option<&'a str>>,
    pub sample: Sample,
    /// The antialiased band at a role's edge, in px.
    pub edge: f64,
}

/// The fields of a grid image's `params`, or the field it fails at and why.
pub fn spec(params: &Value) -> Result<Spec<'_>, (String, String)> {
    let bad = |f: &str, what: &str| Err((f.to_string(), what.to_string()));
    let Some(array) = params["grid"].as_str().filter(|a| a.contains('.')) else {
        return bad(
            "grid",
            "a grid image reads a logic item's i32 grid, <logic>.<name>",
        );
    };
    let side = |i: usize| {
        params["size"][i]
            .as_u64()
            .filter(|n| (1..=u64::from(u16::MAX)).contains(n))
            .map(|n| n as usize)
    };
    let (Some(cols), Some(rows)) = (side(0), side(1)) else {
        return bad(
            "size",
            "a grid image's size is [cols, rows], each from 1 to 65,535 (u16)",
        );
    };
    let cell = |i: usize| params["cell"][i].as_f64().filter(|c| *c > 0.0);
    let (Some(cw), Some(ch)) = (cell(0), cell(1)) else {
        return bad(
            "cell",
            "a grid image's cell is its width and height in u, each above 0",
        );
    };
    let roles: Option<Vec<Option<&str>>> = params["roles"]
        .as_array()
        .filter(|l| !l.is_empty() && l.len() <= MAX_ROLES)
        .and_then(|l| {
            l.iter()
                .map(|r| r.as_str().map(|r| (r != "none").then_some(r)))
                .collect()
        });
    let Some(roles) = roles else {
        return bad(
            "roles",
            "a grid image lists 1 to 16 roles, each a look role or none",
        );
    };
    let sample = match params.get("sample").and_then(Value::as_str) {
        None | Some("nearest") => Sample::Nearest,
        Some("smooth") => Sample::Smooth,
        Some(_) => return bad("sample", "a grid image samples nearest or smooth"),
    };
    let edge = match params.get("edge") {
        None => 1.0,
        Some(e) => match e.as_f64().filter(|e| (0.0..=64.0).contains(e)) {
            Some(e) => e,
            None => return bad("edge", "a grid image's edge is 0 to 64 px"),
        },
    };
    Ok(Spec {
        array,
        cols,
        rows,
        cell: [cw, ch],
        roles,
        sample,
        edge,
    })
}

impl Spec<'_> {
    /// A value's class: its role's index, or [`OUT`] for one past the roles or no i32.
    pub fn class(&self, value: f64) -> u8 {
        let fits = value.fract() == 0.0 && value >= 0.0 && value < self.roles.len() as f64;
        if fits {
            value as u8
        } else {
            OUT
        }
    }

    /// The image's size in u.
    pub fn extent(&self) -> [f64; 2] {
        [
            self.cols as f64 * self.cell[0],
            self.rows as f64 * self.cell[1],
        ]
    }
}

/// Whether `item` is a grid image.
pub fn is_grid_image(item: &Value) -> bool {
    item["kind"] == "grid_image@1"
}

fn grid_images(form: &Value) -> impl Iterator<Item = (&String, &Value)> {
    form.get("items")
        .and_then(Value::as_object)
        .into_iter()
        .flatten()
        .filter(|(_, i)| is_grid_image(i))
}

fn path(id: &str, f: &str) -> String {
    format!("items/{id}/params/{f}")
}

/// The baked array `s` reads, or the refusal: through the core's view (`module_missing` naming
/// logic in a build without it, `ref_unresolved` where nothing writes it), an i32 array of
/// exactly cols × rows values.
fn array<'a>(
    form: &'a Value,
    entries: &[SealedEntry],
    id: &str,
    s: &Spec<'_>,
) -> Result<&'a Value, Box<Issue>> {
    let at = path(id, "grid");
    let worlds = form.get("worlds").unwrap_or(&Value::Null);
    let a = source((&form["arrays"], worlds), entries, id, &at, s.array)?;
    let ty = a["type"].as_str().unwrap_or_default();
    if ty != "i32" {
        let actual = json!({"array": s.array, "type": ty});
        let what = "a grid image reads an i32 array";
        return Err(Box::new(Issue::error("bad_column", id, at, actual, what)));
    }
    let count = a["count"].as_u64().unwrap_or(0);
    if count != (s.cols * s.rows) as u64 {
        let what = "a grid image's array holds cols × rows values, row-major";
        let actual = json!({"array": s.array, "count": count, "cells": s.cols * s.rows, "size": [s.cols, s.rows]});
        let at = path(id, "size");
        return Err(Box::new(Issue::error("out_of_range", id, at, actual, what)));
    }
    Ok(a)
}

fn out_of_range(id: &str, s: &Spec<'_>, (step, c, value): (i64, usize, f64)) -> Issue {
    let actual = json!({"array": s.array, "cell": [c % s.cols, c / s.cols], "value": value as i64, "step": step});
    Issue {
        severity: "warning",
        ..Issue::error(
            OUT_OF_RANGE,
            id,
            path(id, "grid"),
            actual,
            "a cell's value passes the grid image's roles; it draws nothing while it lasts",
        )
    }
}

/// The check over `form`'s grid images, their arrays baked into its `arrays`: each image's
/// refusal, and every `grid.out_of_range` its array raises, each at the step it begins.
pub fn check(form: &Value, entries: &[SealedEntry]) -> Vec<Issue> {
    let mut out = Vec::new();
    for (id, item) in grid_images(form) {
        let s = match spec(&item["params"]) {
            Ok(s) => s,
            Err((f, what)) => {
                out.push(Issue::error(
                    "bad_doc",
                    id,
                    path(id, &f),
                    Value::Null,
                    &what,
                ));
                continue;
            }
        };
        match array(form, entries, id, &s) {
            Err(issue) => out.push(*issue),
            Ok(a) => {
                let raised = excursions_by(a, |e| (s.class(e[0]) == OUT).then_some(e[0]));
                out.extend(raised.into_iter().map(|e| out_of_range(id, &s, e)));
            }
        }
    }
    out
}

/// The `grid.out_of_range` issues a frame at `t` of `form` raises: each cell whose run past the
/// roles begins at the frame's step.
pub fn raised_at(form: &Value, t: i64) -> Vec<Issue> {
    let mut out = Vec::new();
    for (id, item) in grid_images(form) {
        let Ok(s) = spec(&item["params"]) else {
            continue;
        };
        let Some(a) = form["arrays"].get(s.array) else {
            continue;
        };
        let k = t.div_euclid(a["every"].as_i64().unwrap_or(1).max(1));
        let blank = |e: &[f64]| (s.class(e[0]) == OUT).then_some(e[0]);
        let begun = excursions_by(a, blank).into_iter();
        out.extend(begun.filter(|e| e.0 == k).map(|e| out_of_range(id, &s, e)));
    }
    out
}

/// The planted rebuilds: the approximating B-spline, bilinear, and a role drawn only where its
/// share passes 1/2.
pub const BSPLINE: &str = "grid_bspline_rebuild";
pub const BILINEAR: &str = "grid_bilinear_rebuild";
pub const HALF_SHARE: &str = "grid_share_passes_half";
/// The data module's planted rebuilds, each reachable only through a proof surface.
pub const PLANTED: [&str; 3] = [BSPLINE, BILINEAR, HALF_SHARE];

impl Planted {
    /// The planted rebuild a proof surface names, if it names one.
    pub fn named(name: Option<&str>) -> Planted {
        match name {
            Some(BSPLINE) => Planted::Bspline,
            Some(BILINEAR) => Planted::Bilinear,
            Some(HALF_SHARE) => Planted::HalfShare,
            _ => Planted::None,
        }
    }

    fn name(self) -> Option<&'static str> {
        match self {
            Planted::None => None,
            Planted::Bspline => Some(BSPLINE),
            Planted::Bilinear => Some(BILINEAR),
            Planted::HalfShare => Some(HALF_SHARE),
        }
    }
}

/// The data module's `grid_image` operator: each grid image's grid at the frame's t, written
/// into its fields (`data.grid`), from the session's frame before unless t is before it.
pub(crate) fn register(r: &mut Registrar) {
    r.contribution(
        "data.grid",
        "fields",
        "item",
        "geometry",
        "items",
        "core.fields",
    );
    r.private_array("data.grid_mapped", "mapped", "item", "geometry", "items");
    r.operator(
        "grid_image",
        "items",
        &["self", "t", "refs"],
        &["data.grid", "data.grid_mapped"],
    )
    .applies(|_, _, item| is_grid_image(item))
    .run(op);
}

fn op(v: &mut View<'_>) -> Result<(), OpError> {
    let t = v.t()?;
    let item = v.item()?;
    let last = v.last("data.grid_mapped");
    let last = last.as_ref().and_then(|l| l.as_typed::<Mapped>());
    let planted = v.planted();
    let doc = v.document()?;
    let Ok(s) = spec(&item["params"]) else {
        v.write("data.grid", Val::typed(Edits(Vec::new())))?;
        return v.write("data.grid_mapped", Val::typed(Mapped::default()));
    };
    let array = doc.pointer("/arrays").and_then(|a| a.get(s.array));
    let (fields, m) = at(&s, array, t, last.as_deref(), planted);
    let edits = fields
        .into_iter()
        .map(|(k, value)| Edit {
            add: false,
            path: vec!["params".into(), k.into()],
            value,
        })
        .collect();
    v.write("data.grid", Val::typed(Edits(edits)))?;
    v.write("data.grid_mapped", Val::typed(m.unwrap_or_default()))
}

/// The fields a grid image's frame at `t` reads, each written over its params: its grid's
/// classes (base64, a byte a cell) and the step they are; and the mapping, which a later frame
/// continues from. `planted`: a proof surface's planted program.
pub fn at(
    s: &Spec<'_>,
    array: Option<&Value>,
    t: i64,
    last: Option<&Mapped>,
    planted: Option<&str>,
) -> (Vec<(&'static str, Datum)>, Option<Mapped>) {
    let n = s.cols * s.rows;
    let every = array.and_then(|a| a["every"].as_i64()).unwrap_or(1).max(1);
    let read = Read::of(&Value::Null, "i32");
    let m = array
        .zip(read)
        .and_then(|(a, r)| mapped(&r, a, t, last))
        .filter(|m| m.values.len() == n);
    let step = t.div_euclid(every);
    let classes: Vec<u8> = match &m {
        Some(m) => m.values.iter().map(|v| s.class(*v)).collect(),
        None => vec![OUT; n],
    };
    let mut fields = vec![
        (
            "classes",
            Datum::Text(deep_canvas::base64::encode(&classes)),
        ),
        ("step", Datum::Num(step as f64)),
    ];
    if let Some(p) = Planted::named(planted).name() {
        fields.push(("rebuild", Datum::Text(p.into())));
    }
    (fields, m)
}

/// [`at`] for a host that evaluates a document's items outside a session: each grid image of
/// `items` takes the fields of its grid in `arrays` at `t`.
pub fn fill(items: &mut Map<String, Value>, arrays: &Value, t: i64, planted: Option<&str>) {
    for item in items.values_mut().filter(|i| is_grid_image(i)) {
        let fields = match spec(&item["params"]) {
            Ok(s) => at(&s, arrays.get(s.array), t, None, planted).0,
            Err(_) => continue,
        };
        for (k, d) in fields {
            item["params"][k] = match d {
                Datum::Text(s) => json!(s),
                Datum::Num(n) => json!(n),
                _ => Value::Null,
            };
        }
    }
}

/// A grid image as a frame draws it: its grid at the frame's step, how it samples and each
/// class's color, premultiplied, with [`OUT`]'s last.
#[derive(Clone, Debug, PartialEq)]
pub struct Drawn {
    pub cols: usize,
    pub rows: usize,
    pub classes: Vec<u8>,
    pub sample: Sample,
    pub edge: f32,
    pub colors: [[f32; 4]; MAX_ROLES + 1],
    pub planted: Planted,
    /// The step the grid is.
    pub step: i64,
}

impl Drawn {
    /// The grid's image at `size` device px, premultiplied RGBA8.
    pub fn pixels(&self, size: [u32; 2]) -> Vec<u8> {
        let g = Grid {
            cols: self.cols,
            rows: self.rows,
            classes: &self.classes,
            sample: self.sample,
            px: [
                size[0] as f32 / self.cols as f32,
                size[1] as f32 / self.rows as f32,
            ],
            edge: self.edge,
        };
        draw(&g, size, &self.colors, self.planted)
    }

    /// A key of what it draws: the same grid, sampling and colors draw the same pixels.
    pub fn digest(&self) -> String {
        let mut h = sha2::Sha256::new();
        h.update((self.cols as u64).to_le_bytes());
        h.update((self.rows as u64).to_le_bytes());
        h.update(&self.classes);
        h.update([self.sample as u8, self.planted as u8]);
        h.update(self.edge.to_le_bytes());
        for c in self.colors.iter().flatten() {
            h.update(c.to_le_bytes());
        }
        h.finalize().iter().map(|b| format!("{b:02x}")).collect()
    }
}

/// A grid image's mark: its image at `pos`, its cells `cell` u apart, each class in its role's
/// color from `palette`; or the refusal naming the field it fails at.
pub fn marks(
    id: &str,
    params: &Map<String, Value>,
    palette: &crate::scene::Palette,
    pos: [f64; 2],
) -> Result<Vec<crate::scene::Mark>, crate::scene::Refused> {
    use crate::scene::{ImageFit, ImageSampling, Mark, Refused};
    let p = Value::Object(params.clone());
    let refuse = |f: &str| Refused {
        code: "bad_doc",
        path: format!("items/{id}/params/{f}"),
    };
    let s = spec(&p).map_err(|(f, _)| refuse(&f))?;
    let n = s.cols * s.rows;
    let classes = match p["classes"].as_str() {
        Some(b) => deep_canvas::base64::decode(b).filter(|c| c.len() == n),
        None => Some(vec![OUT; n]),
    };
    let classes = classes.ok_or_else(|| refuse("classes"))?;
    let mut colors = [[0f32; 4]; MAX_ROLES + 1];
    for (i, r) in s.roles.iter().enumerate() {
        let Some(r) = r else { continue };
        let c = palette.get(*r).ok_or_else(|| Refused {
            code: "role_unresolved",
            path: format!("items/{id}/params/roles/{i}"),
        })?;
        colors[i] = [
            f32::from(c[0]) / 255.0,
            f32::from(c[1]) / 255.0,
            f32::from(c[2]) / 255.0,
            1.0,
        ];
    }
    let drawn = Drawn {
        cols: s.cols,
        rows: s.rows,
        classes,
        sample: s.sample,
        edge: s.edge as f32,
        colors,
        planted: Planted::named(p["rebuild"].as_str()),
        step: p["step"].as_f64().unwrap_or(0.0) as i64,
    };
    let [w, h] = s.extent();
    Ok(vec![Mark::Image {
        item: id.to_string(),
        asset: format!("grid:{}", drawn.digest()),
        bounds: [pos[0], pos[1], w, h],
        fit: ImageFit::Fill,
        sampling: ImageSampling::Nearest,
        crop: None,
        opacity: 1.0,
        adjust: crate::paint::Adjust::default(),
        tile: None,
        turn: 0.0,
        grid: Some(std::sync::Arc::new(drawn)),
    }])
}

/// The weights of the four cells around a sample `t` cells past the second one's centre
/// (0 ≤ t < 1), with their derivatives in t, by the rebuild's kernel.
fn weights(t: f32, planted: Planted) -> ([f32; 4], [f32; 4]) {
    let (t2, t3) = (t * t, t * t * t);
    match planted {
        Planted::Bspline => (
            [
                (1.0 - t) * (1.0 - t) * (1.0 - t) / 6.0,
                (3.0 * t3 - 6.0 * t2 + 4.0) / 6.0,
                (-3.0 * t3 + 3.0 * t2 + 3.0 * t + 1.0) / 6.0,
                t3 / 6.0,
            ],
            [
                -(1.0 - t) * (1.0 - t) / 2.0,
                (9.0 * t2 - 12.0 * t) / 6.0,
                (-9.0 * t2 + 6.0 * t + 3.0) / 6.0,
                t2 / 2.0,
            ],
        ),
        Planted::Bilinear => ([0.0, 1.0 - t, t, 0.0], [0.0, -1.0, 1.0, 0.0]),
        // Catmull-Rom: k(x) = 1.5|x|³ − 2.5|x|² + 1 within a cell, −0.5|x|³ + 2.5|x|² − 4|x| + 2
        // within two.
        _ => (
            [
                -0.5 * t3 + t2 - 0.5 * t,
                1.5 * t3 - 2.5 * t2 + 1.0,
                -1.5 * t3 + 2.0 * t2 + 0.5 * t,
                0.5 * t3 - 0.5 * t2,
            ],
            [
                -1.5 * t2 + 2.0 * t - 0.5,
                4.5 * t2 - 5.0 * t,
                -4.5 * t2 + 4.0 * t + 0.5,
                1.5 * t2 - t,
            ],
        ),
    }
}

/// One pixel's color (premultiplied, 0 to 1) of a grid of `classes`, its centre at `(u, v)` in
/// cells from the grid's top-left; `px` a cell's size in px, `colors` each class's color with
/// [`OUT`]'s last.
pub fn pixel(
    g: &Grid<'_>,
    (u, v): (f32, f32),
    colors: &[[f32; 4]; MAX_ROLES + 1],
    planted: Planted,
) -> [f32; 4] {
    let at = |x: i64, y: i64| {
        let x = x.clamp(0, g.cols as i64 - 1) as usize;
        let y = y.clamp(0, g.rows as i64 - 1) as usize;
        g.classes[y * g.cols + x]
    };
    let own = at(u.floor() as i64, v.floor() as i64);
    if g.sample == Sample::Nearest || own == OUT {
        return colors[own as usize];
    }
    let (fx, fy) = (u - 0.5, v - 0.5);
    let (ix, iy) = (fx.floor(), fy.floor());
    let (wx, dx) = weights(fx - ix, planted);
    let (wy, dy) = weights(fy - iy, planted);
    let mut share = [0f32; MAX_ROLES + 1];
    let mut grad = [[0f32; 2]; MAX_ROLES + 1];
    let mut present = 0u32;
    for (b, (wyb, dyb)) in wy.iter().zip(dy).enumerate() {
        for (a, (wxa, dxa)) in wx.iter().zip(dx).enumerate() {
            let c = at(ix as i64 + a as i64 - 1, iy as i64 + b as i64 - 1) as usize;
            share[c] += wxa * wyb;
            grad[c][0] += dxa * wyb;
            grad[c][1] += wxa * dyb;
            present |= 1 << c;
        }
    }
    let (mut first, mut second) = (usize::MAX, usize::MAX);
    for c in 0..=MAX_ROLES {
        if present >> c & 1 == 0 {
            continue;
        }
        if first == usize::MAX || share[c] > share[first] {
            second = first;
            first = c;
        } else if second == usize::MAX || share[c] > share[second] {
            second = c;
        }
    }
    if planted == Planted::HalfShare {
        return if share[first] > 0.5 {
            colors[first]
        } else {
            colors[OUT as usize]
        };
    }
    if second == usize::MAX || g.edge <= 0.0 {
        return colors[first];
    }
    // The signed distance in px to where the runner-up's share overtakes, from the difference
    // and its gradient; the band of `edge` px blends the two.
    let d = share[first] - share[second];
    let gx = (grad[first][0] - grad[second][0]) / g.px[0];
    let gy = (grad[first][1] - grad[second][1]) / g.px[1];
    let slope = deep_canvas::ops::sqrt(f64::from(gx * gx + gy * gy)) as f32;
    let k = if slope > 1e-6 {
        (0.5 + d / slope / g.edge).clamp(0.0, 1.0)
    } else {
        1.0
    };
    let (a, b) = (colors[first], colors[second]);
    [0, 1, 2, 3].map(|i| a[i] * k + b[i] * (1.0 - k))
}

/// A grid at one step, as the rebuild reads it.
pub struct Grid<'a> {
    pub cols: usize,
    pub rows: usize,
    pub classes: &'a [u8],
    pub sample: Sample,
    /// A cell's size in px.
    pub px: [f32; 2],
    pub edge: f32,
}

/// The image of `g` at `size` px, premultiplied RGBA8, row by row: each pixel's centre read in
/// cells.
pub fn draw(
    g: &Grid<'_>,
    size: [u32; 2],
    colors: &[[f32; 4]; MAX_ROLES + 1],
    planted: Planted,
) -> Vec<u8> {
    let mut out = Vec::with_capacity(size[0] as usize * size[1] as usize * 4);
    for y in 0..size[1] {
        let v = (y as f32 + 0.5) / g.px[1];
        for x in 0..size[0] {
            let u = (x as f32 + 0.5) / g.px[0];
            let p = pixel(g, (u, v), colors, planted);
            out.extend(p.map(|c| (c.clamp(0.0, 1.0) * 255.0).round() as u8));
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn colors() -> [[f32; 4]; MAX_ROLES + 1] {
        let mut c = [[0f32; 4]; MAX_ROLES + 1];
        c[1] = [1.0, 0.0, 0.0, 1.0];
        c[2] = [0.0, 1.0, 0.0, 1.0];
        c[3] = [0.0, 0.0, 1.0, 1.0];
        c
    }

    /// A 9 × 9 grid of `none` (class 0) with class 1 at its centre, drawn at 8 px a cell, and how
    /// far from the centre its drawn run reaches along a ray, in cells.
    fn reach(planted: Planted, (dx, dy): (f32, f32)) -> f32 {
        let mut classes = vec![0u8; 81];
        classes[40] = 1;
        let g = Grid {
            cols: 9,
            rows: 9,
            classes: &classes,
            sample: Sample::Smooth,
            px: [8.0, 8.0],
            edge: 1.0,
        };
        let c = colors();
        let mut last = 0.0;
        for i in 0..2000 {
            let r = i as f32 * 0.001;
            let p = pixel(&g, (4.5 + dx * r, 4.5 + dy * r), &c, planted);
            if p[3] > 0.5 {
                last = r;
            }
        }
        last * (dx * dx + dy * dy).sqrt()
    }

    #[test]
    fn a_lone_cell_reaches_where_the_kernel_passes_one_half() {
        assert!((reach(Planted::None, (1.0, 0.0)) - 0.545).abs() < 0.01);
        assert!((reach(Planted::None, (1.0, 1.0)) - 0.553).abs() < 0.01);
        assert_eq!(reach(Planted::Bspline, (1.0, 0.0)), 0.0);
        assert!((reach(Planted::Bilinear, (1.0, 1.0)) - 0.414).abs() < 0.01);
        assert!((reach(Planted::Bilinear, (1.0, 0.0)) - 0.5).abs() < 0.01);
    }

    #[test]
    fn three_roles_meet_at_a_corner_without_a_hole() {
        // Left half role 1; right half role 2 above and role 3 below.
        let mut classes = vec![0u8; 64];
        for y in 0..8 {
            for x in 0..8 {
                classes[y * 8 + x] = if x < 4 {
                    1
                } else if y < 4 {
                    2
                } else {
                    3
                };
            }
        }
        let g = Grid {
            cols: 8,
            rows: 8,
            classes: &classes,
            sample: Sample::Smooth,
            px: [8.0, 8.0],
            edge: 1.0,
        };
        let c = colors();
        let pixels = draw(&g, [64, 64], &c, Planted::None);
        assert!(pixels.chunks(4).all(|p| p[3] == 255));
        let holed = draw(&g, [64, 64], &c, Planted::HalfShare);
        assert!(holed.chunks(4).any(|p| p[3] == 0));
    }

    #[test]
    fn a_value_past_the_roles_is_out() {
        let params = json!({"mark": "grid_image", "grid": "w.cells", "size": [4, 2], "cell": [8, 8], "roles": ["none", "accent"]});
        let s = spec(&params).unwrap();
        assert_eq!((s.class(1.0), s.class(2.0), s.class(-1.0)), (1, OUT, OUT));
        assert_eq!(s.roles, [None, Some("accent")]);
    }
}

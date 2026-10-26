//! R1's slice of the data module (canvas primitives: Mark set and columns `marks@1`; Scale and
//! encode `scale@1`, `axis@1`): mark sets of points, rules and text, a linear or time scale, and
//! one axis. A mark set is one item with typed columns for many rows; its encodings map columns
//! through scales, and an axis is generated from its scale, never drawn by hand.
//!
//! Columns hold `data` as base64 of little-endian values of their `dtype` (`f64`, `f32`, `i64`,
//! `i32`, `u32`, `u16`, `u8`, and `bool` and `role` a byte each), or `{sidecar: sha256}` for those
//! bytes in a file the renderer reads from its store, or a JSON list for `str`, or a `const`. A time scale's domain is milliseconds since the Unix epoch, UTC, as the record's times
//! are, and its ticks fall on calendar units.
//!
//! Issue #373 adds R2's mark types: rects from (x, y) to (x2, y2), bars from their y scale's zero
//! (or `y2`), a path and an area as one line through the rows in order (an area down to the
//! zero), symbols, and images from an `asset` column with its `alt`. A key is unique across rows.

use serde_json::{Map, Value};

use deep_canvas::ops;

use crate::path;
use crate::scene::{
    refuse, Align, Fill, Geometry, ImageFit, ImageSampling, Mark, Palette, Refused, TextSpec,
};

/// The most rows a mark set holds (Mark set: "exceed 1M rows per set" it can never).
const MAX_ROWS: u64 = 1_000_000;
/// The most rows a document's mark sets hold together.
pub const MAX_DOCUMENT_ROWS: u64 = 16_000_000;

/// The readings bound to a mark set's cells: (row key, column) → the reading, `None` where the
/// record holds none.
pub type BoundRows = std::collections::BTreeMap<(String, String), Option<f64>>;

/// One column's values.
#[derive(Clone, Debug, PartialEq)]
pub enum Column {
    Numbers(Vec<f64>),
    Texts(Vec<String>),
    Const(Value),
}

impl Column {
    fn number(&self, i: usize) -> Option<f64> {
        match self {
            Column::Numbers(v) => v.get(i).copied(),
            Column::Const(c) => c.as_f64(),
            Column::Texts(_) => None,
        }
    }

    fn text(&self, i: usize) -> Option<String> {
        match self {
            Column::Texts(v) => v.get(i).cloned(),
            Column::Numbers(v) => v.get(i).map(|n| format!("{n}")),
            Column::Const(Value::String(s)) => Some(s.clone()),
            Column::Const(c) => c.as_f64().map(|n| format!("{n}")),
        }
    }
}

fn column_of(c: &Value, n: usize, path: &str) -> Result<Column, Refused> {
    let Value::Object(c) = c else {
        return refuse("bad_column", path);
    };
    if let Some(v) = c.get("const") {
        return Ok(Column::Const(v.clone()));
    }
    let dtype = c.get("dtype").and_then(Value::as_str).unwrap_or("");
    if c.get("len").and_then(Value::as_u64) != Some(n as u64) {
        return refuse("bad_column", format!("{path}/len"));
    }
    if dtype == "str" {
        let Some(Value::Array(list)) = c.get("data") else {
            return refuse("bad_column", format!("{path}/data"));
        };
        let texts: Option<Vec<String>> = list
            .iter()
            .map(|v| v.as_str().map(str::to_string))
            .collect();
        return match texts {
            Some(t) if t.len() == n && t.iter().all(|s| s.chars().count() <= 512) => {
                Ok(Column::Texts(t))
            }
            _ => refuse("bad_column", format!("{path}/data")),
        };
    }
    // Sidecar data reaches the module inlined by whoever holds the store; one that didn't is
    // missing, never zeros.
    if c.get("data").and_then(|d| d.get("sidecar")).is_some() {
        return refuse("asset_missing", format!("{path}/data"));
    }
    let Some(bytes) = c
        .get("data")
        .and_then(Value::as_str)
        .and_then(deep_canvas::base64::decode)
    else {
        return refuse("bad_column", format!("{path}/data"));
    };
    // A bool is a byte, 0 or 1; a role an index into the set's roles, one byte.
    let width = match dtype {
        "f64" | "i64" => 8,
        "f32" | "i32" | "u32" => 4,
        "u16" => 2,
        "u8" | "bool" | "role" => 1,
        _ => return refuse("bad_column", format!("{path}/dtype")),
    };
    if bytes.len() != n * width {
        return refuse("bad_column", format!("{path}/data"));
    }
    let values: Vec<f64> = bytes
        .chunks_exact(width)
        .map(|b| match dtype {
            "f64" => f64::from_le_bytes(b.try_into().unwrap_or([0; 8])),
            "i64" => i64::from_le_bytes(b.try_into().unwrap_or([0; 8])) as f64,
            "f32" => f64::from(f32::from_le_bytes(b.try_into().unwrap_or([0; 4]))),
            "i32" => f64::from(i32::from_le_bytes(b.try_into().unwrap_or([0; 4]))),
            "u32" => f64::from(u32::from_le_bytes(b.try_into().unwrap_or([0; 4]))),
            "u16" => f64::from(u16::from_le_bytes(b.try_into().unwrap_or([0; 2]))),
            _ => f64::from(b[0]),
        })
        .collect();
    if values.iter().any(|v| !v.is_finite()) {
        return refuse("out_of_range", format!("{path}/data"));
    }
    Ok(Column::Numbers(values))
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ScaleKind {
    Linear,
    Time,
}

/// A scale from data to u, with its domain made nice.
#[derive(Clone, Debug, PartialEq)]
pub struct Scale {
    pub kind: ScaleKind,
    pub domain: [f64; 2],
    pub range: [f64; 2],
    /// The tick step: data units for linear, milliseconds for time.
    pub step: f64,
}

/// Calendar steps a time axis ticks on, in milliseconds.
const TIME_STEPS: [f64; 20] = [
    1e3, 2e3, 5e3, 1e4, 15e3, 3e4, 6e4, 12e4, 3e5, 6e5, 9e5, 18e5, 36e5, 72e5, 108e5, 216e5, 432e5,
    864e5, 1728e5, 6048e5,
];

/// The aim: about five ticks across a domain.
const TICKS: f64 = 5.0;

fn linear_step(span: f64) -> f64 {
    let raw = span / TICKS;
    let mag = ops::powi(10.0, ops::log10(raw).floor() as i32);
    [1.0, 2.0, 5.0, 10.0]
        .iter()
        .map(|m| m * mag)
        .find(|s| *s >= raw)
        .unwrap_or(10.0 * mag)
}

impl Scale {
    fn read(id: &str, item: &Value) -> Result<Scale, Refused> {
        let path = format!("items/{id}/params");
        let p = item.get("params").and_then(Value::as_object);
        let get = |k: &str| p.and_then(|p| p.get(k));
        let kind = match get("type").and_then(Value::as_str) {
            None | Some("linear") => ScaleKind::Linear,
            Some("time") => ScaleKind::Time,
            Some(_) => return refuse("scale_type", format!("{path}/type")),
        };
        let pair = |k: &str| -> Result<[f64; 2], Refused> {
            match get(k).and_then(Value::as_array).map(Vec::as_slice) {
                Some([a, b]) => match (a.as_f64(), b.as_f64()) {
                    (Some(a), Some(b)) if a.is_finite() && b.is_finite() => Ok([a, b]),
                    _ => refuse("out_of_range", format!("{path}/{k}")),
                },
                _ => refuse("bad_scale", format!("{path}/{k}")),
            }
        };
        let (mut domain, range) = (pair("domain")?, pair("range")?);
        if domain[1] <= domain[0] {
            return refuse("out_of_range", format!("{path}/domain"));
        }
        let span = domain[1] - domain[0];
        let step = match kind {
            ScaleKind::Linear => linear_step(span),
            ScaleKind::Time => TIME_STEPS
                .iter()
                .copied()
                .find(|s| span / s <= TICKS)
                .unwrap_or(TIME_STEPS[TIME_STEPS.len() - 1]),
        };
        if get("nice").and_then(Value::as_bool).unwrap_or(true) {
            domain = [
                (domain[0] / step).floor() * step,
                (domain[1] / step).ceil() * step,
            ];
        }
        Ok(Scale {
            kind,
            domain,
            range,
            step,
        })
    }

    /// A value's place in u.
    pub fn map(&self, v: f64) -> f64 {
        let [d0, d1] = self.domain;
        let [r0, r1] = self.range;
        r0 + (v - d0) / (d1 - d0) * (r1 - r0)
    }

    /// The ticks over the domain, each with its label.
    pub fn ticks(&self) -> Vec<(f64, String)> {
        let first = (self.domain[0] / self.step).ceil() as i64;
        let last = (self.domain[1] / self.step).floor() as i64;
        let digits = match self.kind {
            ScaleKind::Linear => (-ops::log10(self.step).floor()).max(0.0) as usize,
            ScaleKind::Time => 0,
        };
        (first..=last.min(first + 1_000))
            .map(|k| {
                let v = k as f64 * self.step;
                let label = match self.kind {
                    ScaleKind::Linear => format!("{:.*}", digits, v),
                    ScaleKind::Time => time_label(v as i64, self.step),
                };
                (v, label)
            })
            .collect()
    }
}

/// A UTC civil date from days since the epoch (Howard Hinnant's `civil_from_days`).
fn civil(days: i64) -> (i64, u32, u32) {
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1_460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let m = if mp < 10 { mp + 3 } else { mp - 9 } as u32;
    (yoe + era * 400 + i64::from(m <= 2), m, d)
}

/// A time tick's label at its step: seconds, minutes or the date.
fn time_label(ms: i64, step: f64) -> String {
    let secs = ms.div_euclid(1000);
    let (days, day_secs) = (secs.div_euclid(86_400), secs.rem_euclid(86_400));
    let (h, m, s) = (day_secs / 3600, day_secs % 3600 / 60, day_secs % 60);
    if step >= 864e5 {
        let (y, mo, d) = civil(days);
        format!("{y:04}-{mo:02}-{d:02}")
    } else if step >= 6e4 {
        format!("{h:02}:{m:02}")
    } else {
        format!("{h:02}:{m:02}:{s:02}")
    }
}

/// A `scale@1` item's scale, its domain made nice, and its ticks.
pub fn scale_of(id: &str, item: &Value) -> Result<Scale, Refused> {
    Scale::read(id, item)
}

fn scale_named(items: &Map<String, Value>, id: &str, path: &str) -> Result<Scale, Refused> {
    match items.get(id) {
        Some(item) if item.get("kind").and_then(Value::as_str) == Some("scale@1") => {
            Scale::read(id, item)
        }
        _ => refuse("ref_unresolved", path),
    }
}

fn role(palette: &Palette, name: &str, path: &str) -> Result<[u8; 3], Refused> {
    palette.get(name).copied().ok_or(Refused {
        code: "role_unresolved",
        path: format!("{path}: {name}"),
    })
}

/// A rule from `a` to `b` in `color`: a rect where it runs along an axis, else a stroked path.
fn rule(item: String, a: [f64; 2], b: [f64; 2], width: f64, color: [u8; 3]) -> Mark {
    if a[0] == b[0] || a[1] == b[1] {
        let (x0, x1) = (a[0].min(b[0]), a[0].max(b[0]));
        let (y0, y1) = (a[1].min(b[1]), a[1].max(b[1]));
        let (w, h) = if a[0] == b[0] {
            (width, y1 - y0)
        } else {
            (x1 - x0, width)
        };
        let (x, y) = if a[0] == b[0] {
            (x0 - width / 2.0, y0)
        } else {
            (x0, y0 - width / 2.0)
        };
        return Mark::Rect {
            item,
            bounds: [x, y, w, h],
            radius: 0.0,
            fill: Fill::Solid(color),
        };
    }
    let d = format!("M {} {} L {} {}", a[0], a[1], b[0], b[1]);
    Mark::Path {
        item,
        geometry: Geometry {
            verbs: path::parse(&d).unwrap_or_default(),
            stroke: Some(width),
            fill: false,
        },
        d,
        offset: [0.0, 0.0],
        color,
    }
}

/// One encoded property: a column through a scale, a column in u, or a constant.
enum Encoded {
    Column {
        column: String,
        scale: Option<Scale>,
    },
    Const(Value),
}

/// A mark set's rows as marks, each named `<id>#<key>`.
/// A mark set's rows as marks. `bound` holds the readings bound to its cells.
pub fn mark_set(
    id: &str,
    item: &Value,
    items: &Map<String, Value>,
    palette: &Palette,
    pos: [f64; 2],
    bound: &BoundRows,
) -> Result<Vec<Mark>, Refused> {
    let path = format!("items/{id}/params");
    let empty = Map::new();
    let p = item
        .get("params")
        .and_then(Value::as_object)
        .unwrap_or(&empty);
    let n = match p.get("n").and_then(Value::as_u64) {
        Some(n) if n <= MAX_ROWS => n as usize,
        _ => return refuse("out_of_range", format!("{path}/n")),
    };
    let columns = p
        .get("columns")
        .and_then(Value::as_object)
        .unwrap_or(&empty);
    let mut decoded = std::collections::BTreeMap::new();
    for (name, c) in columns {
        decoded.insert(
            name.clone(),
            column_of(c, n, &format!("{path}/columns/{name}"))?,
        );
    }
    // A bound cell draws its reading, never the value written there (Bound value: it can never be
    // typed over), and a row whose reading is missing isn't drawn, so no bar shows a number
    // nothing measured.
    let mut hidden = std::collections::BTreeSet::new();
    for ((key, column), value) in bound {
        let row = p
            .get("key")
            .and_then(Value::as_str)
            .and_then(|k| decoded.get(k))
            .and_then(|k| (0..n).find(|&i| k.text(i).as_deref() == Some(key.as_str())));
        let Some(i) = row else {
            return refuse("ref_unresolved", format!("items/{id}#{key}"));
        };
        match (value, decoded.get_mut(column)) {
            (Some(v), Some(Column::Numbers(values))) => values[i] = *v,
            (None, Some(_)) => {
                hidden.insert(i);
            }
            _ => return refuse("bad_column", format!("{path}/columns/{column}")),
        }
    }
    let encode = p.get("encode").and_then(Value::as_object).unwrap_or(&empty);
    let mut props = std::collections::BTreeMap::new();
    for (prop, e) in encode {
        let epath = format!("{path}/encode/{prop}");
        let enc = match e {
            Value::Object(o) if o.contains_key("column") => {
                let Some(column) = o.get("column").and_then(Value::as_str) else {
                    return refuse("bad_encode", epath);
                };
                if !decoded.contains_key(column) {
                    return refuse("ref_unresolved", format!("{epath}/column"));
                }
                let scale = match o.get("scale").and_then(Value::as_str) {
                    None => None,
                    Some(s) => Some(scale_named(items, s, &format!("{epath}/scale"))?),
                };
                Encoded::Column {
                    column: column.to_string(),
                    scale,
                }
            }
            v => Encoded::Const(v.clone()),
        };
        props.insert(prop.clone(), enc);
    }
    let number = |prop: &str, i: usize| -> Option<f64> {
        match props.get(prop)? {
            Encoded::Column { column, scale } => {
                let v = decoded.get(column)?.number(i)?;
                Some(scale.as_ref().map_or(v, |s| s.map(v)))
            }
            Encoded::Const(v) => v.as_f64(),
        }
    };
    let text = |i: usize| -> Option<String> {
        match props.get("text")? {
            Encoded::Column { column, .. } => decoded.get(column)?.text(i),
            Encoded::Const(v) => v.as_str().map(str::to_string),
        }
    };
    let key_column = match p.get("key").and_then(Value::as_str) {
        None => None,
        Some(k) => Some(
            decoded
                .get(k)
                .ok_or(Refused {
                    code: "ref_unresolved",
                    path: format!("{path}/key"),
                })
                .map(|c| (k, c))?,
        ),
    };
    let keys: Vec<String> = (0..n)
        .map(|i| {
            key_column
                .and_then(|(_, k)| k.text(i))
                .unwrap_or_else(|| i.to_string())
        })
        .collect();
    // A key is unique and stable (Mark set: `key`), so a row can be picked and patched by it.
    if let Some((k, _)) = key_column {
        let mut seen = std::collections::BTreeSet::new();
        if !keys.iter().all(|key| seen.insert(key)) {
            return refuse("key_not_unique", format!("{path}/columns/{k}"));
        }
    }
    let paint = p.get("paint");
    let fill_role = paint
        .and_then(|pt| pt.get("fill").or(pt.get("stroke")))
        .and_then(|f| f.get("role"))
        .and_then(Value::as_str)
        .unwrap_or("ink");
    let mark = p.get("mark").and_then(Value::as_str).unwrap_or("point");
    // An image set draws its assets, not a role.
    let color = if mark == "image" {
        [0, 0, 0]
    } else {
        role(palette, fill_role, &format!("{path}/paint"))?
    };
    let stroke_width = paint
        .and_then(|pt| pt.get("stroke"))
        .and_then(|s| s.get("width"))
        .and_then(Value::as_f64)
        .unwrap_or(1.0);
    // A bar's or an area's base: its `y2`, else its y scale's zero, else 0.
    let zero = match props.get("y") {
        Some(Encoded::Column {
            scale: Some(scale), ..
        }) => scale.map(0.0),
        _ => 0.0,
    };
    // A column the set reads by name, through `encode` or as itself (an image's asset and alt).
    let column_text = |name: &str, i: usize| -> Option<String> {
        match props.get(name) {
            Some(Encoded::Column { column, .. }) => decoded.get(column)?.text(i),
            Some(Encoded::Const(v)) => v.as_str().map(str::to_string),
            None => decoded.get(name)?.text(i),
        }
    };
    let fit = match p.get("fit").and_then(Value::as_str) {
        None | Some("contain") => ImageFit::Contain,
        Some("cover") => ImageFit::Cover,
        Some("fill") => ImageFit::Fill,
        Some("none") => ImageFit::None,
        Some(_) => return refuse("bad_doc", format!("{path}/fit")),
    };
    let mut out = Vec::with_capacity(n);
    // A path's and an area's rows are one line through the rows in order.
    let mut line: Vec<[f64; 2]> = Vec::new();
    for (i, key) in keys.iter().enumerate() {
        if hidden.contains(&i) {
            continue;
        }
        let name = format!("{id}#{key}");
        let (Some(x), Some(y)) = (number("x", i), number("y", i)) else {
            return refuse("bad_encode", format!("{path}/encode"));
        };
        let at = [x + pos[0], y + pos[1]];
        let x2 = number("x2", i).unwrap_or(x) + pos[0];
        let y2 = number("y2", i).unwrap_or(y) + pos[1];
        let span = |a: [f64; 2], b: [f64; 2]| {
            [
                a[0].min(b[0]),
                a[1].min(b[1]),
                (a[0] - b[0]).abs(),
                (a[1] - b[1]).abs(),
            ]
        };
        match mark {
            "point" | "symbol" => out.push(Mark::Circle {
                item: name,
                center: at,
                r: number("size", i).unwrap_or(if mark == "point" { 6.0 } else { 10.0 }) / 2.0,
                inner_r: 0.0,
                color,
            }),
            "rule" => {
                out.push(rule(
                    name,
                    at,
                    [x2, y2],
                    number("size", i).unwrap_or(1.0),
                    color,
                ));
            }
            "rect" => out.push(Mark::Rect {
                item: name,
                bounds: span(at, [x2, y2]),
                radius: 0.0,
                fill: Fill::Solid(color),
            }),
            "bar" => {
                let base = number("y2", i).unwrap_or(zero) + pos[1];
                out.push(Mark::Rect {
                    item: name,
                    bounds: span(at, [x2, base]),
                    radius: 0.0,
                    fill: Fill::Solid(color),
                });
            }
            "path" | "area" => line.push(at),
            "image" => {
                let Some(asset) = column_text("asset", i) else {
                    return refuse("bad_doc", format!("{path}/columns/asset"));
                };
                if asset.len() != 64 || !asset.bytes().all(|b| b.is_ascii_hexdigit()) {
                    return refuse("bad_asset", format!("{path}/columns/asset"));
                }
                if column_text("alt", i).is_none_or(|a| a.is_empty()) {
                    return refuse("alt_missing", format!("{path}/columns/alt"));
                }
                out.push(Mark::Image {
                    item: name,
                    asset: asset.to_ascii_lowercase(),
                    bounds: span(at, [x2, y2]),
                    fit,
                    sampling: ImageSampling::Linear,
                    crop: None,
                    opacity: 1.0,
                    adjust: crate::paint::Adjust::default(),
                });
            }
            "text" => out.push(Mark::Text {
                item: name,
                spec: TextSpec {
                    text: text(i).unwrap_or_default(),
                    font: "body".into(),
                    size: number("size", i).unwrap_or(11.0),
                    weight: 400,
                    width: None,
                    align: Align::Start,
                    bound: false,
                },
                origin: at,
                role: None,
                color,
                runs: Vec::new(),
            }),
            _ => return refuse("out_of_range", format!("{path}/mark")),
        }
    }
    if !line.is_empty() {
        let mut d = String::new();
        for (k, p) in line.iter().enumerate() {
            d.push_str(&format!(
                "{} {} {} ",
                if k == 0 { "M" } else { "L" },
                p[0],
                p[1]
            ));
        }
        let area = mark == "area";
        if area {
            let (first, last) = (line[0], line[line.len() - 1]);
            let base = zero + pos[1];
            d.push_str(&format!("L {} {base} L {} {base} Z", last[0], first[0]));
        }
        let d = d.trim_end().to_string();
        out.push(Mark::Path {
            item: id.to_string(),
            geometry: Geometry {
                verbs: path::parse(&d).unwrap_or_default(),
                stroke: (!area).then_some(stroke_width),
                fill: area,
            },
            d,
            offset: [0.0, 0.0],
            color,
        });
    }
    Ok(out)
}

/// The width a label's box takes so its text centers on its tick.
const LABEL_BOX: f64 = 96.0;
/// A label's size and the tick's length and gap, in u.
const LABEL_SIZE: f64 = 11.0;
const TICK: f64 = 4.0;

/// One axis, generated from its scale: the line along the scale's range, a tick per step and its
/// label; labels that would crowd thin by parity, keeping the first and the last.
pub fn axis(
    id: &str,
    item: &Value,
    items: &Map<String, Value>,
    palette: &Palette,
    pos: [f64; 2],
) -> Result<Vec<Mark>, Refused> {
    let path = format!("items/{id}/params");
    let empty = Map::new();
    let p = item
        .get("params")
        .and_then(Value::as_object)
        .unwrap_or(&empty);
    let Some(scale_id) = p.get("scale").and_then(Value::as_str) else {
        return refuse("bad_axis", format!("{path}/scale"));
    };
    let scale = scale_named(items, scale_id, &format!("{path}/scale"))?;
    let side = p.get("side").and_then(Value::as_str).unwrap_or("bottom");
    let horizontal = match side {
        "bottom" | "top" => true,
        "left" | "right" => false,
        _ => return refuse("bad_axis", format!("{path}/side")),
    };
    let cross = p.get("at").and_then(Value::as_f64).unwrap_or(0.0);
    let color = role(
        palette,
        p.get("role").and_then(Value::as_str).unwrap_or("muted"),
        &format!("{path}/role"),
    )?;
    let point = |along: f64, off: f64| -> [f64; 2] {
        if horizontal {
            [along + pos[0], cross + off + pos[1]]
        } else {
            [cross + off + pos[0], along + pos[1]]
        }
    };
    let out_dir = if side == "bottom" || side == "right" {
        1.0
    } else {
        -1.0
    };
    let mut marks = vec![rule(
        format!("{id}#line"),
        point(scale.range[0], 0.0),
        point(scale.range[1], 0.0),
        1.0,
        color,
    )];
    let ticks = scale.ticks();
    // Thin by parity until labels clear each other: every 2nd, then every 4th, first and last kept.
    let est = |l: &str| 0.6 * LABEL_SIZE * l.chars().count() as f64 + 4.0;
    let spacing = |k: usize| -> f64 {
        if ticks.len() < 2 {
            f64::INFINITY
        } else {
            (scale.map(ticks[1].0) - scale.map(ticks[0].0)).abs() * k as f64
        }
    };
    let widest = ticks.iter().map(|(_, l)| est(l)).fold(0.0, f64::max);
    let mut every = 1;
    while horizontal && widest > spacing(every) && every < ticks.len() {
        every *= 2;
    }
    // Labels by parity, then the last; a last label off the parity that crowds the one before it
    // takes that one's place, unless that one is the first.
    let last = ticks.len().saturating_sub(1);
    let mut kept: Vec<usize> = (0..ticks.len()).filter(|k| k % every == 0).collect();
    if kept.last() != Some(&last) && !ticks.is_empty() {
        if let Some(&prev) = kept.last() {
            if prev != 0 && spacing(last - prev) < widest {
                kept.pop();
            }
        }
        kept.push(last);
    }
    for (k, (v, label)) in ticks.iter().enumerate() {
        let along = scale.map(*v);
        marks.push(rule(
            format!("{id}#tick{k}"),
            point(along, 0.0),
            point(along, out_dir * TICK),
            1.0,
            color,
        ));
        if !kept.contains(&k) {
            continue;
        }
        let (origin, align) = if horizontal {
            let y = if out_dir > 0.0 {
                TICK + 2.0
            } else {
                -(TICK + 2.0 + LABEL_SIZE * 1.3)
            };
            (point(along - LABEL_BOX / 2.0, y), Align::Center)
        } else if out_dir > 0.0 {
            (point(along - LABEL_SIZE * 0.65, TICK + 2.0), Align::Start)
        } else {
            let at = point(along - LABEL_SIZE * 0.65, -(TICK + 2.0 + LABEL_BOX));
            (at, Align::End)
        };
        marks.push(Mark::Text {
            item: format!("{id}#label{k}"),
            spec: TextSpec {
                text: label.clone(),
                font: "body".into(),
                size: LABEL_SIZE,
                weight: 400,
                width: Some(LABEL_BOX),
                align,
                bound: false,
            },
            origin,
            role: None,
            color,
            runs: Vec::new(),
        });
    }
    Ok(marks)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn a_linear_scale_ticks_on_one_two_five_and_maps_its_nice_domain() {
        let s = Scale::read(
            "s",
            &json!({"params": {"domain": [3, 97], "range": [0, 200]}}),
        )
        .unwrap();
        assert_eq!(s.step, 20.0);
        assert_eq!(s.domain, [0.0, 100.0]);
        assert_eq!(s.map(50.0), 100.0);
        let labels: Vec<String> = s.ticks().into_iter().map(|t| t.1).collect();
        assert_eq!(labels, ["0", "20", "40", "60", "80", "100"]);
    }

    #[test]
    fn a_time_scale_ticks_on_calendar_units_in_utc() {
        // 2026-10-21 14:00 to 14:20 UTC.
        let start = 1_792_591_200_000.0;
        let s = Scale::read("t", &json!({"params": {"type": "time", "domain": [start, start + 1_200_000.0], "range": [0, 400]}})).unwrap();
        assert_eq!(s.step, 300_000.0, "five-minute ticks");
        let labels: Vec<String> = s.ticks().into_iter().map(|t| t.1).collect();
        assert_eq!(labels, ["14:00", "14:05", "14:10", "14:15", "14:20"]);
        assert_eq!(time_label(1_792_591_200_000, 864e5), "2026-10-21");
    }

    #[test]
    fn a_mark_set_draws_a_point_per_row_through_its_scale() {
        let items = json!({"x": {"kind": "scale@1", "params": {"domain": [0, 10], "range": [0, 100], "nice": false}}});
        let items = items.as_object().unwrap();
        // [2.0, 5.0] as little-endian f64.
        let set = json!({"params": {"mark": "point", "n": 2, "key": "k",
            "columns": {"v": {"dtype": "f64", "len": 2, "data": "AAAAAAAAAEAAAAAAAAAUQA=="},
                        "k": {"dtype": "str", "len": 2, "data": ["a", "b"]}},
            "encode": {"x": {"column": "v", "scale": "x"}, "y": 30, "size": 8}}});
        let palette: Palette = [("ink".to_string(), [0, 0, 0])].into();
        let marks = mark_set("dots", &set, items, &palette, [0.0, 0.0], &BoundRows::new()).unwrap();
        let centers: Vec<(String, [f64; 2])> = marks
            .iter()
            .map(|m| match m {
                Mark::Circle { item, center, .. } => (item.clone(), *center),
                _ => panic!("a point"),
            })
            .collect();
        assert_eq!(
            centers,
            vec![
                ("dots#a".to_string(), [20.0, 30.0]),
                ("dots#b".to_string(), [50.0, 30.0])
            ]
        );
    }

    #[test]
    fn a_bound_cell_draws_its_reading_and_a_row_without_one_is_left_out() {
        let items = json!({"x": {"kind": "scale@1", "params": {"domain": [0, 10], "range": [0, 100], "nice": false}}});
        let items = items.as_object().unwrap();
        // [2.0, 5.0] as little-endian f64; row "a" writes 2, its reading is 7.
        let set = json!({"params": {"mark": "point", "n": 2, "key": "k",
            "columns": {"v": {"dtype": "f64", "len": 2, "data": "AAAAAAAAAEAAAAAAAAAUQA=="},
                        "k": {"dtype": "str", "len": 2, "data": ["a", "b"]}},
            "encode": {"x": {"column": "v", "scale": "x"}, "y": 30, "size": 8}}});
        let palette: Palette = [("ink".to_string(), [0, 0, 0])].into();
        let centers = |bound: &BoundRows| -> Vec<(String, f64)> {
            mark_set("dots", &set, items, &palette, [0.0, 0.0], bound)
                .unwrap()
                .iter()
                .map(|m| match m {
                    Mark::Circle { item, center, .. } => (item.clone(), center[0]),
                    _ => panic!("a point"),
                })
                .collect()
        };
        let read: BoundRows = [(("a".into(), "v".into()), Some(7.0))].into();
        assert_eq!(
            centers(&read),
            vec![("dots#a".to_string(), 70.0), ("dots#b".to_string(), 50.0)]
        );
        let missing: BoundRows = [(("a".into(), "v".into()), None)].into();
        assert_eq!(centers(&missing), vec![("dots#b".to_string(), 50.0)]);
    }

    #[test]
    fn an_axis_draws_its_line_ticks_and_labels_and_thins_crowded_labels() {
        let items =
            json!({"x": {"kind": "scale@1", "params": {"domain": [0, 100], "range": [0, 400]}}});
        let items = items.as_object().unwrap();
        let palette: Palette = [("muted".to_string(), [9, 9, 9])].into();
        let marks = axis(
            "ax",
            &json!({"params": {"scale": "x", "side": "bottom", "at": 50}}),
            items,
            &palette,
            [0.0, 0.0],
        )
        .unwrap();
        let labels = marks
            .iter()
            .filter(|m| matches!(m, Mark::Text { .. }))
            .count();
        let ticks = marks.iter().filter(|m| m.item().contains("#tick")).count();
        assert_eq!((ticks, labels), (6, 6));
        // Squeezed into 40 u the same six ticks keep fewer labels, the first and the last among them.
        let items =
            json!({"x": {"kind": "scale@1", "params": {"domain": [0, 100000], "range": [0, 60]}}});
        let marks = axis(
            "ax",
            &json!({"params": {"scale": "x"}}),
            items.as_object().unwrap(),
            &palette,
            [0.0, 0.0],
        )
        .unwrap();
        let kept: Vec<&str> = marks
            .iter()
            .filter_map(|m| match m {
                Mark::Text { item, .. } => Some(item.as_str()),
                _ => None,
            })
            .collect();
        assert!(
            kept.len() < 6 && kept.first() == Some(&"ax#label0"),
            "{kept:?}"
        );
    }
}

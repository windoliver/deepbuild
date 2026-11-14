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

use serde_json::{json, Map, Value};

use deep_canvas::color::Oklab;
use deep_canvas::ops;

use crate::path;
use crate::scene::{
    object_or_empty, refuse, Align, Fill, Geometry, ImageFit, ImageSampling, Mark, Palette,
    Refused, TextSpec,
};
use crate::story::{self, Rows};

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
    pub(crate) fn number(&self, i: usize) -> Option<f64> {
        match self {
            Column::Numbers(v) => v.get(i).copied(),
            Column::Const(c) => c.as_f64(),
            Column::Texts(_) => None,
        }
    }

    pub(crate) fn text(&self, i: usize) -> Option<String> {
        match self {
            Column::Texts(v) => v.get(i).cloned(),
            Column::Numbers(v) => v.get(i).map(|n| format!("{n}")),
            Column::Const(Value::String(s)) => Some(s.clone()),
            Column::Const(c) => c.as_f64().map(|n| format!("{n}")),
        }
    }
}

pub(crate) fn column_of(c: &Value, n: usize, path: &str) -> Result<Column, Refused> {
    let Value::Object(c) = c else {
        return refuse("bad_column", path);
    };
    if let Some(v) = c.get("const") {
        return Ok(Column::Const(v.clone()));
    }
    // #538: a copy column no frame has looked up yet shows nothing; a frame rewrites it.
    if crate::copy::is_copy_column(&Value::Object(c.clone())) {
        return Ok(Column::Texts(vec![String::new(); n]));
    }
    // A table column reaches the module inlined by whoever holds the evidence store, and a
    // column-view source by the build's column view; one still unread names what's missing.
    if c.contains_key("from") {
        return refuse("asset_missing", format!("{path}/from"));
    }
    if c.contains_key("source") {
        return refuse("module_missing", format!("{path}/source"));
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
    /// Powers of ten; a value at or below 0 is refused, naming its row.
    Log,
    /// Logarithmic past ±1, linear through zero, as d3's `scaleSymlog` with constant 1.
    Symlog,
    /// Categories to palette roles, one role each, in order.
    Ordinal,
    /// A numeric domain cut into equal bands, one palette role each.
    Quantize,
}

/// A scale from data to u, with its domain made nice, or from data to palette roles.
#[derive(Clone, Debug, PartialEq)]
pub struct Scale {
    pub kind: ScaleKind,
    pub domain: [f64; 2],
    pub range: [f64; 2],
    /// The tick step: data units for linear, milliseconds for time.
    pub step: f64,
    /// An ordinal scale's categories.
    pub categories: Vec<String>,
    /// The palette roles of an ordinal or a quantize scale's range, or the stops of a continuous
    /// one's, which it interpolates between in OKLab.
    pub roles: Vec<String>,
    /// The table column its domain was read from, when it came from one.
    pub from: Option<FromColumn>,
    /// A domain that follows periods.
    pub follows: Option<Follows>,
}

/// A domain that follows periods: each period's, in order, and where `at` falls among them.
#[derive(Clone, Debug, PartialEq)]
pub struct Follows {
    pub domains: Vec<[f64; 2]>,
    pub period: usize,
    pub fraction: f64,
}

/// A mark set column a scale's domain was read from: its name and its table `trace`.
pub type FromColumn = (String, Value);

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

/// The domain of scale `id` from the columns encoded through it in `items`, with the table
/// column it came from, and whether a bar or an area reads it (its domain then holds zero).
fn column_domain(
    id: &str,
    items: &Map<String, Value>,
) -> Option<([f64; 2], Option<FromColumn>, bool)> {
    let (mut lo, mut hi, mut from, mut zero) = (f64::INFINITY, f64::NEG_INFINITY, None, false);
    for (set_id, item) in items {
        if item.get("kind").and_then(Value::as_str) != Some("marks@1") {
            continue;
        }
        let p = object_or_empty(item.get("params"));
        let n = p.get("n").and_then(Value::as_u64).unwrap_or(0) as usize;
        for e in object_or_empty(p.get("encode")).values() {
            if e.get("scale").and_then(Value::as_str) != Some(id) {
                continue;
            }
            let Some(name) = e.get("column").and_then(Value::as_str) else {
                continue;
            };
            let Some(c) = p.get("columns").and_then(|c| c.get(name)) else {
                continue;
            };
            let path = format!("items/{set_id}/params/columns/{name}");
            if let Ok(Column::Numbers(values)) = column_of(c, n, &path) {
                for v in values {
                    (lo, hi) = (lo.min(v), hi.max(v));
                }
            }
            if let Some(trace) = c.get("trace") {
                from.get_or_insert((name.to_string(), trace.clone()));
            }
            zero |= matches!(p.get("mark").and_then(Value::as_str), Some("bar" | "area"));
        }
    }
    (lo <= hi).then_some(([lo, hi], from, zero))
}

/// The first mark set that encodes a column through scale `id` and plays periods: its compiled
/// periods, `at` and that column's name.
fn periods_through(
    id: &str,
    items: &Map<String, Value>,
) -> Result<Option<(std::rc::Rc<story::Compiled>, f64, String)>, Refused> {
    for (set_id, item) in items {
        if item.get("kind").and_then(Value::as_str) != Some("marks@1") {
            continue;
        }
        let p = object_or_empty(item.get("params"));
        let path = format!("items/{set_id}/params");
        let Some(column) = object_or_empty(p.get("encode"))
            .values()
            .find(|e| e.get("scale").and_then(Value::as_str) == Some(id))
            .and_then(|e| e.get("column")?.as_str())
        else {
            continue;
        };
        let base = || Ok(base_rows(set_id, item, &BoundRows::new())?.without_hidden());
        if let Some(c) = story::compiled(set_id, p, &path, base)? {
            let at = story::at_of(p, &c.periods, &path)?;
            return Ok(Some((c, at, column.to_string())));
        }
    }
    Ok(None)
}

/// The tick step of a domain.
fn step_of(kind: ScaleKind, domain: [f64; 2]) -> f64 {
    let span = domain[1] - domain[0];
    match kind {
        ScaleKind::Time => TIME_STEPS
            .iter()
            .copied()
            .find(|s| span / s <= TICKS)
            .unwrap_or(TIME_STEPS[TIME_STEPS.len() - 1]),
        _ => linear_step(span),
    }
}

/// `domain` rounded out to its step, or to decades on a log scale.
fn nice_of(kind: ScaleKind, domain: [f64; 2], step: f64) -> [f64; 2] {
    match kind {
        ScaleKind::Log => [
            ops::powi(10.0, ops::log10(domain[0]).floor() as i32),
            ops::powi(10.0, ops::log10(domain[1]).ceil() as i32),
        ],
        ScaleKind::Symlog => {
            let out = |v: f64, up: bool| {
                let exp = ops::log10(v.abs().max(1.0));
                let exp = if (v >= 0.0) == up {
                    exp.ceil()
                } else {
                    exp.floor()
                };
                if v == 0.0 {
                    0.0
                } else {
                    ops::powi(10.0, exp as i32).copysign(v)
                }
            };
            [out(domain[0], false), out(domain[1], true)]
        }
        _ => [
            (domain[0] / step).floor() * step,
            (domain[1] / step).ceil() * step,
        ],
    }
}

/// Every row whose value at or below 0 reaches log scale `id`, as `<set>#<key>`.
pub fn log_rows(id: &str, items: &Map<String, Value>) -> Result<Vec<String>, Refused> {
    let mut out = Vec::new();
    for (set_id, item) in items {
        if item.get("kind").and_then(Value::as_str) != Some("marks@1")
            || story::rows_of(item).is_some()
        {
            continue;
        }
        let p = object_or_empty(item.get("params"));
        for e in object_or_empty(p.get("encode")).values() {
            if e.get("scale").and_then(Value::as_str) != Some(id) {
                continue;
            }
            let Some(name) = e.get("column").and_then(Value::as_str) else {
                continue;
            };
            let rows = base_rows(set_id, item, &BoundRows::new())?;
            if let Some(column) = rows.columns.get(name) {
                let low = |i: &usize| column.number(*i).is_some_and(|v| v <= 0.0);
                let rows_low = (0..rows.keys.len()).filter(low);
                out.extend(rows_low.map(|i| format!("{set_id}#{}", rows.keys[i])));
            }
        }
    }
    Ok(out)
}

impl Scale {
    pub(crate) fn read(
        id: &str,
        item: &Value,
        items: &Map<String, Value>,
    ) -> Result<Scale, Refused> {
        let path = format!("items/{id}/params");
        let p = item.get("params").and_then(Value::as_object);
        let get = |k: &str| p.and_then(|p| p.get(k));
        let kind = match get("type").and_then(Value::as_str) {
            None | Some("linear") => ScaleKind::Linear,
            Some("time") => ScaleKind::Time,
            Some("log") => ScaleKind::Log,
            Some("symlog") => ScaleKind::Symlog,
            Some("ordinal") => ScaleKind::Ordinal,
            Some("quantize") => ScaleKind::Quantize,
            Some(_) => return refuse("scale_type", format!("{path}/type")),
        };
        let strings = |k: &str| -> Result<Vec<String>, Refused> {
            match get(k).and_then(Value::as_array) {
                Some(list) if !list.is_empty() => list
                    .iter()
                    .map(|v| v.as_str().map(str::to_string))
                    .collect::<Option<Vec<_>>>()
                    .ok_or(Refused {
                        code: "bad_scale",
                        path: format!("{path}/{k}"),
                    }),
                _ => refuse("bad_scale", format!("{path}/{k}")),
            }
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
        if kind == ScaleKind::Ordinal {
            return Ok(Scale {
                kind,
                domain: [0.0, 0.0],
                range: [0.0, 0.0],
                step: 1.0,
                categories: strings("domain")?,
                roles: strings("range")?,
                from: None,
                follows: None,
            });
        }
        if kind == ScaleKind::Log {
            if let Some(row) = log_rows(id, items)?.first() {
                return refuse("log_domain", format!("items/{row}"));
            }
        }
        let nice = get("nice").and_then(Value::as_bool).unwrap_or(true);
        // Palette roles as a continuous scale's range make it a colormap.
        let ramp = kind != ScaleKind::Quantize
            && get("range")
                .and_then(Value::as_array)
                .is_some_and(|r| r.first().is_some_and(Value::is_string));
        let (range, roles) = if kind == ScaleKind::Quantize || ramp {
            ([0.0, 0.0], strings("range")?)
        } else if matches!(get("range").and_then(Value::as_str), Some("x" | "y" | "z")) {
            // #226: a range naming a view axis spans that axis, which its reader places: the unit.
            ([0.0, 1.0], Vec::new())
        } else {
            (pair("range")?, Vec::new())
        };
        // A domain that follows the periods: each period's own, shaped as any scale's is.
        if get("domain").and_then(Value::as_str) == Some("periods") {
            let Some((compiled, at, column)) = periods_through(id, items)? else {
                return refuse("bad_scale", format!("{path}/domain"));
            };
            let Some(Column::Numbers(values)) = compiled.rows.columns.get(&column) else {
                return refuse("bad_scale", format!("{path}/domain"));
            };
            let zero = get("zero") == Some(&Value::Bool(true)) || bars_through(id, items);
            let shape = |d: [f64; 2]| {
                let d = if zero {
                    [d[0].min(0.0), d[1].max(0.0)]
                } else {
                    d
                };
                let d = if d[1] <= d[0] { [d[0], d[0] + 1.0] } else { d };
                if nice {
                    nice_of(kind, d, step_of(kind, d))
                } else {
                    d
                }
            };
            let periods = &compiled.periods;
            let domains: Vec<[f64; 2]> = periods.domains(values).into_iter().map(shape).collect();
            // A set with no rows has no period to follow.
            if domains.is_empty() {
                return refuse("bad_scale", format!("{path}/domain"));
            }
            // A log scale holds no value at or below 0.
            if kind == ScaleKind::Log && domains.iter().any(|d| d[0] <= 0.0) {
                return refuse("out_of_range", format!("{path}/domain"));
            }
            let (period, fraction) = periods.span_at(at);
            let (a, b) = (
                domains[period],
                domains[(period + 1).min(domains.len() - 1)],
            );
            let domain = [
                a[0] + (b[0] - a[0]) * fraction,
                a[1] + (b[1] - a[1]) * fraction,
            ];
            return Ok(Scale {
                kind,
                domain,
                range,
                step: step_of(kind, domain),
                categories: Vec::new(),
                roles,
                from: None,
                follows: Some(Follows {
                    domains,
                    period,
                    fraction,
                }),
            });
        }
        // A domain read from the columns encoded through the scale, by default.
        let (mut domain, from) = match get("domain") {
            Some(_) => (pair("domain")?, None),
            None => match column_domain(id, items) {
                Some((mut d, from, zero)) => {
                    if zero || get("zero") == Some(&Value::Bool(true)) {
                        d = [d[0].min(0.0), d[1].max(0.0)];
                    }
                    if d[1] <= d[0] {
                        d[1] = d[0] + 1.0;
                    }
                    (d, from)
                }
                None => return refuse("bad_scale", format!("{path}/domain")),
            },
        };
        // A log scale holds no value at or below 0.
        if domain[1] <= domain[0] || (kind == ScaleKind::Log && domain[0] <= 0.0) {
            return refuse("out_of_range", format!("{path}/domain"));
        }
        let step = step_of(kind, domain);
        if nice {
            domain = nice_of(kind, domain, step);
        }
        Ok(Scale {
            kind,
            domain,
            range,
            step,
            categories: Vec::new(),
            roles,
            from,
            follows: None,
        })
    }

    /// A scale whose domain is `domain`, as this one at a rest on its period.
    fn resting(&self, domain: [f64; 2]) -> Scale {
        Scale {
            domain,
            step: step_of(self.kind, domain),
            follows: None,
            ..self.clone()
        }
    }

    /// The share of the way across the domain a value lies, in the scale's own warp.
    fn unit(&self, v: f64) -> f64 {
        let warp = |v: f64| match self.kind {
            ScaleKind::Log => ops::log10(v),
            ScaleKind::Symlog => ops::log1p(v.abs()).copysign(v),
            _ => v,
        };
        let [d0, d1] = self.domain;
        (warp(v) - warp(d0)) / (warp(d1) - warp(d0))
    }

    /// Whether the scale's range is palette roles it interpolates between.
    pub fn ramp(&self) -> bool {
        !self.roles.is_empty() && !matches!(self.kind, ScaleKind::Ordinal | ScaleKind::Quantize)
    }

    /// A value's color through a continuous scale, unrounded: its place across the stops, in
    /// OKLab, held at the ends.
    pub fn lab(&self, v: f64, palette: &Palette, path: &str) -> Result<Oklab, Refused> {
        let last = self.roles.len() - 1;
        let at = self.unit(v).clamp(0.0, 1.0) * last as f64;
        let i = (at.floor() as usize).min(last.saturating_sub(1));
        let [a, b] = [i, (i + 1).min(last)].map(|k| role(palette, &self.roles[k], path));
        Ok(crate::paint::oklab_mix(a?, b?, at - i as f64))
    }

    /// The palette role a value takes through an ordinal or a quantize scale: an ordinal's
    /// category in order, and a quantize's band, as d3's `scaleQuantize` cuts it (thresholds
    /// ((i + 1) × x1 − (i − n) × x0) ÷ (n + 1), the band the count of thresholds at or below the
    /// value, so an edge opens the next band and the domain's ends clamp).
    pub fn role(&self, number: Option<f64>, text: Option<&str>) -> Option<&str> {
        match self.kind {
            ScaleKind::Ordinal => {
                let i = self
                    .categories
                    .iter()
                    .position(|c| Some(c.as_str()) == text)?;
                self.roles.get(i % self.roles.len()).map(String::as_str)
            }
            ScaleKind::Quantize => {
                let v = number?;
                let n = self.roles.len() - 1;
                let [x0, x1] = self.domain;
                let band = (0..n)
                    .filter(|&i| {
                        ((i + 1) as f64 * x1 - (i as f64 - n as f64) * x0) / (n + 1) as f64 <= v
                    })
                    .count();
                self.roles.get(band).map(String::as_str)
            }
            _ => None,
        }
    }

    /// A value's place in u.
    pub fn map(&self, v: f64) -> f64 {
        let [r0, r1] = self.range;
        r0 + self.unit(v) * (r1 - r0)
    }

    /// The ticks over the domain, each with its label.
    pub fn ticks(&self) -> Vec<(f64, String)> {
        if matches!(self.kind, ScaleKind::Log | ScaleKind::Symlog) {
            return self.decades();
        }
        let first = (self.domain[0] / self.step).ceil() as i64;
        let last = (self.domain[1] / self.step).floor() as i64;
        let digits = match self.kind {
            ScaleKind::Time => 0,
            _ => (-ops::log10(self.step).floor()).max(0.0) as usize,
        };
        (first..=last.min(first + 1_000))
            .map(|k| {
                let v = k as f64 * self.step;
                let label = match self.kind {
                    ScaleKind::Time => time_label(v as i64, self.step),
                    _ => format!("{:.*}", digits, v),
                };
                (v, label)
            })
            .collect()
    }

    /// A log or symlog scale's ticks: each power of ten in its domain, and a symlog's zero.
    fn decades(&self) -> Vec<(f64, String)> {
        let mut out = Vec::new();
        let [lo, hi] = self.domain;
        if self.kind == ScaleKind::Symlog && lo <= 0.0 && hi >= 0.0 {
            out.push(0.0);
        }
        let reach = ops::log10(lo.abs().max(hi.abs())).ceil() as i32;
        // A symlog scale is linear within ±1, so its decades start at 1.
        let first = match self.kind {
            ScaleKind::Log => ops::log10(lo).floor() as i32,
            _ => 0,
        };
        for e in first..=reach {
            let v = ops::powi(10.0, e);
            out.extend(
                [v, -v].into_iter().filter(|v| {
                    *v >= lo && *v <= hi && (self.kind == ScaleKind::Symlog || *v > 0.0)
                }),
            );
        }
        out.sort_by(f64::total_cmp);
        out.into_iter().map(|v| (v, format!("{v}"))).collect()
    }

    /// Every tick the scale shows at any period, each with its opacity now: a tick only one of
    /// the two periods around `at` holds enters or leaves by the fraction between them, and one
    /// neither holds is listed at 0.
    pub fn faded_ticks(&self) -> Vec<(f64, String, f64)> {
        let Some(f) = &self.follows else {
            return self.ticks().into_iter().map(|(v, l)| (v, l, 1.0)).collect();
        };
        let ticks: Vec<Vec<(f64, String)>> =
            f.domains.iter().map(|d| self.resting(*d).ticks()).collect();
        let next = (f.period + 1).min(ticks.len() - 1);
        let holds = |p: usize, v: f64| f64::from(u8::from(ticks[p].iter().any(|t| t.0 == v)));
        let mut all: Vec<(f64, String)> = ticks.iter().flatten().cloned().collect();
        all.sort_by(|a, b| a.0.total_cmp(&b.0));
        all.dedup_by(|a, b| a.0 == b.0);
        all.into_iter()
            .map(|(v, label)| {
                let (from, to) = (holds(f.period, v), holds(next, v));
                (v, label, from + (to - from) * f.fraction)
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

/// Whether a bar or an area reads scale `id`.
fn bars_through(id: &str, items: &Map<String, Value>) -> bool {
    items.values().any(|item| {
        let p = object_or_empty(item.get("params"));
        matches!(p.get("mark").and_then(Value::as_str), Some("bar" | "area"))
            && object_or_empty(p.get("encode"))
                .values()
                .any(|e| e.get("scale").and_then(Value::as_str) == Some(id))
    })
}

/// A `scale@1` item's scale, its domain made nice, and its ticks.
pub fn scale_of(id: &str, item: &Value) -> Result<Scale, Refused> {
    // Alone, a scale has no rows to follow: it reads as the unit domain.
    let follows = item.pointer("/params/domain").is_some_and(Value::is_string);
    if follows {
        let mut item = item.clone();
        item["params"]["domain"] = json!([0, 1]);
        return Scale::read(id, &item, &Map::new());
    }
    Scale::read(id, item, &Map::new())
}

/// [`scale_named`], following the keys of a channel on its domain (#226).
fn keyed_named(
    items: &Map<String, Value>,
    channels: Option<&Value>,
    id: &str,
    path: &str,
) -> Result<Scale, Refused> {
    let scale = scale_named(items, id, path)?;
    Ok(crate::follow::keyed(scale, id, &items[id], items, channels))
}

fn scale_named(items: &Map<String, Value>, id: &str, path: &str) -> Result<Scale, Refused> {
    match items.get(id) {
        Some(item) if item.get("kind").and_then(Value::as_str) == Some("scale@1") => {
            Scale::read(id, item, items)
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

type Props = std::collections::BTreeMap<String, Encoded>;

/// A set's `encode`, each column read against `rows`, each scale from `items`.
fn encoded(
    p: &Map<String, Value>,
    rows: &Rows,
    items: &Map<String, Value>,
    path: &str,
) -> Result<Props, Refused> {
    let mut props = Props::new();
    for (prop, e) in object_or_empty(p.get("encode")) {
        let epath = format!("{path}/encode/{prop}");
        let enc = match e {
            Value::Object(o) if o.contains_key("column") => {
                let Some(column) = o.get("column").and_then(Value::as_str) else {
                    return refuse("bad_encode", epath);
                };
                // Rows from an occurrence list bring their columns at t.
                if !rows.columns.contains_key(column) && !p.contains_key("rows") {
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
    Ok(props)
}

/// Row `i`'s value of a property, through its scale.
fn prop_number(props: &Props, rows: &Rows, prop: &str, i: usize) -> Option<f64> {
    match props.get(prop)? {
        Encoded::Column { column, scale } => {
            let v = rows.columns.get(column)?.number(i)?;
            Some(scale.as_ref().map_or(v, |s| s.map(v)))
        }
        Encoded::Const(v) => v.as_f64(),
    }
}

/// A bar's or an area's base: its y scale's zero, else 0.
/// #505: row `i`'s role where the set names its `roles` and has a `role` column: the column's
/// value as an index into them (Mark set and columns: "a `role` column takes an index into the
/// set's roles").
fn set_role<'a>(p: &'a Map<String, Value>, rows: &Rows, i: usize) -> Option<&'a str> {
    let roles = p.get("roles")?.as_array()?;
    let k = rows.columns.get("role")?.number(i)?;
    (k >= 0.0 && k.fract() == 0.0)
        .then(|| roles.get(k as usize)?.as_str())
        .flatten()
}

fn base_of(props: &Props) -> f64 {
    match props.get("y") {
        Some(Encoded::Column {
            scale: Some(scale), ..
        }) => scale.map(0.0),
        _ => 0.0,
    }
}

/// `#head`'s place in document u, `None` before the first row.
pub fn head_place(
    id: &str,
    item: &Value,
    items: &Map<String, Value>,
) -> Result<Option<[f64; 2]>, Refused> {
    let rows = rows(id, item, items, &BoundRows::new())?;
    let path = format!("items/{id}/params");
    let props = encoded(object_or_empty(item.get("params")), &rows, items, &path)?;
    let at = |prop: &str, i: usize| prop_number(&props, &rows, prop, i);
    Ok(rows
        .head
        .and_then(|i| Some([at("x", i)?, at("y", i)?]))
        .map(|p| {
            let pos = crate::scene::item_pos(item);
            [p[0] + pos[0], p[1] + pos[1]]
        }))
}

/// What `geometry` answers of a mark set at t: each row by key, after the transforms, with its
/// columns, opacity, place in document u (an atlas row's, its cell's centre) and, through a
/// colormap, its color unrounded. `planted`: #1653's square layout of an isometric grid.
pub fn rows_report(
    id: &str,
    item: &Value,
    items: &Map<String, Value>,
    palette: &Palette,
    planted: crate::scene::Planted,
) -> Result<Value, Refused> {
    let path = format!("items/{id}/params");
    let p = object_or_empty(item.get("params"));
    let rows = rows(id, item, items, &BoundRows::new())?;
    let props = encoded(p, &rows, items, &path)?;
    let pos = crate::scene::item_pos(item);
    let bar = p.get("mark").and_then(Value::as_str) == Some("bar");
    // #1653: an atlas row's place is its cell's centre.
    let centres: std::collections::BTreeMap<String, [f64; 2]> = if crate::atlas::is_atlas(p) {
        crate::atlas::tiles(id, p, &rows, planted)?
            .into_iter()
            .map(|t| (t.key, t.centre))
            .collect()
    } else {
        Default::default()
    };
    let mut out = Map::new();
    for (i, key) in rows.keys.iter().enumerate() {
        let columns: Map<String, Value> = rows
            .columns
            .iter()
            .map(|(name, c)| match c.number(i) {
                Some(v) => (name.clone(), json!(v)),
                None => (name.clone(), json!(c.text(i))),
            })
            .collect();
        let at = |prop: &str| prop_number(&props, &rows, prop, i);
        let mut place = Map::new();
        for (k, axis) in [("x", 0), ("y", 1), ("x2", 0), ("y2", 1)] {
            let base = (bar && k == "y2").then(|| base_of(&props));
            if let Some(v) = at(k).or(base) {
                place.insert(k.to_string(), json!(v + pos[axis]));
            }
        }
        if let Some(c) = centres.get(key) {
            place.insert("x".into(), json!(c[0] + pos[0]));
            place.insert("y".into(), json!(c[1] + pos[1]));
        }
        let mut row = json!({"columns": columns, "opacity": rows.opacity_of(i), "place": place});
        // #505: a role column's index into the set's roles.
        if let (None, Some(r)) = (props.get("role"), set_role(p, &rows, i)) {
            let c = role(palette, r, &format!("{path}/roles"))?;
            let lab = crate::paint::oklab_mix(c, c, 0.0);
            row["oklab"] = json!([lab.l, lab.a, lab.b]);
        }
        if let Some(Encoded::Column {
            column,
            scale: Some(scale),
        }) = props.get("role")
        {
            if let (true, Some(v)) = (
                scale.ramp(),
                rows.columns.get(column).and_then(|c| c.number(i)),
            ) {
                let lab = scale.lab(v, palette, &format!("{path}/encode/role"))?;
                row["oklab"] = json!([lab.l, lab.a, lab.b]);
            }
        }
        out.insert(key.clone(), row);
    }
    Ok(Value::Object(out))
}

/// What `geometry` answers of a scale at t: its domain.
pub fn domain_report(id: &str, item: &Value, items: &Map<String, Value>) -> Result<Value, Refused> {
    Ok(json!(Scale::read(id, item, items)?.domain))
}

/// What `geometry` answers of an axis at t: every tick its scale holds at any period, with its
/// opacity.
pub fn ticks_report(
    id: &str,
    item: &Value,
    (items, channels): (&Map<String, Value>, Option<&Value>),
) -> Result<Value, Refused> {
    let path = format!("items/{id}/params/scale");
    let scale = item.pointer("/params/scale").and_then(Value::as_str);
    let Some(scale) = scale else {
        return refuse("bad_axis", path);
    };
    let ticks = keyed_named(items, channels, scale, &path)?.faded_ticks();
    Ok(ticks
        .into_iter()
        .map(|(value, _, opacity)| json!({"value": value, "opacity": opacity}))
        .collect())
}

/// What a mark set or an axis draws: its marks, and those a transform left below full opacity, by
/// item name.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Drawing {
    pub marks: Vec<Mark>,
    pub fades: std::collections::BTreeMap<String, f64>,
}

/// The rows a mark set draws: its own columns after its transforms, or another set's rows
/// (`rows_of`) after that set's. `bound` holds the readings bound to its cells.
pub fn rows(
    id: &str,
    item: &Value,
    items: &Map<String, Value>,
    bound: &BoundRows,
) -> Result<Rows, Refused> {
    let path = format!("items/{id}/params");
    let p = object_or_empty(item.get("params"));
    let columns = object_or_empty(p.get("columns"));
    if let Some(of) = p.get("rows_of") {
        let of_path = format!("{path}/rows_of");
        let source = match of.as_str().and_then(|s| Some((s, items.get(s)?))) {
            Some((s, set))
                if set.get("kind").and_then(Value::as_str) == Some("marks@1")
                    && story::rows_of(set).is_none() =>
            {
                (s, set)
            }
            _ => return refuse("ref_unresolved", of_path),
        };
        let mut rows = rows(source.0, source.1, items, &BoundRows::new())?;
        for (name, c) in columns {
            let column = column_of(c, rows.keys.len(), &format!("{path}/columns/{name}"))?;
            rows.columns.insert(name.clone(), column);
        }
        return Ok(rows);
    }
    if p.get("transforms").is_none() {
        return base_rows(id, item, bound);
    }
    story::played(id, p, &path, !bound.is_empty(), || {
        Ok(base_rows(id, item, bound)?.without_hidden())
    })
}

/// A mark set's own rows, before its transforms. A set whose rows come from an occurrence list
/// has them once its document is evaluated at a time.
pub fn base_rows(id: &str, item: &Value, bound: &BoundRows) -> Result<Rows, Refused> {
    let path = format!("items/{id}/params");
    let p = object_or_empty(item.get("params"));
    if p.contains_key("rows") && !p.contains_key("n") {
        return Ok(Rows::default());
    }
    let columns = object_or_empty(p.get("columns"));
    let n = match p.get("n").and_then(Value::as_u64) {
        Some(n) if n <= MAX_ROWS => n as usize,
        _ => return refuse("out_of_range", format!("{path}/n")),
    };
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
    // The rows the column view hid: a value its reader can't narrow to (Array and table: column
    // view) doesn't draw for as long as it lasts, nor does a row whose `alive` is false (#535).
    for c in columns.values().chain(p.get("alive")) {
        if let Some(Value::Array(rows)) = c.get("hide") {
            hidden.extend(rows.iter().filter_map(Value::as_f64).map(|r| r as usize));
        }
    }
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
        .map(|i| crate::atlas::key(key_column.and_then(|(_, k)| k.text(i)), p, i))
        .collect();
    let transforms = story::listed(p, &path)?;
    // A key is unique and stable (Mark set: `key`), so a row can be picked and patched by it;
    // under periods, unique in its period, which the periods check.
    if let (Some((k, _)), false) = (key_column, transforms.iter().any(|t| t.0 == "periods")) {
        let mut seen = std::collections::BTreeSet::new();
        if !keys.iter().all(|key| seen.insert(key)) {
            return refuse("key_not_unique", format!("{path}/columns/{k}"));
        }
    }
    let precision = if transforms.is_empty() {
        Default::default()
    } else {
        decoded
            .iter()
            .filter_map(|(name, c)| match c {
                Column::Numbers(v) => Some((name.clone(), story::precision_of(&columns[name], v))),
                _ => None,
            })
            .collect()
    };
    Ok(Rows {
        keys,
        columns: decoded,
        precision,
        hidden,
        ..Rows::default()
    })
}

/// A mark set's rows as marks, each named `<id>#<key>`. `bound` holds the readings bound to its
/// cells.
pub fn mark_set(
    id: &str,
    item: &Value,
    items: &Map<String, Value>,
    palette: &Palette,
    pos: [f64; 2],
    bound: &BoundRows,
) -> Result<Drawing, Refused> {
    let path = format!("items/{id}/params");
    let p = object_or_empty(item.get("params"));
    let rows = rows(id, item, items, bound)?;
    let n = rows.keys.len();
    let (decoded, keys, hidden) = (&rows.columns, &rows.keys, &rows.hidden);
    let props = encoded(p, &rows, items, &path)?;
    if let (Some("bar" | "area"), Some(Encoded::Column { scale: Some(s), .. })) =
        (p.get("mark").and_then(Value::as_str), props.get("y"))
    {
        // A bar starts at zero, which a log scale doesn't hold.
        if s.kind == ScaleKind::Log {
            return refuse("bad_encode", format!("{path}/encode/y"));
        }
    }
    let number = |prop: &str, i: usize| prop_number(&props, &rows, prop, i);
    let text = |i: usize| -> Option<String> {
        match props.get("text")? {
            Encoded::Column { column, .. } => rows.shown(column, i),
            Encoded::Const(v) => v.as_str().map(str::to_string),
        }
    };
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
    // A stepped fill over the rows: each row one color by its rank, in row order or by key.
    let steps = paint
        .and_then(|pt| pt.get("fill"))
        .and_then(|f| f.get("steps"))
        .and_then(Value::as_object)
        .filter(|s| s.get("over").and_then(Value::as_str) == Some("rows"));
    let row_steps = match steps {
        Some(s) => {
            let stops = crate::paint::row_stops(palette, s, &format!("{path}/paint/fill/steps"))?;
            let mut rank: Vec<usize> = (0..n).collect();
            if s.get("by").and_then(Value::as_str) == Some("key") {
                let num = |k: &str| k.parse::<f64>().ok();
                rank.sort_by(|a, b| match (num(&keys[*a]), num(&keys[*b])) {
                    (Some(x), Some(y)) => x.total_cmp(&y),
                    _ => keys[*a].cmp(&keys[*b]),
                });
            }
            let mut at = vec![0.0; n];
            for (r, i) in rank.into_iter().enumerate() {
                at[i] = if n > 1 {
                    r as f64 / (n - 1) as f64
                } else {
                    0.0
                };
            }
            Some((stops, at))
        }
        None => None,
    };
    // A row's color: its `role` through a scale whose range is palette roles, or the paint's.
    let color_of = |i: usize| -> Result<[u8; 3], Refused> {
        let rpath = format!("{path}/encode/role");
        if let (None, Some(r)) = (props.get("role"), set_role(p, &rows, i)) {
            return role(palette, r, &format!("{path}/roles"));
        }
        match props.get("role") {
            None => Ok(match &row_steps {
                Some((stops, at)) => crate::paint::sample_stops(stops, at[i]),
                None => color,
            }),
            Some(Encoded::Const(Value::String(r))) => role(palette, r, &rpath),
            Some(Encoded::Column {
                column,
                scale: Some(scale),
            }) => {
                let c = decoded.get(column);
                if scale.ramp() {
                    return match c.and_then(|c| c.number(i)) {
                        Some(v) => Ok(crate::paint::rgb_of(scale.lab(v, palette, &rpath)?)),
                        None => refuse("bad_encode", rpath),
                    };
                }
                let text = c.and_then(|c| c.text(i));
                match scale.role(c.and_then(|c| c.number(i)), text.as_deref()) {
                    Some(r) => role(palette, r, &rpath),
                    None => refuse("bad_encode", rpath),
                }
            }
            Some(_) => refuse("bad_encode", rpath),
        }
    };
    let dash = paint
        .and_then(|pt| pt.get("stroke"))
        .and_then(|s| s.get("dash"))
        .and_then(Value::as_array)
        .map(|d| d.iter().filter_map(Value::as_f64).collect::<Vec<_>>())
        .filter(|d| d.iter().sum::<f64>() > 0.0 && d.iter().all(|v| *v >= 0.0));
    let stroke_width = paint
        .and_then(|pt| pt.get("stroke"))
        .and_then(|s| s.get("width"))
        .and_then(Value::as_f64)
        .unwrap_or(1.0);
    // A bar's or an area's base: its `y2`, else its y scale's zero, else 0.
    let zero = base_of(&props);
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
    let mut fades = std::collections::BTreeMap::new();
    // A path's and an area's rows are one line through the rows in order.
    let mut line: Vec<[f64; 2]> = Vec::new();
    let mut line_color = color;
    // A line is one mark: it shows as its most opaque row does.
    let mut line_alpha: f64 = 0.0;
    for (i, key) in keys.iter().enumerate() {
        if hidden.contains(&i) {
            continue;
        }
        let name = format!("{id}#{key}");
        let alpha = rows.opacity_of(i);
        if alpha <= 0.0 {
            continue;
        }
        if mark == "path" || mark == "area" {
            line_alpha = line_alpha.max(alpha);
        } else if alpha < 1.0 {
            fades.insert(name.clone(), alpha);
        }
        let color = color_of(i)?;
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
            "path" | "area" => {
                if line.is_empty() {
                    line_color = color;
                }
                line.push(at)
            }
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
                    tile: None,
                    turn: 0.0,
                });
            }
            "text" => out.push(Mark::Text {
                item: name,
                spec: TextSpec {
                    text: text(i).unwrap_or_default(),
                    font: "body".into(),
                    family: Some(deep_text::Role::Body.family()),
                    fallback: Vec::new(),
                    lang: None,
                    size: number("size", i).unwrap_or(11.0),
                    weight: 400,
                    width: None,
                    max_lines: None,
                    mask: false,
                    align: Align::Start,
                    bound: false,
                    spans: Vec::new(),
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
        let d = match (&dash, area) {
            (Some(dash), false) => dashed(&line, dash),
            _ => d.trim_end().to_string(),
        };
        out.push(Mark::Path {
            item: id.to_string(),
            geometry: Geometry {
                verbs: path::parse(&d).unwrap_or_default(),
                stroke: (!area).then_some(stroke_width),
                fill: area,
            },
            d,
            offset: [0.0, 0.0],
            color: line_color,
        });
        if line_alpha < 1.0 {
            fades.insert(id.to_string(), line_alpha);
        }
    }
    Ok(Drawing { marks: out, fades })
}

/// A polyline cut into dashes (Paint: `dash: [u]`, on and off lengths repeating from its start),
/// each dash a sub-path of its own.
fn dashed(line: &[[f64; 2]], dash: &[f64]) -> String {
    let mut d = String::new();
    let (mut k, mut left, mut on) = (0, dash[0], true);
    for w in line.windows(2) {
        let (a, b) = (w[0], w[1]);
        let len = ((b[0] - a[0]).powi(2) + (b[1] - a[1]).powi(2)).sqrt();
        let at = |f: f64| [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f];
        let mut done = 0.0;
        while done < len {
            let step = left.min(len - done);
            if on {
                let (p, q) = (at(done / len), at((done + step) / len));
                d.push_str(&format!("M {} {} L {} {} ", p[0], p[1], q[0], q[1]));
            }
            done += step;
            left -= step;
            if left <= 0.0 {
                k = (k + 1) % dash.len();
                left = dash[k];
                on = !on;
            }
        }
    }
    d.trim_end().to_string()
}

/// Which rows a line keeps in each pixel column (Series and decimation `series@1`). The planted
/// ones are wrong programs a proof surface reaches only through its `planted` field.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum Decimate {
    /// First, min, max and last: the full data's picture for a line without antialiasing.
    #[default]
    M4,
    /// Every row.
    None,
    /// #399 AC6's twins: only each column's first and last rows, or only its min and max.
    FirstLast,
    MinMax,
    /// #399's planted data@1: M4 without each column's last row.
    DropsLast,
}

/// The pixel column of a time over a window `[t0, t1]` of `cols` columns, exactly: column k
/// holds `t0 + k·(t1−t0)/cols < t ≤ t0 + (k+1)·(t1−t0)/cols`, the window's first row in column 0
/// (tsdownsample's `side="right"` edge rule). Times are whole flicks.
pub fn pixel_column(t: f64, t0: f64, t1: f64, cols: usize) -> usize {
    let (t, t0, t1) = (t as i128, t0 as i128, t1 as i128);
    let span = t1 - t0;
    let w = cols as i128;
    if span <= 0 {
        return 0;
    }
    let scaled = (t - t0) * w;
    let k = if scaled <= 0 {
        0
    } else {
        (scaled + span - 1) / span - 1
    };
    k.clamp(0, w - 1) as usize
}

/// A series' rows in its window, by pixel column: each column's kept rows in time order.
pub struct Decimated {
    pub t: Vec<f64>,
    pub v: Vec<f64>,
    pub columns: Vec<Vec<usize>>,
    pub window: (f64, f64),
}

impl Decimated {
    /// Every kept row, in draw order, each once.
    pub fn rows(&self) -> Vec<usize> {
        self.columns.iter().flatten().copied().collect()
    }

    /// The raw row nearest a time, never a decimated vertex: the crosshair's snap.
    pub fn nearest(&self, at: f64) -> Option<usize> {
        let i = self.t.partition_point(|&t| t < at);
        match (i.checked_sub(1), (i < self.t.len()).then_some(i)) {
            (Some(a), Some(b)) => Some(if at - self.t[a] <= self.t[b] - at {
                a
            } else {
                b
            }),
            (a, b) => a.or(b),
        }
    }
}

/// The time-and-value columns of a line series and the rows each pixel column keeps.
pub fn decimated(id: &str, item: &Value, how: Decimate) -> Result<Decimated, Refused> {
    let path = format!("items/{id}/params");
    let p = object_or_empty(item.get("params"));
    let n = series_len(p, &path)?;
    let t = series_numbers(p, "t", n, &path)?.ok_or(Refused {
        code: "bad_column",
        path: format!("{path}/t"),
    })?;
    if let Some(i) = t.windows(2).position(|w| w[1] <= w[0]) {
        return refuse("out_of_range", format!("{path}/t/{}", i + 1));
    }
    let Some(v) = series_numbers(p, "v", n, &path)? else {
        return refuse("bad_column", format!("{path}/v"));
    };
    let [_, _, bw, _] = series_box(p, &path)?;
    let (t0, t1) = series_window(p, &t, &path)?;
    let cols = bw.floor().max(1.0) as usize;
    let mut columns: Vec<Vec<usize>> = vec![Vec::new(); cols];
    let start = t.partition_point(|&x| x < t0);
    let end = t.partition_point(|&x| x <= t1);
    let mut i = start;
    while i < end {
        let k = pixel_column(t[i], t0, t1, cols);
        let mut j = i;
        let (mut lo, mut hi) = (i, i);
        while j < end && pixel_column(t[j], t0, t1, cols) == k {
            if v[j] < v[lo] {
                lo = j;
            }
            if v[j] > v[hi] {
                hi = j;
            }
            j += 1;
        }
        let last = j - 1;
        let mut kept: Vec<usize> = match how {
            Decimate::None => (i..j).collect(),
            Decimate::M4 => vec![i, lo, hi, last],
            Decimate::FirstLast => vec![i, last],
            Decimate::MinMax => vec![lo, hi],
            Decimate::DropsLast => vec![i, lo, hi],
        };
        kept.sort_unstable();
        kept.dedup();
        columns[k] = kept;
        i = j;
    }
    Ok(Decimated {
        t,
        v,
        columns,
        window: (t0, t1),
    })
}

fn series_len(p: &Map<String, Value>, path: &str) -> Result<usize, Refused> {
    Ok(p.get("t")
        .and_then(|t| t.get("len"))
        .and_then(Value::as_u64)
        .filter(|n| *n <= MAX_ROWS)
        .ok_or(Refused {
            code: "bad_column",
            path: format!("{path}/t"),
        })? as usize)
}

fn series_numbers(
    p: &Map<String, Value>,
    name: &str,
    n: usize,
    path: &str,
) -> Result<Option<Vec<f64>>, Refused> {
    match p.get(name) {
        None => Ok(None),
        Some(c) => match column_of(c, n, &format!("{path}/{name}"))? {
            Column::Numbers(v) => Ok(Some(v)),
            _ => refuse("bad_column", format!("{path}/{name}")),
        },
    }
}

fn series_box(p: &Map<String, Value>, path: &str) -> Result<[f64; 4], Refused> {
    match p.get("box").and_then(Value::as_array).and_then(|b| {
        let b: Option<Vec<f64>> = b.iter().map(Value::as_f64).collect();
        <[f64; 4]>::try_from(b?.as_slice()).ok()
    }) {
        Some(b) => Ok(b),
        None => refuse("bad_doc", format!("{path}/box")),
    }
}

fn series_window(p: &Map<String, Value>, t: &[f64], path: &str) -> Result<(f64, f64), Refused> {
    let n = t.len();
    Ok(match p.get("window") {
        Some(Value::Array(w)) => match w.as_slice() {
            [a, b] => (a.as_f64().unwrap_or(0.0), b.as_f64().unwrap_or(0.0)),
            _ => return refuse("bad_doc", format!("{path}/window")),
        },
        Some(Value::Object(w)) if n > 0 => {
            let last = w.get("last").and_then(Value::as_u64).unwrap_or(n as u64) as usize;
            (t[n.saturating_sub(last.max(1))], t[n - 1])
        }
        None if n > 0 => (t[0], t[n - 1]),
        _ => (0.0, 0.0),
    })
}

/// A `series@1` item's rows in its window, decimated per 1 px column of its `box` (Series and
/// decimation): OHLC per bucket for candles (open first, high max, low min, close last), M4 for a
/// line (first, min, max and last per column, so never more than 4 vertices a column). The rows'
/// `t` is strictly increasing; rows out of order are refused, naming the column. A line draws each
/// column's kept rows as one vertical run from their min to their max at the column's centre, and
/// one segment from each column's last kept row to the next column's first, each its own subpath:
/// the same shape the polyline through the column's rows covers, without the joins that would
/// make it depend on how many rows a column kept.
pub fn series(
    id: &str,
    item: &Value,
    palette: &Palette,
    pos: [f64; 2],
    how: Decimate,
) -> Result<Vec<Mark>, Refused> {
    let path = format!("items/{id}/params");
    let p = object_or_empty(item.get("params"));
    let candles = p.get("decimate").and_then(Value::as_str) == Some("ohlc")
        || p.get("marks")
            .and_then(Value::as_array)
            .is_some_and(|m| m.iter().any(|m| m == "candle"));
    let [bx, by, bw, bh] = series_box(p, &path)?;
    let x = |b: usize| bx + pos[0] + b as f64;
    if !candles {
        let how = match (how, p.get("decimate").and_then(Value::as_str)) {
            (Decimate::M4, Some("none")) => Decimate::None,
            (how, _) => how,
        };
        let d = decimated(id, item, how)?;
        let (lo, hi) = d
            .rows()
            .iter()
            .fold((f64::INFINITY, f64::NEG_INFINITY), |(lo, hi), &r| {
                (lo.min(d.v[r]), hi.max(d.v[r]))
            });
        let y = |v: f64| {
            by + pos[1] + bh
                - if hi > lo {
                    (v - lo) / (hi - lo) * bh
                } else {
                    bh / 2.0
                }
        };
        let color = role(
            palette,
            p.get("role").and_then(Value::as_str).unwrap_or("ink"),
            &format!("{path}/role"),
        )?;
        let mut d_path = String::new();
        let mut previous: Option<(f64, f64)> = None;
        for (b, rows) in d.columns.iter().enumerate() {
            let (Some(&first), Some(&last)) = (rows.first(), rows.last()) else {
                continue;
            };
            let cx = x(b) + 0.5;
            let (min, max) = rows
                .iter()
                .fold((f64::INFINITY, f64::NEG_INFINITY), |(a, z), &r| {
                    (a.min(d.v[r]), z.max(d.v[r]))
                });
            if let Some((px, py)) = previous {
                d_path.push_str(&format!("M {px} {py} L {cx} {} ", y(d.v[first])));
            }
            d_path.push_str(&format!("M {cx} {} L {cx} {} ", y(max), y(min)));
            previous = Some((cx, y(d.v[last])));
        }
        let d_path = d_path.trim_end().to_string();
        return Ok(vec![Mark::Path {
            item: id.to_string(),
            geometry: Geometry {
                verbs: path::parse(&d_path).unwrap_or_default(),
                stroke: Some(1.0),
                fill: false,
            },
            d: d_path,
            offset: [0.0, 0.0],
            color,
        }]);
    }
    let n = series_len(p, &path)?;
    let t = series_numbers(p, "t", n, &path)?.ok_or(Refused {
        code: "bad_column",
        path: format!("{path}/t"),
    })?;
    if let Some(i) = t.windows(2).position(|w| w[1] <= w[0]) {
        return refuse("out_of_range", format!("{path}/t/{}", i + 1));
    }
    if n == 0 && p.get("window").is_none() {
        return Ok(Vec::new());
    }
    let (t0, t1) = series_window(p, &t, &path)?;
    let cols = bw.floor().max(1.0) as usize;
    let (Some(o), Some(h), Some(l), Some(c)) = (
        series_numbers(p, "o", n, &path)?,
        series_numbers(p, "h", n, &path)?,
        series_numbers(p, "l", n, &path)?,
        series_numbers(p, "c", n, &path)?,
    ) else {
        return refuse("bad_column", format!("{path}/o"));
    };
    // Each column's (open, high, low, close) of the rows in it, in row order.
    let mut buckets: Vec<Option<[f64; 4]>> = vec![None; cols];
    for i in (0..n).filter(|&i| t[i] >= t0 && t[i] <= t1) {
        let f = if t1 > t0 {
            (t[i] - t0) / (t1 - t0)
        } else {
            0.0
        };
        let column = ((f * cols as f64) as usize).min(cols - 1);
        let b = buckets[column].get_or_insert([o[i], h[i], l[i], c[i]]);
        (b[1], b[2], b[3]) = (b[1].max(h[i]), b[2].min(l[i]), c[i]);
    }
    let (lo, hi) = buckets
        .iter()
        .flatten()
        .fold((f64::INFINITY, f64::NEG_INFINITY), |(lo, hi), b| {
            (lo.min(b[2]), hi.max(b[1]))
        });
    let y = |v: f64| {
        by + pos[1] + bh
            - if hi > lo {
                (v - lo) / (hi - lo) * bh
            } else {
                bh / 2.0
            }
    };
    let mut out = Vec::new();
    {
        let candle = p.get("candle");
        let role_of = |k: &str| -> Result<[u8; 3], Refused> {
            let name = candle
                .and_then(|c| c.get(k))
                .and_then(Value::as_str)
                .unwrap_or("ink");
            role(palette, name, &format!("{path}/candle/{k}"))
        };
        let (up, down) = (role_of("up")?, role_of("down")?);
        for (b, bucket) in buckets.iter().enumerate() {
            let Some([o, h, l, c]) = *bucket else {
                continue;
            };
            let color = if c >= o { up } else { down };
            let (top, bottom) = (y(h), y(l));
            out.push(Mark::Rect {
                item: format!("{id}#{b}"),
                bounds: [x(b), top, 1.0, (bottom - top).max(1.0)],
                radius: 0.0,
                fill: Fill::Solid(color),
            });
        }
    }
    Ok(out)
}

/// The numbers in a shown string: each run of digits, with the separators between them.
fn number_runs(text: &str) -> Vec<String> {
    let chars: Vec<char> = text.chars().collect();
    let mut out = Vec::new();
    let mut i = 0;
    while i < chars.len() {
        if !chars[i].is_ascii_digit() {
            i += 1;
            continue;
        }
        let start = i;
        while i < chars.len()
            && (chars[i].is_ascii_digit()
                || (matches!(chars[i], '.' | ',')
                    && chars.get(i + 1).is_some_and(char::is_ascii_digit)))
        {
            i += 1;
        }
        out.push(chars[start..i].iter().collect());
    }
    out
}

/// What a table column's cell traces to: the table, its column and data row, the cell's byte
/// range in the file and its raw bytes as the table keeps them, and the table's source.
fn traced(trace: &Value, row: Option<usize>) -> Value {
    let cell = row.and_then(|r| trace.get("cells").and_then(|c| c.get(r)));
    json!({
        "table": trace.get("table"), "column": trace.get("column"), "row": row,
        "bytes": cell.and_then(|c| c.get("bytes")), "raw": cell.and_then(|c| c.get("raw")),
        "origin": trace.get("source"),
    })
}

/// What a number on an anchor path traces to: the column it reads, and that column's table where
/// it reads one (Honest numbers: a number a transform derives traces to its table).
pub fn anchor_source(path: &str, items: &Map<String, Value>) -> Option<Value> {
    let (set, rest) = path.strip_prefix("items/")?.split_once('#')?;
    let (anchor, field) = rest.split_once('/')?;
    let p = object_or_empty(items.get(set)?.get("params"));
    let column = match anchor {
        "head" => field,
        _ => p
            .get("transforms")?
            .as_array()?
            .iter()
            .find_map(|t| t.get("periods")?.get("by")?.as_str())?,
    };
    let trace = p.get("columns")?.get(column)?.get("trace");
    Some(trace.map_or_else(|| json!({"column": column}), |t| traced(t, None)))
}

/// Every number a mark set's text rows or an axis's tick labels show, each with what it traces
/// to (Honest numbers, the check): `{item, row, text, source}`, `row` the mark set's row key.
pub fn numbers(id: &str, item: &Value, items: &Map<String, Value>) -> Vec<Value> {
    let p = object_or_empty(item.get("params"));
    let mut out = Vec::new();
    match item.get("kind").and_then(Value::as_str) {
        Some("marks@1") if p.get("mark").and_then(Value::as_str) == Some("text") => {
            // A set that reads another's rows shows, and traces to, that set's cells.
            let own = story::rows_of(item).and_then(|of| items.get(of));
            let rows = own.map_or(p, |set| object_or_empty(set.get("params")));
            let n = rows.get("n").and_then(Value::as_u64).unwrap_or(0) as usize;
            let columns = object_or_empty(rows.get("columns"));
            let read = |name: &str| {
                columns
                    .get(name)
                    .and_then(|c| column_of(c, n, "").ok().map(|col| (col, c.get("trace"))))
            };
            let (text_column, text) = match p.get("encode").and_then(|e| e.get("text")) {
                Some(Value::Object(e)) => {
                    let name = e.get("column").and_then(Value::as_str).unwrap_or("text");
                    (name.to_string(), read(name))
                }
                Some(v) => (String::new(), Some((Column::Const(v.clone()), None))),
                None => ("text".to_string(), read("text")),
            };
            let Some((text, trace)) = text else {
                return out;
            };
            let keys = rows.get("key").and_then(Value::as_str).and_then(read);
            let hidden: Vec<usize> = columns
                .values()
                .filter_map(|c| c.get("hide").and_then(Value::as_array))
                .flatten()
                .filter_map(Value::as_u64)
                .map(|r| r as usize)
                .collect();
            for i in (0..n).filter(|i| !hidden.contains(i)) {
                let key = keys
                    .as_ref()
                    .and_then(|(k, _)| k.text(i))
                    .unwrap_or_else(|| i.to_string());
                let source = match (trace, &text) {
                    (Some(t), _) => traced(t, Some(i)),
                    (None, Column::Const(_)) => json!({"constant": text_column}),
                    (None, _) => json!({"column": text_column}),
                };
                for run in number_runs(&text.text(i).unwrap_or_default()) {
                    out.push(json!({"item": id, "row": key, "text": run, "source": source}));
                }
            }
        }
        Some("axis@1") => {
            let Some(scale_id) = p.get("scale").and_then(Value::as_str) else {
                return out;
            };
            let Ok(scale) = scale_named(items, scale_id, "") else {
                return out;
            };
            let source = match &scale.from {
                Some((_, trace)) => traced(trace, None),
                None => json!({"scale": scale_id}),
            };
            for (_, label) in scale.ticks() {
                for run in number_runs(&label) {
                    out.push(json!({"item": id, "row": null, "text": run, "source": source}));
                }
            }
            let title = p.get("title").and_then(Value::as_str).unwrap_or("");
            for run in number_runs(title) {
                out.push(
                    json!({"item": id, "row": null, "text": run, "source": {"constant": "title"}}),
                );
            }
        }
        _ => {}
    }
    out
}

/// The width a label's box takes so its text centers on its tick.
const LABEL_BOX: f64 = 96.0;
/// A label's size and the tick's length and gap, in u.
const LABEL_SIZE: f64 = 11.0;
const TICK: f64 = 4.0;

/// Which way an axis through the other scale's zero runs, and where that zero falls, clamped to
/// the pane: the other scale is the one a mark set encodes across this one.
fn cross_zero(id: &str, items: &Map<String, Value>, path: &str) -> Result<(bool, f64), Refused> {
    for item in items.values() {
        let encode = object_or_empty(item.get("params").and_then(|p| p.get("encode")));
        let scale = |prop: &str| encode.get(prop)?.get("scale")?.as_str();
        let (horizontal, other) = if scale("x") == Some(id) {
            (true, scale("y"))
        } else if scale("y") == Some(id) {
            (false, scale("x"))
        } else {
            continue;
        };
        if let Some(other) = other {
            let other = scale_named(items, other, path)?;
            let [a, b] = other.range;
            return Ok((horizontal, other.map(0.0).clamp(a.min(b), a.max(b))));
        }
    }
    refuse("bad_axis", path)
}

/// One axis, generated from its scale: the line along the scale's range, a tick per step and its
/// label; labels that would crowd thin by parity, keeping the first and the last. With `grid`, a
/// grid line per tick under them, from the line across the plot to the frame's far edge
/// (`frame`, the document's size in u).
pub fn axis(
    id: &str,
    item: &Value,
    (items, channels): (&Map<String, Value>, Option<&Value>),
    palette: &Palette,
    pos: [f64; 2],
    frame: [f64; 2],
) -> Result<Drawing, Refused> {
    let path = format!("items/{id}/params");
    let p = object_or_empty(item.get("params"));
    let Some(scale_id) = p.get("scale").and_then(Value::as_str) else {
        return refuse("bad_axis", format!("{path}/scale"));
    };
    let scale = keyed_named(items, channels, scale_id, &format!("{path}/scale"))?;
    let side = p.get("side").and_then(Value::as_str).unwrap_or("bottom");
    let through_zero = match side {
        "zero" => Some(cross_zero(scale_id, items, &format!("{path}/side"))?),
        _ => None,
    };
    let horizontal = match (side, through_zero) {
        (_, Some((horizontal, _))) => horizontal,
        ("bottom" | "top", _) => true,
        ("left" | "right", _) => false,
        _ => return refuse("bad_axis", format!("{path}/side")),
    };
    let cross = p.get("at").and_then(Value::as_f64).unwrap_or(0.0)
        + through_zero.map_or(0.0, |(_, cross)| cross);
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
    let out_dir = if matches!(side, "bottom" | "right" | "zero") {
        1.0
    } else {
        -1.0
    };
    let mut faded = scale.faded_ticks();
    faded.retain(|t| t.2 > 0.0);
    let mut marks = Vec::new();
    let mut fades = std::collections::BTreeMap::new();
    // Grid lines first, under the line, the ticks and the labels: each from the line to the
    // frame's edge on the side away from the labels.
    if p.get("grid").and_then(Value::as_bool) == Some(true) {
        let at = if horizontal {
            cross + pos[1]
        } else {
            cross + pos[0]
        };
        let far = if out_dir > 0.0 {
            0.0
        } else if horizontal {
            frame[1]
        } else {
            frame[0]
        };
        for (k, (v, _, alpha)) in faded.iter().enumerate() {
            let along = scale.map(*v);
            if *alpha < 1.0 {
                fades.insert(format!("{id}#grid{k}"), *alpha);
            }
            marks.push(rule(
                format!("{id}#grid{k}"),
                point(along, 0.0),
                point(along, far - at),
                1.0,
                color,
            ));
        }
    }
    marks.push(rule(
        format!("{id}#line"),
        point(scale.range[0], 0.0),
        point(scale.range[1], 0.0),
        1.0,
        color,
    ));
    let ticks: Vec<(f64, String)> = faded.iter().map(|(v, l, _)| (*v, l.clone())).collect();
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
        // A tick enters and leaves by opacity, under its value as it enters and leaves the domain.
        let alpha = faded[k].2;
        if alpha < 1.0 {
            fades.insert(format!("{id}#tick{k}"), alpha);
            fades.insert(format!("{id}#label{k}"), alpha);
        }
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
                family: Some(deep_text::Role::Body.family()),
                fallback: Vec::new(),
                lang: None,
                size: LABEL_SIZE,
                weight: 400,
                width: Some(LABEL_BOX),
                max_lines: None,
                mask: false,
                align,
                bound: false,
                spans: Vec::new(),
            },
            origin,
            role: None,
            color,
            runs: Vec::new(),
        });
    }
    // The title past the line's far end, the top of an upright axis and the right of a flat one,
    // on the labels' side.
    if let Some(title) = p.get("title").and_then(Value::as_str) {
        let width = LABEL_BOX.max(est(title));
        let line = LABEL_SIZE * 1.3;
        let (origin, align) = if horizontal {
            let end = scale.range[0].max(scale.range[1]);
            let y = if out_dir > 0.0 {
                TICK + 2.0 + line + 2.0
            } else {
                -(TICK + 2.0 + 2.0 * line + 2.0)
            };
            (point(end - width, y), Align::End)
        } else {
            let top = scale.range[0].min(scale.range[1]) - LABEL_SIZE * 0.65 - line - 2.0;
            if out_dir > 0.0 {
                (point(top, TICK + 2.0), Align::Start)
            } else {
                (point(top, -(TICK + 2.0 + width)), Align::End)
            }
        };
        marks.push(Mark::Text {
            item: format!("{id}#title"),
            spec: TextSpec {
                text: title.to_string(),
                font: "body".into(),
                family: Some(deep_text::Role::Body.family()),
                fallback: Vec::new(),
                lang: None,
                size: LABEL_SIZE,
                weight: 600,
                width: Some(width),
                max_lines: None,
                mask: false,
                align,
                bound: false,
                spans: Vec::new(),
            },
            origin,
            role: None,
            color,
            runs: Vec::new(),
        });
    }
    Ok(Drawing { marks, fades })
}

/// A legend row's swatch length, and the gaps after a swatch and after an entry, in u.
const SWATCH: f64 = 16.0;
const GAP: f64 = 6.0;
const ENTRY_GAP: f64 = 16.0;

/// The automatic legend of an ordinal scale whose roles color mark sets (Scale and encode: legends
/// are automatic): one row across the top left, an entry per category a set draws, in the
/// domain's order, each the set's mark in the category's role (a line, dashed as the set is, or
/// a square) and the category's name in ink. No legend for a scale no set colors by.
pub fn legend(
    id: &str,
    item: &Value,
    items: &Map<String, Value>,
    palette: &Palette,
    pos: [f64; 2],
) -> Result<Vec<Mark>, Refused> {
    let ordinal = item.get("params").and_then(|p| p.get("type")) == Some(&json!("ordinal"));
    if !ordinal {
        return Ok(Vec::new());
    }
    // Each category a set draws, with the first such set's params.
    let mut drawn: Vec<(String, &Map<String, Value>)> = Vec::new();
    for (set_id, set) in items {
        if set.get("kind").and_then(Value::as_str) != Some("marks@1") {
            continue;
        }
        let p = object_or_empty(set.get("params"));
        let role = p.get("encode").and_then(|e| e.get("role"));
        if role.and_then(|r| r.get("scale")).and_then(Value::as_str) != Some(id) {
            continue;
        }
        let n = p.get("n").and_then(Value::as_u64).unwrap_or(0) as usize;
        let Some(c) = role
            .and_then(|r| r.get("column"))
            .and_then(Value::as_str)
            .and_then(|name| p.get("columns")?.get(name))
        else {
            continue;
        };
        let Ok(column) = column_of(c, n, &format!("items/{set_id}/params/columns")) else {
            continue;
        };
        for i in 0..n.max(1) {
            if let Some(category) = column.text(i) {
                if !drawn.iter().any(|(c, _)| *c == category) {
                    drawn.push((category, p));
                }
            }
            if matches!(column, Column::Const(_)) {
                break;
            }
        }
    }
    if drawn.is_empty() {
        return Ok(Vec::new());
    }
    let scale = Scale::read(id, item, items)?;
    let path = format!("items/{id}/params/range");
    let ink = role(palette, "ink", &path)?;
    let line = LABEL_SIZE * 1.3;
    let mid = 16.0 + line / 2.0 + pos[1];
    let mut x = 16.0 + pos[0];
    let mut marks = Vec::new();
    for (k, category) in scale.categories.iter().enumerate() {
        let Some((_, set)) = drawn.iter().find(|(c, _)| c == category) else {
            continue;
        };
        let Some(name) = scale.role(None, Some(category)) else {
            continue;
        };
        let color = role(palette, name, &path)?;
        let stroke = set.get("paint").and_then(|pt| pt.get("stroke"));
        if set.get("mark").and_then(Value::as_str) == Some("path") {
            let ends = [[x, mid], [x + SWATCH, mid]];
            let dash = stroke
                .and_then(|s| s.get("dash"))
                .and_then(Value::as_array)
                .map(|d| d.iter().filter_map(Value::as_f64).collect::<Vec<_>>())
                .filter(|d| d.iter().sum::<f64>() > 0.0 && d.iter().all(|v| *v >= 0.0));
            let d = match dash {
                Some(dash) => dashed(&ends, &dash),
                None => format!("M {} {mid} L {} {mid}", ends[0][0], ends[1][0]),
            };
            let width = stroke
                .and_then(|s| s.get("width"))
                .and_then(Value::as_f64)
                .unwrap_or(1.0);
            marks.push(Mark::Path {
                item: format!("{id}#swatch{k}"),
                geometry: Geometry {
                    verbs: path::parse(&d).unwrap_or_default(),
                    stroke: Some(width),
                    fill: false,
                },
                d,
                offset: [0.0, 0.0],
                color,
            });
        } else {
            marks.push(Mark::Rect {
                item: format!("{id}#swatch{k}"),
                bounds: [x + 2.0, mid - 6.0, 12.0, 12.0],
                radius: 0.0,
                fill: Fill::Solid(color),
            });
        }
        x += SWATCH + GAP;
        let width = 0.6 * LABEL_SIZE * category.chars().count() as f64 + 4.0;
        marks.push(Mark::Text {
            item: format!("{id}#legend{k}"),
            spec: TextSpec {
                text: category.clone(),
                font: "body".into(),
                family: Some(deep_text::Role::Body.family()),
                fallback: Vec::new(),
                lang: None,
                size: LABEL_SIZE,
                weight: 400,
                width: None,
                max_lines: None,
                mask: false,
                align: Align::Start,
                bound: false,
                spans: Vec::new(),
            },
            origin: [x, mid - line / 2.0],
            role: None,
            color: ink,
            runs: Vec::new(),
        });
        x += width + ENTRY_GAP;
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
            &Map::new(),
        )
        .unwrap();
        assert_eq!(s.step, 20.0);
        assert_eq!(s.domain, [0.0, 100.0]);
        assert_eq!(s.map(50.0), 100.0);
        let labels: Vec<String> = s.ticks().into_iter().map(|t| t.1).collect();
        assert_eq!(labels, ["0", "20", "40", "60", "80", "100"]);
    }

    #[test]
    fn a_symlog_scale_passes_through_zero_and_a_log_scale_ticks_on_decades() {
        let scale = |p: Value| scale_of("s", &json!({"params": p})).unwrap();
        let sym = scale(json!({"type": "symlog", "domain": [-100, 100], "range": [0, 100]}));
        assert_eq!(sym.map(0.0), 50.0);
        assert!(sym.map(1.0) > 50.0 && sym.map(10.0) - sym.map(1.0) < sym.map(1.0));
        let ticks: Vec<f64> = sym.ticks().iter().map(|t| t.0).collect();
        assert_eq!(ticks, [-100.0, -10.0, -1.0, 0.0, 1.0, 10.0, 100.0]);
        let log = scale(json!({"type": "log", "domain": [2, 300], "range": [0, 300]}));
        assert_eq!(log.domain, [1.0, 1000.0]);
        assert!((log.map(10.0) - 100.0).abs() < 1e-9);
    }

    #[test]
    fn an_axis_through_zero_crosses_at_the_other_scales_zero_clamped_to_the_pane() {
        let items = |domain: Value| {
            json!({
                "xs": {"kind": "scale@1", "params": {"domain": [0, 10], "range": [0, 100], "nice": false}},
                "ys": {"kind": "scale@1", "params": {"domain": domain, "range": [100, 0], "nice": false}},
                "dots": {"kind": "marks@1", "params": {"encode": {
                    "x": {"column": "x", "scale": "xs"}, "y": {"column": "y", "scale": "ys"}}}},
            })
        };
        let line_y = |domain: Value| {
            let all = items(domain);
            let axis = json!({"params": {"scale": "xs", "side": "zero", "role": "ink"}});
            let palette = Palette::from([("ink".to_string(), [0, 0, 0])]);
            let drawn = super::axis(
                "a",
                &axis,
                (all.as_object().unwrap(), None),
                &palette,
                [0.0, 0.0],
                [640.0, 480.0],
            );
            match drawn.unwrap().marks[0] {
                Mark::Rect { bounds, .. } => bounds[1] + bounds[3] / 2.0,
                _ => panic!("an axis line along x is a rect"),
            }
        };
        assert_eq!(line_y(json!([-10, 10])), 50.0);
        assert_eq!(line_y(json!([5, 10])), 100.0);
    }

    #[test]
    fn a_time_scale_ticks_on_calendar_units_in_utc() {
        // 2026-10-21 14:00 to 14:20 UTC.
        let start = 1_792_591_200_000.0;
        let s = Scale::read("t", &json!({"params": {"type": "time", "domain": [start, start + 1_200_000.0], "range": [0, 400]}}), &Map::new()).unwrap();
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
        let marks = mark_set("dots", &set, items, &palette, [0.0, 0.0], &BoundRows::new())
            .unwrap()
            .marks;
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
                .marks
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
            (items, None),
            &palette,
            [0.0, 0.0],
            [640.0, 480.0],
        )
        .unwrap()
        .marks;
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
            (items.as_object().unwrap(), None),
            &palette,
            [0.0, 0.0],
            [640.0, 480.0],
        )
        .unwrap()
        .marks;
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

    #[test]
    fn an_axis_draws_its_title_past_the_far_end_of_its_line() {
        let items =
            json!({"y": {"kind": "scale@1", "params": {"domain": [0, 50], "range": [300, 40]}}});
        let palette: Palette = [("muted".to_string(), [9, 9, 9])].into();
        let marks = axis(
            "ax",
            &json!({"params": {"scale": "y", "side": "left", "at": 48, "title": "Sales"}}),
            (items.as_object().unwrap(), None),
            &palette,
            [0.0, 0.0],
            [640.0, 480.0],
        )
        .unwrap()
        .marks;
        let title = marks.iter().find_map(|m| match m {
            Mark::Text { spec, origin, .. } if spec.text == "Sales" => Some(*origin),
            _ => None,
        });
        let Some([_, y]) = title else {
            panic!(
                "the axis draws its title: {:?}",
                marks.iter().map(Mark::item).collect::<Vec<_>>()
            );
        };
        // Above the top tick's label, which centers on the line's top end at 40.
        assert!(
            y + LABEL_SIZE * 1.3 <= 40.0 - LABEL_SIZE * 0.65,
            "title at y {y}"
        );
    }

    #[test]
    fn a_scale_from_categories_to_roles_draws_its_legend_with_each_series_line() {
        let series = |id: &str, category: &str, dash: Option<[f64; 2]>| {
            let mut stroke = json!({"width": 3});
            if let Some(d) = dash {
                stroke["dash"] = json!(d);
            }
            // x [40, 520] and y [200, 120] as little-endian f32.
            json!({"id": id, "kind": "marks@1", "layer": "main", "order": "a1",
                "params": {"mark": "path", "n": 2,
                    "columns": {"x": {"dtype": "f32", "len": 2, "data": "AAAgQgAAAkQ="},
                                "y": {"dtype": "f32", "len": 2, "data": "AABIQwAA8EI="},
                                "series": {"const": category}},
                    "encode": {"x": {"column": "x"}, "y": {"column": "y"},
                               "role": {"column": "series", "scale": "colors"}},
                    "paint": {"stroke": stroke}}})
        };
        let doc = json!({"format": 1, "size": [600, 320], "layers": {"main": {"writer": "a", "order": "a0"}},
        "items": {
            "colors": {"id": "colors", "kind": "scale@1", "layer": "main", "order": "a0",
                "params": {"type": "ordinal", "domain": ["north", "south"], "range": ["blue", "orange"]}},
            "north": series("north", "north", None),
            "south": series("south", "south", Some([6.0, 4.0])),
        }});
        let doc = doc.as_object().unwrap();
        let palette: Palette = [
            ("ground".to_string(), [255, 255, 255]),
            ("ink".to_string(), [1, 1, 1]),
            ("blue".to_string(), [0, 0, 200]),
            ("orange".to_string(), [250, 120, 0]),
        ]
        .into();
        let frame = crate::scene::frame(
            doc,
            object_or_empty(doc.get("items")),
            &palette,
            &crate::scene::Record::default(),
            1.0,
        )
        .unwrap();
        let marks: Vec<Mark> = frame
            .layers
            .iter()
            .flat_map(|l| l.marks.iter().map(|d| d.mark.clone()))
            .collect();
        let legend: Vec<&Mark> = marks
            .iter()
            .filter(|m| m.item().starts_with("colors#"))
            .collect();
        // Each category's name in ink, and its swatch: the series' line in its role, dashed as the
        // series is.
        for (category, color, dashed) in [
            ("north", [0, 0, 200], false),
            ("south", [250, 120, 0], true),
        ] {
            assert!(
                legend.iter().any(|m| matches!(m, Mark::Text { spec, color: [1, 1, 1], .. } if spec.text == category)),
                "the legend names {category}: {legend:?}"
            );
            let swatch = legend.iter().find_map(|m| match m {
                Mark::Path { d, color: c, .. } if *c == color => Some(d.matches('M').count()),
                _ => None,
            });
            assert_eq!(
                swatch.map(|subpaths| subpaths > 1),
                Some(dashed),
                "{category}'s swatch is its line, dashed as it is: {legend:?}"
            );
        }
    }

    #[test]
    fn an_empty_series_with_a_last_window_keeps_no_rows() {
        let empty = |dtype: &str| json!({"dtype": dtype, "len": 0, "data": ""});
        let series = json!({"params": {"t": empty("i64"), "v": empty("f32"),
            "window": {"last": 5}, "box": [0, 0, 3, 60]}});
        let d = decimated("s", &series, Decimate::M4).unwrap();
        assert_eq!(d.rows(), Vec::<usize>::new());
        assert_eq!(d.window, (0.0, 0.0));
    }

    #[test]
    fn a_log_scale_whose_domain_reaches_zero_is_refused() {
        for domain in [[0, 100], [-5, 100]] {
            let scale = json!({"params": {"type": "log", "domain": domain, "range": [0, 300]}});
            let r = scale_of("s", &scale).expect_err("a log scale holds no value at or below 0");
            assert_eq!(
                (r.code, r.path.as_str()),
                ("out_of_range", "items/s/params/domain")
            );
        }
    }

    /// A log scale `ys` and a bar set of two years through it, whose bars start at zero.
    fn bars_on_a_log_scale(domain: Value, n: usize) -> Value {
        let i32s = |v: &[i32]| {
            let bytes: Vec<u8> = v.iter().flat_map(|x| x.to_le_bytes()).collect();
            json!({"dtype": "i32", "len": v.len(), "data": deep_canvas::base64::encode(&bytes)})
        };
        let mut ys = json!({"kind": "scale@1", "params": {"type": "log", "range": [180, 20]}});
        if !domain.is_null() {
            ys["params"]["domain"] = domain;
        }
        json!({
            "ys": ys,
            "bars": {"kind": "marks@1", "params": {
                "mark": "bar", "n": n, "key": "key",
                "columns": {"year": i32s(&[2000, 2001][..n]),
                            "key": {"dtype": "str", "len": n, "data": vec!["a"; n]},
                            "value": i32s(&[10, 40][..n])},
                "transforms": [{"periods": {"by": "year", "at": 2000}}],
                "encode": {"x": 0, "y": {"column": "value", "scale": "ys"}}}},
        })
    }

    #[test]
    fn a_log_scale_a_bar_widens_to_zero_is_refused() {
        for domain in [Value::Null, json!("periods")] {
            let items = bars_on_a_log_scale(domain.clone(), 2);
            let items = items.as_object().unwrap();
            let r = Scale::read("ys", &items["ys"], items).expect_err("a bar starts at zero");
            let found = (r.code, r.path.as_str());
            assert_eq!(
                found,
                ("out_of_range", "items/ys/params/domain"),
                "{domain}"
            );
        }
    }

    #[test]
    fn a_scale_that_follows_the_periods_of_a_set_with_no_rows_is_refused() {
        let items = bars_on_a_log_scale(json!("periods"), 0);
        let items = items.as_object().unwrap();
        let r = Scale::read("ys", &items["ys"], items).expect_err("no period gives a domain");
        assert_eq!(
            (r.code, r.path.as_str()),
            ("bad_scale", "items/ys/params/domain")
        );
    }
}

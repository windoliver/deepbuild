//! Issue #496: a text animator's selectors (canvas primitives: Text animator and counter:
//! selectors and properties). The range's shapes follow Lottie's range selector
//! (lottie-web `player/js/utils/text/TextSelectorProperty.js`, `getMult`, MIT), so an imported
//! Lottie title selects the same units; a noise selector is lattice noise of (unit, t, seed), so
//! seeking equals playing; selectors combine top to bottom by their modes. [`lay_out`] turns a
//! text's shaped run into the glyphs a frame draws: each animator's props applied per unit, the
//! run set along a path (`on_curve`), and a counter's changed graphemes rolling in their cells.

use std::sync::Arc;

use deep_canvas::document::duration;
use deep_canvas::expr::{Expr, Resolve};
use deep_text::{Glyph, Shaped};
use serde_json::{Map, Value};

use crate::scene::Refused;

/// A range's shape (`shape: square | ramp | ramp_down | triangle | round | smooth`).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Shape {
    Square,
    Ramp,
    RampDown,
    Triangle,
    Round,
    Smooth,
}

impl Shape {
    pub fn parse(s: &str) -> Option<Shape> {
        Some(match s {
            "square" => Shape::Square,
            "ramp" => Shape::Ramp,
            "ramp_down" => Shape::RampDown,
            "triangle" => Shape::Triangle,
            "round" => Shape::Round,
            "smooth" => Shape::Smooth,
            _ => return None,
        })
    }
}

/// How a selector combines with what the selectors above it chose
/// (`mode: add | subtract | multiply | min | max | difference`).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Mode {
    Add,
    Subtract,
    Multiply,
    Min,
    Max,
    Difference,
}

impl Mode {
    pub fn parse(s: &str) -> Option<Mode> {
        Some(match s {
            "add" => Mode::Add,
            "subtract" => Mode::Subtract,
            "multiply" => Mode::Multiply,
            "min" => Mode::Min,
            "max" => Mode::Max,
            "difference" => Mode::Difference,
            _ => return None,
        })
    }

    /// `below` combined with this selector's `amount`. The first selector combines with 0 under
    /// add, as After Effects' first selector does.
    pub fn combine(self, below: f64, amount: f64) -> f64 {
        match self {
            Mode::Add => below + amount,
            Mode::Subtract => below - amount,
            Mode::Multiply => below * amount,
            Mode::Min => below.min(amount),
            Mode::Max => below.max(amount),
            Mode::Difference => (below - amount).abs(),
        }
    }
}

/// The range's ease (`ease: {high, low: −1..1 = 0}`) as Lottie's cubic Bézier: low is its
/// "min ease", high its "max ease".
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct Ease {
    pub high: f64,
    pub low: f64,
}

impl Ease {
    /// The eased value of `x` in 0..1.
    pub fn apply(self, x: f64) -> f64 {
        let (mut x1, mut y1, mut x2, mut y2) = (0.0, 0.0, 1.0, 1.0);
        if self.low > 0.0 {
            x1 = self.low;
        } else {
            y1 = -self.low;
        }
        if self.high > 0.0 {
            x2 = 1.0 - self.high;
        } else {
            y2 = 1.0 + self.high;
        }
        if x1 == y1 && x2 == y2 {
            return x;
        }
        if x == 0.0 || x == 1.0 {
            return x;
        }
        cubic(t_for_x(x, x1, x2), y1, y2)
    }
}

fn cubic(t: f64, a1: f64, a2: f64) -> f64 {
    ((1.0 - 3.0 * a2 + 3.0 * a1) * t + (3.0 * a2 - 6.0 * a1)) * t * t + 3.0 * a1 * t
}

fn slope(t: f64, a1: f64, a2: f64) -> f64 {
    3.0 * (1.0 - 3.0 * a2 + 3.0 * a1) * t * t + 2.0 * (3.0 * a2 - 6.0 * a1) * t + 3.0 * a1
}

/// The Bézier's parameter whose x is `x`, solved to the f64's precision: Newton's steps from the
/// linear guess while the slope holds, bisection otherwise (x is monotone in t for x1, x2 in 0..1).
fn t_for_x(x: f64, x1: f64, x2: f64) -> f64 {
    let (mut lo, mut hi) = (0.0f64, 1.0f64);
    let mut t = x;
    for _ in 0..64 {
        let d = cubic(t, x1, x2) - x;
        if d.abs() < 1e-15 {
            return t;
        }
        if d > 0.0 {
            hi = t;
        } else {
            lo = t;
        }
        let s = slope(t, x1, x2);
        let next = if s.abs() > 1e-9 { t - d / s } else { f64::NAN };
        t = if next > lo && next < hi {
            next
        } else {
            0.5 * (lo + hi)
        };
    }
    t
}

/// A range selector's amount for unit `ind` (0-based) with its start `s` and end `e` in units,
/// before strength: Lottie's `getMult` for each shape, eased.
pub fn range_amount(shape: Shape, s: f64, e: f64, ind: f64, ease: Ease) -> f64 {
    let (s, e) = if s > e { (e, s) } else { (s, e) };
    let ramp = || (0.5 / (e - s) + (ind - s) / (e - s)).clamp(0.0, 1.0);
    let mult = match shape {
        Shape::Ramp => {
            if e == s {
                f64::from(u8::from(ind >= e))
            } else {
                ramp()
            }
        }
        Shape::RampDown => {
            if e == s {
                f64::from(u8::from(ind < e))
            } else {
                1.0 - ramp()
            }
        }
        Shape::Triangle => {
            if e == s {
                0.0
            } else {
                let m = ramp();
                if m < 0.5 {
                    m * 2.0
                } else {
                    1.0 - 2.0 * (m - 0.5)
                }
            }
        }
        Shape::Round => {
            if e == s {
                0.0
            } else {
                let tot = e - s;
                let i = (ind + 0.5 - s).max(0.0).min(tot);
                let (x, a) = (-tot / 2.0 + i, tot / 2.0);
                (1.0 - (x * x) / (a * a)).sqrt()
            }
        }
        Shape::Smooth => {
            if e == s {
                0.0
            } else {
                let i = (ind + 0.5 - s).max(0.0).min(e - s);
                (1.0 + (std::f64::consts::PI + std::f64::consts::TAU * i / (e - s)).cos()) / 2.0
            }
        }
        Shape::Square => {
            if ind >= s.floor() {
                if ind - s < 0.0 {
                    (e.min(1.0) - (s - ind)).clamp(0.0, 1.0)
                } else {
                    (e - ind).clamp(0.0, 1.0)
                }
            } else {
                0.0
            }
        }
    };
    ease.apply(mult)
}

/// A noise selector (`noise {min, max, frequency, correlation, phase, spatial_phase, lock, seed}`).
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Noise {
    pub min: f64,
    pub max: f64,
    pub frequency: f64,
    pub correlation: f64,
    /// Temporal phase, in cycles.
    pub phase: f64,
    /// Spatial phase, in degrees of one unit's cycle.
    pub spatial_phase: f64,
    pub lock: bool,
    pub seed: u64,
}

impl Default for Noise {
    fn default() -> Self {
        Noise {
            min: -1.0,
            max: 1.0,
            frequency: 2.0,
            correlation: 0.5,
            phase: 0.0,
            spatial_phase: 0.0,
            lock: false,
            seed: 0,
        }
    }
}

/// A lattice value in −1..1 from a hash of (seed, channel, unit, step): no state, no clock.
fn lattice(seed: u64, unit: i64, step: i64) -> f64 {
    let mut h = seed ^ 0x9E37_79B9_7F4A_7C15;
    for v in [unit as u64, step as u64] {
        h ^= v.wrapping_mul(0xBF58_476D_1CE4_E5B9);
        h = (h ^ (h >> 30)).wrapping_mul(0xBF58_476D_1CE4_E5B9);
        h = (h ^ (h >> 27)).wrapping_mul(0x94D0_49BB_1331_11EB);
        h ^= h >> 31;
    }
    (h >> 11) as f64 / (1u64 << 52) as f64 - 1.0
}

/// Smooth value noise along time for one lattice row: cosine-free smoothstep between steps.
fn row(seed: u64, unit: i64, x: f64) -> f64 {
    let k = x.floor();
    let f = x - k;
    let w = f * f * (3.0 - 2.0 * f);
    let k = k as i64;
    lattice(seed, unit, k) * (1.0 - w) + lattice(seed, unit, k + 1) * w
}

impl Noise {
    /// The amount for unit `i` at `t` seconds: a value shared by every unit, mixed by correlation
    /// with each unit's own, mapped from −1..1 onto min..max. Pure in (i, t, seed).
    pub fn amount(&self, i: usize, t: f64) -> f64 {
        let x = t * self.frequency + self.phase + self.spatial_phase / 360.0 * i as f64;
        let shared = row(self.seed, -1, x);
        let own = row(self.seed, i as i64, x);
        let c = self.correlation.clamp(0.0, 1.0);
        let v = (c * shared + (1.0 - c) * own).clamp(-1.0, 1.0);
        let v = if self.lock { shared } else { v };
        self.min + (v + 1.0) / 2.0 * (self.max - self.min)
    }
}

/// The wrong programs #496's acceptance suite plants, each a `raster` `planted` name.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum Plant {
    #[default]
    None,
    /// The triangle shape peaks at the range's start instead of its middle.
    TrianglePeaksAtStart,
    /// Each grapheme's left edge, not its advance midpoint, sits on its arc-length point.
    OnCurveLeftEdge,
    /// On a change of a counter's string every grapheme rolls, the unchanged ones included.
    RollMovesEveryGrapheme,
}

/// One glyph a frame draws: the shaped glyph (its id swapped by a glyph shift, its pen and
/// advance as shaped), the transform from its own frame (pen on the baseline, y down) to the
/// document, the cell it is clipped to while it rolls, and its opacity.
#[derive(Clone, Debug)]
pub struct Placed {
    pub glyph: Glyph,
    pub transform: [f64; 6],
    pub clip: Option<[f64; 4]>,
    pub opacity: f64,
    pub paint: Paint,
}

/// How a glyph's paint moves from its run's: toward a role in OKLab, then hue, saturation and
/// brightness as `adjust` defines them; a stroke in a role; a blur.
#[derive(Clone, Debug, PartialEq)]
pub struct Paint {
    /// A role and how far toward it, 0..1.
    pub color: Option<(String, f64)>,
    pub hue: f64,
    pub saturation: f64,
    pub brightness: f64,
    /// A role and the stroke's width, px.
    pub stroke: Option<(String, f64)>,
    pub blur: f64,
}

impl Default for Paint {
    fn default() -> Self {
        Paint {
            color: None,
            hue: 0.0,
            saturation: 1.0,
            brightness: 1.0,
            stroke: None,
            blur: 0.0,
        }
    }
}

/// A text's glyphs at one frame, and each animator's amount per unit.
#[derive(Clone, Debug, Default)]
pub struct Laid {
    pub glyphs: Vec<Placed>,
    pub coverage: Vec<Vec<f64>>,
    /// #1646: a reveal's units' reveal times (flicks), and each unit's afterglow at t under a CRT.
    pub reveal: Vec<i64>,
    pub afterglow: Vec<f64>,
}

/// What laying out a text reads besides its run.
pub struct Input<'a> {
    pub id: &'a str,
    /// The item's evaluated params at t.
    pub params: &'a Map<String, Value>,
    pub run: &'a Shaped,
    /// The run's origin in the document (its box's top left, as drawing places it).
    pub origin: [f64; 2],
    /// The frame's time, flicks.
    pub t: i64,
    pub doc: &'a Map<String, Value>,
    /// The frame's evaluated items, where a curve's path is read.
    pub items: &'a Map<String, Value>,
    /// A counter, a bound value or a template: a number, whose glyphs never shift.
    pub bound: bool,
    pub plant: Plant,
    /// #1646: each reveal unit's reveal time (flicks), compiled from the progress channel by the
    /// caller ([`reveal_levels`] gives the progress each one is at), and the look's CRT afterglow,
    /// the phosphor's decay time in flicks.
    pub reveal_times: &'a [i64],
    pub afterglow: Option<i64>,
}

/// #1646: a text's `reveal: {mode: fade, order: reading, progress}` (Text text@1). Units are
/// graphemes and overlap by `lag = min(4 ÷ n, 0.2)`: unit u of n reveals over the progress from
/// u·lag·w to that plus w, w = 1 ÷ (1 + (n − 1)·lag), so the last ends at 1.
fn reveal_of(params: &Map<String, Value>, id: &str) -> Result<Option<f64>, Refused> {
    let Some(r) = params.get("reveal").filter(|r| !r.is_null()) else {
        return Ok(None);
    };
    let path = format!("items/{id}/params/reveal");
    let Value::Object(r) = r else {
        return Err(bad(path));
    };
    for (field, built) in [("mode", "fade"), ("order", "reading")] {
        match r.get(field).and_then(Value::as_str) {
            None => {}
            Some(v) if v == built => {}
            Some(_) => {
                return Err(Refused {
                    code: "unsupported",
                    path: format!("{path}/{field}"),
                })
            }
        }
    }
    if r.get("emits") == Some(&Value::Bool(true)) {
        return Err(Refused {
            code: "unsupported",
            path: format!("{path}/emits"),
        });
    }
    Ok(Some(num(r.get("progress")).unwrap_or(0.0).clamp(0.0, 1.0)))
}

fn reveal_span(n: usize) -> (f64, f64) {
    let lag = (4.0 / n.max(1) as f64).min(0.2);
    (lag, 1.0 / (1.0 + (n.max(1) - 1) as f64 * lag))
}

/// #1646: the progress at which each of a revealed text's units passes half its reveal, which is
/// its reveal time; `None` when the text has no reveal.
pub fn reveal_levels(
    params: &Map<String, Value>,
    run: &Shaped,
    id: &str,
) -> Result<Option<Vec<f64>>, Refused> {
    if reveal_of(params, id)?.is_none() {
        return Ok(None);
    }
    let n = deep_text::unicode::grapheme_starts(&run.shown).len();
    let (lag, w) = reveal_span(n);
    Ok(Some((0..n).map(|u| (u as f64 * lag + 0.5) * w).collect()))
}

/// What laying out may ask its caller for: a text shaped in the item's own style (a glyph
/// shift's set member, a counter's previous string), and a counter's string at another value
/// of its source.
pub trait Host {
    fn shape(&mut self, text: &str) -> Arc<Shaped>;
    fn counter_text(&mut self, value: f64) -> Result<Option<String>, Refused>;
}

fn bad(path: String) -> Refused {
    Refused {
        code: "bad_doc",
        path,
    }
}

fn num(v: Option<&Value>) -> Option<f64> {
    v.and_then(Value::as_f64)
}

/// A 2×3 affine, (x, y) ↦ (a·x + c·y + e, b·x + d·y + f).
type M = [f64; 6];

const I: M = [1.0, 0.0, 0.0, 1.0, 0.0, 0.0];

fn mul(p: M, q: M) -> M {
    [
        p[0] * q[0] + p[2] * q[1],
        p[1] * q[0] + p[3] * q[1],
        p[0] * q[2] + p[2] * q[3],
        p[1] * q[2] + p[3] * q[3],
        p[0] * q[4] + p[2] * q[5] + p[4],
        p[1] * q[4] + p[3] * q[5] + p[5],
    ]
}

fn translate(x: f64, y: f64) -> M {
    [1.0, 0.0, 0.0, 1.0, x, y]
}

fn rotate(rad: f64) -> M {
    let (s, c) = rad.sin_cos();
    [c, s, -s, c, 0.0, 0.0]
}

/// Units of a run: each grapheme's unit index (`None` for a grapheme no unit holds), and the count.
fn units_of(kind: &str, run: &Shaped, path: &str) -> Result<(Vec<Option<usize>>, usize), Refused> {
    let starts = deep_text::unicode::grapheme_starts(&run.shown);
    let text = &run.shown;
    let grapheme = |k: usize| -> &str {
        let a = starts[k];
        let b = starts.get(k + 1).copied().unwrap_or(text.len());
        &text[a..b]
    };
    let space = |k: usize| grapheme(k).chars().all(char::is_whitespace);
    let n = starts.len();
    let mut out = vec![None; n];
    let mut count = 0usize;
    match kind {
        "grapheme" => {
            for (k, u) in out.iter_mut().enumerate() {
                *u = Some(k);
            }
            count = n;
        }
        "grapheme_no_space" => {
            for (k, u) in out.iter_mut().enumerate() {
                if !space(k) {
                    *u = Some(count);
                    count += 1;
                }
            }
        }
        "word" => {
            let mut open = false;
            for (k, u) in out.iter_mut().enumerate() {
                if space(k) {
                    open = false;
                    continue;
                }
                if !open {
                    count += 1;
                    open = true;
                }
                *u = Some(count - 1);
            }
        }
        "line" => {
            // A grapheme's line is its first glyph's baseline, in order of the lines.
            let mut lines: Vec<f32> = Vec::new();
            for (k, u) in out.iter_mut().enumerate() {
                let Some(g) = run.glyphs.iter().find(|g| g.grapheme == k) else {
                    continue;
                };
                let line = match lines.iter().position(|y| *y == g.y) {
                    Some(l) => l,
                    None => {
                        lines.push(g.y);
                        lines.len() - 1
                    }
                };
                *u = Some(line);
            }
            count = lines.len();
        }
        _ => return Err(bad(path.to_string())),
    }
    Ok((out, count))
}

/// The order units are selected in: unit index → its place in the selection.
fn order_of(order: &str, n: usize, seed: u64) -> Option<Vec<usize>> {
    match order {
        "index" => Some((0..n).collect()),
        "reverse" => Some((0..n).rev().collect()),
        "seeded" => {
            let mut by: Vec<(f64, usize)> = (0..n)
                .map(|i| (lattice(seed, i as i64, 0x5EED), i))
                .collect();
            by.sort_by(|a, b| a.0.total_cmp(&b.0));
            let mut place = vec![0; n];
            for (p, (_, i)) in by.into_iter().enumerate() {
                place[i] = p;
            }
            Some(place)
        }
        _ => None,
    }
}

struct NoTables;
impl Resolve for NoTables {}

/// One selector, read once per frame.
enum Selector {
    Range {
        shape: Shape,
        s: f64,
        e: f64,
        ease: Ease,
        strength: f64,
        falloff: f64,
    },
    Noise(Noise, f64),
    Field(Expr, f64),
}

fn ease_of(v: Option<&Value>, path: &str) -> Result<Ease, Refused> {
    let Some(v) = v else {
        return Ok(Ease::default());
    };
    let bound = |x: Option<&Value>, k: &str| -> Result<f64, Refused> {
        match x {
            None => Ok(0.0),
            Some(x) => x
                .as_f64()
                .filter(|x| (-1.0..=1.0).contains(x))
                .ok_or_else(|| bad(format!("{path}/ease/{k}"))),
        }
    };
    Ok(Ease {
        high: bound(v.get("high"), "high")?,
        low: bound(v.get("low"), "low")?,
    })
}

fn strength_of(v: Option<&Value>, path: &str) -> Result<f64, Refused> {
    match v {
        None => Ok(1.0),
        Some(x) => x
            .as_f64()
            .filter(|x| (-1.0..=1.0).contains(x))
            .ok_or_else(|| bad(format!("{path}/strength"))),
    }
}

/// A range read from `range` (`from`, `to`, `offset`, `basis`, `falloff`) with the shape, ease
/// and strength beside it, its start and end in units.
fn range_of(
    host: &Map<String, Value>,
    range: Option<&Value>,
    n: usize,
    path: &str,
) -> Result<Selector, Refused> {
    let r = |k: &str| range.and_then(|r| r.get(k));
    let index = match r("basis").and_then(Value::as_str) {
        None | Some("fraction") => false,
        Some("index") => true,
        Some(_) => return Err(bad(format!("{path}/range/basis"))),
    };
    let scale = if index { 1.0 } else { n as f64 };
    let offset = num(r("offset")).unwrap_or(0.0);
    let from = num(r("from")).unwrap_or(0.0);
    let to = num(r("to")).unwrap_or(if index { n as f64 } else { 1.0 });
    let shape = match host.get("shape").and_then(Value::as_str) {
        None => Shape::Square,
        Some(name) => Shape::parse(name).ok_or_else(|| bad(format!("{path}/shape")))?,
    };
    Ok(Selector::Range {
        shape,
        s: (from + offset) * scale,
        e: (to + offset) * scale,
        ease: ease_of(host.get("ease"), path)?,
        strength: strength_of(host.get("strength").or(r("strength")), path)?,
        falloff: num(r("falloff")).unwrap_or(0.0).max(0.0) * scale,
    })
}

fn noise_of(v: &Value, path: &str) -> Result<Noise, Refused> {
    let d = Noise::default();
    let f = |k: &str, dflt: f64| -> Result<f64, Refused> {
        match v.get(k) {
            None => Ok(dflt),
            Some(x) => x.as_f64().ok_or_else(|| bad(format!("{path}/noise/{k}"))),
        }
    };
    let n = Noise {
        min: f("min", d.min)?,
        max: f("max", d.max)?,
        frequency: f("frequency", d.frequency)?,
        correlation: f("correlation", d.correlation)?,
        phase: f("phase", d.phase)?,
        spatial_phase: f("spatial_phase", d.spatial_phase)?,
        lock: v.get("lock").and_then(Value::as_bool).unwrap_or(false),
        seed: v.get("seed").and_then(Value::as_u64).unwrap_or(0),
    };
    let unit = |x: f64| (-1.0..=1.0).contains(&x);
    if !unit(n.min) || !unit(n.max) || !(0.0..=1.0).contains(&n.correlation) {
        return Err(bad(format!("{path}/noise")));
    }
    Ok(n)
}

impl Selector {
    /// The selector's amount for the unit at place `i` of `n`, at `t` seconds, over `value`,
    /// what the selectors above chose.
    fn amount(&self, i: usize, n: usize, t: f64, value: f64, plant: Plant) -> f64 {
        match self {
            Selector::Range {
                shape,
                s,
                e,
                ease,
                strength,
                falloff,
            } => {
                let ind = i as f64;
                let mut a = if plant == Plant::TrianglePeaksAtStart && *shape == Shape::Triangle {
                    // The planted triangle: its peak at the range's start, falling to its end.
                    let (lo, hi) = (s.min(*e), s.max(*e));
                    if hi == lo {
                        0.0
                    } else {
                        ease.apply(1.0 - ((ind + 0.5 - lo) / (hi - lo)).clamp(0.0, 1.0))
                            * f64::from(u8::from(ind + 0.5 >= lo))
                    }
                } else {
                    range_amount(*shape, *s, *e, ind, *ease)
                };
                // `falloff` softens a square range's edges over that many units.
                if *shape == Shape::Square && *falloff > 0.0 {
                    let c = ind + 0.5;
                    let d = if c < *s {
                        s - c
                    } else if c > *e {
                        c - e
                    } else {
                        0.0
                    };
                    a = a.max((1.0 - d / falloff).max(0.0));
                }
                a * strength
            }
            Selector::Noise(noise, strength) => noise.amount(i, t) * strength,
            Selector::Field(expr, fallback) => {
                let vars: Vec<f64> = expr
                    .vars
                    .iter()
                    .map(|v| match v.as_str() {
                        "i" => i as f64,
                        "n" => n as f64,
                        "u" => (i as f64 + 0.5) / n.max(1) as f64,
                        "t" => t,
                        "value" => value,
                        _ => 0.0,
                    })
                    .collect();
                let v = expr.eval_num(&vars);
                if v.is_finite() {
                    v
                } else {
                    *fallback
                }
            }
        }
    }
}

/// An animator's selectors, its own range first, each with its mode.
fn selectors_of(
    a: &Map<String, Value>,
    n: usize,
    path: &str,
    plant: Plant,
) -> Result<Vec<(Selector, Mode)>, Refused> {
    let mode_of = |v: Option<&Value>, at: String| -> Result<Mode, Refused> {
        match v.and_then(Value::as_str) {
            None => Ok(Mode::Add),
            Some(m) => Mode::parse(m).ok_or_else(|| bad(at)),
        }
    };
    let mut out = vec![(
        range_of(a, a.get("range"), n, path)?,
        mode_of(a.get("mode"), format!("{path}/mode"))?,
    )];
    let extra = match a.get("selectors") {
        None => Vec::new(),
        Some(Value::Array(list)) => list.clone(),
        Some(_) => return Err(bad(format!("{path}/selectors"))),
    };
    if extra.len() + 1 > 4 {
        return Err(Refused {
            code: "out_of_range",
            path: format!("{path}/selectors"),
        });
    }
    for (k, sel) in extra.iter().enumerate() {
        let at = format!("{path}/selectors/{k}");
        let Value::Object(sel) = sel else {
            return Err(bad(at));
        };
        let mode = mode_of(sel.get("mode"), format!("{at}/mode"))?;
        let strength = strength_of(sel.get("strength"), &at)?;
        let s = if let Some(r) = sel.get("range") {
            let Value::Object(r) = r else {
                return Err(bad(format!("{at}/range")));
            };
            range_of(r, Some(&Value::Object(r.clone())), n, &at)?
        } else if let Some(v) = sel.get("noise") {
            Selector::Noise(noise_of(v, &at)?, strength)
        } else if let Some(v) = sel.get("field") {
            let expr = v
                .get("expr")
                .and_then(Value::as_str)
                .ok_or_else(|| bad(format!("{at}/field/expr")))?;
            let expr =
                Expr::compile(expr, &NoTables, 256).map_err(|_| bad(format!("{at}/field/expr")))?;
            if expr
                .vars
                .iter()
                .any(|v| !matches!(v.as_str(), "i" | "n" | "u" | "t" | "value"))
            {
                return Err(bad(format!("{at}/field/expr")));
            }
            Selector::Field(expr, num(v.get("fallback")).unwrap_or(0.0))
        } else {
            return Err(bad(at));
        };
        out.push((s, mode));
    }
    Ok(out)
}

/// The props an animator applies to a unit at full amount.
#[derive(Default)]
struct Props {
    x: f64,
    y: f64,
    rotate: f64,
    rotate3: Option<[f64; 3]>,
    scale: Option<f64>,
    shear: f64,
    shear_axis: f64,
    pivot: [f64; 2],
    opacity: Option<f64>,
    tracking: f64,
    tracking_anchor: f64,
    line_height: f64,
    shift: Option<(Vec<String>, i32)>,
    moves: bool,
    color: Option<String>,
    hue: f64,
    saturation: Option<f64>,
    brightness: Option<f64>,
    stroke: Option<(String, f64)>,
    blur: f64,
}

fn props_of(p: Option<&Value>, path: &str) -> Result<Props, Refused> {
    let mut out = Props::default();
    let Some(p) = p else { return Ok(out) };
    let Value::Object(p) = p else {
        return Err(bad(format!("{path}/props")));
    };
    let f = |k: &str| num(p.get(k)).unwrap_or(0.0);
    out.x = f("x");
    out.y = f("y");
    match p.get("rotate") {
        None => {}
        Some(Value::Array(r)) => {
            let r: Vec<f64> = r.iter().filter_map(Value::as_f64).collect();
            let [a, b, c] = r[..] else {
                return Err(bad(format!("{path}/props/rotate")));
            };
            out.rotate3 = Some([a, b, c]);
        }
        Some(v) => {
            out.rotate = v
                .as_f64()
                .ok_or_else(|| bad(format!("{path}/props/rotate")))?
        }
    }
    out.scale = num(p.get("scale"));
    out.shear = f("shear");
    out.shear_axis = f("shear_axis");
    if let Some(Value::Array(pv)) = p.get("pivot") {
        out.pivot = [
            num(pv.first()).unwrap_or(0.0),
            num(pv.get(1)).unwrap_or(0.0),
        ];
    }
    out.opacity = num(p.get("opacity"));
    out.tracking = f("tracking");
    out.tracking_anchor = num(p.get("tracking_anchor")).unwrap_or(0.0).clamp(0.0, 1.0);
    out.line_height = f("line_height");
    out.hue = f("hue");
    out.saturation = num(p.get("saturation"));
    out.brightness = num(p.get("brightness"));
    out.blur = f("blur").max(0.0);
    out.color = match p.get("color") {
        None => None,
        Some(Value::String(role)) => Some(role.clone()),
        Some(Value::Object(c)) => c.get("role").and_then(Value::as_str).map(str::to_string),
        Some(_) => return Err(bad(format!("{path}/props/color"))),
    };
    if let Some(st) = p.get("stroke") {
        let role = st
            .get("role")
            .and_then(Value::as_str)
            .unwrap_or("ink")
            .to_string();
        let width =
            num(st.get("width")).ok_or_else(|| bad(format!("{path}/props/stroke/width")))?;
        out.stroke = Some((role, width.max(0.0)));
    }
    if let Some(gs) = p.get("glyph_shift") {
        let at = format!("{path}/props/glyph_shift");
        let set: Vec<String> = match gs.get("set") {
            Some(Value::String(s)) => {
                let chars: &str = match s.as_str() {
                    "digits" => "0123456789",
                    "upper" => "ABCDEFGHIJKLMNOPQRSTUVWXYZ",
                    "lower" => "abcdefghijklmnopqrstuvwxyz",
                    "symbols" => "!#$%&*+-<=>?@^~",
                    _ => return Err(bad(format!("{at}/set"))),
                };
                chars.chars().map(String::from).collect()
            }
            Some(Value::Array(list)) => list
                .iter()
                .map(|v| v.as_str().map(str::to_string))
                .collect::<Option<Vec<_>>>()
                .filter(|l| !l.is_empty())
                .ok_or_else(|| bad(format!("{at}/set")))?,
            _ => return Err(bad(format!("{at}/set"))),
        };
        let by = num(gs.get("by")).unwrap_or(0.0).round() as i32;
        out.shift = Some((set, by));
    }
    out.moves = out.x != 0.0
        || out.y != 0.0
        || out.rotate != 0.0
        || out.rotate3.is_some()
        || out.scale.is_some()
        || out.shear != 0.0
        || out.tracking != 0.0
        || out.line_height != 0.0;
    Ok(out)
}

/// A path's arc-length table: each cubic of its sub-paths, sampled, for a point and a tangent
/// at an arc length.
struct Curve {
    segs: Vec<[[f64; 2]; 4]>,
    /// Cumulative length at each segment's start and per-sample lengths within it.
    tables: Vec<Vec<f64>>,
    starts: Vec<f64>,
    length: f64,
    closed: bool,
}

const SAMPLES: usize = 256;

fn bez(p: &[[f64; 2]; 4], t: f64) -> [f64; 2] {
    let u = 1.0 - t;
    let (a, b, c, d) = (u * u * u, 3.0 * u * u * t, 3.0 * u * t * t, t * t * t);
    [
        a * p[0][0] + b * p[1][0] + c * p[2][0] + d * p[3][0],
        a * p[0][1] + b * p[1][1] + c * p[2][1] + d * p[3][1],
    ]
}

fn dbez(p: &[[f64; 2]; 4], t: f64) -> [f64; 2] {
    let u = 1.0 - t;
    let (a, b, c) = (3.0 * u * u, 6.0 * u * t, 3.0 * t * t);
    [
        a * (p[1][0] - p[0][0]) + b * (p[2][0] - p[1][0]) + c * (p[3][0] - p[2][0]),
        a * (p[1][1] - p[0][1]) + b * (p[2][1] - p[1][1]) + c * (p[3][1] - p[2][1]),
    ]
}

impl Curve {
    fn of(verbs: &[crate::path::Verb]) -> Option<Curve> {
        use crate::path::Verb;
        let mut segs = Vec::new();
        let (mut cur, mut start) = ([0.0; 2], [0.0; 2]);
        let mut closed = false;
        for v in verbs {
            match *v {
                Verb::Move(p) => {
                    if !segs.is_empty() {
                        break; // the first sub-path only
                    }
                    cur = p;
                    start = p;
                }
                Verb::Line(p) => {
                    segs.push([cur, lerp(cur, p, 1.0 / 3.0), lerp(cur, p, 2.0 / 3.0), p]);
                    cur = p;
                }
                Verb::Quad(c, p) => {
                    segs.push([cur, lerp(cur, c, 2.0 / 3.0), lerp(p, c, 2.0 / 3.0), p]);
                    cur = p;
                }
                Verb::Cubic(a, b, p) => {
                    segs.push([cur, a, b, p]);
                    cur = p;
                }
                Verb::Close => {
                    if cur != start {
                        segs.push([
                            cur,
                            lerp(cur, start, 1.0 / 3.0),
                            lerp(cur, start, 2.0 / 3.0),
                            start,
                        ]);
                    }
                    closed = true;
                    cur = start;
                }
            }
        }
        if segs.is_empty() {
            return None;
        }
        let mut tables = Vec::with_capacity(segs.len());
        let mut starts = Vec::with_capacity(segs.len());
        let mut length = 0.0;
        for p in &segs {
            starts.push(length);
            // Gauss–Legendre over each sample interval: exact to well past 1e-6 u for a cubic.
            let mut table = vec![0.0; SAMPLES + 1];
            for k in 0..SAMPLES {
                let (a, b) = (k as f64 / SAMPLES as f64, (k + 1) as f64 / SAMPLES as f64);
                table[k + 1] = table[k] + gauss(p, a, b);
            }
            length += table[SAMPLES];
            tables.push(table);
        }
        Some(Curve {
            segs,
            tables,
            starts,
            length,
            closed,
        })
    }

    /// The point and the tangent's angle at arc length `s`, wrapped on a closed path and held
    /// to its ends on an open one.
    fn at(&self, s: f64) -> ([f64; 2], f64) {
        let s = if self.closed {
            s.rem_euclid(self.length)
        } else {
            s.clamp(0.0, self.length)
        };
        let k = self.starts.partition_point(|&x| x <= s).saturating_sub(1);
        let (p, table) = (&self.segs[k], &self.tables[k]);
        let local = s - self.starts[k];
        let j = table.partition_point(|&x| x <= local).clamp(1, SAMPLES) - 1;
        // Newton on the arc length within the sample interval.
        let (a, b) = (j as f64 / SAMPLES as f64, (j + 1) as f64 / SAMPLES as f64);
        let span = table[j + 1] - table[j];
        let mut t = if span > 0.0 {
            a + (b - a) * (local - table[j]) / span
        } else {
            a
        };
        for _ in 0..8 {
            let d = dbez(p, t);
            let speed = d[0].hypot(d[1]);
            if speed == 0.0 {
                break;
            }
            let err = table[j] + gauss(p, a, t) - local;
            t = (t - err / speed).clamp(a, b);
        }
        let d = dbez(p, t);
        (bez(p, t), d[1].atan2(d[0]))
    }
}

fn lerp(a: [f64; 2], b: [f64; 2], t: f64) -> [f64; 2] {
    [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]
}

/// The cubic's arc length from `a` to `b`, five-point Gauss–Legendre.
fn gauss(p: &[[f64; 2]; 4], a: f64, b: f64) -> f64 {
    const X: [f64; 5] = [
        0.0,
        -0.538_469_310_105_683_1,
        0.538_469_310_105_683_1,
        -0.906_179_845_938_664,
        0.906_179_845_938_664,
    ];
    const W: [f64; 5] = [
        0.568_888_888_888_888_9,
        0.478_628_670_499_366_5,
        0.478_628_670_499_366_5,
        0.236_926_885_056_189_1,
        0.236_926_885_056_189_1,
    ];
    let (h, m) = ((b - a) / 2.0, (a + b) / 2.0);
    X.iter()
        .zip(W)
        .map(|(x, w)| {
            let d = dbez(p, m + h * x);
            w * d[0].hypot(d[1])
        })
        .sum::<f64>()
        * h
}

/// The path an `on_curve` names, in the document's space: its verbs moved by its item's `at`.
fn curve_for(items: &Map<String, Value>, id: &str) -> Option<Curve> {
    let item = items.get(id)?;
    let d = item.pointer("/params/d")?.as_str()?;
    let mut verbs = crate::path::parse(d)?;
    let pos = item.pointer("/at/pos").and_then(Value::as_array);
    let off = [
        num(pos.and_then(|p| p.first())).unwrap_or(0.0),
        num(pos.and_then(|p| p.get(1))).unwrap_or(0.0),
    ];
    let mv = |p: &mut [f64; 2]| {
        p[0] += off[0];
        p[1] += off[1];
    };
    for v in &mut verbs {
        use crate::path::Verb;
        match v {
            Verb::Move(p) | Verb::Line(p) => mv(p),
            Verb::Quad(c, p) => {
                mv(c);
                mv(p);
            }
            Verb::Cubic(a, b, p) => {
                mv(a);
                mv(b);
                mv(p);
            }
            Verb::Close => {}
        }
    }
    Curve::of(&verbs)
}

/// A counter's roll at t: how far the change it is in is (eased, 0..1), the direction, and the
/// counter's string before that change; `None` outside a roll.
struct Roll {
    progress: f64,
    down: bool,
    old: Option<String>,
}

/// The keys of the channel that writes `target`, each (flick, value), when every one holds:
/// the source's changes fall on those flicks.
fn held_keys(doc: &Map<String, Value>, target: &str) -> Option<Vec<(i64, f64)>> {
    let channels = doc.get("channels")?.as_object()?;
    let ch = channels
        .values()
        .find(|c| c.get("target").and_then(Value::as_str) == Some(target))?;
    let keys = ch.get("keys")?.as_object()?;
    let wrap = Value::Object(doc.clone());
    let mut out = Vec::new();
    for k in keys.values() {
        let interp = k.get("interp");
        let holds = interp.and_then(Value::as_str) == Some("hold")
            || interp.and_then(|i| i.get("quantize")).is_some();
        if !holds {
            return None;
        }
        let t = match k.get("t")? {
            Value::String(s) if s == "0s" || s == "0f" || s == "0" => 0,
            v => duration(&wrap, v).ok()?,
        };
        out.push((t, num(k.get("value"))?));
    }
    out.sort_by_key(|k| k.0);
    Some(out)
}

fn roll_at(
    input: &Input<'_>,
    counter: &Map<String, Value>,
    host: &mut dyn Host,
) -> Result<Option<Roll>, Refused> {
    let Some(roll) = counter.get("roll") else {
        return Ok(None);
    };
    let path = format!("items/{}/params/text/counter/roll", input.id);
    let wrap = Value::Object(input.doc.clone());
    let span = roll
        .get("span")
        .and_then(|s| duration(&wrap, s).ok())
        .ok_or_else(|| bad(format!("{path}/span")))?;
    let ease = match roll.get("interp") {
        None => deep_canvas::ease::named("in_out_cubic", None),
        Some(Value::String(name)) if name == "linear" => deep_canvas::ease::named("linear", None),
        Some(i) => i
            .pointer("/ease/name")
            .and_then(Value::as_str)
            .and_then(|n| deep_canvas::ease::named(n, None)),
    }
    .ok_or_else(|| bad(format!("{path}/interp")))?;
    let down = match roll.get("dir").and_then(Value::as_str) {
        None | Some("up") => false,
        Some("down") => true,
        Some(_) => return Err(bad(format!("{path}/dir"))),
    };
    // A roll needs a source whose changes fall on known flicks: a data value a channel of hold
    // or quantize keys writes. Any other source is refused, naming it.
    let source = counter.get("source").and_then(Value::as_str).unwrap_or("");
    let keys = source
        .starts_with("data/")
        .then(|| held_keys(input.doc, source))
        .flatten()
        .ok_or_else(|| Refused {
            code: "roll_source",
            path: format!("items/{}/params/text/counter/source ({source})", input.id),
        })?;
    let k = keys.partition_point(|(at, _)| *at <= input.t);
    if k < 2 {
        return Ok(None);
    }
    let (at, _) = keys[k - 1];
    let into = input.t - at;
    if into >= span {
        return Ok(None);
    }
    let progress = ease.at(into as f64 / span as f64);
    let old = host.counter_text(keys[k - 2].1)?;
    Ok(Some(Roll {
        progress,
        down,
        old,
    }))
}

/// `+ 0.0` turns a −0 into 0, so a transform reads the same bits however it was reached.
fn tidy(m: M) -> M {
    m.map(|v| v + 0.0)
}

/// The glyphs `input`'s text draws at its frame (canvas primitives: Text animator and counter:
/// selectors and properties; Text `text@1`'s `on_curve`; a counter's `roll`).
pub fn lay_out(input: &Input<'_>, host: &mut dyn Host) -> Result<Laid, Refused> {
    let run = input.run;
    let id = input.id;
    let animators: Vec<Value> = match input.params.get("animators") {
        None => Vec::new(),
        Some(Value::Array(a)) => a.clone(),
        Some(_) => return Err(bad(format!("items/{id}/params/animators"))),
    };
    let t = input.t as f64 / 705_600_000.0;
    let n_graphemes = deep_text::unicode::grapheme_starts(&run.shown).len();
    // Per grapheme: offsets, a linear part, opacity and a shifted glyph, from every animator.
    #[derive(Clone)]
    struct Acc {
        d: [f64; 2],
        rot: f64,
        rot3: [f64; 3],
        scale: f64,
        shear: f64,
        shear_axis: f64,
        pivot: [f64; 2],
        opacity: f64,
        shift: i64,
        set: Option<Arc<Vec<String>>>,
        moves: bool,
        paint: Paint,
    }
    let base = Acc {
        d: [0.0; 2],
        rot: 0.0,
        rot3: [0.0; 3],
        scale: 1.0,
        shear: 0.0,
        shear_axis: 0.0,
        pivot: [0.0; 2],
        opacity: 1.0,
        shift: 0,
        set: None,
        moves: false,
        paint: Paint::default(),
    };
    let mut acc = vec![base; n_graphemes];
    let mut coverage = Vec::with_capacity(animators.len());
    for (k, a) in animators.iter().enumerate() {
        let path = format!("items/{id}/params/animators/{k}");
        let Value::Object(a) = a else {
            return Err(bad(path));
        };
        let unit_kind = a.get("units").and_then(Value::as_str).unwrap_or("grapheme");
        let (units, n) = units_of(unit_kind, run, &format!("{path}/units"))?;
        let seed = a.get("seed").and_then(Value::as_u64).unwrap_or(0);
        let order = order_of(
            a.get("order").and_then(Value::as_str).unwrap_or("index"),
            n,
            seed,
        )
        .ok_or_else(|| bad(format!("{path}/order")))?;
        let selectors = selectors_of(a, n, &path, input.plant)?;
        let clamp = a.get("clamp").and_then(Value::as_bool).unwrap_or(false);
        let amounts: Vec<f64> = (0..n)
            .map(|u| select(&selectors, order[u], n, t, clamp, input.plant))
            .collect();
        let props = props_of(a.get("props"), &path)?;
        if props.shift.is_some() && input.bound {
            return Err(Refused {
                code: "glyph_shift_number",
                path: format!("{path}/props/glyph_shift (items/{id} shows a number)"),
            });
        }
        let set = props.shift.as_ref().map(|(s, _)| Arc::new(s.clone()));
        // Tracking moves each unit by what the units before it added, less its anchor's share.
        let mut track = vec![0.0; n + 1];
        for u in 0..n {
            track[u + 1] = track[u] + amounts[u] * props.tracking;
        }
        let anchor = track[n] * props.tracking_anchor;
        for (g, unit) in units.iter().enumerate() {
            let Some(u) = *unit else { continue };
            let w = amounts[u];
            let x = &mut acc[g];
            x.d[0] += w * props.x + track[u] - anchor;
            x.d[1] += w * props.y + w * props.line_height * line_of(run, g) as f64;
            x.rot += w * props.rotate;
            if let Some(r) = props.rotate3 {
                for (o, r) in x.rot3.iter_mut().zip(r) {
                    *o += w * r;
                }
            }
            if let Some(s) = props.scale {
                x.scale *= 1.0 + w * (s - 1.0);
            }
            x.shear += w * props.shear;
            if props.shear != 0.0 {
                x.shear_axis = props.shear_axis;
            }
            if props.moves {
                x.pivot = props.pivot;
                x.moves = true;
            }
            if let Some(o) = props.opacity {
                x.opacity = (x.opacity + w * (o - 1.0)).clamp(0.0, 1.0);
            }
            let paint = &mut x.paint;
            if let Some(role) = &props.color {
                paint.color = Some((role.clone(), w.clamp(0.0, 1.0)));
            }
            paint.hue += w * props.hue;
            if let Some(s) = props.saturation {
                paint.saturation *= (1.0 + w * (s - 1.0)).max(0.0);
            }
            if let Some(b) = props.brightness {
                paint.brightness *= (1.0 + w * (b - 1.0)).max(0.0);
            }
            if let Some((role, width)) = &props.stroke {
                paint.stroke = Some((role.clone(), w.abs() * width));
            }
            paint.blur += w.abs() * props.blur;
            if let Some((_, by)) = &props.shift {
                x.shift += (w * f64::from(*by)).round() as i64;
                x.set = set.clone();
            }
        }
        coverage.push(amounts);
    }
    // #1646: a reveal fades each unit in over its share of the progress, and a CRT's afterglow
    // lights it from its own reveal time, never from an earlier frame.
    let mut afterglow = Vec::new();
    let mut reveal = Vec::new();
    if let Some(progress) = reveal_of(input.params, id)? {
        let (units, n) = units_of("grapheme", run, &format!("items/{id}/params/reveal"))?;
        let (lag, w) = reveal_span(n);
        if let Some(tau) = input.afterglow {
            afterglow = (0..n)
                .map(|u| match input.reveal_times.get(u) {
                    Some(&r) if input.t >= r => {
                        deep_canvas::ops::exp(-((input.t - r) as f64) / tau as f64)
                    }
                    _ => 0.0,
                })
                .collect();
        }
        for (g, unit) in units.iter().enumerate() {
            let Some(u) = *unit else { continue };
            let x = &mut acc[g];
            x.opacity *= ((progress - u as f64 * lag * w) / w).clamp(0.0, 1.0);
            if let Some(a) = afterglow.get(u) {
                x.paint.brightness *= 1.0 + a;
            }
        }
        reveal = input.reveal_times.to_vec();
    }
    // The run's own place: along a path, or at its origin.
    let curve = match input.params.get("on_curve") {
        None => None,
        Some(c) => {
            let at = format!("items/{id}/params/on_curve");
            let path = c
                .get("path")
                .and_then(Value::as_str)
                .ok_or_else(|| bad(format!("{at}/path")))?;
            let curve = curve_for(input.items, path).ok_or_else(|| Refused {
                code: "ref_unresolved",
                path: format!("{at}/path"),
            })?;
            let orient = match c.get("orient").and_then(Value::as_str) {
                None | Some("tangent") => true,
                Some("none") => false,
                Some(_) => return Err(bad(format!("{at}/orient"))),
            };
            Some((
                curve,
                num(c.get("offset")).unwrap_or(0.0),
                c.get("repeat").and_then(Value::as_bool).unwrap_or(false),
                orient,
            ))
        }
    };
    let counter = input
        .params
        .get("text")
        .and_then(|t| t.get("counter"))
        .and_then(Value::as_object);
    let roll = match counter {
        Some(c) => roll_at(input, c, host)?,
        None => None,
    };
    let baseline0 = run.glyphs.first().map_or(0.0, |g| f64::from(g.y));
    let glyph_of = |g: &Glyph, a: &Acc, host: &mut dyn Host| -> Glyph {
        let mut out = g.clone();
        if let (Some(set), true) = (&a.set, a.shift != 0) {
            let shown = grapheme_text(&run.shown, g.grapheme);
            if let Some(j) = set.iter().position(|m| *m == shown) {
                let to = (j as i64 + a.shift).rem_euclid(set.len() as i64) as usize;
                let shaped = host.shape(&set[to]);
                if let Some(s) = shaped.glyphs.first() {
                    out.id = s.id;
                    out.font = s.font.clone();
                    out.coords = s.coords.clone();
                }
            }
        }
        out
    };
    // The glyph-frame part of a glyph's transform: its animators' move about its pivot.
    let local = |g: &Glyph, a: &Acc| -> M {
        if !a.moves {
            return I;
        }
        let adv = f64::from(g.advance);
        let p = [adv / 2.0 + a.pivot[0], a.pivot[1]];
        let mut lin = rotate(a.rot.to_radians());
        if a.rot3 != [0.0; 3] {
            // R = Rz·Ry·Rx about the pivot, seen along z: its upper-left 2×2.
            let [rx, ry, rz] = a.rot3.map(f64::to_radians);
            let (sx, cx) = rx.sin_cos();
            let (sy, cy) = ry.sin_cos();
            let (sz, cz) = rz.sin_cos();
            let r = [
                cz * cy,
                sz * cy,
                cz * sy * sx - sz * cx,
                sz * sy * sx + cz * cx,
                0.0,
                0.0,
            ];
            lin = mul(lin, r);
        }
        if a.shear != 0.0 {
            let axis = a.shear_axis.to_radians();
            let k = a.shear.to_radians().tan();
            lin = mul(
                lin,
                mul(
                    rotate(axis),
                    mul([1.0, 0.0, -k, 1.0, 0.0, 0.0], rotate(-axis)),
                ),
            );
        }
        lin = mul(lin, [a.scale, 0.0, 0.0, a.scale, 0.0, 0.0]);
        mul(
            translate(p[0] + a.d[0], p[1] + a.d[1]),
            mul(lin, translate(-p[0], -p[1])),
        )
    };
    let mut glyphs = Vec::with_capacity(run.glyphs.len());
    let place_plain = |g: &Glyph| -> M {
        translate(
            input.origin[0] + f64::from(g.x),
            input.origin[1] + f64::from(g.y),
        )
    };
    match &curve {
        Some((curve, offset, repeat, orient)) => {
            let width = f64::from(run.width).max(1e-9);
            let copies: Vec<f64> = if *repeat {
                let lo = ((-offset - width) / width).floor() as i64;
                let hi = ((curve.length - offset) / width).ceil() as i64;
                (lo..=hi).map(|k| k as f64 * width).collect()
            } else {
                vec![0.0]
            };
            for shift in copies {
                for g in &run.glyphs {
                    let a = &acc[g.grapheme.min(acc.len().saturating_sub(1))];
                    let adv = f64::from(g.advance);
                    let s = offset + shift + f64::from(g.x) + adv / 2.0;
                    if *repeat && !(0.0..curve.length).contains(&s) {
                        continue;
                    }
                    let (p, theta) = curve.at(s);
                    let theta = if *orient { theta } else { 0.0 };
                    let lift = f64::from(g.y) - baseline0;
                    let back = if input.plant == Plant::OnCurveLeftEdge {
                        0.0
                    } else {
                        -adv / 2.0
                    };
                    let place = mul(
                        translate(p[0], p[1]),
                        mul(rotate(theta), translate(back, lift)),
                    );
                    glyphs.push(Placed {
                        glyph: glyph_of(g, a, host),
                        transform: tidy(mul(place, local(g, a))),
                        clip: None,
                        opacity: a.opacity,
                        paint: a.paint.clone(),
                    });
                }
            }
        }
        None => {
            // A rolling counter's previous string, shaped as the counter is.
            let old = match &roll {
                Some(Roll { old: Some(s), .. }) => Some(host.shape(s)),
                _ => None,
            };
            let old_graphemes = old.as_ref().map(|o| {
                let starts = deep_text::unicode::grapheme_starts(&o.shown);
                (0..starts.len())
                    .map(|k| grapheme_text(&o.shown, k))
                    .collect::<Vec<_>>()
            });
            let line_h = f64::from(run.height) / run.lines.max(1) as f64;
            for g in &run.glyphs {
                let a = &acc[g.grapheme.min(acc.len().saturating_sub(1))];
                let plain = mul(place_plain(g), local(g, a));
                let rolling = match (&roll, &old, &old_graphemes) {
                    (Some(r), Some(old), Some(og)) => {
                        let now = grapheme_text(&run.shown, g.grapheme);
                        let same = og.get(g.grapheme).is_some_and(|o| *o == now)
                            && og.len() == n_graphemes;
                        (!same || input.plant == Plant::RollMovesEveryGrapheme).then_some((r, old))
                    }
                    _ => None,
                };
                let Some((r, old)) = rolling else {
                    glyphs.push(Placed {
                        glyph: glyph_of(g, a, host),
                        transform: tidy(plain),
                        clip: None,
                        opacity: a.opacity,
                        paint: a.paint.clone(),
                    });
                    continue;
                };
                // The grapheme's cell: its advance wide, its line tall, its line's top at the
                // run's top; old slides out one way and new in from the other.
                let top = input.origin[1] + f64::from(g.y) - baseline0;
                let cell = [
                    input.origin[0] + f64::from(g.x),
                    top,
                    f64::from(g.advance),
                    line_h,
                ];
                let sign = if r.down { 1.0 } else { -1.0 };
                for o in old.glyphs.iter().filter(|o| o.grapheme == g.grapheme) {
                    let rest = translate(
                        input.origin[0] + f64::from(o.x),
                        input.origin[1] + f64::from(o.y),
                    );
                    glyphs.push(Placed {
                        glyph: o.clone(),
                        transform: tidy(mul(translate(0.0, sign * r.progress * line_h), rest)),
                        clip: Some(cell),
                        opacity: a.opacity,
                        paint: a.paint.clone(),
                    });
                }
                glyphs.push(Placed {
                    glyph: glyph_of(g, a, host),
                    transform: tidy(mul(
                        translate(0.0, -sign * (1.0 - r.progress) * line_h),
                        plain,
                    )),
                    clip: Some(cell),
                    opacity: a.opacity,
                    paint: a.paint.clone(),
                });
            }
        }
    }
    Ok(Laid {
        glyphs,
        coverage,
        reveal,
        afterglow,
    })
}

/// One animator's amount per grapheme of `run` at `t` flicks (0 for a grapheme no unit holds):
/// what the text module's `animate` operator lifts and fades by.
pub fn amounts(
    id: &str,
    k: usize,
    a: &Map<String, Value>,
    run: &Shaped,
    t: i64,
) -> Result<Vec<f64>, Refused> {
    let path = format!("items/{id}/params/animators/{k}");
    let unit_kind = a.get("units").and_then(Value::as_str).unwrap_or("grapheme");
    let (units, n) = units_of(unit_kind, run, &format!("{path}/units"))?;
    let seed = a.get("seed").and_then(Value::as_u64).unwrap_or(0);
    let order = order_of(
        a.get("order").and_then(Value::as_str).unwrap_or("index"),
        n,
        seed,
    )
    .ok_or_else(|| bad(format!("{path}/order")))?;
    let selectors = selectors_of(a, n, &path, Plant::None)?;
    let clamp = a.get("clamp").and_then(Value::as_bool).unwrap_or(false);
    let ts = t as f64 / 705_600_000.0;
    let per_unit: Vec<f64> = (0..n)
        .map(|u| select(&selectors, order[u], n, ts, clamp, Plant::None))
        .collect();
    Ok(units
        .iter()
        .map(|u| u.map_or(0.0, |u| per_unit[u]))
        .collect())
}

/// The selectors' combined amount for the unit at place `i`, top to bottom by their modes.
fn select(
    selectors: &[(Selector, Mode)],
    i: usize,
    n: usize,
    t: f64,
    clamp: bool,
    plant: Plant,
) -> f64 {
    let mut v = 0.0;
    for (j, (s, mode)) in selectors.iter().enumerate() {
        let x = s.amount(i, n, t, v, plant);
        v = if j == 0 { x } else { mode.combine(v, x) };
    }
    if clamp {
        v.clamp(0.0, 1.0)
    } else {
        v.clamp(-1.0, 1.0)
    }
}

/// The line a grapheme's first glyph sits on, counting from 0.
fn line_of(run: &Shaped, grapheme: usize) -> usize {
    let Some(g) = run.glyphs.iter().find(|g| g.grapheme == grapheme) else {
        return 0;
    };
    let mut ys: Vec<f32> = run.glyphs.iter().map(|g| g.y).collect();
    ys.dedup();
    ys.iter().position(|y| *y == g.y).unwrap_or(0)
}

fn grapheme_text(text: &str, k: usize) -> String {
    let starts = deep_text::unicode::grapheme_starts(text);
    let a = starts.get(k).copied().unwrap_or(text.len());
    let b = starts.get(k + 1).copied().unwrap_or(text.len());
    text.get(a..b).unwrap_or_default().to_string()
}

/// Whether an item's text moves per glyph: an animator, a curve or a counter's roll.
pub fn animated(params: &Map<String, Value>) -> bool {
    params
        .get("animators")
        .and_then(Value::as_array)
        .is_some_and(|a| !a.is_empty())
        || params.contains_key("on_curve")
        || params.contains_key("reveal")
        || params
            .get("text")
            .and_then(|t| t.get("counter"))
            .and_then(|c| c.get("roll"))
            .is_some()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ease_zero_is_the_identity_and_ends_hold() {
        let e = Ease {
            high: 0.5,
            low: -0.3,
        };
        assert_eq!(Ease::default().apply(0.37), 0.37);
        assert_eq!(e.apply(0.0), 0.0);
        assert_eq!(e.apply(1.0), 1.0);
        // x(t) solved back: the parameter found reproduces x.
        let (x1, x2) = (0.0, 0.5);
        let t = t_for_x(0.42, x1, x2);
        assert!((cubic(t, x1, x2) - 0.42).abs() < 1e-14);
    }

    #[test]
    fn triangle_peaks_mid_range() {
        // 10 units, 20%..70%: s = 2, e = 7; the peak sits at unit 4 (centre 4.5 = (2+7)/2).
        let a: Vec<f64> = (0..10)
            .map(|i| range_amount(Shape::Triangle, 2.0, 7.0, i as f64, Ease::default()))
            .collect();
        assert!((a[4] - 1.0).abs() < 1e-12, "{a:?}");
        assert_eq!(a[0], 0.0);
        assert_eq!(a[9], 0.0);
    }

    #[test]
    fn noise_is_pure_in_unit_and_time() {
        let n = Noise {
            seed: 7,
            ..Noise::default()
        };
        assert_eq!(n.amount(3, 1.25), n.amount(3, 1.25));
        assert_ne!(n.amount(3, 1.25), n.amount(4, 1.25));
        let v = n.amount(2, 0.7);
        assert!((-1.0..=1.0).contains(&v));
    }

    struct TestHost(deep_text::Shaper);
    impl Host for TestHost {
        fn shape(&mut self, text: &str) -> Arc<Shaped> {
            self.0.shape(&deep_text::Spec::label(text))
        }
        fn counter_text(&mut self, _: f64) -> Result<Option<String>, Refused> {
            Ok(None)
        }
    }

    fn lay(text: &str, params: Value, doc: Value) -> Result<Laid, Refused> {
        let mut host = TestHost(deep_text::Shaper::new());
        let run = host.shape(text);
        let Value::Object(params) = params else {
            panic!()
        };
        let Value::Object(doc) = doc else { panic!() };
        let input = Input {
            id: "t",
            params: &params,
            run: &run,
            origin: [0.0, 0.0],
            t: 0,
            doc: &doc,
            items: &Map::new(),
            bound: false,
            plant: Plant::None,
            reveal_times: &[],
            afterglow: None,
        };
        lay_out(&input, &mut host)
    }

    fn one(a: Value) -> Value {
        serde_json::json!({"animators": [a]})
    }

    #[test]
    fn an_index_range_counts_units_and_no_space_units_skip_spaces() {
        let a = |units: &str, basis: &str, to: f64| {
            one(
                serde_json::json!({"units": units, "range": {"from": 0, "to": to, "basis": basis}, "props": {"y": 1}}),
            )
        };
        // Units 0 and 1 of five, by index.
        let c = &lay("ABCDE", a("grapheme", "index", 2.0), serde_json::json!({}))
            .unwrap()
            .coverage[0];
        assert_eq!(c, &vec![1.0, 1.0, 0.0, 0.0, 0.0]);
        // "A B": two units, not three; the space is in none.
        let c = &lay(
            "A B",
            a("grapheme_no_space", "fraction", 1.0),
            serde_json::json!({}),
        )
        .unwrap()
        .coverage[0];
        assert_eq!(c.len(), 2);
    }

    #[test]
    fn five_selectors_are_refused_and_a_field_reads_its_unit() {
        let sel = serde_json::json!({"field": {"expr": "i / n"}, "mode": "max"});
        let many = one(
            serde_json::json!({"props": {"y": 1}, "range": {"from": 0, "to": 0}, "selectors": [sel, sel, sel, sel]}),
        );
        assert_eq!(
            lay("ABCD", many, serde_json::json!({})).unwrap_err().code,
            "out_of_range"
        );
        let field = one(
            serde_json::json!({"props": {"y": 1}, "range": {"from": 0, "to": 0}, "selectors": [sel]}),
        );
        let c = &lay("ABCD", field, serde_json::json!({})).unwrap().coverage[0];
        assert_eq!(c, &vec![0.0, 0.25, 0.5, 0.75]);
    }

    #[test]
    fn a_roll_over_a_source_with_no_stepped_keys_is_refused_naming_it() {
        let params = serde_json::json!({"text": {"counter": {"source": "data/n", "roll": {"span": "0.3s"}}}});
        let doc = serde_json::json!({"channels": {"c": {"target": "data/n", "keys": {
            "a": {"t": "0s", "value": 0, "interp": "linear"}, "b": {"t": "1s", "value": 9, "interp": "linear"}}}}});
        let r = lay("0", params, doc).unwrap_err();
        assert_eq!(r.code, "roll_source");
        assert!(r.path.contains("data/n"), "{}", r.path);
    }

    #[test]
    fn a_turn_is_about_the_advance_midpoint_moved_by_the_pivot() {
        let turn = |pivot: [f64; 2]| {
            let l = lay(
                "I",
                one(serde_json::json!({"props": {"rotate": 180, "pivot": pivot}})),
                serde_json::json!({}),
            )
            .unwrap();
            let p = &l.glyphs[0];
            let mid = f64::from(p.glyph.advance) / 2.0 + pivot[0];
            // The pivot maps to itself.
            let t = p.transform;
            let at = [
                t[0] * mid + t[2] * pivot[1] + t[4],
                t[1] * mid + t[3] * pivot[1] + t[5],
            ];
            let rest = [f64::from(p.glyph.x) + mid, f64::from(p.glyph.y) + pivot[1]];
            assert!(
                (at[0] - rest[0]).abs() < 1e-9 && (at[1] - rest[1]).abs() < 1e-9,
                "{at:?} {rest:?}"
            );
            assert!((t[0] + 1.0).abs() < 1e-12);
        };
        turn([0.0, 0.0]);
        turn([3.0, -5.0]);
    }
}

//! A transition's kind and where its window sits (canvas primitives: Transition; #466's
//! Transition: operator, iris and dip): the kinds read from the document, a dip's weight with its
//! hold, an iris's centre and radius at a time, and the window an `align` places on the cut.

use deep_canvas::ops::sqrt;
use serde_json::{Map, Value};

use super::{bad, num, refused, Kind, Transition};
use crate::doc::{Ctx, Refused};

/// A dip: the sides fade to a look role and out of it, holding it whole for `hold` at the middle.
#[derive(Clone, Debug, PartialEq)]
pub struct Dip {
    pub color: String,
    pub hold: i64,
}

/// What a dip lays under its color at a time.
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Under {
    Outgoing,
    Incoming,
    /// The two sides cross-faded, the incoming one's share (#466's planted dip).
    Cross(f64),
}

impl Dip {
    /// The color's weight at `t` and what it lies over: the outgoing side fades to it over the
    /// half before the hold and the incoming side out of it over the half after, each half eased
    /// by the transition's progress; inside the hold the weight is exactly 1.
    pub fn at(&self, tr: &Transition, t: i64, cross_fades: bool) -> (f64, Under) {
        let span = tr.end - tr.start;
        let before = (span - self.hold) / 2;
        let after = span - self.hold - before;
        let tau = t - tr.start;
        if cross_fades {
            let u = if span > 0 {
                tau as f64 / span as f64
            } else {
                1.0
            };
            return (0.5, Under::Cross(tr.ease.at(u)));
        }
        if tau < before {
            (tr.ease.at(tau as f64 / before as f64), Under::Outgoing)
        } else if tau <= before + self.hold || after <= 0 {
            (1.0, Under::Incoming)
        } else {
            let u = (tau - before - self.hold) as f64 / after as f64;
            (1.0 - tr.ease.at(u), Under::Incoming)
        }
    }
}

/// Where an iris centres: an item's evaluated bounds (their centre, or its origin with
/// `#anchor`), or a point as a share of the frame.
#[derive(Clone, Debug, PartialEq)]
pub enum Center {
    Item { id: String, origin: bool },
    At([f64; 2]),
}

/// An iris's radius in the frame's units: a document channel on `transitions/<id>/iris/radius`
/// (by the channel's ID), else a number, else by default the distance from its centre to the
/// frame's farthest corner, closing to 0 over the window by the progress.
#[derive(Clone, Debug, PartialEq)]
pub enum Radius {
    Closing,
    Fixed(f64),
    Channel(String),
}

#[derive(Clone, Debug, PartialEq)]
pub struct Iris {
    pub center: Center,
    pub radius: Radius,
    /// The share of the window at which the radius stops and holds while the centre still
    /// follows its item.
    pub hold_at: Option<f64>,
}

/// An iris at a time: its centre and radius in px of the frame. The outgoing side shows inside
/// the circle, closing on its item, and the incoming side around it, so a window's ends are its
/// two sides whole and nothing flashes back at the cut.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct IrisAt {
    pub center: [f64; 2],
    pub radius: f64,
}

impl Iris {
    /// The iris at `t` (Transition: "an iris centers on an evaluated item, so it follows a
    /// character"): its centre the item's anchor at t through the outgoing side's camera, the side
    /// the circle closes on, on a frame `size` px; `state` evaluated at t. With `from_start`
    /// (#466's planted iris) the anchor is where it stood at the window's first flick.
    #[allow(clippy::too_many_arguments)]
    pub fn at(
        &self,
        program: &crate::program::Program,
        doc: &Map<String, Value>,
        state: &crate::program::State,
        plan: &super::Plan,
        tr: &Transition,
        t: i64,
        at: &super::At,
        size: [f64; 2],
        from_start: bool,
    ) -> IrisAt {
        let pose = plan.side(tr.from, t, at);
        let anchored = if from_start {
            let mut early = program.state();
            program.evaluate(tr.start, crate::eval::Validity::Full, &mut early);
            self.center.point(program, doc, &early)
        } else {
            self.center.point(program, doc, state)
        };
        let center = match (&self.center, anchored) {
            (_, Some(p)) => super::through(&pose.projector(size), p, size)
                .unwrap_or([size[0] / 2.0, size[1] / 2.0]),
            (Center::At(c), None) => [c[0] * size[0], c[1] * size[1]],
            _ => [size[0] / 2.0, size[1] / 2.0],
        };
        // The radius stops at `hold_at` of the window.
        let span = (tr.end - tr.start).max(0);
        let held = self
            .hold_at
            .map_or(t, |h| t.min(tr.start + (h * span as f64).floor() as i64));
        let radius = match &self.radius {
            Radius::Fixed(r) => *r,
            Radius::Channel(id) if held == t => program.channel_value(state, id).unwrap_or(0.0),
            Radius::Channel(id) => {
                let mut then = program.state();
                program.evaluate(held, crate::eval::Validity::Full, &mut then);
                program.channel_value(&then, id).unwrap_or(0.0)
            }
            Radius::Closing => {
                let far = [
                    [0.0, 0.0],
                    [size[0], 0.0],
                    [0.0, size[1]],
                    [size[0], size[1]],
                ]
                .iter()
                .map(|p| {
                    let (dx, dy) = (p[0] - center[0], p[1] - center[1]);
                    sqrt(dx * dx + dy * dy)
                })
                .fold(0.0, f64::max);
                far * (1.0 - tr.progress(held))
            }
        };
        IrisAt {
            center,
            radius: radius.max(0.0),
        }
    }
}

impl Center {
    /// The point an iris centres on at the state's time, in document units: an item's bounds'
    /// centre, or its origin with `#anchor`; `None` for a point given as a share of the frame
    /// or an item the program doesn't hold.
    pub fn point(
        &self,
        program: &crate::program::Program,
        doc: &Map<String, Value>,
        state: &crate::program::State,
    ) -> Option<[f64; 3]> {
        let Center::Item { id, origin } = self else {
            return None;
        };
        if *origin {
            let i = program.items.iter().position(|x| x == id)?;
            let at = i * crate::program::TRANSFORM;
            return Some([state.slots[at], state.slots[at + 1], state.slots[at + 2]]);
        }
        let b = super::bounds_at(program, doc, state, id)?;
        Some([0, 1, 2].map(|k| (b[0][k] + b[1][k]) / 2.0))
    }
}

/// An operator transition: a pack's pass over the two finished sides and the progress.
#[derive(Clone, Debug, PartialEq)]
pub struct Operator {
    pub op: String,
    pub reads: Vec<String>,
}

impl Kind {
    /// The kind's name as a document writes it.
    pub fn name(&self) -> &str {
        match self {
            Kind::Cut => "cut",
            Kind::CrossFade => "cross_fade",
            Kind::Dip(_) => "dip",
            Kind::Iris(_) => "iris",
            Kind::Operator(_) => "operator",
            Kind::Wipe { .. } => "wipe",
            Kind::Push { .. } => "push",
            Kind::ZoomThrough { .. } => "zoom_through",
            Kind::Whip { .. } => "whip",
            Kind::Other(s) => s,
        }
    }
}

/// What an operator transition may read (Transition: operator, iris and dip).
pub const READS: [&str; 3] = ["outgoing", "incoming", "progress"];

/// Where the window sits on the cut.
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub enum Align {
    Start,
    #[default]
    Center,
    End,
    /// The frame where the incoming side first covers half the picture lands on the cut.
    Reveal,
}

/// The transition kind `name` with its fields (`fields`, the object named after the kind).
pub(super) fn kind_of(
    name: &str,
    fields: Option<&Value>,
    path: &str,
    ctx: &Ctx,
) -> Result<Kind, Refused> {
    let angle_of = |f: &str| {
        num(fields.and_then(|o| o.get(f)), &format!("{path}/{name}/{f}")).map(|v| v.unwrap_or(0.0))
    };
    let fields_obj = fields.and_then(Value::as_object);
    Ok(match name {
        "cut" => Kind::Cut,
        "cross_fade" => Kind::CrossFade,
        "dip" => Kind::Dip(dip_of(fields_obj, &format!("{path}/dip"), ctx)?),
        "wipe" => Kind::Wipe {
            angle: angle_of("angle")?,
            feather: angle_of("feather")?,
        },
        "push" => Kind::Push {
            angle: angle_of("angle")?,
        },
        "zoom_through" => {
            let center = match fields.and_then(|f| f.get("center")) {
                Some(Value::Array(c)) if c.len() == 2 => {
                    [c[0].as_f64().unwrap_or(0.5), c[1].as_f64().unwrap_or(0.5)]
                }
                _ => [0.5, 0.5],
            };
            Kind::ZoomThrough { center }
        }
        "whip" => Kind::Whip {
            angle: angle_of("angle")?,
            sweep: num(
                fields.and_then(|f| f.get("sweep")),
                &format!("{path}/whip/sweep"),
            )?
            .unwrap_or(26.0),
        },
        "iris" => Kind::Iris(iris_of(fields_obj, &format!("{path}/iris"))?),
        "operator" => Kind::Operator(operator_of(fields_obj, &format!("{path}/operator"))?),
        "match_morph" | "text_diff" => Kind::Other(name.to_string()),
        _ => return refused("transition_kind", format!("{path}/kind"), Value::Null),
    })
}

/// A dip's color names a look role, never a literal or a status color.
fn dip_of(f: Option<&Map<String, Value>>, path: &str, ctx: &Ctx) -> Result<Dip, Refused> {
    let color = match f.and_then(|f| f.get("color")) {
        None => "ink".to_string(),
        Some(Value::String(role))
            if !role.starts_with("status") && !role.starts_with('#') && !role.is_empty() =>
        {
            role.clone()
        }
        Some(_) => return bad(format!("{path}/color")),
    };
    let hold = match f.and_then(|f| f.get("hold")) {
        None => 0,
        v => crate::doc::time_of(v, ctx, &format!("{path}/hold"))?,
    };
    if hold < 0 {
        return bad(format!("{path}/hold"));
    }
    Ok(Dip { color, hold })
}

fn iris_of(f: Option<&Map<String, Value>>, path: &str) -> Result<Iris, Refused> {
    let center = match f.and_then(|f| f.get("center")) {
        None => Center::At([0.5, 0.5]),
        Some(Value::String(s)) => match s.split_once('#') {
            Some((id, _)) => Center::Item {
                id: id.to_string(),
                origin: true,
            },
            None => Center::Item {
                id: s.clone(),
                origin: false,
            },
        },
        Some(Value::Array(c)) if c.len() == 2 => match (c[0].as_f64(), c[1].as_f64()) {
            (Some(x), Some(y)) => Center::At([x, y]),
            _ => return bad(format!("{path}/center")),
        },
        Some(_) => return bad(format!("{path}/center")),
    };
    let radius = match f.and_then(|f| f.get("radius")) {
        None => Radius::Closing,
        Some(Value::Number(n)) => Radius::Fixed(n.as_f64().unwrap_or(0.0)),
        Some(_) => return bad(format!("{path}/radius")),
    };
    let hold_at = num(f.and_then(|f| f.get("hold_at")), &format!("{path}/hold_at"))?;
    if hold_at.is_some_and(|h| !(0.0..=1.0).contains(&h)) {
        return bad(format!("{path}/hold_at"));
    }
    Ok(Iris {
        center,
        radius,
        hold_at,
    })
}

fn operator_of(f: Option<&Map<String, Value>>, path: &str) -> Result<Operator, Refused> {
    let Some(op) = f.and_then(|f| f.get("op")).and_then(Value::as_str) else {
        return bad(format!("{path}/op"));
    };
    let reads = match f.and_then(|f| f.get("reads")) {
        None => READS.iter().map(|r| r.to_string()).collect(),
        Some(Value::Array(a)) => {
            let mut out = Vec::new();
            for (i, r) in a.iter().enumerate() {
                match r.as_str() {
                    Some(r) if READS.contains(&r) && !out.iter().any(|x: &String| x == r) => {
                        out.push(r.to_string())
                    }
                    _ => return bad(format!("{path}/reads/{i}")),
                }
            }
            out
        }
        Some(_) => return bad(format!("{path}/reads")),
    };
    Ok(Operator {
        op: op.to_string(),
        reads,
    })
}

pub(super) fn align_from(v: Option<&Value>, path: &str) -> Result<Align, Refused> {
    Ok(match v.and_then(Value::as_str) {
        None if v.is_none() => Align::Center,
        Some("start") => Align::Start,
        Some("center") => Align::Center,
        Some("end") => Align::End,
        Some("reveal") => Align::Reveal,
        _ => return bad(path.to_string()),
    })
}

/// The share of the picture the incoming side covers at progress `p` of a kind that draws it by
/// closed form; `None` for a kind whose coverage only its drawn output shows (an operator) or
/// that has no coverage rule here.
pub(super) fn coverage(kind: &Kind, tr: &Transition, t: i64) -> Option<f64> {
    let p = tr.progress(t);
    match kind {
        // A zoom-through blends its sides by its progress as it zooms (#142).
        Kind::CrossFade | Kind::Wipe { .. } | Kind::ZoomThrough { .. } => Some(p),
        // A push reveals when the incoming side has travelled 90% of the way (Transition).
        Kind::Push { .. } => Some(if p >= 0.9 { 0.5 } else { 0.5 * p / 0.9 }),
        Kind::Dip(d) => match d.at(tr, t, false) {
            (w, Under::Incoming) => Some(1.0 - w),
            _ => Some(0.0),
        },
        _ => None,
    }
}

/// The offset from the window's start to its first frame (on the `rate` grid) where `cover`
/// reaches half the picture, or `None` when no frame in the window does.
pub fn reveal_offset(
    span: i64,
    rate: (u32, u32),
    cover: &dyn Fn(i64) -> Option<f64>,
) -> Option<i64> {
    let fps = (i64::from(rate.0), i64::from(rate.1.max(1)));
    let flicks = deep_canvas::grammar::FLICKS_PER_SECOND;
    let mut k = 0i64;
    loop {
        // Frame k of the window, in whole flicks from its start.
        let at = k * flicks * fps.1 / fps.0.max(1);
        if at > span {
            return None;
        }
        if cover(at)? >= 0.5 {
            return Some(at);
        }
        k += 1;
    }
}

/// The window an align puts on the cut, for a span: start (the transition starts at the cut),
/// center, end (it ends there), or reveal with the offset of its reveal frame.
pub fn window(align: Align, cut: i64, span: i64, reveal: Option<i64>) -> (i64, i64) {
    let start = match align {
        Align::Start => cut,
        Align::Center => cut - span / 2,
        Align::End => cut - span,
        Align::Reveal => cut - reveal.unwrap_or(span / 2),
    };
    (start, start + span)
}

/// The window `align` puts on the cut, for the kinds whose coverage motion knows in closed form;
/// an operator's reveal is measured from its drawn output and placed later ([`placed`]), and
/// another kind can't align on a reveal.
pub(super) fn place(
    tr: &mut Transition,
    span: i64,
    rate: (u32, u32),
    path: &str,
) -> Result<(), Refused> {
    let reveal = match tr.align {
        Align::Reveal if matches!(tr.kind, Kind::Operator(_)) => None,
        Align::Reveal => {
            let mut probe = tr.clone();
            (probe.start, probe.end) = (0, span);
            let kind = tr.kind.clone();
            match reveal_offset(span, rate, &|at| coverage(&kind, &probe, at)) {
                Some(at) => Some(at),
                None => return bad(format!("{path}/align")),
            }
        }
        _ => None,
    };
    (tr.start, tr.end) = window(tr.align, tr.cut, span, reveal);
    Ok(())
}

/// A transition placed with its reveal measured from outside motion (an operator's drawn
/// output): its window moved so that frame lands on the cut.
pub fn placed(tr: &mut Transition, reveal: i64) {
    let span = tr.end - tr.start;
    let (start, end) = window(Align::Reveal, tr.cut, span, Some(reveal));
    tr.start = start;
    tr.end = end;
}

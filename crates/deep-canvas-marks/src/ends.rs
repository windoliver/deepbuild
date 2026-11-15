//! Path ends (canvas primitives: Path `path@1`: `ends`; issue #160): a head at a path's start or
//! end, drawn after its ops at its first or last point along the tangent there, in the stroke's
//! paint, sized in stroke widths. A head is at most a quarter of the path's length; past that it
//! scales down whole, its width with its length.

use deep_canvas::ops as m;
use serde_json::Value;

use crate::path::Verb;
use crate::pathops;
use crate::scene::{refuse, Refused};

/// The closed list of head shapes (`none | arrow | open | stealth | dot | ring | square | diamond
/// | bar`).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Head {
    None,
    Arrow,
    Open,
    Stealth,
    Dot,
    Ring,
    Square,
    Diamond,
    Bar,
}

impl Head {
    fn read(v: Option<&Value>, path: &str) -> Result<Head, Refused> {
        Ok(match v {
            None | Some(Value::Null) => Head::None,
            Some(Value::String(s)) => match s.as_str() {
                "none" => Head::None,
                "arrow" => Head::Arrow,
                "open" => Head::Open,
                "stealth" => Head::Stealth,
                "dot" => Head::Dot,
                "ring" => Head::Ring,
                "square" => Head::Square,
                "diamond" => Head::Diamond,
                "bar" => Head::Bar,
                _ => return refuse("bad_doc", path.to_string()),
            },
            Some(_) => return refuse("bad_doc", path.to_string()),
        })
    }

    /// Whether the head is an outline (`open` and `ring`) rather than a filled shape.
    pub fn outlined(self) -> bool {
        matches!(self, Head::Open | Head::Ring | Head::Bar)
    }
}

/// `ends {start, end, size = 4, width = size}`, in stroke widths.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Ends {
    pub start: Head,
    pub end: Head,
    pub size: f64,
    pub width: f64,
}

impl Ends {
    /// Reads `ends` at `path`; `None` when absent or both heads are `none`.
    pub fn read(v: Option<&Value>, path: &str) -> Result<Option<Ends>, Refused> {
        let e = match v {
            None | Some(Value::Null) => return Ok(None),
            Some(Value::Object(e)) => e,
            Some(_) => return refuse("bad_doc", path.to_string()),
        };
        let number = |name: &str, default: f64| -> Result<f64, Refused> {
            match e.get(name) {
                None | Some(Value::Null) => Ok(default),
                Some(v) => {
                    let n = v.as_f64().filter(|n| n.is_finite()).ok_or(Refused {
                        code: "bad_doc",
                        path: format!("{path}/{name}"),
                    })?;
                    if n <= 0.0 {
                        return refuse("out_of_range", format!("{path}/{name}"));
                    }
                    Ok(n)
                }
            }
        };
        let size = number("size", 4.0)?;
        let ends = Ends {
            start: Head::read(e.get("start"), &format!("{path}/start"))?,
            end: Head::read(e.get("end"), &format!("{path}/end"))?,
            size,
            width: number("width", size)?,
        };
        Ok((ends.start != Head::None || ends.end != Head::None).then_some(ends))
    }
}

/// A head as built: its outline in u and whether it fills (else it strokes at the path's width),
/// with the shape it draws as: its tip on the path's end, the direction it points (degrees, as
/// `pathops::at` gives a tangent), and its length along that and width across it, as drawn.
#[derive(Clone, Debug, PartialEq)]
pub struct Built {
    pub verbs: Vec<Verb>,
    pub filled: bool,
    /// `start` or `end`.
    pub at: &'static str,
    pub kind: &'static str,
    pub tip: [f64; 2],
    pub angle: f64,
    pub length: f64,
    pub width: f64,
}

impl Head {
    pub fn name(self) -> &'static str {
        match self {
            Head::None => "none",
            Head::Arrow => "arrow",
            Head::Open => "open",
            Head::Stealth => "stealth",
            Head::Dot => "dot",
            Head::Ring => "ring",
            Head::Square => "square",
            Head::Diamond => "diamond",
            Head::Bar => "bar",
        }
    }
}

fn vadd(a: [f64; 2], b: [f64; 2]) -> [f64; 2] {
    [a[0] + b[0], a[1] + b[1]]
}

fn vmul(a: [f64; 2], k: f64) -> [f64; 2] {
    [a[0] * k, a[1] * k]
}

/// The heads of `verbs` (after its ops), for a stroke `stroke` u wide: at the start pointing back
/// along the path, at the end pointing on.
pub fn build(verbs: &[Verb], ends: &Ends, stroke: f64) -> Vec<Built> {
    build_sized(verbs, ends, stroke, pathops::length(verbs))
}

/// [`build`] with heads sized for a path `length` u long (#223: a head redrawn under a warp keeps
/// the size it has on the path unwarped).
pub fn build_sized(verbs: &[Verb], ends: &Ends, stroke: f64, length: f64) -> Vec<Built> {
    if length <= 0.0 || pathops::length(verbs) <= 0.0 {
        return Vec::new();
    }
    let mut out = Vec::new();
    for (head, at, f, flip) in [
        (ends.start, "start", 0.0, -1.0),
        (ends.end, "end", 1.0, 1.0),
    ] {
        if head == Head::None {
            continue;
        }
        let Some((tip, angle)) = pathops::at(verbs, f) else {
            continue;
        };
        let mut len = ends.size * stroke;
        let mut wide = ends.width * stroke;
        // At most a quarter of the path's length, scaled down whole.
        let cap = length / 4.0;
        if len > cap {
            let k = cap / len;
            len = cap;
            wide *= k;
        }
        let a = m::rad(angle);
        // Along the head, from its tip back along the path, and across it.
        let d = vmul([m::cos(a), m::sin(a)], -flip);
        let n = [-d[1], d[0]];
        let back = |k: f64| vadd(tip, vmul(d, k));
        let across = |p: [f64; 2], k: f64| vadd(p, vmul(n, k));
        let half = wide / 2.0;
        let shape = match head {
            Head::None => continue,
            Head::Arrow => vec![
                Verb::Move(tip),
                Verb::Line(across(back(len), half)),
                Verb::Line(across(back(len), -half)),
                Verb::Close,
            ],
            Head::Open => vec![
                Verb::Move(across(back(len), half)),
                Verb::Line(tip),
                Verb::Line(across(back(len), -half)),
            ],
            Head::Stealth => vec![
                Verb::Move(tip),
                Verb::Line(across(back(len), half)),
                Verb::Line(back(len * 0.6)),
                Verb::Line(across(back(len), -half)),
                Verb::Close,
            ],
            Head::Dot | Head::Ring => {
                let r = len / 2.0;
                let inner = if head == Head::Ring {
                    (r - stroke).max(0.0)
                } else {
                    0.0
                };
                crate::outline::circle(back(r), r, inner)
            }
            Head::Square => vec![
                Verb::Move(across(tip, half)),
                Verb::Line(across(back(len), half)),
                Verb::Line(across(back(len), -half)),
                Verb::Line(across(tip, -half)),
                Verb::Close,
            ],
            Head::Diamond => vec![
                Verb::Move(tip),
                Verb::Line(across(back(len / 2.0), half)),
                Verb::Line(back(len)),
                Verb::Line(across(back(len / 2.0), -half)),
                Verb::Close,
            ],
            Head::Bar => vec![
                Verb::Move(across(tip, half)),
                Verb::Line(across(tip, -half)),
            ],
        };
        // The head points outward: on along the path at its end, back along it at its start.
        let outward = m::deg(m::atan2(-d[1], -d[0]));
        out.push(Built {
            verbs: shape,
            filled: !matches!(head, Head::Open | Head::Bar),
            at,
            kind: head.name(),
            tip,
            angle: outward,
            length: len,
            width: wide,
        });
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::path::parse;

    #[test]
    fn an_arrow_on_a_short_path_is_capped_at_a_quarter_of_its_length() {
        let verbs = parse("M 0 0 L 20 0").unwrap();
        let ends = Ends::read(
            Some(&serde_json::json!({"end": "arrow", "size": 4})),
            "ends",
        )
        .unwrap()
        .unwrap();
        let heads = build(&verbs, &ends, 3.0);
        assert_eq!(heads.len(), 1);
        let Verb::Move(tip) = heads[0].verbs[0] else {
            panic!()
        };
        let Verb::Line(base) = heads[0].verbs[1] else {
            panic!()
        };
        assert_eq!(tip, [20.0, 0.0]);
        assert!((base[0] - 15.0).abs() < 1e-9, "{base:?}");
        assert!((base[1].abs() - 2.5).abs() < 1e-9, "{base:?}");
    }

    #[test]
    fn a_start_head_points_back_and_a_long_path_keeps_the_full_size() {
        let verbs = parse("M 0 0 L 0 100").unwrap();
        let ends = Ends::read(Some(&serde_json::json!({"start": "arrow"})), "ends")
            .unwrap()
            .unwrap();
        let heads = build(&verbs, &ends, 2.0);
        let Verb::Line(base) = heads[0].verbs[1] else {
            panic!()
        };
        assert!((base[1] - 8.0).abs() < 1e-9, "{base:?}");
    }
}

//! #2098: a force's `wind` kind as written (Force): `{velocity, gust: {amplitude, scale, speed},
//! coupling: {kind: aero_triangles, coefficient}, seed}`. Its velocity is three numbers, m/s, or
//! one expression of `t`, seconds, and `p`, the place in metres, over the closed function list,
//! that gives a vec3; `crate::wind` says what it blows.

use deep_canvas::expr::{Expr, Nothing, B, V};
use deep_canvas::interval::Iv;
use serde_json::{Map, Value};

use super::{join, Reader};

/// The most nodes a wind's velocity takes, a field's (The closed function list).
const NODES: usize = 256;
/// What a wind's velocity is bounded over at check: a world's longest span, s, and 10 km, m.
const SPAN: f64 = 600.0;
const REACH: f64 = 1e4;

/// A wind's velocity at a time and a place, m/s.
#[derive(Clone, Debug, PartialEq)]
pub enum Velocity {
    Steady([f64; 3]),
    Field(Expr),
}

impl Velocity {
    /// Its value at `t` s and `p` m; not finite where the expression isn't.
    pub fn at(&self, t: f64, p: [f64; 3]) -> [f64; 3] {
        let e = match self {
            Velocity::Steady(v) => return *v,
            Velocity::Field(e) => e,
        };
        let var = |name: &String| match name.as_str() {
            "t" => V::S(t),
            _ => V::V(3, [p[0], p[1], p[2], 0.0]),
        };
        match e.eval(&e.vars.iter().map(var).collect::<Vec<_>>()) {
            V::V(3, c) => [c[0], c[1], c[2]],
            _ => [f64::NAN; 3],
        }
    }
}

/// A wind's gusts: the share of its speed they add or take, the length of their pattern, m, and
/// the speed the pattern moves downwind, m/s.
#[derive(Clone, Debug, PartialEq)]
pub struct Gust {
    pub amplitude: f64,
    pub scale: f64,
    pub speed: f64,
}

/// A wind (Force: `wind`).
#[derive(Clone, Debug, PartialEq)]
pub struct Wind {
    pub velocity: Velocity,
    pub gust: Option<Gust>,
    /// `coupling.coefficient`, kg/(m²·s): the push on a square metre facing a wind of 1 m/s, N.
    pub coefficient: f64,
    /// Its `seed`, else the world's, folded to the 32 bits the lattice hash takes.
    pub seed: u32,
}

impl Reader {
    /// The number at `key`, which a wind must write, within `min` and above; 0 once refused.
    fn needed(&mut self, m: &Map<String, Value>, key: &str, p: &str, min: f64) -> f64 {
        if !m.contains_key(key) {
            let what = format!("{} is missing: a wind writes it", join(p, key));
            self.refuse("physics.missing_field", join(p, key), &Value::Null, what);
        }
        self.num(m, key, p, 0.0, min, f64::MAX)
    }

    fn velocity(&mut self, m: &Map<String, Value>, p: &str) -> Option<Velocity> {
        let at = join(p, "velocity");
        let Some(text) = m.get("velocity").and_then(Value::as_str) else {
            if !m.contains_key("velocity") {
                let what = format!("{at} is missing: a wind writes its velocity, m/s");
                self.refuse("physics.missing_field", at, &Value::Null, what);
                return None;
            }
            return Some(Velocity::Steady(self.vec3(m, "velocity", p, [0.0; 3])));
        };
        let refused = match Expr::compile(text, &Nothing, NODES) {
            Err(e) => e.to_string(),
            Ok(e) => {
                let stray = e.vars.iter().find(|v| !["t", "p"].contains(&v.as_str()));
                let p = Iv::new(-REACH, REACH);
                let range = |name: &String| match name.as_str() {
                    "t" => B::S(Iv::new(0.0, SPAN)),
                    _ => B::V(3, [p, p, p, Iv::EMPTY]),
                };
                let bound = e.bound(&e.vars.iter().map(range).collect::<Vec<_>>());
                match stray {
                    Some(v) => format!("it reads {v}, and a wind's velocity reads only t and p"),
                    None if !matches!(bound, B::V(3, _)) => "it doesn't give a vec3".into(),
                    None if !bound.is_bounded() => {
                        format!("it isn't bounded over {SPAN} s and {REACH} m from the origin")
                    }
                    None => return Some(Velocity::Field(e)),
                }
            }
        };
        let what = format!("{at} must be three numbers or an expression of t and p that gives a vec3, m/s: {refused}");
        self.refuse("out_of_range", at, &m["velocity"], what);
        None
    }

    /// The wind `fields` write at `p`, or its refusals and none.
    pub(super) fn wind(&mut self, fields: &Value, p: &str) -> Option<Wind> {
        let m = &self.obj(fields, p, &["velocity", "gust", "coupling", "seed"]);
        let velocity = self.velocity(m, p);
        let gust = m.get("gust").map(|g| {
            let gp = join(p, "gust");
            let g = &self.obj(g, &gp, &["amplitude", "scale", "speed"]);
            Gust {
                amplitude: self.needed(g, "amplitude", &gp, 0.0),
                scale: self.needed(g, "scale", &gp, f64::MIN_POSITIVE),
                speed: self.needed(g, "speed", &gp, 0.0),
            }
        });
        let cp = join(p, "coupling");
        let c = &self.obj(
            m.get("coupling").unwrap_or(&Value::Null),
            &cp,
            &["kind", "coefficient"],
        );
        if c.get("kind").and_then(Value::as_str) != Some("aero_triangles") {
            let what = format!(
                "{} must be aero_triangles, the one way a wind pushes a body",
                join(&cp, "kind")
            );
            self.refuse(
                "out_of_range",
                join(&cp, "kind"),
                c.get("kind").unwrap_or(&Value::Null),
                what,
            );
        }
        let coefficient = self.needed(c, "coefficient", &cp, 0.0);
        let seed = match m.get("seed") {
            None => self.seed,
            Some(s) => s.as_u64().unwrap_or_else(|| {
                let what = format!("{} must be a whole number from 0", join(p, "seed"));
                self.refuse("out_of_range", join(p, "seed"), s, what);
                0
            }),
        };
        Some(Wind {
            velocity: velocity?,
            gust,
            coefficient,
            seed: (seed ^ (seed >> 32)) as u32,
        })
    }
}

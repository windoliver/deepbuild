//! #251's fields of the world document: a vehicle body's chassis on ray-cast wheels (canvas
//! primitives: Body `body@1`: vehicle). A vehicle body is a dynamic body whose `vehicle` holds its
//! wheels, at most 8, each with its mount point, radius, suspension, grip and what it does, and the
//! steer limit; it runs in 3D worlds only and follows no channel.

use std::collections::BTreeMap;

use deep_canvas::ops;
use serde_json::{Map, Value};

use super::{join, BodyKind, Reader, Refusal};

/// The most wheels a vehicle body holds.
pub const MOST_WHEELS: usize = 8;

/// One wheel: its mount point on the chassis, its radius, its suspension, its grip and whether it
/// steers, drives and brakes. Its ray points down the chassis's −Y, its axle along X and its
/// heading along +Z.
#[derive(Clone, Debug, PartialEq)]
pub struct Wheel {
    /// m, in the chassis's frame.
    pub at: [f64; 3],
    pub radius: f64,
    /// The suspension's rest length and travel, m.
    pub rest: f64,
    pub travel: f64,
    pub hz: f64,
    pub damping_ratio: f64,
    pub grip: f64,
    pub steers: bool,
    pub drives: bool,
    pub brakes: bool,
}

/// A vehicle body's `vehicle`: its wheels by name and its steer limit, deg.
#[derive(Clone, Debug, PartialEq)]
pub struct Vehicle {
    pub wheels: BTreeMap<String, Wheel>,
    pub steer_max: f64,
}

impl Vehicle {
    /// L, the distance from the steering wheels' axle to the middle of the other axles; the
    /// steering wheels' middle across, and half their track, m.
    fn geometry(&self) -> (f64, f64, f64) {
        let mean = |a: &[f64]| a.iter().sum::<f64>() / a.len().max(1) as f64;
        let steering: Vec<&Wheel> = self.wheels.values().filter(|w| w.steers).collect();
        let mut axles: Vec<f64> = self
            .wheels
            .values()
            .filter(|w| !w.steers)
            .map(|w| w.at[2])
            .collect();
        axles.sort_by(f64::total_cmp);
        axles.dedup();
        let front = mean(&steering.iter().map(|w| w.at[2]).collect::<Vec<_>>());
        let xs = steering.iter().map(|w| w.at[0]);
        let lo = xs.clone().fold(f64::MAX, f64::min);
        let hi = xs.fold(f64::MIN, f64::max);
        (
            (front - mean(&axles)).abs(),
            (lo + hi) / 2.0,
            (hi - lo) / 2.0,
        )
    }

    /// The largest steer angle, deg, that keeps the wheel inside the turn within `steer_max`.
    pub fn steer_limit(&self) -> f64 {
        let (l, _, half) = self.geometry();
        if l == 0.0 {
            return self.steer_max;
        }
        ops::deg(ops::atan(
            l / (l / ops::tan(ops::rad(self.steer_max)) + half),
        ))
    }

    /// Each wheel's steer, deg, by Ackermann's rule for steer angle `delta`, unclamped: a wheel
    /// x to the left of the steering wheels' middle turns atan(L ÷ (L ÷ tan δ − x)), so the
    /// middle of the other axle circles at L ÷ tan δ; 0 for a wheel that doesn't steer.
    pub fn ackermann(&self, delta: f64) -> Vec<f64> {
        let (l, middle, _) = self.geometry();
        let turn = |w: &Wheel| match () {
            _ if !w.steers || delta == 0.0 => 0.0,
            _ if l == 0.0 => delta,
            _ => ops::deg(ops::atan(
                l / (l / ops::tan(ops::rad(delta)) - (w.at[0] - middle)),
            )),
        };
        self.wheels.values().map(turn).collect()
    }
}

impl Reader {
    /// A body's kind; a vehicle body's is dynamic, its wheels in its `vehicle`.
    pub(super) fn kind(&mut self, b: &Map<String, Value>, p: &str) -> BodyKind {
        match b.get("kind").and_then(Value::as_str) {
            Some("static") => BodyKind::Static,
            Some("dynamic" | "vehicle") => BodyKind::Dynamic,
            Some("kinematic") => BodyKind::Kinematic,
            Some("character") => {
                let what =
                    "a character body isn't run by this backend interface yet; #182 brings it";
                self.refuse(
                    "physics.unsupported",
                    join(p, "kind"),
                    &b["kind"],
                    what.into(),
                );
                BodyKind::Static
            }
            _ => {
                let what = "a body's kind must be static, kinematic, dynamic, character or vehicle";
                let at = b.get("kind").unwrap_or(&Value::Null);
                self.refuse("out_of_range", join(p, "kind"), at, what.into());
                BodyKind::Static
            }
        }
    }

    /// A vehicle body's `vehicle` at `p`, refused when it has none; another kind's is refused.
    pub(super) fn vehicle(&mut self, b: &Map<String, Value>, p: &str) -> Option<Vehicle> {
        let p = join(p, "vehicle");
        if b.get("kind").and_then(Value::as_str) != Some("vehicle") {
            if let Some(v) = b.get("vehicle") {
                let what = format!("{p} is a vehicle body's field, and this body isn't one");
                self.refuse("unknown_field", p, v, what);
            }
            return None;
        }
        let Some(v) = b.get("vehicle") else {
            self.refuse(
                "physics.missing_field",
                p.clone(),
                &Value::Null,
                format!("a vehicle body needs {p}: its wheels and its steer limit"),
            );
            return None;
        };
        let m = &self.obj(v, &p, &["wheels", "steer_max"]);
        let wp = join(&p, "wheels");
        let wheels = m.get("wheels").and_then(Value::as_object);
        let n = wheels.map_or(0, Map::len);
        if n == 0 || n > MOST_WHEELS {
            let what = if n == 0 {
                format!("{wp} must hold at least one wheel")
            } else {
                format!("{wp} holds {n} wheels; a vehicle body holds at most {MOST_WHEELS}")
            };
            let at = m.get("wheels").unwrap_or(&Value::Null);
            self.refuse("out_of_range", wp.clone(), at, what);
        }
        let mut out = BTreeMap::new();
        for (name, w) in wheels.into_iter().flatten() {
            let p = join(&wp, name);
            if name.is_empty() || name.contains(['#', '/']) {
                let what =
                    format!("{p}: a wheel's name is its address after #, so it holds no # or /");
                self.refuse("out_of_range", p.clone(), w, what);
            }
            let w = &self.obj(
                w,
                &p,
                &[
                    "at",
                    "radius",
                    "suspension",
                    "grip",
                    "steers",
                    "drives",
                    "brakes",
                ],
            );
            let sp = join(&p, "suspension");
            let s = &self.obj(
                w.get("suspension").unwrap_or(&Value::Null),
                &sp,
                &["rest", "travel", "hz", "damping_ratio"],
            );
            for (m, key, path) in [(w, "at", &p), (w, "radius", &p)]
                .into_iter()
                .chain(["rest", "travel", "hz"].map(|k| (s, k, &sp)))
            {
                if !m.contains_key(key) {
                    let what = format!("wheel {name} needs {}", join(path, key));
                    self.refuse("physics.missing_field", join(path, key), &Value::Null, what);
                }
            }
            out.insert(
                name.clone(),
                Wheel {
                    at: self.vec3(w, "at", &p, [0.0; 3]),
                    radius: self.num(w, "radius", &p, 0.1, f64::MIN_POSITIVE, f64::MAX),
                    rest: self.num(s, "rest", &sp, 0.0, 0.0, f64::MAX),
                    travel: self.num(s, "travel", &sp, 0.0, 0.0, f64::MAX),
                    hz: self.num(s, "hz", &sp, 1.0, f64::MIN_POSITIVE, f64::MAX),
                    damping_ratio: self.num(s, "damping_ratio", &sp, 0.3, 0.0, f64::MAX),
                    grip: self.num(w, "grip", &p, 1.0, 0.0, f64::MAX),
                    steers: self.flag(w, "steers", &p, false),
                    drives: self.flag(w, "drives", &p, false),
                    brakes: self.flag(w, "brakes", &p, true),
                },
            );
        }
        Some(Vehicle {
            wheels: out,
            steer_max: self.num(m, "steer_max", &p, 35.0, 0.0, 89.0),
        })
    }
}

/// Each vehicle body of a world document that isn't 3D, as written, refused, naming its kind: it
/// runs in 3D worlds only.
pub fn flat(doc: &Value) -> Vec<Refusal> {
    let d = doc.get("dimensions").and_then(Value::as_f64).unwrap_or(3.0);
    if d == 3.0 {
        return Vec::new();
    }
    let bodies = doc
        .get("bodies")
        .and_then(Value::as_object)
        .into_iter()
        .flatten();
    bodies
        .filter(|(_, b)| b["kind"] == "vehicle")
        .map(|(id, _)| Refusal {
            code: "out_of_range",
            path: format!("bodies/{id}/kind"),
            actual: "vehicle".into(),
            what: format!("vehicle body {id} runs in 3D worlds only, and this world is {d}D"),
        })
        .collect()
}

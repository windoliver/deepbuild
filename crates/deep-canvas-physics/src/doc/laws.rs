//! #1931's three closed force laws (canvas primitives: Force): `inverse_square {point, k,
//! min_distance}`, `magnetic {field, charge}` and `lennard_jones {epsilon, sigma, cutoff}`, each
//! field read with its range, and the two rules a world holding one is held to.

use serde_json::{json, Map, Value};

use super::{join, ForceKind, Reader, Refusal, World};

/// The laws by name, as a force's kind writes them and a backend's caps claim them.
pub const LAWS: [&str; 3] = ["inverse_square", "magnetic", "lennard_jones"];

/// The most bodies a `lennard_jones` force takes: 32,640 pairs a step.
pub const MOST_PAIR_BODIES: usize = 256;

#[derive(Clone, Debug, PartialEq)]
pub enum Law {
    /// F = k × (p − point) ÷ |p − point|³, N; inside `min_distance` its size holds at its value
    /// there (0: nowhere), and at the point itself it is 0.
    InverseSquare {
        point: [f64; 3],
        k: f64,
        min_distance: f64,
    },
    /// The body holds `charge`, C, and its velocity turns about `field`, T, in the sense of
    /// q (v × B).
    Magnetic { field: [f64; 3], charge: f64 },
    /// F(r) = 24ε ÷ r × (2(σ/r)¹² − (σ/r)⁶) along the line between each pair of bodies closer
    /// than `cutoff`, repulsive when positive.
    LennardJones {
        epsilon: f64,
        sigma: f64,
        cutoff: f64,
    },
}

impl Law {
    pub fn name(&self) -> &'static str {
        match self {
            Law::InverseSquare { .. } => LAWS[0],
            Law::Magnetic { .. } => LAWS[1],
            Law::LennardJones { .. } => LAWS[2],
        }
    }
}

impl Reader {
    /// A length a law is held to at `p`/`key`, m: refused, naming the field, at or below 0.
    fn length(&mut self, m: &Map<String, Value>, key: &str, p: &str) -> Option<f64> {
        let v = m.get(key)?;
        let x = v.as_f64().filter(|x| *x > 0.0);
        if x.is_none() {
            let at = join(p, key);
            let what = format!("{at} is {v}; a force law's {key} is a length above 0 m");
            self.refuse("out_of_range", at, v, what);
        }
        x
    }

    /// Law `name`'s fields at `p`, each refused at its own path when it isn't a finite number
    /// in its range.
    pub(super) fn law(&mut self, name: &str, fields: &Value, p: &str) -> ForceKind {
        let all = f64::MAX;
        ForceKind::Law(match name {
            "inverse_square" => {
                let m = &self.obj(fields, p, &["point", "k", "min_distance"]);
                if let Some(x) = m.get("point").filter(|x| x.is_string()) {
                    self.refuse("physics.unsupported", join(p, "point"), x, "an inverse_square point read from a channel isn't run by this backend interface yet".into());
                }
                Law::InverseSquare {
                    point: if m.get("point").is_some_and(Value::is_string) {
                        [0.0; 3]
                    } else {
                        self.vec3(m, "point", p, [0.0; 3])
                    },
                    k: self.num(m, "k", p, 0.0, -all, all),
                    min_distance: self.length(m, "min_distance", p).unwrap_or(0.0),
                }
            }
            "magnetic" => {
                let m = &self.obj(fields, p, &["field", "charge"]);
                Law::Magnetic {
                    field: self.vec3(m, "field", p, [0.0; 3]),
                    charge: self.num(m, "charge", p, 0.0, -all, all),
                }
            }
            _ => {
                let m = &self.obj(fields, p, &["epsilon", "sigma", "cutoff"]);
                if !m.contains_key("sigma") {
                    let what = format!(
                        "{p} needs sigma, the distance at which the pair's potential is 0, m"
                    );
                    self.refuse(
                        "physics.missing_field",
                        join(p, "sigma"),
                        &Value::Null,
                        what,
                    );
                }
                let sigma = self.length(m, "sigma", p).unwrap_or(1.0);
                Law::LennardJones {
                    epsilon: self.num(m, "epsilon", p, 0.0, -all, all),
                    sigma,
                    cutoff: match m.get("cutoff") {
                        Some(_) => self.length(m, "cutoff", p).unwrap_or(sigma),
                        None => 2.5 * sigma,
                    },
                }
            }
        })
    }
}

/// The rules of a world holding a law. One holding `inverse_square` or `lennard_jones` runs at
/// `substeps: 1`: a force is computed once a step and held over its substeps, and a held central
/// force gains energy every orbit. A `lennard_jones` takes at most 256 bodies.
pub fn held(w: &World) -> Vec<Refusal> {
    let mut out = Vec::new();
    for (id, f) in &w.forces {
        let ForceKind::Law(law) = &f.kind else {
            continue;
        };
        let (name, n) = (law.name(), f.applies_to.len());
        if !matches!(law, Law::Magnetic { .. }) && w.substeps != 1 {
            out.push(Refusal {
                code: "out_of_range",
                path: "substeps".into(),
                actual: w.substeps.into(),
                what: format!("substeps is {}, and force {id}'s kind is {name}, which is computed once a step and held over its substeps: a world holding one runs at substeps 1, since a held central force gains energy every orbit; raise step_rate for finer steps", w.substeps),
            });
        }
        if matches!(law, Law::LennardJones { .. }) && n > MOST_PAIR_BODIES {
            out.push(Refusal {
                code: "over_budget",
                path: format!("forces/{id}/applies_to"),
                actual: json!(n),
                what: format!("force {id} is a lennard_jones law over {n} bodies, more than the {MOST_PAIR_BODIES} it takes (32,640 pairs a step)"),
            });
        }
    }
    out
}

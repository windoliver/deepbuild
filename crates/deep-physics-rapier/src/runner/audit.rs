//! #524: physics.audit at its defaults (Check input: the loop kinds; `physics.audit` gains
//! `faults`, `energy`, `penetration` and `soft`), so a lab document is held to settling cleanly:
//! no fault row of the kinds it names; energy that never grows by more than `energy.max_gain` of
//! the run's own energy a second, outside the steps an input starts; no contact deeper than
//! `penetration.max`; and no soft body's edge past `soft.max_stretch` times its rest length. Each
//! failure names its step, the IDs and a fix. A world's energy is each dynamic body's and each
//! free particle's kinetic energy plus its height's above the lowest it reached in the run, so a
//! still world has none and a swinging one its swing's. `settle`, `max_speed` and `joints` come
//! with breakables and are refused, naming the issue that brings them.

use super::*;
use deep_canvas_physics::occurrence::Payload;
use rapier3d::prelude::ColliderHandle;

/// The issue that brings the audit's other expectations.
const LATER: &str = "#132";

/// The default fault kinds.
const FAULTS: [&str; 4] = ["nan", "capacity", "speed_cap", "penetration"];

/// One step's readings: each subject's energy (its kinetic plus its potential, `-m g·p`), the
/// deepest contact with its pair, and the most stretched soft edge with its two particles.
struct Reading {
    energy: Vec<(String, f64, f64)>,
    deepest: Option<(f64, String, String)>,
    stretch: Option<(f64, String, String)>,
}

impl Rapier {
    fn reading(&self, w: &World) -> Reading {
        let g = self.world.gravity;
        let dt = self.world.integration_parameters.dt;
        let mut energy = Vec::new();
        for (id, h) in &self.bodies {
            let rb = &self.world.bodies[*h];
            if rb.is_dynamic() {
                let ke = f64::from(rb.kinetic_energy());
                energy.push((
                    id.clone(),
                    ke,
                    f64::from(rb.gravitational_potential_energy(dt, g)),
                ));
            }
        }
        let gravity = [f64::from(g.x), f64::from(g.y), f64::from(g.z)];
        let dot = |a: [f64; 3], b: [f64; 3]| a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
        let mut stretch: Option<(f64, String, String)> = None;
        for s in self.read().soft {
            let Some(soft) = w.soft.get(&s.id) else {
                continue;
            };
            for (i, m) in soft.masses.iter().enumerate() {
                if soft
                    .pins
                    .iter()
                    .any(|p| p.particle as usize == i && p.body.is_none())
                {
                    continue;
                }
                let (p, v) = (s.positions[i], s.velocities[i]);
                let name = format!("{}#{}", s.id, soft.addresses[i]);
                energy.push((name, 0.5 * m * dot(v, v), -m * dot(gravity, p)));
            }
            for [a, b] in &soft.edges {
                let (a, b) = (*a as usize, *b as usize);
                let length = |p: [f64; 3], q: [f64; 3]| {
                    let d = [p[0] - q[0], p[1] - q[1], p[2] - q[2]];
                    dot(d, d).sqrt()
                };
                let rest = length(soft.positions[a], soft.positions[b]);
                let ratio = length(s.positions[a], s.positions[b]) / rest;
                if rest > 0.0 && stretch.as_ref().is_none_or(|x| ratio > x.0) {
                    let name = |i: usize| format!("{}#{}", s.id, soft.addresses[i]);
                    stretch = Some((ratio, name(a), name(b)));
                }
            }
        }
        let name = |c: ColliderHandle| {
            self.uses
                .get(&c)
                .map(|u| u.body.clone())
                .or_else(|| self.soft.owner(&self.world, c).cloned())
                .unwrap_or_default()
        };
        let mut deepest: Option<(f64, String, String)> = None;
        for pair in self.world.narrow_phase.contact_pairs() {
            for m in pair.manifolds() {
                for pt in &m.points {
                    let depth = f64::from(-pt.dist);
                    if depth > 0.0 && deepest.as_ref().is_none_or(|d| depth > d.0) {
                        deepest = Some((depth, name(pair.collider1), name(pair.collider2)));
                    }
                }
            }
        }
        Reading {
            energy,
            deepest,
            stretch,
        }
    }
}

impl Run {
    /// physics.audit over `world` (with `scene`) for `steps` steps, its expectations at their
    /// defaults unless `expect` sets them.
    pub(super) fn audit(&self, call: &Value) -> Option<Value> {
        let (world, scene) = match self.subject(call)? {
            Ok(x) => x,
            Err(e) => return Some(e),
        };
        let steps = call.get("steps")?.as_u64()?;
        let expect = call.get("settings").cloned().unwrap_or_else(|| json!({}));
        for k in ["settle", "max_speed", "joints"] {
            if expect.get(k).is_some() {
                let what = format!("physics.audit's {k} isn't run by this backend interface yet; {LATER} brings it");
                return Some(
                    json!({"ok": false, "issues": [{"check": "physics.audit", "code": "physics.unsupported", "path": format!("settings/{k}"), "what": what}]}),
                );
            }
        }
        let faults: Vec<String> = match expect.get("faults").and_then(Value::as_array) {
            Some(f) => f
                .iter()
                .filter_map(|x| x.as_str().map(String::from))
                .collect(),
            None => FAULTS.iter().map(|f| f.to_string()).collect(),
        };
        let limit = |k: &str, d: f64| expect.pointer(k).and_then(Value::as_f64).unwrap_or(d);
        let (max_gain, max_depth, max_stretch) = (
            limit("/energy/max_gain", 0.01),
            limit("/penetration/max", 0.01),
            limit("/soft/max_stretch", 1.1),
        );
        let (w, mut b) = match self.build(&world) {
            Ok(x) => x,
            Err(e) => return Some(e),
        };
        let track = match Track::read(&w, call) {
            Ok(t) => t,
            Err(e) => return Some(e),
        };
        let mut failures = Vec::new();
        let mut readings: Vec<Reading> = vec![b.reading(&w)];
        let (mut depth, mut stretched) = (0.0f64, 0.0f64);
        for k in 1..=steps {
            let targets = scene
                .as_ref()
                .map_or_else(Targets::default, |s| s.targets(k));
            let inputs = track.by_step.get(&(k - 1)).map_or(&[][..], Vec::as_slice);
            if let Err(r) = b.step(inputs, &targets) {
                return Some(json!({"ok": false, "issues": [issue(&r)]}));
            }
            for row in b.occurrences() {
                if let Payload::Fault { kind } = row.payload {
                    if faults.iter().any(|f| f == kind) {
                        failures.push(json!({"rule": "faults", "id": row.a, "step": k, "measured": Value::Null, "limit": Value::Null, "fault": kind,
                            "what": format!("{} wrote fault {kind} at step {k}", row.a),
                            "fix": "Find what made the state non-finite or overflowed the capacity; lower a speed, stiffen a spring the step resolves, or raise the capacity"}));
                    }
                }
            }
            let r = b.reading(&w);
            if let Some((d, a, c)) = &r.deepest {
                depth = depth.max(*d);
                if *d > max_depth && !failures.iter().any(|f| f["rule"] == "penetration") {
                    failures.push(json!({"rule": "penetration", "id": a, "ids": [a, c], "step": k, "measured": d, "limit": max_depth,
                        "what": format!("{a} and {c} overlap {d:.4} m at step {k}, past penetration.max {max_depth} m"),
                        "fix": "Raise the solver's contact_hz or the world's substeps, thicken the thinner shape, or slow what hits it"}));
                }
            }
            if let Some((x, a, c)) = &r.stretch {
                stretched = stretched.max(*x);
                if *x > max_stretch && !failures.iter().any(|f| f["rule"] == "soft") {
                    let body = a.split('#').next().unwrap_or_default();
                    failures.push(json!({"rule": "soft", "id": body, "edge": [a, c], "step": k, "measured": x, "limit": max_stretch,
                        "what": format!("the edge from {a} to {c} is {x:.4} times its rest length at step {k}, past soft.max_stretch {max_stretch}"),
                        "fix": "Raise the soft body's stretch hz, lighten its particles, or pin it at more points"}));
                }
            }
            readings.push(r);
        }
        // Each subject's energy above the least potential it had in the run.
        let mut low: BTreeMap<&str, f64> = BTreeMap::new();
        for r in &readings {
            for (id, _, pe) in &r.energy {
                let e = low.entry(id.as_str()).or_insert(*pe);
                *e = e.min(*pe);
            }
        }
        let total = |r: &Reading| -> f64 {
            r.energy
                .iter()
                .map(|(id, ke, pe)| ke + pe - low.get(id.as_str()).copied().unwrap_or(*pe))
                .sum()
        };
        let energy: Vec<f64> = readings.iter().map(total).collect();
        let scale = energy.iter().copied().fold(0.0, f64::max);
        let second = w.step_rate.round().max(1.0) as usize;
        let inputs: Vec<u64> = track.by_step.keys().copied().collect();
        let mut gain = 0.0f64;
        if scale > 1e-12 {
            for k in 0..energy.len().saturating_sub(second) {
                let window = k as u64..(k + second) as u64;
                if inputs.iter().any(|s| window.contains(s)) {
                    continue;
                }
                let g = (energy[k + second] - energy[k]) / scale;
                gain = gain.max(g);
                if g > max_gain && !failures.iter().any(|f| f["rule"] == "energy") {
                    let grew = |r: &Reading, id: &str| {
                        r.energy
                            .iter()
                            .find(|e| e.0 == id)
                            .map_or(0.0, |e| e.1 + e.2)
                    };
                    let most = readings[k + second]
                        .energy
                        .iter()
                        .map(|e| e.0.as_str())
                        .max_by(|a, b| {
                            let d =
                                |id: &str| grew(&readings[k + second], id) - grew(&readings[k], id);
                            d(a).total_cmp(&d(b))
                        });
                    failures.push(json!({"rule": "energy", "id": most, "step": k + second,
                        "measured": g, "limit": max_gain,
                        "what": format!("the world's energy grew {:.2}% of its own in the second to step {}, past energy.max_gain {max_gain}", g * 100.0, k + second),
                        "fix": "Find what adds energy without an input: a motor, a spring stiffer than the step resolves, or a contact that pushes apart; damp it or raise the substeps"}));
                }
            }
        }
        failures.sort_by_key(|f| f["step"].as_u64());
        Some(
            json!({"ok": true, "kind": "physics.audit", "verdict": if failures.is_empty() { "PASS" } else { "FAIL" },
            "failures": failures,
            "readings": {"energy_gain": gain, "penetration": depth, "max_stretch": stretched},
            "settings": {"faults": faults, "energy": {"max_gain": max_gain}, "penetration": {"max": max_depth},
                       "soft": {"max_stretch": max_stretch}}}),
        )
    }
}

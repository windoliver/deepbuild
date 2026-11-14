//! Motion's entries in the core's `constraint@1` (canvas primitives: Constraint; Registry and
//! seal: registries), each with the fixture the constraint kit reads at the seal, made by running
//! the kind's own solve: the reads it made in order, its op counts at three inputs, the digests
//! of its poses at 50 times played in order and sought in a shuffled order, and the check's
//! answer to a two-item cycle through it.

use std::collections::BTreeMap;

use deep_canvas::canon::sha256_hex;
use serde_json::{json, Value};

use crate::constraint::{self, ArcTable, Ops, Pose, SpringBake, What};

/// Motion's planted constraint solves, for the kit's proof: a kind that iterates to convergence,
/// its op count varying with its input, and one that reads its own output from the previous
/// frame. Each plants itself in `look_at`.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum Planted {
    #[default]
    None,
    Iterates,
    PreviousFrame,
}

/// The planted kind's name in `constraint@1`, beside motion's own.
pub const PLANTED_KIND: &str = "look_at";

/// Motion's kinds and the reads each declares.
pub const KINDS: [(&str, &[&str]); 10] = [
    ("child_of", &["target.world", "self.local"]),
    ("follow_path", &["path.table", "self.local"]),
    ("look_at", &["target.position", "self.position"]),
    ("copy", &["target.group", "self.local"]),
    ("limit", &["self.group"]),
    ("reach2", &["target.position", "chain.lengths"]),
    ("follow_tip", &["item.tip", "self.local"]),
    ("distance", &["target.position", "self.position"]),
    ("spring_chain", &["chain.bake", "self.local"]),
    ("rest_on", &["on.surface", "self.bounds"]),
];

/// What a planted solve carries between frames; nothing for every real one.
#[derive(Clone, Debug, Default)]
struct Carried(Option<Pose>);

/// The fixture's spring chain, baked once at check as the kind bakes it, and read at each time.
fn bake() -> SpringBake {
    SpringBake::bake(
        |s| 40.0 * deep_canvas::ops::sin(3.0 * s),
        1.0,
        2.0,
        0.5,
        60.0,
    )
}

/// The fixture's target at time `t` (0 to 49) and the param `p` that scales how far it is.
fn target_at(t: u32, p: f64) -> Pose {
    let t = f64::from(t);
    Pose {
        pos: [10.0 + 7.25 * t + p, 50.0 + 0.5 * t * p, 0.0],
        rot: [0.0, 0.0, 3.0 * t],
        scale: [1.0 + 0.01 * t, 1.0, 1.0],
    }
}

fn own_at(t: u32) -> Pose {
    let t = f64::from(t);
    Pose {
        pos: [-20.0 + t, 5.0, 0.0],
        rot: [0.0, 0.0, -2.0 * t],
        scale: [1.0; 3],
    }
}

/// One solve of kind `name` at time `t` with param `p`: the pose, the reads in order and the ops.
fn run(
    name: &str,
    t: u32,
    p: f64,
    planted: Planted,
    carried: &mut Carried,
    bake: &SpringBake,
) -> (Pose, Vec<&'static str>, u64) {
    let mut ops = Ops::default();
    let mut order = Vec::new();
    let reads = KINDS
        .iter()
        .find(|(n, _)| *n == name)
        .map_or(&[][..], |(_, r)| *r);
    let target = target_at(t, p);
    let own = own_at(t);
    // The fixture evaluates every read the kind declares, in its order, before the solve.
    order.extend(reads.iter().copied());
    order.push("solve");
    let tf = f64::from(t);
    let pose = match name {
        "child_of" => constraint::child_of(&target, &own, &mut ops),
        "follow_path" => {
            let table = ArcTable::new(vec![
                [0.0, 0.0],
                [40.0, 0.0],
                [40.0, 30.0 + p],
                [90.0, 30.0],
            ]);
            constraint::follow_path(&own, &table, tf / 49.0, true, [0.0, 2.0], &mut ops)
        }
        "look_at" => match planted {
            Planted::None => constraint::look_at(&own, target.pos, &mut ops),
            Planted::Iterates => {
                let goal = constraint::look_at(&own, target.pos, &mut ops);
                let mut at = own;
                while (goal.rot[2] - at.rot[2]).abs() > 1e-9 {
                    at.rot[2] += (goal.rot[2] - at.rot[2]) / 2.0;
                    ops.0 += 2;
                }
                at
            }
            Planted::PreviousFrame => {
                let goal = constraint::look_at(&own, target.pos, &mut ops);
                let was = carried.0.unwrap_or(goal);
                let mut out = goal;
                out.rot[2] = 0.5 * (goal.rot[2] + was.rot[2]);
                carried.0 = Some(out);
                out
            }
        },
        "copy" => constraint::copy(&own, What::Rotation, &target, &mut ops),
        "limit" => {
            let bounds = [Some((-5.0, 30.0 + p)), None, None];
            let mut moved = own;
            moved.pos[0] += 2.0 * tf;
            constraint::limit(&moved, What::Location, &bounds, &mut ops)
        }
        "reach2" => {
            let r = constraint::reach2(
                [0.0, 0.0],
                [30.0, 20.0],
                [target.pos[0] * 0.2, target.pos[1] * 0.2],
                1.0,
                true,
                &mut ops,
            );
            Pose {
                pos: [r.end[0], r.end[1], 0.0],
                rot: [0.0, r.upper, r.lower],
                scale: [r.stretch; 3],
            }
        }
        "follow_tip" => {
            let tip = [target.pos[0], target.pos[1]];
            constraint::follow_tip(&own, tip, target.rot[2], [1.0, -1.0], true, &mut ops)
        }
        "distance" => constraint::distance(&own, target.pos, 10.0, 30.0 + p, &mut ops),
        "spring_chain" => {
            let mut out = own;
            out.rot[2] += bake.at(tf / 49.0 + p * 1e-3, &mut ops);
            out
        }
        _ => constraint::rest_on(&own, 4.0 + p * 0.01, 0.0, 0.0, 10.0, &mut ops).unwrap_or(own),
    };
    if planted == Planted::PreviousFrame && name == PLANTED_KIND {
        order.insert(0, "earlier(self.rotation)");
    }
    (pose, order, ops.0)
}

fn digest(poses: &BTreeMap<u32, Pose>) -> String {
    let mut bytes = Vec::new();
    for (t, p) in poses {
        bytes.extend(t.to_le_bytes());
        for v in p.pos.iter().chain(&p.rot).chain(&p.scale) {
            bytes.extend(v.to_bits().to_le_bytes());
        }
    }
    sha256_hex(&bytes)
}

/// Kind `name`'s fixture, from its solve (or the planted one) run for real.
pub fn fixture(name: &str, planted: Planted, cycle: Value) -> Value {
    let planted = if name == PLANTED_KIND {
        planted
    } else {
        Planted::None
    };
    let baked = if name == "spring_chain" {
        bake()
    } else {
        SpringBake {
            step: 1.0,
            swings: vec![0.0],
            max_swing: 0.0,
        }
    };
    let run = |t: u32, p: f64, carried: &mut Carried| run(name, t, p, planted, carried, &baked);
    let (_, order, _) = run(7, 16.0, &mut Carried::default());
    let ops: Vec<u64> = [0.0, 16.0, 64.0]
        .iter()
        .map(|p| run(7, *p, &mut Carried::default()).2)
        .collect();
    let p = |t: u32| 16.0 + 0.5 * f64::from(t);
    let mut carried = Carried::default();
    let play: BTreeMap<u32, Pose> = (0..50u32)
        .map(|t| (t, run(t, p(t), &mut carried).0))
        .collect();
    // A fixed shuffle (a full-period step over 50), so seeking jumps back and forth.
    let mut carried = Carried::default();
    let seek: BTreeMap<u32, Pose> = (0..50u32)
        .map(|i| (i * 31 + 7) % 50)
        .map(|t| (t, run(t, p(t), &mut carried).0))
        .collect();
    let read: Vec<&str> = {
        let mut r: Vec<&str> = order.iter().copied().filter(|r| *r != "solve").collect();
        r.sort_unstable();
        r
    };
    json!({
        "read": read, "order": order, "ops": ops,
        "play": digest(&play), "seek": digest(&seek), "cycle": cycle,
    })
}

/// Motion's `constraint@1` entries, `(name, value)`, each with its fixture; `cycle` answers a
/// two-item cycle through kind `name` with the check's refusal.
pub fn entries(planted: Planted, cycle: impl Fn(&str) -> Value) -> Vec<(&'static str, Value)> {
    KINDS
        .iter()
        .map(|(name, reads)| {
            let mut declared: Vec<&str> = reads.to_vec();
            if planted == Planted::PreviousFrame && *name == PLANTED_KIND {
                declared.push("earlier(self.rotation)");
            }
            let fixture = fixture(name, planted, cycle(name));
            (
                *name,
                json!({"reads": declared, "writes": ["self.transform"], "fixture": fixture}),
            )
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn kit() -> deep_canvas::registry::lists::RegistryDef {
        deep_canvas::registry::core_lists::registries()
            .into_iter()
            .find(|d| d.name == "constraint@1")
            .expect("the core declares constraint@1")
    }

    #[test]
    fn every_motion_kind_passes_the_constraint_kit_and_the_planted_ones_fail() {
        for (name, value) in entries(Planted::None, crate::module::cycle_through) {
            let r = kit().run_kit(name, &value);
            assert!(r.pass(), "{name}: {:?} {value}", r.failed());
        }
        for planted in [Planted::Iterates, Planted::PreviousFrame] {
            let all = entries(planted, crate::module::cycle_through);
            let (_, value) = all.iter().find(|(n, _)| *n == PLANTED_KIND).unwrap();
            assert!(!kit().run_kit(PLANTED_KIND, value).pass(), "{planted:?}");
        }
    }
}

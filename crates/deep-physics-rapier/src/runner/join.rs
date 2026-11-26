//! #1500 (canvas primitives: Logic: saves across changes): a live world carried on under a new
//! revision. A save binds a world by hash; a join goes one case past that rule: a change that keeps
//! every body, shape and joint, such as gravity or friction, opens the world's whole state as the
//! join held it in the world the new revision built, as a restore loads a checkpoint, and that
//! world then takes the revision's gravity and contact materials, so its next step runs under the
//! new rules from where every body was. Any other change to a world restarts the run, naming what
//! differs.

use super::*;

/// The IDs `a` holds and `b` doesn't.
fn only<V>(a: &BTreeMap<String, V>, b: &BTreeMap<String, V>) -> Option<String> {
    a.keys().find(|k| !b.contains_key(*k)).cloned()
}

/// The first ID both hold whose part differs.
fn changed<V: PartialEq>(a: &BTreeMap<String, V>, b: &BTreeMap<String, V>) -> Option<String> {
    a.iter()
        .find(|(k, v)| b.get(*k).is_some_and(|w| w != *v))
        .map(|(k, _)| k.clone())
}

impl Live {
    /// Why this world can't carry on as `next`, the world a new revision built: the first body,
    /// shape or joint the revision removes, adds or changes, as `{"what": "body", "body": <ID>,
    /// "change": "removed"}`, or `{"what": "world"}` for any
    /// other change past gravity and contact materials (any change, in 2D); none when it carries on.
    pub fn differs(&self, next: &Live) -> Option<Value> {
        let (a, b) = (&self.w, &next.w);
        for (what, gone, new, other) in [
            (
                "body",
                only(&a.bodies, &b.bodies),
                only(&b.bodies, &a.bodies),
                changed(&a.bodies, &b.bodies),
            ),
            (
                "shape",
                only(&a.shapes, &b.shapes),
                only(&b.shapes, &a.shapes),
                changed(&a.shapes, &b.shapes),
            ),
            (
                "joint",
                only(&a.joints, &b.joints),
                only(&b.joints, &a.joints),
                changed(&a.joints, &b.joints),
            ),
        ] {
            for (change, id) in [("removed", gone), ("added", new), ("changed", other)] {
                if let Some(id) = id {
                    return Some(json!({"what": what, what: id, "change": change}));
                }
            }
        }
        let mut kept = a.clone();
        kept.gravity = b.gravity;
        kept.defaults = b.defaults.clone();
        kept.contact_materials = b.contact_materials.clone();
        // A 2D world takes no new gravity or material in place, so any change to it restarts.
        let flat = self.b.flat.is_some() && a != b;
        (kept != *b || flat).then(|| json!({"what": "world"}))
    }

    /// The world's whole state now as a join holds it, with the steps it has run.
    pub fn held(&self) -> (Checkpoint, u64) {
        (self.b.checkpoint(), self.steps)
    }

    /// `held` opened in this world, a new revision's build that [`Live::differs`] lets it carry on
    /// as, with the steps it had run. `poses_only` is the planted open: this build as it stands,
    /// each body's pose and velocities set as held.
    pub fn carry(
        &mut self,
        (cp, steps): &(Checkpoint, u64),
        poses_only: bool,
    ) -> Result<(), Value> {
        let built = poses_only.then(|| self.b.checkpoint());
        self.b
            .carried(cp)
            .map_err(|r| json!({"ok": false, "issues": [issue(&r)]}))?;
        if let Some(built) = &built {
            self.b.plant(crate::planted::Restore::PosesOnly, built);
        }
        self.steps = *steps;
        Ok(())
    }

    /// Every body, static ones too, as the last step left it, by ID: its `pos` and `rot`.
    pub fn poses(&self) -> Value {
        let state = self.b.read();
        let bodies = state.bodies.iter();
        Value::Object(
            bodies
                .map(|b| (b.id.clone(), json!({"pos": b.pos, "rot": b.rot})))
                .collect(),
        )
    }
}

impl Rapier {
    /// `cp` loaded as a restore loads it, then this build's gravity and contact materials in
    /// place of the ones it held. A gravity that changed wakes every dynamic body, so a resting
    /// one feels it on the next step; nothing that stayed the same is touched.
    fn carried(&mut self, cp: &Checkpoint) -> Result<(), Box<Refusal>> {
        let built = std::mem::take(&mut self.world);
        if let Err(r) = self.restore(cp) {
            self.world = built;
            return Err(r);
        }
        let w = &mut self.world;
        if w.gravity != built.gravity {
            w.gravity = built.gravity;
            for (_, b) in w.bodies.iter_mut().filter(|(_, b)| b.is_dynamic()) {
                b.wake_up(true);
            }
        }
        for (h, c) in built.colliders.iter() {
            let Some(mine) = w.colliders.get_mut(h) else {
                continue;
            };
            if mine.friction() != c.friction() {
                mine.set_friction(c.friction());
            }
            if mine.restitution() != c.restitution() {
                mine.set_restitution(c.restitution());
            }
            if mine.friction_combine_rule() != c.friction_combine_rule() {
                mine.set_friction_combine_rule(c.friction_combine_rule());
            }
            if mine.restitution_combine_rule() != c.restitution_combine_rule() {
                mine.set_restitution_combine_rule(c.restitution_combine_rule());
            }
        }
        Ok(())
    }
}

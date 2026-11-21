//! #276: what a copy's player brings to step 0, its profile record (canvas primitives: Logic:
//! saves), which reaches every copy in that player's step-0 message, numbers included, and enters
//! each copy's track there as that player's entry.

use serde_json::{json, Value};

use super::{kind, Copy, Message, Planted, Stepper};

impl<S: Stepper> Copy<S> {
    /// Its first `delay` messages, the first carrying what its player brings to step 0; with no
    /// delay, its first made message carries it.
    pub(super) fn bring(&mut self) {
        let mut brings = self.sim.brings();
        self.brought = brings
            .iter()
            .find(|(c, _)| c == kind::PROFILE)
            .map(|(_, v)| v.clone());
        for _ in 0..self.cfg.delay {
            let entries = std::mem::take(&mut brings);
            self.send(Message {
                entries,
                ..Message::default()
            });
        }
        self.made
            .extend(brings.into_iter().map(|(c, v)| (c, v, None)));
    }

    /// A profile record's entry as the track holds one: `{t, seq, profile, arrays, writer, player}`.
    pub(super) fn profile_entry(
        &self,
        k: i64,
        seq: usize,
        value: &Value,
        who: (&str, u8),
    ) -> Value {
        json!({"t": k * self.cfg.step(), "seq": seq, "profile": value["profile"], "arrays": value["arrays"],
               "writer": who.0, "player": who.1})
    }

    /// What the piece reads of a stamped entry: the entry, but on the planted copy a peer's profile
    /// record's numbers are its own viewer's.
    pub(super) fn fed(&self, entry: &Value) -> Value {
        let mut e = entry.clone();
        let peer = e["player"].as_u64() != Some(u64::from(self.me));
        if let (Planted::ProfileFromOwnStore, true, Some(own)) = (
            self.planted,
            peer && e.get("profile").is_some(),
            &self.brought,
        ) {
            e["arrays"] = own["arrays"].clone();
        }
        e
    }
}

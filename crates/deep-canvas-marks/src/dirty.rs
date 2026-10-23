//! Dirty classes for 2D (canvas primitives: Dirty classes; Invalidation and damage): per item and
//! class a change epoch, so a consumer reruns only for what changed since its last run. A change's
//! paths decide its classes: `at` is transform, `visible` and creation or deletion are presence,
//! paint and color adjustments are shading, a text's words, font, size, weight and box are text,
//! any other param is geometry, a bound value's reading is reading, and a change that came only
//! from the clock is also time. A changed item marks its ancestors, so propagation skips clean
//! subtrees. Epochs decide only when to recompute and never enter a content key.

use std::collections::BTreeMap;

use serde_json::{Map, Value};

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub enum Class {
    Transform,
    Geometry,
    Shading,
    Presence,
    Text,
    Reading,
    Time,
}

impl Class {
    pub fn name(self) -> &'static str {
        match self {
            Class::Transform => "transform",
            Class::Geometry => "geometry",
            Class::Shading => "shading",
            Class::Presence => "presence",
            Class::Text => "text",
            Class::Reading => "reading",
            Class::Time => "time",
        }
    }
}

/// The text kind's params the shaper reads.
const TEXT_PARAMS: [&str; 7] = ["text", "font", "size", "weight", "box", "numerals", "align"];

/// The class a changed field of an item of `kind` falls in (each kind's `dirty: {path → class}`).
pub fn class_of(kind: &str, field: &[&str]) -> Class {
    match field {
        ["at", ..] => Class::Transform,
        ["visible", ..] => Class::Presence,
        ["adjust", ..] | ["params", "paint", ..] => Class::Shading,
        ["params", name, ..] if kind == "text@1" && TEXT_PARAMS.contains(name) => Class::Text,
        _ => Class::Geometry,
    }
}

/// Every leaf path where `a` and `b` differ, a missing side included.
fn diff(a: Option<&Value>, b: Option<&Value>, at: &mut Vec<String>, out: &mut Vec<Vec<String>>) {
    match (a, b) {
        (Some(Value::Object(x)), Some(Value::Object(y))) => {
            let mut keys: Vec<&String> = x.keys().chain(y.keys()).collect();
            keys.sort();
            keys.dedup();
            for k in keys {
                at.push(k.clone());
                diff(x.get(k), y.get(k), at, out);
                at.pop();
            }
        }
        (x, y) if x != y => out.push(at.clone()),
        _ => {}
    }
}

/// The change epochs of a session's items.
#[derive(Clone, Debug, Default)]
pub struct Dirty {
    epoch: u32,
    changed_at: BTreeMap<(String, Class), u32>,
    items: Map<String, Value>,
    shown: BTreeMap<String, String>,
}

impl Dirty {
    /// The epoch of the last [`Dirty::advance`].
    pub fn epoch(&self) -> u32 {
        self.epoch
    }

    /// Takes a frame's evaluated items and each bound value's shown text, stamps what changed at
    /// a new epoch, and returns it, ancestors included. `by_clock` says no revision, reading or
    /// view came with this frame, so what changed, changed because time passed.
    pub fn advance(
        &mut self,
        items: &Map<String, Value>,
        shown: &BTreeMap<String, String>,
        by_clock: bool,
    ) -> Vec<(String, Class)> {
        self.epoch += 1;
        let mut changes: Vec<(String, Class)> = Vec::new();
        let mut ids: Vec<&String> = items.keys().chain(self.items.keys()).collect();
        ids.sort();
        ids.dedup();
        for id in ids {
            let (old, new) = (self.items.get(id), items.get(id));
            let kind = new
                .or(old)
                .and_then(|i| i.get("kind"))
                .and_then(Value::as_str)
                .unwrap_or("");
            if old.is_none() || new.is_none() {
                changes.push((id.clone(), Class::Presence));
                continue;
            }
            let before = changes.len();
            let mut paths = Vec::new();
            diff(old, new, &mut Vec::new(), &mut paths);
            for p in paths {
                let field: Vec<&str> = p.iter().map(String::as_str).collect();
                changes.push((id.clone(), class_of(kind, &field)));
            }
            if by_clock && changes.len() > before {
                changes.push((id.clone(), Class::Time));
            }
        }
        let mut shown_ids: Vec<&String> = shown.keys().chain(self.shown.keys()).collect();
        shown_ids.sort();
        shown_ids.dedup();
        for id in shown_ids {
            if shown.get(id) != self.shown.get(id) {
                changes.push((id.clone(), Class::Reading));
            }
        }
        // A changed item marks its ancestors with the same class.
        let parent = |id: &str| {
            items
                .get(id)
                .or(self.items.get(id))
                .and_then(|i| i.get("parent"))
                .and_then(Value::as_str)
                .map(str::to_string)
        };
        let direct = changes.clone();
        for (id, class) in direct {
            let mut at = parent(&id);
            let mut hops = 0;
            while let Some(p) = at {
                changes.push((p.clone(), class));
                hops += 1;
                if hops > items.len() + self.items.len() {
                    break;
                }
                at = parent(&p);
            }
        }
        changes.sort();
        changes.dedup();
        for (id, class) in &changes {
            self.changed_at.insert((id.clone(), *class), self.epoch);
        }
        self.items = items.clone();
        self.shown = shown.clone();
        changes
    }

    /// Whether `item`'s `class` changed after a consumer's `last_run` epoch.
    pub fn changed_since(&self, item: &str, class: Class, last_run: u32) -> bool {
        self.changed_at
            .get(&(item.to_string(), class))
            .is_some_and(|&e| e > last_run)
    }

    /// Whether any class of `item` changed after `last_run`.
    pub fn any_since(&self, item: &str, last_run: u32) -> bool {
        self.changed_at
            .range((item.to_string(), Class::Transform)..=(item.to_string(), Class::Time))
            .any(|(_, &e)| e > last_run)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn items(v: Value) -> Map<String, Value> {
        v.as_object().cloned().unwrap()
    }

    #[test]
    fn each_kind_of_change_stamps_its_own_class() {
        let base = json!({
            "card": {"kind": "rect@1", "params": {"box": [0, 0, 10, 10], "paint": {"fill": {"role": "ink"}}}, "at": {"pos": [0, 0, 0]}},
            "title": {"kind": "text@1", "params": {"text": "Ready", "size": 13}, "parent": "card"},
        });
        let mut dirty = Dirty::default();
        let first = dirty.advance(&items(base.clone()), &BTreeMap::new(), false);
        assert!(
            first.iter().all(|(_, c)| *c == Class::Presence),
            "everything is new: {first:?}"
        );
        let mut next = base.clone();
        next["card"]["at"]["pos"][0] = json!(5);
        assert_eq!(
            dirty.advance(&items(next.clone()), &BTreeMap::new(), false),
            vec![("card".into(), Class::Transform)]
        );
        next["card"]["params"]["paint"]["fill"]["role"] = json!("accent");
        assert_eq!(
            dirty.advance(&items(next.clone()), &BTreeMap::new(), false),
            vec![("card".into(), Class::Shading)]
        );
        next["card"]["params"]["box"][2] = json!(20);
        assert_eq!(
            dirty.advance(&items(next.clone()), &BTreeMap::new(), false),
            vec![("card".into(), Class::Geometry)]
        );
        // A child's text change marks its parent too.
        next["title"]["params"]["text"] = json!("Blocked");
        assert_eq!(
            dirty.advance(&items(next.clone()), &BTreeMap::new(), false),
            vec![("card".into(), Class::Text), ("title".into(), Class::Text)]
        );
        let shown: BTreeMap<String, String> = [("title".to_string(), "1,234".to_string())].into();
        assert!(dirty
            .advance(&items(next.clone()), &shown, false)
            .contains(&("title".into(), Class::Reading)));
        // Moved by the clock alone: transform and time.
        next["card"]["at"]["pos"][0] = json!(6);
        let by_clock = dirty.advance(&items(next.clone()), &shown, true);
        assert!(
            by_clock.contains(&("card".into(), Class::Transform))
                && by_clock.contains(&("card".into(), Class::Time))
        );
        let mut gone = next.clone();
        gone.as_object_mut().unwrap().remove("title");
        assert!(dirty
            .advance(&items(gone), &BTreeMap::new(), false)
            .contains(&("title".into(), Class::Presence)));
    }

    #[test]
    fn an_unchanged_item_is_clean_for_a_consumer_that_ran_after_its_last_change() {
        let mut dirty = Dirty::default();
        let a = items(
            json!({"a": {"kind": "rect@1", "params": {}}, "b": {"kind": "rect@1", "params": {}}}),
        );
        dirty.advance(&a, &BTreeMap::new(), false);
        let ran = dirty.epoch();
        let mut b = a.clone();
        b["b"]["params"] = json!({"box": [1, 1, 1, 1]});
        dirty.advance(&b, &BTreeMap::new(), false);
        assert!(!dirty.any_since("a", ran));
        assert!(dirty.changed_since("b", Class::Geometry, ran));
        assert!(!dirty.changed_since("b", Class::Transform, ran));
    }
}

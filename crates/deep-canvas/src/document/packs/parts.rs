//! #233: an instance's parts at check (Pack: math@1: "`group[i]` expands to the ID of that part
//! at check"). A drawn document holds an instance's derived items, never the instance, so a cue
//! that names the instance plays on its one drawn part, else on the group its parts hang from
//! (`<id>.all`), and `<id>[i]` names part i (the items it placed, such as a group's members, else
//! the items it derived). Relations read an instance the same way where they're solved (marks2d).

use std::collections::BTreeMap;

use serde_json::{Map, Value};

use super::Expansion;

/// What one expanded instance resolves to.
struct Parts {
    /// `<id>.all`, when the recipe derives one.
    all: Option<String>,
    /// Its parts in order: the items it placed, else the items it derived.
    each: Vec<String>,
}

/// Rewrites, in `items`, every cue target that names an expanded instance, or one of its parts
/// as `<id>[i]`.
pub(super) fn resolve(items: &mut Map<String, Value>, expansions: &[Expansion]) {
    let mut parts = BTreeMap::new();
    for e in expansions {
        let all = format!("{}.all", e.instance);
        let all = items.contains_key(&all).then_some(all);
        let derived = e.items.iter().map(|d| d.id.clone());
        let derived: Vec<String> = derived.filter(|d| Some(d) != all.as_ref()).collect();
        let each = if e.placed.is_empty() {
            derived
        } else {
            e.placed.clone()
        };
        parts.insert(e.instance.clone(), Parts { all, each });
    }
    if parts.is_empty() {
        return;
    }
    // `<id>[i]` → part i; `<id>` → its one part, else its group; a `#part` stays.
    let name = |text: &str| -> Option<String> {
        let (base, part) = match text.split_once('#') {
            Some((b, p)) => (b, Some(p)),
            None => (text, None),
        };
        let found = if let Some((id, i)) = base.strip_suffix(']').and_then(|b| b.split_once('[')) {
            let p = parts.get(id)?;
            p.each.get(i.parse::<usize>().ok()?)?.clone()
        } else {
            let p = parts.get(base)?;
            match (&p.all, p.each.as_slice()) {
                (_, [one]) => one.clone(),
                (Some(all), _) => all.clone(),
                _ => return None,
            }
        };
        Some(match part {
            Some(p) => format!("{found}#{p}"),
            None => found,
        })
    };
    let rewrite = |v: &mut Value| {
        if let Some(new) = v.as_str().and_then(name) {
            *v = Value::String(new);
        }
    };
    for item in items.values_mut() {
        if let Some(Value::Array(cues)) = item.pointer_mut("/params/cues") {
            for targets in cues.iter_mut().filter_map(|c| c.get_mut("targets")) {
                if let Value::Array(list) = targets {
                    list.iter_mut().for_each(&rewrite);
                }
            }
        }
    }
}

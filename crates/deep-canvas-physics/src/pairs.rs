//! `physics.pairs` (issue #2011; canvas primitives: Collision group), a check kind beside the
//! document kinds: the whole interaction matrix of a world's collision groups, computed from every
//! shape use's `member`, `collides` and `sensor` after its role is expanded, held to the pairs a
//! brief locks and to each role's rule. Two shape uses interact only when each one's `collides`
//! names a group the other is a member of; an interacting pair with a sensor in it senses, any
//! other touches solidly.

use serde_json::{json, Value};

use crate::doc::World;

/// How two shape uses interact.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Contact {
    Solid,
    /// Overlap a sensor reports, never a response.
    Sensor,
    None,
}

impl Contact {
    pub fn name(self) -> &'static str {
        match self {
            Contact::Solid => "solid",
            Contact::Sensor => "sensor",
            Contact::None => "none",
        }
    }
}

/// The pairs a brief locks: groups that must interact, and groups that must never.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Brief {
    pub touch: Vec<[String; 2]>,
    pub never: Vec<[String; 2]>,
}

/// One shape use as the check names it, with its groups as bit masks over the world's groups.
struct Use<'w> {
    body: &'w str,
    index: usize,
    shape: &'w str,
    member: u32,
    collides: u32,
    sensor: bool,
    role: Option<&'w str>,
    owner: Option<&'w str>,
}

impl Use<'_> {
    fn name(&self) -> Value {
        json!({"body": self.body, "index": self.index, "shape": self.shape})
    }
}

fn contact(s: &Use, t: &Use) -> Contact {
    if s.collides & t.member == 0 || t.collides & s.member == 0 {
        Contact::None
    } else if s.sensor || t.sensor {
        Contact::Sensor
    } else {
        Contact::Solid
    }
}

/// physics.pairs over `w`, a world whose roles `assumptions` (roles::expand) expanded, against
/// `brief`: `{ok, verdict, groups, matrix, shapes, failures, assumptions}`. A brief group the
/// world lacks is refused, naming it.
pub fn pairs(w: &World, assumptions: &[Value], brief: &Brief) -> Value {
    let role_of = |body: &str, index: usize| {
        assumptions
            .iter()
            .find(|a| a["body"] == body && a["index"] == index)
    };
    let uses: Vec<Use> = w
        .bodies
        .iter()
        .flat_map(|(id, b)| {
            b.shapes.iter().enumerate().map(move |(i, u)| {
                let a = role_of(id, i);
                Use {
                    body: id,
                    index: i,
                    shape: &u.shape,
                    member: u.member,
                    collides: u.collides,
                    sensor: u.sensor,
                    role: a.and_then(|a| a["role"].as_str()),
                    owner: a.and_then(|a| a["owner"].as_str()),
                }
            })
        })
        .collect();
    let bit = |g: &str| w.groups.iter().position(|x| x == g).map(|b| 1u32 << b);
    let mut refused = Vec::new();
    for (kind, list) in [("touch", &brief.touch), ("never", &brief.never)] {
        for (i, pair) in list.iter().enumerate() {
            for g in pair {
                if bit(g).is_none() {
                    refused.push(json!({"check": "physics.pairs", "code": "ref_unresolved", "severity": "error",
                        "ids": [], "path": format!("brief/{kind}/{i}"), "actual": g, "t": null,
                        "what": format!("{g} is not one of the world's collision groups"),
                        "fix": "Lock pairs of the world's collision groups, or of its roles' groups."}));
                }
            }
        }
    }
    if !refused.is_empty() {
        return json!({"ok": false, "issues": refused});
    }
    // Every unordered pair of shape uses on different bodies, in canonical order.
    let mut shape_pairs = Vec::new();
    for (i, s) in uses.iter().enumerate() {
        for t in &uses[i + 1..] {
            if s.body != t.body {
                shape_pairs.push((s, t, contact(s, t)));
            }
        }
    }
    // The shape pairs across groups `g` and `h` (bit masks), each with its uses in that order.
    let across = |g: u32, h: u32| {
        shape_pairs.iter().flat_map(move |&(s, t, c)| {
            let one = (s.member & g != 0 && t.member & h != 0).then_some((s, t, c));
            let other = (t.member & g != 0 && s.member & h != 0).then_some((t, s, c));
            one.into_iter().chain(other)
        })
    };
    let mut matrix = Vec::new();
    for (i, a) in w.groups.iter().enumerate() {
        for b in &w.groups[i..] {
            let interacts = across(bit(a).unwrap_or(0), bit(b).unwrap_or(0))
                .any(|(_, _, c)| c != Contact::None);
            matrix.push(json!({"a": a, "b": b, "interacts": interacts}));
        }
    }
    let mut failures = Vec::new();
    let fail = |lock: &str, pair: [&str; 2], s: &Use, t: &Use, what: String| json!({"lock": lock, "pair": pair, "shapes": [s.name(), t.name()], "what": what});
    let at = |u: &Use| format!("{}/shapes/{}", u.body, u.index);
    for [a, b] in &brief.touch {
        let (g, h) = (bit(a).unwrap_or(0), bit(b).unwrap_or(0));
        if across(g, h).any(|(_, _, c)| c != Contact::None) {
            continue;
        }
        if let Some((s, t, _)) = across(g, h).next() {
            failures.push(fail("touch", [a, b], s, t, format!(
                "the brief locks {a}–{b} to touch, but no two shapes of theirs interact: {} (in {a}) and {} (in {b}) don't, since each one's collides must name a group of the other's",
                at(s), at(t))));
        } else {
            failures.push(json!({"lock": "touch", "pair": [a, b], "shapes": [],
                "what": format!("the brief locks {a}–{b} to touch, but no shapes on two bodies are members of them")}));
        }
    }
    for [a, b] in &brief.never {
        if let Some((s, t, c)) =
            across(bit(a).unwrap_or(0), bit(b).unwrap_or(0)).find(|(_, _, c)| *c != Contact::None)
        {
            failures.push(fail("never", [a, b], s, t, format!(
                "the brief locks {a}–{b} never to touch, but {} (in {a}) and {} (in {b}) interact ({})",
                at(s), at(t), c.name())));
        }
    }
    // The roles' rules: a shot never touches its owner; a pickup or trigger is a sensor to players.
    let group = |u: &Use| {
        w.groups
            .iter()
            .enumerate()
            .find(|(b, _)| u.member & (1 << b) != 0)
            .map_or(String::new(), |(_, g)| g.clone())
    };
    // The first use on another body that `want` picks, with its contact with `s`.
    let find = |s: &Use, want: &dyn Fn(&Use) -> bool| {
        uses.iter()
            .find(|o| o.body != s.body && want(o))
            .map(|o| (o, contact(s, o)))
    };
    for s in &uses {
        let broken = match (s.role, s.owner) {
            (Some("shot"), Some(owner)) => find(s, &|o: &Use| {
                o.body == owner && contact(s, o) != Contact::None
            })
            .map(|(o, c)| (o, format!("shot {} interacts with {} on its owner {owner} ({}); a shot never touches the body that fired it", at(s), at(o), c.name()))),
            (Some(r @ ("pickup" | "trigger")), _) => find(s, &|o: &Use| {
                o.role == Some("player") && contact(s, o) != Contact::Sensor
            })
            .map(|(o, c)| (o, format!("{r} {} meets player {} as {}, not as a sensor; a {r} is a sensor that sees players", at(s), at(o), c.name()))),
            _ => None,
        };
        if let Some((o, what)) = broken {
            let (gs, go) = (group(s), group(o));
            failures.push(fail("role", [&gs, &go], s, o, what));
        }
    }
    let shapes: Vec<Value> = shape_pairs
        .iter()
        .map(|(s, t, c)| json!({"a": s.name(), "b": t.name(), "contact": c.name()}))
        .collect();
    json!({"ok": true, "verdict": if failures.is_empty() { "PASS" } else { "FAIL" },
           "groups": w.groups, "matrix": matrix, "shapes": shapes, "failures": failures,
           "assumptions": assumptions})
}

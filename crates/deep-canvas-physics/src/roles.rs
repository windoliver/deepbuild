//! Roles (issue #2011; canvas primitives: Collision group): a shape use may take `role` instead of
//! groups, and the check expands it through the first-party table below into its collision groups,
//! `member`, `collides` and `sensor`, so a person never writes a group. A shot leaves its `owner`'s
//! groups out of what it collides with, so it never touches the body that fired it; a pickup or a
//! trigger is a sensor that sees players. Each expansion is an assumption row shown to the person.

use serde_json::{json, Map, Value};

use crate::doc::Refusal;

/// One role's row: the groups its shape is a member of, the groups it collides with, and whether
/// it is a sensor.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Row {
    pub role: &'static str,
    pub member: &'static [&'static str],
    pub collides: &'static [&'static str],
    pub sensor: bool,
}

/// The first-party role table: each role is a member of its own group.
pub const TABLE: [Row; 8] = [
    Row {
        role: "player",
        member: &["player"],
        collides: &[
            "player", "enemy", "ground", "wall", "prop", "shot", "pickup", "trigger",
        ],
        sensor: false,
    },
    Row {
        role: "enemy",
        member: &["enemy"],
        collides: &["player", "enemy", "ground", "wall", "prop", "shot"],
        sensor: false,
    },
    Row {
        role: "ground",
        member: &["ground"],
        collides: &["player", "enemy", "prop", "shot"],
        sensor: false,
    },
    Row {
        role: "wall",
        member: &["wall"],
        collides: &["player", "enemy", "prop", "shot"],
        sensor: false,
    },
    Row {
        role: "pickup",
        member: &["pickup"],
        collides: &["player"],
        sensor: true,
    },
    Row {
        role: "shot",
        member: &["shot"],
        collides: &["player", "enemy", "ground", "wall", "prop"],
        sensor: false,
    },
    Row {
        role: "trigger",
        member: &["trigger"],
        collides: &["player"],
        sensor: true,
    },
    Row {
        role: "prop",
        member: &["prop"],
        collides: &["player", "enemy", "ground", "wall", "prop", "shot"],
        sensor: false,
    },
];

/// The planted wrong table (#2011 criterion 3): a pickup solid to the player.
pub const PLANTED_SOLID_PICKUP: [Row; 8] = {
    let mut t = TABLE;
    t[4].sensor = false;
    t
};

/// A world document with every role expanded, and the assumption row of each expansion.
pub struct Expanded {
    pub doc: Value,
    pub assumptions: Vec<Value>,
}

fn refusal(path: String, actual: &Value, what: String) -> Refusal {
    Refusal {
        code: "physics.role",
        path,
        actual: actual.clone(),
        what,
    }
}

/// `doc` with each shape use's `role` (and a shot's `owner`) replaced by the groups, `member`,
/// `collides` and `sensor` that `table` gives it, the roles' groups added to `collision_groups`;
/// or the refusals: a shape use with both a role and explicit groups, a role the table lacks, an
/// owner that isn't a body.
pub fn expand(doc: &Value, table: &[Row]) -> Result<Expanded, Vec<Refusal>> {
    let mut out = doc.clone();
    let mut refused = Vec::new();
    let mut assumptions = Vec::new();
    let Some(bodies) = doc.get("bodies").and_then(Value::as_object) else {
        return Ok(Expanded {
            doc: out,
            assumptions,
        });
    };
    let uses = |b: &Value| -> Vec<Value> {
        b.get("shapes")
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default()
    };
    // The groups a body's shapes are members of, by role or as written, which a shot it fired
    // leaves out.
    let member_of = |id: &str| -> Vec<String> {
        let mut g: Vec<String> = Vec::new();
        for u in bodies.get(id).map(uses).unwrap_or_default() {
            match u.get("role").and_then(Value::as_str) {
                Some(r) => g.extend(
                    table
                        .iter()
                        .filter(|row| row.role == r)
                        .flat_map(|row| row.member.iter().map(|m| (*m).to_string())),
                ),
                None => g.extend(
                    u.get("member")
                        .and_then(Value::as_array)
                        .into_iter()
                        .flatten()
                        .filter_map(|m| m.as_str().map(String::from)),
                ),
            }
        }
        g
    };
    let mut groups: Vec<String> = doc
        .get("collision_groups")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|g| g.as_str().map(String::from))
        .collect();
    let mut any = false;
    for (id, b) in bodies {
        for (i, u) in uses(b).iter().enumerate() {
            let path = format!("bodies/{id}/shapes/{i}");
            let Some(role) = u.get("role") else {
                if let Some(o) = u.get("owner") {
                    refused.push(refusal(
                        format!("{path}/owner"),
                        o,
                        format!("{path} names an owner but no role; only a shot has an owner"),
                    ));
                }
                continue;
            };
            let explicit: Vec<&str> = ["member", "collides", "sensor"]
                .into_iter()
                .filter(|k| u.get(*k).is_some())
                .collect();
            if !explicit.is_empty() {
                refused.push(refusal(
                    path.clone(),
                    u,
                    format!(
                        "shape {path} takes role {role} and explicit {} together; a role expands to its groups, so give one or the other",
                        explicit.join(", ")
                    ),
                ));
                continue;
            }
            let Some(row) = role
                .as_str()
                .and_then(|r| table.iter().find(|row| row.role == r))
            else {
                let names: Vec<&str> = table.iter().map(|r| r.role).collect();
                refused.push(refusal(
                    format!("{path}/role"),
                    role,
                    format!("{role} is not a role; the roles are {}", names.join(", ")),
                ));
                continue;
            };
            let mut collides: Vec<&str> = row.collides.to_vec();
            let owner = u.get("owner");
            if let Some(o) = owner {
                match o.as_str().filter(|o| bodies.contains_key(*o)) {
                    Some(o) if row.role == "shot" => {
                        let theirs = member_of(o);
                        collides.retain(|g| !theirs.iter().any(|t| t == g));
                    }
                    Some(_) => {
                        refused.push(refusal(
                            format!("{path}/owner"),
                            o,
                            format!("{path} is a {}, and only a shot has an owner", row.role),
                        ));
                        continue;
                    }
                    None => {
                        refused.push(refusal(
                            format!("{path}/owner"),
                            o,
                            format!("{o} is not a body of this world"),
                        ));
                        continue;
                    }
                }
            }
            any = true;
            for g in row.member.iter().chain(row.collides) {
                if !groups.iter().any(|x| x == g) {
                    groups.push((*g).to_string());
                }
            }
            let mut m: Map<String, Value> = u.as_object().cloned().unwrap_or_default();
            m.remove("role");
            m.remove("owner");
            m.insert("member".into(), json!(row.member));
            m.insert("collides".into(), json!(collides));
            m.insert("sensor".into(), json!(row.sensor));
            out["bodies"][id]["shapes"][i] = Value::Object(m);
            assumptions.push(json!({
                "body": id, "index": i, "role": row.role, "owner": owner,
                "member": row.member, "collides": collides, "sensor": row.sensor,
                "what": format!("{path} takes role {}: member of {}, collides with {}{}", row.role,
                    row.member.join(", "), collides.join(", "),
                    if row.sensor { ", a sensor" } else { "" }),
            }));
        }
    }
    if any {
        out["collision_groups"] = json!(groups);
    }
    if refused.is_empty() {
        Ok(Expanded {
            doc: out,
            assumptions,
        })
    } else {
        Err(refused)
    }
}

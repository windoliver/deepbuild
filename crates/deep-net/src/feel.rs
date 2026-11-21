//! #280: net.feel (canvas primitives: Check input: net kinds). It plays `players` copies of the
//! piece over the test relay on its virtual clock, each player's messages delayed by its one-way
//! latency plus a seeded jitter, with seeded spikes and losses, and reads on every copy the time
//! it stalled a minute, each rollback's depth and how far each named item jumped when a rollback
//! corrected it. It passes only when every copy's readings are within every bound, and fails
//! naming the copy, the reading and the value; a copy that waited past its deadline fails it,
//! naming the copy and the step it waited for.

use serde_json::{json, Value};

use crate::card::Card;
use crate::copy::{End, Stepper};
use crate::kind::Config;
use crate::play::{play, Ask, Faults, Played, Profile, Spikes};

/// What net.feel's definition gives: never the working agent's.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Feel {
    /// The copies it plays: the net item's count where none.
    pub players: Option<u8>,
    pub steps: i64,
    pub profile: Profile,
    pub seed: u64,
    pub items: Vec<String>,
    pub bounds: Bounds,
}

/// Stall in ms a minute, the p99 rollback depth in steps and the p99 correction in metres.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Bounds {
    pub stall: Option<f64>,
    pub depth_p99: Option<f64>,
    pub correction_p99: Option<f64>,
}

impl Feel {
    /// net.feel's check input: `{players?, steps? = 3,600, profile: {latency: [ms], jitter: ms,
    /// spikes?: {every: s, hold: ms, player?, first?: s}, loss?: {rate, seed}}, seed, items: [item
    /// path], bounds: {stall?, depth_p99?, correction_p99?}}`; an error names the field.
    pub fn of(input: &Value) -> Result<Feel, Value> {
        let bad = |field: &str, what: &str| json!({"code": "bad_input", "kind": "net.feel", "path": field, "what": what});
        let ms = |v: f64| (v * (crate::FLICKS / 1000) as f64).round() as i64;
        let s = |v: f64| (v * crate::FLICKS as f64).round() as i64;
        let num = |v: &Value, field: &str| {
            v.as_f64()
                .filter(|x| x.is_finite() && *x >= 0.0)
                .ok_or_else(|| bad(field, "a number, 0 or more"))
        };
        // With no profile, every message on time: no latency, jitter, spike or loss.
        let none = json!({});
        let p = input.get("profile").unwrap_or(&none);
        let latency = match p.get("latency") {
            None => &[][..],
            Some(l) => l
                .as_array()
                .map(Vec::as_slice)
                .ok_or_else(|| bad("profile/latency", "one one-way latency in ms a player"))?,
        }
        .iter()
        .map(|l| num(l, "profile/latency").map(ms))
        .collect::<Result<Vec<_>, _>>()?;
        let jitter = p
            .get("jitter")
            .map_or(Ok(0.0), |j| num(j, "profile/jitter"))?;
        let seat = |v: Option<&Value>, field: &str| match v {
            None => Ok(None),
            Some(v) => v
                .as_u64()
                .filter(|n| (1..=8).contains(n))
                .map(|n| Some(n as u8))
                .ok_or_else(|| bad(field, "a player from 1 to 8")),
        };
        let spikes = match p.get("spikes") {
            None | Some(Value::Null) => None,
            Some(sp) => Some(Spikes {
                every: s(num(
                    sp.get("every").unwrap_or(&Value::Null),
                    "profile/spikes/every",
                )?),
                hold: ms(num(
                    sp.get("hold").unwrap_or(&Value::Null),
                    "profile/spikes/hold",
                )?),
                player: seat(sp.get("player"), "profile/spikes/player")?,
                first: match sp.get("first") {
                    None => None,
                    Some(f) => Some(s(num(f, "profile/spikes/first")?)),
                },
            }),
        };
        let loss = match p.get("loss") {
            None | Some(Value::Null) => None,
            Some(l) => {
                let rate = num(l.get("rate").unwrap_or(&Value::Null), "profile/loss/rate")?;
                if rate >= 1.0 {
                    return Err(bad("profile/loss/rate", "a chance below 1"));
                }
                let seed = l.get("seed").and_then(Value::as_u64);
                Some((
                    rate,
                    seed.ok_or_else(|| bad("profile/loss/seed", "a whole number"))?,
                ))
            }
        };
        let players = seat(input.get("players"), "players")?;
        if players == Some(1) {
            return Err(bad("players", "2 to 8 players"));
        }
        let items = match input.get("items") {
            None => Vec::new(),
            Some(i) => i
                .as_array()
                .and_then(|i| i.iter().map(|p| p.as_str().map(str::to_string)).collect())
                .ok_or_else(|| bad("items", "item paths, `items/<id>`"))?,
        };
        let b = input.get("bounds").cloned().unwrap_or(json!({}));
        let bound = |k: &str| match b.get(k) {
            None | Some(Value::Null) => Ok(None),
            Some(v) => num(v, &format!("bounds/{k}")).map(Some),
        };
        Ok(Feel {
            players,
            steps: input
                .get("steps")
                .map_or(Some(3600), Value::as_i64)
                .filter(|n| (1..=1_000_000).contains(n))
                .ok_or_else(|| bad("steps", "match steps, 1 or more"))?,
            profile: Profile {
                latency,
                jitter: ms(jitter),
                spikes,
                loss,
            },
            seed: input.get("seed").and_then(Value::as_u64).unwrap_or(0),
            items,
            bounds: Bounds {
                stall: bound("stall")?,
                depth_p99: bound("depth_p99")?,
                correction_p99: bound("correction_p99")?,
            },
        })
    }
}

/// The net module's check kinds as deep_kinds lists them under net@1 (#280: net.feel with its
/// fields, each with its default, and its readings).
pub fn check_kinds() -> Value {
    json!(["net.rollback", "net.desync", "net.budget", listing()])
}

fn listing() -> Value {
    json!({"kind": "net.feel", "fields": [
        {"name": "players", "type": "2 to 8", "default": null, "unset": "the net item's players"},
        {"name": "steps", "type": "u32", "default": 3600},
        {"name": "profile", "type": "{latency: [ms] (one-way, one per player), jitter: ms, spikes: {every: s, hold: ms, player: 1 to 8 (optional), first: s (optional)}, loss: {rate, seed} (optional)}", "default": {}, "unset": "every message on time"},
        {"name": "seed", "type": "u64", "default": 0},
        {"name": "items", "type": "[item path]", "default": []},
        {"name": "bounds", "type": "{stall: ms per minute, depth_p99: steps, correction_p99: m}", "default": {}},
    ], "readings": "{copy, stall_ms_per_min, depth: {p50, p99}, correction: {p50, p99}}",
    "from": "the brief or the definition, never the working agent"})
}

/// #280: the field of a net.feel among `doc`'s own checks that a patch op at `path` setting
/// `value` reaches: its profile, seed, items or bounds, the whole check, or a new net.feel. They
/// are the brief's or the definition's, never the working agent's, so its patch is refused.
pub fn locked(doc: &Value, path: &str, value: &Value) -> Option<String> {
    let path = path.trim_start_matches('/');
    let mut parts = path.split('/');
    if parts.next()? != "checks" {
        return None;
    }
    let feel = |c: &Value| c.get("kind").and_then(Value::as_str) == Some("net.feel");
    if feel(value) {
        return Some(path.to_string());
    }
    let checks = doc.get("checks");
    let Some(at) = parts.next() else {
        let any = match checks {
            Some(Value::Array(a)) => a.iter().any(feel),
            Some(Value::Object(m)) => m.values().any(feel),
            _ => false,
        };
        return any.then(|| path.to_string());
    };
    let check = match checks? {
        Value::Array(a) => a.get(at.parse::<usize>().ok()?)?,
        Value::Object(m) => m.get(at)?,
        _ => return None,
    };
    match parts.next() {
        _ if !feel(check) => None,
        None | Some("kind" | "profile" | "seed" | "items" | "bounds") => Some(path.to_string()),
        Some(_) => None,
    }
}

/// #280: the first field of a net.feel among `stored`'s own checks that `shown`, a writer's
/// whole document, changes, or a net.feel it adds: its path, as `checks/0/bounds/stall`.
pub fn changed(stored: &Value, shown: &Value) -> Option<String> {
    let feel = |c: &Value| c.get("kind").and_then(Value::as_str) == Some("net.feel");
    let (was, now) = (&stored["checks"], &shown["checks"]);
    let keys = |v: &Value| -> Vec<String> {
        match v {
            Value::Array(a) => (0..a.len()).map(|i| i.to_string()).collect(),
            Value::Object(m) => m.keys().cloned().collect(),
            _ => Vec::new(),
        }
    };
    let at = |v: &Value, k: &str| match v {
        Value::Array(a) => k.parse::<usize>().ok().and_then(|i| a.get(i)).cloned(),
        Value::Object(m) => m.get(k).cloned(),
        _ => None,
    };
    let mut all = keys(was);
    all.extend(keys(now).into_iter().filter(|k| !keys(was).contains(k)));
    for k in all {
        let (a, b) = (
            at(was, &k).unwrap_or(Value::Null),
            at(now, &k).unwrap_or(Value::Null),
        );
        if !feel(&a) && !feel(&b) {
            continue;
        }
        for field in ["kind", "profile", "seed", "items", "bounds"] {
            if let Some(p) = first_apart(&a[field], &b[field], format!("checks/{k}/{field}")) {
                return Some(p);
            }
        }
    }
    None
}

/// The path of the first place two values differ, deepest first.
fn first_apart(a: &Value, b: &Value, at: String) -> Option<String> {
    match (a, b) {
        (Value::Object(x), Value::Object(y)) => {
            let mut keys: Vec<&String> = x.keys().chain(y.keys()).collect();
            keys.sort();
            keys.dedup();
            keys.into_iter().find_map(|k| {
                let none = Value::Null;
                let (p, q) = (x.get(k).unwrap_or(&none), y.get(k).unwrap_or(&none));
                first_apart(p, q, format!("{at}/{k}"))
            })
        }
        (Value::Array(x), Value::Array(y)) if x.len() == y.len() => x
            .iter()
            .zip(y)
            .enumerate()
            .find_map(|(i, (p, q))| first_apart(p, q, format!("{at}/{i}"))),
        _ => (a != b).then_some(at),
    }
}

/// net.feel's run and its report: `readings`, one a copy, and `failures`.
pub fn feel<S: Stepper>(
    cfg: &Config,
    card: &Card,
    ask: &Ask,
    make: &mut dyn FnMut(u8) -> Result<S, Value>,
    feel: &Feel,
) -> Result<(Played<S>, Value), Value> {
    let cfg = Config {
        players: feel.players.unwrap_or(cfg.players),
        ..cfg.clone()
    };
    let ask = Ask {
        steps: feel.steps,
        faults: Faults {
            seed: feel.seed,
            profile: Some(feel.profile.clone()),
            ..ask.faults.clone()
        },
        ..ask.clone()
    };
    let played = play(&cfg, card, &ask, make)?;
    let mut readings = Vec::new();
    let mut failures = Vec::new();
    for c in &played.copies {
        let r = c.feel(feel.steps);
        let me = c.me;
        if let Some(end) = c.end().filter(|e| *e != End::Left) {
            let waited = &r["waiting"];
            let what = match end {
                End::Timeout => format!(
                    "copy {me} waited for player {}'s message for match step {} past its deadline",
                    waited["player"], waited["step"]
                ),
                _ => format!("copy {me}'s match ended {}", end.name()),
            };
            failures.push(json!({"copy": me, "reading": "end", "value": end.name(),
                                 "step": waited["step"], "player": waited["player"], "what": what}));
        }
        let bounded = [
            (
                "stall_ms_per_min",
                &r["stall_ms_per_min"],
                feel.bounds.stall,
                "ms a minute",
            ),
            (
                "depth_p99",
                &r["depth"]["p99"],
                feel.bounds.depth_p99,
                "steps",
            ),
            (
                "correction_p99",
                &r["correction"]["p99"],
                feel.bounds.correction_p99,
                "m",
            ),
        ];
        for (reading, value, bound, unit) in bounded {
            let (Some(v), Some(b)) = (value.as_f64(), bound) else {
                continue;
            };
            if v > b {
                failures.push(json!({"copy": me, "reading": reading, "value": v, "bound": b,
                    "what": format!("copy {me}'s {reading} reads {v:.3} {unit}, past its bound of {b} {unit}")}));
            }
        }
        readings.push(r);
    }
    let verdict = if failures.is_empty() { "PASS" } else { "FAIL" };
    let report = json!({"kind": "net.feel", "verdict": verdict, "failures": failures,
        "players": cfg.players, "steps": feel.steps, "window": cfg.window, "delay": cfg.delay,
        "items": feel.items, "readings": readings});
    Ok((played, report))
}

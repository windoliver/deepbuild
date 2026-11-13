//! Bursts (Particles `particles@1`: occurrence bursts): stated bursts, each matching row of a
//! baked occurrence list, or another item's particles' births or deaths, made into one table
//! sorted by time. Particle j of burst b is a closed form of its age, j, b and the seed. A slot
//! holds the bursts' particles in birth order, the n-th in slot n mod count, so the GPU finds a
//! slot's particle by binary search; a table whose births would ever need more live slots than
//! the item's count is refused at check, naming the peak.

use deep_canvas::expr::{Expr, Resolve};
use serde_json::Value;

use super::spec::{Refusal, Spec, MAX_BURST};
use super::V3;

/// Flicks a second (Units and axes: time).
const FLICKS: f64 = 705_600_000.0;

/// One burst: when, where, the surface normal and speed there, the velocity its particles
/// inherit from a parent, how many particles it holds, and the birth index of its first.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Row {
    pub t: f64,
    pub point: V3,
    pub normal: V3,
    pub speed: f64,
    pub velocity: V3,
    pub count: u32,
    pub first: u64,
}

/// Every burst of an item, in time order.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Table {
    pub rows: Vec<Row>,
}

/// A burst before it's numbered.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Event {
    pub t: f64,
    pub point: V3,
    pub normal: V3,
    pub speed: f64,
    pub velocity: V3,
    pub count: u32,
}

impl Table {
    /// The table of `events`, sorted by time (ties keep their order).
    pub fn of(mut events: Vec<Event>) -> Table {
        events.sort_by(|a, b| a.t.total_cmp(&b.t));
        let mut first = 0u64;
        let rows = events
            .into_iter()
            .map(|e| {
                let r = Row {
                    t: e.t,
                    point: e.point,
                    normal: e.normal,
                    speed: e.speed,
                    velocity: e.velocity,
                    count: e.count,
                    first,
                };
                first += u64::from(e.count);
                r
            })
            .collect();
        Table { rows }
    }

    /// Slot `e`'s latest particle at t among `count` slots: its burst's row and its index in the
    /// burst.
    pub fn slot(&self, e: u32, count: u32, t: f64) -> Option<(usize, u32)> {
        let born_by = self.rows.partition_point(|r| r.t <= t);
        let total = self.rows[..born_by]
            .last()
            .map_or(0, |r| r.first + u64::from(r.count));
        let (e, n) = (u64::from(e), u64::from(count.max(1)));
        if total == 0 || total - 1 < e {
            return None;
        }
        let g = e + n * ((total - 1 - e) / n);
        let b = self
            .rows
            .partition_point(|r| r.first + u64::from(r.count) <= g);
        Some((b, (g - self.rows[b].first) as u32))
    }

    /// The most particles born within any span of `life` seconds: the slots the bursts ever need
    /// at once.
    pub fn peak(&self, life: f64) -> u64 {
        let (mut best, mut sum, mut lo) = (0u64, 0u64, 0usize);
        for r in &self.rows {
            sum += u64::from(r.count);
            while self.rows[lo].t <= r.t - life {
                sum -= u64::from(self.rows[lo].count);
                lo += 1;
            }
            best = best.max(sum);
        }
        best
    }
}

/// `emit.bursts`: each at the emitter's origin.
pub fn stated(spec: &Spec, origin: V3) -> Vec<Event> {
    spec.bursts
        .iter()
        .map(|b| Event {
            t: b.t,
            point: origin,
            normal: [0.0; 3],
            speed: 0.0,
            velocity: [0.0; 3],
            count: b.count,
        })
        .collect()
}

struct Nothing;
impl Resolve for Nothing {}

/// The cap on a `where` or `count` expression's ops.
const OPS: usize = 64;

/// `emit.on: {list, kinds, where, count, max_bursts, cooldown}` over the document's baked lists:
/// each matching row a burst at its time and point, at most `max_bursts`, a pair (a, b) bursting
/// again only `cooldown` after its last. A list the document hasn't baked is `unbaked_list`; a
/// count past 256 is refused, naming the peak.
pub fn from_list(id: &str, on: &Value, doc: &Value) -> Result<Vec<Event>, Refusal> {
    let at = |f: &str| format!("items/{id}/params/emit/on/{f}");
    let list = on["list"].as_str().unwrap_or_default();
    let rows = doc["occurrences"][list].as_array().ok_or_else(|| {
        Refusal::new(
            "unbaked_list",
            at("list"),
            format!("{id}: bursts read {list}, which no bake has written: bursts come only from a baked occurrence list"),
        )
        .with(Value::from(list))
    })?;
    let kinds: Vec<&str> = on["kinds"]
        .as_array()
        .map(|k| k.iter().filter_map(Value::as_str).collect())
        .unwrap_or_default();
    let compile = |f: &str, default: &str| -> Result<Expr, Refusal> {
        let text = match &on[f] {
            Value::Null => default.to_string(),
            Value::String(s) => s.clone(),
            other => other.to_string(),
        };
        Expr::compile(&text, &Nothing, OPS).map_err(|r| {
            Refusal::new(
                "bad_doc",
                at(f),
                format!("{id}: emit.on.{f} `{text}`: {}", r.why),
            )
        })
    };
    let test = match on["where"] {
        Value::Null => None,
        _ => Some(compile("where", "1")?),
    };
    let count = compile("count", "12")?;
    let max = on["max_bursts"].as_u64().unwrap_or(256) as usize;
    let cooldown = seconds(&on["cooldown"]).unwrap_or(0.03);
    let vars = |e: &Expr, row: &Value| -> Vec<f64> {
        e.vars
            .iter()
            .map(|v| row[v.as_str()].as_f64().unwrap_or(f64::NAN))
            .collect()
    };
    let mut last: Vec<((u64, u64), f64)> = Vec::new();
    let mut out = Vec::new();
    let mut peak = 0.0f64;
    for row in rows {
        if out.len() >= max {
            break;
        }
        let kind = row["kind"].as_str().unwrap_or_default();
        if !kinds.is_empty() && !kinds.contains(&kind) {
            continue;
        }
        if let Some(e) = &test {
            let v = e.eval_num(&vars(e, row));
            if !(v.is_finite() && v != 0.0) {
                continue;
            }
        }
        let t = row["t"].as_f64().unwrap_or(0.0) / FLICKS;
        let pair = (
            row["a"].as_u64().unwrap_or(0),
            row["b"].as_u64().unwrap_or(0),
        );
        let pair = (pair.0.min(pair.1), pair.0.max(pair.1));
        if let Some((_, when)) = last.iter_mut().find(|(p, _)| *p == pair) {
            if t - *when < cooldown {
                continue;
            }
            *when = t;
        } else {
            last.push((pair, t));
        }
        let n = count.eval_num(&vars(&count, row));
        let n = if n.is_finite() {
            n.round().max(0.0)
        } else {
            0.0
        };
        peak = peak.max(n);
        let v3 = |k: &str| -> V3 {
            let a = row[k].as_array();
            [0, 1, 2].map(|i| {
                a.and_then(|a| a.get(i))
                    .and_then(Value::as_f64)
                    .unwrap_or(0.0)
            })
        };
        out.push(Event {
            t,
            point: v3("point"),
            normal: v3("normal"),
            speed: row["speed"].as_f64().unwrap_or(0.0),
            velocity: [0.0; 3],
            count: n.min(f64::from(u32::MAX)) as u32,
        });
    }
    if peak > f64::from(MAX_BURST) {
        return Err(Refusal::new(
            "out_of_range",
            at("count"),
            format!("{id}: a burst's count reaches {peak}, past its cap of {MAX_BURST}"),
        )
        .with(serde_json::json!({"peak": peak, "cap": MAX_BURST})));
    }
    Ok(out)
}

/// A duration in seconds: a number of seconds, or text such as `30 ms` or `0.5 s`.
fn seconds(v: &Value) -> Option<f64> {
    if let Some(x) = v.as_f64() {
        return Some(x);
    }
    let s = v.as_str()?.trim();
    let (num, unit) = s
        .find(|c: char| c.is_alphabetic())
        .map_or((s, "s"), |k| (&s[..k], s[k..].trim()));
    let x: f64 = num.trim().parse().ok()?;
    Some(match unit {
        "ms" => x / 1000.0,
        "s" => x,
        _ => return None,
    })
}

/// The refusal when the bursts' peak passes the item's count.
pub fn over_count(id: &str, peak: u64, count: u32) -> Option<Refusal> {
    (peak > u64::from(count)).then(|| {
        Refusal::new(
            "out_of_range",
            format!("items/{id}/params/count"),
            format!(
                "{id}: its bursts reach a peak of {peak} live particles, past its count of {count}"
            ),
        )
        .with(serde_json::json!({"peak": peak, "count": count}))
    })
}

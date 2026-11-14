//! Between-step services (canvas primitives: Logic: between-step services; #213): questions a
//! logic item asks a first-party canvas module between its steps, such as the physics module's
//! `physics.cast@1`. Step k writes its requests at `services_at`; right after it, before any
//! checkpoint or step k + 1, the module hands each service its requests in order and writes the
//! answers into the item's result region, so the program reads them one step after it asked and
//! seeking equals playing. A count past `max_per_step` traps `services`, and each answered request
//! charges its `fuel_per_request` to step k + 1. The logic module only reads the registry
//! `logic.service@1`: the host binds each entry's native answer, so this crate names no module.

use std::fmt;
use std::rc::Rc;

use serde_json::{json, Map, Value};

use crate::piece::{align8, clash, h64, refusal, Item, PAGE};

/// A service's answers to `requests` (each `request` bytes) for the step at `t` flicks: each
/// request's result, `result` bytes, in order; Err names why it couldn't answer.
pub type Answer = Rc<dyn Fn(i64, &[u8]) -> Result<Vec<u8>, String>>;

/// A between-step service as the host binds it: its entry in `logic.service@1` and its answer.
#[derive(Clone)]
pub struct Service {
    pub name: String,
    pub request: u32,
    pub result: u32,
    pub max_per_step: u32,
    pub fuel_per_request: i64,
    pub answer: Answer,
}

impl fmt::Debug for Service {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "Service({})", self.name)
    }
}

/// A service an item asks, with its own cap, and where its part of the services region starts.
/// The part: a u32 count, 4 zero bytes and `max` requests, then, 8-aligned, a u32 count, 4 zero
/// bytes and `max` results.
#[derive(Clone, Debug)]
pub struct Asked {
    pub service: Service,
    pub max: u32,
    pub at: u32,
}

impl Asked {
    /// The request count's offset in the services region; the requests follow 8 bytes on.
    pub fn requests(&self) -> u32 {
        self.at
    }
    /// The result count's offset in the services region; the results follow 8 bytes on.
    pub fn results(&self) -> u32 {
        align8(self.at + 8 + self.max * self.service.request)
    }
    fn end(&self) -> u32 {
        align8(self.results() + 8 + self.max * self.service.result)
    }
}

/// The bytes of an item's services region.
pub(crate) fn size(item: &Item) -> u32 {
    item.services.last().map_or(0, Asked::end)
}

/// The `services` an item declares: `{name@major → {max_per_step}}`, in declaration order.
pub(crate) fn declared(v: Option<&Value>) -> Result<Vec<(String, u32)>, String> {
    let Some(v) = v else { return Ok(Vec::new()) };
    let map = v
        .as_object()
        .ok_or("services maps each service's name@major to {max_per_step}")?;
    map.iter()
        .map(|(name, s)| {
            let max = s
                .get("max_per_step")
                .and_then(Value::as_u64)
                .filter(|n| (1..=1024).contains(n))
                .ok_or_else(|| format!("{name}: max_per_step is 1 to 1,024"))?;
            Ok((name.clone(), max as u32))
        })
        .collect()
}

/// Each declared service bound to the build's own, its part placed from `services_at`: refusals
/// naming a service the build doesn't bind or a cap past the service's, and a region the program
/// doesn't export or that passes the end of memory or overlaps another.
pub(crate) fn asked(
    declared: &[(String, u32)],
    bound: &[Service],
    services_at: Option<u32>,
    memory: u64,
    regions: &mut Vec<(&str, u32, u32)>,
) -> Result<Vec<Asked>, Vec<Value>> {
    let mut out = Vec::new();
    let mut refused = Vec::new();
    let mut at = 0;
    for (name, max) in declared {
        let no = |what: String| refusal("services", what, json!({"service": name}));
        match bound.iter().find(|s| &s.name == name) {
            None => refused.push(no(format!("{name}: no service in logic.service@1 answers it in this build; only first-party canvas modules fill that registry"))),
            Some(s) if *max > s.max_per_step => refused.push(no(format!(
                "{name}: max_per_step {max} is past the service's {}",
                s.max_per_step
            ))),
            Some(s) => {
                let a = Asked {
                    service: s.clone(),
                    max: *max,
                    at,
                };
                at = a.end();
                out.push(a);
            }
        }
    }
    if out.is_empty() || !refused.is_empty() {
        return if refused.is_empty() {
            Ok(out)
        } else {
            Err(refused)
        };
    }
    let Some(start) = services_at else {
        return Err(vec![refusal(
            "region",
            "an item that asks services exports services_at, an immutable i32 global holding an address".into(),
            json!({"field": "services"}),
        )]);
    };
    let end = u64::from(start) + u64::from(at);
    if let Some(why) = clash(u64::from(start), end, memory, regions, &[]) {
        return Err(vec![refusal(
            "region",
            format!("the services region, {at} bytes at {start}, {why}"),
            json!({"region": "services"}),
        )]);
    }
    regions.push(("the services region", start, at));
    Ok(out)
}

fn u32_at(memory: &[u8], at: usize) -> u32 {
    u32::from_le_bytes(memory[at..at + 4].try_into().expect("4 bytes"))
}

/// The first service whose request count passes the item's `max_per_step`, and the count.
pub(crate) fn over(item: &Item, memory: &[u8]) -> Option<(String, u32)> {
    item.services.iter().find_map(|a| {
        let n = u32_at(memory, (item.services_at + a.requests()) as usize);
        (n > a.max).then(|| (a.service.name.clone(), n))
    })
}

/// The fuel the answers after the last step charge the next: each answered request's
/// `fuel_per_request`, read from the result counts memory holds, so a seek charges as play does.
pub(crate) fn debt(item: &Item, memory: &[u8]) -> i64 {
    item.services
        .iter()
        .map(|a| {
            let n = u32_at(memory, (item.services_at + a.results()) as usize);
            i64::from(n) * a.service.fuel_per_request
        })
        .sum()
}

/// The result regions as memory holds them before a step, hashed: what logic.determinism compares.
pub(crate) fn results_hash(item: &Item, memory: &[u8]) -> u64 {
    let mut b = Vec::new();
    for a in &item.services {
        let at = (item.services_at + a.results()) as usize;
        let n = u32_at(memory, at).min(a.max) as usize;
        b.extend_from_slice(&memory[at..at + 8 + n * a.service.result as usize]);
    }
    h64(&b)
}

/// Each service's answers to the requests step `k` wrote, against the state that step read (its
/// time, `k` steps of the item's length), written into its result region: the pages written and
/// the requests answered, or the service that couldn't answer and why.
pub(crate) fn serve(
    item: &Item,
    k: i64,
    memory: &mut [u8],
) -> Result<(Vec<u64>, u32), (String, String)> {
    let mut pages = Vec::new();
    let mut answered = 0;
    for a in &item.services {
        let base = item.services_at as usize;
        let n = u32_at(memory, base + a.requests() as usize).min(a.max);
        let out = base + a.results() as usize;
        if n == 0 && u32_at(memory, out) == 0 {
            continue;
        }
        let from = base + a.requests() as usize + 8;
        let asked = memory[from..from + n as usize * a.service.request as usize].to_vec();
        let results =
            (a.service.answer)(k * item.step, &asked).map_err(|e| (a.service.name.clone(), e))?;
        if results.len() != n as usize * a.service.result as usize {
            let what = format!(
                "it answered {} bytes for {n} requests of {} result bytes each",
                results.len(),
                a.service.result
            );
            return Err((a.service.name.clone(), what));
        }
        memory[out..out + 4].copy_from_slice(&n.to_le_bytes());
        memory[out + 8..out + 8 + results.len()].copy_from_slice(&results);
        let last = out + 8 + results.len() - 1;
        pages.extend(out as u64 / PAGE..=last as u64 / PAGE);
        answered += n;
    }
    Ok((pages, answered))
}

/// Each service an item asks, as `deep_query` and the bake list it: its name, cap and where its
/// requests and results start in memory.
pub(crate) fn listed(item: &Item) -> Value {
    let mut out = Map::new();
    for a in &item.services {
        out.insert(
            a.service.name.clone(),
            json!({"max_per_step": a.max, "requests_at": item.services_at + a.requests(),
                   "results_at": item.services_at + a.results(), "request": a.service.request,
                   "result": a.service.result, "fuel_per_request": a.service.fuel_per_request}),
        );
    }
    Value::Object(out)
}

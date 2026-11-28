use serde_json::{json, Map, Value};

use crate::first_party;
use crate::piece::Item;
use crate::track::{Entry, Given};

/// The most nodes and parts a circuit holds (a library's state is sized for them).
pub const NODES: usize = 64;
pub const PARTS: usize = 128;
/// The most frequencies its AC sources may run at (DC is one more).
const FREQUENCIES: usize = 7;
/// The first fails a rule reports.
const SHOWN: usize = 16;

/// A part's kind, by its code in the table.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Kind {
    SourceDc = 1,
    SourceAc,
    Resistor,
    Load,
    Switch,
    Connector,
    Fuse,
    Meter,
    Wire,
    Fault,
    Breaker,
    Rcd,
    Changeover,
    Transformer,
}

impl Kind {
    fn of(name: &str, major: u32) -> Option<Kind> {
        Some(match name {
            "source_dc" => Kind::SourceDc,
            "source_ac" => Kind::SourceAc,
            "resistor" => Kind::Resistor,
            "load" => Kind::Load,
            "switch" => Kind::Switch,
            "connector" => Kind::Connector,
            "fuse" => Kind::Fuse,
            "meter" => Kind::Meter,
            "wire" => Kind::Wire,
            "fault" => Kind::Fault,
            "breaker" if major >= 2 => Kind::Breaker,
            "rcd" if major >= 2 => Kind::Rcd,
            "changeover" if major >= 2 => Kind::Changeover,
            "transformer" if major >= 2 => Kind::Transformer,
            _ => return None,
        })
    }
    fn source(self) -> bool {
        matches!(self, Kind::SourceDc | Kind::SourceAc)
    }
}

/// Where an input or a set value comes from: a control the item reads, by name, or an element
/// of one of the item's own writes, at its offset in the write region and its address in memory.
#[derive(Clone, Debug, PartialEq)]
pub enum Src {
    Control(String),
    Array { offset: usize, address: u32 },
}

/// A number field set by `set_by` within `range`: field j of the part's numbers.
#[derive(Clone, Debug)]
pub struct Set {
    pub field: &'static str,
    pub src: Src,
    pub min: f64,
    pub max: f64,
}

/// A part as the check reads it: its ID and kind, the nodes it joins (`from`, `to`, then a third
/// and fourth: a changeover's `b`, an RCD's neutral pole and a transformer's secondary), what
/// closes it, resets it and tests it, the part it measures, its numbers as the table holds them,
/// and its set fields.
#[derive(Clone, Debug)]
pub struct Part {
    pub id: String,
    pub kind: Kind,
    pub from: Option<usize>,
    pub to: Option<usize>,
    pub n2: Option<usize>,
    pub n3: Option<usize>,
    pub input: Option<Src>,
    pub reset: Option<Src>,
    pub test: Option<Src>,
    pub target: Option<usize>,
    pub x: [f64; 6],
    pub sets: [Option<Set>; 2],
}

/// The circuit an item declares under its interface's major, and the bytes its library reads.
#[derive(Clone, Debug)]
pub struct Circuit {
    pub major: u32,
    pub nodes: Vec<String>,
    pub parts: Vec<Part>,
    pub bytes: Vec<u8>,
}

/// What the check finds an input or a set value by: a number control's slot in the read region,
/// and one of the item's writes by name, `(offset in the write region, address, type, count)`.
pub struct Lookup<'a> {
    pub slot: &'a dyn Fn(&str) -> Option<u32>,
    pub write: &'a dyn Fn(&str) -> Option<Write>,
}

pub type Write = (u32, u32, String, u32);

fn refusal(what: String, part: Option<&str>) -> Value {
    let mut out = json!({"rule": "circuit", "what": what});
    if let Some(p) = part {
        out["part"] = json!(p);
    }
    out
}

/// One of circuit@`major`'s constants, as its first-party pack gives it.
pub fn constant(major: u32, path: &str) -> Option<f64> {
    first_party::packs()
        .iter()
        .find_map(|p| p.pointer(&format!("/interfaces/circuit@{major}/constants/{path}")))
        .and_then(Value::as_f64)
}

pub fn build(v: &Value, major: u32, look: &Lookup) -> Result<Circuit, Vec<Value>> {
    let whole = |what: &str| vec![refusal(what.into(), None)];
    if let Some(k) = v
        .as_object()
        .and_then(|o| o.keys().find(|k| !["nodes", "parts"].contains(&k.as_str())))
    {
        return Err(whole(&format!("circuit has no field {k}")));
    }
    let (Some(nodes_v), Some(parts_v)) = (
        v.get("nodes").and_then(Value::as_array),
        v.get("parts").and_then(Value::as_array),
    ) else {
        return Err(whole("circuit is {nodes: [name], parts: [{id, kind, …}]}"));
    };
    let nodes: Vec<String> = nodes_v
        .iter()
        .map(|n| n.as_str().map(str::to_string))
        .collect::<Option<_>>()
        .ok_or_else(|| whole("circuit.nodes is a list of names"))?;
    if nodes.is_empty() || nodes.len() > NODES || parts_v.len() > PARTS {
        return Err(whole(&format!(
            "a circuit holds 1 to {NODES} nodes and at most {PARTS} parts"
        )));
    }
    if let Some(n) = nodes
        .iter()
        .enumerate()
        .find(|(i, n)| nodes[..*i].contains(*n))
    {
        return Err(whole(&format!("circuit.nodes names {} twice", n.1)));
    }
    let ids: Vec<&str> = parts_v
        .iter()
        .map(|p| p.get("id").and_then(Value::as_str).unwrap_or_default())
        .collect();
    let mut refused = Vec::new();
    let mut parts = Vec::new();
    for (i, p) in parts_v.iter().enumerate() {
        match part_of(p, i, major, &nodes, &ids, parts_v, look) {
            Ok(part) => parts.push(part),
            Err(r) => refused.push(r),
        }
    }
    let mut frequencies: Vec<u64> = Vec::new();
    let mut set_frequencies = 0;
    for p in parts.iter().filter(|p| p.kind == Kind::SourceAc) {
        if p.sets[1].is_some() {
            set_frequencies += 1;
        } else if !frequencies.contains(&p.x[1].to_bits()) {
            frequencies.push(p.x[1].to_bits());
        }
    }
    if frequencies.len() + set_frequencies > FREQUENCIES {
        refused.push(refusal(
            format!("a circuit's AC sources run at most {FREQUENCIES} frequencies"),
            None,
        ));
    }
    if refused.is_empty() && major >= 2 {
        refused.extend(no_dc_through_transformers(&nodes, &parts));
    }
    if !refused.is_empty() {
        return Err(refused);
    }
    let bytes = if major >= 2 {
        table2(&nodes, &parts, look)?
    } else {
        table1(&nodes, &parts, look)?
    };
    Ok(Circuit {
        major,
        nodes,
        parts,
        bytes,
    })
}

fn i32s(b: &mut Vec<u8>, xs: &[i32]) {
    xs.iter().for_each(|x| b.extend(x.to_le_bytes()));
}

/// circuit@1's table (packs/circuit-1.0.0/LAYOUT.md): a header of 64 bytes, then 64 a part.
fn table1(nodes: &[String], parts: &[Part], look: &Lookup) -> Result<Vec<u8>, Vec<Value>> {
    let mut refused = Vec::new();
    let mut bytes = Vec::with_capacity(64 + 64 * parts.len());
    i32s(&mut bytes, &[1, nodes.len() as i32, parts.len() as i32, 64]);
    bytes.resize(64, 0);
    for p in parts {
        let at = |o: &Option<usize>| o.map_or(-1, |n| n as i32);
        let input = |src: &Option<Src>| -> Result<i32, Value> {
            match src {
                None => Ok(-1),
                Some(Src::Control(n)) => slot_of(look, n, &p.id),
                Some(Src::Array { .. }) => unreachable!("circuit@1 takes controls only"),
            }
        };
        let (closed, reset) = match (input(&p.input), input(&p.reset)) {
            (Ok(a), Ok(b)) => (a, b),
            (a, b) => {
                refused.extend(a.err());
                refused.extend(b.err());
                continue;
            }
        };
        i32s(
            &mut bytes,
            &[
                p.kind as i32,
                at(&p.from),
                at(&p.to),
                closed,
                at(&p.target),
                reset,
                0,
                0,
            ],
        );
        p.x[..4].iter().for_each(|x| bytes.extend(x.to_le_bytes()));
    }
    if refused.is_empty() {
        Ok(bytes)
    } else {
        Err(refused)
    }
}

fn slot_of(look: &Lookup, name: &str, part: &str) -> Result<i32, Value> {
    (look.slot)(name).map(|o| o as i32).ok_or_else(|| {
        refusal(
            format!("part {part} is closed by {name}, which the item doesn't read as a number control (its reads)"),
            Some(part),
        )
    })
}

/// circuit@2's table (packs/circuit-2.0.0/LAYOUT.md): a header of 64 bytes, then 160 a part.
fn table2(nodes: &[String], parts: &[Part], look: &Lookup) -> Result<Vec<u8>, Vec<Value>> {
    let mut refused = Vec::new();
    let mut bytes = Vec::with_capacity(64 + 160 * parts.len());
    i32s(&mut bytes, &[2, nodes.len() as i32, parts.len() as i32, 64]);
    bytes.resize(64, 0);
    for p in parts {
        let at = |o: &Option<usize>| o.map_or(-1, |n| n as i32);
        let start = bytes.len();
        i32s(
            &mut bytes,
            &[
                p.kind as i32,
                at(&p.from),
                at(&p.to),
                at(&p.n2),
                at(&p.n3),
                at(&p.target),
            ],
        );
        for src in [&p.input, &p.reset, &p.test] {
            let (mode, address) = match src {
                None => (0, -1),
                Some(Src::Control(n)) => match slot_of(look, n, &p.id) {
                    Ok(s) => (1, s),
                    Err(r) => {
                        refused.push(r);
                        (0, -1)
                    }
                },
                Some(Src::Array { address, .. }) => (2, *address as i32),
            };
            i32s(&mut bytes, &[mode, address]);
        }
        p.x.iter().for_each(|x| bytes.extend(x.to_le_bytes()));
        for set in &p.sets {
            let (mode, address, min, max) = match set {
                None => (0, -1, 0.0, 0.0),
                Some(s) => match &s.src {
                    Src::Control(n) => match (look.slot)(n) {
                        Some(o) => (1, o as i32, s.min, s.max),
                        None => {
                            refused.push(refusal(
                                format!("part {} has {} set by {n}, which the item doesn't read as a number control (its reads)", p.id, s.field),
                                Some(&p.id),
                            ));
                            (0, -1, 0.0, 0.0)
                        }
                    },
                    Src::Array { address, .. } => (2, *address as i32, s.min, s.max),
                },
            };
            i32s(&mut bytes, &[mode, address]);
            bytes.extend(min.to_le_bytes());
            bytes.extend(max.to_le_bytes());
        }
        bytes.resize(start + 160, 0);
    }
    if refused.is_empty() {
        Ok(bytes)
    } else {
        Err(refused)
    }
}

fn no_dc_through_transformers(nodes: &[String], parts: &[Part]) -> Vec<Value> {
    let mut up: Vec<usize> = (0..nodes.len()).collect();
    fn find(up: &mut [usize], v: usize) -> usize {
        let mut v = v;
        while up[v] != v {
            v = up[v];
        }
        v
    }
    let mut join = |a: Option<usize>, b: Option<usize>| {
        if let (Some(a), Some(b)) = (a, b) {
            let (ra, rb) = (find(&mut up, a), find(&mut up, b));
            up[ra.max(rb)] = ra.min(rb);
        }
    };
    for p in parts {
        match p.kind {
            Kind::Meter | Kind::Wire => {}
            Kind::Changeover => {
                join(p.from, p.to);
                join(p.from, p.n2);
            }
            Kind::Rcd => {
                join(p.from, p.to);
                join(p.n2, p.n3);
                if p.x[1] > 0.0 {
                    join(p.to, p.n2);
                }
            }
            Kind::Transformer => {
                join(p.from, p.to);
                join(p.n2, p.n3);
            }
            _ => join(p.from, p.to),
        }
    }
    let mut refused = Vec::new();
    for t in parts.iter().filter(|p| p.kind == Kind::Transformer) {
        for (winding, node) in [("primary", t.from), ("secondary", t.n2)] {
            let Some(node) = node else { continue };
            let net = find(&mut up, node);
            for dc in parts.iter().filter(|p| p.kind == Kind::SourceDc) {
                if dc.from.is_some_and(|n| find(&mut up, n) == net) {
                    let mut r = refusal(
                        format!("circuit part {} is a DC source in the network transformer {}'s {winding} joins: an ideal transformer passes no DC", dc.id, t.id),
                        Some(&dc.id),
                    );
                    r["transformer"] = json!(t.id);
                    r["parts"] = json!([dc.id, t.id]);
                    refused.push(r);
                }
            }
        }
    }
    refused
}

/// Part `i` of the declaration under circuit@`major`, or the refusal naming it.
fn part_of(
    p: &Value,
    i: usize,
    major: u32,
    nodes: &[String],
    ids: &[&str],
    all: &[Value],
    look: &Lookup,
) -> Result<Part, Value> {
    let id = p.get("id").and_then(Value::as_str).unwrap_or_default();
    let name = if id.is_empty() {
        format!("parts[{i}]")
    } else {
        id.to_string()
    };
    let bad = |what: String| refusal(format!("circuit part {name} {what}"), Some(&name));
    if id.is_empty() || ids[..i].contains(&id) {
        return Err(bad("needs an id of its own".into()));
    }
    let kind_name = p.get("kind").and_then(Value::as_str).unwrap_or_default();
    let Some(kind) = Kind::of(kind_name, major) else {
        return Err(bad(if major >= 2 {
            format!("is a {kind_name}, which circuit@2 can't model: it solves linear parts only (sources, resistors, loads, switches, connectors, fuses, faults, meters, wires, breakers, RCDs, changeovers and ideal transformers), never a diode, a dimmer that cuts the wave, a motor's back-EMF, an inductor or a capacitor")
        } else {
            format!("is a {kind_name}, which circuit@1 can't model: it solves linear resistive parts only (sources, resistors, loads, switches, connectors, fuses, faults, meters and wires), never a diode, a motor's back-EMF or a filament whose resistance changes with heat")
        }));
    };
    let fields: &[&str] = match kind {
        Kind::SourceDc => &["from", "to", "v", "r_internal"],
        Kind::SourceAc => &["from", "to", "v_rms", "f", "phase", "r_internal"],
        Kind::Resistor => &["from", "to", "r"],
        Kind::Load => &["from", "to", "p_rated", "v_rated"],
        Kind::Switch | Kind::Connector => &["from", "to", "closed_by"],
        Kind::Fuse => &["from", "to", "rating", "curve", "reset_by"],
        Kind::Meter => &["on"],
        Kind::Wire => &["part", "length", "area", "material"],
        Kind::Fault => &["from", "to", "r", "on_by"],
        Kind::Breaker => &["from", "to", "rating", "curve", "reset_by"],
        Kind::Rcd => &["live", "neutral", "rating", "test_r", "test_by", "reset_by"],
        Kind::Changeover => &["common", "a", "b", "at_b_by"],
        Kind::Transformer => &["primary", "secondary", "turns"],
    };
    if let Some(k) = p.as_object().and_then(|o| {
        o.keys()
            .find(|k| !["id", "kind"].contains(&k.as_str()) && !fields.contains(&k.as_str()))
    }) {
        return Err(bad(format!(
            "has no field {k}: a {kind_name} takes {}",
            fields.join(", ")
        )));
    }
    let named = |k: &str, n: &Value| -> Result<usize, Value> {
        let n = n.as_str().unwrap_or_default();
        nodes.iter().position(|x| x == n).ok_or_else(|| {
            bad(format!(
                "names {k} {n:?}, which isn't one of the circuit's nodes"
            ))
        })
    };
    let node = |k: &str| -> Result<Option<usize>, Value> {
        if !fields.contains(&k) {
            return Ok(None);
        }
        named(k, p.get(k).unwrap_or(&Value::Null)).map(Some)
    };
    let pair = |k: &str| -> Result<(Option<usize>, Option<usize>), Value> {
        match p.get(k).and_then(Value::as_array).map(Vec::as_slice) {
            Some([a, b]) => {
                let (a, b) = (named(k, a)?, named(k, b)?);
                if a == b {
                    return Err(bad(format!("joins {k}'s node to itself")));
                }
                Ok((Some(a), Some(b)))
            }
            _ => Err(bad(format!(
                "needs {k}, [from, to]: two of the circuit's nodes"
            ))),
        }
    };
    let (from, to, n2, n3) = match kind {
        Kind::Rcd => {
            let ((a, b), (c, d)) = (pair("live")?, pair("neutral")?);
            (a, b, c, d)
        }
        Kind::Transformer => {
            let ((a, b), (c, d)) = (pair("primary")?, pair("secondary")?);
            (a, b, c, d)
        }
        Kind::Changeover => {
            let (c, a, b) = (node("common")?, node("a")?, node("b")?);
            if c == a || c == b || a == b {
                return Err(bad("joins common, a and b, which are three nodes".into()));
            }
            (c, a, b, None)
        }
        _ => {
            let (f, t) = (node("from")?, node("to")?);
            if f.is_some() && f == t {
                return Err(bad("joins a node to itself".into()));
            }
            (f, t, None, None)
        }
    };
    let array = |k: &str, given: &Value, types: &[&str]| -> Result<Src, Value> {
        let text = given.as_str().unwrap_or_default();
        let parsed = text
            .strip_suffix(']')
            .and_then(|t| t.split_once('['))
            .and_then(|(n, i)| Some((n, i.parse::<u32>().ok()?)));
        let Some((array, index)) = parsed else {
            return Err(bad(format!("has {k} {{array: {text:?}}}: an array is <name>[<index>], one of the item's own writes")));
        };
        if array.contains('.') {
            return Err(bad(format!("has {k} {{array: {text:?}}}, an array of another item: only the item's own arrays drive its circuit")));
        }
        match (look.write)(array) {
            Some((offset, address, ty, count)) if types.contains(&ty.as_str()) && index < count => {
                let size = if ty == "f64" { 8 } else { 4 };
                Ok(Src::Array {
                    offset: (offset + size * index) as usize,
                    address: address + size * index,
                })
            }
            Some((_, _, ty, count)) => Err(bad(format!(
                "has {k} {{array: {text:?}}}: {array} is {count} {ty}, and {k} takes an element of {} the item writes",
                types.join(" or ")
            ))),
            None => Err(bad(format!(
                "has {k} {{array: {text:?}}}, which isn't one of the item's own writes"
            ))),
        }
    };
    let number = |k: &str,
                  default: Option<f64>,
                  ok: &dyn Fn(f64) -> bool,
                  what: &str|
     -> Result<f64, Value> {
        match p.get(k) {
            None => default.ok_or_else(|| bad(format!("needs {k}, {what}"))),
            Some(v) => v
                .as_f64()
                .filter(|x| x.is_finite() && ok(*x))
                .ok_or_else(|| bad(format!("has {k} {v}: {k} is {what}"))),
        }
    };
    let settable = |k: &'static str,
                    ok: &dyn Fn(f64) -> bool,
                    what: &str|
     -> Result<(f64, Option<Set>), Value> {
        match p.get(k) {
            Some(Value::Object(o)) if major >= 2 => {
                if let Some(extra) = o
                    .keys()
                    .find(|x| !["set_by", "range"].contains(&x.as_str()))
                {
                    return Err(bad(format!(
                        "has {k}.{extra}: a set {k} is {{set_by, range: [min, max]}}"
                    )));
                }
                let range = o
                    .get("range")
                    .and_then(Value::as_array)
                    .and_then(|r| match r.as_slice() {
                        [a, b] => Some((a.as_f64()?, b.as_f64()?)),
                        _ => None,
                    })
                    .filter(|(a, b)| a.is_finite() && b.is_finite() && a <= b && ok(*a) && ok(*b))
                    .ok_or_else(|| {
                        bad(format!("has {k} set without a range it can take: range is [min, max], min ≤ max, each {what}"))
                    })?;
                let src = match o.get("set_by") {
                    Some(Value::String(c)) if !c.is_empty() => Src::Control(c.clone()),
                    Some(Value::Object(a)) if a.len() == 1 && a.contains_key("array") => {
                        array(&format!("{k}.set_by"), &a["array"], &["f64"])?
                    }
                    _ => {
                        return Err(bad(format!(
                            "needs {k}.set_by, a number control the item reads or {{array: <name>[<index>]}}, an f64 of its own writes"
                        )))
                    }
                };
                Ok((
                    0.0,
                    Some(Set {
                        field: k,
                        src,
                        min: range.0,
                        max: range.1,
                    }),
                ))
            }
            _ => number(k, None, ok, what).map(|x| (x, None)),
        }
    };
    let positive = |x: f64| x > 0.0;
    let at_least_0 = |x: f64| x >= 0.0;
    let any = |_: f64| true;
    let text = |k: &str| p.get(k).and_then(Value::as_str).map(str::to_string);
    let input = |k: &str, optional: bool| -> Result<Option<Src>, Value> {
        match p.get(k) {
            None if optional => Ok(None),
            Some(Value::String(s)) if !s.is_empty() => Ok(Some(Src::Control(s.clone()))),
            Some(Value::Object(a)) if major >= 2 && a.len() == 1 && a.contains_key("array") => {
                array(k, &a["array"], &["bool", "i32"]).map(Some)
            }
            _ if major >= 2 => Err(bad(format!(
                "needs {k}, a control the item reads or {{array: <name>[<index>]}}, a bool or i32 of its own writes"
            ))),
            _ => Err(bad(format!(
                "needs {k}, the name of a control the item reads"
            ))),
        }
    };
    let measured = |k: &str| -> Result<Option<usize>, Value> {
        let on = p.get(k).and_then(Value::as_str).unwrap_or_default();
        match ids.iter().position(|x| *x == on) {
            Some(j)
                if j != i
                    && !matches!(
                        all[j].get("kind").and_then(Value::as_str),
                        Some("meter" | "wire")
                    ) =>
            {
                Ok(Some(j))
            }
            _ => Err(bad(format!(
                "names {k} {on:?}, which isn't another part of the circuit that carries current"
            ))),
        }
    };
    let mut x = [0.0; 6];
    let mut sets: [Option<Set>; 2] = [None, None];
    let (mut input_src, mut reset, mut test, mut target) = (None, None, None, None);
    match kind {
        Kind::SourceDc => {
            (x[0], sets[0]) = settable("v", &any, "volts")?;
            x[2] = number("r_internal", Some(0.0), &at_least_0, "ohms, 0 or more")?;
        }
        Kind::SourceAc => {
            (x[0], sets[0]) = settable("v_rms", &at_least_0, "rms volts, 0 or more")?;
            (x[1], sets[1]) = settable("f", &positive, "hertz, more than 0")?;
            x[2] = number("r_internal", Some(0.0), &at_least_0, "ohms, 0 or more")?;
            x[3] = number("phase", Some(0.0), &any, "degrees")?;
        }
        Kind::Resistor => (x[0], sets[0]) = settable("r", &at_least_0, "ohms, 0 or more")?,
        Kind::Fault => {
            (x[0], sets[0]) = settable("r", &at_least_0, "ohms, 0 or more")?;
            input_src = input("on_by", false)?;
        }
        Kind::Load => {
            (x[0], sets[0]) = settable("p_rated", &positive, "watts, more than 0")?;
            (x[1], sets[1]) = settable("v_rated", &positive, "volts, more than 0")?;
        }
        Kind::Switch | Kind::Connector => input_src = input("closed_by", false)?,
        Kind::Fuse => {
            x[0] = number("rating", None, &positive, "amperes, more than 0")?;
            let curve = text("curve").unwrap_or_else(|| "fast".into());
            x[1] = constant(major, &format!("curves/{curve}/tau"))
                .filter(|_| p.get("curve").is_none_or(Value::is_string))
                .ok_or_else(|| {
                    bad(format!(
                        "has curve {curve:?}: a fuse's curve is fast or slow"
                    ))
                })?;
            reset = input("reset_by", true)?;
        }
        Kind::Breaker => {
            x[0] = number("rating", None, &positive, "amperes, more than 0")?;
            let curve = text("curve").unwrap_or_else(|| "B".into());
            x[1] = constant(major, &format!("breaker/curves/{curve}/multiple"))
                .filter(|_| p.get("curve").is_none_or(Value::is_string))
                .ok_or_else(|| {
                    bad(format!(
                        "has curve {curve:?}: a breaker's curve is B, C or D"
                    ))
                })?;
            x[2] = constant(major, "breaker/tau/value").unwrap_or(f64::NAN);
            x[3] = constant(major, "breaker/heat_open/value").unwrap_or(f64::NAN);
            reset = input("reset_by", true)?;
        }
        Kind::Rcd => {
            x[0] = number("rating", Some(0.03), &positive, "amperes, more than 0")?;
            x[1] = match p.get("test_r") {
                None => 0.0,
                Some(_) => number("test_r", None, &positive, "ohms, more than 0")?,
            };
            x[2] = constant(major, "rcd/time/value").unwrap_or(f64::NAN);
            x[3] = constant(major, "rcd/floor/value").unwrap_or(f64::NAN);
            test = input("test_by", true)?;
            reset = input("reset_by", true)?;
        }
        Kind::Changeover => input_src = input("at_b_by", false)?,
        Kind::Transformer => {
            let turns = p
                .get("turns")
                .and_then(Value::as_array)
                .and_then(|t| match t.as_slice() {
                    [a, b] => Some((a.as_f64()?, b.as_f64()?)),
                    _ => None,
                })
                .filter(|(a, b)| a.is_finite() && b.is_finite() && *a > 0.0 && *b > 0.0)
                .ok_or_else(|| bad("needs turns, [n1, n2], each more than 0".into()))?;
            (x[0], x[1]) = turns;
        }
        Kind::Meter => target = measured("on")?,
        Kind::Wire => {
            target = measured("part")?;
            x[0] = number("length", None, &positive, "metres, more than 0")?;
            x[1] = number("area", None, &positive, "mm², more than 0")?;
            let material = text("material").unwrap_or_else(|| "copper".into());
            x[2] = constant(major, &format!("carriers/{material}/value"))
                .filter(|_| p.get("material").is_none_or(Value::is_string))
                .ok_or_else(|| {
                    bad(format!(
                        "has material {material:?}: a wire is copper or aluminium"
                    ))
                })?;
        }
    }
    Ok(Part {
        id: id.to_string(),
        kind,
        from,
        to,
        n2,
        n3,
        input: input_src,
        reset,
        test,
        target,
        x,
        sets,
    })
}

// ---------------------------------------------------------------------------------------------
// The judge.

/// An array the rules read: its byte offset in the write region and its element count.
#[derive(Clone, Copy)]
struct At(usize, usize);

/// A rule's reading: whether it failed, and its first fails.
#[derive(Default)]
struct Rule(bool, Vec<Value>);
impl Rule {
    fn fail(&mut self, v: Value) {
        self.0 = true;
        if self.1.len() < SHOWN {
            self.1.push(v);
        }
    }
    fn json(&self, steps: i64) -> Value {
        json!({"verdict": if self.0 { "FAIL" } else { "PASS" }, "steps": steps, "fails": self.1})
    }
}

/// A fuse or a breaker as the judge follows it: its heat by the pack's curve from the library's
/// rms current, the step its elements give it open, whether the library has it open, the current
/// it last carried, and a breaker's magnetic multiple of its rating (a fuse's is none).
struct Protect {
    part: usize,
    rating: f64,
    cool: f64,
    theta: f64,
    open_at: f64,
    multiple: Option<f64>,
    open: bool,
    due: Option<i64>,
    last_rms: f64,
}

/// An RCD as the judge follows it: its count from the residual it reads, the step that gives it
/// open, whether the library has it open, and its last residual.
struct Count {
    part: usize,
    count: f64,
    open: bool,
    due: Option<i64>,
    residual: Option<f64>,
    /// Its poles' rms currents at the step before, which say whether a crossing changed nothing.
    poles: (f64, f64),
}

/// A set field as the judge follows it: its part, field index, latest value as given and value
/// held to its range.
struct Held {
    part: usize,
    j: usize,
    given: f64,
    held: f64,
}

/// The judge's reading of one item's run, step by step.
pub struct Judge<'a> {
    circuit: &'a Circuit,
    dt: f64,
    kcl_tolerance: f64,
    power_tolerance: f64,
    i: At,
    i_rms: At,
    p: At,
    on: At,
    energy: At,
    v: Option<At>,
    r: Option<At>,
    i2: Option<At>,
    i2_rms: Option<At>,
    residual: Option<At>,
    steps: i64,
    sums: Vec<f64>,
    fuses: Vec<Protect>,
    breakers: Vec<Protect>,
    rcds: Vec<Count>,
    held: Vec<Held>,
    /// Each control a set field reads: its value at each step it changes, by step.
    controls: Map<String, Value>,
    /// Whether every source runs at one frequency and phase, so every current is in phase or
    /// against it and an RCD's residual is the signed sum of its poles' rms currents.
    in_phase: bool,
    kcl: Rule,
    power: Rule,
    fuse: Rule,
    breaker: Rule,
    rcd: Rule,
    range: Rule,
}

fn f64_at(b: &[u8], o: usize) -> f64 {
    f64::from_le_bytes(b[o..o + 8].try_into().unwrap())
}
fn i32_at(b: &[u8], o: usize) -> i32 {
    i32::from_le_bytes(b[o..o + 4].try_into().unwrap())
}

/// The value a control holds at each step its entries change it, as a library reads its slot:
/// the last of the step's first 16 entries; `[[step, value]]` in step order.
fn control_values(entries: &[Entry], name: &str, step: i64) -> Vec<(i64, f64)> {
    let mut taken: Vec<(i64, u32, f64)> = Vec::new();
    let mut list: Vec<&Entry> = entries.iter().filter(|e| e.control == name).collect();
    list.sort_by_key(|e| (e.t, e.seq));
    let mut per: Vec<(i64, Vec<f64>)> = Vec::new();
    for e in list {
        let Given::Number(v) = e.value else { continue };
        let k = e.t.div_euclid(step) + i64::from(e.t.rem_euclid(step) != 0);
        match per.last_mut() {
            Some((at, vs)) if *at == k => vs.push(v),
            _ => per.push((k, vec![v])),
        }
    }
    for (k, vs) in per {
        taken.push((k.max(0), 0, vs[vs.len().min(16) - 1]));
    }
    taken.into_iter().map(|(k, _, v)| (k, v)).collect()
}

impl<'a> Judge<'a> {
    pub fn new(
        item: &Item,
        circuit: &'a Circuit,
        rules: &Value,
        entries: &[Entry],
    ) -> Result<Judge<'a>, String> {
        let p = circuit.parts.len();
        let major = circuit.major;
        let lacks = if major >= 2 {
            format!("an item with a circuit@2 circuit writes v, i, i_rms, p, r, energy, i2, i2_rms and residual (f64) and on (i32), {p} of each and v one a node")
        } else {
            format!("an item with circuit writes i, i_rms, p and energy (f64) and on (i32), {p} of each")
        };
        let need = |name: &str, ty: &str, n: usize| {
            item.write(name)
                .filter(|e| e.ty == ty)
                .map(|e| {
                    At(
                        e.offset as usize,
                        e.size as usize / if ty == "f64" { 8 } else { 4 },
                    )
                })
                .filter(|a| a.1 >= n)
                .ok_or_else(|| lacks.clone())
        };
        let maybe = |name: &str, n: usize| -> Result<Option<At>, String> {
            if major >= 2 {
                need(name, "f64", n).map(Some)
            } else {
                Ok(None)
            }
        };
        let interface = format!("circuit@{major}");
        let param = |rule: &str, k: &str| {
            rules
                .pointer(&format!("/{rule}/{k}"))
                .and_then(Value::as_f64)
                .or_else(|| {
                    first_party::packs()
                        .iter()
                        .find_map(|pk| {
                            pk.pointer(&format!("/interfaces/{interface}/rules/{rule}/{k}"))
                        })
                        .and_then(Value::as_f64)
                })
        };
        // The step's length as a library solving once a step at the item's rate takes it: 1 ÷ per.
        let dt = 1.0 / (deep_canvas::grammar::FLICKS_PER_SECOND as f64 / item.step as f64);
        let protect = |(j, x): (usize, &Part)| Protect {
            part: j,
            rating: x.x[0],
            cool: (-dt
                / if x.kind == Kind::Breaker {
                    x.x[2]
                } else {
                    x.x[1]
                })
            .exp(),
            theta: 0.0,
            open_at: if x.kind == Kind::Breaker { x.x[3] } else { 1.0 },
            multiple: (x.kind == Kind::Breaker).then_some(x.x[1]),
            open: false,
            due: None,
            last_rms: 0.0,
        };
        let of = |k: Kind| {
            circuit
                .parts
                .iter()
                .enumerate()
                .filter(move |(_, x)| x.kind == k)
        };
        let mut controls = Map::new();
        let mut held = Vec::new();
        for (j, x) in circuit.parts.iter().enumerate() {
            for (f, s) in x.sets.iter().enumerate() {
                let Some(s) = s else { continue };
                if let Src::Control(c) = &s.src {
                    controls.insert(c.clone(), json!(control_values(entries, c, item.step)));
                }
                held.push(Held {
                    part: j,
                    j: f,
                    given: 0.0,
                    held: 0.0_f64.clamp(s.min, s.max),
                });
            }
        }
        let ac: Vec<&Part> = of(Kind::SourceAc).map(|(_, x)| x).collect();
        let in_phase = of(Kind::SourceDc).next().is_none()
            && ac.iter().all(|x| {
                x.sets[1].is_none()
                    && x.x[1].to_bits() == ac[0].x[1].to_bits()
                    && x.x[3].to_bits() == ac[0].x[3].to_bits()
            });
        let in_phase = in_phase || ac.is_empty();
        Ok(Judge {
            circuit,
            dt,
            kcl_tolerance: param("circuit.kcl", "tolerance").unwrap_or(1e-9),
            power_tolerance: param("circuit.power", "tolerance").unwrap_or(1e-6),
            i: need("i", "f64", p)?,
            i_rms: need("i_rms", "f64", p)?,
            p: need("p", "f64", p)?,
            on: need("on", "i32", p)?,
            energy: need("energy", "f64", p)?,
            v: maybe("v", circuit.nodes.len())?,
            r: maybe("r", p)?,
            i2: maybe("i2", p)?,
            i2_rms: maybe("i2_rms", p)?,
            residual: maybe("residual", p)?,
            steps: 0,
            sums: vec![0.0; p],
            fuses: of(Kind::Fuse).map(protect).collect(),
            breakers: of(Kind::Breaker).map(protect).collect(),
            rcds: of(Kind::Rcd)
                .map(|(j, _)| Count {
                    part: j,
                    count: 0.0,
                    open: false,
                    due: None,
                    residual: None,
                    poles: (0.0, 0.0),
                })
                .collect(),
            held,
            controls,
            in_phase,
            kcl: Rule::default(),
            power: Rule::default(),
            fuse: Rule::default(),
            breaker: Rule::default(),
            rcd: Rule::default(),
            range: Rule::default(),
        })
    }

    /// Step k's write region.
    pub fn step(&mut self, k: i64, b: &[u8]) {
        self.steps += 1;
        let c = self.circuit;
        let f = |a: At, j: usize| f64_at(b, a.0 + 8 * j);
        let on_of = |j: usize| i32_at(b, self.on.0 + 4 * j);
        let second = |a: Option<At>, j: usize| a.map_or(0.0, |a| f(a, j));
        let mut sums = vec![0.0; c.nodes.len()];
        let mut flow = |from: Option<usize>, to: Option<usize>, i: f64| {
            if let (Some(a), Some(b)) = (from, to) {
                sums[a] -= i;
                sums[b] += i;
            }
        };
        for (j, x) in c.parts.iter().enumerate() {
            let i = f(self.i, j);
            match x.kind {
                Kind::Changeover => {
                    let way = if on_of(j) == 2 { x.n2 } else { x.to };
                    flow(x.from, way, i);
                }
                Kind::Rcd | Kind::Transformer => {
                    flow(x.from, x.to, i);
                    flow(x.n2, x.n3, second(self.i2, j));
                    if x.kind == Kind::Rcd && x.x[1] > 0.0 && f(self.p, j) > 0.0 {
                        if let (Some(v), Some(l), Some(n)) = (self.v, x.to, x.n2) {
                            flow(x.to, x.n2, (f(v, l) - f(v, n)) / x.x[1]);
                        }
                    }
                }
                _ => flow(x.from, x.to, i),
            }
        }
        for (n, sum) in sums.iter().enumerate() {
            if sum.abs() > self.kcl_tolerance || !sum.is_finite() {
                self.kcl
                    .fail(json!({"step": k, "node": c.nodes[n], "sum": sum}));
            }
        }
        // circuit.power: the sources' mean power against every other part's, and each meter's
        // energy against this judge's own sum of its part's power × the step's length.
        let (mut given, mut taken) = (0.0, 0.0);
        for (j, x) in c.parts.iter().enumerate() {
            if x.kind.source() {
                given += f(self.p, j);
            } else {
                taken += f(self.p, j);
            }
        }
        let gap = given - taken;
        if gap.abs() > self.power_tolerance * given.abs().max(taken.abs()) || !gap.is_finite() {
            self.power.fail(json!({"step": k, "gap": gap}));
        }
        for (j, x) in c.parts.iter().enumerate() {
            let (Kind::Meter, Some(on)) = (x.kind, x.target) else {
                continue;
            };
            self.sums[j] += f(self.p, on) * self.dt;
            let (read, own) = (f(self.energy, j), self.sums[j]);
            let gap = read - own;
            if gap.abs() > self.power_tolerance * read.abs().max(own.abs()) || !gap.is_finite() {
                self.power
                    .fail(json!({"step": k, "meter": x.id, "gap": gap}));
            }
        }
        let (i_rms, i_at) = (self.i_rms, self.i);
        for (u, rule, name) in [
            (&mut self.fuses, &mut self.fuse, "fuse"),
            (&mut self.breakers, &mut self.breaker, "breaker"),
        ] {
            for u in u.iter_mut() {
                let id = &c.parts[u.part].id;
                let on = on_of(u.part) != 0;
                let rms = f(i_rms, u.part);
                let breaker = u.multiple.is_some();
                if !u.open && u.due.is_none() && u.theta >= u.open_at {
                    u.due = Some(k);
                }
                if on && u.open {
                    u.open = false;
                    if !breaker {
                        u.theta = 0.0;
                    }
                    u.due = None;
                } else if !on && !u.open {
                    u.open = true;
                    let expected = u.due.or_else(|| {
                        let m = (u.last_rms / u.rating).powi(2);
                        (m > u.open_at).then(|| {
                            let left = ((m - u.theta) / (m - u.open_at)).ln() / -u.cool.ln();
                            k + left.ceil().max(0.0) as i64
                        })
                    });
                    if expected.is_none_or(|d| (k - d).abs() > 1) {
                        rule.fail(json!({name: id, "step": k, "expected": expected}));
                    }
                    u.due = None;
                }
                let current = rms.abs().max(f(i_at, u.part).abs());
                if !on && current > 1e-9 {
                    rule.fail(json!({name: id, "step": k, "current": current}));
                }
                if on || breaker {
                    let m = if on { rms / u.rating } else { 0.0 };
                    u.theta = u.theta * u.cool + m * m * (1.0 - u.cool);
                    u.last_rms = if on { rms } else { 0.0 };
                }
                if let Some(mult) = u.multiple.filter(|_| on && u.due.is_none()) {
                    if rms >= mult * u.rating {
                        u.due = Some(k + 1);
                    }
                }
            }
        }
        for u in &mut self.rcds {
            let x = &c.parts[u.part];
            let on = on_of(u.part) != 0;
            let (a, b2) = (f(self.i, u.part), second(self.i2, u.part));
            let (ar, br) = (f(self.i_rms, u.part), second(self.i2_rms, u.part));
            let residual = if self.in_phase {
                let sign = |v: f64, rms: f64| {
                    if rms == 0.0 {
                        Some(0.0)
                    } else if v.abs() > 1e-6 * rms {
                        Some(v.signum())
                    } else {
                        None
                    }
                };
                match (sign(a, ar), sign(b2, br)) {
                    (Some(sa), Some(sb)) => Some((sa * ar + sb * br).abs()),
                    _ if u.poles == (ar, br) => u.residual,
                    _ => Some(second(self.residual, u.part)),
                }
            } else {
                Some(second(self.residual, u.part))
            };
            u.residual = residual;
            u.poles = (ar, br);
            if !u.open && u.due.is_none() && u.count >= 1.0 - 1e-9 {
                u.due = Some(k);
            }
            if on && u.open {
                u.open = false;
                u.count = 0.0;
                u.due = None;
            } else if !on && !u.open {
                u.open = true;
                if u.due.is_none_or(|d| (k - d).abs() > 1) {
                    self.rcd
                        .fail(json!({"rcd": x.id, "step": k, "expected": u.due, "count": u.count}));
                }
                u.due = None;
            }
            let current = ar.abs().max(br.abs()).max(a.abs()).max(b2.abs());
            if !on && current > 1e-9 {
                self.rcd
                    .fail(json!({"rcd": x.id, "step": k, "current": current}));
            }
            let res = if on { residual.unwrap_or(0.0) } else { 0.0 };
            let rating = x.x[0];
            u.count = if res >= rating && res > 0.0 {
                u.count + self.dt / (x.x[2] * rating / res).max(x.x[3])
            } else {
                0.0
            };
        }
        for h in &mut self.held {
            let x = &c.parts[h.part];
            let Some(s) = &x.sets[h.j] else { continue };
            h.given = match &s.src {
                Src::Array { offset, .. } => f64_at(b, *offset),
                Src::Control(name) => self.controls[name]
                    .as_array()
                    .into_iter()
                    .flatten()
                    .rev()
                    .find(|e| e[0].as_i64().is_some_and(|at| at <= k))
                    .and_then(|e| e[1].as_f64())
                    .unwrap_or(h.given),
            };
            if !h.given.is_finite() {
                self.range.fail(
                    json!({"part": x.id, "field": s.field, "step": k, "value": h.given.to_string()}),
                );
            } else {
                if h.given < s.min || h.given > s.max {
                    self.range.fail(
                        json!({"part": x.id, "field": s.field, "step": k, "value": h.given, "range": [s.min, s.max]}),
                    );
                }
                h.held = h.given.clamp(s.min, s.max);
            }
        }
        if let Some(r) = self.r {
            for (j, x) in c.parts.iter().enumerate() {
                let value = |f: usize| {
                    self.held
                        .iter()
                        .find(|h| h.part == j && h.j == f)
                        .map_or(x.x[f], |h| h.held)
                };
                let expected = match x.kind {
                    Kind::Resistor | Kind::Fault if x.sets[0].is_some() => value(0),
                    Kind::Load if x.sets.iter().any(Option::is_some) => {
                        value(1) * value(1) / value(0)
                    }
                    _ => continue,
                };
                let got = f(r, j);
                if (got - expected).abs() > 1e-12 * expected.abs().max(1.0) {
                    let field = x.sets.iter().flatten().next().map_or("r", |s| s.field);
                    self.range.fail(
                        json!({"part": x.id, "field": field, "step": k, "r": got, "expected": expected}),
                    );
                }
            }
        }
    }

    pub fn result(mut self) -> Value {
        let c = self.circuit;
        for (u, rule, name) in [
            (&self.fuses, &mut self.fuse, "fuse"),
            (&self.breakers, &mut self.breaker, "breaker"),
        ] {
            for u in u {
                if let Some(d) = u.due.filter(|_| !u.open) {
                    rule.fail(json!({name: c.parts[u.part].id, "step": null, "expected": d}));
                }
            }
        }
        for u in &self.rcds {
            if let Some(d) = u.due.filter(|_| !u.open) {
                self.rcd
                    .fail(json!({"rcd": c.parts[u.part].id, "step": null, "expected": d}));
            }
        }
        let mut rules = Map::new();
        rules.insert("circuit.kcl".into(), self.kcl.json(self.steps));
        rules.insert("circuit.power".into(), self.power.json(self.steps));
        rules.insert("circuit.fuse".into(), self.fuse.json(self.steps));
        if c.major >= 2 {
            rules.insert("circuit.breaker".into(), self.breaker.json(self.steps));
            rules.insert("circuit.rcd".into(), self.rcd.json(self.steps));
            rules.insert("circuit.range".into(), self.range.json(self.steps));
        }
        json!({"rules": rules})
    }
}

//! circuit@1's built table and its kind rules (#1181; canvas primitives: Logic: library
//! interfaces): the nodes and parts a logic item's `circuit` declares, checked and refused naming
//! a part circuit@1 can't model; their bytes, the item's asset 0, which a circuit@1 library reads
//! (packs/circuit-1.0.0/LAYOUT.md); and the judge's reading of a run, `circuit.kcl`,
//! `circuit.power` and `circuit.fuse`. The rules read the arrays a library writes at every step
//! with the item's own topology, ratings and the pack's curves, never a library's verdict, so they
//! hold any library, a planted one included.

use serde_json::{json, Map, Value};

use crate::first_party;
use crate::piece::Item;

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
}

impl Kind {
    fn of(name: &str) -> Option<Kind> {
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
            _ => return None,
        })
    }
    fn source(self) -> bool {
        matches!(self, Kind::SourceDc | Kind::SourceAc)
    }
}

/// A part as the check reads it: its ID and kind, the nodes it joins, the input that closes it
/// (and a fuse's that resets it), the part it measures, and its numbers as the table holds them.
#[derive(Clone, Debug)]
pub struct Part {
    pub id: String,
    pub kind: Kind,
    pub from: Option<usize>,
    pub to: Option<usize>,
    pub input: Option<String>,
    pub reset: Option<String>,
    pub target: Option<usize>,
    pub x: [f64; 4],
}

/// The circuit an item declares, and the bytes a circuit@1 library reads.
#[derive(Clone, Debug)]
pub struct Circuit {
    pub nodes: Vec<String>,
    pub parts: Vec<Part>,
    pub bytes: Vec<u8>,
}

fn refusal(what: String, part: Option<&str>) -> Value {
    let mut out = json!({"rule": "circuit", "what": what});
    if let Some(p) = part {
        out["part"] = json!(p);
    }
    out
}

/// One of circuit@1's constants, as its first-party pack gives it (packs/circuit-1.0.0).
pub fn constant(path: &str) -> Option<f64> {
    first_party::packs()
        .iter()
        .find_map(|p| p.pointer(&format!("/interfaces/circuit@1/constants/{path}")))
        .and_then(Value::as_f64)
}

/// The circuit `circuit` declares, each input's slot found by `slot` in the item's read region,
/// or every refusal: a part of a kind circuit@1 can't model, a field it doesn't take or a number
/// out of range, a node or part it names that isn't there, an input the item doesn't read.
pub fn build(v: &Value, slot: &dyn Fn(&str) -> Option<u32>) -> Result<Circuit, Vec<Value>> {
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
        match part_of(p, i, &nodes, &ids, parts_v) {
            Ok(part) => parts.push(part),
            Err(r) => refused.push(r),
        }
    }
    let frequencies: Vec<u64> = parts
        .iter()
        .filter(|p| p.kind == Kind::SourceAc)
        .map(|p| p.x[1].to_bits())
        .fold(Vec::new(), |mut fs, f| {
            if !fs.contains(&f) {
                fs.push(f);
            }
            fs
        });
    if frequencies.len() > FREQUENCIES {
        refused.push(refusal(
            format!("a circuit's AC sources run at most {FREQUENCIES} frequencies"),
            None,
        ));
    }
    if !refused.is_empty() {
        return Err(refused);
    }
    // The table (LAYOUT.md: The built table): a header of 64 bytes, then 64 bytes a part.
    let mut bytes = Vec::with_capacity(64 + 64 * parts.len());
    let i32s = |b: &mut Vec<u8>, xs: &[i32]| xs.iter().for_each(|x| b.extend(x.to_le_bytes()));
    i32s(&mut bytes, &[1, nodes.len() as i32, parts.len() as i32, 64]);
    bytes.resize(64, 0);
    for p in &parts {
        let at = |o: &Option<usize>| o.map_or(-1, |n| n as i32);
        let input = |name: &Option<String>| -> Result<i32, Value> {
            match name {
                None => Ok(-1),
                Some(n) => slot(n).map(|o| o as i32).ok_or_else(|| {
                    refusal(
                        format!("part {} is closed by {n}, which the item doesn't read as a number control (its reads)", p.id),
                        Some(&p.id),
                    )
                }),
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
        p.x.iter().for_each(|x| bytes.extend(x.to_le_bytes()));
    }
    if !refused.is_empty() {
        return Err(refused);
    }
    Ok(Circuit {
        nodes,
        parts,
        bytes,
    })
}

/// Part `i` of the declaration, or the refusal naming it.
fn part_of(
    p: &Value,
    i: usize,
    nodes: &[String],
    ids: &[&str],
    all: &[Value],
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
    let Some(kind) = Kind::of(kind_name) else {
        return Err(bad(format!(
            "is a {kind_name}, which circuit@1 can't model: it solves linear resistive parts only (sources, resistors, loads, switches, connectors, fuses, faults, meters and wires), never a diode, a motor's back-EMF or a filament whose resistance changes with heat"
        )));
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
    let node = |k: &str| -> Result<Option<usize>, Value> {
        if !fields.contains(&k) {
            return Ok(None);
        }
        let n = p.get(k).and_then(Value::as_str).unwrap_or_default();
        nodes.iter().position(|x| x == n).map(Some).ok_or_else(|| {
            bad(format!(
                "names {k} {n:?}, which isn't one of the circuit's nodes"
            ))
        })
    };
    let (from, to) = (node("from")?, node("to")?);
    if from.is_some() && from == to {
        return Err(bad("joins a node to itself".into()));
    }
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
    let positive = |x: f64| x > 0.0;
    let at_least_0 = |x: f64| x >= 0.0;
    let any = |_: f64| true;
    let text = |k: &str| p.get(k).and_then(Value::as_str).map(str::to_string);
    let input = |k: &str| -> Result<Option<String>, Value> {
        match p.get(k) {
            None if k == "reset_by" => Ok(None),
            Some(Value::String(s)) if !s.is_empty() => Ok(Some(s.clone())),
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
    let mut x = [0.0; 4];
    let (mut input_name, mut reset, mut target) = (None, None, None);
    match kind {
        Kind::SourceDc => {
            x[0] = number("v", None, &any, "volts")?;
            x[2] = number("r_internal", Some(0.0), &at_least_0, "ohms, 0 or more")?;
        }
        Kind::SourceAc => {
            x[0] = number("v_rms", None, &at_least_0, "rms volts, 0 or more")?;
            x[1] = number("f", None, &positive, "hertz, more than 0")?;
            x[2] = number("r_internal", Some(0.0), &at_least_0, "ohms, 0 or more")?;
            x[3] = number("phase", Some(0.0), &any, "degrees")?;
        }
        Kind::Resistor => x[0] = number("r", None, &at_least_0, "ohms, 0 or more")?,
        Kind::Fault => {
            x[0] = number("r", None, &at_least_0, "ohms, 0 or more")?;
            input_name = input("on_by")?;
        }
        Kind::Load => {
            x[0] = number("p_rated", None, &positive, "watts, more than 0")?;
            x[1] = number("v_rated", None, &positive, "volts, more than 0")?;
        }
        Kind::Switch | Kind::Connector => input_name = input("closed_by")?,
        Kind::Fuse => {
            x[0] = number("rating", None, &positive, "amperes, more than 0")?;
            let curve = text("curve").unwrap_or_else(|| "fast".into());
            x[1] = constant(&format!("curves/{curve}/tau"))
                .filter(|_| p.get("curve").is_none_or(Value::is_string))
                .ok_or_else(|| {
                    bad(format!(
                        "has curve {curve:?}: a fuse's curve is fast or slow"
                    ))
                })?;
            reset = input("reset_by")?;
        }
        Kind::Meter => target = measured("on")?,
        Kind::Wire => {
            target = measured("part")?;
            x[0] = number("length", None, &positive, "metres, more than 0")?;
            x[1] = number("area", None, &positive, "mm², more than 0")?;
            let material = text("material").unwrap_or_else(|| "copper".into());
            x[2] = constant(&format!("carriers/{material}/value"))
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
        input: input_name,
        reset,
        target,
        x,
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

/// A fuse as the judge follows it: its heat by the pack's curve from the library's rms current,
/// the step the curve gives it open, whether the library has it open, and a late opening owed.
struct Fuse {
    part: usize,
    rating: f64,
    cool: f64,
    theta: f64,
    open: bool,
    due: Option<i64>,
    last_rms: f64,
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
    steps: i64,
    sums: Vec<f64>,
    fuses: Vec<Fuse>,
    kcl: Rule,
    power: Rule,
    fuse: Rule,
}

fn f64_at(b: &[u8], o: usize) -> f64 {
    f64::from_le_bytes(b[o..o + 8].try_into().unwrap())
}
fn i32_at(b: &[u8], o: usize) -> i32 {
    i32::from_le_bytes(b[o..o + 4].try_into().unwrap())
}

impl<'a> Judge<'a> {
    /// The rules over `item`'s arrays, each rule's params from `rules` or the pack's defaults, or
    /// what it lacks: every array they read, by name and type.
    pub fn new(item: &Item, circuit: &'a Circuit, rules: &Value) -> Result<Judge<'a>, String> {
        let p = circuit.parts.len();
        let need = |name: &str, ty: &str| {
            item.write(name)
                .filter(|e| e.ty == ty)
                .map(|e| At(e.offset as usize, e.size as usize / if ty == "f64" { 8 } else { 4 }))
                .filter(|a| a.1 >= p)
                .ok_or_else(|| {
                    format!("an item with circuit writes i, i_rms, p and energy (f64) and on (i32), {p} of each")
                })
        };
        let param = |rule: &str, k: &str| {
            rules
                .pointer(&format!("/{rule}/{k}"))
                .and_then(Value::as_f64)
                .or_else(|| {
                    first_party::packs()
                        .iter()
                        .find_map(|pk| {
                            pk.pointer(&format!("/interfaces/circuit@1/rules/{rule}/{k}"))
                        })
                        .and_then(Value::as_f64)
                })
        };
        // The step's length as a library solving once a step at the item's rate takes it: 1 ÷ per.
        let dt = 1.0 / (deep_canvas::grammar::FLICKS_PER_SECOND as f64 / item.step as f64);
        let fuses = circuit
            .parts
            .iter()
            .enumerate()
            .filter(|(_, x)| x.kind == Kind::Fuse)
            .map(|(j, x)| Fuse {
                part: j,
                rating: x.x[0],
                cool: (-dt / x.x[1]).exp(),
                theta: 0.0,
                open: false,
                due: None,
                last_rms: 0.0,
            })
            .collect();
        Ok(Judge {
            circuit,
            dt,
            kcl_tolerance: param("circuit.kcl", "tolerance").unwrap_or(1e-9),
            power_tolerance: param("circuit.power", "tolerance").unwrap_or(1e-6),
            i: need("i", "f64")?,
            i_rms: need("i_rms", "f64")?,
            p: need("p", "f64")?,
            on: need("on", "i32")?,
            energy: need("energy", "f64")?,
            steps: 0,
            sums: vec![0.0; p],
            fuses,
            kcl: Rule::default(),
            power: Rule::default(),
            fuse: Rule::default(),
        })
    }

    /// Step k's write region.
    pub fn step(&mut self, k: i64, b: &[u8]) {
        self.steps += 1;
        let c = self.circuit;
        let f = |a: At, j: usize| f64_at(b, a.0 + 8 * j);
        // circuit.kcl: into each node, + for a part whose `to` it is, − for one whose `from` it is.
        for (n, name) in c.nodes.iter().enumerate() {
            let sum: f64 = c
                .parts
                .iter()
                .enumerate()
                .map(|(j, x)| {
                    let i = f(self.i, j);
                    (if x.to == Some(n) { i } else { 0.0 })
                        - (if x.from == Some(n) { i } else { 0.0 })
                })
                .sum();
            if sum.abs() > self.kcl_tolerance || !sum.is_finite() {
                self.kcl.fail(json!({"step": k, "node": name, "sum": sum}));
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
        // circuit.fuse: the step the curve gives each fuse open, against the step its `on` turns 0.
        for u in &mut self.fuses {
            let id = &c.parts[u.part].id;
            let on = i32_at(b, self.on.0 + 4 * u.part) != 0;
            let rms = f(self.i_rms, u.part);
            if !u.open && u.due.is_none() && u.theta >= 1.0 {
                u.due = Some(k);
            }
            if on && u.open {
                // Closed again (its reset): cold.
                u.open = false;
                u.theta = 0.0;
                u.due = None;
            } else if !on && !u.open {
                u.open = true;
                let expected = u.due.or_else(|| {
                    // Opened before its heat reached 1: the step it would have, at the last current.
                    let m = (u.last_rms / u.rating).powi(2);
                    (m > 1.0).then(|| {
                        let left = ((m - u.theta) / (m - 1.0)).ln() / -u.cool.ln();
                        k + left.ceil().max(0.0) as i64
                    })
                });
                if expected.is_none_or(|d| (k - d).abs() > 1) {
                    self.fuse
                        .fail(json!({"fuse": id, "step": k, "expected": expected}));
                }
                u.due = None;
            }
            // A fuse past its curve's time and still shut is named once: when it opens, or at the end.
            let current = rms.abs().max(f(self.i, u.part).abs());
            if !on && current > 1e-9 {
                self.fuse
                    .fail(json!({"fuse": id, "step": k, "current": current}));
            }
            if on {
                u.theta = u.theta * u.cool + (rms / u.rating).powi(2) * (1.0 - u.cool);
                u.last_rms = rms;
            }
        }
    }

    /// The three rules: each with its verdict, the steps it read and its first fails. A fuse its
    /// curve opened that the run never opened fails here, naming the step the curve gives.
    pub fn result(mut self) -> Value {
        let c = self.circuit;
        for u in &self.fuses {
            if let Some(d) = u.due.filter(|_| !u.open) {
                self.fuse
                    .fail(json!({"fuse": c.parts[u.part].id, "step": null, "expected": d}));
            }
        }
        let mut rules = Map::new();
        rules.insert("circuit.kcl".into(), self.kcl.json(self.steps));
        rules.insert("circuit.power".into(), self.power.json(self.steps));
        rules.insert("circuit.fuse".into(), self.fuse.json(self.steps));
        json!({"rules": rules})
    }
}

//! #204: a synth preset (canvas primitives: Synth `synth@1`, As built): nodes over the closed
//! list, edges into the inputs each node takes, params with a unit, range and default, and a
//! stated cost per voice, compiled once into a flat program in evaluation order. A cycle may pass
//! only through a wet delay of at least one block, which the program reads from its past.

use serde_json::{Map, Value};

use crate::eq;

/// The closed node list.
pub const NODES: [&str; 11] = [
    "osc", "noise", "modes", "string", "env", "biquad", "shaper", "crush", "delay", "gain", "mix",
];

/// The block a delay on a cycle must at least span, in samples at the check's 48 kHz.
pub const BLOCK: usize = crate::mix::BLOCK as usize;
pub const CHECK_RATE: f64 = 48_000.0;
/// A delay's longest time, s.
pub const DELAY_MAX: f64 = 2.0;
/// A string's lowest pitch, Hz: the length its line is sized for.
pub const STRING_LOWEST: f64 = 20.0;

/// A numeric field: a number, or one of the preset's params by index.
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Field {
    Num(f64),
    Param(usize),
}

#[derive(Clone, Debug, PartialEq)]
pub struct Param {
    pub name: String,
    pub unit: String,
    pub lo: f64,
    pub hi: f64,
    pub default: f64,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Wave {
    Sine,
    Saw,
    Square,
    Triangle,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Color {
    White,
    Pink,
    Brown,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Curve {
    Tanh,
    SoftClip,
    Fold,
}

#[derive(Clone, Debug, PartialEq)]
pub enum Kind {
    Osc {
        wave: Wave,
        hz: Field,
    },
    Noise {
        color: Color,
    },
    Modes {
        ratios: Vec<f64>,
        t60s: Vec<f64>,
        hz: Field,
    },
    String {
        hz: Field,
        damping: Field,
    },
    Env {
        attack: Field,
        hold: Field,
        decay: Field,
        sustain: Field,
        release: Field,
    },
    Biquad {
        ty: eq::Type,
        freq: Field,
        q: Field,
        gain: Field,
    },
    Shaper {
        curve: Curve,
        drive: Field,
        mix: Field,
    },
    Crush {
        bits: Field,
        hold_hz: Field,
        mix: Field,
    },
    Delay {
        time: Field,
        feedback: Field,
        mix: Field,
    },
    Gain {
        gain: Field,
    },
    Mix,
}

impl Kind {
    pub fn name(&self) -> &'static str {
        match self {
            Kind::Osc { .. } => "osc",
            Kind::Noise { .. } => "noise",
            Kind::Modes { .. } => "modes",
            Kind::String { .. } => "string",
            Kind::Env { .. } => "env",
            Kind::Biquad { .. } => "biquad",
            Kind::Shaper { .. } => "shaper",
            Kind::Crush { .. } => "crush",
            Kind::Delay { .. } => "delay",
            Kind::Gain { .. } => "gain",
            Kind::Mix => "mix",
        }
    }

    /// Whether the node takes `input`: `in` on every node but the sources, any name on a mix, an
    /// osc's `hz` and a gain's `gain`.
    fn takes(&self, input: &str) -> bool {
        match self {
            Kind::Mix => true,
            Kind::Osc { .. } => input == "hz",
            Kind::Noise { .. } | Kind::Env { .. } => false,
            Kind::Gain { .. } => input == "in" || input == "gain",
            _ => input == "in",
        }
    }

    /// Multiply-adds per sample (Synth: As built).
    pub fn cost(&self, inputs: usize) -> f64 {
        match self {
            Kind::Osc { .. } => 4.0,
            Kind::Noise {
                color: Color::White,
            } => 2.0,
            Kind::Noise { color: Color::Pink } => 8.0,
            Kind::Noise {
                color: Color::Brown,
            } => 3.0,
            Kind::Modes { ratios, .. } => 3.0 * ratios.len() as f64,
            Kind::String { .. } => 6.0,
            Kind::Env { .. } => 2.0,
            Kind::Biquad { .. } => 5.0,
            Kind::Shaper { .. } => 10.0,
            Kind::Crush { .. } => 2.0,
            Kind::Delay { .. } => 3.0,
            Kind::Gain { .. } => 1.0,
            Kind::Mix => inputs as f64,
        }
    }
}

#[derive(Clone, Debug, PartialEq)]
pub struct Node {
    pub id: String,
    pub kind: Kind,
    /// Program indexes of the nodes summed into `in` (every input on a mix).
    pub ins: Vec<usize>,
    /// Into an osc's `hz` or a gain's `gain`.
    pub mods: Vec<usize>,
    /// Whether it is a delay on a cycle: its output comes from its line before its input is made.
    pub breaks: bool,
}

/// A preset compiled: nodes in evaluation order, its out, params and stated cost.
#[derive(Clone, Debug, PartialEq)]
pub struct Preset {
    pub nodes: Vec<Node>,
    pub out: usize,
    pub params: Vec<Param>,
    pub cost: f64,
}

/// Which of the kit's rules a preset breaks, and why.
#[derive(Clone, Debug, PartialEq)]
pub struct Fault {
    pub rule: &'static str,
    pub why: String,
    /// Where under the preset: `edges/<index>` or `nodes/<ID>`, when it is one edge or node.
    pub at: Option<String>,
}

pub const RULE_NODE: &str = "node_in_list";
pub const RULE_EDGE: &str = "edge_input";
pub const RULE_CYCLE: &str = "cycle_through_delay";
pub const RULE_PARAM: &str = "param_range";
pub const RULE_COST: &str = "cost_within_estimate";

fn fault(rule: &'static str, why: String) -> Fault {
    Fault {
        rule,
        why,
        at: None,
    }
}

fn fault_at(rule: &'static str, why: String, at: String) -> Fault {
    Fault {
        rule,
        why,
        at: Some(at),
    }
}

impl Preset {
    /// The preset's cost at its defaults: the sum of its nodes' multiply-adds per sample.
    pub fn cost_at_defaults(&self) -> f64 {
        self.nodes.iter().map(|n| n.kind.cost(n.ins.len())).sum()
    }

    pub fn param(&self, name: &str) -> Option<usize> {
        self.params.iter().position(|p| p.name == name)
    }

    /// A field's least and greatest values over its param's range.
    pub fn span(&self, f: Field) -> (f64, f64) {
        match f {
            Field::Num(v) => (v, v),
            Field::Param(p) => (self.params[p].lo, self.params[p].hi),
        }
    }

    pub fn default(&self, f: Field) -> f64 {
        match f {
            Field::Num(v) => v,
            Field::Param(p) => self.params[p].default,
        }
    }

    /// Parses and checks `v` against every rule but the sweep, in the kit's order: nodes, params,
    /// edges, cycles, cost.
    pub fn compile(v: &Value) -> Result<Preset, Fault> {
        let o = v
            .as_object()
            .ok_or_else(|| fault(RULE_NODE, "a preset is an object".into()))?;
        let params = params(o)?;
        let nodes_v = o
            .get("nodes")
            .and_then(Value::as_object)
            .filter(|n| !n.is_empty())
            .ok_or_else(|| fault(RULE_NODE, "a preset has nodes {ID → node}".into()))?;
        let mut ids: Vec<&str> = nodes_v.keys().map(String::as_str).collect();
        ids.sort_unstable();
        let mut kinds = Vec::with_capacity(ids.len());
        for id in &ids {
            kinds.push(node(id, &nodes_v[*id], &params)?);
        }
        let at = |id: &str| ids.binary_search(&id).ok();
        let out = o
            .get("out")
            .and_then(Value::as_str)
            .ok_or_else(|| fault(RULE_EDGE, "a preset names its out node".into()))?;
        let out = at(out)
            .ok_or_else(|| fault(RULE_EDGE, format!("out `{out}` is not one of the nodes")))?;
        // Edges: [from, to, input], each end a node and the input one the node takes.
        let mut ins = vec![Vec::new(); ids.len()];
        let mut mods = vec![Vec::new(); ids.len()];
        let mut edges = Vec::new();
        for (index, e) in o
            .get("edges")
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
            .enumerate()
        {
            let here = format!("edges/{index}");
            let part = |i: usize| e.get(i).and_then(Value::as_str);
            let (Some(f), Some(t), Some(input)) = (part(0), part(1), part(2)) else {
                return Err(fault_at(
                    RULE_EDGE,
                    format!("edge {e} is not [from, to, input]"),
                    here,
                ));
            };
            let name = format!("{here} {e}");
            let (Some(fi), Some(ti)) = (at(f), at(t)) else {
                return Err(fault_at(
                    RULE_EDGE,
                    format!("edge {name} names a node the preset doesn't have"),
                    here,
                ));
            };
            if !kinds[ti].takes(input) {
                return Err(fault_at(
                    RULE_EDGE,
                    format!(
                        "edge {name}: a {} node takes no input `{input}`",
                        kinds[ti].name()
                    ),
                    here,
                ));
            }
            if input == "in" || matches!(kinds[ti], Kind::Mix) {
                ins[ti].push(fi);
            } else {
                mods[ti].push(fi);
            }
            edges.push((fi, ti, here));
        }
        let probe = Preset {
            nodes: Vec::new(),
            out,
            params: params.clone(),
            cost: 0.0,
        };
        let order = order(&ids, &kinds, &edges, &probe)?;
        let mut index = vec![0; ids.len()];
        for (k, &n) in order.iter().enumerate() {
            index[n.0] = k;
        }
        let nodes: Vec<Node> = order
            .iter()
            .map(|&(n, breaks)| Node {
                id: ids[n].to_string(),
                kind: kinds[n].clone(),
                ins: ins[n].iter().map(|i| index[*i]).collect(),
                mods: mods[n].iter().map(|i| index[*i]).collect(),
                breaks,
            })
            .collect();
        let cost = o
            .get("cost")
            .and_then(Value::as_f64)
            .filter(|c| c.is_finite() && *c > 0.0)
            .ok_or_else(|| {
                fault(
                    RULE_COST,
                    "a preset states its cost per voice, a positive number".into(),
                )
            })?;
        let p = Preset {
            nodes,
            out: index[out],
            params,
            cost,
        };
        let at_defaults = p.cost_at_defaults();
        if at_defaults > cost {
            return Err(fault(
                RULE_COST,
                format!("its cost at defaults is {at_defaults} multiply-adds a sample, over its estimate of {cost}"),
            ));
        }
        Ok(p)
    }
}

fn params(o: &Map<String, Value>) -> Result<Vec<Param>, Fault> {
    let mut out = Vec::new();
    let Some(ps) = o.get("params") else {
        return Ok(out);
    };
    let ps = ps.as_object().ok_or_else(|| {
        fault(
            RULE_PARAM,
            "params is {name → {unit, range, default}}".into(),
        )
    })?;
    let mut names: Vec<&String> = ps.keys().collect();
    names.sort();
    for name in names {
        let p = &ps[name];
        let unit = p.get("unit").and_then(Value::as_str);
        let range = p.get("range").and_then(Value::as_array);
        let lo = range.and_then(|r| r.first()).and_then(Value::as_f64);
        let hi = range.and_then(|r| r.get(1)).and_then(Value::as_f64);
        let default = p.get("default").and_then(Value::as_f64);
        let (Some(unit), Some(lo), Some(hi), Some(default)) = (unit, lo, hi, default) else {
            return Err(fault(
                RULE_PARAM,
                format!("param `{name}` needs a unit, a range [low, high] and a default"),
            ));
        };
        if range.map(Vec::len) != Some(2)
            || !(lo.is_finite() && hi.is_finite() && lo <= default && default <= hi)
        {
            return Err(fault(
                RULE_PARAM,
                format!("param `{name}`'s range [{lo}, {hi}] must be finite and hold its default {default}"),
            ));
        }
        out.push(Param {
            name: name.clone(),
            unit: unit.to_string(),
            lo,
            hi,
            default,
        });
    }
    Ok(out)
}

/// A node's kind and fields; a field naming a param the preset lacks is the param rule's.
fn node(id: &str, v: &Value, params: &[Param]) -> Result<Kind, Fault> {
    // A node is `{kind, …fields}`, or its kind holding its fields, `{"osc": {wave, hz}}`.
    let (kind, v) = match v.get("kind").and_then(Value::as_str) {
        Some(k) => (k, v),
        None => match v
            .as_object()
            .filter(|o| o.len() == 1)
            .and_then(|o| o.iter().next())
        {
            Some((k, inner)) if inner.is_object() => (k.as_str(), inner),
            _ => ("", v),
        },
    };
    if !NODES.contains(&kind) {
        return Err(fault_at(
            RULE_NODE,
            format!(
                "node `{id}` is `{kind}`, which isn't in the closed list ({})",
                NODES.join(", ")
            ),
            format!("nodes/{id}"),
        ));
    }
    let bad = |what: String| {
        fault_at(
            RULE_NODE,
            format!("node `{id}` ({kind}): {what}"),
            format!("nodes/{id}"),
        )
    };
    let field = |name: &str, default: Option<f64>| -> Result<Field, Fault> {
        match v.get(name) {
            None => default.map(Field::Num).ok_or_else(|| bad(format!("needs `{name}`"))),
            Some(Value::Number(n)) => n.as_f64().map(Field::Num).ok_or_else(|| bad(format!("`{name}` is not a number"))),
            Some(Value::String(p)) => params
                .iter()
                .position(|q| &q.name == p)
                .map(Field::Param)
                .ok_or_else(|| fault(RULE_PARAM, format!("node `{id}`'s `{name}` names param `{p}`, which the preset doesn't have"))),
            Some(_) => Err(bad(format!("`{name}` is a number or a param's name"))),
        }
    };
    let word = |name: &str, default: &str| {
        v.get(name)
            .and_then(Value::as_str)
            .unwrap_or(default)
            .to_string()
    };
    let numbers = |name: &str| -> Result<Vec<f64>, Fault> {
        v.get(name)
            .and_then(Value::as_array)
            .and_then(|a| a.iter().map(Value::as_f64).collect::<Option<Vec<_>>>())
            .filter(|a| !a.is_empty() && a.iter().all(|x| x.is_finite() && *x > 0.0))
            .ok_or_else(|| bad(format!("`{name}` is a list of positive numbers")))
    };
    let span = |f: Field| match f {
        Field::Num(x) => (x, x),
        Field::Param(p) => (params[p].lo, params[p].hi),
    };
    Ok(match kind {
        "osc" => Kind::Osc {
            wave: match word("wave", "sine").as_str() {
                "sine" => Wave::Sine,
                "saw" => Wave::Saw,
                "square" => Wave::Square,
                "triangle" => Wave::Triangle,
                w => return Err(bad(format!("wave `{w}` is sine, saw, square or triangle"))),
            },
            hz: field("hz", None)?,
        },
        "noise" => Kind::Noise {
            color: match word("color", "white").as_str() {
                "white" => Color::White,
                "pink" => Color::Pink,
                "brown" => Color::Brown,
                c => return Err(bad(format!("color `{c}` is white, pink or brown"))),
            },
        },
        "modes" => {
            let ratios = numbers("ratios")?;
            let t60s = numbers("t60s")?;
            if t60s.len() != ratios.len() {
                return Err(bad("`ratios` and `t60s` have one entry per mode".into()));
            }
            Kind::Modes {
                ratios,
                t60s,
                hz: field("hz", None)?,
            }
        }
        "string" => {
            let hz = field("hz", None)?;
            let damping = field("damping", Some(0.1))?;
            if span(hz).0 < STRING_LOWEST
                || !(0.0..1.0).contains(&span(damping).0)
                || span(damping).1 >= 1.0
            {
                return Err(bad(format!(
                    "`hz` is at least {STRING_LOWEST} and `damping` in [0, 1)"
                )));
            }
            Kind::String { hz, damping }
        }
        "env" => Kind::Env {
            attack: field("attack", Some(0.0))?,
            hold: field("hold", Some(0.0))?,
            decay: field("decay", Some(0.0))?,
            sustain: field("sustain", Some(1.0))?,
            release: field("release", Some(0.0))?,
        },
        "biquad" => Kind::Biquad {
            ty: eq::Type::read(&word("type", "lowpass")).ok_or_else(|| {
                bad(format!(
                    "type `{}` is one of the eq's band types",
                    word("type", "")
                ))
            })?,
            freq: field("freq", Some(350.0))?,
            q: field("q", Some(1.0))?,
            gain: field("gain", Some(0.0))?,
        },
        "shaper" => Kind::Shaper {
            curve: match word("curve", "tanh").as_str() {
                "tanh" => Curve::Tanh,
                "soft_clip" => Curve::SoftClip,
                "fold" => Curve::Fold,
                c => return Err(bad(format!("curve `{c}` is tanh, soft_clip or fold"))),
            },
            drive: field("drive", Some(6.0))?,
            mix: field("mix", Some(1.0))?,
        },
        "crush" => {
            let bits = field("bits", Some(8.0))?;
            let (lo, hi) = span(bits);
            if lo < 1.0 || hi > 16.0 {
                return Err(bad("`bits` is 1 to 16".into()));
            }
            Kind::Crush {
                bits,
                hold_hz: field("hold_hz", Some(0.0))?,
                mix: field("mix", Some(1.0))?,
            }
        }
        "delay" => {
            let time = field("time", None)?;
            let (lo, hi) = span(time);
            if lo < 0.0 || hi > DELAY_MAX {
                return Err(bad(format!("`time` is 0 to {DELAY_MAX} s")));
            }
            Kind::Delay {
                time,
                feedback: field("feedback", Some(0.0))?,
                mix: field("mix", Some(1.0))?,
            }
        }
        "gain" => Kind::Gain {
            gain: field("gain", Some(1.0))?,
        },
        _ => Kind::Mix,
    })
}

/// The evaluation order: a topological order of the edges, less those out of a delay on a cycle,
/// which reads only its past. A cycle with no such delay is refused, naming one of its edges.
fn order(
    ids: &[&str],
    kinds: &[Kind],
    edges: &[(usize, usize, String)],
    p: &Preset,
) -> Result<Vec<(usize, bool)>, Fault> {
    let n = ids.len();
    // A delay breaks a cycle when it is wet only and at least one block long at its least.
    let breaker = |i: usize| match &kinds[i] {
        Kind::Delay { time, mix, .. } => {
            p.span(*time).0 * CHECK_RATE >= BLOCK as f64 && *mix == Field::Num(1.0)
        }
        _ => false,
    };
    let on_cycle = |i: usize| reaches(n, edges, i, i);
    let breaks: Vec<bool> = (0..n).map(|i| breaker(i) && on_cycle(i)).collect();
    // With the breakers' out edges cut, what remains must be acyclic.
    let kept: Vec<&(usize, usize, String)> = edges.iter().filter(|e| !breaks[e.0]).collect();
    let mut indeg = vec![0usize; n];
    for e in &kept {
        indeg[e.1] += 1;
    }
    let mut ready: Vec<usize> = (0..n).filter(|i| indeg[*i] == 0).collect();
    ready.reverse();
    let mut out = Vec::with_capacity(n);
    while let Some(i) = ready.pop() {
        out.push((i, breaks[i]));
        let mut next = Vec::new();
        for e in kept.iter().filter(|e| e.0 == i) {
            indeg[e.1] -= 1;
            if indeg[e.1] == 0 {
                next.push(e.1);
            }
        }
        next.sort_unstable_by(|a, b| b.cmp(a));
        ready.extend(next);
        ready.sort_unstable_by(|a, b| b.cmp(a));
    }
    if out.len() < n {
        // The last-listed edge between two nodes left unordered, which closes the cycle.
        let left: Vec<bool> = (0..n).map(|i| !out.iter().any(|o| o.0 == i)).collect();
        let stuck = kept
            .iter()
            .rev()
            .find(|e| left[e.0] && left[e.1] && reaches(n, edges, e.1, e.0))
            .map(|e| e.2.clone())
            .unwrap_or_default();
        return Err(fault_at(
            RULE_CYCLE,
            format!("the edge at {stuck} closes a cycle that passes through no wet delay of at least one block"),
            stuck,
        ));
    }
    Ok(out)
}

/// Whether `to` is reachable from `from` along one or more edges.
fn reaches(n: usize, edges: &[(usize, usize, String)], from: usize, to: usize) -> bool {
    let mut seen = vec![false; n];
    let mut stack = vec![from];
    while let Some(i) = stack.pop() {
        for e in edges.iter().filter(|e| e.0 == i) {
            if e.1 == to {
                return true;
            }
            if !seen[e.1] {
                seen[e.1] = true;
                stack.push(e.1);
            }
        }
    }
    false
}

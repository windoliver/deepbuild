//! An operator transition's pass (#466; canvas primitives: Transition: operator, iris and dip): a
//! composed pass from a pack over the outgoing and incoming color targets, each finished in its
//! own look and display-referred, and the transition's progress, checked and budgeted like any
//! operator. The check here refuses one that reads an earlier frame or any target but the two
//! sides it lists; the coverage curve it draws from a black outgoing and a white incoming side
//! places `align: reveal`, on the CPU reference interpreter, so the reveal is the same on every
//! machine.

use std::collections::BTreeMap;

use serde_json::Value;

use crate::check::{self, Checked};
use crate::graph::{self, From, Issue, Kind, Origin};
use crate::interp::{self, Env, Image};

/// The op a side's texture input names (`{texture: {target: {op: "transition", output}}}`).
pub const SIDES: &str = "transition";
/// The two sides a pass may read, and the param that carries the progress.
pub const OUTGOING: &str = "outgoing";
pub const INCOMING: &str = "incoming";
pub const PROGRESS: &str = "progress";

/// A checked transition pass, and the input that takes each side.
#[derive(Clone, Debug)]
pub struct Pass {
    pub checked: Checked,
    /// What draws: the pass's color alone, since its `coverage` says where the incoming side
    /// shows, not how much of the color lands.
    drawn: Checked,
    /// The texture input reading each side, by side name.
    pub sides: BTreeMap<String, String>,
}

/// Checks `graph` as an operator transition's pass reading only `reads` (`outgoing`,
/// `incoming`, `progress`): a pass from a pack, no read of an earlier frame, no target but a
/// listed side, then the whole operator check (shader text, status colors, limits, its cost
/// within 25% of the estimate).
pub fn check(graph: &Value, reads: &[String]) -> Result<Pass, Vec<Issue>> {
    let mut issues = Vec::new();
    // An earlier frame, by any spelling a texture input could carry it with.
    if let Some(inputs) = graph.get("inputs").and_then(Value::as_object) {
        for (name, input) in inputs {
            let from = input.get("from");
            let tex = from.and_then(|f| f.get("texture"));
            let target = tex.and_then(|t| t.get("target")).or(tex);
            let frame = [target, tex, from]
                .into_iter()
                .flatten()
                .find_map(|v| v.get("frame").or(v.get("step")));
            if frame.is_some_and(|f| f.as_str() != Some("current")) {
                issues.push(Issue::at_path(
                    "operator_kind_rule",
                    &format!("inputs/{name}"),
                    format!("{name} reads an earlier frame, and a transition reads only this frame's two sides"),
                ));
            }
        }
    }
    if !issues.is_empty() {
        return Err(issues);
    }
    let op = graph::read(graph)?;
    if op.kind != Kind::Pass {
        issues.push(Issue::at_path(
            "operator_kind_rule",
            "kind",
            "a transition's operator is a pass",
        ));
    }
    if op.origin == Origin::Shipped {
        issues.push(Issue::at_path(
            "operator_kind_rule",
            "origin",
            "a transition's operator is composed, from a pack or the document",
        ));
    }
    let mut sides = BTreeMap::new();
    for (name, input) in &op.inputs {
        match &input.from {
            From::Target { op: from, output }
                if from == SIDES
                    && (output == OUTGOING || output == INCOMING)
                    && reads.iter().any(|r| r == output) =>
            {
                sides.insert(output.clone(), name.clone());
            }
            From::Param(p) if p == PROGRESS && !reads.iter().any(|r| r == PROGRESS) => {
                issues.push(Issue::at_path(
                    "operator_kind_rule",
                    &format!("inputs/{name}"),
                    "it reads the progress, which the transition's reads don't list",
                ));
            }
            // Its own output, which only an earlier frame holds.
            From::Target { op: from, .. } if *from == op.id => issues.push(Issue::at_path(
                "operator_kind_rule",
                &format!("inputs/{name}"),
                format!("{name} reads the operator's own output, an earlier frame: a transition reads only this frame's two sides"),
            )),
            From::Target { op: from, output } => issues.push(Issue::at_path(
                "operator_kind_rule",
                &format!("inputs/{name}"),
                format!("{name} reads {from}.{output}: a transition's pass reads only the sides its reads list"),
            )),
            From::Texture3d { .. }
            | From::Storage { .. }
            | From::Column { .. }
            | From::Attribute { .. } => issues.push(Issue::at_path(
                "operator_kind_rule",
                &format!("inputs/{name}"),
                format!("{name} reads data a transition's pass can't"),
            )),
            _ => {}
        }
    }
    if !issues.is_empty() {
        return Err(issues);
    }
    let checked = check::check(&op)?;
    let mut drawn = checked.clone();
    drawn.op.outputs.remove("coverage");
    Ok(Pass {
        checked,
        drawn,
        sides,
    })
}

impl Pass {
    /// The pass over `outgoing` and `incoming` at progress `p` (eased), rows `rows` of a
    /// `size` output, in straight display-referred RGBA in [0, 1].
    pub fn rows(
        &self,
        outgoing: &Image,
        incoming: &Image,
        p: f64,
        roles: &BTreeMap<String, [f64; 3]>,
        size: [u32; 2],
        rows: std::ops::Range<u32>,
    ) -> Result<Vec<[f64; 4]>, String> {
        let params = BTreeMap::from([(PROGRESS.to_string(), Value::from(p))]);
        let mut textures = BTreeMap::new();
        for (side, input) in &self.sides {
            textures.insert(
                input.clone(),
                if side == OUTGOING { outgoing } else { incoming },
            );
        }
        let env = Env {
            t: 0.0,
            seed: 0,
            clip: identity(),
            inverse_clip: identity(),
            eye: [0.0; 4],
            inputs: interp::inputs(&self.drawn, &params, roles),
            textures,
            normals: [[0.0; 3]; 3],
        };
        interp::pass_rows(&self.drawn, &env, size, rows)
    }

    /// The share of the picture the incoming side covers at progress `p`: the pass's mean luma
    /// with a black outgoing and a white incoming side, on a `size` frame.
    pub fn coverage(&self, p: f64, size: [u32; 2]) -> Result<f64, String> {
        let flat = |v: f64| Image {
            w: size[0],
            h: size[1],
            px: vec![[v, v, v, 1.0]; (size[0] as usize) * (size[1] as usize)],
        };
        let (black, white) = (flat(0.0), flat(1.0));
        let px = self.rows(&black, &white, p, &BTreeMap::new(), size, 0..size[1])?;
        let sum: f64 = px
            .iter()
            .map(|c| 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2])
            .sum();
        Ok(sum / px.len().max(1) as f64)
    }
}

fn identity() -> [f64; 16] {
    let mut m = [0.0; 16];
    for k in 0..4 {
        m[k * 5] = 1.0;
    }
    m
}

/// The graph an operator transition's `op` names: a `gpu.pass@1` item of the document by ID,
/// else a named operator of `packs` (each pinned pack's manifest), else fx@1's.
pub fn graph_of(op: &str, items: Option<&Value>, packs: &[Value]) -> Option<Value> {
    if let Some(item) = items.and_then(|i| i.get(op)) {
        return crate::module::operator_of(op, item).filter(|g| g["kind"] == "pass");
    }
    packs
        .iter()
        .flat_map(crate::fx::named)
        .chain(crate::fx::library())
        .find(|n| n.name == op)
        .map(|n| n.graph)
}

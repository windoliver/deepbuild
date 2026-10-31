//! Issue #394: the graph module's R1 slice (canvas primitives: Graph and layout memory `graph@1`,
//! `layout@1`): the basic layered layout and its memory, `{id → (rank, order, x, y)}` by stable ID.
//!
//! Ranks come from longest paths over `min_len`, the order in each rank from barycenter sweeps with
//! long edges carried through their ranks, and positions from the spacing, each rank centred on the
//! widest. Every step reads nodes and edges sorted by ID and breaks ties by the order before, so the
//! same graph and seed give the same bytes whatever order its rows came in. With a memory, R1 keeps
//! the picture or refuses: a graph the memory still holds comes back as the memory says, and one
//! with a node it lacks, or an edge its ranks break, returns `layout.relayout_needed` with the full
//! relayout offered beside it, never moving a kept node on its own. R2 lands the memory rules that
//! place new nodes into a kept picture.

pub mod module;

use std::collections::{BTreeMap, BTreeSet};

use serde_json::{json, Map, Value};

/// Why a graph or a layout can't be read or kept, as a refusal code and what it names.
#[derive(Clone, Debug, PartialEq)]
pub struct Refused {
    pub code: &'static str,
    pub names: String,
}

fn refuse<T>(code: &'static str, names: impl Into<String>) -> Result<T, Refused> {
    Err(Refused {
        code,
        names: names.into(),
    })
}

#[derive(Clone, Debug, PartialEq)]
pub struct Node {
    pub id: String,
    pub w: f64,
    pub h: f64,
}

#[derive(Clone, Debug, PartialEq)]
pub struct Edge {
    pub id: String,
    pub a: String,
    pub b: String,
    pub min_len: u32,
}

/// A graph's nodes and edges, each sorted by ID.
#[derive(Clone, Debug, PartialEq)]
pub struct Graph {
    pub nodes: Vec<Node>,
    pub edges: Vec<Edge>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Direction {
    Down,
    Right,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Layout {
    pub direction: Direction,
    /// Required and non-zero, never the clock's. The basic layered layout draws nothing at random,
    /// so the same graph gives the same picture under any seed.
    pub seed: u64,
    /// Between boxes in a rank, between ranks, and taken by a long edge passing through a rank, in u.
    pub node: f64,
    pub rank: f64,
    pub edge: f64,
}

/// A node's entry in the layout memory: its rank from 0, its place in its rank from 0, and its
/// box's top-left corner in u.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Place {
    pub rank: u32,
    pub order: u32,
    pub x: f64,
    pub y: f64,
}

impl deep_canvas::schedule::Canonical for Place {
    fn encode(&self, out: &mut Vec<u8>) {
        deep_canvas::schedule::Canonical::encode(&(&self.rank, &self.order, &self.x, &self.y), out);
    }
}

/// The layout memory, by stable node ID.
pub type Memory = BTreeMap<String, Place>;

fn size(value: Option<&Value>, path: &str) -> Result<f64, Refused> {
    match value.and_then(Value::as_f64) {
        Some(v) if v.is_finite() && v >= 0.0 => Ok(v),
        _ => refuse("bad_input", path),
    }
}

fn text(value: Option<&Value>, path: &str) -> Result<String, Refused> {
    match value.and_then(Value::as_str) {
        Some(s) if !s.is_empty() => Ok(s.to_string()),
        _ => refuse("bad_input", path),
    }
}

/// Reads `{nodes: [{id, w, h, …}], edges: [{id, a, b, min_len?, …}]}`.
pub fn read_graph(value: &Value) -> Result<Graph, Refused> {
    let (Some(Value::Array(nodes)), Some(Value::Array(edges))) =
        (value.get("nodes"), value.get("edges"))
    else {
        return refuse("bad_input", "graph");
    };
    let mut ids = BTreeSet::new();
    let mut read_nodes = Vec::with_capacity(nodes.len());
    for (i, n) in nodes.iter().enumerate() {
        let id = text(n.get("id"), &format!("nodes/{i}/id"))?;
        if !ids.insert(id.clone()) {
            return refuse("graph.duplicate_id", id);
        }
        read_nodes.push(Node {
            w: size(n.get("w"), &format!("nodes/{i}/w"))?,
            h: size(n.get("h"), &format!("nodes/{i}/h"))?,
            id,
        });
    }
    let node_ids = ids.clone();
    let mut read_edges = Vec::with_capacity(edges.len());
    for (i, e) in edges.iter().enumerate() {
        let id = text(e.get("id"), &format!("edges/{i}/id"))?;
        if !ids.insert(id.clone()) {
            return refuse("graph.duplicate_id", id);
        }
        let a = text(e.get("a"), &format!("edges/{i}/a"))?;
        let b = text(e.get("b"), &format!("edges/{i}/b"))?;
        if !node_ids.contains(&a) || !node_ids.contains(&b) || a == b {
            return refuse("graph.bad_edge", id);
        }
        let min_len = match e.get("min_len") {
            None => 1,
            Some(v) => match v.as_u64().and_then(|n| u32::try_from(n).ok()) {
                Some(n) if (1..=u32::from(u16::MAX)).contains(&n) => n,
                _ => return refuse("bad_input", format!("edges/{i}/min_len")),
            },
        };
        read_edges.push(Edge { id, a, b, min_len });
    }
    read_nodes.sort_by(|p, q| p.id.cmp(&q.id));
    read_edges.sort_by(|p, q| p.id.cmp(&q.id));
    Ok(Graph {
        nodes: read_nodes,
        edges: read_edges,
    })
}

/// Reads `{algo: "layered", direction?, seed, spacing?}`.
pub fn read_layout(value: &Value) -> Result<Layout, Refused> {
    if value.get("algo").and_then(Value::as_str) != Some("layered") {
        return refuse("layout.algo_unsupported", "algo");
    }
    let direction = match value.get("direction").map(Value::as_str) {
        None | Some(Some("down")) => Direction::Down,
        Some(Some("right")) => Direction::Right,
        _ => return refuse("bad_input", "direction"),
    };
    let seed = match value.get("seed").and_then(Value::as_u64) {
        Some(s) if s != 0 => s,
        _ => return refuse("layout.seed_required", "seed"),
    };
    let spacing = value.get("spacing");
    let gap = |name: &str, default: f64| match spacing.and_then(|s| s.get(name)) {
        None => Ok(default),
        some => size(some, &format!("spacing/{name}")),
    };
    Ok(Layout {
        direction,
        seed,
        node: gap("node", 24.0)?,
        rank: gap("rank", 48.0)?,
        edge: gap("edge", 12.0)?,
    })
}

/// Reads a memory `{id: [rank, order, x, y]}`.
pub fn read_memory(value: &Value) -> Result<Memory, Refused> {
    let Value::Object(entries) = value else {
        return refuse("bad_input", "memory");
    };
    let mut memory = Memory::new();
    for (id, entry) in entries {
        let place = match entry.as_array().map(Vec::as_slice) {
            Some([rank, order, x, y]) => {
                let whole = |v: &Value| v.as_u64().and_then(|n| u32::try_from(n).ok());
                match (whole(rank), whole(order), x.as_f64(), y.as_f64()) {
                    (Some(rank), Some(order), Some(x), Some(y))
                        if x.is_finite() && y.is_finite() =>
                    {
                        Place { rank, order, x, y }
                    }
                    _ => return refuse("bad_input", format!("memory/{id}")),
                }
            }
            _ => return refuse("bad_input", format!("memory/{id}")),
        };
        memory.insert(id.clone(), place);
    }
    Ok(memory)
}

pub fn write_memory(memory: &Memory) -> Value {
    Value::Object(
        memory
            .iter()
            .map(|(id, p)| (id.clone(), json!([p.rank, p.order, p.x, p.y])))
            .collect::<Map<_, _>>(),
    )
}

/// One place in a rank: a node, or a long edge passing through.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Slot {
    Node(usize),
    Pass,
}

/// Ranks by longest path over `min_len`, a source pulled down to just above its nearest child.
fn ranks(graph: &Graph, index: &BTreeMap<&str, usize>) -> Result<Vec<u32>, Refused> {
    let n = graph.nodes.len();
    let mut indegree = vec![0usize; n];
    let mut out: Vec<Vec<(usize, u32)>> = vec![Vec::new(); n];
    for e in &graph.edges {
        indegree[index[e.b.as_str()]] += 1;
        out[index[e.a.as_str()]].push((index[e.b.as_str()], e.min_len));
    }
    let sources: Vec<bool> = indegree.iter().map(|&d| d == 0).collect();
    let mut ready: BTreeSet<usize> = (0..n).filter(|&i| indegree[i] == 0).collect();
    let mut topo = Vec::with_capacity(n);
    let mut rank = vec![0u32; n];
    while let Some(i) = ready.pop_first() {
        topo.push(i);
        for &(j, len) in &out[i] {
            rank[j] = rank[j].max(rank[i] + len);
            indegree[j] -= 1;
            if indegree[j] == 0 {
                ready.insert(j);
            }
        }
    }
    if topo.len() < n {
        let stuck = (0..n)
            .find(|&i| indegree[i] > 0)
            .map_or("", |i| &graph.nodes[i].id);
        return refuse("layout.cycle", stuck);
    }
    for &i in topo.iter().rev() {
        if sources[i] {
            if let Some(nearest) = out[i].iter().map(|&(j, len)| rank[j] - len).min() {
                rank[i] = nearest;
            }
        }
    }
    Ok(rank)
}

/// The barycenter sweeps: four passes down and up, each a stable sort by the mean place of a slot's
/// neighbours in the rank before, so ties keep the order they had.
const SWEEPS: usize = 4;

/// Each rank's slots in order, as indices into the returned slot list.
fn order(
    graph: &Graph,
    index: &BTreeMap<&str, usize>,
    rank: &[u32],
) -> (Vec<Slot>, Vec<Vec<usize>>) {
    let depth = rank.iter().max().map_or(0, |&r| r as usize + 1);
    let mut slots: Vec<Slot> = (0..graph.nodes.len()).map(Slot::Node).collect();
    let mut rows: Vec<Vec<usize>> = vec![Vec::new(); depth];
    for (i, &r) in rank.iter().enumerate() {
        rows[r as usize].push(i);
    }
    // Each edge as a chain of links between adjacent ranks, through a pass slot in each rank it skips.
    let mut up: Vec<Vec<usize>> = vec![Vec::new(); slots.len()];
    let mut down: Vec<Vec<usize>> = vec![Vec::new(); slots.len()];
    for e in &graph.edges {
        let (a, b) = (index[e.a.as_str()], index[e.b.as_str()]);
        let mut upper = a;
        for r in rank[a] + 1..rank[b] {
            let pass = slots.len();
            slots.push(Slot::Pass);
            up.push(Vec::new());
            down.push(Vec::new());
            rows[r as usize].push(pass);
            down[upper].push(pass);
            up[pass].push(upper);
            upper = pass;
        }
        down[upper].push(b);
        up[b].push(upper);
    }
    let mut at = vec![0.0; slots.len()];
    for row in &rows {
        for (i, &s) in row.iter().enumerate() {
            at[s] = i as f64;
        }
    }
    for sweep in 0..2 * SWEEPS {
        let downward = sweep % 2 == 0;
        let span: Vec<usize> = if downward {
            (1..depth).collect()
        } else {
            (0..depth.saturating_sub(1)).rev().collect()
        };
        let near = if downward { &up } else { &down };
        for r in span {
            let mut keyed: Vec<(f64, usize)> = rows[r]
                .iter()
                .map(|&s| {
                    let mean = if near[s].is_empty() {
                        at[s]
                    } else {
                        near[s].iter().map(|&t| at[t]).sum::<f64>() / near[s].len() as f64
                    };
                    (mean, s)
                })
                .collect();
            keyed.sort_by(|p, q| p.0.total_cmp(&q.0));
            rows[r] = keyed.into_iter().map(|(_, s)| s).collect();
            for (i, &s) in rows[r].iter().enumerate() {
                at[s] = i as f64;
            }
        }
    }
    (slots, rows)
}

/// The basic layered layout of a graph, as a memory by node ID.
pub fn layered(graph: &Graph, layout: &Layout) -> Result<Memory, Refused> {
    let index: BTreeMap<&str, usize> = graph
        .nodes
        .iter()
        .enumerate()
        .map(|(i, n)| (n.id.as_str(), i))
        .collect();
    let rank = ranks(graph, &index)?;
    let (slots, rows) = order(graph, &index, &rank);
    let rows: Vec<Vec<Slot>> = rows
        .iter()
        .map(|row| row.iter().map(|&s| slots[s]).collect())
        .collect();
    // A node's extent along the ranks (down: its height) and across them (down: its width).
    let along = |n: &Node| match layout.direction {
        Direction::Down => n.h,
        Direction::Right => n.w,
    };
    let across = |n: &Node| match layout.direction {
        Direction::Down => n.w,
        Direction::Right => n.h,
    };
    let mut start = Vec::with_capacity(rows.len());
    let mut at = 0.0;
    for row in &rows {
        let depth = row
            .iter()
            .filter_map(|&s| match s {
                Slot::Node(i) => Some(along(&graph.nodes[i])),
                Slot::Pass => None,
            })
            .fold(0.0, f64::max);
        start.push((at, depth));
        at += depth + layout.rank;
    }
    let widths: Vec<f64> = rows
        .iter()
        .map(|row| {
            let mut width = 0.0;
            for (i, &s) in row.iter().enumerate() {
                width += match s {
                    Slot::Node(n) => across(&graph.nodes[n]),
                    Slot::Pass => 0.0,
                };
                if i + 1 < row.len() {
                    width += gap(layout, s, row[i + 1]);
                }
            }
            width
        })
        .collect();
    let widest = widths.iter().copied().fold(0.0, f64::max);
    let mut memory = Memory::new();
    for (r, row) in rows.iter().enumerate() {
        let (top, depth) = start[r];
        let mut cross = (widest - widths[r]) / 2.0;
        let mut order = 0;
        for (i, &s) in row.iter().enumerate() {
            if let Slot::Node(n) = s {
                let node = &graph.nodes[n];
                let main = top + (depth - along(node)) / 2.0;
                let (x, y) = match layout.direction {
                    Direction::Down => (cross, main),
                    Direction::Right => (main, cross),
                };
                memory.insert(
                    node.id.clone(),
                    Place {
                        rank: r as u32,
                        order,
                        x,
                        y,
                    },
                );
                order += 1;
                cross += across(node);
            }
            if i + 1 < row.len() {
                cross += gap(layout, s, row[i + 1]);
            }
        }
    }
    Ok(memory)
}

/// The gap between two neighbours in a rank: the node spacing beside a node, the edge spacing
/// between two passing edges.
fn gap(layout: &Layout, left: Slot, right: Slot) -> f64 {
    match (left, right) {
        (Slot::Pass, Slot::Pass) => layout.edge,
        _ => layout.node,
    }
}

/// Why a memory can't be kept: the nodes it lacks or whose edges its ranks break, and the full
/// relayout offered in its place.
#[derive(Clone, Debug, PartialEq)]
pub struct Relayout {
    pub nodes: Vec<String>,
    pub offered: Memory,
}

/// The layout of a graph a memory holds: the memory itself for the graph's nodes (each rank's order
/// renumbered when a removed node leaves a gap), or the relayout it would take.
pub fn keep(
    graph: &Graph,
    layout: &Layout,
    memory: &Memory,
) -> Result<Result<Memory, Relayout>, Refused> {
    let mut broken: BTreeSet<String> = graph
        .nodes
        .iter()
        .filter(|n| !memory.contains_key(&n.id))
        .map(|n| n.id.clone())
        .collect();
    for e in &graph.edges {
        if let (Some(a), Some(b)) = (memory.get(&e.a), memory.get(&e.b)) {
            if b.rank < a.rank.saturating_add(e.min_len) {
                broken.insert(e.b.clone());
            }
        }
    }
    if !broken.is_empty() {
        return Ok(Err(Relayout {
            nodes: broken.into_iter().collect(),
            offered: layered(graph, layout)?,
        }));
    }
    let mut kept: Vec<(&String, Place)> =
        graph.nodes.iter().map(|n| (&n.id, memory[&n.id])).collect();
    kept.sort_by(|p, q| (p.1.rank, p.1.order, p.0).cmp(&(q.1.rank, q.1.order, q.0)));
    let mut out = Memory::new();
    let mut previous = None;
    let mut order = 0;
    for (id, place) in kept {
        if previous != Some(place.rank) {
            order = 0;
            previous = Some(place.rank);
        }
        out.insert(id.clone(), Place { order, ..place });
        order += 1;
    }
    Ok(Ok(out))
}

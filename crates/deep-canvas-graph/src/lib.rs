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
//!
//! Issue #1826: graph's other own layouts, `tree`, `treemap` and `grid`, beside `layered` and
//! `pinned`, each under the memory's rules; [`lay`] lays a graph out by its layout's `algo`.

pub mod labels;
pub mod module;
pub mod route;
pub mod view;

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
    /// The group whose box it lays out in, if any.
    pub group: Option<String>,
    /// The item that draws it (a frame, card, icon or recipe instance), if any.
    pub item: Option<String>,
    /// What a treemap gives its rectangle's area in proportion to: 1 unless set, never negative.
    pub size: f64,
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

/// A layout's algorithm: graph's own entries of `graph.layout@1`.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Algo {
    Layered,
    Tree,
    Treemap,
    Grid,
    /// Every node at its memory's place.
    Pinned,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Layout {
    pub algo: Algo,
    pub direction: Direction,
    /// Required and non-zero, never the clock's. The basic layered layout draws nothing at random,
    /// so the same graph gives the same picture under any seed.
    pub seed: u64,
    /// Between boxes in a rank, between ranks, and taken by a long edge passing through a rank, in u.
    pub node: f64,
    pub rank: f64,
    pub edge: f64,
    /// A treemap's box `[x, y, w, h]` in u, which its leaves tile.
    pub bounds: Option<[f64; 4]>,
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

/// Reads `{nodes: [{id, w, h, size?, …}], edges: [{id, a, b, min_len?, …}]}`.
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
        let group = match n.get("group") {
            None | Some(Value::Null) => None,
            some => Some(text(some, &format!("nodes/{i}/group"))?),
        };
        let item = match n.get("item") {
            None | Some(Value::Null) => None,
            some => Some(text(some, &format!("nodes/{i}/item"))?),
        };
        read_nodes.push(Node {
            w: size(n.get("w"), &format!("nodes/{i}/w"))?,
            h: size(n.get("h"), &format!("nodes/{i}/h"))?,
            size: match n.get("size") {
                None => 1.0,
                some => size(some, &format!("nodes/{i}/size"))?,
            },
            id,
            group,
            item,
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

/// Reads `{algo: "layered" | "tree" | "treemap" | "grid" | "pinned", direction?, seed, spacing?}`,
/// and a treemap's `box: [x, y, w, h]`.
pub fn read_layout(value: &Value) -> Result<Layout, Refused> {
    let algo = match value.get("algo").and_then(Value::as_str) {
        Some("layered") => Algo::Layered,
        Some("tree") => Algo::Tree,
        Some("treemap") => Algo::Treemap,
        Some("grid") => Algo::Grid,
        Some("pinned") => Algo::Pinned,
        _ => return refuse("layout.algo_unsupported", "algo"),
    };
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
    let bounds = match value
        .get("box")
        .and_then(Value::as_array)
        .map(Vec::as_slice)
    {
        _ if algo != Algo::Treemap => None,
        Some([x, y, w, h]) => {
            let finite = |v: &Value| v.as_f64().filter(|v| v.is_finite());
            match (finite(x), finite(y), finite(w), finite(h)) {
                (Some(x), Some(y), Some(w), Some(h)) if w >= 0.0 && h >= 0.0 => Some([x, y, w, h]),
                _ => return refuse("bad_input", "box"),
            }
        }
        _ => return refuse("bad_input", "box"),
    };
    Ok(Layout {
        algo,
        direction,
        seed,
        node: gap("node", 24.0)?,
        rank: gap("rank", 48.0)?,
        edge: gap("edge", 12.0)?,
        bounds,
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

/// A group's box and its title's box, `[x, y, w, h]` in u.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct GroupBox {
    pub rect: [f64; 4],
    pub title: [f64; 4],
}

/// The band at a group box's top that holds its title, and the title's height inside it, in u.
pub const TITLE_BAND: f64 = 20.0;
pub const TITLE_HEIGHT: f64 = 16.0;
/// A title's width per character, in u: a 13 px label face's mean advance, rounded up.
pub const TITLE_ADVANCE: f64 = 7.0;

/// The layered layout with `groups: box` (graph@1, Semantics): the nodes of one group lay out
/// contiguous in every rank, as a column of its own inside a box the layout sizes around them with
/// the group's title on top; groups stand side by side in the order of their nodes' mean place in
/// their ranks, then by name. Nodes in no group share one column with no box.
pub fn grouped(
    graph: &Graph,
    layout: &Layout,
) -> Result<(Memory, BTreeMap<String, GroupBox>), Refused> {
    let index: BTreeMap<&str, usize> = graph
        .nodes
        .iter()
        .enumerate()
        .map(|(i, n)| (n.id.as_str(), i))
        .collect();
    let rank = ranks(graph, &index)?;
    let (slots, rows) = order(graph, &index, &rank);
    let rows: Vec<Vec<usize>> = rows
        .iter()
        .map(|row| {
            row.iter()
                .filter_map(|&s| match slots[s] {
                    Slot::Node(i) => Some(i),
                    Slot::Pass => None,
                })
                .collect()
        })
        .collect();
    let pad = layout.edge;
    let group = |i: usize| graph.nodes[i].group.as_deref();
    // Each column's mean place, a node's place in its rank as a fraction of the rank.
    let mut mean: BTreeMap<Option<&str>, (f64, f64)> = BTreeMap::new();
    for row in &rows {
        for (k, &i) in row.iter().enumerate() {
            let m = mean.entry(group(i)).or_default();
            m.0 += (k as f64 + 0.5) / row.len() as f64;
            m.1 += 1.0;
        }
    }
    let mut columns: Vec<(f64, Option<&str>)> =
        mean.iter().map(|(&g, &(sum, n))| (sum / n, g)).collect();
    columns.sort_by(|p, q| p.0.total_cmp(&q.0).then(p.1.cmp(&q.1)));
    let column: BTreeMap<Option<&str>, usize> = columns
        .iter()
        .enumerate()
        .map(|(c, &(_, g))| (g, c))
        .collect();
    let rows: Vec<Vec<usize>> = rows
        .into_iter()
        .map(|mut row| {
            row.sort_by_key(|&i| column[&group(i)]);
            row
        })
        .collect();
    let along = |i: usize| match layout.direction {
        Direction::Down => graph.nodes[i].h,
        Direction::Right => graph.nodes[i].w,
    };
    let across = |i: usize| match layout.direction {
        Direction::Down => graph.nodes[i].w,
        Direction::Right => graph.nodes[i].h,
    };
    // Each column's widest rank inside it, then its width with the box's padding.
    let mut inner = vec![0.0f64; columns.len()];
    for row in &rows {
        for (c, (_, g)) in columns.iter().enumerate() {
            let members: Vec<usize> = row.iter().copied().filter(|&i| group(i) == *g).collect();
            let w: f64 = members.iter().map(|&i| across(i)).sum::<f64>()
                + layout.node * members.len().saturating_sub(1) as f64;
            inner[c] = inner[c].max(w);
        }
    }
    let boxed = |c: usize| columns[c].1.is_some();
    // The layout keeps one padding clear of its origin, so no box touches the view's edge.
    let mut left = Vec::with_capacity(columns.len());
    let mut at = pad;
    for (c, w) in inner.iter().enumerate() {
        left.push(at);
        at += w + if boxed(c) { 2.0 * pad } else { 0.0 } + layout.node;
    }
    // Ranks leave room for a title band and a box's padding above and below.
    let gap = layout.rank.max(TITLE_BAND + 2.0 * pad + layout.edge);
    let mut start = Vec::with_capacity(rows.len());
    let mut top = TITLE_BAND + 2.0 * pad;
    for row in &rows {
        let depth = row.iter().map(|&i| along(i)).fold(0.0, f64::max);
        start.push((top, depth));
        top += depth + gap;
    }
    let mut memory = Memory::new();
    for (r, row) in rows.iter().enumerate() {
        let (top, depth) = start[r];
        for (c, (_, g)) in columns.iter().enumerate() {
            let members: Vec<usize> = row.iter().copied().filter(|&i| group(i) == *g).collect();
            let width: f64 = members.iter().map(|&i| across(i)).sum::<f64>()
                + layout.node * members.len().saturating_sub(1) as f64;
            let mut cross = left[c] + if boxed(c) { pad } else { 0.0 } + (inner[c] - width) / 2.0;
            for &i in &members {
                let main = top + (depth - along(i)) / 2.0;
                let (x, y) = match layout.direction {
                    Direction::Down => (cross, main),
                    Direction::Right => (main, cross),
                };
                let order = row.iter().position(|&k| k == i).unwrap_or(0) as u32;
                memory.insert(
                    graph.nodes[i].id.clone(),
                    Place {
                        rank: r as u32,
                        order,
                        x,
                        y,
                    },
                );
                cross += across(i) + layout.node;
            }
        }
    }
    let mut boxes = BTreeMap::new();
    for (c, (_, g)) in columns.iter().enumerate() {
        let Some(name) = g else { continue };
        // The members' extent along the ranks, from the first's top to the last's bottom.
        let (mut lo, mut hi) = (f64::INFINITY, f64::NEG_INFINITY);
        for n in graph
            .nodes
            .iter()
            .filter(|n| n.group.as_deref() == Some(*name))
        {
            let p = &memory[&n.id];
            let (main, len) = match layout.direction {
                Direction::Down => (p.y, n.h),
                Direction::Right => (p.x, n.w),
            };
            lo = lo.min(main);
            hi = hi.max(main + len);
        }
        let (lo, hi) = (lo - pad - TITLE_BAND, hi + pad);
        let (x0, w) = (left[c], inner[c] + 2.0 * pad);
        let rect = match layout.direction {
            Direction::Down => [x0, lo, w, hi - lo],
            Direction::Right => [lo, x0, hi - lo, w],
        };
        let title_w = (name.chars().count() as f64 * TITLE_ADVANCE).min(rect[2] - 2.0 * pad);
        let title = [
            rect[0] + pad,
            rect[1] + (TITLE_BAND - TITLE_HEIGHT) / 2.0,
            title_w,
            TITLE_HEIGHT,
        ];
        boxes.insert(name.to_string(), GroupBox { rect, title });
    }
    Ok((memory, boxes))
}

/// Why a memory can't be kept: the nodes whose ranks its edges break, and the full relayout
/// offered in its place.
#[derive(Clone, Debug, PartialEq)]
pub struct Relayout {
    pub nodes: Vec<String>,
    pub offered: Memory,
}

/// The layout of a graph against its memory (graph@1, Semantics): kept nodes keep their rank and
/// order as hard constraints, and their x and y unless their rank changed; a new node takes the
/// rank its edges ask and its neighbours' barycenter slot, and only the ranks it joins are
/// re-placed, the fewest moves that keep the spacing. A removed node leaves its rank's order
/// renumbered and every place kept. When the kept ranks can't hold an edge, or a new node's edges
/// ask for no rank, it returns the relayout it would take and moves nothing. Beside the layout, the
/// ranks it re-placed, ascending.
pub fn keep(
    graph: &Graph,
    layout: &Layout,
    memory: &Memory,
) -> Result<Result<(Memory, Vec<u32>), Relayout>, Refused> {
    kept(graph, layout, memory, layered)
}

/// [`keep`], offering `afresh`'s layout as the relayout: `layered`'s, or `tree`'s.
fn kept(
    graph: &Graph,
    layout: &Layout,
    memory: &Memory,
    afresh: fn(&Graph, &Layout) -> Result<Memory, Refused>,
) -> Result<Result<(Memory, Vec<u32>), Relayout>, Refused> {
    let index: BTreeMap<&str, usize> = graph
        .nodes
        .iter()
        .enumerate()
        .map(|(i, n)| (n.id.as_str(), i))
        .collect();
    let n = graph.nodes.len();
    let mut ins: Vec<Vec<(usize, u32)>> = vec![Vec::new(); n];
    let mut outs: Vec<Vec<(usize, u32)>> = vec![Vec::new(); n];
    for e in &graph.edges {
        let (a, b) = (index[e.a.as_str()], index[e.b.as_str()]);
        outs[a].push((b, e.min_len));
        ins[b].push((a, e.min_len));
    }
    let held: Vec<Option<Place>> = graph
        .nodes
        .iter()
        .map(|node| memory.get(&node.id).copied())
        .collect();
    let mut broken = BTreeSet::new();
    for e in &graph.edges {
        if let (Some(a), Some(b)) = (memory.get(&e.a), memory.get(&e.b)) {
            if b.rank < a.rank.saturating_add(e.min_len) {
                broken.insert(e.b.clone());
            }
        }
    }
    // New nodes in topological order among themselves, by ID where nothing orders them.
    let fresh: Vec<usize> = (0..n).filter(|&i| held[i].is_none()).collect();
    let mut waiting: Vec<usize> = (0..n)
        .map(|i| ins[i].iter().filter(|&&(a, _)| held[a].is_none()).count())
        .collect();
    let mut ready: BTreeSet<usize> = fresh.iter().copied().filter(|&i| waiting[i] == 0).collect();
    let mut topo = Vec::with_capacity(fresh.len());
    while let Some(i) = ready.pop_first() {
        topo.push(i);
        for &(b, _) in &outs[i] {
            if held[b].is_none() {
                waiting[b] -= 1;
                if waiting[b] == 0 {
                    ready.insert(b);
                }
            }
        }
    }
    if topo.len() < fresh.len() {
        if let Some(&stuck) = fresh.iter().find(|&&i| waiting[i] > 0) {
            broken.insert(graph.nodes[stuck].id.clone());
        }
    }
    // Each new node's highest rank its kept children allow, then its rank: just below its lowest
    // parent, or just above its nearest child when it has no parent.
    let mut upper: Vec<Option<i64>> = vec![None; n];
    for &i in topo.iter().rev() {
        upper[i] = outs[i]
            .iter()
            .filter_map(|&(b, len)| {
                held[b]
                    .map(|p| i64::from(p.rank))
                    .or(upper[b])
                    .map(|r| r - i64::from(len))
            })
            .min();
    }
    let mut rank: Vec<i64> = held
        .iter()
        .map(|p| p.map_or(-1, |p| i64::from(p.rank)))
        .collect();
    for &i in &topo {
        let lower = ins[i]
            .iter()
            .map(|&(a, len)| rank[a] + i64::from(len))
            .max();
        let r = match (lower, upper[i]) {
            (Some(lo), _) => lo,
            (None, Some(up)) => up,
            (None, None) => 0,
        };
        if r < 0 || upper[i].is_some_and(|up| r > up) {
            broken.insert(graph.nodes[i].id.clone());
        }
        rank[i] = r.max(0);
    }
    if !broken.is_empty() {
        return Ok(Err(Relayout {
            nodes: broken.into_iter().collect(),
            offered: afresh(graph, layout)?,
        }));
    }
    let along = |i: usize| match layout.direction {
        Direction::Down => graph.nodes[i].h,
        Direction::Right => graph.nodes[i].w,
    };
    let across = |i: usize| match layout.direction {
        Direction::Down => graph.nodes[i].w,
        Direction::Right => graph.nodes[i].h,
    };
    let split = |p: &Place| match layout.direction {
        Direction::Down => (p.x, p.y),
        Direction::Right => (p.y, p.x),
    };
    // Each rank's kept nodes in their kept order, and each rank's centre line along the ranks.
    let mut rows: BTreeMap<i64, Vec<usize>> = BTreeMap::new();
    let mut lines: BTreeMap<i64, f64> = BTreeMap::new();
    for i in 0..n {
        if let Some(p) = held[i] {
            rows.entry(rank[i]).or_default().push(i);
            lines.entry(rank[i]).or_insert(split(&p).1 + along(i) / 2.0);
        }
    }
    for row in rows.values_mut() {
        row.sort_by_key(|&i| (held[i].map_or(0, |p| p.order), &graph.nodes[i].id));
    }
    // Where each node's box starts across the ranks and along them.
    let mut cross: Vec<f64> = vec![0.0; n];
    let mut main: Vec<f64> = vec![0.0; n];
    for i in 0..n {
        if let Some(p) = held[i] {
            (cross[i], main[i]) = split(&p);
        }
    }
    let mut placed: Vec<bool> = held.iter().map(Option::is_some).collect();
    let mut joining: BTreeMap<i64, Vec<usize>> = BTreeMap::new();
    for &i in &topo {
        joining.entry(rank[i]).or_default().push(i);
    }
    for (&r, newcomers) in &joining {
        let row = rows.entry(r).or_default();
        let centre = |i: usize, cross: &[f64]| cross[i] + across(i) / 2.0;
        for &i in newcomers {
            let near: Vec<f64> = ins[i]
                .iter()
                .chain(&outs[i])
                .filter(|&&(j, _)| placed[j])
                .map(|&(j, _)| centre(j, &cross))
                .collect();
            let slot = if near.is_empty() {
                row.len()
            } else {
                let bary = near.iter().sum::<f64>() / near.len() as f64;
                row.iter()
                    .position(|&k| centre(k, &cross) > bary)
                    .unwrap_or(row.len())
            };
            let desired = if near.is_empty() {
                row.last()
                    .map_or(0.0, |&k| cross[k] + across(k) + layout.node)
            } else {
                near.iter().sum::<f64>() / near.len() as f64 - across(i) / 2.0
            };
            cross[i] = desired;
            row.insert(slot, i);
            placed[i] = true;
        }
        settle(row, &mut cross, &|i| across(i), layout.node);
        // The rank's centre line, or a new rank's below the last.
        let line = match lines.get(&r) {
            Some(&line) => line,
            None => {
                let below = (0..n)
                    .filter(|&k| placed[k] && rank[k] < r)
                    .map(|k| main[k] + along(k))
                    .fold(None, |m: Option<f64>, v| Some(m.map_or(v, |m| m.max(v))));
                let depth = newcomers.iter().map(|&i| along(i)).fold(0.0, f64::max);
                let line = below.map_or(depth / 2.0, |b| b + layout.rank + depth / 2.0);
                lines.insert(r, line);
                line
            }
        };
        for &i in newcomers {
            main[i] = line - along(i) / 2.0;
        }
    }
    let mut out = Memory::new();
    for (&r, row) in &rows {
        for (order, &i) in row.iter().enumerate() {
            let (x, y) = match layout.direction {
                Direction::Down => (cross[i], main[i]),
                Direction::Right => (main[i], cross[i]),
            };
            out.insert(
                graph.nodes[i].id.clone(),
                Place {
                    rank: r as u32,
                    order: order as u32,
                    x,
                    y,
                },
            );
        }
    }
    let replaced = joining.keys().map(|&r| r as u32).collect();
    Ok(Ok((out, replaced)))
}

/// The fewest moves across a rank that keep its order and spacing: each box keeps where it wants
/// to start unless a neighbour overlaps it, and boxes that overlap shift together to the mean of
/// where they want to be (pool-adjacent-violators, so the squared moves are least).
fn settle(row: &[usize], cross: &mut [f64], across: &dyn Fn(usize) -> f64, gap: f64) {
    // Each block: its first slot, its slot count, and its start's least-squares place.
    let mut blocks: Vec<(usize, usize, f64)> = Vec::new();
    let mut offset = vec![0.0; row.len()];
    for k in 1..row.len() {
        offset[k] = offset[k - 1] + across(row[k - 1]) + gap;
    }
    for k in 0..row.len() {
        blocks.push((k, 1, cross[row[k]] - offset[k]));
        while blocks.len() > 1 {
            let (s2, n2, p2) = blocks[blocks.len() - 1];
            let (s1, n1, p1) = blocks[blocks.len() - 2];
            if p1 <= p2 {
                break;
            }
            blocks.truncate(blocks.len() - 2);
            let mean = (p1 * n1 as f64 + p2 * n2 as f64) / (n1 + n2) as f64;
            assert_eq!(s1 + n1, s2);
            blocks.push((s1, n1 + n2, mean));
        }
    }
    for (start, count, at) in blocks {
        if count == 1 {
            continue;
        }
        cross[row[start]] = at + offset[start];
        for k in start + 1..start + count {
            cross[row[k]] = cross[row[k - 1]] + across(row[k - 1]) + gap;
        }
    }
    // Rounding never lets a gap fall short of the spacing.
    for k in 1..row.len() {
        cross[row[k]] = cross[row[k]].max(cross[row[k - 1]] + across(row[k - 1]) + gap);
    }
}

/// What [`lay`] placed: the memory; against a memory, the ranks it placed again, ascending (a
/// layout afresh places every rank and lists none); and for a treemap each leaf's rectangle
/// `[x, y, w, h]`, whose size is the layout's to give.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Laid {
    pub memory: Memory,
    pub replaced: Vec<u32>,
    pub boxes: BTreeMap<String, [f64; 4]>,
}

/// A graph laid out by its layout's `algo` (#1826): afresh with no memory, else against it, by
/// the memory's rules, so a graph its memory holds whole comes back as the memory says. `pinned`
/// lays out as `layered` here: a view pins its nodes itself.
pub fn lay(
    graph: &Graph,
    layout: &Layout,
    memory: Option<&Memory>,
) -> Result<Result<Laid, Relayout>, Refused> {
    let afresh: fn(&Graph, &Layout) -> Result<Memory, Refused> = if layout.algo == Algo::Tree {
        tree
    } else {
        layered
    };
    let (laid, boxes) = match (layout.algo, memory) {
        (Algo::Grid, _) => (grid(graph, layout, memory), BTreeMap::new()),
        (Algo::Treemap, _) => treemap(graph, layout, memory)?,
        (_, None) => (afresh(graph, layout)?, BTreeMap::new()),
        (_, Some(memory)) => {
            if layout.algo == Algo::Tree {
                forest(graph)?;
            }
            return Ok(
                kept(graph, layout, memory, afresh)?.map(|(memory, replaced)| Laid {
                    memory,
                    replaced,
                    boxes: BTreeMap::new(),
                }),
            );
        }
    };
    // The ranks of the entries the memory lacked or held elsewhere.
    let replaced: BTreeSet<u32> = memory.map_or_else(BTreeSet::new, |m| {
        laid.iter()
            .filter(|(id, place)| m.get(*id) != Some(*place))
            .map(|(_, place)| place.rank)
            .collect()
    });
    Ok(Ok(Laid {
        memory: laid,
        replaced: replaced.into_iter().collect(),
        boxes,
    }))
}

/// The rooted forest a graph's edges make: its roots, and each node's children, both in ID
/// order. An edge, taken in ID order, into a node that has a parent already, or from one of that
/// node's own descendants, breaks the tree and is the one named.
fn forest(graph: &Graph) -> Result<(Vec<usize>, Vec<Vec<usize>>), Refused> {
    let n = graph.nodes.len();
    let index: BTreeMap<&str, usize> = graph
        .nodes
        .iter()
        .enumerate()
        .map(|(i, n)| (n.id.as_str(), i))
        .collect();
    // Each node's way up to its tree's root so far, halved as it is walked.
    let mut up: Vec<usize> = (0..n).collect();
    let mut child = vec![false; n];
    let mut children: Vec<Vec<usize>> = vec![Vec::new(); n];
    for e in &graph.edges {
        let (a, b) = (index[e.a.as_str()], index[e.b.as_str()]);
        let mut root = a;
        while up[root] != root {
            up[root] = up[up[root]];
            root = up[root];
        }
        if child[b] || root == b {
            return refuse("layout.not_a_tree", &e.id);
        }
        child[b] = true;
        up[b] = root;
        children[a].push(b);
    }
    for row in &mut children {
        row.sort_unstable();
    }
    Ok(((0..n).filter(|&i| !child[i]).collect(), children))
}

/// The tree layout: one rank per depth along `direction`, `spacing.rank` between ranks as
/// `layered` spaces them, each parent centred over its children's centres, and each subtree in a
/// span of its own, `spacing.node` from its siblings'. A forest's trees stand side by side.
fn tree(graph: &Graph, layout: &Layout) -> Result<Memory, Refused> {
    let (roots, children) = forest(graph)?;
    let n = graph.nodes.len();
    let along = |i: usize| match layout.direction {
        Direction::Down => graph.nodes[i].h,
        Direction::Right => graph.nodes[i].w,
    };
    let across = |i: usize| match layout.direction {
        Direction::Down => graph.nodes[i].w,
        Direction::Right => graph.nodes[i].h,
    };
    // Parents before children, each depth from its first node across to its last.
    let mut order = roots.clone();
    let mut depth = vec![0usize; n];
    let mut next = 0;
    while let Some(&i) = order.get(next) {
        for &c in &children[i] {
            depth[c] = depth[i] + 1;
            order.push(c);
        }
        next += 1;
    }
    // Each subtree's reach to either side of its root's centre, and each child's centre from
    // its parent's.
    let mut reach = vec![(0.0, 0.0); n];
    let mut from = vec![0.0; n];
    for &i in order.iter().rev() {
        let half = across(i) / 2.0;
        let mut at = 0.0;
        let mut centres = Vec::with_capacity(children[i].len());
        for &c in &children[i] {
            if !centres.is_empty() {
                at += layout.node;
            }
            centres.push(at + reach[c].0);
            at += reach[c].0 + reach[c].1;
        }
        if centres.is_empty() {
            reach[i] = (half, half);
            continue;
        }
        let mid = centres.iter().sum::<f64>() / centres.len() as f64;
        for (&c, centre) in children[i].iter().zip(&centres) {
            from[c] = centre - mid;
        }
        reach[i] = (half.max(mid), half.max(at - mid));
    }
    let mut deep = vec![0.0f64; depth.iter().max().map_or(0, |d| d + 1)];
    for i in 0..n {
        deep[depth[i]] = deep[depth[i]].max(along(i));
    }
    let mut top = Vec::with_capacity(deep.len());
    let mut at = 0.0;
    for d in &deep {
        top.push(at);
        at += d + layout.rank;
    }
    let mut centre = vec![0.0; n];
    let mut at = 0.0;
    for &r in &roots {
        centre[r] = at + reach[r].0;
        at += reach[r].0 + reach[r].1 + layout.node;
    }
    let mut placed = vec![0u32; deep.len()];
    let mut memory = Memory::new();
    for &i in &order {
        for &c in &children[i] {
            centre[c] = centre[i] + from[c];
        }
        let cross = centre[i] - across(i) / 2.0;
        let main = top[depth[i]] + (deep[depth[i]] - along(i)) / 2.0;
        let (x, y) = match layout.direction {
            Direction::Down => (cross, main),
            Direction::Right => (main, cross),
        };
        memory.insert(
            graph.nodes[i].id.clone(),
            Place {
                rank: depth[i] as u32,
                order: placed[depth[i]],
                x,
                y,
            },
        );
        placed[depth[i]] += 1;
    }
    Ok(memory)
}

/// The grid layout: nodes in ID order in rows of ceil(√n), each centred in a cell the size of the
/// largest node, cells `spacing.node` apart; a row is a rank, stacked along `direction`. With a
/// memory, kept nodes keep their cells, and their x and y unless a new node widens the cell,
/// which changes every rank's width; new nodes take the free cells in order.
fn grid(graph: &Graph, layout: &Layout, memory: Option<&Memory>) -> Memory {
    let along = |n: &Node| match layout.direction {
        Direction::Down => n.h,
        Direction::Right => n.w,
    };
    let across = |n: &Node| match layout.direction {
        Direction::Down => n.w,
        Direction::Right => n.h,
    };
    let held = |n: &Node| memory.and_then(|m| m.get(&n.id));
    // The largest node's size, over every node or over the kept ones alone.
    let cell = |kept: bool| {
        graph
            .nodes
            .iter()
            .filter(|n| !kept || held(n).is_some())
            .fold((0.0f64, 0.0f64), |(w, h), n| {
                (w.max(across(n)), h.max(along(n)))
            })
    };
    let (wide, deep) = cell(false);
    let settled = cell(true) == (wide, deep);
    let at = |rank: u32, order: u32, n: &Node| {
        let cross = f64::from(order) * (wide + layout.node) + (wide - across(n)) / 2.0;
        let main = f64::from(rank) * (deep + layout.node) + (deep - along(n)) / 2.0;
        let (x, y) = match layout.direction {
            Direction::Down => (cross, main),
            Direction::Right => (main, cross),
        };
        Place { rank, order, x, y }
    };
    let taken: BTreeSet<(u32, u32)> = graph
        .nodes
        .iter()
        .filter_map(held)
        .map(|p| (p.rank, p.order))
        .collect();
    let columns = (1u32..)
        .find(|c| (*c as usize).saturating_mul(*c as usize) >= graph.nodes.len())
        .unwrap_or(1)
        .max(
            taken
                .iter()
                .map(|&(_, order)| order.saturating_add(1))
                .max()
                .unwrap_or(1),
        );
    let mut next = 0;
    let mut free = || loop {
        let slot = (next / columns, next % columns);
        next += 1;
        if !taken.contains(&slot) {
            return slot;
        }
    };
    let mut out = Memory::new();
    for n in &graph.nodes {
        let place = match held(n) {
            Some(&kept) if settled => kept,
            Some(kept) => at(kept.rank, kept.order, n),
            None => {
                let (rank, order) = free();
                at(rank, order, n)
            }
        };
        out.insert(n.id.clone(), place);
    }
    out
}

/// A squarified tiling of `rect` among `weights`, in their order: rows across the rectangle's
/// shorter side, each grown while its worst aspect ratio gets no worse, and each tile's area its
/// weight's share of the rectangle's. A weight of 0 takes no area.
fn squarify(weights: &[f64], rect: [f64; 4]) -> Vec<[f64; 4]> {
    let [mut x, mut y, mut w, mut h] = rect;
    let mut out = vec![[x, y, 0.0, 0.0]; weights.len()];
    let total: f64 = weights.iter().sum();
    let areas: Vec<(usize, f64)> = weights
        .iter()
        .enumerate()
        .filter(|(_, v)| **v > 0.0)
        .map(|(k, v)| (k, v / total * w * h))
        .collect();
    let mut i = 0;
    while i < areas.len() && w.min(h) > 0.0 {
        let short = w.min(h);
        let worst = |sum: f64, lo: f64, hi: f64| {
            (short * short * hi / (sum * sum)).max(sum * sum / (short * short * lo))
        };
        let (mut sum, mut lo, mut hi) = (areas[i].1, areas[i].1, areas[i].1);
        let mut j = i + 1;
        while let Some(&(_, a)) = areas.get(j) {
            if worst(sum + a, lo.min(a), hi.max(a)) > worst(sum, lo, hi) {
                break;
            }
            (sum, lo, hi) = (sum + a, lo.min(a), hi.max(a));
            j += 1;
        }
        // The row: a strip down the left of a wide rectangle, or across the top of a tall one.
        let strip = sum / short;
        let mut at = if w >= h { y } else { x };
        for &(k, a) in &areas[i..j] {
            let len = a / strip;
            out[k] = if w >= h {
                [x, at, strip, len]
            } else {
                [at, y, len, strip]
            };
            at += len;
        }
        if w >= h {
            (x, w) = (x + strip, w - strip);
        } else {
            (y, h) = (y + strip, h - strip);
        }
        i = j;
    }
    out
}

/// The treemap layout: the layout's box tiled by the graph's nodes as leaves, each leaf's
/// rectangle's area in proportion to its `size`, the leaves of one `group` nested in one
/// rectangle of the box. Tiles go largest first, ties by ID, a group at its leaves' sizes'
/// sum; with a memory, kept leaves keep their order and new ones follow. It has one rank, and a
/// leaf's order is its place in the tiling. Beside the memory, each leaf's rectangle.
fn treemap(
    graph: &Graph,
    layout: &Layout,
    memory: Option<&Memory>,
) -> Result<(Memory, BTreeMap<String, [f64; 4]>), Refused> {
    let Some(bounds) = layout.bounds else {
        return refuse("bad_input", "box");
    };
    let nodes = &graph.nodes;
    let mut leaves: Vec<usize> = (0..nodes.len()).collect();
    match memory {
        Some(m) => leaves.sort_by_key(|&i| {
            m.get(&nodes[i].id)
                .map_or((true, 0), |place| (false, place.order))
        }),
        None => leaves.sort_by(|&a, &b| nodes[b].size.total_cmp(&nodes[a].size)),
    }
    // The box's tiles: a group's leaves together where its first leaf stands, any other leaf alone.
    let mut tiles: Vec<Vec<usize>> = Vec::new();
    let mut groups: BTreeMap<&str, usize> = BTreeMap::new();
    for i in leaves {
        match nodes[i].group.as_deref() {
            Some(group) => match groups.get(group) {
                Some(&tile) => tiles[tile].push(i),
                None => {
                    groups.insert(group, tiles.len());
                    tiles.push(vec![i]);
                }
            },
            None => tiles.push(vec![i]),
        }
    }
    let sizes = |tile: &[usize]| tile.iter().map(|&i| nodes[i].size).collect::<Vec<_>>();
    let weight = |tile: &Vec<usize>| sizes(tile).iter().sum::<f64>();
    if memory.is_none() {
        tiles.sort_by(|a, b| weight(b).total_cmp(&weight(a)));
    }
    let outer = squarify(&tiles.iter().map(weight).collect::<Vec<_>>(), bounds);
    let mut laid = Memory::new();
    let mut boxes = BTreeMap::new();
    for (tile, rect) in tiles.iter().zip(outer) {
        let inner = match tile.as_slice() {
            [_] => vec![rect],
            _ => squarify(&sizes(tile), rect),
        };
        for (&i, [x, y, w, h]) in tile.iter().zip(inner) {
            let order = laid.len() as u32;
            laid.insert(
                nodes[i].id.clone(),
                Place {
                    rank: 0,
                    order,
                    x,
                    y,
                },
            );
            boxes.insert(nodes[i].id.clone(), [x, y, w, h]);
        }
    }
    Ok((laid, boxes))
}

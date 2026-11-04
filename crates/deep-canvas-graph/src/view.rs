//! A `graph@1` item as a view draws it (issue #399): its nodes' boxes laid out, kept by its
//! memory or pinned to it, its groups' boxes and titles, and its edges' routes, in document u from
//! the item's origin. What draws each node (a box of its own, or the item it names) is the
//! renderer's; this module only places.

use std::collections::BTreeMap;

use serde_json::Value;

use crate::route::{self, Ask, Obstacle, Point, Side, Style};
use crate::{
    grouped, keep, layered, read_graph, read_layout, read_memory, Graph, GroupBox, Memory, Refused,
};

/// How edges are routed: around obstacles, or #399 AC7's planted straight router.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum Router {
    #[default]
    Orthogonal,
    Straight,
}

/// A graph item's laid-out view.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Drawn {
    pub nodes: BTreeMap<String, [f64; 4]>,
    pub groups: BTreeMap<String, GroupBox>,
    pub routes: BTreeMap<String, Vec<Point>>,
}

/// The graph of a `graph@1` item's params and its nodes' boxes at `origin`: pinned to its memory,
/// kept by it (the old picture when a change can't hold), or laid out afresh, in groups' boxes
/// when its nodes name groups and `groups` isn't `none`.
pub fn place(params: &Value, origin: [f64; 2]) -> Result<(Graph, Drawn), Refused> {
    let graph = read_graph(&params["graph"])?;
    let layout = read_layout(&params["layout"])?;
    let memory = match params.get("memory") {
        None | Some(Value::Null) => None,
        Some(m) => Some(read_memory(m)?),
    };
    let boxed = params.get("groups").and_then(Value::as_str) != Some("none")
        && graph.nodes.iter().any(|n| n.group.is_some());
    let (places, groups): (Memory, BTreeMap<String, GroupBox>) = match (&memory, layout.pinned) {
        (Some(m), true) => (m.clone(), BTreeMap::new()),
        (None, true) => {
            return Err(Refused {
                code: "bad_input",
                names: "memory".into(),
            })
        }
        (Some(m), false) => match keep(&graph, &layout, m)? {
            Ok((kept, _)) => (kept, BTreeMap::new()),
            Err(_) => (m.clone(), BTreeMap::new()),
        },
        (None, false) if boxed => grouped(&graph, &layout)?,
        (None, false) => (layered(&graph, &layout)?, BTreeMap::new()),
    };
    let mut drawn = Drawn::default();
    for n in &graph.nodes {
        if let Some(p) = places.get(&n.id) {
            drawn
                .nodes
                .insert(n.id.clone(), [origin[0] + p.x, origin[1] + p.y, n.w, n.h]);
        }
    }
    let at = |r: [f64; 4]| [origin[0] + r[0], origin[1] + r[1], r[2], r[3]];
    drawn.groups = groups
        .into_iter()
        .map(|(name, g)| {
            (
                name,
                GroupBox {
                    rect: at(g.rect),
                    title: at(g.title),
                },
            )
        })
        .collect();
    Ok((graph, drawn))
}

/// The sides an edge leaves and enters by: down the ranks when the second box lies below the
/// first, up when above, else across.
fn sides(a: [f64; 4], b: [f64; 4]) -> (Side, Side) {
    if b[1] >= a[1] + a[3] {
        (Side::S, Side::N)
    } else if b[1] + b[3] <= a[1] {
        (Side::N, Side::S)
    } else if b[0] >= a[0] + a[2] {
        (Side::E, Side::W)
    } else {
        (Side::W, Side::E)
    }
}

/// Where the line between two boxes' centres leaves a box.
fn border(r: [f64; 4], towards: Point) -> Point {
    let c = (r[0] + r[2] / 2.0, r[1] + r[3] / 2.0);
    let (dx, dy) = (towards.0 - c.0, towards.1 - c.1);
    let sx = if dx == 0.0 {
        f64::INFINITY
    } else {
        (r[2] / 2.0) / dx.abs()
    };
    let sy = if dy == 0.0 {
        f64::INFINITY
    } else {
        (r[3] / 2.0) / dy.abs()
    };
    let s = sx.min(sy).min(1.0);
    (c.0 + dx * s, c.1 + dy * s)
}

/// Every edge's route, in edge-ID order, around the other nodes, the groups' titles and `avoid`
/// (the node labels), keeping `clearance` u from each.
pub fn routes(
    graph: &Graph,
    drawn: &mut Drawn,
    avoid: &[Obstacle],
    clearance: f64,
    router: Router,
) -> Vec<String> {
    let mut obstacles: Vec<Obstacle> = drawn
        .groups
        .iter()
        .map(|(name, g)| Obstacle {
            id: format!("title:{name}"),
            rect: g.title,
        })
        .collect();
    obstacles.extend(avoid.iter().cloned());
    let mut asks = Vec::new();
    for e in &graph.edges {
        let (Some(&a), Some(&b)) = (drawn.nodes.get(&e.a), drawn.nodes.get(&e.b)) else {
            continue;
        };
        if router == Router::Straight {
            let centre = |r: [f64; 4]| (r[0] + r[2] / 2.0, r[1] + r[3] / 2.0);
            drawn.routes.insert(
                e.id.clone(),
                vec![border(a, centre(b)), border(b, centre(a))],
            );
            continue;
        }
        let (a_side, b_side) = sides(a, b);
        asks.push(Ask {
            id: e.id.clone(),
            a,
            b,
            a_side,
            b_side,
        });
    }
    if asks.is_empty() {
        return Vec::new();
    }
    // Every node is an obstacle; an edge's own two are left by their ports' stubs.
    obstacles.extend(drawn.nodes.iter().map(|(id, &rect)| Obstacle {
        id: id.clone(),
        rect,
    }));
    let style = Style {
        clearance,
        bend: clearance,
    };
    let (found, blocked) = route::route(&asks, &obstacles, style);
    drawn.routes.extend(found);
    blocked
}

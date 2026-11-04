//! The layout memory's R1 rule (#394; graph@1: "It can never: Move a pinned or unchanged node
//! without a relayout you saw"): a graph the memory still holds keeps every node where it was, and
//! one it can't hold is refused with the relayout offered, never laid out again on its own.

use deep_canvas_graph::{keep, layered, read_graph, read_layout};
use serde_json::{json, Value};

fn graph(extra: bool) -> Value {
    let mut nodes = vec![
        json!({"id": "a", "w": 40, "h": 20}),
        json!({"id": "b", "w": 60, "h": 20}),
        json!({"id": "c", "w": 50, "h": 30}),
    ];
    let mut edges = vec![
        json!({"id": "ab", "a": "a", "b": "b"}),
        json!({"id": "ac", "a": "a", "b": "c"}),
    ];
    if extra {
        nodes.push(json!({"id": "d", "w": 30, "h": 20}));
        edges.push(json!({"id": "bd", "a": "b", "b": "d"}));
    }
    json!({"nodes": nodes, "edges": edges})
}

#[test]
fn a_new_node_joins_its_rank_and_a_removed_one_moves_nothing() {
    let layout = read_layout(&json!({"algo": "layered", "seed": 1})).expect("a layout");
    let three = read_graph(&graph(false)).expect("a graph");
    let memory = layered(&three, &layout).expect("laid out");

    let four = read_graph(&graph(true)).expect("a graph");
    let kept = keep(&four, &layout, &memory)
        .expect("read")
        .expect("d joins rank 2")
        .0;
    assert_eq!(kept["d"].rank, kept["b"].rank + 1);
    for id in ["a", "b", "c"] {
        assert_eq!(kept[id], memory[id], "{id} stays put");
    }

    let mut two = graph(false);
    two["nodes"]
        .as_array_mut()
        .expect("nodes")
        .retain(|n| n["id"] != "c");
    two["edges"]
        .as_array_mut()
        .expect("edges")
        .retain(|e| e["id"] != "ac");
    let kept = keep(&read_graph(&two).expect("a graph"), &layout, &memory)
        .expect("read")
        .expect("kept")
        .0;
    for id in ["a", "b"] {
        assert_eq!(
            (kept[id].rank, kept[id].x, kept[id].y),
            (memory[id].rank, memory[id].x, memory[id].y),
            "{id} stays put"
        );
    }
}

/// graph@1's metamorphic fixture: adding one node and its edge to a rank leaves every node
/// outside that rank at its x and y bit for bit and every rank's order unchanged.
#[test]
fn adding_a_node_re_places_only_its_rank() {
    let layout = read_layout(&json!({"algo": "layered", "seed": 7})).expect("a layout");
    let sizes = [6, 7, 7, 6, 7, 7];
    let id = |r: usize, k: usize| format!("n{r}_{k}");
    let mut nodes = Vec::new();
    let mut edges = Vec::new();
    for (r, &count) in sizes.iter().enumerate() {
        for k in 0..count {
            nodes.push(json!({"id": id(r, k), "w": 40 + (k * 7 % 30), "h": 24}));
            if r > 0 {
                let p = (k * 5 + r) % sizes[r - 1];
                edges.push(json!({"id": format!("e{r}_{k}"), "a": id(r - 1, p), "b": id(r, k)}));
            }
        }
    }
    let before = read_graph(&json!({"nodes": nodes, "edges": edges})).expect("a graph");
    let memory = layered(&before, &layout).expect("laid out");
    nodes.push(json!({"id": "new", "w": 50, "h": 24}));
    edges.push(json!({"id": "enew", "a": id(2, 3), "b": "new"}));
    let after = read_graph(&json!({"nodes": nodes, "edges": edges})).expect("a graph");
    let (kept, replaced) = keep(&after, &layout, &memory).expect("read").expect("kept");
    assert_eq!(replaced, [3]);
    assert_eq!(kept["new"].rank, 3);
    for (node, place) in &memory {
        if place.rank != 3 {
            assert_eq!(kept[node], *place, "{node} stays put");
        }
    }
    let row = |m: &deep_canvas_graph::Memory| {
        let mut ids: Vec<(u32, String)> = m
            .iter()
            .filter(|(n, p)| p.rank == 3 && n.as_str() != "new")
            .map(|(n, p)| (p.order, n.clone()))
            .collect();
        ids.sort();
        ids.into_iter().map(|(_, n)| n).collect::<Vec<_>>()
    };
    assert_eq!(row(&kept), row(&memory));
    let mut xs: Vec<(u32, f64)> = kept
        .values()
        .filter(|p| p.rank == 3)
        .map(|p| (p.order, p.x))
        .collect();
    xs.sort_by_key(|p| p.0);
    for w in xs.windows(2) {
        assert!(
            w[1].1 > w[0].1,
            "rank 4 keeps its order and doesn't overlap"
        );
    }
}

#[test]
fn a_memory_whose_ranks_an_edge_breaks_asks_for_a_relayout() {
    let layout = read_layout(&json!({"algo": "layered", "seed": 1})).expect("a layout");
    let three = read_graph(&graph(false)).expect("a graph");
    let mut memory = layered(&three, &layout).expect("laid out");
    memory.get_mut("c").expect("c").rank = 0;
    let relayout = keep(&three, &layout, &memory)
        .expect("read")
        .expect_err("ac goes up");
    assert_eq!(relayout.nodes, ["c"]);
}

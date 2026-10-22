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
fn a_new_node_asks_for_a_relayout_and_a_removed_one_moves_nothing() {
    let layout = read_layout(&json!({"algo": "layered", "seed": 1})).expect("a layout");
    let three = read_graph(&graph(false)).expect("a graph");
    let memory = layered(&three, &layout).expect("laid out");

    let four = read_graph(&graph(true)).expect("a graph");
    let relayout = keep(&four, &layout, &memory)
        .expect("read")
        .expect_err("d is new");
    assert_eq!(relayout.nodes, ["d"]);
    assert_eq!(relayout.offered, layered(&four, &layout).expect("laid out"));

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
        .expect("kept");
    for id in ["a", "b"] {
        assert_eq!(
            (kept[id].rank, kept[id].x, kept[id].y),
            (memory[id].rank, memory[id].x, memory[id].y),
            "{id} stays put"
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

//! Graph's own layouts beside `layered` (#1826), where the issue's scope asks and no acceptance
//! criterion reaches: a treemap's groups and sizes, the memory's rules for a grid and a treemap,
//! and what breaks a tree.

use deep_canvas_graph::view::{place, routes, Router};
use deep_canvas_graph::{lay, read_graph, read_layout, Laid};
use serde_json::{json, Value};

fn laid(nodes: Value, layout: &Value, memory: Option<&Laid>) -> Laid {
    let graph = read_graph(&json!({"nodes": nodes, "edges": []})).expect("a graph");
    let layout = read_layout(layout).expect("a layout");
    lay(&graph, &layout, memory.map(|m| &m.memory))
        .expect("laid out")
        .expect("kept")
}

#[test]
fn a_treemap_nests_a_groups_leaves_and_reads_each_size() {
    let nodes = json!([
        {"id": "a", "w": 0, "h": 0, "size": 2, "group": "g"},
        {"id": "b", "w": 0, "h": 0, "size": 2, "group": "g"},
        {"id": "c", "w": 0, "h": 0},
        {"id": "d", "w": 0, "h": 0, "size": 3},
        {"id": "e", "w": 0, "h": 0, "size": 0},
    ]);
    let layout = json!({"algo": "treemap", "seed": 1, "box": [0, 0, 80, 100]});
    let boxes = laid(nodes, &layout, None).boxes;
    // Each area is its size's share of the box, 1,000 u² a unit; c's size is 1 unless set.
    for (id, size) in [("a", 2.0), ("b", 2.0), ("c", 1.0), ("d", 3.0), ("e", 0.0)] {
        let [_, _, w, h] = boxes[id];
        assert!((w * h - size * 1000.0).abs() < 1e-6, "{id}: {} u²", w * h);
    }
    // The group's two leaves tile one rectangle: their bounds hold no one else's area.
    let (a, b) = (boxes["a"], boxes["b"]);
    let w = (a[0] + a[2]).max(b[0] + b[2]) - a[0].min(b[0]);
    let h = (a[1] + a[3]).max(b[1] + b[3]) - a[1].min(b[1]);
    assert!((w * h - 4000.0).abs() < 1e-6, "g's leaves span {w} × {h} u");
    let below = json!({"nodes": [{"id": "a", "w": 0, "h": 0, "size": -1}], "edges": []});
    assert_eq!(read_graph(&below).unwrap_err().names, "nodes/0/size");
}

#[test]
fn a_grid_keeps_its_memory_and_a_new_node_takes_the_free_cell() {
    let node = |id: &str| json!({"id": id, "w": 40, "h": 24});
    let layout = json!({"algo": "grid", "seed": 1});
    let five = laid(json!(["b", "c", "d", "e", "f"].map(node)), &layout, None);
    // `a` sorts first, where a grid afresh would put it and move every other node.
    let nodes = json!(["a", "b", "c", "d", "e", "f"].map(node));
    let six = laid(nodes, &layout, Some(&five));
    for (id, place) in &five.memory {
        assert_eq!(six.memory[id], *place, "{id} stays put");
    }
    assert_eq!((six.memory["a"].rank, six.memory["a"].order), (1, 2));
    assert_eq!(six.replaced, [1]);
}

#[test]
fn a_treemap_keeps_its_leaves_order_when_sizes_change() {
    let leaves = |a: u32| {
        json!([
            {"id": "a", "w": 0, "h": 0, "size": a},
            {"id": "b", "w": 0, "h": 0, "size": 2},
            {"id": "c", "w": 0, "h": 0, "size": 3},
        ])
    };
    let order = |laid: &Laid| ["a", "b", "c"].map(|id| laid.memory[id].order);
    let layout = json!({"algo": "treemap", "seed": 1, "box": [0, 0, 300, 100]});
    let first = laid(leaves(1), &layout, None);
    assert_eq!(order(&first), [2, 1, 0], "largest first");
    let grown = laid(leaves(9), &layout, Some(&first));
    assert_eq!(order(&grown), [2, 1, 0], "a grew past c and kept its place");
    let again = laid(leaves(1), &layout, Some(&first));
    assert_eq!(
        (again.memory, again.boxes, again.replaced),
        (first.memory, first.boxes, vec![]),
        "the graph its memory holds comes back the same"
    );
}

#[test]
fn a_second_parent_breaks_a_tree_and_a_forest_stands_side_by_side() {
    let node = |id: &str| json!({"id": id, "w": 40, "h": 24});
    let layout = read_layout(&json!({"algo": "tree", "seed": 1})).expect("a layout");
    let graph = |to: &str| {
        let nodes = ["a", "b", "c", "d"].map(node);
        let edges = json!([{"id": "e1", "a": "a", "b": "c"}, {"id": "e2", "a": "b", "b": to}]);
        read_graph(&json!({"nodes": nodes, "edges": edges})).expect("a graph")
    };
    let refused = lay(&graph("c"), &layout, None).unwrap_err();
    assert_eq!(
        (refused.code, refused.names.as_str()),
        ("layout.not_a_tree", "e2")
    );
    let m = lay(&graph("d"), &layout, None)
        .expect("laid out")
        .expect("kept")
        .memory;
    assert_eq!(["a", "b", "c", "d"].map(|id| m[id].rank), [0, 0, 1, 1]);
    assert_eq!(m["b"].x - (m["a"].x + 40.0), 24.0, "spacing.node apart");
    assert_eq!((m["c"].x, m["d"].x), (m["a"].x, m["b"].x));
}

#[test]
fn a_trees_routes_leave_their_parent_in_their_childrens_order() {
    let nodes = ["a", "b", "c"].map(|id| json!({"id": id, "w": 40, "h": 24}));
    // By ID the edge to `c`, the right child, comes first.
    let edges = json!([{"id": "e1", "a": "b", "b": "c"}, {"id": "e2", "a": "b", "b": "a"}]);
    let layout = json!({"algo": "tree", "seed": 1});
    let params = json!({"graph": {"nodes": nodes, "edges": edges}, "layout": layout});
    let (graph, mut drawn) = place(&params, [0.0, 0.0]).expect("placed");
    let blocked = routes(&graph, &mut drawn, &[], 8.0, Router::Orthogonal);
    assert!(blocked.is_empty(), "every edge finds its way: {blocked:?}");
    let (left, right) = (drawn.routes["e2"][0].0, drawn.routes["e1"][0].0);
    assert!(
        left < right,
        "the route to `a`, the left child, leaves at {left}, and the one to `c` at {right}"
    );
}

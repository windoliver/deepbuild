//! #2660 criterion 1: a build of a 10,000-row mark set at depth 2 inside an auto-layout frame
//! makes at least 50,000 fewer heap allocations than on the merge base, counted as
//! `crates/deep-marks-render/tests/no_alloc.rs` counts, and its draw list hashes the same.
//!
//! The build is `deep_canvas_marks::scene::frame`, the draw list for a document's items. The merge
//! base's count and draw-list hash are `fixtures/layout-marks-base.json`, read at the base (see
//! the README). The draw list's hash is each layer's ID, mark count and content key, which covers
//! every mark the layer draws in draw order.

mod alloc;

#[global_allocator]
static ALLOCATOR: alloc::Counting = alloc::Counting;

use deep_canvas_marks::scene::{frame, Frame, Palette, Record};
use serde_json::{json, Value};

const ROWS: usize = 10_000;

/// A `row` frame with one flow child, a 10,000-point mark set: the set's rank is two tree levels,
/// the frame's and its own, each with an order key and an ID.
fn document() -> Value {
    let column = |f: &dyn Fn(usize) -> f32| {
        let bytes: Vec<u8> = (0..ROWS).flat_map(|i| f(i).to_le_bytes()).collect();
        json!({"dtype": "f32", "len": ROWS, "data": deep_canvas::base64::encode(&bytes)})
    };
    json!({
        "format": 1, "size": [1200, 800],
        "layers": {"main": {"order": "a0"}},
        "items": {
            "board": {"id": "board", "kind": "frame@1", "layer": "main", "order": "a0",
                "params": {"layout": "row", "padding": 8, "gap": 4}, "at": {"pos": [0, 0, 0]}},
            "dots": {"id": "dots", "kind": "marks@1", "layer": "main", "parent": "board", "order": "b0",
                "params": {"mark": "point", "n": ROWS,
                    "box": [0, 0, 1000, 700], "width": "fixed", "height": "fixed",
                    "columns": {"x": column(&|i| (i % 100) as f32 * 10.0),
                                "y": column(&|i| (i / 100) as f32 * 7.0)},
                    "encode": {"x": {"column": "x"}, "y": {"column": "y"}},
                    "paint": {"fill": {"role": "ink"}}}}
        }
    })
}

fn palette() -> Palette {
    [
        ("ground".to_string(), [255, 255, 255]),
        ("ink".to_string(), [20, 20, 20]),
    ]
    .into()
}

/// The draw list's hash: each layer's ID, mark count and content key, in layer order.
fn hash(f: &Frame) -> String {
    f.layers
        .iter()
        .map(|l| {
            let key: String = l.key.0.iter().map(|b| format!("{b:02x}")).collect();
            format!("{}:{}:{key}", l.id, l.marks.len())
        })
        .collect::<Vec<_>>()
        .join(",")
}

fn base() -> Value {
    let file = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../tests/acceptance/2660/fixtures/layout-marks-base.json");
    serde_json::from_str(&std::fs::read_to_string(file).expect("the base reading")).unwrap()
}

// AC1 #2660.d3570005
#[test]
fn ac1_a_laid_out_mark_set_builds_with_50000_fewer_allocations_and_the_same_draw_list() {
    let doc = document();
    let doc = doc.as_object().unwrap();
    let items = doc["items"].as_object().unwrap();
    let (palette, record) = (palette(), Record::default());
    // Warm-up: the first build fills the process's caches (shaping, tessellation).
    frame(doc, items, &palette, &record, 1.0).expect("the document builds");
    let (built, counted) = alloc::counted(|| frame(doc, items, &palette, &record, 1.0));
    let built = built.expect("the document builds");
    let marks: usize = built.layers.iter().map(|l| l.marks.len()).sum();
    let got = hash(&built);
    eprintln!(
        "build: {} allocations, {} bytes; {marks} marks; draw list {got}",
        counted.count, counted.bytes
    );
    // The build drew the set: a mark per row, the frame and nothing else drawn twice.
    assert!(
        marks >= ROWS,
        "the build drew {marks} marks, not the set's {ROWS} rows"
    );
    let base = base();
    assert_eq!(
        got,
        base["hash"].as_str().unwrap(),
        "the draw list differs from the merge base's"
    );
    let was = base["allocations"].as_u64().unwrap();
    let fewer = was as i64 - counted.count as i64;
    assert!(
        fewer >= 50_000,
        "the build made {} heap allocations, {fewer} fewer than the merge base's {was}; at least 50,000 fewer are owed",
        counted.count
    );
}

//! #2660 criterion 2: a one-item change on a document with 2,000 text items, taken by the fast
//! path, allocates under 64 KB. On the merge base the fast path copies both text maps (each text's
//! run and each animated text's units) into the frame it writes, and the test fails, naming the
//! bytes.
//!
//! The change is the scheduler's: the session revises the one item (`revise_items`) and runs the
//! frame that follows, every operator in it, on the shipped text, look, marks2d and data modules.
//! The item changed is one of 40 rects beside the texts, moved: a text's own move shapes it again,
//! which the fast path doesn't take on the merge base.
//! The bytes are those its heap allocations ask for, counted as
//! `crates/deep-marks-render/tests/no_alloc.rs` counts allocations.
//!
//! Redrafted blind for #3447: `revise_items` takes a fourth argument since #2700, `reached`, the
//! members besides `items` the patch reached. A rect's move reaches none, so it is empty.

// The first draft's counting allocator, read where it is.
#[path = "../2660/alloc.rs"]
mod alloc;

#[global_allocator]
static ALLOCATOR: alloc::Counting = alloc::Counting;

use deep_canvas::registry::{BuildSet, Registry};
use deep_canvas::schedule::{default_view, Options, Scheduler, Session};
use deep_canvas_marks::modules::{tokens, Drawing};
use serde_json::{json, Map, Value};

const TEXTS: usize = 2_000;
const RECTS: usize = 40;
const LIMIT: u64 = 64 * 1024;

fn board() -> Value {
    let mut items = Map::new();
    for i in 0..TEXTS {
        let id = format!("t{i:04}");
        items.insert(
            id.clone(),
            json!({"id": id, "kind": "text@1", "layer": "a", "name": id, "order": format!("b{i:04}"),
                   "params": {"text": format!("Row {i}"), "font": "body", "size": 12, "box": {"w": 60, "h": 16}},
                   "at": {"pos": [(i % 25) * 64, (i / 25) * 12, 0]}}),
        );
    }
    for i in 0..RECTS {
        let id = format!("r{i:02}");
        items.insert(
            id.clone(),
            json!({"id": id, "kind": "rect@1", "layer": "a", "name": id, "order": format!("c{i:02}"),
                   "params": {"box": [0, 0, 8, 6], "paint": {"fill": {"role": "accent"}}},
                   "at": {"pos": [i * 40, 980, 0]}}),
        );
    }
    json!({"format": 1, "profile": "board", "title": "Texts", "description": "2,000 labels.",
           "size": [1600, 1000],
           "layers": {"a": {"writer": "agent:t", "title": "A", "order": "a1"}}, "items": items})
}

fn drawing(s: &Scheduler<'_>, session: &Session) -> std::sync::Arc<Drawing> {
    session
        .value(s, "marks2d.frame", None)
        .and_then(|v| v.as_typed::<Drawing>())
        .expect("a drawing")
}

// AC2 #2660.1b678fb1
#[test]
fn ac2_a_one_item_change_on_the_fast_path_allocates_under_64_kb() {
    let mut registry = Registry::new(BuildSet::R1);
    for m in [
        deep_canvas_marks::modules::text(),
        deep_canvas_marks::modules::look(),
        deep_canvas_marks::modules::marks2d(),
        deep_canvas_marks::modules::data(),
    ] {
        registry = registry.with(m);
    }
    let sealed = registry.seal().expect("seals");
    let def = deep_canvas_marks::look::shipped("clean").expect("the clean look ships");
    let bundled: Vec<&str> = deep_text::FACES.iter().map(|f| f.file).collect();
    let look = deep_canvas_marks::look::resolve(&def, &bundled).expect("the clean look resolves");
    let mut s = Scheduler::new(&sealed, Options::default());
    let mut doc = board();
    let view = default_view(&doc);
    let mut live = Session::new(0, tokens(&look.light));
    live.load(&mut s, &doc);
    live.frame(&mut s, 0, &view);
    assert_eq!(
        drawing(&s, &live).frame.layers.iter().map(|l| l.marks.len()).sum::<usize>(),
        TEXTS + RECTS,
        "the frame draws every text and rect"
    );
    // Two changes warm the fast path; the third is counted.
    let mut last = None;
    for k in 0..3usize {
        let id = format!("r{:02}", 5 + k * 7);
        doc["items"][&id]["at"]["pos"] = json!([3 + k * 50, 960, 0]);
        let ((), counted) = alloc::counted(|| {
            assert!(
                live.revise_items(&mut s, &doc, &[&id], &[]).is_some(),
                "{id}'s move revises the one item"
            );
            live.frame(&mut s, 0, &view);
        });
        let got = drawing(&s, &live);
        // The change was taken by the fast path: the frame replaced the item's one mark in the
        // last list.
        assert_eq!(got.built, 1, "{id}'s move replaces its item's one mark");
        assert_eq!(got.damage.len(), 1, "{id}'s move damages one layer");
        assert_eq!(got.runs.len(), TEXTS, "the frame keeps every text's run");
        last = Some(counted);
    }
    let counted = last.unwrap();
    // A reading beside the count: what a copy of the frame's two text maps asks for.
    let got = drawing(&s, &live);
    let (_, copy) = alloc::counted(|| (got.runs.clone(), got.animated.clone()));
    eprintln!(
        "one-item change: {} bytes in {} allocations (a copy of the two text maps alone: {} bytes in {} allocations)",
        counted.bytes, counted.count, copy.bytes, copy.count
    );
    assert!(
        counted.bytes < LIMIT,
        "a one-item change on the fast path allocated {} bytes in {} allocations; under {LIMIT} bytes are owed",
        counted.bytes,
        counted.count
    );
}

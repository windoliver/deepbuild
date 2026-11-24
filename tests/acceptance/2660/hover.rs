//! #2660 criterion 4: 1,000 pointer moves over a 1,000-item document with no button down and
//! nothing changed allocate nothing after the first, and each hit names the item the merge base
//! names. (The planted scope the criterion names is `hover_planted.rs`.)
//!
//! A move is `Scope::input` with `Event::Move`, the scope's whole handling of it; what it hovers
//! is the scope's `hover`, read through `Scope::to_json` between moves, outside the count. The
//! merge base's hover after each move is `fixtures/hover-base.json`, read at the base (README).

mod alloc;
mod hover_doc;

#[global_allocator]
static ALLOCATOR: alloc::Counting = alloc::Counting;

use deep_canvas::scope::Planted;
use hover_doc::{board, hover, moved, scope, ITEMS};
use serde_json::Value;

fn base() -> Vec<Option<String>> {
    let file = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../tests/acceptance/2660/fixtures/hover-base.json");
    let v: Value =
        serde_json::from_str(&std::fs::read_to_string(file).expect("the base reading")).unwrap();
    v.as_array()
        .unwrap()
        .iter()
        .map(|h| h.as_str().map(str::to_string))
        .collect()
}

// AC4 #2660.86f235d7
#[test]
fn ac4_pointer_moves_with_nothing_changed_allocate_nothing_after_the_first_and_hit_what_the_base_hits()
{
    let doc = board();
    let mut scope = scope(&doc, Planted::default());
    let mut hovers = Vec::with_capacity(ITEMS);
    let mut allocating = Vec::new();
    for k in 0..ITEMS {
        let ((), counted) = alloc::counted(|| moved(&mut scope, &doc, k));
        if k > 0 && counted.count > 0 {
            allocating.push((k, counted.count, counted.bytes));
        }
        hovers.push(hover(&scope, &doc));
    }
    let hits = hovers.iter().filter(|h| h.is_some()).count();
    let total: u64 = allocating.iter().map(|a| a.1).sum();
    eprintln!(
        "{} of {} moves after the first allocated, {total} allocations in all; {hits} moves hovered an item",
        allocating.len(),
        ITEMS - 1
    );
    if let Some(&(k, n, bytes)) = allocating.first() {
        eprintln!(
            "base hover reading: {}",
            serde_json::to_string(&hovers).unwrap()
        );
        panic!(
            "{} of the {} moves after the first allocated ({total} allocations in all); move {k} first, {n} allocations of {bytes} bytes",
            allocating.len(),
            ITEMS - 1
        );
    }
    let base = base();
    assert_eq!(base.len(), ITEMS, "the base read a hover per move");
    // The moves hover items: most land on one, some on gaps.
    assert!(hits >= ITEMS / 2, "only {hits} of {ITEMS} moves hovered an item");
    for (k, (got, want)) in hovers.iter().zip(&base).enumerate() {
        assert_eq!(
            got,
            want,
            "move {k} to {:?} hovers {got:?}; the merge base hovers {want:?}",
            hover_doc::at(k)
        );
    }
    // A patch that moves an item: the next move hovers it where it went, as the base does.
    hover_doc::hovers_the_moved_item(Planted::default()).unwrap();
}

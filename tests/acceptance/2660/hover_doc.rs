//! The hover fixture #2660 criterion 4 and its planted scope share: a flat 1,000-item board, the
//! 1,000 pointer positions moved over it, the hover a scope shows after a move, and the patch
//! that moves one item.

#![allow(dead_code)]

use deep_canvas::scope::{Event, Planted, Scope};
use serde_json::{json, Map, Value};

pub const ITEMS: usize = 1_000;
pub const PANEL: [f64; 4] = [0.0, 0.0, 800.0, 500.0];

/// 1,000 rects on an 800 × 500 page, 40 a row in 20 u cells, every seventh one large enough to
/// overlap its neighbours, stacked by order keys that aren't in ID order.
pub fn board() -> Value {
    let mut items = Map::new();
    for i in 0..ITEMS {
        let id = format!("n{i:04}");
        let side = if i % 7 == 0 { 30 } else { 18 };
        items.insert(
            id.clone(),
            json!({"id": id, "kind": "rect@1", "layer": "a", "name": id,
                   "order": format!("a{:04}", (i * 389) % ITEMS),
                   "params": {"box": [0, 0, side, side], "paint": {"fill": {"role": "ink"}}},
                   "at": {"pos": [(i % 40) * 20, (i / 40) * 20, 0]}}),
        );
    }
    json!({"format": 1, "profile": "board", "title": "Hover", "description": "1,000 rects.",
           "size": [800, 500], "layers": {"a": {"writer": "agent:t", "title": "A", "order": "a1"}},
           "items": items})
}

/// The pointer's place for move `k`, window px: spread over the page, some on gaps.
pub fn at(k: usize) -> [f64; 2] {
    [((k * 37) % 800) as f64 + 0.5, ((k * 53) % 500) as f64 + 0.5]
}

pub fn scope(doc: &Value, planted: Planted) -> Scope {
    Scope::new(doc, PANEL, [1600.0, 1000.0], planted).expect("a flat scope")
}

/// The item the scope shows hovered, read after a move.
pub fn hover(scope: &Scope, doc: &Value) -> Option<String> {
    scope.to_json(doc, None, &Map::new())["hover"]
        .as_str()
        .map(str::to_string)
}

/// A pointer move with no button down.
pub fn moved(scope: &mut Scope, doc: &Value, k: usize) {
    scope.input(doc, 0, k as u64, &Event::Move(at(k)));
}

/// The patch that moves item `n0123` over the page's bottom-right corner, a gap no other item
/// covers, as a new revision; the hover there must name it.
pub const MOVED: &str = "n0123";
pub const THERE: [f64; 2] = [799.0, 499.0];

pub fn patched(doc: &Value) -> Value {
    let mut out = doc.clone();
    out["items"][MOVED]["at"]["pos"] = json!([785, 485, 0]);
    out
}

/// Hovers the board, then the patched board at the moved item's new place: `Err` naming the item
/// when the scope doesn't name it there.
pub fn hovers_the_moved_item(planted: Planted) -> Result<(), String> {
    let doc = board();
    let mut scope = scope(&doc, planted);
    for k in 0..10 {
        moved(&mut scope, &doc, k);
    }
    scope.input(&doc, 0, 10, &Event::Move(THERE));
    let before = hover(&scope, &doc);
    if before.is_some() {
        return Err(format!("{THERE:?} hovers {before:?} before the patch"));
    }
    let next = patched(&doc);
    scope.input(&next, 0, 11, &Event::Move(THERE));
    match hover(&scope, &next) {
        Some(id) if id == MOVED => Ok(()),
        got => Err(format!(
            "after the patch that moves {MOVED} to {THERE:?}, the pointer there hovers {got:?}, not {MOVED}"
        )),
    }
}

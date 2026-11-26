//! Issue #1583: the card's rows as it draws them. A card's words come from an agent, and a yes covers what was shown,
//! so every row's words go through [`visible`], and an approval whose words hold a character you can't see says so in
//! one line under its question. That line is a row of the safety list (crates/deep-app/safety.json). A line break and
//! a tab are drawn as their escapes too and bring no line: a command is written with them, and a line most approvals
//! drew would say nothing.

use super::{visible, Row};
use crate::{copy, kinds::Kind};

/// What an approval says when its words hold such a character: its key in the app's table (#2403).
const HOLDS_ESCAPES: &str = "question.holds_escapes";

/// `rows` as the card draws them, in their order.
pub(super) fn drawn(kind: Kind, rows: Vec<Row>) -> Vec<Row> {
    // #1583's planted card draws every row's words as the record holds them, in a test build only.
    if crate::plain::planted("card-draws-raw") {
        return rows;
    }
    let holds = kind == Kind::BatchedAuthority && rows.iter().any(|row| hides(row.label()));
    let mut rows: Vec<Row> = rows.into_iter().map(Row::marked).collect();
    if holds {
        rows.insert(2, Row::Text(copy::text(HOLDS_ESCAPES).to_owned()));
    }
    rows
}

/// Whether `text` holds a character [`visible`] draws as its escape, a line break and a tab aside: each of those two
/// adds one byte to what is drawn, so anything more is another character's escape.
fn hides(text: &str) -> bool {
    visible(text).len() > text.len() + text.matches(['\n', '\t']).count()
}

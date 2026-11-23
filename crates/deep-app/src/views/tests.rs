use super::*;

#[std::prelude::v1::test]
fn the_sidebars_keys_move_the_ring_and_open_the_focused_session_which_keeps_its_row_as_rows_move() {
    let ids = |list: &[&str]| list.iter().map(|s| s.to_string()).collect::<Vec<_>>();
    let sessions = ids(&["a", "b", "c"]);
    let mut rows = SidebarRows::default();
    // Down from nothing focuses the first row; down again the second; up and down stop at the ends.
    assert!(rows.key("down", &sessions));
    assert!(rows.key("down", &sessions));
    assert_eq!(rows.focused.as_deref(), Some("b"));
    rows.key("down", &sessions);
    assert!(!rows.key("down", &sessions), "the last row holds");
    rows.key("up", &sessions);
    rows.key("up", &sessions);
    assert!(!rows.key("up", &sessions), "the first row holds");
    // Return opens the focused session; focus moving on leaves it open, so selected and focused differ.
    rows.key("down", &sessions);
    assert!(rows.key("enter", &sessions));
    rows.key("down", &sessions);
    assert_eq!(
        rows,
        SidebarRows {
            selected: Some("b".into()),
            focused: Some("c".into())
        }
    );
    // A new session shown first moves every row down a place; the same sessions stay selected and focused.
    let moved = ids(&["z", "a", "b", "c"]);
    rows.key("up", &moved);
    assert_eq!(rows.focused.as_deref(), Some("b"));
    assert_eq!(rows.selected.as_deref(), Some("b"));
    // Keys on an empty sidebar change nothing; space opens as return does.
    assert!(!SidebarRows::default().key("down", &[]));
    assert!(rows.key("down", &moved) && rows.key("space", &moved));
    assert_eq!(rows.selected.as_deref(), Some("c"));
}

#[std::prelude::v1::test]
fn the_window_has_two_regions_and_nothing_docked_below() {
    let showing = |view| {
        let layout = Layout::shipped(view);
        layout.center[layout.active].clone()
    };
    assert_eq!(showing("needs-you"), HOME);
    assert_eq!(showing("session"), SESSION);
    assert_eq!(showing("sidebar"), HOME);
    let state = Layout::app(false).state();
    assert!(state.bottom_dock.is_none() && state.right_dock.is_none());
    assert!(!Layout::app(false)
        .center
        .iter()
        .any(|name| name == NEEDS_YOU || name == LINE));
}

#[std::prelude::v1::test]
#[should_panic(expected = "is not a shipped view")]
fn a_name_that_is_not_a_shipped_view_is_refused() {
    Layout::shipped("needs_you");
}

#[std::prelude::v1::test]
fn a_needs_you_row_shows_a_direction_mark_as_the_card_does() {
    // #1510: an override in the question would read the rest of the row backwards.
    let mut view = crate::record::View::default();
    view.apply(
        serde_json::json!({"kind": "ask.created", "id": "a1", "session": "s1", "data": {
        "question": "Open invoice\u{202e}txt.exe?", "default": "no", "deadline": 1_000,
        "options": [{"id": "no", "label": "No"}]}}),
    );
    let open = read(&view, Kind::NeedsYou, None).open;
    assert_eq!(open[0].2, "Open invoice\\u{202e}txt.exe?");
}

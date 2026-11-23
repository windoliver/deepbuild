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
    view.apply(
        serde_json::json!({"kind": "ask.batched", "writer": "core", "data": {
        "batch": "now:1970-01-01T00:00:00.000Z", "asks": [{"ask": "ask:a1"}]}}),
    );
    let open = read(&view, Kind::NeedsYou, None).open;
    assert_eq!(open[0].2, "Open invoice\\u{202e}txt.exe?");
}

#[std::prelude::v1::test]
fn a_record_no_batching_core_wrote_shows_its_asks_at_once() {
    // #22: a record with neither the hub's list nor any batch of the core's has nothing to wait for, so its open
    // asks draw as they did, and the rows are as many as the count.
    let mut view = crate::record::View::default();
    for id in ["a1", "a2"] {
        view.apply(serde_json::json!({"kind": "ask.created", "id": id, "session": "s1", "writer": "core",
                                      "data": {"kind": "taste", "question": format!("{id}?")}}));
    }
    let open = read(&view, Kind::NeedsYou, None).open;
    let handles: Vec<&str> = open.iter().map(|row| row.0.as_str()).collect();
    assert_eq!(handles, ["ask:a1", "ask:a2"]);
    assert_eq!(open.len(), states::count(&view.table()));
}

#[std::prelude::v1::test]
fn a_record_with_no_list_and_no_batching_core_draws_and_counts_every_open_ask() {
    // #22: with no list and no batch of the core's, the sixth ask a fixture's session holds is folded by count
    // (#338) with no exception to show through: it draws as on main, and the count says as many as the rows.
    let mut view = crate::record::View::default();
    for id in ["a1", "a2", "a3", "a4", "a5", "a6"] {
        view.apply(serde_json::json!({"kind": "ask.created", "id": id, "session": "s1", "writer": "mcp:agent",
                                      "data": {"kind": "taste", "question": format!("{id}?")}}));
    }
    let open = read(&view, Kind::NeedsYou, None).open;
    let handles: Vec<&str> = open.iter().map(|row| row.0.as_str()).collect();
    assert_eq!(
        handles,
        ["ask:a1", "ask:a2", "ask:a3", "ask:a4", "ask:a5", "ask:a6"]
    );
    assert_eq!(count_of(&view), open.len());
}

#[std::prelude::v1::test]
fn a_batching_record_with_no_list_counts_only_the_asks_it_draws() {
    // #22: a batching core's record that the hub hasn't listed yet: an ask waiting for its batch is neither drawn
    // nor counted, so the window never says "1 ask needs you" over an empty list.
    let mut view = crate::record::View::default();
    let ask = |id: &str| {
        serde_json::json!({"kind": "ask.created", "id": id, "session": "s1", "writer": "mcp:agent",
                                            "data": {"kind": "taste", "question": format!("{id}?")}})
    };
    view.apply(ask("a0"));
    view.apply(
        serde_json::json!({"kind": "ask.batched", "writer": "core", "data": {
        "batch": "batch:1970-01-01T00:00:00.000Z", "asks": [{"ask": "ask:a0"}]}}),
    );
    view.apply(serde_json::json!({"kind": "ask.answered", "writer": "core", "subject": "ask:a0", "data": {}}));
    view.apply(ask("a1"));
    assert_eq!(read(&view, Kind::NeedsYou, None).open.len(), 0);
    assert_eq!(count_of(&view), 0);
}

#[std::prelude::v1::test]
fn needs_you_shows_an_ask_once_the_core_shows_it_and_a_folded_one_only_through_its_exception() {
    // #22: Needs you reads the inbox projection the CLI reads, where an ask waits for its batch. Session sd asks
    // five, the core raises its exception, and a sixth folds into it; sa asks one.
    let mut view = crate::record::View::default();
    let ask = |id: &str, kind: &str, writer: &str| {
        let session = if id.starts_with('a') { "sa" } else { "sd" };
        serde_json::json!({"kind": "ask.created", "id": id, "session": session, "writer": writer,
                           "data": {"kind": kind, "question": format!("{id}?")}})
    };
    // The record is a batching core's: it showed an earlier ask, answered since.
    view.apply(ask("a0", "taste", "mcp:agent"));
    view.apply(
        serde_json::json!({"kind": "ask.batched", "writer": "core", "data": {
        "batch": "batch:1970-01-01T00:00:00.000Z", "asks": [{"ask": "ask:a0"}]}}),
    );
    view.apply(serde_json::json!({"kind": "ask.answered", "writer": "core", "subject": "ask:a0", "data": {}}));
    for id in ["a1", "d1", "d2", "d3", "d4", "d5"] {
        view.apply(ask(id, "taste", "mcp:agent"));
    }
    // The core's "keeps asking" for sd, keyed on its thread as the core keys it.
    let mut keeps_asking = ask("x", "exception", "core");
    keeps_asking["data"]["key"] = {
        use sha2::Digest;
        format!("{:x}", sha2::Sha256::digest(b"asks.fold:sd")).into()
    };
    view.apply(keeps_asking);
    view.apply(ask("d6", "taste", "mcp:agent"));
    let rows = |view: &crate::record::View| -> Vec<(String, String)> {
        read(view, Kind::NeedsYou, None)
            .open
            .into_iter()
            .map(|(handle, _, _, status, _)| (handle, status))
            .collect()
    };
    assert_eq!(
        rows(&view),
        Vec::<(String, String)>::new(),
        "every ask waits for the batch"
    );

    let shown = ["a1", "d1", "d2", "d3", "d4", "d5", "x"];
    view.apply(serde_json::json!({"kind": "ask.batched", "writer": "core", "data": {
        "batch": "batch:1970-01-01T08:00:00.000Z",
        "asks": shown.iter().map(|id| serde_json::json!({"ask": format!("ask:{id}")})).collect::<Vec<_>>()}}));
    let want: Vec<(String, String)> = shown
        .iter()
        .map(|id| (format!("ask:{id}"), "shown".to_owned()))
        .collect();
    assert_eq!(
        rows(&view),
        want,
        "the batch shows them, and the sixth only through the exception"
    );
    assert_eq!(asks_need_you(rows(&view).len()), "7 asks need you");
}

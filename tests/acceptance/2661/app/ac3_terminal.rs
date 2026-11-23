//! AC3: with a session's Terminal tab opened and then another page shown for 60 s, a stand-in hub receives no
//! `canvas.user`. On the merge base it receives 240.
//!
//! The record holds one session. The app's window (README: The window) shows its page, the Terminal control is
//! clicked as a person clicks it, then Home is shown and 60 s pass, a frame every 250 ms. The stand-in hub hosts a
//! terminal for the session: it answers `canvas.user`'s page, tab and cells calls.

use std::sync::Arc;
use std::time::Duration;

use gpui_kit::test::TestWindowExt as _;
use gpui_kit::{AppContext as _, TestAppContext};
use serde_json::{json, Value};

use crate::hub::{record_answer, StandIn};
use crate::window::{frame, open, pass, show, NOW};

const SESSION: &str = "01KB2661TERMSESS0000000001";
const AWAY: Duration = Duration::from_secs(60);
const TICK: Duration = Duration::from_millis(250);

/// The record: the session starts and its task is created.
fn event(log_pos: u64) -> Value {
    match log_pos {
        1 => json!({"v": 1, "id": "01KB2661TERM00000000000001", "kind": "session.start", "writer": "hook",
                    "session": SESSION, "ts": NOW - 3_600_000, "log_pos": 1,
                    "data": {"agent": "claude-code", "worktree": "~/src/shop", "branch": "feat/cart", "thread": SESSION}}),
        _ => json!({"v": 1, "id": "01KB2661TERM00000000000002", "kind": "task.created", "writer": "app",
                    "session": SESSION, "ts": NOW - 3_500_000, "log_pos": 2,
                    "data": {"task_ref": "task:01KB2661TASK0000000000001", "thread": SESSION, "owner": "you",
                             "title": "Cart totals round to the cent"}}),
    }
}

/// The hub's canvas core for the session's page: its terminal tab and a grid of one row.
fn canvas_user(params: &Value) -> Value {
    match params["call"]["call"].as_str() {
        Some("tab") => json!({ "drawn": [{ "text": "npm test" }] }),
        Some("cells") => json!({ "revision": 1, "cols": 8, "rows": [{ "text": "npm test" }] }),
        _ => json!({}),
    }
}

#[gpui_kit::test]
fn ac3_a_terminal_tab_left_for_another_page_asks_the_hub_nothing_for_60_s(cx: &mut TestAppContext) {
    let hub = StandIn::start(Arc::new(|method: &str, params: &Value, _: usize| match method {
        "canvas.user" => canvas_user(params),
        _ => record_answer(method, params, &event, 2).unwrap_or(json!({})),
    }));
    let (window, _home) = open(cx, &hub);

    // The session's page, its Terminal opened by a click.
    show(cx, window, &format!("session/{SESSION}"));
    cx.update_window(window, |_, window, cx| window.click("session-terminal", cx))
        .expect("the window takes the click");
    frame(cx, window);
    assert!(
        hub.count("canvas.user") > 0,
        "BLOCKED: the Terminal control asked the hub nothing; the tab didn't open"
    );

    // Another page shown for 60 s.
    show(cx, window, "page/home");
    let before = hub.count("canvas.user");
    pass(cx, window, AWAY, TICK);
    let away = hub.count("canvas.user") - before;
    assert_eq!(
        away, 0,
        "FAIL: with the session's Terminal tab opened and then Home shown for 60 s, the stand-in hub received {away} \
         canvas.user, not 0"
    );
}

//! AC5: a render of the Sidebar with 700 sessions allocates no list of asks, counted by the test, and every row's
//! state word is the merge base's.
//!
//! The record (below) holds 700 sessions in five kinds of state; 280 of them each hold one open ask, raised in the
//! sessions' order, so no two asks in a row are one session's. It has no rows the hub built, so the app reads each
//! session's state itself, where `open_asks(Some(session))` builds its list at the base. The Sidebar is the shipped
//! view, alone in gpui-kit's test window; the counted render is its first: the window opened and its first frame
//! drawn. The counting allocator (alloc.rs) counts each list of asks the render builds and frees, a block whose first
//! word is the address of one of the record's open asks; a list of one session's asks breaks the criterion. A list of
//! every open ask, which spans sessions, is reported beside it (README: Open points).
//!
//! The rows' words are the list's (`list::read`, which the Sidebar draws from) for all 700 sessions, against the merge
//! base's, kept in `fixtures/sidebar-700-words.json` (README: The merge base's words).

use gpui_kit::{
    div, point, px, size, AnyView, AppContext as _, Bounds, Context, IntoElement, ParentElement as _, Render,
    Styled as _, TestAppContext, Window, WindowBounds, WindowOptions,
};
use gpui_kit::test::TestWindowExt as _;
use serde_json::{json, Value};

use crate::alloc::lists_of_asks;
use crate::window::NOW;

const SESSIONS: usize = 700;
const WORDS: &str = include_str!("fixtures/sidebar-700-words.json");

pub fn session(k: usize) -> String {
    format!("01KB2661SB{k:016}")
}

/// The record: every session starts and its task is created; then each session's state, by `k % 5`: an open ask; a
/// tool call under way; an open ask and a finished tool call; a claim judged PASS; a finished tool call.
pub fn record() -> Vec<Value> {
    let mut events = Vec::new();
    let mut push = |kind: &str, writer: &str, k: usize, data: Value| {
        let n = events.len() + 1;
        events.push(json!({
            "v": 1, "id": format!("01KB2661EV{n:016}"), "kind": kind, "writer": writer, "actor": "you", "scope": "you",
            "session": session(k), "ts": NOW - 3_600_000 + n as u64 * 1_000, "log_pos": n, "data": data,
        }));
        format!("01KB2661EV{n:016}")
    };
    for k in 0..SESSIONS {
        push("session.start", "hook", k, json!({"agent": "claude-code", "worktree": format!("/work/repo{}", k % 7),
            "branch": "main", "thread": session(k)}));
    }
    for k in 0..SESSIONS {
        push("task.created", "app", k, json!({"task_ref": format!("task:01KB2661TK{k:016}"), "thread": session(k),
            "owner": "you", "title": format!("Task {:03}", k + 1)}));
    }
    for k in 0..SESSIONS {
        match k % 5 {
            0 | 2 => {
                push("ask.created", "core", k, json!({
                    "kind": "taste", "question": format!("Which header colour for task {:03}?", k + 1),
                    "options": [{"id": "blue", "label": "Blue", "decision": "none"},
                                {"id": "green", "label": "Green", "decision": "none"}],
                    "recommended": "blue", "default": "blue", "deadline": NOW + 86_400_000, "fallback": "you",
                    "owner": "you", "key": format!("k-2661-{k}"),
                }));
            }
            1 => {
                push("tool.before", "hook", k, json!({"kind": "shell", "command": "npm test", "call": format!("toolu_{k}")}));
            }
            3 => {
                let claim = push("claim.made", "mcp:agent", k, json!({"summary": "Totals round half up", "commit": "4f2a9c1e0b7d"}));
                push("verdict.made", "core", k, json!({"claim": format!("claim:{claim}"), "verdict": "verdict:v", "outcome": "PASS"}));
            }
            _ => {}
        }
    }
    for k in (0..SESSIONS).filter(|k| k % 5 == 2 || k % 5 == 4) {
        push("tool.after", "hook", k, json!({"kind": "shell", "call": format!("toolu_{k}"), "exit": 0, "took_ms": 1_840}));
    }
    events
}

/// Every row's (session, state word), as the list reads the record now.
pub fn words() -> Vec<(String, String)> {
    deep_app::record::with_view(|view| deep_app::list::read(view, NOW))
        .expect("the record is installed")
        .1
        .into_iter()
        .map(|row| (row.id, row.word))
        .collect()
}

struct Root(AnyView);

impl Render for Root {
    fn render(&mut self, _: &mut Window, _: &mut Context<Self>) -> impl IntoElement {
        div().size_full().child(self.0.clone())
    }
}

#[gpui_kit::test]
fn ac5_a_render_of_the_sidebar_with_700_sessions_allocates_no_list_of_asks(cx: &mut TestAppContext) {
    crate::quiet_home();
    deep_app::record::install_local(record());
    deep_app::setup::assume_finished();
    deep_app::views::set_clock(NOW);
    cx.update(|cx| {
        gpui_kit::init(cx);
        deep_app::init(cx);
    });

    // Each open ask, where the record holds it, with its session's number.
    let asks: Vec<(usize, u32)> = deep_app::record::with_view(|view| {
        view.table()
            .open_asks(None)
            .into_iter()
            .map(|ask| {
                let of = ask["session"].as_str().unwrap_or_default();
                let k = of.trim_start_matches("01KB2661SB").parse::<u32>().unwrap_or(u32::MAX);
                (ask as *const Value as usize, k)
            })
            .collect()
    })
    .expect("the record is installed");
    assert_eq!(asks.len(), 280, "BLOCKED: the record holds {} open asks, not 280", asks.len());

    let ((), one_session, spanning) = lists_of_asks(asks, || {
        let (window, _) = cx.update(|cx| {
            gpui_kit::open_window(
                WindowOptions {
                    window_bounds: Some(WindowBounds::Windowed(Bounds {
                        origin: point(px(0.), px(0.)),
                        size: size(px(320.), px(982.)),
                    })),
                    ..Default::default()
                },
                cx,
                |_, cx| {
                    let sidebar = deep_app::views::shipped(deep_app::views::Kind::Sidebar, cx);
                    cx.new(|_| Root(sidebar))
                },
            )
            .expect("the Sidebar's window opens")
        });
        cx.run_until_parked();
        cx.update_window(window, |_, window, cx| window.render_frame(cx))
            .expect("the Sidebar draws");
    });

    // Every row's word, the merge base's.
    let want: Vec<(String, String)> = serde_json::from_str(WORDS).expect("the merge base's words");
    let got = words();
    let differ: Vec<String> = want
        .iter()
        .zip(got.iter())
        .filter(|(want, got)| want != got)
        .map(|(want, got)| format!("{}: {:?} at the merge base, {:?} now", want.0, want.1, got.1))
        .collect();
    assert!(
        got.len() == want.len() && differ.is_empty(),
        "FAIL: the Sidebar's rows read other words than at the merge base: {} rows now, {} then; {} differ: {}",
        got.len(),
        want.len(),
        differ.len(),
        differ.iter().take(10).cloned().collect::<Vec<_>>().join("; ")
    );

    let reading = format!(
        "a render of the Sidebar with {SESSIONS} sessions (280 holding an open ask) built {one_session} lists of one \
         session's asks, and {spanning} lists of asks across sessions"
    );
    println!("{reading}");
    assert_eq!(one_session, 0, "FAIL: {reading}; it must build no list of a session's asks");
}

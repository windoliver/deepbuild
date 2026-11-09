//! #1738, a session's task title shown as data: written blind from the issue, docs/technical-design.md and the base
//! 667292fc, before any implementation (../README.md says what was read and the surfaces these reach).
//!
//!   AC1 `#1738.0d008709`  ac1_*   a title holding U+202E, `\x1b[2K\r` and a newline shows each as its escape in the
//!                                 ask notification's title, the sidebar row, the session page's heading and its line
//!   AC2 `#1738.e6a3db6d`  ac2_*   the verdict line sent to the session's chat marks them too
//!   AC3 `#1738.7a00b50e`  ac3_*   the record's `task.created` keeps the title's original bytes
//!   AC4 `#1738.f8a06717`  ac4_*   plain, Chinese and emoji titles show unchanged
//!
//! Every surface is reached through deep-app's public lib. The record is the app's one reader, held in memory
//! (`record::install_local`), as the replica holds it. The drawn surfaces are read from the app's shell
//! (`views::Shell` on `Layout::shipped("session")`) in gpui-kit's test window, each by its accessibility label, the
//! text an assistive client reads: the sidebar row `session:<id>`, the page's heading `session-title` and the line
//! `line-status`. The notification is the one `notify::Notifier::due` posts for the session's open ask; the verdict
//! line is `states::verdict_line`, the line the replica sends to the session's chat (deep-replica's
//! `Replica::surfaces`, "verdict-line", is that call; the replica itself draws only on macOS).
//!
//! Wired into deep-app by a `[[test]]` entry (`acceptance_1738`); run with
//! `cargo test --locked -p deep-app --test acceptance_1738`.

use std::time::Duration;

use deep_app::events::Inbox;
use deep_app::notify::{Notification, Notifier};
use deep_app::record;
use deep_app::states;
use deep_app::views::{set_state, AppState, Layout, Shell};
use gpui_kit::base::test_support::snapshots;
use gpui_kit::test::TestWindowExt as _;
use gpui_kit::{
    point, px, size, AppContext as _, Bounds, ElementId, TestAppContext, WindowBounds,
    WindowOptions,
};
use serde_json::{json, Value};

const NOW: u64 = 1_800_000_000_000;
const SESSION: &str = "01MD1738SESS0000000000001";
const ASK: &str = "01MD1738ASK00000000000001";

/// The issue's title: U+202E reverses what follows it, `ESC [2K` erases the line and `\r` returns to its start, and
/// the newline starts another line.
const HOSTILE: &str = "Fix the cart\u{202E}txt.exe\x1b[2K\rApproved by you\nship it";
/// The same title as the issue spells it shown: each of those characters as its escape, `\u{202e}`, `\x1b`, `\r`,
/// `\n`, at its place, every other character unchanged.
const HOSTILE_SHOWN: &str = "Fix the cart\\u{202e}txt.exe\\x1b[2K\\rApproved by you\\nship it";
/// The characters the shown title must not hold raw.
const RAW: [(char, &str); 4] = [
    ('\u{202E}', "U+202E RIGHT-TO-LEFT OVERRIDE"),
    ('\u{1b}', "ESC (0x1b)"),
    ('\r', "CR (0x0d)"),
    ('\n', "LF (0x0a)"),
];

/// Titles that must show as they are.
const PLAIN: &str = "Cart totals";
const CHINESE: &str = "修复结账页面的总价";
/// A rocket, a check, a thumb with a skin-tone modifier, a heart with its emoji presentation selector (U+FE0F) and a
/// family joined by zero-width joiners (U+200D), as people type them.
const EMOJI: &str = "Ship the header 🚀 ✅ 👍🏽 ❤️ 👨‍👩‍👧";

/// The record of one session: it starts, its task is created with `title` (a `task.created` naming the session as
/// its thread), and it raises an ask that is open.
fn record_with(title: &str) -> Vec<Value> {
    vec![
        json!({"v": 1, "id": "01MD1738R00000000000000001", "kind": "session.start", "writer": "hook", "session": SESSION,
               "ts": NOW - 3_600_000, "log_pos": 1,
               "data": {"agent": "claude-code", "worktree": "~/src/shop", "branch": "feat/cart", "thread": SESSION}}),
        json!({"v": 1, "id": "01MD1738R00000000000000002", "kind": "task.created", "writer": "app", "session": SESSION,
               "ts": NOW - 3_500_000, "log_pos": 2,
               "data": {"task_ref": "task:01MD1738TASK0000000000001", "thread": SESSION, "owner": "you", "title": title}}),
        json!({"v": 1, "id": ASK, "kind": "ask.created", "writer": "core", "session": SESSION, "ts": NOW - 60_000, "log_pos": 3,
               "data": {"kind": "taste", "question": "Which header color for the checkout page?",
                        "options": [{"id": "blue", "label": "Blue", "decision": "none"}, {"id": "green", "label": "Green", "decision": "none"}],
                        "default": "blue", "recommended": null, "deadline": NOW + 86_400_000, "key": "k-1738",
                        "pinned_to": {"kind": "commit", "ref": "abc"}}}),
    ]
}

/// What every surface the issue names shows for a record whose task is titled `title`.
struct Shown {
    notification_title: String,
    /// The notification's text: its title, then its body, as Notification Center holds it.
    notification_text: String,
    sidebar_row: String,
    heading: String,
    line: String,
    verdict_line: String,
}

fn shown(cx: &mut TestAppContext, title: &str) -> Shown {
    record::install_local(record_with(title));
    set_state(AppState {
        inbox: Inbox::default(),
        now: NOW,
        sessions: Vec::new(),
        held: None,
    });
    cx.update(|cx| {
        gpui_kit::init(cx);
        deep_app::init(cx);
    });
    let (window, _shell) = cx.update(|cx| {
        gpui_kit::open_window(
            WindowOptions {
                window_bounds: Some(WindowBounds::Windowed(Bounds {
                    origin: point(px(0.), px(0.)),
                    size: size(px(1512.), px(982.)),
                })),
                ..Default::default()
            },
            cx,
            |window, cx| cx.new(|cx| Shell::new(&Layout::shipped("session"), window, cx)),
        )
        .expect("the shell window opens")
    });
    cx.run_until_parked();
    let row = ElementId::Name(format!("session:{SESSION}").into());
    let [sidebar_row, heading, line] = cx
        .update_window(window, |_, window, cx| {
            window.render_frame(cx);
            let named = |id: &ElementId| {
                snapshots(window)
                    .into_iter()
                    .find(|element| element.path().last() == Some(id))
                    .and_then(|element| element.label().map(str::to_owned))
                    .unwrap_or_else(|| panic!("the window draws {id:?} with a label"))
            };
            [
                named(&row),
                named(&"session-title".into()),
                named(&"line-status".into()),
            ]
        })
        .expect("the window draws");

    // The notification the session's open ask posts once it comes due.
    let posted: Vec<Notification> = record::with_view(|view| {
        let mut notifier = Notifier::new(Duration::ZERO);
        for event in record_with(title) {
            notifier.saw(&event, NOW);
        }
        notifier.due(view, NOW, None, false)
    })
    .expect("the record is installed");
    let notification = posted
        .into_iter()
        .find(|n| n.ask.as_deref() == Some(&format!("ask:{ASK}")))
        .expect("the ask's notification is posted");

    let verdict_line = record::with_view(|view| states::verdict_line(&view.table(), SESSION, NOW))
        .expect("the record is installed");
    Shown {
        notification_title: notification.title,
        notification_text: notification.text,
        sidebar_row,
        heading,
        line,
        verdict_line,
    }
}

/// `text`, on `surface`, holds none of RAW and shows the title as `expected`.
fn expect_shows(failed: &mut Vec<String>, surface: &str, text: &str, expected: &str) {
    for (c, name) in RAW {
        if text.contains(c) {
            failed.push(format!("{surface} holds {name} raw: {text:?}"));
        }
    }
    if !text.contains(expected) {
        failed.push(format!(
            "{surface} doesn't show the title as {expected:?}: {text:?}"
        ));
    }
}

fn report(failed: Vec<String>) {
    assert!(
        failed.is_empty(),
        "{} failed:\n{}",
        failed.len(),
        failed.join("\n")
    );
}

#[gpui_kit::test]
fn ac1_0d008709_a_hostile_title_shows_each_character_as_its_escape_in_the_notification_title(
    cx: &mut TestAppContext,
) {
    let shown = shown(cx, HOSTILE);
    let mut failed = Vec::new();
    expect_shows(
        &mut failed,
        "the ask notification's title",
        &shown.notification_title,
        HOSTILE_SHOWN,
    );
    // Notification Center holds the title as the text's first line, its body after: a raw newline would move part of
    // the title into the body.
    let first_line = shown
        .notification_text
        .split('\n')
        .next()
        .unwrap_or_default();
    if first_line != shown.notification_title {
        failed.push(format!(
            "the notification's text doesn't start with its whole title on one line: title {:?}, text {:?}",
            shown.notification_title, shown.notification_text
        ));
    }
    report(failed);
}

#[gpui_kit::test]
fn ac1_0d008709_a_hostile_title_shows_each_character_as_its_escape_in_the_sidebar_row(
    cx: &mut TestAppContext,
) {
    let shown = shown(cx, HOSTILE);
    let mut failed = Vec::new();
    expect_shows(
        &mut failed,
        "the sidebar row",
        &shown.sidebar_row,
        HOSTILE_SHOWN,
    );
    report(failed);
}

#[gpui_kit::test]
fn ac1_0d008709_a_hostile_title_shows_each_character_as_its_escape_in_the_session_pages_heading(
    cx: &mut TestAppContext,
) {
    let shown = shown(cx, HOSTILE);
    let mut failed = Vec::new();
    expect_shows(
        &mut failed,
        "the session page's heading",
        &shown.heading,
        HOSTILE_SHOWN,
    );
    report(failed);
}

#[gpui_kit::test]
fn ac1_0d008709_a_hostile_title_shows_each_character_as_its_escape_in_the_session_pages_line(
    cx: &mut TestAppContext,
) {
    let shown = shown(cx, HOSTILE);
    let mut failed = Vec::new();
    expect_shows(
        &mut failed,
        "the session page's line",
        &shown.line,
        HOSTILE_SHOWN,
    );
    report(failed);
}

#[gpui_kit::test]
fn ac2_e6a3db6d_the_verdict_line_to_the_sessions_chat_marks_the_hostile_titles_characters(
    cx: &mut TestAppContext,
) {
    let shown = shown(cx, HOSTILE);
    let mut failed = Vec::new();
    expect_shows(
        &mut failed,
        "the verdict line",
        &shown.verdict_line,
        HOSTILE_SHOWN,
    );
    report(failed);
}

#[gpui_kit::test]
fn ac3_7a00b50e_the_records_task_created_keeps_the_titles_original_bytes(cx: &mut TestAppContext) {
    // Every surface is drawn and posted first, so marking on the way to a surface would show here.
    let _ = shown(cx, HOSTILE);
    let task = |events: Vec<Value>| -> Vec<Value> {
        events
            .into_iter()
            .filter(|event| event["kind"] == "task.created")
            .collect()
    };
    let held = task(record::history());
    assert_eq!(
        held.len(),
        1,
        "the record holds the one task.created: {held:?}"
    );
    assert_eq!(
        held[0]["data"]["title"].as_str().map(str::as_bytes),
        Some(HOSTILE.as_bytes()),
        "the record's task.created keeps the title's bytes"
    );
    assert_eq!(
        held[0],
        record_with(HOSTILE)[1],
        "the record's task.created is the event given"
    );
    let applied = record::with_view(|view| task(view.events.iter().cloned().collect()))
        .expect("the record is installed");
    assert_eq!(
        applied
            .first()
            .and_then(|event| event["data"]["title"].as_str())
            .map(str::as_bytes),
        Some(HOSTILE.as_bytes()),
        "the event the app's reader applied keeps the title's bytes"
    );
}

#[gpui_kit::test]
fn ac4_f8a06717_a_plain_title_shows_unchanged_on_every_surface(cx: &mut TestAppContext) {
    unchanged(cx, PLAIN);
}

#[gpui_kit::test]
fn ac4_f8a06717_a_chinese_title_shows_unchanged_on_every_surface(cx: &mut TestAppContext) {
    unchanged(cx, CHINESE);
}

#[gpui_kit::test]
fn ac4_f8a06717_an_emoji_title_shows_unchanged_on_every_surface(cx: &mut TestAppContext) {
    unchanged(cx, EMOJI);
}

fn unchanged(cx: &mut TestAppContext, title: &str) {
    let shown = shown(cx, title);
    let mut failed = Vec::new();
    for (surface, text) in [
        ("the ask notification's title", &shown.notification_title),
        ("the sidebar row", &shown.sidebar_row),
        ("the session page's heading", &shown.heading),
        ("the session page's line", &shown.line),
        ("the verdict line", &shown.verdict_line),
    ] {
        if !text.contains(title) {
            failed.push(format!(
                "{surface} doesn't show {title:?} unchanged: {text:?}"
            ));
        }
    }
    report(failed);
}

//! #326 AC4, the app's half, redrafted blind: after each frame from one hub, Needs you and a
//! session's page, fed by one record reader, agree on the number of open asks, both follow the
//! record, and the hub sees one subscription. Needs you's rows are told by what a person reads,
//! each ask's question (#1172), not by `ask:…` handles. README.md here says what this replaces.
//!
//! Wired into deep-replica by one `[[test]]` entry, and run from the checkout with:
//!     cargo test --locked -p deep-replica --test acceptance_326_panels_redraft

#[path = "../common.rs"]
mod common;
#[cfg(target_os = "macos")]
#[path = "../hub.rs"]
mod hub;

fn main() {
    #[cfg(target_os = "macos")]
    std::process::exit(suite::run());
    #[cfg(not(target_os = "macos"))]
    {
        println!("acceptance_326_panels_redraft: INCONCLUSIVE; the headless app needs macOS, so nothing ran");
        std::process::exit(1);
    }
}

#[cfg(target_os = "macos")]
mod suite {
    use std::time::{Duration, Instant};

    use deep_app::views::Layout;
    use deep_replica::{
        shell::open_shell,
        snapshot::{from_observed, Node, Snapshot},
    };
    use gpui_kit::test::TestWindowExt as _;
    use gpui_kit::*;
    use serde_json::Value;

    use super::hub::*;

    /// An ask as the fixture's `ask.created` frame carries it.
    struct Ask {
        handle: String,
        question: String,
    }

    /// Whether a person or a screen reader meets `text` on this node: in its name or its value.
    fn reads(node: &Node, text: &str) -> bool {
        node.name
            .as_deref()
            .into_iter()
            .chain(node.value.as_ref().and_then(Value::as_str))
            .any(|read| read.contains(text))
    }

    fn drawn(cx: &mut HeadlessAppContext, handle: AnyWindowHandle) -> Snapshot {
        cx.update_window(handle, |_, window, cx| {
            window.render_frame(cx);
            from_observed(window)
        })
        .unwrap()
    }

    /// The questions Needs you shows, top to bottom. A row is the outermost node that reads a
    /// question, so a child repeating its row's text is that row, and two rows are two.
    fn rows_of(node: &Node, asks: &[Ask], rows: &mut Vec<String>) {
        match asks.iter().find(|ask| reads(node, &ask.question)) {
            Some(ask) => rows.push(ask.question.clone()),
            None => {
                for child in &node.children {
                    rows_of(child, asks, rows);
                }
            }
        }
    }

    /// The first ask a node shows as its `ask:…` handle, with what that node's name is.
    fn read_as_handle<'a>(
        snapshot: &'a Snapshot,
        asks: &'a [Ask],
    ) -> Option<(&'a Ask, Option<&'a str>)> {
        snapshot.flatten().into_iter().find_map(|node| {
            asks.iter()
                .find(|ask| reads(node, &ask.handle))
                .map(|ask| (ask, node.name.as_deref()))
        })
    }

    /// The count the session page's readout shows: its session's open asks, as at the base.
    fn session_count(cx: &mut HeadlessAppContext, handle: AnyWindowHandle) -> usize {
        cx.update_window(handle, |_, window, cx| {
            deep_app::canvas::clear_items();
            window.render_frame(cx);
        })
        .unwrap();
        let items = deep_app::canvas::items();
        let (_, readout) = items
            .iter()
            .find(|(id, _)| id == "session-readout")
            .unwrap_or_else(|| panic!("the session page drew no session-readout item: {items:?}"));
        readout["text"]
            .as_str()
            .and_then(|text| text.parse().ok())
            .unwrap_or_else(|| panic!("the session readout is not a count: {readout}"))
    }

    fn needs_you_and_session_page_share_each_log_pos() {
        let hub = Hub::start();
        let mut cx = deep_replica::headless_context();
        let reader = deep_app::record::RecordReader::open(&hub.socket, &hub.token_file)
            .unwrap_or_else(|error| panic!("the record reader can't open the test hub: {error:?}"));
        deep_app::record::install(reader);
        let (needs_you, _) =
            cx.update(|cx| open_shell(&Layout::shipped("needs-you"), cx, |_, _| {}));
        let (session, _) = cx.update(|cx| open_shell(&Layout::shipped("session"), cx, |_, _| {}));

        // Six asks created, then the first one answered: seven frames.
        let mut frames: Vec<Value> = (1..=6).map(ask_created).collect();
        let asks: Vec<Ask> = frames
            .iter()
            .map(|frame| Ask {
                handle: handle_of(frame),
                question: frame["data"]["question"]
                    .as_str()
                    .expect("the fixture's ask.created carries its question")
                    .to_owned(),
            })
            .collect();
        frames.push(ask_answered(7, &asks[0].handle));

        let mut open: Vec<String> = Vec::new();
        for frame in frames {
            let at = frame["log_pos"].as_u64().unwrap();
            let ask = asks
                .iter()
                .find(|ask| ask.handle == handle_of(&frame) || ask.handle == frame["subject"])
                .expect("every fixture frame is about one of the six asks");
            if frame["kind"] == "ask.created" {
                open.push(ask.question.clone());
            } else {
                open.retain(|question| *question != ask.question);
            }
            hub.append(frame);
            let deadline = Instant::now() + Duration::from_secs(10);
            loop {
                deep_app::record::poll(Duration::from_millis(100))
                    .unwrap_or_else(|error| panic!("polling the record reader failed: {error:?}"));
                let snapshot = drawn(&mut cx, needs_you);
                if let Some((ask, name)) = read_as_handle(&snapshot, &asks) {
                    panic!(
                        "after the frame at log_pos {at}, the question {:?} is missing from Needs you: a person reads {name:?}, the ask's handle {}",
                        ask.question, ask.handle
                    );
                }
                let mut rows = Vec::new();
                rows_of(&snapshot.tree, &asks, &mut rows);
                let count = session_count(&mut cx, session);
                let missing: Vec<&String> = open
                    .iter()
                    .filter(|question| !rows.contains(question))
                    .collect();
                assert_eq!(
                    rows.len(),
                    count,
                    "after the frame at log_pos {at}, Needs you shows {} open asks and the session's page counts {count}: the two views show different log positions; open in the record and not shown: {missing:?}",
                    rows.len()
                );
                if rows == open {
                    break;
                }
                assert!(
                    Instant::now() < deadline,
                    "10 s after the frame at log_pos {at}, Needs you shows {rows:?}, not {open:?}"
                );
            }
        }
        // Both views were fed by the one reader: the hub saw one subscription for the two of them.
        assert_eq!(
            hub.subscriptions(),
            1,
            "the app subscribed to the stream more than once"
        );
    }

    pub fn run() -> i32 {
        deep_app::views::set_state(deep_replica::load_state());
        super::common::run(&[(
            "needs_you_and_session_page_share_each_log_pos",
            needs_you_and_session_page_share_each_log_pos,
        )])
    }
}

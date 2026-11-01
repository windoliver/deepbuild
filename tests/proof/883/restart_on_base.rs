//! #883's Proof, the restart case on the merge base: the app's notifier is handed the record's events again, as the
//! reader hands them over after a hub restart or a channel reconnect, and must post nothing more for an ask that
//! already notified. Copied to crates/deep-app/tests/ of a checkout and run there with
//! `cargo test -p deep-app --test restart_on_base`; out/restart-on-base.txt holds the runs on 0f7fb686 and on this
//! change. Only the notifier's API that both have is used: `Notifier::new`, `saw`, `due`.

use deep_app::notify::{Notifier, NOTIFY_AFTER};
use serde_json::json;

#[test]
fn reading_the_record_again_posts_nothing_for_an_ask_that_notified() {
    let ask = json!({"v": 1, "kind": "ask.created", "id": "01MD883PROOF00000000000001", "log_pos": 1,
        "session": "s1", "writer": "core", "data": {"question": "Push feat/cart to origin?", "default": "no",
        "deadline": 10_000_000, "options": [{"id": "no", "label": "No"}, {"id": "yes", "label": "Yes"}]}});
    let events = vec![ask.clone()];
    let mut notifier = Notifier::new(NOTIFY_AFTER);
    notifier.saw(&ask, 0);
    let first = notifier.due(&events, 1_000, None, true);
    assert_eq!(first.len(), 1, "the ask notifies once it has been open a second: {first:?}");

    // The hub restarts: the reader reads the record again and hands its events over again.
    for event in &events {
        notifier.saw(event, 2_000);
    }
    let again = notifier.due(&events, 3_000, None, true);
    assert!(
        again.is_empty(),
        "ask:01MD883PROOF00000000000001 notified again after the record was read again: {again:?}"
    );
}

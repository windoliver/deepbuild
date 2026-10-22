//! Salience's hold and files (#394 Fields; canvas primitives: Salience): the set changes only when
//! the level opens or on a needs-you or verdict change, arrivals that would change it wait as
//! "N new", and files show only at the evidence level.

use deep_canvas_record::{level, Hold, Item, Level, Options};

/// Facts in the rank list's order: needs you, sent back, failing, lacks proof, touched, changed.
fn item(id: &str, facts: [bool; 6]) -> Item {
    Item {
        id: id.to_string(),
        facts,
        priority: 0,
        file: false,
    }
}

const NONE: [bool; 6] = [false; 6];
const CHANGED: [bool; 6] = [false, false, false, false, false, true];
const FAILING: [bool; 6] = [false, false, true, false, false, false];
const NEEDS_YOU: [bool; 6] = [true, false, false, false, false, false];

const THREE: Options = Options {
    show: 3,
    fits: 9,
    evidence: false,
};

fn ids(level: &Level) -> Vec<&str> {
    level.shown.iter().map(|s| s.id.as_str()).collect()
}

/// A level of five where c, d and e rank first only by being changed, held as it opened.
fn opened() -> (Vec<Item>, Hold) {
    let items = vec![
        item("a", NONE),
        item("b", NONE),
        item("c", CHANGED),
        item("d", CHANGED),
        item("e", CHANGED),
    ];
    let first = level(&items, &THREE, None);
    assert_eq!(ids(&first), ["c", "d", "e"]);
    let hold = Hold {
        shown: ids(&first).iter().map(|s| s.to_string()).collect(),
        items: items.clone(),
    };
    (items, hold)
}

#[test]
fn an_arrival_that_would_reorder_waits_as_new_until_the_next_hold() {
    let (mut items, hold) = opened();
    items.push(item("0", CHANGED));
    let held = level(&items, &THREE, Some(&hold));
    // A program that re-ranks on every reading shows 0, c, d here.
    assert_eq!(ids(&held), ["c", "d", "e"], "the held set keeps its places");
    assert_eq!(held.new, 1, "the arrival waits as 1 new");
    let fold = held.fold.expect("the rest fold");
    assert_eq!(fold.items, ["0", "a", "b"]);
    assert!(fold.line.starts_with("3 more"));
    let reopened = level(&items, &THREE, None);
    assert_eq!(
        ids(&reopened),
        ["0", "c", "d"],
        "opening the level again re-ranks"
    );
    assert_eq!(reopened.new, 0);
}

#[test]
fn a_needs_you_or_verdict_change_changes_the_held_set_at_once() {
    let (items, hold) = opened();
    let mut asked = items.clone();
    asked.push(item("z", NEEDS_YOU));
    // A program that holds through a needs-you arrival folds an open ask.
    assert_eq!(ids(&level(&asked, &THREE, Some(&hold))), ["z", "c", "d"]);

    let mut failed = items.clone();
    failed[0] = item("a", FAILING);
    assert_eq!(ids(&level(&failed, &THREE, Some(&hold))), ["a", "c", "d"]);

    let mut touched = items;
    touched[1] = item("b", [false, false, false, false, true, false]);
    let held = level(&touched, &THREE, Some(&hold));
    assert_eq!(
        ids(&held),
        ["c", "d", "e"],
        "touched is no verdict: the set holds"
    );
    assert_eq!(held.new, 1);
}

#[test]
fn files_show_only_at_the_evidence_level() {
    let mut log = item("run.log", FAILING);
    log.file = true;
    let items = vec![log, item("claim", CHANGED), item("task", NONE)];
    let map = level(&items, &THREE, None);
    assert_eq!(
        ids(&map),
        ["claim", "task"],
        "a file isn't on another level, shown or folded"
    );
    assert!(map.fold.is_none());
    let evidence = level(
        &items,
        &Options {
            evidence: true,
            ..THREE
        },
        None,
    );
    assert_eq!(ids(&evidence), ["run.log", "claim", "task"]);
}

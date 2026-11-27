//! `deep-drive` past #124's acceptance suite: a replica launched at scale 1 draws, places and answers in 1x device
//! pixels, and a canvas item is acted on where it was drawn. Each test drives the real binary over its stdin.
#![cfg(target_os = "macos")]

use std::{
    io::{BufRead, BufReader, Write},
    path::PathBuf,
    process::{Child, ChildStdin, ChildStdout, Command, Stdio},
};

use serde_json::{json, Value};

/// The panel the tests mount: one canvas item, "script-line", on a 200 by 100 point canvas.
const PANEL: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/tests/fixtures/canvas-panel");

struct Drive {
    child: Child,
    stdin: ChildStdin,
    stdout: BufReader<ChildStdout>,
    replica: Value,
    out: PathBuf,
}

impl Drive {
    fn start(name: &str) -> Drive {
        let out = std::env::temp_dir().join(format!("deep-drive-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&out);
        let mut child = Command::new(env!("CARGO_BIN_EXE_deep-drive"))
            .arg("--out")
            .arg(&out)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .spawn()
            .expect("deep-drive starts");
        let stdin = child.stdin.take().unwrap();
        let stdout = BufReader::new(child.stdout.take().unwrap());
        let mut drive = Drive {
            child,
            stdin,
            stdout,
            replica: Value::Null,
            out,
        };
        assert_eq!(drive.read()["ready"], true);
        drive
    }

    fn launch(name: &str, launch: Value) -> (Drive, Value) {
        let mut drive = Drive::start(name);
        let reply = drive.call(json!({"call": "launch", "launch": launch}));
        assert_eq!(reply["ok"], true, "launch: {reply}");
        drive.replica = reply["replica"].clone();
        (drive, reply)
    }

    fn read(&mut self) -> Value {
        let mut line = String::new();
        self.stdout.read_line(&mut line).expect("a reply line");
        serde_json::from_str(&line).expect("a JSON reply")
    }

    fn call(&mut self, mut call: Value) -> Value {
        call["replica"] = self.replica.clone();
        writeln!(self.stdin, "{call}").unwrap();
        self.read()
    }
}

impl Drop for Drive {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
        let _ = std::fs::remove_dir_all(&self.out);
    }
}

fn boxed(v: &Value) -> [i64; 4] {
    let n: Vec<i64> = v
        .as_array()
        .expect("a box")
        .iter()
        .map(|v| v.as_i64().unwrap())
        .collect();
    [n[0], n[1], n[2], n[3]]
}

/// Clicks the canvas item and answers the box it was clicked in.
fn click_item(drive: &mut Drive) -> [i64; 4] {
    let reply = drive
        .call(json!({"call": "act", "locator": {"item": "script-line"}, "act": {"kind": "click"}}));
    assert_eq!(reply["ok"], true, "click on the canvas item: {reply}");
    let [x, y, w, h] = boxed(&reply["box"]);
    let point = &reply["point"];
    let (px, py) = (point[0].as_i64().unwrap(), point[1].as_i64().unwrap());
    assert!(
        px >= x && px < x + w && py >= y && py < y + h,
        "the click lands in the item: {reply}"
    );
    [x, y, w, h]
}

#[test]
fn a_replica_at_scale_1_answers_in_1x_device_pixels() {
    let mut at = Vec::new();
    for scale in [1, 2] {
        let (mut drive, reply) = Drive::launch(
            &format!("scale{scale}"),
            json!({"from": "fixture", "panel": PANEL, "size": [800, 600], "scale": scale}),
        );
        assert_eq!(reply["window"], json!({"size": [800, 600], "scale": scale}));
        let shot = drive.call(json!({"call": "screenshot", "screenshot": {"target": "window"}}));
        assert_eq!(
            [&shot["w"], &shot["h"]],
            [&json!(800 * scale), &json!(600 * scale)],
            "{shot}"
        );
        let image = image::open(shot["path"].as_str().unwrap()).expect("the screenshot");
        assert_eq!(
            (image.width(), image.height()),
            (800 * scale as u32, 600 * scale as u32)
        );
        at.push(click_item(&mut drive));
    }
    let [one, two] = [at[0], at[1]];
    assert_eq!(
        [one[2], one[3]],
        [200, 100],
        "the 200 by 100 point canvas at 1x"
    );
    assert_eq!(two, one.map(|v| v * 2), "and twice that at 2x");
}

#[test]
fn a_canvas_item_is_acted_on_where_it_was_drawn() {
    let (mut drive, _) = Drive::launch("item", json!({"from": "fixture", "panel": PANEL}));
    let clicked = click_item(&mut drive);
    assert_eq!(
        [clicked[2], clicked[3]],
        [400, 200],
        "the canvas's own box at 2x"
    );
}

#[test]
fn a_launch_names_the_locale_it_ran_and_refuses_one_that_is_no_tag() {
    let (_, reply) = Drive::launch(
        "locale",
        json!({"from": "fixture", "panel": PANEL, "locale": "fr-FR"}),
    );
    assert_eq!(reply["locale"], "fr-FR", "{reply}");
    let refused = Drive::start("no-tag")
        .call(json!({"call": "launch", "launch": {"from": "fixture", "locale": "french!"}}));
    assert_eq!(refused["error"]["code"], "refused", "{refused}");
    let message = refused["error"]["message"].as_str().unwrap_or_default();
    assert!(
        message.contains("locale"),
        "refused for its locale: {refused}"
    );
}

#[test]
fn an_action_with_its_target_in_a_drags_drop_field_is_refused_naming_locator() {
    let (mut drive, _) = Drive::launch("to", json!({"from": "fixture", "panel": PANEL}));
    let typed = drive.call(
        json!({"call": "act", "act": {"kind": "type", "text": "x", "to": {"item": "script-line"}}}),
    );
    assert_eq!(typed["error"]["code"], "refused", "{typed}");
    let message = typed["error"]["message"].as_str().unwrap_or_default();
    assert!(
        message.contains("locator"),
        "the refusal says where the target goes: {typed}"
    );
    let dropped = drive.call(json!({"call": "act", "locator": {"item": "script-line"}, "act": {"kind": "drag", "to_point": [10, 10]}}));
    assert_eq!(
        dropped["ok"], true,
        "a drag still takes its drop target: {dropped}"
    );
}

#[test]
fn a_replica_launched_dark_draws_its_chrome_dark() {
    let mut ground = Vec::new();
    for theme in ["light", "dark"] {
        let (mut drive, _) = Drive::launch(
            theme,
            json!({"from": "fixture", "panel": PANEL, "size": [800, 600], "scale": 1, "theme": theme}),
        );
        let shot = drive.call(json!({"call": "screenshot", "screenshot": {"target": "window"}}));
        let image = image::open(shot["path"].as_str().unwrap())
            .expect("the screenshot")
            .to_luma8();
        let mean = image.pixels().map(|p| u64::from(p.0[0])).sum::<u64>()
            / u64::from(image.width() * image.height());
        ground.push(mean);
    }
    assert!(
        ground[0] > 160 && ground[1] < 96,
        "mean luma light {} and dark {}: a dark launch draws a dark window",
        ground[0],
        ground[1]
    );
}

/// GPUI paints no glyph wholly past a clip, so a line a clip cuts spells only its start: the audit still reads it.
#[test]
fn a_line_its_clip_cuts_is_still_audited_past_its_frame() {
    let mut drive = Drive::start("cut-line");
    let file = "crates/deep-replica/tests/fixtures/cut-line-panel/main.js";
    let panel = concat!(env!("CARGO_MANIFEST_DIR"), "/tests/fixtures/cut-line-panel");
    let reply =
        drive.call(json!({"call": "ui_check", "ui_check": {"changed": [file], "panel": panel}}));
    assert_eq!(reply["ok"], true, "{reply}");
    let findings = reply["findings"].as_array().unwrap();
    assert_eq!(findings.len(), 4, "one in each render: {findings:?}");
    for finding in findings {
        assert_eq!(finding["audit"], "outside_frame");
        let (frame, drawn) = (boxed(&finding["frame"]), boxed(&finding["box"]));
        assert!(drawn[0] + drawn[2] > frame[0] + frame[2], "{finding}");
    }
    assert_eq!(reply["claim"], "FAIL");
}

/// A notice sits above the box, so it never covers the box's Send (#1100: Set up's long line covered it).
#[test]
fn a_notice_never_covers_the_boxs_send() {
    let panel = concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/tests/fixtures/fails-to-load-panel"
    );
    let (mut drive, _) = Drive::launch(
        "notice-over-box",
        json!({"from": "fixture", "panel": panel, "view": {"name": "Broken view", "pages": [], "commands": []},
            "size": [1512, 982], "scale": 1}),
    );
    let t = drive.call(json!({"call": "see"}))["t"].as_i64().unwrap();
    let waited = drive.call(
        json!({"call": "wait_for", "wait_for": {"t": t + 705_600_000 / 2}, "timeout": 10_000}),
    );
    assert_eq!(waited["ok"], true, "{waited}");
    let seen = drive.call(json!({"call": "see"}));
    fn flat<'a>(node: &'a Value, into: &mut Vec<&'a Value>) {
        into.push(node);
        for child in node["children"].as_array().into_iter().flatten() {
            flat(child, into);
        }
    }
    let mut nodes = Vec::new();
    flat(&seen["snapshot"]["tree"], &mut nodes);
    let send = nodes
        .iter()
        .find(|n| n["id"] == "box-send")
        .unwrap_or_else(|| panic!("the page draws the box's Send: {seen}"));
    let notice = nodes
        .iter()
        .find(|n| n["id"].as_str().is_some_and(|id| id.starts_with("notice:")))
        .unwrap_or_else(|| panic!("the failed view is named in a notice: {seen}"));
    let ([sx, sy, sw, sh], [nx, ny, nw, nh]) = (boxed(&send["bounds"]), boxed(&notice["bounds"]));
    let apart = nx + nw <= sx || sx + sw <= nx || ny + nh <= sy || sy + sh <= ny;
    assert!(apart, "the notice {notice} covers Send {send}");
}

/// The plain-words record: two sessions and one open ask, Cart totals', whose default is Stop here.
const WORDS: &str = concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/fixtures/plain-words.events.jsonl"
);
const CART: &str = "01PWCART000000000000000002";
const ASK: &str = "01PWASK0000000000000000042";
const ASKED: &str = "Cart totals came back three times. Keep trying, or stop here?";

/// The lines the window said so far (#3232), in the order made.
fn said(drive: &mut Drive) -> Vec<String> {
    let seen = drive.call(json!({"call": "see"}));
    let list = &seen["snapshot"]["announcements"];
    let lines = list
        .as_array()
        .unwrap_or_else(|| panic!("the snapshot carries the window's announcements: {list}"));
    lines
        .iter()
        .map(|line| line["text"].as_str().unwrap().to_owned())
        .collect()
}

/// Lets `ms` of the replica's clock pass, a frame each 100 ms.
fn pass(drive: &mut Drive, ms: i64) {
    let t = drive.call(json!({"call": "see"}))["t"].as_i64().unwrap();
    let waited = drive.call(
        json!({"call": "wait_for", "wait_for": {"t": t + ms * 705_600, "step_ms": 100},
        "timeout": ms + 2_000}),
    );
    assert_eq!(waited["ok"], true, "{waited}");
}

/// The core's `nth` event about the record's ask, fed as the hub's stream delivers it; when the replica has it.
fn feed(drive: &mut Drive, nth: u8, kind: &str, data: Value) -> u64 {
    let id = format!("01PWFED{nth:019}");
    let event = json!({"v": 1, "id": id, "kind": kind, "writer": "core", "actor": "you", "scope": "you",
        "subject": format!("ask:{ASK}"), "data": data});
    let fed = drive.call(json!({"call": "feed", "feed": {"session": CART, "event": event}}));
    assert_eq!(fed["ok"], true, "{fed}");
    fed["ts"].as_u64().unwrap()
}

/// The record's ask on its page, with nothing said yet.
fn on_the_asks_page(name: &str) -> Drive {
    let (mut drive, _) = Drive::launch(name, json!({"from": "fixture", "fixture": WORDS}));
    let address = format!("ask/{ASK}");
    let opened = drive.call(json!({"call": "open", "open": {"address": address}}));
    assert_eq!(opened["address"], json!(address), "{opened}");
    pass(&mut drive, 3_000);
    assert_eq!(said(&mut drive), [""; 0], "nothing changed yet");
    drive
}

/// #3232: a default applied to the ask on the open page is said once, with the default and that it can be undone.
#[test]
fn a_default_applied_to_the_ask_on_the_open_page_is_said_with_the_default() {
    let mut drive = on_the_asks_page("said-default");
    let stop = json!({"answer": "stop", "plan_hash": null, "decision": "none"});
    feed(&mut drive, 1, "ask.defaulted", stop);
    pass(&mut drive, 3_000);
    assert_eq!(
        said(&mut drive),
        ["Took its default · Stop here · it can be undone"]
    );
}

/// #3232: a hold is said at its start with its length and the key that undoes it, and once more when it is withdrawn.
#[test]
fn a_hold_withdrawn_before_its_step_started_is_said_after_its_start() {
    let mut drive = on_the_asks_page("said-withdrawn");
    let keep = json!({"answer": "keep", "plan_hash": null, "decision": "allow"});
    let yes = feed(&mut drive, 1, "ask.answered", keep);
    let steps = json!(["git push origin main"]);
    let held = json!({"until": yes + 10_000, "steps": steps});
    feed(&mut drive, 2, "approval.held", held);
    pass(&mut drive, 3_000);
    let start = "Starts in 10 s · Undo · ⌘Z";
    assert_eq!(said(&mut drive), [start]);
    let withdrawn = json!({"steps": steps, "restarted": false});
    feed(&mut drive, 3, "approval.withdrawn", withdrawn);
    pass(&mut drive, 3_000);
    assert_eq!(said(&mut drive), [start, "Withdrawn before it started"]);
}

/// #3232: an ask that comes due with notifications off posts nothing, so the key window says it; with them on its
/// notification says it and the window doesn't, so nothing is heard twice.
#[test]
fn an_ask_that_comes_due_with_notifications_off_is_said_in_the_window() {
    let line = format!("needs you · 1 ask needs you · {ASKED} · ⌘J");
    for (setting, lines, posts) in [("denied", vec![line], 0), ("allowed", Vec::new(), 1)] {
        let launch = json!({"from": "fixture", "fixture": WORDS, "notifications": setting});
        let (mut drive, _) = Drive::launch(&format!("said-{setting}"), launch);
        pass(&mut drive, 3_000);
        assert_eq!(said(&mut drive), lines, "notifications {setting}");
        let closed = drive.call(json!({"call": "close"}));
        let trace = std::fs::read_to_string(closed["trace"]["path"].as_str().unwrap()).unwrap();
        let trace: Value = serde_json::from_str(&trace).unwrap();
        let posted = trace["notifications"].as_array().unwrap();
        let its = posted
            .iter()
            .filter(|post| post["ask"] == format!("ask:{ASK}"));
        assert_eq!(its.count(), posts, "notifications {setting}: {posted:?}");
    }
}

/// The node whose id is `id`; null when the tree holds none.
fn node_of(node: &Value, id: &str) -> Value {
    if node["id"] == id {
        return node.clone();
    }
    let children = node["children"].as_array().into_iter().flatten();
    children
        .map(|child| node_of(child, id))
        .find(|found| !found.is_null())
        .unwrap_or(Value::Null)
}

/// #3232: asks that come in sight beside a presented card wait as new. Their count is drawn on the row of the list's
/// count and said once for each change, the card stays where it is, and showing one of them ends the count.
#[test]
fn asks_that_arrive_beside_a_presented_card_are_said_as_new_with_their_count() {
    let mut drive = on_the_asks_page("said-new");
    // What the window draws of them, and where the card is.
    let look = |drive: &mut Drive| {
        let tree = drive.call(json!({"call": "see"}))["snapshot"]["tree"].clone();
        let card = node_of(&tree, "question-card")["bounds"].clone();
        (node_of(&tree, "asks-new")["name"].clone(), card)
    };
    let (none, card) = look(&mut drive);
    assert_eq!(none, Value::Null, "no ask is new yet");
    let mut lines = Vec::new();
    for (nth, new) in [(1, "1 new"), (2, "2 new")] {
        let data = json!({"kind": "choice", "question": format!("Is {nth} right?"), "owner": "you",
            "options": [{"id": "yes", "label": "Yes", "decision": "none"}, {"id": "no", "label": "No", "decision": "none"}],
            "recommended": "yes", "deadline": 1_800_134_000_000_u64, "fallback": "no", "default": "no",
            "provisional": false, "key": format!("k-new-{nth}")});
        let event = json!({"v": 1, "id": format!("01PWNEW{nth:019}"), "kind": "ask.created", "writer": "core",
            "actor": "you", "scope": "you", "data": data});
        let fed = drive.call(json!({"call": "feed", "feed": {"session": CART, "event": event}}));
        assert_eq!(fed["ok"], true, "{fed}");
        assert_eq!(
            look(&mut drive),
            (json!(new), card.clone()),
            "the card stays"
        );
        pass(&mut drive, 3_000);
        lines.push(format!(
            "needs you · {} asks need you · {new} · ⌘J",
            nth + 1
        ));
        assert_eq!(said(&mut drive), lines);
    }
    // One of them shown: its page opens, and none waits as new beside its card.
    let address = "ask/01PWNEW0000000000000000001";
    let opened = drive.call(json!({"call": "open", "open": {"address": address}}));
    assert_eq!(opened["address"], json!(address), "{opened}");
    pass(&mut drive, 3_000);
    assert_eq!(look(&mut drive).0, Value::Null, "shown, so none is new");
    assert_eq!(said(&mut drive), lines);
}

/// The press that brings the window back from another app is refused (#1843), so Send is often the first thing pressed
/// there. A resize re-arms the card too, and Send is pressed at once.
#[test]
fn a_send_the_card_refused_leaves_your_words_in_the_box() {
    const RECORD: &str = concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../tests/acceptance/1462/fixtures/record.events.jsonl"
    );
    let (mut drive, _) = Drive::launch(
        "refused-send",
        json!({"from": "fixture", "fixture": RECORD, "center": "deepbuild/needs-you"}),
    );
    let mut does = |call: Value| {
        let reply = drive.call(call);
        assert_eq!(reply["ok"], true, "{reply}");
        reply
    };
    does(json!({"call": "open", "open": {"address": "ask/01KB1462AK0000000000000002"}}));
    does(
        json!({"call": "wait_for", "locator": {"id": "question-card"},
        "wait_for": {"state": "value", "value": "armed"}, "timeout": 5000}),
    );
    does(json!({"call": "act", "act": {"kind": "press", "keys": "cmd-n"}}));
    does(json!({"call": "act", "act": {"kind": "type", "text": "plain files"}}));
    does(json!({"call": "resize", "resize": {"size": [1200, 800]}}));
    does(json!({"call": "act", "locator": {"id": "box-send"}, "act": {"kind": "click"}}));
    let seen = does(json!({"call": "see"}));
    let value = |id: &str| value_of(&seen["snapshot"]["tree"], id);
    assert_eq!(
        (value("question-card"), value("box-draft")),
        (json!("presented"), json!("plain files"))
    );
}

/// The value of the node whose id is `id`.
fn value_of(node: &Value, id: &str) -> Value {
    if node["id"] == id {
        return node["value"].clone();
    }
    let children = node["children"].as_array().into_iter().flatten();
    children
        .map(|child| value_of(child, id))
        .find(|value| !value.is_null())
        .unwrap_or(Value::Null)
}

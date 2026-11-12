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
    let reply = drive.call(json!({"call": "ui_check", "ui_check": {"changed": [file], "panel": panel}}));
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

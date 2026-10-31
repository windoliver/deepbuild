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

//! The budget class table's ambient cap and "when hidden" in the `live` call (#421: the showpiece
//! budget class): a showpiece presents at most 30 frames a second however fast the call's clock
//! runs, and draws and submits nothing while its window is hidden or unfocused, where a work
//! product pauses only while hidden. On the noop backend, so it needs no GPU.

use std::io::Write;
use std::process::{Command, Stdio};

use serde_json::{json, Value};

/// A camera over one box that slides the whole span, so every frame has something to draw.
fn doc(class: &str) -> Value {
    json!({
        "format": 1, "profile": "scene", "title": "Ambient", "description": "A #421 ambient-cap fixture.",
        "size": [64, 48], "camera": "cam",
        "requires": {"modules": {"scene3d": "^1"}},
        "budget": {"class": class},
        "transport": {"span": "60s"},
        "items": {
            "cam": {"id": "cam", "kind": "camera@1", "name": "Camera", "order": "a0",
                "params": {"projection": "perspective", "target": [0, 0, 0], "orbit": {"azimuth": 30, "elevation": 35, "distance": 14}, "fov": 40}},
            "box": {"id": "box", "kind": "mark.box@1", "name": "Box", "order": "b0",
                "params": {"size": [1, 1, 1], "paint": {"fill": {"role": "accent"}}}, "at": {"pos": [0, 0.5, 0]}},
        },
        "channels": {"slide": {"target": "items/box/at/pos/0", "type": "f32",
            "keys": {"k0": {"t": "0s", "value": -3, "interp": "linear"}, "k1": {"t": "60s", "value": 3, "interp": "linear"}}}},
    })
}

/// One `live` call in a fresh `deep-gpu run --backend noop`; its reply.
fn live(dir: &std::path::Path, mut call: Value) -> Value {
    call["call"] = json!("live");
    call["look"] = json!({"roles": {"ground": "#000000", "accent": "#1aa3c8"}});
    let line = json!({"out": dir, "calls": [call]}).to_string();
    let mut child = Command::new(env!("CARGO_BIN_EXE_deep-gpu"))
        .args(["run", "--backend", "noop"])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .spawn()
        .expect("deep-gpu runs");
    writeln!(child.stdin.take().expect("stdin"), "{line}").expect("the scenario is written");
    let out = child.wait_with_output().expect("deep-gpu exits");
    let answer: Value = serde_json::from_slice(&out.stdout).expect("one JSON answer");
    assert_eq!(answer["ok"], true, "the scenario ran: {answer}");
    let reply = answer["replies"][0].clone();
    assert!(
        reply.get("code").is_none(),
        "the live call answered: {reply}"
    );
    reply
}

fn session(dir: &std::path::Path, id: &str, class: &str) -> Value {
    let path = dir.join(format!("{id}.json"));
    std::fs::write(&path, doc(class).to_string()).expect("the document is written");
    json!({"session": id, "writer": format!("agent:{id}"), "doc": path})
}

fn view<'a>(frame: &'a Value, id: &str) -> &'a Value {
    frame["views"]
        .as_array()
        .and_then(|vs| vs.iter().find(|v| v["session"] == id))
        .unwrap_or_else(|| panic!("frame {} has session {id}'s view", frame["frame"]))
}

/// The gaps between consecutive presents, in ms.
fn gaps(reply: &Value) -> Vec<f64> {
    let at: Vec<f64> = reply["frames"]
        .as_array()
        .expect("frames")
        .iter()
        .map(|f| f["presented_ms"].as_f64().expect("every frame presented"))
        .collect();
    at.windows(2).map(|w| w[1] - w[0]).collect()
}

#[test]
fn a_showpiece_presents_at_most_thirty_frames_a_second_while_a_core_view_follows_the_clock() {
    let dir = tempdir();
    let frames = 12;
    let show = live(
        &dir,
        json!({"frames": frames, "fps": 120, "sessions": [session(&dir, "show", "showpiece")]}),
    );
    for f in show["frames"].as_array().expect("frames") {
        assert_eq!(
            view(f, "show")["drawn"],
            true,
            "the showpiece draws frame {}",
            f["frame"]
        );
    }
    let g = gaps(&show);
    assert_eq!(g.len(), frames - 1);
    for (i, gap) in g.iter().enumerate() {
        assert!(
            *gap >= 1e3 / 30.0 - 0.05,
            "presents {} and {} are {gap:.2} ms apart, under 1 ÷ 30 s",
            i + 1,
            i + 2
        );
    }
    // The control: a class with no ambient cap presents at the call's 120 fps.
    let core = live(
        &dir,
        json!({"frames": frames, "fps": 120, "sessions": [session(&dir, "core", "core_view")]}),
    );
    let mut g = gaps(&core);
    g.sort_by(f64::total_cmp);
    assert!(
        g[g.len() / 2] < 20.0,
        "a core view's median gap at 120 fps is under 20 ms: {g:?}"
    );
}

#[test]
fn a_showpiece_pauses_while_hidden_or_unfocused_and_a_work_product_only_while_hidden() {
    let dir = tempdir();
    let reply = live(
        &dir,
        json!({
            "frames": 12, "report": ["fences"],
            "sessions": [session(&dir, "show", "showpiece"), session(&dir, "work", "work_product")],
            "events": [
                {"frame": 4, "window_state": {"focused": false}},
                {"frame": 7, "window_state": {"focused": true}},
                {"frame": 9, "window_state": {"window": "main", "visible": false}},
                {"frame": 11, "window_state": {"visible": true}},
            ],
        }),
    );
    let unfocused = 4..=6;
    let hidden = 9..=10;
    for f in reply["frames"].as_array().expect("frames") {
        let k = f["frame"].as_u64().expect("its number");
        let show_paused = unfocused.contains(&k) || hidden.contains(&k);
        let work_paused = hidden.contains(&k);
        for (id, paused) in [("show", show_paused), ("work", work_paused)] {
            let v = view(f, id);
            assert_eq!(v["drawn"], !paused, "frame {k}: {id} drawn is {}", !paused);
            assert_eq!(v["paused"], paused, "frame {k}: {id} paused is {paused}");
        }
    }
    // Submits nothing: no submit fence for a paused session's frame.
    for e in reply["fences"].as_array().expect("the fence record") {
        if e["event"] != "submit" {
            continue;
        }
        let k = e["frame"].as_u64().expect("a submit names its frame");
        match e["session"].as_str() {
            Some("show") => assert!(
                !unfocused.contains(&k) && !hidden.contains(&k),
                "the showpiece submitted frame {k} while paused"
            ),
            Some("work") => assert!(
                !hidden.contains(&k),
                "the work product submitted frame {k} while hidden"
            ),
            _ => {}
        }
    }
}

fn tempdir() -> std::path::PathBuf {
    let dir = std::env::temp_dir().join(format!(
        "deep-gpu-ambient-{}-{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .expect("after the epoch")
            .as_nanos()
    ));
    std::fs::create_dir_all(&dir).expect("a scratch directory");
    dir
}

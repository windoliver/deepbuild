use super::*;

#[test]
fn a_tour_whose_keys_all_come_before_its_start_plays_once() {
    let (tx, rx) = std::sync::mpsc::channel();
    std::thread::spawn(move || {
        let piece = Piece {
            seed: 0,
            class: deep_canvas::budget::Class::Figure,
            controls: Default::default(),
            limits: Default::default(),
            sources: Default::default(),
            tour: Some(json!({"idle_after": 0, "keys": {"a": [[-1, 1]]}})),
            items: Vec::new(),
            machine: Vec::new(),
            document: String::new(),
        };
        let entries = track(&piece, &json!({}), 0).expect("a track");
        let played: Vec<(i64, world::Given)> =
            entries.iter().map(|e| (e.t, e.value.clone())).collect();
        tx.send(played).ok();
    });
    let got = rx.recv_timeout(std::time::Duration::from_secs(1));
    assert_eq!(got, Ok(vec![(-F, world::Given::Number(1.0))]));
}

#[test]
fn a_reading_waits_for_its_readers_alone() {
    // `r` reads the feed at 60 Hz and `s` reads nothing at 15 Hz, so after step 3 `s` has run
    // to 12/60 s while `r` next runs step 4: the reading is stamped at 4/60 s, and taken.
    let bytes = wat::parse_str(include_str!("fixture.wat")).expect("the fixture assembles");
    let sha = rewrite::hash(&bytes);
    let item = |hz: i64, reads: Value| {
        json!({"kind": "logic@1", "params": {"program": sha, "step_rate": hz, "reads": reads,
                "writes": {"steps": {"type": "i32"}, "presses": {"type": "i32"}}}})
    };
    let mut assets = Map::new();
    assets.insert(sha.clone(), json!(B64.encode(&bytes)));
    let piece = json!({"seed": 533, "sources": {"feed": {"shape": "scalar", "delivery": "each"}},
            "items": {"r": item(60, json!(["reading:feed"])), "s": item(15, json!([]))}, "assets": assets});
    let mut logic = Logic::new(Planted::default());
    let opened = logic.handle(&json!({"call": "open", "piece": piece}));
    let session = opened["session"].as_str().expect("a session").to_string();
    logic.handle(&json!({"call": "step", "session": session, "to": 3}));
    let entry = json!({"reading": "reading:feed", "value": 7, "as_of": 1});
    let got = logic.handle(&json!({"call": "append", "session": session, "entry": entry}));
    assert_eq!(got["entry"]["t"], json!(4 * F / 60), "{got}");
}

/// #533: entries a slow item reads in one step keep the track's order, by time first, then
/// player and seq. A 15 Hz item's step 1 takes the stamps 1/60 s to 4/60 s: player 2's entry
/// at 1/60 s comes before player 1's at 2/60 s, whichever arrived first.
#[test]
fn a_slow_items_step_reads_its_entries_by_time_then_player_and_seq() {
    // Writes the [player, value] of the first two entries of `press` in its read region.
    let bytes = wat::parse_str(
            r#"(module (memory (export "memory") 1 1) (global (export "reads_at") i32 (i32.const 0))
            (global (export "writes_at") i32 (i32.const 4096)) (func (export "init") (param $seed i64))
            (func (export "step") (param $k i64)
              (f64.store (i32.const 4096) (f64.convert_i32_u (i32.load (i32.const 8))))
              (f64.store (i32.const 4104) (f64.load (i32.const 16)))
              (f64.store (i32.const 4112) (f64.convert_i32_u (i32.load (i32.const 24))))
              (f64.store (i32.const 4120) (f64.load (i32.const 32)))))"#,
        )
        .expect("the program assembles");
    let sha = rewrite::hash(&bytes);
    let mut assets = Map::new();
    assets.insert(sha.clone(), json!(B64.encode(&bytes)));
    let piece = json!({"seed": 533, "controls": {"press": {"kind": "slider"}}, "assets": assets,
            "items": {"order": {"kind": "logic@1", "params": {"program": sha, "step_rate": 15,
                "reads": ["press"], "writes": {"order": {"type": "f64", "count": 4}}}}}});
    let order = |first: (i64, i64, i64), second: (i64, i64, i64)| {
        let mut logic = Logic::new(Planted::default());
        let opened = logic.handle(&json!({"call": "open", "piece": piece}));
        let session = opened["session"].as_str().expect("a session").to_string();
        for (sixtieths, player, value) in [first, second] {
            let entry = json!({"t": sixtieths * F / 60, "seq": 0, "control": "press",
                    "value": value, "writer": "you", "player": player});
            let got = logic.handle(&json!({"call": "append", "session": session, "entry": entry}));
            assert_eq!(got["ok"], json!(true), "{got}");
        }
        let ran = logic.handle(&json!({"call": "step", "session": session, "to": 1}));
        ran["steps"][1]["arrays"]["order.order"].clone()
    };
    let wanted = json!([2.0, 21.0, 1.0, 12.0]);
    assert_eq!(
        order((1, 2, 21), (2, 1, 12)),
        wanted,
        "the earlier entry arriving first"
    );
    assert_eq!(
        order((2, 1, 12), (1, 2, 21)),
        wanted,
        "the earlier entry arriving last"
    );
}

/// #533: two items read one feed at 60 Hz and 15 Hz. After step 3 of each, `s` has read to
/// 12/60 s, so the reading is stamped at the first step either runs after that, 13/60 s.
#[test]
fn a_reading_two_rates_read_is_stamped_after_what_both_have_read() {
    let bytes = wat::parse_str(include_str!("fixture.wat")).expect("the fixture assembles");
    let sha = rewrite::hash(&bytes);
    let item = |hz: i64| {
        json!({"kind": "logic@1", "params": {"program": sha, "step_rate": hz, "reads": ["reading:feed"],
                "writes": {"steps": {"type": "i32"}, "presses": {"type": "i32"}}}})
    };
    let mut assets = Map::new();
    assets.insert(sha.clone(), json!(B64.encode(&bytes)));
    let piece = json!({"seed": 533, "sources": {"feed": {"shape": "scalar", "delivery": "each"}},
            "items": {"r": item(60), "s": item(15)}, "assets": assets});
    let mut logic = Logic::new(Planted::default());
    let opened = logic.handle(&json!({"call": "open", "piece": piece}));
    let session = opened["session"].as_str().expect("a session").to_string();
    logic.handle(&json!({"call": "step", "session": session, "to": 3}));
    let entry = json!({"reading": "reading:feed", "value": 7, "as_of": 1});
    let got = logic.handle(&json!({"call": "append", "session": session, "entry": entry}));
    assert_eq!(got["entry"]["t"], json!(13 * F / 60), "{got}");
}

/// #533: an item on a turn clock runs the step a reading it reads is recorded at (Logic:
/// turn clock), and no other.
#[test]
fn a_reading_wakes_the_turn_clock_item_that_reads_it() {
    let bytes = wat::parse_str(include_str!("fixture.wat")).expect("the fixture assembles");
    let sha = rewrite::hash(&bytes);
    let mut assets = Map::new();
    assets.insert(sha.clone(), json!(B64.encode(&bytes)));
    for delivery in ["each", "latest"] {
        let piece = json!({"seed": 533, "sources": {"feed": {"shape": "scalar", "delivery": delivery}}, "assets": assets,
                "items": {"r": {"kind": "logic@1", "params": {"program": sha, "clock": "on_input", "reads": ["reading:feed"],
                    "writes": {"steps": {"type": "i32"}, "presses": {"type": "i32"}}}}}});
        let mut logic = Logic::new(Planted::default());
        let opened = logic.handle(&json!({"call": "open", "piece": piece}));
        let session = opened["session"].as_str().expect("a session").to_string();
        logic.handle(&json!({"call": "step", "session": session, "to": 2}));
        let entry = json!({"reading": "reading:feed", "value": 7, "as_of": 1});
        let got = logic.handle(&json!({"call": "append", "session": session, "entry": entry}));
        let at = got["entry"]["t"].as_i64().expect("a stamp") / (F / 60);
        let ran = logic.handle(&json!({"call": "step", "session": session, "to": 9}));
        let steps: Vec<i64> = ran["steps"]
            .as_array()
            .into_iter()
            .flatten()
            .filter_map(|s| s["step"].as_i64())
            .collect();
        assert_eq!(
            steps,
            vec![at],
            "{delivery}: the steps run after the reading: {ran}"
        );
    }
}

/// #533: values past an `each` reading's `max_per_step` wait for the next step, and that wait
/// asks a turn-clock item for the step: three values at one a step run three steps.
#[test]
fn readings_still_waiting_ask_a_turn_clock_item_for_its_next_step() {
    let bytes = wat::parse_str(include_str!("fixture.wat")).expect("the fixture assembles");
    let sha = rewrite::hash(&bytes);
    let mut assets = Map::new();
    assets.insert(sha.clone(), json!(B64.encode(&bytes)));
    let piece = json!({"seed": 533, "sources": {"feed": {"shape": "scalar", "delivery": "each", "max_per_step": 1}},
            "assets": assets, "items": {"r": {"kind": "logic@1", "params": {"program": sha, "clock": "on_input",
                "reads": ["reading:feed"], "writes": {"steps": {"type": "i32"}, "presses": {"type": "i32"}}}}}});
    let mut logic = Logic::new(Planted::default());
    let opened = logic.handle(&json!({"call": "open", "piece": piece}));
    let session = opened["session"].as_str().expect("a session").to_string();
    logic.handle(&json!({"call": "step", "session": session, "to": 2}));
    for _ in 0..3 {
        let entry = json!({"reading": "reading:feed", "value": 7, "as_of": 1});
        let got = logic.handle(&json!({"call": "append", "session": session, "entry": entry}));
        assert_eq!(got["ok"], json!(true), "{got}");
    }
    let ran = logic.handle(&json!({"call": "step", "session": session, "to": 9}));
    let steps: Vec<i64> = ran["steps"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|s| s["step"].as_i64())
        .collect();
    assert_eq!(steps, vec![3, 4, 5], "{ran}");
}

/// #1920: a golden carries the seal's runtime digest in place of the logic module's own. The
/// set this runner holds, logic and sandbox, has no measured or backend_bytes implementation,
/// so it is the d1 digest of no entry: the SHA-256 of `[]`.
#[test]
fn a_golden_carries_the_seals_runtime_digest() {
    let line = json!({"call": "golden", "piece": {"seed": 0, "items": {}}, "steps": 1});
    let golden = Logic::default().handle(&line)["golden"].clone();
    let none = "4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945";
    assert_eq!(golden["runtime_digest"], json!(none));
}

/// A golden holds no time (#532, #534's checkpoint `ns`): the same piece gives the same golden
/// twice and verifies against it, as does a golden recorded with each checkpoint's `ns`, while
/// one whose checkpoint's deep hash differs fails.
#[test]
fn a_golden_holds_no_time_and_verifies_by_step_and_deep_hash() {
    let program = wat::parse_str(
            r#"(module (memory (export "memory") 1 1)
  (global (export "reads_at") i32 (i32.const 0)) (global (export "writes_at") i32 (i32.const 1024))
  (func (export "init") (param i64))
  (func (export "step") (param $k i64) (i32.store (i32.const 1024) (i32.wrap_i64 (local.get $k)))))"#,
        )
        .expect("a program");
    let sha = rewrite::hash(&program);
    let params = json!({"program": sha, "writes": {"a": {"type": "i32", "count": 1}}});
    let piece = json!({"seed": 0, "assets": {&sha: B64.encode(&program)}, "items": {"e": {"kind": "logic@1", "params": params}}});
    let call = |call: &str, golden: Option<&Value>| {
        let line = json!({"call": call, "piece": piece, "steps": 121, "golden": golden});
        Logic::default().handle(&line)
    };
    let golden = call("golden", None)["golden"].clone();
    let steps: Vec<&Value> = golden["checkpoint_hashes"]["e"]
        .as_array()
        .expect("checkpoints")
        .iter()
        .map(|c| &c["step"])
        .collect();
    assert_eq!(steps, [0, 60, 120]);
    let again = call("golden", None)["golden"].clone();
    assert_eq!(again["checkpoint_hashes"], golden["checkpoint_hashes"]);
    assert_eq!(again, golden);
    assert_eq!(call("golden_verify", Some(&golden))["verdict"], "PASS");
    let mut timed = golden.clone();
    timed["checkpoint_hashes"]["e"][1]["ns"] = json!(4576);
    assert_eq!(call("golden_verify", Some(&timed))["verdict"], "PASS");
    let mut other = golden.clone();
    other["checkpoint_hashes"]["e"][1]["deep_hash"] = json!("0000000000000000");
    assert_eq!(call("golden_verify", Some(&other))["verdict"], "FAIL");
}

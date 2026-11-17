use super::*;

/// The core alone, sealed with no faults. `seal()` is not called: the seal-count test counts its runs.
fn startup() -> Startup {
    startup_of(deep_canvas::registry::core())
}

/// A startup holding `sealed`, with no faults; for a test in another module, without `seal()`.
pub(crate) fn startup_of(sealed: deep_canvas::registry::Sealed) -> Startup {
    Startup {
        sealed,
        seal_ms: 0.0,
        steps_by_name: false,
        admits_frame_json: false,
        test_build: false,
        shapes_on_ui_thread: false,
        run_per_document: false,
        network: None,
        ignores_unknown_occlusion: false,
        listing: None,
        kinds: None,
        layouts: Default::default(),
        cache: None,
        run_planted: None,
    }
}

#[test]
fn every_seal_in_the_process_counts() {
    use std::sync::atomic::Ordering;
    let before = hub::SEAL_RUNS.load(Ordering::Relaxed);
    for _ in 0..2 {
        seal(
            None,
            Coefficients::read(cost::REFERENCE).expect("the build's own"),
        )
        .expect("the shipped set seals");
    }
    assert_eq!(hub::SEAL_RUNS.load(Ordering::Relaxed) - before, 2);
}

#[test]
fn a_batch_column_whose_length_overflows_is_no_call() {
    let c = json!({"call": "batch", "doc": "d", "source": "s",
            "columns": {"x": {"dtype": "f64", "data": "", "len": 1u64 << 61}}});
    assert!(call(c.as_object().expect("an object")).is_none());
}

/// #138: a golden store that can't be read, or can't be written back, takes no record and no
/// decision: each is refused, and a store that can't be read stays as it was.
#[test]
fn a_golden_store_that_cant_be_read_or_written_refuses_a_record_and_a_decision() {
    use std::os::unix::fs::PermissionsExt;
    let startup = startup();
    let dir = std::env::temp_dir().join(format!("deep-138-store-{}", std::process::id()));
    let goldens = dir.join("goldens");
    let store = goldens.join("store.json");
    std::fs::create_dir_all(&goldens).expect("a folder");
    let reply = |call: &Value| {
        let line = json!({"evidence": dir.join("evidence"), "goldens": goldens,
                "commit": "0123456789abcdef0123456789abcdef01234567", "calls": [call]});
        answer("run", &startup, &line.to_string())["replies"][0].clone()
    };
    // The first fixture this build records on the CPU, and a decision that needs none.
    let manifest = reply(&json!({"call": "manifest"}));
    let record = (manifest["fixtures"].as_array().expect("fixtures").iter())
        .map(|f| json!({"call": "record", "fixture": f["name"], "backend": "vello_cpu"}))
        .find(|c| reply(c)["outcome"] == "recorded")
        .expect("a fixture records");
    let waive = json!({"call": "decide", "decision": {"waive": {"fixture": "f", "reason": "r"}}});
    let outcomes = || {
        [&record, &waive].map(|call| {
            let r = reply(call);
            let text = |k: &str| r[k].as_str().unwrap_or("").to_string();
            format!("{} {}", text("outcome"), text("code"))
        })
    };
    std::fs::write(&store, "{").expect("written");
    let unreadable = outcomes();
    let kept = std::fs::read_to_string(&store).expect("the store");
    std::fs::remove_file(&store).expect("removed");
    let mode = |m| std::fs::set_permissions(&goldens, std::fs::Permissions::from_mode(m));
    mode(0o555).expect("read-only");
    let unwritable = outcomes();
    mode(0o755).expect("writable");
    let _ = std::fs::remove_dir_all(&dir);
    let refused = |code: &str| [(); 2].map(|()| format!("refused {code}"));
    assert_eq!(
        (unreadable, kept.as_str(), unwritable),
        (
            refused("store_unreadable"),
            "{",
            refused("store_unwritable")
        )
    );
}

/// #138: a kit call that runs nothing passes nothing. A call that matches no module is
/// INVALID and leaves the ledger as it was; a module none of whose parts ran is INVALID; and
/// a run over some parts only writes no ledger.
#[test]
fn a_kit_call_that_runs_nothing_is_invalid_and_a_partial_run_writes_no_ledger() {
    let startup = startup();
    let dir = std::env::temp_dir().join(format!("deep-138-unrun-{}", std::process::id()));
    std::fs::create_dir_all(&dir).expect("a folder");
    let kit = |call: Value| {
        let line = json!({"evidence": dir.join("evidence"), "calls": [call]});
        answer("run", &startup, &line.to_string())["replies"][0].clone()
    };
    let kept = dir.join("kept.json");
    std::fs::write(&kept, "{\"kept\": true}\n").expect("written");
    let unmatched = kit(json!({"call": "kit", "modules": ["marks2D"], "ledger": kept}));
    let kept = std::fs::read_to_string(&kept).expect("the ledger");
    assert_eq!(
        (unmatched["verdict"].as_str(), kept.as_str()),
        (Some("INVALID"), "{\"kept\": true}\n"),
        "no module matched"
    );
    for parts in [json!([]), json!(["sandbox"])] {
        let r = kit(json!({"call": "kit", "modules": ["core"], "parts": parts}));
        assert_eq!(
            [&r["verdict"], &r["modules"][0]["verdict"]],
            ["INVALID"; 2],
            "core over the parts {parts}"
        );
    }
    let partial = dir.join("partial.json");
    let one = json!(["schedule"]);
    let r = kit(json!({"call": "kit", "modules": ["core"], "parts": one, "ledger": partial}));
    let written = partial.exists();
    let _ = std::fs::remove_dir_all(&dir);
    assert_eq!(r["modules"][0]["parts"][0]["part"], "schedule", "{r}");
    assert!(!written, "a run of one part wrote a ledger");
}

#[test]
fn every_shared_document_reply_is_stamped_on_the_clock_too() {
    // The clocked check queue builds a patch's reply itself, not through `Hub::call`.
    // `seal()` is not called here: the seal-count test counts its runs.
    let startup = startup();
    let evidence = std::env::temp_dir().join(format!("deep-305-stamp-{}", std::process::id()));
    let doc = "01JB7D00000000000000000001";
    let seed = json!({
        "format": 1, "profile": "board", "title": "Stamps", "size": [640, 360],
        "description": "A shared board whose every reply must carry the core and the set digest.",
        "layers": {"alpha-main": {"writer": "agent:t", "title": "Alpha", "order": "a1"}},
        "items": {},
    });
    let patch = |id: &str| {
        json!({"call": "deep_show", "session": "s", "doc": doc, "patch": {
            "patch": id, "doc": doc, "base": 0, "reason": "a stamp test",
            "ops": [{"op": "create", "item": {"id": "~1", "kind": "rect@1", "name": "N",
                "order": "a5", "params": {"box": [0, 0, 10, 10]}}}],
        }})
    };
    let scenario = |clock: bool, planted: Option<&str>| {
        let mut calls = vec![
            patch("01JB7D0000000000000000P001"),
            patch("01JB7D0000000000000000P002"),
            json!({"call": "read", "doc": doc}),
        ];
        let mut s = json!({
            "evidence": evidence.to_string_lossy(),
            "sessions": {"s": {"thread": "t", "name": "Claude Code: t",
                "process": {"pid": 4100, "start": 1000}}},
            "processes": [{"pid": 1, "ppid": 0, "start": 0}],
            "panels": {"main": {"rect": [0, 0, 800, 600]}},
            "docs": {doc: {"panel": "main", "document": seed}},
        });
        if clock {
            for (i, c) in calls.iter_mut().enumerate() {
                c["at"] = json!(i * 10);
            }
            s["clock"] = json!({"refresh_hz": 60, "lead": 0, "check": 5});
        }
        if let Some(twin) = planted {
            s["planted"] = json!(twin);
        }
        s["calls"] = json!(calls);
        s.to_string()
    };
    for (clock, planted) in [
        (false, None),
        (true, None),
        (true, Some("reply_without_digest")),
    ] {
        let out = answer("run", &startup, &scenario(clock, planted));
        let replies = out["replies"].as_array().expect("a run's replies");
        assert_eq!(replies.len(), 3, "{out}");
        assert_eq!(replies[0]["outcome"], "applied", "{out}");
        for r in replies {
            assert_eq!(
                r["core"],
                json!(deep_canvas::registry::core_name()),
                "clock {clock}: {r}"
            );
            let digest = r.get("set_digest");
            match planted {
                None => assert_eq!(digest, Some(&json!(startup.sealed.set_digest)), "{r}"),
                Some(_) => assert!(digest.is_none(), "{r}"),
            }
        }
    }
    let _ = std::fs::remove_dir_all(&evidence);
}

/// #387: the sealed plan published at `deep://schedule/<core version>` equals its committed
/// snapshot for every build set, so a change to the plan is a reviewed change to a file.
#[test]
fn the_published_schedule_matches_its_committed_snapshot() {
    let snapshots = [
        (BuildSet::Core, include_str!("../schedule/core.json")),
        (BuildSet::R1, include_str!("../schedule/r1.json")),
        (BuildSet::R2, include_str!("../schedule/r2.json")),
        (BuildSet::Full, include_str!("../schedule/full.json")),
    ];
    for (set, snapshot) in snapshots {
        let published = assemble(set, modules(set))
            .seal()
            .expect("the shipped set seals")
            .schedule();
        let committed: Value = serde_json::from_str(snapshot).expect("the snapshot is JSON");
        assert_eq!(
            published,
            committed,
            "the {} schedule drifted from crates/deep-show/schedule/{}.json:\n{}",
            set.name(),
            set.name(),
            serde_json::to_string_pretty(&published).unwrap_or_default()
        );
    }
}

#[test]
fn run_takes_planted_and_costs_once_each_and_nothing_else() {
    let args = |a: &[&str]| a.iter().map(|s| s.to_string()).collect::<Vec<_>>();
    assert!(matches!(
        start_args(&args(&["run"])),
        Ok((None, None, None))
    ));
    assert!(matches!(
        start_args(&args(&[
            "run",
            "--planted",
            "treats_every_dependency_required"
        ])),
        Ok((
            Some(StartPlanted::Seal(Fault::EveryDependencyRequired)),
            None,
            None
        ))
    ));
    assert!(matches!(
        start_args(&args(&[
            "run",
            "--costs",
            "c.json",
            "--planted",
            "admits_frame_json"
        ])),
        Ok((
            Some(StartPlanted::Seal(Fault::AdmitsFrameJson)),
            Some(_),
            None
        ))
    ));
    let twin = "treats_every_dependency_required";
    for stray in [
        &["run", "extra"][..],
        &["run", "--planted"],
        &["run", "--planted", "nonsense"],
        &["run", "--planted", twin, "extra"],
        &["run", "--planted", twin, "--planted", twin],
        &["run", "--costs", "a", "--costs", "b"],
        &["run", "--cache", "a", "--cache", "b"],
    ] {
        assert!(start_args(&args(stray)).is_err(), "{stray:?}");
    }
}

#[test]
fn core_version_is_the_canvas_crates_version() {
    let manifest = include_str!("../../deep-canvas/Cargo.toml");
    let line = format!("version = \"{}\"", deep_canvas::registry::CORE_VERSION);
    assert!(manifest.lines().any(|l| l.trim() == line), "{line}");
    // The seal parses it at startup; a pre-release tag would need `Semver` to carry one.
    assert!(deep_canvas::registry::Semver::parse(deep_canvas::registry::CORE_VERSION).is_some());
}

/// #383's view controls on a shared board an agent adds to: scrubbing the record's time back
/// shows the revision current then, picked and drawn as it was; compare against revision 0
/// names what changed, the changed lens colors by it, and no control writes a revision.
#[test]
fn a_scrubbed_view_shows_the_revision_current_then_and_compare_names_what_changed() {
    let startup = startup();
    let evidence = std::env::temp_dir().join(format!("deep-383-view-{}", std::process::id()));
    let doc = "01JB383V00000000000000000A";
    let rect = |id: &str, x: u32| {
        json!({"id": id, "kind": "rect@1", "layer": "alpha-main", "name": id, "order": "a1",
                "params": {"box": [x, 100, 40, 40]}})
    };
    let seed = json!({
        "format": 1, "profile": "board", "title": "View", "size": [640, 360],
        "description": "A shared board an agent adds boxes to, scrubbed and compared.",
        "layers": {"alpha-main": {"writer": "agent:t", "title": "Alpha", "order": "a1"}},
        "items": {"a": rect("a", 20)},
    });
    let add = |id: &str, n: u32, x: u32, base: u32| {
        json!({"call": "deep_show", "session": "s", "doc": doc, "patch": {
            "patch": format!("01JB383V0000000000000000P{n}"), "doc": doc, "base": base,
            "reason": "add a box", "ops": [{"op": "create", "item": rect(id, x)}],
        }})
    };
    // A 60 Hz clock with no lead: frame k presents at k × 11,760,000 flicks.
    const FRAME: i64 = 11_760_000;
    let event = |t: i64, e: Value| json!({"call": "input", "panel": "main", "at": t, "event": e});
    let control =
        |t: i64, c: &str, v: Value| event(t, json!({"type": "control", "control": c, "value": v}));
    // Box c, which only revision 2 holds, sits at page (200, 100) to (240, 140); the default
    // camera shows the 640 u page across the 800 px panel, so its centre (220, 120) is at
    // panel px (275, 225).
    let on_c = [275.0, 225.0];
    let click = |t: i64| {
        [
            event(t, json!({"type": "down", "pos": on_c})),
            event(t + 1, json!({"type": "up", "pos": on_c})),
        ]
    };
    let mut calls = vec![
        json!({"call": "scope", "panel": "main", "at": 0}),
        add("b", 1, 100, 0),
        add("c", 2, 200, 1),
    ];
    calls[1]["at"] = json!(10 * FRAME);
    calls[2]["at"] = json!(20 * FRAME);
    calls.push(control(30 * FRAME, "time", json!(15 * FRAME)));
    calls.extend(click(31 * FRAME));
    calls.push(control(40 * FRAME, "time", Value::Null));
    calls.extend(click(41 * FRAME));
    calls.push(control(50 * FRAME, "compare", json!(0)));
    calls.push(control(51 * FRAME, "lens", json!("changed")));
    calls.push(json!({"call": "presented", "panel": "main", "at": 60 * FRAME}));
    calls.push(json!({"call": "revisions", "doc": doc, "at": 61 * FRAME}));
    calls.push(json!({"call": "view", "panel": "main", "at": 62 * FRAME}));
    calls.push(control(
        63 * FRAME,
        "filter",
        json!({"writers": ["agent:t"]}),
    ));
    calls.push(json!({"call": "view", "panel": "main", "at": 64 * FRAME}));
    calls.push(json!({"call": "revisions", "doc": doc, "at": 65 * FRAME}));
    let scenario = json!({
        "evidence": evidence.to_string_lossy(),
        "sessions": {"s": {"thread": "t", "name": "Claude Code: t", "process": {"pid": 4100, "start": 1000}}},
        "processes": [{"pid": 1, "ppid": 0, "start": 0}],
        "panels": {"main": {"rect": [0, 0, 800, 600]}},
        "docs": {doc: {"panel": "main", "document": seed}},
        "clock": {"refresh_hz": 60, "lead": 0, "check": 5},
        "calls": calls,
    });
    let out = answer("run", &startup, &scenario.to_string());
    let _ = std::fs::remove_dir_all(&evidence);
    let r = &out["replies"];
    assert_eq!(out["ok"], json!(true), "{out}");
    // Scrubbed to between the two patches, the view shows revision 1, which has no c, so a
    // click where c is selects nothing; live again, the same click selects c. Each control
    // committed once.
    assert_eq!(r[3]["state"]["view"]["time"], json!(15 * FRAME));
    assert_eq!(r[3]["commits"].as_array().map(Vec::len), Some(1));
    assert_eq!(r[5]["state"]["selection"], json!([]));
    assert_eq!(r[8]["state"]["selection"], json!(["c"]));
    // Live again, then compared with revision 0: b and c were added, a is the same.
    assert_eq!(
        r[9]["state"]["changed"],
        json!({"b": "added", "c": "added"})
    );
    let key = &r[10]["state"]["lens"]["key"];
    assert_eq!(key["a"], json!("same"));
    assert_eq!(key["c"], json!("added"));
    // The frames drew revision 2 live, went back to revision 1 while scrubbed, and returned.
    let revs: Vec<u64> = r[11]["frames"]
        .as_array()
        .expect("frames")
        .iter()
        .filter_map(|f| f["rev"].as_u64())
        .collect();
    let back = revs
        .iter()
        .position(|&v| v == 2)
        .expect("revision 2 is drawn");
    assert!(
        revs[back..].contains(&1),
        "the scrubbed view draws revision 1 again: {revs:?}"
    );
    assert_eq!(revs.last(), Some(&2), "and the live one after: {revs:?}");
    let before: Vec<&Value> = r[11]["frames"]
        .as_array()
        .expect("frames")
        .iter()
        .filter_map(|f| f.get("before"))
        .collect();
    assert_eq!(
        before.last(),
        Some(&&json!(0)),
        "a comparing frame names its before"
    );
    // No view control wrote a revision: the board still has its three.
    assert_eq!(r[12]["revisions"].as_array().map(Vec::len), Some(3));
    // The view drawn: under the changed lens, then with the agent's boxes filtered out, a
    // different picture of the same three revisions.
    let snap = |i: usize| r[i]["snapshot"]["sha256"].as_str().map(str::to_string);
    assert!(snap(13).is_some(), "the view is drawn: {}", r[13]);
    assert_ne!(
        snap(13),
        snap(15),
        "hiding the agent's boxes changes the picture"
    );
    assert_eq!(r[16]["revisions"].as_array().map(Vec::len), Some(3));
}

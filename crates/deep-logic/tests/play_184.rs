//! #184: a piece played headless with a bot's entries (`deep_logic::play`), on the grid maze the
//! playtest's kit uses: a token moved one cell per arrow press, `won` set at the exit. The maze's
//! programs and its twins are written to `packages/checks/playtest/fixtures` with
//! `DEEP_184_WRITE=1 cargo test -p deep-logic --test play_184 fixtures`.

use std::collections::BTreeMap;

use deep_canvas_sandbox::rewrite;
use deep_logic::play::{play, Plants};
use serde_json::{json, Value};

/// The maze, row by row from y 0: `.` open, `#` wall, `E` the exit; the token starts at (0, 0).
/// Its one shortest route passes (3, 4).
const MAZE: [&str; 8] = [
    "....#.#.", "###.#.#.", "......#.", ".####.#.", "......#.", "###.###.", "........", ".######E",
];
/// The walled twin: the exit's two neighbours are walls.
const WALLED: [&str; 8] = [
    "....#.#.", "###.#.#.", "......#.", ".####.#.", "......#.", "###.###.", "......#.", ".######E",
];
/// The shortest route, 0 north, 1 east, 2 south, 3 west.
const ROUTE: [u8; 18] = [1, 1, 1, 2, 2, 1, 1, 2, 2, 3, 3, 2, 2, 1, 1, 1, 1, 2];

#[derive(Default, Clone, Copy)]
struct Twin {
    walled: bool,
    stuck_at: Option<(i32, i32)>,
    trap_at_press: Option<i32>,
    burn: u32,
}

fn grid(rows: &[&str; 8]) -> String {
    rows.iter()
        .flat_map(|r| r.chars())
        .map(|c| match c {
            '#' => "\\01",
            'E' => "\\02",
            _ => "\\00",
        })
        .collect()
}

/// The maze's program: reads `arrow` (a number control, 0..3 a press each) at 1024 and writes
/// `pos` (x, y), `won` and `presses`.
fn maze_wat(t: Twin) -> String {
    let data = grid(if t.walled { &WALLED } else { &MAZE });
    let trap = t.trap_at_press.map_or(String::new(), |n| {
        format!("(if (i32.eq (global.get $presses) (i32.const {n})) (then (drop (i32.div_s (i32.const 1) (global.get $zero)))))")
    });
    let mv = "(call $move (i32.trunc_f64_s (f64.load (i32.add (i32.const 1040) (i32.mul (local.get $j) (i32.const 16))))))";
    let guarded = match t.stuck_at {
        Some((x, y)) => format!(
            "(if (i32.and (i32.eq (global.get $x) (i32.const {x})) (i32.eq (global.get $y) (i32.const {y}))) (then) (else {mv}))"
        ),
        None => mv.to_string(),
    };
    let burn = if t.burn == 0 {
        String::new()
    } else {
        format!(
            "(local.set $i (i32.const 0)) (loop $b (local.set $i (i32.add (local.get $i) (i32.const 1))) (br_if $b (i32.lt_u (local.get $i) (i32.const {}))))",
            t.burn
        )
    };
    format!(
        r#"(module
  (memory (export "memory") 1 1)
  (global (export "reads_at") i32 (i32.const 1024))
  (global (export "writes_at") i32 (i32.const 2048))
  (data (i32.const 0) "{data}")
  (global $x (mut i32) (i32.const 0))
  (global $y (mut i32) (i32.const 0))
  (global $won (mut i32) (i32.const 0))
  (global $presses (mut i32) (i32.const 0))
  (global $zero (mut i32) (i32.const 0))
  (func (export "init") (param $seed i64))
  (func $move (param $d i32)
    (local $nx i32) (local $ny i32) (local $c i32)
    (local.set $nx (global.get $x))
    (local.set $ny (global.get $y))
    (if (i32.eq (local.get $d) (i32.const 0)) (then (local.set $ny (i32.sub (local.get $ny) (i32.const 1)))))
    (if (i32.eq (local.get $d) (i32.const 1)) (then (local.set $nx (i32.add (local.get $nx) (i32.const 1)))))
    (if (i32.eq (local.get $d) (i32.const 2)) (then (local.set $ny (i32.add (local.get $ny) (i32.const 1)))))
    (if (i32.eq (local.get $d) (i32.const 3)) (then (local.set $nx (i32.sub (local.get $nx) (i32.const 1)))))
    (if (i32.ge_u (local.get $nx) (i32.const 8)) (then (return)))
    (if (i32.ge_u (local.get $ny) (i32.const 8)) (then (return)))
    (local.set $c (i32.load8_u (i32.add (i32.mul (local.get $ny) (i32.const 8)) (local.get $nx))))
    (if (i32.eq (local.get $c) (i32.const 1)) (then (return)))
    (global.set $x (local.get $nx))
    (global.set $y (local.get $ny))
    (if (i32.eq (local.get $c) (i32.const 2)) (then (global.set $won (i32.const 1)))))
  (func (export "step") (param $k i64)
    (local $n i32) (local $j i32) (local $i i32)
    (local.set $n (i32.load (i32.const 1024)))
    (block $done (loop $each
      (br_if $done (i32.ge_u (local.get $j) (local.get $n)))
      (global.set $presses (i32.add (global.get $presses) (i32.const 1)))
      {trap}
      (if (i32.eqz (global.get $won)) (then {guarded}))
      (local.set $j (i32.add (local.get $j) (i32.const 1)))
      (br $each)))
    {burn}
    (i32.store (i32.const 2048) (global.get $x))
    (i32.store (i32.const 2052) (global.get $y))
    (i32.store (i32.const 2056) (global.get $won))
    (i32.store (i32.const 2064) (global.get $presses))))
"#
    )
}

/// The shortest-route bot: reads `maze.pos` at 1024 and plays `arrow` (value, serial) at 2048,
/// a new serial for the route's next press once the token has moved.
fn bot_wat() -> String {
    let route: String = ROUTE.iter().map(|d| format!("\\{d:02x}")).collect();
    format!(
        r#"(module
  (memory (export "memory") 1 1)
  (global (export "reads_at") i32 (i32.const 1024))
  (global (export "writes_at") i32 (i32.const 2048))
  (data (i32.const 0) "{route}")
  (global $idx (mut i32) (i32.const 0))
  (global $serial (mut i32) (i32.const 0))
  (global $lx (mut i32) (i32.const 0))
  (global $ly (mut i32) (i32.const 0))
  (func (export "init") (param $seed i64))
  (func (export "step") (param $k i64)
    (local $x i32) (local $y i32)
    (local.set $x (i32.load (i32.const 1024)))
    (local.set $y (i32.load (i32.const 1028)))
    (if (i32.eqz (global.get $serial))
      (then (global.set $serial (i32.const 1)) (global.set $lx (local.get $x)) (global.set $ly (local.get $y)))
      (else (if (i32.or (i32.ne (local.get $x) (global.get $lx)) (i32.ne (local.get $y) (global.get $ly)))
        (then
          (global.set $lx (local.get $x))
          (global.set $ly (local.get $y))
          (global.set $idx (i32.add (global.get $idx) (i32.const 1)))
          (if (i32.lt_u (global.get $idx) (i32.const {len})) (then (global.set $serial (i32.add (global.get $serial) (i32.const 1)))))))))
    (f64.store (i32.const 2048) (f64.convert_i32_u (i32.load8_u (global.get $idx))))
    (f64.store (i32.const 2056) (f64.convert_i32_u (global.get $serial)))))
"#,
        len = ROUTE.len()
    )
}

struct Built {
    piece: Value,
    assets: BTreeMap<String, Vec<u8>>,
    bot: String,
}

fn build(t: Twin, rate: u32, fuel: u64) -> Built {
    let program = wat::parse_str(maze_wat(t)).expect("the maze assembles");
    let bot = wat::parse_str(bot_wat()).expect("the bot assembles");
    let (sha, bot_sha) = (rewrite::hash(&program), rewrite::hash(&bot));
    let params = json!({"program": sha, "step_rate": rate, "reads": ["arrow"], "budget": {"fuel": fuel},
                        "writes": {"pos": {"type": "i32", "count": 2}, "won": {"type": "i32"}, "presses": {"type": "i32"}}});
    let piece = json!({"seed": 7, "controls": {"arrow": {"kind": "slider", "range": [0, 3], "increment": 1, "default": 0}},
                       "items": {"maze": {"kind": "logic@1", "params": params}}});
    let assets = BTreeMap::from([(sha, program), (bot_sha.clone(), bot)]);
    Built {
        piece,
        assets,
        bot: bot_sha,
    }
}

fn run(b: &Built, call: Value, plants: Plants) -> Value {
    let stored = |sha: &str| b.assets.get(sha).cloned();
    play(&b.piece, &stored, &call, plants, &mut |_, _| None)
        .unwrap_or_else(|e| panic!("a play: {e}"))
}

fn logic_bot(b: &Built) -> Value {
    json!({"logic": {"program": b.bot, "reads": ["maze.pos"], "plays": {"press": "arrow"}}})
}

fn won_at(r: &Value) -> Option<usize> {
    r["values"]["maze.won"]
        .as_array()?
        .iter()
        .position(|v| v[0] == 1)
}

#[test]
fn the_logic_bot_walks_the_route_and_the_track_replays() {
    let b = build(Twin::default(), 60, 1_000_000);
    let started = std::time::Instant::now();
    let r = run(
        &b,
        json!({"seed": 11, "span": 120, "bot": logic_bot(&b), "values": ["maze.pos", "maze.won"]}),
        Plants::default(),
    );
    let played = started.elapsed();
    assert_eq!(r["steps"], 7200);
    assert!(won_at(&r).is_some(), "the bot reaches the exit");
    assert_eq!(
        r["entries"].as_array().unwrap().len(),
        ROUTE.len(),
        "one entry a press"
    );
    assert!(r["trap"].is_null() && r["bot_trap"].is_null());
    let ceiling = r["ceilings"]["maze"].as_i64().unwrap();
    assert!(r["fuel"]["maze"]
        .as_array()
        .unwrap()
        .iter()
        .all(|f| f.as_i64().unwrap() <= ceiling));
    let started = std::time::Instant::now();
    let again = run(
        &b,
        json!({"seed": 11, "span": 120, "track": r["entries"], "values": ["maze.pos", "maze.won"]}),
        Plants::default(),
    );
    let replayed = started.elapsed();
    assert_eq!(again["track"], r["track"]);
    assert_eq!(again["checkpoints"], r["checkpoints"]);
    assert_eq!(again["final"], r["final"]);
    assert_eq!(again["values"], r["values"]);
    assert!(r["checkpoints"].as_array().unwrap().len() >= 100);
    eprintln!("7,200 steps: played in {played:?} with its bot, replayed in {replayed:?}");
}

#[test]
fn a_policy_presses_seeded_arrows_and_names_an_undeclared_control() {
    let b = build(Twin::default(), 60, 1_000_000);
    let policy = json!({"policy": {"pick": {"arrow": {"from": [0, 1, 2, 3], "every": 0.25}}}});
    let one = run(
        &b,
        json!({"seed": 5, "span": 120, "bot": policy, "values": ["maze.pos"]}),
        Plants::default(),
    );
    let two = run(
        &b,
        json!({"seed": 5, "span": 120, "bot": policy, "values": ["maze.pos"]}),
        Plants::default(),
    );
    let other = run(
        &b,
        json!({"seed": 6, "span": 120, "bot": policy, "values": ["maze.pos"]}),
        Plants::default(),
    );
    assert_eq!(one["entries"].as_array().unwrap().len(), 480);
    assert_eq!(one["track"], two["track"]);
    assert_ne!(one["track"], other["track"]);
    let stored = |sha: &str| b.assets.get(sha).cloned();
    let bad = json!({"policy": {"pick": {"jump": {"from": [1]}}}});
    let e = play(
        &b.piece,
        &stored,
        &json!({"seed": 5, "bot": bad}),
        Plants::default(),
        &mut |_, _| None,
    )
    .unwrap_err();
    assert_eq!(e["code"], "control_undeclared");
    assert_eq!(e["control"], "jump");
}

#[test]
fn twins_stick_trap_and_pass_the_ceiling() {
    let stuck = build(
        Twin {
            stuck_at: Some((3, 4)),
            ..Default::default()
        },
        60,
        1_000_000,
    );
    let r = run(
        &stuck,
        json!({"seed": 1, "span": 30, "bot": logic_bot(&stuck), "values": ["maze.pos", "maze.won"]}),
        Plants::default(),
    );
    assert!(won_at(&r).is_none());
    let pos = r["values"]["maze.pos"].as_array().unwrap();
    assert_eq!(pos.last().unwrap(), &json!([3, 4]));

    let trap = build(
        Twin {
            trap_at_press: Some(40),
            ..Default::default()
        },
        60,
        1_000_000,
    );
    let policy = json!({"policy": {"pick": {"arrow": {"from": [0, 1, 2, 3], "every": 0.25}}}});
    let r = run(
        &trap,
        json!({"seed": 1, "span": 120, "bot": policy, "values": ["maze.presses"]}),
        Plants::default(),
    );
    assert_eq!(r["trap"]["item"], "maze");
    assert!(!r["trap"]["inputs"].as_array().unwrap().is_empty());

    let busy = build(
        Twin {
            burn: 1_125_000,
            ..Default::default()
        },
        240,
        10_000_000,
    );
    let r = run(
        &busy,
        json!({"seed": 1, "span": {"steps": 4}, "bot": logic_bot(&busy)}),
        Plants::default(),
    );
    assert_eq!(r["ceilings"]["maze"], 3_000_000);
    assert_eq!(r["fuel"]["maze"][0], 9_000_026, "{}", r["fuel"]);
}

#[test]
fn a_bot_entry_is_a_new_serial_and_a_planted_replica_drops_one() {
    let b = build(Twin::default(), 60, 1_000_000);
    let r = run(
        &b,
        json!({"seed": 1, "span": 2, "bot": logic_bot(&b)}),
        Plants {
            drops_first_bot_entry: true,
            ..Default::default()
        },
    );
    let again = run(
        &b,
        json!({"seed": 1, "span": 2, "track": r["entries"]}),
        Plants::default(),
    );
    assert_ne!(
        again["final"], r["final"],
        "the dropped entry changes the replay"
    );
}

#[test]
fn fixtures() {
    let Ok(dir) = std::env::var("DEEP_184_WRITE") else {
        return;
    };
    let dir = if dir == "1" {
        "../../packages/checks/playtest/fixtures".to_string()
    } else {
        dir
    };
    std::fs::create_dir_all(&dir).expect("the fixtures folder");
    let twins = [
        ("maze", Twin::default()),
        (
            "maze-stuck",
            Twin {
                stuck_at: Some((3, 4)),
                ..Default::default()
            },
        ),
        (
            "maze-walled",
            Twin {
                walled: true,
                ..Default::default()
            },
        ),
        (
            "maze-trap",
            Twin {
                trap_at_press: Some(40),
                ..Default::default()
            },
        ),
        (
            "maze-busy",
            Twin {
                burn: 1_125_000,
                ..Default::default()
            },
        ),
    ];
    for (name, t) in twins {
        let wat = maze_wat(t);
        std::fs::write(format!("{dir}/{name}.wat"), &wat).unwrap();
        std::fs::write(format!("{dir}/{name}.wasm"), wat::parse_str(&wat).unwrap()).unwrap();
    }
    let wat = bot_wat();
    std::fs::write(format!("{dir}/route-bot.wat"), &wat).unwrap();
    std::fs::write(
        format!("{dir}/route-bot.wasm"),
        wat::parse_str(&wat).unwrap(),
    )
    .unwrap();
}

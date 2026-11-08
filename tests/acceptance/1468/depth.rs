//! Acceptance tests for #1468: a deep expression is refused instead of crashing the process, since the parser's
//! nesting has a cap of 64 levels (canvas primitives: The closed function list). Written blind from the issue, the
//! design and the base (README.md).
//!
//! A stack overflow aborts the whole process, which no test can catch, so every expression the base might crash on
//! runs in a child: this test binary re-executed with `--ignored --exact child_entry` and the case named in
//! `ACCEPTANCE_1468_CASE`. The child runs the case on a thread with a 1 MB stack, times the compile call alone, and
//! prints one `RESULT <json>` line; the parent judges the child's exit (a signal or a non-zero exit fails) and that
//! line. AC4's driver goes through the real `deep-motion eval` binary instead, a process of its own.

use std::io::Write;
use std::os::unix::process::ExitStatusExt;
use std::process::{Command, Output, Stdio};
use std::sync::Arc;
use std::time::{Duration, Instant};

use deep_canvas::document::{PackPlanted, Packs};
use deep_canvas::expr::{Expr, Nothing, V};
use deep_canvas_marks::animator::{self, Host, Input, Plant};
use serde_json::{json, Value};

const AC1: &str = "AC1 #1468.ded1c18b";
const AC2: &str = "AC2 #1468.a5827afe";
const AC3: &str = "AC3 #1468.ba3528c4";
const AC4: &str = "AC4 #1468.b22b517b";

/// The cap the issue and the design name.
const CAP: usize = 64;
/// AC1's repeat count.
const MILLION: usize = 1_000_000;
/// AC1's budget for one refusal, timed around the compile call in the child.
const BUDGET: Duration = Duration::from_millis(50);
/// The stack the child runs each case on (AC2's "1 MB thread"; the same for every case).
const STACK: usize = 1 << 20;
/// The node cap the direct compiles pass: a field's (256), so depth 64 of every opener fits under it.
const NODES: usize = 256;
/// A child that runs this long has hung; it is killed by its own PID and fails.
const CHILD_LIMIT: Duration = Duration::from_secs(300);
const ENV: &str = "ACCEPTANCE_1468_CASE";

// ---- the expressions

/// `opener` n times around 1, as a well-formed expression: parens and calls closed, a conditional's last arm 1,
/// carets n of them between n + 1 ones (README: How each criterion is read).
fn nested(opener: &str, n: usize) -> String {
    match opener {
        "(" => format!("{}1{}", "(".repeat(n), ")".repeat(n)),
        "abs(" => format!("{}1{}", "abs(".repeat(n), ")".repeat(n)),
        "-" | "+" | "!" | "x ? y : " => format!("{}1", opener.repeat(n)),
        "^" => vec!["1"; n + 1].join("^"),
        _ => panic!("no such opener {opener}"),
    }
}

/// AC1's five openers.
const AC1_OPENERS: [&str; 5] = ["(", "-", "!", "abs(", "x ? y : "];
/// AC2's: every recursive path the issue's scope names (parens, unary `-`, `+`, `!`, a call's argument, the
/// conditional and powers).
const AC2_OPENERS: [&str; 7] = ["(", "-", "+", "!", "abs(", "x ? y : ", "^"];

// ---- the child

/// The child-process entry, run only by the parent tests below (`--ignored --exact child_entry`); it is not a test of
/// its own, and with no case named it panics rather than pass.
#[test]
#[ignore = "the child-process entry the tests of this file run; never a test on its own"]
fn child_entry() {
    let case = std::env::var(ENV).expect("ACCEPTANCE_1468_CASE names the case");
    let out = std::thread::Builder::new()
        .name(format!("case {case}"))
        .stack_size(STACK)
        .spawn(move || run_case(&case))
        .expect("a 1 MB thread starts")
        .join()
        .unwrap_or_else(|_| json!({"panicked": true}));
    // On a line of its own: libtest prints the test's name on the same line first.
    println!("\nRESULT {out}");
}

fn run_case(case: &str) -> Value {
    let (kind, rest) = case.split_once(':').expect("a case is kind:arg");
    match kind {
        // compile:<opener>:<n>: the base's Expr::compile, timed alone, then evaluated when it compiles.
        "compile" => {
            let (opener, n) = rest.rsplit_once(':').expect("compile:<opener>:<n>");
            compile_case(&nested(opener, n.parse().expect("n")))
        }
        // power2:<terms>: `2^2^…^2`, AC3.
        "power2" => compile_case(&vec!["2"; rest.parse().expect("terms")].join("^")),
        // planted:<opener>:<n>: the planted parser with no cap, over the same string.
        "planted" => {
            let (opener, n) = rest.rsplit_once(':').expect("planted:<opener>:<n>");
            let text = nested(opener, n.parse().expect("n"));
            let t = Instant::now();
            let parsed = planted::parse(&text);
            let ms = t.elapsed().as_secs_f64() * 1e3;
            json!({"refused": parsed.is_err(), "ms": ms})
        }
        "field" => field_case(rest),
        "pack" => pack_case(rest),
        _ => panic!("no such case {case}"),
    }
}

fn compile_case(text: &str) -> Value {
    let t = Instant::now();
    let compiled = Expr::compile(text, &Nothing, NODES);
    let ms = t.elapsed().as_secs_f64() * 1e3;
    match compiled {
        Err(r) => {
            let call: String = r.call.chars().take(80).collect();
            json!({"refused": true, "ms": ms, "why": r.why, "call": call})
        }
        Ok(e) => {
            // x is 0 and y 2, so a conditional takes its last arm.
            let vars: Vec<V> = e
                .vars
                .iter()
                .map(|v| V::S(if v == "y" { 2.0 } else { 0.0 }))
                .collect();
            let value = e.eval(&vars).num();
            json!({"refused": false, "ms": ms, "value": value, "vars": e.vars})
        }
    }
}

/// A deep or shallow text the AC4 cases put in a document: 1,000,000 parens around `inner`, or one.
fn wrapped(deep: &str, inner: &str) -> String {
    let n = if deep == "deep" { MILLION } else { 1 };
    format!("{}{inner}{}", "(".repeat(n), ")".repeat(n))
}

struct Shaping(deep_text::Shaper);
impl Host for Shaping {
    fn shape(&mut self, text: &str) -> Arc<deep_text::Shaped> {
        self.0.shape(&deep_text::Spec::label(text))
    }
    fn counter_text(&mut self, _: f64) -> Result<Option<String>, deep_canvas_marks::scene::Refused> {
        Ok(None)
    }
}

/// AC4's field: a text item whose animator's field selector holds the string, laid out at t 0 the way the renderer
/// lays out an animated text (`deep_canvas_marks::animator::lay_out`).
fn field_case(deep: &str) -> Value {
    let expr = wrapped(deep, "i");
    let item = json!({
        "id": "words", "kind": "text@1", "layer": "main", "name": "Words", "order": "a0",
        "params": {"text": "ABCDE", "animators": [{
            "units": "grapheme", "props": {"y": 1},
            "selectors": [{"field": {"expr": expr}}],
        }]},
        "at": {"pos": [0, 0, 0]},
    });
    let doc = json!({"format": 1, "id": "field-1468", "items": {"words": item}});
    let Value::Object(doc) = doc else { unreachable!() };
    let items = doc["items"].as_object().expect("items").clone();
    let params = items["words"]["params"].as_object().expect("params").clone();
    let mut host = Shaping(deep_text::Shaper::new());
    let run = host.shape("ABCDE");
    let input = Input {
        id: "words",
        params: &params,
        run: &run,
        origin: [0.0, 0.0],
        t: 0,
        doc: &doc,
        items: &items,
        bound: false,
        plant: Plant::None,
    };
    match animator::lay_out(&input, &mut host) {
        Ok(_) => json!({"refused": false}),
        Err(r) => json!({"refused": true, "code": r.code, "path": r.path}),
    }
}

/// AC4's pack rule: a pack whose kind holds a rule over its input x, admitted by the pack check in the core build.
fn pack_case(deep: &str) -> Value {
    let rule = format!("{} >= 1", wrapped(deep, "x"));
    let manifest = json!({
        "id": "test/deeprule", "name": "deeprule", "version": "1.0.0", "license": "MIT",
        "description": "The #1468 acceptance suite's pack: one kind whose rule holds the string under test.",
        "requires": {"core": ">=0.0.0"},
        "recipes": {"deeprule.probe@1": {
            "id": "deeprule.probe", "version": "1.0", "title": "Deep rule probe", "license": "MIT",
            "author": "the #1468 acceptance suite", "description": "A square whose rule reads x.",
            "inputs": {"x": {"type": "number", "default": 1, "min": 0, "max": 2, "about": "what the rule reads"}},
            "steps": {"dot": {"op": "mark", "kind": "rect@1", "params": {"box": [0, 0, 4, 4], "paint": {"fill": {"role": "ink"}}}}},
            "outputs": {"parts": ["dot"]},
            "rules": [{"code": "deeprule.holds", "expr": rule, "at": "rest", "fix": "set x to 1 or more"}],
            "twins": [{"params": {"x": 0}, "expect": "deeprule.holds"}],
        }},
    });
    let sealed = deep_canvas::registry::core();
    let mut packs = Packs::new(PackPlanted::default());
    match packs.admit(&manifest, &sealed) {
        Ok(_) => json!({"refused": false}),
        Err(issues) => {
            let issues: Vec<Value> = issues
                .iter()
                .map(|i| {
                    let what: String = i.what.chars().take(200).collect();
                    json!({"code": i.code, "path": i.path, "what": what})
                })
                .collect();
            json!({"refused": true, "issues": issues})
        }
    }
}

// ---- the parent's harness

/// Runs `cmd` with `stdin` written and closed, killing it by its own PID past the limit.
fn run_bounded(mut cmd: Command, stdin: &[u8]) -> Output {
    let mut child = cmd
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .expect("the child starts");
    let mut input = child.stdin.take().expect("stdin");
    let bytes = stdin.to_vec();
    let writer = std::thread::spawn(move || {
        let _ = input.write_all(&bytes);
    });
    let id = child.id();
    let start = Instant::now();
    let done = Arc::new(std::sync::atomic::AtomicBool::new(false));
    let watch = {
        let done = done.clone();
        std::thread::spawn(move || {
            while !done.load(std::sync::atomic::Ordering::SeqCst) {
                if start.elapsed() > CHILD_LIMIT {
                    // Only this child, by its PID.
                    let _ = Command::new("kill").arg("-KILL").arg(id.to_string()).status();
                    return;
                }
                std::thread::sleep(Duration::from_millis(100));
            }
        })
    };
    let out = child.wait_with_output().expect("the child's output");
    done.store(true, std::sync::atomic::Ordering::SeqCst);
    let _ = watch.join();
    let _ = writer.join();
    out
}

/// What a child's exit says: `Err` for a signal or a non-zero exit, else its stdout.
fn exited(out: &Output, what: &str) -> Result<String, String> {
    let stdout = String::from_utf8_lossy(&out.stdout).into_owned();
    let stderr = String::from_utf8_lossy(&out.stderr);
    let tail: String = stderr.lines().rev().take(4).collect::<Vec<_>>().into_iter().rev().collect::<Vec<_>>().join(" | ");
    if let Some(sig) = out.status.signal() {
        return Err(format!("{what}: the process died by signal {sig}; stderr: {tail}"));
    }
    if !out.status.success() {
        return Err(format!("{what}: the process exited {:?}; stderr: {tail}", out.status.code()));
    }
    Ok(stdout)
}

/// Runs one case in a child and returns its result, or why the child failed.
fn judge(case: &str) -> Result<Value, String> {
    let mut cmd = Command::new(std::env::current_exe().expect("this test binary"));
    cmd.args(["--ignored", "--exact", "child_entry", "--nocapture", "--test-threads=1"])
        .env(ENV, case);
    let out = run_bounded(cmd, b"");
    let stdout = exited(&out, &format!("case {case}"))?;
    let line = stdout
        .lines()
        .find_map(|l| l.split_once("RESULT ").map(|(_, r)| r))
        .ok_or_else(|| format!("case {case}: the child printed no result"))?;
    let v: Value = serde_json::from_str(line).map_err(|e| format!("case {case}: unreadable result {e}"))?;
    if v.get("panicked") == Some(&json!(true)) {
        return Err(format!("case {case}: the case panicked"));
    }
    Ok(v)
}

/// A refusal within the budget, or why not.
fn refused_in_budget(case: &str) -> Result<Value, String> {
    let v = judge(case)?;
    if v["refused"] != json!(true) {
        return Err(format!("case {case}: no refusal: {v}"));
    }
    let ms = v["ms"].as_f64().unwrap_or(f64::INFINITY);
    if ms >= BUDGET.as_secs_f64() * 1e3 {
        return Err(format!("case {case}: refused in {ms:.1} ms, not under 50 ms"));
    }
    Ok(v)
}

/// A refusal whose reason names the cap (64), or why not.
fn refused_naming_cap(case: &str) -> Result<Value, String> {
    let v = judge(case)?;
    if v["refused"] != json!(true) {
        return Err(format!("case {case}: no refusal: {v}"));
    }
    let why = v["why"].as_str().unwrap_or_default();
    if !names_number(why, CAP) {
        return Err(format!("case {case}: the reason `{why}` doesn't name the cap {CAP}"));
    }
    Ok(v)
}

/// Whether `text` holds `n` as a whole number (not inside a longer one).
fn names_number(text: &str, n: usize) -> bool {
    let n = n.to_string();
    let b = text.as_bytes();
    text.match_indices(&n).any(|(i, _)| {
        let before = i == 0 || !b[i - 1].is_ascii_digit();
        let after = b.get(i + n.len()).is_none_or(|c| !c.is_ascii_digit());
        before && after
    })
}

fn verdict(fails: &[String], what: &str) {
    assert!(fails.is_empty(), "{what}: {} case(s) failed:\n  {}", fails.len(), fails.join("\n  "));
}

// ---- AC1

#[test]
fn ac1_a_million_repeats_of_each_opener_are_refused_in_under_50_ms_in_a_child() {
    let fails: Vec<String> = AC1_OPENERS
        .iter()
        .filter_map(|o| refused_in_budget(&format!("compile:{o}:{MILLION}")).err())
        .collect();
    verdict(&fails, &format!("{AC1} 1,000,000 repeats each of `(`, `-`, `!`, `abs(` and `x ? y : `, refused in under 50 ms"));
}

#[test]
fn ac1_a_planted_parser_with_no_cap_dies_by_signal_and_fails() {
    let mut fails = Vec::new();
    for o in AC1_OPENERS {
        let case = format!("planted:{o}:{MILLION}");
        match refused_in_budget(&case) {
            Ok(v) => fails.push(format!("the harness passed the planted parser on `{o}`: {v}")),
            Err(e) if !e.contains("died by signal") => {
                fails.push(format!("the planted parser on `{o}` failed, but not by dying by signal: {e}"))
            }
            Err(_) => {}
        }
    }
    verdict(&fails, &format!("{AC1} the harness fails a planted parser with no cap, which dies by signal"));
}

// ---- AC2

#[test]
fn ac2_depth_64_parses_and_evaluates_on_a_1_mb_thread() {
    let mut fails = Vec::new();
    for o in AC2_OPENERS {
        let case = format!("compile:{o}:{CAP}");
        match judge(&case) {
            Err(e) => fails.push(e),
            Ok(v) if v["refused"] != json!(false) => fails.push(format!("case {case}: refused: {v}")),
            // Every opener's depth-64 expression is 1: an even count of `-` and `!`, the conditional's last arm,
            // 1 raised to 1.
            Ok(v) if v["value"].as_f64() != Some(1.0) => fails.push(format!("case {case}: evaluates to {}, not 1", v["value"])),
            Ok(_) => {}
        }
    }
    verdict(&fails, &format!("{AC2} depth 64 parses and evaluates on a 1 MB thread"));
}

#[test]
fn ac2_depth_65_is_refused_naming_the_cap() {
    let fails: Vec<String> = AC2_OPENERS
        .iter()
        .filter_map(|o| refused_naming_cap(&format!("compile:{o}:{}", CAP + 1)).err())
        .collect();
    verdict(&fails, &format!("{AC2} depth 65 is refused with a reason naming the cap 64"));
}

// ---- AC3

#[test]
fn ac3_a_power_tower_of_10000_terms_is_refused_naming_the_cap() {
    let fails: Vec<String> = refused_naming_cap("power2:10000").err().into_iter().collect();
    verdict(&fails, &format!("{AC3} `2^2^2…` at 10,000 terms is refused with a reason naming the cap 64"));
}

// ---- AC4

const MOTION: &str = env!("CARGO_BIN_EXE_deep-motion");

/// One `deep-motion eval` of a film whose driver `deep` writes `items/dot/at/pos/1` with `expr`.
fn motion_eval(expr: &str) -> Result<Value, String> {
    let dot = json!({"id": "dot", "kind": "rect@1", "layer": "main", "name": "Rect dot", "order": "adot",
        "params": {"box": [0, 0, 20, 20], "paint": {"fill": {"role": "ink"}}}, "at": {"pos": [0, 0, 0]}});
    let doc = json!({
        "format": 1, "id": "driver-1468", "profile": "film", "title": "#1468 driver",
        "description": "The #1468 acceptance tests' document with one driver.", "size": [640, 360],
        "layers": {"main": {"writer": "agent-a", "title": "Main", "order": "a0"}},
        "transport": {"span": "4s"}, "items": {"dot": dot},
        "drivers": {"deep": {"target": "items/dot/at/pos/1", "expr": expr, "vars": {}}},
    });
    let mut line = serde_json::to_vec(&json!({"doc": doc, "times": [0]})).expect("JSON");
    line.push(b'\n');
    let mut cmd = Command::new(MOTION);
    cmd.arg("eval");
    let out = run_bounded(cmd, &line);
    let stdout = exited(&out, "deep-motion eval")?;
    let answer = stdout.lines().next().ok_or("deep-motion eval answered nothing")?;
    serde_json::from_str(answer).map_err(|e| format!("deep-motion eval's answer isn't JSON: {e}"))
}

/// Whether a refusal's path names `want` (as the path itself or inside it).
fn path_names(path: &str, want: &str) -> bool {
    path.trim_start_matches('/').contains(want)
}

#[test]
fn ac4_a_driver_holding_the_string_is_refused_naming_its_path_and_the_process_stays_up() {
    let mut fails = Vec::new();
    match motion_eval(&wrapped("shallow", "1")) {
        Ok(a) if a["ok"] == json!(true) => {}
        other => fails.push(format!("the twin, the same driver with `(1)`, is accepted: {other:?}")),
    }
    match motion_eval(&wrapped("deep", "1")) {
        Err(e) => fails.push(e),
        Ok(a) => {
            let path = a["path"].as_str().unwrap_or_default();
            if a["ok"] != json!(false) || !path_names(path, "drivers/deep/expr") {
                let short: String = a.to_string().chars().take(300).collect();
                fails.push(format!("the answer is a refusal naming drivers/deep/expr: {short}"));
            }
        }
    }
    verdict(&fails, &format!("{AC4} a driver holding 1,000,000 nested parens, through deep-motion eval"));
}

#[test]
fn ac4_a_field_holding_the_string_is_refused_naming_its_path_and_the_process_stays_up() {
    let mut fails = Vec::new();
    match judge("field:shallow") {
        Ok(v) if v["refused"] == json!(false) => {}
        other => fails.push(format!("the twin, the same field with `(i)`, lays out: {other:?}")),
    }
    let want = "items/words/params/animators/0/selectors/0/field/expr";
    match judge("field:deep") {
        Err(e) => fails.push(e),
        Ok(v) => {
            if v["refused"] != json!(true) || !path_names(v["path"].as_str().unwrap_or_default(), want) {
                fails.push(format!("the layout is refused naming {want}: {v}"));
            }
        }
    }
    verdict(&fails, &format!("{AC4} a text animator's field holding 1,000,000 nested parens, laid out in a child"));
}

#[test]
fn ac4_a_pack_rule_holding_the_string_is_refused_naming_its_path_and_the_process_stays_up() {
    let mut fails = Vec::new();
    match judge("pack:shallow") {
        Ok(v) if v["refused"] == json!(false) => {}
        other => fails.push(format!("the twin, the same rule with `(x) >= 1`, is admitted: {other:?}")),
    }
    let want = "recipes/deeprule.probe@1/rules/0/expr";
    match judge("pack:deep") {
        Err(e) => fails.push(e),
        Ok(v) => {
            let named = v["issues"]
                .as_array()
                .is_some_and(|l| l.iter().any(|i| path_names(i["path"].as_str().unwrap_or_default(), want)));
            if v["refused"] != json!(true) || !named {
                fails.push(format!("the pack check refuses naming {want}: {v}"));
            }
        }
    }
    verdict(&fails, &format!("{AC4} a pack's kind rule holding 1,000,000 nested parens, through the pack check in a child"));
}

// ---- the planted parser

/// The planted wrong program AC1 names: a recursive-descent parser over the same openers with no depth cap, so a
/// million of them overflow its stack. It must die by signal and the harness must fail it.
mod planted {
    #[allow(dead_code)]
    pub enum P {
        One,
        Name,
        Neg(Box<P>),
        Not(Box<P>),
        Call(Box<P>),
        If(Box<P>, Box<P>, Box<P>),
        Pow(Box<P>, Box<P>),
    }

    pub fn parse(text: &str) -> Result<P, String> {
        let b: Vec<u8> = text.bytes().filter(|c| *c != b' ').collect();
        let mut at = 0;
        let p = expr(&b, &mut at)?;
        if at == b.len() {
            Ok(p)
        } else {
            Err(format!("trailing text at {at}"))
        }
    }

    fn expr(b: &[u8], at: &mut usize) -> Result<P, String> {
        let c = power(b, at)?;
        if b.get(*at) == Some(&b'?') {
            *at += 1;
            let a = expr(b, at)?;
            if b.get(*at) != Some(&b':') {
                return Err("no `:`".into());
            }
            *at += 1;
            let e = expr(b, at)?;
            return Ok(P::If(Box::new(c), Box::new(a), Box::new(e)));
        }
        Ok(c)
    }

    fn power(b: &[u8], at: &mut usize) -> Result<P, String> {
        let base = unary(b, at)?;
        if b.get(*at) == Some(&b'^') {
            *at += 1;
            return Ok(P::Pow(Box::new(base), Box::new(power(b, at)?)));
        }
        Ok(base)
    }

    fn unary(b: &[u8], at: &mut usize) -> Result<P, String> {
        match b.get(*at) {
            Some(b'-') => {
                *at += 1;
                Ok(P::Neg(Box::new(unary(b, at)?)))
            }
            Some(b'+') => {
                *at += 1;
                unary(b, at)
            }
            Some(b'!') => {
                *at += 1;
                Ok(P::Not(Box::new(unary(b, at)?)))
            }
            Some(b'(') => {
                *at += 1;
                let e = expr(b, at)?;
                close(b, at)?;
                Ok(e)
            }
            Some(b'a') if b[*at..].starts_with(b"abs(") => {
                *at += 4;
                let e = expr(b, at)?;
                close(b, at)?;
                Ok(P::Call(Box::new(e)))
            }
            Some(b'1' | b'2') => {
                *at += 1;
                Ok(P::One)
            }
            Some(b'x' | b'y') => {
                *at += 1;
                Ok(P::Name)
            }
            _ => Err(format!("unexpected text at {at}")),
        }
    }

    fn close(b: &[u8], at: &mut usize) -> Result<(), String> {
        if b.get(*at) == Some(&b')') {
            *at += 1;
            Ok(())
        } else {
            Err("missing `)`".into())
        }
    }
}

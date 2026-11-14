//! Acceptance tests for #1468: a deep expression is refused instead of crashing the process; the parser's nesting
//! has a cap of 64 levels (canvas primitives: The closed function list). Written blind from the issue, the design and
//! the base commit (README.md).
//!
//! Every reading that could crash runs in a child process: this test binary run again with `DEEP_1468_CHILD` set,
//! which runs the ignored test `child` alone. The child does its work on a thread with a 1 MB stack and prints one
//! `RESULT <json>` line per step; the parent reads the child's exit, any signal it died by and those lines. A child
//! that dies by a signal fails the criterion, whatever the load. A timing taken while the one-minute load is at or
//! above half the cores reads INCONCLUSIVE: the test fails with a message starting `INCONCLUSIVE:`, never a pass.

use std::os::unix::process::ExitStatusExt;
use std::process::{Command, Stdio};
use std::time::Instant;

use deep_canvas::expr::{Expr, Nothing, Refusal, B, V};
use deep_canvas::interval::Iv;
use serde_json::{json, Value};

/// Each criterion's ID (scripts/proof-change.mjs: the first eight hex digits of the SHA-256 of its text).
const AC1: &str = "AC1 #1468.ded1c18b";
const AC2: &str = "AC2 #1468.a5827afe";
const AC3: &str = "AC3 #1468.ba3528c4";
const AC4: &str = "AC4 #1468.b22b517b";

/// The cap the issue and the design name.
const CAP: usize = 64;
/// AC1's repeats.
const REPEATS: usize = 1_000_000;
/// AC1's limit.
const LIMIT_MS: f64 = 50.0;
/// AC3's terms.
const POW_TERMS: usize = 10_000;
/// AC2's thread, and every child's.
const STACK: usize = 1 << 20;
/// A node cap no string here reaches, so a refusal is never the node cap's (it is also a path function's 512 for
/// the depth-64 and depth-65 strings, whose nodes are at most 196).
const NODES: usize = 512;
const BIG_NODES: usize = 1 << 24;
/// The environment variable that makes this binary a child.
const CHILD: &str = "DEEP_1468_CHILD";

// ---- the strings

#[derive(Clone, Copy, Debug, PartialEq)]
enum Construct {
    Paren,
    Minus,
    Not,
    Abs,
    Cond,
    Pow,
}

const FIVE: [Construct; 5] = [Construct::Paren, Construct::Minus, Construct::Not, Construct::Abs, Construct::Cond];
const SIX: [Construct; 6] =
    [Construct::Paren, Construct::Minus, Construct::Not, Construct::Abs, Construct::Cond, Construct::Pow];

impl Construct {
    fn key(self) -> &'static str {
        match self {
            Construct::Paren => "paren",
            Construct::Minus => "minus",
            Construct::Not => "not",
            Construct::Abs => "abs",
            Construct::Cond => "cond",
            Construct::Pow => "pow",
        }
    }

    fn of(key: &str) -> Construct {
        *SIX.iter().find(|c| c.key() == key).unwrap_or_else(|| panic!("no construct {key}"))
    }

    /// What repeats, as the issue writes it.
    fn label(self) -> &'static str {
        match self {
            Construct::Paren => "`(`",
            Construct::Minus => "`-`",
            Construct::Not => "`!`",
            Construct::Abs => "`abs(`",
            Construct::Cond => "`x ? y : `",
            Construct::Pow => "`^`",
        }
    }

    /// `n` levels of the construct around a leaf, well formed, so nothing but its depth can refuse it: `n` opening
    /// parens, a 1 and `n` closing ones; `n` minus signs or bangs before a 1; `n` `abs(` calls around a 1; `n`
    /// conditionals `x ? y : ` before a 1; and a chain of `n` carets, `1^1^…^1` (n + 1 terms).
    fn nest(self, n: usize) -> String {
        match self {
            Construct::Paren => format!("{}1{}", "(".repeat(n), ")".repeat(n)),
            Construct::Minus => format!("{}1", "-".repeat(n)),
            Construct::Not => format!("{}1", "!".repeat(n)),
            Construct::Abs => format!("{}1{}", "abs(".repeat(n), ")".repeat(n)),
            Construct::Cond => format!("{}1", "x ? y : ".repeat(n)),
            Construct::Pow => format!("1{}", "^1".repeat(n)),
        }
    }
}

/// `2^2^2…` at `terms` terms.
fn tower(terms: usize) -> String {
    let mut s = String::with_capacity(terms * 2);
    s.push('2');
    for _ in 1..terms {
        s.push_str("^2");
    }
    s
}

/// `inner` in `n` pairs of parens.
fn wrapped(inner: &str, n: usize) -> String {
    format!("{}{inner}{}", "(".repeat(n), ")".repeat(n))
}

/// Whether a refusal's reason names the depth cap: the number 64 stands in it as a number of its own, and it isn't
/// the node cap's refusal or a syntax refusal.
fn names_cap(why: &str) -> bool {
    let numbers = why.split(|c: char| !c.is_ascii_digit()).any(|w| w == CAP.to_string());
    let other = ["nodes once its sums expand", "missing `)`", "ends early", "unexpected", "trailing text"]
        .iter()
        .any(|w| why.contains(w));
    numbers && !other
}

// ---- the planted parser: the same grammar's recursive paths with no cap

mod planted {
    //! A recursive-descent parser of the closed list's recursive paths (parens, unary `-`, `+` and `!`, `?:`, `^`
    //! and call arguments) with no depth counter: the wrong program AC1's check must fail.

    /// The parsed tree, held only so that building and dropping it recurse as a parser's tree does.
    #[allow(dead_code)]
    pub enum Node {
        Num(f64),
        Name(String),
        Neg(Box<Node>),
        Not(Box<Node>),
        Pow(Box<Node>, Box<Node>),
        If(Box<Node>, Box<Node>, Box<Node>),
        Call(String, Vec<Node>),
    }

    struct P<'a> {
        s: &'a [u8],
        at: usize,
    }

    impl P<'_> {
        fn skip(&mut self) {
            while self.at < self.s.len() && self.s[self.at].is_ascii_whitespace() {
                self.at += 1;
            }
        }
        fn eat(&mut self, c: u8) -> bool {
            self.skip();
            if self.s.get(self.at) == Some(&c) {
                self.at += 1;
                true
            } else {
                false
            }
        }
        fn expr(&mut self) -> Result<Node, String> {
            let c = self.unary()?;
            if self.eat(b'?') {
                let a = self.expr()?;
                if !self.eat(b':') {
                    return Err("a `?` without its `:`".into());
                }
                let b = self.expr()?;
                return Ok(Node::If(Box::new(c), Box::new(a), Box::new(b)));
            }
            Ok(c)
        }
        fn unary(&mut self) -> Result<Node, String> {
            if self.eat(b'-') {
                return Ok(Node::Neg(Box::new(self.unary()?)));
            }
            if self.eat(b'+') {
                return self.unary();
            }
            if self.eat(b'!') {
                return Ok(Node::Not(Box::new(self.unary()?)));
            }
            let base = self.atom()?;
            if self.eat(b'^') {
                return Ok(Node::Pow(Box::new(base), Box::new(self.unary()?)));
            }
            Ok(base)
        }
        fn atom(&mut self) -> Result<Node, String> {
            self.skip();
            let start = self.at;
            match self.s.get(self.at) {
                Some(b'(') => {
                    self.at += 1;
                    let e = self.expr()?;
                    if !self.eat(b')') {
                        return Err("missing `)`".into());
                    }
                    Ok(e)
                }
                Some(c) if c.is_ascii_digit() => {
                    while self.at < self.s.len() && (self.s[self.at].is_ascii_digit() || self.s[self.at] == b'.') {
                        self.at += 1;
                    }
                    let text = std::str::from_utf8(&self.s[start..self.at]).map_err(|e| e.to_string())?;
                    text.parse().map(Node::Num).map_err(|_| format!("`{text}` is not a number"))
                }
                Some(c) if c.is_ascii_alphabetic() => {
                    while self.at < self.s.len() && (self.s[self.at].is_ascii_alphanumeric() || self.s[self.at] == b'_') {
                        self.at += 1;
                    }
                    let name = String::from_utf8_lossy(&self.s[start..self.at]).into_owned();
                    if !self.eat(b'(') {
                        return Ok(Node::Name(name));
                    }
                    let mut args = Vec::new();
                    if !self.eat(b')') {
                        loop {
                            args.push(self.expr()?);
                            if self.eat(b',') {
                                continue;
                            }
                            if self.eat(b')') {
                                break;
                            }
                            return Err("missing `)`".into());
                        }
                    }
                    Ok(Node::Call(name, args))
                }
                _ => Err("unexpected text".into()),
            }
        }
    }

    pub fn parse(text: &str) -> Result<Node, String> {
        let mut p = P { s: text.as_bytes(), at: 0 };
        let e = p.expr()?;
        p.skip();
        if p.at < p.s.len() {
            return Err("trailing text after the expression".into());
        }
        Ok(e)
    }
}

// ---- the child

/// Runs `f` on a thread with a 1 MB stack.
fn on_small_stack<T: Send + 'static>(f: impl FnOnce() -> T + Send + 'static) -> T {
    std::thread::Builder::new()
        .stack_size(STACK)
        .spawn(f)
        .expect("a 1 MB thread starts")
        .join()
        .expect("the 1 MB thread returns")
}

fn result(v: Value) {
    println!("RESULT {v}");
}

/// One compile of `text`, timed from the call to the result dropped: by the shipped parser, or the planted one.
fn timed_compile(text: String, parser: &str) -> Value {
    let planted = parser == "planted";
    on_small_stack(move || {
        let started = Instant::now();
        let (refused, why) = if planted {
            match planted::parse(&text) {
                Ok(tree) => {
                    drop(tree);
                    (false, String::new())
                }
                Err(why) => (true, why),
            }
        } else {
            match Expr::compile(&text, &Nothing, BIG_NODES) {
                Ok(e) => {
                    drop(e);
                    (false, String::new())
                }
                Err(r) => {
                    let why = r.why.clone();
                    drop(r);
                    (true, why)
                }
            }
        };
        let ms = started.elapsed().as_secs_f64() * 1e3;
        json!({"bytes": text.len(), "refused": refused, "why": why, "ms": ms})
    })
}

/// AC2's depth-64 reading of one construct: compiled, evaluated and bounded, then dropped, on the 1 MB thread.
fn depth_64(c: Construct) -> Value {
    on_small_stack(move || {
        let text = c.nest(CAP);
        let e = match Expr::compile(&text, &Nothing, NODES) {
            Ok(e) => e,
            Err(r) => return json!({"construct": c.key(), "compiled": false, "why": r.why}),
        };
        // x = 0 takes every conditional's else down to the leaf; x = 1 takes the first's then, y.
        let read = |x: f64, y: f64| -> (f64, Iv) {
            let vars: Vec<V> = e.vars.iter().map(|n| V::S(if n == "x" { x } else { y })).collect();
            let ranges: Vec<B> = e.vars.iter().map(|n| B::S(Iv::point(if n == "x" { x } else { y }))).collect();
            (e.eval(&vars).num(), e.bound(&ranges).num())
        };
        let (v0, b0) = read(0.0, 5.0);
        let (v1, b1) = read(1.0, 5.0);
        let vars = e.vars.clone();
        drop(e);
        json!({"construct": c.key(), "compiled": true, "vars": vars,
               "x0": {"value": v0, "lo": b0.lo, "hi": b0.hi}, "x1": {"value": v1, "lo": b1.lo, "hi": b1.hi}})
    })
}

/// AC4's text item: four graphemes whose one animator's field selector reads `expr`.
fn word(expr: &str) -> Value {
    json!({"id": "word", "kind": "text@1", "layer": "main", "name": "word", "order": "a1", "at": {"pos": [16, 16, 0]},
           "params": {"text": "ABCD", "size": 48, "animators": [{
               "units": "grapheme", "range": {"from": 0, "to": 0}, "props": {"y": 1},
               "selectors": [{"field": {"expr": expr}, "mode": "max"}]}]}})
}

/// The field selector's amounts per unit, read from a document holding the text item, as the text module reads
/// them (`deep_canvas_marks::animator::amounts` over the item's run from the one shaper).
fn field_step(step: &str, expr: &str) -> Value {
    let expr = expr.to_string();
    let step = step.to_string();
    on_small_stack(move || {
        let doc = json!({"format": 1, "id": "field-1468", "profile": "film", "items": {"word": word(&expr)}});
        let item = &doc["items"]["word"];
        let text = item["params"]["text"].as_str().unwrap_or_default().to_string();
        let Value::Object(animator) = item["params"]["animators"][0].clone() else { unreachable!() };
        let mut shaper = deep_text::Shaper::new();
        let run = shaper.shape(&deep_text::Spec::label(&text));
        match deep_canvas_marks::animator::amounts("word", 0, &animator, &run, 0) {
            Ok(a) => json!({"step": step, "ok": true, "amounts": a}),
            Err(r) => json!({"step": step, "ok": false, "code": r.code, "path": r.path}),
        }
    })
}

/// AC4's pack: one recipe kind `deep.probe@1` with one input x and a kind rule over it, `expr`, whose planted twin
/// is x = 2.
fn pack(version: &str, expr: &str) -> Value {
    json!({
        "id": "test/deep", "name": "deep", "version": version, "license": "MIT",
        "description": "the #1468 acceptance tests' pack: one kind whose rule holds while x is at most 1",
        "requires": {"core": ">=0.0.0", "modules": {}},
        "recipes": {"deep.probe@1": {
            "id": "deep.probe", "version": "1.0",
            "inputs": {"x": {"type": "number", "default": 0, "min": 0, "max": 2}},
            "steps": {"r": {"op": "mark", "kind": "test.rect@1", "params": {"w": 10, "h": 10}}},
            "rules": [{"code": "deep.small", "expr": expr, "at": "rest", "fix": "keep x at most 1"}],
            "twins": [{"params": {"x": 2}, "expect": "deep.small"}]
        }}
    })
}

fn board(version: &str, x: f64) -> Value {
    json!({
        "format": 1, "id": "doc-1468", "profile": "figure", "title": "Probe", "description": "One deep.probe instance.",
        "size": [640, 360], "packs": [format!("test/deep@{version}")],
        "layers": {"main": {"writer": "agent-a", "title": "Main", "order": "a0"}},
        "items": {"p1": {"id": "p1", "kind": "deep.probe@1", "layer": "main", "name": "p1", "order": "a0",
                         "params": {"x": x}, "at": {"pos": [40, 40, 0]}}}
    })
}

/// One pack admitted into `packs`: its issues' paths and reasons when refused.
fn admit(packs: &mut deep_canvas::document::Packs, step: &str, manifest: Value) -> Value {
    match packs.admit(&manifest, &deep_canvas::registry::core()) {
        Ok(_) => json!({"step": step, "ok": true}),
        Err(issues) => json!({"step": step, "ok": false,
            "issues": issues.iter().map(|i| json!({"code": i.code, "path": i.path, "what": i.what})).collect::<Vec<_>>()}),
    }
}

/// The pack steps, all in this one process: the deep rule's pack (when `deep`), then the shallow one, and a board
/// holding an instance of its kind, checked.
fn pack_steps(deep: bool) {
    let deep_rule = wrapped("x <= 1", REPEATS);
    on_small_stack(move || {
        let mut packs = deep_canvas::document::Packs::default();
        if deep {
            result(admit(&mut packs, "deep", pack("1.0.0", &deep_rule)));
        }
        result(admit(&mut packs, "shallow", pack("1.0.1", "((x <= 1))")));
        let checked = deep_canvas::document::check_packed(&board("1.0.1", 0.5), &deep_canvas::registry::core(), &packs);
        result(json!({"step": "board", "ok": checked.ok,
            "issues": checked.issues.iter().map(|i| json!({"code": i.code, "path": i.path, "what": i.what})).collect::<Vec<_>>()}));
    });
}

/// The child: what `DEEP_1468_CHILD` names. Run only by the tests below, through [`child_run`].
#[test]
#[ignore = "the child process the #1468 tests run; it does nothing without DEEP_1468_CHILD"]
fn child() {
    let Ok(mode) = std::env::var(CHILD) else { return };
    let parts: Vec<&str> = mode.split(':').collect();
    match parts.as_slice() {
        ["ac1", c, parser] => result(timed_compile(Construct::of(c).nest(REPEATS), parser)),
        ["ac3", parser] => result(timed_compile(tower(POW_TERMS), parser)),
        ["ac2"] => {
            for c in SIX {
                result(depth_64(c));
            }
        }
        ["field", "deep"] => {
            result(field_step("deep", &wrapped("i / n", REPEATS)));
            result(field_step("shallow", "((i / n))"));
        }
        ["field", "shallow"] => result(field_step("shallow", "((i / n))")),
        ["pack", "deep"] => pack_steps(true),
        ["pack", "shallow"] => pack_steps(false),
        _ => panic!("no child mode {mode}"),
    }
}

// ---- the parent

struct Run {
    what: String,
    code: Option<i32>,
    signal: Option<i32>,
    results: Vec<Value>,
    stderr: String,
}

impl Run {
    fn exited(&self) -> bool {
        self.signal.is_none() && self.code == Some(0)
    }

    fn how(&self) -> String {
        let tail: String = {
            let lines: Vec<&str> = self.stderr.lines().filter(|l| !l.trim().is_empty()).collect();
            lines[lines.len().saturating_sub(4)..].join(" | ")
        };
        match (self.signal, self.code) {
            (Some(s), _) => format!("{} died by signal {s} ({}); stderr: {tail}", self.what, signal_name(s)),
            (None, Some(0)) => format!("{} exited 0", self.what),
            (None, c) => format!("{} exited {c:?}; stderr: {tail}", self.what),
        }
    }
}

fn signal_name(s: i32) -> &'static str {
    match s {
        6 => "SIGABRT, as a Rust stack overflow aborts",
        11 => "SIGSEGV",
        9 => "SIGKILL",
        _ => "another signal",
    }
}

/// This binary run again as the child `mode`.
fn child_run(mode: &str) -> Run {
    let exe = std::env::current_exe().expect("the test binary's path");
    let out = Command::new(exe)
        .args(["child", "--exact", "--ignored", "--nocapture", "--test-threads=1"])
        .env(CHILD, mode)
        .env("RUST_BACKTRACE", "0")
        .stdin(Stdio::null())
        .output()
        .expect("the child starts");
    let stdout = String::from_utf8_lossy(&out.stdout);
    let results = stdout
        .lines()
        // The harness prints `test child ... ` before the first line, so a result may start mid-line.
        .filter_map(|l| l.find("RESULT ").map(|i| &l[i + "RESULT ".len()..]))
        .map(|l| serde_json::from_str(l).unwrap_or_else(|e| panic!("child {mode}: a RESULT line isn't JSON ({e}): {l:.300}")))
        .collect();
    Run {
        what: format!("the child `{mode}`"),
        code: out.status.code(),
        signal: out.status.signal(),
        results,
        stderr: String::from_utf8_lossy(&out.stderr).into_owned(),
    }
}

/// The one-minute load and the cores it is read against.
#[derive(Clone, Copy, Debug)]
struct Load {
    load: f64,
    cores: usize,
}

fn load_now() -> Option<f64> {
    std::fs::read_to_string("/proc/loadavg").ok()?.split_whitespace().next()?.parse().ok()
}

/// The load before and after a reading, the greater; unreadable reads as loaded.
fn load_around<T>(f: impl FnOnce() -> T) -> (T, Load) {
    let before = load_now();
    let out = f();
    let after = load_now();
    let cores = std::thread::available_parallelism().map_or(1, |n| n.get());
    let load = match (before, after) {
        (Some(a), Some(b)) => a.max(b),
        _ => f64::INFINITY,
    };
    (out, Load { load, cores })
}

impl Load {
    fn loaded(&self) -> bool {
        self.load >= self.cores as f64 / 2.0
    }
}

#[derive(Debug)]
enum Verdict {
    Pass,
    Fail(String),
    Inconclusive(String),
}

/// A child's one compile: refused with a reason naming the cap, without dying, and (when `limit`) in under it.
fn judge(run: &Run, limit: Option<(f64, Load)>) -> Verdict {
    if !run.exited() {
        return Verdict::Fail(run.how());
    }
    let Some(r) = run.results.last() else {
        return Verdict::Fail(format!("{} printed no result", run.what));
    };
    if r["refused"] != json!(true) {
        return Verdict::Fail(format!("{} accepted the string of {} bytes; it must be refused", run.what, r["bytes"]));
    }
    let why = r["why"].as_str().unwrap_or_default();
    if !names_cap(why) {
        return Verdict::Fail(format!("{} refused it, but the reason doesn't name the cap of {CAP}: {why:.300}", run.what));
    }
    let Some((limit_ms, load)) = limit else { return Verdict::Pass };
    let ms = r["ms"].as_f64().unwrap_or(f64::INFINITY);
    if load.loaded() {
        return Verdict::Inconclusive(format!(
            "{} refused it in {ms:.3} ms, read under a one-minute load of {:.2} on {} cores (at or above half)",
            run.what, load.load, load.cores
        ));
    }
    if ms >= limit_ms {
        return Verdict::Fail(format!("{} refused it in {ms:.3} ms, not under {limit_ms} ms (load {:.2} on {} cores)", run.what, load.load, load.cores));
    }
    Verdict::Pass
}

fn settle(what: &str, v: Verdict) {
    match v {
        Verdict::Pass => {}
        Verdict::Fail(why) => panic!("{what}: {why}"),
        Verdict::Inconclusive(why) => panic!("INCONCLUSIVE: {what}: {why}; this is not a pass"),
    }
}

// ---- AC1

fn ac1(c: Construct) {
    let (run, load) = load_around(|| child_run(&format!("ac1:{}:real", c.key())));
    let what = format!("{AC1} {REPEATS} repeats of {}", c.label());
    eprintln!("{what}: {} {:?}", run.how(), run.results);
    settle(&what, judge(&run, Some((LIMIT_MS, load))));
}

#[test]
fn ac1_a_million_opening_parens_are_refused_in_a_child_in_under_50_ms() {
    ac1(Construct::Paren);
}

#[test]
fn ac1_a_million_minus_signs_are_refused_in_a_child_in_under_50_ms() {
    ac1(Construct::Minus);
}

#[test]
fn ac1_a_million_bangs_are_refused_in_a_child_in_under_50_ms() {
    ac1(Construct::Not);
}

#[test]
fn ac1_a_million_abs_calls_are_refused_in_a_child_in_under_50_ms() {
    ac1(Construct::Abs);
}

#[test]
fn ac1_a_million_conditionals_are_refused_in_a_child_in_under_50_ms() {
    ac1(Construct::Cond);
}

#[test]
fn ac1_a_planted_parser_with_no_cap_dies_by_signal_and_fails() {
    for c in FIVE {
        let (run, load) = load_around(|| child_run(&format!("ac1:{}:planted", c.key())));
        let what = format!("{AC1} the planted parser on {REPEATS} repeats of {}", c.label());
        assert!(run.signal.is_some(), "{what}: the planted parser with no cap must die by signal; {}", run.how());
        let v = judge(&run, Some((LIMIT_MS, load)));
        assert!(matches!(v, Verdict::Fail(_)), "{what}: the check must fail it, but reads {v:?}");
    }
}

// ---- AC2

#[test]
fn ac2_depth_64_parses_and_evaluates_on_a_1_mb_thread_in_a_debug_build() {
    if !cfg!(debug_assertions) {
        settle(AC2, Verdict::Inconclusive("this test binary isn't a debug build; the criterion reads one".into()));
    }
    let run = child_run("ac2");
    assert!(run.exited(), "{AC2} depth 64 on a 1 MB thread: {}", run.how());
    let mut failures = Vec::new();
    for c in SIX {
        let Some(r) = run.results.iter().find(|r| r["construct"] == json!(c.key())) else {
            failures.push(format!("{}: no result", c.key()));
            continue;
        };
        if r["compiled"] != json!(true) {
            failures.push(format!("{} at depth {CAP}: refused: {}", c.key(), r["why"]));
            continue;
        }
        // Every construct reads 1 at its leaf; the conditionals read y (5) when x is 1.
        let want1 = if c == Construct::Cond { 5.0 } else { 1.0 };
        for (case, want) in [("x0", 1.0), ("x1", want1)] {
            let v = r[case]["value"].as_f64().unwrap_or(f64::NAN);
            let (lo, hi) = (r[case]["lo"].as_f64().unwrap_or(f64::NAN), r[case]["hi"].as_f64().unwrap_or(f64::NAN));
            if v != want {
                failures.push(format!("{} at depth {CAP} ({case}): evaluates to {v}, not {want}", c.key()));
            }
            if !(lo <= want && want <= hi) {
                failures.push(format!("{} at depth {CAP} ({case}): its bound [{lo}, {hi}] doesn't hold {want}", c.key()));
            }
        }
    }
    assert!(failures.is_empty(), "{AC2} depth 64 parses and evaluates:\n  {}", failures.join("\n  "));
}

#[test]
fn ac2_depth_65_is_refused_naming_the_cap() {
    let mut failures = Vec::new();
    for c in SIX {
        let text = c.nest(CAP + 1);
        match Expr::compile(&text, &Nothing, NODES) {
            Ok(_) => failures.push(format!("{} at depth {}: parsed; it must be refused", c.key(), CAP + 1)),
            Err(Refusal { why, .. }) if !names_cap(&why) => {
                failures.push(format!("{} at depth {}: refused, but not naming the cap: {why}", c.key(), CAP + 1))
            }
            Err(_) => {}
        }
    }
    assert!(failures.is_empty(), "{AC2} depth 65 is refused, naming the cap:\n  {}", failures.join("\n  "));
}

// ---- AC3

#[test]
fn ac3_a_power_tower_of_10000_terms_is_refused_the_same_way() {
    let run = child_run("ac3:real");
    let what = format!("{AC3} `2^2^2…` at {POW_TERMS} terms");
    eprintln!("{what}: {} {:?}", run.how(), run.results);
    settle(&what, judge(&run, None));
}

#[test]
fn ac3_a_planted_parser_with_no_cap_dies_on_the_tower_and_fails() {
    let run = child_run("ac3:planted");
    let what = format!("{AC3} the planted parser on `2^2^2…` at {POW_TERMS} terms");
    assert!(run.signal.is_some(), "{what}: the planted parser with no cap must die by signal; {}", run.how());
    assert!(matches!(judge(&run, None), Verdict::Fail(_)), "{what}: the check must fail it");
}

// ---- AC4

/// `deep-motion eval` over `docs`, one line each, in one process.
fn motion_eval(docs: &[Value]) -> (Run, Vec<Value>) {
    let mut input = String::new();
    for d in docs {
        input.push_str(&json!({"doc": d, "times": [0]}).to_string());
        input.push('\n');
    }
    let mut child = Command::new(env!("CARGO_BIN_EXE_deep-motion"))
        .arg("eval")
        .env("RUST_BACKTRACE", "0")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .expect("deep-motion starts");
    let mut stdin = child.stdin.take().expect("deep-motion's stdin");
    let writer = std::thread::spawn(move || {
        use std::io::Write;
        let _ = stdin.write_all(input.as_bytes());
    });
    let out = child.wait_with_output().expect("deep-motion runs");
    let _ = writer.join();
    let answers = String::from_utf8_lossy(&out.stdout)
        .lines()
        .filter(|l| !l.is_empty())
        .map(|l| serde_json::from_str(l).unwrap_or_else(|_| json!({"not_json": l.chars().take(300).collect::<String>()})))
        .collect();
    let run = Run {
        what: "deep-motion eval".into(),
        code: out.status.code(),
        signal: out.status.signal(),
        results: Vec::new(),
        stderr: String::from_utf8_lossy(&out.stderr).into_owned(),
    };
    (run, answers)
}

/// A film whose driver `d` writes the rect's x from `expr` over the time.
fn driven(expr: &str) -> Value {
    json!({
        "transport": {"span": "1s"},
        "items": {"a": {"id": "a", "kind": "rect@1", "params": {"box": [0, 0, 4, 4]}, "at": {"pos": [0, 0, 0]}}},
        "drivers": {"d": {"target": "items/a/at/pos/0", "expr": expr, "vars": {"t": "time"}}}
    })
}

const SHALLOW_DRIVER: &str = "((t))";
const FIELD_PATH: &str = "items/word/params/animators/0/selectors/0/field/expr";

fn short(v: &Value) -> String {
    v.to_string().chars().take(600).collect()
}

#[test]
fn ac4_a_driver_holding_a_million_parens_is_refused_naming_its_path_and_deep_motion_stays_up() {
    let (run, answers) = motion_eval(&[driven(&wrapped("t", REPEATS)), driven(SHALLOW_DRIVER)]);
    assert!(run.exited(), "{AC4} driver: the process stays up: {}", run.how());
    assert_eq!(answers.len(), 2, "{AC4} driver: one answer per line, the deep document's and then the shallow one's");
    let deep = &answers[0];
    let path = deep["path"].as_str().unwrap_or_default();
    assert!(
        deep["ok"] == json!(false) && path.contains("drivers/d") && path.ends_with("expr"),
        "{AC4} driver: the deep document is refused naming drivers/d/…/expr: {}",
        short(deep)
    );
    assert_eq!(answers[1]["ok"], json!(true), "{AC4} driver: the same process then evaluates the shallow document: {}", short(&answers[1]));
}

#[test]
fn ac4_a_field_holding_a_million_parens_is_refused_naming_its_path_and_the_process_stays_up() {
    let run = child_run("field:deep");
    assert!(run.exited(), "{AC4} field: the process stays up: {}", run.how());
    let deep = run.results.iter().find(|r| r["step"] == json!("deep"));
    let deep = deep.unwrap_or_else(|| panic!("{AC4} field: the deep step printed no result"));
    assert!(
        deep["ok"] == json!(false) && deep["path"] == json!(FIELD_PATH),
        "{AC4} field: the deep selector is refused naming {FIELD_PATH}: {}",
        short(deep)
    );
    let shallow = run.results.iter().find(|r| r["step"] == json!("shallow"));
    let shallow = shallow.unwrap_or_else(|| panic!("{AC4} field: the shallow step printed no result after the refusal"));
    assert_eq!(shallow["amounts"], json!([0.0, 0.25, 0.5, 0.75]), "{AC4} field: the same process then reads i / n: {}", short(shallow));
}

#[test]
fn ac4_a_pack_rule_holding_a_million_parens_is_refused_naming_its_path_and_the_process_stays_up() {
    let run = child_run("pack:deep");
    assert!(run.exited(), "{AC4} pack rule: the process stays up: {}", run.how());
    let step = |s: &str| {
        run.results.iter().find(|r| r["step"] == json!(s)).cloned().unwrap_or_else(|| panic!("{AC4} pack rule: no `{s}` step"))
    };
    let deep = step("deep");
    let named = deep["issues"]
        .as_array()
        .is_some_and(|l| l.iter().any(|i| i["path"].as_str().is_some_and(|p| p.contains("rules/0/expr"))));
    assert!(deep["ok"] == json!(false) && named, "{AC4} pack rule: the deep rule's pack is refused naming rules/0/expr: {}", short(&deep));
    let shallow = step("shallow");
    assert_eq!(shallow["ok"], json!(true), "{AC4} pack rule: the same process then admits the shallow pack: {}", short(&shallow));
    let board = step("board");
    assert_eq!(board["ok"], json!(true), "{AC4} pack rule: and checks a board holding its kind: {}", short(&board));
}

/// Not vacuous: the three documents with a shallow expression in the same place evaluate, so the refusals above are
/// the deep strings', not the fixtures'. This holds on the base.
#[test]
fn ac4_the_same_documents_with_a_shallow_expression_evaluate() {
    let (run, answers) = motion_eval(&[driven(SHALLOW_DRIVER)]);
    assert!(run.exited() && answers.len() == 1 && answers[0]["ok"] == json!(true), "{AC4} control: the shallow driver evaluates: {} {:?}", run.how(), answers.first().map(short));
    let run = child_run("field:shallow");
    assert!(run.exited(), "{AC4} control: {}", run.how());
    assert_eq!(run.results.first().map(|r| r["amounts"].clone()), Some(json!([0.0, 0.25, 0.5, 0.75])), "{AC4} control: the shallow field reads i / n: {:?}", run.results);
    let run = child_run("pack:shallow");
    assert!(run.exited(), "{AC4} control: {}", run.how());
    let oks: Vec<Value> = run.results.iter().map(|r| r["ok"].clone()).collect();
    assert_eq!(oks, vec![json!(true), json!(true)], "{AC4} control: the shallow pack is admitted and its board checks: {:?}", run.results);
}

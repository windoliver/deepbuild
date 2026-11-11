//! The sandbox module's check-time runner as JSON calls (#238): `check`, `rewrite`, `run`, sandbox@1's
//! `kit` and `kit_plan`, `about` and the web runner's source. `deep-sandbox` serves them as JSON
//! lines; deep-show calls the same functions for providers, validators, registry programs and its
//! kit part `sandbox`, so neither keeps a copy of the subset, the rewrite or the runner.

use std::time::{Duration, Instant};

use base64::{engine::general_purpose::STANDARD as B64, Engine as _};
use deep_canvas_sandbox::check::{self, Limits, Refusal, SUBSET};
use deep_canvas_sandbox::rewrite::{self, Rewritten, START};
use deep_canvas_sandbox::trap::Trap;
use deep_canvas_sandbox::{kit, module};
use serde_json::{json, Value};
use wasmtime::Val;

use crate::{Call, Faults, Runner, WASMTIME};

/// The web player's implementation of sandbox@1: the browser's own WebAssembly engine runs the
/// bytes the app rewrote.
pub const WEB_RUNNER: &str = include_str!("../web/runner.mjs");

/// How long a kit case may run before it fails as one that never ends.
const KIT_DEADLINE: Duration = Duration::from_secs(10);
/// How long any other run may.
const RUN_DEADLINE: Duration = Duration::from_secs(120);

/// The planted twins `deep-sandbox --planted <name>` runs, each one criterion's wrong program.
#[derive(Clone, Copy, Debug, Default)]
pub struct Planted {
    pub rewrite: rewrite::Faults,
    pub engine: Faults,
    /// The subset check on the parser's default features instead of the allowlist.
    pub parser_defaults: bool,
}

impl Planted {
    pub fn named(name: &str) -> Option<Planted> {
        let mut p = Planted::default();
        match name {
            "rewriter_skips_back_edge_fuel" => p.rewrite.skip_loop_charge = true,
            "meters_with_wasmtime_fuel" => p.engine.wasmtime_fuel = true,
            "runner_skips_nan" => p.rewrite.keep_nan = true,
            "rewriter_no_call_overhead" => p.rewrite.no_call_overhead = true,
            "check_parser_defaults" => p.parser_defaults = true,
            "mapper_reports_unreachable" => p.engine.every_trap_unreachable = true,
            "rewrite_grow_returns_minus_one" => p.rewrite.grow_returns = true,
            _ => return None,
        }
        Some(p)
    }
}

/// A run's budgets: fuel units, the stack's cap in bytes and the memory a program may hold.
#[derive(Clone, Copy, Debug)]
pub struct Budget {
    pub fuel: i64,
    pub stack: i32,
    pub memory: u64,
}

const MIB: u64 = 1024 * 1024;
const PAGE: u64 = 65_536;

impl Budget {
    /// The role's budget (Provider `gen@1`; Logic: data layouts), with what `v` sets.
    pub fn of(role: &str, v: Option<&Value>, input: usize) -> Budget {
        let (fuel, memory, stack) = match role {
            "validator" => (
                (8 * input as i64).max(10_000_000),
                input as u64 + 4 * MIB,
                262_144,
            ),
            // logic@1's defaults: 1,000,000 fuel a step, 4 MiB and 64 KiB (#531).
            "logic" => (1_000_000, 4 * MIB, 65_536),
            _ => (1_000_000_000, 64 * MIB, 262_144),
        };
        let get = |k: &str| v.and_then(|b| b.get(k)).and_then(Value::as_i64);
        Budget {
            fuel: get("fuel").unwrap_or(fuel),
            // Under the native stack, so the rewrite's `stack` trap comes first.
            stack: get("stack")
                .unwrap_or(stack)
                .clamp(0, crate::NATIVE_STACK as i64 - 1) as i32,
            // At most what a 32-bit memory holds.
            memory: get("memory_mib").map_or(memory, |m| m.clamp(0, 4096) as u64 * MIB),
        }
    }
}

/// Where a trap's offset is counted: in the program as written (what a `run` reports), or in the
/// rewritten program that runs everywhere (what sandbox@1's kit compares, so two implementations
/// that stop at one instruction of the program as written but at two of the rewritten one differ).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Offsets {
    Written,
    Rewritten,
}

/// What a run left.
#[derive(Clone, Debug)]
pub struct Ran {
    pub trap: Option<Trap>,
    pub result: Option<i64>,
    pub reads: Vec<Value>,
    /// The memory after the run, and where a provider's output starts in it.
    pub memory: Vec<u8>,
    pub out_at: Option<u32>,
}

pub fn trap_json(t: &Option<Trap>) -> Value {
    match t {
        Some(t) => json!({"kind": t.kind, "function": t.function, "offset": t.offset}),
        None => Value::Null,
    }
}

pub fn refusals_json(r: &[Refusal]) -> Value {
    Value::Array(r.iter().map(Refusal::to_json).collect())
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

/// sandbox@1, its implementation and the engine this process runs.
pub fn about() -> Value {
    json!({
        "interface": module::INTERFACE,
        "implementation": module::module().manifest.implementation.to_json(),
        "engine": {"name": "wasmtime", "version": WASMTIME},
        "arch": std::env::consts::ARCH,
        "os": std::env::consts::OS,
    })
}

/// The sandbox module's check, rewrite and check-time runner, with any planted twin.
#[derive(Clone, Copy, Debug, Default)]
pub struct Sandbox {
    pub planted: Planted,
}

impl Sandbox {
    /// The subset check, then the role's exports.
    pub fn check(&self, bytes: &[u8], role: &str, budget: &Budget) -> Result<(), Vec<Refusal>> {
        let features = if self.planted.parser_defaults {
            check::parser_defaults()
        } else {
            SUBSET
        };
        check::check(bytes, &Limits { features, memory: budget.memory })?;
        check::check_role(bytes, role)
    }

    /// The check, then the rewrite; a refusal is `Err(Ok(refusals))`, a rewrite that fails `Err(Err)`.
    pub fn rewrite(
        &self,
        bytes: &[u8],
        role: &str,
        budget: &Budget,
    ) -> Result<(Rewritten, f64), Result<Vec<Refusal>, String>> {
        self.check(bytes, role, budget).map_err(Ok)?;
        let t = Instant::now();
        let mode = if role == "logic" {
            rewrite::Mode::Logic
        } else {
            rewrite::Mode::Plain
        };
        let out = rewrite::rewrite_as(bytes, self.planted.rewrite, mode).map_err(Err)?;
        Ok((out, t.elapsed().as_secs_f64() * 1000.0))
    }

    /// One run of rewritten bytes in a role: a provider runs its start export, if any, then
    /// `gen(seed)`; a validator reads `input` at `in_at` and runs `validate(len)`. A trap names
    /// the offset in the program as written, or with `at: Rewritten` in the rewritten program.
    #[allow(clippy::too_many_arguments)]
    pub fn run(
        &self,
        rewritten: &[u8],
        role: &str,
        seed: i64,
        budget: &Budget,
        reads: &[(u32, u32)],
        input: &[u8],
        deadline: Duration,
        at: Offsets,
    ) -> Result<Ran, String> {
        // A validator's memory is its asset plus 4 MiB, whatever the program declares (#415).
        let pages = (role == "validator").then(|| budget.memory.div_ceil(PAGE));
        let mut r = Runner::sized(rewritten, pages, self.planted.engine, at == Offsets::Written)?;
        let call = |export: &str, args: Vec<Val>| Call {
            export: export.into(),
            args,
            fuel: budget.fuel,
            stack: budget.stack,
            deadline: Some(deadline),
        };
        let mut calls = Vec::new();
        if r.exports(START) {
            calls.push(call(START, vec![]));
        }
        match role {
            "validator" => {
                let at = match r.global("in_at") {
                    Some(Val::I32(a)) => a as usize,
                    _ => return Err("a validator exports the immutable global in_at".into()),
                };
                r.write("memory", at, input)?;
                calls.push(call("validate", vec![Val::I64(input.len() as i64)]));
            }
            _ => calls.push(call("gen", vec![Val::I64(seed)])),
        }
        let mut trap = None;
        let mut result = None;
        for c in &calls {
            let out = r.call(c)?;
            if out.trap.is_some() {
                trap = out.trap;
                break;
            }
            result = match out.results.first() {
                Some(Val::I32(v)) => Some(i64::from(*v)),
                Some(Val::I64(v)) => Some(*v),
                _ => None,
            };
        }
        let out_at = match r.global("out_at") {
            Some(Val::I32(a)) => Some(a as u32),
            _ => None,
        };
        // A validator's memory holds its asset, up to 260 MiB, and nothing reads it after the run.
        let memory = if role == "validator" && reads.is_empty() {
            Vec::new()
        } else {
            r.memory("memory").unwrap_or(&[]).to_vec()
        };
        let reads = reads
            .iter()
            .map(|&(at, len)| {
                let s = (at as usize).min(memory.len());
                let e = (at as usize + len as usize).min(memory.len());
                json!({"at": at, "len": len, "hex": hex(&memory[s..e])})
            })
            .collect();
        Ok(Ran {
            result: if trap.is_some() { None } else { result },
            trap,
            reads,
            memory,
            out_at,
        })
    }

    /// One JSON call (README of #238's acceptance suite: deep-sandbox).
    pub fn handle(&self, line: &Value) -> Value {
        let bad = || json!({"ok": false, "code": "bad_input"});
        let program = || {
            line.get("program")
                .and_then(Value::as_str)
                .and_then(|p| B64.decode(p).ok())
        };
        let role = line.get("role").and_then(Value::as_str).unwrap_or("provider");
        let budget = Budget::of(role, line.get("budget"), 0);
        let refused = |r: Vec<Refusal>| json!({"ok": false, "code": "subset_refused", "refusals": refusals_json(&r)});
        match line.get("call").and_then(Value::as_str) {
            Some("about") => about(),
            Some("check") => {
                let Some(bytes) = program() else { return bad() };
                match self.check(&bytes, role, &budget) {
                    Ok(()) => json!({"ok": true, "refusals": []}),
                    Err(r) => refused(r),
                }
            }
            Some("rewrite") => {
                let Some(bytes) = program() else { return bad() };
                match self.rewrite(&bytes, role, &budget) {
                    Ok((out, ms)) => json!({"ok": true, "rewritten": B64.encode(&out.bytes), "hash": out.hash, "ms": ms}),
                    Err(Ok(r)) => refused(r),
                    Err(Err(e)) => json!({"ok": false, "code": "rewrite_failed", "what": e}),
                }
            }
            Some("run") => {
                let Some(bytes) = program() else { return bad() };
                let (out, _) = match self.rewrite(&bytes, role, &budget) {
                    Ok(o) => o,
                    Err(Ok(r)) => return refused(r),
                    Err(Err(e)) => return json!({"ok": false, "code": "rewrite_failed", "what": e}),
                };
                let seed = line.get("seed").and_then(Value::as_i64).unwrap_or(0);
                let input = line
                    .get("input")
                    .and_then(Value::as_str)
                    .and_then(|i| B64.decode(i).ok())
                    .unwrap_or_default();
                let reads = reads_of(line.get("read"));
                match self.run(&out.bytes, role, seed, &budget, &reads, &input, RUN_DEADLINE, Offsets::Written) {
                    Ok(r) => json!({"ok": true, "hash": out.hash, "trap": trap_json(&r.trap), "result": r.result, "reads": r.reads}),
                    Err(e) => json!({"ok": false, "code": "run_failed", "what": e}),
                }
            }
            Some("kit") => self.kit(),
            Some("kit_plan") => self.kit_plan(),
            Some("web_runner") => json!({"source": WEB_RUNNER}),
            _ => bad(),
        }
    }

    /// sandbox@1's kit on this host: each fixture's result against the reference's.
    pub fn kit(&self) -> Value {
        let mut cases = Vec::new();
        let mut failures = Vec::new();
        for f in fixtures() {
            let c = self.case(&f);
            if let Some(fs) = c.get("failures").and_then(Value::as_array) {
                failures.extend(fs.iter().cloned());
            }
            cases.push(c);
        }
        for c in &mut cases {
            if let Some(o) = c.as_object_mut() {
                o.remove("failures");
            }
        }
        let verdict = if failures.is_empty() { "PASS" } else { "FAIL" };
        json!({"interface": module::INTERFACE, "verdict": verdict, "cases": cases, "failures": failures})
    }

    /// For each fixture that runs, the web runner's request for the bytes this host rewrote.
    pub fn kit_plan(&self) -> Value {
        let plan: Vec<Value> = fixtures()
            .into_iter()
            .filter(|f| f.expect.get("refusals").is_none())
            .filter_map(|f| {
                let (out, _) = self.rewrite(&f.bytes, &f.role, &f.budget).ok()?;
                Some(json!({"fixture": f.name, "request": {
                    "rewritten": B64.encode(&out.bytes), "role": f.role, "seed": 0,
                    "budget": f.budget_json, "read": f.read_json, "offsets": "rewritten",
                }}))
            })
            .collect();
        json!({"fixtures": plan})
    }

    fn case(&self, f: &Fixture) -> Value {
        let name = f.name.as_str();
        let mut fails = Vec::new();
        let mut fail = |field: &str, expected: Value, actual: Value, function: Option<usize>| {
            let mut x = json!({"fixture": name, "field": field, "expected": expected, "actual": actual});
            if let Some(i) = function {
                x["function"] = json!(i);
            }
            fails.push(x);
        };
        let e = &f.expect;
        let mut out = json!({
            "case": name, "fixture": name, "verdict": "PASS", "hash": null,
            "expected_hash": e.get("hash").cloned().unwrap_or(Value::Null),
            "refusals": [], "trap": null, "expected_trap": e.get("trap").cloned().unwrap_or(Value::Null),
            "result": null, "reads": [],
        });
        match self.rewrite(&f.bytes, &f.role, &f.budget) {
            Err(Ok(r)) => {
                let got = refusals_json(&r);
                out["refusals"] = got.clone();
                let want = e.get("refusals").cloned().unwrap_or(json!([]));
                if got != want {
                    fail("refusal", want, got, None);
                }
            }
            Err(Err(msg)) => match e.get("refusals") {
                // The check admitted what the reference refuses, and the rewrite couldn't take it.
                Some(want) => fail("refusal", want.clone(), json!([]), None),
                None => fail("hash", e.get("hash").cloned().unwrap_or(Value::Null), json!(msg), None),
            },
            Ok((rw, _)) => {
                if let Some(want) = e.get("refusals") {
                    fail("refusal", want.clone(), json!([]), None);
                }
                let hash = rw.hash.clone();
                out["hash"] = json!(hash);
                let functions = rewrite::functions(&rw.bytes);
                out["functions"] = json!(functions);
                if e.get("hash") != Some(&json!(hash)) && e.get("refusals").is_none() {
                    let want: Vec<String> = e
                        .get("functions")
                        .and_then(Value::as_array)
                        .map(|a| a.iter().filter_map(|v| v.as_str().map(String::from)).collect())
                        .unwrap_or_default();
                    let differs = (0..functions.len().max(want.len()))
                        .find(|&i| functions.get(i) != want.get(i));
                    fail("hash", e.get("hash").cloned().unwrap_or(Value::Null), json!(hash), differs);
                }
                if e.get("refusals").is_none() {
                    match self.run(&rw.bytes, &f.role, 0, &f.budget, &f.reads, &[], KIT_DEADLINE, Offsets::Rewritten) {
                        Err(msg) => fail("kind", want_kind(e), json!(msg), None),
                        Ok(r) => {
                            let trap = trap_json(&r.trap);
                            out["trap"] = trap.clone();
                            out["result"] = json!(r.result);
                            out["reads"] = Value::Array(r.reads.clone());
                            let want = e.get("trap").cloned().unwrap_or(Value::Null);
                            for field in ["kind", "function", "offset"] {
                                let (w, g) = (want.get(field).cloned(), trap.get(field).cloned());
                                if w != g {
                                    fail(field, w.unwrap_or(Value::Null), g.unwrap_or(Value::Null), None);
                                }
                            }
                            let wr = e.get("result").cloned().unwrap_or(Value::Null);
                            if wr != out["result"] {
                                fail("result", wr, out["result"].clone(), None);
                            }
                            let wr = e.get("reads").cloned().unwrap_or(json!([]));
                            if wr != out["reads"] {
                                fail("reads", wr, out["reads"].clone(), None);
                            }
                        }
                    }
                }
            }
        }
        if !fails.is_empty() {
            out["verdict"] = json!("FAIL");
            out["failure"] = fails[0].clone();
        }
        out["failures"] = Value::Array(fails);
        out
    }
}

fn want_kind(expect: &Value) -> Value {
    expect.pointer("/trap/kind").cloned().unwrap_or(Value::Null)
}


fn reads_of(v: Option<&Value>) -> Vec<(u32, u32)> {
    v.and_then(Value::as_array)
        .map(|a| {
            a.iter()
                .filter_map(|r| {
                    Some((
                        r.get("at")?.as_u64()? as u32,
                        r.get("len")?.as_u64()?.min(4096) as u32,
                    ))
                })
                .collect()
        })
        .unwrap_or_default()
}

/// One of the kit's fixtures, assembled.
struct Fixture {
    name: String,
    role: String,
    bytes: Vec<u8>,
    budget: Budget,
    budget_json: Value,
    reads: Vec<(u32, u32)>,
    read_json: Value,
    expect: Value,
}

fn fixtures() -> Vec<Fixture> {
    let kit: Value = serde_json::from_str(kit::KIT).expect("sandbox@1's kit is JSON");
    let list = kit["fixtures"].as_array().cloned().unwrap_or_default();
    list.into_iter()
        .map(|f| {
            let program = f["program"].as_str().unwrap_or_default();
            let text = kit::PROGRAMS
                .iter()
                .find(|(n, _)| *n == program)
                .map(|(_, t)| *t)
                .expect("each kit fixture names one of its programs");
            let mut bytes = wat::parse_str(text).expect("the kit's programs assemble");
            if let Some(total) = f.get("pad_to").and_then(Value::as_u64) {
                bytes = padded(bytes, total as usize);
            }
            let role = f["role"].as_str().unwrap_or("provider").to_string();
            Fixture {
                name: f["fixture"].as_str().unwrap_or_default().to_string(),
                budget: Budget::of(&role, f.get("budget"), 0),
                budget_json: f.get("budget").cloned().unwrap_or(json!({})),
                reads: reads_of(f.get("read")),
                read_json: f.get("read").cloned().unwrap_or(json!([])),
                expect: f.get("expect").cloned().unwrap_or(json!({})),
                role,
                bytes,
            }
        })
        .collect()
}

/// `bytes` with a custom section appended so the whole program is exactly `total` bytes.
fn padded(mut bytes: Vec<u8>, total: usize) -> Vec<u8> {
    let name = b"pad";
    for size_len in 1..=5usize {
        let header = 1 + size_len + 1 + name.len();
        let Some(payload) = total.checked_sub(bytes.len() + header) else { continue };
        let body = 1 + name.len() + payload;
        let mut size = Vec::new();
        let mut n = body;
        loop {
            let b = (n & 0x7f) as u8;
            n >>= 7;
            if n == 0 {
                size.push(b);
                break;
            }
            size.push(b | 0x80);
        }
        if size.len() != size_len {
            continue;
        }
        bytes.push(0);
        bytes.extend(size);
        bytes.push(name.len() as u8);
        bytes.extend_from_slice(name);
        bytes.resize(total, 0);
        return bytes;
    }
    bytes
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_stack_budget_stays_under_the_native_stack() {
        let stack = |n: i64| Budget::of("provider", Some(&json!({"stack": n})), 0).stack;
        assert_eq!(stack(4_294_967_295), (2 << 20) - 1, "past i32");
        assert_eq!(stack(4_294_967_296), (2 << 20) - 1, "a multiple of 2^32");
        assert_eq!(stack(-1), 0);
        assert_eq!(stack(65_536), 65_536);
    }

    #[test]
    fn a_memory_budget_stays_inside_a_32_bit_memory() {
        let memory = |n: i64| Budget::of("provider", Some(&json!({"memory_mib": n})), 0).memory;
        assert_eq!(memory(-1), 0);
        assert_eq!(memory(1 << 40), 4096 * MIB);
        assert_eq!(memory(16), 16 * MIB);
    }
}

//! `deep-show <run | screen>`: JSON lines in, one JSON line out per input line, in order, exit 0;
//! a line that can't be read, lacks a required field or names an unknown `planted` value answers
//! `{"ok":false,"code":"bad_input"}`, before anything platform-specific. The surface is the #393
//! acceptance README's: `run` plays a scenario of deep_show and `deep show` calls against the
//! hub's canvas side and answers each call; `screen` also draws the window those calls leave, by
//! band with the question card last, through GPUI's offscreen Metal renderer (macOS only; off
//! macOS it answers `{"ok":false,"code":"unsupported_platform"}`).

mod evidence;
mod frames;
mod hub;
mod kit;
#[cfg(feature = "test-accent")]
mod planted;
mod shared;
mod snapshot;

/// Every heap allocation the process makes, counted so the `frames` call can read how many the
/// scheduler made in a frame (#387: "the scheduler allocates nothing per frame after warm-up").
struct Counting;

static ALLOCATIONS: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);

// SAFETY: every call forwards to the system allocator unchanged; the counter is a relaxed atomic.
unsafe impl std::alloc::GlobalAlloc for Counting {
    unsafe fn alloc(&self, layout: std::alloc::Layout) -> *mut u8 {
        ALLOCATIONS.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
        unsafe { std::alloc::System.alloc(layout) }
    }

    unsafe fn dealloc(&self, ptr: *mut u8, layout: std::alloc::Layout) {
        unsafe { std::alloc::System.dealloc(ptr, layout) }
    }

    unsafe fn alloc_zeroed(&self, layout: std::alloc::Layout) -> *mut u8 {
        ALLOCATIONS.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
        unsafe { std::alloc::System.alloc_zeroed(layout) }
    }

    unsafe fn realloc(&self, ptr: *mut u8, layout: std::alloc::Layout, new_size: usize) -> *mut u8 {
        ALLOCATIONS.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
        unsafe { std::alloc::System.realloc(ptr, layout, new_size) }
    }
}

#[global_allocator]
static COUNTING: Counting = Counting;

/// How many heap allocations the process has made.
pub fn allocations() -> u64 {
    ALLOCATIONS.load(std::sync::atomic::Ordering::Relaxed)
}

use std::collections::BTreeMap;
use std::io::{self, BufRead, Write};
use std::path::PathBuf;
use std::time::Instant;

use deep_canvas::registry::{BuildSet, Fault, Module, Registry, SealError};
use serde_json::{json, Map, Value};

use hub::{
    flicks, Body, Call, Card, Claim, Eval, Fault as HoldFault, Hold, Include, Panel, PatchCall,
    Planted, Process, RecordObject, Scenario, Session, Show, Startup, Via,
};
use shared::{Clock, CommitFault, Quota};

fn bad_input() -> Value {
    json!({"ok": false, "code": "bad_input"})
}

/// Standard base64 (RFC 4648, with padding) to bytes; `None` for anything else.
fn base64(text: &str) -> Option<Vec<u8>> {
    let value = |c: u8| -> Option<u32> {
        Some(match c {
            b'A'..=b'Z' => c - b'A',
            b'a'..=b'z' => c - b'a' + 26,
            b'0'..=b'9' => c - b'0' + 52,
            b'+' => 62,
            b'/' => 63,
            _ => return None,
        } as u32)
    };
    let bytes = text.as_bytes();
    if !bytes.len().is_multiple_of(4) {
        return None;
    }
    let mut out = Vec::with_capacity(bytes.len() / 4 * 3);
    for chunk in bytes.chunks(4) {
        let pad = chunk.iter().rev().take_while(|c| **c == b'=').count();
        if pad > 2 {
            return None;
        }
        let mut n = 0u32;
        for (i, c) in chunk.iter().enumerate() {
            let v = if i >= 4 - pad { 0 } else { value(*c)? };
            n = (n << 6) | v;
        }
        let three = [(n >> 16) as u8, (n >> 8) as u8, n as u8];
        out.extend_from_slice(&three[..3 - pad]);
    }
    Some(out)
}

/// The marker a JSON number past f64's range is read as, so the document check can refuse it
/// with `out_of_range` at its path instead of the whole line failing to parse.
pub const OVERFLOW: &str = "\u{0}overflow:";

/// A line whose numbers past f64's range (`1e999`) are rewritten as [`OVERFLOW`] strings, or
/// `None` when it has none.
fn tame_overflow(line: &str) -> Option<String> {
    let bytes = line.as_bytes();
    let mut out = String::with_capacity(line.len());
    let mut i = 0;
    let mut changed = false;
    while i < bytes.len() {
        let c = bytes[i];
        if c == b'"' {
            // A string, its escapes included, copied as it is.
            let start = i;
            i += 1;
            while i < bytes.len() && bytes[i] != b'"' {
                i += if bytes[i] == b'\\' { 2 } else { 1 };
            }
            i = (i + 1).min(bytes.len());
            out.push_str(&line[start..i]);
            continue;
        }
        if c == b'-' || c.is_ascii_digit() {
            let start = i;
            i += 1;
            while i < bytes.len()
                && matches!(bytes[i], b'0'..=b'9' | b'.' | b'e' | b'E' | b'+' | b'-')
            {
                i += 1;
            }
            let token = &line[start..i];
            match token.parse::<f64>() {
                Ok(n) if n.is_infinite() => {
                    out.push_str(&format!(
                        "\"{}{token}\"",
                        OVERFLOW.replace('\u{0}', "\\u0000")
                    ));
                    changed = true;
                }
                _ => out.push_str(token),
            }
            continue;
        }
        out.push(c as char);
        i += 1;
    }
    changed.then_some(out)
}

fn rect(value: Option<&Value>) -> Option<[f64; 4]> {
    let parts: Vec<f64> = value?
        .as_array()?
        .iter()
        .map(Value::as_f64)
        .collect::<Option<_>>()?;
    let r = <[f64; 4]>::try_from(parts.as_slice()).ok()?;
    (r.iter().all(|v| v.is_finite()) && r[2] > 0.0 && r[3] > 0.0).then_some(r)
}

/// An optional object field as a map of `parse`d entries; absent is empty.
fn entries<T>(
    input: &Map<String, Value>,
    key: &str,
    parse: impl Fn(&Map<String, Value>) -> Option<T>,
) -> Option<BTreeMap<String, T>> {
    match input.get(key) {
        None => Some(BTreeMap::new()),
        Some(v) => v
            .as_object()?
            .iter()
            .map(|(k, e)| Some((k.clone(), parse(e.as_object()?)?)))
            .collect(),
    }
}

fn strings(value: Option<&Value>) -> Option<Vec<String>> {
    match value {
        None => Some(Vec::new()),
        Some(v) => v
            .as_array()?
            .iter()
            .map(|s| s.as_str().map(str::to_string))
            .collect(),
    }
}

/// Who a call names: a `deep_show` call's session, or a `deep show` call's peer process.
fn via(name: &str, c: &Map<String, Value>) -> Option<Via> {
    match name {
        "deep_show" => match c.get("session")? {
            Value::Null => Some(Via::Mcp(None)),
            Value::String(s) => Some(Via::Mcp(Some(s.clone()))),
            _ => None,
        },
        "deep show" => {
            let peer = c.get("peer")?.as_object()?;
            Some(Via::Cli(
                peer.get("pid")?.as_u64()?,
                peer.get("start")?.as_i64()?,
            ))
        }
        _ => None,
    }
}

/// A call's backend: one of the kit's.
fn backend(c: &Map<String, Value>) -> Option<String> {
    let b = c.get("backend")?.as_str()?;
    kit::BACKENDS.contains(&b).then(|| b.to_string())
}

/// Who a call acts as: an agent's session or `deep show` from a process tree, or no one.
fn acting(c: &Map<String, Value>) -> Option<Option<Via>> {
    match (c.get("session"), c.get("peer")) {
        (None, None) => Some(None),
        (Some(_), None) => Some(Some(via("deep_show", c)?)),
        (None, Some(_)) => Some(Some(via("deep show", c)?)),
        _ => None,
    }
}

fn call(c: &Map<String, Value>) -> Option<Call> {
    let name = c.get("call")?.as_str()?;
    let doc = || Some(c.get("doc")?.as_str()?.to_string());
    let time = |key: &str, default: i64| -> Option<i64> {
        match c.get(key) {
            None => Some(default),
            Some(t) => flicks(t.as_str()?),
        }
    };
    match name {
        "revisions" => return Some(Call::Revisions(doc()?)),
        "screen" => return Some(Call::Screen),
        "registry" => return Some(Call::Registry),
        "fixtures" => return Some(Call::Fixtures),
        "schedule" => return Some(Call::Schedule),
        "eval" => {
            let view = match c.get("view") {
                None => Map::new(),
                Some(v) => v.as_object()?.clone(),
            };
            if view.keys().any(|k| k != "locale" && k != "reduced_motion") {
                return None;
            }
            let size = match c.get("size") {
                None => None,
                Some(v) => {
                    let s: Vec<u16> = v
                        .as_array()?
                        .iter()
                        .map(|n| n.as_u64().and_then(|n| u16::try_from(n).ok()))
                        .collect::<Option<_>>()?;
                    Some(<[u16; 2]>::try_from(s.as_slice()).ok()?)
                }
            };
            let flag = |k: &str| match c.get(k) {
                None => Some(false),
                Some(b) => b.as_bool(),
            };
            return Some(Call::Eval(Box::new(Eval {
                doc: doc()?,
                t: time("t", 0)?,
                view,
                clean: flag("clean")?,
                perturb: match c.get("perturb") {
                    None => None,
                    Some(p) => Some(p.as_str()?.to_string()),
                },
                pixels: flag("pixels")?,
                size,
            })));
        }
        "frames" => {
            return Some(Call::Frames {
                doc: doc()?,
                count: c.get("count")?.as_u64()?.min(100_000) as usize,
                from: time("from", 0)?,
                step: time("step", flicks("1/60s").unwrap_or(11_760_000))?,
            })
        }
        "panel" => {
            return Some(Call::Panel {
                panel: c.get("panel")?.as_str()?.to_string(),
                visible: c.get("visible")?.as_bool()?,
            })
        }
        "intern" => {
            return Some(Call::Intern {
                doc: doc()?,
                id: c.get("id")?.as_str()?.to_string(),
            })
        }
        "resolve" => {
            return Some(Call::Resolve {
                doc: doc()?,
                handle: c.get("handle")?.clone(),
            })
        }
        "batch" => {
            let source = c.get("source")?.as_str()?.to_string();
            let mut columns = BTreeMap::new();
            for (name, col) in c.get("columns")?.as_object()? {
                if col.get("dtype")?.as_str()? != "f64" {
                    return None;
                }
                let bytes = base64(col.get("data")?.as_str()?)?;
                let len = col.get("len")?.as_u64()? as usize;
                if bytes.len() != len * 8 {
                    return None;
                }
                columns.insert(format!("{source}.{name}"), bytes);
            }
            return Some(Call::Batch {
                doc: doc()?,
                source,
                columns,
            });
        }
        "kit" => return Some(Call::Kit(Box::new(kit::KitCall::parse(c)?))),
        "manifest" => return Some(Call::Manifest),
        "catalog" => return Some(Call::Catalog),
        "golden" => {
            return Some(Call::Golden {
                fixture: c.get("fixture")?.as_str()?.to_string(),
                backend: backend(c)?,
            })
        }
        "record" => {
            return Some(Call::Record {
                via: acting(c)?,
                fixture: c.get("fixture")?.as_str()?.to_string(),
                backend: backend(c)?,
            })
        }
        "goldens" => {
            return Some(Call::Goldens {
                fixture: c.get("fixture")?.as_str()?.to_string(),
            })
        }
        "decide" => {
            return Some(Call::Decide {
                via: acting(c)?,
                decision: c.get("decision")?.clone(),
            })
        }
        "corpus_record" => {
            return Some(Call::CorpusRecord {
                corpus: PathBuf::from(c.get("corpus")?.as_str()?),
                name: c.get("name")?.as_str()?.to_string(),
                document: c.get("document")?.clone(),
                times: c
                    .get("times")?
                    .as_array()?
                    .iter()
                    .map(|t| flicks(t.as_str()?))
                    .collect::<Option<_>>()?,
            })
        }
        "compare_images" => {
            return Some(Call::CompareImages {
                expected: PathBuf::from(c.get("expected")?.as_str()?),
                actual: PathBuf::from(c.get("actual")?.as_str()?),
                tolerance: c.get("tolerance")?.clone(),
            })
        }
        "by_writer" => return Some(Call::ByWriter(doc()?)),
        "history" => {
            return Some(Call::History {
                doc: doc()?,
                item: c.get("item")?.as_str()?.to_string(),
            })
        }
        "read" => {
            let as_writer = match (c.get("session"), c.get("peer")) {
                (None, None) => None,
                (Some(_), None) => Some(via("deep_show", c)?),
                (None, Some(_)) => Some(via("deep show", c)?),
                _ => return None,
            };
            return Some(Call::Read {
                doc: doc()?,
                via: as_writer,
            });
        }
        _ => {}
    }
    let via = via(name, c)?;
    let body = match (c.get("document"), c.get("patch"), c.get("undo")) {
        (Some(_), None, None) => None,
        (None, Some(p), None) => Some(Body::Patch(p.clone())),
        (None, None, Some(u)) => Some(Body::Undo {
            patch: u.get("patch")?.as_str()?.to_string(),
            of: u.get("of")?.as_str()?.to_string(),
        }),
        _ => return None,
    };
    if let Some(body) = body {
        return Some(Call::Patch(Box::new(PatchCall {
            via,
            doc: doc()?,
            body,
        })));
    }
    let include = match c.get("include") {
        None => vec![Include::Issues],
        Some(v) => v
            .as_array()?
            .iter()
            .map(|i| match i.as_str()? {
                "issues" => Some(Include::Issues),
                "audit" => Some(Include::Audit),
                "timing" => Some(Include::Timing),
                "pixels" => Some(Include::Pixels),
                _ => None,
            })
            .collect::<Option<_>>()?,
    };
    let size = match c.get("size") {
        None => None,
        Some(v) => {
            let s: Vec<u16> = v
                .as_array()?
                .iter()
                .map(|n| {
                    n.as_u64()
                        .and_then(|n| u16::try_from(n).ok())
                        .filter(|n| (1..=8192).contains(n))
                })
                .collect::<Option<_>>()?;
            Some(<[u16; 2]>::try_from(s.as_slice()).ok()?)
        }
    };
    Some(Call::Show(Box::new(Show {
        via,
        doc: c.get("doc")?.as_str()?.to_string(),
        document: c.get("document")?.clone(),
        removes: strings(c.get("removes"))?,
        t: match c.get("t") {
            None => 0,
            Some(t) => flicks(t.as_str()?)?,
        },
        size,
        include,
        check: match c.get("check") {
            None => false,
            Some(b) => b.as_bool()?,
        },
        claim: match c.get("claim") {
            None => None,
            Some(h) => Some(h.as_str()?.to_string()),
        },
    })))
}

fn scenario(input: &Map<String, Value>) -> Option<Scenario> {
    let sessions = entries(input, "sessions", |s| {
        let p = s.get("process")?.as_object()?;
        Some(Session {
            thread: s.get("thread")?.as_str()?.to_string(),
            name: s.get("name")?.as_str()?.to_string(),
            process: (p.get("pid")?.as_u64()?, p.get("start")?.as_i64()?),
        })
    })?;
    let processes = match input.get("processes") {
        None => Vec::new(),
        Some(v) => v
            .as_array()?
            .iter()
            .map(|p| {
                Some(Process {
                    pid: p.get("pid")?.as_u64()?,
                    ppid: p.get("ppid")?.as_u64()?,
                    start: p.get("start")?.as_i64()?,
                })
            })
            .collect::<Option<_>>()?,
    };
    let panels = entries(input, "panels", |p| {
        Some(Panel {
            rect: rect(p.get("rect"))?,
            visible: match p.get("visible") {
                None => true,
                Some(v) => v.as_bool()?,
            },
        })
    })?;
    let docs = entries(input, "docs", |d| {
        Some(d.get("panel")?.as_str()?.to_string())
    })?;
    let seeds = entries(input, "docs", |d| Some(d.get("document").cloned()))?
        .into_iter()
        .filter_map(|(id, seed)| Some((id, seed?)))
        .collect();
    let quotas = entries(input, "quotas", |q| {
        let cap = |k: &str| match q.get(k) {
            None => Some(None),
            Some(v) => v.as_u64().and_then(|n| u32::try_from(n).ok()).map(Some),
        };
        let known = ["patches_per_s", "items", "msg_bytes", "docs"];
        if q.keys().any(|k| !known.contains(&k.as_str())) {
            return None;
        }
        Some(Quota {
            patches_per_s: cap("patches_per_s")?,
            items: cap("items")?,
            msg_bytes: cap("msg_bytes")?,
            docs: cap("docs")?,
        })
    })?;
    let clock = match input.get("clock") {
        None => None,
        Some(c) => {
            let n = |k: &str| c.get(k)?.as_i64().filter(|n| *n >= 0);
            let refresh_hz = n("refresh_hz").filter(|n| *n > 0)?;
            Some(Clock {
                refresh_hz,
                lead: n("lead")?,
                check: n("check")?,
            })
        }
    };
    let record = entries(input, "record", |o| {
        Some(RecordObject {
            session: match o.get("session")? {
                Value::Null => None,
                v => Some(v.as_str()?.to_string()),
            },
            state: match o.get("state") {
                None => None,
                Some(s) => Some(s.as_str()?.to_string()),
            },
            value: match o.get("value") {
                None => None,
                Some(n) => Some(n.as_f64()?),
            },
            as_of: match o.get("as_of") {
                None => None,
                Some(n) => Some(n.as_i64()?),
            },
        })
    })?;
    let claims = entries(input, "claims", |c| {
        c.get("session")?.as_str()?;
        Some(Claim {
            deliverables: strings(c.get("deliverables"))?,
        })
    })?;
    let window = match input.get("window") {
        None => None,
        Some(w) => {
            let r = rect(Some(&json!([0, 0, w.get(0)?, w.get(1)?])))?;
            Some([r[2], r[3]])
        }
    };
    let card = match input.get("card") {
        None => None,
        Some(c) => Some(Card {
            question: c.get("question")?.as_str()?.to_string(),
            options: c
                .get("options")?
                .as_array()?
                .iter()
                .map(|o| o.get("label")?.as_str().map(str::to_string))
                .collect::<Option<_>>()?,
            rect: rect(c.get("rect"))?,
        }),
    };
    let commit_fault = match input.get("fault") {
        Some(f) if f.get("kill_after_layer_file").is_some() => Some(
            CommitFault::KillAfterLayerFile(f.get("kill_after_layer_file")?.as_str()?.to_string()),
        ),
        Some(f) if f.get("layer_file_fails").is_some() => Some(CommitFault::LayerFileFails(
            f.get("layer_file_fails")?.as_str()?.to_string(),
        )),
        _ => None,
    };
    let fault = match input.get("fault") {
        None => None,
        Some(_) if commit_fault.is_some() => None,
        Some(f) => Some(HoldFault {
            holds: match f.get("holds")?.as_str()? {
                "fallback_pipeline" => Hold::FallbackPipeline,
                "rebuild_queue" => Hold::RebuildQueue,
                "asset_decode" => Hold::AssetDecode,
                _ => return None,
            },
            ms: f.get("ms")?.as_u64()?,
        }),
    };
    let planted = match input.get("planted") {
        None => None,
        Some(p) => Some(match p.as_str()? {
            "presents_unnamed_removal" => Planted::PresentsUnnamedRemoval,
            "diffs_items_only" => Planted::DiffsItemsOnly,
            "inlines_every_issue" => Planted::InlinesEveryIssue,
            "cuts_without_truncated" => Planted::CutsWithoutTruncated,
            "sorts_by_order_key_alone" => Planted::SortsByOrderKeyAlone,
            "reply_without_digest" => Planted::ReplyWithoutDigest,
            "reads_wasm_bytes" => Planted::ReadsWasmBytes,
            "rebase_counts_op_targets_only" => Planted::RebaseCountsOpTargetsOnly,
            "diffs_whole_document" => Planted::DiffsWholeDocument,
            "one_fifo_check_queue" => Planted::OneFifoCheckQueue,
            "newest_layer_file_current" => Planted::NewestLayerFileCurrent,
            "seeds_noise_from_clock" => Planted::SeedsNoiseFromClock,
            "key_without_locale" => Planted::KeyWithoutLocale,
            "key_without_reduced_motion" => Planted::KeyWithoutReducedMotion,
            "key_hashes_positions" => Planted::KeyHashesPositions,
            "key_without_params" => Planted::KeyWithoutParams,
            "refusal_without_code" => Planted::RefusalWithoutCode,
            "refused_patch_writes" => Planted::RefusedPatchWrites,
            "dry_run_skips_recheck" => Planted::DryRunSkipsRecheck,
            "undo_reorder_mints_key" => Planted::UndoReorderMintsKey,
            "apply_time_order_keys" => Planted::ApplyTimeOrderKeys,
            "incremental_check_skips_referrers" => Planted::IncrementalCheckSkipsReferrers,
            "rebase_by_path" => Planted::RebaseByPath,
            "fuzzer_runs_none" => Planted::FuzzerRunsNone,
            "part_runs_half" => Planted::PartRunsHalf,
            "exit_zero_with_failed_case" => Planted::ExitZeroWithFailedCase,
            "counts_declared_as_reached" => Planted::CountsDeclaredAsReached,
            "skips_snapshot_comparison" => Planted::SkipsSnapshotComparison,
            "checks_expected_code_only" => Planted::ChecksExpectedCodeOnly,
            "accepts_agent_decisions" => Planted::AcceptsAgentDecisions,
            "every_digest_positive" => Planted::EveryDigestPositive,
            "checks_share_only" => Planted::ChecksShareOnly,
            _ => return None,
        }),
    };
    let u32_field = |k: &str| match input.get(k) {
        None => Some(None),
        Some(n) => n.as_u64().and_then(|n| u32::try_from(n).ok()).map(Some),
    };
    let epoch_start = u32_field("epoch_start")?;
    let shuffle = u32_field("shuffle")?;
    let environment = match input.get("environment") {
        None => Map::new(),
        Some(e) => {
            let e = e.as_object()?;
            if e.iter()
                .any(|(k, v)| !matches!(k.as_str(), "os" | "driver") || !v.is_string())
            {
                return None;
            }
            e.clone()
        }
    };
    let list = input.get("calls")?.as_array()?;
    let calls = list
        .iter()
        .map(|c| call(c.as_object()?))
        .collect::<Option<_>>()?;
    // On the clock every call says when it arrives.
    let at = list
        .iter()
        .map(|c| match (c.get("at"), &clock) {
            (Some(t), Some(_)) => t.as_i64().filter(|t| *t >= 0),
            (None, None) => Some(0),
            _ => None,
        })
        .collect::<Option<_>>()?;
    Some(Scenario {
        evidence: PathBuf::from(input.get("evidence")?.as_str()?),
        sessions,
        processes,
        panels,
        docs,
        record,
        claims,
        window,
        card,
        fault,
        planted,
        calls,
        at,
        seeds,
        state: match input.get("state") {
            None => None,
            Some(s) => Some(PathBuf::from(s.as_str()?)),
        },
        quotas,
        clock,
        commit_fault,
        epoch_start: epoch_start.unwrap_or(0),
        shuffle,
        goldens: match input.get("goldens") {
            None => None,
            Some(g) => Some(PathBuf::from(g.as_str()?)),
        },
        environment,
        commit: match input.get("commit") {
            None => None,
            Some(c) => Some(c.as_str()?.to_string()),
        },
    })
}

fn answer(command: &str, startup: &Startup, line: &str) -> Value {
    // A number past f64's range is the document's fault, refused at its path by the check
    // (#387: "a NaN or an infinity in a param is refused with out_of_range"), not the line's.
    let parsed = serde_json::from_str::<Value>(line).or_else(|e| match tame_overflow(line) {
        Some(tamed) => serde_json::from_str::<Value>(&tamed),
        None => Err(e),
    });
    let Ok(Value::Object(input)) = parsed else {
        return bad_input();
    };
    let Some(scenario) = scenario(&input) else {
        return bad_input();
    };
    match command {
        "run" => {
            let replies = hub::Hub::new(&scenario, startup).run_calls();
            json!({"ok": true, "replies": replies})
        }
        "screen" => {
            let (Some(out), Some(_)) = (input.get("out").and_then(Value::as_str), scenario.window)
            else {
                return bad_input();
            };
            screen(&scenario, startup, out)
        }
        _ => bad_input(),
    }
}

#[cfg(target_os = "macos")]
fn screen(scenario: &Scenario, startup: &Startup, out: &str) -> Value {
    let mut hub = hub::Hub::new(scenario, startup);
    let replies = hub.run_calls();
    window::draw(&mut hub, replies, out)
}

#[cfg(not(target_os = "macos"))]
fn screen(_: &Scenario, _: &Startup, _: &str) -> Value {
    json!({"ok": false, "code": "unsupported_platform"})
}

// The build set this binary holds, one of its Cargo features (#305: Registry and seal:
// `build_set`); `full` is the default, so a plain build is the full set.
#[cfg(not(any(feature = "core", feature = "r1", feature = "r2", feature = "full")))]
compile_error!("deep-show needs one build-set feature: core, r1, r2 or full");
#[cfg(any(
    all(feature = "core", feature = "r1"),
    all(feature = "core", feature = "r2"),
    all(feature = "core", feature = "full"),
    all(feature = "r1", feature = "r2"),
    all(feature = "r1", feature = "full"),
    all(feature = "r2", feature = "full"),
))]
compile_error!("deep-show takes one build-set feature, not two: core, r1, r2 or full");

fn build_set() -> BuildSet {
    if cfg!(feature = "full") {
        BuildSet::Full
    } else if cfg!(feature = "r2") {
        BuildSet::R2
    } else if cfg!(feature = "r1") {
        BuildSet::R1
    } else {
        BuildSet::Core
    }
}

/// Whether this build holds a test canvas module: a test build, which logs every read every
/// operator makes (#387).
const TEST_BUILD: bool = cfg!(any(
    feature = "test-a",
    feature = "test-b",
    feature = "test-b-requires-a",
    feature = "test-two-writers",
    feature = "test-later-phase",
    feature = "test-cycle",
    feature = "test-missing-dep",
    feature = "test-accent",
    feature = "test-peek",
    feature = "test-up-1-0",
    feature = "test-up-1-1",
    feature = "test-nudge",
    feature = "test-step",
    feature = "test-step-renamed",
    feature = "test-step-cycle",
    feature = "test-scatter",
    feature = "test-kit",
));

/// The canvas modules this build compiles in: the shipped set's (R1's canvas laid out as the
/// text, look, marks2d and motion modules, #387; every build set holds them, since R1's kinds
/// are what the core draws) and, under its `test-*` features, the #305 and #387 acceptance
/// READMEs' test canvas modules.
fn modules() -> Vec<Module> {
    #[allow(unused_mut)]
    let mut out: Vec<Module> = vec![
        deep_canvas_marks::modules::text(),
        deep_canvas_marks::modules::look(),
        deep_canvas_marks::modules::marks2d(),
        deep_canvas_motion::module::module(),
    ];
    #[cfg(feature = "test-accent")]
    out.push(planted::accent());
    #[cfg(feature = "test-peek")]
    out.push(deep_canvas_test_modules::peek());
    #[cfg(feature = "test-up-1-0")]
    out.push(deep_canvas_test_modules::up_1_0());
    #[cfg(feature = "test-up-1-1")]
    out.push(deep_canvas_test_modules::up_1_1());
    #[cfg(feature = "test-nudge")]
    out.push(deep_canvas_test_modules::nudge());
    #[cfg(feature = "test-step")]
    out.extend(deep_canvas_test_modules::steps());
    #[cfg(feature = "test-step-renamed")]
    out.extend(deep_canvas_test_modules::steps_renamed());
    #[cfg(feature = "test-step-cycle")]
    out.extend(deep_canvas_test_modules::steps_cycle());
    #[cfg(feature = "test-scatter")]
    out.push(deep_canvas_test_modules::scatter());
    #[cfg(feature = "test-a")]
    out.push(deep_canvas_test_modules::a());
    #[cfg(feature = "test-b")]
    out.push(deep_canvas_test_modules::b());
    #[cfg(feature = "test-b-requires-a")]
    out.push(deep_canvas_test_modules::b_requires_a());
    #[cfg(feature = "test-two-writers")]
    out.extend(deep_canvas_test_modules::two_writers());
    #[cfg(feature = "test-later-phase")]
    out.push(deep_canvas_test_modules::later_phase());
    #[cfg(feature = "test-cycle")]
    out.extend(deep_canvas_test_modules::cycle());
    #[cfg(feature = "test-missing-dep")]
    out.push(deep_canvas_test_modules::missing_dep());
    out.extend(kit::modules::built());
    out
}

/// Registers the build's canvas modules in sorted name order and seals, timing both; the
/// planted seal (`--planted treats_every_dependency_required`) is the criterion's wrong program.
fn seal(planted: Option<StartPlanted>) -> Result<Startup, SealError> {
    let started = Instant::now();
    hub::SEAL_RUNS.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    let mut registry = Registry::new(build_set());
    for module in modules() {
        registry = registry.with(module);
    }
    if let Some(StartPlanted::Seal(fault)) = planted {
        registry = registry.plant(fault);
    }
    let sealed = registry.seal()?;
    kit::ledger::admit(&sealed)?;
    Ok(Startup {
        sealed,
        seal_ms: started.elapsed().as_secs_f64() * 1000.0,
        steps_by_name: planted == Some(StartPlanted::StepsByName),
        test_build: TEST_BUILD,
    })
}

/// A wrong program reachable only through the startup argument `--planted`: #305's seal that
/// reads every dependency as required, or #387's scheduler that orders steps at one time by
/// canvas-module name.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum StartPlanted {
    Seal(Fault),
    StepsByName,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_seal_in_the_process_counts() {
        use std::sync::atomic::Ordering;
        let before = hub::SEAL_RUNS.load(Ordering::Relaxed);
        seal(None).expect("the shipped set seals");
        seal(None).expect("the shipped set seals");
        assert_eq!(hub::SEAL_RUNS.load(Ordering::Relaxed) - before, 2);
    }

    #[test]
    fn every_shared_document_reply_is_stamped_on_the_clock_too() {
        // The clocked check queue builds a patch's reply itself, not through `Hub::call`.
        // `seal()` is not called here: the seal-count test counts its runs.
        let startup = Startup {
            sealed: deep_canvas::registry::core(),
            seal_ms: 0.0,
            steps_by_name: false,
            test_build: false,
        };
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
            let mut registry = Registry::new(set);
            for module in modules() {
                registry = registry.with(module);
            }
            let published = registry.seal().expect("the shipped set seals").schedule();
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
    fn run_takes_planted_and_nothing_else() {
        let args = |a: &[&str]| a.iter().map(|s| s.to_string()).collect::<Vec<_>>();
        assert!(matches!(planted_arg(&args(&["run"])), Ok(None)));
        assert!(matches!(
            planted_arg(&args(&[
                "run",
                "--planted",
                "treats_every_dependency_required"
            ])),
            Ok(Some(StartPlanted::Seal(Fault::EveryDependencyRequired)))
        ));
        assert!(matches!(
            planted_arg(&args(&["run", "--planted", "orders_steps_by_name"])),
            Ok(Some(StartPlanted::StepsByName))
        ));
        let twin = "treats_every_dependency_required";
        for stray in [
            &["run", "extra"][..],
            &["run", "--planted"],
            &["run", "--planted", "nonsense"],
            &["run", "--planted", twin, "extra"],
            &["run", "--planted", twin, "--planted", twin],
        ] {
            assert!(planted_arg(&args(stray)).is_err(), "{stray:?}");
        }
    }

    #[test]
    fn core_version_is_the_canvas_crates_version() {
        let manifest = include_str!("../../deep-canvas/Cargo.toml");
        let line = format!("version = \"{}\"", deep_canvas::registry::CORE_VERSION);
        assert!(manifest.lines().any(|l| l.trim() == line), "{line}");
        // The seal parses it at startup; a pre-release tag would need `Semver` to carry one.
        assert!(
            deep_canvas::registry::Semver::parse(deep_canvas::registry::CORE_VERSION).is_some()
        );
    }
}

/// The seal's planted twin from the arguments after the command: none, or
/// `--planted <name>` and nothing else; an unknown name or a stray argument is bad input.
fn planted_arg(args: &[String]) -> Result<Option<StartPlanted>, ()> {
    match args.get(1..).unwrap_or_default() {
        [] => Ok(None),
        [flag, twin] if flag == "--planted" && twin == "treats_every_dependency_required" => {
            Ok(Some(StartPlanted::Seal(Fault::EveryDependencyRequired)))
        }
        [flag, twin] if flag == "--planted" && twin == "orders_steps_by_name" => {
            Ok(Some(StartPlanted::StepsByName))
        }
        _ => Err(()),
    }
}

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let command = args.first().cloned().unwrap_or_default();
    let stdout = io::stdout();
    let mut out = stdout.lock();
    let Ok(fault) = planted_arg(&args) else {
        let _ = writeln!(out, "{}", bad_input());
        std::process::exit(2);
    };
    // The seal runs before the first line is read: a refused set answers no scenario.
    let startup = match seal(fault) {
        Ok(startup) => startup,
        Err(err) => {
            let line = json!({
                "ok": false,
                "code": "seal_refused",
                "reason": err.code,
                "modules": err.modules,
                "arrays": err.arrays,
                "what": err.what,
            });
            let _ = writeln!(out, "{line}");
            let _ = out.flush();
            std::process::exit(2);
        }
    };
    let stdin = io::stdin();
    for line in stdin.lock().lines() {
        let Ok(line) = line else { break };
        let reply = answer(&command, &startup, &line);
        let _ = writeln!(out, "{reply}");
        let _ = out.flush();
    }
}

#[cfg(target_os = "macos")]
mod window;

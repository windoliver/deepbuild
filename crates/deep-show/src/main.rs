//! `deep-show <run | screen | live>`: JSON lines in, one JSON line out per input line, in order, exit 0
//! (`live` answers its first line, holds its window, then exits);
//! a line that can't be read, lacks a required field or names an unknown `planted` value answers
//! `{"ok":false,"code":"bad_input"}`, before anything platform-specific. The surface is the #393
//! acceptance README's: `run` plays a scenario of deep_show and `deep show` calls against the
//! hub's canvas side and answers each call; `screen` also draws the window those calls leave, by
//! band with the question card last, through GPUI's offscreen Metal renderer (macOS only; off
//! macOS it answers `{"ok":false,"code":"unsupported_platform"}`).

mod access;
mod ask;
mod audio;
mod bake;
mod capture;
mod costs;
mod determinism;
mod efficiency;
mod evidence;
mod export;
mod familiar;
mod film;
mod film_audit;
mod film_layout;
mod film_viewer;
mod frames;
mod function;
mod gate;
mod generated;
mod geometry;
mod geometry_audit;
mod golden;
mod host;
mod hub;
mod input;
mod jobs;
mod kept;
mod kinds;
mod kit;
mod lengths;
mod logic;
mod media;
mod mixdown;
mod modes;
mod narration;
mod packs;
mod physics;
mod picks;
mod placement;
#[cfg(feature = "test-accent")]
mod planted;
mod played;
mod print;
mod probe;
mod query;
mod registries;
mod retired;
mod ring;
mod runs;
mod sandbox;
mod scene3d;
mod seams;
mod serve;
mod shaper;
mod shared;
mod snapshot;
mod spatial;
mod spawn;
mod stepped;
mod terminal;
mod terrain;
#[cfg(feature = "test-machines")]
mod test_machines;
mod test_registries;
#[cfg(feature = "test-sim")]
mod test_sim;
#[cfg(feature = "test-threads")]
mod test_threads;
mod time;
#[cfg(any(
    feature = "test-json",
    feature = "test-debug-digest",
    feature = "test-accent",
    feature = "test-threads",
    feature = "test-scene3d-tie-by-order",
    feature = "test-scene3d-reads-vector"
))]
mod twins;
mod verdict;
mod video;
mod workers;

/// Every heap allocation the process makes while [`count_allocations`] runs, counted so the
/// `frames` call can read how many the scheduler made in a frame (#387: "the scheduler
/// allocates nothing per frame after warm-up"). Outside it nothing is counted, so the kit's
/// threads, which allocate on every core at once, don't all contend for one counter.
struct Counting;

static COUNTING_ON: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);
static ALLOCATIONS: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);

fn count() {
    if COUNTING_ON.load(std::sync::atomic::Ordering::Relaxed) {
        ALLOCATIONS.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    }
}

// SAFETY: every call forwards to the system allocator unchanged; the counter is a relaxed atomic.
unsafe impl std::alloc::GlobalAlloc for Counting {
    unsafe fn alloc(&self, layout: std::alloc::Layout) -> *mut u8 {
        count();
        unsafe { std::alloc::System.alloc(layout) }
    }

    unsafe fn dealloc(&self, ptr: *mut u8, layout: std::alloc::Layout) {
        unsafe { std::alloc::System.dealloc(ptr, layout) }
    }

    unsafe fn alloc_zeroed(&self, layout: std::alloc::Layout) -> *mut u8 {
        count();
        unsafe { std::alloc::System.alloc_zeroed(layout) }
    }

    unsafe fn realloc(&self, ptr: *mut u8, layout: std::alloc::Layout, new_size: usize) -> *mut u8 {
        count();
        unsafe { std::alloc::System.realloc(ptr, layout, new_size) }
    }
}

#[global_allocator]
static COUNTING: Counting = Counting;

/// What `f` returns and how many heap allocations the process made while it ran.
pub fn count_allocations<T>(f: impl FnOnce() -> T) -> (T, u64) {
    use std::sync::atomic::Ordering::Relaxed;
    let before = ALLOCATIONS.load(Relaxed);
    COUNTING_ON.store(true, Relaxed);
    let out = f();
    COUNTING_ON.store(false, Relaxed);
    (out, ALLOCATIONS.load(Relaxed) - before)
}

use std::collections::BTreeMap;
use std::io::{self, BufRead, Write};
use std::path::PathBuf;
use std::time::Instant;

use deep_canvas::cost::{self, Coefficients};
use deep_canvas::registry::{BuildSet, Fault, Module, Registry, SealError};
use deep_canvas::schedule::HashVersion;
use serde_json::{json, Map, Value};

use hub::{
    flicks, Body, Call, Card, Claim, Eval, Fault as HoldFault, Hold, Include, Panel, PatchCall,
    Planted, PressPhase, Process, RecordObject, Requirement, Scenario, Session, Show, Slot,
    Startup, Via,
};
use shared::{Clock, CommitFault, Quota};

fn bad_input() -> Value {
    json!({"ok": false, "code": "bad_input"})
}

/// A refusal's code.
fn refused(code: &str) -> Value {
    json!({"code": code})
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

/// An optional field as `read` takes it: `Some(None)` when it's absent, `None` when `read` refuses it.
pub(crate) fn optional<T>(
    value: Option<&Value>,
    read: impl FnOnce(&Value) -> Option<T>,
) -> Option<Option<T>> {
    value.map_or(Some(None), |v| read(v).map(Some))
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

/// An optional `[w, h]` in whole px, each one `ok` keeps; absent is `Some(None)`.
fn px_size(value: Option<&Value>, ok: impl Fn(&u16) -> bool) -> Option<Option<[u16; 2]>> {
    let Some(v) = value else {
        return Some(None);
    };
    let s: Vec<u16> = v
        .as_array()?
        .iter()
        .map(|n| n.as_u64().and_then(|n| u16::try_from(n).ok()).filter(&ok))
        .collect::<Option<_>>()?;
    Some(Some(<[u16; 2]>::try_from(s.as_slice()).ok()?))
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

/// A `deep_query` call (#411 acceptance README: deep_query): the agent's, bound to its session,
/// or a check plug-in's, with its package ID and the documents its grant covers.
fn query_call(c: &Map<String, Value>) -> Option<query::Query> {
    let plugin = match c.get("plugin") {
        None => None,
        Some(p) => Some(query::Plugin {
            id: p.get("id")?.as_str()?.to_string(),
            docs: strings(p.get("docs"))?,
        }),
    };
    let via = match (&plugin, c.get("session")) {
        (Some(_), None) => hub::Via::Mcp(None),
        _ => via("deep_show", c)?,
    };
    let what = match c.get("what").map(Value::as_str) {
        None | Some(Some("rows")) => query::What::Rows,
        Some(Some("summary")) => query::What::Summary,
        Some(Some("why")) => query::What::Why,
        _ => return None,
    };
    let items = match c.get("items") {
        None => None,
        v => Some(strings(v)?),
    };
    let at = match c.get("at") {
        None => Vec::new(),
        Some(v) => v
            .as_array()?
            .iter()
            .map(|t| flicks(t.as_str()?))
            .collect::<Option<_>>()?,
    };
    let none_of_kind = match c.get("expect") {
        None => None,
        Some(e) => Some(e.get("none")?.get("kind")?.as_str()?.to_string()),
    };
    Some(query::Query {
        via,
        plugin,
        doc: c.get("doc")?.as_str()?.to_string(),
        rev: match c.get("rev") {
            None => None,
            Some(r) => Some(r.as_u64()?),
        },
        what,
        items,
        paths: strings(c.get("paths"))?,
        at,
        cap: match c.get("cap") {
            None => query::DEFAULT_CAP,
            Some(n) => usize::try_from(n.as_u64()?).ok()?,
        },
        // #412: where the page an earlier answer cut at 64 KB left off.
        cursor: optional(c.get("cursor"), |n| n.as_str()?.parse().ok())?.unwrap_or(0),
        none_of_kind,
        path: match c.get("path") {
            None => None,
            Some(p) => Some(p.as_str()?.to_string()),
        },
        track: optional(c.get("track"), |t| t.as_array().cloned())?.unwrap_or_default(),
        t: match c.get("t") {
            None => 0,
            Some(t) => flicks(t.as_str()?)?,
        },
    })
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
    if let Some(g) = gate::parse_call(name, c) {
        return Some(Call::Gate(Box::new(g)));
    }
    let doc = || Some(c.get("doc")?.as_str()?.to_string());
    let time = |key: &str, default: i64| -> Option<i64> {
        match c.get(key) {
            None => Some(default),
            Some(t) => flicks(t.as_str()?),
        }
    };
    let flag = |k: &str| match c.get(k) {
        None => Some(false),
        Some(b) => b.as_bool(),
    };
    match name {
        "revisions" => return Some(Call::Revisions(doc()?)),
        "session" => {
            return Some(Call::Session {
                doc: doc()?,
                set: c.get("set").cloned().filter(Value::is_object),
            })
        }
        "frame_hash" => {
            let frames = c.get("frames")?.as_array()?.iter().map(|f| {
                let size = f.get("size")?.as_array().filter(|a| a.len() == 2)?;
                let w = u32::try_from(size[0].as_u64()?).ok()?;
                let h = u32::try_from(size[1].as_u64()?).ok()?;
                Some(([w, h], f.get("bytes")?.as_str()?.to_string()))
            });
            return Some(Call::FrameHash {
                frames: frames.collect::<Option<_>>()?,
                software: match c.get("adapter") {
                    None => false,
                    Some(a) => a.as_str()? == "software",
                },
            });
        }
        "pixel_hash" => {
            let frames = c.get("frames")?.as_array()?.iter().map(|f| {
                let size = f.get("size")?.as_array().filter(|a| a.len() == 2)?;
                let w = u32::try_from(size[0].as_u64()?).ok()?;
                let h = u32::try_from(size[1].as_u64()?).ok()?;
                let format = deep_gpu::pixel_hash::Format::named(f.get("format")?.as_str()?)?;
                Some(([w, h], format, f.get("bytes")?.as_str()?.to_string()))
            });
            return Some(Call::PixelHash(frames.collect::<Option<_>>()?));
        }
        "cross_machine" => {
            let a = c.get("audio")?.as_array().filter(|a| a.len() == 2)?;
            return Some(Call::CrossMachine([
                a[0].as_str()?.to_string(),
                a[1].as_str()?.to_string(),
            ]));
        }
        "input" => {
            return Some(Call::Input {
                panel: c.get("panel")?.as_str()?.to_string(),
                event: input::event(c.get("event")?)?,
                t: optional(c.get("event")?.get("t"), Value::as_i64)?,
            })
        }
        "scope" => return Some(Call::Scope(c.get("panel")?.as_str()?.to_string())),
        "presented" => return Some(Call::Presented(c.get("panel")?.as_str()?.to_string())),
        "pop_out" => {
            return Some(Call::PopOut {
                panel: c.get("panel")?.as_str()?.to_string(),
                display: c.get("display")?.as_str()?.to_string(),
                serial: optional(c.get("serial"), Value::as_u64)?,
                full_screen: optional(c.get("full_screen"), Value::as_bool)?.unwrap_or(false),
                agent: acting(c)?.is_some(),
            })
        }
        "move_window" => {
            return Some(Call::MoveWindow {
                window: c.get("window")?.as_str()?.to_string(),
                rect: rect(c.get("rect"))?,
                agent: acting(c)?.is_some(),
            })
        }
        "activate" => {
            return Some(Call::Activate {
                window: match c.get("window")? {
                    Value::Null => None,
                    w => Some(w.as_str()?.to_string()),
                },
                agent: acting(c)?.is_some(),
            })
        }
        "thermal" => {
            return Some(Call::Thermal {
                hot: match c.get("state")?.as_str()? {
                    "nominal" | "fair" => false,
                    "serious" | "critical" => true,
                    _ => return None,
                },
                agent: acting(c)?.is_some(),
            })
        }
        "hide_window" => {
            return Some(Call::HideWindow {
                window: c.get("window")?.as_str()?.to_string(),
                hidden: c.get("hidden")?.as_bool()?,
                agent: acting(c)?.is_some(),
            })
        }
        "frontmost" => {
            return Some(Call::Frontmost {
                window: c.get("window")?.as_str()?.to_string(),
                front: c.get("frontmost")?.as_bool()?,
                agent: acting(c)?.is_some(),
            })
        }
        "test_window" => {
            c.get("id")?.as_str()?;
            match c.get("rect")? {
                Value::Null => {}
                r => {
                    rect(Some(r))?;
                }
            }
            return Some(Call::TestWindow);
        }
        "window_caps" => return Some(Call::WindowCaps),
        "windows" => return Some(Call::Windows),
        "layout" => return Some(Call::Layout),
        "card" => return Some(Call::CardState),
        "press" => {
            if c.get("source")?.as_str()? != "hid" {
                return None;
            }
            return Some(Call::Press {
                t: c.get("t")?.as_i64().filter(|t| *t >= 0)?,
                phase: match c.get("phase")?.as_str()? {
                    "down" => PressPhase::Down,
                    "up" => PressPhase::Up,
                    "repeat" => PressPhase::Repeat,
                    _ => return None,
                },
                option: c.get("option")?.as_str()?.to_string(),
            });
        }
        "rearm" => {
            let on = c.get("on")?.as_str()?;
            if ![
                "content",
                "move",
                "resize",
                "occluded",
                "display",
                "activation",
            ]
            .contains(&on)
            {
                return None;
            }
            return Some(Call::Rearm(on.to_string()));
        }
        "see" => return Some(Call::See(c.get("panel")?.as_str()?.to_string())),
        "view" => return Some(Call::View(c.get("panel")?.as_str()?.to_string())),
        "viewer" => return Some(Call::Viewer(c.get("panel")?.as_str()?.to_string())),
        "ask" => {
            let pointer = optional(c.get("pointer"), input::point)?;
            return Some(Call::Ask {
                panel: c.get("panel")?.as_str()?.to_string(),
                session: c.get("session")?.as_str()?.to_string(),
                words: c.get("words")?.as_str()?.to_string(),
                pointer,
            });
        }
        "messages" => return Some(Call::Messages(c.get("session")?.as_str()?.to_string())),
        "render_back" => {
            return Some(Call::RenderBack {
                session: c.get("session")?.as_str()?.to_string(),
                doc: doc()?,
                // #140: `t` in flicks, or the time grammar's text; at 0 when it is left out.
                t: match c.get("t") {
                    None => Some(0),
                    Some(Value::String(text)) => hub::flicks(text),
                    Some(t) => t.as_i64(),
                }
                .filter(|t| *t >= 0)?,
                rev: c.get("rev")?.as_u64()?,
                size: px_size(c.get("size"), |n| *n > 0)?,
                probes: probe::parse(c)?,
            });
        }
        "screen" => return Some(Call::Screen),
        "registry" => return Some(Call::Registry),
        "geometry" => return geometry::parse(c).map(|g| Call::Geometry(Box::new(g))),
        "kinds" => return Some(Call::KindSchemas),
        "spatial" => return spatial::parse(c).map(|s| Call::Spatial(Box::new(s))),
        "logic" => return picks::parse(c).map(|l| Call::Logic(Box::new(l))),
        "terrain_rays" => return terrain::parse(c).map(|r| Call::TerrainRays(Box::new(r))),
        "packs" => return Some(Call::Packs),
        "install_pack" => {
            return Some(Call::InstallPack {
                id: c.get("id")?.as_str()?.to_string(),
                dir: PathBuf::from(c.get("dir")?.as_str()?),
                session: optional(c.get("session"), |s| Some(s.as_str()?.to_string()))?,
            })
        }
        "uninstall_pack" => {
            return Some(Call::UninstallPack {
                id: c.get("id")?.as_str()?.to_string(),
                version: c.get("version")?.as_str()?.to_string(),
            })
        }
        "registries" => return Some(Call::Registries),
        // #490: the closed function list's point and interval forms, and their search.
        "fn" => return Some(Call::Fn(Box::new(c.clone()))),
        "path" => {
            return Some(Call::Path {
                doc: doc()?,
                item: c.get("item")?.as_str()?.to_string(),
            })
        }
        // #412: deep_kinds checks its own fields, so each refusal is error@2 at its path. It arrives on
        // the clock at `arrives`, never one of its fields (#1718), so the check never sees it.
        "deep_kinds" => {
            let mut args = c.clone();
            args.remove("arrives");
            return Some(Call::Kinds(Value::Object(args)));
        }
        "sandbox" => return Some(Call::Sandbox),
        "provided" => return Some(Call::Provided(c.get("doc")?.as_str()?.to_string())),
        "validate" => {
            return Some(Call::Validate {
                layout: c.get("layout")?.as_str()?.to_string(),
                path: PathBuf::from(c.get("path")?.as_str()?),
            })
        }
        "resolve" if c.get("registry").is_some() => {
            return Some(Call::Lookup {
                doc: doc()?,
                registry: c.get("registry")?.as_str()?.to_string(),
                name: c.get("name")?.as_str()?.to_string(),
                runs: optional(c.get("runs"), |n| {
                    n.as_u64().filter(|n| (1..=100_000).contains(n))
                })?
                .unwrap_or(0) as usize,
            })
        }
        "costs" => return Some(Call::Costs),
        "migrate" => return Some(Call::Migrate(hash_named(c.get("to")?.as_str()?)?)),
        // #1901: the fingerprint kept output is keyed by, a kept draw, and the padded key input.
        "fingerprint" => return Some(Call::Fingerprint),
        "draw" => {
            let output = c.get("output")?.as_str()?;
            return Some(Call::Draw {
                doc: doc()?,
                t: crate::time::eval_time(c.get("t"))?,
                output: kept::OUTPUTS.into_iter().find(|o| *o == output)?,
            });
        }
        "padded_key" => {
            let seeds = c.get("seeds")?.as_array().filter(|s| s.len() == 2)?;
            return Some(Call::PaddedKey {
                fields: c.get("fields")?.as_u64()?,
                seeds: [seeds[0].as_u64()?, seeds[1].as_u64()?],
            });
        }
        "keys" => {
            return Some(Call::Keys {
                doc: doc()?,
                runs: c.get("runs")?.as_u64().filter(|n| (1..=1000).contains(n))? as usize,
            })
        }
        "fixtures" => return Some(Call::Fixtures),
        "seam_suite" => return seams::parse(c),
        "relay_client" => return seams::parse_client(c),
        "schedule" => return Some(Call::Schedule),
        "golden_record" | "golden_verify" => {
            return golden::parse(name, c).map(Call::RuntimeGolden)
        }
        "rate" | "time" | "export" | "play" | "determinism" => {
            return crate::time::parse_call(name, c)
        }
        "eval" => {
            let view = match c.get("view") {
                None => Map::new(),
                Some(v) => v.as_object()?.clone(),
            };
            if view.keys().any(|k| k != "locale" && k != "reduced_motion") {
                return None;
            }
            return Some(Call::Eval(Box::new(Eval {
                debug_text: flag("debug_text")?,
                doc: doc()?,
                t: crate::time::eval_time(c.get("t"))?,
                view,
                clean: flag("clean")?,
                perturb: optional(c.get("perturb"), |p| Some(p.as_str()?.to_string()))?,
                pixels: flag("pixels")?,
                film: flag("film")?,
                size: px_size(c.get("size"), |_| true)?,
                arrays: optional(c.get("arrays"), query::names)?.unwrap_or_default(),
                paths: optional(c.get("paths"), query::names)?.unwrap_or_default(),
                track: optional(c.get("track"), |t| t.as_array().cloned())?,
            })));
        }
        "frames" => {
            // #856: a whole revision arriving at a frame's latch.
            let revise = match c.get("revise") {
                None => None,
                Some(r) => Some((
                    r.get("frame")?.as_u64()? as usize,
                    r.get("document")?.clone(),
                )),
            };
            return Some(Call::Frames(Box::new(crate::hub::Frames {
                doc: doc()?,
                count: c.get("count")?.as_u64()?.min(100_000) as usize,
                from: time("from", 0)?,
                step: time("step", flicks("1/60s").unwrap_or(11_760_000))?,
                paced: flag("paced")?,
                revise,
                pixels: flag("pixels")?,
            })));
        }
        "settle" => {
            let via = match c.get("session")? {
                Value::String(s) => Via::Mcp(Some(s.clone())),
                _ => return None,
            };
            return Some(Call::Settle(Box::new(efficiency::Settle {
                via,
                doc: doc()?,
                patches: c.get("patches")?.as_array()?.clone(),
            })));
        }
        // #854's perf lane reads the core directly, bound to no session or plug-in: the summary or a
        // paged read. Every other deep_query is #411's, the agent's or a check plug-in's.
        "deep_query" if c.get("session").is_some() || c.get("plugin").is_some() => {
            return query_call(c).map(|q| Call::SceneQuery(Box::new(q)));
        }
        "deep_query" => {
            let page = match c.get("page") {
                None => None,
                Some(p) => Some((
                    p.get("limit")?.as_u64()? as usize,
                    match p.get("after") {
                        None | Some(Value::Null) => None,
                        Some(a) => Some(a.as_str()?.to_string()),
                    },
                )),
            };
            return Some(Call::Query(efficiency::Query { doc: doc()?, page }));
        }
        "shaped_runs" => {
            return Some(Call::ShapedRuns(c.get("text")?.as_str()?.to_string()));
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
                if len.checked_mul(8) != Some(bytes.len()) {
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
        "verdict" => return Some(Call::Verdict(c.get("claim")?.as_str()?.to_string())),
        "verdicts" => return Some(Call::Verdicts(c.get("claim")?.as_str()?.to_string())),
        "answer" => {
            return Some(Call::Answer {
                via: acting(c)?,
                claim: c.get("claim")?.as_str()?.to_string(),
                requirement: c.get("requirement")?.as_str()?.to_string(),
                yes: match c.get("answer")?.as_str()? {
                    "yes" => true,
                    "no" => false,
                    _ => return None,
                },
            })
        }
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
    if let Some(r) = ring::parse_call(name, c) {
        return Some(Call::Ring(Box::new(r)));
    }
    if let Some(t) = terminal::parse_call(name, c) {
        return Some(Call::Term(Box::new(t)));
    }
    if let Some(t) = capture::parse_call(name, c) {
        return Some(Call::Capture(Box::new(t)));
    }
    if let Some(m) = media::parse_call(name, c) {
        return Some(Call::Media(Box::new(m)));
    }
    if let Some(m) = mixdown::parse_call(name, c) {
        return Some(Call::Mix(Box::new(m)));
    }
    if let Some(a) = audio::parse_call(name, c) {
        return Some(Call::Audio(Box::new(a)));
    }
    let via = via(name, c)?;
    let body = match (c.get("document"), c.get("patch"), c.get("undo")) {
        (Some(_), None, None) => None,
        // #427: a diagnostic mode of the current revision carries no document.
        (None, None, None) if c.contains_key("mode") => None,
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
    let size = px_size(c.get("size"), |n| (1..=8192).contains(n))?;
    let show = Box::new(Show {
        via,
        doc: c.get("doc")?.as_str()?.to_string(),
        // #427: a mode call without a document draws the current revision and mints none.
        document: match (c.get("document"), c.get("mode")) {
            (Some(d), _) => d.clone(),
            (None, Some(_)) => Value::Null,
            (None, None) => return None,
        },
        removes: strings(c.get("removes"))?,
        t: optional(c.get("t"), |t| flicks(t.as_str()?))?.unwrap_or(0),
        size,
        include,
        check: optional(c.get("check"), Value::as_bool)?.unwrap_or(false),
        claim: optional(c.get("claim"), |h| Some(h.as_str()?.to_string()))?,
    });
    // #411: a diagnostic mode, one of the closed list.
    match c.get("mode") {
        None => Some(Call::Show(show)),
        Some(m) => {
            let mode = m.as_str().filter(|m| modes::owner(m).is_some())?;
            // #412: where the readings an earlier answer cut at 64 KB left off.
            let cursor = optional(c.get("cursor"), |n| n.as_str()?.parse().ok())?.unwrap_or(0);
            // #427: what the deviation, motion paths and pick hierarchy modes read.
            let span = match c.get("span") {
                None => None,
                Some(s) => {
                    let s = s.as_array().filter(|s| s.len() == 2)?;
                    Some([flicks(s[0].as_str()?)?, flicks(s[1].as_str()?)?])
                }
            };
            Some(Call::Mode(
                show,
                Box::new(modes::ModeArgs {
                    mode: mode.to_string(),
                    cursor,
                    item: optional(c.get("item"), |s| Some(s.as_str()?.to_string()))?,
                    reference: optional(c.get("reference"), |s| Some(s.as_str()?.to_string()))?,
                    select: strings(c.get("select"))?,
                    span,
                    depth: optional(c.get("depth"), Value::as_u64)?.map(|d| d as usize),
                }),
            ))
        }
    }
}

fn scenario(input: &Map<String, Value>) -> Option<Scenario> {
    let sessions = entries(input, "sessions", |s| {
        let p = s.get("process")?.as_object()?;
        // #402: a session's terminal, hosted by the hub or running elsewhere.
        let (runs_in, capture) = match s.get("terminal") {
            None => (None, None),
            Some(t) if t.get("hosted")?.as_bool()? => (None, None),
            Some(t) => (
                Some(t.get("runs_in")?.as_str()?.to_string()),
                optional(t.get("capture"), |c| strings(c.get("lines")))?,
            ),
        };
        Some(Session {
            thread: s.get("thread")?.as_str()?.to_string(),
            name: s.get("name")?.as_str()?.to_string(),
            process: (p.get("pid")?.as_u64()?, p.get("start")?.as_i64()?),
            runs_in,
            capture,
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
            visible: optional(p.get("visible"), Value::as_bool)?.unwrap_or(true),
            html: optional(p.get("html"), |h| Some(PathBuf::from(h.as_str()?)))?,
            // #498: a shipped panel, by its ID in the app's inventory; any other is bad input.
            shipped: optional(p.get("shipped"), |s| {
                let id = s.as_str()?;
                shipped_panels().contains(&id).then(|| id.to_string())
            })?,
        })
    })?;
    let docs = entries(input, "docs", |d| {
        Some(d.get("panel")?.as_str()?.to_string())
    })?;
    let docs_for = entries(input, "docs", |d| match d.get("for") {
        None => Some(None),
        Some(f) => Some(Some(f.as_str()?.to_string())),
    })?
    .into_iter()
    .filter_map(|(d, f)| Some((d, f?)))
    .collect();
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
    // #400: the displays connected, the first the main one; with them the clock carries no
    // refresh of its own, and the #383 `display` is theirs.
    let displays = match input.get("displays") {
        None => Vec::new(),
        Some(d) => {
            let list = d
                .as_array()?
                .iter()
                .map(|d| {
                    d.get("scale")?.as_f64().filter(|s| *s > 0.0)?;
                    d.get("color_space")?.as_str()?;
                    Some(placement::Display {
                        uuid: d.get("uuid")?.as_str()?.to_string(),
                        bounds: rect(d.get("bounds"))?,
                        // At least one flick per frame.
                        refresh_hz: d
                            .get("refresh_hz")?
                            .as_i64()
                            .filter(|n| (1..=shared::FLICKS).contains(n))?,
                        next_vsync: d.get("next_vsync")?.as_i64().filter(|n| *n >= 0)?,
                        feed: optional(d.get("feed"), |f| Some(f.as_str()?.to_string()))?,
                    })
                })
                .collect::<Option<Vec<_>>>()?;
            let mut uuids = std::collections::BTreeSet::new();
            if list.is_empty()
                || input.get("display").is_some()
                || !list.iter().all(|d| uuids.insert(d.uuid.as_str()))
            {
                return None;
            }
            list
        }
    };
    let layout = match input.get("layout") {
        None => None,
        Some(_) if displays.is_empty() => return None,
        Some(l) => Some(placement::Layout::parse(l)?),
    };
    let clock = match input.get("clock") {
        None => None,
        Some(c) => {
            let n = |k: &str| c.get(k)?.as_i64().filter(|n| *n >= 0);
            let refresh_hz = match (c.get("refresh_hz"), displays.is_empty()) {
                (None, false) => None,
                (Some(_), true) => Some(n("refresh_hz").filter(|n| *n > 0)?),
                _ => return None,
            };
            Some(Clock {
                refresh_hz,
                lead: n("lead")?,
                check: n("check")?,
            })
        }
    };
    // #629: a list is a replay's run record entries; an object, the record's objects by handle.
    let (record, runs) = match input.get("record") {
        Some(Value::Array(list)) => (
            BTreeMap::new(),
            list.iter()
                .map(|e| runs::entry(e).map(|_| e.clone()))
                .collect::<Option<Vec<_>>>()?,
        ),
        _ => (
            entries(input, "record", |o| {
                Some(RecordObject {
                    session: match o.get("session")? {
                        Value::Null => None,
                        v => Some(v.as_str()?.to_string()),
                    },
                    state: optional(o.get("state"), |s| Some(s.as_str()?.to_string()))?,
                    value: optional(o.get("value"), Value::as_f64)?,
                    as_of: optional(o.get("as_of"), Value::as_i64)?,
                })
            })?,
            Vec::new(),
        ),
    };
    let claims = entries(input, "claims", |c| {
        let session = c.get("session")?.as_str()?.to_string();
        let requirements = match c.get("requirements") {
            None => Vec::new(),
            Some(list) => list
                .as_array()?
                .iter()
                .map(|r| {
                    let check = r.get("check")?;
                    check.as_object()?.get("kind")?.as_str()?;
                    Some(Requirement {
                        id: r.get("id")?.as_str()?.to_string(),
                        check: check.clone(),
                    })
                })
                .collect::<Option<Vec<_>>>()?,
        };
        Some(Claim {
            session,
            deliverables: strings(c.get("deliverables"))?,
            requirements,
            brief: match c.get("brief") {
                None => None,
                Some(b) => Some(b.as_object().map(|_| b.clone())?),
            },
        })
    })?;
    let size_field = |k: &str| match input.get(k) {
        None => Some(None),
        Some(w) => {
            let r = rect(Some(&json!([0, 0, w.get(0)?, w.get(1)?])))?;
            Some(Some([r[2], r[3]]))
        }
    };
    let window = size_field("window")?;
    let display = size_field("display")?;
    let card = match input.get("card") {
        None => None,
        Some(c) => {
            // #393's reserved slot, or #400's ask, measured size and ask time, which the shell
            // places.
            let slot = match (c.get("rect"), c.get("size"), c.get("at")) {
                (Some(r), None, None) => Slot::Reserved(rect(Some(r))?),
                (None, Some(s), Some(at)) if !displays.is_empty() => {
                    let s = s.as_array().filter(|s| s.len() == 2)?;
                    let r = rect(Some(&json!([0, 0, s[0], s[1]])))?;
                    Slot::Placed {
                        ask: c.get("ask")?.as_str()?.to_string(),
                        size: [r[2], r[3]],
                        at: at.as_i64().filter(|t| *t >= 0)?,
                    }
                }
                _ => return None,
            };
            let options = c.get("options")?.as_array()?;
            Some(Card {
                question: c.get("question")?.as_str()?.to_string(),
                options: options
                    .iter()
                    .map(|o| o.get("label")?.as_str().map(str::to_string))
                    .collect::<Option<_>>()?,
                slot,
            })
        }
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
    // #105: the hub ends at this time as SIGKILL would.
    let kill_at = optional(input.get("fault").and_then(|f| f.get("kill_at")), |t| {
        t.as_i64().filter(|t| *t >= 0)
    })?;
    let fault = match input.get("fault") {
        None => None,
        Some(_) if commit_fault.is_some() || kill_at.is_some() => None,
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
    let mut placement_planted = placement::Planted::default();
    // #420's wrong programs live in scene3d's and the building module's operators, #453's in the
    // loop module's geometry.shading, #535's in the data module's mapping and deep-show.
    let module_planted = input
        .get("planted")
        .and_then(Value::as_str)
        .filter(|p| {
            deep_canvas_scene3d::PLANTED.contains(p)
                || deep_canvas_loop::PLANTED.contains(p)
                || deep_canvas_media::PLANTED.contains(p)
                // #1732's wrong programs live in the motion module's arrangement solve.
                || deep_canvas_motion::arrange::PLANTED.contains(p)
                || *p == deep_canvas_motion::module::UNDECLARED_KIND_ACCEPTED
                || deep_canvas_motion::module::PLANTED.contains(p)
                || *p == deep_canvas_motion::lengths::ONE_VALUE
                || deep_canvas_marks::arrays::PLANTED.contains(p)
                // #1967's wrong programs live in the cells module's playback and conversion.
                || deep_canvas_cells::recording::PLANTED.contains(p)
                || deep_canvas_export::lottie::PLANTED.contains(p)
                || deep_canvas_input::rows::PLANTED.contains(p)
        })
        .map(str::to_string);
    // #433's wrong programs are twins of the familiar@1 pack.
    let pack_planted = input
        .get("planted")
        .and_then(Value::as_str)
        .filter(|p| familiar::PLANTED.contains(p))
        .map(str::to_string);
    let planted = match input.get("planted").map(Value::as_str) {
        None => None,
        Some(None) => return None,
        Some(Some(_)) if module_planted.is_some() || pack_planted.is_some() => None,
        Some(Some(p)) => match placement_planted.flag(p) {
            // #400's wrong programs live in the placement.
            Some(flag) => {
                *flag = true;
                None
            }
            None if export_planted(p).is_some() => export_planted(p),
            None if geometry_audit::planted(p).is_some() => geometry_audit::planted(p),
            None if physics::planted(p).is_some() => physics::planted(p),
            None if stepped::planted(p).is_some() => stepped::planted(p),
            None => Some(match p {
                "presents_unnamed_removal" => Planted::PresentsUnnamedRemoval,
                "diffs_items_only" => Planted::DiffsItemsOnly,
                "inlines_every_issue" => Planted::InlinesEveryIssue,
                "cuts_without_truncated" => Planted::CutsWithoutTruncated,
                "sorts_by_order_key_alone" => Planted::SortsByOrderKeyAlone,
                "reply_without_digest" => Planted::ReplyWithoutDigest,
                "reads_wasm_bytes" => Planted::ReadsWasmBytes,
                "start_on_at_first_frame" => Planted::StartOnAtFirstFrame,
                "board_runs_program_per_frame" => Planted::BoardRunsProgramPerFrame,
                "figure_feeds_verdict" => Planted::FigureFeedsVerdict,
                "reload_rebuilds_every_part" => Planted::ReloadRebuildsEveryPart,
                "sweep_poses_assemblies_at_rest" => Planted::SweepPosesAssembliesAtRest,
                "pick_selects_item" => Planted::PickSelectsItem,
                "variant_pick_writes_revision" => Planted::VariantPickWritesRevision,
                "variant_export_final_choice" => Planted::VariantExportFinalChoice,
                "readout_reads_defaults" => Planted::ReadoutReadsDefaults,
                "plugin_code_per_frame" => Planted::PluginCodePerFrame,
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
                "estimates_on_this_machine" => Planted::EstimatesOnThisMachine,
                "line_scroll_pans" => Planted::LineScrollPans,
                "commit_every_move" => Planted::CommitEveryMove,
                "pick_mid_gesture" => Planted::PickMidGesture,
                "drag_shows_on_release" => Planted::DragShowsOnRelease,
                "patch_shows_a_frame_late" => Planted::PatchShowsAFrameLate,
                "full_screen_only_3d" => Planted::FullScreenOnly3d,
                "esc_to_root" => Planted::EscToRoot,
                "counts_every_issue" => Planted::CountsEveryIssue,
                "matches_carried_by_code" => Planted::MatchesCarriedByCode,
                "issues_without_actual" => Planted::IssuesWithoutActual,
                "loads_deprecated_silently" => Planted::LoadsDeprecatedSilently,
                "announces_every_frame" => Planted::AnnouncesEveryFrame,
                "box_folds_quote" => Planted::BoxFoldsQuote,
                "box_drops_t" => Planted::BoxDropsT,
                "box_drops_doc_rev" => Planted::BoxDropsDocRev,
                "box_sends_every_id" => Planted::BoxSendsEveryId,
                "resolver_only_ref_unresolved" => Planted::ResolverOnlyRefUnresolved,
                "resolver_closes_task" => Planted::ResolverClosesTask,
                "probe_from_depth" => Planted::ProbeFromDepth,
                "probe_nearest_item" => Planted::ProbeNearestItem,
                "verdict_keyed_by_doc" => Planted::VerdictKeyedByDoc,
                "checks_skip_unknown_kind" => Planted::ChecksSkipUnknownKind,
                "missing_kind_inconclusive" => Planted::MissingKindInconclusive,
                "layout_text_by_kind" => Planted::LayoutTextByKind,
                "verdict_counts_new_issues" => Planted::VerdictCountsNewIssues,
                "flicker_counts_single_changes" => Planted::FlickerCountsSingleChanges,
                "flicker_whole_view_mean" => Planted::FlickerWholeViewMean,
                "flicker_analyzes_once" => Planted::FlickerAnalyzesOnce,
                "cites_empty_passes" => Planted::CitesEmptyPasses,
                "seeds_by_expansion_order" => Planted::SeedsByExpansionOrder,
                "each_seeds_by_element_count" => Planted::EachSeedsByElementCount,
                "each_face_per_triangle" => Planted::EachFacePerTriangle,
                "reexpansion_overwrites_broken_out" => Planted::ReexpansionOverwritesBrokenOut,
                "orphan_load_drops_broken_out" => Planted::OrphanLoadDropsBrokenOut,
                "orphan_load_hands_id_to_expansion" => Planted::OrphanLoadHandsIdToExpansion,
                "expansion_cache_without_recipe_version" => {
                    Planted::ExpansionCacheWithoutRecipeVersion
                }
                "pack_check_skips_requires_modules" => Planted::PackCheckSkipsRequiresModules,
                "packs_keyed_by_name" => Planted::PacksKeyedByName,
                "store_sweep_deletes_named" => Planted::StoreSweepDeletesNamed,
                "loader_draws_missing_with_installed" => Planted::LoaderDrawsMissingWithInstalled,
                "counts_agent_rule_as_cover" => Planted::OwnRuleCountsAsCover,
                "recipe_rules_twice" => Planted::RulesEvaluatedTwice,
                "kit_tests_defaults_only" => Planted::KitDefaultsOnly,
                "expander_hash_map_order" => Planted::ExpandsInHashOrder,
                "migration_stops_at_first_fault" => Planted::MigrationFirstFault,
                "checkpoint_nearest_in_distance" => Planted::CheckpointNearestInDistance,
                "merges_in_finish_order" => Planted::MergesInFinishOrder,
                "runs_every_node" => Planted::RunsEveryNode,
                "unpaged" => Planted::Unpaged,
                "reloads_revision" => Planted::ReloadsRevision,
                "rebuilds_draw_list" => Planted::RebuildsDrawList,
                "repaints_every_mark" => Planted::RepaintsEveryMark,
                "background_at_live_priority" => Planted::BackgroundAtLivePriority,
                "accepts_every_sample_rate_8_to_192k" => Planted::AcceptsEverySampleRate8To192k,
                "prefix_reads_final" => Planted::PrefixReadsFinal,
                "relation_from_previous_box" => Planted::RelationFromPreviousBox,
                "why_names_operator_only" => Planted::WhyNamesOperatorOnly,
                "why_names_key_only" => Planted::WhyNamesKeyOnly,
                "cuts_by_row_order" => Planted::CutsByRowOrder,
                "frame_index_i64_product" => Planted::FrameIndexI64Product,
                "frame_index_truncating_division" => Planted::FrameIndexTruncatingDivision,
                "panel_policy_open" => Planted::PanelPolicyOpen,
                "toasts_ignore_card" => Planted::ToastsIgnoreCard,
                "script_ops_need_no_serial" => Planted::ScriptOpsNeedNoSerial,
                "placement_moves_yours" => Planted::PlacementMovesYours,
                "refresh_restamps_cached" => Planted::RefreshRestampsCached,
                "sends_without_serial" => Planted::SendsWithoutSerial,
                "serial_carries_many_sends" => Planted::SerialCarriesManySends,
                "bound_value_a_frame_late" => Planted::BoundValueAFrameLate,
                "resolver_reads_summary" => Planted::ResolverReadsSummary,
                "unparsable_reads_zero" => Planted::UnparsableReadsZero,
                "keymap_unchecked" => Planted::KeymapUnchecked,
                "conflicts_unreported" => Planted::ConflictsUnreported,
                "focused_panel_takes_escape" => Planted::FocusedPanelTakesEscape,
                "terminal_30_per_second" => Planted::Terminal30PerSecond,
                "cells_a_frame_late" => Planted::CellsAFrameLate,
                "video_shows_late" => Planted::VideoShowsLate,
                "video_drops_uncounted" => Planted::VideoDropsUncounted,
                "tab_draws_text" => Planted::TabDrawsText,
                "tab_redraws_at_30hz" => Planted::TabRedrawsAt30hz,
                "tab_draws_capture" => Planted::TabDrawsCapture,
                "records_without_hold" => Planted::RecordsWithoutHold,
                "records_past_max" => Planted::RecordsPastMax,
                "drafts_no_check" => Planted::DraftsNoCheck,
                "frames_to_record" => Planted::FramesToRecord,
                "keeps_asset_after_crash" => Planted::KeepsAssetAfterCrash,
                "labels_redaction_complete" => Planted::LabelsRedactionComplete,
                "sends_without_approval" => Planted::SendsWithoutApproval,
                "keeps_session_open" => Planted::KeepsSessionOpen,
                "records_for_agent" => Planted::RecordsForAgent,
                "records_without_permission" => Planted::RecordsWithoutPermission,
                "skips_caps" => Planted::SkipsCaps,
                "follows_urls" => Planted::FollowsUrls,
                "decodes_in_app" => Planted::DecodesInApp,
                "ignores_edit_lists" => Planted::IgnoresEditLists,
                "keeps_priming" => Planted::KeepsPriming,
                "encodes_in_decode_worker" => Planted::EncodesInDecodeWorker,
                "probe_rounds_to_flicks" => Planted::ProbeRoundsToFlicks,
                "probe_stores_normalized" => Planted::ProbeStoresNormalized,
                "assumes_bt601" => Planted::AssumesBt601,
                "lookup_floors_frame_rate" => Planted::LookupFloorsFrameRate,
                "seek_reads_proxy" => Planted::SeekReadsProxy,
                "shipped_panels_ungated" => Planted::ShippedPanelsUngated,
                "comparer_matches_hash" => Planted::ComparerMatchesHash,
                "keeps_voices_on_switch" => Planted::KeepsVoicesOnSwitch,
                "fades_on_close" => Planted::FadesOnClose,
                "cull_by_center" => Planted::CullByCenter,
                "bounds_children_only" => Planted::BoundsChildrenOnly,
                "mode_draws_live_surface" => Planted::ModeDrawsLiveSurface,
                "mode_ids_by_count" => Planted::ModeIdsByCount,
                "bounds_authored_position" => Planted::BoundsAuthoredPosition,
                "lights_local_position" => Planted::LightsLocalPosition,
                "checker_fits_surface" => Planted::CheckerFitsSurface,
                "deviation_one_way" => Planted::DeviationOneWay,
                "normals_from_faces" => Planted::NormalsFromFaces,
                // #499: the mix's wrong programs.
                "reverb_restores_without_tail" => Planted::ReverbRestoresWithoutTail,
                "ring_drops_oldest" => Planted::RingDropsOldest,
                "mixer_holds_gain_per_block" => Planted::MixerHoldsGainPerBlock,
                "emitter_always_inverse" => Planted::EmitterAlwaysInverse,
                "cone_sign_reversed" => Planted::ConeSignReversed,
                // #499: the clock's and the audio backend's.
                "clock_follows_display" => Planted::ClockFollowsDisplay,
                "backend_keeps_removed_device" => Planted::BackendKeepsRemovedDevice,
                "clock_restarts_from_sample_0" => Planted::ClockRestartsFromSample0,
                "arms_each_vsync" => Planted::ArmsEachVsync,
                "link_never_stops" => Planted::LinkNeverStops,
                "waker_ignores_schedule_frame" => Planted::WakerIgnoresScheduleFrame,
                "link_restarts_a_refresh_late" => Planted::LinkRestartsARefreshLate,
                _ => return None,
            }),
        },
    };
    let u32_field = |k: &str| match input.get(k) {
        None => Some(None),
        Some(n) => n.as_u64().and_then(|n| u32::try_from(n).ok()).map(Some),
    };
    let epoch_start = u32_field("epoch_start")?;
    let shuffle = u32_field("shuffle")?;
    let threads = match u32_field("threads")? {
        Some(n @ 1..=64) => Some(n as usize),
        Some(_) => return None,
        None => None,
    };
    let background = match input.get("background") {
        None => Vec::new(),
        Some(list) => list
            .as_array()?
            .iter()
            .map(|j| {
                let (kind, replicas) = match j.get("job")?.as_str()? {
                    "playtest" => (
                        "playtest",
                        usize::try_from(j.get("replicas")?.as_u64()?)
                            .ok()
                            .filter(|n| *n >= 1)?,
                    ),
                    "bake" => ("bake", 1),
                    _ => return None,
                };
                let document = j.get("document")?.clone();
                document.is_object().then_some(hub::Job {
                    kind,
                    replicas,
                    document,
                })
            })
            .collect::<Option<_>>()?,
    };
    // #855: a process keys with `hash@2` unless the scenario keys as before its migration.
    let hash = optional(input.get("hash"), |h| hash_named(h.as_str()?))?.unwrap_or(HashVersion::V2);
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
        .map(|c| {
            // deep_query's `at` is the times it reads (#411), geometry's the curve fractions it
            // reads (#441) and fn's the points (#490): on the clock each arrives at `arrives`, as
            // deep_kinds does, which takes no `at` (#1718).
            let arrives = if c.get("call") == Some(&json!("deep_query"))
                || c.get("call") == Some(&json!("geometry"))
                || c.get("call") == Some(&json!("fn"))
                || c.get("call") == Some(&json!("deep_kinds"))
            {
                "arrives"
            } else {
                "at"
            };
            (c.get(arrives), &clock)
        })
        .map(|(at, clock)| match (at, clock) {
            (Some(t), Some(_)) => t.as_i64().filter(|t| *t >= 0),
            (None, None) => Some(0),
            _ => None,
        })
        .collect::<Option<_>>()?;
    // #306: the packs installed in the store before the first call, each `{id, dir}`.
    let packs = match input.get("packs") {
        None => Vec::new(),
        Some(list) => list
            .as_array()?
            .iter()
            .map(|p| {
                Some((
                    p.get("id")?.as_str()?.to_string(),
                    PathBuf::from(p.get("dir")?.as_str()?),
                ))
            })
            .collect::<Option<_>>()?,
    };
    let notes = packs::notes(input.get("notes"))?;
    // #200: the hub's installed slot fills, each `{slot, fill, kit}`.
    let installed = match input.get("installed") {
        None => Vec::new(),
        Some(list) => list
            .as_array()?
            .iter()
            .map(|i| {
                i.get("slot")?.as_str()?;
                i.get("fill")?.as_str()?;
                i.get("kit")?.as_object()?;
                Some(i.clone())
            })
            .collect::<Option<_>>()?,
    };
    // #412: the entries plug-ins fill, each with the kit result the hub recorded on this core; the
    // folder of guides and examples used in place of the installed ones; the corpus runs.
    let plugin_entries = match input.get("plugin_entries") {
        None => Vec::new(),
        Some(list) => list
            .as_array()?
            .iter()
            .map(|p| {
                p.get("plugin")?.as_str()?;
                p.get("registry")?.as_str()?;
                p.get("entry")?.get("name")?.as_str()?;
                p.get("kit")?.as_object()?;
                Some(p.clone())
            })
            .collect::<Option<_>>()?,
    };
    let corpus_runs = match input.get("corpus_runs") {
        None => Vec::new(),
        Some(list) => list
            .as_array()?
            .iter()
            .map(|r| {
                r.get("example")?.as_str()?;
                r.get("module_set")?.as_str()?;
                r.get("played")?.as_u64()?;
                Some(r.clone())
            })
            .collect::<Option<_>>()?,
    };
    Some(Scenario {
        evidence: PathBuf::from(input.get("evidence")?.as_str()?),
        packs,
        notes,
        installed,
        plugin_entries,
        gallery: optional(input.get("gallery"), |g| Some(PathBuf::from(g.as_str()?)))?,
        corpus_runs,
        sessions,
        processes,
        panels,
        docs,
        docs_for,
        record,
        runs,
        claims,
        window,
        display,
        verdicts: match input.get("verdicts") {
            None => Map::new(),
            Some(v) => v.as_object()?.clone(),
        },
        card,
        displays,
        layout,
        placement_planted,
        fault,
        planted,
        module_planted,
        pack_planted,
        calls,
        at,
        seeds,
        state: optional(input.get("state"), |s| Some(PathBuf::from(s.as_str()?)))?,
        quotas,
        clock,
        commit_fault,
        kill_at,
        epoch_start: epoch_start.unwrap_or(0),
        shuffle,
        threads,
        background,
        hash,
        goldens: optional(input.get("goldens"), |g| Some(PathBuf::from(g.as_str()?)))?,
        environment,
        commit: optional(input.get("commit"), |c| Some(c.as_str()?.to_string()))?,
        machine: optional(input.get("machine"), |m| Some(m.as_object()?.clone()))?,
        devices: capture::Devices::parse(input)?,
        decode_caps: media::caps(input)?,
        audio: audio::parse(input.get("audio"))?,
        delays: stepped::delays(input.get("delays"))?,
    })
}

/// A line's input object and the scenario it holds; `None` for a line that isn't one.
fn read_line(line: &str) -> Option<(Map<String, Value>, Scenario)> {
    // A number past f64's range is the document's fault, refused at its path by the check
    // (#387: "a NaN or an infinity in a param is refused with out_of_range"), not the line's.
    let parsed = serde_json::from_str::<Value>(line).or_else(|e| match tame_overflow(line) {
        Some(tamed) => serde_json::from_str::<Value>(&tamed),
        None => Err(e),
    });
    let Ok(Value::Object(input)) = parsed else {
        return None;
    };
    let scenario = scenario(&input)?;
    Some((input, scenario))
}

fn answer(command: &str, startup: &Startup, line: &str) -> Value {
    let Some((input, mut scenario)) = read_line(line) else {
        return bad_input();
    };
    if scenario.planted.is_none() {
        scenario.planted = startup.run_planted;
    }
    match command {
        "run" => {
            let replies = jobs::around(&scenario, startup, |background| {
                let mut hub = hub::Hub::new(&scenario, startup);
                hub.background = background;
                hub.run_calls()
            });
            json!({"ok": true, "replies": replies})
        }
        "screen" => {
            let (Some(out), Some(_)) = (input.get("out").and_then(Value::as_str), scenario.window)
            else {
                return bad_input();
            };
            // The time the window shows (a time or flicks, 0 by default) and its scale (#1162).
            let t = match input.get("t") {
                None => 0,
                Some(Value::String(text)) => match hub::flicks(text) {
                    Some(t) => t,
                    None => return bad_input(),
                },
                Some(v) => match v.as_i64() {
                    Some(t) => t,
                    None => return bad_input(),
                },
            };
            let scale = input.get("scale").and_then(Value::as_f64).unwrap_or(1.0);
            if !(1.0..=4.0).contains(&scale) {
                return bad_input();
            }
            screen(&scenario, startup, out, t, scale)
        }
        _ => bad_input(),
    }
}

/// The virtual display clock `canvas` plays its calls on (#806): 120 Hz, the latch 2 ms before vsync,
/// half a millisecond a check, and each call ten frames after the one before, so a patch is current
/// at a latch before the next call arrives, as on the stand-in's clock (#384, #96).
const CANVAS_CLOCK: (i64, i64, i64) = (120, 1_411_200, 352_800);
const CANVAS_SPACING: i64 = 10 * (shared::FLICKS / 120);

/// `deep-show canvas` (#806): the hub's canvas side, long-lived. Its world (a scenario's fields but
/// `calls`, `clock` and `at`) is the hub's: the sessions it bound, the documents it minted, the
/// record's objects, the claims, the window and card. Each call is played after every call before
/// it, on the clock `canvas` keeps, and answered with its reply, so the replies are the stand-in's for
/// the same calls in the same order. A fault holds only the call that sends it, not the earlier ones
/// played again before it.
struct CanvasSide {
    world: Map<String, Value>,
    calls: Vec<Value>,
}

impl CanvasSide {
    fn scenario(&self, fault: bool) -> Option<Scenario> {
        let mut input = self.world.clone();
        if !fault {
            input.remove("fault");
        }
        let (refresh_hz, lead, check) = CANVAS_CLOCK;
        input.insert(
            "clock".into(),
            json!({"refresh_hz": refresh_hz, "lead": lead, "check": check}),
        );
        let calls: Vec<Value> = self
            .calls
            .iter()
            .enumerate()
            .map(|(i, c)| {
                let mut c = c.clone();
                let arrives = if ["deep_query", "geometry", "fn", "deep_kinds"]
                    .iter()
                    .any(|k| c["call"] == *k)
                {
                    "arrives"
                } else {
                    "at"
                };
                c[arrives] = json!((i as i64 + 1) * CANVAS_SPACING);
                c
            })
            .collect();
        input.insert("calls".into(), Value::Array(calls));
        scenario(&input)
    }

    fn line(&mut self, startup: &Startup, line: &str) -> Value {
        let Ok(Value::Object(input)) = serde_json::from_str::<Value>(line) else {
            return bad_input();
        };
        if let Some(Value::Object(world)) = input.get("world") {
            let before = std::mem::replace(&mut self.world, world.clone());
            if self.scenario(false).is_none() {
                self.world = before;
                return bad_input();
            }
            return json!({"ok": true});
        }
        let Some(Value::Object(call)) = input.get("call") else {
            return bad_input();
        };
        let mut call = call.clone();
        let out = call.remove("out");
        let doc = call.get("doc").and_then(Value::as_str).map(str::to_string);
        self.calls.push(Value::Object(call));
        let Some(scenario) = self.scenario(true) else {
            self.calls.pop();
            return bad_input();
        };
        match out.as_ref().and_then(Value::as_str) {
            // The window as the calls leave it, drawn and written to `out`; the reply is the
            // `screen` call's own, with the picture's size and each item's box beside it.
            Some(out) if scenario.window.is_some() => {
                let mut drawn = screen(&scenario, startup, out, 0, 1.0);
                let Some(Value::Array(mut replies)) = drawn.get_mut("replies").map(Value::take)
                else {
                    return drawn;
                };
                let mut reply = replies.pop().unwrap_or(Value::Null);
                for k in ["width", "height", "items"] {
                    reply[k] = drawn[k].take();
                }
                json!({"ok": true, "reply": reply})
            }
            _ => {
                let mut hub = hub::Hub::new(&scenario, startup);
                let mut replies = hub.run_calls();
                let reply = replies.pop().unwrap_or(Value::Null);
                // #412: deep_kinds reads and changes nothing, so it leaves no call to replay.
                if self.calls.last().and_then(|c| c.get("call")) == Some(&json!("deep_kinds")) {
                    self.calls.pop();
                }
                let presented = match doc.as_deref() {
                    Some(doc)
                        if reply.get("rev").is_some()
                            && reply["outcome"] != "refused"
                            && reply["outcome"] != "applied" =>
                    {
                        hub.presented_revision(doc)
                    }
                    _ => None,
                };
                json!({"ok": true, "reply": reply, "presented": presented})
            }
        }
    }
}

#[cfg(target_os = "macos")]
fn screen(scenario: &Scenario, startup: &Startup, out: &str, t: i64, scale: f64) -> Value {
    let mut hub = hub::Hub::new(scenario, startup);
    let replies = hub.run_calls();
    window::draw(&mut hub, replies, out, t, scale)
}

#[cfg(not(target_os = "macos"))]
fn screen(_: &Scenario, _: &Startup, _: &str, _: i64, _: f64) -> Value {
    json!({"ok": false, "code": "unsupported_platform"})
}

/// `live` (#376): the screen-reader smoke run's window, on macOS; with a `live` object (#140),
/// the window paced, watched, read back and played to as it asks. The run keeps its scenario
/// for the life of the process, which ends with the window.
#[cfg(target_os = "macos")]
fn live(startup: &'static Startup, line: &str) -> Value {
    let Some((input, scenario)) = read_line(line) else {
        return bad_input();
    };
    match input.get("live") {
        None => {
            let mut hub = hub::Hub::new(&scenario, startup);
            hub.run_calls();
            live::show(&mut hub)
        }
        Some(options) => match watch::parse(options, call) {
            Some(options) => watch::run(Box::leak(Box::new(scenario)), startup, options),
            None => bad_input(),
        },
    }
}

#[cfg(not(target_os = "macos"))]
fn live(_: &Startup, _: &str) -> Value {
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
    feature = "test-preview",
    feature = "test-preview-removed",
    feature = "test-preview-removed-bare",
    feature = "test-cue",
    feature = "test-cue-span",
    feature = "test-ring-a",
    feature = "test-ring-b",
    feature = "test-sheet-wordy",
    feature = "test-sim-a",
    feature = "test-sim-b",
    feature = "test-sim-b-f64",
    feature = "test-sim-b-private-renamed",
    feature = "test-sim-b-public-renamed",
    feature = "test-sim-b-false-bit",
    feature = "test-sim-b-off",
    feature = "test-sim-c",
    feature = "test-sim-a-1-0-1",
    feature = "test-sim-b-1-0-1",
    feature = "test-sim-b-pin-feature",
    feature = "test-gpu-second-backend",
    feature = "test-scene3d-tie-by-order",
    feature = "test-scene3d-reads-vector",
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
    feature = "test-tick",
    feature = "test-held",
    feature = "test-frame-cache",
    feature = "test-kit",
    feature = "test-leave-out-look",
    feature = "test-leave-out-text",
    feature = "test-check-kind",
    feature = "test-glyph-label",
    feature = "test-leave-out-logic",
    feature = "test-leave-out-data",
    feature = "test-leave-out-sandbox",
    feature = "test-mesh-item",
    feature = "test-prog-registry",
    feature = "test-sandbox-needs-logic",
    feature = "test-sandbox-alt",
    feature = "test-threads",
    feature = "test-json",
    feature = "test-debug-digest",
));

/// The canvas modules a build of `set` holds (Registry and seal: `build_set`): `core` is text and
/// look; `r1` adds marks2d, data, graph, record, sheet and motion; `r2` scene3d (#378) and effects
/// (#380); and, under `test-*` features, the READMEs' test modules and #388's builds without one.
fn modules(set: BuildSet) -> Vec<Module> {
    #[allow(unused_mut)]
    let mut out: Vec<Module> = vec![
        deep_canvas_marks::modules::text(),
        // #418: `test-look-finish-off` seals the planted look@1 implementation in its place.
        if cfg!(feature = "test-look-finish-off") {
            deep_canvas_marks::modules::look_finish_off()
        } else {
            deep_canvas_marks::modules::look()
        },
    ];
    if set >= BuildSet::R1 {
        out.extend([
            deep_canvas_marks::modules::marks2d(),
            // #399: `test-data-m4-drops-last` and `test-graph-tie-by-registration` seal the
            // planted data@1 and graph@1 implementations in their places.
            if cfg!(feature = "test-data-m4-drops-last") {
                deep_canvas_marks::modules::data_m4_drops_last()
            } else {
                deep_canvas_marks::modules::data()
            },
            if cfg!(feature = "test-graph-tie-by-registration") {
                deep_canvas_graph::module::tie_by_registration()
            } else {
                deep_canvas_graph::module::module()
            },
            deep_canvas_record::module::module(),
            deep_canvas_sheet::module::module(),
            physics::motion(),
        ]);
    }
    if set >= BuildSet::R2 {
        // Issue #402: the cell grid, on the text module.
        out.push(deep_canvas_cells::module::module());
        // Issue #421: `test-scene3d-tie-by-order` holds the planted implementation in its place.
        #[cfg(feature = "test-scene3d-tie-by-order")]
        out.push(twins::scene3d_tie_by_order());
        // Issue #443: `test-scene3d-reads-vector` holds the planted scene3d that reads vector's
        // items itself.
        #[cfg(feature = "test-scene3d-reads-vector")]
        out.push(twins::scene3d_reads_vector());
        #[cfg(not(any(
            feature = "test-scene3d-tie-by-order",
            feature = "test-scene3d-reads-vector"
        )))]
        out.push(deep_canvas_scene3d::module::module());
        // Issue #380: the shipped effects, whose passes go into scene3d's frame; #200's planted
        // layout has it fill the op table's base steps.
        out.push(if cfg!(feature = "test-steps-in-effects") {
            test_registries::effects_with_base_steps()
        } else {
            deep_canvas_effects::module::module()
        });
        // Issue #398: SVG import and formulas, drawn as marks2d's items; #399's
        // `test-vector-currentcolor-ink` seals the planted vector@1 implementation in its place.
        out.push(if cfg!(feature = "test-vector-currentcolor-ink") {
            deep_canvas_vector::module::currentcolor_ink()
        } else {
            deep_canvas_vector::module::module()
        });
    }
    if set >= BuildSet::Full {
        // Issue #420: walls, openings, slabs, roofs and stairs as trusted builders.
        out.push(deep_canvas_scene3d::building::module());
        // Issue #453: the loop's check kinds, geometry.shading first.
        out.push(deep_canvas_loop::module());
        // Issue #499: the media module, media@1; `test-media-checkpoint-without-tail` seals the
        // planted implementation whose reverb checkpoint leaves out its tail.
        out.push(if cfg!(feature = "test-media-checkpoint-without-tail") {
            deep_canvas_media::module::checkpoint_without_tail()
        } else {
            deep_canvas_media::module::module()
        });
        // Issue #308: controls and the input track's handling, with control@1; #535: logic's arrays.
        out.extend([deep_canvas_input::module::module(), deep_logic::module(), deep_canvas_export::module::module()]);
        out.extend(physics::module());
    }
    // Issue #238: the sandbox module, on core alone; `test-sandbox-alt` seals the test
    // implementation `sandbox.alt` in its place, and `test-sandbox-needs-logic` plants a manifest
    // that requires logic. Issue #2324: sandbox.alt pins another release outside every advisory
    // 49.0.2 was inside, and the planted engine build, whose kit differs from the reference's, is
    // no bit implementation, so the runtime digest names it.
    if set >= BuildSet::Full {
        out.push(if cfg!(feature = "test-sandbox-alt") {
            deep_canvas_sandbox::module::implementation("sandbox.alt", "=50.0.1")
        } else if cfg!(feature = "test-sandbox-needs-logic") {
            sandbox_needs_logic()
        } else if cfg!(feature = "plant-engine-differs") {
            let mut m = deep_canvas_sandbox::module::module();
            m.manifest.implementation.equivalence = deep_canvas::registry::Equivalence::Measured;
            m
        } else {
            deep_canvas_sandbox::module::module()
        });
    }
    #[cfg(feature = "test-leave-out-sandbox")]
    out.retain(|m| m.manifest.name != "sandbox");
    #[cfg(feature = "test-mesh-item")]
    out.push(deep_canvas_test_modules::sandbox::mesh());
    #[cfg(feature = "test-prog-registry")]
    out.push(deep_canvas_test_modules::sandbox::prog());
    #[cfg(feature = "test-leave-out-effects")]
    out.retain(|m| m.manifest.name != "effects");
    // #485: a build without scene3d, and without each module that can't seal without it.
    #[cfg(feature = "test-leave-out-scene3d")]
    {
        let mut gone = vec!["scene3d".to_string()];
        loop {
            let more: Vec<String> = out
                .iter()
                .filter(|m| !gone.contains(&m.manifest.name))
                .filter(|m| {
                    m.manifest
                        .depends_on
                        .iter()
                        .any(|(n, d)| !d.optional && gone.contains(n))
                })
                .map(|m| m.manifest.name.clone())
                .collect();
            if more.is_empty() {
                break;
            }
            gone.extend(more);
        }
        out.retain(|m| !gone.contains(&m.manifest.name));
    }
    // #485's planted layout: effects declares gpu.output@1, which the core then leaves to it.
    #[cfg(feature = "test-gpu-output-in-effects")]
    for m in &mut out {
        if m.manifest.name == "effects" {
            *m = test_registries::effects_declaring_outputs();
        }
    }
    // #501's planted layout: media declares export.target@1, which the core then leaves to it.
    #[cfg(feature = "test-export-target-in-media")]
    for m in &mut out {
        if m.manifest.name == "media" {
            *m = deep_canvas_media::module::declaring_export_targets();
        }
    }
    // #499: a build without the media module, and the test module that probes an asset through
    // the decode worker (or, planted, through media).
    #[cfg(feature = "test-leave-out-media")]
    out.retain(|m| m.manifest.name != "media");
    #[cfg(feature = "test-probe")]
    out.push(deep_canvas_test_modules::probe::module(false));
    #[cfg(feature = "test-probe-via-media")]
    out.push(deep_canvas_test_modules::probe::module(true));
    // #308: a build without the input module, which refuses a document with a control kind.
    #[cfg(feature = "test-leave-out-input")]
    out.retain(|m| m.manifest.name != "input");
    // #308: the input module with the test control kind test.dial among its kinds.
    #[cfg(feature = "test-control-kind")]
    for m in &mut out {
        if m.manifest.name == "input" {
            *m = deep_canvas_input::module::with_test_kind("");
        }
    }
    out.extend(test_registries::modules());
    #[cfg(feature = "test-leave-out-look")]
    out.retain(|m| m.manifest.name != "look");
    #[cfg(feature = "test-leave-out-text")]
    out.retain(|m| m.manifest.name != "text");
    #[cfg(feature = "test-accent")]
    out.push(planted::accent());
    #[cfg(feature = "test-threads")]
    out.extend(test_threads::modules());
    #[cfg(feature = "test-machines")]
    out.push(test_machines::module());
    #[cfg(feature = "test-json")]
    out.push(twins::json_writer());
    #[cfg(feature = "test-debug-digest")]
    out.push(twins::debug_digest());
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
    #[cfg(feature = "test-tick")]
    out.push(deep_canvas_test_modules::tick());
    #[cfg(feature = "test-held")]
    out.push(deep_canvas_test_modules::held());
    #[cfg(feature = "test-frame-cache")]
    out.push(deep_canvas_test_modules::cache());
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
    #[cfg(feature = "test-title-cap")]
    out.push(deep_canvas_test_modules::title_cap());
    #[cfg(feature = "test-deprecated")]
    out.push(deep_canvas_test_modules::deprecated());
    #[cfg(feature = "test-check-kind")]
    out.push(deep_canvas_test_modules::checks());
    #[cfg(feature = "test-glyph-label")]
    out.push(deep_canvas_test_modules::label());
    #[cfg(feature = "test-export-guards")]
    out.push(deep_canvas_test_modules::guards());
    // Issues #185 and #1920: test.sim@1's implementations and their variants, and test module c.
    #[cfg(feature = "test-sim")]
    out.extend(test_sim::modules());
    out.extend(kit::modules::built());
    #[cfg(feature = "test-leave-out-logic")]
    out.retain(|m| m.manifest.name != "logic");
    // #443: a build without the vector module, whose scene3d@1 and marks2d@1 digests equal the
    // full set's.
    #[cfg(feature = "test-leave-out-vector")]
    out.retain(|m| m.manifest.name != "vector");
    // #489: a build without the data module, whose motion@1 digest equals the full set's.
    #[cfg(feature = "test-leave-out-data")]
    out.retain(|m| m.manifest.name != "data");
    // #490: a build without the motion module, which still resolves ease@1, the core's; and the
    // planted layout that declares ease@1 in the motion module instead.
    #[cfg(feature = "test-leave-out-motion")]
    {
        // With motion go the modules that require it (building), so the set still seals.
        out.retain(|m| m.manifest.name != "motion");
        while let Some(i) = out.iter().position(|m| {
            m.manifest
                .depends_on
                .iter()
                .any(|(dep, d)| !d.optional && !out.iter().any(|o| o.manifest.name == *dep))
        }) {
            out.remove(i);
        }
    }
    #[cfg(feature = "test-ease-in-motion")]
    for m in &mut out {
        if m.manifest.name == "motion" {
            *m = deep_canvas_motion::module::declaring_eases();
        }
    }
    #[cfg(feature = "test-ease-renumbered")]
    for m in &mut out {
        if m.manifest.name == "motion" {
            *m = deep_canvas_motion::module::renumbered();
        }
    }
    out
}

/// #238: a sandbox module whose manifest declares logic among its required dependencies, which
/// the seal refuses in a build without the logic module, naming both.
pub fn sandbox_needs_logic() -> Module {
    let mut m = deep_canvas_sandbox::module::module();
    m.manifest.depends_on.insert(
        "logic".into(),
        deep_canvas::registry::Dependency {
            range: deep_canvas::registry::Range::parse("^1").expect("a range"),
            optional: false,
        },
    );
    m
}

/// The seams' backends this build ships, each `seam.<seam>`, an implementation of its seam's
/// interface the seal holds beside the build set's canvas modules (#185), and under
/// `test-gpu-second-backend` a second GPU backend beside the first, which the seal refuses.
fn seam_backends() -> Vec<Module> {
    use deep_canvas_seams::module;
    #[allow(unused_mut)]
    let mut out = vec![
        module("fonts", "seam.fonts", deep_text::FONTS),
        module(
            "cpu",
            "seam.cpu",
            deep_canvas_seams::cpu(std::env::consts::ARCH),
        ),
        module("headless", "seam.headless", deep_canvas_seams::HEADLESS),
        module("gpu", "seam.gpu", deep_gpu::seam::BACKEND),
        module("network", "seam.network", deep_relay::macos::BACKEND),
    ];
    #[cfg(feature = "test-gpu-second-backend")]
    out.push(module(
        "gpu",
        "seam.gpu.second",
        deep_canvas_seams::Backend {
            name: "wgpu-metal-second",
            version: deep_gpu::seam::BACKEND.version,
        },
    ));
    out
}

/// Every canvas interface a build may hold, each with its reference implementation (#185): every
/// shipped canvas module is its interface's reference, as each seam's shipped backend is; the
/// test interfaces' references are their own test modules. An implementation of an interface
/// declared here hashes to its reference's digest or the seal refuses it.
fn interfaces() -> Vec<deep_canvas::registry::Interface> {
    let kit = kit::interface_parts();
    let mut out: Vec<_> = modules(BuildSet::Full)
        .into_iter()
        .filter(|m| !m.manifest.name.starts_with("test."))
        .map(|m| {
            // #238: sandbox@1's reference is the shipped implementation, whichever a test build
            // holds, and its kit holds sandbox@1's own part.
            let interface = m.manifest.implements.clone();
            let sandbox = interface == deep_canvas_sandbox::module::INTERFACE;
            let mut parts = kit.clone();
            if sandbox {
                parts.push(kit::SANDBOX_PART.to_string());
            }
            // #418, #399, #421: look@1's, data@1's, graph@1's, vector@1's and scene3d@1's
            // references are the shipped modules, whichever a test build holds.
            let reference = match interface.as_str() {
                _ if sandbox => deep_canvas_sandbox::module::module(),
                "look@1" => deep_canvas_marks::modules::look(),
                "data@1" => deep_canvas_marks::modules::data(),
                "graph@1" => deep_canvas_graph::module::module(),
                "vector@1" => deep_canvas_vector::module::module(),
                "media@1" => deep_canvas_media::module::module(),
                _ if m.manifest.name == "scene3d" => deep_canvas_scene3d::module::module(),
                _ => m,
            };
            deep_canvas::registry::Interface {
                name: interface,
                reference,
                kit: parts,
                behavior: None,
            }
        })
        .collect();
    for m in seam_backends()
        .into_iter()
        .filter(|m| m.manifest.name.matches('.').count() == 1)
    {
        let seam = m.manifest.name.trim_start_matches("seam.").to_string();
        out.push(deep_canvas_seams::interface(&seam, m));
    }
    #[cfg(feature = "test-sim")]
    out.push(deep_canvas_test_modules::sim::interface(
        kit,
        cfg!(feature = "test-sim-behavior"),
    ));
    out
}

/// The interfaces a build of `held` seals against: every one `interfaces()` declares, and each
/// held test module's own, with that module its reference.
fn declared(held: &[Module]) -> Vec<deep_canvas::registry::Interface> {
    let mut out = interfaces();
    for m in held {
        if !out.iter().any(|i| i.name == m.manifest.implements) {
            out.push(deep_canvas::registry::Interface {
                name: m.manifest.implements.clone(),
                reference: m.clone(),
                kit: kit::interface_parts(),
                behavior: None,
            });
        }
    }
    out
}

/// The registry of a `set` build holding `held`: every interface it seals against, the seams'
/// backends and its canvas modules.
fn assemble(set: BuildSet, held: Vec<Module>) -> Registry {
    let mut registry = Registry::new(set);
    for interface in declared(&held) {
        registry = registry.declare(interface);
    }
    for backend in seam_backends() {
        registry = registry.backend(backend);
    }
    for module in held {
        registry = registry.with(module);
    }
    registry
}

/// A monotonic clock for the seal's interface checks, in nanoseconds since its first reading.
fn clock_ns() -> u64 {
    static START: std::sync::OnceLock<Instant> = std::sync::OnceLock::new();
    u64::try_from(START.get_or_init(Instant::now).elapsed().as_nanos()).unwrap_or(u64::MAX)
}

/// The app's shipped panels, by the IDs its inventory lists (#882): the shipped plug-ins whose
/// sound the device gate holds (#498).
fn shipped_panels() -> Vec<&'static str> {
    static IDS: std::sync::OnceLock<Vec<&'static str>> = std::sync::OnceLock::new();
    IDS.get_or_init(|| {
        let inventory: Value = serde_json::from_str(include_str!("../../deep-app/inventory.json"))
            .expect("the app's inventory is JSON");
        (inventory["panels"].as_array().into_iter().flatten())
            .filter_map(|p| p["panel"].as_str())
            .map(|id| &*Box::leak(id.to_string().into_boxed_str()))
            .collect()
    })
    .clone()
}

/// Every shipped canvas module's manifest, for the `module` call's dependencies (#402).
pub fn shipped_manifests() -> Vec<deep_canvas::registry::Manifest> {
    modules(BuildSet::Full)
        .into_iter()
        .map(|m| m.manifest)
        .collect()
}

/// Registers the build's canvas modules in sorted name order and seals, timing both; the
/// planted seal (`--planted treats_every_dependency_required`) is the criterion's wrong program.
fn seal(planted: Option<StartPlanted>, costs: Coefficients) -> Result<Startup, Box<SealError>> {
    let started = Instant::now();
    hub::SEAL_RUNS.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    let mut held = modules(build_set());
    // #221: marks2d with a planted relation solve, whose entries the constraint kit refuses.
    if let Some(StartPlanted::Relations(p)) = planted {
        for m in held.iter_mut().filter(|m| m.manifest.name == "marks2d") {
            *m = deep_canvas_marks::modules::marks2d_planted(p);
        }
    }
    // #489: motion with a planted constraint solve, whose entry the constraint kit refuses.
    if let Some(StartPlanted::Constraints(p)) = planted {
        for m in held.iter_mut().filter(|m| m.manifest.name == "motion") {
            *m = deep_canvas_motion::module::planted(p);
        }
    }
    // #308: the input module, or the test control kind, with a planted program.
    if let Some(StartPlanted::Input(p)) = planted {
        for m in held.iter_mut().filter(|m| m.manifest.name == "input") {
            if let Some(planted) = deep_canvas_input::module::planted(p) {
                *m = planted;
            }
        }
    }
    if planted == Some(StartPlanted::Run(Planted::TargetReaderIsWriter)) {
        for m in held.iter_mut().filter(|m| m.manifest.name == "media") {
            *m = deep_canvas_media::module::png_reads_itself();
        }
    }
    if let Some(StartPlanted::ControlKind(p)) = planted {
        for m in held.iter_mut().filter(|m| m.manifest.name == "input") {
            *m = deep_canvas_input::module::with_test_kind(p);
        }
    }
    // Every build set holds text and look, since a status mark needs text's shaper and look's
    // status map; the planted seal lets a build without look start (#388).
    for name in deep_canvas::registry::CORE_MODULES {
        let exempt = name == "look" && planted == Some(StartPlanted::StartsWithoutLook);
        if !exempt && !held.iter().any(|m| m.manifest.name == name) {
            return Err(Box::new(SealError {
                code: "missing_core_module",
                modules: vec![name.to_string()],
                what: format!("every build set holds `{name}`, and this build leaves it out"),
                ..SealError::default()
            }));
        }
    }
    let mut registry = assemble(build_set(), held)
        .with_costs(costs)
        .timed(clock_ns);
    if let Some(StartPlanted::Seal(fault)) = planted {
        registry = registry.plant(fault);
    }
    // #200: the registries the core declares in a test build, the planted layout whose base
    // steps a canvas module fills, and the kit that admits every entry.
    for def in test_registries::core() {
        registry = registry.declares(def);
    }
    if cfg!(feature = "test-steps-in-effects") {
        registry = registry.plant(Fault::BaseStepsElsewhere);
    }
    // #490's planted openings of ease@1: its entries renumbered, or declared by motion.
    if cfg!(feature = "test-ease-renumbered") {
        registry = registry.plant(Fault::EaseRenumbered);
    }
    if cfg!(feature = "test-ease-in-motion") {
        registry = registry.plant(Fault::EaseInMotion);
    }
    if cfg!(feature = "test-camera-in-scene3d") {
        registry = registry.plant(Fault::CameraInScene3d);
    }
    if cfg!(feature = "test-export-target-in-media") {
        registry = registry.plant(Fault::ExportTargetInMedia);
    }
    if cfg!(feature = "test-gpu-output-in-effects") {
        registry = registry.plant(Fault::GpuOutputInEffects);
    }
    // #412: the fixture ring keeps the bare name the issue gives it (`ring@1`, `ring@2`).
    if cfg!(any(feature = "test-ring-a", feature = "test-ring-b")) {
        registry = registry.allows_bare("test.ring", "ring");
    }
    if let Some(StartPlanted::KitAdmitsAll(name)) = planted {
        registry = registry.plant_admits_all(name);
    }
    let sealed = registry.seal();
    hub::INTERFACE_RUNS.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    let sealed = sealed?;
    kit::ledger::admit(&sealed)?;
    // #412: a build whose sheet passes 32 KB is refused, naming the entries whose lines put it
    // past and the bytes over.
    if let Some((entries, over)) = kinds::sheet_overrun(&sealed) {
        return Err(Box::new(SealError {
            code: "sheet_overrun",
            what: format!(
                "the sheet is {over} bytes past its {} bytes; ship {} as a recipe or a gallery example",
                kinds::SHEET_CAP,
                entries.join(", ")
            ),
            registry: Some(Box::new(deep_canvas::registry::RegistryRefusal {
                name: "kind@1".into(),
                entries: entries.into_iter().map(Value::from).collect(),
                rules: vec!["sheet_cap".into()],
                passes: Vec::new(),
            })),
            overrun_bytes: Some(over),
            ..SealError::default()
        }));
    }
    Ok(Startup {
        sealed,
        seal_ms: started.elapsed().as_secs_f64() * 1000.0,
        steps_by_name: planted == Some(StartPlanted::StepsByName),
        admits_frame_json: planted == Some(StartPlanted::Seal(Fault::AdmitsFrameJson)),
        test_build: TEST_BUILD,
        shapes_on_ui_thread: planted == Some(StartPlanted::ShapesOnUiThread),
        run_per_document: planted == Some(StartPlanted::RunPerDocument),
        network: match planted {
            Some(StartPlanted::Network(fault)) => Some(fault),
            _ => None,
        },
        ignores_unknown_occlusion: planted == Some(StartPlanted::IgnoresUnknownOcclusion),
        listing: match planted {
            Some(StartPlanted::Listing(l)) => Some(l),
            _ => None,
        },
        kinds: match planted {
            Some(StartPlanted::Kinds(k)) => Some(k),
            _ => None,
        },
        layouts: match planted {
            Some(StartPlanted::Layouts(l)) => l,
            _ => Default::default(),
        },
        run_planted: match planted {
            Some(StartPlanted::Run(p)) => Some(p),
            _ => None,
        },
        cache: None,
    })
}

/// A wrong program reachable only through the startup argument `--planted`: #305's seal that
/// reads every dependency as required, #387's scheduler that orders steps at one time by
/// canvas-module name, #388's seal that lets a build without look start, #856's hub that
/// shapes a long text on the UI thread and its shaped-run cache per document, or #140's network
/// backends with a fault.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum StartPlanted {
    Seal(Fault),
    StepsByName,
    StartsWithoutLook,
    ShapesOnUiThread,
    RunPerDocument,
    /// #140: a network backend with one fault, run through the network seam's suite.
    Network(seams::NetFault),
    /// #140: the card that treats unknown occlusion as unobscured.
    IgnoresUnknownOcclusion,
    /// #200: the kit of the named registry replaced by one that admits every entry.
    KitAdmitsAll(&'static str),
    /// #200: a wrong `deep://registries` listing.
    Listing(registries::Listing),
    /// #221: marks2d's relations solved by a planted program.
    Relations(deep_canvas_marks::relations::Planted),
    /// #489: motion's constraint kinds solved by a planted program.
    Constraints(deep_canvas_motion::kit::Planted),
    /// #412: a wrong deep_kinds listing, sheet, dump, diff or gallery.
    Kinds(kinds::Planted),
    /// #415: a wrong first-party layout's cap or validator.
    Layouts(deep_canvas_sandbox::layouts::Planted),
    /// #308: the input module with a planted program, whose control@1 entry the kit refuses.
    Input(&'static str),
    /// #308: the test control kind test.dial, which the input module fills under
    /// `test-control-kind`, with a planted program.
    ControlKind(&'static str),
    /// #501: a run's wrong program given at startup, as the scenario's `planted` would give it.
    Run(Planted),
}

#[cfg(test)]
mod tests {
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
        let waive =
            json!({"call": "decide", "decision": {"waive": {"fixture": "f", "reason": "r"}}});
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
        assert!(
            deep_canvas::registry::Semver::parse(deep_canvas::registry::CORE_VERSION).is_some()
        );
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
        let event =
            |t: i64, e: Value| json!({"call": "input", "panel": "main", "at": t, "event": e});
        let control = |t: i64, c: &str, v: Value| {
            event(t, json!({"type": "control", "control": c, "value": v}))
        };
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
}

/// The arguments after the command: `--planted <name>` and `--costs <path>`, each at most once,
/// in either order; an unknown name or a stray argument is bad input.
type StartArgs = (Option<StartPlanted>, Option<String>, Option<PathBuf>);

fn start_args(args: &[String]) -> Result<StartArgs, ()> {
    let (mut planted, mut costs, mut cache) = (None, None, None);
    let mut rest = args.get(1..).unwrap_or_default();
    while let [flag, value, more @ ..] = rest {
        match flag.as_str() {
            "--planted" if planted.is_none() => planted = Some(planted_named(value)?),
            "--costs" if costs.is_none() => costs = Some(value.clone()),
            // #1901: the folder kept output lives in across processes.
            "--cache" if cache.is_none() => cache = Some(PathBuf::from(value)),
            _ => return Err(()),
        }
        rest = more;
    }
    if rest.is_empty() {
        Ok((planted, costs, cache))
    } else {
        Err(())
    }
}

/// The planted twin a startup argument names.
fn planted_named(twin: &str) -> Result<StartPlanted, ()> {
    match twin {
        "treats_every_dependency_required" => {
            Ok(StartPlanted::Seal(Fault::EveryDependencyRequired))
        }
        "admits_frame_json" => Ok(StartPlanted::Seal(Fault::AdmitsFrameJson)),
        "digest_hashes_private" => Ok(StartPlanted::Seal(Fault::DigestHashesPrivate)),
        "digest_covers_pins" => Ok(StartPlanted::Seal(Fault::DigestCoversPins)),
        "runtime_digest_omits_physics" => Ok(StartPlanted::Seal(Fault::RuntimeOmitsPhysics)),
        "runtime_digest_hashes_only_shapes" => Ok(StartPlanted::Seal(Fault::RuntimeOnlyShapes)),
        "orders_steps_by_name" => Ok(StartPlanted::StepsByName),
        "starts_without_look" => Ok(StartPlanted::StartsWithoutLook),
        "shapes_on_ui_thread" => Ok(StartPlanted::ShapesOnUiThread),
        "run_per_document" => Ok(StartPlanted::RunPerDocument),
        "card_ignores_unknown_occlusion" => Ok(StartPlanted::IgnoresUnknownOcclusion),
        "hashes_every_entry" => Ok(StartPlanted::Seal(Fault::HashesEveryEntry)),
        "takes_foreign_entry" => Ok(StartPlanted::Seal(Fault::TakesForeignEntry)),
        "relation_iterates_to_convergence" => Ok(StartPlanted::Relations(
            deep_canvas_marks::relations::Planted::Iterates,
        )),
        "relation_reads_previous_place" => Ok(StartPlanted::Relations(
            deep_canvas_marks::relations::Planted::PreviousPlace,
        )),
        "constraint_iterates_to_convergence" => Ok(StartPlanted::Constraints(
            deep_canvas_motion::kit::Planted::Iterates,
        )),
        "constraint_reads_previous_output" => Ok(StartPlanted::Constraints(
            deep_canvas_motion::kit::Planted::PreviousFrame,
        )),
        "input_drag_along_recompute" => Ok(StartPlanted::Input("drag_along_recompute")),
        "input_tool_stamps_you" => Ok(StartPlanted::Input("tool_stamps_you")),
        "control_kind_recompute"
        | "control_kind_reads_modifiers"
        | "control_kind_no_keyboard"
        | "control_kind_agent_input" => Ok(StartPlanted::ControlKind(Box::leak(
            twin.trim_start_matches("control_kind_")
                .to_string()
                .into_boxed_str(),
        ))),
        "registries_without_slots" => Ok(StartPlanted::Listing(registries::Listing::WithoutSlots)),
        "slot_fill_as_entry" => Ok(StartPlanted::Listing(registries::Listing::FillAsEntry)),
        "validator_without_close" => Ok(StartPlanted::Seal(Fault::NoCloseNames)),
        "close_by_spelling" => Ok(StartPlanted::Seal(Fault::CloseBySpelling)),
        "pages_capped_at_64mib" => Ok(StartPlanted::Layouts(
            deep_canvas_sandbox::layouts::Planted {
                pages_pack_cap: true,
                ..Default::default()
            },
        )),
        "nav_graph_trusts_link_count" => Ok(StartPlanted::Layouts(
            deep_canvas_sandbox::layouts::Planted {
                trusts_link_count: true,
                ..Default::default()
            },
        )),
        _ if kinds::Planted::named(twin).is_some() => {
            Ok(StartPlanted::Kinds(kinds::Planted::named(twin).ok_or(())?))
        }
        _ if twin.starts_with("kit_admits_all:") => {
            let name = twin.trim_start_matches("kit_admits_all:");
            Ok(StartPlanted::KitAdmitsAll(Box::leak(
                name.to_string().into_boxed_str(),
            )))
        }
        _ if export_planted(twin).is_some() => {
            export_planted(twin).map(StartPlanted::Run).ok_or(())
        }
        "fingerprint_without_sources" => Ok(StartPlanted::Run(Planted::FingerprintWithoutSources)),
        "key_hashes_raw_bytes" => Ok(StartPlanted::Run(Planted::KeyHashesRawBytes)),
        _ => seams::NetFault::named(twin)
            .map(StartPlanted::Network)
            .ok_or(()),
    }
}

use export::planted as export_planted;

/// A hash version by its name: `hash@1` or `hash@2`.
fn hash_named(name: &str) -> Option<HashVersion> {
    [HashVersion::V1, HashVersion::V2]
        .into_iter()
        .find(|v| v.name() == name)
}

/// The coefficients this process estimates with: the file `--costs` names, else the build's
/// own; one whose build isn't optimized is refused, naming its profile (#855).
fn coefficients(path: Option<&str>) -> Result<Coefficients, cost::Refused> {
    let text = match path {
        None => cost::REFERENCE.to_string(),
        Some(p) => std::fs::read_to_string(p).map_err(|e| cost::Refused {
            profile: None,
            what: format!("costs: {p} can't be read: {e}"),
        })?,
    };
    Coefficients::read(&text)
}

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let command = args.first().cloned().unwrap_or_default();
    // #402: the terminal side on the wall clock, and a terminal's panel host; neither seals.
    match command.as_str() {
        "serve" => std::process::exit(serve::run()),
        "host" => std::process::exit(host::run(&args)),
        // #990: a hosted terminal's tab in the real app window, read by accessibility.
        #[cfg(target_os = "macos")]
        "term-ax" => {
            let spec = args
                .get(1)
                .and_then(|p| std::fs::read_to_string(p).ok())
                .and_then(|t| serde_json::from_str(&t).ok())
                .unwrap_or(serde_json::Value::Null);
            std::process::exit(deep_replica::terminal::ax(spec))
        }
        // #498: this binary's copies as the decode worker and the encode tool.
        "decode-worker" => {
            std::process::exit(deep_codecs::serve(deep_codecs::DECODE_WORKER, &args[1..]))
        }
        "encode-tool" => {
            std::process::exit(deep_codecs::serve(deep_codecs::ENCODE_TOOL, &args[1..]))
        }
        // #162: this binary's copy as the Lottie export's reference reader.
        "lottie-reader" => std::process::exit(deep_lottie_reader::serve(&args[1..])),
        _ => {}
    }
    let stdout = io::stdout();
    let mut out = stdout.lock();
    // #412: `deep-show kinds --dump <dir>` and `--diff <a> <b>`, what `deep kinds` runs.
    if command == "kinds" {
        let (line, code) = kinds::command(&args, |planted| {
            let start = planted.map(StartPlanted::Kinds);
            seal(start, Coefficients::reference())
                .map(|s| s.sealed)
                .map_err(|e| e.what)
        });
        let _ = writeln!(out, "{line}");
        let _ = out.flush();
        std::process::exit(code);
    }
    let Ok((fault, costs, cache)) = start_args(&args) else {
        let _ = writeln!(out, "{}", bad_input());
        std::process::exit(2);
    };
    // The cost model reads its coefficients before any scenario: a file a debug build measured
    // answers none.
    let coefficients = match coefficients(costs.as_deref()) {
        Ok(c) => c,
        Err(refused) => {
            let line = json!({"ok": false, "code": "costs_refused", "profile": refused.profile, "what": refused.what});
            let _ = writeln!(out, "{line}");
            let _ = out.flush();
            std::process::exit(2);
        }
    };
    // The seal runs before the first line is read: a refused set answers no scenario.
    let startup: &'static Startup = match seal(fault, coefficients) {
        Ok(startup) => Box::leak(Box::new(Startup { cache, ..startup })),
        Err(err) => {
            let mut line = json!({
                "ok": false,
                "code": "seal_refused",
                "reason": err.code,
                "modules": err.modules,
                "operators": err.operators,
                "arrays": err.arrays,
                "what": err.what,
            });
            // #185: the interface and the implementations a refusal involves.
            if let Some(interface) = &err.interface {
                line["interface"] = json!(interface);
            }
            if !err.implementations.is_empty() {
                line["implementations"] = json!(err.implementations);
            }
            // #200: the registry, its entries, the kit rules and the passes a refusal involves.
            if let Some(r) = &err.registry {
                line["registry"] = json!(r.name);
                line["entries"] = json!(r.entries);
                line["rules"] = json!(r.rules);
                if !r.passes.is_empty() {
                    line["passes"] = json!(r.passes);
                }
            }
            // #412: the bytes a sheet runs past its cap.
            if let Some(over) = err.overrun_bytes {
                line["overrun_bytes"] = json!(over);
            }
            let _ = writeln!(out, "{line}");
            let _ = out.flush();
            std::process::exit(2);
        }
    };
    let stdin = io::stdin();
    let mut canvas = CanvasSide {
        world: Map::new(),
        calls: Vec::new(),
    };
    canvas.world.insert("evidence".into(), json!(""));
    for line in stdin.lock().lines() {
        let reply = match line {
            Ok(line) => match command.as_str() {
                "canvas" => canvas.line(startup, &line),
                "live" => live(startup, &line),
                _ => answer(&command, startup, &line),
            },
            // A line that is not UTF-8 was read to its end: it is one that can't be read.
            Err(e) if e.kind() == io::ErrorKind::InvalidData => bad_input(),
            Err(_) => break,
        };
        let _ = writeln!(out, "{reply}");
        let _ = out.flush();
        if command == "live" {
            break;
        }
    }
}

#[cfg(target_os = "macos")]
mod idle;
#[cfg(target_os = "macos")]
mod live;
#[cfg(target_os = "macos")]
mod watch;
#[cfg(target_os = "macos")]
mod window;
// #501: the device gate's live output on the default device, for `soak`.
mod device;

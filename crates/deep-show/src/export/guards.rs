//! Issue #157: what an export refuses or lists before it draws a frame, and the disk it needs
//! (canvas primitives: Export; Check input: export kinds; Asset: licences through jobs): the
//! nearest even size for a 4:2:0 codec, the readiness gate's count of the PCM against the free
//! space where the export writes, the strips the film's end cuts, and the licences and credits
//! its assets carry through the jobs that made them.

use std::collections::BTreeSet;
use std::path::Path;

use deep_canvas_media::export_checks::{self as rules, FrameRead};
use deep_canvas_media::mix::Mix;
use serde_json::{json, Value};

use super::{pair_of, Guard, Job};
use crate::hub::Hub;

/// A 4:2:0 codec's odd width or height, refused at check with the size and the nearest even one
/// (one down, or 2 for a side of 1).
pub(crate) fn odd_size(size: [u16; 2]) -> Option<Value> {
    if size.iter().all(|n| n % 2 == 0) {
        return None;
    }
    let even = size.map(|n| {
        if n % 2 == 0 {
            n
        } else if n == 1 {
            2
        } else {
            n - 1
        }
    });
    Some(
        json!({"outcome": "refused", "code": "export_size_odd", "size": size, "nearest_even": even,
        "what": format!("a 4:2:0 codec needs an even width and height: {}×{} is odd; the nearest even size is {}×{}",
            size[0], size[1], even[0], even[1])}),
    )
}

/// The licences a document's assets carry, a job output's being its inputs' (`license.from`,
/// walked to the assets that name a licence of their own), each as `{asset, id}`; their credits
/// as `{asset, credit}`; and an issue for each CC BY licence that carries no credit.
pub(crate) fn licenses(doc: &Value) -> (Vec<Value>, Vec<Value>, Vec<Value>) {
    let assets = doc["assets"].as_object().cloned().unwrap_or_default();
    let mut leaves = BTreeSet::new();
    for id in assets.keys() {
        let mut stack = vec![id.clone()];
        let mut seen = BTreeSet::new();
        while let Some(a) = stack.pop() {
            if !seen.insert(a.clone()) {
                continue;
            }
            match assets.get(&a).and_then(|x| x["license"]["from"].as_array()) {
                Some(from) => {
                    stack.extend(from.iter().filter_map(Value::as_str).map(str::to_string))
                }
                None => {
                    leaves.insert(a);
                }
            }
        }
    }
    let (mut licenses, mut credits, mut missing) = (Vec::new(), Vec::new(), Vec::new());
    for a in leaves {
        let license = assets.get(&a).map_or(&Value::Null, |x| &x["license"]);
        let id = license["id"].as_str().unwrap_or("unknown");
        licenses.push(json!({"asset": a, "id": id}));
        match license["credit"].as_str().filter(|c| !c.trim().is_empty()) {
            Some(credit) => credits.push(json!({"asset": a, "credit": credit})),
            None if id.to_ascii_uppercase().starts_with("CC-BY") => missing.push(json!({"check": "licenses", "code": "credit_missing",
                "severity": "error", "asset": a, "license": id,
                "what": format!("asset `{a}` is {id}, which the export may carry only with its credit, and it gives none")})),
            None => {}
        }
    }
    (licenses, credits, missing)
}

/// The bytes free on the volume that holds `at` (its nearest existing folder), as the file
/// system reports them to this process.
pub(crate) fn free_bytes(at: &Path) -> Option<u64> {
    use std::os::unix::ffi::OsStrExt;
    let mut p = at;
    while !p.exists() {
        p = p.parent()?;
    }
    let c = std::ffi::CString::new(p.as_os_str().as_bytes()).ok()?;
    // SAFETY: `c` is a NUL-terminated path and `s` a zeroed statvfs the call fills.
    let mut s: libc::statvfs = unsafe { std::mem::zeroed() };
    (unsafe { libc::statvfs(c.as_ptr(), &mut s) } == 0)
        .then(|| s.f_bavail as u64 * s.f_frsize as u64)
}

/// The readiness gate's disk count: whether `needed` bytes fit the volume that holds `at`, and
/// what it has free.
pub(crate) struct Disk {
    pub fits: bool,
    pub free: u64,
}

/// An export keeps only its PCM on disk while it runs (no frame is stored raw), so it is refused
/// before the first frame when the volume it writes to can't hold that.
pub(crate) fn disk_gate(needed: u64, at: &Path) -> Disk {
    let free = free_bytes(at).unwrap_or(0);
    Disk {
        fits: needed <= free,
        free,
    }
}

/// Each strip that plays past the film's end, with its start and the time lost, in flicks.
pub(crate) fn end_cuts(mix: &Mix, end: i64) -> Vec<Value> {
    mix.strips
        .iter()
        .filter(|s| s.start + s.span > end)
        .map(|s| {
            let lost = s.start + s.span - end.max(s.start);
            json!({"check": "end_cut", "code": "end_cut", "severity": "warning", "strip": s.id, "start": s.start, "lost": lost,
                "what": format!("strip `{}` starts at {:.3} s and runs past the film's end: {:.3} s of it is cut",
                    s.id, s.start as f64 / FLICKS, lost as f64 / FLICKS)})
        })
        .collect()
}

const FLICKS: f64 = deep_canvas::grammar::FLICKS_PER_SECOND as f64;

impl Hub<'_> {
    /// #157: the film's cuts, in flicks: where one placement cuts to the next, and each shot
    /// transition of kind cut.
    pub(super) fn cuts_of(&mut self, doc: &Value) -> Vec<i64> {
        let motion = doc
            .as_object()
            .and_then(|m| deep_canvas_motion::doc::read(m).ok());
        let mut out: Vec<i64> = motion
            .map(|m| m.cuts.iter().map(|c| c.at).collect())
            .unwrap_or_default();
        let session = self.evaluated(doc, 0);
        if let Some(plan) =
            crate::film::program_of(&self.sched, &session).and_then(|p| p.shots.clone())
        {
            out.extend(
                plan.transitions
                    .iter()
                    .filter(|t| matches!(t.kind, deep_canvas_motion::shots::Kind::Cut))
                    .map(|t| t.cut),
            );
        }
        out.sort_unstable();
        out.dedup();
        out
    }

    /// #157: film.blank and film.wrap over what the GPU read of each frame: each run of black or
    /// flat frames lasting 0.1 s outside the declared spans, and a looping film whose last frame
    /// changes to its first by more than any two neighbouring frames change.
    #[allow(clippy::too_many_arguments)]
    pub(super) fn frame_guards(
        &self,
        doc: &Value,
        job: &Job,
        frame: i64,
        first: i64,
        reads: &[deep_gpu::frame_checks::Reading],
        wrap: Option<u64>,
        size: [u16; 2],
    ) -> Result<Vec<Value>, Value> {
        // The document's own film.blank check input declares its intended blanks: `except`, each a
        // span [from, to) of flicks or time literals.
        let mut except = Vec::new();
        let declared = doc["checks"]
            .as_array()
            .into_iter()
            .flatten()
            .filter(|c| c["kind"] == "film.blank");
        for span in declared.flat_map(|c| c["except"].as_array().cloned().unwrap_or_default()) {
            let (a, b) = pair_of(&span).ok_or_else(|| json!({"outcome": "refused", "code": "bad_doc", "path": "checks/film.blank/except"}))?;
            let at = |t| {
                self.resolve_time(&job.doc, t).map_err(|code| json!({"outcome": "refused", "code": code, "path": "checks/film.blank/except"}))
            };
            except.push(at(&a)?..at(&b)?);
        }
        let rule = rules::BlankRule {
            coverage: 0.98,
            min: deep_canvas::grammar::FLICKS_PER_SECOND / 10,
            frame,
            except,
            flat_window: 3,
        };
        let read: Vec<FrameRead> = reads
            .iter()
            .map(|r| FrameRead {
                dark: r.dark,
                pixels: r.pixels,
                histogram: r.histogram,
            })
            .collect();
        let flat = !self.guard_planted(Guard::BlankDarkOnly);
        let mut issues: Vec<Value> = rules::blank_runs(first, &read, &rule, flat)
            .iter()
            .map(|run| {
                let (kind, what) = match run.kind {
                    rules::BlankKind::Black => ("black", "black".to_string()),
                    rules::BlankKind::Flat { low } => ("flat", format!("flat: one luma window from {low} holds 98% of their pixels")),
                };
                let s = (run.last - run.first + 1) as f64 * frame as f64 / deep_canvas::grammar::FLICKS_PER_SECOND as f64;
                json!({"check": "film.blank", "code": "film.blank", "severity": "error", "kind": kind, "first": run.first, "last": run.last,
                    "frames": (run.first..=run.last).collect::<Vec<_>>(),
                    "what": format!("frames {} to {} ({s:.3} s) are {what}; declare the span an exception if it is meant", run.first, run.last)})
            })
            .collect();
        if let Some(sum) = wrap {
            let neighbours: Vec<(i64, u64)> = reads
                .iter()
                .enumerate()
                .filter_map(|(i, r)| r.diff.map(|d| (first + i as i64 - 1, d)))
                .collect();
            let bytes = u64::from(size[0]) * u64::from(size[1]) * 4;
            if let Err(w) = rules::wrap(sum, &neighbours, bytes) {
                let last = first + reads.len() as i64 - 1;
                issues.push(json!({"check": "film.wrap", "code": "film.wrap", "severity": "error", "wrap": [last, first],
                    "change": w.change, "largest": w.largest, "between": [w.between.0, w.between.1],
                    "what": format!("the wrap from frame {last} to frame {first} changes {:.3} per byte, more than the largest change between neighbouring frames, {:.3} (frames {} and {})",
                        w.change, w.largest, w.between.0, w.between.1)}));
            }
        }
        Ok(issues)
    }

    /// Whether the document's look has grain, which raises the encoder's quality floor.
    pub(crate) fn has_grain(&self, doc: &Value) -> bool {
        let def = self.look_def_of(doc);
        let finish = def
            .as_ref()
            .and_then(|l| l.get("finish"))
            .and_then(Value::as_array);
        finish
            .into_iter()
            .flatten()
            .any(|f| f.get("grain").is_some())
    }
}

//! Issue #501: exports. A timeline leaves as a file through a sealed `export.target@1` entry:
//! its frames evaluated on a virtual clock in a fresh session with the document's default view
//! (no selection, cutaway or hover reaches them), each raster the one a still draws, hashed with
//! BLAKE3 on the GPU, its audio the mix's samples over the frame's span, the file written by the
//! target's writer under a temporary name and renamed only when whole.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use deep_canvas::document::frame_rate_of;
use deep_canvas::schedule::{default_view, Scheduler, Session as DocSession};
use deep_canvas::time as clock;
use deep_canvas::timecode;
use deep_codecs::ENCODE_TOOL;
use deep_canvas_media::analysis::loudness::{self, Loudness};
use deep_canvas_media::captions::{self, Caption};
use deep_canvas_media::delivery::{self, Miss};
use deep_canvas_media::mix::{amp, Mix, Player};
use serde_json::{json, Map, Value};
use sha2::{Digest, Sha256};

use crate::frames::drawing_of;
use crate::hub::{EvalTime, Hub, Planted};
use crate::time::{context_of, sample_rate_of};
use crate::mixdown::planted_of;
use crate::snapshot::Unfit;

impl Hub<'_> {
    /// The export frame at `t` in `session` on `sched`: straight RGBA rows top-down at `size`
    /// (the drawing's frame when none), over the look's ground when `opaque`. The raster the
    /// still at `t` stores, by construction: 3D writer layers with their 2D items over them, a
    /// film's sides finished and blended, or the canonical 2D raster.
    pub(crate) fn export_frame(
        &mut self,
        sched: &mut Scheduler<'_>,
        session: &mut DocSession,
        doc: &Value,
        t: i64,
        size: Option<[u16; 2]>,
        opaque: bool,
    ) -> Result<(Vec<u8>, [u16; 2]), Unfit> {
        // #504: each variant set's pick at `t`, loaded only on the frame it changes.
        crate::played::load_at(sched, session, doc, t);
        let shown = crate::played::at(doc, t);
        let doc = shown.as_ref();
        session.frame(sched, t, &default_view(doc));
        let (_, pictures) = self.videos_at(doc, t, true);
        self.renderer.videos = pictures;
        self.caption_at(doc, t);
        let unfit = |code| Unfit { code, path: "frames".into() };
        let drawing = drawing_of(sched, session).ok_or_else(|| unfit("no_drawing"))?;
        if deep_canvas_scene3d::scene::has_3d(doc) {
            return self.rgba3d(doc, t, &drawing, size);
        }
        let sides = crate::film::program_of(sched, session)
            .and_then(|p| crate::film::sides(&p, doc, t, false));
        let (rgba, _, size) = match sides {
            Some(sides) => self.film_rgba(&drawing, size, &sides, doc, opaque)?,
            None => self.canonical_rgba(&drawing, size, opaque)?,
        };
        Ok((rgba, size))
    }

    /// One shard: the frames `frames` (absolute indices at `frame` flicks each) of `doc`, from a
    /// fresh scheduler and session, written as BGRA8 files in `dir` and hashed on the GPU; and the
    /// mix's samples over each frame's span (frame k's span starts at ⌊k·Δ × hz ÷ flicks⌋), from
    /// a player sought to the shard's first sample, appended to `pcm`.
    pub(crate) fn export_shard(
        &mut self,
        doc: &Value,
        shard: &Shard,
        dir: &std::path::Path,
        pcm: &mut Vec<u8>,
    ) -> Result<Rendered, Value> {
        let unfit = |u: Unfit| json!({"code": u.code, "path": u.path});
        let io = |_| json!({"code": "export_unwritable"});
        let mut sched = Scheduler::new(&self.startup.sealed, self.options());
        let mut session: DocSession = self.new_session();
        session.load(&mut sched, doc);
        let gpu = self.gpu3().map(|g| g.device().clone()).ok_or_else(|| json!({"code": "gpu_unavailable"}))?;
        let planted = deep_gpu::blake3::Planted {
            joins_right_left: self.scenario.planted == Some(Planted::ChunkTreeWrongOrder),
        };
        let hasher = deep_gpu::blake3::Blake3::new(&gpu.device, planted);
        let mut hashes: Option<deep_gpu::blake3::Frames> = None;
        let mut out = Rendered::default();
        for k in shard.frames.clone() {
            let t = k * shard.frame;
            let (mut px, size) = self.export_frame(&mut sched, &mut session, doc, t, shard.size, shard.opaque).map_err(unfit)?;
            for p in px.as_chunks_mut::<4>().0 {
                p.swap(0, 2);
            }
            let path = dir.join(format!("{k:06}.bgra"));
            std::fs::write(&path, &px).map_err(io)?;
            out.files.push(path);
            out.size = size;
            let frames = hashes.get_or_insert_with(|| {
                hasher.frames(&gpu.device, &gpu.queue, [u32::from(size[0]), u32::from(size[1])])
            });
            out.hashes.extend(frames.push(&px));
        }
        out.hashes.extend(hashes.as_mut().and_then(deep_gpu::blake3::Frames::finish));
        if let Some(mix) = &shard.mix {
            let hz = mix.rate as u32;
            let span = |k: i64| self.span_start(k, shard.frame, hz);
            let mut player = Player::new(mix.clone(), planted_of(self.scenario.planted, false));
            player.delivery = amp(shard.gain);
            player.seek(span(shard.frames.start));
            for k in shard.frames.clone() {
                let n = (span(k + 1) - span(k)).max(0) as usize;
                let mut buf = vec![0f32; 2 * n];
                player.read(&mut buf);
                let bytes: Vec<u8> = buf.iter().flat_map(|x| x.to_le_bytes()).collect();
                out.pcm.push(hex(Sha256::digest(&bytes)));
                pcm.extend_from_slice(&bytes);
            }
            out.cut = player.limited();
        }
        Ok(out)
    }

    /// Frame k's first sample at `hz`: [`deep_canvas::time::span_start`], or the planted
    /// programs' wrong spans.
    pub(crate) fn span_start(&self, k: i64, frame: i64, hz: u32) -> i64 {
        match self.scenario.planted {
            Some(Planted::SpanRoundsEachFrame) => {
                let x = i128::from(frame) * i128::from(hz);
                let f = i128::from(deep_canvas::grammar::FLICKS_PER_SECOND);
                k * ((x + f / 2) / f) as i64
            }
            Some(Planted::SpanRoundsStart) => {
                let x = i128::from(k) * i128::from(frame) * i128::from(hz);
                let f = i128::from(deep_canvas::grammar::FLICKS_PER_SECOND);
                ((x + f / 2) / f) as i64
            }
            _ => deep_canvas::time::span_start(k, frame, hz),
        }
    }
}

/// What an export takes in: the request fields the issue names.
pub struct Job {
    pub doc: String,
    pub range: Span,
    pub size: Option<[u16; 2]>,
    pub frame_rate: Option<(u32, u32)>,
    /// `video.codec`: which target writes it (Export: a codec, or a target's own name).
    pub codec: String,
    pub alpha: bool,
    pub sample_rate: Option<u32>,
    pub audio_codec: String,
    pub shards: u8,
    pub timecode: String,
    pub drop_frame: bool,
    pub out: String,
    /// `adapter: "software"`: the frames drawn and hashed on the software adapter.
    pub software: bool,
    /// `readback: true`: each frame's raw BGRA8 bytes kept in the evidence store.
    pub readback: bool,
    /// #544: the input track the document's logic items read.
    pub track: Vec<Value>,
    /// #502: `captions: {profile, files, mode}` and `loudness_profile`.
    pub captions: Captions,
    pub loudness_profile: Option<String>,
}

/// An export's `captions`: the profile that holds them, the sidecars to write (`[srt]` when left
/// out) and whether the frames carry them (`open` when left out).
pub struct Captions {
    pub profile: Option<String>,
    pub files: Vec<String>,
    pub mode: String,
}

impl Default for Captions {
    fn default() -> Self {
        Captions { profile: None, files: vec!["srt".into()], mode: "open".into() }
    }
}

impl Job {
    /// The export.target@1 entry that writes the job's codec: `video` for the movie codecs,
    /// `png` for a PNG sequence, otherwise the target the codec names.
    pub fn target(&self) -> &str {
        match self.codec.as_str() {
            "h264" | "hevc" | "hevc_alpha" | "prores_4444" | "gif" => "video",
            "png_seq" => "png",
            other => other,
        }
    }
}

/// Which part of the timeline leaves.
pub enum Span {
    Whole,
    Between(EvalTime, EvalTime),
    Still(EvalTime),
    Marker(String),
    /// A range form the issue lists that this build does not write, by its name.
    Unbuilt(&'static str),
}

/// A time given as flicks or a time literal.
fn at(v: &Value) -> Option<EvalTime> {
    match v {
        Value::Number(n) => n.as_i64().map(EvalTime::Flicks),
        Value::String(t) => Some(EvalTime::Literal(t.clone())),
        _ => None,
    }
}

/// An `export` line with an `out`, or `None` for a line lacking a field it needs.
pub fn parse(c: &Map<String, Value>) -> Option<Job> {
    let s = |v: Option<&Value>| v.and_then(Value::as_str).map(str::to_string);
    let range = match c.get("range") {
        None => Span::Whole,
        Some(Value::String(w)) if w == "whole" => Span::Whole,
        Some(Value::Array(a)) if a.len() == 2 => Span::Between(at(&a[0])?, at(&a[1])?),
        Some(Value::Object(o)) => match (o.get("still"), o.get("ranges"), o.get("frames")) {
            (Some(Value::Object(st)), _, _) => match (st.get("t"), st.get("marker")) {
                (Some(t), None) => Span::Still(at(t)?),
                (None, Some(m)) => Span::Marker(m.as_str()?.to_string()),
                _ => return None,
            },
            (_, Some(_), _) => Span::Unbuilt("ranges"),
            (_, _, Some(_)) => Span::Unbuilt("frames"),
            _ => return None,
        },
        _ => return None,
    };
    let whole = |v: &Value| u32::try_from(v.as_u64()?).ok();
    let pair = |v: &Value| -> Option<(u32, u32)> {
        let a = v.as_array().filter(|a| a.len() == 2)?;
        Some((whole(&a[0])?, whole(&a[1])?))
    };
    let size = match c.get("size") {
        None => None,
        Some(v) => {
            let (w, h) = pair(v)?;
            Some([u16::try_from(w).ok()?, u16::try_from(h).ok()?])
        }
    };
    let video = c.get("video");
    let audio = c.get("audio");
    let tc = c.get("timecode");
    // `alpha`: `straight` (or true) keeps it; absent, `none` or false draws over the ground.
    let alpha = match video.and_then(|v| v.get("alpha")) {
        None | Some(Value::Null) | Some(Value::Bool(false)) => false,
        Some(Value::String(a)) => a != "none",
        Some(_) => true,
    };
    Some(Job {
        doc: s(c.get("doc"))?,
        range,
        size,
        frame_rate: crate::optional(c.get("frame_rate"), pair)?,
        codec: s(video.and_then(|v| v.get("codec"))).unwrap_or_else(|| "h264".into()),
        alpha,
        sample_rate: audio.and_then(|a| a.get("sample_rate")).and_then(whole),
        audio_codec: s(audio.and_then(|a| a.get("codec"))).unwrap_or_else(|| "pcm".into()),
        shards: match c.get("shards") {
            None => 1,
            Some(v) => u8::try_from(v.as_u64()?).ok().filter(|n| *n >= 1)?,
        },
        timecode: s(tc.and_then(|t| t.get("start"))).unwrap_or_else(|| "00:00:00:00".into()),
        drop_frame: tc.and_then(|t| t.get("drop_frame")).and_then(Value::as_bool).unwrap_or(false),
        out: s(c.get("out"))?,
        software: match c.get("adapter") {
            None => false,
            Some(a) => a.as_str()? == "software",
        },
        readback: c.get("readback").and_then(Value::as_bool).unwrap_or(false),
        track: c.get("track").map_or(Some(Vec::new()), |t| t.as_array().cloned())?,
        captions: {
            let cap = c.get("captions");
            Captions {
                profile: s(cap.and_then(|c| c.get("profile"))),
                files: match cap.and_then(|c| c.get("files")) {
                    None => vec!["srt".into()],
                    Some(Value::String(f)) => vec![f.clone()],
                    Some(f) => f.as_array()?.iter().map(|f| f.as_str().map(str::to_string)).collect::<Option<_>>()?,
                },
                mode: s(cap.and_then(|c| c.get("mode"))).unwrap_or_else(|| "open".into()),
            }
        },
        loudness_profile: s(c.get("loudness_profile")),
    })
}

/// The software adapter's refusal: no adapter draws without a GPU here (#230).
pub(crate) fn no_software_adapter() -> Value {
    json!({"outcome": "refused", "code": "software_adapter_unavailable", "adapter": "software",
        "why": "no software adapter opens in this build (#230); the frames draw and hash on the GPU only"})
}

impl Hub<'_> {
    /// `export` with an `out`: the job checked, the readiness gate passed before anything is
    /// written, every shard rendered, the target's writer handed the frames and samples, and
    /// the receipt. Nothing is left at `out` or beside it unless the export is whole.
    pub fn export_run(&mut self, job: &Job) -> Value {
        let doc = match self.current(&job.doc) {
            Some(r) => r.doc.clone(),
            None => return json!({"outcome": "refused", "code": "no_revision"}),
        };
        self.export_doc(job, doc)
    }

    /// [`Hub::export_run`] of a given document, under `job.doc` as its ID.
    pub(crate) fn export_doc(&mut self, job: &Job, doc: Value) -> Value {
        let scratch = std::env::temp_dir().join(format!("deep-export-{}-{}", std::process::id(), self.media.exports));
        self.media.exports += 1;
        let result = self.export_inner(job, doc, &scratch);
        self.media.captions = None;
        let _ = std::fs::remove_dir_all(&scratch);
        match result {
            Ok(mut receipt) => {
                let readback = receipt.as_object_mut().and_then(|r| r.remove("readback"));
                let mut reply = json!({"outcome": "exported", "receipt": receipt});
                if let Some(r) = readback {
                    reply["readback"] = r;
                }
                reply
            }
            Err(mut why) => {
                if why.get("outcome").is_none() {
                    why["outcome"] = json!("refused");
                }
                why
            }
        }
    }

    fn export_inner(&mut self, job: &Job, mut doc: Value, scratch: &Path) -> Result<Value, Value> {
        let refuse = |code: &str| json!({"code": code});
        if job.software {
            return Err(no_software_adapter());
        }
        let target = job.target().to_string();
        // The target, as this build sealed it.
        let entry = self
            .startup
            .sealed
            .registry("export.target@1")
            .and_then(|r| r.entry(&target))
            .map(|e| e.value.clone())
            .ok_or_else(|| json!({"code": "unknown_target", "target": target, "codec": job.codec}))?;
        // Rates, and what the check refuses before anything is drawn.
        let (p, q) = job
            .frame_rate
            .or_else(|| doc.get("transport").and_then(frame_rate_of))
            .unwrap_or((60, 1));
        let frame = clock::frame_length(p, q)
            .map_err(|why| json!({"code": "bad_rate", "frame_rate": [p, q], "why": why}))?;
        let tc = timecode::of_rate(p, q, job.drop_frame).map_err(|why| {
            json!({"code": "drop_frame_rate", "frame_rate": format!("{p}/{q}"), "why": format!("drop_frame: {why}")})
        })?;
        let start_number = tc
            .number(&job.timecode)
            .map_err(|why| json!({"code": "bad_timecode", "why": why}))?;
        if target == "video" {
            if !matches!(job.codec.as_str(), "h264" | "prores_4444") {
                return Err(json!({"code": "codec_unbuilt", "video": job.codec}));
            }
            if !matches!(job.audio_codec.as_str(), "aac" | "pcm") {
                return Err(json!({"code": "codec_unbuilt", "audio": job.audio_codec}));
            }
            if let Some(size) = job.size.filter(|s| s[0] % 2 == 1 || s[1] % 2 == 1) {
                return Err(json!({"code": "export_size_odd", "size": size}));
            }
        }
        // #502: the captions asked for: a mode that draws them or sidecars that carry them.
        let cap = &job.captions;
        if !matches!(cap.mode.as_str(), "open" | "closed" | "both") || cap.files.iter().any(|f| f != "srt" && f != "vtt") {
            return Err(json!({"code": "bad_captions", "captions": {"mode": cap.mode, "files": cap.files},
                "why": "captions.mode is open, closed or both, and captions.files lists srt, vtt or both"}));
        }
        if cap.mode != "open" && cap.files.is_empty() {
            return Err(json!({"code": "captions_not_carried", "captions": {"mode": cap.mode, "files": cap.files},
                "why": format!("captions: mode {} with no file would carry no captions; name srt or vtt in captions.files", cap.mode)}));
        }
        let profile = job.loudness_profile.as_deref().unwrap_or("none");
        let profile = delivery::profile(profile).ok_or_else(|| json!({"code": "unknown_loudness_profile", "loudness_profile": profile}))?;
        // The frames that leave, as absolute indices on the frame grid.
        let on_grid = |t: i64| -> Result<i64, Value> {
            if t.rem_euclid(frame) != 0 {
                return Err(json!({"code": "not_whole_frames", "t": t, "frame": frame}));
            }
            Ok(t.div_euclid(frame))
        };
        let resolve = |hub: &Hub, t: &EvalTime| hub.resolve_time(&job.doc, t).map_err(refuse);
        let frames = match &job.range {
            Span::Unbuilt(form) => return Err(json!({"code": "range_unbuilt", "range": form})),
            Span::Whole => {
                // An open span has no end: an export takes a finite range of its own (Transport).
                if doc.pointer("/transport/span").and_then(Value::as_str) == Some("open") {
                    return Err(json!({"code": "span_open", "span": "open",
                        "why": "span open has no end: give the export a range, such as the recorded track's"}));
                }
                let span = doc_span(&doc).ok_or_else(|| refuse("no_span"))?;
                0..on_grid(span)?
            }
            Span::Between(a, b) => {
                let (a, b) = (resolve(self, a)?, resolve(self, b)?);
                if b <= a {
                    return Err(refuse("empty_range"));
                }
                on_grid(a)?..on_grid(b)?
            }
            Span::Still(t) => {
                let k = clock::index(resolve(self, t)?, frame);
                k..k + 1
            }
            Span::Marker(id) => {
                let (m, _) = *context_of(&doc)
                    .markers
                    .get(id)
                    .ok_or_else(|| json!({"code": "unknown_marker", "marker": id}))?;
                let k = clock::index(clock::film_time(m, 0, frame), frame);
                k..k + 1
            }
        };
        // Written under a temporary name beside `out`, renamed only when whole.
        let out = PathBuf::from(&job.out);
        let temp = out.with_file_name(format!(
            ".{}.part",
            out.file_name().map(|f| f.to_string_lossy()).unwrap_or_default()
        ));
        // #504: the frames replay the document's input track (the job's, or the hub's), so an
        // export shows each pick from its entry on; session view values never reach it (#501).
        let mut track = if job.track.is_empty() { self.track_json(&job.doc) } else { job.track.clone() };
        if self.planted(Planted::VariantExportFinalChoice) {
            // Planted: each choice's entries all take its last entry's option.
            let last: BTreeMap<String, Value> = track.iter().map(|e| (e["control"].to_string(), e["value"].clone())).collect();
            for e in &mut track {
                e["value"] = last[&e["control"].to_string()].clone();
            }
        }
        doc = crate::played::with_track(&doc, &track);
        let _ = self.inline_tables(&mut doc);
        let _ = self.inline_vectors(&mut doc);
        self.inline_occurrences(&mut doc, &job.track).map_err(|i| json!({"code": i.code, "issues": [i.to_json()]}))?;
        let _ = self.column_view(&mut doc, 0);
        std::fs::create_dir_all(scratch).map_err(|_| refuse("export_unwritable"))?;
        // The readiness gate: every asset the frames or the mix read, before any frame.
        if let Err(issue) = self.ready(&mut doc) {
            let mut drawn = 0;
            if self.scenario.planted == Some(Planted::ExportStartsThenStops) {
                // Planted: it starts anyway and stops at the missing strip's first frame.
                let stop = issue["start"].as_i64().map_or(0, |t| clock::index(t, frame));
                let shard = Shard { frames: frames.start..stop.max(frames.start), frame, size: job.size, opaque: !job.alpha, mix: None, gain: 0.0 };
                let part = self.export_shard(&doc, &shard, scratch, &mut Vec::new())?;
                let mut bytes = Vec::new();
                for f in &part.files {
                    bytes.extend(std::fs::read(f).unwrap_or_default());
                }
                let _ = std::fs::write(&temp, bytes);
                drawn = part.files.len();
            }
            return Err(json!({"outcome": "stopped", "gate": "readiness", "frames_drawn": drawn, "issues": [issue]}));
        }
        // #502: the script's lines, their captions laid out on this export's frames and held to
        // their profile, before any frame is drawn.
        if let Some(s) = self.script_of(&doc) {
            if let Some(problem) = &s.problem {
                return Err(problem.clone());
            }
            if let Some(who) = &s.unshareable {
                return Err(json!({"outcome": "blocked", "state": "BLOCKED", "code": "narration.unshareable", "unshareable": who,
                    "reason": format!("an export carries narration only under a license that says shareable: true; this one's doesn't: {who}")}));
            }
        }
        self.media.captions = Some(crate::narration::View { frame, draw: cap.mode != "closed", profile: cap.profile.clone() });
        let laid = self.captions_of(&doc, frame, cap.profile.as_deref())?;
        if let Some(l) = &laid {
            let found = captions::check(&l.captions, &l.limits, &crate::narration::graphemes);
            if !found.is_empty() {
                let list: Vec<Value> = found.iter().map(|v| json!({"caption": v.caption, "measure": v.limit, "what": v.what})).collect();
                return Err(json!({"outcome": "failed", "code": "captions", "profile": l.profile.name, "issues": list}));
            }
        }
        let hz = job.sample_rate.unwrap_or_else(|| sample_rate_of(&doc));
        let mix = if target == "video" {
            let mut d = doc.clone();
            d["transport"]["sample_rate"] = json!(hz);
            Some(Arc::new(self.mix_of(&d)?))
        } else {
            None
        };
        // #502: the delivery gain: the master measured with none, then one static gain to the
        // profile's target ahead of the master's limiter, and one correction where its cuts left
        // the loudness outside the profile.
        let (mut gain, mut before) = (0.0, None);
        if let (Some(mix), Some((target_lufs, _))) = (&mix, profile.integrated) {
            let (first, last) = (self.span_start(frames.start, frame, hz), self.span_start(frames.end, frame, hz));
            let planted = planted_of(self.scenario.planted, false);
            let pass = |db: f64| {
                let mut player = Player::new(mix.clone(), planted);
                player.delivery = amp(db);
                player.seek(first);
                let mut buf = vec![0f32; 2 * (last - first).max(0) as usize];
                player.read(&mut buf);
                (loudness::measure(&buf, &[1.0, 1.0], i64::from(hz), 8), player.limited())
            };
            let (master, _) = pass(0.0);
            // Planted: no static gain; the normalizer rides the master instead.
            if let Some(g) = profile.gain(master.integrated).filter(|_| !deep_canvas_media::planted(NORMALIZER)) {
                let (read, cut) = pass(g);
                gain = if cut && !profile.holds(read.integrated) { g + target_lufs - read.integrated } else { g };
            }
            before = Some(master);
        }
        // Planted: the png writer exports only the session's selected items.
        if target == "png" && self.scenario.planted == Some(Planted::TargetExportsSelection) {
            let selection = self.session_state.get(&job.doc).map(|s| s["selection"].clone()).unwrap_or(Value::Null);
            if let (Some(sel), Some(items)) = (selection.as_array().filter(|s| !s.is_empty()), doc["items"].as_object_mut()) {
                items.retain(|id, i| sel.contains(&json!(id)) || i["kind"] == "camera@1");
            }
        }
        // Shards: contiguous runs of frames, each from its own fresh session and player.
        let len = frames.end - frames.start;
        let n = i64::from(job.shards).min(len.max(1));
        let mut parts = Vec::new();
        let mut pcm = Vec::new();
        for i in 0..n {
            let shard = Shard {
                frames: frames.start + len * i / n..frames.start + len * (i + 1) / n,
                frame,
                size: job.size,
                opaque: !job.alpha,
                mix: mix.clone(),
                gain,
            };
            let dir = scratch.join(format!("shard{i}"));
            std::fs::create_dir_all(&dir).map_err(|_| refuse("export_unwritable"))?;
            parts.push(self.export_shard(&doc, &shard, &dir, &mut pcm)?);
        }
        // #502: the readings of the PCM that leaves, held to the profile; and, when the
        // limiter never cut, its loudness range held to the master's before the gain.
        let cut = parts.iter().any(|p| p.cut);
        let mut sound = None;
        if mix.is_some() {
            if before.is_some() && deep_canvas_media::planted(NORMALIZER) {
                ride_gain(&mut pcm, hz);
            }
            let samples: Vec<f32> = pcm.as_chunks::<4>().0.iter().map(|b| f32::from_le_bytes(*b)).collect();
            let read = loudness::measure(&samples, &[1.0, 1.0], i64::from(hz), 8);
            let mut misses = profile.misses(&read);
            misses.extend(before.as_ref().and_then(|b: &Loudness| delivery::range_kept(b.range, read.range, cut)));
            if !misses.is_empty() {
                return Err(loudness_failed(profile.name, "pcm", &misses, &read));
            }
            sound = Some(read);
        }
        let size = parts.first().map(|p| p.size).unwrap_or([0, 0]);
        let first = start_number + frames.start as u64;
        let tc_start = match self.scenario.planted {
            Some(Planted::RangeRestartsTimecode) => start_number,
            _ => first,
        };
        if let Some(parent) = out.parent() {
            std::fs::create_dir_all(parent).map_err(|_| refuse("export_unwritable"))?;
        }
        let written = self.write_target(job, &target, &entry, &parts, &pcm, hz, &temp, scratch, size, (p, q), &tc, tc_start);
        let encoder = match written {
            Ok(e) => e,
            Err(e) => {
                let _ = std::fs::remove_file(&temp);
                let _ = std::fs::remove_dir_all(&temp);
                return Err(e);
            }
        };
        let drop_temp = || {
            let _ = std::fs::remove_file(&temp);
            let _ = std::fs::remove_dir_all(&temp);
        };
        // #502: the same readings of the decoded delivery, held to the profile too.
        let mut delivered = None;
        if sound.is_some() {
            let read = match self.pcm_at(&temp, "delivery") {
                Ok((rate, channels, samples)) => loudness::measure(&samples, &vec![1.0; channels], rate, 8),
                Err(e) => {
                    drop_temp();
                    return Err(json!({"code": "delivery_unread", "why": e}));
                }
            };
            let misses = profile.misses(&read);
            if !misses.is_empty() {
                drop_temp();
                return Err(loudness_failed(profile.name, "delivery", &misses, &read));
            }
            delivered = Some(read);
        }
        // #502: the sidecars, beside the delivery under its name, whole or not at all.
        let mut sidecars: Vec<(PathBuf, PathBuf)> = Vec::new();
        if let Some(l) = &laid {
            for kind in &job.captions.files {
                let cues = sidecar_cues(&l.captions, frame);
                let text = if kind == "srt" { captions::srt(&cues) } else { captions::vtt(&cues) };
                let to = out.with_extension(kind);
                let part = to.with_file_name(format!(".{}.part", to.file_name().map(|f| f.to_string_lossy()).unwrap_or_default()));
                if std::fs::write(&part, text).is_err() {
                    drop_temp();
                    sidecars.iter().for_each(|(part, _)| drop(std::fs::remove_file(part)));
                    return Err(refuse("export_unwritable"));
                }
                sidecars.push((part, to));
            }
        }
        let renamed = std::fs::rename(&temp, &out).and_then(|()| sidecars.iter().try_for_each(|(part, to)| std::fs::rename(part, to)));
        if let Err(e) = renamed {
            drop_temp();
            for (part, to) in &sidecars {
                let _ = std::fs::remove_file(part);
                let _ = std::fs::remove_file(to);
            }
            let _ = std::fs::remove_file(&out);
            return Err(json!({"code": "export_unwritable", "why": e.to_string()}));
        }
        // Planted: the png writer writes a baked channel back into the document.
        if target == "png" && self.scenario.planted == Some(Planted::TargetWritesBakedChannel) {
            self.bake_back(&job.doc, &doc);
        }
        let count = frames.end - frames.start;
        let adapter = self
            .gpu3()
            .and_then(|g| g.device().adapter.as_ref().map(|a| a.name.clone()));
        let hidden: Vec<&String> = match entry["hidden"].as_str() {
            Some("listed") => doc["items"]
                .as_object()
                .into_iter()
                .flatten()
                .filter(|(_, i)| i["visible"] == json!(false))
                .map(|(id, _)| id)
                .collect(),
            _ => Vec::new(),
        };
        let mut receipt = json!({
            "target": target,
            "size": size,
            "frame_rate": [p, q],
            "frames": count,
            "duration": count * frame,
            "frame_hashes": parts.iter().flat_map(|p| p.hashes.iter().map(hex)).collect::<Vec<_>>(),
            "timecode": {"start": self.label(&tc, tc_start), "last": self.label(&tc, tc_start + count.max(1) as u64 - 1), "drop_frame": job.drop_frame},
            "encoder": encoder,
            "handoff": "copy",
            "adapter": {"name": adapter, "software": false},
            "shards": n,
            "hidden": hidden,
        });
        if mix.is_some() {
            receipt["sample_rate"] = json!(hz);
            receipt["audio"] = json!(job.audio_codec);
            receipt["pcm_hashes"] = json!(parts.iter().flat_map(|p| p.pcm.iter().cloned()).collect::<Vec<_>>());
        }
        if let Some(read) = &sound {
            for (k, v) in readings(read) {
                receipt[k] = v;
            }
            receipt["loudness_profile"] = json!(profile.name);
            receipt["gain"] = json!(gain);
            receipt["limiter_cut"] = json!(cut);
            receipt["delivery"] = Value::Object(delivered.as_ref().map(readings).unwrap_or_default());
        }
        if let Some(l) = &laid {
            receipt["captions"] = json!({
                "profile": l.profile.name,
                "mode": job.captions.mode,
                "files": job.captions.files,
                "cues": l.captions.iter().map(caption_json).collect::<Vec<_>>(),
                "violations": [],
            });
        }
        let mut reply = json!(receipt);
        if job.readback {
            let mut back = Vec::new();
            for f in parts.iter().flat_map(|p| &p.files) {
                let bytes = std::fs::read(f).map_err(|_| refuse("export_unwritable"))?;
                back.push(crate::evidence::put(&self.scenario.evidence, &bytes).map_err(|_| refuse("evidence_unwritable"))?);
            }
            reply["readback"] = json!({"frames": back});
        }
        Ok(reply)
    }

    /// Frame `n`'s timecode label, or the planted labeller's that drops in tenth minutes too.
    pub(crate) fn label(&self, tc: &timecode::Timecode, n: u64) -> String {
        if self.scenario.planted != Some(Planted::DropFrameEveryTenthMinute) || tc.drop == 0 {
            return tc.label(n);
        }
        let (fps, drop) = (u64::from(tc.nominal), u64::from(tc.drop));
        let per_minute = fps * 60 - drop;
        let f = if n >= drop { n + drop * ((n - drop) / per_minute) } else { n };
        let (s, ff) = (f / fps, f % fps);
        format!("{:02}:{:02}:{:02};{:02}", s / 3600, s / 60 % 60, s % 60, ff)
    }

    /// The readiness gate: every strip's asset, and every asset an item probes, in the store;
    /// the first missing one named, with the strip's start.
    fn ready(&mut self, doc: &mut Value) -> Result<(), Value> {
        let strips: Vec<(String, String, Option<i64>)> = doc
            .get("strips")
            .and_then(Value::as_object)
            .into_iter()
            .flatten()
            .filter_map(|(id, s)| {
                let sha = deep_canvas_media::doc::strip_asset(s)?.to_string();
                Some((id.clone(), sha, deep_canvas_media::doc::time(doc, s.get("start"))))
            })
            .collect();
        for (id, sha, start) in strips {
            if sha.len() != 64 || crate::evidence::read(&self.scenario.evidence, &sha).is_none() {
                return Err(json!({"code": "asset_missing", "severity": "error", "strip": id, "asset": sha, "start": start,
                    "what": format!("strip `{id}` plays asset {sha}, which the evidence store doesn't hold")}));
            }
        }
        if let Some(issue) = self.probe_assets(doc).into_iter().next() {
            return Err(json!({"code": "asset_missing", "severity": "error", "item": issue.ids.first(), "path": issue.path,
                "asset": issue.actual, "why": issue.code, "what": issue.what}));
        }
        Ok(())
    }

    /// Planted: a new current revision of `id` holding a baked channel, written by the export.
    fn bake_back(&mut self, id: &str, doc: &Value) {
        let mut baked = doc.clone();
        baked["channels"]["baked"] = json!({"target": "items/baked", "type": "f32", "keys": {}});
        self.push_revision(id, baked);
    }

    /// Planted programs' edit: `doc` as a new current revision of `id`, by the last writer.
    pub(crate) fn push_revision(&mut self, id: &str, baked: Value) {
        let hash = hex(Sha256::digest(baked.to_string()));
        let rows = self.revisions.entry(id.to_string()).or_default();
        let last = rows.iter().rev().find(|r| r.state == "current");
        let row = crate::hub::Row {
            rev: last.map_or(1, |r| r.rev + 1),
            base_rev: last.map_or(0, |r| r.rev),
            writer: last.map_or_else(
                || deep_canvas::show::Writer { kind: deep_canvas::show::WriterKind::Plugin, id: "export".into() },
                |r| r.writer.clone(),
            ),
            hash,
            state: "current",
            doc: baked,
        };
        for r in rows.iter_mut().filter(|r| r.state == "current") {
            r.state = "superseded";
        }
        rows.push(row);
    }

    /// The target's writer, handed the shards' frames and the samples: the encoder it ran.
    #[allow(clippy::too_many_arguments)]
    fn write_target(
        &mut self,
        job: &Job,
        target: &str,
        entry: &Value,
        parts: &[Rendered],
        pcm: &[u8],
        hz: u32,
        temp: &Path,
        scratch: &Path,
        size: [u16; 2],
        (p, q): (u32, u32),
        tc: &timecode::Timecode,
        start: u64,
    ) -> Result<Value, Value> {
        let paths = |r: &Rendered| r.files.iter().map(|f| f.to_string_lossy().into_owned()).collect::<Vec<_>>();
        let failed = |reply: &Value| json!({"code": "writer_failed", "target": target, "reply": reply});
        match (target, entry["writer"].as_str()) {
            ("png", Some("media")) => {
                let files: Vec<String> = parts.iter().flat_map(paths).collect();
                let job = json!({"op": "export.png", "frames": files, "size": size, "out": temp});
                let (reply, pid) = self.media_job(ENCODE_TOOL, job);
                reply.get("frames").ok_or_else(|| failed(&reply))?;
                Ok(json!({"name": "png", "process": {"pid": pid, "role": ENCODE_TOOL}}))
            }
            ("video", Some("media")) => {
                let mut files = Vec::new();
                let mut encoder = Value::Null;
                for (i, part) in parts.iter().enumerate() {
                    let path = scratch.join(format!("part{i}.mov"));
                    let ask = json!({"op": "export.part", "codec": job.codec, "frames": paths(part),
                        "size": size, "rate": [p, q], "out": path});
                    let (reply, pid) = self.media_job(ENCODE_TOOL, ask);
                    encoder = reply.get("encoder").cloned().ok_or_else(|| failed(&reply))?;
                    encoder["process"] = json!({"pid": pid, "role": ENCODE_TOOL});
                    files.push(path);
                }
                let audio = scratch.join("audio.f32");
                std::fs::write(&audio, pcm).map_err(|_| json!({"code": "export_unwritable"}))?;
                let ask = json!({"op": "export.join", "parts": files, "out": temp,
                    "audio": {"path": audio, "sample_rate": hz, "channels": 2, "codec": job.audio_codec},
                    "timecode": {"start_frame": start, "drop_frame": tc.drop > 0, "rate": tc.nominal}});
                let (reply, _) = self.media_job(ENCODE_TOOL, ask);
                reply.get("frames").ok_or_else(|| failed(&reply))?;
                Ok(encoder)
            }
            _ => crate::test_registries::write_export(target, entry, parts, temp)
                .ok_or_else(|| json!({"code": "no_writer", "target": target})),
        }
    }
}

impl Hub<'_> {
    /// `session`: a document's session state, its selection and view inputs, after `set`
    /// replaces it when given. Nothing an export writes reads it.
    pub fn session_reply(&mut self, doc: &str, set: Option<&Value>) -> Value {
        if let Some(state) = set {
            let mut state = state.clone();
            for k in ["selection", "view"] {
                if state.get(k).is_none() {
                    state[k] = if k == "selection" { json!([]) } else { json!({}) };
                }
            }
            self.session_state.insert(doc.to_string(), state);
            // #504: a view value the session now holds shows at once.
            self.replay(doc, self.now);
        }
        let state = self
            .session_state
            .get(doc)
            .cloned()
            .unwrap_or_else(|| json!({"selection": [], "view": {}}));
        json!({"session": state})
    }

    /// `frame_hash`: the export's GPU hash pass on BGRA8 frames from the evidence store, each
    /// its own BLAKE3.
    pub fn frame_hash(&mut self, frames: &[([u32; 2], String)], software: bool) -> Value {
        if software {
            return no_software_adapter();
        }
        let mut hashes = Vec::new();
        for ([w, h], sha) in frames {
            let Some(bytes) = crate::evidence::read(&self.scenario.evidence, sha) else {
                return json!({"outcome": "refused", "code": "unknown_asset", "asset": sha});
            };
            if bytes.len() as u64 != u64::from(*w) * u64::from(*h) * 4 {
                return json!({"outcome": "refused", "code": "bad_frame", "asset": sha, "size": [w, h]});
            }
            match self.gpu_hash(&bytes, [*w, *h]) {
                Ok(d) => hashes.push(hex(d)),
                Err(e) => return e,
            }
        }
        let adapter = self.gpu3().and_then(|g| g.device().adapter.as_ref().map(|a| a.name.clone()));
        json!({"outcome": "hashed", "hashes": hashes, "adapter": {"name": adapter, "software": false}})
    }

    /// One BGRA8 frame's BLAKE3 through the export's GPU pass.
    pub(crate) fn gpu_hash(&mut self, bgra: &[u8], size: [u32; 2]) -> Result<[u8; 32], Value> {
        let planted = deep_gpu::blake3::Planted {
            joins_right_left: self.scenario.planted == Some(Planted::ChunkTreeWrongOrder),
        };
        let gpu = self.gpu3().map(|g| g.device().clone()).ok_or_else(|| json!({"outcome": "refused", "code": "gpu_unavailable"}))?;
        let mut frames = deep_gpu::blake3::Blake3::new(&gpu.device, planted).frames(&gpu.device, &gpu.queue, size);
        let first = frames.push(bgra);
        first.or_else(|| frames.finish()).ok_or_else(|| json!({"outcome": "refused", "code": "gpu_unavailable"}))
    }

    /// `cross_machine`: two renders of the same sound, as float or 16-bit WAVs in the evidence
    /// store, read against each other: the peak per-sample difference in dBFS (null when they
    /// are identical) and the audio result. Across architectures audio is a reading: at or below
    /// −96 dBFS it passes, above it is INCONCLUSIVE, never PASS and never FAIL.
    pub fn cross_machine(&self, wavs: &[String; 2]) -> Value {
        let mut read = Vec::new();
        for sha in wavs {
            match crate::evidence::read(&self.scenario.evidence, sha).as_deref().and_then(wav_samples) {
                Some(w) => read.push(w),
                None => return json!({"outcome": "refused", "code": "unreadable_audio", "audio": sha}),
            }
        }
        let (a, b) = (&read[0], &read[1]);
        if a.0 != b.0 || a.1 != b.1 || a.2.len() != b.2.len() {
            return json!({"outcome": "refused", "code": "audio_differs_in_shape",
                "audio": [{"rate": a.0, "channels": a.1, "samples": a.2.len()}, {"rate": b.0, "channels": b.1, "samples": b.2.len()}]});
        }
        let peak = a.2.iter().zip(&b.2).map(|(x, y)| (f64::from(*x) - f64::from(*y)).abs()).fold(0.0, f64::max);
        let db = (peak > 0.0).then(|| 20.0 * peak.log10());
        let verdict = match db {
            Some(d) if d > -96.0 => "INCONCLUSIVE",
            _ => "PASS",
        };
        json!({"outcome": "read", "peak_dbfs": db, "verdict": verdict, "threshold_dbfs": -96})
    }
}

/// A WAV's sample rate, channel count and interleaved samples: float 32-bit or PCM 16-bit.
fn wav_samples(bytes: &[u8]) -> Option<(u32, u16, Vec<f32>)> {
    if bytes.len() < 12 || &bytes[0..4] != b"RIFF" || &bytes[8..12] != b"WAVE" {
        return None;
    }
    let (mut fmt, mut data) = (None, None);
    let mut o = 12;
    while o + 8 <= bytes.len() {
        let len = u32::from_le_bytes(bytes[o + 4..o + 8].try_into().ok()?) as usize;
        let body = bytes.get(o + 8..(o + 8 + len).min(bytes.len()))?;
        match &bytes[o..o + 4] {
            b"fmt " if body.len() >= 16 => {
                let mut tag = u16::from_le_bytes([body[0], body[1]]);
                if tag == 0xfffe && body.len() >= 26 {
                    tag = u16::from_le_bytes([body[24], body[25]]);
                }
                let channels = u16::from_le_bytes([body[2], body[3]]);
                let rate = u32::from_le_bytes(body[4..8].try_into().ok()?);
                let bits = u16::from_le_bytes([body[14], body[15]]);
                fmt = Some((tag, channels, rate, bits));
            }
            b"data" => data = Some(body),
            _ => {}
        }
        o += 8 + len + len % 2;
    }
    let ((tag, channels, rate, bits), data) = (fmt?, data?);
    let samples = match (tag, bits) {
        (3, 32) => data.as_chunks::<4>().0.iter().map(|c| f32::from_le_bytes(*c)).collect(),
        (1, 16) => data.as_chunks::<2>().0.iter().map(|c| f32::from(i16::from_le_bytes(*c)) / 32_768.0).collect(),
        _ => return None,
    };
    Some((rate, channels, samples))
}

/// The planted sidecar writer (#502): it times cues at 24 frames a second whatever the rate.
const SIDECAR_24: &str = "sidecar_times_at_24fps";
/// The planted normalizer (#502): it rides gain to −23 LUFS.
const NORMALIZER: &str = "normalizer_rides_gain";

/// The captions as a sidecar writes them: as they are, or, planted, each time's frame count
/// at 1/24 s a frame.
fn sidecar_cues(captions: &[Caption], frame: i64) -> Vec<Caption> {
    if !deep_canvas_media::planted(SIDECAR_24) {
        return captions.to_vec();
    }
    let at_24 = |t: i64| t / frame * (deep_canvas::grammar::FLICKS_PER_SECOND / 24);
    captions.iter().map(|c| Caption { start: at_24(c.start), end: at_24(c.end), ..c.clone() }).collect()
}

/// The planted normalizer: each 10 ms of the PCM takes the gain that brings the short-term
/// loudness of the 3 s ending there to −23 LUFS, the first 3 s the first whole window's.
fn ride_gain(pcm: &mut [u8], hz: u32) {
    let samples: Vec<f32> = pcm.as_chunks::<4>().0.iter().map(|b| f32::from_le_bytes(*b)).collect();
    let short_term = loudness::measure(&samples, &[1.0, 1.0], i64::from(hz), 1).short_term;
    let Some(last) = short_term.len().checked_sub(1) else { return };
    let block = (hz as usize / 100).max(1) * 8;
    for (k, bytes) in pcm.chunks_mut(block).enumerate() {
        let read = short_term[k.clamp(299.min(last), last)];
        if !read.is_finite() {
            continue;
        }
        let gain = amp(-23.0 - read);
        for b in bytes.as_chunks_mut::<4>().0 {
            *b = ((f64::from(f32::from_le_bytes(*b)) * gain) as f32).to_le_bytes();
        }
    }
}

/// A loudness bake's readings as a receipt carries them.
fn readings(l: &Loudness) -> serde_json::Map<String, Value> {
    let n = |x: f64| if x.is_finite() { json!(x) } else { Value::Null };
    let plr = l.true_peak - l.integrated;
    [("integrated", n(l.integrated)), ("lra", n(l.range)), ("max_m", n(l.momentary_max)), ("max_s", n(l.short_term_max)),
        ("true_peak", n(l.true_peak)), ("sample_peak", n(l.sample_peak)), ("plr", n(plr))]
        .into_iter()
        .map(|(k, v)| (k.to_string(), v))
        .collect()
}

/// An export whose sound lies outside its loudness profile: each measure that does, with its
/// reading and what it is held to, on the PCM or on the decoded delivery.
fn loudness_failed(profile: &str, on: &str, misses: &[Miss], read: &Loudness) -> Value {
    let issues: Vec<Value> = misses
        .iter()
        .map(|m| {
            json!({"measure": m.measure, "reading": m.reading, "target": m.target, "tolerance": m.tolerance, "on": on,
                "what": format!("{}: the {on} reads {:.2}, held to {:.2} within {:.2} by {profile}", m.measure, m.reading, m.target, m.tolerance)})
        })
        .collect();
    json!({"outcome": "failed", "code": "loudness", "loudness_profile": profile, "issues": issues, "readings": readings(read)})
}

/// A caption as a receipt lists it.
fn caption_json(c: &Caption) -> Value {
    json!({"name": c.id, "line": c.line, "text": c.lines.join("\n"), "in": c.start, "out": c.end})
}

/// The document's span, from its transport.
fn doc_span(doc: &Value) -> Option<i64> {
    let span = doc.pointer("/transport/span")?;
    deep_canvas_media::doc::time(doc, Some(span))
}

/// One shard of an export: its frames and how they are drawn and heard.
pub(crate) struct Shard {
    pub frames: std::ops::Range<i64>,
    pub frame: i64,
    pub size: Option<[u16; 2]>,
    pub opaque: bool,
    pub mix: Option<Arc<Mix>>,
    /// #502: the delivery gain on the master, dB.
    pub gain: f64,
}

/// What a shard rendered: its frame files, their BLAKE3 digests, each frame span's SHA-256 over
/// f32le PCM, and the frame size.
#[derive(Default)]
pub(crate) struct Rendered {
    pub files: Vec<std::path::PathBuf>,
    pub hashes: Vec<[u8; 32]>,
    pub pcm: Vec<String>,
    pub size: [u16; 2],
    /// #502: whether the master's limiter cut a sample of the shard.
    pub cut: bool,
}

pub(crate) fn hex(d: impl AsRef<[u8]>) -> String {
    d.as_ref().iter().map(|b| format!("{b:02x}")).collect()
}

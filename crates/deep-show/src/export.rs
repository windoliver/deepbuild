//! Issue #501: exports. A timeline leaves as a file through a sealed `export.target@1` entry:
//! its frames evaluated on a virtual clock in a fresh session with the document's default view
//! (no selection, cutaway or hover reaches them), each raster the one a still draws, hashed with
//! BLAKE3 on the GPU, its audio the mix's samples over the frame's span, the file written by the
//! target's writer under a temporary name and renamed only when whole.
//!
//! Issue #157: an export is all or nothing. Its sound is rendered and held to its profile before
//! any frame; its frames stream to the encode tool as they are drawn, none stored raw, while the
//! GPU hashes and reads each one for film.blank and film.wrap; it holds the machine's GPU lease
//! while it runs; and the delivery is read back from its own bytes in a fresh decode worker
//! (export.color, export.fidelity) before it takes its name. Any failure leaves no file.

mod feed;
mod fidelity;
mod frames;
mod guards;
#[cfg(feature = "test-export-guards")]
mod test_guards;

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use deep_canvas::document::frame_rate_of;
use deep_canvas::schedule::{default_view, Scheduler, Session as DocSession};
use deep_canvas::time as clock;
use deep_canvas::timecode;
use deep_canvas_media::analysis::loudness::{self, Loudness};
use deep_canvas_media::captions::{self, Caption};
use deep_canvas_media::delivery::{self, Miss};
use deep_canvas_media::export_checks as rules;
use deep_canvas_media::mix::{amp, Mix, Player};
use serde_json::{json, Map, Value};
use sha2::{Digest, Sha256};

use crate::frames::drawing_of;
use crate::hub::{EvalTime, Hub, Planted};
use crate::time::{context_of, sample_rate_of};
use crate::mixdown::planted_of;
use crate::snapshot::Unfit;
use frames::{Lease, Run, Sink};

/// The export guards' wrong programs (#157), each only to prove its acceptance test fails on it.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Guard {
    /// The export's limiter leaves no codec margin.
    NoCodecMargin,
    /// A shard's first sample is rounded instead of floored.
    ShardStartRounds,
    /// The readiness gate counts no disk.
    NoDiskGate,
    /// Each raw frame is kept on disk.
    StoresRawFrames,
    /// export.fidelity compares the frames kept from the export's own pass.
    FidelityKeepsFrames,
    /// film.blank counts only the pixels under its luma floor.
    BlankDarkOnly,
    /// film.wrap compares the last frame with the second.
    WrapAgainstSecond,
    /// A wrong encoder, muxer or reader in the helper processes, by its name there.
    Codec(&'static str),
}

/// The helper processes' wrong programs (#157), by the names they answer to.
const CODEC_PLANTS: [&str; 18] = [
    "encode_full_range_bt601",
    "h264_full_range_under_limited_tags",
    "prores_fed_full_range",
    "prores_premultiplies_straight",
    "encoder_starves_bitrate",
    "encoder_ignores_chapters",
    "video_writer_drops_frame",
    "writer_drops_frame_700",
    "writer_repeats_frame_701",
    "muxer_strips_audio_edit_list",
    "muxer_edit_list_1024",
    "muxer_swaps_channels",
    "muxer_keeps_end_padding",
    "muxer_writes_moov_last",
    "muxer_timescale_600",
    "muxer_timescale_1000",
    "muxer_drops_video_edit_list",
    "reader_pads_last_packet",
];

/// #501's wrong programs, #1897's and #157's, by the names their acceptance suites give them.
pub(crate) fn planted(name: &str) -> Option<Planted> {
    use Guard as G;
    Some(match name {
        "hash_xors_without_position" => Planted::HashXorsWithoutPosition,
        "span_rounds_each_frame" => Planted::SpanRoundsEachFrame,
        "span_rounds_start" => Planted::SpanRoundsStart,
        "chunk_tree_wrong_order" => Planted::ChunkTreeWrongOrder,
        "range_restarts_timecode" => Planted::RangeRestartsTimecode,
        "export_starts_then_stops" => Planted::ExportStartsThenStops,
        "target_exports_selection" => Planted::TargetExportsSelection,
        "target_writes_baked_channel" => Planted::TargetWritesBakedChannel,
        "target_reader_is_writer" => Planted::TargetReaderIsWriter,
        "mixer_linux_one_step" => Planted::MixerLinuxOneStep,
        "drop_frame_every_tenth_minute" => Planted::DropFrameEveryTenthMinute,
        "timecode_track_zero" => Planted::TimecodeTrackZero,
        "png_premultiplies_straight" => Planted::PngPremultipliesStraight,
        "video_drops_frame_300" => Planted::VideoDropsFrame300,
        "range_starts_one_frame_late" => Planted::RangeStartsOneFrameLate,
        // #525's, reached by `--planted`: a golden verifier and a receipt writer.
        "golden_compares_across_digests" => Planted::GoldenComparesAcrossDigests,
        "receipt_omits_runtime_digest" => Planted::ReceiptOmitsRuntimeDigest,
        "limiter_without_codec_margin" => Planted::Export(G::NoCodecMargin),
        "shard_rounds_first_sample" => Planted::Export(G::ShardStartRounds),
        "export_without_disk_gate" => Planted::Export(G::NoDiskGate),
        "export_stores_raw_frames" => Planted::Export(G::StoresRawFrames),
        "fidelity_keeps_frames" => Planted::Export(G::FidelityKeepsFrames),
        "blank_counts_dark_only" => Planted::Export(G::BlankDarkOnly),
        "wrap_compares_second_frame" => Planted::Export(G::WrapAgainstSecond),
        other => Planted::Export(G::Codec(CODEC_PLANTS.iter().find(|p| **p == other)?)),
    })
}

impl Hub<'_> {
    /// Whether #157's wrong program `g` is planted.
    fn guard_planted(&self, g: Guard) -> bool {
        self.scenario.planted == Some(Planted::Export(g))
    }
}

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
        let (block, pictures) = self.videos_at(doc, t, true);
        // #157: a video the decode worker couldn't decode at this frame stops the frame.
        if let Some(id) = undecoded(doc, &block) {
            return Err(Unfit { code: "decode_error", path: format!("items/{id}") });
        }
        self.renderer.videos = pictures;
        self.caption_at(doc, t);
        let unfit = |code| Unfit { code, path: "frames".into() };
        let drawing = drawing_of(sched, session).ok_or_else(|| unfit("no_drawing"))?;
        #[allow(unused_mut)]
        let (mut rgba, size) = if deep_canvas_scene3d::scene::has_3d(doc) {
            self.rgba3d(doc, t, &drawing, size)?
        } else {
            let sides = crate::film::program_of(sched, session).and_then(|p| crate::film::sides(&p, doc, t, false));
            let (rgba, _, size) = match sides {
                Some(sides) => self.film_rgba(&drawing, size, &sides, doc, (opaque, Some(t)))?,
                None if opaque => self.printed_frame(doc, t, &drawing, size)?,
                None => self.canonical_rgba(&drawing, size, opaque)?,
            };
            (rgba, size)
        };
        #[cfg(feature = "test-export-guards")]
        test_guards::paint(doc, test_guards::frame_of(doc, t), &mut rgba, size, |r| self.look.light.get(r).copied());
        // #1163: the planted renderer seeds its noise from the clock in exports too.
        if self.scenario.planted == Some(Planted::SeedsNoiseFromClock) {
            crate::hub::export_noise(&mut rgba, t);
        }
        Ok((rgba, size))
    }

    /// #157: an opaque 2D frame as the canvas shows it: when the document's look prints (its
    /// grain), its items through the print finish on the GPU, then the caption and the status
    /// marks over them; otherwise the canonical raster.
    fn printed_frame(&mut self, doc: &Value, t: i64, drawing: &crate::frames::Painted, size: Option<[u16; 2]>) -> Result<(Vec<u8>, crate::snapshot::Drawn, [u16; 2]), Unfit> {
        let Some(def) = self.print_look(doc, None) else {
            return self.canonical_rgba(drawing, size, true);
        };
        let drawn = self.renderer.prepare_drawing(drawing, &self.scenario.evidence)?;
        let px = size.unwrap_or_else(|| crate::snapshot::px(drawn.frame.size));
        let Some(mut rgba) = self.print_part(&def, doc, &drawn.part(drawn.view, true, false), px, t)? else {
            return self.canonical_rgba(drawing, size, true);
        };
        self.caption_over(&mut rgba, px);
        let status = self.renderer.raster(&drawn.part(drawn.view, false, true), px, None);
        crate::snapshot::over(&mut rgba, &status);
        Ok((rgba, drawn, px))
    }

    /// One shard's sound: the mix's samples over each of its frames' spans (frame k's span starts
    /// at ⌊k·Δ × hz ÷ flicks⌋), from a player sought to the shard's first sample, appended to
    /// `pcm`; each span's SHA-256 over f32le, and whether the master's limiter cut.
    fn export_sound(&mut self, shard: &Shard, mix: &Arc<Mix>, pcm: &mut Vec<u8>) -> (Vec<String>, bool) {
        let hz = mix.rate as u32;
        let span = |k: i64| self.span_start(k, shard.frame, hz);
        let mut player = Player::new(mix.clone(), planted_of(self.scenario.planted, false));
        player.delivery = amp(shard.gain);
        if let Some(db) = shard.ceiling {
            player.set_ceiling(db);
        }
        let first = span(shard.frames.start);
        // Planted: the splitter rounds the shard's first sample instead of flooring it.
        let rounded = self.guard_planted(Guard::ShardStartRounds) && shard.frames.start > 0;
        player.seek(if rounded { round_start(shard.frames.start, shard.frame, hz) } else { first });
        let mut hashes = Vec::new();
        for k in shard.frames.clone() {
            let n = (span(k + 1) - span(k)).max(0) as usize;
            let mut buf = vec![0f32; 2 * n];
            player.read(&mut buf);
            let bytes: Vec<u8> = buf.iter().flat_map(|x| x.to_le_bytes()).collect();
            hashes.push(hex(Sha256::digest(&bytes)));
            pcm.extend_from_slice(&bytes);
        }
        (hashes, player.limited())
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
    /// #157: `video.quality` (draft, standard or master: export.fidelity's floor), `video.alpha:
    /// premultiplied` and `video.keyframe_interval`.
    pub quality: String,
    pub premultiplied: bool,
    pub keyframe_interval: Option<u32>,
    /// #157: `brief: {refuse: ["end_cut"]}`: a brief that refuses end cuts fails the export that
    /// has one.
    pub refuse_end_cuts: bool,
    /// #157: the agent session that asks for the export, which holds its GPU lease.
    pub session: Option<String>,
}

impl Default for Job {
    fn default() -> Self {
        Job {
            doc: String::new(),
            range: Span::Whole,
            size: None,
            frame_rate: None,
            codec: "h264".into(),
            alpha: false,
            sample_rate: None,
            audio_codec: "pcm".into(),
            shards: 1,
            timecode: "00:00:00:00".into(),
            drop_frame: false,
            out: String::new(),
            software: false,
            readback: false,
            track: Vec::new(),
            captions: Captions::default(),
            loudness_profile: None,
            quality: "standard".into(),
            premultiplied: false,
            keyframe_interval: None,
            refuse_end_cuts: false,
            session: None,
        }
    }
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
        quality: match s(video.and_then(|v| v.get("quality"))) {
            None => "standard".into(),
            Some(q) => Some(q).filter(|q| rules::quality_floor(q).is_some())?,
        },
        premultiplied: video.and_then(|v| v.get("alpha")).and_then(Value::as_str) == Some("premultiplied"),
        keyframe_interval: crate::optional(video.and_then(|v| v.get("keyframe_interval")), whole)?,
        refuse_end_cuts: c.get("brief").and_then(|b| b.get("refuse")).and_then(Value::as_array).is_some_and(|r| r.contains(&json!("end_cut"))),
        session: s(c.get("session")),
    })
}

/// A declared span `[from, to]` as times.
fn pair_of(v: &Value) -> Option<(EvalTime, EvalTime)> {
    let a = v.as_array().filter(|a| a.len() == 2)?;
    Some((at(&a[0])?, at(&a[1])?))
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
        // #409: what the hub's own frames draw, each recipe instance's derived items in its place.
        let (form, _) = self.drawing_form(&doc);
        self.export_doc(job, form)
    }

    /// [`Hub::export_run`] of a given document, under `job.doc` as its ID.
    pub(crate) fn export_doc(&mut self, job: &Job, doc: Value) -> Value {
        // #157: the export's scratch (its PCM and the encoded parts) sits beside its output, on the
        // volume the disk gate reads; nothing of it outlives the export.
        let out = PathBuf::from(&job.out);
        let temp = temp_of(&out);
        let scratch = out.with_file_name(format!(".{}.export-{}-{}", name_of(&out), std::process::id(), self.media.exports));
        self.media.exports += 1;
        let result = self.export_inner(job, doc, &scratch);
        self.media.captions = None;
        let _ = std::fs::remove_dir_all(&scratch);
        // All or nothing: a failed export leaves nothing at its temporary name (only #501's
        // planted export that starts and stops leaves its partial file).
        if result.is_err() && self.scenario.planted != Some(Planted::ExportStartsThenStops) {
            for p in [temp.clone(), PathBuf::from(format!("{}.part", temp.display()))] {
                let _ = std::fs::remove_file(&p);
                let _ = std::fs::remove_dir_all(&p);
            }
        }
        match result {
            Ok(mut receipt) => {
                // #525: the receipt names the runtime digest, so two backends' evidence never mixes.
                if self.scenario.planted != Some(Planted::ReceiptOmitsRuntimeDigest) {
                    receipt["runtime_digest"] = json!(self.startup.sealed.runtime_digest);
                }
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
            if !matches!(job.codec.as_str(), "h264" | "hevc" | "prores_4444") {
                return Err(json!({"code": "codec_unbuilt", "video": job.codec}));
            }
            if !matches!(job.audio_codec.as_str(), "aac" | "pcm") {
                return Err(json!({"code": "codec_unbuilt", "audio": job.audio_codec}));
            }
            // #157: a 4:2:0 codec needs an even size, the job's or the document's own.
            let own = job.size.or_else(|| doc_size(&doc));
            if let Some(odd) = own.filter(|_| job.codec != "prores_4444").and_then(guards::odd_size) {
                return Err(odd);
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
                // #1163: the planted range starts one frame late, and ends one late.
                let late =
                    i64::from(self.scenario.planted == Some(Planted::RangeStartsOneFrameLate));
                on_grid(a)? + late..on_grid(b)? + late
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
        let temp = temp_of(&out);
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
                // Planted: it starts anyway and stops at the missing strip's first frame, its
                // frames' rows written to the temporary name as they are drawn.
                let stop = issue["start"].as_i64().map_or(0, |t| clock::index(t, frame));
                let shard = Shard { frames: frames.start..stop.max(frames.start), frame, size: job.size, opaque: !job.alpha, gain: 0.0, ceiling: None };
                let file = std::fs::File::create(&temp).map_err(|_| refuse("export_unwritable"))?;
                let mut run = Run::new(scratch, Vec::new(), false);
                self.export_frames(&doc, &shard, &mut run, &mut Sink::Raw(file))?;
                drawn = (shard.frames.end - shard.frames.start) as usize;
            }
            return Err(json!({"outcome": "stopped", "state": "BLOCKED", "gate": "readiness", "frames_drawn": drawn, "issues": [issue]}));
        }
        // #502: the script's lines, their captions laid out on this export's frames and held to
        // their profile, before any frame is drawn.
        if let Some(s) = self.script_of(&doc) {
            if let Some(problem) = &s.problem {
                return Err(problem.clone());
            }
            if let Some(who) = &s.unshareable {
                // #157: one ask, naming whose licence it is, the one thing that unblocks it.
                let ask = json!({"kind": "unblock", "about": who,
                    "ask": format!("give a licence that says shareable: true for {who}, or replace it, so the export can carry the narration")});
                return Err(json!({"outcome": "blocked", "state": "BLOCKED", "code": "narration.unshareable", "unshareable": who, "asks": [ask],
                    "reason": format!("an export carries narration only under a license that says shareable: true; this one's doesn't: {who}")}));
            }
        }
        // #157: the licences the export carries, through every job output to its inputs; a CC BY
        // input without its credit FAILs.
        let (licenses, credits, missing) = guards::licenses(&doc);
        if !missing.is_empty() {
            return Err(json!({"outcome": "failed", "code": "credit_missing", "issues": missing}));
        }
        let cuts = self.cuts_of(&doc);
        self.media.captions = Some(crate::narration::View { frame, draw: cap.mode != "closed", profile: cap.profile.clone(), cuts });
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
        // #157: the delivery limiter's ceiling sits below the profile's by the meter's worst
        // under-read and the codec's margin (planted: no margin).
        let ceiling = match self.guard_planted(Guard::NoCodecMargin) {
            true => profile.true_peak,
            false => profile.limiter_ceiling(8, &job.audio_codec),
        };
        let (mut gain, mut before) = (0.0, None);
        if let (Some(mix), Some((target_lufs, _))) = (&mix, profile.integrated) {
            let (first, last) = (self.span_start(frames.start, frame, hz), self.span_start(frames.end, frame, hz));
            let planted = planted_of(self.scenario.planted, false);
            let pass = |db: f64| {
                let mut player = Player::new(mix.clone(), planted);
                player.delivery = amp(db);
                if let Some(db) = ceiling {
                    player.set_ceiling(db);
                }
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
                // #157: a delivery louder than the streaming level is held to a lower ceiling; the one
                // correction keeps it at the level instead (0.01 LU under it).
                if let Some(l) = profile.louder.as_ref().filter(|l| read.integrated > l.integrated) {
                    gain -= read.integrated - l.integrated + 0.01;
                }
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
        let shards: Vec<Shard> = (0..n)
            .map(|i| Shard {
                frames: frames.start + len * i / n..frames.start + len * (i + 1) / n,
                frame,
                size: job.size,
                opaque: !job.alpha,
                gain,
                ceiling,
            })
            .collect();
        // #157: each strip the film's end cuts, listed as a warning a brief may refuse.
        let warnings = mix.as_deref().map(|m| guards::end_cuts(m, frames.end * frame)).unwrap_or_default();
        if job.refuse_end_cuts && !warnings.is_empty() {
            return Err(json!({"outcome": "failed", "code": "end_cut", "issues": warnings}));
        }
        // #157: the readiness gate's disk count: the PCM is all an export keeps on disk.
        let needed = match mix {
            Some(_) => (self.span_start(frames.end, frame, hz) - self.span_start(frames.start, frame, hz)).max(0) as u64 * 8,
            None => 0,
        };
        let disk = guards::disk_gate(needed, scratch);
        if !disk.fits && !self.guard_planted(Guard::NoDiskGate) {
            return Err(json!({"outcome": "refused", "code": "export_disk_short", "needed": needed, "free": disk.free, "frames_drawn": 0,
                "what": format!("the export keeps {needed} bytes of PCM on disk while it runs, and {} has {} bytes free", scratch.display(), disk.free)}));
        }
        // #157: the sound first, held to its profile before any frame is drawn; and, when the
        // limiter never cut, its loudness range held to the master's before the gain (#502).
        let (mut pcm, mut pcm_hashes, mut cut, mut sound) = (Vec::new(), Vec::new(), false, None);
        if let Some(mix) = &mix {
            for shard in &shards {
                let (hashes, c) = self.export_sound(shard, mix, &mut pcm);
                pcm_hashes.extend(hashes);
                cut |= c;
            }
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
        // The PCM the join reads, kept beside the delivery until the delivery is checked.
        let audio = scratch.join("audio.f32");
        if mix.is_some() && target == "video" {
            std::fs::write(&audio, &pcm).map_err(|e| {
                json!({"outcome": "failed", "code": "export_unwritable", "issues": [{"code": "export_unwritable", "path": audio,
                    "what": format!("{} couldn't be written: {e}", audio.display())}]})
            })?;
        }
        let raw: Vec<f32> = pcm.as_chunks::<4>().0.iter().map(|b| f32::from_le_bytes(*b)).collect();
        drop(pcm);
        // #157: the machine's GPU lease, held while the export draws and reads its frames.
        let lease = Lease::take();
        let first = start_number + frames.start as u64;
        let tc_start = match self.scenario.planted {
            Some(Planted::RangeRestartsTimecode) => start_number,
            _ => first,
        };
        if let Some(parent) = out.parent() {
            std::fs::create_dir_all(parent).map_err(|_| refuse("export_unwritable"))?;
        }
        let chapters = chapters_of(&doc, frame, &frames);
        let mut run = Run::new(scratch, chapters.iter().map(|c| c.2).collect(), job.readback);
        let mut sink = self.sink_for(job, &doc, &target, &entry, &temp, (p, q), len)?;
        for shard in &shards {
            self.export_frames(&doc, shard, &mut run, &mut sink)?;
        }
        let looping = doc.pointer("/transport/loop").and_then(Value::as_str) == Some("wrap");
        let seen = run.seen.take().ok_or_else(|| refuse("no_frames"))?;
        let (hashes, reads, wrap) = seen
            .finish(looping)
            .map_err(|()| stopped(frames.end - 1, "device_lost", &format!("the GPU device was lost at frame {}", frames.end - 1)))?;
        // #157: frames.finite, film.blank and film.wrap, from what the GPU read of each frame.
        let mut issues = std::mem::take(&mut run.nonfinite);
        issues.extend(self.frame_guards(&doc, job, frame, frames.start, &reads, wrap.filter(|_| looping), run.size)?);
        if !issues.is_empty() {
            return Err(json!({"outcome": "failed", "code": "export.frames", "issues": issues}));
        }
        let size = run.size;
        let encoder = self.sink_finish(sink, job, &target, &entry, &temp, &audio, hz, &tc, tc_start)?;
        // #157: the colour probe, and the delivery read back from its own bytes.
        let (mut probe, mut read, mut found) = (Value::Null, None, Vec::new());
        if target == "video" {
            match self.color_probe(job, size, (p, q), scratch) {
                Ok(p) => probe = p,
                Err(e) if e["outcome"] == "failed" => found.extend(e["issues"].as_array().cloned().unwrap_or_default()),
                Err(e) => return Err(e),
            }
        }
        if target == "video" || target == "png" {
            let pcm = mix.as_ref().map(|_| (&raw[..], 2, hz));
            let d = fidelity::Delivery {
                path: &temp, doc: &doc, job, frames: frames.clone(), frame, rate: (p, q), size, hashes: &hashes, pcm,
                chapters: &chapters, kept: self.guard_planted(Guard::FidelityKeepsFrames).then_some(&run.kept[..]),
                priming: encoder.pointer("/audio/priming").and_then(Value::as_i64),
                reads: &reads,
            };
            match self.read_delivery(&d) {
                Ok(r) => read = Some(r),
                Err(e) if e["outcome"] == "failed" && found.is_empty() => return Err(e),
                Err(e) if e["outcome"] == "failed" => found.extend(e["issues"].as_array().cloned().unwrap_or_default()),
                Err(e) => return Err(e),
            }
        }
        // export.color and export.fidelity, each raised: every issue they found.
        if !found.is_empty() {
            return Err(json!({"outcome": "failed", "code": "export.delivery", "issues": found}));
        }
        // #502: the readings of the decoded delivery, held to the profile too.
        let mut delivered = None;
        if sound.is_some() {
            let Some((rate, channels, samples)) = read.as_ref().and_then(|r| r.pcm.as_ref()) else {
                return Err(json!({"code": "delivery_unread", "why": "the delivery holds no sound"}));
            };
            let got = loudness::measure(samples, &vec![1.0; *channels], i64::from(*rate), 8);
            let misses = profile.misses(&got);
            if !misses.is_empty() {
                return Err(loudness_failed(profile.name, "delivery", &misses, &got));
            }
            delivered = Some(got);
        }
        let drop_temp = || {
            let _ = std::fs::remove_file(&temp);
            let _ = std::fs::remove_dir_all(&temp);
        };
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
        let adapter = self.gpu3().and_then(|g| g.device().adapter.clone()).map(|a| {
            json!({"name": a.name, "driver": a.driver, "driver_info": a.driver_info, "backend": format!("{:?}", a.backend),
                "software": a.device_type == wgpu::DeviceType::Cpu})
        });
        let holder = job.session.clone().unwrap_or_else(|| format!("process {}", std::process::id()));
        let key = adapter.as_ref().and_then(|a| a["name"].as_str()).unwrap_or("gpu").to_string();
        let lease = lease.release(&holder, &key);
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
            "frame_hashes": hashes.iter().map(hex).collect::<Vec<_>>(),
            "timecode": {"start": self.label(&tc, tc_start), "last": self.label(&tc, tc_start + count.max(1) as u64 - 1), "drop_frame": job.drop_frame},
            "encoder": encoder["encoder"],
            "handoff": "copy",
            "adapter": adapter.unwrap_or_else(|| json!({"name": null, "software": false})),
            "shards": n,
            "hidden": hidden,
            "nonfinite": [],
            "chapters": chapters.iter().map(|(marker, name, k)| json!({"marker": marker, "name": name, "frame": k})).collect::<Vec<_>>(),
            "warnings": warnings,
            "lease": lease,
            "seams": shards.iter().skip(1).map(|s| s.frames.start).collect::<Vec<_>>(),
            "disk": {"needed": needed, "free": disk.free},
            "licenses": licenses,
            "credits": credits,
        });
        if let Some(r) = &read {
            receipt["fidelity"] = r.fidelity.clone();
            if mix.is_some() {
                receipt["av_offset"] = json!({"samples": r.av_offset, "priming": encoder.pointer("/audio/priming").cloned().unwrap_or(json!(0)),
                    "edit_list": r.edit_list});
            }
        }
        if target == "video" {
            receipt["color_probe"] = probe;
        }
        if mix.is_some() {
            receipt["sample_rate"] = json!(hz);
            receipt["audio"] = json!(job.audio_codec);
            receipt["pcm_hashes"] = json!(pcm_hashes);
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
            reply["readback"] = json!({"frames": run.back});
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
        let lost = |_| json!({"outcome": "refused", "code": "device_lost"});
        let first = frames.push(bgra).map_err(lost)?;
        match first {
            Some(d) => Ok(d),
            None => frames.finish().map_err(lost)?.ok_or_else(|| json!({"outcome": "refused", "code": "gpu_unavailable"})),
        }
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
            let at = m.at.map(|s| (s * deep_canvas::grammar::FLICKS_PER_SECOND as f64).round() as i64);
            json!({"check": "loudness", "measure": m.measure, "reading": m.reading, "target": m.target, "tolerance": m.tolerance, "on": on, "at": at,
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
    /// #502: the delivery gain on the master, dB.
    pub gain: f64,
    /// #157: the delivery limiter's ceiling, dBTP, when the profile sets one.
    pub ceiling: Option<f64>,
}

pub(crate) fn hex(d: impl AsRef<[u8]>) -> String {
    d.as_ref().iter().map(|b| format!("{b:02x}")).collect()
}

/// The temporary name an export writes under, beside its output.
fn temp_of(out: &Path) -> PathBuf {
    out.with_file_name(format!(".{}.part", name_of(out)))
}

fn name_of(out: &Path) -> String {
    out.file_name().map(|f| f.to_string_lossy().into_owned()).unwrap_or_default()
}

/// The document's own size in pixels, when it gives one.
fn doc_size(doc: &Value) -> Option<[u16; 2]> {
    let s = doc.get("size")?.as_array()?;
    Some(crate::snapshot::px([s.first()?.as_f64()?, s.get(1)?.as_f64()?]))
}


/// #157: the chapters, one per section marker inside `frames`, in order: its marker, its name and
/// its first frame, the first frame at or after the marker's start.
fn chapters_of(doc: &Value, frame: i64, frames: &std::ops::Range<i64>) -> Vec<(String, String, i64)> {
    let Some(motion) = doc.as_object().and_then(|m| deep_canvas_motion::doc::read(m).ok()) else { return Vec::new() };
    let mut out: Vec<(String, String, i64)> = motion
        .markers
        .iter()
        .filter(|m| m.kind == "section")
        .map(|m| {
            let name = doc.pointer(&format!("/markers/{}/name", m.id)).and_then(Value::as_str).unwrap_or(&m.id).to_string();
            (m.id.clone(), name, clock::index(m.start + frame - 1, frame))
        })
        .filter(|(_, _, k)| frames.contains(k))
        .collect();
    out.sort_by(|a, b| (a.2, &a.0).cmp(&(b.2, &b.0)));
    out
}

/// An export stopped at frame `k`: nothing is left, and the issue names the frame.
fn stopped(k: i64, code: &str, what: &str) -> Value {
    json!({"outcome": "stopped", "code": code, "frame": k, "issues": [{"code": code, "frame": k, "what": what}]})
}

/// Frame k's first sample at `hz`: ⌊k·Δ × hz ÷ flicks⌋ (Time and the flick).
fn span_at(k: i64, frame: i64, hz: u32) -> i64 {
    deep_canvas::time::span_start(k, frame, hz)
}

/// The planted splitter's start for a shard's first frame: rounded to the nearest sample.
fn round_start(k: i64, frame: i64, hz: u32) -> i64 {
    let x = i128::from(k) * i128::from(frame) * i128::from(hz);
    let f = i128::from(deep_canvas::grammar::FLICKS_PER_SECOND);
    ((x + f / 2) / f) as i64
}

/// The first video item at a frame whose picture the decode worker couldn't give.
fn undecoded(doc: &Value, block: &Map<String, Value>) -> Option<String> {
    doc["items"]
        .as_object()?
        .iter()
        .filter(|(_, i)| i["kind"] == "image@1" && i["params"].get("frames").is_some() && i["params"]["asset"].is_string())
        .map(|(id, _)| id)
        .find(|id| !block.contains_key(*id))
        .cloned()
}

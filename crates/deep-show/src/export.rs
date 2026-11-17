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
mod gltf;
mod guards;
mod lottie;
mod page;
mod pdf;
#[cfg(feature = "test-export-guards")]
mod test_guards;
mod web;

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
use crate::snapshot::Unfit;
use crate::time::{context_of, sample_rate_of};
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
    /// #507: the pdf handout's writer leaves stage 4's page out.
    PdfSkipsStage4,
    /// #169: the page keys each state by its picture and its controls alone.
    PageKeysByPicture,
    /// #169: the page draws its targets only as boxes on each still.
    PageTargetsOnImage,
    /// #468: the glTF export drops a camera's lens shift without a warning.
    GltfDropsShift,
    /// #172: the web export writes the export's time into the index page.
    WebIndexExportTime,
    /// #172: the web export writes a test variant of the player, which alone has probe().
    WebProbeTestVariant,
    /// #172: the web player's device request asks for the adapter's own limits.
    WebRequestsAdapterLimits,
    /// #172: the web player writes a fragment `control.<ID>=<value>` as an input entry.
    WebFragmentWritesEntry,
    /// #1490: the web export takes the smallest player set whatever modules the document uses.
    WebPicksSmallestSet,
    /// #1490: the web export takes the full player set whatever modules the document uses.
    WebPicksFullSet,
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
        "pdf_writer_skips_stage_4" => Planted::Export(G::PdfSkipsStage4),
        "page_keys_by_picture" => Planted::Export(G::PageKeysByPicture),
        "page_targets_on_image" => Planted::Export(G::PageTargetsOnImage),
        "gltf_drops_shift" => Planted::Export(G::GltfDropsShift),
        "web_index_export_time" => Planted::Export(G::WebIndexExportTime),
        "web_probe_test_variant" => Planted::Export(G::WebProbeTestVariant),
        "web_requests_adapter_limits" => Planted::Export(G::WebRequestsAdapterLimits),
        "web_fragment_writes_entry" => Planted::Export(G::WebFragmentWritesEntry),
        "web_picks_smallest_set" => Planted::Export(G::WebPicksSmallestSet),
        "web_picks_full_set" => Planted::Export(G::WebPicksFullSet),
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
            return Err(Unfit {
                code: "decode_error",
                path: format!("items/{id}"),
            });
        }
        self.renderer.videos = pictures;
        self.caption_at(doc, t);
        let unfit = |code| Unfit {
            code,
            path: "frames".into(),
        };
        let drawing = drawing_of(sched, session).ok_or_else(|| unfit("no_drawing"))?;
        let drawing = self.boiled(doc, t, false, drawing);
        #[allow(unused_mut)]
        let (mut rgba, size) = if deep_canvas_scene3d::scene::has_3d(doc) {
            self.rgba3d(doc, t, &drawing, size)?
        } else {
            let sides = crate::film::program_of(sched, session)
                .and_then(|p| crate::film::sides(&p, doc, t, false));
            let (rgba, _, size) = match sides {
                Some(sides) => self.film_rgba(&drawing, size, &sides, doc, (opaque, Some(t)))?,
                None if opaque => self.printed_frame(doc, t, &drawing, size)?,
                None => self.canonical_rgba(&drawing, size, opaque)?,
            };
            (rgba, size)
        };
        // #903: the tour's pointer, in the overlay above the document's layers.
        self.pointer_over(doc, t, &mut rgba, size);
        #[cfg(feature = "test-export-guards")]
        test_guards::paint(doc, test_guards::frame_of(doc, t), &mut rgba, size, |r| {
            self.look.light.get(r).copied()
        });
        // #1163: the planted renderer seeds its noise from the clock in exports too.
        if self.scenario.planted == Some(Planted::SeedsNoiseFromClock) {
            crate::hub::export_noise(&mut rgba, t);
        }
        Ok((rgba, size))
    }

    /// #157: an opaque 2D frame as the canvas shows it: when the document's look prints (its
    /// grain), its items through the print finish on the GPU, then the caption and the status
    /// marks over them; otherwise the canonical raster.
    fn printed_frame(
        &mut self,
        doc: &Value,
        t: i64,
        drawing: &crate::frames::Painted,
        size: Option<[u16; 2]>,
    ) -> Result<(Vec<u8>, crate::snapshot::Drawn, [u16; 2]), Unfit> {
        let Some(def) = self.print_look(doc, None) else {
            return self.canonical_rgba(drawing, size, true);
        };
        let drawn = self
            .renderer
            .prepare_drawing(drawing, &self.scenario.evidence)?;
        let px = size.unwrap_or_else(|| crate::snapshot::px(drawn.frame.size));
        let Some(mut rgba) =
            self.print_part(&def, doc, &drawn.part(drawn.view, true, false), px, t)?
        else {
            return self.canonical_rgba(drawing, size, true);
        };
        self.caption_over(&mut rgba, px);
        let status = self
            .renderer
            .raster(&drawn.part(drawn.view, false, true), px, None);
        crate::snapshot::over(&mut rgba, &status);
        Ok((rgba, drawn, px))
    }

    /// One shard's sound: the mix's samples over each of its frames' spans (frame k's span starts
    /// at ⌊k·Δ × hz ÷ flicks⌋), from a player sought to the shard's first sample, appended to
    /// `pcm`; each span's SHA-256 over f32le, and whether the master's limiter cut.
    fn export_sound(
        &mut self,
        shard: &Shard,
        mix: &Arc<Mix>,
        pcm: &mut Vec<u8>,
    ) -> (Vec<String>, bool) {
        let hz = mix.rate as u32;
        let span = |k: i64| self.span_start(k, shard.frame, hz);
        let mut player = Player::new(
            mix.clone(),
            crate::mixdown::export_planted(self.scenario.planted),
        );
        player.delivery = amp(shard.gain);
        if let Some(db) = shard.ceiling {
            player.set_ceiling(db);
        }
        let first = span(shard.frames.start);
        // Planted: the splitter rounds the shard's first sample instead of flooring it.
        let rounded = self.guard_planted(Guard::ShardStartRounds) && shard.frames.start > 0;
        player.seek(if rounded {
            round_start(shard.frames.start, shard.frame, hz)
        } else {
            first
        });
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
    /// #162: `lottie: {container, images}` (or `video.lottie`), the Lottie target's options.
    pub lottie: Value,
    /// #507: `pdf {notes}`: the handout prints each stage's notes under its still.
    pub notes: bool,
    /// #169: `page: {sample, orbit, still}` (or `video.page`), the playable page's options.
    pub page: Value,
    /// #169: the page's own clips are tagged with their pixels' transfer, sRGB, so a browser
    /// draws them as it draws the page's stills; never read from a request.
    pub srgb: bool,
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
            lottie: Value::Null,
            notes: false,
            page: Value::Null,
            srgb: false,
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
        Captions {
            profile: None,
            files: vec!["srt".into()],
            mode: "open".into(),
        }
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
    /// #507: each stage's settled still, the pdf handout's pages.
    Stages,
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
        Some(Value::String(w)) if w == "stages" => Span::Stages,
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
        drop_frame: tc
            .and_then(|t| t.get("drop_frame"))
            .and_then(Value::as_bool)
            .unwrap_or(false),
        out: s(c.get("out"))?,
        software: match c.get("adapter") {
            None => false,
            Some(a) => a.as_str()? == "software",
        },
        readback: c.get("readback").and_then(Value::as_bool).unwrap_or(false),
        track: c
            .get("track")
            .map_or(Some(Vec::new()), |t| t.as_array().cloned())?,
        captions: {
            let cap = c.get("captions");
            Captions {
                profile: s(cap.and_then(|c| c.get("profile"))),
                files: match cap.and_then(|c| c.get("files")) {
                    None => vec!["srt".into()],
                    Some(Value::String(f)) => vec![f.clone()],
                    Some(f) => f
                        .as_array()?
                        .iter()
                        .map(|f| f.as_str().map(str::to_string))
                        .collect::<Option<_>>()?,
                },
                mode: s(cap.and_then(|c| c.get("mode"))).unwrap_or_else(|| "open".into()),
            }
        },
        loudness_profile: s(c.get("loudness_profile")),
        quality: match s(video.and_then(|v| v.get("quality"))) {
            None => "standard".into(),
            Some(q) => Some(q).filter(|q| rules::quality_floor(q).is_some())?,
        },
        premultiplied: video.and_then(|v| v.get("alpha")).and_then(Value::as_str)
            == Some("premultiplied"),
        keyframe_interval: crate::optional(video.and_then(|v| v.get("keyframe_interval")), whole)?,
        refuse_end_cuts: c
            .get("brief")
            .and_then(|b| b.get("refuse"))
            .and_then(Value::as_array)
            .is_some_and(|r| r.contains(&json!("end_cut"))),
        session: s(c.get("session")),
        lottie: c
            .get("lottie")
            .or_else(|| video.and_then(|v| v.get("lottie")))
            .cloned()
            .unwrap_or(Value::Null),
        notes: c
            .get("pdf")
            .and_then(|p| p.get("notes"))
            .and_then(Value::as_bool)
            .unwrap_or(false),
        page: c
            .get("page")
            .or_else(|| video.and_then(|v| v.get("page")))
            .cloned()
            .unwrap_or(Value::Null),
        srgb: false,
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

mod run;

impl Hub<'_> {
    /// `session`: a document's session state, its selection and view inputs, after `set`
    /// replaces it when given. Nothing an export writes reads it.
    pub fn session_reply(&mut self, doc: &str, set: Option<&Value>) -> Value {
        if let Some(state) = set {
            let mut state = state.clone();
            for k in ["selection", "view"] {
                if state.get(k).is_none() {
                    state[k] = if k == "selection" {
                        json!([])
                    } else {
                        json!({})
                    };
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
        let adapter = self
            .gpu3()
            .and_then(|g| g.device().adapter.as_ref().map(|a| a.name.clone()));
        json!({"outcome": "hashed", "hashes": hashes, "adapter": {"name": adapter, "software": false}})
    }

    /// One BGRA8 frame's BLAKE3 through the export's GPU pass.
    pub(crate) fn gpu_hash(&mut self, bgra: &[u8], size: [u32; 2]) -> Result<[u8; 32], Value> {
        let planted = deep_gpu::blake3::Planted {
            joins_right_left: self.scenario.planted == Some(Planted::ChunkTreeWrongOrder),
        };
        let gpu = self
            .gpu3()
            .map(|g| g.device().clone())
            .ok_or_else(|| json!({"outcome": "refused", "code": "gpu_unavailable"}))?;
        let mut frames = deep_gpu::blake3::Blake3::new(&gpu.device, planted).frames(
            &gpu.device,
            &gpu.queue,
            size,
        );
        let lost = |_| json!({"outcome": "refused", "code": "device_lost"});
        let first = frames.push(bgra).map_err(lost)?;
        match first {
            Some(d) => Ok(d),
            None => frames
                .finish()
                .map_err(lost)?
                .ok_or_else(|| json!({"outcome": "refused", "code": "gpu_unavailable"})),
        }
    }

    /// `cross_machine`: two renders of the same sound, as float or 16-bit WAVs in the evidence
    /// store, read against each other: the peak per-sample difference in dBFS (null when they
    /// are identical) and the audio result. Across architectures audio is a reading: at or below
    /// −96 dBFS it passes, above it is INCONCLUSIVE, never PASS and never FAIL.
    pub fn cross_machine(&self, wavs: &[String; 2]) -> Value {
        let mut read = Vec::new();
        for sha in wavs {
            match crate::evidence::read(&self.scenario.evidence, sha)
                .as_deref()
                .and_then(wav_samples)
            {
                Some(w) => read.push(w),
                None => {
                    return json!({"outcome": "refused", "code": "unreadable_audio", "audio": sha})
                }
            }
        }
        let (a, b) = (&read[0], &read[1]);
        if a.0 != b.0 || a.1 != b.1 || a.2.len() != b.2.len() {
            return json!({"outcome": "refused", "code": "audio_differs_in_shape",
                "audio": [{"rate": a.0, "channels": a.1, "samples": a.2.len()}, {"rate": b.0, "channels": b.1, "samples": b.2.len()}]});
        }
        let peak =
            a.2.iter()
                .zip(&b.2)
                .map(|(x, y)| (f64::from(*x) - f64::from(*y)).abs())
                .fold(0.0, f64::max);
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
        (3, 32) => data
            .as_chunks::<4>()
            .0
            .iter()
            .map(|c| f32::from_le_bytes(*c))
            .collect(),
        (1, 16) => data
            .as_chunks::<2>()
            .0
            .iter()
            .map(|c| f32::from(i16::from_le_bytes(*c)) / 32_768.0)
            .collect(),
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
    captions
        .iter()
        .map(|c| Caption {
            start: at_24(c.start),
            end: at_24(c.end),
            ..c.clone()
        })
        .collect()
}

/// The planted normalizer: each 10 ms of the PCM takes the gain that brings the short-term
/// loudness of the 3 s ending there to −23 LUFS, the first 3 s the first whole window's.
fn ride_gain(pcm: &mut [u8], hz: u32) {
    let samples: Vec<f32> = pcm
        .as_chunks::<4>()
        .0
        .iter()
        .map(|b| f32::from_le_bytes(*b))
        .collect();
    let short_term = loudness::measure(&samples, &[1.0, 1.0], i64::from(hz), 1).short_term;
    let Some(last) = short_term.len().checked_sub(1) else {
        return;
    };
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
    [
        ("integrated", n(l.integrated)),
        ("lra", n(l.range)),
        ("max_m", n(l.momentary_max)),
        ("max_s", n(l.short_term_max)),
        ("true_peak", n(l.true_peak)),
        ("sample_peak", n(l.sample_peak)),
        ("plr", n(plr)),
    ]
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
    out.file_name()
        .map(|f| f.to_string_lossy().into_owned())
        .unwrap_or_default()
}

/// The document's own size in pixels, when it gives one.
fn doc_size(doc: &Value) -> Option<[u16; 2]> {
    let s = doc.get("size")?.as_array()?;
    Some(crate::snapshot::px([
        s.first()?.as_f64()?,
        s.get(1)?.as_f64()?,
    ]))
}

/// #157: the chapters, one per section marker inside `frames`, in order: its marker, its name and
/// its first frame, the first frame at or after the marker's start.
fn chapters_of(
    doc: &Value,
    frame: i64,
    frames: &std::ops::Range<i64>,
) -> Vec<(String, String, i64)> {
    let Some(motion) = doc
        .as_object()
        .and_then(|m| deep_canvas_motion::doc::read(m).ok())
    else {
        return Vec::new();
    };
    let mut out: Vec<(String, String, i64)> = motion
        .markers
        .iter()
        .filter(|m| m.kind == "section")
        .map(|m| {
            let name = doc
                .pointer(&format!("/markers/{}/name", m.id))
                .and_then(Value::as_str)
                .unwrap_or(&m.id)
                .to_string();
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
        .filter(|(_, i)| {
            i["kind"] == "image@1"
                && i["params"].get("frames").is_some()
                && i["params"]["asset"].is_string()
        })
        .map(|(id, _)| id)
        .find(|id| !block.contains_key(*id))
        .cloned()
}

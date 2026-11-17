//! Issue #157: how an export draws its frames and hands them on: each frame drawn, read on the
//! GPU (its BLAKE3 digest, film.blank's and film.wrap's readings, frames.finite's count) and given
//! to the writer as it is drawn, never stored raw; the writers the targets name; and the machine's
//! GPU lease the export holds while it draws.
//!
//! Issue #518: the writer is an encode job in the tool that registers the codec, opened before the
//! first frame is drawn; a 4:2:0 codec's tool is handed each frame's NV12 planes from the GPU's
//! conversion pass, once the frame's hash and planes are done.

use std::path::{Path, PathBuf};
use std::sync::Arc;

use deep_canvas::schedule::{Scheduler, Session as DocSession};
use deep_canvas::timecode;
use deep_codecs::ENCODE_TOOL;
use serde_json::{json, Value};

#[cfg(feature = "test-export-guards")]
use super::test_guards;
use super::tools::{Run as Run_, Tool};
use super::{feed, program, stopped, Guard, Job, Shard};
use crate::hub::{Hub, Planted};

impl Hub<'_> {
    /// One shard's frames (absolute indices at `frame` flicks each) of `doc`, from a fresh
    /// scheduler and session, each drawn, read on the GPU and handed to `sink` as it is drawn,
    /// never stored raw. A frame that can't be drawn, a lost device or a writer that takes no
    /// frame stops the export, naming the frame.
    pub(super) fn export_frames(
        &mut self,
        doc: &Value,
        shard: &Shard,
        run: &mut Run,
        sink: &mut Sink,
    ) -> Result<(), Value> {
        let mut sched = Scheduler::new(&self.startup.sealed, self.options());
        let mut session: DocSession = self.new_session();
        session.load(&mut sched, doc);
        for k in shard.frames.clone() {
            #[cfg(feature = "test-export-guards")]
            if test_guards::loses_device_at(doc, k) {
                if let Some(g) = self.gpu3() {
                    g.force_loss();
                }
            }
            let t = k * shard.frame;
            let (mut px, size) = self
                .exposed_frame(&mut sched, &mut session, doc, t, shard.size, shard.opaque)
                .map_err(|u| {
                    stopped(
                        k,
                        u.code,
                        &format!("frame {k} can't be drawn: {} at {}", u.code, u.path),
                    )
                })?;
            for p in px.as_chunks_mut::<4>().0 {
                p.swap(0, 2);
            }
            run.size = size;
            if run.readback {
                let sha = crate::evidence::put(&self.scenario.evidence, &px)
                    .map_err(|_| json!({"code": "evidence_unwritable"}))?;
                run.back.push(sha);
            }
            if self.guard_planted(Guard::StoresRawFrames) {
                let dir = run.scratch.join("frames");
                let kept = std::fs::create_dir_all(&dir)
                    .and_then(|()| std::fs::write(dir.join(format!("{k:06}.bgra")), &px));
                kept.map_err(|e| {
                    let mut s = stopped(
                        k,
                        "export_unwritable",
                        &format!("frame {k} couldn't be kept in {}: {e}", dir.display()),
                    );
                    s["issues"][0]["path"] = json!(dir);
                    s
                })?;
            }
            if self.guard_planted(Guard::FidelityKeepsFrames) {
                run.kept.push(px.clone());
            }
            if run.seen.is_none() {
                let gpu = self
                    .gpu3()
                    .map(|g| g.device().clone())
                    .ok_or_else(|| stopped(k, "gpu_unavailable", "no GPU to hash the frames on"))?;
                let joins = self.scenario.planted == Some(Planted::ChunkTreeWrongOrder);
                // #518: a 4:2:0 codec's tool reads the conversion pass's planes of each frame.
                let nv12 = sink.nv12().then(|| self.nv12_pass(&gpu));
                run.seen = Some(Seen::new(gpu, size, joins, nv12));
            }
            let keep = if self.guard_planted(Guard::WrapAgainstSecond) {
                1
            } else {
                0
            };
            let seen = run.seen.as_mut().expect("made above");
            seen.push(&px, keep).map_err(|()| {
                stopped(
                    k,
                    "device_lost",
                    &format!("the GPU device was lost at frame {k}"),
                )
            })?;
            // frames.finite: each float target the frame drew, counted on the GPU.
            for (item, target) in float_targets(doc, k, size, &seen.gpu) {
                let found =
                    deep_gpu::frame_checks::finite(&seen.gpu.device, &seen.gpu.queue, &target)
                        .map_err(|_| {
                            stopped(
                                k,
                                "device_lost",
                                &format!("the GPU device was lost at frame {k}"),
                            )
                        })?;
                if found.count > 0 {
                    run.nonfinite.push(json!({"check": "frames.finite", "code": "frames.finite", "severity": "error", "frame": k, "item": item,
                        "count": found.count, "first": found.first,
                        "what": format!("frame {k}'s float target from `{item}` holds {} non-finite values, the first at {:?}", found.count, found.first)}));
                }
            }
            // Planted (#518): the hand-off never gives the encode job the last frame's buffer.
            if run.dropped == Some(k) {
                continue;
            }
            // The frame is handed over once its hash and its planes are done on the GPU.
            let planes = match sink.nv12() {
                true => Some(seen.converted().map_err(|()| {
                    stopped(
                        k,
                        "device_lost",
                        &format!("the GPU device was lost at frame {k}"),
                    )
                })?),
                false => None,
            };
            let key = k == shard.frames.start || run.chapters.contains(&k);
            let bytes = planes.as_deref().unwrap_or(&px);
            self.sink_push(sink, &shard.frames, k, bytes, size, key, run)?;
        }
        self.sink_end_shard(sink)
    }

    /// #518: opens the sink's next encode job at `size`, for `frames` when it is a shard's part
    /// and for the whole film when it is a sequence. Nothing waits for the tool's answer here, so
    /// an open asked for before the first frame is drawn runs beside the export's preparing.
    pub(super) fn sink_open(
        &mut self,
        sink: &mut Sink,
        frames: &std::ops::Range<i64>,
        size: [u16; 2],
        run: &Run,
    ) -> Result<(), Value> {
        // Planted: the job is told of one frame fewer when the dropped frame is among its own.
        let count = |f: &std::ops::Range<i64>| {
            f.end - f.start - i64::from(run.dropped.is_some_and(|l| f.contains(&l)))
        };
        let stale = self.media.encoder_stale.clone();
        match sink {
            Sink::Parts {
                open,
                done,
                ask,
                ext,
                nv12,
                ..
            } => {
                let mut ask = ask.clone();
                ask["size"] = json!(size);
                let path = run.scratch.join(format!("part{}.{ext}", done.len()));
                let (first, n) = (frames.start, count(frames));
                *open = Some(feed::Part::open(
                    self.encode_tool()?,
                    ask,
                    path,
                    first,
                    n,
                    *nv12,
                    stale,
                )?);
            }
            Sink::Png {
                open, out, frames, ..
            } => {
                let ask = json!({"op": "export.png", "size": size});
                let (first, n) = (frames.start, count(frames));
                *open = Some(feed::Part::open(
                    self.encode_tool()?,
                    ask,
                    out.clone(),
                    first,
                    n,
                    false,
                    stale,
                )?);
            }
            Sink::Program {
                tool,
                open,
                out,
                frames,
                ask,
                part,
            } => {
                let Run_::Program { argv, cwd } = &tool.run else {
                    return Err(json!({"code": "no_writer", "tool": tool.id}));
                };
                if let Some(part) = part.as_mut() {
                    *part = run.scratch.join("part0.mp4");
                }
                let mut ask = ask.clone();
                ask["size"] = json!(size);
                ask["frames"] = json!(count(frames));
                ask["first"] = json!(frames.start);
                ask["out"] = json!(part.as_ref().unwrap_or(&*out));
                let planted = program::Planted {
                    waits_forever: self.guard_planted(Guard::WaitsForSlotForever),
                    no_window: self.guard_planted(super::READS_ALL_FIRST),
                    before_hash: self.guard_planted(Guard::SendsBeforeHash),
                };
                // A tool that takes GPU surfaces is handed a ring of `frame_delay` + 2 slots.
                #[cfg(target_os = "macos")]
                let ring = match (tool.surface, self.gpu3().map(|g| g.device().clone())) {
                    (true, Some(gpu)) => {
                        let ring = program::Slots::new(gpu, size, tool.window())?;
                        ask["ring"] = json!(ring.name);
                        ask["slots"] = json!(tool.window());
                        Some(ring)
                    }
                    _ => None,
                };
                #[cfg(not(target_os = "macos"))]
                let ring = None;
                let session = program::Session::start(tool, argv, cwd, &ask, planted, ring)?;
                *open = Some((session, size));
            }
            Sink::Raw(_) => {}
        }
        Ok(())
    }

    /// The writer the target names, before its first frame: the encode tool that registers the
    /// codec (#518) for media's video (a part per shard, joined after) and png (one sequence),
    /// the build's own or a plug-in's program, or a test module's writer, which takes the
    /// frames' rows into the delivery.
    #[allow(clippy::too_many_arguments)]
    pub(super) fn sink_for(
        &mut self,
        job: &Job,
        doc: &Value,
        target: &str,
        entry: &Value,
        temp: &Path,
        (p, q): (u32, u32),
        frames: std::ops::Range<i64>,
        tool: Option<&Tool>,
    ) -> Result<Sink, Value> {
        let nv12 = super::tools::yuv420(&job.codec);
        match (target, entry["writer"].as_str(), tool) {
            ("video" | "png", Some("media"), Some(tool))
                if matches!(tool.run, Run_::Program { .. }) =>
            {
                // The job as the tool's wire gives it: its frames' format, and the kind's params.
                let ask = json!({"op": "open", "format": if nv12 { "nv12" } else { "bgra8" },
                    "conversion": nv12.then_some(deep_gpu::nv12::VERSION), "frame_rate": [p, q], "color": "bt709",
                    "alpha": if job.alpha { "straight" } else { "none" },
                    "params": {"codec": job.codec, "keyframe_interval": job.keyframe_interval, "quality": job.quality}});
                Ok(Sink::Program {
                    tool: tool.clone(),
                    open: None,
                    out: temp.to_path_buf(),
                    frames,
                    ask,
                    part: (target == "video").then(PathBuf::new),
                })
            }
            ("video", Some("media"), Some(tool)) => {
                let grain = self.has_grain(doc);
                let mut ask = transfer(
                    json!({"op": "export.part", "codec": job.codec, "rate": [p, q], "quality": job.quality, "grain": grain,
                    "keyframe_interval": job.keyframe_interval}),
                    job,
                );
                if let Run_::Own(Some(ms)) = &tool.run {
                    ask["stub_open_ms"] = json!(ms);
                }
                Ok(Sink::Parts {
                    tool: tool.clone(),
                    open: None,
                    done: Vec::new(),
                    encoder: Value::Null,
                    ask,
                    ext: if job.codec == "prores_4444" {
                        "mov"
                    } else {
                        "mp4"
                    },
                    nv12,
                    opened: None,
                })
            }
            ("png", Some("media"), Some(tool)) => Ok(Sink::Png {
                tool: tool.clone(),
                open: None,
                out: temp.to_path_buf(),
                frames,
            }),
            _ if entry["writer"]
                .as_str()
                .is_some_and(|w| w.starts_with("test.")) =>
            {
                std::fs::File::create(temp)
                    .map(Sink::Raw)
                    .map_err(|_| json!({"code": "export_unwritable"}))
            }
            _ => Err(json!({"code": "no_writer", "target": target})),
        }
    }

    /// Hands frame `k`, one of `frames`, to the writer as it is drawn: `bytes` are its NV12
    /// planes when the sink takes them, else its BGRA8 rows.
    #[allow(clippy::too_many_arguments)]
    pub(super) fn sink_push(
        &mut self,
        sink: &mut Sink,
        frames: &std::ops::Range<i64>,
        k: i64,
        bytes: &[u8],
        size: [u16; 2],
        key: bool,
        run: &Run,
    ) -> Result<(), Value> {
        if !matches!(sink, Sink::Raw(_)) {
            // A job opened ahead for another size than the frames drew is ended and opened again.
            if sink.open_size().is_some_and(|s| s != size) {
                self.sink_abort(sink);
            }
            if sink.open_size().is_none() {
                self.sink_open(sink, frames, size, run)?;
            }
        }
        match sink {
            Sink::Parts { open, .. } => {
                let part = open.as_mut().expect("opened above");
                part.push(self.encode_tool()?, k, bytes, key)
            }
            Sink::Png { open, .. } => {
                open.as_mut()
                    .expect("opened above")
                    .push(self.encode_tool()?, k, bytes, false)
            }
            Sink::Program { open, .. } => {
                let (session, _) = open.as_mut().expect("opened above");
                session.push(k, bytes, key)
            }
            Sink::Raw(file) => {
                use std::io::Write as _;
                file.write_all(bytes).map_err(|e| {
                    stopped(
                        k,
                        "export_unwritable",
                        &format!("frame {k} couldn't be written: {e}"),
                    )
                })
            }
        }
    }

    /// #518: ends a sink's open encode job without its file: the build's own tool by ending its
    /// process, whose stdin then closes, and a plug-in's program by its own PID.
    pub(super) fn sink_abort(&mut self, sink: &mut Sink) {
        match sink {
            Sink::Parts { open, .. } | Sink::Png { open, .. } => drop(open.take()),
            Sink::Program { open, .. } => drop(open.take()),
            Sink::Raw(_) => {}
        }
        self.end_stale_encoder();
    }

    /// A shard's part, finished once its last frame is in.
    pub(super) fn sink_end_shard(&mut self, sink: &mut Sink) -> Result<(), Value> {
        if let Sink::Parts {
            open,
            done,
            encoder,
            opened,
            ..
        } = sink
        {
            if let Some(part) = open.take() {
                let path = part.path.clone();
                *opened = opened.or(part.opened);
                let reply = part.finish(self.encode_tool()?)?;
                *encoder = reply["encoder"].clone();
                done.push(path);
            }
        }
        Ok(())
    }

    /// The delivery at its temporary name, once every frame is in: the parts joined with the
    /// sound and timecode, the PNG sequence finished, or a test writer's file closed. The
    /// encoder that ran and the join's reply.
    #[allow(clippy::too_many_arguments)]
    pub(super) fn sink_finish(
        &mut self,
        sink: Sink,
        job: &Job,
        target: &str,
        entry: &Value,
        temp: &Path,
        audio: &Path,
        hz: u32,
        tc: &timecode::Timecode,
        start: u64,
    ) -> Result<Value, Value> {
        let failed =
            |reply: &Value| json!({"code": "writer_failed", "target": target, "reply": reply});
        let pid = |hub: &mut Hub| hub.encode_tool().map(|t| t.pid).unwrap_or(0);
        // The join of a film's video parts with its sound and timecode, at the temporary name.
        let join = |parts: Value| {
            let sound = audio.exists().then(|| json!({"path": audio, "sample_rate": hz, "channels": 2, "codec": job.audio_codec}));
            json!({"op": "export.join", "parts": parts, "out": temp, "audio": sound,
                "timecode": {"start_frame": start, "drop_frame": tc.drop > 0, "rate": tc.nominal}})
        };
        // #518: the receipt's encoder names the tool, name and version; what the tool's own
        // encoder calls itself stays beside it.
        let named = |tool: &Tool, hardware: Value, own: &Value| {
            let (name, version) = tool.name_version();
            json!({"name": name, "version": version, "hardware": hardware, "quality_floor": own["quality_floor"],
                "library": {"name": own["name"], "version": own["version"]}})
        };
        match sink {
            Sink::Parts {
                tool,
                done,
                encoder,
                opened,
                ..
            } => {
                let (reply, pid) = self.media_job(ENCODE_TOOL, join(json!(done)));
                reply.get("frames").ok_or_else(|| failed(&reply))?;
                let mut encoder = named(&tool, encoder["hardware"].clone(), &encoder);
                encoder["process"] = json!({"pid": pid, "role": ENCODE_TOOL});
                Ok(json!({"encoder": encoder, "audio": reply["audio"], "open": opened}))
            }
            Sink::Png { tool, open, .. } => {
                let part = open.ok_or_else(|| json!({"code": "no_frames"}))?;
                let opened = part.opened;
                let reply = part.finish(self.encode_tool()?)?;
                reply.get("frames").ok_or_else(|| failed(&reply))?;
                let mut encoder = named(&tool, json!(tool.hardware), &reply["encoder"]);
                encoder["process"] = json!({"pid": pid(self), "role": ENCODE_TOOL});
                Ok(json!({"encoder": encoder, "open": opened}))
            }
            Sink::Program {
                tool, open, part, ..
            } => {
                let (session, _) = open.ok_or_else(|| json!({"code": "no_frames"}))?;
                let opened = session.opened();
                let handoff = session.handoff();
                let done = session.finish()?;
                let mut encoder = named(&tool, json!(tool.hardware), &Value::Null);
                // The tool's own report, as it gave it: never trusted, and no check reads it.
                encoder["report"] = done["report"].clone();
                // A film's video part is joined with its sound and timecode, as the build's own.
                let mut sound = Value::Null;
                if let Some(part) = part {
                    let (reply, _) = self.media_job(ENCODE_TOOL, join(json!([part])));
                    reply.get("frames").ok_or_else(|| failed(&reply))?;
                    sound = reply["audio"].clone();
                }
                Ok(json!({"encoder": encoder, "audio": sound, "open": opened, "handoff": handoff}))
            }
            Sink::Raw(file) => {
                drop(file);
                let named = crate::test_registries::write_export(target, entry)
                    .ok_or_else(|| json!({"code": "no_writer", "target": target}))?;
                Ok(json!({"encoder": named}))
            }
        }
    }
}

/// Where an export's frames go as they are drawn.
pub(super) enum Sink {
    /// Media's video: a part per shard, each opened before its first frame, joined after.
    Parts {
        tool: Tool,
        open: Option<feed::Part>,
        done: Vec<PathBuf>,
        encoder: Value,
        ask: Value,
        ext: &'static str,
        nv12: bool,
        /// The first part's open, in seconds, as the tool timed it.
        opened: Option<f64>,
    },
    /// Media's PNG sequence: one job over every frame, writing the folder at `out`.
    Png {
        tool: Tool,
        open: Option<feed::Part>,
        out: PathBuf,
        frames: std::ops::Range<i64>,
    },
    /// #518: a plug-in's encode tool, a program of its own: one job over every frame, writing
    /// `out`, opened for the size beside it.
    Program {
        tool: Tool,
        open: Option<(program::Session, [u16; 2])>,
        out: PathBuf,
        frames: std::ops::Range<i64>,
        ask: Value,
        /// A film's video, which the tool writes here and the join gives its sound and timecode.
        part: Option<PathBuf>,
    },
    /// A test module's writer: the frames' BGRA8 rows, one after another, in the delivery.
    Raw(std::fs::File),
}

impl Sink {
    /// Whether the sink's tool reads each frame as the conversion pass's NV12 planes.
    pub(super) fn nv12(&self) -> bool {
        match self {
            Sink::Parts { nv12, .. } => *nv12,
            Sink::Program { ask, .. } => ask["format"] == "nv12",
            Sink::Png { .. } | Sink::Raw(_) => false,
        }
    }

    /// The size its open encode job was opened for, when one is open.
    fn open_size(&self) -> Option<[u16; 2]> {
        match self {
            Sink::Parts { open, .. } | Sink::Png { open, .. } => open.as_ref().map(|p| p.size),
            Sink::Program { open, .. } => open.as_ref().map(|(_, size)| *size),
            Sink::Raw(_) => None,
        }
    }
}

/// What an export keeps while it draws: the GPU's reading of its frames, the frames' size, the
/// frames read back into the evidence store (`readback: true`), each chapter's first frame, and
/// (planted) the frames kept for a fidelity check that doesn't draw them again.
pub(super) struct Run {
    scratch: PathBuf,
    pub(super) seen: Option<Seen>,
    pub(super) size: [u16; 2],
    readback: bool,
    pub(super) back: Vec<String>,
    chapters: Vec<i64>,
    pub(super) kept: Vec<Vec<u8>>,
    /// frames.finite's issues: each frame whose float target held a non-finite value.
    pub(super) nonfinite: Vec<Value>,
    /// #518, planted: the frame whose buffer the hand-off never gives the encode job.
    pub(super) dropped: Option<i64>,
}

impl Run {
    pub(super) fn new(scratch: &Path, chapters: Vec<i64>, readback: bool) -> Run {
        Run {
            scratch: scratch.to_path_buf(),
            seen: None,
            size: [0, 0],
            readback,
            back: Vec::new(),
            chapters,
            kept: Vec::new(),
            nonfinite: Vec::new(),
            dropped: None,
        }
    }
}

/// What the GPU reads of each frame as it is drawn: its BLAKE3 digest and its readings for
/// film.blank and film.wrap, both one frame late, the frame the wrap is measured against, and
/// (#518) for a 4:2:0 codec the frame's NV12 planes by the conversion pass.
pub(super) struct Seen {
    gpu: Arc<deep_gpu::device::Device>,
    hasher: deep_gpu::blake3::Frames,
    stats: deep_gpu::frame_checks::Stats,
    planes: Option<deep_gpu::nv12::Planes>,
    hashes: Vec<[u8; 32]>,
    reads: Vec<deep_gpu::frame_checks::Reading>,
    pushed: usize,
}

impl Seen {
    pub(super) fn new(
        gpu: Arc<deep_gpu::device::Device>,
        size: [u16; 2],
        joins_right_left: bool,
        nv12: Option<deep_gpu::nv12::Nv12>,
    ) -> Seen {
        let planted = deep_gpu::blake3::Planted { joins_right_left };
        let hasher = deep_gpu::blake3::Blake3::new(&gpu.device, planted).frames(
            &gpu.device,
            &gpu.queue,
            size.map(u32::from),
        );
        let stats = deep_gpu::frame_checks::FrameChecks::new(&gpu.device).stats(
            &gpu.device,
            &gpu.queue,
            &hasher,
        );
        let planes = nv12.map(|n| n.planes(&gpu.device, &gpu.queue, &hasher, size.map(u32::from)));
        Seen {
            gpu,
            hasher,
            stats,
            planes,
            hashes: Vec::new(),
            reads: Vec::new(),
            pushed: 0,
        }
    }

    /// Hashes and reads one frame, keeping it for the wrap when it is frame `keep` of the film.
    pub(super) fn push(&mut self, bgra: &[u8], keep: usize) -> Result<(), ()> {
        self.hashes.extend(self.hasher.push(bgra).map_err(|_| ())?);
        self.reads.extend(self.stats.after_push().map_err(|_| ())?);
        if self.pushed == keep {
            self.stats.keep();
        }
        self.pushed += 1;
        Ok(())
    }

    /// #518: the NV12 planes of the frame just pushed, by the conversion pass on the GPU, taken
    /// through memory for a tool that takes no surface; they are whole only once the frame's
    /// hash is done too, since the GPU runs the frame's work in order.
    pub(super) fn converted(&mut self) -> Result<Vec<u8>, ()> {
        let planes = self.planes.as_mut().ok_or(())?;
        planes.after_push().map_err(|_| ())?;
        planes.finish().map_err(|_| ())?.ok_or(())
    }

    /// Every frame's digest and reading, and, when the film loops, the last frame's change to
    /// the kept one.
    #[allow(clippy::type_complexity)]
    pub(super) fn finish(
        mut self,
        looping: bool,
    ) -> Result<
        (
            Vec<[u8; 32]>,
            Vec<deep_gpu::frame_checks::Reading>,
            Option<u64>,
        ),
        (),
    > {
        self.hashes.extend(self.hasher.finish().map_err(|_| ())?);
        self.reads.extend(self.stats.finish().map_err(|_| ())?);
        let wrap = if looping {
            Some(self.stats.wrap().map_err(|_| ())?)
        } else {
            None
        };
        Ok((self.hashes, self.reads, wrap))
    }
}

/// #157: the float render targets frame `k` drew, each with the item that drew it, for
/// frames.finite. A 2D frame rasters straight to 8 bits and keeps none; a test build's
/// `test.nonfinite@1` items each give frame `k` a float target with one NaN in their pixel.
#[allow(unused_variables)]
fn float_targets(
    doc: &Value,
    k: i64,
    size: [u16; 2],
    gpu: &deep_gpu::device::Device,
) -> Vec<(String, wgpu::Texture)> {
    #[allow(unused_mut)]
    let mut out = Vec::new();
    #[cfg(feature = "test-export-guards")]
    for (item, [x, y]) in test_guards::nonfinite_at(doc, k) {
        let (w, h) = (u32::from(size[0]), u32::from(size[1]));
        let target = gpu.device.create_texture(&wgpu::TextureDescriptor {
            label: Some("export float target"),
            size: wgpu::Extent3d {
                width: w,
                height: h,
                depth_or_array_layers: 1,
            },
            mip_level_count: 1,
            sample_count: 1,
            dimension: wgpu::TextureDimension::D2,
            format: wgpu::TextureFormat::Rgba16Float,
            usage: wgpu::TextureUsages::RENDER_ATTACHMENT
                | wgpu::TextureUsages::COPY_SRC
                | wgpu::TextureUsages::COPY_DST,
            view_formats: &[],
        });
        let mut texels = vec![0u8; (w * h * 8) as usize];
        if x < w && y < h {
            let at = ((y * w + x) * 8) as usize;
            texels[at..at + 2].copy_from_slice(&0x7e00u16.to_le_bytes());
        }
        let layout = wgpu::TexelCopyBufferLayout {
            offset: 0,
            bytes_per_row: Some(w * 8),
            rows_per_image: None,
        };
        gpu.queue
            .write_texture(target.as_image_copy(), &texels, layout, target.size());
        out.push((item, target));
    }
    out
}

/// The machine's GPU lease, held while an export draws and reads its frames: when it was taken,
/// how long the export waited for it, and when it was let go, in ms since the Unix epoch.
pub(super) struct Lease {
    lease: Option<crate::kit::goldens::GpuLease>,
    asked: u128,
    taken: u128,
}

impl Lease {
    pub(super) fn take() -> Lease {
        let asked = now_ms();
        let lease = Some(crate::kit::goldens::GpuLease::wait());
        Lease {
            lease,
            asked,
            taken: now_ms(),
        }
    }

    /// Lets the lease go: its record, the GPU named by `key` and held by `holder`.
    pub(super) fn release(mut self, holder: &str, key: &str) -> Value {
        // Its release is read before the lease file goes, so no later holder's acquisition reads earlier.
        let released = now_ms();
        drop(self.lease.take());
        json!({"resource": {"host": "local", "kind": "gpu", "key": key}, "holder": holder, "asked": self.asked as u64,
            "acquired": self.taken as u64, "waited_ms": (self.taken - self.asked) as u64, "released": released as u64})
    }
}

fn now_ms() -> u128 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0, |d| d.as_millis())
}

/// #169: an encode request with the job's transfer, sRGB for the page's clips.
pub(super) fn transfer(mut ask: Value, job: &Job) -> Value {
    if job.srgb {
        ask["transfer"] = json!("srgb");
    }
    ask
}

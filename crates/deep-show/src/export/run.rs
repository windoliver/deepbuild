use super::*;

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
        let scratch = out.with_file_name(format!(
            ".{}.export-{}-{}",
            name_of(&out),
            std::process::id(),
            self.media.exports
        ));
        self.media.exports += 1;
        let result = self.export_inner(job, doc, &scratch);
        self.media.captions = None;
        let _ = std::fs::remove_dir_all(&scratch);
        // All or nothing: a failed export leaves nothing at its temporary name (only #501's
        // planted export that starts and stops leaves its partial file).
        if result.is_err() && self.scenario.planted != Some(Planted::ExportStartsThenStops) {
            for p in [
                temp.clone(),
                PathBuf::from(format!("{}.part", temp.display())),
            ] {
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
        if job.codec == "pdf" {
            return self.export_pdf(job, &doc);
        }
        // #169: the playable page, the export module's own writer outside export.target@1.
        if job.codec == "page" {
            return self.export_page(job, &doc);
        }
        // #468: a still as one glTF file, outside export.target@1 (Export: glTF).
        if job.codec == "gltf" {
            return self.export_gltf(job, &doc);
        }
        let target = job.target().to_string();
        // The target, as this build sealed it.
        let entry = self
            .startup
            .sealed
            .registry("export.target@1")
            .and_then(|r| r.entry(&target))
            .map(|e| e.value.clone())
            .ok_or_else(
                || json!({"code": "unknown_target", "target": target, "codec": job.codec}),
            )?;
        // #162: a Lottie can't keep the status rule: refused before anything is written.
        if let Some(r) = lottie::refused(&doc).filter(|_| target == "lottie") {
            return Err(r);
        }
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
            if let Some(odd) = own
                .filter(|_| job.codec != "prores_4444")
                .and_then(guards::odd_size)
            {
                return Err(odd);
            }
        }
        // #502: the captions asked for: a mode that draws them or sidecars that carry them.
        let cap = &job.captions;
        if !matches!(cap.mode.as_str(), "open" | "closed" | "both")
            || cap.files.iter().any(|f| f != "srt" && f != "vtt")
        {
            return Err(
                json!({"code": "bad_captions", "captions": {"mode": cap.mode, "files": cap.files},
                "why": "captions.mode is open, closed or both, and captions.files lists srt, vtt or both"}),
            );
        }
        if cap.mode != "open" && cap.files.is_empty() {
            return Err(
                json!({"code": "captions_not_carried", "captions": {"mode": cap.mode, "files": cap.files},
                "why": format!("captions: mode {} with no file would carry no captions; name srt or vtt in captions.files", cap.mode)}),
            );
        }
        let profile = job.loudness_profile.as_deref().unwrap_or("none");
        let profile = delivery::profile(profile).ok_or_else(
            || json!({"code": "unknown_loudness_profile", "loudness_profile": profile}),
        )?;
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
            Span::Stages => {
                return Err(
                    json!({"code": "range_unbuilt", "range": "stages", "why": "range: stages is the pdf handout's"}),
                )
            }
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
                // #169: on a track whose path holds or jumps, the still is the frame where the
                // timeline first reaches the marker on that path.
                let track = match job.track.is_empty() {
                    true => self.track_json(&job.doc),
                    false => job.track.clone(),
                };
                let played = crate::played::with_track(&doc, &track);
                let at = crate::present::path_of(&played).clock_end(m).unwrap_or(m);
                let k = clock::index(clock::film_time(at, 0, frame), frame);
                k..k + 1
            }
        };
        // Written under a temporary name beside `out`, renamed only when whole.
        let out = PathBuf::from(&job.out);
        let temp = temp_of(&out);
        // #504: the frames replay the document's input track (the job's, or the hub's), so an
        // export shows each pick from its entry on; session view values never reach it (#501).
        let mut track = if job.track.is_empty() {
            self.track_json(&job.doc)
        } else {
            job.track.clone()
        };
        if self.planted(Planted::VariantExportFinalChoice) {
            // Planted: each choice's entries all take its last entry's option.
            let last: BTreeMap<String, Value> = track
                .iter()
                .map(|e| (e["control"].to_string(), e["value"].clone()))
                .collect();
            for e in &mut track {
                e["value"] = last[&e["control"].to_string()].clone();
            }
        }
        doc = crate::played::with_track(&doc, &track);
        // #903: an export no one gave input to plays the document's tour.
        crate::tour::inline(&mut doc);
        if self.scenario.module_planted.as_deref() == Some("export_keeps_live_hover") {
            // Planted (#539): the frames evaluate hover as the panel's live hover, not none.
            self.hover_into(&job.doc, &mut doc);
        }
        // #507: a film whose markers wait or branch exports one path, each hold as long as the
        // film audit's hold rule asks for what it shows.
        let path = match (&job.range, doc_span(&doc)) {
            (Span::Whole, Some(end)) => self.export_path(&doc, end)?,
            _ => None,
        };
        let frames = match &path {
            Some(p) => {
                doc = p.doc.clone();
                0..(p.frames + frame - 1).div_euclid(frame)
            }
            None => frames,
        };
        let _ = self.inline_tables(&mut doc);
        let _ = self.inline_vectors(&mut doc);
        self.inline_occurrences(&mut doc, &job.track)
            .map_err(|i| json!({"code": i.code, "issues": [i.to_json()]}))?;
        let _ = self.column_view(&mut doc, 0);
        std::fs::create_dir_all(scratch).map_err(|_| refuse("export_unwritable"))?;
        // The readiness gate: every asset the frames or the mix read, before any frame.
        if let Err(issue) = self.ready(&mut doc) {
            let mut drawn = 0;
            if self.scenario.planted == Some(Planted::ExportStartsThenStops) {
                // Planted: it starts anyway and stops at the missing strip's first frame, its
                // frames' rows written to the temporary name as they are drawn.
                let stop = issue["start"]
                    .as_i64()
                    .map_or(0, |t| clock::index(t, frame));
                let shard = Shard {
                    frames: frames.start..stop.max(frames.start),
                    frame,
                    size: job.size,
                    opaque: !job.alpha,
                    gain: 0.0,
                    ceiling: None,
                };
                let file = std::fs::File::create(&temp).map_err(|_| refuse("export_unwritable"))?;
                let mut run = Run::new(scratch, Vec::new(), false);
                self.export_frames(&doc, &shard, &mut run, &mut Sink::Raw(file))?;
                drawn = (shard.frames.end - shard.frames.start) as usize;
            }
            return Err(
                json!({"outcome": "stopped", "state": "BLOCKED", "gate": "readiness", "frames_drawn": drawn, "issues": [issue]}),
            );
        }
        // #162: the Lottie target writes no frames: its writer reads the document as the frames show it.
        if target == "lottie" {
            return self.export_lottie(job, &doc, ((p, q), frame), frames, &out, &temp);
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
                return Err(
                    json!({"outcome": "blocked", "state": "BLOCKED", "code": "narration.unshareable", "unshareable": who, "asks": [ask],
                    "reason": format!("an export carries narration only under a license that says shareable: true; this one's doesn't: {who}")}),
                );
            }
            crate::narration::heard_back::fits(&doc, &s)?;
        }
        // #157: the licences the export carries, through every job output to its inputs; a CC BY
        // input without its credit FAILs.
        let (licenses, credits, missing) = guards::licenses(&doc);
        if !missing.is_empty() {
            return Err(json!({"outcome": "failed", "code": "credit_missing", "issues": missing}));
        }
        let cuts = self.cuts_of(&doc);
        self.media.captions = Some(crate::narration::View {
            frame,
            draw: cap.mode != "closed",
            profile: cap.profile.clone(),
            cuts,
        });
        let laid = self.captions_of(&doc, frame, cap.profile.as_deref())?;
        if let Some(l) = &laid {
            let found = captions::check(&l.captions, &l.limits, &crate::narration::graphemes);
            if !found.is_empty() {
                let list: Vec<Value> = found
                    .iter()
                    .map(|v| json!({"caption": v.caption, "measure": v.limit, "what": v.what}))
                    .collect();
                return Err(
                    json!({"outcome": "failed", "code": "captions", "profile": l.profile.name, "issues": list}),
                );
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
            let (first, last) = (
                self.span_start(frames.start, frame, hz),
                self.span_start(frames.end, frame, hz),
            );
            let planted = crate::mixdown::export_planted(self.scenario.planted);
            let pass = |db: f64| {
                let mut player = Player::new(mix.clone(), planted);
                player.delivery = amp(db);
                if let Some(db) = ceiling {
                    player.set_ceiling(db);
                }
                player.seek(first);
                let mut buf = vec![0f32; 2 * (last - first).max(0) as usize];
                player.read(&mut buf);
                (
                    loudness::measure(&buf, &[1.0, 1.0], i64::from(hz), 8),
                    player.limited(),
                )
            };
            let (master, _) = pass(0.0);
            // Planted: no static gain; the normalizer rides the master instead.
            if let Some(g) = profile
                .gain(master.integrated)
                .filter(|_| !deep_canvas_media::planted(NORMALIZER))
            {
                let (read, cut) = pass(g);
                gain = if cut && !profile.holds(read.integrated) {
                    g + target_lufs - read.integrated
                } else {
                    g
                };
                // #157: a delivery louder than the streaming level is held to a lower ceiling; the one
                // correction keeps it at the level instead (0.01 LU under it).
                if let Some(l) = profile
                    .louder
                    .as_ref()
                    .filter(|l| read.integrated > l.integrated)
                {
                    gain -= read.integrated - l.integrated + 0.01;
                }
            }
            before = Some(master);
        }
        // Planted: the png writer exports only the session's selected items.
        if target == "png" && self.scenario.planted == Some(Planted::TargetExportsSelection) {
            let selection = self
                .session_state
                .get(&job.doc)
                .map(|s| s["selection"].clone())
                .unwrap_or(Value::Null);
            if let (Some(sel), Some(items)) = (
                selection.as_array().filter(|s| !s.is_empty()),
                doc["items"].as_object_mut(),
            ) {
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
        let warnings = mix
            .as_deref()
            .map(|m| guards::end_cuts(m, frames.end * frame))
            .unwrap_or_default();
        if job.refuse_end_cuts && !warnings.is_empty() {
            return Err(json!({"outcome": "failed", "code": "end_cut", "issues": warnings}));
        }
        // #157: the readiness gate's disk count: the PCM is all an export keeps on disk.
        let needed = match mix {
            Some(_) => {
                (self.span_start(frames.end, frame, hz) - self.span_start(frames.start, frame, hz))
                    .max(0) as u64
                    * 8
            }
            None => 0,
        };
        let disk = guards::disk_gate(needed, scratch);
        if !disk.fits && !self.guard_planted(Guard::NoDiskGate) {
            return Err(
                json!({"outcome": "refused", "code": "export_disk_short", "needed": needed, "free": disk.free, "frames_drawn": 0,
                "what": format!("the export keeps {needed} bytes of PCM on disk while it runs, and {} has {} bytes free", scratch.display(), disk.free)}),
            );
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
            let samples: Vec<f32> = pcm
                .as_chunks::<4>()
                .0
                .iter()
                .map(|b| f32::from_le_bytes(*b))
                .collect();
            let read = loudness::measure(&samples, &[1.0, 1.0], i64::from(hz), 8);
            let mut misses = profile.misses(&read);
            misses.extend(
                before
                    .as_ref()
                    .and_then(|b: &Loudness| delivery::range_kept(b.range, read.range, cut)),
            );
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
        let raw: Vec<f32> = pcm
            .as_chunks::<4>()
            .0
            .iter()
            .map(|b| f32::from_le_bytes(*b))
            .collect();
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
        let mut run = Run::new(
            scratch,
            chapters.iter().map(|c| c.2).collect(),
            job.readback,
        );
        let mut sink = self.sink_for(job, &doc, &target, &entry, &temp, (p, q), len)?;
        for shard in &shards {
            self.export_frames(&doc, shard, &mut run, &mut sink)?;
        }
        // #169: film.wrap holds an export of whole passes of the loop, not a part of one.
        let passes = doc_span(&doc)
            .is_some_and(|span| span > 0 && ((frames.end - frames.start) * frame) % span == 0);
        let looping =
            passes && doc.pointer("/transport/loop").and_then(Value::as_str) == Some("wrap");
        let seen = run.seen.take().ok_or_else(|| refuse("no_frames"))?;
        let (hashes, reads, wrap) = seen.finish(looping).map_err(|()| {
            stopped(
                frames.end - 1,
                "device_lost",
                &format!("the GPU device was lost at frame {}", frames.end - 1),
            )
        })?;
        // #157: frames.finite, film.blank and film.wrap, from what the GPU read of each frame.
        let mut issues = std::mem::take(&mut run.nonfinite);
        issues.extend(self.frame_guards(
            &doc,
            job,
            frame,
            frames.start,
            &reads,
            wrap.filter(|_| looping),
            run.size,
        )?);
        if !issues.is_empty() {
            return Err(json!({"outcome": "failed", "code": "export.frames", "issues": issues}));
        }
        let size = run.size;
        let encoder =
            self.sink_finish(sink, job, &target, &entry, &temp, &audio, hz, &tc, tc_start)?;
        // #157: the colour probe, and the delivery read back from its own bytes.
        let (mut probe, mut read, mut found) = (Value::Null, None, Vec::new());
        if target == "video" {
            match self.color_probe(job, size, (p, q), scratch) {
                Ok(p) => probe = p,
                Err(e) if e["outcome"] == "failed" => {
                    found.extend(e["issues"].as_array().cloned().unwrap_or_default())
                }
                Err(e) => return Err(e),
            }
        }
        if target == "video" || target == "png" {
            let pcm = mix.as_ref().map(|_| (&raw[..], 2, hz));
            let d = fidelity::Delivery {
                path: &temp,
                doc: &doc,
                job,
                frames: frames.clone(),
                frame,
                rate: (p, q),
                size,
                hashes: &hashes,
                pcm,
                chapters: &chapters,
                kept: self
                    .guard_planted(Guard::FidelityKeepsFrames)
                    .then_some(&run.kept[..]),
                priming: encoder.pointer("/audio/priming").and_then(Value::as_i64),
                reads: &reads,
            };
            match self.read_delivery(&d) {
                Ok(r) => read = Some(r),
                Err(e) if e["outcome"] == "failed" && found.is_empty() => return Err(e),
                Err(e) if e["outcome"] == "failed" => {
                    found.extend(e["issues"].as_array().cloned().unwrap_or_default())
                }
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
                return Err(
                    json!({"code": "delivery_unread", "why": "the delivery holds no sound"}),
                );
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
                let text = if kind == "srt" {
                    captions::srt(&cues)
                } else {
                    captions::vtt(&cues)
                };
                let to = out.with_extension(kind);
                let part = to.with_file_name(format!(
                    ".{}.part",
                    to.file_name()
                        .map(|f| f.to_string_lossy())
                        .unwrap_or_default()
                ));
                if std::fs::write(&part, text).is_err() {
                    drop_temp();
                    sidecars
                        .iter()
                        .for_each(|(part, _)| drop(std::fs::remove_file(part)));
                    return Err(refuse("export_unwritable"));
                }
                sidecars.push((part, to));
            }
        }
        let renamed = std::fs::rename(&temp, &out).and_then(|()| {
            sidecars
                .iter()
                .try_for_each(|(part, to)| std::fs::rename(part, to))
        });
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
        let holder = job
            .session
            .clone()
            .unwrap_or_else(|| format!("process {}", std::process::id()));
        let key = adapter
            .as_ref()
            .and_then(|a| a["name"].as_str())
            .unwrap_or("gpu")
            .to_string();
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
        if let Some(p) = &path {
            receipt["ranges"] = json!(p.ranges);
            receipt["holds"] = json!(p.holds);
        }
        if mix.is_some() {
            receipt["sample_rate"] = json!(hz);
            receipt["audio"] = json!(job.audio_codec);
            receipt["pcm_hashes"] = json!(pcm_hashes);
            receipt["bakes"] = self.bakes_listed(&doc, hz)?;
        }
        if let Some(read) = &sound {
            for (k, v) in readings(read) {
                receipt[k] = v;
            }
            receipt["loudness_profile"] = json!(profile.name);
            receipt["gain"] = json!(gain);
            receipt["limiter_cut"] = json!(cut);
            receipt["delivery"] =
                Value::Object(delivered.as_ref().map(readings).unwrap_or_default());
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
        let f = if n >= drop {
            n + drop * ((n - drop) / per_minute)
        } else {
            n
        };
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
                Some((
                    id.clone(),
                    sha,
                    deep_canvas_media::doc::time(doc, s.get("start")),
                ))
            })
            .collect();
        for (id, sha, start) in strips {
            if sha.len() != 64 || crate::evidence::read(&self.scenario.evidence, &sha).is_none() {
                return Err(
                    json!({"code": "asset_missing", "severity": "error", "strip": id, "asset": sha, "start": start,
                    "what": format!("strip `{id}` plays asset {sha}, which the evidence store doesn't hold")}),
                );
            }
        }
        if let Some(issue) = self.probe_assets(doc).into_iter().next() {
            return Err(
                json!({"code": "asset_missing", "severity": "error", "item": issue.ids.first(), "path": issue.path,
                "asset": issue.actual, "why": issue.code, "what": issue.what}),
            );
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
                || deep_canvas::show::Writer {
                    kind: deep_canvas::show::WriterKind::Plugin,
                    id: "export".into(),
                },
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

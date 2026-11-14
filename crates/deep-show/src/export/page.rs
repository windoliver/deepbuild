//! #169 (canvas primitives: Export: playable page): a live piece shared as a folder a browser
//! plays with no network and no code from the document. The export module lists the piece's
//! states and edges (`deep_canvas_export::page::list`); here each state renders as its settled
//! still (or its loop) and each edge as its clip, every one through the export itself with its
//! guards, so the page shows only frames the app rendered. The folder holds an index page, the
//! fixed player DeepBuild ships, the media and a manifest of states, edges, keys and each
//! target's screen box per state; it is written under a temporary name, read back by hash and
//! renamed only when whole, and each of its files goes into the evidence store, so it leaves the
//! machine only by hash, through a send that waits for your approval.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::time::Instant;

use deep_canvas::document::frame_rate_of;
use deep_canvas::schedule::{default_view, CarriedState, Scheduler};
use deep_canvas::time as clock;
use deep_canvas_export::page::list::{self, Edge, Listing, State};
use deep_canvas_export::page::write;
use deep_canvas_motion::program::Program;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};

use super::{temp_of, Captions, Guard, Job, Span};
use crate::access;
use crate::hub::{EvalTime, Hub, Planted};

/// `page.sample.count` and `page.orbit.frames`: their defaults and most.
const SAMPLES: (u64, u64) = (16, 64);
const ORBIT: (u64, u64) = (36, 72);

/// The page's options: the sampled control and its count, the turntable's frames, the still's
/// format.
struct Options {
    sample: Option<(String, u64)>,
    orbit: Option<u64>,
    jpeg: bool,
}

/// What every state's and edge's render reads.
struct Ctx<'a> {
    job: &'a Job,
    doc: &'a Value,
    listing: &'a Listing,
    frame: i64,
    temp: &'a Path,
    opts: &'a Options,
}

fn refused(code: &str, why: String, more: Value) -> Value {
    let mut out = json!({"outcome": "refused", "code": code, "why": why});
    if let (Some(o), Some(m)) = (out.as_object_mut(), more.as_object()) {
        o.extend(m.clone());
    }
    out
}

fn options(doc: &Value, page: &Value) -> Result<Options, Value> {
    let sample = match page.get("sample") {
        None | Some(Value::Null) => None,
        Some(s) => {
            let control = s["control"].as_str().unwrap_or_default().to_string();
            if doc["controls"][&control]["kind"].as_str() != Some("slider") {
                return Err(refused(
                    "page_sample_control",
                    format!("page.sample names {control}, which isn't a slider of this piece"),
                    json!({"control": control}),
                ));
            }
            match s.get("count").map_or(Some(SAMPLES.0), Value::as_u64) {
                Some(n) if (1..=SAMPLES.1).contains(&n) => Some((control, n)),
                _ => {
                    return Err(refused(
                        "page_samples",
                        format!(
                            "page.sample takes at most {} samples of {control}, and asks for {}",
                            SAMPLES.1, s["count"]
                        ),
                        json!({"control": control, "count": s["count"], "most": SAMPLES.1}),
                    ))
                }
            }
        }
    };
    let orbit = match page.get("orbit") {
        None | Some(Value::Null) => None,
        Some(o) => {
            if !deep_canvas_scene3d::scene::has_3d(doc) {
                return Err(refused(
                    "page_orbit_2d",
                    "page.orbit turns the camera of a 3D view, and this piece has none".into(),
                    json!({}),
                ));
            }
            match o.get("frames").map_or(Some(ORBIT.0), Value::as_u64) {
                Some(n) if (1..=ORBIT.1).contains(&n) => Some(n),
                _ => {
                    return Err(refused(
                        "page_orbit_frames",
                        format!(
                            "page.orbit takes at most {} frames, and asks for {}",
                            ORBIT.1, o["frames"]
                        ),
                        json!({"frames": o["frames"], "most": ORBIT.1}),
                    ))
                }
            }
        }
    };
    let jpeg = match page["still"].as_str().unwrap_or("png") {
        "png" => false,
        "jpeg" => true,
        other => {
            return Err(refused(
                "page_still",
                format!("page.still is png or jpeg, not {other}"),
                json!({"still": other}),
            ))
        }
    };
    Ok(Options {
        sample,
        orbit,
        jpeg,
    })
}

/// `n` values evenly over a slider's range, both ends included; its default (or its low end)
/// alone for one.
fn sample_values(control: &Value, n: u64) -> Vec<f64> {
    let r = &control["range"];
    let (lo, hi) = (r[0].as_f64().unwrap_or(0.0), r[1].as_f64().unwrap_or(1.0));
    if n < 2 {
        return vec![control["default"].as_f64().unwrap_or(lo)];
    }
    (0..n)
        .map(|k| lo + (hi - lo) * k as f64 / (n - 1) as f64)
        .collect()
}

/// `form` with its camera turned `by` degrees of azimuth about its target: the camera item the
/// document names, or its first `camera@1` item.
fn turned(form: &Value, by: f64) -> Result<Value, Value> {
    let items = form["items"].as_object();
    let named = form["camera"]
        .as_str()
        .filter(|id| items.is_some_and(|i| i.contains_key(*id)));
    let id = named
        .map(str::to_string)
        .or_else(|| {
            (items.into_iter().flatten())
                .find(|(_, i)| i["kind"] == "camera@1")
                .map(|(id, _)| id.clone())
        })
        .ok_or_else(|| {
            refused(
                "page_orbit_camera",
                "page.orbit turns a camera, and this piece has no camera@1 item".into(),
                json!({}),
            )
        })?;
    let mut out = form.clone();
    let orbit = &mut out["items"][&id]["params"]["orbit"];
    let az = orbit["azimuth"].as_f64().unwrap_or(0.0);
    orbit["azimuth"] = json!(az + by);
    Ok(out)
}

/// The page's redaction: the least complete of its assets' (each asset's own `redaction`,
/// complete where it says nothing).
fn redaction(doc: &Value) -> &'static str {
    let mut worst = "complete";
    for (_, a) in doc["assets"].as_object().into_iter().flatten() {
        match a["redaction"].as_str() {
            Some("incomplete") => return "incomplete",
            Some("unknown") => worst = "unknown",
            _ => {}
        }
    }
    worst
}

/// The largest rectangle, on a grid of `step` px, whose cells all show item `id` in `raster`
/// (`w` × `h`, one item index a pixel): `[x, y, w, h]` px.
fn largest_rect(raster: &[u32], [w, h]: [usize; 2], id: u32, step: usize) -> Option<[f64; 4]> {
    let (cols, rows) = (w / step, h / step);
    let mut heights = vec![0usize; cols];
    let mut best = (0usize, [0usize; 4]);
    let mut stack: Vec<usize> = Vec::with_capacity(cols + 1);
    for r in 0..rows {
        let y = r * step + step / 2;
        for (c, hc) in heights.iter_mut().enumerate() {
            let x = c * step + step / 2;
            *hc = if raster[y * w + x] == id { *hc + 1 } else { 0 };
        }
        stack.clear();
        for c in 0..=cols {
            let hc = heights.get(c).copied().unwrap_or(0);
            while let Some(&top) = stack.last() {
                if heights[top] < hc {
                    break;
                }
                stack.pop();
                let left = stack.last().map_or(0, |s| s + 1);
                let area = heights[top] * (c - left);
                if area > best.0 {
                    best = (area, [left, r + 1 - heights[top], c - left, heights[top]]);
                }
            }
            stack.push(c);
        }
    }
    (best.0 > 0).then(|| best.1.map(|v| (v * step) as f64))
}

/// A PNG's pixels as a JPEG, for `still: jpeg`.
fn jpeg_of_png(png: &[u8]) -> Result<Vec<u8>, String> {
    let img = image::load_from_memory_with_format(png, image::ImageFormat::Png)
        .map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    image::codecs::jpeg::JpegEncoder::new_with_quality(&mut out, 90)
        .encode_image(&img.to_rgb8())
        .map_err(|e| e.to_string())?;
    Ok(out)
}

fn sha256_hex(bytes: &[u8]) -> String {
    super::hex(Sha256::digest(bytes))
}

impl Hub<'_> {
    /// `video.codec: page`: the playable page of `doc`, written as a folder at `job.out`.
    pub(super) fn export_page(&mut self, job: &Job, doc: &Value) -> Result<Value, Value> {
        let started = Instant::now();
        let opts = options(doc, &job.page)?;
        // A page can't keep the status rule, as a Lottie can't (#162).
        if let Some(r) = doc.as_object().and_then(|d| {
            deep_canvas_export::lottie::status_binding(
                d,
                "page.status_binding",
                "a playable page",
                "a playable page",
            )
        }) {
            return Err(
                json!({"outcome": "refused", "code": r.code, "path": r.path, "why": r.what, "issues": [r.json()]}),
            );
        }
        let (p, q) = job
            .frame_rate
            .or_else(|| doc.get("transport").and_then(frame_rate_of))
            .unwrap_or((60, 1));
        let frame = clock::frame_length(p, q)
            .map_err(|why| json!({"code": "bad_rate", "frame_rate": [p, q], "why": why}))?;
        let by_picture = self.planted(Planted::Export(Guard::PageKeysByPicture));
        let listing = {
            let mut probe = |form: &Value, t: i64| self.page_probe(form, t, by_picture, job.size);
            list::list(doc, frame, &mut probe)?
        };
        let out = PathBuf::from(&job.out);
        let temp = temp_of(&out);
        let _ = std::fs::remove_dir_all(&temp);
        std::fs::create_dir_all(temp.join("media"))
            .and_then(|()| std::fs::create_dir_all(temp.join("player")))
            .map_err(|_| json!({"code": "export_unwritable"}))?;
        let mut files: BTreeMap<String, Vec<u8>> = BTreeMap::new();
        let cx = Ctx {
            job,
            doc,
            listing: &listing,
            frame,
            temp: &temp,
            opts: &opts,
        };
        let mut states = Vec::with_capacity(listing.states.len());
        for (k, s) in listing.states.iter().enumerate() {
            states.push(self.page_state(&cx, k, s, &mut files)?);
        }
        let mut edges = Vec::with_capacity(listing.edges.len());
        for (k, e) in listing.edges.iter().enumerate() {
            edges.push(self.page_edge(&cx, k, e, &mut files)?);
        }
        let mut manifest = write::manifest(doc, &listing, states, edges, self.page_bound(doc));
        if let Some((control, n)) = &opts.sample {
            let c = &doc["controls"][control];
            manifest["sample"] =
                json!({"control": control, "label": c["label"], "values": sample_values(c, *n)});
        }
        if let Some(n) = opts.orbit {
            manifest["orbit"] = json!({"frames": n});
        }
        if self.planted(Planted::Export(Guard::PageTargetsOnImage)) {
            // Planted (#169 AC7): the targets are only boxes on each still.
            manifest["targets_on_image"] = json!(true);
        }
        let manifest_bytes = serde_json::to_vec_pretty(&manifest).unwrap_or_default();
        files.insert("manifest.json".into(), manifest_bytes);
        files.insert(
            "index.html".into(),
            write::index_html(doc, &manifest).into_bytes(),
        );
        files.insert("player/player.js".into(), write::PLAYER_JS.into());
        files.insert("player/player.css".into(), write::PLAYER_CSS.into());
        for (name, bytes) in files.iter().filter(|(n, _)| !n.starts_with("media/")) {
            std::fs::write(temp.join(name), bytes)
                .map_err(|_| json!({"code": "export_unwritable", "file": name}))?;
        }
        // Read back: every file the page names is there and is the bytes written; each goes into
        // the evidence store, the one way a file leaves the machine.
        let mut listed = Vec::with_capacity(files.len());
        for (name, bytes) in &files {
            if std::fs::read(temp.join(name)).ok().as_ref() != Some(bytes) {
                return Err(json!({"outcome": "failed", "code": "export.fidelity",
                    "issues": [{"code": "export.fidelity", "what": format!("{name} doesn't read back as written")}]}));
            }
            crate::evidence::put(&self.scenario.evidence, bytes)
                .map_err(|_| json!({"code": "not_written", "file": name}))?;
            listed.push(json!({"path": name, "sha256": sha256_hex(bytes), "bytes": bytes.len()}));
        }
        let _ = std::fs::remove_dir_all(&out);
        std::fs::rename(&temp, &out).map_err(|_| json!({"code": "export_unwritable"}))?;
        Ok(json!({
            "target": "page",
            "states": listing.states.len(),
            "edges": listing.edges.len(),
            "bytes": files.values().map(Vec::len).sum::<usize>(),
            "warnings": listing.warnings,
            "redaction": redaction(doc),
            "files": listed,
            "frame_rate": [p, q],
            "timing": {"wall": started.elapsed().as_secs_f64()},
        }))
    }

    /// The core's carried state of `form` at `t`, read in a fresh session; planted, the frame's
    /// raw hash in its place, so states are keyed by the picture and the controls alone.
    fn page_probe(
        &mut self,
        form: &Value,
        t: i64,
        by_picture: bool,
        size: Option<[u16; 2]>,
    ) -> Result<Vec<CarriedState>, Value> {
        if !by_picture {
            return Ok(self.carried_at(form, t));
        }
        let mut sched = Scheduler::new(&self.startup.sealed, self.options());
        let mut session = self.new_session();
        session.load(&mut sched, form);
        let (rgba, size) = self
            .export_frame(&mut sched, &mut session, form, t, size, true)
            .map_err(|u| json!({"code": u.code, "path": u.path}))?;
        let bgra: Vec<u8> = (rgba.as_chunks::<4>().0.iter())
            .flat_map(|p| [p[2], p[1], p[0], p[3]])
            .collect();
        let hash = self.gpu_hash(&bgra, size.map(u32::from))?;
        Ok(vec![CarriedState {
            module: "picture".into(),
            kind: "frame".into(),
            key: String::new(),
            hash: super::hex(hash),
        }])
    }

    /// The core's carried-state list as a play of `form` leaves it at `t`, read through the core
    /// in a fresh session: seeking equals playing, so this is what any play to `t` carries.
    pub(crate) fn carried_at(&self, form: &Value, t: i64) -> Vec<CarriedState> {
        let mut sched = Scheduler::new(&self.startup.sealed, self.options());
        let mut session = self.new_session();
        session.load(&mut sched, form);
        crate::played::load_at(&mut sched, &mut session, form, t);
        session.frame(&mut sched, t, &default_view(form));
        session.carried(&sched)
    }

    /// One state's entry: its still (and loop), its targets' boxes, its tree and readouts.
    fn page_state(
        &mut self,
        cx: &Ctx<'_>,
        k: usize,
        s: &State,
        files: &mut BTreeMap<String, Vec<u8>>,
    ) -> Result<Value, Value> {
        let (listing, frame) = (cx.listing, cx.frame);
        let form = list::played(cx.doc, &listing.axes, &s.node, listing.present);
        let (t, track) = (s.node.t, &s.node.track);
        let still = self.page_still(cx, &form, track, t, &format!("media/s{k}"), files)?;
        let looped = match s.rest.loop_len {
            Some(len) if len >= frame => {
                let name = format!("media/s{k}-loop.mp4");
                let end = t + len.div_euclid(frame) * frame;
                let span = Span::Between(EvalTime::Flicks(t), EvalTime::Flicks(end));
                self.page_media(cx, &form, track, span, "h264", &name, files)?;
                Some(name)
            }
            _ => None,
        };
        // The sampled control's stills, and the turntable's, each a still of this state.
        let mut samples = Vec::new();
        if let Some((control, n)) = &cx.opts.sample {
            let values = sample_values(&cx.doc["controls"][control], *n);
            for (i, v) in values.into_iter().enumerate() {
                let pinned = crate::geometry_audit::with_control(&form, control, v);
                let mut r =
                    self.page_still(cx, &pinned, track, t, &format!("media/s{k}-x{i}"), files)?;
                r["value"] = json!(v);
                samples.push(r);
            }
        }
        let mut orbit = Vec::new();
        for i in 0..cx.opts.orbit.unwrap_or(0) {
            let az = 360.0 * i as f64 / cx.opts.orbit.unwrap_or(1) as f64;
            let mut r = self.page_still(
                cx,
                &turned(&form, az)?,
                track,
                t,
                &format!("media/s{k}-o{i}"),
                files,
            )?;
            r["azimuth"] = json!(az);
            orbit.push(r);
        }
        let shown = crate::played::at(&form, t).into_owned();
        let (targets, size) = self.page_targets(&form, &shown, t, cx.job.size)?;
        let program = shown.as_object().and_then(|m| Program::compile(m).ok());
        let data = access::data_at(&shown, program.as_ref(), t);
        Ok(json!({
            "id": format!("s{k}"),
            "controls": write::values_json(&listing.axes, &s.key.values),
            "marker": s.key.stop,
            "stage": s.rest.stage,
            "still": still["still"],
            "frame_hash": still["frame_hash"],
            "loop": looped,
            "samples": samples,
            "orbit": orbit,
            "t": t,
            "track": track,
            "view": s.node.view,
            "size": size,
            "targets": targets,
            "tree": access::tree(&shown, &[]),
            "readouts": access::readouts(&data, &[]),
        }))
    }

    /// One edge's entry: its clip, from the change until its play rests, when it takes time.
    fn page_edge(
        &mut self,
        cx: &Ctx<'_>,
        k: usize,
        e: &Edge,
        files: &mut BTreeMap<String, Vec<u8>>,
    ) -> Result<Value, Value> {
        // A change that shows on its next frame and moves no further lands with no clip.
        let clip = if e.node.t > e.at + cx.frame {
            let form = list::played(cx.doc, &cx.listing.axes, &e.node, cx.listing.present);
            let name = format!("media/e{k}.mp4");
            let span = Span::Between(EvalTime::Flicks(e.at), EvalTime::Flicks(e.node.t));
            self.page_media(cx, &form, &e.node.track, span, "h264", &name, files)?;
            Some(name)
        } else {
            None
        };
        Ok(json!({
            "id": format!("e{k}"),
            "from": format!("s{}", e.from),
            "to": format!("s{}", e.to),
            "control": e.control.as_deref().unwrap_or("present"),
            "value": e.value,
            "clip": clip,
            "span": (e.node.t - e.at) as f64 / deep_canvas::grammar::FLICKS_PER_SECOND as f64,
        }))
    }

    /// One still, exported through the export as a one-frame PNG sequence, into the page's
    /// media as `base` with its extension (a JPEG of that frame with `still: jpeg`): its name
    /// and the raw frame hash the export recorded.
    fn page_still(
        &mut self,
        cx: &Ctx<'_>,
        form: &Value,
        track: &[Value],
        t: i64,
        base: &str,
        files: &mut BTreeMap<String, Vec<u8>>,
    ) -> Result<Value, Value> {
        let png = format!("{base}.png");
        let still = Span::Still(EvalTime::Flicks(t));
        let r = self.page_media(cx, form, track, still, "png_seq", &png, files)?;
        let mut name = png;
        if cx.opts.jpeg {
            let bytes = files.remove(&name).unwrap_or_default();
            let _ = std::fs::remove_file(cx.temp.join(&name));
            let jpeg = jpeg_of_png(&bytes)
                .map_err(|why| json!({"code": "export_unwritable", "media": name, "why": why}))?;
            name = format!("{base}.jpg");
            std::fs::write(cx.temp.join(&name), &jpeg)
                .map_err(|_| json!({"code": "export_unwritable", "media": name}))?;
            files.insert(name.clone(), jpeg);
        }
        Ok(json!({"still": name, "frame_hash": r["frame_hashes"][0]}))
    }

    /// One still or clip, exported through the export itself into the page's media as `name`:
    /// a PNG sequence of one frame, or an H.264 movie with its sound and open captions.
    #[allow(clippy::too_many_arguments)]
    fn page_media(
        &mut self,
        cx: &Ctx<'_>,
        form: &Value,
        track: &[Value],
        range: Span,
        codec: &str,
        name: &str,
        files: &mut BTreeMap<String, Vec<u8>>,
    ) -> Result<Value, Value> {
        let (job, temp) = (cx.job, cx.temp);
        let target = temp.join(name);
        let frames = temp.join(format!(".{}.frames", name.replace('/', "_")));
        let one = Job {
            doc: job.doc.clone(),
            range,
            size: job.size,
            frame_rate: job.frame_rate,
            codec: codec.into(),
            audio_codec: if codec == "h264" { "aac" } else { "pcm" }.into(),
            out: if codec == "png_seq" { &frames } else { &target }
                .display()
                .to_string(),
            track: track.to_vec(),
            captions: Captions {
                profile: job.captions.profile.clone(),
                files: Vec::new(),
                mode: "open".into(),
            },
            loudness_profile: job.loudness_profile.clone(),
            session: job.session.clone(),
            ..Job::default()
        };
        let reply = self.export_doc(&one, form.clone());
        if reply["outcome"] != "exported" {
            let mut why = reply;
            why["media"] = json!(name);
            return Err(why);
        }
        if codec == "png_seq" {
            let png = std::fs::read_dir(&frames)
                .ok()
                .and_then(|mut d| d.next())
                .and_then(Result::ok)
                .map(|f| f.path())
                .ok_or_else(|| json!({"code": "export_unwritable", "media": name}))?;
            std::fs::rename(&png, &target)
                .map_err(|_| json!({"code": "export_unwritable", "media": name}))?;
            let _ = std::fs::remove_dir_all(&frames);
        }
        let bytes = std::fs::read(&target)
            .map_err(|_| json!({"code": "export_unwritable", "media": name}))?;
        files.insert(name.into(), bytes);
        Ok(reply["receipt"].clone())
    }

    /// Each target of the state that draws, in the Tab order, with the screen box a click on it
    /// lands in: the largest rectangle of its item's own pixels in the still, from the 3D object
    /// ID pass, or from the 2D marks' boxes painted in draw order; and the still's size.
    fn page_targets(
        &mut self,
        form: &Value,
        shown: &Value,
        t: i64,
        size: Option<[u16; 2]>,
    ) -> Result<(Vec<Value>, [u16; 2]), Value> {
        let (raster, names, boxes, size) = self.page_ids(form, shown, t, size)?;
        let dims = [usize::from(size[0]), usize::from(size[1])];
        let step = (dims[0] / 320).max(1);
        let targets = deep_canvas::scope::pick_targets(shown, &[])
            .into_iter()
            .filter_map(|p| {
                let id = names
                    .iter()
                    .position(|n| *n == p.item)
                    .map(|i| i as u32 + 1);
                let rect = id.and_then(|id| largest_rect(&raster, dims, id, step));
                let own = || boxes.iter().find(|(i, _)| *i == p.item).map(|(_, b)| *b);
                let b = rect.or_else(own)?;
                Some(
                    json!({"target": format!("{}/{}", p.control, p.option), "control": p.control,
                    "option": p.option, "item": p.item, "label": p.label, "box": b}),
                )
            })
            .collect();
        Ok((targets, size))
    }

    /// The still's pixels as item indices (into the names, from 1; 0 where nothing draws), each
    /// item's box in px, and the still's size.
    #[allow(clippy::type_complexity)]
    fn page_ids(
        &mut self,
        form: &Value,
        shown: &Value,
        t: i64,
        size: Option<[u16; 2]>,
    ) -> Result<(Vec<u32>, Vec<String>, Vec<(String, [f64; 4])>, [u16; 2]), Value> {
        let mut names: Vec<String> = Vec::new();
        let index = |id: &str, names: &mut Vec<String>| -> u32 {
            let id = id.split('#').next().unwrap_or(id);
            match names.iter().position(|n| n == id) {
                Some(i) => i as u32 + 1,
                None => {
                    names.push(id.to_string());
                    names.len() as u32
                }
            }
        };
        if deep_canvas_scene3d::scene::has_3d(shown) {
            let posed = crate::film::posed(shown, t).unwrap_or_else(|| shown.clone());
            let size = size.unwrap_or_else(|| {
                crate::snapshot::px([0, 1].map(|i| posed["size"][i].as_f64().unwrap_or(1.0)))
            });
            let evidence = self.scenario.evidence.clone();
            let read = move |sha: &str| crate::evidence::read(&evidence, sha);
            let palette = self.look.light.clone();
            let gpu = self
                .gpu3()
                .ok_or_else(|| json!({"code": "gpu_unavailable"}))?;
            let (scene, look) = gpu
                .evaluate(&posed, t, &palette, size, &read)
                .map_err(|u| json!({"code": u.code, "path": u.path}))?;
            let (_, ids) = gpu
                .draw_scene(&scene, &look, false)
                .ok_or_else(|| json!({"code": "gpu_unavailable"}))?;
            let [w, h] = size.map(u32::from);
            let inner = |v: u32, n: u32, m: u32| {
                (((f64::from(v) + 0.5) * f64::from(m) / f64::from(n)) as u32).min(m - 1)
            };
            let mut raster = vec![0u32; (w * h) as usize];
            for y in 0..h {
                for x in 0..w {
                    let (ix, iy) = (inner(x, w, ids.size[0]), inner(y, h, ids.size[1]));
                    let i = (iy * ids.size[0] + ix) as usize * 4;
                    let pick = (ids.ids.get(i..i + 4))
                        .map_or(0, |b| u32::from_le_bytes([b[0], b[1], b[2], b[3]]));
                    if let Some(item) = ids.picks.get(&pick).filter(|_| pick != 0) {
                        raster[(y * w + x) as usize] = index(item, &mut names);
                    }
                }
            }
            return Ok((raster, names, scene.boxes(), size));
        }
        let mut sched = Scheduler::new(&self.startup.sealed, self.options());
        let mut session = self.new_session();
        session.load(&mut sched, form);
        crate::played::load_at(&mut sched, &mut session, form, t);
        session.frame(&mut sched, t, &default_view(shown));
        let drawing = crate::frames::drawing_of(&sched, &session)
            .ok_or_else(|| json!({"code": "no_drawing"}))?;
        let (_, drawn, size) = self
            .canonical_rgba(&drawing, size, true)
            .map_err(|u| json!({"code": u.code, "path": u.path}))?;
        let scale = drawn.scale(size);
        let [w, h] = [usize::from(size[0]), usize::from(size[1])];
        let mut raster = vec![0u32; w * h];
        let mut boxes = Vec::new();
        // Later marks draw over earlier ones, so each box is painted over those before it.
        for (id, b) in drawn.boxes() {
            let b = b.map(|v| v * scale);
            let k = index(&id, &mut names);
            let (x0, x1) = (
                (b[0].max(0.0) as usize).min(w),
                ((b[0] + b[2]).max(0.0) as usize).min(w),
            );
            for y in (b[1].max(0.0) as usize).min(h)..((b[1] + b[3]).max(0.0) as usize).min(h) {
                raster[y * w + x0..y * w + x1.max(x0)].fill(k);
            }
            boxes.push((id, b));
        }
        Ok((raster, names, boxes, size))
    }

    /// Each bound value as the text it shows, with its source and as-of time: a page holds the
    /// text, never the reading it came from.
    fn page_bound(&self, doc: &Value) -> Vec<Value> {
        let record = self.record();
        let shown = match (doc.as_object(), doc["items"].as_object()) {
            (Some(d), Some(items)) => {
                deep_canvas_marks::scene::bound_texts(d, items, &record).unwrap_or_default()
            }
            _ => Default::default(),
        };
        (doc.get("bound_values")
            .and_then(Value::as_object)
            .into_iter()
            .flatten())
        .map(|(id, b)| {
            let target = b["target"].as_str().unwrap_or("");
            let item = target
                .strip_prefix("items/")
                .and_then(|t| t.split('/').next())
                .unwrap_or(target);
            let source = b["source"].as_str().unwrap_or("");
            let text = shown.get(item).map(|s| s.text.clone());
            json!({"id": id, "item": item, "source": source, "text": text,
                    "as_of": record.as_of.get(source)})
        })
        .collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_target_box_is_the_largest_rectangle_of_its_own_pixels() {
        // Item 1 a 6 × 4 block, item 2 a 2 × 2 block over its middle: item 1's box keeps clear
        // of item 2, so a click at its centre lands on item 1.
        let (w, h) = (8, 6);
        let mut raster = vec![0u32; w * h];
        for y in 1..5 {
            for x in 1..7 {
                raster[y * w + x] = 1;
            }
        }
        for y in 2..4 {
            for x in 3..5 {
                raster[y * w + x] = 2;
            }
        }
        let one = largest_rect(&raster, [w, h], 1, 1).expect("item 1 shows");
        assert_eq!(
            largest_rect(&raster, [w, h], 2, 1),
            Some([3.0, 2.0, 2.0, 2.0])
        );
        let centre = [one[0] + one[2] / 2.0, one[1] + one[3] / 2.0].map(|v| v as usize);
        assert_eq!(raster[centre[1] * w + centre[0]], 1, "box {one:?}");
        assert_eq!(largest_rect(&raster, [w, h], 3, 1), None);
    }
}

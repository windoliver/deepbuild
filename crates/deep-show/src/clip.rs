//! Issue #1250: clips of a play (canvas primitives: Input track; Export). While a piece plays
//! live, the app keeps its input track from its start or its last load, and the logic module's
//! checkpoints, with each step's state hashed by field. `save_clip` (⌘⇧C by default) writes the
//! last `seconds` played, never before the play's start: a replica restores the nearest
//! checkpoint at or before the clip's start and replays the track to its end, and only when it
//! ends where the live play did does the export path render the range from the track, never from
//! the screen. On an indexed look that is a GIF of the index target, exact to its palette and
//! pixel grid (`write`); otherwise an MP4 through the encode job with the piece's sound, as is a
//! GIF over 32 MiB (`clip.too_large`). `save_still` writes the frame on screen as a PNG, indexed
//! on an indexed look. Each lands in the piece's exports folder, on a card; nothing is uploaded,
//! and a clip is a keepsake, never evidence.

pub(crate) mod write;

use std::collections::{BTreeMap, VecDeque};
use std::path::{Path, PathBuf};
use std::rc::Rc;

use deep_canvas::schedule::{default_view, Scheduler, Session as DocSession};
use deep_canvas_marks::print::Indexed;
use deep_groups_render::indexed::Reader;
use deep_logic::world::{track_of, Entry, Record, World};
use serde_json::{json, Map, Value};

use crate::export::{Job, Span};
use crate::hub::{EvalTime, Hub, Planted};
use crate::shared::FLICKS;

/// The most a clip keeps, in seconds (Input track: `save_clip {seconds ≤ 60}`).
const MOST_SECONDS: i64 = 60;
/// A GIF past this is written as an MP4 instead (`clip.too_large`).
const GIF_MOST_BYTES: usize = 32 << 20;

/// The planted clips' names (#1250's acceptance README: Planted programs).
pub(crate) fn planted(name: &str) -> Option<Planted> {
    Some(Planted::Clip(match name {
        "clip_requantizes_median_cut" => write::Plant::MedianCut,
        "clip_gif_every_frame" => write::Plant::EveryFrame,
        _ => return None,
    }))
}

/// A player control (Input track: `save_clip {seconds = 10 (≤ 60), scale = 2}`, `save_still
/// {scale = 2}`).
#[derive(Clone, Debug, PartialEq)]
pub enum Action {
    Clip { seconds: i64, scale: u8 },
    Still { scale: u8 },
}

impl Action {
    fn name(&self) -> &'static str {
        match self {
            Action::Clip { .. } => "save_clip",
            Action::Still { .. } => "save_still",
        }
    }
}

/// The player control an `input` event runs: ⌘⇧C, Save clip's default key, or an `action`
/// event, a player control as the app's commands and a rebound key run it; `None` for any other.
pub(crate) fn action_of(event: &Value) -> Option<Option<Action>> {
    let scale = |v: &Value| match v.get("scale") {
        None => Some(2),
        Some(s) => u8::try_from(s.as_u64()?).ok().filter(|s| *s >= 1),
    };
    match event.get("type").and_then(Value::as_str) {
        Some("key") => {
            let key = event.get("key").and_then(Value::as_str)?;
            let mods: Vec<&str> = (event.get("mods").and_then(Value::as_array).into_iter())
                .flatten()
                .filter_map(Value::as_str)
                .collect();
            let chord = key.eq_ignore_ascii_case("c")
                && mods.contains(&"cmd")
                && mods.contains(&"shift")
                && !mods.contains(&"alt");
            chord.then_some(Some(Action::Clip {
                seconds: 10,
                scale: 2,
            }))
        }
        Some("action") => Some(match event.get("action").and_then(Value::as_str) {
            Some("save_clip") => (|| {
                let seconds = match event.get("seconds") {
                    None => 10,
                    Some(s) => s.as_i64().filter(|s| (1..=MOST_SECONDS).contains(s))?,
                };
                Some(Action::Clip {
                    seconds,
                    scale: scale(event)?,
                })
            })(),
            Some("save_still") => scale(event).map(|scale| Action::Still { scale }),
            _ => None,
        }),
        _ => None,
    }
}

/// What the app keeps of a piece playing live: its logic stepped on the scenario's clock, the
/// track's entries fed to it as they arrive, its checkpoints (the logic module's ring), and each
/// step's state hashed by field since the checkpoint a 60 s clip would restore.
pub(crate) struct Live {
    world: World,
    /// The finest step among the piece's logic items, in flicks.
    step: i64,
    /// The hub track's entries fed so far, and its fork when they were.
    fed: usize,
    fork_at: Option<i64>,
    /// Each step's state after it ran, `(field, hash)` in the logic module's canonical order.
    hashes: VecDeque<(i64, Vec<(String, u64)>)>,
}

/// The cards and what a clip draws through.
#[derive(Default)]
pub(crate) struct Clips {
    live: BTreeMap<String, Live>,
    /// Each panel's cards, in the order its actions ran.
    cards: BTreeMap<String, Vec<Value>>,
    reader: Option<Reader>,
}

/// The finest step among `doc`'s logic items, in flicks: a piece that plays live presents a
/// frame at each of its steps; `None` for a document with no logic item.
pub(crate) fn step_of(doc: &Value) -> Option<i64> {
    (doc.get("items")?.as_object()?.values())
        .filter(|i| i["kind"] == deep_logic::module::INTERFACE)
        .filter_map(|i| i.pointer("/params/step_rate")?.as_i64().filter(|r| *r > 0))
        .map(|r| FLICKS / r)
        .min()
}

/// The first field two steps' hashes differ in.
fn first_field(a: &[(String, u64)], b: &[(String, u64)]) -> Option<String> {
    a.iter()
        .zip(b)
        .find(|(x, y)| x != y)
        .map(|(x, _)| x.0.clone())
        .or_else(|| (a.len() != b.len()).then(|| "state".to_string()))
}

/// A file written whole: under a temporary name beside `path`, then renamed.
fn write_whole(path: &Path, bytes: &[u8]) -> Result<(), Value> {
    let temp = path.with_file_name(format!(
        ".{}.part",
        path.file_name().and_then(|n| n.to_str()).unwrap_or("clip")
    ));
    let unwritable = |e: std::io::Error| json!({"code": "export_unwritable", "why": e.to_string()});
    std::fs::write(&temp, bytes).map_err(unwritable)?;
    std::fs::rename(&temp, path).map_err(|e| {
        let _ = std::fs::remove_file(&temp);
        unwritable(e)
    })
}

impl Hub<'_> {
    /// The piece's exports folder: `<state>/exports/<doc ID>/`, made when first written.
    fn exports_dir(&self, doc: &str) -> Result<PathBuf, Value> {
        let state = (self.scenario.state.clone()).ok_or_else(
            || json!({"code": "no_state", "why": "the app has no state folder to keep exports in"}),
        )?;
        let dir = state.join("exports").join(doc);
        std::fs::create_dir_all(&dir)
            .map_err(|e| json!({"code": "export_unwritable", "why": e.to_string()}))?;
        Ok(dir)
    }

    /// `doc`'s live play, stepped to now: begun at its start, or again where its track was
    /// loaded or forked; the entries since the last feed fed in, then every step before now run,
    /// each one's state hashed by field.
    pub(crate) fn live_play(&mut self, doc: &str) -> Result<&mut Live, Value> {
        let (len, fork) = (self.tracks.get(doc)).map_or((0, None), |t| (t.len(), t.fork_at));
        let again = match self.clips.live.get(doc) {
            Some(l) => len < l.fed || fork != l.fork_at,
            None => true,
        };
        if again {
            let form = self
                .current(doc)
                .map(|r| r.doc.clone())
                .ok_or_else(|| json!({"code": "not_presented"}))?;
            let step = step_of(&form).ok_or_else(|| json!({"code": "not_a_piece", "why": "the document has no logic item that plays"}))?;
            let piece = self
                .logic_piece(&form, &[])
                .map_err(|i| json!({"code": i.code, "issues": [i.to_json()]}))?
                .ok_or_else(|| json!({"code": "not_a_piece"}))?;
            let planted = self.scenario.logic_planted.unwrap_or_default();
            let mut rec = Record::default();
            let world = World::new(Rc::new(piece), track_of(&[]), true, planted, &mut rec, None)?;
            let live = Live {
                world,
                step,
                fed: 0,
                fork_at: fork,
                hashes: VecDeque::new(),
            };
            self.clips.live.insert(doc.to_string(), live);
        }
        let now = self.now;
        let new: Vec<Value> = (self.tracks.get(doc).into_iter())
            .flat_map(|t| {
                let fed = self.clips.live.get(doc).map_or(0, |l| l.fed);
                (fed..t.len()).filter_map(move |i| t.get(i))
            })
            .map(|e| e.to_json())
            .filter(|e| e.get("present").is_none() && e.get("rewind").is_none())
            .collect();
        let live = self.clips.live.get_mut(doc).expect("made above");
        for e in &new {
            if let Some(e) = Entry::parse(e) {
                live.world.append(e)?;
            }
        }
        live.fed = len;
        // Every step before now: an entry stamped now is read by the step at now, still to run.
        while let Some(k) = live.world.at() {
            if k * live.step > now - 1 {
                break;
            }
            let mut rec = Record::default();
            live.world.run_through(k * live.step, &mut rec);
            live.hashes.push_back((k, live.world.field_hashes()));
        }
        // The hashes a clip can need: from the checkpoint a 60 s clip's replica restores.
        let oldest = (now - (MOST_SECONDS + 1) * FLICKS).max(0) / live.step;
        let keep = live.world.nearest(oldest).unwrap_or(0);
        while live.hashes.front().is_some_and(|(k, _)| *k < keep) {
            live.hashes.pop_front();
        }
        Ok(live)
    }

    /// The replica of `doc`'s play over `[from, to)`: the nearest checkpoint at or before `from`
    /// restored, the track replayed to where the live play stands; `Err` with the first step,
    /// module and field whose state differs from the live play's, as a desync is named.
    fn replica(&mut self, doc: &str, from: i64) -> Result<(), Value> {
        let live = self.live_play(doc)?;
        let c = (live.world.nearest(from / live.step))
            .ok_or_else(|| json!({"code": "no_checkpoint", "step": from / live.step}))?;
        let mut replica = live.world.restore(c, None)?;
        let end = live.world.at().unwrap_or(c);
        let first = live.hashes.front().map_or(c, |(k, _)| *k);
        for k in c..end {
            let mut rec = Record::default();
            replica.run_through(k * live.step, &mut rec);
            let mine = replica.field_hashes();
            let theirs = usize::try_from(k - first)
                .ok()
                .and_then(|i| live.hashes.get(i))
                .map(|(_, h)| h.as_slice())
                .unwrap_or_default();
            if let Some(field) = first_field(theirs, &mine) {
                return Err(json!({"first_step": k, "module": "logic", "field": field}));
            }
        }
        // And the full-state hash where both stand.
        if replica.deep_hashes() != live.world.deep_hashes() {
            return Err(
                json!({"first_step": end - 1, "module": "logic", "field": "state", "restored": c}),
            );
        }
        Ok(())
    }

    /// `doc`'s form as the export path draws it on `track`: the track inlined, the tour, tables,
    /// imported outlines and each logic item's bake from it, and the core's column view.
    pub(crate) fn clip_form(&self, mut doc: Value, track: &[Value]) -> Result<Value, Value> {
        doc = crate::played::with_track(&doc, track);
        crate::tour::inline(&mut doc);
        let _ = self.inline_tables(&mut doc);
        let _ = self.inline_vectors(&mut doc);
        self.inline_occurrences(&mut doc, track)
            .map_err(|i| json!({"code": i.code, "issues": [i.to_json()]}))?;
        let _ = self.column_view(&mut doc, 0);
        Ok(doc)
    }

    /// The indexed basis `doc`'s look draws on, its palette in index order; `None` on any other.
    pub(crate) fn indexed_of(&self, doc: &Value) -> Option<Indexed> {
        let def = self.look_def_of(doc)?;
        let look = self.look_of(doc)?;
        deep_canvas_marks::print::indexed(&def, &look.light).ok()?
    }

    /// The index target `ix` draws `doc` into at each of `times`, as the export path's session
    /// evaluates it, through the operator `film2d` draws with (#464).
    pub(crate) fn index_frames(
        &mut self,
        doc: &Value,
        times: &[i64],
        ix: &Indexed,
    ) -> Result<Vec<Vec<u8>>, Value> {
        let gone =
            || json!({"code": "gpu_unavailable", "why": "no GPU to draw the index target on"});
        let device = self.gpu3().map(|g| g.device().clone()).ok_or_else(gone)?;
        let items: Map<String, Value> = doc
            .get("items")
            .and_then(Value::as_object)
            .cloned()
            .unwrap_or_default();
        // Under the document's own look: the hub's is the last presented document's.
        let own = self.look_of(doc);
        let (look, def) = (self.look.clone(), self.look_def.clone());
        if let Some(own) = own {
            self.look = own;
            self.look_def = self.look_def_of(doc);
        }
        let out = self.index_frames_in(doc, times, ix, &device, &items);
        (self.look, self.look_def) = (look, def);
        out
    }

    fn index_frames_in(
        &mut self,
        doc: &Value,
        times: &[i64],
        ix: &Indexed,
        device: &std::sync::Arc<deep_gpu::device::Device>,
        items: &Map<String, Value>,
    ) -> Result<Vec<Vec<u8>>, Value> {
        let mut sched = Scheduler::new(&self.startup.sealed, self.options());
        let mut session: DocSession = self.new_session();
        session.load(&mut sched, doc);
        let mut out = Vec::with_capacity(times.len());
        for &t in times {
            crate::played::load_at(&mut sched, &mut session, doc, t);
            session.frame(&mut sched, t, &default_view(doc));
            let painted = crate::frames::drawing_of(&sched, &session)
                .ok_or_else(|| json!({"code": "no_drawing", "t": t}))?;
            let marks: Vec<_> = (painted.drawing.iter())
                .flat_map(|d| d.frame.layers.iter().flat_map(|l| l.marks.iter().cloned()))
                .collect();
            let reader = self
                .clips
                .reader
                .get_or_insert_with(|| Reader::new(&device.device));
            let indices = reader
                .indices(device, ix, &marks, items)
                .map_err(|why| json!({"code": "not_drawn", "t": t, "why": why}))?;
            out.push(indices);
        }
        Ok(out)
    }

    /// `presented`'s frames from `from` on, each with its index target as the live play drew
    /// it, kept in the evidence store by its SHA-256; a piece on any other look has none.
    pub(crate) fn presented_indices(&mut self, panel: &str, from: i64) -> Value {
        let mut reply = self.presented(panel);
        let Some(doc) = self.panel_doc(panel) else {
            return reply;
        };
        let Some(rev) = self.current(&doc).map(|r| r.doc.clone()) else {
            return reply;
        };
        let Some(ix) = self.indexed_of(&rev) else {
            return reply;
        };
        let times: Vec<i64> = (reply["frames"].as_array().into_iter().flatten())
            .filter_map(|f| f["t"].as_i64())
            .filter(|t| *t >= from)
            .collect();
        let track = self.track_json(&doc);
        let (rev, _) = self.drawing_form(&rev);
        let drawn = self
            .clip_form(rev, &track)
            .and_then(|form| self.index_frames(&form, &times, &ix));
        let frames = match drawn {
            Ok(f) => f,
            Err(e) => return e,
        };
        let mut shas = Vec::with_capacity(frames.len());
        for f in &frames {
            match crate::evidence::put(&self.scenario.evidence, f) {
                Ok(sha) => shas.push(sha),
                Err(_) => return json!({"code": "evidence_unwritable"}),
            }
        }
        let mut shas = shas.into_iter();
        for f in (reply["frames"].as_array_mut().into_iter().flatten())
            .filter(|f| f["t"].as_i64().is_some_and(|t| t >= from))
        {
            if let Some(sha) = shas.next() {
                f["indices"] = json!(sha);
            }
        }
        reply
    }

    /// `clips`: a panel's cards, in the order its actions ran.
    pub(crate) fn clips_reply(&self, panel: &str) -> Value {
        json!({"clips": self.clips.cards.get(panel).cloned().unwrap_or_default()})
    }

    /// A player control run in `panel` now: its card, kept for `clips`.
    pub(crate) fn player_action(&mut self, panel: &str, action: &Action) -> Value {
        let started = std::time::Instant::now();
        let at = self.now;
        let mut card = match action {
            Action::Clip { seconds, scale } => self.save_clip(panel, *seconds, *scale),
            Action::Still { scale } => self.save_still(panel, *scale),
        }
        .unwrap_or_else(|why| {
            let mut card = json!({"outcome": "refused"});
            for (k, v) in why.as_object().into_iter().flatten() {
                card[k] = v.clone();
            }
            card
        });
        card["action"] = json!(action.name());
        card["at"] = json!(at);
        if card["outcome"] == "written" {
            card["timing"] = json!({"wall": started.elapsed().as_secs_f64()});
            let file = card["file"].as_str().unwrap_or_default().to_string();
            card["text"] = json!(format!("Saved {file}. Reveal · Copy"));
            card["buttons"] = json!(["Reveal", "Copy"]);
        }
        self.clips
            .cards
            .entry(panel.to_string())
            .or_default()
            .push(card.clone());
        json!({"clip": card})
    }

    /// Save clip: the last `seconds` of the play in `panel`, never before its start, from a
    /// replica that ends where the live play did, written by the export path.
    fn save_clip(&mut self, panel: &str, seconds: i64, scale: u8) -> Result<Value, Value> {
        let doc = self
            .panel_doc(panel)
            .ok_or_else(|| json!({"code": "unknown_panel"}))?;
        let rev = (self.current(&doc).map(|r| r.doc.clone()))
            .ok_or_else(|| json!({"code": "not_presented"}))?;
        let play = (rev.get("transport"))
            .and_then(deep_canvas::document::frame_rate_of)
            .unwrap_or((60, 1));
        let indexed = self.indexed_of(&rev);
        // On an indexed look the frames are taken at the play's rate halved until it is at
        // most 50 a second; otherwise at the play's own.
        let plant = match self.scenario.planted {
            Some(Planted::Clip(p)) => Some(p),
            _ => None,
        };
        let [p, q] = match indexed {
            Some(_) => write::gif_rate([play.0, play.1], plant),
            None => [play.0, play.1],
        };
        let frame = deep_canvas::time::frame_length(p, q)
            .map_err(|why| json!({"code": "bad_rate", "why": why}))?;
        let to = self.now.div_euclid(frame) * frame;
        let from = (to - seconds.min(MOST_SECONDS) * FLICKS)
            .max(0)
            .div_euclid(frame)
            * frame;
        let range = json!([from, to]);
        if to <= from {
            return Err(json!({"code": "empty_range", "range": range}));
        }
        if let Err(d) = self.replica(&doc, from) {
            if d.get("first_step").is_none() {
                return Err(d);
            }
            let text = format!(
                "Not saved: the clip's replay parted from your play at step {}, in module {}, field {} (clip.desync).",
                d["first_step"], d["module"].as_str().unwrap_or(""), d["field"].as_str().unwrap_or("")
            );
            return Err(json!({"code": "clip.desync", "range": range, "desync": d, "text": text}));
        }
        let dir = self.exports_dir(&doc)?;
        let name = format!("clip-{}", to / (FLICKS / 1000));
        let track = self.track_json(&doc);
        let span = Span::Between(EvalTime::Flicks(from), EvalTime::Flicks(to));
        let mut too_large = None;
        if indexed.is_some() {
            let file = dir.join(format!("{name}.gif"));
            let job = Job {
                doc: doc.clone(),
                range: span,
                frame_rate: Some((p, q)),
                codec: "gif".into(),
                out: file.to_string_lossy().into_owned(),
                track: track.clone(),
                gif: json!({"scale": scale}),
                ..Job::default()
            };
            let reply = self.export_run(&job);
            match reply["outcome"].as_str() {
                Some("exported") => {
                    return Ok(json!({"outcome": "written", "format": "gif", "file": file,
                        "range": range, "receipt": reply["receipt"]}))
                }
                _ if reply["code"] == "gif_too_large" => too_large = Some(reply),
                _ => return Err(reply),
            }
        }
        // The encode job's MP4, with the piece's sound, at the play's rate.
        let file = dir.join(format!("{name}.mp4"));
        let job = Job {
            doc: doc.clone(),
            range: Span::Between(EvalTime::Flicks(from), EvalTime::Flicks(to)),
            codec: "h264".into(),
            out: file.to_string_lossy().into_owned(),
            track,
            ..Job::default()
        };
        let reply = self.export_run(&job);
        if reply["outcome"] != "exported" {
            return Err(reply);
        }
        let mut card = json!({"outcome": "written", "format": "mp4", "file": file, "range": range,
            "receipt": reply["receipt"]});
        if let Some(big) = too_large {
            card["code"] = json!("clip.too_large");
            card["why"] = json!(format!(
                "the GIF would be {} bytes, over 32 MiB, so it was written as an MP4",
                big["bytes"]
            ));
        }
        Ok(card)
    }

    /// Save still: the frame on screen in `panel`, the last it presented at or before now, as a
    /// PNG; an indexed one with the look's palette on an indexed look.
    fn save_still(&mut self, panel: &str, scale: u8) -> Result<Value, Value> {
        let doc = self
            .panel_doc(panel)
            .ok_or_else(|| json!({"code": "unknown_panel"}))?;
        let rev = (self.current(&doc).map(|r| r.doc.clone()))
            .ok_or_else(|| json!({"code": "not_presented"}))?;
        let shown = self.presented(panel);
        let t = (shown["frames"].as_array().and_then(|f| f.last()))
            .and_then(|f| f["t"].as_i64())
            .ok_or_else(
                || json!({"code": "not_presented", "why": "the panel has shown no frame"}),
            )?;
        let dir = self.exports_dir(&doc)?;
        let file = dir.join(format!("still-{}.png", t / (FLICKS / 1000)));
        let track = self.track_json(&doc);
        let Some(ix) = self.indexed_of(&rev) else {
            // Any other look: the export path's PNG still of that frame.
            let folder = dir.join(format!(".still-{}", std::process::id()));
            let job = Job {
                doc: doc.clone(),
                range: Span::Still(EvalTime::Flicks(t)),
                codec: "png_seq".into(),
                out: folder.to_string_lossy().into_owned(),
                track,
                ..Job::default()
            };
            let reply = self.export_run(&job);
            let png = (std::fs::read_dir(&folder).into_iter().flatten().flatten())
                .map(|e| e.path())
                .find(|p| p.extension().is_some_and(|x| x == "png"));
            let moved = match (&reply["outcome"], png) {
                (o, Some(png)) if o == "exported" => std::fs::rename(png, &file).is_ok(),
                _ => false,
            };
            let _ = std::fs::remove_dir_all(&folder);
            if !moved {
                return Err(reply);
            }
            return Ok(json!({"outcome": "written", "format": "png", "file": file, "t": t}));
        };
        let (rev, _) = self.drawing_form(&rev);
        let form = self.clip_form(rev, &track)?;
        let frames = self.index_frames(&form, &[t], &ix)?;
        let palette: Vec<[u8; 3]> = ix.palette.iter().map(|(_, c)| *c).collect();
        let size = ix.size.map(|v| v as usize);
        let png = write::indexed_png(&frames[0], size, usize::from(scale), &palette)
            .map_err(|why| json!({"code": "not_drawn", "why": why}))?;
        write_whole(&file, &png)?;
        Ok(json!({"outcome": "written", "format": "png", "file": file, "t": t}))
    }

    /// The export path's GIF of an indexed look (`video.codec: gif`, `gif: {scale}`): each frame
    /// of the range at the job's rate drawn into the index target from the track, the look's
    /// palette as the global color table in index order, each index drawn as `scale` × `scale`
    /// pixels, delays in hundredths with the remainder carried; never quantized again. Over
    /// 32 MiB it writes nothing (`gif_too_large`). Written under a temporary name, then renamed.
    pub(crate) fn export_gif(&mut self, job: &Job, doc: &Value) -> Result<Value, Value> {
        let started = std::time::Instant::now();
        let ix = self.indexed_of(doc).ok_or_else(|| {
            json!({"code": "gif_needs_indexed", "why": "a GIF is written only from an indexed look's index target, never quantized"})
        })?;
        let (p, q) = job
            .frame_rate
            .or_else(|| {
                doc.get("transport")
                    .and_then(deep_canvas::document::frame_rate_of)
            })
            .unwrap_or((60, 1));
        let frame = deep_canvas::time::frame_length(p, q)
            .map_err(|why| json!({"code": "bad_rate", "why": why}))?;
        let Span::Between(a, b) = &job.range else {
            return Err(json!({"code": "range_unbuilt", "why": "a GIF takes a range [in, out]"}));
        };
        let resolve = |hub: &Hub, t: &EvalTime| {
            hub.resolve_time(&job.doc, t)
                .map_err(|c| json!({"code": c}))
        };
        let (a, b) = (resolve(self, a)?, resolve(self, b)?);
        if a.rem_euclid(frame) != 0 || b.rem_euclid(frame) != 0 || b <= a {
            return Err(json!({"code": "not_whole_frames", "range": [a, b], "frame": frame}));
        }
        let times: Vec<i64> = (a / frame..b / frame).map(|k| k * frame).collect();
        let form = self.clip_form(doc.clone(), &job.track)?;
        let frames = self.index_frames(&form, &times, &ix)?;
        let scale = (job.gif.get("scale").and_then(Value::as_u64)).map_or(2, |s| s.max(1) as usize);
        let plant = match self.scenario.planted {
            Some(Planted::Clip(p)) => Some(p),
            _ => None,
        };
        let palette: Vec<[u8; 3]> = ix.palette.iter().map(|(_, c)| *c).collect();
        let delays = write::delays(frames.len(), [p, q]);
        let frames: Vec<std::borrow::Cow<'_, [u8]>> =
            frames.iter().map(|f| f.as_slice().into()).collect();
        let size = ix.size.map(|v| v as usize);
        let bytes = write::gif(&frames, size, scale, &palette, &delays, plant)
            .map_err(|why| json!({"code": "not_drawn", "why": why}))?;
        if bytes.len() > GIF_MOST_BYTES {
            return Err(json!({"code": "gif_too_large", "bytes": bytes.len()}));
        }
        write_whole(Path::new(&job.out), &bytes)?;
        use sha2::Digest as _;
        Ok(
            json!({"frames": frames.len(), "size": [size[0] * scale, size[1] * scale],
            "frame_rate": [p, q], "delays": delays.iter().map(|d| u32::from(*d)).sum::<u32>(),
            "bytes": bytes.len(), "sha256": hex(&sha2::Sha256::digest(&bytes)),
            "palette": palette.len(), "encoder": {"name": "gif", "writer": "deep-show"},
            "timing": {"wall": started.elapsed().as_secs_f64()}}),
        )
    }
}

fn hex(b: &[u8]) -> String {
    b.iter().map(|x| format!("{x:02x}")).collect()
}

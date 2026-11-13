//! Frame history in `view3d` (#173; tests/acceptance/173/README.md: Assumed surfaces): the
//! call's frame cap, stalls, scrubs and your hand's orbit; and, per frame, the window's plan, its
//! grid frames drawn through the session (each at its own step, jittered by it, into its layer;
//! the frame at t resolving the window into the slot) and the frame's report.

use std::sync::Arc;

use deep_canvas::camera::Offsets;
use deep_canvas_scene3d::history::{
    self as rules, Entry, Grid, History, Mode, Move, Plan, Schedule,
};
use deep_canvas_scene3d::look::Look3;
use deep_canvas_scene3d::scene::Scene;
use deep_scene3d_render::history::Frame;
use deep_scene3d_render::surface::Surface;
use serde_json::{json, Value};

use crate::session3::{self, Drawn, Opened};
use crate::{refused, App, Planted};

/// The scene at a grid step's time, as the session evaluates it.
pub(super) type FrameAt<'a> = dyn FnMut(&mut App, i64) -> Result<Arc<Scene>, Value> + 'a;

/// How a frame was reached.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum Reach {
    Open,
    Next,
    Seek,
    Scrub,
    Release,
}

/// The call's frame-history inputs.
pub(super) struct Inputs {
    /// The view's frame cap; the call's `fps` when it names none.
    cap: Option<u64>,
    /// `(after, ms)`: the display frames a stall misses.
    stalls: Vec<(u64, u64)>,
    /// `(after, through, release)`: a scrub's frames and the one it lets go on.
    scrubs: Vec<(u64, Vec<u64>, u64)>,
    /// `(frame, azimuth°)`: your hand's orbit, from that frame on.
    cameras: Vec<(u64, f64)>,
    /// The determinism check's times, in flicks.
    pub determinism: Option<Vec<i64>>,
    /// Of the frames played, the one alone that draws (the determinism check's played side).
    pub draw_only: Option<u64>,
    /// Each frame reports its 128-bit pixel hash (the determinism check's sides).
    hash128: bool,
}

impl Inputs {
    pub fn cap(&self) -> Option<u64> {
        self.cap
    }

    /// Whether each frame's 128-bit pixel hash is taken: for a side of the determinism check,
    /// and under the planted check that hashes the frames this view shows.
    pub fn hashes(&self, planted: Option<Planted>) -> bool {
        self.hash128
            || self.determinism.is_some() && planted == Some(Planted::DeterminismHashesLiveView)
    }
}

pub(super) fn inputs(call: &Value) -> Result<Inputs, Value> {
    let bad = |what: &str| refused("bad_input", what);
    let list = |key: &str| call[key].as_array().cloned().unwrap_or_default();
    let mut stalls = Vec::new();
    for s in list("stalls") {
        match (s["after"].as_u64(), s["ms"].as_u64()) {
            (Some(after), Some(ms)) => stalls.push((after, ms)),
            _ => return Err(bad("a stall is {after, ms}")),
        }
    }
    let mut scrubs = Vec::new();
    for s in list("scrubs") {
        let through: Option<Vec<u64>> = s["through"]
            .as_array()
            .map(|t| t.iter().filter_map(Value::as_u64).collect());
        match (s["after"].as_u64(), through, s["release"].as_u64()) {
            (Some(after), Some(through), Some(release)) => scrubs.push((after, through, release)),
            _ => return Err(bad("a scrub is {after, through: [frame], release}")),
        }
    }
    let mut cameras = Vec::new();
    for v in list("viewer") {
        if let (Some(frame), Some(c)) = (v["frame"].as_u64(), v.get("camera")) {
            let azimuth = c["azimuth"]
                .as_f64()
                .ok_or_else(|| bad("a viewer's camera is {azimuth: deg}"))?;
            cameras.push((frame, azimuth));
        }
    }
    let determinism = match call.pointer("/determinism/at_times") {
        None => None,
        Some(t) => Some(
            t.as_array()
                .and_then(|t| t.iter().map(Value::as_i64).collect::<Option<Vec<_>>>())
                .ok_or_else(|| bad("determinism.at_times lists times in flicks"))?,
        ),
    };
    Ok(Inputs {
        cap: call["cap"].as_u64().filter(|c| *c > 0),
        stalls,
        scrubs,
        cameras,
        determinism,
        draw_only: call["draw_only"].as_u64(),
        hash128: call["hash128"].as_bool().unwrap_or(false),
    })
}

/// The report of a frame drawn without history: at its own t.
pub(super) fn plain(t: i64) -> Value {
    json!({"mode": "none", "shows": t, "window": [], "rendered": []})
}

/// A frame's 128-bit pixel hash on the GPU (#1897's), as 32 hex digits, of its BGRA `bytes`.
pub(super) fn hash128(app: &mut App, bgra: &[u8], size: [u32; 2]) -> Result<String, Value> {
    use deep_gpu::pixel_hash::{Format, PixelHash};
    let rgba: Vec<u8> = bgra
        .as_chunks::<4>()
        .0
        .iter()
        .flat_map(|p| [p[2], p[1], p[0], p[3]])
        .collect();
    let sums = app.worker.call(move |state| {
        let d = state.gpu.device();
        PixelHash::new(&d.device, Default::default()).sums(
            &d.device,
            &d.queue,
            &rgba,
            size,
            Format::Rgba8,
        )
    });
    Ok(sums.iter().map(|b| format!("{b:02x}")).collect())
}

/// The same-machine determinism check after the call's frames (#173; Determinism): at each of
/// `at_times`, a canonical render played to it (every frame evaluated from 0, that one drawn)
/// against one sought to it (a cold evaluation jumped from a second later), by 128-bit pixel
/// hash. The planted check hashes this view's live frames instead: the one it showed at t
/// against the view jumped to t as it now stands, your hand's turn included.
pub(super) fn determinism(
    app: &mut App,
    out: &str,
    call: &Value,
    at_times: &[i64],
    fps: u64,
    (planted, shown, azimuth): (bool, &std::collections::BTreeMap<u64, String>, f64),
) -> Result<Value, Value> {
    let flicks = super::FLICKS_PER_SECOND as i128;
    let mut rows = Vec::new();
    let mut pass = true;
    for &t in at_times {
        let n = (i128::from(t) * i128::from(fps) / flicks) as u64;
        // This call's document and look; nothing a canonical render never reads.
        let side = |fields: Value| -> Value {
            let mut c = call.clone();
            if let (Some(o), Some(f)) = (c.as_object_mut(), fields.as_object()) {
                for k in [
                    "determinism",
                    "stalls",
                    "scrubs",
                    "capture",
                    "targets",
                    "timings",
                    "seeks",
                    "viewer",
                    "surface",
                    "class",
                    "from",
                    "frames",
                ] {
                    o.remove(k);
                }
                o.insert("hash128".into(), json!(true));
                o.extend(f.clone());
            }
            c
        };
        let seek = json!({"from": n + fps, "frames": 2, "seeks": [{"after": n + fps, "to": n}]});
        let mut hash_of = |c: Value| -> Result<String, Value> {
            let reply = super::run(app, out, &c)?;
            reply["frames"]
                .as_array()
                .and_then(|f| f.iter().rev().find(|f| f["frame"] == n))
                .and_then(|f| f["pixel_hash128"].as_str())
                .map(str::to_string)
                .ok_or_else(|| refused("render_failed", format!("determinism: no frame {n} drawn")))
        };
        let (play, seek) = if planted {
            let mut live = seek;
            live["viewer"] = json!([{"frame": 0, "camera": {"azimuth": azimuth}}]);
            let play = shown.get(&n).cloned();
            (
                play.ok_or_else(|| refused("render_failed", "determinism: frame not shown"))?,
                hash_of(side(live))?,
            )
        } else {
            let mut sought = seek;
            sought["class"] = json!("export");
            sought["draw_only"] = json!(n);
            let played = json!({"class": "export", "from": 0, "frames": n + 1, "draw_only": n});
            (hash_of(side(played))?, hash_of(side(sought))?)
        };
        pass &= play == seek;
        rows.push(json!({"t": t, "play": {"pixel_hash": play}, "seek": {"pixel_hash": seek}}));
    }
    Ok(json!({"result": if pass { "PASS" } else { "FAIL" }, "frames": rows}))
}

/// The frames a call draws, in order, with how each was reached: `frames` of them from `from`,
/// counting the display frames a stall misses (drawn by no one) and a scrub's; each seek jumps
/// once; after a scrub's frames, the one let go on draws and play goes on from it.
pub(super) fn order(
    from: u64,
    frames: u64,
    seeks: &[(u64, u64)],
    inputs: &Inputs,
    fps: u64,
) -> Vec<(u64, Reach)> {
    let mut seeks = seeks.to_vec();
    let mut scrubs = inputs.scrubs.clone();
    let mut budget = frames;
    let mut out = Vec::with_capacity(frames as usize);
    let mut next = (from, Reach::Open);
    while budget > 0 {
        out.push(next);
        budget -= 1;
        let mut last = next.0;
        if let Some(k) = scrubs.iter().position(|s| s.0 == last) {
            let (_, through, release) = scrubs.remove(k);
            for f in through {
                if budget == 0 {
                    return out;
                }
                out.push((f, Reach::Scrub));
                budget -= 1;
            }
            if budget == 0 {
                return out;
            }
            out.push((release, Reach::Release));
            budget -= 1;
            last = release;
        }
        next = match seeks.iter().position(|s| s.0 == last) {
            Some(k) => (seeks.remove(k).1, Reach::Seek),
            None => {
                // The display frames n + k with 1000 k < ms × fps are missed.
                let missed = inputs
                    .stalls
                    .iter()
                    .find(|s| s.0 == last)
                    .map_or(0, |s| {
                        (1..).take_while(|k| 1000 * k < s.1 * fps).count() as u64
                    })
                    .min(budget);
                budget -= missed;
                (last + 1 + missed, Reach::Next)
            }
        };
    }
    out
}

/// Your hand's turn at frame `n`: its entry for `n`, or, at the open, its last before it.
pub(super) fn hand(inputs: &Inputs, n: u64, from: u64, now: f64) -> f64 {
    inputs
        .cameras
        .iter()
        .rfind(|(f, _)| *f == n || (n == from && *f < n))
        .map_or(now, |(_, a)| *a)
}

/// The camera `scene` draws through with your hand's turn `azimuth`: the document's own at 0.
pub(super) fn turn(doc: &Value, scene: &mut Scene, t: i64, azimuth: f64) -> Result<(), Value> {
    if azimuth == 0.0 {
        return Ok(());
    }
    let program =
        deep_canvas_scene3d::frames::Frames::compile(doc).map_err(|r| refused(r.code, r.path))?;
    let offsets = Offsets {
        azimuth,
        ..Offsets::default()
    };
    scene.camera =
        deep_canvas_scene3d::frames::turned_camera(doc, &program, scene, t, scene.size, &offsets)
            .map_err(|r| refused(r.code, r.path))?;
    Ok(())
}

/// A view's frame history over one call.
pub(super) struct Run {
    look: History,
    grid: Grid,
    schedule: Schedule,
    /// Your hand's turn as the last frame drew.
    hand: Option<f64>,
    /// The frame shown, for a display refresh that shows its grid step again.
    last: Option<Drawn>,
    /// The render scale its window's frames drew at, while one has.
    pub drew: Option<f64>,
}

impl Run {
    /// The view's history under `look`, on the grid at its frame `cap` (the display's refresh
    /// under the planted `grid_at_refresh`); `None` when the look keeps none.
    pub fn of(
        look: &Look3,
        cap: Option<u64>,
        fps: u64,
        planted: Option<Planted>,
    ) -> Result<Option<Run>, Value> {
        if !look.history.on() {
            return Ok(None);
        }
        let cap = match planted {
            Some(Planted::GridAtRefresh) => fps,
            _ => cap.unwrap_or(fps),
        };
        let grid =
            Grid::of(&look.history, cap as u32, None, 0).map_err(|e| refused("bad_input", e))?;
        let past = u32::from(planted == Some(Planted::KeepsFramePastWindow));
        Ok(Some(Run {
            look: look.history.clone(),
            grid,
            schedule: Schedule::new(look.history.window, past),
            hand: None,
            last: None,
            drew: None,
        }))
    }

    /// The grid step `k` that shows at `t`, and how the frame there is drawn after `reach`, your
    /// hand at `azimuth`: at rest (`still` says whether the scene at a step draws as the one a
    /// step before does) history drops.
    pub fn plan(
        &mut self,
        t: i64,
        reach: Reach,
        azimuth: f64,
        still: &mut dyn FnMut(i64, i64) -> Result<bool, Value>,
    ) -> Result<(i64, Plan), Value> {
        let k = self.grid.index(t);
        let how = match reach {
            Reach::Scrub => Move::Scrub,
            Reach::Open | Reach::Seek | Reach::Release => Move::Jump,
            Reach::Next if self.hand.is_some_and(|h| h != azimuth) => Move::Hand,
            Reach::Next if still(self.grid.at(k), self.grid.step)? => Move::Rest,
            Reach::Next => Move::Play,
        };
        self.hand = Some(azimuth);
        Ok((k, self.schedule.next(k, how)))
    }

    /// The frame's report: what drew it, the grid time it shows, the window's grid times it
    /// resolved and those it rendered.
    pub fn report(&self, t: i64, k: i64, plan: &Plan) -> Value {
        let at = |es: &mut dyn Iterator<Item = &Entry>| -> Vec<i64> {
            es.map(|e| self.grid.at(e.k)).collect()
        };
        let mode = match self.look.mode {
            Mode::Upscale => "upscale",
            _ => "antialias",
        };
        match plan {
            Plan::Plain => json!({"mode": "none", "shows": t, "window": [], "rendered": []}),
            Plan::Same => {
                json!({"mode": mode, "shows": self.grid.at(k), "window": at(&mut self.schedule.entries()), "rendered": []})
            }
            Plan::Window { render, resolve } => json!({
                "mode": mode, "shows": self.grid.at(k), "window": at(&mut resolve.iter()), "rendered": at(&mut render.iter()),
            }),
        }
    }

    /// Draws a plan that draws through the window: its grid frames in order, each `frame_at`
    /// its own step, the last resolving the window into the slot; the same step again shows
    /// the frame drawn last.
    #[allow(clippy::too_many_arguments)]
    pub fn draw(
        &mut self,
        app: &mut App,
        opened: &Opened,
        look: &Look3,
        n: u64,
        plan: &Plan,
        base: Surface,
        frame_at: &mut FrameAt,
        read: (bool, bool),
    ) -> Result<Drawn, Value> {
        let (render, resolve) = match plan {
            Plan::Window { render, resolve } => (render, resolve),
            _ => {
                return self
                    .last
                    .clone()
                    .ok_or_else(|| refused("render_failed", "no frame drawn to show again"));
            }
        };
        let scale = match self.look.mode {
            Mode::Upscale => self.look.scale,
            _ => base.scale,
        };
        let surface = Surface { scale, ..base };
        let mut drawn = None;
        for (i, e) in render.iter().enumerate() {
            let last = i + 1 == render.len();
            let scene = frame_at(app, self.grid.at(e.k))?;
            let frame = Frame {
                layer: e.layer,
                layers: self.schedule.layers(),
                jitter: rules::jitter(e.k),
                resolve: last.then(|| (self.look.clone(), resolve.clone())),
            };
            session3::history(app, Some(frame), surface, scene.size)?;
            let d = session3::draw(
                app,
                opened,
                scene,
                look.clone(),
                n,
                0,
                last && read.0,
                last && read.1,
            )?;
            if last {
                drawn = Some(d);
            } else {
                // Passed over, so its slot frees for the next.
                let _ = opened.ui.latch();
            }
        }
        session3::history(app, None, base, [0, 0])?;
        let d = drawn.ok_or_else(|| refused("render_failed", "a window plan renders its frame"))?;
        self.drew = Some(scale);
        self.last = Some(d.clone());
        Ok(d)
    }

    /// The upscale its window's frames drew through, `None` while none has: temporal below
    /// scale 1.
    pub fn surface(&self) -> Option<(f64, &'static str)> {
        self.drew
            .map(|s| (s, if s < 1.0 { "temporal" } else { "none" }))
    }
}

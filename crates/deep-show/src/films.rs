//! #466's films in time on the canonical 2D path: the look's boil on each frame's stroked lines,
//! the flicker check's `reseed` rule, and an exposure under the look's quantize and motion blur
//! (canvas primitives: Look `look@1`; Motion blur; Flicker check).

use std::cell::Cell;
use std::sync::Arc;

use deep_canvas::schedule::{Scheduler, Session as DocSession};
use deep_canvas_marks::boil::Boil;
use deep_canvas_motion::shutter;
use serde_json::Value;

use crate::frames::Painted;
use crate::hub::Hub;
use crate::snapshot::Unfit;

/// #466's wrong programs that live in deep-show: a scenario names one in `planted`.
pub const BOIL_IGNORES_CYCLE: &str = "boil_ignores_cycle";
pub const BOIL_FOLLOWS_PLAYBACK: &str = "boil_seed_follows_playback";
pub const BLUR_QUANTIZES_SAMPLES: &str = "blur_quantizes_samples";
pub const REVEAL_AT_UNIT_START: &str = "reveal_emits_at_unit_start";
pub const PLANTED: [&str; 4] = [
    BOIL_IGNORES_CYCLE,
    BOIL_FOLLOWS_PLAYBACK,
    BLUR_QUANTIZES_SAMPLES,
    REVEAL_AT_UNIT_START,
];

thread_local! {
    /// The planted boil's count of frames drawn since the process began playing.
    static DRAWN: Cell<u32> = const { Cell::new(0) };
}

/// A frame's exposure: the look's quantize and its motion blur's shutter and samples.
struct Exposure {
    quantize: Option<(u32, u32)>,
    blur: Option<(i64, u32)>,
}

impl Hub<'_> {
    fn planted_named(&self, name: &str) -> bool {
        self.scenario.module_planted.as_deref() == Some(name)
    }

    /// The occurrence lists `doc`'s revealed texts and built paths emit (`<item>.reveal`,
    /// `<item>.build`), compiled from its motion; none when it has no motion to compile.
    pub(crate) fn reveal_lists(&self, doc: &Value) -> serde_json::Map<String, Value> {
        let Some(map) = doc.as_object() else {
            return serde_json::Map::new();
        };
        let emits = map
            .get("items")
            .and_then(Value::as_object)
            .is_some_and(|i| {
                i.values().any(|i| {
                    i.pointer("/params/reveal/emits") == Some(&Value::Bool(true))
                        || i.pointer("/params/build/emits") == Some(&Value::Bool(true))
                })
            });
        if !emits {
            return serde_json::Map::new();
        }
        let Ok(program) = deep_canvas_motion::program::Program::compile(map) else {
            return serde_json::Map::new();
        };
        let at_start = self.planted_named(REVEAL_AT_UNIT_START);
        let mut lists = deep_canvas_motion::emits::reveal_lists(map, &program, at_start);
        lists.extend(deep_canvas_motion::emits::build_lists(map, &program));
        lists
    }

    /// `form` with its revealed texts' lists baked into `occurrences`, as Spawn reads a list.
    pub(crate) fn inline_reveals(&self, form: &mut Value) {
        let lists = self.reveal_lists(form);
        if lists.is_empty() {
            return;
        }
        if let Some(doc) = form.as_object_mut() {
            let occ = doc
                .entry("occurrences")
                .or_insert_with(|| Value::Object(serde_json::Map::new()));
            if let Some(occ) = occ.as_object_mut() {
                occ.extend(lists);
            }
        }
    }

    /// The look's boil for `doc`, when its look defines one.
    fn boil_of(&self, doc: &Value) -> Option<Boil> {
        let def = self.look_def_of(doc)?;
        let seed = doc.get("seed").and_then(Value::as_u64).unwrap_or(0);
        let mut b = deep_canvas_marks::boil::read(&def, seed).ok().flatten()?;
        if self.planted_named(BOIL_IGNORES_CYCLE) {
            b.cycle = 0;
        }
        Some(b)
    }

    /// Whether `doc`'s look boils.
    pub(crate) fn has_boil(&self, doc: &Value) -> bool {
        self.boil_of(doc).is_some()
    }

    /// `painted` at `t` with the look's boil on its stroked lines: drawing ⌊t × hz⌋ mod cycle,
    /// held under reduced motion.
    pub(crate) fn boiled(
        &self,
        doc: &Value,
        t: i64,
        reduced: bool,
        mut painted: Painted,
    ) -> Painted {
        let Some(boil) = self.boil_of(doc) else {
            return painted;
        };
        let k = if self.planted_named(BOIL_FOLLOWS_PLAYBACK) {
            DRAWN.with(|d| {
                let k = d.get();
                d.set(k + 1);
                k
            })
        } else {
            boil.drawing(t, reduced)
        };
        if let Some(d) = painted.drawing.as_mut() {
            let mut frame = d.frame.clone();
            boil.frame(&mut frame, k);
            *d = Arc::new(deep_canvas_marks::modules::Drawing {
                frame,
                runs: d.runs.clone(),
                animated: d.animated.clone(),
                built: d.built,
                damage: Vec::new(),
                basis: None,
            });
        }
        painted
    }

    /// The flicker check's `reseed` rule (Flicker check): the frames `sample` of `drawn`, drawn
    /// again cold after it played, at `px`; the first whose luminance differs from its played
    /// frame's, or `None`. A boil, paper or fill seeded by time and IDs draws the same.
    pub(crate) fn reseeded(
        &mut self,
        drawn: &Value,
        played: &[Vec<f32>],
        times: &[i64],
        px: [u16; 2],
        reduced: bool,
    ) -> Option<usize> {
        let n = played.len();
        let sample = [n / 3, n / 2, n.saturating_sub(1)];
        for &k in sample.iter().filter(|&&k| k < n) {
            let t = times[k];
            let session = self.evaluated(drawn, t);
            let Some(painted) = crate::frames::drawing_of(&self.sched, &session) else {
                continue;
            };
            let painted = self.boiled(drawn, t, reduced, painted);
            let program = crate::film::program_of(&self.sched, &session);
            let sides = program
                .as_deref()
                .and_then(|p| crate::film::sides(p, drawn, t, reduced));
            let rgba = match &sides {
                Some(s) => self
                    .film_rgba(&painted, Some(px), s, drawn, (true, None))
                    .map(|r| r.0),
                None => self.canonical_rgba(&painted, Some(px), true).map(|r| r.0),
            };
            let Ok(rgba) = rgba else { continue };
            let lit: Vec<f32> = rgba
                .as_chunks::<4>()
                .0
                .iter()
                .map(|c| deep_canvas::film_audit::luminance(c[0], c[1], c[2]))
                .collect();
            if lit != played[k] {
                return Some(k);
            }
        }
        None
    }

    /// The look's quantize and motion blur, for a 2D film that has either.
    fn exposure_of(&self, doc: &Value, rate: (u32, u32)) -> Option<Exposure> {
        let def = self.look_def_of(doc)?;
        let quantize = def
            .as_object()
            .and_then(|d| deep_canvas_motion::doc::feel_of(d, rate).ok())
            .and_then(|f| f.quantize);
        let blur = deep_canvas_scene3d::samples::read_blur(&def)
            .ok()
            .flatten()
            .filter(|b| b.samples > 1)
            .map(|b| (shutter::shutter(b.shutter_angle, rate), b.samples));
        (quantize.is_some() || blur.is_some()).then_some(Exposure { quantize, blur })
    }

    /// The export frame at `t` under the look's exposure (Motion blur): its samples at the frame's
    /// time after the look's quantize, each with its shutter offset after that quantize, averaged
    /// in linear light; one frame drawn at `t` when the look has neither.
    #[allow(clippy::too_many_arguments)]
    pub(crate) fn exposed_frame(
        &mut self,
        sched: &mut Scheduler<'_>,
        session: &mut DocSession,
        doc: &Value,
        t: i64,
        size: Option<[u16; 2]>,
        opaque: bool,
    ) -> Result<(Vec<u8>, [u16; 2]), Unfit> {
        let rate = crate::film::program_of(sched, session).map(|p| p.motion.frame_rate);
        let exposure = rate.and_then(|r| self.exposure_of(doc, r));
        let Some(e) = exposure.filter(|_| !deep_canvas_scene3d::scene::has_3d(doc)) else {
            return self.export_frame(sched, session, doc, t, size, opaque);
        };
        let (shutter, samples) = e.blur.unwrap_or((0, 1));
        let requantize = self.planted_named(BLUR_QUANTIZES_SAMPLES);
        let times = shutter::times(t, e.quantize, shutter, samples, requantize);
        let mut frames = Vec::with_capacity(times.len());
        let mut out_size = size.unwrap_or([0, 0]);
        for at in times {
            let (rgba, s) = self.export_frame(sched, session, doc, at.max(0), size, opaque)?;
            out_size = s;
            frames.push(rgba);
        }
        Ok((shutter::average(&frames), out_size))
    }
}

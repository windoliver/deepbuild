//! #553: a match copy's media module (canvas primitives: Net: rollback; Spawn; Sound and video on
//! the picture's clock). Its spawns start a voice from each occurrence its logic items make, live,
//! as the copy runs their steps, and its audio thread renders the output on the copy's clock in
//! 128-sample blocks, each sample once and in order, a block behind the steps it sounds. Media
//! keeps no rollback ring and no full-state hash covers it, so a rollback never restores sound,
//! which plays on from the corrected steps: a voice whose occurrence the corrected run makes again
//! is the same voice and plays on, and one whose occurrence it doesn't fades out over 5 ms from the
//! first sample not yet rendered.

use std::collections::BTreeMap;
use std::sync::Arc;

use deep_canvas_media::mix::{Bus, Curve, Fade, Mix, Planted as MixPlanted, Player, Source, Strip};
use deep_canvas_media::FLICKS;
use deep_net::{Defect, Planted, Stepper};
use serde_json::{json, Map, Value};

use crate::hub::Hub;

/// One audio block.
const BLOCK: i64 = 128;
/// A dropped voice's fade-out.
const FADE: i64 = FLICKS / 200;

/// What a copy's media module plays from: the drawn form with its spawns, and their sources
/// decoded.
#[derive(Clone)]
pub struct MediaSpec {
    pub form: Value,
    pub sources: BTreeMap<String, Arc<Source>>,
    pub rate: i64,
}

impl MediaSpec {
    /// The lists the form's spawns read; none when it has no spawn.
    fn lists(&self) -> Vec<String> {
        let spawns = self.form["spawns"].as_object().into_iter().flatten();
        spawns
            .filter_map(|(_, s)| s["on"]["list"].as_str().map(str::to_string))
            .collect()
    }
}

impl Hub<'_> {
    /// The media module a copy of `doc`'s match plays: its drawn form's spawns and every asset they
    /// name, decoded; none when it has no spawn.
    pub(crate) fn match_media(&mut self, doc: &str) -> Option<MediaSpec> {
        let form = self.forms.get(doc)?.clone();
        let spawns = form
            .get("spawns")
            .filter(|s| s.as_object().is_some_and(|o| !o.is_empty()))?;
        let mut shas = Vec::new();
        named(spawns, &mut shas);
        let sources = (shas.into_iter())
            .filter_map(|sha| Some((sha.clone(), self.source(&sha).ok()?)))
            .collect();
        let rate = form["transport"]["sample_rate"].as_i64().unwrap_or(48_000);
        Some(MediaSpec {
            form,
            sources,
            rate,
        })
    }
}

/// Every asset hash `v` names (64 lower-case hex digits).
fn named(v: &Value, out: &mut Vec<String>) {
    match v {
        Value::String(s) if s.len() == 64 && s.bytes().all(|b| b.is_ascii_hexdigit()) => {
            out.push(s.clone())
        }
        Value::Array(a) => a.iter().for_each(|x| named(x, out)),
        Value::Object(o) => o.values().for_each(|x| named(x, out)),
        _ => {}
    }
}

/// A voice a spawn started from an occurrence.
#[derive(Clone)]
struct Voice {
    /// The spawn and the occurrence row, as the copy's logic made it.
    key: String,
    spawn: String,
    row: Value,
    /// The output sample it began at, and the samples it faded over.
    start: i64,
    faded: Option<(i64, i64)>,
    strip: Strip,
    /// Its occurrence's step was replaced and the corrected run hasn't made it again yet.
    unsure: bool,
}

struct Media {
    spec: MediaSpec,
    lists: Vec<String>,
    player: Player,
    /// Output samples rendered, the samples a strip renders ahead of the output, and each block.
    head: i64,
    lead: i64,
    blocks: Vec<(i64, i64)>,
    out: Vec<f32>,
    voices: Vec<Voice>,
    /// The strips changed since the player last took them.
    dirty: bool,
    /// The end of the last step run, in flicks after the match's start.
    ran_to: i64,
    /// The planted module's own checkpoints: the head and how many voices it had, by step.
    kept: BTreeMap<i64, (i64, usize)>,
}

impl Media {
    fn new(spec: MediaSpec) -> Media {
        let master = Bus {
            id: "master".into(),
            gain_db: 0.0,
            pan: 0.0,
            mute: false,
            processors: Vec::new(),
            out: None,
            sends: Vec::new(),
            duck: None,
        };
        let mix = Mix::new(spec.rate, Vec::new(), vec![master]).expect("a bare master mixes");
        let mut player = Player::new(Arc::new(mix), MixPlanted::default());
        player.seek(0);
        let lead = player.ahead() - BLOCK;
        Media {
            lists: spec.lists(),
            spec,
            player,
            head: 0,
            lead,
            blocks: Vec::new(),
            out: Vec::new(),
            voices: Vec::new(),
            dirty: false,
            ran_to: 0,
            kept: BTreeMap::new(),
        }
    }

    fn per_sample(&self) -> i64 {
        FLICKS / self.spec.rate
    }

    /// The voices the spawns plan over the occurrence lists as `rows` hold them, as a live play
    /// plans them (#525): each with its spawn, its row and its strip.
    fn planned(&self, rows: &[Value]) -> Vec<(String, Value, Strip)> {
        let mut lists = Map::new();
        for l in &self.lists {
            lists.insert(l.clone(), json!([]));
        }
        let mut sorted: Vec<&Value> = rows.iter().collect();
        sorted.sort_by_key(|r| r["t"].as_i64().unwrap_or(0));
        for r in sorted {
            let list = format!("{}.occurrences", r["item"].as_str().unwrap_or_default());
            if let Some(Value::Array(a)) = lists.get_mut(&list) {
                a.push(r.clone());
            }
        }
        let mut d = self.spec.form.clone();
        d["occurrences"] = Value::Object(lists);
        let sources = &self.spec.sources;
        let mut source = |sha: &str| {
            (sources.get(sha).cloned())
                .ok_or_else(|| json!({"code": "unknown_asset", "asset": sha}))
        };
        let Ok((strips, info)) = Hub::voices(&d, 0, None, &mut source) else {
            return Vec::new();
        };
        (info.iter().zip(strips))
            .filter_map(|(v, strip)| {
                let spawn = v["spawn"].as_str()?.to_string();
                let list = d["spawns"][&spawn]["on"]["list"].as_str()?;
                let k = v["occurrence"].as_u64()? as usize;
                let row = d["occurrences"][list].get(k)?.clone();
                Some((spawn, row, strip))
            })
            .collect()
    }

    /// Step `step` ran to `until` flicks, leaving the occurrence rows `rows`: each voice of that
    /// step's occurrences a replaced step made again plays on, and each new one starts, never
    /// before the first sample a strip hasn't rendered yet.
    fn ran(&mut self, step: i64, until: i64, rows: &[Value]) {
        self.ran_to = self.ran_to.max(until);
        if !rows.iter().any(|r| r["step"].as_i64() == Some(step)) {
            return;
        }
        let first = (self.head + self.lead) * self.per_sample();
        for (spawn, row, mut strip) in self.planned(rows) {
            if row["step"].as_i64() != Some(step) {
                continue;
            }
            {
                let key = format!("{spawn} {row}");
                if let Some(v) = self.voices.iter_mut().find(|v| v.key == key) {
                    v.unsure = false;
                    continue;
                }
                strip.start = strip.start.max(first);
                let start = strip.start / self.per_sample();
                self.voices.push(Voice {
                    key,
                    spawn,
                    row: row.clone(),
                    start,
                    faded: None,
                    strip,
                    unsure: false,
                });
                self.dirty = true;
            }
        }
    }

    /// A rollback to `step`: the voices of the steps it replaces wait to be made again; the planted
    /// module restores its own checkpoint there.
    fn back(&mut self, step: i64, restores: bool) {
        for v in &mut self.voices {
            if v.row["step"].as_i64().is_some_and(|k| k >= step) && v.faded.is_none() {
                v.unsure = true;
            }
        }
        if let (true, Some((head, n))) = (restores, self.kept.get(&step).copied()) {
            self.head = head;
            self.voices.truncate(n);
            self.player.seek(head);
            self.dirty = true;
            self.kept.retain(|k, _| *k < step);
        }
    }

    /// Each voice the corrected run didn't make again fades out over 5 ms from the first sample a
    /// strip hasn't rendered; one that never sounded is dropped.
    fn settle(&mut self) {
        let from = self.head + self.lead;
        let n = FADE / self.per_sample();
        let at = from * self.per_sample();
        self.voices.retain(|v| !(v.unsure && v.start >= from));
        for v in self.voices.iter_mut().filter(|v| v.unsure) {
            v.unsure = false;
            if v.strip.start + v.strip.span <= at {
                continue;
            }
            v.strip.span = at + FADE - v.strip.start;
            v.strip.fade_out = Some(Fade {
                length: FADE,
                curve: Curve::Linear,
            });
            v.faded = Some((from, from + n));
            self.dirty = true;
        }
    }

    /// The audio thread renders up to `t` flicks after the match's start, a block behind the last
    /// step run, in whole blocks.
    fn render(&mut self, t: i64) {
        self.settle();
        if std::mem::take(&mut self.dirty) {
            let strips = self.voices.iter().map(|v| v.strip.clone()).collect();
            self.player.set_added(strips);
        }
        let upto = t.min(self.ran_to) / self.per_sample() - self.lead - BLOCK;
        let mut buf = vec![0f32; 2 * BLOCK as usize];
        while self.head + BLOCK <= upto {
            self.player.read(&mut buf);
            self.out.extend_from_slice(&buf);
            self.blocks.push((self.head, BLOCK));
            self.head += BLOCK;
        }
    }

    /// Its state as the planted full-state hash covers it: each voice and the write head.
    fn digest(&self) -> u64 {
        let mut h: u64 = 0xcbf2_9ce4_8422_2325;
        let mut eat = |b: &[u8]| {
            for x in b {
                h = (h ^ u64::from(*x)).wrapping_mul(0x0100_0000_01b3);
            }
        };
        eat(&self.head.to_le_bytes());
        for v in &self.voices {
            eat(v.key.as_bytes());
            eat(&v.start.to_le_bytes());
            eat(format!("{:?}", v.faded).as_bytes());
        }
        h
    }
}

/// A copy's canvas modules: logic and its worlds (`inner`), and the media module beside them.
pub struct Voiced<S> {
    pub inner: S,
    media: Option<Media>,
    planted: Planted,
}

impl<S> Voiced<S> {
    /// `inner` with the media module `spec` plays, if the piece has spawns; `planted`: #553's
    /// wrong media modules.
    pub fn new(inner: S, spec: Option<MediaSpec>, planted: Planted) -> Voiced<S> {
        let media = spec.filter(|s| !s.lists().is_empty()).map(Media::new);
        Voiced {
            inner,
            media,
            planted,
        }
    }

    /// Every voice it started, in start order: `{spawn, step, kind, a, b, start, faded}`.
    pub fn voices(&self) -> Option<Value> {
        let m = self.media.as_ref()?;
        let list: Vec<Value> = (m.voices.iter())
            .map(|v| {
                let faded = v.faded.map(|(from, to)| json!({"from": from, "to": to}));
                json!({"spawn": v.spawn, "step": v.row["step"], "kind": v.row["kind"],
                       "a": v.row["a"], "b": v.row["b"], "start": v.start, "faded": faded})
            })
            .collect();
        Some(json!(list))
    }

    /// The audio thread: its rate, every block it rendered in order, and every sample it rendered,
    /// interleaved stereo.
    pub fn audio(&self) -> Option<(i64, Vec<Value>, &[f32])> {
        let m = self.media.as_ref()?;
        let blocks = (m.blocks.iter())
            .map(|(from, count)| json!({"from": from, "count": count}))
            .collect();
        Some((m.spec.rate, blocks, &m.out))
    }
}

impl<S: Stepper> Stepper for Voiced<S> {
    fn enter(&mut self, entry: &Value) -> Result<(), Value> {
        self.inner.enter(entry)
    }

    fn run(&mut self, step: i64, until: i64) -> Result<(), Value> {
        let ran = self.inner.run(step, until);
        if let Some(m) = self.media.as_mut() {
            m.ran(step, until, &self.inner.occurrences());
        }
        ran
    }

    fn hash(&mut self) -> u64 {
        let h = self.inner.hash();
        match (&self.media, self.planted) {
            (Some(m), Planted::HashCoversMedia) => (h ^ m.digest()).wrapping_mul(0x0100_0000_01b3),
            _ => h,
        }
    }

    fn step_hash(&mut self) -> u64 {
        self.inner.step_hash()
    }

    fn fields(&mut self) -> Vec<(String, String, u64)> {
        self.inner.fields()
    }

    fn again(&self) -> Result<Self, Value> {
        Ok(Voiced {
            inner: self.inner.again()?,
            media: None,
            planted: self.planted,
        })
    }

    fn plant(&mut self, defect: &Defect) -> Result<(), Value> {
        self.inner.plant(defect)
    }

    fn hold(&mut self, size: usize) {
        self.inner.hold(size);
    }

    fn keep(&mut self, step: i64) {
        self.inner.keep(step);
        if let (Some(m), Planted::MediaRestoresCheckpoint) = (self.media.as_mut(), self.planted) {
            m.kept.insert(step, (m.head, m.voices.len()));
        }
    }

    fn back(&mut self, step: i64, t: i64) -> Result<(), Value> {
        self.inner.back(step, t)?;
        if let Some(m) = self.media.as_mut() {
            m.back(step, self.planted == Planted::MediaRestoresCheckpoint);
        }
        Ok(())
    }

    fn timed(&mut self) -> Vec<(String, u64)> {
        self.inner.timed()
    }

    fn written(&self) -> Vec<(String, u64)> {
        self.inner.written()
    }

    fn made(&mut self) -> BTreeMap<i64, Value> {
        self.inner.made()
    }

    fn occurrences(&self) -> Vec<Value> {
        self.inner.occurrences()
    }

    fn seek(&mut self, step: i64, len: i64) -> Result<(i64, u64), Value> {
        self.inner.seek(step, len)
    }

    fn matched(&mut self, game: &[u8; 16]) {
        self.inner.matched(game);
    }

    fn drew(&mut self, entry: &Value) {
        self.inner.drew(entry);
    }

    fn guess(&mut self, step: i64) -> Option<i64> {
        self.inner.guess(step)
    }

    fn sound(&mut self, t: i64) {
        self.inner.sound(t);
        if let Some(m) = self.media.as_mut() {
            m.render(t);
        }
    }

    fn confirmed(&mut self, upto: i64) {
        self.inner.confirmed(upto);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A voice dropped once the head passed its start sounds whole up to the first sample a strip
    /// hadn't rendered, fades out over the 5 ms the report names, and is silent after.
    #[test]
    fn a_dropped_voice_fades_over_the_samples_it_reports() {
        let rate = 48_000;
        let tone: Vec<f32> = (0..rate / 4)
            .flat_map(|i| {
                let v =
                    (0.5 * (std::f64::consts::TAU * 1000.0 * i as f64 / rate as f64).cos()) as f32;
                [v, v]
            })
            .collect();
        let source = Arc::new(Source {
            rate,
            channels: 2,
            samples: tone,
            loop_region: None,
        });
        let spec = MediaSpec {
            form: json!({}),
            sources: BTreeMap::new(),
            rate,
        };
        let mut m = Media::new(spec);
        let per = FLICKS / rate;
        let start = 4_000;
        let span = source.duration();
        m.voices.push(Voice {
            key: "bang".into(),
            spawn: "bang".into(),
            row: json!({"step": 5}),
            start,
            faded: None,
            strip: Strip {
                id: "bang".into(),
                source,
                start: start * per,
                r#in: 0,
                out: span,
                rate: (1, 1),
                ramp: None,
                gain: deep_canvas_media::mix::Gain::Db(0.0),
                pan: 0.0,
                fade_in: None,
                fade_out: None,
                looped: false,
                span,
                bus: 0,
                disabled: Vec::new(),
                emitter: None,
                synth: None,
            },
            unsure: false,
        });
        m.dirty = true;
        m.ran_to = 1_000_000 * per;
        m.render(6_000 * per);
        m.back(0, false);
        m.render(20_000 * per);
        let (from, to) = m.voices[0].faded.expect("the voice faded");
        assert_eq!(to - from, 240);
        assert!(from > start);
        let peak = |a: i64, b: i64| {
            (a..b)
                .map(|s| m.out[2 * s as usize].abs())
                .fold(0f32, f32::max)
        };
        assert!(
            peak(from - 240, from) > 0.4,
            "the tone sounds whole before the fade"
        );
        assert!(
            peak(from, from + 60) > peak(to - 60, to),
            "it falls over the fade"
        );
        assert!(peak(to, to + 2_400) < 1e-3, "and is silent after");
        let ends: Vec<i64> = m.blocks.iter().map(|(f, c)| f + c).collect();
        assert!(m.blocks.iter().skip(1).zip(&ends).all(|((f, _), e)| f == e));
    }
}

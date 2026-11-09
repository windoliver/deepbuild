//! Issue #499: the live transport on the audio clock, played through a test audio backend (the
//! #499 clock acceptance README). The backend is the platform's output replaced at its boundary:
//! devices whose sample clocks the scenario gives, each pulling `buffer` frames at a time
//! `latency + buffer` samples before they play, and reporting the host time that buffer's first
//! sample plays, off by a seeded jitter. Everything above it is the app's: the gate opens a
//! stream on the system's default output, the clock pairs the callbacks' timestamps (smoothed)
//! and leads the frames while sound plays, hands off to the display at the last sample played
//! when the output changes or goes away, and hands back to the next device at its first sample,
//! so t stays monotonic and no logic step runs twice or is skipped.

use std::collections::BTreeMap;
use std::rc::Rc;
use std::sync::Arc;

use deep_canvas_media::clock::Pairing;
use deep_canvas_media::mix::{Mix, Player};
use deep_canvas_media::FLICKS;
use deep_logic::piece::{History, Piece};
use deep_logic::world::{track_of, Record, World};
use serde_json::{json, Map, Value};

use crate::evidence;
use crate::hub::{Hub, Planted};
use crate::mixdown::float_wav;
use crate::placement::Grid;
use crate::refused;

#[derive(Clone, Debug)]
pub struct Spec {
    pub id: String,
    pub rate: i64,
    pub ppm: i64,
    pub buffer: i64,
    pub latency: i64,
    pub jitter: i64,
    pub seed: u64,
}

impl Spec {
    fn parse(v: &Value) -> Option<Spec> {
        let n = |k: &str| v.get(k)?.as_i64();
        let s = Spec {
            id: v.get("id")?.as_str()?.to_string(),
            rate: n("rate").filter(|r| *r > 0 && FLICKS % r == 0)?,
            ppm: n("ppm").unwrap_or(0),
            buffer: n("buffer").filter(|b| *b > 0)?,
            latency: n("latency").filter(|l| *l >= 0)?,
            jitter: n("jitter").filter(|j| *j >= 0).unwrap_or(0),
            seed: v.get("seed").and_then(Value::as_u64).unwrap_or(0),
        };
        (s.ppm > -1_000_000).then_some(s)
    }
}

/// An output device: its spec, when it was connected and when it went away.
#[derive(Clone, Debug)]
struct Device {
    spec: Spec,
    connected: i64,
    removed: Option<i64>,
}

const PPM: i128 = 1_000_000;

impl Device {
    /// The host flick its k-th sample since it was connected plays at: the hardware truth.
    fn play_at(&self, k: i64) -> i64 {
        let s = &self.spec;
        self.connected
            + (k as i128 * FLICKS as i128 * PPM / (s.rate as i128 * (PPM + s.ppm as i128))) as i64
    }

    /// Its first sample that plays at or after host flick `h`.
    fn first_at_or_after(&self, h: i64) -> i64 {
        if h <= self.connected {
            return 0;
        }
        let s = &self.spec;
        let mut k = ((h - self.connected) as i128 * s.rate as i128 * (PPM + s.ppm as i128)
            / (FLICKS as i128 * PPM)) as i64;
        while k > 0 && self.play_at(k - 1) >= h {
            k -= 1;
        }
        while self.play_at(k) < h {
            k += 1;
        }
        k
    }

    fn sample(&self) -> i64 {
        FLICKS / self.spec.rate
    }

    /// The seeded error of buffer `j`'s timestamp, within ±jitter.
    fn jitter(&self, j: i64) -> i64 {
        let s = &self.spec;
        if s.jitter == 0 {
            return 0;
        }
        let mut x = s.seed ^ (j as u64).wrapping_mul(0x9E37_79B9_7F4A_7C15) ^ 0xD1B5_4A32_D192_ED03;
        x ^= x >> 33;
        x = x.wrapping_mul(0xFF51_AFD7_ED55_8CCD);
        x ^= x >> 33;
        (x % (2 * s.jitter as u64 + 1)) as i64 - s.jitter
    }
}

/// The scenario's test audio backend (`audio: {backend: "test", devices, default}`).
#[derive(Clone, Debug, Default)]
pub struct Backend {
    devices: Vec<Device>,
    default: Option<String>,
}

/// The scenario's `audio`: none, a backend, or `None` for a field that doesn't read.
pub fn parse(v: Option<&Value>) -> Option<Option<Backend>> {
    let Some(v) = v else {
        return Some(None);
    };
    if v.get("backend")?.as_str()? != "test" {
        return None;
    }
    let devices: Vec<Device> = v
        .get("devices")?
        .as_array()?
        .iter()
        .map(|d| {
            Some(Device {
                spec: Spec::parse(d)?,
                connected: 0,
                removed: None,
            })
        })
        .collect::<Option<_>>()?;
    let default = match v.get("default") {
        None | Some(Value::Null) => None,
        Some(d) => Some(d.as_str()?.to_string()).filter(|d| devices.iter().any(|x| &x.spec.id == d)),
    };
    Some(Some(Backend { devices, default }))
}

impl Backend {
    fn device(&self, id: &str) -> Option<&Device> {
        self.devices.iter().find(|d| d.spec.id == id)
    }
}

pub enum AudioCall {
    Device {
        add: Option<Spec>,
        default: Option<Option<String>>,
        remove: Option<String>,
    },
    Transport {
        panel: String,
        from: i64,
        to: i64,
    },
    FullState {
        panel: String,
        item: String,
        step: i64,
    },
}

pub fn parse_call(name: &str, c: &Map<String, Value>) -> Option<AudioCall> {
    let s = |k: &str| Some(c.get(k)?.as_str()?.to_string());
    Some(match name {
        "audio_device" => AudioCall::Device {
            add: match c.get("add") {
                None => None,
                Some(d) => Some(Spec::parse(d)?),
            },
            default: match c.get("default") {
                None => None,
                Some(Value::Null) => Some(None),
                Some(d) => Some(Some(d.as_str()?.to_string())),
            },
            remove: match c.get("remove") {
                None => None,
                Some(_) => Some(s("remove")?),
            },
        },
        "transport" => AudioCall::Transport {
            panel: s("panel")?,
            from: c.get("from")?.as_i64()?,
            to: c.get("to")?.as_i64()?,
        },
        "full_state" => AudioCall::FullState {
            panel: s("panel")?,
            item: s("item")?,
            step: c.get("step")?.as_i64()?,
        },
        _ => return None,
    })
}

/// One output stream the app opened on a device.
struct Stream {
    device: String,
    /// The device sample of stream sample 0.
    k0: i64,
    /// The next buffer to pull.
    next: i64,
    /// The document sample stream sample 0 plays.
    d0: Option<i64>,
    pairing: Pairing,
    /// Once closed (the output changed), the host time from which it plays nothing.
    closed: Option<i64>,
}

struct Frame {
    at: i64,
    t: i64,
    master: &'static str,
    device: Option<String>,
}

struct Logic {
    piece: Rc<Piece>,
    world: World,
    rec: Record,
}

/// A panel's live play under the test backend: its mix's player, the stream, the clock, the
/// frames presented and the logic steps run.
pub struct AudioPlay {
    player: Player,
    rate: i64,
    play_host: i64,
    grid: Grid,
    next_vsync: i64,
    /// The display clock: t = t_ref + (host − h_ref).
    t_ref: i64,
    h_ref: i64,
    /// Whether the audio clock leads now.
    audio: bool,
    /// The document time the sound starts at: the audio clock leads from it.
    sound_from: i64,
    stream: Option<Stream>,
    streams_opened: u32,
    /// Every buffer written, by device: its first device sample and its interleaved samples, and
    /// the host time from which that device plays nothing more of this stream.
    written: BTreeMap<String, Vec<(i64, Vec<f32>, Option<i64>)>>,
    frames: Vec<Frame>,
    steps: Vec<(String, i64, i64)>,
    logic: Option<Logic>,
    pub notice: Option<(&'static str, String)>,
    now: i64,
}

/// The first document time any strip of `mix` sounds.
fn sound_from(mix: &Mix) -> i64 {
    mix.strips.iter().map(|s| s.start).min().unwrap_or(0).max(0)
}

impl AudioPlay {
    pub fn new(mix: Arc<Mix>, piece: Option<Rc<Piece>>, play_host: i64, grid: Grid) -> Result<AudioPlay, Value> {
        let rate = mix.rate;
        let from = sound_from(&mix);
        let logic = match piece {
            Some(piece) => {
                let mut rec = Record::default();
                let world = World::new(piece.clone(), track_of(&[]), true, Default::default(), &mut rec, None)?;
                Some(Logic { piece, world, rec })
            }
            None => None,
        };
        let first = (play_host - grid.next_vsync).max(0);
        let k = first / grid.period + i64::from(first % grid.period != 0);
        Ok(AudioPlay {
            player: Player::new(mix, Default::default()),
            rate,
            play_host,
            grid,
            next_vsync: k,
            t_ref: 0,
            h_ref: play_host,
            audio: false,
            sound_from: from,
            stream: None,
            streams_opened: 0,
            written: BTreeMap::new(),
            frames: Vec::new(),
            steps: Vec::new(),
            logic,
            notice: None,
            now: play_host,
        })
    }

    fn vsync(&self, k: i64) -> i64 {
        self.grid.next_vsync + k * self.grid.period
    }

    pub fn running(&self, b: &Backend) -> bool {
        self.stream.as_ref().is_some_and(|s| {
            s.closed.is_none() && b.device(&s.device).is_some_and(|d| d.removed.is_none())
        })
    }

    /// Opens a stream on the default output at host time `at`.
    fn open(&mut self, b: &Backend, at: i64) {
        let Some(d) = b.default.as_deref().and_then(|id| b.device(id)) else {
            return;
        };
        if d.removed.is_some() {
            return;
        }
        let lead = (d.spec.latency + d.spec.buffer) * d.sample();
        self.stream = Some(Stream {
            device: d.spec.id.clone(),
            k0: d.first_at_or_after(at + lead),
            next: 0,
            d0: None,
            pairing: Pairing::new(d.spec.rate),
            closed: None,
        });
        self.streams_opened += 1;
    }

    /// The display clock's t at host `h`.
    fn display_t(&self, h: i64) -> i64 {
        self.t_ref + (h - self.h_ref)
    }

    /// The stream stops at host `at`: the clock hands off to the display at its last sample.
    fn close(&mut self, at: i64) {
        let Some(mut s) = self.stream.take() else {
            return;
        };
        let sample = FLICKS / self.rate;
        if let (Some(d0), Some(p)) = (s.d0, s.pairing.position(at)) {
            let last = (p.ceil() as i64 - 1).max(0);
            if let Some(h) = s.pairing.host_of(last) {
                if self.audio {
                    self.t_ref = (d0 + last) * sample;
                    self.h_ref = h;
                }
            }
        }
        self.audio = false;
        s.closed = Some(at);
        if let Some(bufs) = self.written.get_mut(&s.device) {
            for b in bufs.iter_mut() {
                b.2 = Some(b.2.map_or(at, |x| x.min(at)));
            }
        }
    }

    /// Plays on to host time `to`: every callback and vsync before it, in time order.
    fn advance(&mut self, b: &Backend, to: i64, planted: Option<Planted>) {
        loop {
            let vs = self.vsync(self.next_vsync);
            let cb = self.stream.as_ref().and_then(|s| {
                let d = b.device(&s.device)?;
                let k = s.k0 + s.next * d.spec.buffer;
                let pull = d.play_at(k) - (d.spec.latency + d.spec.buffer) * d.sample();
                let gone = d.removed.is_some_and(|r| r <= pull) || s.closed.is_some_and(|c| c <= pull);
                (!gone).then_some(pull)
            });
            match cb {
                Some(pull) if pull <= vs && pull < to => self.callback(b, planted),
                _ if vs < to => self.frame(vs, planted),
                _ => break,
            }
        }
        self.now = to;
    }

    fn callback(&mut self, b: &Backend, planted: Option<Planted>) {
        let opened = self.streams_opened;
        let restart = planted == Some(Planted::ClockRestartsFromSample0) && opened > 1;
        let sample = FLICKS / self.rate;
        let Some(s) = self.stream.as_mut() else {
            return;
        };
        let Some(d) = b.device(&s.device) else {
            return;
        };
        let buf = d.spec.buffer;
        let k = s.k0 + s.next * buf;
        let reported = d.play_at(k) + d.jitter(s.next);
        let n = s.next * buf;
        if s.d0.is_none() {
            // The stream's first sample takes the t the display clock gives the host time it
            // plays at, so t never jumps; the planted clock restarts from 0 on a new device.
            let t = if restart { 0 } else { self.t_ref + (reported - self.h_ref) };
            let d0 = t.div_euclid(sample) + i64::from(t.rem_euclid(sample) * 2 >= sample);
            s.d0 = Some(d0);
            self.player.seek(d0);
        }
        s.pairing.add(n, reported);
        s.next += 1;
        let device = s.device.clone();
        let mut out = vec![0f32; 2 * buf as usize];
        self.player.read(&mut out);
        self.written.entry(device).or_default().push((k, out, None));
    }

    fn frame(&mut self, at: i64, planted: Option<Planted>) {
        self.next_vsync += 1;
        if at < self.play_host {
            return;
        }
        let sample = FLICKS / self.rate;
        let mut t = self.display_t(at);
        let mut led = ("display", None);
        if let Some(s) = &self.stream {
            if let (Some(d0), Some(p)) = (s.d0, s.pairing.position(at)) {
                let heard = ((d0 as f64 + p) * sample as f64).round() as i64;
                if !self.audio && p >= 0.0 && heard >= self.sound_from {
                    self.audio = true;
                }
                if self.audio {
                    led = ("audio", Some(s.device.clone()));
                    if planted != Some(Planted::ClockFollowsDisplay) {
                        t = heard;
                    }
                }
            }
        }
        if planted != Some(Planted::ClockFollowsDisplay) {
            // Under the display, t keeps on from where the audio clock left it.
            if led.0 == "audio" {
                self.t_ref = t;
                self.h_ref = at;
            }
        }
        if let Some(l) = &mut self.logic {
            let owed = if t < 0 { 0 } else { t.div_euclid(l.piece.items.first().map_or(FLICKS, |i| i.step.max(1))) + 1 };
            let ids: Vec<String> = l.piece.items.iter().map(|i| i.id.clone()).collect();
            let steps = &mut self.steps;
            l.world.run(owed, &mut l.rec, &mut |_, k| {
                if k < owed {
                    for id in &ids {
                        steps.push((id.clone(), k, at));
                    }
                }
            });
        }
        self.frames.push(Frame { at, t, master: led.0, device: led.1 });
    }
}

impl Hub<'_> {
    /// The test backend as this run's device changes left it.
    fn backend(&mut self) -> Option<Backend> {
        if self.gate.backend.is_none() {
            self.gate.backend = self.scenario.audio.clone();
        }
        self.gate.backend.clone()
    }

    /// Every live play under the test backend, played on to now.
    pub(crate) fn advance_audio(&mut self) {
        let Some(b) = self.backend() else {
            return;
        };
        let (now, planted) = (self.now, self.scenario.planted);
        for p in self.gate.audio_plays() {
            p.advance(&b, now, planted);
        }
    }

    /// Starts `panel`'s live play under the test backend: Play granted it.
    pub(crate) fn start_audio(&mut self, panel: &str, mix: Arc<Mix>, piece: Option<Value>) -> Result<AudioPlay, Value> {
        let grid = self
            .placement
            .pacing(panel)
            .map(|(_, d)| d.grid())
            .or_else(|| self.scenario.clock.and_then(|c| c.refresh_hz).map(|hz| Grid { next_vsync: FLICKS / hz, period: FLICKS / hz }))
            .ok_or_else(|| refused("no_display"))?;
        let piece = match piece {
            Some(p) => Some(Rc::new(
                deep_logic::piece::check(&p, &Default::default(), &mut History::new()).map_err(|r| r.0)?,
            )),
            None => None,
        };
        let mut play = AudioPlay::new(mix, piece, self.now, grid)?;
        if let Some(b) = self.backend() {
            play.open(&b, self.now);
        }
        Ok(play)
    }

    pub fn audio_call(&mut self, call: &AudioCall) -> Value {
        if self.scenario.audio.is_none() {
            return refused("no_audio_backend");
        }
        self.advance_audio();
        let now = self.now;
        let planted = self.scenario.planted;
        match call {
            AudioCall::Device { add, default, remove } => {
                self.backend();
                let Some(b) = self.gate.backend.as_mut() else {
                    return refused("no_audio_backend");
                };
                if let Some(spec) = add {
                    b.devices.retain(|d| d.spec.id != spec.id);
                    b.devices.push(Device { spec: spec.clone(), connected: now, removed: None });
                }
                if let Some(d) = default {
                    b.default = d.clone().filter(|d| b.devices.iter().any(|x| &x.spec.id == d && x.removed.is_none()));
                }
                if let Some(r) = remove {
                    for d in b.devices.iter_mut().filter(|d| &d.spec.id == r && d.removed.is_none()) {
                        d.removed = Some(now);
                    }
                    if b.default.as_deref() == Some(r.as_str()) {
                        b.default = None;
                    }
                }
                let b = b.clone();
                let keeps = planted == Some(Planted::BackendKeepsRemovedDevice);
                for p in self.gate.audio_plays() {
                    let Some(dev) = p.stream.as_ref().map(|s| s.device.clone()) else {
                        p.open(&b, now);
                        continue;
                    };
                    let lost = b.device(&dev).is_none_or(|d| d.removed.is_some());
                    let moved = b.default.as_deref() != Some(dev.as_str());
                    if keeps || !(lost || moved) {
                        continue;
                    }
                    if lost {
                        p.notice = Some(("output_lost", dev.clone()));
                    }
                    p.close(now);
                    p.open(&b, now);
                }
                json!({"devices": b.devices.iter().filter(|d| d.removed.is_none()).map(|d| d.spec.id.clone()).collect::<Vec<_>>(),
                       "default": b.default})
            }
            AudioCall::Transport { panel, from, to } => {
                let Some(p) = self.gate.audio_play(panel) else {
                    return refused("not_playing");
                };
                let frames: Vec<Value> = p
                    .frames
                    .iter()
                    .filter(|f| f.at >= *from && f.at < *to)
                    .map(|f| json!({"at": f.at, "t": f.t, "master": f.master, "device": f.device}))
                    .collect();
                let steps: Vec<Value> = p
                    .steps
                    .iter()
                    .filter(|s| s.2 >= *from && s.2 < *to)
                    .map(|s| json!({"item": s.0, "step": s.1, "at": s.2}))
                    .collect();
                json!({"transport": {"frames": frames, "steps": steps}})
            }
            AudioCall::FullState { panel, item, step } => {
                let Some(l) = self.gate.audio_play(panel).and_then(|p| p.logic.as_ref()) else {
                    return refused("not_playing");
                };
                let deep = l.rec.checkpoints.get(item).and_then(Value::as_array).and_then(|c| {
                    c.iter().find(|c| c["step"].as_i64() == Some(*step)).map(|c| c["deep_hash"].clone())
                });
                let Some(deep) = deep else {
                    return refused("not_reached");
                };
                let rows = l.rec.steps_json(&l.piece);
                let arrays = rows
                    .as_array()
                    .and_then(|r| r.iter().find(|r| r["step"].as_i64() == Some(step - 1)))
                    .map(|r| r["arrays"].clone())
                    .unwrap_or(json!({}));
                let own: Map<String, Value> = arrays
                    .as_object()
                    .into_iter()
                    .flatten()
                    .filter(|(k, _)| k.starts_with(&format!("{item}.")))
                    .map(|(k, v)| (k.clone(), v.clone()))
                    .collect();
                json!({"full_state": {"item": item, "step": step, "deep_hash": deep, "arrays": own}})
            }
        }
    }

    /// What `device` played over host [from, to), as a float WAV in the evidence store.
    pub(crate) fn device_output(&mut self, device: &str, from: i64, to: i64) -> Value {
        self.advance_audio();
        let Some(d) = self.backend().and_then(|b| b.device(device).cloned()) else {
            return refused("unknown_device");
        };
        let (first, last) = (d.first_at_or_after(from), d.first_at_or_after(to));
        let n = (last - first).max(0) as usize;
        let mut pcm = vec![0f32; 2 * n];
        for p in self.gate.audio_plays() {
            for (k, buf, until) in p.written.get(device).into_iter().flatten() {
                let len = (buf.len() / 2) as i64;
                for i in (first.max(*k))..(last.min(k + len)) {
                    let h = d.play_at(i);
                    if d.removed.is_some_and(|r| h >= r) || until.is_some_and(|u| h >= u) {
                        continue;
                    }
                    let (src, dst) = (2 * (i - k) as usize, 2 * (i - first) as usize);
                    pcm[dst] += buf[src];
                    pcm[dst + 1] += buf[src + 1];
                }
            }
        }
        match evidence::put(&self.scenario.evidence, &float_wav(&pcm, 2, d.spec.rate)) {
            Ok(sha) => json!({"output": {"device": device, "sample_rate": d.spec.rate, "channels": 2,
                "first": first, "frames": n, "sha256": sha}}),
            Err(_) => refused("store_failed"),
        }
    }

    /// The gate's state for a panel played under the test backend, and its notice.
    pub(crate) fn audio_gate(&mut self, panel: &str) -> Option<(&'static str, Value)> {
        self.advance_audio();
        let b = self.backend()?;
        let p = self.gate.audio_play(panel)?;
        let state = if p.running(&b) { "running" } else { "interrupted" };
        let notice = p.notice.as_ref().map_or(Value::Null, |(c, d)| json!({"code": c, "device": d}));
        Some((state, notice))
    }
}

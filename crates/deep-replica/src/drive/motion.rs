//! The motion check (#1427). `motion` records a launched replica: while it runs the clock steps by 1/120 s, and each
//! step every element with a named id is sampled as it was painted, its bounds, opacity and own text, keyed by the
//! named ids on its path (a row's handle or session ID, a panel's own id, never a position). `motion_check` reads a
//! recording, given as data, taken of a journey it replays, or taken of the three shipped journeys, and answers its
//! findings from a closed list, each naming the element, the time and the measured value. Allowances name a finding,
//! an element and a reason. Virtual time proves the shape of motion, never its pacing, so every answer says pacing
//! was not measured.

use std::collections::{BTreeMap, BTreeSet};

use serde_json::{json, Value};

use deep_app::views::{HOME, NEEDS_YOU, SESSION};

use super::{fail, sha256, Drive, Fail, Plant, Replica, FLICKS};

/// One step of a motion recording: 1/120 s.
pub const STEP: u64 = FLICKS / 120;
const FORMAT: &str = "motion.recording@1";
const PACING: &str =
    "pacing not measured: virtual time proves the shape of motion, not native pacing";
const FINDINGS: [&str; 7] = [
    "pop_in",
    "jump",
    "overshoot",
    "flicker",
    "no_settle",
    "reader_moved",
    "moved_under_reduced_motion",
];
/// How long an element must hold still to be at rest, for overshoot: 100 ms.
const REST_STEPS: usize = 12;
/// The window flicker counts reversals in: 200 ms.
const FLICKER_WINDOW: u64 = FLICKS / 5;
/// How long after the last input anything may still move: 2 s.
const SETTLE: u64 = 2 * FLICKS;

/// One element as a step saw it.
#[derive(Clone, Debug, PartialEq)]
pub struct El {
    pub id: String,
    pub bounds: [i64; 4],
    pub opacity: f64,
    pub text: String,
}

/// A recording in progress on a replica.
pub struct Recorder {
    reader: Option<String>,
    inputs: Vec<u64>,
    frames: Vec<(u64, Vec<El>)>,
    declared: BTreeSet<(String, &'static str)>,
    /// The plant `jumps-on-act`: the next sample draws everything 30% of the window to the right.
    shift_next: bool,
}

impl Replica {
    pub(super) fn motion(&mut self, args: &Value) -> Result<Value, Fail> {
        match (args["action"].as_str(), self.motion.is_some()) {
            (Some("start"), true) => {
                Err(fail("refused", "this replica is already recording motion"))
            }
            (Some("start"), false) => {
                if self.clock.real.is_some() {
                    return Err(fail(
                        "refused",
                        "motion records on the virtual clock; this replica runs on the real one",
                    ));
                }
                gpui_kit::note_paints(true);
                self.motion = Some(Recorder {
                    reader: None,
                    inputs: Vec::new(),
                    frames: Vec::new(),
                    declared: BTreeSet::new(),
                    shift_next: false,
                });
                self.sample();
                let reader = match &args["reader"] {
                    Value::Null => None,
                    locator => Some(self.reader_of(locator)?),
                };
                self.motion.as_mut().expect("started").reader = reader;
                Ok(json!({}))
            }
            (Some("stop"), false) => Err(fail("refused", "this replica isn't recording motion")),
            (Some("stop"), true) => {
                self.declare();
                gpui_kit::note_paints(false);
                let recorder = self.motion.take().expect("recording");
                Ok(json!({"recording": self.recording_of(recorder)}))
            }
            (other, _) => Err(fail(
                "refused",
                format!("motion.action is start or stop, not {other:?}"),
            )),
        }
    }

    /// While recording: one input delivered now.
    pub(super) fn input_at(&mut self, t: u64) {
        let planted = self.plant == Some(Plant::JumpsOnAct);
        if let Some(recorder) = &mut self.motion {
            recorder.inputs.push(t);
            recorder.shift_next = planted;
        }
    }

    /// While recording: this step's elements, from the frame just drawn.
    pub(super) fn sample(&mut self) {
        if self.motion.is_none() {
            return;
        }
        gpui_kit::take_painted();
        self.draw();
        let painted = gpui_kit::take_painted();
        let scale = self.scale();
        let width = self.window_px()[0];
        let device = |v: gpui_kit::Pixels| (f32::from(v) * scale).round() as i64;
        let mut seen = BTreeSet::new();
        let mut elements: Vec<(usize, El)> = Vec::new();
        for p in painted {
            if !matches!(p.id.last(), Some(gpui_kit::ElementId::Name(_))) {
                continue;
            }
            let names: Vec<&str> = p
                .id
                .iter()
                .filter_map(|id| match id {
                    // A Rust type's name is a component's frame, the same for every instance: no identity of its own.
                    gpui_kit::ElementId::Name(name) if !name.contains("::") => Some(name.as_ref()),
                    _ => None,
                })
                .collect();
            let id = names.join("/");
            if !seen.insert(id.clone()) {
                continue;
            }
            let b = p.bounds;
            elements.push((
                names.len(),
                El {
                    id,
                    bounds: [b.origin.x, b.origin.y, b.size.width, b.size.height].map(device),
                    opacity: (p.opacity.clamp(0., 1.) as f64 * 10_000.).round() / 10_000.,
                    text: String::new(),
                },
            ));
        }
        // Each drawn string belongs to the deepest element it lies in: an element's own text, not its children's.
        let mut runs = self.glyphs.runs();
        runs.retain(|r| r.visible);
        runs.sort_by_key(|r| (r.bounds[1], r.bounds[0]));
        for run in runs {
            let owner = elements
                .iter_mut()
                .filter(|(_, e)| super::contains(e.bounds, run.bounds))
                .max_by_key(|(depth, _)| *depth);
            if let Some((_, e)) = owner {
                if !e.text.is_empty() {
                    e.text.push(' ');
                }
                e.text.push_str(&run.text);
            }
        }
        let t = self.clock.t;
        let recorder = self.motion.as_mut().expect("recording");
        let shift = if std::mem::take(&mut recorder.shift_next) {
            width * 3 / 10
        } else {
            0
        };
        let elements = elements
            .into_iter()
            .map(|(_, mut e)| {
                e.bounds[0] += shift;
                e
            })
            .collect();
        recorder.frames.push((t, elements));
    }

    /// The element a locator names, as the recording keys it: the deepest recorded element holding its centre.
    fn reader_of(&mut self, locator: &Value) -> Result<String, Fail> {
        let target = match self.frame().one(locator) {
            Ok(target) => target,
            Err(super::Miss::Bad(why)) => {
                return Err(fail("refused", format!("motion.reader: {why}")))
            }
            Err(_) => {
                return Err(fail(
                    "refused",
                    format!("motion.reader {locator} names no one thing on screen"),
                ))
            }
        };
        let [cx, cy] = target.center();
        let frame = &self
            .motion
            .as_ref()
            .expect("recording")
            .frames
            .last()
            .expect("sampled")
            .1;
        frame
            .iter()
            .filter(|e| {
                let [x, y, w, h] = e.bounds;
                (x..x + w).contains(&cx) && (y..y + h).contains(&cy)
            })
            .max_by_key(|e| e.id.matches('/').count())
            .map(|e| e.id.clone())
            .ok_or_else(|| {
                fail(
                    "refused",
                    format!("motion.reader {locator} is in no element with an id"),
                )
            })
    }

    /// The transitions and springs the replica's panel declares, by the element id it gave them.
    fn declare(&mut self) {
        let Some(view) = self.script.clone() else {
            return;
        };
        let tree = self
            .cx
            .update(|cx| view.read(cx).snapshot().map(|s| s.debug_tree()));
        let Some(tree) = tree else { return };
        let recorder = self.motion.as_mut().expect("recording");
        for line in tree.lines() {
            let Some(key) = line
                .split(":id[Str(\"")
                .nth(1)
                .and_then(|rest| rest.split("\")]").next())
            else {
                continue;
            };
            for (mark, kind) in [(":transition(", "flight"), (":spring(", "spring")] {
                if line.contains(mark) {
                    recorder.declared.insert((key.to_owned(), kind));
                }
            }
        }
    }

    fn window_px(&mut self) -> [i64; 2] {
        let scale = self.scale();
        let size = self
            .cx
            .update_window(self.window, |_, window, _| window.viewport_size())
            .unwrap_or_default();
        [size.width, size.height].map(|v| (f32::from(v) * scale).round() as i64)
    }

    fn recording_of(&mut self, recorder: Recorder) -> Value {
        let window = self.window_px();
        let ids: BTreeSet<&str> = recorder
            .frames
            .iter()
            .flat_map(|(_, f)| f.iter().map(|e| e.id.as_str()))
            .collect();
        let declared: Vec<Value> = recorder
            .declared
            .iter()
            .flat_map(|(key, kind)| {
                ids.iter()
                    .filter(move |id| id.rsplit('/').next() == Some(key.as_str()))
                    .map(move |id| json!({"element": id, "kind": kind}))
            })
            .collect();
        json!({
            "format": FORMAT,
            "window": window,
            "step": STEP,
            "reduced_motion": self.reduced,
            "inputs": recorder.inputs.iter().map(|t| json!({"t": t})).collect::<Vec<_>>(),
            "reader": recorder.reader,
            "declared": declared,
            "frames": recorder.frames.iter().map(|(t, elements)| json!({
                "t": t,
                "elements": elements.iter().map(|e| json!({"id": e.id, "bounds": e.bounds, "opacity": e.opacity, "text": e.text})).collect::<Vec<_>>(),
            })).collect::<Vec<_>>(),
        })
    }
}

// ---- Reading a recording.

/// A recording as the check reads it.
pub struct Recording {
    window: [f64; 2],
    reduced: bool,
    inputs: Vec<u64>,
    reader: Option<String>,
    flights: BTreeSet<String>,
    springs: BTreeSet<String>,
    frames: Vec<(u64, BTreeMap<String, El>)>,
}

impl Recording {
    pub fn parse(value: &Value) -> Result<Recording, String> {
        if value["format"] != FORMAT {
            return Err(format!("a recording is {FORMAT}, not {}", value["format"]));
        }
        let window = match value["window"]
            .as_array()
            .map(|w| w.iter().filter_map(Value::as_f64).collect::<Vec<_>>())
        {
            Some(w) if w.len() == 2 && w.iter().all(|v| *v > 0.) => [w[0], w[1]],
            _ => {
                return Err(format!(
                    "recording.window is [width, height], not {}",
                    value["window"]
                ))
            }
        };
        let declared = |kind: &str| -> BTreeSet<String> {
            value["declared"]
                .as_array()
                .into_iter()
                .flatten()
                .filter(|d| d["kind"] == kind)
                .filter_map(|d| d["element"].as_str().map(str::to_owned))
                .collect()
        };
        let mut frames = Vec::new();
        for frame in value["frames"]
            .as_array()
            .ok_or("recording.frames is a list")?
        {
            let t = frame["t"]
                .as_u64()
                .ok_or_else(|| format!("a frame's t is flicks, not {}", frame["t"]))?;
            let mut elements = BTreeMap::new();
            for e in frame["elements"]
                .as_array()
                .ok_or("a frame's elements is a list")?
            {
                let id = e["id"]
                    .as_str()
                    .filter(|id| !id.is_empty())
                    .ok_or_else(|| format!("an element has an id: {e}"))?;
                let bounds: Vec<i64> = e["bounds"]
                    .as_array()
                    .into_iter()
                    .flatten()
                    .filter_map(|v| v.as_f64().map(|v| v.round() as i64))
                    .collect();
                let [x, y, w, h] = bounds[..] else {
                    return Err(format!("an element's bounds are [x, y, w, h]: {e}"));
                };
                let opacity = e["opacity"]
                    .as_f64()
                    .ok_or_else(|| format!("an element's opacity is a number: {e}"))?;
                let el = El {
                    id: id.to_owned(),
                    bounds: [x, y, w, h],
                    opacity,
                    text: e["text"].as_str().unwrap_or_default().to_owned(),
                };
                elements.insert(el.id.clone(), el);
            }
            frames.push((t, elements));
        }
        frames.sort_by_key(|(t, _)| *t);
        let mut inputs: Vec<u64> = value["inputs"]
            .as_array()
            .into_iter()
            .flatten()
            .filter_map(|i| i["t"].as_u64())
            .collect();
        inputs.sort_unstable();
        Ok(Recording {
            window,
            reduced: value["reduced_motion"].as_bool().unwrap_or(false),
            inputs,
            reader: value["reader"].as_str().map(str::to_owned),
            flights: declared("flight"),
            springs: declared("spring"),
            frames,
        })
    }

    /// Every element's track: its index into the frames and its state there, for each frame it is in.
    fn tracks(&self) -> BTreeMap<&str, Vec<(usize, &El)>> {
        let mut tracks: BTreeMap<&str, Vec<(usize, &El)>> = BTreeMap::new();
        for (k, (_, elements)) in self.frames.iter().enumerate() {
            for (id, e) in elements {
                tracks.entry(id.as_str()).or_default().push((k, e));
            }
        }
        tracks
    }

    /// The findings, at most one of each kind an element, ordered by time, kind and element.
    pub fn findings(&self) -> Vec<Finding> {
        let mut found = Vec::new();
        let t = |k: usize| self.frames[k].0;
        let settle_from = self
            .inputs
            .last()
            .copied()
            .or(self.frames.first().map(|f| f.0))
            .unwrap_or(0)
            + SETTLE;
        for (id, track) in self.tracks() {
            let mut add = |finding: &'static str, at: u64, value: f64| {
                found.push(Finding {
                    finding,
                    element: id.to_owned(),
                    t: at,
                    value,
                })
            };
            let pairs = || {
                track
                    .windows(2)
                    .filter(|w| w[1].0 == w[0].0 + 1)
                    .map(|w| (w[0].1, w[1].0, w[1].1))
            };
            let moved = |a: &El, b: &El| a.bounds[0] != b.bounds[0] || a.bounds[1] != b.bounds[1];
            // pop_in: absent or at 0 a step before, over half opaque now.
            let pop = track.iter().enumerate().find(|(i, (k, e))| {
                *k > 0
                    && e.opacity > 0.5
                    && (*i == 0 || track[i - 1].0 != k - 1 || track[i - 1].1.opacity == 0.)
            });
            if let Some((_, (k, e))) = pop {
                add("pop_in", t(*k), e.opacity);
            }
            // jump: over a quarter of the window on either axis in one step, with no flight declared.
            if !self.flights.contains(id) {
                let jump = pairs().find_map(|(a, k, b)| {
                    let fx = (b.bounds[0] - a.bounds[0]).abs() as f64 / self.window[0];
                    let fy = (b.bounds[1] - a.bounds[1]).abs() as f64 / self.window[1];
                    (fx > 0.25 || fy > 0.25).then_some((k, fx.max(fy)))
                });
                if let Some((k, value)) = jump {
                    add("jump", t(k), value);
                }
            }
            // overshoot: from rest to rest, more than 12% of the move past where it comes to rest, with no spring.
            if !self.springs.contains(id) {
                if let Some((k, value)) = (0..2)
                    .filter_map(|axis| overshoot(&track, axis))
                    .min_by_key(|(k, _)| *k)
                {
                    add("overshoot", t(k), value);
                }
            }
            // flicker: opacity reverses direction more than twice in 200 ms.
            if let Some((k, value)) = self.flicker(&track) {
                add("flicker", t(k), value as f64);
            }
            // no_settle: still moving 2 s after the last input.
            if let Some((_, k, _)) = pairs().find(|(a, k, b)| t(*k) >= settle_from && moved(a, b)) {
                add(
                    "no_settle",
                    t(k),
                    (t(k) - (settle_from - SETTLE)) as f64 / FLICKS as f64,
                );
            }
            // reader_moved: the line a person is reading moves.
            if self.reader.as_deref() == Some(id) {
                if let Some((a, k, b)) = pairs().find(|(a, _, b)| moved(a, b)) {
                    let (dx, dy) = (
                        (b.bounds[0] - a.bounds[0]) as f64,
                        (b.bounds[1] - a.bounds[1]) as f64,
                    );
                    add("reader_moved", t(k), (dx * dx + dy * dy).sqrt());
                }
            }
            // moved_under_reduced_motion: a change of place that takes more than one step after one input.
            if self.reduced {
                let mut episodes: BTreeMap<usize, (usize, u64)> = BTreeMap::new();
                for (a, k, b) in pairs() {
                    if moved(a, b) {
                        let after = self.inputs.iter().filter(|i| **i <= t(k)).count();
                        let episode = episodes.entry(after).or_insert((k, 0));
                        episode.1 += 1;
                    }
                }
                if let Some((k, steps)) = episodes.values().find(|(_, n)| *n > 1) {
                    add("moved_under_reduced_motion", t(*k), *steps as f64);
                }
            }
        }
        found.sort_by(|a, b| (a.t, a.rank(), &a.element).cmp(&(b.t, b.rank(), &b.element)));
        found
    }

    /// The worst 200 ms of an element's opacity reversals, from its first reversal, when there are more than two.
    fn flicker(&self, track: &[(usize, &El)]) -> Option<(usize, usize)> {
        let mut reversals = Vec::new();
        let mut last: Option<(f64, usize)> = None; // the last direction and the step it was last seen at
        for w in track.windows(2).filter(|w| w[1].0 == w[0].0 + 1) {
            let d = w[1].1.opacity - w[0].1.opacity;
            if d.abs() < 1e-4 {
                continue;
            }
            if let Some((sign, at)) = last {
                if sign != d.signum() {
                    reversals.push(at);
                }
            }
            last = Some((d.signum(), w[1].0));
        }
        let t = |k: usize| self.frames[k].0;
        reversals
            .iter()
            .enumerate()
            .map(|(i, &k)| {
                (
                    k,
                    reversals[i..]
                        .iter()
                        .take_while(|&&j| t(j) - t(k) <= FLICKER_WINDOW)
                        .count(),
                )
            })
            .filter(|(_, n)| *n > 2)
            .max_by(|a, b| a.1.cmp(&b.1).then(b.0.cmp(&a.0)))
    }
}

/// On one axis: each move from rest to rest, and the first that went more than 12% of its length past its end.
fn overshoot(track: &[(usize, &El)], axis: usize) -> Option<(usize, f64)> {
    let p: Vec<(usize, i64)> = track.iter().map(|(k, e)| (*k, e.bounds[axis])).collect();
    // The rests: runs of at least REST_STEPS samples in a row at one place, and where the element first is, which is
    // where any move it makes starts however soon after the recording does.
    let mut rests = Vec::new();
    let mut i = 0;
    while i < p.len() {
        let mut j = i;
        while j + 1 < p.len() && p[j + 1].1 == p[i].1 && p[j + 1].0 == p[j].0 + 1 {
            j += 1;
        }
        if i == 0 || j + 1 - i >= REST_STEPS {
            rests.push((i, j));
        }
        i = j + 1;
    }
    rests.windows(2).find_map(|w| {
        let ((_, from_end), (to_start, _)) = (w[0], w[1]);
        let (start, end) = (p[from_end].1, p[to_start].1);
        let length = (end - start).abs() as f64;
        if length == 0. {
            return None;
        }
        let way = (end - start).signum();
        let (k, past) = p[from_end..to_start]
            .iter()
            .map(|(k, v)| (*k, ((v - end) * way) as f64))
            .max_by(|a, b| a.1.total_cmp(&b.1).then(b.0.cmp(&a.0)))?;
        (past / length > 0.12).then_some((k, past / length))
    })
}

/// One finding: what, on which element, when, and the measured value.
#[derive(Clone, Debug, PartialEq)]
pub struct Finding {
    pub finding: &'static str,
    pub element: String,
    pub t: u64,
    pub value: f64,
}

impl Finding {
    fn rank(&self) -> usize {
        FINDINGS
            .iter()
            .position(|f| *f == self.finding)
            .unwrap_or(FINDINGS.len())
    }

    fn json(&self) -> Value {
        json!({"finding": self.finding, "element": self.element, "t": self.t, "value": self.value})
    }
}

/// The allowances applied: the findings kept, the stale allowances, and the INVALID ones with why.
fn allow(found: Vec<Finding>, allowances: &[Value]) -> (Vec<Finding>, Vec<Value>, Vec<Value>) {
    let mut invalid = Vec::new();
    let mut valid = Vec::new();
    for a in allowances {
        let reason = a["reason"].as_str().map(str::trim).unwrap_or_default();
        let finding = a["finding"].as_str().unwrap_or_default();
        let element = a["element"].as_str().unwrap_or_default();
        if reason.is_empty() {
            invalid.push(json!({"allowance": a, "why": "an allowance gives its reason"}));
        } else if !FINDINGS.contains(&finding) {
            invalid.push(json!({"allowance": a, "why": format!("{finding:?} is not a motion finding; they are {}", FINDINGS.join(", "))}));
        } else if element.is_empty() {
            invalid.push(json!({"allowance": a, "why": "an allowance names its element"}));
        } else {
            valid.push((finding, element));
        }
    }
    let used: BTreeSet<(&str, &str)> = valid
        .iter()
        .filter(|(f, e)| found.iter().any(|x| x.finding == *f && x.element == *e))
        .copied()
        .collect();
    let stale = valid
        .iter()
        .filter(|a| !used.contains(*a))
        .map(|(f, e)| json!({"finding": f, "element": e}))
        .collect();
    let kept = found
        .into_iter()
        .filter(|x| !used.contains(&(x.finding, x.element.as_str())))
        .collect();
    (kept, stale, invalid)
}

/// The claim of one checked recording: INVALID for a bad allowance, FAIL for a finding or a stale allowance,
/// INCONCLUSIVE when it ends before the 2 s after its last input could be seen, PASS otherwise.
fn claim(kept: &[Finding], stale: &[Value], invalid: &[Value], judged: bool) -> &'static str {
    if !invalid.is_empty() {
        "INVALID"
    } else if !kept.is_empty() || !stale.is_empty() {
        "FAIL"
    } else if !judged {
        "INCONCLUSIVE"
    } else {
        "PASS"
    }
}

impl Recording {
    /// Whether the recording runs to 2 s after its last input, so `no_settle` could be judged.
    fn judged(&self) -> bool {
        let (Some(first), Some(last)) = (self.frames.first(), self.frames.last()) else {
            return false;
        };
        last.0 >= self.inputs.last().copied().unwrap_or(first.0) + SETTLE
    }

    fn summary(&self, value: &Value) -> Value {
        let elements: BTreeSet<&str> = self
            .frames
            .iter()
            .flat_map(|(_, f)| f.keys().map(String::as_str))
            .collect();
        json!({
            "sha256": sha256(value.to_string().as_bytes()),
            "frames": self.frames.len(),
            "step": value["step"],
            "inputs": value["inputs"],
            "reduced_motion": self.reduced,
            "elements": elements,
        })
    }
}

// ---- The check.

/// The three shipped journeys: Needs you, a session page and the project page, on #338's fixture record. Each
/// launches on its center, points at one row and holds the pointer there, and runs past 2 s so `no_settle` is judged.
fn shipped() -> Vec<(&'static str, Vec<Value>)> {
    let hold = json!({"call": "wait_for", "wait_for": {"t": 3 * FLICKS}, "timeout": 60_000});
    let journey = |center: &str, row: &str| {
        vec![
            json!({"call": "launch", "launch": {"from": "fixture", "center": center, "clock": "virtual"}}),
            json!({"call": "act", "locator": {"role": "button", "name": row}, "act": {"kind": "hover"}}),
            hold.clone(),
        ]
    };
    let session = "! Session 01MCBH57 · needs you";
    vec![
        (
            "needs-you",
            journey(NEEDS_YOU, "Authority ask 1 in folding: go ahead?"),
        ),
        ("session", journey(SESSION, session)),
        ("project", journey(HOME, session)),
    ]
}

/// Replays `calls` in a replica of its own, recording from the launch, and answers the recording and whether every
/// call was answered.
fn record(drive: &mut Drive, calls: &[Value], reader: &Value) -> Result<(Value, bool), Fail> {
    let Some((first, rest)) = calls.split_first().filter(|(c, _)| c["call"] == "launch") else {
        return Err(fail(
            "refused",
            "motion_check.journey is deep_drive calls, a launch first",
        ));
    };
    let launched = drive.call(first);
    if launched["ok"] != true {
        return Err(fail(
            "blocked",
            format!("the journey's launch: {}", launched["error"]),
        ));
    }
    let id = launched["replica"].clone();
    let started = drive.call(
        &json!({"call": "motion", "replica": id, "motion": {"action": "start", "reader": reader}}),
    );
    let mut all = started["ok"] == true;
    if all {
        for call in rest.iter().filter(|c| c["call"] != "close") {
            let mut call = call.clone();
            call["replica"] = id.clone();
            all &= drive.call(&call)["ok"] == true;
        }
    }
    let stopped =
        drive.call(&json!({"call": "motion", "replica": id, "motion": {"action": "stop"}}));
    drive.call(&json!({"call": "close", "replica": id}));
    if started["ok"] != true || stopped["ok"] != true {
        return Err(fail(
            "blocked",
            format!(
                "the journey's motion recording: {}",
                if started["ok"] != true {
                    &started["error"]
                } else {
                    &stopped["error"]
                }
            ),
        ));
    }
    Ok((stopped["recording"].clone(), all))
}

pub fn run(drive: &mut Drive, args: &Value) -> Result<Value, Fail> {
    let allowances = match &args["allowances"] {
        Value::Null => Vec::new(),
        Value::Array(list) => list.clone(),
        other => {
            return Err(fail(
                "refused",
                format!("motion_check.allowances is a list, not {other}"),
            ))
        }
    };
    let read = |value: &Value| Recording::parse(value).map_err(|why| fail("refused", why));
    if !args["recording"].is_null() {
        let recording = read(&args["recording"])?;
        let (kept, stale, invalid) = allow(recording.findings(), &allowances);
        return Ok(json!({
            "claim": claim(&kept, &stale, &invalid, recording.judged()),
            "findings": kept.iter().map(Finding::json).collect::<Vec<_>>(),
            "stale": stale, "invalid": invalid, "pacing": PACING,
        }));
    }
    if let Some(calls) = args["journey"].as_array() {
        let (value, all) = record(drive, calls, &args["reader"])?;
        let recording = read(&value)?;
        let (kept, stale, invalid) = allow(recording.findings(), &allowances);
        return Ok(json!({
            "claim": claim(&kept, &stale, &invalid, all && recording.judged()),
            "findings": kept.iter().map(Finding::json).collect::<Vec<_>>(),
            "stale": stale, "invalid": invalid, "pacing": PACING,
            "recording": recording.summary(&value),
        }));
    }
    if args["shipped"] != true {
        return Err(fail(
            "refused",
            "motion_check takes a recording, a journey or shipped: true",
        ));
    }
    // Each journey's findings, then the allowances over all of them, so one is stale only if no journey needs it.
    let mut runs = Vec::new();
    for (name, calls) in shipped() {
        let (value, all) = record(drive, &calls, &Value::Null)?;
        let recording = read(&value)?;
        runs.push((
            name,
            recording.findings(),
            all && recording.judged(),
            recording.summary(&value),
        ));
    }
    let every: Vec<Finding> = runs.iter().flat_map(|r| r.1.iter().cloned()).collect();
    let (_, stale, invalid) = allow(every, &allowances);
    let mut findings = Vec::new();
    let mut journeys = Vec::new();
    let mut claims = Vec::new();
    for (name, found, judged, summary) in runs {
        let (kept, _, _) = allow(found, &allowances);
        let verdict = claim(&kept, &[], &invalid, judged);
        claims.push(verdict);
        findings.extend(kept.iter().map(|f| {
            let mut v = f.json();
            v["journey"] = json!(name);
            v
        }));
        journeys.push(json!({"name": name, "claim": verdict, "findings": kept.iter().map(Finding::json).collect::<Vec<_>>(), "pacing": PACING, "recording": summary}));
    }
    let claim = ["INVALID", "FAIL", "INCONCLUSIVE"]
        .into_iter()
        .find(|c| claims.contains(c) || (*c == "FAIL" && !stale.is_empty()))
        .unwrap_or("PASS");
    Ok(
        json!({"claim": claim, "findings": findings, "stale": stale, "invalid": invalid, "pacing": PACING, "journeys": journeys}),
    )
}

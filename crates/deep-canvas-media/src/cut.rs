//! Issue #1518: `cut.words@1` (canvas primitives: Strip and track, its As built (#1518)). A
//! recording cut by its words: the words to keep, by index in the recording's words record,
//! expand at check into strips. Each cut moves from the record's edge onto the quietest spot near
//! it, then onto a zero crossing, never past the middle of a word either side of it, and each
//! splice crossfades; a run too short for its crossfades is dropped and listed, never silently. A
//! recording with video gets a picture per strip on the strip's own clock, cut on a frame. The host
//! reads the recording for the module (the check's [`Reads`]); nothing here decodes, and the
//! source asset is never written.

use std::collections::BTreeSet;
use std::sync::Arc;

use deep_canvas::document::expands::{Lowered, Reads, Refusal, Request, Sound};
use serde_json::{json, Map, Value};

use crate::heard::{self, align::Op};
use crate::FLICKS;

/// The kind, `family.name`.
pub const KIND: &str = "cut.words";
const WORDS: &str = "bake.words";
const ALIGNER: &str = "charsiu-aligner@1.0.0";
/// The job and the pinned tool whose records hold transcripts.
pub const TRANSCRIPT: &str = "narration.transcript";
pub const TRANSCRIBER: &str = "whisper-cpp@1.9.5";

/// The frames a sound holds.
pub fn frames(pcm: &Sound) -> i64 {
    (pcm.samples.len() / pcm.channels.max(1)) as i64
}

/// A sound's samples as interleaved f32 little-endian: the bytes its SHA-256 names.
pub fn bytes(pcm: &Sound) -> Vec<u8> {
    pcm.samples.iter().flat_map(|x| x.to_le_bytes()).collect()
}

/// The channels' mean at frame `n`; 0 outside the sound.
fn mono(pcm: &Sound, n: i64) -> f64 {
    let c = pcm.channels.max(1);
    if n < 0 || n >= frames(pcm) {
        return 0.0;
    }
    let at = n as usize * c;
    pcm.samples[at..at + c]
        .iter()
        .map(|x| f64::from(*x))
        .sum::<f64>()
        / c as f64
}

/// One word of the record, its times in samples of the PCM.
#[derive(Clone, Debug)]
pub struct Word {
    pub text: String,
    pub start: i64,
    pub end: i64,
}

impl Word {
    fn middle(&self) -> i64 {
        (self.start + self.end).div_euclid(2)
    }
}

/// The placement's settings, in samples.
#[derive(Clone, Copy, Debug)]
pub struct Settings {
    pub search: i64,
    pub min: i64,
    pub max: i64,
}

/// A cut: its raw point (the record's edge) and where it landed, in samples.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Cut {
    pub raw: i64,
    pub at: i64,
}

/// A run of kept words as it plays: its cuts (none at the PCM's own start or end), its
/// crossfades, and its strip's source span and start, all in samples.
#[derive(Clone, Debug)]
pub struct Run {
    pub first: usize,
    pub last: usize,
    pub cut_in: Option<Cut>,
    pub cut_out: Option<Cut>,
    pub fade_in: i64,
    pub fade_out: i64,
    pub r#in: i64,
    pub out: i64,
    pub start: i64,
}

impl Run {
    fn from(&self) -> i64 {
        self.cut_in.map_or(0, |c| c.at)
    }

    fn to(&self, frames: i64) -> i64 {
        self.cut_out.map_or(frames, |c| c.at)
    }

    /// Where the strip ends, in samples of document time.
    pub fn end(&self) -> i64 {
        self.start + (self.out - self.r#in)
    }

    /// Where source sample `s` sounds, in samples of document time.
    pub fn at(&self, s: i64) -> i64 {
        self.start + (s - self.r#in)
    }
}

/// The planted wrong programs a plan runs (#1518).
#[derive(Clone, Copy, Debug, Default)]
pub struct Plants {
    /// `cut_on_raw_times`: each cut at its raw point, never moved.
    pub raw: bool,
    /// `cut_drops_fragments`: a fragment dropped and never listed.
    pub silent: bool,
}

impl Plants {
    fn now() -> Plants {
        Plants {
            raw: crate::planted("cut_on_raw_times"),
            silent: crate::planted("cut_drops_fragments"),
        }
    }
}

/// Where the sound lands between words `left` and `right`, from `raw`: the quietest spot within
/// `search` of it and between the two words' middles, then the nearest zero crossing there.
pub fn place(
    pcm: &Sound,
    left: &Word,
    right: &Word,
    raw: i64,
    s: &Settings,
    plants: Plants,
) -> i64 {
    let frames = frames(pcm);
    let (a, b) = (left.middle(), right.middle());
    let lo = (raw - s.search).max(a).max(0);
    let hi = (raw + s.search).min(b).min(frames);
    if plants.raw {
        return raw.clamp(0, frames);
    }
    if lo > hi {
        return raw.clamp(a.min(b), a.max(b)).clamp(0, frames);
    }
    // The energy at n: the channels' mean, squared and summed over twice `max` samples centred on
    // n, so the crossfade centred on the cut has as much quiet again around it.
    let w = (2 * s.max).max(1);
    let first = lo - w / 2;
    let mut prefix = Vec::with_capacity((hi - lo + w + 1) as usize);
    prefix.push(0.0f64);
    for m in first..hi - w / 2 + w {
        let x = mono(pcm, m);
        prefix.push(prefix[prefix.len() - 1] + x * x);
    }
    let energy = |n: i64| {
        let a = (n - w / 2 - first) as usize;
        prefix[a + w as usize] - prefix[a]
    };
    let mut quiet = lo;
    let mut least = f64::INFINITY;
    for n in lo..=hi {
        let e = energy(n);
        let nearer = (n - raw).abs() < (quiet - raw).abs();
        if e < least || (e == least && nearer) {
            least = e;
            quiet = n;
        }
    }
    let crossing = |n: i64| {
        if n <= 0 || n >= frames {
            return true;
        }
        let (x, before) = (mono(pcm, n), mono(pcm, n - 1));
        x == 0.0 || (x < 0.0) != (before < 0.0)
    };
    for d in 0..=(hi - lo) {
        for n in [quiet - d, quiet + d] {
            if (lo..=hi).contains(&n) && crossing(n) {
                return n;
            }
        }
    }
    quiet
}

/// A splice's crossfade over a gap: `max`, or half the gap where that is shorter, never under
/// `min`.
fn crossfade(gap: i64, s: &Settings) -> i64 {
    (gap / 2).min(s.max).max(s.min)
}

/// The recipe planned: the PCM, the record's words, the runs that play, what was removed, and
/// each dropped fragment's words with why.
pub struct Plan {
    pub asset: String,
    pub pcm: Arc<Sound>,
    pub words: Vec<Word>,
    pub runs: Vec<Run>,
    pub removed: Vec<usize>,
    pub fragments: Vec<(usize, String)>,
    /// The records the recording's asset lists, read.
    pub records: Vec<Value>,
}

impl Plan {
    /// Sample counts at the PCM's rate as flicks.
    pub fn flicks(&self, samples: i64) -> i64 {
        (i128::from(samples) * i128::from(FLICKS) / i128::from(self.pcm.rate.max(1))) as i64
    }

    /// Each kept word that plays, in order: its index, text and start in document flicks.
    pub fn kept(&self) -> Vec<(usize, &str, i64)> {
        self.runs
            .iter()
            .flat_map(|r| {
                (r.first..=r.last).map(move |k| {
                    let w = &self.words[k];
                    (k, w.text.as_str(), self.flicks(r.at(w.start.max(r.r#in))))
                })
            })
            .collect()
    }

    /// Where removed word `k` was taken out, in document flicks: the splice between the runs
    /// around it, else the result's start or end.
    pub fn removed_at(&self, k: usize) -> i64 {
        let next = self.runs.iter().position(|r| r.first > k);
        let t = match next {
            Some(0) => 0,
            Some(i) => {
                let r = &self.runs[i];
                r.at(r.from())
            }
            None => self.runs.last().map_or(0, Run::end),
        };
        self.flicks(t)
    }
}

fn refusal(code: &'static str, path: String, actual: Value, what: String) -> Vec<Refusal> {
    vec![Refusal {
        code,
        path,
        actual: Box::new(actual),
        what,
    }]
}

fn ms(v: Option<&Value>, default: f64) -> Option<f64> {
    match v {
        None => Some(default),
        Some(v) => v.as_f64().filter(|x| x.is_finite() && *x >= 0.0),
    }
}

/// The kept word indices, from `keep`'s indices and inclusive `[first, last]` ranges.
fn kept_set(keep: Option<&Value>, n: usize, id: &str) -> Result<BTreeSet<usize>, Vec<Refusal>> {
    let mut out = BTreeSet::new();
    let path = |i: usize| format!("items/{id}/params/keep/{i}");
    let index = |v: &Value| v.as_u64().and_then(|k| usize::try_from(k).ok());
    for (i, e) in keep
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .enumerate()
    {
        let range = match e {
            Value::Array(r) if r.len() == 2 => index(&r[0]).zip(index(&r[1])),
            v => index(v).map(|k| (k, k)),
        };
        let Some((a, b)) = range.filter(|(a, b)| a <= b && *b < n) else {
            return Err(refusal(
                "cut.keep_range",
                path(i),
                e.clone(),
                format!("keep's entry {i} isn't a word index or a [first, last] range of the record's {n} words, counted from 0"),
            ));
        };
        out.extend(a..=b);
    }
    Ok(out)
}

/// The recipe `id` of `doc`, planned: read through the host's `reads`, placed and crossfaded.
pub fn plan(
    doc: &Value,
    id: &str,
    item: &Value,
    reads: Option<&dyn Reads>,
) -> Result<Plan, Vec<Refusal>> {
    let p = item.get("params").unwrap_or(&Value::Null);
    let name = p
        .get("recording")
        .and_then(Value::as_str)
        .unwrap_or_default();
    let asset = doc.get("assets").and_then(|a| a.get(name));
    let Some(sha) = asset.and_then(|a| a.get("sha256")).and_then(Value::as_str) else {
        return Err(refusal(
            "unknown_asset",
            format!("items/{id}/params/recording"),
            json!(name),
            format!("`recording` names `{name}`, which isn't an entry of assets with a sha256"),
        ));
    };
    let attached: Vec<String> = asset
        .and_then(|a| a.get("attached"))
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(Value::as_str)
        .map(str::to_string)
        .collect();
    let Some(reader) = reads else {
        return Err(refusal(
            "cut.unread",
            format!("items/{id}/params/recording"),
            json!(name),
            "no host reads the recording here, so its cuts can't be placed".into(),
        ));
    };
    let pcm = reader.sound(sha).map_err(|why| {
        refusal(
            "unknown_asset",
            format!("items/{id}/params/recording"),
            why,
            format!("the recording `{name}` can't be read"),
        )
    })?;
    let records: Vec<Value> = attached.iter().filter_map(|r| reader.record(r)).collect();
    let of_pcm = |kind: &str| {
        records
            .iter()
            .find(|r| r["kind"] == kind && r["pcm_sha256"] == pcm.sha256.as_str())
    };
    let Some(record) = of_pcm(WORDS) else {
        let _ = reader.keep(&bytes(&pcm));
        let locale = doc.get("locale").and_then(Value::as_str).unwrap_or("en");
        let mut blocked = json!({"outcome": "blocked", "state": "BLOCKED", "code": "cut.words_unbaked", "item": id,
            "pcm_sha256": pcm.sha256, "sample_rate": pcm.rate, "channels": pcm.channels});
        let transcript = of_pcm(TRANSCRIPT).filter(|r| r["analyzer"] == TRANSCRIBER);
        let run = match transcript.and_then(|r| r["text"].as_str()) {
            Some(text) => {
                let text_sha = reader.keep(text.as_bytes()).unwrap_or_default();
                blocked["job"] = json!(WORDS);
                blocked["analyzer"] = json!(ALIGNER);
                blocked["text_sha256"] = json!(text_sha);
                format!(
                    "{WORDS} on {ALIGNER} with the input pcm {} and the input text {text_sha}",
                    pcm.sha256
                )
            }
            None => {
                blocked["job"] = json!(TRANSCRIPT);
                blocked["analyzer"] = json!(TRANSCRIBER);
                blocked["locale"] = json!(locale);
                format!(
                    "{TRANSCRIPT} on {TRANSCRIBER} with the input pcm {} and locale {locale}",
                    pcm.sha256
                )
            }
        };
        return Err(refusal(
            "cut.words_unbaked",
            format!("items/{id}/params/recording"),
            blocked,
            format!(
                "the recording `{name}` has no {WORDS} record of its PCM {} ({} Hz, {} channel{}): run {run}, then list its record in the asset's attached",
                pcm.sha256,
                pcm.rate,
                pcm.channels,
                if pcm.channels == 1 { "" } else { "s" }
            ),
        ));
    };
    let rate = pcm.rate.max(1);
    let sample = |f: i64| (i128::from(f) * i128::from(rate) / i128::from(FLICKS)) as i64;
    let words: Option<Vec<Word>> = record["words"].as_array().and_then(|ws| {
        ws.iter()
            .map(|w| {
                Some(Word {
                    text: w.get("text")?.as_str()?.to_string(),
                    start: sample(w.get("start")?.as_i64()?),
                    end: sample(w.get("end")?.as_i64()?),
                })
            })
            .collect()
    });
    let Some(words) = words else {
        return Err(refusal(
            "bad_record",
            format!("items/{id}/params/recording"),
            json!(name),
            format!("the words record of `{name}` lists no words with text, start and end"),
        ));
    };
    let keep = kept_set(p.get("keep"), words.len(), id)?;
    let (Some(search), Some(min), Some(max)) = (
        ms(p.get("search"), 200.0),
        ms(p.pointer("/crossfade/min"), 5.0),
        ms(p.pointer("/crossfade/max"), 40.0),
    ) else {
        return Err(refusal(
            "out_of_range",
            format!("items/{id}/params"),
            p.clone(),
            "search and crossfade's min and max are milliseconds, 0 or more".into(),
        ));
    };
    let at = |ms: f64| (ms * rate as f64 / 1000.0).round() as i64;
    let s = Settings {
        search: at(search),
        min: at(min),
        max: at(max).max(at(min)),
    };
    let (runs, fragments) = lay(&pcm, &words, &keep, &s, Plants::now());
    let removed = (0..words.len()).filter(|k| !keep.contains(k)).collect();
    Ok(Plan {
        asset: sha.to_string(),
        pcm,
        words,
        runs,
        removed,
        fragments,
        records,
    })
}

/// The runs of kept words placed and crossfaded, a fragment too short for its crossfades
/// dropped and listed with why.
fn lay(
    pcm: &Sound,
    words: &[Word],
    keep: &BTreeSet<usize>,
    s: &Settings,
    plants: Plants,
) -> (Vec<Run>, Vec<(usize, String)>) {
    let frames = frames(pcm);
    let last = words.len().saturating_sub(1);
    let mut runs: Vec<Run> = Vec::new();
    for &k in keep {
        match runs.last_mut() {
            Some(r) if r.last + 1 == k => r.last = k,
            _ => runs.push(Run {
                first: k,
                last: k,
                cut_in: None,
                cut_out: None,
                fade_in: 0,
                fade_out: 0,
                r#in: 0,
                out: 0,
                start: 0,
            }),
        }
    }
    for r in &mut runs {
        if r.first > 0 {
            let raw = words[r.first].start;
            let at = place(pcm, &words[r.first - 1], &words[r.first], raw, s, plants);
            r.cut_in = Some(Cut { raw, at });
        }
        if r.last < last {
            let raw = words[r.last].end;
            let at = place(pcm, &words[r.last], &words[r.last + 1], raw, s, plants);
            r.cut_out = Some(Cut { raw, at });
        }
    }
    let mut fragments = Vec::new();
    loop {
        for i in 0..runs.len() {
            let before = i.checked_sub(1).map_or(0, |j| runs[j].to(frames));
            let after = runs.get(i + 1).map_or(frames, Run::from);
            let r = &mut runs[i];
            r.fade_in = match r.cut_in {
                Some(c) => crossfade(c.at - before, s),
                None => 0,
            };
            r.fade_out = match r.cut_out {
                Some(c) => crossfade(after - c.at, s),
                None => 0,
            };
        }
        let short = runs
            .iter()
            .position(|r| 2 * (r.to(frames) - r.from()) < r.fade_in + r.fade_out);
        let Some(i) = short else { break };
        let r = runs.remove(i);
        if !plants.silent {
            let ms = |n: i64| n * 1000 / pcm.rate.max(1);
            let why = format!(
                "{} ms between its cuts, under half its crossfades of {} and {} ms",
                ms(r.to(frames) - r.from()),
                ms(r.fade_in),
                ms(r.fade_out)
            );
            fragments.extend((r.first..=r.last).map(|k| (k, why.clone())));
        }
    }
    let mut start = 0;
    for r in &mut runs {
        r.r#in = match r.cut_in {
            Some(c) => (c.at - r.fade_in / 2).max(0),
            None => 0,
        };
        r.out = match r.cut_out {
            Some(c) => (c.at + r.fade_out - r.fade_out / 2).min(frames),
            None => frames,
        };
        r.start = start;
        start = r.end() - r.fade_out;
    }
    fragments.sort_by_key(|(k, _)| *k);
    (runs, fragments)
}

/// The expansion at check.
pub fn expand(req: &Request<'_>) -> Result<Lowered, Vec<Refusal>> {
    lower(req.doc, req.id, req.item, req.reads)
}

/// The recipe `id` of `doc` lowered: each run a strip, each strip's picture for a recording with
/// video, and the report.
pub fn lower(
    doc: &Value,
    id: &str,
    item: &Value,
    reads: Option<&dyn Reads>,
) -> Result<Lowered, Vec<Refusal>> {
    let plan = plan(doc, id, item, reads)?;
    let f = |s: i64| plan.flicks(s);
    let fade = |n: i64| json!({"length": f(n), "curve": "equal_power"});
    let mut strips = Map::new();
    for (k, r) in plan.runs.iter().enumerate() {
        let mut strip = json!({"track": 0, "src": {"asset": plan.asset}, "start": f(r.start), "in": f(r.r#in), "out": f(r.out)});
        if r.cut_in.is_some() {
            strip["fade_in"] = fade(r.fade_in);
        }
        if r.cut_out.is_some() {
            strip["fade_out"] = fade(r.fade_out);
        }
        strips.insert(format!("{id}.s{}", k + 1), strip);
    }
    let mut out = Lowered::default();
    if plan.pcm.video && !plan.runs.is_empty() {
        pictures((doc, id, item), &plan, &mut out);
    }
    out.sections.insert("strips".into(), Value::Object(strips));
    let cuts: Vec<Value> = plan
        .runs
        .iter()
        .flat_map(|r| {
            let side = |c: Option<Cut>, word: usize, side: &str| {
                c.map(|c| json!({"word": word, "side": side, "raw": f(c.raw), "at": f(c.at), "sample": c.at}))
            };
            side(r.cut_in, r.first, "in")
                .into_iter()
                .chain(side(r.cut_out, r.last, "out"))
        })
        .collect();
    let fragments: Vec<Value> = plan
        .fragments
        .iter()
        .map(|(k, why)| json!({"word": k, "text": plan.words[*k].text, "why": why}))
        .collect();
    out.report.insert("removed".into(), json!(plan.removed));
    out.report
        .insert("fragments".into(), Value::Array(fragments));
    out.report.insert("cuts".into(), Value::Array(cuts));
    Ok(out)
}

/// Each strip's picture, an `image@1` of the recording on its strip's clock, shown from the frame
/// nearest the splice before it to the one nearest the splice after it.
fn pictures((doc, id, item): (&Value, &str, &Value), plan: &Plan, out: &mut Lowered) {
    let (num, den) = doc
        .get("transport")
        .and_then(deep_canvas::document::frame_rate_of)
        .unwrap_or((60, 1));
    let frame = (i128::from(FLICKS) * i128::from(den) / i128::from(num.max(1))) as i64;
    let nearest = |t: i64| (t + frame / 2).div_euclid(frame.max(1)) * frame;
    let size = doc.get("size").cloned().unwrap_or(json!([0, 0]));
    let (w, h) = (size.get(0).cloned(), size.get(1).cloned());
    let name = item
        .get("name")
        .and_then(Value::as_str)
        .unwrap_or(id)
        .to_string();
    let order = item.get("order").cloned().unwrap_or(Value::Null);
    let n = plan.runs.len();
    let mut cuts: Vec<i64> = vec![0];
    for r in &plan.runs[1..] {
        cuts.push(nearest(plan.flicks(r.at(r.from()))));
    }
    let end = plan.flicks(plan.runs[n - 1].end());
    cuts.push(
        end.div_euclid(frame.max(1)) * frame + if end % frame.max(1) == 0 { 0 } else { frame },
    );
    let mut channels = Map::new();
    for (k, r) in plan.runs.iter().enumerate() {
        let pid = format!("{id}.p{}", k + 1);
        out.items.insert(
            pid.clone(),
            json!({"id": pid, "kind": "image@1", "name": format!("{name} picture {}", k + 1), "order": order,
                "params": {"asset": plan.asset, "box": [0, 0, w, h], "fit": "contain",
                    "alt": format!("{name}: words {} to {}", r.first, r.last),
                    "frames": {"start": plan.flicks(r.start), "in": plan.flicks(r.r#in), "rate": [1, 1]}}}),
        );
        let (from, to) = (cuts[k], cuts[k + 1]);
        let mut keys = Vec::new();
        if from > 0 {
            keys.push((0, false));
        }
        if to > from {
            keys.push((from, true));
        }
        // The last picture of a strip that plays to the recording's end stays, holding its last
        // frame as a video does; one that ends on a cut never shows what the cut removed.
        if k + 1 < n || r.cut_out.is_some() || to <= from {
            keys.push((to.max(from), false));
        }
        let keyed: Map<String, Value> = keys
            .iter()
            .enumerate()
            .map(|(i, (t, v))| {
                (
                    format!("k{i:04}"),
                    json!({"t": t, "value": v, "interp": "hold"}),
                )
            })
            .collect();
        channels.insert(
            format!("{pid}.shown"),
            json!({"target": format!("items/{pid}/visible"), "type": "bool", "keys": keyed}),
        );
    }
    out.sections
        .insert("channels".into(), Value::Object(channels));
}

/// The longest run of tokens the expected and heard lists share, in order, as ops: a token
/// outside it is missing (expected) or extra (heard), so a removed word heard where a kept one
/// should be reads as both, never as one paired with the other.
fn common(a: &[heard::Tok], b: &[heard::Tok]) -> Vec<Op> {
    let (n, m) = (a.len(), b.len());
    let mut d = vec![vec![0u32; m + 1]; n + 1];
    for i in (0..n).rev() {
        for j in (0..m).rev() {
            d[i][j] = if heard::heard_eq(&a[i], &b[j]) {
                d[i + 1][j + 1] + 1
            } else {
                d[i + 1][j].max(d[i][j + 1])
            };
        }
    }
    let (mut i, mut j) = (0, 0);
    let mut out = Vec::with_capacity(n + m);
    while i < n || j < m {
        if i < n && j < m && heard::heard_eq(&a[i], &b[j]) && d[i][j] == d[i + 1][j + 1] + 1 {
            out.push(Op::Same(i, j));
            i += 1;
            j += 1;
        } else if i < n && (j == m || d[i + 1][j] >= d[i][j + 1]) {
            out.push(Op::Del(i));
            i += 1;
        } else {
            out.push(Op::Ins(j));
            j += 1;
        }
    }
    out
}

/// What a transcript of a cut result says against the plan: each kept word lost (missing or
/// heard as another) and each removed word heard, `(word, text, t)` with t in document flicks.
pub struct Heard {
    pub lost: Vec<(usize, String, i64)>,
    pub left: Vec<(usize, String, i64)>,
}

/// The transcript `said` after normalizer@1, aligned with the kept words' texts in order.
pub fn heard(plan: &Plan, said: &str) -> Heard {
    let kept = plan.kept();
    let mut expected: Vec<heard::Tok> = Vec::new();
    let mut owner: Vec<usize> = Vec::new();
    for (p, (_, text, _)) in kept.iter().enumerate() {
        for t in heard::normalize(text) {
            expected.push(t);
            owner.push(p);
        }
    }
    let toks = heard::normalize(said);
    let ops = common(&expected, &toks);
    let mut lost = BTreeSet::new();
    // Each extra heard token with the kept position it follows (none before the first).
    let mut extras: Vec<(Option<usize>, &heard::Tok)> = Vec::new();
    let mut after: Option<usize> = None;
    for op in &ops {
        match *op {
            Op::Same(i, _) => after = Some(owner[i]),
            Op::Sub(i, _) | Op::Del(i) => {
                lost.insert(owner[i]);
                after = Some(owner[i]);
            }
            Op::Ins(j) => extras.push((after, &toks[j])),
        }
    }
    let lost = lost
        .into_iter()
        .map(|p| (kept[p].0, kept[p].1.to_string(), kept[p].2))
        .collect();
    // A removed word is heard when its tokens stand among the extras, those where it was taken
    // out first.
    let mut used = vec![false; extras.len()];
    let mut left = Vec::new();
    let gap_of = |p: Option<usize>| -> (usize, usize) {
        let lo = p.map_or(0, |p| kept[p].0 + 1);
        let hi = kept
            .get(p.map_or(0, |p| p + 1))
            .map_or(plan.words.len(), |k| k.0);
        (lo, hi)
    };
    for pass in 0..2 {
        for &k in &plan.removed {
            if left.iter().any(|(w, _, _)| *w == k) {
                continue;
            }
            let want = heard::normalize(&plan.words[k].text);
            if want.is_empty() {
                continue;
            }
            let found = (0..extras.len()).find(|&s| {
                s + want.len() <= extras.len()
                    && (0..want.len()).all(|i| {
                        !used[s + i]
                            && extras[s + i].0 == extras[s].0
                            && heard::heard_eq(&want[i], extras[s + i].1)
                    })
                    && (pass == 1 || {
                        let (lo, hi) = gap_of(extras[s].0);
                        (lo..hi).contains(&k)
                    })
            });
            if let Some(s) = found {
                used[s..s + want.len()].iter_mut().for_each(|u| *u = true);
                left.push((k, plan.words[k].text.clone(), plan.removed_at(k)));
            }
        }
    }
    left.sort_by_key(|(k, _, _)| *k);
    Heard { lost, left }
}

/// `cut.words@1`'s registration: the kind and its expansion at check.
pub(crate) fn register(r: &mut deep_canvas::registry::Registrar) {
    use deep_canvas::kinds::{Entry, Param, ParamType, Version};
    let json = |(name, form, default): (&'static str, &'static str, Value)| Param {
        name,
        ty: ParamType::Json(form),
        unit: "",
        default,
        min: None,
        max: None,
        minor: 0,
        module: "",
        operator: "",
    };
    let fields = [
        ("recording", "name", Value::Null),
        ("keep", "[index | [first: index, last: index]]", json!([])),
        ("search", "ms", json!(200)),
        (
            "crossfade",
            "{min?: ms, max?: ms}",
            json!({"min": 5, "max": 40}),
        ),
    ];
    r.kind(
        Entry {
            family: "cut",
            name: "words",
            versions: vec![Version {
                major: 1,
                minor: 0,
                params: fields.into_iter().map(json).collect(),
            }],
            migrations: vec![],
        },
        &[],
        "",
    );
    r.expands(KIND, expand);
}

#[cfg(test)]
mod tests {
    use super::*;

    const RATE: i64 = 48_000;

    /// A PCM of 1 kHz tone bursts at the given sample spans, silence elsewhere, `noise` added
    /// throughout as a small alternating offset.
    fn pcm(spans: &[(i64, i64)], frames: i64, noise: f32) -> Sound {
        let mut samples = vec![0f32; frames as usize];
        for (i, x) in samples.iter_mut().enumerate() {
            *x = if i % 2 == 0 { noise } else { -noise };
        }
        for &(a, b) in spans {
            for n in a..b {
                let t = n as f64 / RATE as f64;
                samples[n as usize] +=
                    (0.5 * (std::f64::consts::TAU * 1000.0 * t + 0.3).sin()) as f32;
            }
        }
        Sound {
            rate: RATE,
            channels: 1,
            samples,
            sha256: String::new(),
            video: false,
        }
    }

    fn word(a: i64, b: i64) -> Word {
        Word {
            text: "w".into(),
            start: a,
            end: b,
        }
    }

    const S: Settings = Settings {
        search: 9_600,
        min: 240,
        max: 1_920,
    };

    /// A cut whose stated edge is 150 ms late still lands in the silence before its word, on a
    /// zero crossing; the planted recipe lands on the raw point inside the word.
    #[test]
    fn a_cut_moves_onto_quiet_and_a_zero_crossing() {
        // Words at [0.2, 0.6) and [0.8, 1.2) s; the record states the second 150 ms late.
        let p = pcm(&[(9_600, 28_800), (38_400, 57_600)], 72_000, 0.0);
        let (left, right) = (word(9_600, 28_800), word(38_400 + 7_200, 57_600 + 7_200));
        let at = place(&p, &left, &right, right.start, &S, Plants::default());
        assert!((28_800 + 960..=38_400 - 960).contains(&at), "{at}");
        let x = |n: i64| mono(&p, n);
        assert!(x(at) == 0.0 || (x(at) < 0.0) != (x(at - 1) < 0.0));
        let planted = Plants {
            raw: true,
            silent: false,
        };
        assert_eq!(
            place(&p, &left, &right, right.start, &S, planted),
            right.start
        );
    }

    /// A kept word of 30 ms between two cuts is dropped and listed; the planted recipe drops it
    /// and lists nothing; the cuts either side join as one splice.
    #[test]
    fn a_fragment_too_short_for_its_crossfades_is_listed() {
        // Five words, the middle one 30 ms long; with no search its cuts sit at its own edges.
        let spans = [(4_800, 14_400), (24_000, 25_440), (36_000, 45_600)];
        let p = pcm(&spans, 52_800, 0.0);
        let ws = [
            spans[0],
            (15_000, 23_000),
            spans[1],
            (26_000, 35_000),
            spans[2],
        ]
        .map(|(a, b)| word(a, b));
        let keep: BTreeSet<usize> = [0, 2, 4].into_iter().collect();
        let s = Settings { search: 0, ..S };
        let (runs, fragments) = lay(&p, &ws, &keep, &s, Plants::default());
        assert_eq!(fragments.iter().map(|f| f.0).collect::<Vec<_>>(), [2]);
        assert_eq!(runs.iter().map(|r| r.first).collect::<Vec<_>>(), [0, 4]);
        let planted = Plants {
            raw: false,
            silent: true,
        };
        let (runs, none) = lay(&p, &ws, &keep, &s, planted);
        assert!(none.is_empty());
        assert_eq!(runs.len(), 2);
    }

    /// Strips chain on one clock: each next strip starts its crossfade before the one before it
    /// ends, and a run that keeps the first word starts at the PCM's start with no fade.
    #[test]
    fn strips_overlap_by_their_crossfades() {
        let spans = [(4_800, 14_400), (24_000, 33_600), (43_200, 52_800)];
        let p = pcm(&spans, 60_000, 0.0);
        let ws: Vec<Word> = spans.iter().map(|&(a, b)| word(a, b)).collect();
        let keep: BTreeSet<usize> = [0, 2].into_iter().collect();
        let (runs, _) = lay(&p, &ws, &keep, &S, Plants::default());
        assert_eq!(runs.len(), 2);
        assert_eq!((runs[0].r#in, runs[0].fade_in), (0, 0));
        assert_eq!(runs[1].start, runs[0].end() - runs[0].fade_out);
        assert_eq!(runs[0].fade_out, runs[1].fade_in);
        assert_eq!(runs[1].out, 60_000);
    }

    /// A removed word heard where a kept one should be names both: the kept one lost, the removed
    /// one left, never one paired with the other.
    #[test]
    fn a_removed_word_heard_in_a_kept_ones_place_is_named_left() {
        let spans = [
            (0, 4_800),
            (9_600, 14_400),
            (19_200, 24_000),
            (28_800, 33_600),
            (38_400, 43_200),
        ];
        let p = pcm(&spans, 48_000, 0.0);
        let words: Vec<Word> = ["the", "red", "fox", "ran", "home"]
            .iter()
            .zip(spans)
            .map(|(t, (a, b))| Word {
                text: t.to_string(),
                ..word(a, b)
            })
            .collect();
        let keep: BTreeSet<usize> = [0, 2, 3, 4].into_iter().collect();
        let (runs, fragments) = lay(&p, &words, &keep, &S, Plants::default());
        let plan = Plan {
            asset: String::new(),
            pcm: Arc::new(p),
            words,
            runs,
            removed: vec![1],
            fragments,
            records: Vec::new(),
        };
        let h = heard(&plan, "The red, fox home.");
        assert_eq!(h.lost.iter().map(|w| w.0).collect::<Vec<_>>(), [3]);
        assert_eq!(
            h.left.iter().map(|w| (w.0, w.2)).collect::<Vec<_>>(),
            [(1, plan.removed_at(1))]
        );
        assert!(heard(&plan, "the fox ran home").lost.is_empty());
    }
}

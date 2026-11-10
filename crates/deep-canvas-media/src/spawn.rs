//! Issue #500: a Spawn's voices (canvas primitives: Spawn, Spawn: variants), planned once as a
//! fold over a baked occurrence list in flick order. Cooldowns, voice steals and variant picks are
//! decided here, before playback, so a seek reads the same voices as a play and nothing depends on
//! CPU load or a live meter.

use sha2::{Digest, Sha256};

/// How a voice's template is picked from the weighted list.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Pick {
    Weighted,
    /// Never the previous pick of the same spawn.
    NoRepeat,
}

/// Which live voice gives way past `max_voices`.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Steal {
    Oldest,
    Furthest,
    Quietest,
    /// The new voice doesn't start.
    None,
}

pub struct Plan {
    pub id: String,
    pub seed: String,
    /// Each template's weight.
    pub weights: Vec<f64>,
    pub pick: Pick,
    pub cooldown: i64,
    pub max_voices: usize,
    pub steal: Steal,
}

/// One occurrence as the planner reads it, in list order sorted by flick.
pub struct Occ {
    /// Its flick, which the cooldown reads.
    pub t: i64,
    /// Where its voice starts (its parent flick under a time remap, else `t`).
    pub start: i64,
    /// Its pair (a, b), whose cooldown it shares.
    pub pair: (String, String),
    /// The spawn's evaluated gain for it, linear, which `quietest` reads.
    pub gain: f64,
    /// Its distance to the listener, which `furthest` reads.
    pub distance: f64,
}

#[derive(Clone, Debug, PartialEq)]
pub struct Voice {
    /// The occurrence's index in the list.
    pub occurrence: usize,
    pub template: usize,
    pub start: i64,
    /// The flick a later voice stole it at, if one did.
    pub stop: Option<i64>,
    /// The index of the voice that stole it.
    pub stolen_by: Option<usize>,
}

/// A uniform draw in [0, 1) from hash(seed, spawn ID, occurrence index, round).
fn draw(seed: &str, id: &str, index: usize, round: u32) -> f64 {
    let mut h = Sha256::new();
    for part in [seed.as_bytes(), &[0], id.as_bytes(), &[0]] {
        h.update(part);
    }
    h.update((index as u64).to_le_bytes());
    h.update(round.to_le_bytes());
    let d = h.finalize();
    let top = u64::from_be_bytes(d[..8].try_into().unwrap_or_default()) >> 11;
    top as f64 / (1u64 << 53) as f64
}

/// The template a draw `u` picks from `weights`, leaving out `skip`.
fn weighted(weights: &[f64], u: f64, skip: Option<usize>) -> usize {
    let w = |i: usize| if Some(i) == skip { 0.0 } else { weights[i].max(0.0) };
    let total: f64 = (0..weights.len()).map(w).sum();
    if total <= 0.0 {
        return (0..weights.len()).find(|&i| Some(i) != skip).unwrap_or(0);
    }
    let mut at = u * total;
    for i in 0..weights.len() {
        if w(i) > 0.0 && at < w(i) {
            return i;
        }
        at -= w(i);
    }
    (0..weights.len()).rev().find(|&i| w(i) > 0.0).unwrap_or(0)
}

/// Every voice the spawn plays over `occs` (sorted by `t`, ties in list order); `span` is a
/// template's length, so the planner knows which voices still sound when another starts.
pub fn plan(p: &Plan, occs: &[Occ], span: impl Fn(usize) -> i64) -> Vec<Voice> {
    let mut voices: Vec<Voice> = Vec::new();
    let mut last: Vec<(&(String, String), i64)> = Vec::new();
    let mut prev: Option<usize> = None;
    for (i, o) in occs.iter().enumerate() {
        if last.iter().any(|(pair, t)| *pair == &o.pair && o.t - t < p.cooldown) {
            continue;
        }
        let template = if p.weights.is_empty() {
            0
        } else {
            let skip = (p.pick == Pick::NoRepeat && p.weights.len() > 1).then_some(prev).flatten();
            weighted(&p.weights, draw(&p.seed, &p.id, i, 0), skip)
        };
        let ends = |v: &Voice| v.stop.unwrap_or(v.start + span(v.template));
        let live: Vec<usize> = (0..voices.len())
            .filter(|&k| voices[k].start <= o.start && ends(&voices[k]) > o.start)
            .collect();
        if live.len() >= p.max_voices.max(1) {
            // Ties by start flick, then the occurrence's place in the list (its stable ID).
            let key = |k: &usize| (voices[*k].start, voices[*k].occurrence);
            let victim = match p.steal {
                Steal::None => None,
                Steal::Oldest => live.iter().min_by_key(|k| key(k)),
                Steal::Furthest => live.iter().min_by(|a, b| {
                    let (da, db) = (occs[voices[**a].occurrence].distance, occs[voices[**b].occurrence].distance);
                    db.total_cmp(&da).then(key(a).cmp(&key(b)))
                }),
                Steal::Quietest => live.iter().min_by(|a, b| {
                    let (ga, gb) = (occs[voices[**a].occurrence].gain, occs[voices[**b].occurrence].gain);
                    ga.total_cmp(&gb).then(key(a).cmp(&key(b)))
                }),
            };
            let Some(&victim) = victim else { continue };
            voices[victim].stop = Some(o.start);
            voices[victim].stolen_by = Some(voices.len());
        }
        match last.iter_mut().find(|(pair, _)| *pair == &o.pair) {
            Some(l) => l.1 = o.t,
            None => last.push((&o.pair, o.t)),
        }
        prev = Some(template);
        voices.push(Voice { occurrence: i, template, start: o.start, stop: None, stolen_by: None });
    }
    voices
}

#[cfg(test)]
mod tests {
    use super::*;

    const MS: i64 = crate::FLICKS / 1000;

    fn occ(t: i64, a: &str) -> Occ {
        Occ { t, start: t, pair: (a.into(), "floor".into()), gain: 1.0, distance: 0.0 }
    }

    fn spawn(weights: Vec<f64>, pick: Pick) -> Plan {
        Plan { id: "steps".into(), seed: "7".into(), weights, pick, cooldown: 30 * MS, max_voices: 8, steal: Steal::Oldest }
    }

    #[test]
    fn a_pair_cools_down_while_another_pair_plays() {
        let mut occs: Vec<Occ> = (0..20).map(|k| occ(k * MS, "ball")).collect();
        occs.push(occ(10 * MS, "cup"));
        occs.sort_by_key(|o| o.t);
        let v = plan(&spawn(vec![1.0], Pick::Weighted), &occs, |_| 1000 * MS);
        let pairs: Vec<&str> = v.iter().map(|v| occs[v.occurrence].pair.0.as_str()).collect();
        assert_eq!(pairs, ["ball", "cup"]);
        // Past the cooldown the pair plays again.
        let occs = [occ(0, "ball"), occ(30 * MS, "ball")];
        assert_eq!(plan(&spawn(vec![1.0], Pick::Weighted), &occs, |_| MS).len(), 2);
    }

    #[test]
    fn a_ninth_voice_steals_the_earliest_started() {
        let occs: Vec<Occ> = (0..9).map(|k| occ(k * 100 * MS, &format!("b{k}"))).collect();
        let v = plan(&spawn(vec![1.0], Pick::Weighted), &occs, |_| 10_000 * MS);
        assert_eq!(v.len(), 9);
        assert_eq!((v[0].stop, v[0].stolen_by), (Some(800 * MS), Some(8)));
        assert!(v[1..].iter().all(|v| v.stop.is_none()));
        let mut none = spawn(vec![1.0], Pick::Weighted);
        none.steal = Steal::None;
        assert_eq!(plan(&none, &occs, |_| 10_000 * MS).len(), 8);
        let mut quiet = spawn(vec![1.0], Pick::Weighted);
        quiet.steal = Steal::Quietest;
        let mut occs = occs;
        occs[3].gain = 0.1;
        assert_eq!(plan(&quiet, &occs, |_| 10_000 * MS)[3].stop, Some(800 * MS));
    }

    #[test]
    fn no_repeat_never_repeats_and_picks_are_a_function_of_the_list() {
        let occs: Vec<Occ> = (0..1000).map(|k| occ(k * 100 * MS, "ball")).collect();
        let p = spawn(vec![1.0, 1.0, 2.0], Pick::NoRepeat);
        let v = plan(&p, &occs, |_| MS);
        assert_eq!(v.len(), 1000);
        assert!(v.windows(2).all(|w| w[0].template != w[1].template));
        assert_eq!(v, plan(&p, &occs, |_| MS));
        // Weighted picks repeat sometimes and follow the weights.
        let w = plan(&spawn(vec![1.0, 1.0, 2.0], Pick::Weighted), &occs, |_| MS);
        assert!(w.windows(2).any(|w| w[0].template == w[1].template));
        let heavy = w.iter().filter(|v| v.template == 2).count();
        assert!((400..600).contains(&heavy), "{heavy}");
    }
}

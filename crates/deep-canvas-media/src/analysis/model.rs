//! Issue #1819: the readings the analysis bake's model kinds derive from a model's recorded frames
//! (canvas primitives: Analysis bake). A pinned model runs as a runner job and records its frames
//! once; these rules read that record, so the same record re-checks to an exact match here.

/// A beats bake's tempo in beats per minute: 60 ÷ the least-squares slope of beat time over beat
/// number, so each beat's rounding to a model frame averages out. Beats are numbered by the
/// median interval, so a missed beat keeps its place; a tempo outside `range` is halved or
/// doubled into it. None with fewer than two beats.
pub fn tempo(beats: &[i64], flicks: i64, range: (f64, f64)) -> Option<f64> {
    if beats.len() < 2 {
        return None;
    }
    let t: Vec<f64> = beats.iter().map(|b| *b as f64 / flicks as f64).collect();
    let mut gaps: Vec<f64> = t.windows(2).map(|w| w[1] - w[0]).collect();
    gaps.sort_by(f64::total_cmp);
    let p0 = gaps[gaps.len() / 2];
    if p0 <= 0.0 {
        return None;
    }
    let k: Vec<f64> = t.iter().map(|x| ((x - t[0]) / p0).round()).collect();
    let n = t.len() as f64;
    let (km, tm) = (k.iter().sum::<f64>() / n, t.iter().sum::<f64>() / n);
    let (mut num, mut den) = (0.0, 0.0);
    for (a, b) in k.iter().zip(&t) {
        num += (a - km) * (b - tm);
        den += (a - km) * (a - km);
    }
    if den == 0.0 || num <= 0.0 {
        return None;
    }
    let mut bpm = 60.0 * den / num;
    while bpm > range.1 && bpm / 2.0 >= range.0 {
        bpm /= 2.0;
    }
    while bpm < range.0 && bpm * 2.0 <= range.1 {
        bpm *= 2.0;
    }
    Some(bpm)
}

/// An activity bake's speech spans, as [start, end) in flicks: the runs of frames whose speech
/// probability is at least `threshold`, each from its first frame's start to its last frame's
/// end, with runs less than `JOIN` apart joined and runs shorter than `SHORTEST` dropped.
pub fn spans(speech: &[f64], frame: i64, threshold: f64) -> Vec<(i64, i64)> {
    let mut runs: Vec<(i64, i64)> = Vec::new();
    let mut open: Option<usize> = None;
    for (i, p) in speech.iter().chain([&f64::NEG_INFINITY]).enumerate() {
        match (open, *p >= threshold) {
            (None, true) => open = Some(i),
            (Some(s), false) => {
                let (start, end) = (s as i64 * frame, i as i64 * frame);
                match runs.last_mut() {
                    Some(last) if start - last.1 < JOIN => last.1 = end,
                    _ => runs.push((start, end)),
                }
                open = None;
            }
            _ => {}
        }
    }
    runs.retain(|(s, e)| e - s >= SHORTEST);
    runs
}

/// Runs of speech less than 0.3 s apart are one span: a pause inside a sentence isn't its end.
pub const JOIN: i64 = crate::FLICKS * 3 / 10;
/// A run shorter than 0.1 s isn't speech: a click or a note's attack can cross the threshold.
pub const SHORTEST: i64 = crate::FLICKS / 10;

/// The pinned viseme table: each ARPAbet phoneme's mouth shape, A to H; X is the rest shape.
pub const MAP: &str = "arpabet.visemes@1";

/// A phoneme's shape through [`MAP`], stress digits ignored; None for a phoneme it doesn't hold.
pub fn shape(phoneme: &str) -> Option<char> {
    let p = phoneme.trim_end_matches(|c: char| c.is_ascii_digit());
    Some(match p {
        "P" | "B" | "M" => 'A',
        "T" | "D" | "K" | "G" | "N" | "NG" | "S" | "Z" | "SH" | "ZH" | "CH" | "JH" | "TH" | "DH" | "Y" | "IY" | "IH" => 'B',
        "EH" | "AE" | "AH" | "EY" | "HH" => 'C',
        "AA" | "AY" | "AW" => 'D',
        "AO" | "ER" | "R" | "UH" | "OY" => 'E',
        "UW" | "OW" | "W" => 'F',
        "F" | "V" => 'G',
        "L" => 'H',
        _ => return None,
    })
}

/// One line of a visemes bake: its ID, its start in flicks, and its phonemes as (phoneme, start,
/// end) in flicks from the line's start, as its words record holds them.
pub struct Line<'a> {
    pub line: &'a str,
    pub at: i64,
    pub phonemes: Vec<(&'a str, i64, i64)>,
}

/// A viseme occurrence: its time in flicks, its shape, and its line.
#[derive(Clone, Debug, PartialEq)]
pub struct Viseme {
    pub t: i64,
    pub shape: char,
    pub line: String,
}

/// A visemes bake: each phoneme's shape placed `lead` before the phoneme starts, since a drawn
/// mouth forms before the voice is heard, and X at each line's last phoneme's end, held until the
/// next line's first shape. In time order; Err names a phoneme the table doesn't hold.
pub fn visemes(lines: &[Line], lead: i64) -> Result<Vec<Viseme>, String> {
    let mut out = Vec::new();
    for l in lines {
        for (p, start, _) in &l.phonemes {
            let shape = shape(p).ok_or_else(|| format!("{MAP} holds no phoneme {p}"))?;
            out.push(Viseme { t: l.at + start - lead, shape, line: l.line.to_string() });
        }
        if let Some((_, _, end)) = l.phonemes.last() {
            out.push(Viseme { t: l.at + end, shape: 'X', line: l.line.to_string() });
        }
    }
    out.sort_by_key(|v| v.t);
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::FLICKS;

    #[test]
    fn tempo_at_96_bpm_on_20_ms_frames() {
        // 625 ms beats rounded to 20 ms frames: a median interval reads 93.75 or 96.77.
        let frame = FLICKS / 50;
        let beats: Vec<i64> = (0..32).map(|k| ((k as f64 * 31.25).round() as i64) * frame).collect();
        let bpm = tempo(&beats, FLICKS, (55.0, 215.0)).unwrap();
        assert!((bpm - 96.0).abs() < 0.1, "{bpm}");
    }

    #[test]
    fn each_shape_leads_its_phoneme() {
        let f = FLICKS / 24;
        let line = Line { line: "l1", at: 10 * f, phonemes: vec![("M", 0, 2 * f), ("AA1", 2 * f, 5 * f)] };
        let v = visemes(&[line], f).unwrap();
        assert_eq!(v.iter().map(|v| (v.t, v.shape)).collect::<Vec<_>>(), vec![(9 * f, 'A'), (11 * f, 'D'), (15 * f, 'X')]);
    }
}

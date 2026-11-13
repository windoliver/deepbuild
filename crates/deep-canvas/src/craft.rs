//! Issue #409: craft@1 (canvas primitives: Film audit: craft@1). Its checks' table, `craft.json`:
//! each check's name, its fields' defaults, and its own description, threshold and fix, which the
//! check registry lists and `scripts/skill.mjs` writes into the skill, so the rule an agent reads
//! is the rule the check runs. And its measures, as pure functions over what the caller read from
//! the evaluated film: the share of 1/12 s frame pairs that move, read the way an export's 12 fps,
//! 320 px gray resample reads them; the blank runs in that resample; each shot's camera move,
//! classed by what the camera does; whether a cut between two shots that keep one item turns or
//! resizes it enough; and which side of a line a camera is on.

use std::sync::OnceLock;

use serde_json::Value;

/// The pack's name, as its checks' registry entries give it.
pub const PACK: &str = "craft@1";

/// One craft@1 check as `craft.json` states it.
#[derive(Clone, Debug)]
pub struct Check {
    pub name: String,
    /// Its fields at their defaults, which a brief's entry overrides.
    pub defaults: Value,
    pub description: String,
    pub threshold: String,
    pub fix: String,
}

/// Every craft@1 check, in the table's order.
pub fn checks() -> &'static [Check] {
    static TABLE: OnceLock<Vec<Check>> = OnceLock::new();
    TABLE.get_or_init(|| {
        let table: Value = serde_json::from_str(include_str!("craft.json")).unwrap_or_default();
        let text = |c: &Value, k: &str| c[k].as_str().unwrap_or_default().to_string();
        table["checks"]
            .as_array()
            .into_iter()
            .flatten()
            .map(|c| Check {
                name: text(c, "name"),
                defaults: c["defaults"].clone(),
                description: text(c, "description"),
                threshold: text(c, "threshold"),
                fix: text(c, "fix"),
            })
            .collect()
    })
}

/// The check `name`, if craft@1 has it.
pub fn check(name: &str) -> Option<&'static Check> {
    checks().iter().find(|c| c.name == name)
}

/// The analysis rate and width of the motion share (frame differences at 12 fps, 320 px wide).
pub const ANALYSIS_FPS: f64 = 12.0;
pub const ANALYSIS_WIDTH: f64 = 320.0;
/// A pair counts as motion when its mean difference is at least this many gray levels.
pub const FAST_LEVELS: f64 = 9.0;
/// A frame is blank when under this share of its pixels has a gradient over [`BLANK_GRADIENT`]
/// levels; the first and last [`BLANK_EDGE`] seconds aren't read.
pub const BLANK_GRADIENT: f32 = 24.0;
pub const BLANK_SHARE: f64 = 0.002;
pub const BLANK_EDGE: f64 = 0.5;

/// The source frame each analysis slot shows, for a film of `frames` frames at `fps`: as a
/// 12 fps resample takes them, slot k shows the last source frame whose time rounds to it.
pub fn slots(frames: usize, fps: f64) -> Vec<usize> {
    if frames == 0 || fps <= 0.0 {
        return Vec::new();
    }
    let n = (frames as f64 * ANALYSIS_FPS / fps).round() as usize;
    (0..n)
        .map(|k| {
            let j = ((k as f64 + 0.5) * fps / ANALYSIS_FPS - 1e-9).ceil() as usize;
            j.saturating_sub(1).min(frames - 1)
        })
        .collect()
}

/// The analysis frame's height for a film of `w` × `h`: 320 px wide, an even height.
pub fn analysis_height(w: f64, h: f64) -> usize {
    ((h * ANALYSIS_WIDTH / w.max(1.0) / 2.0).round() * 2.0).max(2.0) as usize
}

/// A frame's gray levels as an export carries them: BT.709 luma in limited range, read back in
/// full range.
pub fn gray(rgba: &[u8]) -> Vec<u8> {
    rgba.as_chunks::<4>()
        .0
        .iter()
        .map(|p| {
            let y = 0.2126 * f64::from(p[0]) + 0.7152 * f64::from(p[1]) + 0.0722 * f64::from(p[2]);
            let coded = (16.0 + 219.0 * y / 255.0).round().clamp(16.0, 235.0);
            ((coded - 16.0) * 255.0 / 219.0).round() as u8
        })
        .collect()
}

/// The rows a frame of height `h` keeps once its caption band, a share `band` of its height at
/// the bottom, is masked.
pub fn kept_rows(h: usize, band: f64) -> usize {
    ((h as f64 * (1.0 - band.clamp(0.0, 1.0))).round() as usize).min(h)
}

/// The motion share's reading: each pair's mean difference (None where a cut or a cross-fade
/// leaves it out), and how many pairs moved.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Motion {
    pub diffs: Vec<Option<f64>>,
    pub fast: usize,
    pub counted: usize,
}

impl Motion {
    /// The share of counted pairs that moved; 0 with none counted.
    pub fn share(&self) -> f64 {
        if self.counted == 0 {
            0.0
        } else {
            self.fast as f64 / self.counted as f64
        }
    }
}

/// The motion share of `frames` (gray, `w` px wide, each holding at least `rows` rows, the caption
/// band's rows below them left unread): pair k is frames k and k + 1, and `left_out[k]` drops it.
pub fn motion(frames: &[Vec<u8>], w: usize, rows: usize, left_out: &[bool]) -> Motion {
    let mut out = Motion::default();
    let n = rows * w;
    for k in 0..frames.len().saturating_sub(1) {
        if left_out.get(k).copied().unwrap_or(false) || n == 0 {
            out.diffs.push(None);
            continue;
        }
        let (a, b) = (&frames[k][..n], &frames[k + 1][..n]);
        let sum: u64 = a
            .iter()
            .zip(b)
            .map(|(x, y)| u64::from(x.abs_diff(*y)))
            .sum();
        let d = sum as f64 / n as f64;
        out.counted += 1;
        if d >= FAST_LEVELS {
            out.fast += 1;
        }
        out.diffs.push(Some(d));
    }
    out
}

/// Each pair's mean difference over the first `rows` rows of `frames` (gray, `w` px wide).
pub fn diffs(frames: &[Vec<u8>], w: usize, rows: usize) -> Vec<f64> {
    let n = rows * w;
    frames
        .windows(2)
        .map(|p| {
            let sum: u64 = p[0][..n]
                .iter()
                .zip(&p[1][..n])
                .map(|(x, y)| u64::from(x.abs_diff(*y)))
                .sum();
            sum as f64 / n.max(1) as f64
        })
        .collect()
}

/// The pairs that jump like a cut while the camera holds `still`: a mean difference of at least
/// 8 levels and at least 3 times the median of the 12 pairs around it, plus 2. An export shows
/// such a jump as a cut, so the motion share leaves it out like one.
pub fn jumps(diffs: &[f64], still: &[bool]) -> Vec<bool> {
    let n = diffs.len();
    (0..n)
        .map(|i| {
            let mut around: Vec<f64> = diffs[i.saturating_sub(6)..i]
                .iter()
                .chain(&diffs[i + 1..(i + 7).min(n)])
                .copied()
                .collect();
            around.sort_by(f64::total_cmp);
            let k = around.len();
            let median = match k {
                0 => 0.0,
                _ if k % 2 == 1 => around[k / 2],
                _ => (around[k / 2 - 1] + around[k / 2]) / 2.0,
            };
            still.get(i).copied().unwrap_or(true) && diffs[i] >= 8.0_f64.max(3.0 * median + 2.0)
        })
        .collect()
}

/// The pairs inside a cross-fade an export shows, cut or not by the timeline: a window of 2 × 2,
/// 3, 5, 8 or 12 pairs, none of them `cut_like`, whose steps share the change (none over 75% of
/// it, 10 levels in all), whose ends differ over the frame (10 levels on average, over 20 levels
/// at a fifth of its pixels), and whose middle frames are blends of its ends: each frame's share
/// of the first end falls by no more than 0.08 a frame from over 0.55 to under 0.45, two or more
/// lie between 0.15 and 0.85, and what a blend leaves unexplained stays under 0.22 of the ends'
/// difference there and 0.25 overall. Overlapping windows: the one whose ends differ most, then
/// the one closest to a blend.
pub fn dissolves(
    frames: &[Vec<u8>],
    w: usize,
    rows: usize,
    diffs: &[f64],
    cut_like: &[bool],
) -> Vec<bool> {
    let (n, px) = (frames.len(), w * rows);
    let mut found: Vec<(usize, usize, f64, f64)> = Vec::new();
    for half in [2usize, 3, 5, 8, 12] {
        for t in half..n.saturating_sub(half) {
            let (a, b) = (t - half, t + half);
            if cut_like[a..b].iter().any(|c| *c) {
                continue;
            }
            let sum: f64 = diffs[a..b].iter().sum();
            if diffs[a..b].iter().any(|d| *d > 0.75 * sum) || sum < 10.0 {
                continue;
            }
            let (fa, fb) = (&frames[a][..px], &frames[b][..px]);
            let ends: Vec<f64> = fa
                .iter()
                .zip(fb)
                .map(|(x, y)| f64::from(*x) - f64::from(*y))
                .collect();
            let apart = ends.iter().map(|d| d.abs()).sum::<f64>() / px.max(1) as f64;
            let wide = ends.iter().filter(|d| d.abs() > 20.0).count() as f64 / px.max(1) as f64;
            if apart < 10.0 || wide < 0.20 {
                continue;
            }
            let norm = ends.iter().map(|d| d * d).sum::<f64>() + 1e-6;
            let (mut left, mut shares) = (Vec::new(), Vec::new());
            for f in &frames[a + 1..b] {
                let x: Vec<f64> = f[..px]
                    .iter()
                    .zip(fb)
                    .map(|(x, y)| f64::from(*x) - f64::from(*y))
                    .collect();
                let share = x.iter().zip(&ends).map(|(x, d)| x * d).sum::<f64>() / norm;
                let off = x
                    .iter()
                    .zip(&ends)
                    .map(|(x, d)| (x - share * d).abs())
                    .sum::<f64>()
                    / px.max(1) as f64;
                left.push(off / (apart + 1e-6));
                shares.push(share);
            }
            let falls = shares.windows(2).all(|p| p[1] - p[0] <= 0.08);
            let mid: Vec<f64> = shares
                .iter()
                .zip(&left)
                .filter(|(s, _)| **s > 0.15 && **s < 0.85)
                .map(|(_, l)| *l)
                .collect();
            let mean = |v: &[f64]| v.iter().sum::<f64>() / v.len().max(1) as f64;
            let (first, last) = (
                shares.first().copied().unwrap_or(0.0),
                shares.last().copied().unwrap_or(1.0),
            );
            if mid.len() >= 2
                && mean(&mid) < 0.22
                && mean(&left) < 0.25
                && falls
                && first > 0.55
                && last < 0.45
            {
                found.push((a, b, mean(&left), apart));
            }
        }
    }
    found.sort_by(|x, y| {
        (-x.3.round(), x.2)
            .partial_cmp(&(-y.3.round(), y.2))
            .unwrap_or(std::cmp::Ordering::Equal)
    });
    let mut out = vec![false; n.saturating_sub(1)];
    for (a, b, _, _) in found {
        if !out[a..b].iter().any(|x| *x) {
            out[a..b].fill(true);
        }
    }
    out
}

/// Whether a gray frame (`w` px wide, its first `rows` rows read) is blank: under 0.2% of its
/// pixels has a 3×3 Sobel gradient over 24 levels, borders reflected.
pub fn blank(frame: &[u8], w: usize, rows: usize) -> bool {
    if w == 0 || rows == 0 {
        return true;
    }
    let at = |x: isize, y: isize| -> f32 {
        let r = |v: isize, n: usize| -> usize {
            let n = n as isize;
            if n == 1 {
                return 0;
            }
            let v = if v < 0 {
                -v
            } else if v >= n {
                2 * n - 2 - v
            } else {
                v
            };
            v as usize
        };
        f32::from(frame[r(y, rows) * w + r(x, w)])
    };
    let mut edged = 0usize;
    for y in 0..rows as isize {
        for x in 0..w as isize {
            let gx = (at(x + 1, y - 1) + 2.0 * at(x + 1, y) + at(x + 1, y + 1))
                - (at(x - 1, y - 1) + 2.0 * at(x - 1, y) + at(x - 1, y + 1));
            let gy = (at(x - 1, y + 1) + 2.0 * at(x, y + 1) + at(x + 1, y + 1))
                - (at(x - 1, y - 1) + 2.0 * at(x, y - 1) + at(x + 1, y - 1));
            if gx.hypot(gy) > BLANK_GRADIENT {
                edged += 1;
            }
        }
    }
    (edged as f64) < BLANK_SHARE * (w * rows) as f64
}

/// The runs of blank analysis frames, `[first, end)` in slots: the first and last half second
/// aren't read, and both frames of a pair a cut or cross-fade leaves out break a run.
pub fn blank_runs(
    frames: &[Vec<u8>],
    w: usize,
    rows: usize,
    left_out: &[bool],
) -> Vec<(usize, usize)> {
    let n = frames.len();
    let edge = (BLANK_EDGE * ANALYSIS_FPS).round() as usize;
    let mut ok = vec![true; n];
    for (k, o) in ok.iter_mut().enumerate() {
        if k < edge || k + edge >= n {
            *o = false;
        }
    }
    for (k, out) in left_out.iter().enumerate() {
        if *out {
            for i in [k, k + 1] {
                if i < n {
                    ok[i] = false;
                }
            }
        }
    }
    let mut runs = Vec::new();
    let mut start = None;
    for k in 0..=n {
        let b = k < n && ok[k] && blank(&frames[k], w, rows);
        match (b, start) {
            (true, None) => start = Some(k),
            (false, Some(s)) => {
                runs.push((s, k));
                start = None;
            }
            _ => {}
        }
    }
    runs
}

/// A camera move, classed by what the camera does (Film audit: craft@1: camera_grammar).
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub enum Move {
    Hold,
    Push,
    Pull,
    Pan,
    Orbit,
}

impl Move {
    pub fn name(self) -> &'static str {
        match self {
            Move::Hold => "hold",
            Move::Push => "push",
            Move::Pull => "pull",
            Move::Pan => "pan",
            Move::Orbit => "orbit",
        }
    }
}

/// A camera at one time: its eye, what it looks at, and its view's width through the target.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Cam {
    pub position: [f64; 3],
    pub target: [f64; 3],
    pub width: f64,
    pub flat: bool,
}

fn sub(a: [f64; 3], b: [f64; 3]) -> [f64; 3] {
    [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
}

fn dot(a: [f64; 3], b: [f64; 3]) -> f64 {
    a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
}

fn len(a: [f64; 3]) -> f64 {
    dot(a, a).sqrt()
}

/// The angle between two directions, degrees; 0 where either is zero.
pub fn turn(a: [f64; 3], b: [f64; 3]) -> f64 {
    let (la, lb) = (len(a), len(b));
    if la == 0.0 || lb == 0.0 {
        return 0.0;
    }
    (dot(a, b) / (la * lb)).clamp(-1.0, 1.0).acos().to_degrees()
}

/// The azimuth of `p` about `about` on the ground plane, degrees.
fn azimuth(p: [f64; 3], about: [f64; 3]) -> f64 {
    let d = sub(p, about);
    d[0].atan2(d[2]).to_degrees()
}

/// The move a shot makes from `a` (its first frame) to `b` (its last), about its kept items'
/// centre `about`: an azimuth sweep over 10° about the kept items is an orbit, a change in
/// distance or view width over 10% a push or a pull, an aim turn over 5° a pan, and less a hold.
/// A flat camera's aim turn is its target's shift seen from a distance of its view's width.
pub fn classify(a: &Cam, b: &Cam, about: Option<[f64; 3]>) -> Move {
    if !a.flat && !b.flat {
        if let Some(c) = about {
            let mut sweep = (azimuth(b.position, c) - azimuth(a.position, c)).abs() % 360.0;
            if sweep > 180.0 {
                sweep = 360.0 - sweep;
            }
            if sweep > 10.0 {
                return Move::Orbit;
            }
        }
    }
    let change = |x: f64, y: f64| if x > 0.0 { (y - x) / x } else { 0.0 };
    let by_distance = if a.flat || b.flat {
        0.0
    } else {
        change(
            len(sub(a.position, a.target)),
            len(sub(b.position, b.target)),
        )
    };
    let by_width = change(a.width, b.width);
    let c = if by_distance.abs() > 0.10 {
        by_distance
    } else {
        by_width
    };
    if c.abs() > 0.10 {
        return if c < 0.0 { Move::Push } else { Move::Pull };
    }
    let aim = if a.flat || b.flat {
        let shift = len(sub(b.target, a.target));
        shift.atan2(a.width.max(1e-9)).to_degrees()
    } else {
        turn(sub(a.target, a.position), sub(b.target, b.position))
    };
    if aim > 5.0 {
        Move::Pan
    } else {
        Move::Hold
    }
}

/// A cut between two shots that keep the item at `item`: the direction from each camera to it
/// turns by the first value, degrees, and its framed height changes by the second, a ratio of
/// at least 1, from `heights` (before, after, frame px). A jump cut turns under `angle_min` and
/// changes under `size_min`.
pub fn cut_change(before: &Cam, after: &Cam, item: [f64; 3], heights: [f64; 2]) -> (f64, f64) {
    let angle = if before.flat || after.flat {
        0.0
    } else {
        turn(sub(item, before.position), sub(item, after.position))
    };
    let [a, b] = heights;
    let ratio = if a > 0.0 && b > 0.0 {
        a.max(b) / a.min(b)
    } else {
        1.0
    };
    (angle, ratio)
}

/// Which side of the vertical plane through `p` and `q` the point `x` is on: positive, negative,
/// or 0 on it (or with `p` and `q` stacked).
pub fn side(p: [f64; 3], q: [f64; 3], x: [f64; 3]) -> f64 {
    let along = sub(q, p);
    // The plane's normal on the ground: `along` × +Y.
    let normal = [-along[2], 0.0, along[0]];
    dot(normal, sub(x, p))
}

/// The numbers a text holds: runs of digits, with the separators inside them dropped.
pub fn numbers(text: &str) -> Vec<String> {
    let mut out = Vec::new();
    let chars: Vec<char> = text.chars().collect();
    let mut k = 0;
    while k < chars.len() {
        if !chars[k].is_ascii_digit() {
            k += 1;
            continue;
        }
        let mut n = String::new();
        while k < chars.len() {
            let c = chars[k];
            if c.is_ascii_digit() {
                n.push(c);
            } else if (c == '.' || c == ',') && chars.get(k + 1).is_some_and(char::is_ascii_digit) {
                if c == '.' {
                    n.push('.');
                }
            } else {
                break;
            }
            k += 1;
        }
        out.push(n);
    }
    out
}

/// Levenshtein distance between two lists.
pub fn edits<T: PartialEq>(a: &[T], b: &[T]) -> usize {
    let mut row: Vec<usize> = (0..=b.len()).collect();
    for (i, x) in a.iter().enumerate() {
        let mut prev = row[0];
        row[0] = i + 1;
        for (j, y) in b.iter().enumerate() {
            let next = (row[j + 1] + 1)
                .min(row[j] + 1)
                .min(prev + usize::from(x != y));
            prev = row[j + 1];
            row[j + 1] = next;
        }
    }
    row[b.len()]
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_table_states_every_check() {
        let names: Vec<&str> = checks().iter().map(|c| c.name.as_str()).collect();
        assert_eq!(names.len(), 16, "{names:?}");
        for c in checks() {
            assert!(
                !c.description.is_empty() && !c.threshold.is_empty() && !c.fix.is_empty(),
                "{}",
                c.name
            );
            assert!(c.defaults.is_object(), "{}", c.name);
        }
        assert_eq!(
            check("shot_length").map(|c| c.defaults["min"].as_f64()),
            Some(Some(2.0))
        );
    }

    #[test]
    fn slots_take_the_last_frame_that_rounds_to_each() {
        assert_eq!(slots(48, 24.0)[..4], [0, 2, 4, 6]);
        assert_eq!(slots(120, 60.0)[..3], [2, 7, 12]);
        assert_eq!(slots(60, 30.0)[..4], [1, 3, 6, 8]);
        assert_eq!(slots(50, 25.0).len(), 24);
        assert_eq!(slots(50, 25.0)[12], 26);
    }

    #[test]
    fn gray_reads_back_limited_range_luma() {
        assert_eq!(gray(&[0, 0, 0, 255, 255, 255, 255, 255]), vec![0, 255]);
        // Y′ 51.2 → coded 60 → 51.
        assert_eq!(gray(&[51, 51, 51, 255]), vec![51]);
    }

    #[test]
    fn a_pair_moves_at_nine_levels_and_cuts_are_left_out() {
        let f = |v: u8| vec![v; 8];
        let frames = vec![f(0), f(9), f(17), f(100), f(100)];
        let m = motion(&frames, 4, 2, &[false, false, true, false]);
        assert_eq!(m.diffs, vec![Some(9.0), Some(8.0), None, Some(0.0)]);
        assert_eq!((m.fast, m.counted), (1, 3));
        // The band's rows aren't read.
        let banded = vec![
            [vec![0; 4], vec![200; 4]].concat(),
            [vec![0; 4], vec![0; 4]].concat(),
        ];
        assert_eq!(motion(&banded, 4, 1, &[]).fast, 0);
    }

    #[test]
    fn a_still_jump_reads_as_a_cut_and_a_sweep_does_not() {
        let mut d = vec![0.5; 30];
        d[10] = 40.0;
        for x in &mut d[18..28] {
            *x = 27.0;
        }
        let still = vec![true; 30];
        let cut: Vec<usize> = jumps(&d, &still)
            .iter()
            .enumerate()
            .filter(|(_, j)| **j)
            .map(|(i, _)| i)
            .collect();
        assert_eq!(cut, vec![10]);
        // The camera made the same jump: not a cut.
        let mut moving = still.clone();
        moving[10] = false;
        assert!(!jumps(&d, &moving)[10]);
        let frames = vec![vec![0u8; 8], vec![9u8; 8]];
        assert_eq!(diffs(&frames, 4, 2), vec![9.0]);
    }

    #[test]
    fn a_blend_between_two_frames_reads_as_a_cross_fade_and_a_cut_does_not() {
        // Still at 0, a 7-frame blend to 200, still at 200; then a hard cut to 0 and still.
        let mut levels: Vec<f64> = vec![0.0; 10];
        levels.extend((1..=7).map(|k| 200.0 * f64::from(k) / 8.0));
        levels.extend([200.0; 10]);
        levels.extend([0.0; 10]);
        let frames: Vec<Vec<u8>> = levels.iter().map(|v| vec![*v as u8; 16]).collect();
        let d = diffs(&frames, 4, 4);
        let cut = jumps(&d, &vec![true; d.len()]);
        let faded = dissolves(&frames, 4, 4, &d, &cut);
        let pairs: Vec<usize> = faded
            .iter()
            .enumerate()
            .filter(|(_, f)| **f)
            .map(|(i, _)| i)
            .collect();
        assert!(
            pairs.contains(&9) && pairs.contains(&16),
            "the blend's pairs are left out: {pairs:?}"
        );
        assert!(!faded[26], "the hard cut isn't a cross-fade");
        assert!(cut[26], "the hard cut reads as a cut");
        // A film that never changes, and a bar sliding across the frame, hold no cross-fade.
        let still = vec![vec![90u8; 16]; 30];
        let d = diffs(&still, 4, 4);
        assert!(!dissolves(&still, 4, 4, &d, &vec![false; d.len()]).contains(&true));
        let slide: Vec<Vec<u8>> = (0..30)
            .map(|k| {
                let mut f = vec![0u8; 128];
                for row in f.chunks_mut(32) {
                    row[2 * k % 28..2 * k % 28 + 4].fill(255);
                }
                f
            })
            .collect();
        let d = diffs(&slide, 32, 4);
        assert!(
            !dissolves(&slide, 32, 4, &d, &vec![false; d.len()]).contains(&true),
            "a sliding bar isn't a blend"
        );
    }

    #[test]
    fn a_flat_frame_is_blank_and_an_edge_is_not() {
        assert!(blank(&[128; 64], 8, 8));
        let mut edged = vec![0u8; 64];
        for row in edged.chunks_mut(8) {
            row[4..].fill(255);
        }
        assert!(!blank(&edged, 8, 8));
    }

    #[test]
    fn moves_are_classed_by_the_camera() {
        let at = |p: [f64; 3], t: [f64; 3]| Cam {
            position: p,
            target: t,
            width: 2.0 * len(sub(p, t)),
            flat: false,
        };
        let a = at([0.0, 0.0, 10.0], [0.0; 3]);
        assert_eq!(
            classify(&a, &at([0.0, 0.0, 8.0], [0.0; 3]), None),
            Move::Push
        );
        assert_eq!(
            classify(&a, &at([0.0, 0.0, 12.0], [0.0; 3]), None),
            Move::Pull
        );
        assert_eq!(
            classify(&a, &at([0.0, 0.0, 10.5], [0.0; 3]), None),
            Move::Hold
        );
        assert_eq!(
            classify(&a, &at([0.0, 0.0, 10.0], [1.5, 0.0, 0.0]), None),
            Move::Pan
        );
        let swept = at([10.0 * 0.3f64.sin(), 0.0, 10.0 * 0.3f64.cos()], [0.0; 3]);
        assert_eq!(classify(&a, &swept, Some([0.0; 3])), Move::Orbit);
    }

    #[test]
    fn sides_of_a_vertical_line() {
        let (p, q) = ([0.0, 0.0, 0.0], [4.0, 1.0, 0.0]);
        assert!(side(p, q, [1.0, 0.0, 3.0]) * side(p, q, [2.0, 5.0, -3.0]) < 0.0);
    }

    #[test]
    fn numbers_on_screen_and_in_words() {
        assert_eq!(
            numbers("42 cups, 1,200 mugs and 3.5 l"),
            vec!["42", "1200", "3.5"]
        );
        assert!(numbers("no numbers").is_empty());
    }

    #[test]
    fn lists_differ_by_edits() {
        assert_eq!(edits(&["a", "b", "c"], &["a", "c"]), 1);
        assert_eq!(edits::<&str>(&[], &["a"]), 1);
        assert_eq!(edits(&["hold", "push"], &["hold", "push"]), 0);
    }
}

//! Issue #1968: a `text_diff` between two code items (canvas primitives: Text `text@1`: code, and
//! Transition). The two versions align line by line by a longest common subsequence, then token
//! by token inside the lines that changed, comparing lines and tokens by their raw bytes, ties to
//! the earlier position. Kept tokens move from their old places to their new ones; a run of
//! changed tokens cross-fades with the run that replaces it while both travel as their line does;
//! and a token no line keeps fades out, or in, where its line goes, so a deleted line's tokens
//! fade out where they stood before the lines below close over it, and an inserted line's fade in
//! where they land once the lines below have opened its space.

use std::ops::Range;
use std::sync::Arc;

use serde_json::{Map, Value};

use crate::code;
use crate::scene::{Drawn, Mark, Refused, Scope, TextRun, TextSpec};

/// One step of an alignment of two sequences, in order.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Step {
    /// The old element and the new one are equal, and kept.
    Keep(usize, usize),
    Delete(usize),
    Insert(usize),
}

/// The most cells the table of an alignment's middle may hold: 16 MiB of counts.
pub const CELLS: usize = 1 << 22;

/// The longest common subsequence of `old` and `new` as steps in order: their common start and
/// end kept, then the middle walked forward over a table of its suffixes' longest common
/// subsequences, keeping two equal elements as soon as they meet and, where deleting and inserting
/// keep as many, deleting first, so a kept element takes the earlier of its equal places. `None`
/// when the middle's table would hold more than [`CELLS`].
pub fn align<T: PartialEq>(old: &[T], new: &[T]) -> Option<Vec<Step>> {
    let prefix = old.iter().zip(new).take_while(|(a, b)| a == b).count();
    let suffix = old[prefix..]
        .iter()
        .rev()
        .zip(new[prefix..].iter().rev())
        .take_while(|(a, b)| a == b)
        .count();
    let (a, b) = (
        &old[prefix..old.len() - suffix],
        &new[prefix..new.len() - suffix],
    );
    let (n, m) = (a.len(), b.len());
    let mut steps = Vec::with_capacity(old.len() + new.len());
    steps.extend((0..prefix).map(|k| Step::Keep(k, k)));
    let (mut i, mut j) = (0, 0);
    if n > 0 && m > 0 {
        let width = n + 1;
        if width.checked_mul(m + 1)? > CELLS {
            return None;
        }
        // `table[j * width + i]`: how long a common subsequence `a[i..]` and `b[j..]` hold.
        let mut table = vec![0u32; width * (m + 1)];
        for y in (0..m).rev() {
            for x in (0..n).rev() {
                table[y * width + x] = if a[x] == b[y] {
                    table[(y + 1) * width + x + 1] + 1
                } else {
                    table[(y + 1) * width + x].max(table[y * width + x + 1])
                };
            }
        }
        while i < n && j < m {
            if a[i] == b[j] {
                steps.push(Step::Keep(prefix + i, prefix + j));
                (i, j) = (i + 1, j + 1);
            } else if table[j * width + i + 1] >= table[(j + 1) * width + i] {
                steps.push(Step::Delete(prefix + i));
                i += 1;
            } else {
                steps.push(Step::Insert(prefix + j));
                j += 1;
            }
        }
    }
    steps.extend((i..n).map(|k| Step::Delete(prefix + k)));
    steps.extend((j..m).map(|k| Step::Insert(prefix + k)));
    let (o, w) = (old.len() - suffix, new.len() - suffix);
    steps.extend((0..suffix).map(|k| Step::Keep(o + k, w + k)));
    Some(steps)
}

/// What a text_diff moves of a code item as one: a token, or the piece of one a line end or an
/// earlier token cuts; or a word, a run of graphemes no token holds that isn't white space.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Unit {
    /// Its raw bytes, which the diff compares.
    pub raw: Range<usize>,
    /// Its display graphemes, as the shaped run counts them (a line end counts one).
    pub graphemes: Range<usize>,
    pub line: usize,
    /// Its part: `tok:k`, the token `tokens` lists k-th, or `word:n`, the item's n-th word.
    pub part: String,
}

/// A code item as a text_diff reads it: its raw bytes, each display line's raw bytes without its
/// line end, its units in reading order, and each line's units.
#[derive(Clone, Debug, PartialEq)]
pub struct Version {
    pub raw: Vec<u8>,
    pub lines: Vec<Range<usize>>,
    pub units: Vec<Unit>,
    pub line_units: Vec<Range<usize>>,
}

impl Version {
    /// The code item at `path` whose params are `params`, as a text_diff reads it; `None` for a
    /// text that isn't code.
    pub fn read(params: &Map<String, Value>, path: &str) -> Result<Option<Version>, Refused> {
        let Some(d) = code::read(params, path)? else {
            return Ok(None);
        };
        let raw = code::raw(params)
            .map(|r| r.into_owned())
            .unwrap_or_default();
        let tokens = code::tokens(params, &d, path)?;
        let starts = deep_text::unicode::grapheme_starts(&d.text);
        // Each display grapheme's owner: the first token listed that holds it.
        let mut owner: Vec<Option<usize>> = vec![None; starts.len()];
        for (k, (span, _)) in tokens.iter().enumerate() {
            for g in span.clone() {
                if let Some(o) = owner.get_mut(g).filter(|o| o.is_none()) {
                    *o = Some(k);
                }
            }
        }
        #[derive(PartialEq)]
        enum Key {
            Token(usize),
            Word,
        }
        let mut units: Vec<Unit> = Vec::new();
        let mut line_units = Vec::new();
        let (mut line, mut first, mut words) = (0, 0, 0);
        // The unit being read: its key, its graphemes and raw bytes, and whether it shows ink.
        let mut open: Option<(Key, Unit, bool)> = None;
        let close = |open: &mut Option<(Key, Unit, bool)>, units: &mut Vec<Unit>| {
            if let Some((_, unit, true)) = open.take() {
                units.push(unit);
            }
        };
        let mut at = 0;
        for (g, &s) in starts.iter().enumerate() {
            let e = starts.get(g + 1).copied().unwrap_or(d.text.len());
            let shown = &d.text[s..e];
            if shown == "\n" {
                close(&mut open, &mut units);
                line_units.push(first..units.len());
                (first, line) = (units.len(), line + 1);
                continue;
            }
            while d.graphemes.get(at).is_some_and(|(t, _)| t.end <= s) {
                at += 1;
            }
            let Some((_, bytes)) = d.graphemes.get(at) else {
                continue;
            };
            let ink = !shown.chars().all(char::is_whitespace);
            let key = match owner[g] {
                Some(k) => Key::Token(k),
                None if ink => Key::Word,
                None => {
                    close(&mut open, &mut units);
                    continue;
                }
            };
            if let Some((_, unit, shows)) = open
                .as_mut()
                .filter(|(k, unit, _)| *k == key && unit.graphemes.end == g)
            {
                unit.graphemes.end = g + 1;
                unit.raw.end = unit.raw.end.max(bytes.end);
                *shows |= ink;
                continue;
            }
            close(&mut open, &mut units);
            let part = match key {
                Key::Token(k) => format!("tok:{k}"),
                Key::Word => {
                    words += 1;
                    format!("word:{}", words - 1)
                }
            };
            let unit = Unit {
                raw: bytes.clone(),
                graphemes: g..g + 1,
                line,
                part,
            };
            open = Some((key, unit, ink));
        }
        close(&mut open, &mut units);
        line_units.push(first..units.len());
        let mut lines: Vec<Range<usize>> = code::line_ranges(&raw);
        lines.resize(line_units.len(), raw.len()..raw.len());
        Ok(Some(Version {
            raw,
            lines,
            units,
            line_units,
        }))
    }

    fn line(&self, k: usize) -> &[u8] {
        &self.raw[self.lines[k].clone()]
    }

    fn unit(&self, k: usize) -> &[u8] {
        &self.raw[self.units[k].raw.clone()]
    }
}

/// What became of a unit across a text_diff.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Fate {
    /// Kept: the other version's unit it is.
    Kept(usize),
    /// In the changed run [`Matching::runs`] holds at this index, which cross-fades with the other
    /// version's run.
    Changed(usize),
    /// Deleted (an old unit) or inserted (a new one), moving as the kept unit of its line it
    /// names moves, if its line keeps one.
    Alone(Option<usize>),
}

/// How two code items' units pair up across a text_diff: each old unit's fate, each new unit's,
/// and each run of changed units, its old units and the new ones replacing them.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Matching {
    pub old: Vec<Fate>,
    pub new: Vec<Fate>,
    pub runs: Vec<(Range<usize>, Range<usize>)>,
}

/// How `old` and `new` pair up: lines aligned by their raw bytes, then the units of each pair of
/// kept lines, and of each stretch of lines that changed between two kept ones, aligned by
/// theirs. In a stretch, the units a step of the alignment neither keeps nor passes over in a kept
/// line are changed runs, each line's deleted units with the inserted ones of the line they meet
/// in order; the rest stay alone.
pub fn matching(old: &Version, new: &Version) -> Matching {
    let lines_old: Vec<&[u8]> = (0..old.lines.len()).map(|k| old.line(k)).collect();
    let lines_new: Vec<&[u8]> = (0..new.lines.len()).map(|k| new.line(k)).collect();
    let steps =
        align(&lines_old, &lines_new).unwrap_or_else(|| apart(old.lines.len(), new.lines.len()));
    let mut out = Matching {
        old: vec![Fate::Alone(None); old.units.len()],
        new: vec![Fate::Alone(None); new.units.len()],
        runs: Vec::new(),
    };
    let mut k = 0;
    while k < steps.len() {
        if let Step::Keep(i, j) = steps[k] {
            pair(old, new, &[i], &[j], &mut out);
            k += 1;
            continue;
        }
        let (mut gone, mut came) = (Vec::new(), Vec::new());
        while let Some(&s) = steps.get(k).filter(|s| !matches!(s, Step::Keep(..))) {
            match s {
                Step::Delete(i) => gone.push(i),
                Step::Insert(j) => came.push(j),
                Step::Keep(..) => unreachable!(),
            }
            k += 1;
        }
        pair(old, new, &gone, &came, &mut out);
    }
    for (fates, version) in [(&mut out.old, old), (&mut out.new, new)] {
        anchor(fates, version);
    }
    out
}

/// Every old element deleted, then every new one inserted.
fn apart(n: usize, m: usize) -> Vec<Step> {
    (0..n)
        .map(Step::Delete)
        .chain((0..m).map(Step::Insert))
        .collect()
}

/// The units of lines `a` of `old` and `b` of `new`, each a stretch of lines in order, aligned and
/// written into `out`. A stretch whose table would pass [`CELLS`] pairs its lines in order
/// instead, and a single pair that still would aligns nothing.
fn pair(old: &Version, new: &Version, a: &[usize], b: &[usize], out: &mut Matching) {
    let span = |v: &Version, lines: &[usize]| match (lines.first(), lines.last()) {
        (Some(&f), Some(&l)) => v.line_units[f].start..v.line_units[l].end,
        _ => 0..0,
    };
    let (ua, ub) = (span(old, a), span(new, b));
    let units_old: Vec<&[u8]> = ua.clone().map(|u| old.unit(u)).collect();
    let units_new: Vec<&[u8]> = ub.clone().map(|u| new.unit(u)).collect();
    let steps = match align(&units_old, &units_new) {
        Some(steps) => steps,
        None if a.len() > 1 || b.len() > 1 => {
            for q in 0..a.len().max(b.len()) {
                let one = |l: &[usize]| l.get(q..q + 1).unwrap_or(&[]).to_vec();
                pair(old, new, &one(a), &one(b), out);
            }
            return;
        }
        None => apart(ua.len(), ub.len()),
    };
    let mut k = 0;
    while k < steps.len() {
        if let Step::Keep(i, j) = steps[k] {
            out.old[ua.start + i] = Fate::Kept(ub.start + j);
            out.new[ub.start + j] = Fate::Kept(ua.start + i);
            k += 1;
            continue;
        }
        // A run of steps that keep nothing: each line's deleted units with the inserted ones of
        // the line met in the same order.
        let (mut gone, mut came): (Vec<Range<usize>>, Vec<Range<usize>>) = (Vec::new(), Vec::new());
        let grow = |groups: &mut Vec<Range<usize>>, v: &Version, u: usize| match groups.last_mut() {
            Some(g) if v.units[g.end - 1].line == v.units[u].line && g.end == u => g.end = u + 1,
            _ => groups.push(u..u + 1),
        };
        while let Some(&s) = steps.get(k).filter(|s| !matches!(s, Step::Keep(..))) {
            match s {
                Step::Delete(i) => grow(&mut gone, old, ua.start + i),
                Step::Insert(j) => grow(&mut came, new, ub.start + j),
                Step::Keep(..) => unreachable!(),
            }
            k += 1;
        }
        for (g, c) in gone.into_iter().zip(came) {
            let r = out.runs.len();
            g.clone().for_each(|u| out.old[u] = Fate::Changed(r));
            c.clone().for_each(|u| out.new[u] = Fate::Changed(r));
            out.runs.push((g, c));
        }
    }
}

/// Each alone unit's anchor: the nearest kept unit of its line, before it first.
fn anchor(fates: &mut [Fate], v: &Version) {
    for span in &v.line_units {
        for u in span.clone() {
            if fates[u] != Fate::Alone(None) {
                continue;
            }
            let kept = |k: &usize| matches!(fates[*k], Fate::Kept(_));
            let near = (span.start..u)
                .rev()
                .find(kept)
                .or_else(|| (u + 1..span.end).find(kept));
            fates[u] = Fate::Alone(near);
        }
    }
}

/// A text_diff's two sides as a frame draws them: each code item's text mark and its scopes, its
/// shaped run and line height, where each display grapheme starts in its text, and where each of
/// its units sits in the document (the pen of its first glyph, on its line's top).
pub struct Side<'a> {
    pub drawn: &'a Drawn,
    pub version: &'a Version,
    pub shaped: Arc<deep_text::Shaped>,
    pub height: f64,
    pub starts: Vec<usize>,
    pub places: Vec<[f64; 2]>,
}

impl<'a> Side<'a> {
    /// The side `version` draws as the text mark `drawn`; `None` for a mark that isn't text, or a
    /// font nothing bundles.
    pub fn of(drawn: &'a Drawn, version: &'a Version) -> Option<Side<'a>> {
        let Mark::Text { spec, origin, .. } = &drawn.mark else {
            return None;
        };
        let shaped = crate::scene::shaped_text(spec)?;
        let (height, rows) = crate::lines::rows(&shaped);
        let starts = deep_text::unicode::grapheme_starts(&spec.text);
        // Each grapheme's leftmost glyph pen.
        let mut pen = vec![f64::INFINITY; starts.len()];
        for g in &shaped.glyphs {
            if let Some(x) = pen.get_mut(g.grapheme) {
                *x = x.min(f64::from(g.x));
            }
        }
        let places = version
            .units
            .iter()
            .map(|u| {
                let x = pen.get(u.graphemes.clone()).map_or(f64::INFINITY, |p| {
                    p.iter().copied().fold(f64::INFINITY, f64::min)
                });
                let y = rows
                    .get(u.line)
                    .map_or(0.0, |row| crate::lines::top(&shaped, height, u.line, row));
                [
                    origin[0] + if x.is_finite() { x } else { 0.0 },
                    origin[1] + y,
                ]
            })
            .collect();
        Some(Side {
            drawn,
            version,
            shaped,
            height,
            starts,
            places,
        })
    }
}

/// One unit a text_diff draws at a progress: which side's unit, where it sits, and its opacity.
#[derive(Clone, Debug, PartialEq)]
pub struct Moved {
    /// `false` for the old version's unit, `true` for the new one's.
    pub new: bool,
    pub unit: usize,
    pub at: [f64; 2],
    pub opacity: f64,
}

/// The units a text_diff draws at progress `p`: each old unit kept moving from its place to its
/// partner's, each changed run's units cross-fading as the run travels from the old run's place
/// to the new one's, and each alone unit fading where the kept unit it names goes (in place with
/// none): an old one over the first half, before the kept units close over it, and a new one over
/// the second, once they have made room. A new unit that is kept draws as its old twin, so it isn't
/// listed.
pub fn moved(old: &Side<'_>, new: &Side<'_>, m: &Matching, p: f64) -> Vec<Moved> {
    let (going, coming) = ((1.0 - 2.0 * p).max(0.0), (2.0 * p - 1.0).max(0.0));
    let shift = |a: [f64; 2], b: [f64; 2]| [b[0] - a[0], b[1] - a[1]];
    let kept_shift = |u: usize| match m.old[u] {
        Fate::Kept(v) => shift(old.places[u], new.places[v]),
        _ => [0.0, 0.0],
    };
    let run_shift = |r: usize| {
        let (a, b) = &m.runs[r];
        shift(old.places[a.start], new.places[b.start])
    };
    let mut out = Vec::with_capacity(m.old.len() + m.new.len());
    for (u, fate) in m.old.iter().enumerate() {
        let (d, opacity) = match *fate {
            Fate::Kept(_) => (kept_shift(u), 1.0),
            Fate::Changed(r) => (run_shift(r), 1.0 - p),
            Fate::Alone(a) => (a.map_or([0.0, 0.0], kept_shift), going),
        };
        let [x, y] = old.places[u];
        out.push(Moved {
            new: false,
            unit: u,
            at: [x + d[0] * p, y + d[1] * p],
            opacity,
        });
    }
    for (v, fate) in m.new.iter().enumerate() {
        let (d, opacity) = match *fate {
            Fate::Kept(_) => continue,
            Fate::Changed(r) => (run_shift(r), p),
            Fate::Alone(a) => match a.map(|k| m.new[k]) {
                Some(Fate::Kept(u)) => (kept_shift(u), coming),
                _ => ([0.0, 0.0], coming),
            },
        };
        let [x, y] = new.places[v];
        out.push(Moved {
            new: true,
            unit: v,
            at: [x - d[0] * (1.0 - p), y - d[1] * (1.0 - p)],
            opacity,
        });
    }
    out
}

/// The marks of [`moved`]'s units: each a text mark of its unit's graphemes, in its side's spec,
/// runs and scopes, at its place, at its opacity (none drawn at 0), named `<item>#<part>`.
pub fn marks(old: &Side<'_>, new: &Side<'_>, moved: &[Moved]) -> Vec<Arc<Drawn>> {
    moved
        .iter()
        .filter(|m| m.opacity > 0.0)
        .filter_map(|m| {
            let side = if m.new { new } else { old };
            let Mark::Text {
                item,
                spec,
                role,
                color,
                runs,
                ..
            } = &side.drawn.mark
            else {
                return None;
            };
            let unit = &side.version.units[m.unit];
            let byte = |g: usize| side.starts.get(g).copied().unwrap_or(spec.text.len());
            let text = spec.text[byte(unit.graphemes.start)..byte(unit.graphemes.end)].to_string();
            let g = &unit.graphemes;
            // Runs are in order and apart: those that meet the unit's graphemes, cut to them.
            let runs: Vec<TextRun> = runs[runs.partition_point(|r| r.to <= g.start)..]
                .iter()
                .take_while(|r| r.from < g.end)
                .map(|r| TextRun {
                    from: r.from.max(g.start) - g.start,
                    to: r.to.min(g.end) - g.start,
                    ..r.clone()
                })
                .collect();
            let mut scopes = side.drawn.scopes.clone();
            if m.opacity < 1.0 {
                scopes.push(Scope::Opacity {
                    item: format!("{item}#{}#fade", unit.part),
                    alpha: m.opacity,
                    blend: None,
                    effect: None,
                });
            }
            Some(Arc::new(Drawn {
                mark: Mark::Text {
                    item: format!("{item}#{}", unit.part),
                    spec: TextSpec {
                        text,
                        width: None,
                        max_lines: None,
                        mask: false,
                        align: crate::scene::Align::Start,
                        spans: Vec::new(),
                        gap: 0.0,
                        indent: 0.0,
                        ..spec.clone()
                    },
                    origin: m.at,
                    role: role.clone(),
                    color: *color,
                    runs,
                },
                clip: side.drawn.clip,
                scopes,
            }))
        })
        .collect()
}

/// One token of a text_diff at a progress, as an eval's film block reports it: the token it is in
/// each version (`None` in the version that lacks it), its box in the document and its opacity in
/// the diff.
#[derive(Clone, Debug, PartialEq)]
pub struct Piece {
    pub from: Option<usize>,
    pub to: Option<usize>,
    pub bbox: [f64; 4],
    pub opacity: f64,
}

/// [`moved`]'s units as tokens: each token of either version once, a kept one naming both, its box
/// its `#tok:k` anchor's box moved as its units move, its opacity theirs. A word no token holds
/// isn't a token, so it isn't listed.
pub fn pieces(old: &Side<'_>, new: &Side<'_>, m: &Matching, moved: &[Moved]) -> Vec<Piece> {
    let token = |v: &Version, u: usize| v.units[u].part.strip_prefix("tok:")?.parse().ok();
    let mut out: Vec<Piece> = Vec::new();
    let mut index = std::collections::HashMap::new();
    for q in moved {
        let side = if q.new { new } else { old };
        let (from, to) = match (q.new, m.old.get(q.unit)) {
            (true, _) => (None, token(new.version, q.unit)),
            (false, Some(&Fate::Kept(v))) => (token(old.version, q.unit), token(new.version, v)),
            (false, _) => (token(old.version, q.unit), None),
        };
        let unit = &side.version.units[q.unit];
        let (Some(b), Mark::Text { origin, .. }) = (
            crate::lines::span_box(&side.shaped, &unit.graphemes, side.height),
            &side.drawn.mark,
        ) else {
            continue;
        };
        if from.is_none() && to.is_none() {
            continue;
        }
        let [x, y] = side.places[q.unit];
        let bbox = [
            origin[0] + b[0] + q.at[0] - x,
            origin[1] + b[1] + q.at[1] - y,
            b[2],
            b[3],
        ];
        // A token a line end or another token cuts is several units: one box around them all.
        match index.get(&(from, to)) {
            Some(&k) => {
                let p: &mut Piece = &mut out[k];
                let (x0, y0) = (p.bbox[0].min(bbox[0]), p.bbox[1].min(bbox[1]));
                let x1 = (p.bbox[0] + p.bbox[2]).max(bbox[0] + bbox[2]);
                let y1 = (p.bbox[1] + p.bbox[3]).max(bbox[1] + bbox[3]);
                p.bbox = [x0, y0, x1 - x0, y1 - y0];
                p.opacity = p.opacity.max(q.opacity);
            }
            None => {
                index.insert((from, to), out.len());
                out.push(Piece {
                    from,
                    to,
                    bbox,
                    opacity: q.opacity,
                });
            }
        }
    }
    out
}

/// A unit mark's shaped run, as the text module keeps one for each text a frame draws.
pub fn run_of(mark: &Mark) -> Option<crate::modules::Run> {
    let Mark::Text { spec, .. } = mark else {
        return None;
    };
    Some(crate::modules::Run {
        spec: spec.clone(),
        shaped: crate::scene::shaped_text(spec)?,
    })
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    #[test]
    fn a_kept_element_takes_the_earlier_place_and_a_tie_deletes_first() {
        use Step::*;
        assert_eq!(
            align(&['x'], &['x', 'x']),
            Some(vec![Keep(0, 0), Insert(1)])
        );
        assert_eq!(
            align(&['x', 'x'], &['x']),
            Some(vec![Keep(0, 0), Delete(1)])
        );
        assert_eq!(
            align(&['a', 'b'], &['b', 'a']),
            Some(vec![Delete(0), Keep(1, 0), Insert(1)])
        );
        assert_eq!(
            align(&[0, 1, 3, 4, 5], &[0, 1, 4, 5, 8, 9]),
            Some(vec![
                Keep(0, 0),
                Keep(1, 1),
                Delete(2),
                Keep(3, 2),
                Keep(4, 3),
                Insert(4),
                Insert(5)
            ])
        );
        let wide = vec![0u8; 3000];
        assert_eq!(align(&wide, &vec![1u8; 3000]), None);
    }

    fn code(raw: &str, tokens: &[(usize, usize, &str)]) -> Version {
        let tokens: Vec<Value> = tokens
            .iter()
            .map(|(from, to, class)| json!({"from": from, "to": to, "class": class}))
            .collect();
        let params = json!({"raw": raw, "code": {"language": "python", "tokens": tokens}});
        Version::read(params.as_object().unwrap(), "items/c")
            .unwrap()
            .unwrap()
    }

    /// Words as tokens: every run of letters, digits and underscores, and each other character
    /// that isn't white space.
    fn tokens_of(raw: &str) -> Vec<(usize, usize, &'static str)> {
        let mut out = Vec::new();
        let b = raw.as_bytes();
        let mut i = 0;
        while i < b.len() {
            let word = |c: u8| c.is_ascii_alphanumeric() || c == b'_';
            if word(b[i]) {
                let s = i;
                while i < b.len() && word(b[i]) {
                    i += 1;
                }
                out.push((s, i, "variable"));
            } else {
                if !b[i].is_ascii_whitespace() {
                    out.push((i, i + 1, "punctuation"));
                }
                i += 1;
            }
        }
        out
    }

    #[test]
    fn a_line_inserted_above_the_last_two_keeps_them_and_one_changed_argument_cross_fades() {
        let a = "def area(w, h):\n    s = w * h\n    return s\n";
        let b = "def area(w, d):\n    k = w\n    s = w * h\n    return s\n";
        let (old, new) = (code(a, &tokens_of(a)), code(b, &tokens_of(b)));
        let m = matching(&old, &new);
        let parts = |v: &Version, fates: &[Fate], want: fn(&Fate) -> bool| -> Vec<String> {
            fates
                .iter()
                .enumerate()
                .filter(|(_, f)| want(f))
                .map(|(u, _)| String::from_utf8_lossy(v.unit(u)).into_owned())
                .collect()
        };
        assert_eq!(
            parts(&old, &m.old, |f| matches!(f, Fate::Changed(_))),
            ["h"]
        );
        assert_eq!(
            parts(&new, &m.new, |f| matches!(f, Fate::Changed(_))),
            ["d"]
        );
        assert_eq!(
            parts(&new, &m.new, |f| matches!(f, Fate::Alone(_))),
            ["k", "=", "w"]
        );
        assert!(m.old.iter().all(|f| !matches!(f, Fate::Alone(_))));
        // Every unit of the last two lines is kept, each with its twin one line down.
        for u in old.line_units[1].start..old.line_units[2].end {
            let Fate::Kept(v) = m.old[u] else {
                panic!("{u} kept")
            };
            assert_eq!(new.units[v].line, old.units[u].line + 1);
            assert_eq!(old.unit(u), new.unit(v));
        }
        // The inserted line keeps nothing, so its units fade in place.
        assert!(new.line_units[1]
            .clone()
            .all(|v| m.new[v] == Fate::Alone(None)));
    }

    #[test]
    fn lines_and_tokens_compare_by_raw_bytes_and_untokened_ink_moves_as_words() {
        // The same display, other bytes: a precomposed é against e and U+0301.
        let a = "x = \"caf\u{e9}\"\ny\n";
        let b = "x = \"cafe\u{301}\"\ny\n";
        let (old, new) = (code(a, &[]), code(b, &[]));
        let parts: Vec<&str> = old.units.iter().map(|u| u.part.as_str()).collect();
        assert_eq!(parts, ["word:0", "word:1", "word:2", "word:3"]);
        let m = matching(&old, &new);
        assert_eq!(m.old[2], Fate::Changed(0));
        assert_eq!(m.old[3], Fate::Kept(3));
        assert_eq!(m.old[0], Fate::Kept(0));
    }
}

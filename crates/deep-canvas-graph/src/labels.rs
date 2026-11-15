//! Labels `label@1`, `labels@1` (canvas primitives: Labels): placed on the CPU by priority, then
//! ID, each against an occupancy bitmap of `cell`-px cells in rows of 32-bit words that holds the
//! marks, routes, frame titles and status marks to avoid and every label placed before it, with its
//! padding. A label tries the spot it had in the bucket before it in the chain from the
//! document's base zoom, then its anchors in order; one that fits nowhere folds and joins its
//! frame's count. Buckets are √2 apart, so a bucket's placement depends only on the bucket, never
//! on how the view got there, and nothing here reads a clock.

use std::collections::BTreeMap;

/// The anchors a node label may take, in the order they are tried.
pub const NODE_ANCHORS: [Anchor; 9] = [
    Anchor::N,
    Anchor::E,
    Anchor::S,
    Anchor::W,
    Anchor::NE,
    Anchor::SE,
    Anchor::SW,
    Anchor::NW,
    Anchor::Middle,
];

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub enum Anchor {
    N,
    NE,
    E,
    SE,
    S,
    SW,
    W,
    NW,
    Middle,
}

impl Anchor {
    pub fn name(self) -> &'static str {
        match self {
            Anchor::N => "n",
            Anchor::NE => "ne",
            Anchor::E => "e",
            Anchor::SE => "se",
            Anchor::S => "s",
            Anchor::SW => "sw",
            Anchor::W => "w",
            Anchor::NW => "nw",
            Anchor::Middle => "middle",
        }
    }

    pub fn read(s: &str) -> Option<Anchor> {
        NODE_ANCHORS.into_iter().find(|a| a.name() == s)
    }

    /// The label's top-left for a target box and a label size, `offset` px off the box.
    fn place(self, target: [f64; 4], w: f64, h: f64, offset: f64) -> (f64, f64) {
        let [x, y, tw, th] = target;
        let (cx, cy) = (x + tw / 2.0 - w / 2.0, y + th / 2.0 - h / 2.0);
        let (left, right) = (x - offset - w, x + tw + offset);
        let (top, bottom) = (y - offset - h, y + th + offset);
        match self {
            Anchor::N => (cx, top),
            Anchor::NE => (right, top),
            Anchor::E => (right, cy),
            Anchor::SE => (right, bottom),
            Anchor::S => (cx, bottom),
            Anchor::SW => (left, bottom),
            Anchor::W => (left, cy),
            Anchor::NW => (left, top),
            Anchor::Middle => (cx, cy),
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Fold {
    Dot,
    Count,
    Hide,
}

impl Fold {
    pub fn read(s: &str) -> Option<Fold> {
        Some(match s {
            "dot" => Fold::Dot,
            "count" => Fold::Count,
            "hide" => Fold::Hide,
            _ => return None,
        })
    }

    pub fn name(self) -> &'static str {
        match self {
            Fold::Dot => "dot",
            Fold::Count => "count",
            Fold::Hide => "hide",
        }
    }
}

/// One label: its target's box in document u, its size in px, and how it places.
#[derive(Clone, Debug, PartialEq)]
pub struct Label {
    pub id: String,
    pub target: [f64; 4],
    pub w: f64,
    pub h: f64,
    pub priority: i16,
    pub needs_you: bool,
    pub anchors: Vec<Anchor>,
    pub offset: f64,
    pub padding: f64,
    pub fold: Fold,
    /// The zoom range it shows in, `[min, max]`.
    pub zoom: [f64; 2],
}

/// What placement avoids, in document u: marks, routes (as their segments' boxes), frame titles and
/// status marks; status marks are never covered, even by a label's padding.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Avoid {
    pub boxes: Vec<[f64; 4]>,
    pub status: Vec<[f64; 4]>,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Placement {
    pub cell: f64,
    /// The document's base zoom, where every chain starts.
    pub base: f64,
    /// The frame labels stay inside, `[x, y, w, h]` in document u.
    pub frame: [f64; 4],
}

/// A label's outcome in one bucket: placed at a spot (top-left, screen px from the frame's
/// origin), or folded.
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Spot {
    At { anchor: Anchor, x: f64, y: f64 },
    Folded(Fold),
}

/// A label's top-left at `anchor` of a target box, `offset` px off it.
pub fn anchored(anchor: Anchor, target: [f64; 4], w: f64, h: f64, offset: f64) -> (f64, f64) {
    anchor.place(target, w, h, offset)
}

/// The bucket of a zoom: buckets are √2 apart, bucket 0 holding the base zoom.
pub fn bucket(zoom: f64, base: f64) -> i32 {
    (deep_canvas::ops::log2(zoom / base) * 2.0 + 1e-9).floor() as i32
}

/// A bucket's zoom, the one it is placed at.
pub fn bucket_zoom(bucket: i32, base: f64) -> f64 {
    base * deep_canvas::ops::pow(2.0, f64::from(bucket) / 2.0)
}

/// The occupancy bitmap: rows of 32-bit words, one bit per cell.
struct Bitmap {
    words: usize,
    rows: usize,
    bits: Vec<u32>,
    cell: f64,
}

impl Bitmap {
    fn new(w: f64, h: f64, cell: f64) -> Bitmap {
        let cols = (w / cell).ceil().max(1.0) as usize;
        let rows = (h / cell).ceil().max(1.0) as usize;
        let words = cols.div_ceil(32);
        Bitmap {
            words,
            rows,
            bits: vec![0; words * rows],
            cell,
        }
    }

    /// The cells a box covers, clipped to the bitmap; a box with no area covers none.
    fn span(&self, r: [f64; 4]) -> Option<(usize, usize, usize, usize)> {
        let [x, y, w, h] = r;
        if w <= 0.0 || h <= 0.0 {
            return None;
        }
        let c0 = (x / self.cell).floor().max(0.0) as usize;
        let r0 = (y / self.cell).floor().max(0.0) as usize;
        let c1 = ((x + w) / self.cell).ceil().min((self.words * 32) as f64) as usize;
        let r1 = ((y + h) / self.cell).ceil().min(self.rows as f64) as usize;
        (c1 > c0 && r1 > r0).then_some((c0, r0, c1, r1))
    }

    fn mask(c0: usize, c1: usize, word: usize) -> u32 {
        let lo = c0.max(word * 32) - word * 32;
        let hi = c1.min(word * 32 + 32) - word * 32;
        if hi <= lo {
            return 0;
        }
        if hi - lo == 32 {
            u32::MAX
        } else {
            ((1u32 << (hi - lo)) - 1) << lo
        }
    }

    fn any(&self, r: [f64; 4]) -> bool {
        let Some((c0, r0, c1, r1)) = self.span(r) else {
            return false;
        };
        (r0..r1).any(|row| {
            (c0 / 32..c1.div_ceil(32))
                .any(|word| self.bits[row * self.words + word] & Self::mask(c0, c1, word) != 0)
        })
    }

    fn set(&mut self, r: [f64; 4]) {
        let Some((c0, r0, c1, r1)) = self.span(r) else {
            return;
        };
        for row in r0..r1 {
            for word in c0 / 32..c1.div_ceil(32) {
                self.bits[row * self.words + word] |= Self::mask(c0, c1, word);
            }
        }
    }
}

/// The order labels place in: needs-you first, then higher priority, then ID.
fn ordered(labels: &[Label]) -> Vec<usize> {
    let mut order: Vec<usize> = (0..labels.len()).collect();
    order.sort_by(|&p, &q| {
        let (a, b) = (&labels[p], &labels[q]);
        b.needs_you
            .cmp(&a.needs_you)
            .then(b.priority.cmp(&a.priority))
            .then(a.id.cmp(&b.id))
    });
    order
}

/// One bucket's placement, given the bucket before it in the chain (none at the base).
fn place_at(
    labels: &[Label],
    avoid: &Avoid,
    p: &Placement,
    zoom: f64,
    previous: Option<&BTreeMap<String, Spot>>,
) -> BTreeMap<String, Spot> {
    let scale = |r: [f64; 4]| {
        [
            (r[0] - p.frame[0]) * zoom,
            (r[1] - p.frame[1]) * zoom,
            r[2] * zoom,
            r[3] * zoom,
        ]
    };
    let frame = [0.0, 0.0, p.frame[2] * zoom, p.frame[3] * zoom];
    let mut bitmap = Bitmap::new(frame[2], frame[3], p.cell);
    for &r in &avoid.boxes {
        bitmap.set(scale(r));
    }
    for &r in &avoid.status {
        bitmap.set(scale(r));
    }
    let mut out = BTreeMap::new();
    for i in ordered(labels) {
        let l = &labels[i];
        if zoom < l.zoom[0] || zoom > l.zoom[1] {
            out.insert(l.id.clone(), Spot::Folded(Fold::Hide));
            continue;
        }
        let target = scale(l.target);
        let kept = previous.and_then(|prev| match prev.get(&l.id) {
            Some(Spot::At { anchor, .. }) => Some(*anchor),
            _ => None,
        });
        let tries = kept.into_iter().chain(l.anchors.iter().copied());
        let mut spot = Spot::Folded(l.fold);
        for anchor in tries {
            let (x, y) = anchor.place(target, l.w, l.h, l.offset);
            let body = [x, y, l.w, l.h];
            let padded = [
                x - l.padding,
                y - l.padding,
                l.w + 2.0 * l.padding,
                l.h + 2.0 * l.padding,
            ];
            let inside = body[0] >= 0.0
                && body[1] >= 0.0
                && body[0] + body[2] <= frame[2]
                && body[1] + body[3] <= frame[3];
            if inside && !bitmap.any(padded) {
                bitmap.set(padded);
                spot = Spot::At { anchor, x, y };
                break;
            }
        }
        out.insert(l.id.clone(), spot);
    }
    out
}

/// A bucket's placement, by the chain from the base bucket to it, each step trying the spots of
/// the step before. The same bucket gives the same placement however the view reached it.
pub fn place(
    labels: &[Label],
    avoid: &Avoid,
    p: &Placement,
    bucket: i32,
) -> BTreeMap<String, Spot> {
    let mut chain: Option<BTreeMap<String, Spot>> = None;
    let step = if bucket >= 0 { 1 } else { -1 };
    let mut b = 0;
    loop {
        let next = place_at(labels, avoid, p, bucket_zoom(b, p.base), chain.as_ref());
        chain = Some(next);
        if b == bucket {
            break;
        }
        b += step;
    }
    chain.unwrap_or_default()
}

/// How far into a bucket labels start fading toward the next one: the last eighth of its span.
pub const FADE_MARGIN: f64 = 0.125;

/// A label's opacity at a zoom: 1 inside its bucket, easing toward the next bucket's state over
/// the bucket's last [`FADE_MARGIN`] of log-zoom. It reads the zoom only, never the time.
pub fn opacity(here: &Spot, next: &Spot, zoom: f64, base: f64) -> f64 {
    let visible = |s: &Spot| f64::from(u8::from(matches!(s, Spot::At { .. })));
    let pos = deep_canvas::ops::log2(zoom / base) * 2.0;
    let into = pos - pos.floor();
    let (a, b) = (visible(here), visible(next));
    if into < 1.0 - FADE_MARGIN || a == b {
        return a;
    }
    let t = (into - (1.0 - FADE_MARGIN)) / FADE_MARGIN;
    a + (b - a) * t
}

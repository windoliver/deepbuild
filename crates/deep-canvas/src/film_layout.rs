//! Issue #408: the core's `film.layout` check kind (canvas primitives: Film layout). At each
//! checked time it reads the evaluated frame, never its pixels: each text's glyph boxes from the
//! core's glyph-box array, strokes as flattened polylines and fills as their true outlines, each
//! with its place in the draw order. Text cut by the frame, two texts overlapping, a stroke
//! crossing a text and an opaque fill covering one are errors; an open path or plot leaving the
//! frame, an item wholly out of frame and anything but a lone text while the camera moved are
//! notices. One pair seen at many times is one issue, listing every time, with its fix as patch
//! ops on the document.

use std::collections::BTreeMap;

use serde_json::{json, Map, Value};

/// The thresholds (Film layout: Fields). A brief may only tighten them, so a looser value in a
/// check input is read as the default.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Limits {
    pub overlap_min: f64,
    pub touch: f64,
    pub covered_max: f64,
    pub fill_opaque: f64,
    pub backdrop_opaque: f64,
    pub cut_min: f64,
}

impl Default for Limits {
    fn default() -> Self {
        Limits {
            overlap_min: 0.05,
            touch: 4.0,
            covered_max: 0.3,
            fill_opaque: 0.5,
            backdrop_opaque: 0.9,
            cut_min: 2.7,
        }
    }
}

impl Limits {
    /// The defaults, tightened by what `input` names: a smaller share or opacity limit, a wider
    /// touch or a larger cut margin. A field that would loosen a threshold keeps the default.
    pub fn from_input(input: &Value) -> Limits {
        let d = Limits::default();
        let n = |k: &str| {
            input
                .get(k)
                .and_then(Value::as_f64)
                .filter(|x| x.is_finite())
        };
        let lower = |k: &str, def: f64| n(k).filter(|x| *x >= 0.0).map_or(def, |x| x.min(def));
        let higher = |k: &str, def: f64| n(k).map_or(def, |x| x.max(def));
        Limits {
            overlap_min: lower("overlap_min", d.overlap_min),
            touch: higher("touch", d.touch),
            covered_max: lower("covered_max", d.covered_max),
            fill_opaque: lower("fill_opaque", d.fill_opaque),
            backdrop_opaque: higher("backdrop_opaque", d.backdrop_opaque).min(1.0),
            cut_min: higher("cut_min", d.cut_min),
        }
    }
}

/// A box as `[x0, y0, x1, y1]`, in the frame's units.
pub type Box4 = [f64; 4];

/// One glyph run in the frame: a text item's, a formula's parts, or a label a canvas module
/// draws for an item (`item#part`).
#[derive(Clone, Debug, PartialEq)]
pub struct Text {
    /// The run's name in issues: its item's ID, or `item#part`.
    pub id: String,
    /// The item a fix patches.
    pub item: String,
    pub boxes: Vec<Box4>,
    /// Its place in the draw order: higher draws later, on top.
    pub order: usize,
    /// It draws a halo under its glyphs (Text `text@1`: halo), which counts as its backdrop.
    pub halo: bool,
    /// Runs one morph draws as two copies of one glyph run share a key, and never overlap.
    pub morph: Option<String>,
    /// Its item's `at.pos` and `at.scale` in the document, for fixes.
    pub pos: [f64; 3],
    pub scale: [f64; 3],
    /// The item's `params.size` where its size sets its glyphs (a text), and its `params.box`
    /// width and height, for a cut's scale fix.
    pub size: Option<f64>,
    pub box_wh: [Option<f64>; 2],
}

impl Text {
    /// The text's box: the union of its glyph boxes.
    pub fn bounds(&self) -> Option<Box4> {
        union(&self.boxes)
    }
}

/// A stroke as the core's flattened polylines.
#[derive(Clone, Debug, PartialEq)]
pub struct Stroke {
    pub id: String,
    pub item: String,
    pub kind: String,
    pub order: usize,
    pub lines: Vec<Vec<[f64; 2]>>,
    /// One of axis@1's grid lines: under a text it never crosses it.
    pub grid: bool,
    /// An open path or a plot, which may leave the frame as a notice.
    pub open: bool,
}

/// A fill as its true outline: contours, filled even-odd.
#[derive(Clone, Debug, PartialEq)]
pub struct Fill {
    pub id: String,
    pub item: String,
    pub kind: String,
    pub order: usize,
    pub opacity: f64,
    pub contours: Vec<Vec<[f64; 2]>>,
}

/// The evaluated frame at one checked time.
#[derive(Clone, Debug, Default)]
pub struct Frame {
    pub t: i64,
    /// The frame in its own units: 0..w, 0..h.
    pub size: [f64; 2],
    pub texts: Vec<Text>,
    pub strokes: Vec<Stroke>,
    pub fills: Vec<Fill>,
    /// The camera has moved since the film's first checked time.
    pub camera_moved: bool,
}

/// What the check reads beside the frames: the thresholds, the backdrops the input names, the
/// document's safe margin and each item's order key (for fixes).
#[derive(Clone, Debug, Default)]
pub struct Input {
    pub limits: Limits,
    /// Items, by ID or kind, sized to sit behind text: their edges never cross it.
    pub backdrops: Vec<String>,
    pub safe: f64,
    /// Every item's order key, by ID.
    pub orders: BTreeMap<String, String>,
}

/// One issue, merged over every time it was seen.
#[derive(Clone, Debug, PartialEq)]
pub struct Found {
    pub code: &'static str,
    /// `error` or `notice`.
    pub severity: &'static str,
    pub ids: Vec<String>,
    /// The code's own fields (`item, sides`; `a, b, share`; `text, stroke`; `text, by, share`),
    /// as first seen.
    pub fields: Map<String, Value>,
    /// The first time it was seen, and every time.
    pub t: i64,
    pub ts: Vec<i64>,
    pub what: String,
    pub fix: String,
    pub fix_ops: Vec<Value>,
}

/// The union of boxes.
fn union(boxes: &[Box4]) -> Option<Box4> {
    let mut it = boxes.iter().filter(|b| b[2] >= b[0] && b[3] >= b[1]);
    let first = *it.next()?;
    Some(it.fold(first, |a, b| {
        [
            a[0].min(b[0]),
            a[1].min(b[1]),
            a[2].max(b[2]),
            a[3].max(b[3]),
        ]
    }))
}

fn area(b: &Box4) -> f64 {
    (b[2] - b[0]).max(0.0) * (b[3] - b[1]).max(0.0)
}

fn intersection(a: &Box4, b: &Box4) -> Box4 {
    [
        a[0].max(b[0]),
        a[1].max(b[1]),
        a[2].min(b[2]),
        a[3].min(b[3]),
    ]
}

fn grow(b: &Box4, by: f64) -> Box4 {
    [b[0] - by, b[1] - by, b[2] + by, b[3] + by]
}

/// Whether the segment from `p` to `q` meets the box (Liang–Barsky clipping).
pub fn segment_meets(p: [f64; 2], q: [f64; 2], b: &Box4) -> bool {
    let (dx, dy) = (q[0] - p[0], q[1] - p[1]);
    let (mut lo, mut hi) = (0.0f64, 1.0f64);
    for (den, num) in [
        (-dx, p[0] - b[0]),
        (dx, b[2] - p[0]),
        (-dy, p[1] - b[1]),
        (dy, b[3] - p[1]),
    ] {
        if den == 0.0 {
            if num < 0.0 {
                return false;
            }
            continue;
        }
        let r = num / den;
        if den < 0.0 {
            lo = lo.max(r);
        } else {
            hi = hi.min(r);
        }
        if lo > hi {
            return false;
        }
    }
    true
}

/// Whether `p` is inside the contours, even-odd.
pub fn inside(contours: &[Vec<[f64; 2]>], p: [f64; 2]) -> bool {
    let mut odd = false;
    for c in contours {
        let n = c.len();
        if n < 3 {
            continue;
        }
        let mut j = n - 1;
        for i in 0..n {
            let (a, b) = (c[i], c[j]);
            if (a[1] > p[1]) != (b[1] > p[1])
                && p[0] < (b[0] - a[0]) * (p[1] - a[1]) / (b[1] - a[1]) + a[0]
            {
                odd = !odd;
            }
            j = i;
        }
    }
    odd
}

/// The 7×7 grid of samples in a box, at its cells' centres.
fn samples(b: &Box4) -> impl Iterator<Item = [f64; 2]> + '_ {
    (0..7).flat_map(move |j| {
        (0..7).map(move |i| {
            [
                b[0] + (b[2] - b[0]) * (f64::from(i) + 0.5) / 7.0,
                b[1] + (b[3] - b[1]) * (f64::from(j) + 0.5) / 7.0,
            ]
        })
    })
}

/// The share of a box's samples inside the fill, even-odd.
pub fn covered_share(fill: &Fill, b: &Box4) -> f64 {
    let n = samples(b).filter(|p| inside(&fill.contours, *p)).count();
    n as f64 / 49.0
}

fn corners(b: &Box4) -> [[f64; 2]; 4] {
    [[b[0], b[1]], [b[2], b[1]], [b[2], b[3]], [b[0], b[3]]]
}

fn round3(x: f64) -> f64 {
    (x * 1000.0).round() / 1000.0
}

/// An issue's key: its code and what it names, so one pair seen at many times is one issue.
type Key<'a> = (&'static str, &'a str, &'a str);

/// Every issue seen so far, and the keys the frame being checked raised.
#[derive(Default)]
struct Seen<'a> {
    found: BTreeMap<Key<'a>, Found>,
    raised: Vec<Key<'a>>,
}

/// A hit at `t`: the issue `make` builds is made only the first time its key is seen.
fn see<'a>(seen: &mut Seen<'a>, key: Key<'a>, t: i64, make: impl FnOnce() -> Found) {
    match seen.found.get_mut(&key) {
        Some(f) => {
            if f.ts.last() != Some(&t) {
                f.ts.push(t);
            }
        }
        None => {
            let mut f = make();
            f.t = t;
            f.ts = vec![t];
            seen.found.insert(key, f);
        }
    }
    seen.raised.push(key);
}

fn op(item: &str, path: &str, value: Value) -> Value {
    json!({"op": "set", "id": item, "path": format!("items/{item}/{path}"), "value": value})
}

/// The film's issues over its checked frames, errors and notices, in first-seen then code order.
/// A frame equal by its evaluated data to one already checked is checked once: its issues are
/// that frame's, seen again at its time.
pub fn check(frames: &[Frame], input: &Input) -> Vec<Found> {
    let mut seen = Seen::default();
    // Each frame checked, with the keys it raised.
    let mut checked: Vec<(usize, Vec<Key<'_>>)> = Vec::new();
    for (i, f) in frames.iter().enumerate() {
        match checked.iter().find(|(j, _)| same(&frames[*j], f)) {
            Some((_, keys)) => {
                for key in keys {
                    if let Some(x) = seen.found.get_mut(key) {
                        x.ts.push(f.t);
                    }
                }
            }
            None => {
                frame_issues(f, input, &mut seen);
                checked.push((i, std::mem::take(&mut seen.raised)));
            }
        }
    }
    let mut out: Vec<Found> = seen.found.into_values().collect();
    for f in &mut out {
        f.ts.sort_unstable();
        f.ts.dedup();
        f.t = f.ts[0];
    }
    out.sort_by(|a, b| (a.t, a.code, &a.ids).cmp(&(b.t, b.code, &b.ids)));
    out
}

/// Whether two frames are equal by their evaluated data, their times left out.
fn same(a: &Frame, b: &Frame) -> bool {
    a.size == b.size
        && a.camera_moved == b.camera_moved
        && a.texts == b.texts
        && a.strokes == b.strokes
        && a.fills == b.fills
}

/// A stroke's segments in runs of [`CHUNK`] with each run's box, so a text far from most of a
/// long stroke tests only the runs near it.
const CHUNK: usize = 8;

struct Chunks {
    /// The box of every point, then each run's box with its line and first point.
    all: Box4,
    runs: Vec<(Box4, usize, usize)>,
}

fn chunks(s: &Stroke) -> Chunks {
    let mut runs = Vec::new();
    let mut all = [
        f64::INFINITY,
        f64::INFINITY,
        f64::NEG_INFINITY,
        f64::NEG_INFINITY,
    ];
    for (li, line) in s.lines.iter().enumerate() {
        let mut k = 0;
        while k + 1 < line.len() {
            let end = (k + CHUNK).min(line.len() - 1);
            let mut b = [
                f64::INFINITY,
                f64::INFINITY,
                f64::NEG_INFINITY,
                f64::NEG_INFINITY,
            ];
            for p in &line[k..=end] {
                b = [
                    b[0].min(p[0]),
                    b[1].min(p[1]),
                    b[2].max(p[0]),
                    b[3].max(p[1]),
                ];
            }
            all = [
                all[0].min(b[0]),
                all[1].min(b[1]),
                all[2].max(b[2]),
                all[3].max(b[3]),
            ];
            runs.push((b, li, k));
            k = end;
        }
    }
    Chunks { all, runs }
}

fn meets(a: &Box4, b: &Box4) -> bool {
    a[0] <= b[2] && b[0] <= a[2] && a[1] <= b[3] && b[1] <= a[3]
}

/// Whether any segment of the stroke meets the box.
fn crosses(s: &Stroke, c: &Chunks, b: &Box4) -> bool {
    if !meets(&c.all, b) {
        return false;
    }
    c.runs
        .iter()
        .filter(|(rb, _, _)| meets(rb, b))
        .any(|&(_, li, k)| {
            let line = &s.lines[li];
            let end = (k + CHUNK).min(line.len() - 1);
            (k..end).any(|i| {
                let (p, q) = (line[i], line[i + 1]);
                p[0].max(q[0]) >= b[0]
                    && p[0].min(q[0]) <= b[2]
                    && p[1].max(q[1]) >= b[1]
                    && p[1].min(q[1]) <= b[3]
                    && segment_meets(p, q, b)
            })
        })
}

fn frame_issues<'a>(f: &'a Frame, input: &Input, seen: &mut Seen<'a>) {
    let l = &input.limits;
    let t = f.t;
    let boxed: Vec<(&'a Text, Box4)> = f
        .texts
        .iter()
        .filter_map(|x| Some((x, x.bounds()?)))
        .collect();
    let frame: Box4 = [0.0, 0.0, f.size[0], f.size[1]];
    let lone = boxed.len() == 1 && f.strokes.is_empty() && f.fills.is_empty();
    // Cut: a text past the frame's edges; wholly out of frame, or under a moved camera with
    // anything else in the frame, a notice.
    for (x, b) in &boxed {
        let sides: Vec<(&str, f64)> = [
            ("left", frame[0] - b[0]),
            ("top", frame[1] - b[1]),
            ("right", b[2] - frame[2]),
            ("bottom", b[3] - frame[3]),
        ]
        .into_iter()
        .filter(|(_, by)| *by > 1e-9)
        .collect();
        if sides.is_empty() {
            continue;
        }
        let i = intersection(b, &frame);
        if i[2] <= i[0] || i[3] <= i[1] {
            notice(
                seen,
                "layout.out_of_frame",
                &x.id,
                t,
                "is wholly out of frame",
            );
            continue;
        }
        if f.camera_moved && !lone {
            notice(
                seen,
                "layout.camera_framed",
                &x.id,
                t,
                "is cut while the camera has moved",
            );
            continue;
        }
        let side_json: Vec<Value> = sides
            .iter()
            .map(|(e, by)| json!({"edge": e, "by": round3(*by)}))
            .collect();
        let ops = cut_fix(x, b, &sides, f.size, input);
        see(seen, ("layout.cut", &x.id, ""), t, || Found {
            code: "layout.cut",
            severity: "error",
            ids: vec![x.id.clone()],
            fields: obj(json!({"item": x.id, "sides": side_json})),
            t,
            ts: Vec::new(),
            what: format!(
                "{} is cut by the frame: {}",
                x.id,
                sides
                    .iter()
                    .map(|(e, by)| format!("{e} by {} u", round3(*by)))
                    .collect::<Vec<_>>()
                    .join(", ")
            ),
            fix: if ops.1 {
                "Scale the text to the safe width.".into()
            } else {
                "Move the text inside the frame by its overshoot plus the cut margin.".into()
            },
            fix_ops: ops.0,
        });
    }
    // Overlap: two texts sharing more than overlap_min of the smaller box, never a morph's two
    // copies of one run.
    for (i, (a, ab)) in boxed.iter().enumerate() {
        for (b, bb) in boxed.iter().skip(i + 1) {
            if a.morph.is_some() && a.morph == b.morph {
                continue;
            }
            let smaller = area(ab).min(area(bb));
            if smaller <= 0.0 {
                continue;
            }
            let share = area(&intersection(ab, bb)) / smaller;
            if share <= l.overlap_min {
                continue;
            }
            let (first, later, lb, fb) = if a.order <= b.order {
                (a, b, bb, ab)
            } else {
                (b, a, ab, bb)
            };
            let key = ("layout.overlap", first.id.as_str(), later.id.as_str());
            see(seen, key, t, || Found {
                code: "layout.overlap",
                severity: "error",
                ids: vec![first.id.clone(), later.id.clone()],
                fields: obj(json!({"a": first.id, "b": later.id, "share": round3(share)})),
                t,
                ts: Vec::new(),
                what: format!(
                    "{} and {} share {:.3} of the smaller box, over {}",
                    first.id, later.id, share, l.overlap_min
                ),
                fix: "Move the later text by the smallest offset that clears it.".into(),
                fix_ops: {
                    let offset = clear(fb, lb);
                    let pos = [
                        later.pos[0] + offset[0],
                        later.pos[1] + offset[1],
                        later.pos[2],
                    ];
                    vec![op(&later.item, "at/pos", json!(pos))]
                },
            });
        }
    }
    // Crossing: a stroke segment within touch of a text's box, unless a backdrop or a halo sits
    // between them, or it is a grid line under the text.
    let runs: Vec<Chunks> = f.strokes.iter().map(chunks).collect();
    for (x, b) in &boxed {
        let grown = grow(b, l.touch);
        for (s, c) in f.strokes.iter().zip(&runs) {
            if s.item == x.item || input.backdrops.iter().any(|d| *d == s.item || *d == s.kind) {
                continue;
            }
            let under = s.order < x.order;
            if under && (s.grid || x.halo) {
                continue;
            }
            if !crosses(s, c, &grown) {
                continue;
            }
            // An opaque fill drawn between them that covers the text's four corners backs it.
            let backed = under
                && f.fills.iter().any(|fl| {
                    fl.order > s.order
                        && fl.order < x.order
                        && fl.opacity >= l.backdrop_opaque
                        && corners(b).iter().all(|c| inside(&fl.contours, *c))
                });
            if backed {
                continue;
            }
            see(seen, ("layout.crossing", &x.id, &s.id), t, || {
                Found {
                code: "layout.crossing",
                severity: "error",
                ids: vec![x.id.clone(), s.id.clone()],
                fields: obj(json!({"text": x.id, "stroke": s.id})),
                t,
                ts: Vec::new(),
                what: format!("{} crosses {}", s.id, x.id),
                fix: "Give the text a 4 px halo in the look's paper (ground) role, or raise it above the stroke.".into(),
                fix_ops: {
                    // The look's paper is its `ground` role.
                    let halo = json!([{"width": 4, "role": "ground"}]);
                    let mut ops = vec![op(&x.item, "params/halo", halo)];
                    if !under {
                        if let Some(k) = above(input, &s.item) {
                            ops.push(op(&x.item, "order", json!(k)));
                        }
                    }
                    ops
                },
            }
            });
        }
    }
    // Covered: an opaque fill drawn after a text over more than covered_max of its samples.
    let fill_boxes: Vec<Option<Box4>> = f
        .fills
        .iter()
        .map(|fl| {
            union(
                &fl.contours
                    .iter()
                    .flatten()
                    .map(|p| [p[0], p[1], p[0], p[1]])
                    .collect::<Vec<_>>(),
            )
        })
        .collect();
    // A text's own fill (a formula's glyphs) is text, which overlap judges, never a cover.
    let text_items: std::collections::BTreeSet<&str> =
        f.texts.iter().map(|x| x.item.as_str()).collect();
    for (x, b) in &boxed {
        for (fl, fb) in f.fills.iter().zip(&fill_boxes) {
            if text_items.contains(fl.item.as_str())
                || fl.order <= x.order
                || fl.opacity < l.fill_opaque
            {
                continue;
            }
            if !fb.is_some_and(|fb| meets(&fb, b)) {
                continue;
            }
            let share = covered_share(fl, b);
            if share <= l.covered_max {
                continue;
            }
            see(seen, ("layout.covered", &x.id, &fl.id), t, || Found {
                code: "layout.covered",
                severity: "error",
                ids: vec![x.id.clone(), fl.id.clone()],
                fields: obj(json!({"text": x.id, "by": fl.id, "share": round3(share)})),
                t,
                ts: Vec::new(),
                what: format!("{} covers {:.3} of {}'s samples", fl.id, share, x.id),
                fix: "Lower the fill's draw order below the text.".into(),
                fix_ops: below(input, &x.item)
                    .map(|k| vec![op(&fl.item, "order", json!(k))])
                    .unwrap_or_default(),
            });
        }
    }
    // An open path or plot leaving the frame is a notice.
    for s in f.strokes.iter().filter(|s| s.open) {
        let leaves = s
            .lines
            .iter()
            .flatten()
            .any(|p| p[0] < frame[0] || p[1] < frame[1] || p[0] > frame[2] || p[1] > frame[3]);
        if leaves {
            notice(seen, "layout.open_path", &s.id, t, "leaves the frame");
        }
    }
}

fn notice<'a>(seen: &mut Seen<'a>, code: &'static str, id: &'a str, t: i64, what: &str) {
    see(seen, (code, id, ""), t, || Found {
        code,
        severity: "notice",
        ids: vec![id.to_string()],
        fields: obj(json!({"item": id})),
        t,
        ts: Vec::new(),
        what: format!("{id} {what}"),
        fix: String::new(),
        fix_ops: Vec::new(),
    });
}

fn obj(v: Value) -> Map<String, Value> {
    match v {
        Value::Object(m) => m,
        _ => Map::new(),
    }
}

/// The smallest offset along one axis that moves `b` clear of `a`.
fn clear(a: &Box4, b: &Box4) -> [f64; 2] {
    let moves = [
        [a[2] - b[0], 0.0],
        [a[0] - b[2], 0.0],
        [0.0, a[3] - b[1]],
        [0.0, a[1] - b[3]],
    ];
    let len = |m: &[f64; 2]| m[0].abs() + m[1].abs();
    moves
        .into_iter()
        .min_by(|x, y| len(x).total_cmp(&len(y)))
        .unwrap_or([0.0, 0.0])
}

/// A cut's fix: scale to the safe width when both sides of an axis are cut, else move the text
/// in by the overshoot plus the cut margin. Returns the ops and whether it scales.
fn cut_fix(
    x: &Text,
    b: &Box4,
    sides: &[(&str, f64)],
    size: [f64; 2],
    input: &Input,
) -> (Vec<Value>, bool) {
    let has = |e: &str| sides.iter().find(|(s, _)| *s == e).map(|(_, by)| *by);
    let both_x = has("left").is_some() && has("right").is_some();
    let both_y = has("top").is_some() && has("bottom").is_some();
    if both_x || both_y {
        let safe_w = (size[0] - 2.0 * input.safe).max(1.0);
        let safe_h = (size[1] - 2.0 * input.safe).max(1.0);
        let (w, h) = (b[2] - b[0], b[3] - b[1]);
        let mut k = 1.0f64;
        if both_x && w > 0.0 {
            k = k.min(safe_w / w);
        }
        if both_y && h > 0.0 {
            k = k.min(safe_h / h);
        }
        let ops = match x.size {
            // A text sets its glyphs by its size: smaller about its position, which then moves so
            // the box starts at the safe margin.
            Some(s) => {
                let mut pos = x.pos;
                if both_x {
                    pos[0] = input.safe - k * (b[0] - x.pos[0]);
                }
                if both_y {
                    pos[1] = input.safe - k * (b[1] - x.pos[1]);
                }
                let mut ops = vec![
                    op(&x.item, "at/pos", json!(pos)),
                    op(&x.item, "params/size", json!(s * k)),
                ];
                for (name, v) in ["w", "h"].iter().zip(x.box_wh) {
                    if let Some(v) = v {
                        ops.push(op(&x.item, &format!("params/box/{name}"), json!(v * k)));
                    }
                }
                ops
            }
            // Anything else scales about its box's centre, which stays put, so a position a
            // channel holds still holds.
            None => vec![
                op(&x.item, "at/pivot", json!("c")),
                op(
                    &x.item,
                    "at/scale",
                    json!([x.scale[0] * k, x.scale[1] * k, x.scale[2]]),
                ),
            ],
        };
        return (ops, true);
    }
    let m = input.limits.cut_min;
    let dx = has("left").map_or(0.0, |by| by + m) - has("right").map_or(0.0, |by| by + m);
    let dy = has("top").map_or(0.0, |by| by + m) - has("bottom").map_or(0.0, |by| by + m);
    let pos = [x.pos[0] + dx, x.pos[1] + dy, x.pos[2]];
    (vec![op(&x.item, "at/pos", json!(pos))], false)
}

/// An order key just above `item`'s: between it and the next key up.
fn above(input: &Input, item: &str) -> Option<String> {
    let k = input.orders.get(item)?;
    let next = input.orders.values().filter(|o| *o > k).min();
    crate::document::key_between(Some(k), next.map(String::as_str), item.as_bytes())
}

/// An order key just below `item`'s: between the next key down and it.
fn below(input: &Input, item: &str) -> Option<String> {
    let k = input.orders.get(item)?;
    let prev = input.orders.values().filter(|o| *o < k).max();
    crate::document::key_between(prev.map(String::as_str), Some(k), item.as_bytes())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn text(id: &str, b: Box4, order: usize) -> Text {
        Text {
            id: id.into(),
            item: id.into(),
            boxes: vec![b],
            order,
            halo: false,
            morph: None,
            pos: [b[0], b[1], 0.0],
            scale: [1.0, 1.0, 1.0],
            size: Some(40.0),
            box_wh: [None, None],
        }
    }

    fn rect(id: &str, b: Box4, order: usize) -> Fill {
        Fill {
            id: id.into(),
            item: id.into(),
            kind: "rect@1".into(),
            order,
            opacity: 1.0,
            contours: vec![corners(&b).to_vec()],
        }
    }

    fn frame(t: i64) -> Frame {
        Frame {
            t,
            size: [1920.0, 1080.0],
            ..Frame::default()
        }
    }

    #[test]
    fn covered_counts_samples_even_odd() {
        // A fill over the left 3/7 of the box covers 21 of 49 samples.
        let b = [0.0, 0.0, 70.0, 70.0];
        let f = rect("r", [0.0, 0.0, 30.0, 70.0], 1);
        assert_eq!(covered_share(&f, &b), 21.0 / 49.0);
        // Two nested contours: the hole is out, even-odd.
        let mut ring = f.clone();
        ring.contours = vec![
            corners(&[0.0, 0.0, 70.0, 70.0]).to_vec(),
            corners(&[10.0, 10.0, 60.0, 60.0]).to_vec(),
        ];
        assert_eq!(covered_share(&ring, &b), 24.0 / 49.0);
    }

    #[test]
    fn one_pair_at_many_times_is_one_issue() {
        let line = Stroke {
            id: "axis#line".into(),
            item: "axis".into(),
            kind: "axis@1".into(),
            order: 0,
            lines: vec![vec![[0.0, 520.0], [1920.0, 520.0]]],
            grid: false,
            open: false,
        };
        let mut frames = Vec::new();
        for (t, y) in [(1, 300.0), (2, 500.0), (3, 500.0), (4, 300.0)] {
            let mut f = frame(t);
            f.texts.push(text("label", [800.0, y, 900.0, y + 40.0], 1));
            f.strokes.push(line.clone());
            frames.push(f);
        }
        let found = check(&frames, &Input::default());
        assert_eq!(found.len(), 1, "{found:?}");
        assert_eq!(found[0].code, "layout.crossing");
        assert_eq!((found[0].t, found[0].ts.clone()), (2, vec![2, 3]));
        // A halo under the text, with the line drawn first, is its backdrop.
        for f in &mut frames {
            f.texts[0].halo = true;
        }
        assert!(check(&frames, &Input::default()).is_empty());
        // A grid line drawn under the text never crosses it; one drawn over it does.
        for f in &mut frames {
            f.texts[0].halo = false;
            f.strokes[0].grid = true;
        }
        assert!(check(&frames, &Input::default()).is_empty());
        for f in &mut frames {
            f.strokes[0].order = 2;
        }
        assert_eq!(check(&frames, &Input::default()).len(), 1);
    }

    #[test]
    fn overlap_is_a_share_of_the_smaller_box() {
        let mut f = frame(0);
        f.texts.push(text("a", [0.0, 0.0, 100.0, 100.0], 0));
        f.texts.push(text("b", [94.0, 0.0, 194.0, 100.0], 1));
        let found = check(&[f.clone()], &Input::default());
        assert_eq!(found.len(), 1);
        assert_eq!(found[0].fields["share"], json!(0.06));
        f.texts[1].boxes = vec![[96.0, 0.0, 196.0, 100.0]];
        assert!(check(&[f.clone()], &Input::default()).is_empty());
        // A morph's two copies of one run never overlap.
        f.texts[1].boxes = vec![[0.0, 0.0, 100.0, 100.0]];
        f.texts[0].morph = Some("m".into());
        f.texts[1].morph = Some("m".into());
        assert!(check(&[f], &Input::default()).is_empty());
    }

    #[test]
    fn cut_on_both_sides_scales_to_the_safe_width() {
        let mut f = frame(0);
        f.texts
            .push(text("title", [-182.0, 400.0, 2102.0, 480.0], 0));
        let input = Input {
            safe: 24.0,
            ..Input::default()
        };
        let found = check(&[f], &input);
        assert_eq!(found.len(), 1);
        assert_eq!(
            found[0].fields["sides"],
            json!([{"edge": "left", "by": 182.0}, {"edge": "right", "by": 182.0}])
        );
        let k = 1872.0 / 2284.0;
        assert_eq!(found[0].fix_ops[1]["value"], json!(40.0 * k));
    }

    #[test]
    fn a_looser_threshold_keeps_the_default() {
        let l = Limits::from_input(&json!({"overlap_min": 0.5, "touch": 1, "covered_max": 0.1}));
        assert_eq!((l.overlap_min, l.touch, l.covered_max), (0.05, 4.0, 0.1));
    }
}

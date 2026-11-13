//! Frame history (#173; canvas primitives: Look `look@1`: frame history): the rules a live view's
//! window of its own frames follows, as pure functions of time and of how the transport moved.
//! A window frame is a grid step's own render, jittered by an offset from its grid index alone;
//! the window at t is the grid steps up to the last one at or before t, so the frame at t is the
//! same whether it was played or seeked. Nothing here touches the GPU or keeps a frame.

use std::collections::VecDeque;

use serde_json::Value;

use crate::scene::Solid;

/// History's mode.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Mode {
    None,
    Antialias,
    Upscale,
}

/// Which parts the current frame alone counts for.
#[derive(Clone, Debug, PartialEq)]
pub enum Reactive {
    /// Parts whose emission, color or flipbook changes inside the window, particles and
    /// see-through parts.
    Auto,
    Ids(Vec<String>),
}

#[derive(Clone, Debug, PartialEq)]
pub struct Reject {
    pub depth: bool,
    /// The clamp to the current frame's neighborhood in YCoCg.
    pub clamp: bool,
    pub reactive: Reactive,
}

/// Look: frame history.
#[derive(Clone, Debug, PartialEq)]
pub struct History {
    pub mode: Mode,
    /// 2 to 16 frames.
    pub window: u32,
    /// The grid's step as a frame rate `p/q`; `None` steps at the view's frame cap.
    pub step: Option<(u32, u32)>,
    /// With upscale, the render scale the window rebuilds the display from: 0.5 to 1.
    pub scale: f64,
    pub reject: Reject,
}

impl Default for History {
    fn default() -> History {
        History {
            mode: Mode::None,
            window: 8,
            step: None,
            scale: 0.67,
            reject: Reject {
                depth: true,
                clamp: true,
                reactive: Reactive::Auto,
            },
        }
    }
}

impl History {
    pub fn on(&self) -> bool {
        self.mode != Mode::None
    }
}

/// A look's `history`, `scale` and `reject`; a look without `history` keeps none.
pub fn read_history(look: &Value) -> Result<History, String> {
    let mut h = History::default();
    let o = match look.get("history") {
        None | Some(Value::Null) => return Ok(h),
        Some(Value::Object(o)) => o,
        Some(_) => return Err("history is an object".into()),
    };
    h.mode = match o.get("mode").and_then(Value::as_str) {
        None | Some("antialias") => Mode::Antialias,
        Some("upscale") => Mode::Upscale,
        Some("none") => Mode::None,
        Some(other) => {
            return Err(format!(
                "history.mode: {other} is not none, antialias or upscale"
            ))
        }
    };
    if let Some(w) = o.get("window") {
        h.window = match w.as_u64() {
            Some(n @ 2..=16) => n as u32,
            _ => return Err("history.window is 2 to 16".into()),
        };
    }
    if let Some(step) = o.get("step") {
        let rate = serde_json::json!({ "frame_rate": step });
        let (p, q) = deep_canvas::document::frame_rate_of(&rate)
            .filter(|&(p, q)| p > 0 && q > 0)
            .ok_or("history.step is a frame rate, p/q")?;
        deep_canvas::time::frame_length(p, q).map_err(|e| format!("history.step: {e}"))?;
        h.step = Some((p, q));
    }
    if let Some(s) = o.get("scale").or_else(|| look.get("scale")) {
        h.scale = s
            .as_f64()
            .filter(|s| (0.5..=1.0).contains(s))
            .ok_or("history.scale is 0.5 to 1")?;
    }
    if let Some(r) = o.get("reject").or_else(|| look.get("reject")) {
        let r = r.as_object().ok_or("history.reject is an object")?;
        if let Some(d) = r.get("depth") {
            h.reject.depth = d.as_bool().ok_or("history.reject.depth is true or false")?;
        }
        h.reject.clamp = match r.get("clamp").and_then(Value::as_str) {
            None | Some("neighborhood") => true,
            Some("none") => false,
            Some(other) => {
                return Err(format!(
                    "history.reject.clamp: {other} is not neighborhood or none"
                ))
            }
        };
        h.reject.reactive = match r.get("reactive") {
            None => Reactive::Auto,
            Some(Value::String(s)) if s == "auto" => Reactive::Auto,
            Some(Value::Array(ids)) => Reactive::Ids(
                ids.iter()
                    .map(|v| v.as_str().map(str::to_string))
                    .collect::<Option<_>>()
                    .ok_or("history.reject.reactive is auto or a list of IDs")?,
            ),
            Some(_) => return Err("history.reject.reactive is auto or a list of IDs".into()),
        };
    }
    Ok(h)
}

/// The grid a window's frames fall on: steps at `start + k × step`, in flicks.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Grid {
    pub start: i64,
    pub step: i64,
}

impl Grid {
    /// The grid at `history.step`, else, for a film playing at `film` frames a second, the fewest
    /// of its own frames that span one interval of the view's frame `cap`, else the cap's own.
    pub fn of(
        history: &History,
        cap: u32,
        film: Option<(u32, u32)>,
        start: i64,
    ) -> Result<Grid, String> {
        let step = match (history.step, film) {
            (Some((p, q)), _) => deep_canvas::time::frame_length(p, q)?,
            (None, Some((p, q))) => {
                let frame = deep_canvas::time::frame_length(p, q)?;
                let interval = deep_canvas::time::frame_length(cap, 1)?;
                // ⌈interval ÷ frame⌉ of the film's frames, at least one.
                ((interval + frame - 1) / frame).max(1) * frame
            }
            (None, None) => deep_canvas::time::frame_length(cap, 1)?,
        };
        Ok(Grid { start, step })
    }

    /// The step that holds `t`: the last one at or before it.
    pub fn index(&self, t: i64) -> i64 {
        deep_canvas::time::index(t - self.start, self.step)
    }

    /// Where step `k` falls.
    pub fn at(&self, k: i64) -> i64 {
        self.start + k * self.step
    }
}

/// The steps of the window that ends at step `k`, oldest first: `window` of them, the grid going
/// on before the start as it does after, so the first frame has a whole window too.
pub fn steps(k: i64, window: u32) -> std::ops::RangeInclusive<i64> {
    (k - i64::from(window) + 1)..=k
}

/// Step `k`'s sub-pixel offset, px right and down: the R2 sequence's k-th point less half a
/// pixel, from the step's index alone, never a frame count or a clock.
pub fn jitter(k: i64) -> [f64; 2] {
    let [u, v] = crate::samples::r2(k.rem_euclid(1 << 32) as u32);
    [u - 0.5, v - 0.5]
}

/// How the view reached the frame it's about to show.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Move {
    /// Played forward from the frame it showed, or a display refresh inside one step.
    Play,
    /// A seek, a cut, a marker's jump, a loop's wrap, a change of ladder rung, size or revision,
    /// and the frame a scrub lets go on.
    Jump,
    /// A view your hand moves: its frames join the window as they draw, never compared.
    Hand,
    /// Dragging the playhead: frames draw without history.
    Scrub,
    /// Nothing moves: history drops and the frame settles.
    Rest,
}

/// One frame the window holds: its grid step, the layer it sits in, and whether a hand drew it.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Entry {
    pub k: i64,
    pub layer: u32,
    pub hand: bool,
}

/// What a shown frame takes.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Plan {
    /// What the view shows already: nothing renders.
    Same,
    /// One frame of its own, with no history: scrubbing or at rest.
    Plain,
    /// Render `render` (oldest first, each into its layer), then resolve `resolve` (oldest first;
    /// the last is the frame at t).
    Window {
        render: Vec<Entry>,
        resolve: Vec<Entry>,
    },
}

/// The window's schedule: which grid frames a shown frame renders and resolves, and which layer
/// each sits in.
#[derive(Clone, Debug)]
pub struct Schedule {
    window: u32,
    /// Frames kept past the window: 0 always, but in a planted twin.
    past: u32,
    entries: VecDeque<Entry>,
}

impl Schedule {
    pub fn new(window: u32, past: u32) -> Schedule {
        Schedule {
            window,
            past,
            entries: VecDeque::new(),
        }
    }

    /// The layers the window needs.
    pub fn layers(&self) -> u32 {
        self.window + self.past
    }

    /// The frames the window holds, oldest first.
    pub fn entries(&self) -> impl Iterator<Item = &Entry> {
        self.entries.iter()
    }

    /// Drops every frame the window holds.
    pub fn drop_all(&mut self) {
        self.entries.clear();
    }

    fn free_layer(&self) -> u32 {
        (0..self.layers())
            .find(|l| !self.entries.iter().any(|e| e.layer == *l))
            .expect("a window never holds more frames than layers")
    }

    fn push(&mut self, k: i64, hand: bool, render: &mut Vec<Entry>) {
        if self.entries.len() as u32 >= self.layers() {
            self.entries.pop_front();
        }
        let e = Entry {
            k,
            layer: self.free_layer(),
            hand,
        };
        // Kept in step order, a hand's frames after the step's played one.
        let at = self
            .entries
            .iter()
            .position(|x| x.k > k)
            .unwrap_or(self.entries.len());
        self.entries.insert(at, e);
        render.push(e);
    }

    /// The plan for showing grid step `k` after `how`.
    pub fn next(&mut self, k: i64, how: Move) -> Plan {
        let last = self.entries.back().map(|e| e.k);
        let how = match how {
            // Playing never steps back: a step back is a wrap, a jump.
            Move::Play if last.is_some_and(|l| k < l) => Move::Jump,
            other => other,
        };
        match how {
            Move::Scrub | Move::Rest => {
                self.entries.clear();
                return Plan::Plain;
            }
            Move::Play if last == Some(k) => return Plan::Same,
            Move::Jump => self.entries.clear(),
            _ => {}
        }
        // Nothing older than the window (and the planted twin's extra frames) stays.
        let oldest = k - i64::from(self.window + self.past) + 1;
        self.entries.retain(|e| e.k >= oldest);
        let mut render = Vec::new();
        if how == Move::Hand {
            // A hand's move draws the frame at t again, and the window fills as it goes.
            self.push(k, true, &mut render);
        } else {
            // The steps the window lacks render, each once.
            for s in steps(k, self.window) {
                if !self.entries.iter().any(|e| e.k == s && !e.hand) {
                    self.push(s, false, &mut render);
                }
            }
        }
        let resolve = self.entries.iter().copied().collect();
        Plan::Window { render, resolve }
    }
}

/// What a solid looks like at a time, as far as the reactive mask compares it: its color,
/// emission, material, maps (a flipbook's frame among them), adjust and shape (a mesh whose
/// surface deforms has another hash at another time).
#[derive(Clone, Debug, PartialEq)]
pub struct Appearance {
    color: [u8; 3],
    emission: [f64; 3],
    material: Option<crate::light::Material>,
    maps: Option<std::sync::Arc<crate::light::Maps>>,
    adjust: Option<crate::scene::Adjust3>,
    shape: crate::scene::Shape,
}

impl Appearance {
    pub fn of(s: &Solid) -> Appearance {
        Appearance {
            color: s.color,
            emission: s.emission,
            material: s.material,
            maps: s.maps.clone(),
            adjust: s.adjust,
            shape: s.shape,
        }
    }
}

/// Whether the current frame alone counts for a solid whatever the window holds: it draws
/// see-through, sways on the GPU or is shaded by a material operator.
pub fn own_frame_only(s: &Solid) -> bool {
    s.alpha < 1.0 || s.per_pixel || s.sway.is_some() || s.op.is_some()
}

/// A 3×4 affine, rows.
pub type Affine = [[f64; 4]; 3];

/// The inverse of an affine, or `None` when its linear part is singular.
pub fn inverse(m: &Affine) -> Option<Affine> {
    let a = |r: usize, c: usize| m[r][c];
    let det = a(0, 0) * (a(1, 1) * a(2, 2) - a(1, 2) * a(2, 1))
        - a(0, 1) * (a(1, 0) * a(2, 2) - a(1, 2) * a(2, 0))
        + a(0, 2) * (a(1, 0) * a(2, 1) - a(1, 1) * a(2, 0));
    if det == 0.0 || !det.is_finite() {
        return None;
    }
    let i = 1.0 / det;
    let l = [
        [
            (a(1, 1) * a(2, 2) - a(1, 2) * a(2, 1)) * i,
            (a(0, 2) * a(2, 1) - a(0, 1) * a(2, 2)) * i,
            (a(0, 1) * a(1, 2) - a(0, 2) * a(1, 1)) * i,
        ],
        [
            (a(1, 2) * a(2, 0) - a(1, 0) * a(2, 2)) * i,
            (a(0, 0) * a(2, 2) - a(0, 2) * a(2, 0)) * i,
            (a(0, 2) * a(1, 0) - a(0, 0) * a(1, 2)) * i,
        ],
        [
            (a(1, 0) * a(2, 1) - a(1, 1) * a(2, 0)) * i,
            (a(0, 1) * a(2, 0) - a(0, 0) * a(2, 1)) * i,
            (a(0, 0) * a(1, 1) - a(0, 1) * a(1, 0)) * i,
        ],
    ];
    let t = [a(0, 3), a(1, 3), a(2, 3)];
    let mut out = [[0.0; 4]; 3];
    for r in 0..3 {
        out[r][..3].copy_from_slice(&l[r]);
        out[r][3] = -(l[r][0] * t[0] + l[r][1] * t[1] + l[r][2] * t[2]);
    }
    Some(out)
}

/// `a · b` for affines.
pub fn compose(a: &Affine, b: &Affine) -> Affine {
    let mut out = [[0.0; 4]; 3];
    for r in 0..3 {
        for c in 0..4 {
            out[r][c] = a[r][0] * b[0][c] + a[r][1] * b[1][c] + a[r][2] * b[2][c];
        }
        out[r][3] += a[r][3];
    }
    out
}

/// How a solid carries a world point at t to where the same point of its surface was at a window
/// frame's time: its model then times the inverse of its model now, both from the core's own
/// evaluations; `None` when its model now is singular.
pub fn carry(now: &Affine, then: &Affine) -> Option<Affine> {
    Some(compose(then, &inverse(now)?))
}

#[cfg(test)]
mod tests {
    use super::*;
    use deep_canvas::grammar::FLICKS_PER_SECOND as S;
    use serde_json::json;

    #[test]
    fn a_look_without_history_keeps_none_and_its_fields_read_with_their_defaults() {
        assert!(!read_history(&json!({})).unwrap().on());
        let h = read_history(&json!({"history": {}})).unwrap();
        assert_eq!(h.mode, Mode::Antialias);
        assert_eq!((h.window, h.step, h.scale), (8, None, 0.67));
        assert!(h.reject.depth && h.reject.clamp && h.reject.reactive == Reactive::Auto);
        let h = read_history(&json!({
            "history": {"mode": "upscale", "window": 16, "step": "24/1", "scale": 0.5,
                        "reject": {"depth": false, "clamp": "none", "reactive": ["sign"]}}
        }))
        .unwrap();
        assert_eq!(
            (h.mode, h.window, h.step, h.scale),
            (Mode::Upscale, 16, Some((24, 1)), 0.5)
        );
        assert!(!h.reject.depth && !h.reject.clamp);
        assert_eq!(h.reject.reactive, Reactive::Ids(vec!["sign".into()]));
        for bad in [
            json!({"history": {"window": 1}}),
            json!({"history": {"window": 17}}),
            json!({"history": {"mode": "temporal"}}),
            json!({"history": {"scale": 0.4}}),
            json!({"history": {"step": "85/1"}}),
        ] {
            assert!(read_history(&bad).is_err(), "{bad}");
        }
    }

    #[test]
    fn the_grid_steps_at_the_cap_or_at_the_fewest_film_frames_that_span_it() {
        let h = History::default();
        assert_eq!(Grid::of(&h, 30, None, 0).unwrap().step, S / 30);
        // A 24 fps film under a 30 fps cap steps a frame at a time; a 60 fps film two at a time,
        // and a 50 fps film two of its own frames, 1/25 s.
        assert_eq!(Grid::of(&h, 30, Some((24, 1)), 0).unwrap().step, S / 24);
        assert_eq!(Grid::of(&h, 30, Some((60, 1)), 0).unwrap().step, S / 30);
        assert_eq!(Grid::of(&h, 30, Some((50, 1)), 0).unwrap().step, S / 25);
        let g = Grid::of(&h, 30, None, 0).unwrap();
        // The frame at t shows the last step at or before it.
        assert_eq!(g.index(S * 5 / 2), 75);
        assert_eq!(g.index(S * 5 / 2 + S / 60), 75);
        assert_eq!(g.at(75), S * 5 / 2);
        assert_eq!(steps(75, 8), 68..=75);
        assert_eq!(steps(2, 8), -5..=2);
    }

    #[test]
    fn a_steps_jitter_comes_from_its_index_alone_and_the_window_spreads_over_the_pixel() {
        assert_eq!(jitter(0), [0.0, 0.0]);
        assert_eq!(jitter(75), jitter(75));
        let w: Vec<[f64; 2]> = (68..=75).map(jitter).collect();
        for (i, a) in w.iter().enumerate() {
            assert!(a.iter().all(|x| (-0.5..0.5).contains(x)));
            for b in &w[i + 1..] {
                assert_ne!(a, b);
            }
        }
    }

    fn played(plan: &Plan) -> (Vec<i64>, Vec<i64>) {
        match plan {
            Plan::Window { render, resolve } => (
                render.iter().map(|e| e.k).collect(),
                resolve.iter().map(|e| e.k).collect(),
            ),
            other => panic!("not a window: {other:?}"),
        }
    }

    #[test]
    fn playing_renders_each_step_once_and_a_jump_renders_the_window_before_t_shows() {
        let mut s = Schedule::new(8, 0);
        let mut renders = 0;
        for k in 0..=75 {
            let (r, w) = played(&s.next(k, Move::Play));
            renders += r.len();
            assert_eq!(w, steps(k, 8).collect::<Vec<_>>());
            // A display refresh inside the step renders nothing.
            assert_eq!(s.next(k, Move::Play), Plan::Same);
        }
        // The open renders its whole window; each step after it renders once.
        assert_eq!(renders, 8 + 75);
        let mut seek = Schedule::new(8, 0);
        let (r, w) = played(&seek.next(75, Move::Jump));
        assert_eq!(r, (68..=75).collect::<Vec<_>>());
        assert_eq!(w, r);
        // A jump never keeps its window, even onto steps it holds.
        let (r, _) = played(&seek.next(75, Move::Jump));
        assert_eq!(r.len(), 8);
    }

    #[test]
    fn a_missed_step_renders_only_the_steps_the_window_lacks_and_a_wrap_is_a_jump() {
        let mut s = Schedule::new(8, 0);
        for k in 0..=73 {
            s.next(k, Move::Play);
        }
        let (r, w) = played(&s.next(75, Move::Play));
        assert_eq!(r, vec![74, 75]);
        assert_eq!(w, (68..=75).collect::<Vec<_>>());
        let (r, _) = played(&s.next(2, Move::Play));
        assert_eq!(r, (-5..=2).collect::<Vec<_>>());
    }

    #[test]
    fn a_planted_window_that_keeps_one_frame_past_it_resolves_differently_played_than_seeked() {
        let mut played_s = Schedule::new(8, 1);
        let mut w = Vec::new();
        for k in 0..=75 {
            w = played(&played_s.next(k, Move::Play)).1;
        }
        let seeked = played(&Schedule::new(8, 1).next(75, Move::Jump)).1;
        assert_eq!(w, (67..=75).collect::<Vec<_>>());
        assert_eq!(seeked, (68..=75).collect::<Vec<_>>());
    }

    #[test]
    fn scrubbing_and_rest_draw_without_history_and_letting_go_renders_the_window() {
        let mut s = Schedule::new(8, 0);
        for k in 0..=20 {
            s.next(k, Move::Play);
        }
        assert_eq!(s.next(40, Move::Scrub), Plan::Plain);
        assert_eq!(s.entries().count(), 0);
        let (r, _) = played(&s.next(40, Move::Jump));
        assert_eq!(r, (33..=40).collect::<Vec<_>>());
        assert_eq!(s.next(40, Move::Rest), Plan::Plain);
    }

    #[test]
    fn a_hands_frames_join_the_window_as_they_draw_and_never_overflow_its_layers() {
        let mut s = Schedule::new(4, 0);
        s.next(10, Move::Jump);
        for _ in 0..10 {
            let (r, w) = played(&s.next(10, Move::Hand));
            assert_eq!(r, vec![10]);
            assert!(w.len() <= 4);
            let mut layers: Vec<u32> = s.entries().map(|e| e.layer).collect();
            layers.sort();
            layers.dedup();
            assert_eq!(layers.len(), s.entries().count());
        }
    }

    #[test]
    fn carrying_a_point_takes_it_to_where_its_surface_was_then() {
        let now: Affine = [
            [0.0, -2.0, 0.0, 1.0],
            [2.0, 0.0, 0.0, -3.0],
            [0.0, 0.0, 0.5, 4.0],
        ];
        let then: Affine = [
            [1.0, 0.0, 0.0, 5.0],
            [0.0, 1.0, 0.0, 0.0],
            [0.0, 0.0, 1.0, 0.0],
        ];
        let apply = |m: &Affine, p: [f64; 3]| -> [f64; 3] {
            std::array::from_fn(|r| m[r][0] * p[0] + m[r][1] * p[1] + m[r][2] * p[2] + m[r][3])
        };
        // A point of the item's own space, where it is now and where it was then.
        let local = [0.25, -1.0, 2.0];
        let c = carry(&now, &then).unwrap();
        let got = apply(&c, apply(&now, local));
        let want = apply(&then, local);
        for i in 0..3 {
            assert!((got[i] - want[i]).abs() < 1e-12, "{got:?} {want:?}");
        }
        assert!(inverse(&[[0.0; 4]; 3]).is_none());
    }
}

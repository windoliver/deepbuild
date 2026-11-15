//! The scroll control (canvas primitives: Control: scroll): wheel and trackpad deltas become
//! whole steps once, at the gesture. A wheel line is one step; pixel deltas count one step for
//! each step's size on screen they cover, the rest carried until the gesture ends and then
//! dropped. Each change is one position, clamped to the range, so a replay reads the positions
//! and never quantizes again. With `snap`, a gesture that ends between snap points moves on to
//! the next one in its direction.

/// The wrong programs of the router a scroll control rides, chosen only by a proof scenario's
/// `planted`: one that gives the wheel to the control wherever the pointer is, and one that
/// leaves a gesture's momentum tail scrolling after a key press. The session's own, a control
/// that rounds each frame's share of a delta and one that snaps to the nearest point, are its
/// `Planted` names.
pub const PLANTED: [&str; 2] = ["wheel_to_list_everywhere", "scroll_tail_survives_keys"];

/// A scroll control's fields: its step in u, its range in steps, its page in steps and its snap.
#[derive(Clone, Debug, PartialEq)]
pub struct Spec {
    pub axis_x: bool,
    pub step: f64,
    pub range: [i32; 2],
    pub page: i32,
    pub snap: Option<i32>,
}

impl Spec {
    /// The control's `scroll` fields, with the design's defaults.
    pub fn of(control: &serde_json::Value) -> Option<Spec> {
        let s = control.get("scroll")?;
        let range = s.get("range")?.as_array()?;
        let [lo, hi] = [range.first()?.as_i64()?, range.get(1)?.as_i64()?];
        let snap = match s.get("snap") {
            None | Some(serde_json::Value::Null) => None,
            Some(v) => Some(v.as_i64().filter(|n| *n > 0)? as i32),
        };
        Some(Spec {
            axis_x: s.get("axis").and_then(|a| a.as_str()) == Some("x"),
            step: s.get("step").map_or(Some(24.0), |v| v.as_f64())?,
            range: [lo.min(hi) as i32, lo.max(hi) as i32],
            page: s.get("page").map_or(Some(10), |v| v.as_i64())? as i32,
            snap,
        })
    }

    pub fn clamp(&self, p: i64) -> i32 {
        p.clamp(self.range[0] as i64, self.range[1] as i64) as i32
    }
}

/// One gesture's quantizer: the position, the pixels carried and the gesture's direction.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Gesture {
    /// Pixels not yet a whole step, with their sign.
    carry: f64,
    /// The sign of the gesture's net delta.
    sum: f64,
}

impl Gesture {
    /// Positions written by `steps` whole steps from `at`, one for each change, clamped.
    fn walk(spec: &Spec, at: &mut i32, steps: i64) -> Vec<i32> {
        let mut out = Vec::new();
        let dir = steps.signum();
        for _ in 0..steps.unsigned_abs() {
            let next = spec.clamp(*at as i64 + dir);
            if next == *at {
                break;
            }
            *at = next;
            out.push(next);
        }
        out
    }

    /// A wheel delta of `lines` lines, positive towards the range's end.
    pub fn lines(&mut self, spec: &Spec, at: &mut i32, lines: f64) -> Vec<i32> {
        self.sum += lines;
        let whole = lines.trunc() as i64;
        Self::walk(spec, at, whole)
    }

    /// A pixel delta of `px` px, positive towards the range's end, with a step `per_step` px on
    /// screen: one step for each `per_step` the carried pixels cover.
    pub fn pixels(&mut self, spec: &Spec, at: &mut i32, px: f64, per_step: f64) -> Vec<i32> {
        if !(per_step > 0.0) || !px.is_finite() {
            return Vec::new();
        }
        self.sum += px;
        self.carry += px;
        let whole = (self.carry / per_step).trunc();
        self.carry -= whole * per_step;
        Self::walk(spec, at, whole as i64)
    }

    /// The gesture's end: the carried pixels are dropped and, with a snap, a position between
    /// snap points moves on to the next one in the gesture's direction (planted: the nearest).
    pub fn end(&mut self, spec: &Spec, at: &mut i32, nearest: bool) -> Vec<i32> {
        let dir = self.sum.signum() as i64;
        *self = Gesture::default();
        let Some(n) = spec.snap else {
            return Vec::new();
        };
        let (n, p) = (n as i64, *at as i64);
        if p.rem_euclid(n) == 0 {
            return Vec::new();
        }
        let below = p.div_euclid(n) * n;
        let to = if nearest {
            if p - below < below + n - p {
                below
            } else {
                below + n
            }
        } else if dir < 0 {
            below
        } else if dir > 0 {
            below + n
        } else {
            return Vec::new();
        };
        let to = spec.clamp(to);
        if to == *at {
            return Vec::new();
        }
        *at = to;
        vec![to]
    }
}

/// The planted control's frame share: a frame's summed pixels rounded on their own, no carry.
pub fn rounded_share(spec: &Spec, at: &mut i32, px: f64, per_step: f64) -> Vec<i32> {
    if !(per_step > 0.0) {
        return Vec::new();
    }
    Gesture::walk(spec, at, (px / per_step).round() as i64)
}

/// A key's move with focus: arrows a step, Page Up and Page Down a page, Home and End the ends.
pub fn key(spec: &Spec, at: i32, key: &str) -> Option<i32> {
    let (back, fwd) = if spec.axis_x {
        ("ArrowLeft", "ArrowRight")
    } else {
        ("ArrowUp", "ArrowDown")
    };
    let to = match key {
        k if k == back => at as i64 - 1,
        k if k == fwd => at as i64 + 1,
        "PageUp" => at as i64 - spec.page as i64,
        "PageDown" => at as i64 + spec.page as i64,
        "Home" => spec.range[0] as i64,
        "End" => spec.range[1] as i64,
        _ => return None,
    };
    Some(spec.clamp(to))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn spec(snap: Option<i32>, hi: i32) -> Spec {
        Spec {
            axis_x: false,
            step: 24.0,
            range: [0, hi],
            page: 10,
            snap,
        }
    }

    #[test]
    fn pixels_carry_within_a_gesture_and_drop_at_its_end() {
        let s = spec(None, 190);
        let (mut g, mut at) = (Gesture::default(), 3);
        assert_eq!(g.pixels(&s, &mut at, 60.0, 24.0), vec![4, 5]);
        assert_eq!(g.pixels(&s, &mut at, 12.0, 24.0), vec![6]);
        assert_eq!(g.pixels(&s, &mut at, 20.0, 24.0), Vec::<i32>::new());
        assert!(g.end(&s, &mut at, false).is_empty());
        assert_eq!(g.pixels(&s, &mut at, 20.0, 24.0), Vec::<i32>::new());
    }

    #[test]
    fn a_snap_moves_on_in_the_gestures_direction() {
        let s = spec(Some(7), 21);
        let (mut g, mut at) = (Gesture::default(), 0);
        assert_eq!(g.pixels(&s, &mut at, 34.0, 24.0), vec![1]);
        assert_eq!(g.end(&s, &mut at, false), vec![7]);
        assert_eq!(g.pixels(&s, &mut at, -34.0, 24.0), vec![6]);
        assert_eq!(g.end(&s, &mut at, false), vec![0]);
        assert!(g.pixels(&s, &mut at, 10.0, 24.0).is_empty());
        assert!(g.end(&s, &mut at, false).is_empty());
        let mut at = 0;
        g.pixels(&s, &mut at, 34.0, 24.0);
        assert_eq!(g.end(&s, &mut at, true), vec![0]);
    }

    #[test]
    fn keys_move_a_step_a_page_or_to_an_end_inside_the_range() {
        let s = spec(None, 190);
        assert_eq!(key(&s, 0, "ArrowUp"), Some(0));
        assert_eq!(key(&s, 0, "PageDown"), Some(10));
        assert_eq!(key(&s, 3, "End"), Some(190));
        assert_eq!(key(&s, 185, "PageDown"), Some(190));
    }
}

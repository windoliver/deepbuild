//! The scroll control (canvas primitives: Control: scroll): wheel and trackpad deltas become
//! whole steps once, at the gesture. A wheel line is one step; pixel deltas count one step for
//! each step's size on screen they cover, the rest carried until the gesture ends and then
//! dropped. Each change is one position, clamped to the range, so a replay reads the positions
//! and never quantizes again. With `snap`, a gesture that ends between snap points moves on to
//! the next one in its direction.

use deep_canvas::scope::Phase;
use serde_json::json;

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
        let axis_x = match s.get("axis").map(|a| a.as_str()) {
            None | Some(Some("y")) => false,
            Some(Some("x")) => true,
            _ => return None,
        };
        Some(Spec {
            axis_x,
            step: s
                .get("step")
                .map_or(Some(24.0), |v| v.as_f64())
                .filter(|v| *v > 0.0)?,
            range: [lo.min(hi) as i32, lo.max(hi) as i32],
            page: s.get("page").map_or(Some(10), |v| v.as_i64())? as i32,
            snap,
        })
    }

    /// A control's class: view unless it says document (Control: scroll).
    pub fn document(control: &serde_json::Value) -> bool {
        control.get("class").and_then(|c| c.as_str()) == Some("document")
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

/// The document's scroll controls at check: their `scroll` fields (a positive step, a range of
/// i32, a positive page and snap, axis x or y), an `area` naming one of the document's items, and
/// class view or document, each refusal naming the control.
pub fn check(doc: &serde_json::Value) -> Vec<deep_canvas::document::Issue> {
    use deep_canvas::document::Issue;
    let controls = doc.get("controls").and_then(|c| c.as_object());
    let scrolls = controls
        .into_iter()
        .flatten()
        .filter(|(_, c)| c.get("kind").and_then(|k| k.as_str()) == Some("scroll"));
    let mut out = Vec::new();
    for (id, c) in scrolls {
        let fields = c.get("scroll").cloned().unwrap_or_default();
        let fits = |k: &str| {
            fields
                .pointer(k)
                .and_then(|v| v.as_i64())
                .is_some_and(|v| i32::try_from(v).is_ok())
        };
        let page = fields
            .get("page")
            .is_none_or(|p| p.as_i64().is_some_and(|p| p > 0));
        if Spec::of(c).is_none() || !fits("/range/0") || !fits("/range/1") || !page {
            let what = "a scroll control takes a step over 0, a range of two i32, a page and a snap over 0, and axis x or y";
            out.push(Issue::error(
                "out_of_range",
                id,
                format!("controls/{id}/scroll"),
                fields.clone(),
                what,
            ));
        }
        let area = fields.get("area").and_then(|a| a.as_str());
        if area.is_none_or(|a| doc.get("items").and_then(|i| i.get(a)).is_none()) {
            let what = "a scroll control's area names an item of the document, the area that takes the wheel";
            out.push(Issue::error(
                "ref_unresolved",
                id,
                format!("controls/{id}/scroll/area"),
                json!(area),
                what,
            ));
        }
        if c.get("class")
            .is_some_and(|k| k != "document" && k != "view")
        {
            let what = "a scroll control is class view or document";
            out.push(Issue::error(
                "out_of_range",
                id,
                format!("controls/{id}/class"),
                c["class"].clone(),
                what,
            ));
        }
    }
    out
}

/// Where a wheel or trackpad event goes (Control: scroll; Scope bullet "a scroll tail stays with
/// its gesture"): a trackpad gesture, its momentum tail included, goes to the scroll control it
/// began over, or to the camera when it began over none, wherever the pointer drifts. Once the
/// touch has ended, a key press ends the tail; from the first modifier change, the gesture's
/// phases drop until a new gesture. A wheel's notch is a gesture of its own.
#[derive(Debug, Default)]
pub struct Router {
    latch: Option<Latch>,
}

#[derive(Debug)]
struct Latch {
    target: Option<String>,
    mods: [bool; 4],
    lifted: bool,
    ended: bool,
}

/// Where an event goes.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Route {
    To(String),
    Camera,
    Drop,
}

impl Router {
    /// A key press: a tail under way ends (the planted `scroll_tail_survives_keys`: it doesn't).
    pub fn key(&mut self, survives: bool) {
        if let Some(l) = self.latch.as_mut().filter(|l| l.lifted && !survives) {
            l.ended = true;
        }
    }

    /// An event of `phase`, a wheel's `line` or a tail's `momentum`, with modifiers `mods`, over
    /// scroll control `over`, if any.
    pub fn route(
        &mut self,
        phase: Phase,
        line: bool,
        momentum: bool,
        mods: [bool; 4],
        over: Option<&str>,
    ) -> Route {
        let to = |t: Option<&str>| t.map_or(Route::Camera, |t| Route::To(t.to_string()));
        if line {
            return to(over);
        }
        if (phase == Phase::Begin && !momentum) || self.latch.is_none() {
            self.latch = Some(Latch {
                target: over.map(str::to_string),
                mods,
                lifted: false,
                ended: false,
            });
        }
        let l = self.latch.as_mut().expect("set above");
        if l.mods != mods {
            l.ended = true;
        }
        let route = if l.ended {
            Route::Drop
        } else {
            to(l.target.as_deref())
        };
        if phase == Phase::End {
            if momentum {
                self.latch = None;
            } else {
                l.lifted = true;
            }
        }
        route
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
        assert_eq!(key(&s, 15, "PageUp"), Some(5));
        assert_eq!(key(&s, 15, "Home"), Some(0));
        assert_eq!(key(&s, 15, "ArrowLeft"), None);
        let x = Spec {
            axis_x: true,
            ..spec(None, 190)
        };
        assert_eq!(key(&x, 15, "ArrowLeft"), Some(14));
        assert_eq!(key(&x, 15, "ArrowDown"), None);
    }

    #[test]
    fn the_check_names_a_missing_area_a_zero_step_and_a_viewer_class_and_view_is_the_default() {
        let doc = |scroll: serde_json::Value, class: Option<&str>| {
            let mut c = json!({"kind": "scroll", "scroll": scroll});
            if let Some(k) = class {
                c["class"] = json!(k);
            }
            json!({"items": {"listbox": {}}, "controls": {"list": c}})
        };
        let good = json!({"range": [0, 190], "area": "listbox", "snap": 7});
        assert!(check(&doc(good.clone(), None)).is_empty());
        assert!(!Spec::document(
            &doc(good.clone(), None)["controls"]["list"]
        ));
        let paths =
            |d: serde_json::Value| check(&d).into_iter().map(|i| i.path).collect::<Vec<_>>();
        assert_eq!(
            paths(doc(json!({"range": [0, 190], "area": "nowhere"}), None)),
            ["controls/list/scroll/area"]
        );
        assert_eq!(
            paths(doc(
                json!({"range": [0, 190], "area": "listbox", "step": 0}),
                None
            )),
            ["controls/list/scroll"]
        );
        assert_eq!(
            paths(doc(
                json!({"range": [0, 3_000_000_000_i64], "area": "listbox"}),
                None
            )),
            ["controls/list/scroll"]
        );
        assert_eq!(paths(doc(good, Some("viewer"))), ["controls/list/class"]);
    }

    const NO: [bool; 4] = [false; 4];

    #[test]
    fn a_gesture_and_its_tail_stay_with_the_target_they_began_over() {
        let mut r = Router::default();
        let to = Route::To("list".into());
        assert_eq!(r.route(Phase::Begin, false, false, NO, Some("list")), to);
        assert_eq!(r.route(Phase::Change, false, false, NO, None), to);
        assert_eq!(r.route(Phase::End, false, false, NO, None), to);
        assert_eq!(r.route(Phase::Begin, false, true, NO, None), to);
        assert_eq!(r.route(Phase::End, false, true, NO, None), to);
        // Over no control, a gesture is the camera's even where it drifts over one.
        assert_eq!(r.route(Phase::Begin, false, false, NO, None), Route::Camera);
        assert_eq!(
            r.route(Phase::Change, false, false, NO, Some("list")),
            Route::Camera
        );
        // A wheel's notch goes where the pointer is.
        assert_eq!(r.route(Phase::Change, true, false, NO, Some("list")), to);
    }

    #[test]
    fn a_key_ends_the_tail_and_a_modifier_change_drops_the_gesture_until_a_new_one() {
        let mut r = Router::default();
        let to = Route::To("list".into());
        r.route(Phase::Begin, false, false, NO, Some("list"));
        r.key(false);
        assert_eq!(
            r.route(Phase::Change, false, false, NO, Some("list")),
            to,
            "a key while the fingers scroll"
        );
        r.route(Phase::End, false, false, NO, Some("list"));
        assert_eq!(r.route(Phase::Begin, false, true, NO, None), to);
        r.key(false);
        assert_eq!(r.route(Phase::Change, false, true, NO, None), Route::Drop);
        assert_eq!(r.route(Phase::End, false, true, NO, None), Route::Drop);
        let shift = [true, false, false, false];
        assert_eq!(r.route(Phase::Begin, false, false, NO, Some("list")), to);
        assert_eq!(
            r.route(Phase::Change, false, false, shift, Some("list")),
            Route::Drop
        );
        assert_eq!(
            r.route(Phase::Change, false, false, NO, Some("list")),
            Route::Drop
        );
        assert_eq!(r.route(Phase::Begin, false, false, shift, Some("list")), to);
    }
}

//! Where an item draws (#162 moved it here from the scene and gave it the item's turn): `x ↦
//! scale·x + pos` from its evaluated `at`, which already rides its parents as the evaluator
//! composes them; with a box-point pivot it scales about that point of its own box (#221); then it
//! turns `at.rot`'s z about where its pivot lands, its position with no pivot (Units and axes:
//! subtract the pivot, scale, rotate, add the position). Shear, a numeric pivot and turns about x
//! and y wait for the GPU layer.

use serde_json::Value;

use crate::path::Verb;
use crate::relations::{self, Point};

#[derive(Clone, Copy, Debug, PartialEq)]
pub(crate) struct Place {
    pub(crate) scale: [f64; 2],
    pub(crate) offset: [f64; 2],
    /// Degrees about z, x toward y, and the point it turns about.
    turn: f64,
    about: [f64; 2],
}

impl Place {
    pub(crate) const NONE: Place = Place {
        scale: [1.0, 1.0],
        offset: [0.0, 0.0],
        turn: 0.0,
        about: [0.0, 0.0],
    };

    pub(crate) fn of(item: &Value) -> Place {
        let pivot = item
            .get("at")
            .and_then(|a| a.get("pivot"))
            .and_then(Value::as_str)
            .and_then(Point::parse);
        let local = pivot.and_then(|_| {
            let kind = item.get("kind").and_then(Value::as_str)?;
            let empty = serde_json::Map::new();
            let params = item
                .get("params")
                .and_then(Value::as_object)
                .unwrap_or(&empty);
            relations::own_box(kind, params)
        });
        let (scale, offset) = relations::place_of(item, local);
        let c = match (pivot, local) {
            (Some(p), Some(b)) => p.of(b),
            _ => [0.0, 0.0],
        };
        Place {
            scale,
            offset,
            turn: item
                .pointer("/at/rot/2")
                .and_then(Value::as_f64)
                .unwrap_or(0.0),
            about: [offset[0] + scale[0] * c[0], offset[1] + scale[1] * c[1]],
        }
    }

    /// Where `p` draws: scaled and moved, then turned.
    pub(crate) fn at(&self, p: [f64; 2]) -> [f64; 2] {
        self.turned(self.unturned(p))
    }

    fn unturned(&self, p: [f64; 2]) -> [f64; 2] {
        [
            self.scale[0] * p[0] + self.offset[0],
            self.scale[1] * p[1] + self.offset[1],
        ]
    }

    fn turned(&self, q: [f64; 2]) -> [f64; 2] {
        if self.turn == 0.0 {
            return q;
        }
        let (s, c) = crate::turn::sin_cos(self.turn);
        let d = [q[0] - self.about[0], q[1] - self.about[1]];
        [
            self.about[0] + c * d[0] - s * d[1],
            self.about[1] + s * d[0] + c * d[1],
        ]
    }

    /// True when the place only moves what it holds, as R1's marks can draw.
    pub(crate) fn moves(&self) -> bool {
        self.scale == [1.0, 1.0] && self.turn == 0.0
    }

    /// As a gradient's transform: `[a, b, c, d, e, f]`, x′ = a x + c y + e, y′ = b x + d y + f.
    pub(crate) fn affine(&self) -> [f64; 6] {
        let o = self.at([0.0, 0.0]);
        let x = self.at([1.0, 0.0]);
        let y = self.at([0.0, 1.0]);
        [
            x[0] - o[0],
            x[1] - o[1],
            y[0] - o[0],
            y[1] - o[1],
            o[0],
            o[1],
        ]
    }

    /// A box `[x, y, w, h]` where it draws, unturned: a mask's, a frame's or an image's box, each
    /// of which its own mark turns where it turns.
    pub(crate) fn rect(&self, [x, y, w, h]: [f64; 4]) -> [f64; 4] {
        let (a, b) = (self.unturned([x, y]), self.unturned([x + w, y + h]));
        [
            a[0].min(b[0]),
            a[1].min(b[1]),
            (b[0] - a[0]).abs(),
            (b[1] - a[1]).abs(),
        ]
    }

    pub(crate) fn verbs(&self, verbs: Vec<Verb>) -> Vec<Verb> {
        let m = |p: [f64; 2]| self.at(p);
        verbs
            .into_iter()
            .map(|v| match v {
                Verb::Move(p) => Verb::Move(m(p)),
                Verb::Line(p) => Verb::Line(m(p)),
                Verb::Quad(a, b) => Verb::Quad(m(a), m(b)),
                Verb::Cubic(a, b, c) => Verb::Cubic(m(a), m(b), m(c)),
                Verb::Close => Verb::Close,
            })
            .collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn a_turn_turns_about_the_position_or_the_landed_pivot() {
        let p = Place::of(
            &json!({"kind": "rect@1", "params": {"box": [0, 0, 20, 10]}, "at": {"pos": [100, 50, 0], "rot": [0, 0, 90]}}),
        );
        assert_eq!(p.at([0.0, 0.0]), [100.0, 50.0]);
        assert_eq!(p.at([20.0, 0.0]), [100.0, 70.0], "x turns toward y");
        assert!(!p.moves());
        let c = Place::of(
            &json!({"kind": "rect@1", "params": {"box": [0, 0, 20, 10]}, "at": {"pos": [100, 50, 0], "rot": [0, 0, 90], "pivot": "c"}}),
        );
        assert_eq!(c.at([10.0, 5.0]), [110.0, 55.0], "the centre stays put");
        assert_eq!(c.at([20.0, 5.0]), [110.0, 65.0]);
        assert_eq!(
            c.rect([0.0, 0.0, 20.0, 10.0]),
            [100.0, 50.0, 20.0, 10.0],
            "a box stays unturned"
        );
    }

    #[test]
    fn no_turn_moves_as_before() {
        let p = Place::of(
            &json!({"kind": "rect@1", "params": {"box": [0, 0, 20, 10]}, "at": {"pos": [3, 4, 0]}}),
        );
        assert!(p.moves());
        assert_eq!(p.affine(), [1.0, 0.0, 0.0, 1.0, 3.0, 4.0]);
    }
}

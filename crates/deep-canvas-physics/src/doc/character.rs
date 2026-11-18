//! #182: a character body's own fields (canvas primitives: Body `body@1`: character). Its
//! `shapes` hold one capsule and no `follow`; `character` sets its slope limit, step, snap,
//! offset, jump and an optional crouching capsule, each with the design's default.

use serde_json::{Map, Value};

use super::{join, BodyKind, Reader, Shape, ShapeUse};
use std::collections::BTreeMap;

/// What a character body is, besides a body: the controller's limits and its jump.
#[derive(Clone, Debug, PartialEq)]
pub struct Character {
    /// deg: the steepest surface it walks on and climbs.
    pub slope_limit: f64,
    /// m: the highest step it climbs, and the free width a step's top needs.
    pub step_height: f64,
    pub step_width: f64,
    /// m: how far below it ground snaps it down while it walks down; 0 never.
    pub snap: f64,
    /// m: the gap it keeps from what it meets.
    pub offset: f64,
    /// m: the height a jump with none of its own rises.
    pub jump: f64,
    /// The capsule: radius and half height of its cylinder, m.
    pub radius: f64,
    pub half_height: f64,
    /// m: the crouching capsule's height, tip to tip, when declared.
    pub crouch: Option<f64>,
}

impl Character {
    /// m: the gap under it within which a walkable surface grounds it (`offset` + 0.05 m).
    pub fn ground_distance(&self) -> f64 {
        self.offset + 0.05
    }

    /// The cosine of the slope limit: a surface whose normal's part along up is at least this
    /// is walkable (pinned math, so every machine reads it alike).
    pub fn walkable(&self) -> f64 {
        deep_canvas::ops::cos(self.slope_limit.to_radians())
    }

    /// The vertical speed a jump of `height` m sets under gravity `g` × `gravity_scale`, m/s.
    pub fn jump_speed(g: f64, gravity_scale: f64, height: f64) -> f64 {
        deep_canvas::ops::sqrt(2.0 * g * gravity_scale * height)
    }

    /// The half height of the crouching capsule's cylinder, m.
    pub fn crouch_half_height(&self) -> Option<f64> {
        self.crouch.map(|h| h / 2.0 - self.radius)
    }
}

/// The fields of `character` and their defaults, as `deep_kinds` lists them.
pub const FIELDS: [(&str, &str); 7] = [
    ("slope_limit", "deg = 45"),
    ("step.height", "m = 0.3"),
    ("step.width", "m = the capsule's radius"),
    ("snap", "m = 0.2"),
    ("offset", "m = 0.01"),
    ("jump.height", "m = 1"),
    (
        "crouch.height",
        "m (optional): a second, lower capsule of the same radius",
    ),
];

impl Reader {
    /// Body `p`'s `character` when its kind is character: one capsule, no follow, and the
    /// fields within their ranges; a `character` on another kind is refused.
    pub(super) fn character(
        &mut self,
        b: &Map<String, Value>,
        p: &str,
        kind: BodyKind,
        uses: &[ShapeUse],
        shapes: &BTreeMap<String, Shape>,
    ) -> Option<Character> {
        if kind != BodyKind::Character {
            if let Some(x) = b.get("character") {
                self.refuse(
                    "out_of_range",
                    join(p, "character"),
                    x,
                    "only a body of kind character takes character".into(),
                );
            }
            return None;
        }
        let capsule = match uses {
            [u] => match shapes.get(&u.shape) {
                Some(Shape::Capsule {
                    half_height,
                    radius,
                }) => Some((*radius, *half_height)),
                Some(_) => {
                    self.refuse(
                        "out_of_range",
                        join(p, "shapes/0/shape"),
                        &b["shapes"][0]["shape"],
                        format!(
                            "a character body holds one capsule, and {} isn't one",
                            u.shape
                        ),
                    );
                    None
                }
                None => None,
            },
            _ => {
                self.refuse(
                    "out_of_range",
                    join(p, "shapes"),
                    b.get("shapes").unwrap_or(&Value::Null),
                    format!(
                        "a character body holds one capsule, not {} shapes",
                        uses.len()
                    ),
                );
                None
            }
        };
        let cp = join(p, "character");
        let c = &self.obj(
            b.get("character").unwrap_or(&Value::Null),
            &cp,
            &["slope_limit", "step", "snap", "offset", "jump", "crouch"],
        );
        let sp = join(&cp, "step");
        let step = &self.obj(
            c.get("step").unwrap_or(&Value::Null),
            &sp,
            &["height", "width"],
        );
        let jp = join(&cp, "jump");
        let jump = &self.obj(c.get("jump").unwrap_or(&Value::Null), &jp, &["height"]);
        let (radius, half_height) = capsule?;
        let crp = join(&cp, "crouch");
        let crouch = c.get("crouch").map(|x| {
            let o = &self.obj(x, &crp, &["height"]);
            o.get("height").cloned().unwrap_or(Value::Null)
        });
        let tall = 2.0 * (half_height + radius);
        let crouch = match crouch {
            None => None,
            Some(h) => match h.as_f64() {
                Some(x) if x >= 2.0 * radius && x < tall => Some(x),
                _ => {
                    self.refuse(
                        "out_of_range",
                        join(&crp, "height"),
                        &h,
                        format!("a crouching capsule's height is at least twice its radius ({} m) and under the standing capsule's height ({tall} m)", 2.0 * radius),
                    );
                    None
                }
            },
        };
        Some(Character {
            slope_limit: self.num(c, "slope_limit", &cp, 45.0, 0.0, 90.0),
            step_height: self.num(step, "height", &sp, 0.3, 0.0, f64::MAX),
            step_width: self.num(step, "width", &sp, radius, 0.0, f64::MAX),
            snap: self.num(c, "snap", &cp, 0.2, 0.0, f64::MAX),
            offset: self.num(c, "offset", &cp, 0.01, f64::MIN_POSITIVE, f64::MAX),
            jump: self.num(jump, "height", &jp, 1.0, 0.0, f64::MAX),
            radius,
            half_height,
            crouch,
        })
    }
}

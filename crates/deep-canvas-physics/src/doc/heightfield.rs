//! #2014's `heightfield {cols, rows, heights, scale}` shape (canvas primitives: Shape), which a
//! terrain plate's collision is built as.

use serde_json::{json, Map, Value};

use super::{join, Reader, Shape};

/// The most samples a heightfield takes a side, a terrain plate's cap (4,096 cells).
pub const HEIGHTFIELD_SAMPLES: u64 = 4097;

impl Reader {
    /// A heightfield's samples and scale, or its refusal at the field at fault.
    pub(super) fn heightfield(&mut self, s: &Map<String, Value>, p: &str) -> Option<Shape> {
        let side = |key: &str| {
            s.get(key)
                .and_then(Value::as_u64)
                .filter(|n| (2..=HEIGHTFIELD_SAMPLES).contains(n))
                .map(|n| n as usize)
        };
        let (Some(cols), Some(rows)) = (side("cols"), side("rows")) else {
            self.refuse(
                "out_of_range",
                join(p, "cols"),
                &json!([s.get("cols"), s.get("rows")]),
                format!(
                    "a heightfield's cols and rows must each be 2 to {HEIGHTFIELD_SAMPLES} samples"
                ),
            );
            return None;
        };
        let heights = s
            .get("heights")
            .and_then(Value::as_array)
            .and_then(|a| a.iter().map(Value::as_f64).collect::<Option<Vec<_>>>())
            .filter(|h| h.len() == cols * rows);
        let Some(heights) = heights else {
            self.refuse(
                "out_of_range",
                join(p, "heights"),
                s.get("heights").unwrap_or(&Value::Null),
                format!(
                    "a heightfield's heights must be cols × rows = {} numbers",
                    cols * rows
                ),
            );
            return None;
        };
        let scale = self.vec3(s, "scale", p, [1.0; 3]);
        if scale.iter().any(|x| !x.is_finite() || *x <= 0.0) {
            self.refuse(
                "out_of_range",
                join(p, "scale"),
                s.get("scale").unwrap_or(&Value::Null),
                "a heightfield's scale must be three positive numbers".into(),
            );
            return None;
        }
        Some(Shape::Heightfield {
            cols,
            rows,
            heights,
            scale,
        })
    }
}

//! A path's build (#466; canvas primitives: Path `path@1`: `build`): its strokes drawn on in turn
//! by a progress channel, each sub-path one stroke owning an equal share of the progress, in
//! index order or a seeded one; its fill after the strokes, with them, or never; and, with
//! `emits`, each stroke's span compiled at check into the occurrence list `<item>.build`.

use serde_json::{Map, Value};

use crate::path::Verb;
use crate::pathops::{subs_of, trim, verbs_of};

/// When a built path's fill draws.
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Fill {
    After,
    With,
    None,
}

/// A path's `build`.
#[derive(Clone, Debug, PartialEq)]
pub struct Build {
    pub progress: f64,
    pub seeded: bool,
    pub emits: bool,
    pub fill: Fill,
}

/// The path's `build`, `None` without one, or the field it refuses.
pub fn read(params: &Map<String, Value>) -> Result<Option<Build>, String> {
    let Some(b) = params.get("build").filter(|b| !b.is_null()) else {
        return Ok(None);
    };
    let Some(b) = b.as_object() else {
        return Err("build".into());
    };
    let progress = match b.get("progress") {
        None => 1.0,
        Some(v) => v.as_f64().ok_or("build/progress")?.clamp(0.0, 1.0),
    };
    let seeded = match b.get("order").and_then(Value::as_str) {
        None | Some("index") => false,
        Some("seeded") => true,
        Some(_) => return Err("build/order".into()),
    };
    let emits = match b.get("emits") {
        None => false,
        Some(v) => v.as_bool().ok_or("build/emits")?,
    };
    let fill = match b.get("fill").and_then(Value::as_str) {
        None | Some("after") => Fill::After,
        Some("with") => Fill::With,
        Some("none") => Fill::None,
        Some(_) => return Err("build/fill".into()),
    };
    Ok(Some(Build {
        progress,
        seeded,
        emits,
        fill,
    }))
}

/// The order `n` strokes draw in: by index, or seeded from the item's ID.
pub fn order(n: usize, seeded: bool, id: &str) -> Vec<usize> {
    let mut out: Vec<usize> = (0..n).collect();
    if seeded {
        let key = |k: usize| {
            id.bytes()
                .chain((k as u64).to_le_bytes())
                .fold(0xcbf2_9ce4_8422_2325u64, |h, b| {
                    (h ^ u64::from(b)).wrapping_mul(0x0100_0000_01b3)
                })
        };
        out.sort_by_key(|&k| key(k));
    }
    out
}

/// Each stroke's share of the progress, `[from, to)`, by stroke index: the k-th to draw owns
/// [k ÷ n, (k + 1) ÷ n).
pub fn spans(n: usize, seeded: bool, id: &str) -> Vec<(f64, f64)> {
    let mut out = vec![(0.0, 0.0); n];
    for (k, stroke) in order(n, seeded, id).into_iter().enumerate() {
        out[stroke] = (k as f64 / n as f64, (k + 1) as f64 / n as f64);
    }
    out
}

impl Build {
    /// `verbs` as far as the build has drawn them: each stroke drawn on by its share.
    pub fn drawn(&self, verbs: &[Verb], id: &str) -> Vec<Verb> {
        if self.progress >= 1.0 {
            return verbs.to_vec();
        }
        let subs = subs_of(verbs);
        let spans = spans(subs.len(), self.seeded, id);
        let shown: Vec<_> = subs
            .iter()
            .zip(spans)
            .flat_map(|(s, (a, b))| {
                let end = ((self.progress - a) / (b - a)).clamp(0.0, 1.0);
                trim(std::slice::from_ref(s), 0.0, end, 0.0, false)
            })
            .collect();
        verbs_of(&shown)
    }

    /// Whether the fill draws at this progress.
    pub fn fills(&self) -> bool {
        match self.fill {
            Fill::After => self.progress >= 1.0,
            Fill::With => true,
            Fill::None => false,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn two_strokes() -> Vec<Verb> {
        crate::path::parse("M 0 0 L 100 0 M 0 50 L 100 50").unwrap()
    }

    #[test]
    fn strokes_draw_on_in_turn() {
        let b = |p: f64| Build {
            progress: p,
            seeded: false,
            emits: false,
            fill: Fill::After,
        };
        let len = |v: &[Verb]| crate::pathops::length(v);
        // Half way: the first stroke whole, the second not begun.
        assert!((len(&b(0.5).drawn(&two_strokes(), "p")) - 100.0).abs() < 1e-6);
        // Three quarters: the first whole and half the second.
        assert!((len(&b(0.75).drawn(&two_strokes(), "p")) - 150.0).abs() < 1e-6);
        assert!((len(&b(0.25).drawn(&two_strokes(), "p")) - 50.0).abs() < 1e-6);
        assert!(!b(0.99).fills() && b(1.0).fills());
    }

    #[test]
    fn a_build_reads_its_fields_and_refuses_others() {
        let p = |v: Value| read(v.as_object().unwrap()).map(|b| b.map(|b| b.fill));
        assert_eq!(
            p(json!({"build": {"progress": 0.2, "fill": "with"}})),
            Ok(Some(Fill::With))
        );
        assert_eq!(
            p(json!({"build": {"order": "random"}})),
            Err("build/order".into())
        );
        assert_eq!(p(json!({})), Ok(None));
    }

    #[test]
    fn a_seeded_order_still_gives_each_stroke_one_share() {
        let s = spans(5, true, "zig");
        let mut starts: Vec<f64> = s.iter().map(|(a, _)| *a).collect();
        starts.sort_by(f64::total_cmp);
        assert_eq!(starts, vec![0.0, 0.2, 0.4, 0.6, 0.8]);
        assert_ne!(order(5, true, "zig"), order(5, false, "zig"));
    }
}

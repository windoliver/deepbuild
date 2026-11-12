//! Issue #409: craft@1's not_example (canvas primitives: Film audit: craft@1): the film's structure
//! against its nearest example's, on six measures, structure only.

use deep_canvas::craft as measure;
use serde_json::{json, Map, Value};

use super::{look_of, markers, moved, raise, Ctx, Film, Found, ShotOf};
use crate::hub::Hub;

impl Hub<'_> {
    pub(super) fn not_example(&mut self, fields: &Map<String, Value>, ctx: &mut Ctx) -> Found {
        let min_differ = fields
            .get("min_differ")
            .and_then(Value::as_u64)
            .unwrap_or(4) as usize;
        let fixtures: Vec<String> = fields
            .get("fixtures")
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
            .filter_map(Value::as_str)
            .map(str::to_string)
            .collect();
        let blocked = |why: String| Found {
            blocked: vec![json!({"code": "craft.not_example", "why": why})],
            ..Found::default()
        };
        if fixtures.is_empty() {
            return blocked("no example or fixture film to compare with".into());
        }
        let drawn = ctx.drawn.clone();
        let Some(film) = ctx.film.take().flatten() else {
            return Found::default();
        };
        let mine = structure(&film, &drawn);
        let mut nearest: Option<(usize, String, Value)> = None;
        let mut missing = Vec::new();
        for id in &fixtures {
            let Some(r) = self.query_revision(id, None) else {
                missing.push(id.clone());
                continue;
            };
            let Some(theirs) = self.film_of(&r.drawn).map(|f| structure(&f, &r.drawn)) else {
                missing.push(id.clone());
                continue;
            };
            let (n, measures) = differ(&mine, &theirs);
            if nearest.as_ref().is_none_or(|(m, _, _)| n < *m) {
                nearest = Some((n, id.clone(), measures));
            }
        }
        let first = film.shots.first().map_or(String::new(), |s| s.id.clone());
        let start = film.start;
        ctx.film = Some(Some(film));
        let Some((n, id, measures)) = nearest else {
            return blocked(format!(
                "the fixture films {} aren't held",
                missing.join(", ")
            ));
        };
        let mut out = Found::default();
        if n < min_differ {
            let mut i = raise("not_example", "craft.not_example", "error", &[&first], start,
                format!("the film differs from its nearest example `{id}` on {n} of 6 measures, under {min_differ}"));
            i["actual"] = json!({"example": id, "differ": n, "measures": measures});
            out.issues.push(i);
        }
        out.measure = json!({"example": id, "differ": n, "measures": measures});
        out
    }
}

/// A film's structure as not_example compares it.
struct Structure {
    kinds: Vec<String>,
    looks: Vec<String>,
    signature: String,
    moves: Vec<&'static str>,
    sections: (Option<f64>, Vec<i64>),
}

/// A shot's kind by how much of the page (2D) or the frame (its kept items' fill) it frames.
fn shot_kind(film: &Film, drawn: &Value, s: &ShotOf) -> String {
    let size = match s.poses.first() {
        Some((_, p)) if p.flat => p.view_width / film.size[0],
        _ => {
            1.0 - drawn
                .pointer(&format!("/shots/{}/frame/fill", s.id))
                .and_then(Value::as_f64)
                .unwrap_or(0.0)
        }
    };
    if size >= 0.8 {
        "wide"
    } else if size >= 0.4 {
        "medium"
    } else {
        "close"
    }
    .to_string()
}

fn structure(film: &Film, drawn: &Value) -> Structure {
    let mut counts: Vec<(String, usize)> = Vec::new();
    for (k, _, _) in &film.joins {
        match counts.iter_mut().find(|(n, _)| n == k) {
            Some(c) => c.1 += 1,
            None => counts.push((k.clone(), 1)),
        }
    }
    let signature = counts
        .iter()
        .max_by_key(|(_, n)| *n)
        .map_or("cut".to_string(), |(k, _)| k.clone());
    let bpm = drawn
        .pointer("/tempo_map/segments/0/bpm")
        .and_then(Value::as_f64);
    let sections = markers(drawn, "section", None)
        .into_iter()
        .map(|(_, _, s)| s)
        .collect();
    Structure {
        kinds: film
            .shots
            .iter()
            .map(|s| shot_kind(film, drawn, s))
            .collect(),
        looks: film.shots.iter().map(|s| look_of(drawn, &s.id)).collect(),
        signature,
        moves: (0..film.shots.len())
            .map(|i| moved(film, drawn, i, false).0.name())
            .collect(),
        sections: (bpm, sections),
    }
}

/// On how many of the six measures two films differ, and each measure's reading.
fn differ(a: &Structure, b: &Structure) -> (usize, Value) {
    let far = |d: usize, n: usize| d >= n.div_ceil(4).max(1);
    let n = a.kinds.len().max(b.kinds.len());
    let first = |s: &Structure| (s.kinds.first().cloned(), s.looks.first().cloned());
    let last = |s: &Structure| {
        (
            s.kinds.last().cloned(),
            s.moves.last().copied(),
            s.looks.last().cloned(),
        )
    };
    let measures = [
        ("shot_kinds", far(measure::edits(&a.kinds, &b.kinds), n)),
        ("first_shot", first(a) != first(b)),
        ("signature_transition", a.signature != b.signature),
        ("camera_moves", far(measure::edits(&a.moves, &b.moves), n)),
        ("sections", a.sections != b.sections),
        ("last_shot", last(a) != last(b)),
    ];
    let count = measures.iter().filter(|(_, d)| *d).count();
    (
        count,
        json!(measures
            .iter()
            .map(|(k, d)| (k.to_string(), json!(d)))
            .collect::<Map<_, _>>()),
    )
}

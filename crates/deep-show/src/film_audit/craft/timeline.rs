//! Issue #409: craft@1's checks over a film's timeline (canvas primitives: Film audit: craft@1):
//! shot_length's spans, montage minimums and long takes, and camera_grammar's moves read from the
//! camera, pushes in a row, accents, neighbours, jump cuts and the line.

use deep_canvas::craft::{self as measure, Move};
use serde_json::{json, Map, Value};

use super::{cam, framed, item_at, moved, num, raise, seconds, secs, time_of, Film, Found};

/// shot_length: each shot's length against the brief's range, its montage spans and long takes.
pub(super) fn shot_length(film: &Film, drawn: &Value, fields: &Map<String, Value>) -> Found {
    let (min, max, hard) = (
        num(fields, "min"),
        num(fields, "max"),
        num(fields, "hard_max"),
    );
    let declared = fields.get("signature").and_then(Value::as_object);
    let (takes, take_max) = declared.map_or((0, 0.0), |s| {
        (
            s.get("count").and_then(Value::as_u64).unwrap_or(1) as usize,
            seconds(s.get("max")).unwrap_or(20.0),
        )
    });
    // Montage spans: markers whose span lowers the minimum inside it, never under 0.25 s.
    let montage: Vec<(i64, i64, f64)> = fields
        .get("montage")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|m| {
            let id = m["span"].as_str()?;
            let mk = drawn.pointer(&format!("/markers/{id}"))?;
            let t = time_of(drawn, mk.get("t"))?;
            let span = time_of(drawn, mk.get("span"))?;
            Some((t, t + span, seconds(m.get("min")).unwrap_or(min).max(0.25)))
        })
        .collect();
    let mut out = Found::default();
    let mut lengths = Map::new();
    let mut long = 0;
    for s in &film.shots {
        let d = secs(s.end - s.start);
        lengths.insert(s.id.clone(), json!(d));
        let floor = montage
            .iter()
            .find(|(a, b, _)| *a <= s.start && s.end <= *b)
            .map_or(min, |m| m.2);
        let id = s.id.as_str();
        if d + 1e-9 < floor {
            out.issues.push(raise(
                "shot_length",
                "craft.shot_length",
                "error",
                &[id],
                s.start,
                format!("`{id}` lasts {d:.3} s, under the minimum of {floor} s"),
            ));
        } else if d > hard + 1e-9 {
            long += 1;
            if long > takes {
                out.issues.push(raise("shot_length", "craft.shot_length", "error", &[id], s.start,
                    format!("`{id}` lasts {d:.3} s, past the hard maximum of {hard} s, and the brief declares {takes} long take(s)")));
            } else if d > take_max + 1e-9 {
                out.issues.push(raise(
                    "shot_length",
                    "craft.shot_length",
                    "error",
                    &[id],
                    s.start,
                    format!(
                        "the long take `{id}` lasts {d:.3} s, past its maximum of {take_max} s"
                    ),
                ));
            }
        } else if d > max + 1e-9 {
            out.issues.push(raise(
                "shot_length",
                "craft.shot_length",
                "warning",
                &[id],
                s.start,
                format!("`{id}` lasts {d:.3} s, past the maximum of {max} s"),
            ));
        }
    }
    out.measure = json!({"lengths": lengths});
    out
}

/// camera_grammar: moves read from the camera, pushes in a row, accents, neighbours, jump cuts and
/// the line.
pub(super) fn camera_grammar(
    film: &Film,
    drawn: &Value,
    fields: &Map<String, Value>,
    by_label: bool,
    angle_only: bool,
) -> Found {
    let mut out = Found::default();
    let moves: Vec<(Move, Option<i64>)> = (0..film.shots.len())
        .map(|i| moved(film, drawn, i, by_label))
        .collect();
    // Pushes in a row, and the share of accents.
    let run_max = fields
        .get("push_run_max")
        .and_then(Value::as_u64)
        .unwrap_or(2) as usize;
    let mut run = 0;
    for (s, (m, _)) in film.shots.iter().zip(&moves) {
        run = if *m == Move::Push { run + 1 } else { 0 };
        if run == run_max + 1 {
            out.issues.push(raise(
                "camera_grammar",
                "craft.camera_grammar",
                "error",
                &[&s.id],
                s.start,
                format!("`{}` is the {} push in a row, past {run_max}", s.id, run),
            ));
        }
    }
    let accents = moves.iter().filter(|(_, a)| a.is_some()).count();
    let share = accents as f64 / film.shots.len().max(1) as f64;
    let accents_max = fields
        .get("accents_max")
        .and_then(Value::as_f64)
        .unwrap_or(0.33);
    if share > accents_max + 1e-9 {
        if let Some((s, (_, Some(t)))) = film
            .shots
            .iter()
            .zip(&moves)
            .rev()
            .find(|(_, (_, a))| a.is_some())
        {
            out.issues.push(raise(
                "camera_grammar",
                "craft.camera_grammar",
                "error",
                &[&s.id],
                *t,
                format!(
                    "{accents} of {} shots are accents ({share:.2}), past {accents_max}",
                    film.shots.len()
                ),
            ));
        }
    }
    // Cuts: neighbours that differ, and no jump cut between shots that keep one item.
    let cut_change = fields
        .get("cut_change")
        .filter(|v| !v.is_null() && **v != json!(false));
    let angle_min = cut_change
        .and_then(|c| c["angle_min"].as_f64())
        .unwrap_or(30.0);
    let size_min = cut_change
        .and_then(|c| c["size_min"].as_f64())
        .unwrap_or(1.4);
    let keep = |id: &str| -> Vec<String> {
        drawn
            .pointer(&format!("/shots/{id}/frame/keep"))
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
            .filter_map(Value::as_str)
            .map(str::to_string)
            .collect()
    };
    let mut cuts = Vec::new();
    for &(t, a, b) in &film.cuts {
        let (sa, sb) = (&film.shots[a], &film.shots[b]);
        let (Some((_, pa)), Some((_, pb))) = (sa.poses.last(), sb.poses.first()) else {
            continue;
        };
        let common = keep(&sa.id).into_iter().find(|k| keep(&sb.id).contains(k));
        let at = common
            .as_deref()
            .and_then(|k| item_at(drawn, k))
            .unwrap_or(pa.target);
        let (angle, ratio) =
            measure::cut_change(&cam(pa), &cam(pb), at, [framed(pa, at), framed(pb, at)]);
        cuts.push(
            json!({"shots": [sa.id, sb.id], "t": t, "angle": angle, "size": ratio, "item": common}),
        );
        let shots = [sa.id.as_str(), sb.id.as_str()];
        if let (Some(item), Some(_)) = (&common, cut_change) {
            if angle < angle_min && (angle_only || ratio < size_min) {
                out.issues.push(raise("camera_grammar", "craft.camera_grammar.jump_cut", "error", &shots, t, format!(
                    "the cut from `{}` to `{}` turns {angle:.1}° about `{item}` (under {angle_min}°) and changes its framed height {ratio:.2} times (under {size_min})",
                    sa.id, sb.id)));
                continue;
            }
        }
        let shift = (0..3)
            .map(|k| (pa.target[k] - pb.target[k]).abs())
            .fold(0.0, f64::max);
        if moves[a].0 == moves[b].0
            && angle < 1.0
            && ratio < 1.01
            && shift <= 1e-6 * pa.width().max(1.0)
        {
            out.issues.push(raise(
                "camera_grammar",
                "craft.camera_grammar",
                "error",
                &shots,
                t,
                format!(
                    "`{}` and `{}` are neighbours with the same framing and move",
                    sa.id, sb.id
                ),
            ));
        }
    }
    // The line through two items: every shot's camera on the side the first takes.
    if let Some([p, q]) = fields
        .get("line")
        .and_then(|l| l["through"].as_array())
        .and_then(|ids| {
            let at: Vec<[f64; 3]> = ids
                .iter()
                .filter_map(Value::as_str)
                .filter_map(|i| item_at(drawn, i))
                .collect();
            <[[f64; 3]; 2]>::try_from(at).ok()
        })
    {
        let mut sign = 0.0;
        for s in &film.shots {
            for (t, pose) in &s.poses {
                let side = measure::side(p, q, pose.position);
                if side.abs() < 1e-9 {
                    continue;
                }
                if sign == 0.0 {
                    sign = side.signum();
                } else if side.signum() != sign {
                    out.issues.push(raise(
                        "camera_grammar",
                        "craft.camera_grammar.line",
                        "error",
                        &[&s.id],
                        *t,
                        format!(
                            "`{}`'s camera crosses the line through the brief's two items",
                            s.id
                        ),
                    ));
                    break;
                }
            }
        }
    }
    let names: Map<String, Value> = film
        .shots
        .iter()
        .zip(&moves)
        .map(|(s, (m, _))| (s.id.clone(), json!(m.name())))
        .collect();
    let accented: Vec<Value> = film
        .shots
        .iter()
        .zip(&moves)
        .filter_map(|(s, (_, a))| a.map(|t| json!({"shot": s.id, "t": t})))
        .collect();
    out.measure = json!({"moves": names, "accents": accented, "cuts": cuts});
    out
}

#[cfg(test)]
mod tests {
    use deep_canvas_motion::shots::Pose;

    use super::*;
    use crate::film_audit::craft::{flicks, named, ShotOf};
    use crate::shared::FLICKS;

    /// A flat shot of `seconds` from `start` whose view width at u (0 to 1 through the shot) is
    /// `width(u)`, posed every 1/12 s and at its last frame (24 fps).
    fn shot(id: &str, start: f64, seconds: f64, width: impl Fn(f64) -> f64) -> ShotOf {
        let (a, b) = (flicks(start), flicks(start + seconds));
        let mut times: Vec<i64> = (0..)
            .map(|k| a + k * FLICKS / 12)
            .take_while(|t| *t < b - FLICKS / 24)
            .collect();
        times.push(b - FLICKS / 24);
        let poses = times
            .into_iter()
            .map(|t| {
                let w = width((t - a) as f64 / (b - a) as f64);
                (
                    t,
                    Pose {
                        position: [160.0, 90.0, 10.0],
                        target: [160.0, 90.0, 0.0],
                        fov: 0.0,
                        view_width: w,
                        roll: 0.0,
                        flat: true,
                    },
                )
            })
            .collect();
        ShotOf {
            id: id.into(),
            start: a,
            end: b,
            poses,
        }
    }

    /// A film of `shots` joined by cuts.
    fn film_of(shots: Vec<ShotOf>) -> Film {
        let cuts = (1..shots.len())
            .map(|k| (shots[k].start, k - 1, k))
            .collect();
        let span = shots.last().map_or(0, |s| s.end);
        Film {
            frame: FLICKS / 24,
            start: 0,
            span,
            size: [320.0, 180.0],
            shots,
            cuts,
            joins: Vec::new(),
        }
    }

    fn fields(check: &str, entry: Value) -> Map<String, Value> {
        let mut e = entry;
        e["check"] = json!(check);
        named(&json!({"craft": [e]}), false).remove(0).1
    }

    fn codes(f: &Found) -> Vec<(String, String, String)> {
        f.issues
            .iter()
            .map(|i| {
                (
                    i["code"].as_str().unwrap_or("").into(),
                    i["severity"].as_str().unwrap_or("").into(),
                    i["ids"].to_string(),
                )
            })
            .collect()
    }

    #[test]
    fn shot_length_warns_past_max_and_lowers_the_minimum_only_inside_a_montage() {
        let hold = |_: f64| 320.0;
        let film = film_of(vec![
            shot("long", 0.0, 7.0, hold),
            shot("quick", 7.0, 1.0, hold),
            shot("blink", 8.0, 0.2, hold),
            shot("short", 8.2, 1.0, hold),
        ]);
        let drawn = json!({"transport": {"frame_rate": "24/1"}, "markers": {"m1": {"kind": "section", "t": "7s", "span": "1.2s"}}});
        let f = shot_length(
            &film,
            &drawn,
            &fields(
                "shot_length",
                json!({"montage": [{"span": "m1", "min": "0.1s"}]}),
            ),
        );
        assert_eq!(
            codes(&f),
            vec![
                ("craft.shot_length".into(), "warning".into(), r#"["long"]"#.into()),
                ("craft.shot_length".into(), "error".into(), r#"["blink"]"#.into()),
                ("craft.shot_length".into(), "error".into(), r#"["short"]"#.into()),
            ],
            "7 s warns (max 6, hard_max 8); inside the montage 1 s passes and 0.2 s is under its 0.25 s floor; outside it 1 s is under 2 s"
        );
    }

    #[test]
    fn camera_grammar_holds_pushes_in_a_row_accents_and_neighbours() {
        let push = |u: f64| 320.0 * (1.0 - 0.2 * u);
        let slam = |u: f64| {
            if u < 0.05 {
                320.0 * (1.0 - 4.0 * u)
            } else {
                256.0
            }
        };
        let hold = |_: f64| 320.0;
        let drawn = json!({});
        let grammar = fields("camera_grammar", json!({}));
        let pushes = film_of(vec![
            shot("p1", 0.0, 3.0, push),
            shot("p2", 3.0, 3.0, push),
            shot("p3", 6.0, 3.0, push),
            shot("h", 9.0, 3.0, hold),
        ]);
        let f = camera_grammar(&pushes, &drawn, &grammar, false, false);
        assert_eq!(
            codes(&f),
            vec![(
                "craft.camera_grammar".into(),
                "error".into(),
                r#"["p3"]"#.into()
            )],
            "the third push in a row, past 2"
        );
        assert_eq!(
            f.measure["moves"],
            json!({"p1": "push", "p2": "push", "p3": "push", "h": "hold"})
        );
        let accents = film_of(vec![
            shot("a1", 0.0, 3.0, slam),
            shot("h1", 3.0, 3.0, hold),
            shot("a2", 6.0, 3.0, slam),
            shot("h2", 9.0, 3.0, |_| 300.0),
        ]);
        let f = camera_grammar(&accents, &drawn, &grammar, false, false);
        assert_eq!(
            codes(&f),
            vec![(
                "craft.camera_grammar".into(),
                "error".into(),
                r#"["a2"]"#.into()
            )],
            "2 of 4 shots are accents, past 0.33"
        );
        let same = film_of(vec![shot("n1", 0.0, 3.0, hold), shot("n2", 3.0, 3.0, hold)]);
        let f = camera_grammar(&same, &drawn, &grammar, false, false);
        assert_eq!(
            codes(&f),
            vec![(
                "craft.camera_grammar".into(),
                "error".into(),
                r#"["n1","n2"]"#.into()
            )],
            "neighbours with one framing and move"
        );
    }
}

//! Issue #491: cue alignment on markers (canvas primitives: Tempo map and cue alignment). A cue
//! `{cue: marker, anchor, offset, move, snap, tolerance, land}` in the document's `cue_align`
//! puts its marker on the nearest anchor (a beat of the tempo map, a moment marker, or another
//! marker) plus its offset, resolved at check. A snapped cue that moves is reported as a
//! `cue_moved` notice, never silently; one with no anchor within its tolerance, or whose anchor
//! needs what motion doesn't have (a strip, sound, or a word, onset, peak or occurrence bake), is
//! BLOCKED and named.

use std::collections::BTreeMap;

use deep_canvas::grammar::{Time, TimeContext};
use serde_json::{json, Map, Value};

use crate::doc::{Marker, Refused};
use crate::tempo::Tempo;

fn blocked(id: &str, why: String) -> Refused {
    Refused {
        code: "cue_blocked",
        path: format!("cue_align/{id}"),
        detail: Some(Box::new(
            json!({"cue": id, "verdict": "BLOCKED", "why": why}),
        )),
    }
}

fn bad(id: &str, field: &str) -> Refused {
    Refused {
        code: "bad_doc",
        path: format!("cue_align/{id}/{field}"),
        detail: Some(Box::new(json!({"cue": id}))),
    }
}

/// A flick span: a time literal (seconds or frames, signed) or a whole number of flicks.
fn flicks(v: Option<&Value>, id: &str, field: &str) -> Result<Option<i64>, Refused> {
    match v {
        None => Ok(None),
        Some(Value::Number(n)) => n.as_i64().map(Some).ok_or_else(|| bad(id, field)),
        Some(Value::String(text)) => {
            let (sign, body) = text
                .strip_prefix('-')
                .map_or((1, text.as_str()), |b| (-1, b));
            match Time::parse(body) {
                Ok(Time::Span(span)) => span
                    .resolve(&TimeContext::default())
                    .map(|t| Some(sign * t))
                    .map_err(|_| bad(id, field)),
                _ => Err(bad(id, field)),
            }
        }
        Some(_) => Err(bad(id, field)),
    }
}

/// The anchor nearest `t` among `times`.
fn nearest(t: i64, times: impl Iterator<Item = i64>) -> Option<i64> {
    times.min_by_key(|&a| (a.abs_diff(t), a))
}

/// Each cue's marker and where it lands, and the notices for those that moved.
pub fn align(
    doc: &Map<String, Value>,
    markers: &[Marker],
    tempo: Option<&Tempo>,
) -> Result<(BTreeMap<String, i64>, Vec<Value>), Refused> {
    let mut pins = BTreeMap::new();
    let mut moved = Vec::new();
    let Some(cues) = doc.get("cue_align") else {
        return Ok((pins, moved));
    };
    let Value::Object(cues) = cues else {
        return Err(Refused {
            code: "bad_doc",
            path: "cue_align".into(),
            detail: None,
        });
    };
    // Anchors are the markers as written, never another cue's marker, so no cue chases another.
    let cued: Vec<&str> = cues
        .values()
        .filter_map(|c| c.get("cue").and_then(Value::as_str))
        .collect();
    for (id, c) in cues {
        let Value::Object(c) = c else {
            return Err(bad(id, ""));
        };
        let text = |k: &str, default: &'static str| match c.get(k) {
            None => Ok(default.to_string()),
            Some(Value::String(s)) => Ok(s.clone()),
            Some(_) => Err(bad(id, k)),
        };
        let Some(target) = c.get("cue").and_then(Value::as_str) else {
            return Err(bad(id, "cue"));
        };
        let Some(marker) = markers.iter().find(|m| m.id == target) else {
            // A first marker isn't placed yet when cues align: it solves once they have.
            let why = if doc.get("markers").and_then(|m| m.get(target)).is_some() {
                format!("`{target}` is a first marker, which solves after cues align")
            } else {
                format!(
                    "`{target}` is not a marker: a strip cue aligns sound, which lands with strips"
                )
            };
            return Err(blocked(id, why));
        };
        // One cue per marker: two would pull it two ways.
        if cued.iter().filter(|&&c| c == target).count() > 1 {
            return Err(bad(id, "cue"));
        }
        let anchor = text("anchor", "")?;
        let mv = text("move", "picture")?;
        let land = text("land", "frame")?;
        if !["frame", "sample"].contains(&land.as_str()) {
            return Err(bad(id, "land"));
        }
        match mv.as_str() {
            "picture" => {}
            "sound" => {
                return Err(blocked(
                    id,
                    "move: sound aligns a strip's sound, which lands with strips".into(),
                ))
            }
            _ => return Err(bad(id, "move")),
        }
        let offset = flicks(c.get("offset"), id, "offset")?.unwrap_or(0);
        let tolerance = flicks(c.get("tolerance"), id, "tolerance")?;
        if tolerance.is_some_and(|t| t < 0) {
            return Err(bad(id, "tolerance"));
        }
        let snap = match c.get("snap") {
            None => true,
            Some(Value::Bool(b)) => *b,
            Some(_) => return Err(bad(id, "snap")),
        };
        let t = marker.start;
        // The anchor is sought at the marker less its offset, so an offset past the clock is bad.
        let from = t.checked_sub(offset).ok_or_else(|| bad(id, "offset"))?;
        let others = || {
            markers
                .iter()
                .filter(|m| m.id != target && !cued.contains(&m.id.as_str()))
        };
        let at = match anchor.as_str() {
            "beat" => match tempo {
                Some(tempo) => tempo.nearest_beat(from),
                None => {
                    return Err(blocked(
                        id,
                        "a beat anchor needs the tempo map or a beats bake".into(),
                    ))
                }
            },
            "moment" => nearest(
                from,
                others().filter(|m| m.kind == "moment").map(|m| m.start),
            ),
            "marker" => nearest(from, others().map(|m| m.start)),
            "word" | "onset" | "peak" | "occurrence" => {
                return Err(blocked(
                    id,
                    format!(
                        "a{} {anchor} anchor resolves only from a bake",
                        if anchor == "onset" || anchor == "occurrence" {
                            "n"
                        } else {
                            ""
                        }
                    ),
                ))
            }
            _ => return Err(bad(id, "anchor")),
        };
        let Some(at) = at else {
            return Err(blocked(
                id,
                format!("no {anchor} anchor to align `{target}` to"),
            ));
        };
        let to = at.checked_add(offset).ok_or_else(|| bad(id, "offset"))?;
        if tolerance.is_some_and(|tol| to.abs_diff(t) > tol.unsigned_abs()) {
            return Err(blocked(
                id,
                format!("`{target}` at {t} flicks is {} flicks from its {anchor} anchor's {to}, past its tolerance", to.abs_diff(t)),
            ));
        }
        if !snap {
            // An unsnapped cue only checks it sits on its anchor.
            if tolerance.is_none() && to != t {
                return Err(blocked(id, format!("`{target}` at {t} flicks is off its {anchor} anchor's {to} and doesn't snap")));
            }
            continue;
        }
        if to != t {
            moved.push(json!({"code": "cue_moved", "cue": id, "marker": target, "from": t, "to": to, "anchor": anchor}));
        }
        pins.insert(target.to_string(), to);
    }
    Ok((pins, moved))
}

/// Once the markers re-place with the pins in, each pinned marker must still sit on its anchor:
/// one that doesn't was pinned to a marker placed from it, which moved on, so it is BLOCKED.
pub(crate) fn landed(
    doc: &Map<String, Value>,
    markers: &[Marker],
    tempo: Option<&Tempo>,
    pins: &BTreeMap<String, i64>,
) -> Result<(), Refused> {
    let (again, _) = align(doc, markers, tempo)?;
    let Some((marker, to)) = pins.iter().find(|(m, to)| again.get(*m) != Some(to)) else {
        return Ok(());
    };
    let id = doc
        .get("cue_align")
        .and_then(Value::as_object)
        .and_then(|cues| {
            cues.iter()
                .find(|(_, c)| c.get("cue").and_then(Value::as_str) == Some(marker))
        })
        .map_or(marker.as_str(), |(id, _)| id.as_str());
    Err(blocked(
        id,
        format!("`{marker}` pinned at {to} flicks is off its anchor once the markers placed from it move with it"),
    ))
}

#[cfg(test)]
mod tests {
    use crate::doc::read;
    use serde_json::{json, Value};

    const F: i64 = 705_600_000;

    fn doc(cues: Value) -> Value {
        json!({
            "format": 1, "id": "cues", "profile": "film", "items": {}, "transport": {"span": "8s"},
            "tempo_map": {"segments": [{"at": "0s", "bpm": 120, "meter": [4, 4], "span": 16}]},
            "markers": {
                "hit": {"kind": "cue", "t": "1.1s"},
                "echo": {"kind": "cue", "t": "@hit+1s"},
                "flash": {"kind": "moment", "t": "3.2s"},
            },
            "cue_align": cues,
        })
    }

    fn start(d: &Value, id: &str) -> i64 {
        let m = read(d.as_object().unwrap()).unwrap();
        m.markers.iter().find(|m| m.id == id).unwrap().start
    }

    #[test]
    fn a_beat_cue_moves_its_marker_and_reports_it() {
        let d =
            doc(json!({"c": {"cue": "hit", "anchor": "beat", "snap": true, "tolerance": "0.2s"}}));
        let m = read(d.as_object().unwrap()).unwrap();
        // 1.1 s snaps to the 120 BPM beat at 1.0 s, and the marker after it keeps its offset.
        assert_eq!(start(&d, "hit"), F);
        assert_eq!(start(&d, "echo"), 2 * F);
        let moved: Vec<_> = m
            .notices
            .iter()
            .filter(|n| n["code"] == "cue_moved")
            .collect();
        assert_eq!(
            moved,
            [
                &json!({"code": "cue_moved", "cue": "c", "marker": "hit", "from": 776_160_000, "to": F, "anchor": "beat"})
            ]
        );
        // Its literal time still raises its notice, once.
        let literal = m
            .notices
            .iter()
            .filter(|n| n["code"] == "literal_time_with_tempo_map" && n["id"] == "hit")
            .count();
        assert_eq!(literal, 1);
    }

    #[test]
    fn an_offset_lands_past_its_anchor_on_a_moment() {
        let d = doc(json!({"c": {"cue": "hit", "anchor": "moment", "offset": "-0.1s"}}));
        assert_eq!(start(&d, "hit"), 32 * F / 10 - F / 10);
    }

    #[test]
    fn a_cue_past_its_tolerance_or_off_a_bake_is_blocked_by_name() {
        let refused = |cues: Value| read(doc(cues).as_object().unwrap()).unwrap_err();
        for cues in [
            json!({"c": {"cue": "hit", "anchor": "beat", "tolerance": "0.05s"}}),
            json!({"c": {"cue": "hit", "anchor": "onset"}}),
            json!({"c": {"cue": "hit", "anchor": "beat", "move": "sound"}}),
            json!({"c": {"cue": "drums", "anchor": "beat"}}),
            json!({"c": {"cue": "hit", "anchor": "beat", "snap": false}}),
        ] {
            let r = refused(cues.clone());
            assert_eq!(
                (r.code, r.detail.as_ref().map(|d| d["cue"].clone())),
                ("cue_blocked", Some(json!("c"))),
                "{cues}"
            );
        }
        // `echo` is written after `hit`, so pinning `hit` to it moves it on: refused, not landed.
        let r = refused(json!({"c": {"cue": "hit", "anchor": "marker"}}));
        assert_eq!(
            (r.code, r.detail.as_ref().map(|d| d["cue"].clone())),
            ("cue_blocked", Some(json!("c")))
        );
        // Without a snap, a cue within its tolerance is checked and left where it is.
        let d =
            doc(json!({"c": {"cue": "hit", "anchor": "beat", "snap": false, "tolerance": "0.2s"}}));
        assert_eq!(start(&d, "hit"), 11 * F / 10);
    }

    #[test]
    fn an_offset_past_the_clock_is_refused() {
        let d = doc(json!({"c": {"cue": "hit", "anchor": "moment", "offset": i64::MIN}}));
        let r = read(d.as_object().unwrap()).unwrap_err();
        assert_eq!((r.code, r.path.as_str()), ("bad_doc", "cue_align/c/offset"));
    }

    #[test]
    fn a_cue_on_a_first_marker_says_it_solves_after() {
        let mut d = doc(json!({"c": {"cue": "cross", "anchor": "beat"}}));
        d["markers"]["cross"] = json!({"kind": "moment", "t": {"first": {"expr": "t - 1", "vars": {"t": "time"}, "after": "0s", "before": "4s"}}});
        let r = read(d.as_object().unwrap()).unwrap_err();
        let why = r
            .detail
            .as_ref()
            .map(|d| d["why"].to_string())
            .unwrap_or_default();
        assert!(
            r.code == "cue_blocked" && why.contains("first marker"),
            "{why}"
        );
    }
}

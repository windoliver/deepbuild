//! Captions the look designs (#466; canvas primitives: Look `look@1`: captions): the plate a
//! caption sits on, how it enters, where it anchors and its stage, drawn inside the span the
//! caption profile lays out, so the look changes how a caption looks and never when it shows.
//! A caption whose words already show on screen (`script.captions.shown_by`) draws nothing, and
//! the sidecars still carry it.

use serde_json::{json, Map, Value};

use deep_canvas::grammar::FLICKS_PER_SECOND as FLICKS;

/// #466's wrong programs in the caption layer.
pub const AFTER_ENTRANCE: &str = "designed_caption_after_entrance";
pub const PLATE_IN_TEXT_ROLE: &str = "caption_plate_in_text_role";
pub const SHOWN_BY_IGNORED: &str = "shown_by_ignored";
pub const PLANTED: [&str; 3] = [AFTER_ENTRANCE, PLATE_IN_TEXT_ROLE, SHOWN_BY_IGNORED];

const PLATES: [&str; 11] = [
    "strip",
    "card",
    "note_box",
    "banderole",
    "terminal_line",
    "figure_caption",
    "map_label",
    "toast",
    "pill",
    "hud_plate",
    "row_box",
];
const ENTRANCES: [&str; 5] = ["unfold", "slide", "write", "type_by_word", "rise_by_word"];

/// A look's caption design.
#[derive(Clone, Debug, PartialEq)]
pub struct Design {
    pub plate: String,
    pub entrance: String,
    /// The share of the entrance after which the text starts.
    pub text_after: f64,
    /// The plate's centre as a share of the safe area, x then y.
    pub anchor: [f64; 2],
    pub before_finish: bool,
}

/// The look's `captions` design, `None` when it gives none, or the field it refuses.
pub fn design_of(look: &Value) -> Result<Option<Design>, String> {
    let Some(c) = look.get("captions").filter(|c| !c.is_null()) else {
        return Ok(None);
    };
    let pick = |k: &str, list: &[&str], default: &str| -> Result<String, String> {
        match c.get(k) {
            None => Ok(default.to_string()),
            Some(Value::String(s)) if list.contains(&s.as_str()) => Ok(s.clone()),
            Some(_) => Err(format!("look/captions/{k}")),
        }
    };
    let text_after = match c.get("text_after") {
        None => 0.0,
        Some(v) => v
            .as_f64()
            .filter(|v| (0.0..=1.0).contains(v))
            .ok_or("look/captions/text_after")?,
    };
    let anchor = match c.get("anchor") {
        None => [0.5, 1.0],
        Some(Value::Array(a)) if a.len() == 2 => match (a[0].as_f64(), a[1].as_f64()) {
            (Some(x), Some(y)) if (0.0..=1.0).contains(&x) && (0.0..=1.0).contains(&y) => [x, y],
            _ => return Err("look/captions/anchor".into()),
        },
        Some(_) => return Err("look/captions/anchor".into()),
    };
    let before_finish = match c.get("stage").and_then(Value::as_str) {
        None | Some("after_finish") => false,
        Some("before_finish") => true,
        Some(_) => return Err("look/captions/stage".into()),
    };
    Ok(Some(Design {
        plate: pick("plate", &PLATES, "strip")?,
        entrance: pick("entrance", &ENTRANCES, "unfold")?,
        text_after,
        anchor,
        before_finish,
    }))
}

/// How long a caption's entrance takes: a third of its span, at most half a second, so it ends
/// well inside the time the profile gives the caption.
pub fn entrance_span(start: i64, end: i64) -> i64 {
    ((end - start) / 3).clamp(0, FLICKS / 2)
}

/// A plate's look: its fill role (none for a caption under a figure), the text's role, its
/// corner radius as a share of its height, an outline role, and whether it spans the safe width.
fn plate_style(
    plate: &str,
) -> (
    Option<&'static str>,
    &'static str,
    f64,
    Option<&'static str>,
    bool,
) {
    match plate {
        "strip" => (Some("ink"), "ground", 0.0, None, true),
        "card" => (Some("ground"), "ink", 0.15, Some("muted"), false),
        "note_box" => (Some("ground"), "ink", 0.05, Some("ink"), false),
        "banderole" => (Some("ink"), "ground", 0.0, None, true),
        "terminal_line" => (Some("ink"), "ground", 0.0, None, true),
        "figure_caption" => (None, "ink", 0.0, None, false),
        "map_label" => (Some("ground"), "ink", 0.0, Some("ink"), false),
        "toast" => (Some("ink"), "ground", 0.25, None, false),
        "pill" => (Some("ink"), "ground", 0.5, None, false),
        "hud_plate" => (Some("ink"), "ground", 0.05, Some("ground"), false),
        _ => (Some("ground"), "ink", 0.0, Some("muted"), false),
    }
}

/// The caption layer's items for `lines` designed by `d`, `at` flicks into the caption's span
/// of `span`, on a frame `size` with its `safe` margin: the plate, then the text, each entering
/// as the design says. `plate_in_text` is #466's planted plate.
#[allow(clippy::too_many_arguments)]
pub fn items(
    d: &Design,
    lines: &[String],
    (font, text_size, role): (&str, f64, Option<&str>),
    (size, safe): ([f64; 2], f64),
    (at, span): (i64, i64),
    plate_in_text: bool,
) -> Map<String, Value> {
    let (fill, text_role, radius, outline, wide) = plate_style(&d.plate);
    // The script's captions block may name the plate's role; the look's design keeps its shape.
    let fill = fill.map(|f| role.unwrap_or(f));
    let text_role = if role.is_some() { "ink" } else { text_role };
    let fill = if plate_in_text { Some(text_role) } else { fill };
    let line_height = (1.3 * text_size).round();
    let pad = (0.5 * text_size).round();
    let longest = lines.iter().map(|l| l.chars().count()).max().unwrap_or(0) as f64;
    let inner_w = size[0] - 2.0 * safe;
    let w = if wide {
        inner_w
    } else {
        (longest * 0.62 * text_size + 2.0 * pad).min(inner_w)
    };
    let h = lines.len().max(1) as f64 * line_height + 2.0 * pad;
    let cx = safe + d.anchor[0] * inner_w;
    let cy = safe + d.anchor[1] * (size[1] - 2.0 * safe);
    let (x, y) = (
        (cx - w / 2.0).clamp(safe, size[0] - safe - w),
        (cy - h / 2.0).clamp(safe, size[1] - safe - h),
    );
    // The entrance's progress, and the text's within it.
    let e = if span > 0 {
        (at as f64 / span as f64).clamp(0.0, 1.0)
    } else {
        1.0
    };
    let q = if d.text_after >= 1.0 {
        f64::from(u8::from(e >= 1.0))
    } else {
        ((e - d.text_after) / (1.0 - d.text_after)).clamp(0.0, 1.0)
    };
    let (mut px, mut py, mut pw, mut ph) = (x, y, w, h);
    let mut lift = 0.0;
    match d.entrance.as_str() {
        "unfold" => {
            ph = (h * e).max(1.0);
            py = y + (h - ph) / 2.0;
        }
        "slide" => lift = (1.0 - e) * h,
        _ => {}
    }
    py += lift;
    if !wide && d.entrance == "unfold" {
        pw = w;
        px = x;
    }
    let mut out = Map::new();
    if let Some(role) = fill {
        let mut paint = json!({"fill": {"role": role}});
        if let Some(o) = outline {
            paint["stroke"] = json!({"role": o, "width": 1});
        }
        out.insert("plate".into(), json!({"id": "plate", "kind": "rect@1", "layer": "captions", "name": "Caption plate", "order": "a1",
            "params": {"box": [px, py, pw, ph], "radius": radius * ph, "paint": paint}}));
    }
    if q <= 0.0 {
        return out;
    }
    // Words in by word, or the whole text written in by its reveal.
    let words: Vec<&str> = lines.iter().flat_map(|l| l.split(' ')).collect();
    let text = match d.entrance.as_str() {
        "type_by_word" | "rise_by_word" => {
            let k = (q * words.len() as f64).ceil() as usize;
            let mut shown = Vec::new();
            let mut left = k;
            for l in lines {
                let n = l.split(' ').count();
                let take = left.min(n);
                left -= take;
                if take > 0 {
                    shown.push(l.split(' ').take(take).collect::<Vec<_>>().join(" "));
                }
            }
            shown.join("\n")
        }
        _ => lines.join("\n"),
    };
    let mut params = json!({"text": text, "font": font, "size": text_size, "paint": {"fill": {"role": text_role}},
        "box": {"w": w - 2.0 * pad, "h": h - 2.0 * pad}, "autosize": "none", "align": "center", "valign": "middle"});
    if d.entrance == "write" && q < 1.0 {
        params["reveal"] = json!({"mode": "fade", "order": "reading", "progress": q});
    }
    let rise = if d.entrance == "rise_by_word" {
        (1.0 - q) * 0.5 * line_height
    } else {
        0.0
    };
    out.insert("text".into(), json!({"id": "text", "kind": "text@1", "layer": "captions", "name": "Caption", "order": "a2",
        "params": params, "at": {"pos": [x + pad, y + pad + lift + rise, 0]}}));
    out
}

/// Whether a caption's words already show as the text item `shown_by` names: its text with every
/// run of white space as one space equals the caption's lines joined by single spaces.
pub fn shown_by(doc: &Value, shown_by: &str, lines: &[String]) -> bool {
    let words = |s: &str| s.split_whitespace().collect::<Vec<_>>().join(" ");
    doc.pointer(&format!("/items/{shown_by}/params/text"))
        .and_then(Value::as_str)
        .is_some_and(|t| words(t) == words(&lines.join(" ")))
}

impl crate::hub::Hub<'_> {
    /// The frames render.contrast reads of `doc` (#466): at each of `at`, the document with the
    /// caption showing then; and each caption no time of `at` shows, at the time it has fully
    /// entered. A caption joins as its text, the item named for the caption (`<line>.<n>`), and its
    /// plate, `<line>.<n>.plate`, drawn over every other item.
    pub(crate) fn caption_frames(&mut self, doc: &Value, at: &[i64]) -> Vec<(i64, Value)> {
        let (p, q) = doc
            .get("transport")
            .and_then(deep_canvas::document::frame_rate_of)
            .unwrap_or((60, 1));
        let frame = deep_canvas::time::frame_length(p, q).unwrap_or(FLICKS / 60);
        let Ok(Some(laid)) = self.captions_of(doc, frame, None) else {
            return at.iter().map(|&t| (t, doc.clone())).collect();
        };
        let layer = doc
            .get("layers")
            .and_then(Value::as_object)
            .and_then(|l| l.keys().next().cloned());
        let shows = |c: &deep_canvas_media::captions::Caption| {
            !doc.pointer("/script/captions/shown_by")
                .and_then(Value::as_str)
                .is_some_and(|by| shown_by(doc, by, &c.lines))
        };
        let mut jobs: Vec<(i64, Option<&deep_canvas_media::captions::Caption>)> = at
            .iter()
            .map(|&t| {
                (
                    t,
                    laid.captions
                        .iter()
                        .find(|c| c.start <= t && t < c.end && shows(c)),
                )
            })
            .collect();
        for c in laid.captions.iter().filter(|c| shows(c)) {
            if !at.iter().any(|&t| c.start <= t && t < c.end) {
                jobs.push((
                    (c.start + entrance_span(c.start, c.end)).min(c.end - 1),
                    Some(c),
                ));
            }
        }
        let mut out = Vec::new();
        for (t, c) in jobs {
            let Some(c) = c else {
                out.push((t, doc.clone()));
                continue;
            };
            let Some((items, _)) = self.caption_items(doc, c, laid.limits.max_lines, t) else {
                out.push((t, doc.clone()));
                continue;
            };
            let mut shown = doc.clone();
            for (name, mut item) in items {
                let id = if name == "text" {
                    c.id.clone()
                } else {
                    format!("{}.{name}", c.id)
                };
                item["id"] = json!(id);
                item["order"] = json!(format!("~caption{}", item["order"].as_str().unwrap_or("")));
                match &layer {
                    Some(l) => item["layer"] = json!(l),
                    None => {
                        if let Some(o) = item.as_object_mut() {
                            o.remove("layer");
                        }
                    }
                }
                shown["items"][&id] = item;
            }
            out.push((t, shown));
        }
        out
    }

    /// `lowered` with a text item for each caption the frames read (#466), so render.contrast
    /// judges a caption as it does a text, by the caption's name.
    pub(crate) fn with_caption_texts(&self, lowered: &Value, picks: &[&str]) -> Value {
        let mut out = lowered.clone();
        for id in picks {
            if out["items"].get(*id).is_none() && is_caption_name(id) {
                out["items"][*id] = json!({"id": id, "kind": "text@1"});
            }
        }
        out
    }
}

/// Whether `id` names a caption as the layout names them: `<line>.<n>`.
fn is_caption_name(id: &str) -> bool {
    id.rsplit_once('.').is_some_and(|(line, n)| {
        !line.is_empty() && !n.is_empty() && n.bytes().all(|b| b.is_ascii_digit())
    })
}

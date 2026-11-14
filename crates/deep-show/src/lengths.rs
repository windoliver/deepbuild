//! #1183: lengths drawn larger than real, on the honest-numbers row (canvas primitives: Honest
//! numbers, "Lengths follow the same rule"). Each deliverable's mappings of a measured length, as
//! the motion module's rule reads them (`deep_canvas_motion::lengths`), go into the row's
//! `lengths` record; a refused one raises `length.ratio_undeclared`, naming the item and both
//! ratios; one it can't read keeps the row from passing. An exaggerated one's disclosure is played
//! over the transport, frame by frame, and must read (the film audit's `readable`) on every frame
//! its item is on screen, else `length.disclosure_hidden` names the overlay and the first such
//! frame. Each number a disclosure shows is listed with the field it reads.

use std::collections::BTreeMap;

use deep_canvas::lengths::{moved, shown_at, MAPPERS, SLOTS};
use deep_canvas::template::{self, Part};
use deep_canvas_motion::lengths::{self as rule, Mapping, Outcome};
use deep_canvas_scene3d::{label::Labels, look::Look3, scene};
use serde_json::{json, Value};

use crate::film_audit::{readable, TextAt};
use crate::hub::Hub;

/// A length mapped at a ratio the document doesn't declare.
const RATIO_UNDECLARED: &str = "length.ratio_undeclared";
/// A disclosure that doesn't read on a frame where the item it covers is on screen.
const DISCLOSURE_HIDDEN: &str = "length.disclosure_hidden";
const KIND: &str = "honest_numbers";

/// What the length rule found on one deliverable.
#[derive(Default)]
pub(crate) struct Lengths {
    /// One entry per mapping, in the document's order.
    pub(crate) record: Vec<Value>,
    pub(crate) issues: Vec<Value>,
    pub(crate) numbers: Vec<Value>,
    pub(crate) blocked: Vec<Value>,
    /// A mapping the rule couldn't read: the row never passes on it.
    pub(crate) unchecked: bool,
}

/// The refusal of a mapping, naming its item and both ratios.
fn refusal(m: &Mapping) -> Value {
    json!({
        "check": KIND, "code": RATIO_UNDECLARED, "severity": "error", "ids": [m.item], "path": m.mapping,
        "actual": {"mapping": m.mapping, "ratio": m.ratio, "expected": m.expected(), "shown_at": m.shown_at},
        "what": "draws a measured length at a ratio the document doesn't declare: neither its assembly's shown_at nor shown_at × an exaggerate factor",
        "fix": "draw it at its assembly's shown_at, or declare `exaggerate {factor, disclose}` with the overlay that says so",
    })
}

/// Whether a box `[x, y, w, h]` meets a frame of `size`.
fn meets(b: &[f64; 4], size: [f64; 2]) -> bool {
    b[0] < size[0] && b[0] + b[2] > 0.0 && b[1] < size[1] && b[1] + b[3] > 0.0
}

impl Hub<'_> {
    /// The length rule on deliverable `doc`, whose document is `document`.
    pub(crate) fn lengths(&self, doc: &str, document: &Value) -> Lengths {
        let one_value = self.scenario.module_planted.as_deref() == Some(rule::ONE_VALUE);
        let mappings = rule::mappings(document, one_value);
        let mut out = Lengths::default();
        for m in &mappings {
            let mut entry = m.to_json();
            entry["doc"] = json!(doc);
            out.record.push(entry);
            match m.outcome {
                Outcome::Undeclared => out.issues.push(refusal(m)),
                Outcome::Unchecked(_) => out.unchecked = true,
                Outcome::Shown | Outcome::Exaggerated => {}
            }
        }
        let exaggerated: Vec<&Mapping> = mappings
            .iter()
            .filter(|m| m.outcome == Outcome::Exaggerated)
            .collect();
        if !exaggerated.is_empty() {
            // Its logic baked, as the frames that show it read it.
            let mut form = document.clone();
            match self.inline_occurrences(&mut form, &[]) {
                Ok(()) => self.disclosures(&form, &exaggerated, &mut out),
                Err(i) => out
                    .blocked
                    .push(json!({"code": i.code, "kind": KIND, "ids": i.ids})),
            }
        }
        out.numbers = shown(document);
        out
    }

    /// Each exaggerated mapping's disclosure over the transport: on every frame its item is on
    /// screen, the overlay reads; the first frame it doesn't raises one issue.
    fn disclosures(&self, form: &Value, exaggerated: &[&Mapping], out: &mut Lengths) {
        let (p, q) = form
            .get("transport")
            .and_then(deep_canvas::document::frame_rate_of)
            .unwrap_or((60, 1));
        let Ok(frame) = deep_canvas::time::frame_length(p, q) else {
            return;
        };
        let time = |at: &str| deep_canvas_media::doc::time(form, form.pointer(at));
        let (span, start) = (
            time("/transport/span").unwrap_or(0),
            time("/transport/start").unwrap_or(0),
        );
        let look = Look3::from_roles(self.look.light.clone());
        let look_min = self
            .look
            .sizes
            .as_ref()
            .and_then(|s| s.text.values().map(|r| r.size).reduce(f64::min));
        let limits =
            deep_canvas::film_audit::Readable::from_input(&Value::Null, look_min.unwrap_or(0.0));
        let mut labels = Labels::new();
        let mut open: Vec<&Mapping> = exaggerated.to_vec();
        let mut before: BTreeMap<String, TextAt> = BTreeMap::new();
        for k in 0..(span / frame).max(1) {
            if open.is_empty() {
                break;
            }
            let t = start + k * frame;
            let s = match scene::evaluate(form, t, &look, &mut labels) {
                Ok(s) => s,
                Err(r) => {
                    let ids: Vec<&str> = open.iter().map(|m| m.item.as_str()).collect();
                    out.blocked
                        .push(json!({"code": r.code, "kind": KIND, "ids": ids, "path": r.path}));
                    return;
                }
            };
            let size = [f64::from(s.size[0]), f64::from(s.size[1])];
            let boxes = s.boxes();
            let texts: BTreeMap<String, TextAt> = s
                .readouts
                .iter()
                .filter_map(|l| {
                    let c = s.camera.project(l.pos)?;
                    let [w, h] = l.quad;
                    let boxes = vec![[
                        c[0] - w / 2.0,
                        c[1] - h / 2.0,
                        c[0] + w / 2.0,
                        c[1] + h / 2.0,
                    ]];
                    let (item, text, color, ground) =
                        (l.id.clone(), l.text.clone(), l.color, s.ground);
                    Some((
                        l.id.clone(),
                        TextAt {
                            item,
                            text,
                            boxes,
                            opacity: vec![1.0],
                            color,
                            ground,
                            size: l.em,
                        },
                    ))
                })
                .collect();
            open.retain(|m| {
                let Some((_, overlay)) = &m.exaggerate else { return false };
                let part = format!("{}#", m.item);
                let on = boxes.iter().any(|(id, b)| (*id == m.item || id.starts_with(&part)) && meets(b, size));
                // The readout's own corner margin is its safe area (Overlay: anchored in the safe area).
                if !on || texts.get(overlay).is_some_and(|x| readable(x, before.get(overlay), &limits, size, 0.0)) {
                    return true;
                }
                out.issues.push(json!({
                    "check": KIND, "code": DISCLOSURE_HIDDEN, "severity": "error", "ids": [overlay, m.item],
                    "path": format!("items/{overlay}"), "t": t, "frame": k,
                    "actual": {"mapping": m.mapping, "overlay": overlay, "item": m.item, "frame": k},
                    "what": "the disclosure doesn't read on a frame where the item it covers is on screen",
                    "fix": "show the disclosure, readable, on every frame the exaggerated item is on screen",
                }));
                false
            });
            before = texts;
        }
    }
}

/// Each number a disclosure's template shows through `{factor}` or `{shown_at}`, with the field
/// it reads: an exaggeration's factor, or the assembly's `shown_at`.
fn shown(doc: &Value) -> Vec<Value> {
    let mut out = Vec::new();
    for section in MAPPERS {
        for (id, entry) in doc
            .get(section)
            .and_then(Value::as_object)
            .into_iter()
            .flatten()
        {
            let Some((_, overlay)) = deep_canvas::lengths::exaggerate(entry) else {
                continue;
            };
            let t = doc
                .pointer(&format!("/items/{overlay}/params/template"))
                .and_then(Value::as_str);
            for part in t.and_then(|t| template::parts(t).ok()).unwrap_or_default() {
                let Part::Slot(slot) = part else { continue };
                let Some(v) = SLOTS
                    .contains(&slot)
                    .then(|| template::value_in(doc, overlay, slot))
                    .flatten()
                else {
                    continue;
                };
                let field = match slot {
                    "factor" => format!("{section}/{id}/exaggerate/factor"),
                    _ => {
                        let target = entry
                            .get("target")
                            .and_then(Value::as_str)
                            .and_then(moved)
                            .unwrap_or_default();
                        shown_at(doc, target)
                            .0
                            .map_or("shown_at".into(), |a| format!("assemblies/{a}/shown_at"))
                    }
                };
                let listed = json!({"item": overlay, "text": v.text, "source": {"path": field}});
                if !out
                    .iter()
                    .any(|n: &Value| n["item"] == listed["item"] && n["text"] == listed["text"])
                {
                    out.push(listed);
                }
            }
        }
    }
    out
}

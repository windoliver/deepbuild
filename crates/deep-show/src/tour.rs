//! Issue #903: a document's tour where no one gives input, and its pointer (canvas primitives:
//! Tour). A played form whose track holds no one's entries carries the tour's own over the
//! document's span, from `idle_after` past the start, so every frame the hub draws replays
//! them; and an export's frames, a determinism render and the app's window draw the tour's
//! pointer over the document's layers, where the input module puts it from the tour's keys and
//! the layout evaluated at the times it asks for.

use std::cell::RefCell;
use std::collections::BTreeMap;
use std::sync::Arc;

use deep_canvas_input::tour::{Drawn, Layout, Run, Tour};
use deep_canvas_input::track::Entry;
use deep_canvas_marks::key::ContentKey;
use deep_canvas_marks::modules::Drawing as Marks;
use deep_canvas_marks::path::Verb;
use deep_canvas_marks::scene::{self, Fill, Frame, Layer, Line, Mark};
use deep_canvas_motion::doc::feel_of;
use deep_canvas_scene3d::label::Labels;
use deep_canvas_scene3d::look::Look3;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};

use crate::frames::Painted;
use crate::hub::Hub;
use crate::snapshot;

/// The pointer's item in a frame's draw list, a name no document's item has.
const ITEM: &str = "\u{0}tour.pointer";

/// The pointer's anchors in one played form, by the item a control is hit through and time: each
/// is the same whenever it is asked for, so a film asks once per key.
#[derive(Default)]
pub(crate) struct Anchors {
    form: Option<Value>,
    at: BTreeMap<(String, i64), Option<[f64; 2]>>,
}

fn tour_of(form: &Value) -> Option<Tour> {
    Tour::of(form.get("tour")?).ok()
}

/// `form` with its tour's entries as its track, when it carries no track of its own: the
/// entries the tour writes where no one gives input, to the end of the document's span.
pub(crate) fn inline(form: &mut Value) {
    let span = form.pointer("/transport/span");
    let span = span.and_then(|s| deep_canvas_media::doc::time(form, Some(s)));
    let (Some(tour), Some(span), None) = (tour_of(form), span, form.get("track")) else {
        return;
    };
    let entries: Vec<Value> = tour.entries(span).iter().map(Entry::to_json).collect();
    if !entries.is_empty() {
        form["track"] = Value::Array(entries);
    }
}

/// What the pointer reads of a played form's layout: each control's hit box where the frame
/// at a time draws the item it is hit through.
struct Drawing<'h, 'a> {
    hub: RefCell<&'h mut Hub<'a>>,
    form: &'h Value,
}

impl Layout for Drawing<'_, '_> {
    fn anchor(&self, control: &str, value: &Value, t: i64) -> Option<[f64; 2]> {
        let c = self.form.get("controls")?.get(control)?;
        let targets = c.get("targets").and_then(Value::as_object);
        // A choice's or a stage's key lands on the target of the option it picks.
        let picked = value.as_str().and_then(|o| targets?.get(o));
        let hit = c.pointer("/handle/item").or(picked);
        let item = hit.or_else(|| targets?.values().next())?.as_str()?;
        let mut hub = self.hub.borrow_mut();
        let key = (item.to_string(), t);
        if hub.tour_anchors.form.as_ref() != Some(self.form) {
            hub.tour_anchors = Anchors {
                form: Some(self.form.clone()),
                at: BTreeMap::new(),
            };
        }
        if let Some(known) = hub.tour_anchors.at.get(&key) {
            return *known;
        }
        let anchor = hub.anchor(self.form, item, t);
        hub.tour_anchors.at.insert(key, anchor);
        anchor
    }

    fn presses(&self, control: &str) -> bool {
        let kind = self.form.pointer(&format!("/controls/{control}/kind"));
        let kind = kind.and_then(Value::as_str);
        matches!(kind, Some("press" | "toggle" | "transport"))
    }
}

impl Hub<'_> {
    /// The centre of `item`'s box in px of `form`'s frame at its own size, as the frame at `t`
    /// draws it: a 2D item at its evaluated box, one in a card over 3D where the card's anchor
    /// projects, a 3D item at its projected box; none for an item the frame doesn't draw.
    fn anchor(&mut self, form: &Value, item: &str, t: i64) -> Option<[f64; 2]> {
        let centre = |b: [f64; 4]| [b[0] + b[2] / 2.0, b[1] + b[3] / 2.0];
        let named = |boxes: Vec<(String, [f64; 4])>| {
            let found = boxes.into_iter().find(|(id, _)| id == item);
            found.map(|(_, b)| centre(b))
        };
        let session = self.evaluated(form, t);
        let drawing = crate::frames::drawing_of(&self.sched, &session)?;
        let evidence = &self.scenario.evidence;
        let drawn = self.renderer.prepare_drawing(&drawing, evidence);
        let flat = named(drawn.ok()?.boxes());
        if !deep_canvas_scene3d::scene::has_3d(form) {
            return flat;
        }
        let posed = crate::film::posed(form, t);
        let form = posed.as_ref().unwrap_or(form);
        let look = Look3::from_roles(self.look.light.clone());
        let evidence = self.scenario.evidence.clone();
        let read = move |sha: &str| crate::evidence::read(&evidence, sha);
        let evaluated = deep_canvas_scene3d::scene::evaluate_with;
        let scene = evaluated(form, t, &look, &mut Labels::new(), &read).ok()?;
        let cards = deep_canvas_scene3d::views::framed(form);
        match cards.iter().find(|f| f.items.contains(item)) {
            // A card's items draw with its frame's corner at the card's place.
            Some(card) => {
                let placed = scene.overlays.iter().find(|o| o.id == card.overlay)?;
                let (origin, at) = (placed.origin?, flat?);
                Some([0, 1].map(|k| at[k] - card.corner[k] + origin[k]))
            }
            None => flat.or_else(|| named(scene.boxes())),
        }
    }

    /// The tour pointer the frame of `form` at `t` draws, its tip in px of the frame at its own
    /// size; none where no pointer pixel draws: a form with no tour, one whose track isn't the
    /// tour's own entries (the tour plays where no one gives input), a pointer its `show` hides,
    /// or reduced motion.
    pub(crate) fn tour_pointer(&mut self, form: &Value, t: i64, reduced: bool) -> Option<Drawn> {
        let tour = tour_of(form).filter(|_| !reduced)?;
        let track = form.get("track").and_then(Value::as_array)?;
        if track.iter().any(|e| e["writer"] != "tour") {
            return None;
        }
        let size = [0, 1].map(|k| form["size"][k].as_f64().unwrap_or(0.0));
        let run = Run {
            origin: tour.idle_after,
            home: [size[0] / 2.0, size[1] / 2.0],
            end: None,
        };
        // The look's ease for a change of state, which the glide takes (Look: `time.state`).
        let rate = form.get("transport");
        let rate = rate.and_then(deep_canvas::document::frame_rate_of);
        let look = self.look_def_of(form);
        let feel = look.as_ref().and_then(Value::as_object);
        let feel = feel.and_then(|l| feel_of(l, rate.unwrap_or((60, 1))).ok());
        let layout = Drawing {
            hub: RefCell::new(self),
            form,
        };
        tour.pointer(&run, t, &layout, feel.unwrap_or_default().ease, false)
    }

    /// The tour pointer of `form` at `t` drawn over `rgba`, a frame of `size` px: in the overlay
    /// above the document's layers, and never a part of them.
    pub(crate) fn pointer_over(&mut self, form: &Value, t: i64, rgba: &mut [u8], size: [u16; 2]) {
        let Some(pointer) = self.tour_pointer(form, t, false) else {
            return;
        };
        let frame = [0, 1].map(|k| form["size"][k].as_f64().unwrap_or(1.0));
        let role = |name: &str| self.look.light.get(name).copied();
        let ink = role("ink").unwrap_or([0; 3]);
        let ground = role("ground").unwrap_or([255; 3]);
        let colors = [ink, ground, role("accent").unwrap_or(ink)];
        let marks = Marks {
            frame: Frame {
                size: frame,
                ground: colors[1],
                layers: vec![layer(&pointer, frame, colors)],
            },
            runs: BTreeMap::new(),
            animated: BTreeMap::new(),
            built: 0,
            damage: Vec::new(),
            basis: None,
        };
        let painted = Painted {
            drawing: Some(Arc::new(marks)),
            boxes: Vec::new(),
            status: None,
            size: frame,
        };
        let evidence = &self.scenario.evidence;
        if let Ok(drawn) = self.renderer.prepare_drawing(&painted, evidence) {
            let over = self.renderer.raster(&drawn, size, None);
            snapshot::over(rgba, &over);
        }
    }
}

/// The pointer's marks in a frame of `size` u: a press's ring under an arrow whose tip is the
/// pointer's, in the look's `(ink, ground, accent)`.
fn layer(pointer: &Drawn, size: [f64; 2], [ink, ground, accent]: [[u8; 3]; 3]) -> Layer {
    // The arrow stands a fortieth of the frame's shorter side tall, and never under 18 u.
    let s = (size[0].min(size[1]) / 40.0).max(18.0) / 17.0;
    let [x, y] = pointer.tip;
    let at = |p: [f64; 2]| [x + p[0] * s, y + p[1] * s];
    let outline = [
        [0.0, 0.0],
        [0.0, 17.0],
        [4.1, 13.2],
        [6.9, 19.6],
        [9.6, 18.4],
        [6.8, 12.1],
        [12.2, 12.1],
    ];
    let mut verbs = vec![Verb::Move(at(outline[0]))];
    verbs.extend(outline[1..].iter().map(|p| Verb::Line(at(*p))));
    verbs.push(Verb::Close);
    let line = |width: f64, color: [u8; 3], opacity: f64| Line {
        width,
        paint: Fill::Solid(color),
        opacity,
        dashes: None,
        profile: None,
    };
    let arrow = Mark::Shape {
        item: ITEM.into(),
        verbs,
        fill: Some((Fill::Solid(ink), pointer.opacity)),
        stroke: Some(line(1.4 * s, ground, pointer.opacity)),
    };
    // The ring widens from the tip and thins out as it goes.
    let ring = pointer.ring.map(|share| Mark::Shape {
        item: ITEM.into(),
        verbs: circle([x, y], (6.0 + 16.0 * share) * s),
        fill: None,
        stroke: Some(line(2.4 * s, accent, pointer.opacity * (1.0 - share))),
    });
    let marks = ring.into_iter().chain([arrow]).map(|mark| scene::Drawn {
        mark,
        clip: None,
        scopes: Vec::new(),
    });
    let state = json!([pointer.tip, pointer.opacity, pointer.ring, size]).to_string();
    let mut key = [0; 16];
    key.copy_from_slice(&Sha256::digest(state.as_bytes())[..16]);
    Layer {
        id: ITEM.into(),
        marks: marks.map(Arc::new).collect(),
        key: ContentKey(key),
    }
}

/// A circle of radius `r` about `c`, as four cubics.
fn circle(c: [f64; 2], r: f64) -> Vec<Verb> {
    let k = 0.552_284_749_830_793_4 * r;
    let p = |dx: f64, dy: f64| [c[0] + dx, c[1] + dy];
    vec![
        Verb::Move(p(r, 0.0)),
        Verb::Cubic(p(r, k), p(k, r), p(0.0, r)),
        Verb::Cubic(p(-k, r), p(-r, k), p(-r, 0.0)),
        Verb::Cubic(p(-r, -k), p(-k, -r), p(0.0, -r)),
        Verb::Cubic(p(k, -r), p(r, -k), p(r, 0.0)),
        Verb::Close,
    ]
}

/// A pointer's reading as `eval` answers it: its tip and the share of itself it draws with; a
/// pointer that doesn't draw reads opacity 0 and no tip.
pub(crate) fn reading(pointer: Option<Drawn>) -> Value {
    json!({"tip": pointer.map(|p| p.tip), "opacity": pointer.map_or(0.0, |p| p.opacity)})
}

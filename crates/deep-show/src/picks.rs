//! #539 (canvas primitives: Control: picks on rows and grid focus; Control: point, its hover): a
//! pick control on rows in a panel. A click or a tap on a drawn row of a set it names, or Enter or
//! Space on its focused row, appends one entry `{set, key}` at the gesture, found by the core's
//! hit test over the rows that draw, and selects nothing. With `focus`, the rows are the
//! control's one Tab stop: arrows, Home and End move a roving focus over the drawn rows
//! (`deep_canvas_input::rows`), each landing announced by the row's label and none an entry. The
//! cell under the pointer is the control's hover, viewer state that only the panel's live view
//! and the window draw. The `logic` call steps a document's logic items on its input track as the
//! hub holds it, and keeps the first run on each track as the record a replay must match.

use std::collections::BTreeMap;
use std::rc::Rc;

use deep_canvas::document::Issue;
use deep_canvas::scope::{Event, Hit};
use deep_canvas_input::rows::{self, Move, Row};
use deep_logic::piece::Piece;
use deep_logic::world::{track_of, Entry, Record, World};
use serde_json::{json, Map, Value};

use crate::hub::Hub;

/// A pick control on rows: `verb: pick` with `rows`, the sets it names in order, and its `focus`.
pub(crate) struct Picker {
    pub id: String,
    pub sets: Vec<String>,
    pub focus: Option<Value>,
}

/// The document's pick controls on rows, in its order.
pub(crate) fn pickers(doc: &Value) -> Vec<Picker> {
    let controls = doc.get("controls").and_then(Value::as_object);
    controls
        .into_iter()
        .flatten()
        .filter(|(_, c)| c.get("verb").and_then(Value::as_str) == Some("pick"))
        .filter_map(|(id, c)| {
            let sets = c
                .get("rows")?
                .as_array()?
                .iter()
                .map(|s| s.as_str().map(str::to_string))
                .collect::<Option<_>>()?;
            Some(Picker {
                id: id.clone(),
                sets,
                focus: c.get("focus").cloned(),
            })
        })
        .collect()
}

/// A drawn row of a pick control's sets: `<set>#<key>`, its row, its box and its hexagon.
#[derive(Clone, Debug)]
pub(crate) struct Drawn {
    pub id: String,
    pub row: Row,
    b: [f64; 4],
    hull: Option<Value>,
}

impl Drawn {
    /// The entry's value a pick of this row writes.
    fn value(&self) -> Value {
        json!({"set": self.row.set, "key": self.row.key})
    }
}

/// A row's key: a grid's `cx,cy`, a fed instancer's `slot.gen`, or an integer key and 0.
fn key_of(key: &str) -> Option<([i64; 2], bool)> {
    if let Some((a, b)) = key.split_once(',') {
        return Some(([a.parse().ok()?, b.parse().ok()?], true));
    }
    if let Some((a, b)) = key.split_once('.') {
        return Some(([a.parse().ok()?, b.parse().ok()?], false));
    }
    Some(([key.parse().ok()?, 0], false))
}

/// `p`'s rows among `all`, the rows a frame draws; a row keyed by a string isn't one a pick takes.
fn of(p: &Picker, all: &[(String, [f64; 4], Option<Value>)]) -> Vec<Drawn> {
    all.iter()
        .filter_map(|(id, b, hull)| {
            let (set, key) = id.split_once('#')?;
            let set = p.sets.iter().position(|s| s == set)?;
            let (key, grid) = key_of(key)?;
            let centre = [b[0] + b[2] / 2.0, b[1] + b[3] / 2.0];
            Some(Drawn {
                id: id.clone(),
                row: Row {
                    set: set as u8,
                    key,
                    centre,
                    grid,
                },
                b: *b,
                hull: hull.clone(),
            })
        })
        .collect()
}

/// A row's label, the key: a grid's or an instancer's pair, else the integer.
fn label(r: &Row) -> String {
    if r.grid || r.key[1] != 0 {
        format!("({}, {})", r.key[0], r.key[1])
    } else {
        r.key[0].to_string()
    }
}

/// What a panel holds of its pick controls, all viewer state but the record.
#[derive(Default)]
pub(crate) struct Viewer {
    /// The roving focus: its control and its row.
    focus: Option<(String, Drawn)>,
    /// Each focus announcement, `{t, id, text}`, in the order made.
    pub(crate) said: Vec<Value>,
    /// Each pick control's hovered cell.
    hover: BTreeMap<String, [i64; 2]>,
    /// The press: the control and value its row picks, its time, and the camera then.
    pressed: Option<(String, Value, i64, Value)>,
    down: bool,
    /// The planted `pick_resolves_on_replay`: each pick's panel point, by control and stamp.
    points: Vec<(String, i64, [f64; 2])>,
    /// The record of the play: each track's first `logic` run, its step hashes.
    runs: Vec<(String, Vec<Value>)>,
}

impl Viewer {
    /// The focused row's ID, which `state.focus` reports for the control's stop.
    pub(crate) fn focused(&self) -> Option<&str> {
        self.focus.as_ref().map(|(_, d)| d.id.as_str())
    }
}

/// `logic`: the document's logic items stepped from 0 to `steps` − 1 on its input track.
#[derive(Debug)]
pub struct LogicCall {
    pub doc: String,
    pub steps: i64,
    pub check: bool,
    /// #548: the input track the replay reads in place of the hub's.
    pub track: Option<Vec<Value>>,
}

pub fn parse(c: &Map<String, Value>) -> Option<LogicCall> {
    let check = match c.get("check") {
        None => false,
        Some(v) => v.as_str()? == "logic.determinism",
    };
    let steps = c
        .get("steps")?
        .as_i64()
        .filter(|n| (1..=100_000).contains(n))?;
    let track = match c.get("track") {
        None => None,
        Some(t) => Some(t.as_array()?.clone()),
    };
    Some(LogicCall {
        doc: c.get("doc")?.as_str()?.to_string(),
        steps,
        check,
        track,
    })
}

/// `piece` stepped from 0 to `count` − 1 on `entries`: each step's hash and arrays per item, as
/// `logic` reports them (#540's `match` reports each copy's the same way), up to the first step
/// that trapped and no further (#548), with that trap.
pub(crate) fn stepped(
    piece: &Rc<Piece>,
    entries: &[Entry],
    count: i64,
) -> Result<(Vec<Value>, Option<Value>), Value> {
    let mut rec = Record::default();
    let mut world = World::new(
        piece.clone(),
        track_of(entries),
        false,
        Default::default(),
        &mut rec,
        None,
    )?;
    let len = piece.items.first().map_or(1, |i| i.step);
    let mut steps = Vec::new();
    for k in 0..count {
        world.run(k + 1, &mut rec, &mut |_, _| {});
        let row = rec.rows().get(&k).map(|r| &r.0);
        let hash: Map<String, Value> = piece
            .items
            .iter()
            .filter_map(|i| Some((i.id.clone(), row?.get(&i.id)?.get("hash")?.clone())))
            .collect();
        let mut arrays = Map::new();
        for (n, item) in piece.items.iter().enumerate() {
            let region = world.write_region(n);
            for w in &item.writes {
                let Some(e) = item.write(&w.name) else {
                    continue;
                };
                let bytes = &region[e.offset as usize..(e.offset + e.size) as usize];
                let values = bytes
                    .chunks_exact(w.ty.size() as usize)
                    .map(|b| w.ty.value(b))
                    .collect();
                arrays.insert(format!("{}.{}", item.id, w.name), Value::Array(values));
            }
        }
        steps.push(json!({"step": k, "t": k * len, "hash": hash, "arrays": arrays}));
        if let Some(trap) = rec.traps.first() {
            return Ok((steps, Some(trap.clone())));
        }
    }
    Ok((steps, None))
}

/// Whether a logic item of `form` reads control `c`.
fn read_by_logic(form: &Value, c: &str) -> bool {
    let items = form.get("items").and_then(Value::as_object);
    items.into_iter().flatten().any(|(_, i)| {
        i.pointer("/params/reads")
            .and_then(Value::as_array)
            .is_some_and(|r| r.iter().any(|r| r == c))
    })
}

/// A pick control's rows at check: at most 8, each an item of the document; and, when a logic
/// item reads the control, no named set keyed by a string column, naming the set.
pub(crate) fn check(form: &Value) -> Vec<Issue> {
    let mut out = Vec::new();
    let items = form.get("items").and_then(Value::as_object);
    for p in pickers(form) {
        let path = format!("controls/{}/rows", p.id);
        if p.sets.len() > 8 {
            out.push(Issue::error(
                "out_of_range",
                &p.id,
                path.clone(),
                json!(p.sets.len()),
                "a pick control names at most 8 sets of rows",
            ));
        }
        for (i, set) in p.sets.iter().enumerate() {
            let Some(item) = items.and_then(|m| m.get(set)) else {
                out.push(Issue::error(
                    "ref_unresolved",
                    &p.id,
                    format!("{path}/{i}"),
                    json!(set),
                    "a pick control's rows name a mark set or an instancer of the document",
                ));
                continue;
            };
            let key = item.pointer("/params/key").and_then(Value::as_str);
            let column = key.and_then(|k| item.pointer(&format!("/params/columns/{k}/as")));
            if read_by_logic(form, &p.id) && column.and_then(Value::as_str) == Some("str") {
                out.push(Issue::error("logic_refused", set, format!("{path}/{i}"), json!({"set": set, "key": key}), "a logic item reads this pick control, and the set is keyed by a string column: logic never gets a string key"));
            }
        }
    }
    out
}

impl Hub<'_> {
    fn planted_is(&self, name: &str) -> bool {
        self.scenario.module_planted.as_deref() == Some(name)
    }

    /// Every mark set row the panel's document draws now, as its session holds it; with `dead`,
    /// from it with each set's `alive` left out.
    fn rows_now(&mut self, panel: &str, dead: bool) -> Vec<(String, [f64; 4], Option<Value>)> {
        let Some(mut doc) = self
            .panel_doc(panel)
            .and_then(|d| self.sessions.get(&d)?.document().cloned())
        else {
            return Vec::new();
        };
        let t = self
            .scopes
            .get(panel)
            .and_then(|s| s.scope.time())
            .unwrap_or(self.now);
        if dead {
            for item in doc["items"]
                .as_object_mut()
                .into_iter()
                .flat_map(|i| i.values_mut())
            {
                if let Some(p) = item.get_mut("params").and_then(Value::as_object_mut) {
                    p.remove("alive");
                }
            }
        }
        self.row_boxes(&doc, t)
    }

    /// The topmost of `rows` under panel point `pos`, by the core's hit test: each row a target
    /// with its box and hexagon, stacked over its set. The planted `hit_by_quad_bounds` meets a
    /// row by its quad.
    fn hit(&self, panel: &str, doc: &Value, rows: &[Drawn], pos: [f64; 2]) -> Option<Drawn> {
        let scope = &self.scopes.get(panel)?.scope;
        let quads = self.planted_is("hit_by_quad_bounds");
        let targets: Map<String, Value> = rows
            .iter()
            .map(|r| {
                let order = &doc["items"][r.id.split('#').next().unwrap_or_default()]["order"];
                let hull = if quads {
                    Value::Null
                } else {
                    r.hull.clone().unwrap_or(Value::Null)
                };
                (
                    r.id.clone(),
                    json!({"id": r.id, "order": order, "params": {"box": r.b, "hull": hull}}),
                )
            })
            .collect();
        let mut shown = doc.clone();
        shown["items"] = Value::Object(targets);
        match scope.hit(&shown, pos) {
            Hit::Item(id) => rows.iter().find(|r| r.id == id).cloned(),
            _ => None,
        }
    }

    /// A pointer event on a panel with pick controls, before its scope takes it: a press notes
    /// the row it lands on; a release on that row with the camera where it was appends the pick,
    /// stamped at the press; a move with no press sets each control's hovered cell. One gesture
    /// picks for one control: of those whose rows hold the topmost row, the last in the
    /// document's order. The entries appended.
    pub(crate) fn pick_pointer(
        &mut self,
        panel: &str,
        doc: &Value,
        event: &Event,
        serial: u64,
    ) -> Result<Vec<Value>, Value> {
        let pickers = pickers(doc);
        let pos = match event {
            Event::Down { pos, .. } | Event::Move(pos) | Event::Up(pos) if !pickers.is_empty() => {
                *pos
            }
            _ => return Ok(Vec::new()),
        };
        let all = self.rows_now(panel, self.planted_is("hit_ignores_alive"));
        let hits: Vec<Option<Drawn>> = pickers
            .iter()
            .map(|p| self.hit(panel, doc, &of(p, &all), pos))
            .collect();
        let hit = pickers
            .iter()
            .zip(&hits)
            .rev()
            .find_map(|(p, h)| Some((p.id.clone(), h.as_ref()?.value())));
        let camera = self
            .scopes
            .get(panel)
            .map_or(Value::Null, |s| s.scope.pose().to_json());
        let (now, planted) = (self.now, self.planted_is("pick_resolves_on_replay"));
        let Some(v) = self.scopes.get_mut(panel).map(|s| &mut s.picks) else {
            return Ok(Vec::new());
        };
        match event {
            Event::Down { .. } => {
                v.down = true;
                v.pressed = hit.map(|(c, value)| (c, value, now, camera));
            }
            Event::Up(_) => {
                v.down = false;
                if let (Some((c, value, t, at)), Some(h)) = (v.pressed.take(), hit) {
                    if h == (c.clone(), value.clone()) && at == camera {
                        if planted {
                            v.points.push((c.clone(), t, pos));
                        }
                        let doc = self.panel_doc(panel).unwrap_or_default();
                        return self.pick(&doc, &c, value, t, serial);
                    }
                }
            }
            _ if !v.down => {
                for (p, h) in pickers.iter().zip(hits) {
                    match h.filter(|d| d.row.grid) {
                        Some(d) => v.hover.insert(p.id.clone(), d.row.key),
                        None => v.hover.remove(&p.id),
                    };
                }
            }
            _ => {}
        }
        Ok(Vec::new())
    }

    /// A pick: one entry on `doc`'s track at `t`. When a logic item reads the control, the
    /// document's logic is baked again on the track, as an export bakes it, so the live session
    /// draws what its rules make of the pick. The entry appended.
    pub(crate) fn pick(
        &mut self,
        doc: &str,
        control: &str,
        value: Value,
        t: i64,
        serial: u64,
    ) -> Result<Vec<Value>, Value> {
        let appended: Vec<Value> = self
            .enter(doc, control, value, t, serial)?
            .into_iter()
            .collect();
        let Some(mut form) = self
            .forms
            .get(doc)
            .filter(|f| read_by_logic(f, control))
            .cloned()
        else {
            return Ok(appended);
        };
        let track = self.track_json(doc);
        if self.inline_occurrences(&mut form, &track).is_ok() {
            let _ = self.column_view(&mut form, 0);
            self.forms.insert(doc.to_string(), form);
            self.replay(doc, t);
        }
        Ok(appended)
    }

    /// The roving focus on the stop the scope holds: a pick control with `focus` enters at its
    /// start row (`focus.start`, else the first drawn row), and a focused row that stopped
    /// drawing gives way to the nearest drawn row, each announced; any other stop holds no row.
    /// The planted `focus_stops_on_hidden_rows` takes rows that don't draw as drawn ones.
    pub(crate) fn settle_focus(&mut self, panel: &str) {
        let Some((doc, _)) = self.panel_document(panel) else {
            return;
        };
        let stop = self.scopes.get(panel).and_then(|s| match &s.scope.focus {
            Some((c, None)) => Some(c.clone()),
            _ => None,
        });
        let Some(p) = stop.and_then(|c| {
            pickers(&doc)
                .into_iter()
                .find(|p| p.id == c && p.focus.is_some())
        }) else {
            if let Some(s) = self.scopes.get_mut(panel) {
                s.picks.focus = None;
            }
            return;
        };
        let rows = of(
            &p,
            &self.rows_now(panel, self.planted_is("focus_stops_on_hidden_rows")),
        );
        let list: Vec<Row> = rows.iter().map(|d| d.row.clone()).collect();
        let held = self
            .scopes
            .get(panel)
            .and_then(|s| s.picks.focus.clone())
            .filter(|(c, _)| *c == p.id);
        let next = match held {
            Some((_, d)) if rows.iter().any(|r| r.id == d.id) => return,
            Some((_, d)) => rows::nearest(&list, &d.row),
            None => {
                let start = p
                    .focus
                    .as_ref()
                    .and_then(|f| f.get("start"))
                    .and_then(Value::as_array);
                let start = start.and_then(|k| Some([k.first()?.as_i64()?, k.get(1)?.as_i64()?]));
                rows::start(&list, start)
            }
        };
        self.focus_on(panel, &p.id, next.map(|i| rows[i].clone()));
    }

    fn focus_on(&mut self, panel: &str, control: &str, row: Option<Drawn>) {
        let now = self.now;
        if let Some(s) = self.scopes.get_mut(panel) {
            if let Some(d) = &row {
                s.picks
                    .said
                    .push(json!({"t": now, "id": d.id, "text": label(&d.row)}));
            }
            s.picks.focus = row.map(|d| (control.to_string(), d));
        }
    }

    /// A key after the scope took it: the focus settled on the scope's stop, then, on a pick
    /// control's rows, moved by an arrow, Home or End, or picked by Enter or Space. The entries
    /// appended.
    pub(crate) fn pick_key(
        &mut self,
        panel: &str,
        key: &str,
        serial: u64,
    ) -> Result<Vec<Value>, Value> {
        self.settle_focus(panel);
        let Some((control, here)) = self.scopes.get(panel).and_then(|s| s.picks.focus.clone())
        else {
            return Ok(Vec::new());
        };
        if matches!(key, "Enter" | "Return" | " " | "Space") {
            let doc = self.panel_doc(panel).unwrap_or_default();
            return self.pick(&doc, &control, here.value(), self.now, serial);
        }
        let (Some(m), Some((doc, _))) = (Move::of(key), self.panel_document(panel)) else {
            return Ok(Vec::new());
        };
        let Some(p) = pickers(&doc).into_iter().find(|p| p.id == control) else {
            return Ok(Vec::new());
        };
        let rows = of(
            &p,
            &self.rows_now(panel, self.planted_is("focus_stops_on_hidden_rows")),
        );
        let list: Vec<Row> = rows.iter().map(|d| d.row.clone()).collect();
        if let Some(at) = rows.iter().position(|r| r.id == here.id) {
            let to = rows::moved(&list, at, m);
            if to != at {
                self.focus_on(panel, &control, Some(rows[to].clone()));
            }
        }
        Ok(Vec::new())
    }

    /// Writes the panel's viewer state for its pick controls into `form`, a live view's: each
    /// control's hovered cell as its `hover`, and the focused row's outline, never a fill.
    pub(crate) fn viewer_into(&self, panel: &str, form: &mut Value) {
        let Some(v) = self.scopes.get(panel).map(|s| &s.picks) else {
            return;
        };
        let points = self.scopes.get(panel).map(|s| &s.points.hover);
        let hovers = v.hover.iter().map(|(c, cell)| (c, json!(cell)));
        for (c, h) in hovers.chain(points.into_iter().flatten().map(|(c, h)| (c, h.clone()))) {
            if let Some(control) = form
                .get_mut("controls")
                .and_then(|cs| cs.get_mut(c.as_str()))
            {
                control["hover"] = h;
            }
        }
        if let (Some((c, d)), Some(items)) = (
            &v.focus,
            form.get_mut("items").and_then(Value::as_object_mut),
        ) {
            // On its set's layer, above every item.
            let layer = items
                .get(d.id.split('#').next().unwrap_or_default())
                .and_then(|s| s.get("layer"))
                .cloned();
            let id = format!("{c}-focus");
            let paint = json!({"stroke": {"role": "accent", "width": 1}});
            let mut outline = json!({"id": id, "kind": "rect@1", "name": "Focus", "role": "decoration", "order": "zz", "params": {"box": d.b, "paint": paint}});
            if let Some(layer) = layer {
                outline["layer"] = layer;
            }
            items.insert(id, outline);
        }
    }

    /// The planted `export_keeps_live_hover`: document `doc`'s panel's live hover in `form`.
    pub(crate) fn hover_into(&self, doc: &str, form: &mut Value) {
        let Some(panel) = self.scenario.docs.get(doc) else {
            return;
        };
        let hover = self
            .scopes
            .get(panel)
            .map(|s| s.picks.hover.clone())
            .unwrap_or_default();
        for (c, cell) in hover {
            if let Some(control) = form
                .get_mut("controls")
                .and_then(|cs| cs.get_mut(c.as_str()))
            {
                control["hover"] = json!(cell);
            }
        }
    }

    /// A 2D frame of `doc` for the window at `t`: its session's, with the panel's viewer state.
    pub(crate) fn window_drawn(
        &mut self,
        doc: &str,
        panel: &str,
        t: i64,
    ) -> Option<crate::snapshot::Drawn> {
        let mut form = self.played_form(doc)?;
        let before = form.clone();
        self.viewer_into(panel, &mut form);
        // #548: the live frame's logic previews, of the state at `t`.
        self.preview_into(doc, panel, t, &mut form);
        if form == before {
            return self.live_drawn(doc, t);
        }
        let held = self.sessions.get(doc)?.document().cloned();
        if let Some(s) = self.sessions.get_mut(doc) {
            s.load(&mut self.sched, &form);
        }
        let drawn = self.live_drawn(doc, t);
        if let (Some(held), Some(s)) = (held, self.sessions.get_mut(doc)) {
            s.load(&mut self.sched, &held);
        }
        drawn
    }

    /// The hub's track of `doc` as a read takes it. The planted `pick_resolves_on_replay`
    /// resolves each pick's row again from its panel point through the camera as it is now.
    pub(crate) fn track_read(&mut self, doc: &str) -> Vec<Value> {
        let mut track = self.track_json(doc);
        // #540: the planted point twins that compute an entry again at a replay.
        let _ = self.points_read(doc, &mut track);
        let panel = self.scenario.docs.get(doc).cloned().unwrap_or_default();
        let points = self
            .scopes
            .get(&panel)
            .map(|s| s.picks.points.clone())
            .unwrap_or_default();
        let Some((shown, _)) = self.panel_document(&panel).filter(|_| !points.is_empty()) else {
            return track;
        };
        let all = self.rows_now(&panel, false);
        for e in &mut track {
            let at = points
                .iter()
                .find(|(c, t, _)| e["control"] == c.as_str() && e["t"].as_i64() == Some(*t));
            let p = at.and_then(|(c, _, _)| pickers(&shown).into_iter().find(|p| p.id == *c));
            if let (Some((_, _, pos)), Some(p)) = (at, p) {
                if let Some(d) = self.hit(&panel, &shown, &of(&p, &all), *pos) {
                    e["value"] = d.value();
                }
            }
        }
        track
    }

    /// `logic`: the document's logic items, as its last `deep_show` checked them, stepped from 0
    /// to `steps` − 1 on its input track as the hub holds it: each step's hash and arrays per
    /// item, and the track read. The first run on a track is the record of the play; with
    /// `check`, logic.determinism runs, and a run whose step hash differs from the record's
    /// fails, naming the step and the entry it read.
    pub fn logic_call(&mut self, l: &LogicCall) -> Value {
        let Some(form) = self.forms.get(&l.doc).cloned() else {
            return json!({"code": "no_revision"});
        };
        let piece = match self.logic_piece(&form) {
            Ok(Some(p)) => Rc::new(p),
            Ok(None) => return json!({"code": "no_logic"}),
            Err(i) => return json!({"code": i.code, "issues": [i.to_json()]}),
        };
        let held = l.track.clone().unwrap_or_else(|| self.track_json(&l.doc));
        let read = l.track.clone().unwrap_or_else(|| self.track_read(&l.doc));
        let entries: Vec<Entry> = read.iter().filter_map(Entry::parse).collect();
        let (steps, trap) = match stepped(&piece, &entries, l.steps) {
            Ok(s) => s,
            Err(e) => return e,
        };
        let len = piece.items.first().map_or(1, |i| i.step);
        let hashes: Vec<Value> = steps.iter().map(|s| s["hash"].clone()).collect();
        let replay = self.against_record(&l.doc, &held, &hashes, &piece, len);
        let mut out = json!({"steps": steps, "track": held, "trap": trap});
        if l.check {
            let at = [l.steps / 2];
            let (verdict, mut failures) = match deep_logic::checks::determinism(
                &piece,
                &entries,
                l.steps,
                &at,
                Default::default(),
            ) {
                Ok(v) => (
                    "PASS",
                    v["failures"].as_array().cloned().unwrap_or_default(),
                ),
                Err(e) => ("BLOCKED", vec![e]),
            };
            failures.extend(replay);
            let verdict = if verdict == "PASS" && !failures.is_empty() {
                "FAIL"
            } else {
                verdict
            };
            out["check"] =
                json!({"kind": "logic.determinism", "verdict": verdict, "failures": failures});
        }
        out
    }

    /// A run's step hashes against the record of the first run on the same track, kept when there
    /// is none: each item's first step whose hash differs, with the entries it read.
    fn against_record(
        &mut self,
        doc: &str,
        held: &[Value],
        hashes: &[Value],
        piece: &deep_logic::piece::Piece,
        len: i64,
    ) -> Vec<Value> {
        let key = Value::Array(held.to_vec()).to_string();
        let panel = self.scenario.docs.get(doc).cloned().unwrap_or_default();
        let Some(v) = self.scopes.get_mut(&panel).map(|s| &mut s.picks) else {
            return Vec::new();
        };
        let Some((_, first)) = v.runs.iter().find(|(k, _)| *k == key) else {
            v.runs.push((key, hashes.to_vec()));
            return Vec::new();
        };
        let mut failures = Vec::new();
        for item in &piece.items {
            let Some(k) = (0..hashes.len().min(first.len()))
                .find(|&k| hashes[k][&item.id] != first[k][&item.id])
            else {
                continue;
            };
            let t = k as i64 * len;
            let read: Vec<&Value> = held
                .iter()
                .filter(|e| e["t"].as_i64().is_some_and(|et| et <= t && et > t - len))
                .collect();
            let entry = read.first().copied().or_else(|| {
                held.iter()
                    .rfind(|e| e["t"].as_i64().is_some_and(|et| et <= t))
            });
            failures.push(json!({"item": item.id, "run": "replay", "step": k, "t": t, "field": "step_hash",
                "recorded": first[k][&item.id], "replayed": hashes[k][&item.id], "entry": entry, "inputs": read}));
        }
        failures
    }
}

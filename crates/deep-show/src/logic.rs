//! #544: a document's logic items, baked on an input track over the transport's span, and each
//! one's occurrence list written into the form its readers read, as `occurrences` holds a baked
//! list (`<logic ID>.occurrences`): Spawn, `start_on`, mark-set rows and drivers read a logic
//! item's rows as they read any list, from the bake, so a seek reads what playing does. #535: the
//! bake's arrays go into the form's `arrays`, which the core's column view reads.

use std::rc::Rc;

use deep_canvas::document::Issue;
use deep_logic::piece::Piece;
use deep_logic::world::{track_of, Entry, Record, World};
use serde_json::{json, Map, Value};

use crate::hub::Hub;

/// #548's planted deep_query: its region map lays the reads out by name, not in declaration order.
pub(crate) const MAP_READS_BY_NAME: &str = "region_map_reads_by_name";

/// The logic items' lists in `form`'s `occurrences`, by name.
fn logic_lists(form: &mut Value) -> Vec<&mut Value> {
    let logic: Vec<String> = form
        .get("items")
        .and_then(Value::as_object)
        .into_iter()
        .flatten()
        .filter(|(_, i)| i.get("kind").and_then(Value::as_str) == Some("logic@1"))
        .map(|(id, _)| format!("{id}.occurrences"))
        .collect();
    match form.get_mut("occurrences").and_then(Value::as_object_mut) {
        Some(lists) => lists
            .iter_mut()
            .filter(|(k, _)| logic.contains(k))
            .map(|(_, v)| v)
            .collect(),
        None => Vec::new(),
    }
}

/// The planted start_on (`start_on_at_first_frame`): each logic row before a session's first
/// frame moved to it, as if a run started when a frame first read the occurrence.
pub(crate) fn from_first_frame(form: &mut Value, first: i64) {
    for list in logic_lists(form) {
        for row in list.as_array_mut().into_iter().flatten() {
            if row["t"].as_i64().is_some_and(|t| t < first) {
                row["t"] = json!(first);
            }
        }
    }
}

impl Hub<'_> {
    /// Mark set columns that read a column source, resolved and narrowed by the core's column
    /// view at `t`, as [`deep_play::logic::column_view`] resolves them.
    pub(crate) fn column_view(&self, form: &mut Value, t: i64) -> Vec<Issue> {
        deep_play::logic::column_view(&self.startup.sealed, form, t)
    }

    /// The document check's view of `form`'s readers ([`Hub::column_view`]), and #538's fit
    /// check over its copy tables, its time written to `timing` when the call asked for it.
    pub(crate) fn checked_view(
        &mut self,
        doc: &str,
        form: &mut Value,
        t: i64,
        timing: Option<&mut Map<String, Value>>,
    ) -> Vec<Issue> {
        self.keep_first_positions(doc, form);
        let mut issues = self.column_view(form, t);
        let (unfit, ms) = copy_fit(form);
        issues.extend(unfit);
        if let Some(timing) = timing {
            timing.insert("copy_fit_ms".into(), json!(ms));
        }
        issues
    }

    /// #538's planted lookup (`copy_keeps_first_position`): each copy table keeps every key's
    /// position in the order the document's first revision stored it, and a later revision's key
    /// reads the entry now at that position. Without the plant, nothing changes.
    pub(crate) fn keep_first_positions(&mut self, doc: &str, form: &mut Value) {
        if self.scenario.module_planted.as_deref()
            != Some(deep_canvas_marks::copy::KEEPS_FIRST_POSITION)
        {
            return;
        }
        let Some(copy) = form
            .pointer_mut("/data/copy")
            .and_then(Value::as_object_mut)
        else {
            return;
        };
        for (locale, tables) in copy.iter_mut() {
            for (name, t) in tables.as_object_mut().into_iter().flatten() {
                let Some(t) = t.as_object_mut() else { continue };
                let now: Vec<String> = t
                    .keys()
                    .filter(|k| k.parse::<i32>().is_ok())
                    .cloned()
                    .collect();
                let first = self
                    .first_orders
                    .entry(format!("{doc}/{locale}/{name}"))
                    .or_insert_with(|| now.clone())
                    .clone();
                let entries: Vec<Value> = now.iter().map(|k| t[k].clone()).collect();
                for (pos, k) in first.iter().enumerate() {
                    if let (Some(e), true) = (entries.get(pos), t.contains_key(k)) {
                        t.insert(k.clone(), e.clone());
                    }
                }
            }
        }
    }

    /// The arrays and lists `form`'s readers read: its logic items' (below), then its spectra's
    /// bands from the bakes kept at check (#503).
    pub(crate) fn inline_occurrences(
        &self,
        form: &mut Value,
        track: &[Value],
    ) -> Result<(), Box<Issue>> {
        let logic = self.inline_logic(form, track);
        self.inline_spectra(form);
        // #466: the lists a text's reveal emits, baked like any occurrence list.
        self.inline_reveals(form);
        logic
    }

    /// Each logic item of `form` stepped on `track` over the transport's span, its program read
    /// from the evidence store, after `form`'s worlds (shared with the web player, #172).
    fn inline_logic(&self, form: &mut Value, track: &[Value]) -> Result<(), Box<Issue>> {
        self.inline_worlds(form, track)?;
        let piece = self.logic_piece(form, track)?;
        let drops = self.scenario.module_planted.as_deref() == Some("hand_over_drops_last_range");
        deep_play::logic::inline_logic(form, piece, track, drops)
    }

    /// `form`'s logic items as one piece, checked by the logic module, each program read from the
    /// evidence store, with the services this build binds (#213); none without a logic item.
    pub(crate) fn logic_piece(
        &self,
        form: &Value,
        track: &[Value],
    ) -> Result<Option<Piece>, Box<Issue>> {
        let root = &self.scenario.evidence;
        let late = self.planted(crate::hub::Planted::Physics(
            crate::physics::Planted::CastAnswersLate,
        ));
        deep_play::logic::logic_piece(
            &self.startup.sealed,
            form,
            track,
            &|sha| crate::evidence::read(root, sha),
            late,
        )
    }

    /// #548: deep_query's logic read of `form`: each of `items` baked on `track` over the span
    /// (and to the last step asked): its region map with its layout digest, each asked step's
    /// arrays as that step left them and the fuel it used, its trap, null when none, and the
    /// hash of the bytes it runs.
    pub(crate) fn logic_read(
        &self,
        form: &Value,
        items: &[String],
        steps: &[i64],
        track: &[Value],
    ) -> Value {
        let piece = match self.logic_piece(form, track) {
            Ok(Some(p)) => Rc::new(p),
            Ok(None) => return json!({"code": "no_logic"}),
            Err(i) => return json!({"code": i.code, "issues": [i.to_json()]}),
        };
        let Some(entries) = track
            .iter()
            .filter(|e| e.get("present").is_none())
            .map(Entry::parse)
            .collect::<Option<Vec<_>>>()
        else {
            return json!({"code": "bad_input", "what": "track: each entry is {t, control, value}"});
        };
        let span = deep_canvas_media::doc::time(form, form.pointer("/transport/span"))
            .unwrap_or(0)
            .max(0);
        let count = piece
            .items
            .iter()
            .map(|i| (span + i.step - 1) / i.step.max(1))
            .chain(steps.iter().map(|k| k + 1))
            .max()
            .unwrap_or(0);
        let mut rec = Record::default();
        let mut world = match World::new(
            piece.clone(),
            track_of(&entries),
            false,
            Default::default(),
            &mut rec,
            None,
        ) {
            Ok(w) => w,
            Err(e) => return e,
        };
        world.run(count, &mut rec, &mut |_, _| {});
        // The planted map lays the reads out by name (#548's region_map_reads_by_name).
        let planted = self.scenario.module_planted.as_deref() == Some(MAP_READS_BY_NAME);
        let by_name = planted
            .then(|| {
                let p = deep_logic::Planted {
                    map_reads_by_name: true,
                    ..Default::default()
                };
                deep_logic::piece::region_maps(&piece_json(form)?, &p).ok()
            })
            .flatten();
        let mut out = Map::new();
        for id in items {
            let Some(i) = piece.items.iter().position(|x| &x.id == id) else {
                return json!({"code": "ref_unresolved", "item": id});
            };
            let region_map = match &by_name {
                Some(maps) => maps
                    .iter()
                    .find(|(m, _, _)| m == id)
                    .map_or(Value::Null, |(_, l, _)| l.to_json()),
                None => piece.items[i].layout.to_json(),
            };
            let prefix = format!("{id}.");
            let fuel = rec.fuel.get(&i);
            let read: Vec<Value> = steps
                .iter()
                .map(|k| {
                    let arrays: Map<String, Value> = rec
                        .arrays_at(&piece, *k)
                        .into_iter()
                        .filter(|(n, _)| n.starts_with(&prefix))
                        .collect();
                    let f = fuel
                        .and_then(|f| f.iter().find(|(s, _)| s == k))
                        .map(|(_, f)| *f);
                    json!({"step": k, "arrays": arrays, "fuel": f})
                })
                .collect();
            let trap = rec
                .traps
                .iter()
                .find(|t| t["item"] == json!(id))
                .cloned()
                .unwrap_or(Value::Null);
            // #1164: `hash`, the SHA-256 of the bytes the engine runs (sandbox@1's rewrite).
            out.insert(id.clone(), json!({"region_map": region_map, "steps": read, "trap": trap, "hash": piece.items[i].hash}));
        }
        json!({"logic": out})
    }
}

/// #1164: the logic twins a scenario's `planted` may name, alone or as a list applied together.
const PLANTED: [&str; 2] = ["restore_zeroes_move_count", "check_compares_step_hashes"];

/// A scenario's `planted` as logic twins: `Some(None)` when it names none, `None` (bad input)
/// for a list holding any other name.
pub(crate) fn planted(v: Option<&Value>) -> Option<Option<deep_logic::Planted>> {
    let mut p = deep_logic::Planted::default();
    match v {
        Some(Value::String(n)) if PLANTED.contains(&n.as_str()) => Some(p.and(n)),
        Some(Value::Array(names)) => {
            for n in names {
                p = p.and(n.as_str().filter(|n| PLANTED.contains(n))?)?;
            }
            Some(Some(p))
        }
        _ => Some(None),
    }
}

pub(crate) use deep_play::logic::piece_json;

/// #538: keyed copy's fit check over `form` (Text `text@1`: keyed copy), in the default type,
/// and the CPU time it took in ms.
pub(crate) fn copy_fit(form: &Value) -> (Vec<Issue>, f64) {
    let started = std::time::Instant::now();
    let mut out = Vec::new();
    if let Some(doc) = form.as_object() {
        deep_canvas_marks::copy::fit_issues(
            doc,
            &deep_canvas_marks::scene::Type::default(),
            &mut out,
        );
    }
    (out, started.elapsed().as_secs_f64() * 1000.0)
}

pub(crate) use deep_play::logic::raised_at;

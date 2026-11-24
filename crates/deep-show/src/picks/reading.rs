//! #3236 (Mark set, scale and encode; Control: picks on rows and grid focus): a reading focus on a
//! mark set or a series no pick control names. Its drawn rows are one Tab stop, the scope's
//! `(set, READING)`; arrows move the focus over the set's walk, Home and End to its first and last
//! stop, each landing announced by what the stop holds, with the values' units. Past 1,000 drawn
//! rows the walk is by buckets. It is viewer state: it writes no entry and picks nothing.

use deep_canvas::scope::READING;
use deep_canvas_input::rows::Move;
use deep_canvas_input::track::{Entry, Writer};
use deep_canvas_marks::data::holds::{self, Stop, Walk};
use deep_canvas_marks::scene::bound_rows;
use serde_json::{json, Value};

use crate::hub::Hub;

/// A stop of a set's walk: its ID, what it says, and, for a row, its key's order and the centre of
/// what it draws.
#[derive(Clone)]
struct At {
    id: String,
    text: String,
    centre: Option<[f64; 2]>,
}

/// The reading focus on a set's stop: what it holds, and where, so a stop that goes is followed.
#[derive(Clone)]
pub(crate) struct Held {
    pub set: String,
    pub id: String,
    centre: Option<[f64; 2]>,
    /// The stop's place in the walk.
    at: usize,
}

impl Hub<'_> {
    /// The panel's shown revision with its tables inlined, as a frame reads its rows: what the
    /// tree's values and a walk are computed from.
    pub(crate) fn shown_with_tables(&self, panel: &str) -> Option<Value> {
        let (mut shown, _) = self.panel_document(panel)?;
        let _ = self.inline_tables(&mut shown);
        Some(shown)
    }

    /// `set`'s walk on the panel, from the rows it draws with the record's readings.
    fn walk(&self, panel: &str, set: &str) -> Vec<At> {
        let walk = match self.scenario.module_planted.as_deref() {
            Some(holds::WALK_IN_ROW_ORDER) => Walk::RowOrder,
            Some(holds::WALK_ON_EVERY_ROW) => Walk::EveryRow,
            _ => Walk::Reading,
        };
        let Some(doc) = self.shown_with_tables(panel) else {
            return Vec::new();
        };
        let Some((form, items)) = doc
            .as_object()
            .and_then(|form| Some((form, form.get("items")?.as_object()?)))
        else {
            return Vec::new();
        };
        let bound = bound_rows(form, &self.record())
            .remove(set)
            .unwrap_or_default();
        match items
            .get(set)
            .and_then(|item| holds::holds(set, item, items, &bound, walk))
        {
            Some(Ok((held, stops))) => stops
                .iter()
                .map(|s| At {
                    id: s.id(set),
                    text: held.says(s),
                    centre: match s {
                        Stop::Row { centre, .. } => Some(*centre),
                        Stop::Bucket { .. } => None,
                    },
                })
                .collect(),
            _ => Vec::new(),
        }
    }

    /// The set whose reading stop the scope holds.
    fn reading_set(&self, panel: &str) -> Option<String> {
        match &self.scopes.get(panel)?.scope.focus {
            Some((set, Some(o))) if o == READING => Some(set.clone()),
            _ => None,
        }
    }

    /// Tab passes a set that draws nothing to walk: it is no stop.
    pub(crate) fn skip_empty(&mut self, panel: &str) {
        let Some((doc, _)) = self.panel_document(panel) else {
            return;
        };
        while self
            .reading_set(panel)
            .is_some_and(|set| self.walk(panel, &set).is_empty())
        {
            match self.scopes.get_mut(panel) {
                Some(s) => s.scope.tab(&doc),
                None => return,
            }
        }
    }

    /// The reading focus on the stop the scope holds: a set's reading stop enters at its first
    /// stop, and a stop that stopped drawing gives way to the nearest drawn row by center
    /// distance, ties to the smaller key, as #539's rows do (a bucket's, to the one at its place),
    /// each announced; any other stop holds none.
    pub(crate) fn settle_reading(&mut self, panel: &str) {
        let Some(set) = self.reading_set(panel) else {
            if let Some(s) = self.scopes.get_mut(panel) {
                s.picks.reading = None;
            }
            return;
        };
        let walk = self.walk(panel, &set);
        let held = self
            .scopes
            .get(panel)
            .and_then(|s| s.picks.reading.clone())
            .filter(|h| h.set == set);
        let at = match held {
            None => 0,
            Some(h) if walk.iter().any(|s| s.id == h.id) => return,
            Some(h) => nearest(&walk, &h),
        };
        self.land(panel, &set, at, walk.get(at));
    }

    /// The focus on `stop` of `set`, announced. The planted `reading_walk_writes_entry` also
    /// appends a pick entry for its row to the document's input track: the entries appended.
    fn land(&mut self, panel: &str, set: &str, at: usize, stop: Option<&At>) -> Vec<Value> {
        let now = self.now;
        if let Some(s) = self.scopes.get_mut(panel) {
            if let Some(At { id, text, .. }) = stop {
                s.picks.said.push(json!({"t": now, "id": id, "text": text}));
            }
            s.picks.reading = stop.map(|stop| Held {
                set: set.to_string(),
                id: stop.id.clone(),
                centre: stop.centre,
                at,
            });
        }
        let planted = self.scenario.module_planted.as_deref() == Some(holds::WALK_WRITES_ENTRY);
        let (Some(At { id, .. }), Some(doc), true) = (stop, self.panel_doc(panel), planted) else {
            return Vec::new();
        };
        let key = id.rsplit('#').next().and_then(|k| k.parse::<i64>().ok());
        let entry = Entry {
            t: now,
            seq: 0,
            control: set.to_string(),
            value: json!({"set": 0, "key": [key.unwrap_or(0), 0]}),
            samples: None,
            writer: Writer::You,
            serial: None,
            player: None,
        };
        let appended = entry.to_json();
        self.tracks.entry(doc).or_default().append(entry);
        vec![appended]
    }

    /// A key on a set's reading stop: an arrow moves the focus to the next or the previous stop,
    /// Home and End to the first and last. `None` where the reading focus doesn't hold the
    /// panel; else the entries it appended, none but by the planted walk.
    pub(crate) fn reading_key(&mut self, panel: &str, key: &str) -> Option<Vec<Value>> {
        let held = self.scopes.get(panel)?.picks.reading.clone()?;
        let walk = self.walk(panel, &held.set);
        let (Some(m), Some(at)) = (Move::of(key), walk.iter().position(|s| s.id == held.id)) else {
            return Some(Vec::new());
        };
        let last = walk.len() - 1;
        let to = match m {
            Move::Home => 0,
            Move::End => last,
            Move::Right | Move::Down => (at + 1).min(last),
            Move::Left | Move::Up => at.saturating_sub(1),
        };
        if to == at {
            return Some(Vec::new());
        }
        Some(self.land(panel, &held.set, to, walk.get(to)))
    }
}

/// The walk's stop nearest where `gone` was: a row by its centre's distance, ties to the smaller
/// key; a bucket, or a row with no centre, the one at its place.
fn nearest(walk: &[At], gone: &Held) -> usize {
    let there = gone.centre.and_then(|c| {
        let far = |s: &At| {
            let (x, y) = (s.centre?[0] - c[0], s.centre?[1] - c[1]);
            Some(x * x + y * y)
        };
        walk.iter()
            .enumerate()
            .filter_map(|(i, s)| Some((far(s)?, s.id.clone(), i)))
            .min_by(|a, b| a.0.total_cmp(&b.0).then_with(|| a.1.cmp(&b.1)))
    });
    match there {
        Some((.., i)) => i,
        None => gone.at.min(walk.len().saturating_sub(1)),
    }
}

#[cfg(test)]
mod tests {
    use serde_json::{json, Value};

    const DOC: &str = "01JB3236000000000000000099";
    const MS: i64 = 705_600;

    fn column(v: &[f64]) -> Value {
        let bytes: Vec<u8> = v.iter().flat_map(|x| x.to_le_bytes()).collect();
        json!({"dtype": "f64", "len": v.len(), "unit": "m", "data": deep_canvas::base64::encode(&bytes)})
    }

    /// A chart of rows at x = 0, 1, 2 … and the `y`s given, keyed by index, or by `key`.
    fn set(id: &str, order: &str, y: &[f64], key: Option<&[&str]>) -> (String, Value) {
        let x: Vec<f64> = (0..y.len()).map(|i| i as f64).collect();
        let mut params = json!({"mark": "point", "n": y.len(),
            "columns": {"x": column(&x), "y": column(y)},
            "encode": {"x": {"column": "x", "scale": "time"}, "y": {"column": "y", "scale": "height"}}});
        if let Some(k) = key {
            params["key"] = json!("k");
            params["columns"]["k"] = json!({"dtype": "str", "len": k.len(), "data": k});
        }
        let item = json!({"id": id, "kind": "marks@1", "name": id, "role": "data", "order": order,
                          "params": params});
        (id.to_string(), item)
    }

    fn document(sets: &[(String, Value)], extra: Value) -> Value {
        let scale = |domain: [f64; 2], range: [f64; 2]| json!({"type": "linear", "domain": domain, "range": range, "nice": false});
        let mut items = json!({
            "cam": {"id": "cam", "kind": "camera@1", "name": "Camera", "order": "a0",
                "params": {"projection": "orthographic", "target": [200, 150, 0], "view_width": 400}},
            "time": {"id": "time", "kind": "scale@1", "name": "Time", "order": "a1",
                "params": scale([0.0, 12.0], [40.0, 360.0])},
            "height": {"id": "height", "kind": "scale@1", "name": "Height", "order": "a2",
                "params": scale([0.0, 60.0], [260.0, 20.0])},
        });
        for (id, item) in sets {
            items[id] = item.clone();
        }
        let mut doc = json!({"format": 1, "id": DOC, "profile": "figure", "title": "T",
            "description": "A chart read by key.", "size": [400, 300], "seed": 1, "camera": "cam",
            "transport": {"span": "4s", "frame_rate": [60, 1]}, "items": items});
        for (k, v) in extra.as_object().into_iter().flatten() {
            doc[k] = v.clone();
        }
        doc
    }

    /// The replies to `shown`, then each step: a key, or a document shown as a revision.
    fn run(record: Value, docs: &[Value], steps: &[&str]) -> Vec<Value> {
        let full = crate::BuildSet::Full;
        let sealed = crate::assemble(full, crate::modules(full))
            .seal()
            .expect("the shipped set seals");
        let startup = crate::tests::startup_of(sealed);
        let evidence = std::env::temp_dir().join(format!(
            "deep-3236-{}-{:?}",
            std::process::id(),
            std::thread::current().id()
        ));
        let mut at = 0;
        let mut calls = Vec::new();
        let mut add = |mut c: Value, gap: i64| {
            at += gap * MS;
            c["at"] = json!(at.max(1));
            calls.push(c);
        };
        let show = |d: &Value| json!({"call": "deep_show", "session": "s", "doc": DOC, "document": d, "include": ["issues"]});
        add(show(&docs[0]), 0);
        add(json!({"call": "scope", "panel": "p1"}), 160);
        for step in steps {
            match step.strip_prefix("show ") {
                Some(k) => add(show(&docs[k.parse::<usize>().unwrap()]), 200),
                None => add(
                    json!({"call": "input", "panel": "p1", "event": {"type": "key", "key": step}}),
                    100,
                ),
            }
        }
        add(json!({"call": "see", "panel": "p1"}), 50);
        let scenario = json!({
            "evidence": evidence.to_string_lossy(),
            "sessions": {"s": {"thread": "t", "name": "Claude Code: t", "process": {"pid": 4100, "start": 1000}}},
            "processes": [{"pid": 1, "ppid": 0, "start": 0}, {"pid": 4100, "ppid": 1, "start": 1000}],
            "panels": {"p1": {"rect": [0, 0, 800, 600]}}, "docs": {DOC: {"panel": "p1"}},
            "record": record, "clock": {"refresh_hz": 120, "lead": 2 * MS, "check": MS / 2},
            "display": [1600, 900], "calls": calls,
        });
        let out = crate::answer("run", &startup, &scenario.to_string());
        let _ = std::fs::remove_dir_all(&evidence);
        assert_eq!(out["ok"], true, "{out}");
        out["replies"].as_array().cloned().unwrap_or_default()
    }

    /// The focus after each step that is a key.
    fn foci(replies: &[Value]) -> Vec<Value> {
        replies
            .iter()
            .filter(|r| r.get("serial").is_some())
            .map(|r| r["state"]["focus"].clone())
            .collect()
    }

    fn said(replies: &[Value]) -> Vec<String> {
        replies.last().expect("see")["announcements"]
            .as_array()
            .into_iter()
            .flatten()
            .map(|a| a["text"].as_str().unwrap_or("").to_string())
            .collect()
    }

    fn value<'a>(replies: &'a [Value], id: &str) -> &'a str {
        let tree = replies.last().expect("see")["tree"].as_array();
        tree.into_iter()
            .flatten()
            .find(|n| n["id"] == id)
            .and_then(|n| n["value"].as_str())
            .unwrap_or("")
    }

    #[test]
    fn home_end_and_the_arrows_walk_and_stop_at_the_ends() {
        let doc = document(
            &[set("s", "a3", &[40.0, 37.0, 33.0, 30.0], None)],
            json!({}),
        );
        let r = run(
            json!({}),
            &[doc],
            &[
                "Tab",
                "End",
                "ArrowRight",
                "ArrowLeft",
                "Home",
                "ArrowUp",
                "ArrowDown",
            ],
        );
        let want = ["s#0", "s#3", "s#3", "s#2", "s#0", "s#0", "s#1"];
        assert_eq!(foci(&r), want.map(|f| json!(f)));
        // A key that moves nothing says nothing.
        assert_eq!(said(&r).len(), 5, "{:?}", said(&r));
    }

    #[test]
    fn focus_moves_to_the_nearest_drawn_row_when_its_row_stops_drawing() {
        let before = document(
            &[set("s", "a3", &[40.0, 37.0, 33.0, 30.0, 26.0, 22.0], None)],
            json!({}),
        );
        let after = document(
            &[set(
                "s",
                "a3",
                &[40.0, 37.0, f64::NAN, 30.0, 26.0, 22.0],
                None,
            )],
            json!({}),
        );
        let steps = ["Tab", "ArrowRight", "ArrowRight", "show 1", "Shift"];
        let r = run(json!({}), &[before, after], &steps);
        // Row 2 was at (93, 128); row 3, at (120, 140), is nearer than row 1 at (67, 112).
        assert_eq!(
            *foci(&r).last().expect("a key"),
            json!("s#3"),
            "{:?}",
            foci(&r)
        );
        assert_eq!(said(&r).last().map(String::as_str), Some("x 3 m, y 30 m"));
    }

    #[test]
    fn a_set_that_draws_no_row_is_no_tab_stop() {
        let sets = [
            set("gone", "a3", &[f64::NAN, f64::NAN], None),
            set("s", "a4", &[40.0, 37.0], None),
        ];
        let r = run(json!({}), &[document(&sets, json!({}))], &["Tab", "Tab"]);
        assert_eq!(foci(&r), [json!("s#0"), Value::Null]);
    }

    #[test]
    fn a_cell_bound_to_a_reading_is_heard_as_the_reading_and_not_at_all_without_one() {
        let sets = [set("s", "a3", &[10.0, 0.0, 30.0], Some(&["a", "b", "c"]))];
        let reading = "reading:01JB3236000000000000000001";
        let doc = document(
            &sets,
            json!({"bound_values": {"b0": {"target": "items/s#b/y", "source": reading}}}),
        );
        let held = json!({reading: {"session": null, "value": 45.0, "as_of": 1}});
        let r = run(held, &[doc.clone()], &["Tab", "ArrowRight", "ArrowRight"]);
        assert_eq!(value(&r, "s"), "3 rows drawn, x m 0 to 2, y m 10 to 45");
        assert!(
            said(&r).contains(&"x 1 m, y 45 m".to_string()),
            "{:?}",
            said(&r)
        );
        // With no reading, the row doesn't draw, so it is neither counted nor landed on.
        let r = run(
            json!({reading: {"session": null}}),
            &[doc],
            &["Tab", "ArrowRight", "ArrowRight"],
        );
        assert_eq!(
            value(&r, "s"),
            "2 rows drawn, x m 0 to 2, y m 10 to 30, 1 missing"
        );
        assert!(
            !said(&r).iter().any(|t| t.contains("x 1 m")),
            "{:?}",
            said(&r)
        );
    }
}

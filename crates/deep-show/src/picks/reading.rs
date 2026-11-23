//! #3236 (Mark set, scale and encode; Control: picks on rows and grid focus): a reading focus on a
//! mark set or a series no pick control names. Its drawn rows are one Tab stop, the scope's
//! `(set, READING)`; arrows move the focus over the set's walk, Home and End to its first and last
//! stop, each landing announced by what the stop holds, with the values' units. Past 1,000 drawn
//! rows the walk is by buckets. It is viewer state: it writes no entry and picks nothing.

use deep_canvas::scope::READING;
use deep_canvas_input::rows::Move;
use deep_canvas_input::track::{Entry, Writer};
use deep_canvas_marks::data::holds::{self, Walk};
use serde_json::{json, Value};

use crate::hub::Hub;

impl Hub<'_> {
    /// The panel's shown revision with its tables inlined, as a frame reads its rows: what the
    /// tree's values and a walk are computed from.
    pub(crate) fn shown_with_tables(&self, panel: &str) -> Option<Value> {
        let (mut shown, _) = self.panel_document(panel)?;
        let _ = self.inline_tables(&mut shown);
        Some(shown)
    }

    /// `set`'s walk on the panel: each stop's ID and what it says.
    fn walk(&self, panel: &str, set: &str) -> Vec<(String, String)> {
        let walk = match self.scenario.module_planted.as_deref() {
            Some(holds::WALK_IN_ROW_ORDER) => Walk::RowOrder,
            Some(holds::WALK_ON_EVERY_ROW) => Walk::EveryRow,
            _ => Walk::Reading,
        };
        let Some(doc) = self.shown_with_tables(panel) else {
            return Vec::new();
        };
        let Some(items) = doc.get("items").and_then(Value::as_object) else {
            return Vec::new();
        };
        match items
            .get(set)
            .and_then(|item| holds::holds(set, item, items, walk))
        {
            Some(Ok((holds, stops))) => stops.iter().map(|s| (s.id(set), holds.says(s))).collect(),
            _ => Vec::new(),
        }
    }

    /// The reading focus on the stop the scope holds: a set's reading stop enters at its first
    /// stop, and a stop that stopped drawing gives way to the one now at its place, each
    /// announced; any other stop holds none.
    pub(crate) fn settle_reading(&mut self, panel: &str) {
        let set = self.scopes.get(panel).and_then(|s| match &s.scope.focus {
            Some((set, Some(o))) if o == READING => Some(set.clone()),
            _ => None,
        });
        let Some(set) = set else {
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
            .filter(|(s, _)| *s == set);
        let at = match held {
            Some((_, id)) if walk.iter().any(|(w, _)| *w == id) => return,
            _ => 0,
        };
        self.land(panel, &set, walk.get(at));
    }

    /// The focus on `stop` of `set`, announced. The planted `reading_walk_writes_entry` also
    /// appends a pick entry for its row to the document's input track: the entries appended.
    fn land(&mut self, panel: &str, set: &str, stop: Option<&(String, String)>) -> Vec<Value> {
        let now = self.now;
        if let Some(s) = self.scopes.get_mut(panel) {
            if let Some((id, text)) = stop {
                s.picks.said.push(json!({"t": now, "id": id, "text": text}));
            }
            s.picks.reading = stop.map(|(id, _)| (set.to_string(), id.clone()));
        }
        let planted = self.scenario.module_planted.as_deref() == Some(holds::WALK_WRITES_ENTRY);
        let (Some((id, _)), Some(doc), true) = (stop, self.panel_doc(panel), planted) else {
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
        let (set, here) = self.scopes.get(panel)?.picks.reading.clone()?;
        let walk = self.walk(panel, &set);
        let (Some(m), Some(at)) = (Move::of(key), walk.iter().position(|(id, _)| *id == here))
        else {
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
        Some(self.land(panel, &set, walk.get(to)))
    }
}

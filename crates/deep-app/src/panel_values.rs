//! Issue #1172: a plug-in panel's bound values in the app (Bound value in panels). A panel directory's `panel.json`
//! holds its element tree in #401's form, `{"tree": [{"id", "component": "text", "bind": {...}}]}`. Each bound element
//! draws one line above the panel's script, through the canvas's own bound-value text, from the newest reading the
//! record holds: in ink while fresh, in the look's muted role with its age once past `stale_after`, in ms. The panel
//! updates it natively: its script renders only when its structure changes.

use std::path::Path;
use std::time::Duration;

use deep_canvas_marks::scene::{bound_text, Record, Shown};
use gpui_kit::*;
use serde_json::{json, Map, Value};

use crate::{chrome, text, views};

/// Flicks in a millisecond, the bound value's clock.
const FLICKS_PER_MS: i64 = 705_600;
/// How often a shown value is read again, so one goes stale while it shows.
const TICK: Duration = Duration::from_secs(1);

/// The panel's bound elements, `(id, bind)`, in the tree's order; none without a `panel.json`.
pub fn elements(dir: &Path) -> Vec<(String, Value)> {
    let Ok(text) = std::fs::read_to_string(dir.join("panel.json")) else {
        return Vec::new();
    };
    let tree: Value = serde_json::from_str(&text).unwrap_or_default();
    tree["tree"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|element| {
            let bind = element.get("bind")?.clone();
            Some((element["id"].as_str()?.to_owned(), bind))
        })
        .collect()
}

/// A duration in ms as the canvas's time grammar writes it.
fn seconds(ms: u64) -> String {
    format!("{}.{:03}s", ms / 1000, ms % 1000)
}

/// `bind` as a frame at `now` ms draws it, from `reading`'s value and the time it is as of, in ms.
fn shown(bind: &Value, reading: Option<(f64, u64)>, now: u64) -> Option<Shown> {
    let source = bind["source"].as_str()?;
    let mut bound = Map::new();
    bound.insert("target".into(), json!("items/v/params/text"));
    bound.insert("source".into(), json!(source));
    for key in ["format", "missing"] {
        if let Some(value) = bind.get(key) {
            bound.insert(key.into(), value.clone());
        }
    }
    bound.insert(
        "stale_after".into(),
        json!(seconds(bind["stale_after"].as_u64()?)),
    );
    let mut doc = Map::new();
    doc.insert("bound_values".into(), json!({ "v": bound }));
    let mut record = Record {
        pinned: now as i64 * FLICKS_PER_MS,
        ..Record::default()
    };
    if let Some((value, as_of)) = reading {
        record.readings.insert(source.to_owned(), value);
        record
            .as_of
            .insert(source.to_owned(), as_of as i64 * FLICKS_PER_MS);
    }
    bound_text(&doc, "v", &json!({}), &record, "en").ok()?
}

/// The newest value of `source`, as the one reader holds it.
fn reading(source: &str) -> Option<(f64, u64)> {
    crate::record::with_view(|view| view.table().value(source)).flatten()
}

/// A plug-in panel's script with its bound values above it.
pub struct BoundPanel {
    script: AnyView,
    elements: Vec<(String, Value)>,
    _tick: Task<()>,
}

impl BoundPanel {
    pub fn new(script: AnyView, elements: Vec<(String, Value)>, cx: &mut Context<Self>) -> Self {
        let tick = cx.spawn(async move |this, cx| loop {
            cx.background_executor().timer(TICK).await;
            if this.update(cx, |_, cx| cx.notify()).is_err() {
                return;
            }
        });
        BoundPanel {
            script,
            elements,
            _tick: tick,
        }
    }
}

impl Render for BoundPanel {
    fn render(&mut self, window: &mut Window, _: &mut Context<Self>) -> impl IntoElement {
        let chrome = chrome::of(window);
        let now = views::now();
        let lines = self.elements.iter().filter_map(|(id, bind)| {
            let shown = shown(bind, reading(bind["source"].as_str()?), now)?;
            let color = if shown.stale {
                chrome.muted
            } else {
                chrome.ink_primary
            };
            let label = text::Label {
                bound: true,
                ..text::Label::new(shown.text)
            };
            Some(
                div()
                    .px_2()
                    .py_1()
                    .child(text::label(id, label, color, None)),
            )
        });
        div()
            .size_full()
            .flex()
            .flex_col()
            .children(lines)
            .child(div().flex_1().min_h_0().child(self.script.clone()))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn bind(stale_after: u64) -> Value {
        json!({"source": "reading:quotes", "stale_after": stale_after, "missing": "dash",
               "format": {"unit": "USD", "precision": 2, "notation": "fixed"}})
    }

    #[::core::prelude::v1::test]
    fn a_value_past_its_freshness_is_stale_with_its_age_and_one_within_it_is_neither() {
        let now = 1_800_000_000_000;
        let stale = shown(&bind(60_000), Some((182.4, now - 120_000)), now).expect("a value");
        assert!(stale.stale && stale.text.contains("182.40") && stale.text.contains("2 min"));
        let fresh = shown(&bind(3_600_000), Some((96.1, now)), now).expect("a value");
        assert!(!fresh.stale && !fresh.text.contains("min"));
    }

    #[::core::prelude::v1::test]
    fn the_tree_gives_each_bound_element_and_no_file_gives_none() {
        let dir = std::env::temp_dir().join(format!("deep-app-bound-{}", std::process::id()));
        std::fs::create_dir_all(&dir).expect("a folder");
        assert!(elements(&dir).is_empty());
        let tree = r#"{"tree": [{"id": "a", "component": "text", "bind": {"source": "reading:x"}}, {"id": "b"}]}"#;
        std::fs::write(dir.join("panel.json"), tree).expect("written");
        let found = elements(&dir);
        std::fs::remove_dir_all(&dir).expect("removed");
        assert_eq!(found.len(), 1);
        assert_eq!(found[0].0, "a");
    }
}

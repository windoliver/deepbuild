//! #169: the playable page's own files. The manifest names every state and edge, each state's
//! still, targets and accessibility tree, and each edge's control, value, clip and keys; the index
//! page carries it as escaped text beside the fixed player, which is the same bytes in every
//! export and runs no code from the document. The page's content policy lets it load only its
//! own files.

use serde_json::{json, Map, Value};

use super::list::{Axis, Listing};

/// The fixed player and its styles, shipped with DeepBuild.
pub const PLAYER_JS: &str = include_str!("../../web/page-player.js");
pub const PLAYER_CSS: &str = include_str!("../../web/page-player.css");

/// The index page's content policy: its own files only, and no request of its own.
pub const POLICY: &str = "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; media-src 'self'; connect-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'";

/// Present mode's advance keys (Marker: present mode): →, Space and Page Down.
const ADVANCE_KEYS: [&str; 3] = ["ArrowRight", " ", "PageDown"];

/// Each listed control's value by its ID, as an input entry writes it: a toggle's boolean, a
/// stage's ID or an option's name; null before any where it has no default.
pub fn values_json(axes: &[Axis], values: &[Option<usize>]) -> Value {
    let mut out = Map::new();
    for (a, v) in axes.iter().zip(values) {
        out.insert(a.id.clone(), v.map_or(Value::Null, |o| a.value(o)));
    }
    Value::Object(out)
}

/// The keys that make the change `from` → `to` on `control` (Control: `keys`, a key to a value,
/// a delta or a toggle).
fn keys_of(control: &Value, axis: &Axis, from: Option<usize>, to: usize) -> Vec<String> {
    let mut out = Vec::new();
    for (key, spec) in control["keys"].as_object().into_iter().flatten() {
        let hit = match spec {
            Value::String(s) if s == "toggle" => axis.kind == "toggle" && from != Some(to),
            Value::Number(d) => d
                .as_i64()
                .zip(from)
                .is_some_and(|(d, f)| f as i64 + d == to as i64),
            v => axis.value(to) == *v || v.as_str() == Some(axis.names[to].as_str()),
        };
        if hit {
            out.push(key.clone());
        }
    }
    out
}

/// The manifest: the page's controls, states and edges, each state's targets tied to the edge
/// each plays, and each edge's keys. `states` and `edges` are the rendered entries, in the
/// listing's order.
pub fn manifest(
    doc: &Value,
    listing: &Listing,
    mut states: Vec<Value>,
    mut edges: Vec<Value>,
    bound: Vec<Value>,
) -> Value {
    let controls: Vec<Value> = (listing.axes.iter())
        .map(|a| {
            let c = &doc["controls"][&a.id];
            let options: Vec<Value> = (0..a.names.len())
                .map(|o| json!({"name": a.names[o], "value": a.value(o), "label": option_label(doc, c, &a.names[o])}))
                .collect();
            json!({"id": a.id, "kind": a.kind, "label": c["label"], "options": options})
        })
        .collect();
    for (k, e) in listing.edges.iter().enumerate() {
        let from = &listing.states[e.from].key.values;
        let keys: Vec<String> = match &e.control {
            None => ADVANCE_KEYS.iter().map(|k| k.to_string()).collect(),
            Some(id) => {
                let i = listing.axes.iter().position(|a| a.id == *id);
                let to = i.and_then(|i| {
                    (0..listing.axes[i].names.len()).find(|&o| listing.axes[i].value(o) == e.value)
                });
                match (i, to) {
                    (Some(i), Some(to)) => {
                        keys_of(&doc["controls"][id], &listing.axes[i], from[i], to)
                    }
                    _ => Vec::new(),
                }
            }
        };
        edges[k]["keys"] = json!(keys);
    }
    for (k, s) in states.iter_mut().enumerate() {
        let mine: Vec<usize> = (0..listing.edges.len())
            .filter(|&i| listing.edges[i].from == k)
            .collect();
        for t in s["targets"].as_array_mut().into_iter().flatten() {
            let edge = mine.iter().find(|&&i| {
                let e = &listing.edges[i];
                let axis = listing
                    .axes
                    .iter()
                    .find(|a| Some(&a.id) == e.control.as_ref());
                let option = axis.and_then(|a| (0..a.names.len()).find(|&o| a.value(o) == e.value));
                e.control.as_deref() == t["control"].as_str()
                    && axis
                        .zip(option)
                        .is_some_and(|(a, o)| t["option"] == a.names[o].as_str())
            });
            t["edge"] = edge.map_or(Value::Null, |i| json!(format!("e{i}")));
        }
        s["edges"] = json!(mine.iter().map(|i| format!("e{i}")).collect::<Vec<_>>());
    }
    json!({
        "page": 1,
        "doc": doc["id"],
        "title": doc["title"],
        "start": "s0",
        "controls": controls,
        "control_ids": doc["controls"].as_object().map_or(Vec::new(), |c| c.keys().cloned().collect()),
        "states": states,
        "edges": edges,
        "bound": bound,
        "warnings": listing.warnings,
    })
}

/// An option's label: its stage's, its variant option's or its option's `label`, else its name.
fn option_label(doc: &Value, control: &Value, name: &str) -> String {
    let named = |list: &Value| -> Option<String> {
        let o = match list {
            Value::Array(a) => a.iter().find(|o| o["name"] == name || o["id"] == name)?,
            Value::Object(m) => m.get(name)?,
            _ => return None,
        };
        o["label"].as_str().map(str::to_string)
    };
    let set = control["variant"]
        .as_str()
        .map(|s| &doc["variants"][s]["options"]);
    set.and_then(named)
        .or_else(|| named(&control["stages"]))
        .or_else(|| named(&control["options"]))
        .unwrap_or_else(|| name.to_string())
}

/// `text` escaped for HTML text and attribute values.
pub fn escape(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    for c in text.chars() {
        match c {
            '&' => out.push_str("&amp;"),
            '<' => out.push_str("&lt;"),
            '>' => out.push_str("&gt;"),
            '"' => out.push_str("&quot;"),
            '\'' => out.push_str("&#39;"),
            c => out.push(c),
        }
    }
    out
}

/// The index page: its content policy, the title, the player's styles and script, and the
/// manifest as escaped text in a template the player reads and never runs (so the page also
/// opens from a file, where a request for `manifest.json` is refused). `<html>` names no state
/// until the player shows one, so a reader that waits for `data-deep-state` finds the page built.
pub fn index_html(doc: &Value, manifest: &Value) -> String {
    let title = escape(doc["title"].as_str().unwrap_or("DeepBuild piece"));
    let data = escape(&manifest.to_string());
    format!(
        "<!doctype html>\n<html lang=\"en\">\n<head>\n<meta charset=\"utf-8\">\n\
         <meta http-equiv=\"Content-Security-Policy\" content=\"{POLICY}\">\n\
         <meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">\n\
         <title>{title}</title>\n<link rel=\"stylesheet\" href=\"player/player.css\">\n</head>\n<body>\n\
         <main id=\"page\"></main>\n<template id=\"deep-manifest\">{data}</template>\n\
         <script src=\"player/player.js\"></script>\n</body>\n</html>\n"
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn no_text_of_the_document_can_close_the_manifest_or_open_markup() {
        let doc = json!({"title": "A </template><script>x()</script> & <b>"});
        let manifest = json!({"start": "s0", "title": doc["title"]});
        let page = index_html(&doc, &manifest);
        assert_eq!(page.matches("<script").count(), 1, "{page}");
        assert_eq!(page.matches("</template>").count(), 1, "{page}");
    }
}

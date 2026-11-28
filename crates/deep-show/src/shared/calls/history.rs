use deep_canvas::show::Writer;
use serde_json::{json, Value};

use crate::hub::Hub;
use crate::shared::writer_of_text;

impl Hub<'_> {
    pub fn history(&self, doc: &str, item: &str) -> Value {
        let rows: Vec<Value> = self
            .shared
            .get(doc)
            .into_iter()
            .flat_map(|s| s.revs.iter())
            .filter(|r| r.changed.contains(item))
            .map(|r| {
                let writer = r.writer.as_ref().map(Writer::to_json);
                json!({"rev": r.rev, "patch": r.patch, "writer": writer, "reason": r.reason})
            })
            .collect();
        json!({"history": rows})
    }

    pub fn by_writer(&self, doc: &str) -> Value {
        let (Some(k), Some(shared)) = (self.shown(doc), self.shared.get(doc)) else {
            return json!({"writers": []});
        };
        let (shown, _) = shared.at(k);
        let mut rows = Vec::new();
        for (layer, entry) in shown["layers"].as_object().into_iter().flatten() {
            let Some(writer) = entry["writer"].as_str().and_then(writer_of_text) else {
                continue;
            };
            let mut items: Vec<&String> = shown["items"]
                .as_object()
                .into_iter()
                .flatten()
                .filter(|(_, i)| i["layer"].as_str() == Some(layer.as_str()))
                .map(|(id, _)| id)
                .collect();
            items.sort();
            let patches: Vec<&String> = shared.revs[..=k]
                .iter()
                .filter(|r| r.writer.as_ref() == Some(&writer))
                .filter_map(|r| r.patch.as_ref())
                .collect();
            rows.push(json!({"writer": writer.to_json(), "layer": layer, "items": items, "patches": patches}));
        }
        json!({"writers": rows})
    }

    pub fn shared_revisions(&self, doc: &str) -> Value {
        let shared = &self.shared[doc];
        if shared.doc.get("source").is_some() {
            return json!({"revisions": []});
        }
        let last = shared.current().rev;
        let rows: Vec<Value> = shared
            .revs
            .iter()
            .enumerate()
            .map(|(k, r)| {
                json!({
                    "rev": r.rev,
                    "base_rev": r.base_rev,
                    "writer": r.writer.as_ref().map(Writer::to_json),
                    "hash": shared.hash(k, &self.startup.sealed),
                    "state": if r.rev == last { "current" } else { "superseded" },
                    "patches": r.patch.iter().collect::<Vec<_>>(),
                })
            })
            .collect();
        json!({"revisions": rows})
    }
}

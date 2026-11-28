use std::borrow::Cow;

use deep_canvas::show::{Band, Writer, WriterKind};
use serde_json::{json, Value};

use super::Hub;
use crate::shared;

pub struct BandRow {
    pub doc: Option<String>,
    pub band: Band,
    pub layer: String,
    pub owner: Writer,
    pub outline: bool,
    pub name: Option<String>,
}

impl BandRow {
    pub fn to_json(&self) -> Value {
        let owner = match self.band {
            Band::Card => json!({"kind": "shell"}),
            _ => self.owner.to_json(),
        };
        json!({
            "layer": self.layer,
            "owner": owner,
            "band": self.band.name(),
            "outline": self.outline,
            "name": self.name,
        })
    }
}

impl Hub<'_> {
    pub fn bands(&self) -> Vec<BandRow> {
        let mut rows = Vec::new();
        for (doc, panel) in &self.scenario.docs {
            if !self.panel_visible(panel) {
                continue;
            }
            let shown = match self.shown(doc) {
                Some(k) => Some(self.shared[doc].at(k).0),
                None => self.current(doc).map(|r| Cow::Borrowed(&r.doc)),
            };
            let layers = shown.as_ref().and_then(|d| d["layers"].as_object());
            for (layer, entry) in layers.into_iter().flatten() {
                let Some(owner) = entry["writer"].as_str().and_then(shared::writer_of_text) else {
                    continue;
                };
                rows.push(BandRow {
                    doc: Some(doc.clone()),
                    band: owner.band(),
                    layer: layer.clone(),
                    outline: owner.outlined(),
                    name: self.agent_name(&owner),
                    owner,
                });
            }
        }
        rows.sort_by(|a, b| a.band.cmp(&b.band).then_with(|| a.doc.cmp(&b.doc)));
        if self.card_slot().is_some() {
            rows.push(BandRow {
                doc: None,
                band: Band::Card,
                layer: "card".into(),
                owner: Writer {
                    kind: WriterKind::Shell,
                    id: "shell".into(),
                },
                outline: false,
                name: None,
            });
        }
        rows
    }
}

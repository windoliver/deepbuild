//! The #499 module acceptance README's test canvas module `test.probe` (its blind redraft,
//! tests/acceptance/499/module/redraft/REDRAFT.md): one kind, `test.probe@1 {box, asset}`, whose
//! asset (named in the document's `assets`) the core has the decode worker probe, the trusted
//! ring's, with no media module; its operator reads the probe kept on the asset into the arrays
//! `test.probe.sample_rate` (Hz) and `test.probe.duration` (flicks). Its planted twin calls
//! through the media module (depends on it), so a build without media refuses it at the seal.

use deep_canvas::registry::{Module, Registrar};
use deep_canvas::schedule::Val;
use serde_json::Value;

use super::{box_param, json_param, kind, manifest, of_kind};

const FLICKS: i128 = 705_600_000;

fn register(r: &mut Registrar) {
    r.kind(kind("test", "probe", vec![box_param(), json_param("asset")]), &[], "rect@1")
        .probes("asset");
    r.array("test.probe.sample_rate", "i64", "document", "items", "items");
    r.array("test.probe.duration", "i64", "document", "items", "items");
    r.operator("probe", "items", &["refs"], &["test.probe.sample_rate", "test.probe.duration"])
        .document()
        .applies(|doc, _, _| {
            doc["items"].as_object().is_some_and(|i| i.values().any(|x| of_kind(x, "test.probe@1")))
        })
        .run(|v| {
            let doc = v.document()?;
            let items = doc["items"].as_object().into_iter().flatten();
            let asset = items
                .map(|(_, x)| x)
                .find(|x| of_kind(x, "test.probe@1"))
                .and_then(|x| x.pointer("/params/asset").and_then(Value::as_str))
                .unwrap_or_default();
            let stream = doc.pointer(&format!("/assets/{asset}/probe/streams/0")).cloned().unwrap_or(Value::Null);
            let rate = stream["sample_rate"].as_i64().unwrap_or(0);
            let (n, d) = (stream["duration"][0].as_i64().unwrap_or(0), stream["duration"][1].as_i64().unwrap_or(1).max(1));
            v.write("test.probe.sample_rate", Val::typed(rate))?;
            v.write("test.probe.duration", Val::typed((n as i128 * FLICKS / d as i128) as i64))
        });
}

/// `test.probe`; with `via_media`, the planted one that calls through the media module.
pub fn module(via_media: bool) -> Module {
    let deps: &[(&str, bool)] = if via_media { &[("media", false)] } else { &[] };
    Module {
        manifest: manifest("test.probe", deps),
        register,
    }
}

//! #1164: the `track` call: a document's input track as the hub holds it, with its hash and its
//! `fork_at` (Input track), and a recorded track loaded whole, which is how a fresh process
//! replays a recording.

use deep_canvas_input::track::{Entry, Sample, Track, Writer};
use serde_json::{json, Value};

use crate::hub::Hub;

impl Hub<'_> {
    /// `doc`'s input track, its hash and its fork; with `load`, the track becomes exactly those
    /// entries first, in their order, and the document replays on it.
    pub(crate) fn track_call(&mut self, doc: &str, load: Option<&[Value]>) -> Value {
        if !self.forms.contains_key(doc) {
            return json!({"code": "no_revision"});
        }
        if let Some(entries) = load {
            let Some(parsed) = entries.iter().map(entry_of).collect::<Option<Vec<_>>>() else {
                return json!({"code": "bad_input", "what": "load: each entry is {t, control, value, writer} as the track call gives it"});
            };
            let mut track = Track::default();
            for e in parsed {
                track.append(e);
            }
            self.tracks.insert(doc.to_string(), track);
            let now = self.now;
            self.replay(doc, now);
        }
        let held = self.tracks.get(doc).cloned().unwrap_or_default();
        json!({"track": self.track_json(doc), "hash": held.hash(), "fork_at": held.fork_at})
    }
}

/// An entry in the form [`Entry::to_json`] writes; `seq` is the track's to give again.
fn entry_of(v: &Value) -> Option<Entry> {
    let (control, value) = match v.get("present") {
        Some(p) => (String::new(), p.clone()),
        None => (v.get("control")?.as_str()?.to_string(), v.get("value")?.clone()),
    };
    let pair = |p: Option<&Value>| -> Option<Option<[f64; 2]>> {
        match p {
            None => Some(None),
            Some(p) => Some(Some([p.get(0)?.as_f64()?, p.get(1)?.as_f64()?])),
        }
    };
    let samples = match v.get("samples") {
        None => None,
        Some(s) => Some(
            s.as_array()?
                .iter()
                .map(|s| {
                    Some(Sample {
                        t: s.get("t")?.as_i64()?,
                        value: s.get("value")?.clone(),
                        at: pair(s.get("at"))?,
                        px: pair(s.get("px"))?,
                    })
                })
                .collect::<Option<Vec<_>>>()?,
        ),
    };
    Some(Entry {
        t: v.get("t")?.as_i64()?,
        seq: 0,
        control,
        value,
        samples,
        writer: match v.get("writer")?.as_str()? {
            "you" => Writer::You,
            "tour" => Writer::Tour,
            "agent" => Writer::Agent,
            _ => return None,
        },
        serial: match v.get("serial") {
            None => None,
            Some(s) => Some(u32::try_from(s.as_u64()?).ok()?),
        },
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn an_entry_reads_back_as_the_track_wrote_it() {
        let e = Entry {
            t: 705_600_000,
            seq: 0,
            control: "c1".into(),
            value: json!(1),
            samples: None,
            writer: Writer::You,
            serial: Some(4),
        };
        assert_eq!(entry_of(&e.to_json()), Some(e));
        assert_eq!(entry_of(&json!({"t": 1, "control": "c1", "value": 1, "writer": "nobody"})), None);
    }
}

//! Issue #501: the film viewer in a panel (canvas primitives: Transport: film viewer). A key in a
//! panel showing a film goes to that panel's viewer after the ring routes it and before the
//! scope; `viewer` reads the frame it shows, hashed as the export hashes its frames; `play` with
//! `presented` lists what each vsync shows; and the keymap names each viewer key a control holds.

use std::collections::BTreeMap;

use deep_canvas::document::frame_rate_of;
use deep_canvas::schedule::{Scheduler, Session as DocSession};
use deep_canvas::scope::Event;
use deep_canvas::time::{film_time, frame_length};
use deep_canvas_media::viewer::{Change, Film, Mods, Viewer, KEYS};
use deep_canvas_motion::doc::read as read_motion;
use serde_json::{json, Value};

use crate::export::hex;
use crate::hub::{Hub, Planted};
use crate::refused;

/// A panel's film viewer: its keys' state, and the film time it is paused at (`None` while it
/// plays). It opens paused at the film's start.
pub struct FilmViewer {
    viewer: Viewer,
    paused: Option<i64>,
}

/// A film document's transport as the viewer reads it, in flicks.
struct FilmOf {
    start: i64,
    span: i64,
    frame: i64,
    sections: Vec<i64>,
}

impl FilmOf {
    fn film(&self) -> Film<'_> {
        Film {
            start: self.start,
            span: self.span,
            frame: self.frame,
            sections: &self.sections,
        }
    }
}

/// A `film` profile document's start, span, frame and section markers' starts; `None` for any
/// other document.
fn film_of(doc: &Value) -> Option<FilmOf> {
    if doc.get("profile")?.as_str()? != "film" {
        return None;
    }
    let (p, q) = doc
        .get("transport")
        .and_then(frame_rate_of)
        .unwrap_or((60, 1));
    let motion = read_motion(doc.as_object()?).ok()?;
    Some(FilmOf {
        start: motion.transport.start,
        span: motion.transport.span?,
        frame: frame_length(p, q).ok()?,
        sections: motion
            .markers
            .iter()
            .filter(|m| m.kind == "section")
            .map(|m| m.start)
            .collect(),
    })
}

impl FilmViewer {
    fn new(film: &FilmOf) -> FilmViewer {
        FilmViewer {
            viewer: Viewer::new(),
            paused: Some(film.start),
        }
    }

    /// The film frame on screen at host time `now`.
    fn shown(&self, now: i64, film: &FilmOf) -> i64 {
        let t = self.paused.unwrap_or_else(|| self.viewer.position(now));
        film_time(
            t.clamp(film.start, film.start + film.span - 1),
            film.start,
            film.frame,
        )
    }
}

impl Hub<'_> {
    /// A key in a panel showing a film, as its viewer takes it; `None` leaves it to the scope.
    pub(crate) fn viewer_key(&mut self, panel: &str, event: &Event, serial: u64) -> Option<Value> {
        let Event::Key { key, cmd, alt } = event else {
            return None;
        };
        let film = film_of(&self.panel_document(panel)?.0)?;
        let now = self.now;
        let v = self
            .scopes
            .get_mut(panel)?
            .viewer
            .get_or_insert_with(|| FilmViewer::new(&film));
        let mods = Mods {
            alt: *alt,
            cmd: *cmd,
        };
        match v.viewer.key(key, mods, now, v.paused, &film.film())? {
            Change::Seek(t) if v.paused.is_some() => v.paused = Some(t),
            Change::Play => v.paused = None,
            Change::Pause(t) => v.paused = Some(t),
            _ => {}
        }
        let t = v.shown(now, &film);
        Some(
            json!({"serial": serial, "viewer": {"paused": v.paused.is_some(), "frame": (t - film.start) / film.frame, "t": t}}),
        )
    }

    /// `viewer`: what the panel's film viewer shows: paused or not, the frame from the film's
    /// start, its time and the BLAKE3 of its BGRA8 rows, as the export hashes that frame.
    pub fn viewer_reply(&mut self, panel: &str) -> Value {
        if let Err(e) = self.panel_scope(panel) {
            return e;
        }
        let Some((mut doc, _)) = self.panel_document(panel) else {
            return refused("not_presented");
        };
        let Some(film) = film_of(&doc) else {
            return refused("not_a_film");
        };
        let now = self.now;
        let Some(s) = self.scopes.get_mut(panel) else {
            return refused("unknown_panel");
        };
        let v = s.viewer.get_or_insert_with(|| FilmViewer::new(&film));
        let (paused, t) = (v.paused.is_some(), v.shown(now, &film));
        let _ = self.inline_tables(&mut doc);
        let _ = self.inline_vectors(&mut doc);
        match self.frame_hashes(&doc, &[t]) {
            Ok(h) => {
                json!({"viewer": {"paused": paused, "frame": (t - film.start) / film.frame, "t": t, "hash": h[0]}})
            }
            Err(e) => e,
        }
    }

    /// `play`'s `presented`: each vsync `display` apart from 0 to `to`, the time it evaluates (a
    /// film's own frame, any other document's display time) and the BLAKE3 of the frame shown.
    /// Each distinct frame is drawn once.
    pub(crate) fn presented_frames(
        &mut self,
        doc: &Value,
        display: i64,
        to: i64,
    ) -> Result<Value, Value> {
        let film = film_of(doc);
        let ats: Vec<i64> = (0..)
            .map_while(|k: i64| k.checked_mul(display))
            .take_while(|t| *t <= to)
            .collect();
        let shown: Vec<i64> = ats
            .iter()
            .map(|&at| {
                film.as_ref()
                    .map_or(at, |f| film_time(at, f.start, f.frame))
            })
            .collect();
        let mut times = shown.clone();
        times.dedup();
        let hashes = self.frame_hashes(doc, &times)?;
        let by: BTreeMap<i64, &String> = times.iter().copied().zip(&hashes).collect();
        Ok(ats
            .iter()
            .zip(&shown)
            .map(|(at, t)| json!({"at": at, "t": t, "hash": by[t]}))
            .collect())
    }

    /// The export frames at `times` (ascending) from a fresh scheduler and session, each hashed
    /// with BLAKE3 on the GPU as the export hashes its frames.
    fn frame_hashes(&mut self, doc: &Value, times: &[i64]) -> Result<Vec<String>, Value> {
        let mut sched = Scheduler::new(&self.startup.sealed, self.options());
        let mut session: DocSession = self.new_session();
        session.load(&mut sched, doc);
        let gpu = self
            .gpu3()
            .map(|g| g.device().clone())
            .ok_or_else(|| json!({"code": "gpu_unavailable"}))?;
        let planted = deep_gpu::blake3::Planted {
            joins_right_left: self.scenario.planted == Some(Planted::ChunkTreeWrongOrder),
        };
        let hasher = deep_gpu::blake3::Blake3::new(&gpu.device, planted);
        let mut frames: Option<deep_gpu::blake3::Frames> = None;
        let mut out = Vec::with_capacity(times.len());
        for &t in times {
            let (mut px, size) = self
                .export_frame(&mut sched, &mut session, doc, t, None, true)
                .map_err(|u| json!({"code": u.code, "path": u.path}))?;
            for p in px.as_chunks_mut::<4>().0 {
                p.swap(0, 2);
            }
            let f = frames.get_or_insert_with(|| {
                hasher.frames(
                    &gpu.device,
                    &gpu.queue,
                    [u32::from(size[0]), u32::from(size[1])],
                )
            });
            out.extend(f.push(&px));
        }
        out.extend(frames.as_mut().and_then(deep_gpu::blake3::Frames::finish));
        Ok(out.iter().map(hex).collect())
    }

    /// The keymap check's film-viewer conflicts: each viewer key a control of a film document
    /// holds, as `{chord, context: "film_viewer", control, doc}`.
    pub(crate) fn viewer_conflicts(&self) -> Vec<Value> {
        let mut out = Vec::new();
        for id in self.scenario.docs.keys() {
            let Some(doc) = self.current(id).map(|r| &r.doc) else {
                continue;
            };
            if film_of(doc).is_none() {
                continue;
            }
            let rate = doc
                .get("transport")
                .and_then(frame_rate_of)
                .unwrap_or((60, 1));
            let size = doc
                .get("size")
                .and_then(crate::input::point)
                .unwrap_or([640.0, 360.0]);
            let planted = deep_canvas_input::session::Planted::default();
            let Ok(s) =
                deep_canvas_input::session::Session::new(doc, size, rate, false, planted, &[])
            else {
                continue;
            };
            for &(key, modifier, _, _) in KEYS {
                let mods: &[&str] = if modifier.is_empty() {
                    &[]
                } else {
                    &[modifier]
                };
                let name = if key == " " {
                    "space".to_string()
                } else {
                    key.to_lowercase()
                };
                let chord = if modifier.is_empty() {
                    name
                } else {
                    format!("{modifier}+{name}")
                };
                for control in s.holders(key, mods) {
                    out.push(json!({"chord": chord, "context": "film_viewer", "control": control, "doc": id}));
                }
            }
        }
        out
    }
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    /// The never-rule on keys: a film whose toggle holds M and whose slider holds the arrows has
    /// the keymap check name each of those viewer keys, and no key a control doesn't hold.
    #[test]
    fn the_keymap_names_each_viewer_key_a_film_control_holds() {
        // Sealed without `seal()`, whose runs another test counts.
        let full = crate::BuildSet::Full;
        let sealed = crate::assemble(full, crate::modules(full)).seal().expect("the shipped set seals");
        let startup = crate::tests::startup_of(sealed);
        let doc = "01JB501V00000000000000000A";
        let film = json!({
            "format": 1, "profile": "film", "title": "Viewer keys", "description": "A film whose controls hold viewer keys.",
            "size": [640, 360], "transport": {"span": "2s", "frame_rate": [24, 1]},
            "controls": {
                "gain": {"kind": "slider", "class": "document", "label": "Gain", "role": "slider", "range": [0, 1], "default": 0.5},
                "sound": {"kind": "toggle", "class": "document", "label": "Sound", "role": "switch", "keys": {"m": "toggle"}},
            },
            "items": {"box": {"id": "box", "kind": "rect@1", "name": "Box", "order": "a0", "params": {"box": [0, 0, 20, 20]}}},
        });
        let evidence =
            std::env::temp_dir().join(format!("deep-501-viewer-keys-{}", std::process::id()));
        let scenario = json!({
            "evidence": evidence.to_string_lossy(), "sessions": {},
            "processes": [{"pid": 1, "ppid": 0, "start": 0}, {"pid": 3002, "ppid": 1, "start": 3000}],
            "panels": {"main": {"rect": [0, 0, 1280, 720]}}, "docs": {doc: {"panel": "main"}},
            "calls": [
                {"call": "deep show", "peer": {"pid": 3002, "start": 3000}, "doc": doc, "document": film},
                {"call": "keymap"},
            ],
        });
        let out = crate::answer("run", &startup, &scenario.to_string());
        let _ = std::fs::remove_dir_all(&evidence);
        assert_eq!(out["replies"][0]["outcome"], json!("presented"), "{out}");
        let mut named: Vec<(String, String)> = out["replies"][1]["conflicts"]
            .as_array()
            .expect("conflicts")
            .iter()
            .filter(|c| c["context"] == "film_viewer")
            .map(|c| {
                (
                    c["chord"].as_str().unwrap().to_string(),
                    c["control"].as_str().unwrap().to_string(),
                )
            })
            .collect();
        named.sort();
        let want = |c: &str, k: &str| (c.to_string(), k.to_string());
        assert!(named.contains(&want("m", "sound")), "{named:?}");
        assert!(named.contains(&want("arrowright", "gain")), "{named:?}");
        assert!(named.contains(&want("alt+arrowright", "gain")), "{named:?}");
        assert!(
            !named.iter().any(|(c, _)| c == "j" || c == "f"),
            "{named:?}"
        );
    }
}

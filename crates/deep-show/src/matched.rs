//! #552: each copy of a match as its own player sees and hears it (canvas primitives: Net: this
//! copy's player). A copy draws the piece from its own recorded track through its own `match.me`,
//! a view value like the camera that never enters its state: so its frame, its pick tests and its
//! accessibility tree hold only what its player sees, and the readers of an item's occurrences on
//! this copy (bursts and Spawn's voices among them) read only those its player's fog grid shows.
//! `match`'s `views` and each copy's `effects` read it here; `on_panel` puts one copy on its
//! document's panel.

use std::collections::BTreeMap;
use std::rc::Rc;

use deep_canvas::grammar::FLICKS_PER_SECOND;
use deep_canvas_effects::particles::bursts::{self, IGNORES_FOG};
use deep_canvas_scene3d::{slots, tints};
use deep_net::Stepper;
use serde_json::{json, Value};

use crate::hub::Hub;
use crate::probe::Probes;

/// A copy's view a `match` call asks for: its player, the match step it stood at and the panel
/// points its pick tests probe.
#[derive(Clone)]
pub struct ViewAsk {
    pub player: u8,
    pub step: i64,
    pub probes: Vec<[u32; 2]>,
}

/// `views: [{player, step, probes?: [[x, y]]}]`.
pub fn views_of(v: &Value) -> Option<Vec<ViewAsk>> {
    v.as_array()?
        .iter()
        .map(|a| {
            let probes = match a.get("probes") {
                None => Vec::new(),
                Some(p) => p
                    .as_array()?
                    .iter()
                    .map(|q| {
                        let q = q.as_array()?;
                        Some([q.first()?.as_f64()? as u32, q.get(1)?.as_f64()? as u32])
                    })
                    .collect::<Option<_>>()?,
            };
            Some(ViewAsk {
                player: a.get("player")?.as_u64().filter(|p| (1..=8).contains(p))? as u8,
                step: a.get("step")?.as_i64().filter(|s| *s >= 0)?,
                probes,
            })
        })
        .collect()
}

/// The wrong programs a copy's drawn form hands its readers: scene3d's `seen` column and fog
/// overlay that read player 1's bits on every copy, and the burst that ignores the fog gate.
const DRAWN_PLANTS: [&str; 3] = [slots::SEEN_PLAYER_ONE, tints::PLAYER_ONE, IGNORES_FOG];

impl Hub<'_> {
    /// `doc`'s drawn form as the copy of player `me` (1 to 8, or "none" for every side) shows it:
    /// its logic baked again on `track`, its occurrences gated by `me`'s fog, and `me` its
    /// `match.me`, a view value its frames, picks and accessibility tree read.
    pub(crate) fn copy_form(
        &mut self,
        doc: &str,
        track: &[Value],
        me: &Value,
    ) -> Result<Value, Value> {
        let mut form = self
            .forms
            .get(doc)
            .cloned()
            .ok_or_else(|| json!({"code": "no_revision"}))?;
        form["match.me"] = me.clone();
        if let Some(p) = self
            .scenario
            .module_planted
            .clone()
            .filter(|p| DRAWN_PLANTS.contains(&p.as_str()))
        {
            form["planted"] = json!(p);
        }
        self.inline_occurrences(&mut form, track)
            .map_err(|i| json!({"code": i.code, "issues": [i.to_json()]}))?;
        let _ = self.column_view(&mut form, 0);
        Ok(form)
    }

    /// Each asked copy's view after its match step: `{player, step, me, snapshot, hits, tree}`,
    /// its frame a PNG in the evidence store, drawn from that copy's record. `tracks` holds each
    /// copy's merged track, by player; `len` is one match step in flicks.
    pub(crate) fn copy_views(
        &mut self,
        doc: &str,
        asks: &[ViewAsk],
        tracks: &BTreeMap<u8, Vec<Value>>,
        len: i64,
    ) -> Result<Vec<Value>, Value> {
        let Some(session) = self.scenario.sessions.keys().next().cloned() else {
            return Err(
                json!({"code": "render_unavailable", "why": "no session to draw a view for"}),
            );
        };
        let rev = self
            .rev_at(doc, i64::MAX)
            .ok_or_else(|| json!({"code": "no_revision"}))?;
        let mut out = Vec::new();
        for a in asks {
            let track = tracks.get(&a.player).cloned().unwrap_or_default();
            let form = self.copy_form(doc, &track, &json!(a.player))?;
            let t = a.step * len;
            if !crate::probe::draws_3d(&form) {
                return Err(
                    json!({"code": "unsupported", "what": "a copy's view draws a 3D piece"}),
                );
            }
            let probes = Probes {
                camera: None,
                at: a.probes.clone(),
                views: Vec::new(),
            };
            // The copy's own view, as its panel shows it to its player, not an agent's read of
            // another writer's layer: every item it draws is its to hit.
            let mut own = form.clone();
            if let Some(o) = own.as_object_mut() {
                o.remove("layers");
            }
            let drawn = self.render_back_3d(&session, rev, &own, t, None, &probes);
            let Some(sha) = drawn.pointer("/snapshots/0/sha256").cloned() else {
                return Err(json!({"code": "render_unavailable", "why": drawn}));
            };
            let mut view = json!({"player": a.player, "step": a.step, "me": form["match.me"],
                                  "snapshot": sha, "tree": copy_tree(&form, t)});
            if !a.probes.is_empty() {
                view["hits"] = drawn["hits"].clone();
            }
            out.push(view);
        }
        Ok(out)
    }

    /// Every burst and voice the copy's readers make from an occurrence, as `{reader, made, step,
    /// kind, a, b}`: each `particles@1` of `doc` whose emitter reads a list, and each spawn, over
    /// `form`, the copy's drawn form, whose lists hold only the occurrences its player sees.
    pub(crate) fn copy_effects(&mut self, doc: &str, form: &Value) -> Vec<Value> {
        let row = |list: &str, r: &Value, reader: &str, made: &str| {
            json!({"reader": reader, "made": made, "list": list, "step": r["step"], "kind": r["kind"],
                   "a": r["a"], "b": r["b"]})
        };
        let mut out = Vec::new();
        // The bursts as the document writes them: a build whose drawn form skips the kind still
        // reads the lists they read.
        let written = self
            .current(doc)
            .map(|r| r.doc.clone())
            .unwrap_or_else(|| form.clone());
        for (id, item) in written["items"].as_object().into_iter().flatten() {
            let on = &item["params"]["emit"]["on"];
            let (Some("particles@1"), Some(list)) = (item["kind"].as_str(), on["list"].as_str())
            else {
                continue;
            };
            let Ok(events) = bursts::from_list(id, on, form) else {
                continue;
            };
            // Each burst at its row's time: the rows the burst read, gated or (planted) not.
            let mut rows: Vec<&Value> = form["occurrences"][list]
                .as_array()
                .into_iter()
                .flatten()
                .collect();
            if form["planted"] == IGNORES_FOG {
                rows.extend(form["fogged"][list].as_array().into_iter().flatten());
            }
            for e in events {
                let at =
                    |r: &Value| r["t"].as_f64().unwrap_or(0.0) / FLICKS_PER_SECOND as f64 == e.t;
                if let Some(r) = rows.iter().find(|r| at(r)) {
                    out.push(row(list, r, id, "burst"));
                }
            }
        }
        let planted = self.scenario.module_planted.clone();
        let voices = Hub::voices(form, 0, planted.as_deref(), &mut |sha| self.source(sha));
        if let Ok((_, voices)) = voices {
            for v in voices {
                let spawn = v["spawn"].as_str().unwrap_or_default();
                let list = form["spawns"][spawn]["on"]["list"]
                    .as_str()
                    .unwrap_or_default();
                let k = v["occurrence"].as_u64().unwrap_or(0) as usize;
                if let Some(r) = form["occurrences"][list].get(k) {
                    out.push(row(list, r, spawn, "voice"));
                }
            }
        }
        out
    }
}

/// The copy's accessibility tree at `t`: the panel's, as `see` gives it, and each element an
/// instancer fed by logic draws for this copy, by its element ID, so an element its player
/// doesn't see is never announced.
fn copy_tree(form: &Value, t: i64) -> Vec<Value> {
    let mut tree = crate::access::tree(form, &[]);
    let planted = form["planted"].as_str();
    for (id, item) in form["items"].as_object().into_iter().flatten() {
        if item["kind"] != "instance@1" {
            continue;
        }
        let Ok(Some(Value::Array(elements))) =
            slots::reading(form, t, (id, "elements"), None, planted)
        else {
            continue;
        };
        let name = item["name"].as_str().unwrap_or(id);
        for e in elements {
            tree.push(
                json!({"id": e["id"], "role": "img", "name": format!("{name} {}", e["slot"])}),
            );
        }
    }
    tree
}

/// #552: the full-state hash every `hash_every` match steps a copy of `doc`'s match takes, of its
/// logic items (and, #551, its worlds) stepped on `track` through `steps` match steps, as `logic`
/// replays a record: the copies' own stepper, so a replay compares with the match.
pub(crate) fn replay_hashes(
    piece: Rc<deep_logic::piece::Piece>,
    (doc, track): (&Value, &[Value]),
    cfg: &deep_net::Config,
    steps: i64,
) -> Result<Vec<Value>, Value> {
    let mut sim = deep_play::net::Logic::new(piece, track, false)?;
    sim.worlds(doc)?;
    let len = cfg.step();
    let mut out = Vec::new();
    for k in 0..steps {
        if sim.run(k, (k + 1) * len).is_err() {
            break;
        }
        if k % cfg.hash_every == 0 {
            out.push(json!({"step": k, "hash": format!("{:016x}", sim.hash())}));
        }
    }
    Ok(out)
}

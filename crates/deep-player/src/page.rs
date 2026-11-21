//! The player's surface to its index page: one `Player` per page, on the page's one thread. The
//! page fetches every file the bundle names and checks it against its SHA-256 before it hands it
//! here; nothing here reaches the network, a store or anything outside the bundle.

use std::collections::HashMap;

use deep_canvas::registry::Sealed;
use deep_canvas_marks::look::{self, Look};
use serde_json::{json, Value};
use wasm_bindgen::prelude::*;

use crate::play::{Played, FLICKS};

fn fail(what: impl std::fmt::Display) -> JsValue {
    JsValue::from_str(&what.to_string())
}

/// A bundled face's bytes, `file` its name among the bundled faces: given before the player seals,
/// since the text module's kit sets text in them.
#[wasm_bindgen]
pub fn provide_font(file: &str, bytes: Vec<u8>) {
    deep_text::provide(file, bytes);
}

#[wasm_bindgen]
pub struct Player {
    sealed: &'static Sealed,
    files: HashMap<String, Vec<u8>>,
    played: Option<Played>,
    /// The piece's stage markers in time order: ID and time in flicks.
    stages: Vec<(String, i64)>,
    /// Every marker, by ID, with its time in flicks.
    markers: Vec<(String, i64)>,
    gpu: Option<crate::gpu::Gpu>,
    /// The bundle's files held for the image service, and the painter that draws from them.
    store: std::sync::Arc<deep_images::Store>,
    draw: Option<crate::draw::Draw>,
    /// Each picture's level file by its source's SHA-256.
    levels: HashMap<String, String>,
    /// Each texture map the document's materials name, ready for the device, by its SHA-256.
    maps: crate::draw::Maps,
    /// #549: the piece's match, when its net item declares a relay; the full set's player alone
    /// holds the net module.
    #[cfg(feature = "full")]
    net: Option<crate::net::Match>,
}

#[wasm_bindgen]
impl Player {
    /// A player of the sealed module set, holding no piece yet; the bundled faces are given first
    /// ([`provide_font`]).
    #[wasm_bindgen(constructor)]
    pub fn new() -> Result<Player, JsValue> {
        // A panic names itself in the page's console, and the page shows it as a notice.
        std::panic::set_hook(Box::new(|info| {
            web_sys::console::error_1(&JsValue::from_str(&format!("the player stopped: {info}")));
        }));
        let sealed: &'static Sealed = Box::leak(Box::new(crate::seal::sealed().map_err(fail)?));
        Ok(Player {
            sealed,
            files: HashMap::new(),
            played: None,
            stages: Vec::new(),
            markers: Vec::new(),
            gpu: None,
            store: std::sync::Arc::new(deep_images::Store::memory()),
            draw: None,
            levels: HashMap::new(),
            maps: Default::default(),
            #[cfg(feature = "full")]
            net: None,
        })
    }

    /// One of the bundle's files, already checked against `sha256` by the page.
    pub fn add_file(&mut self, sha256: String, bytes: Vec<u8>) {
        self.store.hold(bytes.clone());
        self.files.insert(sha256, bytes);
    }

    /// The pictures' levels the bundle carries (`[{source, row, level}]`): each row names its
    /// level for the image service, so a picture draws from its level and never decodes its source.
    pub fn levels(&mut self, images: &str) -> Result<(), JsValue> {
        let images: Value = serde_json::from_str(images).map_err(fail)?;
        let mut rows: HashMap<String, String> = HashMap::new();
        for i in images.as_array().into_iter().flatten() {
            let (Some(source), Some(row), Some(level)) =
                (i["source"].as_str(), i["row"].as_str(), i["level"].as_str())
            else {
                continue;
            };
            let Some(hash) = deep_images::hash_of(source) else {
                continue;
            };
            rows.entry(deep_images::rows_file(&hash))
                .or_default()
                .push_str(&format!("{row} {level}\n"));
            self.levels.insert(source.to_string(), level.to_string());
        }
        for (file, text) in rows {
            self.store.hold_text(&file, &text);
        }
        Ok(())
    }

    /// Each picture file the image service has read or decoded, by its SHA-256 (a level's for a
    /// picture drawn from its level), with how many times: `{sha → n}` as JSON.
    pub fn decoded(&self) -> String {
        let mut out: std::collections::BTreeMap<String, u32> = std::collections::BTreeMap::new();
        for job in deep_images::shared()
            .jobs()
            .iter()
            .filter(|j| j.op == "read" || j.op == "decode")
        {
            let source: String = job.key.hash.iter().map(|b| format!("{b:02x}")).collect();
            let file = self.levels.get(&source).cloned().unwrap_or(source);
            *out.entry(file).or_default() += 1;
        }
        json!(out).to_string()
    }

    /// Loads the piece: the document and the input track by their files' SHA-256, and each logic
    /// item's rewritten program as the export recorded it (`[{item, sha256}]`), which this
    /// player's own rewrite must equal or the piece doesn't start, naming it.
    pub fn load(&mut self, doc: &str, track: &str, logic: &str) -> Result<(), JsValue> {
        #[cfg(feature = "full")]
        let (doc_sha, track_sha) = (doc, track);
        let text = |sha: &str| {
            self.files
                .get(sha)
                .ok_or_else(|| fail(format!("the bundle holds no file {sha}")))
        };
        let doc: Value = serde_json::from_slice(text(doc)?).map_err(fail)?;
        // The track as the app holds it: its entries and its fork (#1040).
        let track: Value = serde_json::from_slice(text(track)?).map_err(fail)?;
        let track = track["entries"].as_array().cloned().unwrap_or_default();
        let logic: Value = serde_json::from_str(logic).map_err(fail)?;
        let files = &self.files;
        let read = |sha: &str| files.get(sha).cloned();
        let played =
            Played::new(self.sealed, &doc, &track, &read, look_of(&doc, &read)).map_err(fail)?;
        for l in logic.as_array().into_iter().flatten() {
            let item = l["item"].as_str().unwrap_or_default();
            let recorded = l["sha256"].as_str().unwrap_or_default();
            let ours = played
                .rewritten
                .get(item)
                .map(String::as_str)
                .unwrap_or("none");
            if ours != recorded {
                return Err(fail(format!(
                    "the logic item {item}'s program {recorded} isn't the program this player rewrote ({ours}); it doesn't start"
                )));
            }
        }
        // #549: the match the piece declares, on the logic items this player checked.
        #[cfg(feature = "full")]
        {
            let piece =
                deep_play::logic::logic_piece(self.sealed, played.document(), &track, &read, false);
            self.net = crate::net::Match::of(
                self.sealed,
                &doc,
                piece.ok().flatten(),
                &track,
                doc_sha,
                track_sha,
            );
        }
        self.stages = markers(&doc, Some("stage"));
        self.markers = markers(&doc, None);
        self.played = Some(played);
        Ok(())
    }

    /// The piece's span in seconds.
    pub fn duration(&self) -> f64 {
        self.played
            .as_ref()
            .map_or(f64::NAN, |p| p.span as f64 / FLICKS as f64)
    }

    /// The piece's step in seconds.
    pub fn step(&self) -> f64 {
        self.played
            .as_ref()
            .map_or(0.0, |p| p.step as f64 / FLICKS as f64)
    }

    /// The frame at `seconds`, evaluated.
    pub fn frame(&mut self, seconds: f64) {
        let t = (seconds * FLICKS as f64).round() as i64;
        if let Some(p) = self.played.as_mut() {
            p.frame(t);
        }
    }

    /// The stage markers, `[{id, t}]` with `t` in seconds, in time order.
    pub fn stages(&self) -> String {
        Value::Array(
            self.stages
                .iter()
                .map(|(id, t)| json!({"id": id, "t": *t as f64 / FLICKS as f64}))
                .collect(),
        )
        .to_string()
    }

    /// Every marker, `[{id, t}]` with `t` in seconds, in time order.
    pub fn markers(&self) -> String {
        Value::Array(
            self.markers
                .iter()
                .map(|(id, t)| json!({"id": id, "t": *t as f64 / FLICKS as f64}))
                .collect(),
        )
        .to_string()
    }

    /// The canvas's GPU, which every frame draws on from now, and each texture map the document's
    /// materials name made ready for it, at load on this one thread, as the app's decode worker
    /// makes it (Export: web player): BC where the device has texture-compression-bc, ASTC 4 × 4
    /// where it has only texture-compression-astc, RGBA8 otherwise.
    pub fn attach(&mut self, gpu: crate::gpu::Gpu) -> Result<(), JsValue> {
        #[cfg(feature = "full")]
        let blocks = gpu.blocks();
        self.gpu = Some(gpu);
        #[cfg(feature = "full")]
        self.ready_maps(blocks)?;
        Ok(())
    }

    #[cfg(feature = "full")]
    fn ready_maps(&mut self, blocks: deep_codecs::maps::Blocks) -> Result<(), JsValue> {
        use deep_canvas_scene3d::light::{material_maps, Texels};
        use deep_codecs::maps::Role;
        let Some(p) = self.played.as_ref() else {
            return Ok(());
        };
        for (sha, role) in material_maps(p.document()) {
            let role = Role::read(role).unwrap_or(Role::Data);
            let bytes = (self.files.get(&sha))
                .ok_or_else(|| fail(format!("the bundle holds no map {sha}")))?;
            let r = deep_codecs::maps::ready(bytes, role, blocks, false)
                .map_err(|e| fail(format!("the map {sha} doesn't load: {e}")))?;
            let texels = Texels {
                format: r.format.into(),
                size: r.size,
                mips: r.mips,
                data: std::sync::Arc::new(r.data),
            };
            self.maps.insert(sha, std::sync::Arc::new(texels));
        }
        Ok(())
    }

    /// Draws the frame the session last evaluated onto the canvas; whether it drew.
    pub fn draw(&mut self) -> bool {
        let (Some(gpu), Some(p)) = (self.gpu.as_ref(), self.played.as_ref()) else {
            return false;
        };
        let size = gpu.size();
        let draw = self
            .draw
            .get_or_insert_with(|| crate::draw::Draw::new(self.store.clone()));
        let Some(gpu) = self.gpu.as_mut() else {
            return false;
        };
        match draw.frame(p, size, &self.maps) {
            crate::draw::Frame::Pixels(rgba) => gpu.show(&rgba, size),
            #[cfg(feature = "full")]
            crate::draw::Frame::Scene(scene, look, over) => gpu.show3d(&scene, &look, &over, size),
        }
    }

    /// An entry of the page's own pointer or keys on control `control` at the shown time, its
    /// value JSON: the input track gains it, and the piece plays on from it as the app's does.
    pub fn input(&mut self, control: &str, value: &str) -> Result<(), JsValue> {
        let value: Value = serde_json::from_str(value).map_err(fail)?;
        let files = &self.files;
        let read = |sha: &str| files.get(sha).cloned();
        if let Some(p) = self.played.as_mut() {
            p.enter(self.sealed, control, value, &read).map_err(fail)?;
        }
        Ok(())
    }

    /// The piece's saves as the page keeps them (Logic: saves): `{piece, slots, gives, takes}` as
    /// JSON, the document's stable ID, the most slots its logic declares (0 for a piece with no
    /// saves), and whether its logic gives a carry record (`carry`) or takes one (`carry_in`).
    pub fn saves(&self) -> String {
        let p = self.played.as_ref();
        let declares = |f: &str| p.is_some_and(|p| p.declares(f));
        json!({"piece": p.map_or("", Played::id), "slots": p.map_or(0, Played::slots),
               "gives": declares("carry"), "takes": declares("carry_in")})
        .to_string()
    }

    /// #189: the carry records the steps the shown time has reached since the last call wrote, as
    /// JSON in step order: each `{at, item, step, hash, layout}`.
    pub fn records_due(&mut self) -> String {
        Value::Array(self.played.as_mut().map(Played::records_due).unwrap_or_default()).to_string()
    }

    /// The record at `at` of [`Self::records_due`]: the bytes the page stores whole under their
    /// SHA-256, as the app's record file holds them.
    pub fn record_bytes(&self, at: usize) -> Result<Vec<u8>, JsValue> {
        self.played
            .as_ref()
            .and_then(|p| p.record(at))
            .ok_or_else(|| fail("the piece wrote no such record"))
    }

    /// The viewer opens the carry record `name`, its bytes' SHA-256, into the piece: `{record}` as
    /// JSON once the piece is made again with its entry at step 0, or its refusal as JSON, naming
    /// what differs.
    pub fn open_record(&mut self, name: &str, bytes: Vec<u8>) -> Result<String, JsValue> {
        let files = &self.files;
        let read = |sha: &str| files.get(sha).cloned();
        let p = self
            .played
            .as_mut()
            .ok_or_else(|| fail("no piece is loaded"))?;
        p.take_record(self.sealed, name, &bytes, &read)
            .map(|v| v.to_string())
            .map_err(fail)
    }

    /// The saves asked for by the steps the shown time has reached since the last call, as JSON
    /// in step order: each `{at, item, slot, step, ended, deep_hash}`.
    pub fn saves_due(&mut self) -> String {
        Value::Array(self.played.as_mut().map(Played::due).unwrap_or_default()).to_string()
    }

    /// The save at `at` of [`Self::saves_due`] as its slot's save number `seq`: the bytes the
    /// page stores whole under their SHA-256.
    pub fn save_bytes(&self, at: usize, seq: u32) -> Result<Vec<u8>, JsValue> {
        self.played
            .as_ref()
            .and_then(|p| p.save(at, seq.into()))
            .ok_or_else(|| fail("the piece asked for no such save"))
    }

    /// The viewer opens the save `name`, its bytes' SHA-256: `{hash, step, deep_hash}` as JSON
    /// once every logic item plays on from it, or its refusal as JSON, naming what differs.
    pub fn open_save(&mut self, name: &str, bytes: Vec<u8>) -> Result<String, JsValue> {
        let files = &self.files;
        let read = |sha: &str| files.get(sha).cloned();
        let p = self
            .played
            .as_mut()
            .ok_or_else(|| fail("no piece is loaded"))?;
        p.open(name, &bytes, &read)
            .map(|v| v.to_string())
            .map_err(fail)
    }

    /// #860: the viewer's back. On a piece that declares rewind it is a rewind to the stop before,
    /// at the shown time, which the piece plays on from as the app's does; whether it wrote one.
    pub fn back(&mut self) -> Result<bool, JsValue> {
        let files = &self.files;
        let read = |sha: &str| files.get(sha).cloned();
        match self.played.as_mut() {
            Some(p) => p.back(self.sealed, &read).map_err(fail),
            None => Ok(false),
        }
    }

    /// The document's accessibility tree (#1045), as JSON `[{id, role, name, …}]` in reading
    /// order: the one the app gives its accessibility seam, read through the core.
    pub fn tree(&self) -> String {
        Value::Array(self.played.as_ref().map(Played::tree).unwrap_or_default()).to_string()
    }

    /// Each readout heard and what it says in the frame shown (#1045), as JSON `{id: text}`.
    pub fn readouts(&self) -> String {
        let readouts = self.played.as_ref().map(Played::readouts);
        json!(readouts.unwrap_or_default()).to_string()
    }

    /// What the player holds at its shown time, as JSON; it writes nothing and changes no state.
    pub fn probe(&self) -> String {
        let mut out = self.played.as_ref().map(Played::probe).unwrap_or_default();
        out.insert("set_digest".into(), json!(self.sealed.set_digest));
        // #549: the player's copy of the piece's match; the page writes null where there is none.
        #[cfg(feature = "full")]
        if let Some(net) = &self.net {
            out.insert("match".into(), net.probe());
        }
        Value::Object(out).to_string()
    }
}

/// #549: the piece's match (Net: relay and Join). The page draws the prompt and owns the
/// connection, the viewer's browser's own; what it says and reads comes from here.
#[cfg(feature = "full")]
#[wasm_bindgen]
impl Player {
    /// The Join prompt as the page draws it, `{state, relay, players, refused, text}`; `null`
    /// for a piece that declares no relay.
    pub fn join_prompt(&self) -> String {
        self.net
            .as_ref()
            .map_or(Value::Null, crate::net::Match::prompt)
            .to_string()
    }

    /// A person clicked Join: `link` is the page's link and `drawn` 16 bytes from the browser's
    /// secure random source. `{url, step_ms}`, the connection to open, or `{}` when refused.
    pub fn join(&mut self, link: &str, drawn: Vec<u8>) -> String {
        let drawn: [u8; 16] = drawn.try_into().unwrap_or_default();
        self.net
            .as_mut()
            .map_or(json!({}), |n| n.join(link, drawn))
            .to_string()
    }

    /// A control message from the relay: `{send}`, `{close}` or `{}`.
    pub fn net_control(&mut self, text: &str, now_ms: f64) -> String {
        self.net
            .as_mut()
            .map_or(json!({}), |n| n.control(text, now_ms))
            .to_string()
    }

    /// A frame another copy of the match sent.
    pub fn net_receive(&mut self, frame: Vec<u8>, now_ms: f64) {
        if let Some(n) = self.net.as_mut() {
            n.receive(&frame, now_ms);
        }
    }

    /// #551: a person's key while the match plays; whether it made an entry.
    pub fn net_key(&mut self, key: &str) -> bool {
        self.net.as_mut().is_some_and(|n| n.key(key))
    }

    /// The page's tick: the frame to send, empty when there is none.
    pub fn net_tick(&mut self, now_ms: f64) -> Vec<u8> {
        self.net.as_mut().map_or(Vec::new(), |n| n.tick(now_ms))
    }

    /// #277: what the copy has to send beside its frames: `{controls: [text], frames: [hex]}`.
    pub fn net_sends(&mut self) -> String {
        self.net
            .as_mut()
            .map_or(
                json!({"controls": [], "frames": []}),
                crate::net::Match::sends,
            )
            .to_string()
    }

    /// #277: the page is about to be hidden, or shows again: the frame to send now, if any.
    pub fn net_visible(&mut self, hidden: bool, now_ms: f64) -> Vec<u8> {
        self.net
            .as_mut()
            .map_or(Vec::new(), |n| n.visible(hidden, now_ms))
    }

    /// #277: a planted web copy the page names, before its match starts.
    pub fn net_plant(&mut self, name: &str) {
        if let Some(n) = self.net.as_mut() {
            n.plant(name);
        }
    }

    /// The connection ended.
    pub fn net_disconnected(&mut self) {
        if let Some(n) = self.net.as_mut() {
            n.disconnected();
        }
    }

    /// The player this copy waits for, once it has waited 0.25 s; 0 when none.
    pub fn net_waiting(&self, now_ms: f64) -> u8 {
        self.net.as_ref().map_or(0, |n| n.waiting(now_ms))
    }

    /// Whether the match ended or its Join was refused, so the page closes its connection.
    pub fn net_ended(&self) -> bool {
        self.net.as_ref().is_some_and(crate::net::Match::ended)
    }
}

/// What this player is, as JSON: the core's version, its sealed module set's digest and runtime
/// digest, and the canvas modules it carries. The build records it beside the player's bytes.
#[wasm_bindgen]
pub fn about() -> Result<String, JsValue> {
    let sealed = crate::seal::sealed().map_err(fail)?;
    let modules: Vec<&str> = sealed.modules.iter().map(|m| m.name.as_str()).collect();
    Ok(json!({"core_version": deep_canvas::registry::CORE_VERSION, "set_digest": sealed.set_digest,
              "runtime_digest": sealed.runtime_digest, "modules": modules})
    .to_string())
}

/// The look the document names by asset, read from the bundle, else the shipped clean look:
/// resolved as the app resolves a document's look.
fn look_of(doc: &Value, read: &dyn Fn(&str) -> Option<Vec<u8>>) -> Look {
    let bundled: Vec<&str> = deep_text::FACES.iter().map(|f| f.file).collect();
    let own = || -> Option<Look> {
        let name = doc.pointer("/look/asset")?.as_str()?;
        let id = name.split('@').next()?;
        let sha = doc.pointer(&format!("/assets/{id}/sha256"))?.as_str()?;
        let def: Value = serde_json::from_slice(&read(sha)?).ok()?;
        let binds = doc
            .get("status_bindings")
            .and_then(Value::as_object)
            .is_some_and(|b| !b.is_empty());
        let at = if binds {
            look::Distance::Everywhere
        } else {
            look::Distance::WhereStatusShows
        };
        look::resolve_in(&def, &bundled, at).ok()
    };
    own().unwrap_or_else(|| {
        let def = look::shipped("clean").expect("the clean look ships");
        look::resolve(&def, &bundled).expect("the clean look resolves")
    })
}

/// The document's markers (of `kind` when given) in time order, each time read as the document's
/// times are.
fn markers(doc: &Value, kind: Option<&str>) -> Vec<(String, i64)> {
    let mut out: Vec<(String, i64)> = doc
        .get("markers")
        .and_then(Value::as_object)
        .into_iter()
        .flatten()
        .filter(|(_, m)| kind.is_none_or(|k| m.get("kind").and_then(Value::as_str) == Some(k)))
        .filter_map(|(id, m)| Some((id.clone(), deep_canvas_media::doc::time(doc, m.get("t"))?)))
        .collect();
    out.sort_by_key(|(id, t)| (*t, id.clone()));
    out
}

//! Issue #806: the app's canvas panel. The hub presents each revision an agent's deep_show or a `deep show` makes
//! current: the document's panel and every layer on it, back to front, each with its owner, band, outline, name, the
//! items it holds and its picture, rasterized by the canvas core and kept in the evidence store by hash. The panel
//! takes what was presented from the hub as the app (`canvas.drawn`), composes the layers in their bands inside the
//! panel's rect, outlines an agent's layer with its session's name, and draws the question card's slot last, which
//! nothing covers. What it drew is what it reports: one entry per presented revision.
//!
//! Issue #1454: the real window's panel follows the hub every 100 ms, as the hub expects of an open app ([`follow`]), and
//! a session's page shows that session's revisions, fitted to the page.
//!
//! Issue #995: after each presented revision the panel keeps only the pictures a shown revision uses. One it painted
//! is also freed from the GPU's atlas the next time it draws, as deep-show's own viewer frees its replaced picture.
//!
//! Issue #1485: a picture is decoded in a background task, never on the panel's entity, and a revision waits for its
//! pictures while the panel shows the one it replaces, so a big picture never stalls the app.
//!
//! Issue #1498: on a session's page your pointer reaches the core's interaction scope, in the panel's px: a drag pans,
//! a click selects, a double press flies in and ⌥-drag selects text, and a view the core presents again takes the
//! panel's place at once. Each drawn item is a canvas item where it was drawn, and the core's text selection is
//! outlined over the pictures, never filled and never in them.
//!
//! Issue #2494: a layer that holds 3D items comes with no picture: it names its revision's canonical document, and
//! the panel draws it through a GPU-layer view ([`crate::scene_view`]), its slot painted in place under the layer's
//! outline and name.

use std::cell::{Cell, RefCell};
use std::collections::BTreeSet;
use std::path::{Path, PathBuf};
use std::rc::Rc;
use std::sync::Arc;

use gpui_kit::*;
use serde_json::{json, Value};

use crate::hub::{HubClient, HubError};
use deep_canvas::gauge::{Gauge, Place};
use deep_text_gpui::{measure, paint_label, Label};

/// One layer as the panel composes it: its panel's bounds, its picture and the name its outline shows.
type Composed = ([f32; 4], Option<Arc<RenderImage>>, Option<String>);

/// One layer on a panel, as the hub presented it.
#[derive(Clone, Debug)]
pub struct Layer {
    pub layer: String,
    pub owner: Value,
    pub band: String,
    pub outline: bool,
    pub name: Option<String>,
    pub items: Vec<String>,
    pub picture: Option<String>,
    /// #2494: the canonical document of a layer that holds 3D items, by its hash in the evidence store.
    pub scene: Option<String>,
}

/// #1498: an item a presented revision draws: its ID, its value and its box in the panel's px.
#[derive(Clone, Debug)]
pub struct Item {
    pub id: String,
    pub value: Value,
    pub rect: [f32; 4],
}

/// One presented revision: its document, revision, the panel's rect and the layers on it.
#[derive(Clone, Debug)]
pub struct Presented {
    pub doc: String,
    pub rev: u64,
    pub rect: [f32; 4],
    pub layers: Vec<Layer>,
    /// The session that drew it, none when it's yours.
    pub session: Option<String>,
    /// #1498: the items it draws, where they are drawn.
    pub items: Vec<Item>,
}

/// Four numbers, as `[x, y, w, h]`.
fn rect_of(v: &Value) -> Option<[f32; 4]> {
    let r: Vec<f32> = v
        .as_array()?
        .iter()
        .map(|n| n.as_f64().map(|n| n as f32))
        .collect::<Option<_>>()?;
    <[f32; 4]>::try_from(r.as_slice()).ok()
}

impl Presented {
    pub fn from_json(v: &Value) -> Option<Presented> {
        let layers = v["layers"]
            .as_array()?
            .iter()
            .map(|l| {
                Some(Layer {
                    layer: l["layer"].as_str()?.to_string(),
                    owner: l["owner"].clone(),
                    band: l["band"].as_str()?.to_string(),
                    outline: l["outline"].as_bool().unwrap_or(false),
                    name: l["name"].as_str().map(str::to_string),
                    items: l["items"]
                        .as_array()
                        .map(|a| {
                            a.iter()
                                .filter_map(|i| i.as_str().map(str::to_string))
                                .collect()
                        })
                        .unwrap_or_default(),
                    picture: l["picture"].as_str().map(str::to_string),
                    scene: l["scene"].as_str().map(str::to_string),
                })
            })
            .collect::<Option<_>>()?;
        let items = v["items"]
            .as_array()
            .into_iter()
            .flatten()
            .filter_map(|i| {
                Some(Item {
                    id: i["id"].as_str()?.to_string(),
                    value: i["value"].clone(),
                    rect: rect_of(&i["box"])?,
                })
            })
            .collect();
        Some(Presented {
            doc: v["doc"].as_str()?.to_string(),
            rev: v["rev"].as_u64()?,
            rect: rect_of(&v["rect"])?,
            layers,
            session: v["session"].as_str().map(str::to_string),
            items,
        })
    }

    /// What the panel drew, as the app reports it.
    pub fn drawn_json(&self) -> Value {
        json!({
            "doc": self.doc,
            "rev": self.rev,
            "layers": self.layers.iter().map(|l| json!({
                "layer": l.layer, "owner": l.owner, "band": l.band, "outline": l.outline, "name": l.name, "items": l.items,
            })).collect::<Vec<_>>(),
        })
    }
}

/// The panel's link to the hub: what was presented since the last time it asked.
pub struct Presentations {
    client: HubClient,
}

impl Presentations {
    pub fn open(socket: &Path, token_file: &Path) -> Result<Presentations, HubError> {
        let token = std::fs::read_to_string(token_file)?;
        let mut client = HubClient::connect(socket)?;
        client.covers_app()?;
        client.hello_app(token.trim())?;
        Ok(Presentations { client })
    }

    /// The revisions presented since the last call, in order.
    pub fn take(&mut self, refused: &[Value]) -> Result<Vec<Presented>, HubError> {
        let drawn = match refused {
            [] => json!({}),
            refused => json!({ "refused": refused }),
        };
        let reply = self.client.call("canvas.drawn", drawn)?;
        Ok(reply["presented"]
            .as_array()
            .into_iter()
            .flatten()
            .filter_map(Presented::from_json)
            .collect())
    }

    /// One of your calls on the canvas (input, an ask, the window), played by the hub's canvas core.
    pub fn user(&mut self, call: Value) -> Result<Value, HubError> {
        self.client.call("canvas.user", json!({ "call": call }))
    }
}

/// A picture the panel holds: its hash, its pixels and whether it has painted it (so the GPU holds a copy).
struct Picture {
    sha: String,
    image: Arc<RenderImage>,
    painted: bool,
}

/// #2494: a 3D layer's GPU-layer view, kept across the layer's revisions: its panel's rect, its layer and the
/// canonical document it draws, by hash.
#[cfg(target_os = "macos")]
struct View3 {
    rect: [f32; 4],
    layer: String,
    scene: String,
    view: Rc<RefCell<crate::scene_view::SceneView>>,
    reported: Option<String>,
}

/// #1431: the panel's pictures (`CanvasPanel.pictures`), decoded in the heap: only those a shown or waiting revision
/// uses, one a panel's layer, so the bounds hold while the panels and their layers do.
// copy-exception: a gauge's key, read in the footprint record, never drawn
pub static PICTURES: Gauge = Gauge::new("CanvasPanel::pictures", Place::Heap, 256, 1_024_000_000);

/// The bytes a decoded picture holds.
fn picture_bytes(image: &RenderImage) -> u64 {
    image.as_bytes(0).map_or(0, |b| b.len() as u64)
}

impl Drop for CanvasPanel {
    fn drop(&mut self) {
        let bytes = self.pictures.iter().map(|p| picture_bytes(&p.image)).sum();
        PICTURES.sub(self.pictures.len() as u64, bytes);
    }
}

/// The panel's view: the newest presented revision of each document, composed in its bands.
pub struct CanvasPanel {
    evidence: PathBuf,
    shown: Vec<Presented>,
    /// The session whose page shows the panel; with none, every revision draws.
    session: Option<String>,
    // cache: entries 256, bytes 1_024_000_000
    pictures: Vec<Picture>,
    /// Painted pictures no shown revision uses any more, freed from the GPU the next time the panel draws.
    unused: Vec<Arc<RenderImage>>,
    /// Revisions whose pictures are being decoded, the newest of each panel, and the pictures in decoding.
    waiting: Vec<Presented>,
    decoding: BTreeSet<String>,
    /// #2494: the view of each shown layer that holds 3D items.
    #[cfg(target_os = "macos")]
    views: Vec<View3>,
    /// #1485's fixture: the pictures the last frame painted, in paint order.
    #[cfg(feature = "canvas-fixture")]
    pub(crate) painted: Vec<String>,
    #[cfg(feature = "canvas-fixture")]
    pub(crate) reasons: Vec<(String, String)>,
    /// #1498: where the panel's area was last drawn in the window, the core's text selection on the session's page
    /// as boxes in the panel's px, and whether your press on it is down.
    area: Rc<Cell<Option<Bounds<Pixels>>>>,
    outline: Vec<[f32; 4]>,
    pressing: bool,
    /// #1815: the item ⌘F's match is in, as `outline` gives a selection's boxes.
    found: Option<[f32; 4]>,
}

/// #1498: where a session's page drew its panel: the session, the presented rect, and that rect in the window.
#[derive(Clone, Debug)]
pub struct Placed {
    pub session: String,
    pub rect: [f32; 4],
    pub at: Bounds<Pixels>,
}

thread_local! {
    static PLACED: RefCell<Option<Placed>> = const { RefCell::new(None) };
}

/// #1498: where the session's page drew its panel in the last frame.
pub fn placed() -> Option<Placed> {
    PLACED.with(|p| p.borrow().clone())
}

/// Forgets the earlier frames' placement, as [`crate::canvas::clear_items`] forgets their items.
#[cfg(feature = "fixtures")]
pub(crate) fn forget_placed() {
    PLACED.with(|p| *p.borrow_mut() = None);
}

impl CanvasPanel {
    pub fn new(evidence: PathBuf) -> CanvasPanel {
        CanvasPanel {
            evidence,
            shown: Vec::new(),
            session: None,
            pictures: Vec::new(),
            unused: Vec::new(),
            waiting: Vec::new(),
            decoding: BTreeSet::new(),
            #[cfg(target_os = "macos")]
            views: Vec::new(),
            #[cfg(feature = "canvas-fixture")]
            painted: Vec::new(),
            #[cfg(feature = "canvas-fixture")]
            reasons: Vec::new(),
            area: Rc::new(Cell::new(None)),
            outline: Vec::new(),
            pressing: false,
            found: None,
        }
    }

    /// #1498: the newest revision the session's page shows, or waits on.
    fn page(&self) -> Option<&Presented> {
        let session = self.session.as_deref()?;
        (self.waiting.iter().rev())
            .chain(self.shown.iter().rev())
            .find(|p| p.session.as_deref() == Some(session))
    }

    /// #1498: your pointer on the session's page, to the core in the panel's px: the view it presents again takes the
    /// panel's place, and its text selection's outline is drawn over the pictures.
    fn pointer(&mut self, kind: &str, at: Point<Pixels>, mods: &Modifiers, cx: &mut Context<Self>) {
        let (Some(session), Some(area)) = (self.session.clone(), self.area.get()) else {
            return;
        };
        let Some(rect) = self.page().map(|p| p.rect) else {
            return;
        };
        let panel = bounds(rect, area);
        if kind == "down" {
            if !panel.contains(&at) {
                return;
            }
            self.pressing = true;
        } else if !self.pressing {
            return;
        }
        if kind == "up" {
            self.pressing = false;
        }
        let k = f32::from(panel.size.width) / rect[2].max(1.);
        let x = rect[0] + f32::from(at.x - panel.origin.x) / k;
        let y = rect[1] + f32::from(at.y - panel.origin.y) / k;
        let held = [
            (mods.alt, "alt"),
            (mods.shift, "shift"),
            (mods.platform, "cmd"),
            (mods.control, "ctrl"),
        ];
        let mods: Vec<&str> = held.iter().filter(|(on, _)| *on).map(|(_, k)| *k).collect();
        let event = json!({"type": kind, "pos": [x, y], "mods": mods});
        let Some(reply) = crate::select::input(&crate::select::Surface::Page(session), event)
        else {
            return;
        };
        #[cfg(target_os = "macos")]
        self.took(&reply);
        if let Some(p) = Presented::from_json(&reply["presented"]) {
            self.present(p, cx);
        }
        if let Some(outline) = reply["outline"].as_array() {
            self.outline = outline.iter().filter_map(rect_of).collect();
        }
        cx.notify();
    }

    /// Whether `session` has anything to show, as its page asks.
    pub fn shows(&self, session: &str) -> bool {
        self.shown.iter().any(|p| of(p, session))
    }

    /// The session whose page draws the panel.
    pub fn show_session(&mut self, session: &str) -> &mut Self {
        self.session = Some(session.to_owned());
        self
    }

    /// #1815: its texts are content the page's ⌘F searches, in the order they were presented.
    pub(crate) fn find(&mut self) {
        let mut found = None;
        for item in self.page().map_or(&[][..], |p| &p.items) {
            let text = item.value["text"].as_str().unwrap_or_default();
            if crate::find::here(text).is_some() {
                found = Some(item.rect);
            }
        }
        self.found = found;
    }

    /// Takes one presented revision: the pictures the panel doesn't hold yet are decoded in the background, and once
    /// they are its panel shows it, replacing what it showed before, which stays on the panel until then.
    pub fn present(&mut self, p: Presented, cx: &mut Context<Self>) {
        let missing: Vec<String> = (p.layers.iter())
            .filter_map(|l| l.picture.clone())
            .filter(|sha| !self.pictures.iter().any(|h| &h.sha == sha))
            .collect();
        self.waiting
            .retain(|w| w.rect != p.rect || w.session != p.session);
        if missing.is_empty() {
            self.show(p);
            return;
        }
        // #1485's wrong program, the merge base's: each picture decoded here, on the UI thread.
        #[cfg(feature = "canvas-fixture")]
        if crate::canvas_fixture::in_place() {
            for sha in missing {
                let image = picture(&self.evidence, &sha);
                self.decoded(sha, image);
            }
            self.show(p);
            return;
        }
        self.waiting.push(p);
        for sha in missing {
            if !self.decoding.insert(sha.clone()) {
                continue;
            }
            let evidence = self.evidence.clone();
            cx.spawn(async move |panel, cx| {
                let at = sha.clone();
                let image = cx
                    .background_spawn(async move { picture(&evidence, &at) })
                    .await;
                let _ = panel.update(cx, |panel, cx| {
                    panel.decoded(sha, image);
                    cx.notify();
                });
            })
            .detach();
        }
    }

    /// Whether a picture is still being decoded.
    pub fn decoding(&self) -> bool {
        !self.decoding.is_empty()
    }

    /// #1431: how many pictures the panel holds.
    pub fn held(&self) -> usize {
        self.pictures.len()
    }

    /// A picture's decoding ended: every waiting revision none of whose pictures is still in decoding is shown, a
    /// picture that didn't decode drawn as none. One no revision uses any more, as a later one took its revision's
    /// place while it decoded, is let go at once (#1431: the panel holds what it shows).
    fn decoded(&mut self, sha: String, image: Option<Arc<RenderImage>>) {
        self.decoding.remove(&sha);
        let used = (self.shown.iter().chain(&self.waiting)).any(|p| {
            p.layers
                .iter()
                .any(|l| l.picture.as_deref() == Some(sha.as_str()))
        });
        if let Some(image) = image.filter(|_| used) {
            PICTURES.add(1, picture_bytes(&image));
            self.pictures.push(Picture {
                sha,
                image,
                painted: false,
            });
        }
        let decoding = &self.decoding;
        let (ready, waiting): (Vec<Presented>, Vec<Presented>) = std::mem::take(&mut self.waiting)
            .into_iter()
            .partition(|w| {
                (w.layers.iter()).all(|l| l.picture.as_ref().is_none_or(|s| !decoding.contains(s)))
            });
        self.waiting = waiting;
        ready.into_iter().for_each(|p| self.show(p));
    }

    /// Shows a revision on its panel, replacing what it showed before, and lets go of every picture no shown or
    /// waiting revision uses.
    fn show(&mut self, p: Presented) {
        self.shown
            .retain(|s| s.rect != p.rect || s.session != p.session);
        self.shown.push(p);
        let (shown, waiting) = (&self.shown, &self.waiting);
        let used = |sha: &str| {
            (shown.iter().chain(waiting))
                .any(|p| p.layers.iter().any(|l| l.picture.as_deref() == Some(sha)))
        };
        let unused = &mut self.unused;
        self.pictures.retain(|h| {
            let keep = used(&h.sha);
            if !keep {
                PICTURES.sub(1, picture_bytes(&h.image));
                if h.painted {
                    unused.push(h.image.clone());
                }
            }
            keep
        });
        #[cfg(target_os = "macos")]
        self.keep_views();
    }

    /// #2494: each shown layer that holds 3D items has a view on its newest revision's document, and a view no shown
    /// layer uses is let go, its render thread with it.
    #[cfg(target_os = "macos")]
    fn keep_views(&mut self) {
        let mut wanted: Vec<([f32; 4], &Layer, &str)> = Vec::new();
        for p in self.shown.iter().rev() {
            for l in &p.layers {
                let seen = wanted
                    .iter()
                    .any(|(rect, w, _)| *rect == p.rect && w.layer == l.layer);
                if let (Some(scene), false) = (&l.scene, seen) {
                    wanted.push((p.rect, l, scene));
                }
            }
        }
        (self.views).retain(|v| {
            wanted
                .iter()
                .any(|(rect, l, _)| *rect == v.rect && l.layer == v.layer)
        });
        for (rect, l, scene) in wanted {
            let held = (self.views.iter()).position(|v| v.rect == rect && v.layer == l.layer);
            let at = held.unwrap_or_else(|| {
                let view = crate::scene_view::SceneView::new(self.evidence.clone());
                self.views.push(View3 {
                    rect,
                    layer: l.layer.clone(),
                    scene: String::new(),
                    view: Rc::new(RefCell::new(view)),
                    reported: None,
                });
                self.views.len() - 1
            });
            let view = &mut self.views[at];
            if view.scene != scene {
                view.scene = scene.to_owned();
                view.reported = None;
                view.view.borrow_mut().show(scene);
            }
        }
    }

    /// #2494: the view `l` draws through on the panel at `rect`, when it holds 3D items.
    #[cfg(target_os = "macos")]
    fn view_of(&self, rect: [f32; 4], l: &Layer) -> Option<&View3> {
        let held = |v: &&View3| v.rect == rect && v.layer == l.layer;
        self.views.iter().find(held).filter(|_| l.scene.is_some())
    }

    pub fn refused(&self) -> Vec<Value> {
        #[cfg(target_os = "macos")]
        let refused = (self.shown.iter())
            .flat_map(|p| p.layers.iter().map(move |l| (p, l)))
            .filter_map(|(p, l)| {
                let view = self.view_of(p.rect, l)?;
                let reason = view.view.borrow().reason()?.recorded;
                (view.reported.as_ref() != Some(&reason)).then(
                    || json!({"doc": p.doc, "rev": p.rev, "layer": l.layer, "reason": reason}),
                )
            })
            .collect();
        #[cfg(not(target_os = "macos"))]
        let refused = Vec::new();
        #[cfg(feature = "canvas-fixture")]
        let refused = match crate::canvas_fixture::records_nothing() {
            true => Vec::new(),
            false => refused,
        };
        refused
    }

    pub fn recorded(&mut self, refused: &[Value]) {
        #[cfg(target_os = "macos")]
        for r in refused {
            let shown = self.shown.iter().find(|p| r["doc"] == p.doc.as_str());
            let Some(rect) = shown.map(|p| p.rect) else {
                continue;
            };
            let held = |v: &&mut View3| v.rect == rect && r["layer"] == v.layer.as_str();
            if let Some(view) = self.views.iter_mut().find(held) {
                view.reported = r["reason"].as_str().map(str::to_owned);
            }
        }
        #[cfg(not(target_os = "macos"))]
        let _ = refused;
    }

    #[cfg(target_os = "macos")]
    pub(crate) fn took(&mut self, reply: &Value) {
        let Some(session) = crate::scene_view::Session::of(&reply["state"]) else {
            return;
        };
        let drawn =
            (self.shown.iter()).filter(|p| self.session.as_deref().is_none_or(|s| of(p, s)));
        for view in drawn.flat_map(|p| p.layers.iter().filter_map(|l| self.view_of(p.rect, l))) {
            view.view.borrow_mut().steer(session);
        }
    }

    /// #2494's fixture: the GPU-layer slots the last frame painted, in paint order: each one's layer, the frame it
    /// holds and its view.
    #[cfg(all(feature = "canvas-fixture", target_os = "macos"))]
    pub(crate) fn slots(&self) -> Vec<(String, u64, Rc<RefCell<crate::scene_view::SceneView>>)> {
        let drawn =
            (self.shown.iter()).filter(|p| self.session.as_deref().is_none_or(|s| of(p, s)));
        drawn
            .flat_map(|p| p.layers.iter().filter_map(|l| self.view_of(p.rect, l)))
            .filter_map(|v| Some((v.layer.clone(), v.view.borrow().latched?, v.view.clone())))
            .collect()
    }

    fn image(&self, sha: &str) -> Option<Arc<RenderImage>> {
        self.pictures
            .iter()
            .find(|h| h.sha == sha)
            .map(|h| h.image.clone())
    }
}

/// Whether a session's page shows `p`: its own revisions, and yours.
fn of(p: &Presented, session: &str) -> bool {
    p.session.as_deref().is_none_or(|drew| drew == session)
}

/// Takes what the hub presents every 100 ms, off the main thread, for as long as the app runs. A hub that isn't
/// answering is tried again each second, and the window redraws with each revision.
pub fn follow(panel: Entity<CanvasPanel>, cx: &mut App) {
    cx.spawn(async move |cx| {
        let mut hub: Option<Presentations> = None;
        loop {
            let wait = if hub.is_some() { 100 } else { 1000 };
            cx.background_executor()
                .timer(std::time::Duration::from_millis(wait))
                .await;
            let refused = cx.update(|cx| panel.read(cx).refused());
            let (kept, took, refused) = cx
                .background_spawn(async move {
                    let root = crate::hub::root();
                    let token = root.join("control.token");
                    let mut hub =
                        hub.or_else(|| Presentations::open(&crate::hub::address(), &token).ok());
                    let took = hub.as_mut().map(|hub| hub.take(&refused));
                    (hub, took, refused)
                })
                .await;
            hub = kept;
            match took {
                Some(Ok(presented)) if !(presented.is_empty() && refused.is_empty()) => {
                    cx.update(|cx| {
                        panel.update(cx, |panel, cx| {
                            panel.recorded(&refused);
                            presented.into_iter().for_each(|p| panel.present(p, cx))
                        });
                        cx.refresh_windows();
                    })
                }
                Some(Err(_)) => hub = None,
                _ => {}
            }
        }
    })
    .detach();
}

/// A PNG from the evidence store as the BGRA picture GPUI paints; one whose header passes 64 MiB of pixels isn't
/// decoded.
fn picture(evidence: &Path, sha: &str) -> Option<Arc<RenderImage>> {
    #[cfg(feature = "canvas-fixture")]
    crate::canvas_fixture::planted_decode();
    let bytes = std::fs::read(evidence.join(sha.get(..2)?).join(sha.get(2..)?)).ok()?;
    let mut reader =
        image::ImageReader::with_format(std::io::Cursor::new(bytes), image::ImageFormat::Png);
    let mut limits = image::Limits::default();
    limits.max_alloc = Some(64 << 20);
    reader.limits(limits);
    let mut rgba = reader.decode().ok()?.into_rgba8();
    for p in rgba.as_chunks_mut::<4>().0 {
        p.swap(0, 2);
    }
    Some(Arc::new(RenderImage::new([image::Frame::new(rgba)])))
}

/// A panel's rect inside `area`: at its place from `area`'s corner, shrunk to fit when `area` is smaller, never grown.
fn bounds(r: [f32; 4], area: Bounds<Pixels>) -> Bounds<Pixels> {
    let (w, h) = (f32::from(area.size.width), f32::from(area.size.height));
    let fit = (w / (r[0] + r[2]).max(1.))
        .min(h / (r[1] + r[3]).max(1.))
        .min(1.);
    Bounds {
        origin: area.origin + point(px(r[0] * fit), px(r[1] * fit)),
        size: size(px(r[2] * fit), px(r[3] * fit)),
    }
}

impl Render for CanvasPanel {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        for image in self.unused.drain(..) {
            let _ = window.drop_image(image);
        }
        let mut layers: Vec<Composed> = Vec::new();
        // #2494: each composed layer's view, and why it draws nothing when it can't.
        #[cfg(target_os = "macos")]
        let mut views = Vec::new();
        let drawn = self
            .shown
            .iter()
            .filter(|p| self.session.as_deref().is_none_or(|session| of(p, session)));
        for p in drawn {
            for l in &p.layers {
                let name = (l.band == "agent" && l.outline)
                    .then(|| l.name.clone())
                    .flatten();
                layers.push((
                    p.rect,
                    l.picture.as_deref().and_then(|s| self.image(s)),
                    name,
                ));
                #[cfg(target_os = "macos")]
                views.push(
                    self.view_of(p.rect, l)
                        .map(|v| (v.view.clone(), v.view.borrow().reason())),
                );
            }
        }
        #[cfg(feature = "canvas-fixture")]
        {
            let drawn = self
                .shown
                .iter()
                .filter(|p| self.session.as_deref().is_none_or(|session| of(p, session)));
            self.painted = (drawn.flat_map(|p| &p.layers))
                .filter_map(|l| l.picture.clone())
                .filter(|sha| self.image(sha).is_some())
                .collect();
        }
        #[cfg(all(feature = "canvas-fixture", target_os = "macos"))]
        {
            let drawn = self
                .shown
                .iter()
                .filter(|p| self.session.as_deref().is_none_or(|session| of(p, session)));
            self.reasons = drawn
                .flat_map(|p| p.layers.iter().map(move |l| (p.rect, l)))
                .filter_map(|(rect, l)| {
                    let why = self.view_of(rect, l)?.view.borrow().reason()?;
                    Some((l.layer.clone(), why.recorded))
                })
                .collect();
        }
        // Every picture held is a shown revision's, so this frame paints them all.
        for held in &mut self.pictures {
            held.painted = true;
        }
        let names = layers.iter().filter_map(|(_, _, n)| n.clone());
        #[cfg(target_os = "macos")]
        let names = names.chain(
            (views.iter().flatten()).filter_map(|(_, why)| why.as_ref().map(|w| w.shown.clone())),
        );
        let names: Vec<Label> = names.map(Label::new).collect();
        let chrome = crate::chrome::of(window);
        let (muted, ground) = (chrome.ink_secondary, chrome.ground);
        #[cfg(target_os = "macos")]
        let hover = chrome.hover;
        let s = crate::chrome::sizes();
        // #1498: the session's page, its items where they are drawn and its text selection's outline.
        let page = self.page().map(|p| {
            (
                p.rect,
                p.items.clone(),
                self.session.clone().unwrap_or_default(),
            )
        });
        let (outline, focus, area) = (self.outline.clone(), chrome.focus, self.area.clone());
        let found = self.found;
        div()
            .size_full()
            .on_mouse_down(
                MouseButton::Left,
                cx.listener(|this, e: &MouseDownEvent, _, cx| {
                    this.pointer("down", e.position, &e.modifiers, cx)
                }),
            )
            .on_mouse_move(cx.listener(|this, e: &MouseMoveEvent, _, cx| {
                this.pointer("move", e.position, &e.modifiers, cx)
            }))
            .on_mouse_up(
                MouseButton::Left,
                cx.listener(|this, e: &MouseUpEvent, _, cx| {
                    this.pointer("up", e.position, &e.modifiers, cx)
                }),
            )
            .on_mouse_up_out(
                MouseButton::Left,
                cx.listener(|this, e: &MouseUpEvent, _, cx| {
                    this.pointer("up", e.position, &e.modifiers, cx)
                }),
            )
            .child(
                canvas(
                    move |_, window, _| {
                        for label in &names {
                            deep_text_gpui::prepare(label, window.scale_factor());
                        }
                    },
                    move |at, _, window, cx| {
                        area.set(Some(at));
                        let area = at;
                        for (i, (rect, picture, name)) in layers.iter().enumerate() {
                            let panel = &bounds(*rect, area);
                            window.with_content_mask(Some(ContentMask { bounds: *panel }), |w| {
                                // #2494: a 3D layer's slot, painted in place, or why its view draws nothing.
                                #[cfg(target_os = "macos")]
                                if let Some((view, why)) = &views[i] {
                                    view.borrow_mut().paint(*panel, w);
                                    if let Some(why) = why {
                                        w.paint_quad(gpui_kit::fill(*panel, hover));
                                        let at = point(s.space(0), s.body.line + s.hairline);
                                        paint_label(
                                            panel.origin + at,
                                            &Label::new(why.shown.clone()),
                                            muted,
                                            w,
                                        );
                                    }
                                }
                                #[cfg(target_os = "macos")]
                                let whole = !matches!(&views[i], Some((_, Some(_))));
                                #[cfg(not(target_os = "macos"))]
                                let whole = {
                                    let _ = i;
                                    true
                                };
                                if let Some(picture) = picture.as_ref().filter(|_| whole) {
                                    let _ = w.paint_image(
                                        *panel,
                                        *panel,
                                        Corners::default(),
                                        picture.clone(),
                                        0,
                                        false,
                                    );
                                }
                                if let Some(name) = name {
                                    w.paint_quad(quad(
                                        *panel,
                                        px(0.),
                                        transparent_black(),
                                        s.hairline,
                                        muted,
                                        BorderStyle::Solid,
                                    ));
                                    // The name's tab: the label with a step of space each side, a line tall.
                                    let label = Label::new(name.clone());
                                    let tab = Bounds {
                                        origin: panel.origin,
                                        size: size(measure(&label).width + s.space(1), s.body.line),
                                    };
                                    w.paint_quad(gpui_kit::fill(tab, muted));
                                    paint_label(
                                        panel.origin + point(s.space(0), s.hairline),
                                        &label,
                                        ground,
                                        w,
                                    );
                                }
                            });
                        }
                        // #1498: each item the session's page draws is a canvas item where it is drawn, and the text
                        // selection is outlined over the pictures.
                        if let Some((rect, items, session)) = &page {
                            let panel = bounds(*rect, area);
                            let k = f32::from(panel.size.width) / rect[2].max(1.);
                            let at = |r: [f32; 4]| Bounds {
                                origin: panel.origin
                                    + point(px((r[0] - rect[0]) * k), px((r[1] - rect[1]) * k)),
                                size: size(px(r[2] * k), px(r[3] * k)),
                            };
                            for item in items {
                                crate::canvas::record(
                                    &item.id,
                                    || item.value.clone(),
                                    at(item.rect),
                                );
                            }
                            PLACED.with(|p| {
                                *p.borrow_mut() = Some(Placed {
                                    session: session.clone(),
                                    rect: *rect,
                                    at: panel,
                                })
                            });
                            if let Some(found) = found {
                                crate::find::bring(at(found), window, cx);
                            }
                            window.with_content_mask(Some(ContentMask { bounds: panel }), |w| {
                                for r in outline.iter().chain(&found) {
                                    w.paint_quad(quad(
                                        at(*r),
                                        px(0.),
                                        transparent_black(),
                                        s.hairline,
                                        focus,
                                        BorderStyle::Solid,
                                    ));
                                }
                            });
                        }
                    },
                )
                .size_full(),
            )
    }
}

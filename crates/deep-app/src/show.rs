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

use std::collections::BTreeSet;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use gpui_kit::*;
use serde_json::{json, Value};

use crate::hub::{HubClient, HubError};
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
}

impl Presented {
    pub fn from_json(v: &Value) -> Option<Presented> {
        let rect: Vec<f32> = v["rect"]
            .as_array()?
            .iter()
            .map(|n| n.as_f64().map(|n| n as f32))
            .collect::<Option<_>>()?;
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
                })
            })
            .collect::<Option<_>>()?;
        Some(Presented {
            doc: v["doc"].as_str()?.to_string(),
            rev: v["rev"].as_u64()?,
            rect: <[f32; 4]>::try_from(rect.as_slice()).ok()?,
            layers,
            session: v["session"].as_str().map(str::to_string),
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
    pub fn take(&mut self) -> Result<Vec<Presented>, HubError> {
        let reply = self.client.call("canvas.drawn", json!({}))?;
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

/// The panel's view: the newest presented revision of each document, composed in its bands.
pub struct CanvasPanel {
    evidence: PathBuf,
    shown: Vec<Presented>,
    /// The session whose page shows the panel; with none, every revision draws.
    session: Option<String>,
    pictures: Vec<Picture>,
    /// Painted pictures no shown revision uses any more, freed from the GPU the next time the panel draws.
    unused: Vec<Arc<RenderImage>>,
    /// Revisions whose pictures are being decoded, the newest of each panel, and the pictures in decoding.
    waiting: Vec<Presented>,
    decoding: BTreeSet<String>,
    /// #1485's fixture: the pictures the last frame painted, in paint order.
    #[cfg(feature = "canvas-fixture")]
    pub(crate) painted: Vec<String>,
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
            #[cfg(feature = "canvas-fixture")]
            painted: Vec::new(),
        }
    }

    /// Whether `session` has anything to show, as its page asks.
    pub fn shows(&self, session: &str) -> bool {
        self.shown.iter().any(|p| of(p, session))
    }

    /// The session whose page draws the panel.
    pub fn show_session(&mut self, session: &str) {
        self.session = Some(session.to_owned());
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

    /// A picture's decoding ended: every waiting revision none of whose pictures is still in decoding is shown, a
    /// picture that didn't decode drawn as none.
    fn decoded(&mut self, sha: String, image: Option<Arc<RenderImage>>) {
        self.decoding.remove(&sha);
        if let Some(image) = image {
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
            if !keep && h.painted {
                unused.push(h.image.clone());
            }
            keep
        });
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
            let (kept, took) = cx
                .background_spawn(async move {
                    let root = crate::hub::root();
                    let token = root.join("control.token");
                    let mut hub =
                        hub.or_else(|| Presentations::open(&crate::hub::address(), &token).ok());
                    let took = hub.as_mut().map(Presentations::take);
                    (hub, took)
                })
                .await;
            hub = kept;
            match took {
                Some(Ok(presented)) if !presented.is_empty() => cx.update(|cx| {
                    panel.update(cx, |panel, cx| {
                        presented.into_iter().for_each(|p| panel.present(p, cx))
                    });
                    cx.refresh_windows();
                }),
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
    fn render(&mut self, window: &mut Window, _: &mut Context<Self>) -> impl IntoElement {
        for image in self.unused.drain(..) {
            let _ = window.drop_image(image);
        }
        let mut layers: Vec<Composed> = Vec::new();
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
        // Every picture held is a shown revision's, so this frame paints them all.
        for held in &mut self.pictures {
            held.painted = true;
        }
        let names: Vec<Label> = layers
            .iter()
            .filter_map(|(_, _, n)| n.clone().map(Label::new))
            .collect();
        let chrome = crate::chrome::of(window);
        let (muted, ground) = (chrome.ink_secondary, chrome.ground);
        let s = crate::chrome::sizes();
        div().size_full().child(
            canvas(
                move |_, window, _| {
                    for label in &names {
                        deep_text_gpui::prepare(label, window.scale_factor());
                    }
                },
                move |area, _, window, _| {
                    for (rect, picture, name) in &layers {
                        let panel = &bounds(*rect, area);
                        window.with_content_mask(Some(ContentMask { bounds: *panel }), |w| {
                            if let Some(picture) = picture {
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
                },
            )
            .size_full(),
        )
    }
}

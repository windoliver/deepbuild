//! Issue #806: the app's canvas panel. The hub presents each revision an agent's deep_show or a `deep show` makes
//! current: the document's panel and every layer on it, back to front, each with its owner, band, outline, name, the
//! items it holds and its picture, rasterized by the canvas core and kept in the evidence store by hash. The panel
//! takes what was presented from the hub as the app (`canvas.drawn`), composes the layers in their bands inside the
//! panel's rect, outlines an agent's layer with its session's name, and draws the question card's slot last, which
//! nothing covers. What it drew is what it reports: one entry per presented revision.

use std::path::{Path, PathBuf};
use std::sync::Arc;

use gpui_kit::*;
use serde_json::{json, Value};

use crate::hub::{HubClient, HubError};
use deep_text_gpui::{measure, paint_label, Label};

/// The outline around an agent's layer, and its name tab, in px.
const OUTLINE_PX: f32 = 1.;
const NAME_TAB: f32 = 18.;

/// One layer as the panel composes it: its panel's bounds, its picture and the name its outline shows.
type Composed = (Bounds<Pixels>, Option<Arc<RenderImage>>, Option<String>);

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

/// The panel's view: the newest presented revision of each document, composed in its bands.
pub struct CanvasPanel {
    evidence: PathBuf,
    shown: Vec<Presented>,
    pictures: Vec<(String, Arc<RenderImage>)>,
}

impl CanvasPanel {
    pub fn new(evidence: PathBuf) -> CanvasPanel {
        CanvasPanel {
            evidence,
            shown: Vec::new(),
            pictures: Vec::new(),
        }
    }

    /// Takes one presented revision: its panel now shows it, replacing what it showed before.
    pub fn present(&mut self, p: Presented) {
        for layer in &p.layers {
            if let Some(sha) = &layer.picture {
                if !self.pictures.iter().any(|(s, _)| s == sha) {
                    if let Some(img) = picture(&self.evidence, sha) {
                        self.pictures.push((sha.clone(), img));
                    }
                }
            }
        }
        self.shown.retain(|s| s.rect != p.rect);
        self.shown.push(p);
    }

    fn image(&self, sha: &str) -> Option<Arc<RenderImage>> {
        self.pictures
            .iter()
            .find(|(s, _)| s == sha)
            .map(|(_, i)| i.clone())
    }
}

/// A PNG from the evidence store as the BGRA picture GPUI paints.
fn picture(evidence: &Path, sha: &str) -> Option<Arc<RenderImage>> {
    let bytes = std::fs::read(evidence.join(&sha[..2]).join(&sha[2..])).ok()?;
    let mut rgba = image::load_from_memory_with_format(&bytes, image::ImageFormat::Png)
        .ok()?
        .to_rgba8();
    for p in rgba.as_chunks_mut::<4>().0 {
        p.swap(0, 2);
    }
    Some(Arc::new(RenderImage::new([image::Frame::new(rgba)])))
}

fn bounds(r: [f32; 4]) -> Bounds<Pixels> {
    Bounds {
        origin: point(px(r[0]), px(r[1])),
        size: size(px(r[2]), px(r[3])),
    }
}

impl Render for CanvasPanel {
    fn render(&mut self, _: &mut Window, _: &mut Context<Self>) -> impl IntoElement {
        let mut layers: Vec<Composed> = Vec::new();
        for p in &self.shown {
            for l in &p.layers {
                let name = (l.band == "agent" && l.outline)
                    .then(|| l.name.clone())
                    .flatten();
                layers.push((
                    bounds(p.rect),
                    l.picture.as_deref().and_then(|s| self.image(s)),
                    name,
                ));
            }
        }
        let names: Vec<Label> = layers
            .iter()
            .filter_map(|(_, _, n)| n.clone().map(Label::new))
            .collect();
        let muted = hsla(0., 0., 0.55, 1.);
        let ground = hsla(0., 0., 1., 1.);
        div().size_full().child(
            canvas(
                move |_, window, _| {
                    for label in &names {
                        deep_text_gpui::prepare(label, window.scale_factor());
                    }
                },
                move |_, _, window, _| {
                    for (panel, picture, name) in &layers {
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
                                    px(OUTLINE_PX),
                                    muted,
                                    BorderStyle::Solid,
                                ));
                                let label = Label::new(name.clone());
                                let tab = Bounds {
                                    origin: panel.origin,
                                    size: size(measure(&label).width + px(12.), px(NAME_TAB)),
                                };
                                w.paint_quad(gpui_kit::fill(tab, muted));
                                paint_label(
                                    panel.origin + point(px(6.), px(1.)),
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

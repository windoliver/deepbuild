//! DeepBuild patch (windoliver/deepbuild#1434): chrome layers, so the app's own surfaces can carry
//! GPU effects. GPUI multiplies opacity into each paint, reads nothing drawn beneath an element and
//! has no slot between two elements; these three primitives add that:
//!
//! - a layer: an element's subtree drawn into its own scene, rendered offscreen and composited
//!   once, with group opacity, rounded clip radii and a soft edge;
//! - a backdrop: a copy of what is drawn so far under an effect's bounds, at full, half or
//!   quarter scale, which the effect's operator reads;
//! - an effect slot: a shipped operator's output drawn at the element's own place in paint
//!   order, premultiplied, with its clip and edge. An effect names its operator; it never
//!   carries shader text, and the renderer refuses a name the app didn't register.
//!
//! A layer's subtree is recorded in the root scene's paint operations between two markers, so a
//! cached view replays it as it does any paint, while its primitives go to the layer's own scene.

use std::sync::Arc;

use crate::{Bounds, ContentMask, Corners, DrawOrder, ScaledPixels, SharedString};

use super::{PaintOperation, Primitive, Scene};

/// How a layer composites: its group opacity, its clip's corner radii and its soft edge, the
/// width over which its coverage falls from 1 inside to 0 at the clip, in device pixels.
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct ChromeLayer {
    /// 0 to 1, applied once to the composited group.
    pub opacity: f32,
    /// The clip's corner radii.
    pub radii: Corners<ScaledPixels>,
    /// The soft edge's width; 0 is a hard (antialiased) edge.
    pub edge: ScaledPixels,
}

/// The scale a backdrop copy is read at.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum BackdropScale {
    /// Every device pixel.
    Full,
    /// Half the width and height.
    Half,
    /// A quarter of the width and height.
    Quarter,
}

impl BackdropScale {
    /// The scale as a factor: 1, 0.5 or 0.25.
    pub fn factor(self) -> f32 {
        match self {
            BackdropScale::Full => 1.0,
            BackdropScale::Half => 0.5,
            BackdropScale::Quarter => 0.25,
        }
    }

    /// The scale for a factor of exactly 1, 0.5 or 0.25.
    pub fn from_factor(factor: f32) -> Option<Self> {
        [Self::Full, Self::Half, Self::Quarter]
            .into_iter()
            .find(|scale| scale.factor() == factor)
    }
}

/// An effect slot: a shipped operator, by the name the app registered it under, with its
/// parameters, and the backdrop it reads.
#[derive(Clone, Debug, PartialEq)]
pub struct ChromeEffect {
    /// The effect's own name, which a refusal names.
    pub name: SharedString,
    /// The registered operator it runs.
    pub operator: SharedString,
    /// The operator's parameters, in its declared order.
    pub params: Vec<f32>,
    /// The backdrop copy the operator reads, if any.
    pub backdrop: Option<BackdropScale>,
    /// The capture it reads that copy from, taken earlier in paint order; with none, the copy is
    /// taken at the effect's own place.
    pub captured: Option<u64>,
    /// The clip's corner radii.
    pub radii: Corners<ScaledPixels>,
    /// The soft edge's width.
    pub edge: ScaledPixels,
}

/// What a chrome primitive draws.
#[derive(Clone)]
pub enum ChromeKind {
    /// A layer's finished scene, composited once.
    Layer(ChromeLayer, Arc<Scene>),
    /// An effect slot.
    Effect(ChromeEffect),
    /// A backdrop copy taken here, under the bounds, for a later effect to read by its key.
    Backdrop(BackdropScale, u64),
}

/// One chrome primitive at its place in paint order.
#[derive(Clone)]
pub struct ChromePrimitive {
    /// Its draw order in the scene that holds it.
    pub order: DrawOrder,
    /// Its bounds, in device pixels.
    pub bounds: Bounds<ScaledPixels>,
    /// The element's or panel's mask, which it never draws outside.
    pub content_mask: ContentMask<ScaledPixels>,
    /// What it draws.
    pub kind: ChromeKind,
}

/// A layer as it opens: what the root scene's marker carries.
#[derive(Clone, Debug, PartialEq)]
pub struct OpenChrome {
    /// The layer's bounds, in device pixels.
    pub bounds: Bounds<ScaledPixels>,
    /// The mask in force where it opened.
    pub content_mask: ContentMask<ScaledPixels>,
    /// How it composites.
    pub layer: ChromeLayer,
}

/// The layers open while a frame paints, innermost last, each with the scene its subtree draws to.
#[derive(Default)]
pub(super) struct ChromeState {
    open: Vec<(OpenChrome, Scene)>,
    /// Surfaces no effect may cover, by name, this frame.
    guarded: Vec<(SharedString, Bounds<ScaledPixels>)>,
    /// The last backdrop capture's key.
    captures: u64,
}

impl Scene {
    /// Opens a layer: until it closes, primitives go to its own scene.
    pub fn push_chrome_layer(&mut self, open: OpenChrome) {
        self.paint_operations
            .push(PaintOperation::StartChrome(open.clone()));
        self.chrome_state.open.push((open, Scene::default()));
    }

    /// Closes the innermost layer and places it, as one primitive, where it opened.
    pub fn pop_chrome_layer(&mut self) {
        let Some((open, mut scene)) = self.chrome_state.open.pop() else {
            return;
        };
        self.paint_operations.push(PaintOperation::EndChrome);
        scene.paint_operations.clear();
        scene.finish();
        let primitive = ChromePrimitive {
            order: 0,
            bounds: open.bounds,
            content_mask: open.content_mask,
            kind: ChromeKind::Layer(open.layer, Arc::new(scene)),
        };
        match self.chrome_state.open.last_mut() {
            Some((_, parent)) => parent.place_chrome(primitive),
            None => self.place_chrome(primitive),
        }
    }

    /// Whether a layer is open.
    pub fn in_chrome_layer(&self) -> bool {
        !self.chrome_state.open.is_empty()
    }

    /// While a layer is open, a primitive goes to its scene and only its paint operation stays
    /// here; otherwise it comes back to be inserted here.
    pub(super) fn chrome_redirect(&mut self, primitive: Primitive) -> Option<Primitive> {
        let Some((_, scene)) = self.chrome_state.open.last_mut() else {
            return Some(primitive);
        };
        scene.insert_primitive(primitive.clone());
        self.paint_operations
            .push(PaintOperation::Primitive(primitive));
        None
    }

    /// While a layer is open, a paint layer opens or closes in its scene.
    pub(super) fn chrome_paint_layer(&mut self, bounds: Option<Bounds<ScaledPixels>>) -> bool {
        let Some((_, scene)) = self.chrome_state.open.last_mut() else {
            return false;
        };
        match bounds {
            Some(bounds) => {
                scene.push_layer(bounds);
                self.paint_operations
                    .push(PaintOperation::StartLayer(bounds));
            }
            None => {
                scene.pop_layer();
                self.paint_operations.push(PaintOperation::EndLayer);
            }
        }
        true
    }

    fn place_chrome(&mut self, mut primitive: ChromePrimitive) {
        let clipped = primitive.bounds.intersect(&primitive.content_mask.bounds);
        if clipped.is_empty() {
            return;
        }
        primitive.order = self
            .layer_stack
            .last()
            .copied()
            .unwrap_or_else(|| self.primitive_bounds.insert(clipped));
        self.chrome.push(primitive);
    }
}

impl From<ChromePrimitive> for Primitive {
    fn from(primitive: ChromePrimitive) -> Self {
        Primitive::Chrome(primitive)
    }
}

/// An effect that would have drawn over a guarded surface, such as the question card or an
/// access prompt: refused, so it drew nothing.
#[derive(Clone, Debug, PartialEq)]
pub struct ChromeRefusal {
    /// The effect's name.
    pub effect: SharedString,
    /// The guarded surface's name.
    pub over: SharedString,
}

static EFFECTS_LAST: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);

/// Plants the wrong program the card's acceptance test must catch: every effect composites after
/// the window's last paint, over the question card, instead of at its element's place.
pub fn plant_effects_after_frame() {
    EFFECTS_LAST.store(true, std::sync::atomic::Ordering::SeqCst);
}

static READS_BACKDROPS: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);

/// Whether any scene in this process has read a backdrop: from then on a window's renderer keeps
/// what it draws readable, so a copy can be taken from it.
pub fn chrome_reads_backdrops() -> bool {
    READS_BACKDROPS.load(std::sync::atomic::Ordering::Relaxed)
}

impl Scene {
    /// Takes a backdrop copy here, under `bounds`, and gives the key an effect reads it by.
    pub fn insert_chrome_backdrop(
        &mut self,
        bounds: Bounds<ScaledPixels>,
        content_mask: ContentMask<ScaledPixels>,
        scale: BackdropScale,
    ) -> u64 {
        READS_BACKDROPS.store(true, std::sync::atomic::Ordering::Relaxed);
        self.chrome_state.captures += 1;
        let key = self.chrome_state.captures;
        self.insert_primitive(ChromePrimitive {
            order: 0,
            bounds,
            content_mask,
            kind: ChromeKind::Backdrop(scale, key),
        });
        key
    }

    /// Guards a surface for this frame: no effect painted in it may cover it, before or after it.
    pub fn guard_from_chrome(&mut self, name: SharedString, bounds: Bounds<ScaledPixels>) {
        self.chrome_state.guarded.push((name, bounds));
    }

    /// Inserts an effect, unless it would cover a guarded surface: then it's refused, logged and
    /// drawn nowhere, and the refusal comes back for the app to record.
    pub fn insert_chrome_effect(
        &mut self,
        bounds: Bounds<ScaledPixels>,
        content_mask: ContentMask<ScaledPixels>,
        effect: ChromeEffect,
    ) -> Result<(), ChromeRefusal> {
        let drawn = bounds.intersect(&content_mask.bounds);
        let over = self
            .chrome_state
            .guarded
            .iter()
            .find(|(_, guarded)| !drawn.is_empty() && drawn.intersects(guarded));
        if let Some((over, _)) = over {
            let refusal = ChromeRefusal {
                effect: effect.name.clone(),
                over: over.clone(),
            };
            log::warn!("chrome effect {} refused: it would draw over {}", refusal.effect, refusal.over);
            return Err(refusal);
        }
        if effect.backdrop.is_some() {
            READS_BACKDROPS.store(true, std::sync::atomic::Ordering::Relaxed);
        }
        self.insert_primitive(ChromePrimitive {
            order: 0,
            bounds,
            content_mask,
            kind: ChromeKind::Effect(effect),
        });
        if EFFECTS_LAST.load(std::sync::atomic::Ordering::SeqCst) && !self.in_chrome_layer() {
            if let Some(last) = self.chrome.last_mut() {
                last.order = DrawOrder::MAX - 1;
            }
        }
        Ok(())
    }
}

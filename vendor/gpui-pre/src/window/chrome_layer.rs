//! DeepBuild patch (windoliver/deepbuild#1434): the paint calls for chrome layers, backdrops and
//! effect slots (`scene::chrome`). Each runs at its element's place in paint order and in the
//! element's content mask, so it never draws outside its element or panel.

use crate::{
    BackdropScale, Bounds, ChromeEffect, ChromeLayer, ChromeRefusal, Corners, OpenChrome, Pixels,
    ScaledPixels, SharedString, Window,
};

static MULTIPLIES_PER_ELEMENT: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);

/// Plants the wrong program a layer's acceptance test must catch: a layer that multiplies its
/// opacity into each element's paint, as GPUI's own opacity does, instead of compositing once.
pub fn plant_multiplies_per_element() {
    MULTIPLIES_PER_ELEMENT.store(true, std::sync::atomic::Ordering::SeqCst);
}

impl Window {
    /// Paints `f`'s subtree into a layer that composites once, at `opacity`, clipped to `bounds`
    /// with corner `radii` and a soft `edge`. Opacity inside it applies within the group.
    pub fn paint_chrome_layer<R>(
        &mut self,
        bounds: Bounds<Pixels>,
        opacity: f32,
        radii: Corners<Pixels>,
        edge: Pixels,
        f: impl FnOnce(&mut Self) -> R,
    ) -> R {
        self.invalidator.debug_assert_paint();
        if MULTIPLIES_PER_ELEMENT.load(std::sync::atomic::Ordering::SeqCst) {
            return self.with_element_opacity(Some(opacity), f);
        }
        let scale = self.scale_factor();
        // The group takes the opacity its ancestors paint at, once; its subtree starts at 1.
        let previous = std::mem::replace(&mut self.element_opacity, 1.0);
        let open = OpenChrome {
            bounds: self.snap_bounds(bounds),
            content_mask: self.snapped_content_mask(),
            layer: ChromeLayer {
                opacity: opacity.clamp(0.0, 1.0) * previous,
                radii: radii.scale(scale),
                edge: ScaledPixels(edge.0 * scale),
            },
        };
        self.next_frame.scene.push_chrome_layer(open);
        let result = f(self);
        self.element_opacity = previous;
        self.next_frame.scene.pop_chrome_layer();
        result
    }

    /// Paints an effect slot at this place in paint order: the registered `operator` with its
    /// `params`, reading a backdrop copy at `backdrop`'s scale if given, clipped to `bounds` with
    /// corner `radii` and a soft `edge`. Refused, recorded and drawn nowhere if it would cover a
    /// guarded surface. With `captured`, the operator reads that earlier capture.
    #[allow(clippy::too_many_arguments)]
    pub fn paint_chrome_effect(
        &mut self,
        bounds: Bounds<Pixels>,
        name: SharedString,
        operator: SharedString,
        params: Vec<f32>,
        backdrop: Option<BackdropScale>,
        captured: Option<u64>,
        radii: Corners<Pixels>,
        edge: Pixels,
    ) -> Result<(), ChromeRefusal> {
        self.invalidator.debug_assert_paint();
        let scale = self.scale_factor();
        let effect = ChromeEffect {
            name,
            operator,
            params,
            backdrop,
            captured,
            radii: radii.scale(scale),
            edge: ScaledPixels(edge.0 * scale),
        };
        let bounds = self.snap_bounds(bounds);
        let content_mask = self.snapped_content_mask();
        self.next_frame
            .scene
            .insert_chrome_effect(bounds, content_mask, effect)
    }

    /// Takes a backdrop copy here, under `bounds`, at `scale`, for an effect painted later to read
    /// by the key this gives, so it reads what was drawn before the element it belongs to.
    pub fn paint_chrome_backdrop(&mut self, bounds: Bounds<Pixels>, scale: BackdropScale) -> u64 {
        self.invalidator.debug_assert_paint();
        let bounds = self.snap_bounds(bounds);
        let content_mask = self.snapped_content_mask();
        self.next_frame
            .scene
            .insert_chrome_backdrop(bounds, content_mask, scale)
    }

    /// Guards `bounds` for this frame, as the question card and access prompts do: an effect
    /// painted after it that would cover it is refused, naming `name`. The window's root guards
    /// first, so every effect in the frame, a deferred one or one under the guard, is checked.
    pub fn guard_from_chrome(&mut self, name: impl Into<SharedString>, bounds: Bounds<Pixels>) {
        let bounds = self.cover_bounds(bounds);
        self.next_frame.scene.guard_from_chrome(name.into(), bounds);
    }
}

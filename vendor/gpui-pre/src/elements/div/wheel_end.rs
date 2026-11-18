//! DeepBuild patch (windoliver/deepbuild#1482): a wheel past the end of a scrolled element moves nothing, so it
//! notifies nothing. The wheel listener held the offset unclamped until the next prepaint clamped it back, so every
//! event at an end changed the offset, notified the view and drew a frame for nothing, a momentum tail's included.
//! The listener now clamps as `clamp_scroll_position` will, and an offset that didn't move notifies nothing.

use super::Interactivity;
use crate::{Bounds, Pixels, Point, Style, Window, px, size};

impl Interactivity {
    /// The furthest this element scrolls, as `clamp_scroll_position` reads it at prepaint.
    pub(super) fn scroll_max(
        &self,
        bounds: Bounds<Pixels>,
        style: &Style,
        window: &Window,
    ) -> Point<Pixels> {
        let rem_size = window.rem_size();
        let padding = style
            .padding
            .to_pixels(bounds.size.into(), rem_size)
            .map(|edge| window.pixel_snap(*edge));
        let padding_size = size(padding.left + padding.right, padding.top + padding.bottom);
        Point::from(self.content_size + padding_size - bounds.size)
            .map(|pixels| (pixels * 100.).round() / 100.)
            .max(&Default::default())
    }
}

/// `offset` held within `max`, as the next prepaint would hold it.
pub(super) fn clamp(offset: Point<Pixels>, max: Point<Pixels>) -> Point<Pixels> {
    Point {
        x: offset.x.clamp(-max.x, px(0.)),
        y: offset.y.clamp(-max.y, px(0.)),
    }
}

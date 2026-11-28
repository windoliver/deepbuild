//! DeepBuild patch (windoliver/deepbuild#1482): a wheel past the end of a scrolled element moves nothing, so it
//! notifies nothing. gpui-fast's listener returns for a wheel that can't move the offset, but one that moves it past
//! an end held the offset unclamped until the next prepaint clamped it back, so the next event at that end moved it
//! again, notified the view and drew a frame for nothing. The listener now clamps as `clamp_scroll_position` will.

use crate::{Pixels, Point, px};

/// `offset` held within `max`, as the next prepaint would hold it.
pub(super) fn clamp(offset: Point<Pixels>, max: Point<Pixels>) -> Point<Pixels> {
    Point {
        x: offset.x.clamp(-max.x, px(0.)),
        y: offset.y.clamp(-max.y, px(0.)),
    }
}

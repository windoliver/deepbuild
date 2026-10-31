//! Issue #390: the canvas's text in the app. A label or readout is shaped by the one shaper and
//! drawn by deep-text-gpui from the canvas's own atlas through the GPUI patch's tinted mask
//! sprite, never GPUI's text system (which stays for the chrome). Like every canvas item, it
//! records what it drew for a replica's snapshot: its text, where its box is and what its paint
//! did.

pub use deep_text_gpui::{measure, Label, Shaped};
use gpui_kit::*;
use serde_json::json;
use std::sync::Arc;

use crate::canvas::record;

/// A label as a canvas element. Its box is the wider of its text and `widest`, the string a
/// readout must hold, such as a bound value's widest form, so a readout keeps its place as its
/// value changes; the text is drawn whole in it.
pub fn label(id: &str, label: Label, color: Hsla, widest: Option<&str>) -> Canvas<Arc<Shaped>> {
    let id = id.to_owned();
    let widest = widest.map(str::to_owned);
    let own = measure(&label).width;
    let reserved = widest.as_deref().map_or(px(0.), |widest| {
        measure(&Label {
            text: widest.to_owned(),
            ..label.clone()
        })
        .width
    });
    let width = f32::from(own.max(reserved));
    let label = Label {
        width: Some(width),
        ..label
    };
    let height = measure(&label).height;
    let prepared = label.clone();
    canvas(
        // Glyphs placed before any label is painted, so a page goes up once a frame.
        move |_, window, _| {
            deep_text_gpui::prepare(&prepared, window.scale_factor());
            deep_text_gpui::shape(&prepared)
        },
        move |bounds, shaped, window, _| {
            let painted = deep_text_gpui::paint_label(bounds.origin, &label, color, window);
            record(
                &id,
                json!({
                    "text": label.text,
                    "role": label.role.name(),
                    "bound": label.bound,
                    "widest": widest,
                    "at": [f32::from(bounds.origin.x), f32::from(bounds.origin.y)],
                    "box": [width, f32::from(height)],
                    "width": shaped.width,
                    "lines": shaped.lines,
                    "ellipsized": shaped.ellipsized,
                    "sprites": painted.sprites,
                    "pages": painted.pages.iter().map(|(page, _)| *page).collect::<Vec<_>>(),
                }),
                bounds,
            );
        },
    )
    .w(px(width))
    .h(height)
}

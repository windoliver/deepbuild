//! Where status marks, their labels and the legend go, for every renderer: GPUI's live view and
//! Vello CPU's rasters draw the same boxes and labels (canvas primitives: The status-color rule;
//! Status binding). Status marks draw after every writer layer and nothing covers them; the legend
//! of every state on screen takes the first corner clear of items and marks.

use deep_canvas_marks::look;
use deep_canvas_marks::scene::{self, Align, Mark, Rgb, Slot, StatusMark};
use deep_text::Role;
use deep_text_gpui::Label;
use serde_json::{json, Value};

/// A status mark's label: the glyph and word, in the body face at this size and weight.
const STATUS_LABEL: (f32, u16) = (12., 600);
/// A stroke's or a badge's chip: its glyph's size and weight, and the chip's height in u.
const STATUS_CHIP: (f32, u16) = (11., 600);
const CHIP_HEIGHT: f64 = 16.;
/// The legend's rows, its swatch and its margin from the frame's top right, in u.
const LEGEND_ROW: f64 = 20.;
const LEGEND_SWATCH: f64 = 12.;
const LEGEND_MARGIN: f64 = 16.;

/// One thing a renderer draws for status, in u, in order.
pub enum Prim {
    /// A filled rect with corner radius `radius`.
    Fill {
        rect: [f64; 4],
        radius: f64,
        color: Rgb,
    },
    /// A ring `width` wide inside `rect`, with outer corner radius `radius`.
    Ring {
        rect: [f64; 4],
        radius: f64,
        width: f64,
        color: Rgb,
    },
    Text {
        label: Label,
        origin: [f64; 2],
        color: Rgb,
    },
}

/// A text mark's label, or `None` for a font role the shaper lacks.
pub fn label_of(spec: &scene::TextSpec) -> Option<Label> {
    Some(Label {
        role: Role::parse(&spec.font)?,
        size: spec.size as f32,
        weight: spec.weight,
        width: spec.width.map(|w| w as f32),
        bound: spec.bound,
        align: match spec.align {
            Align::Start => deep_text::Align::Start,
            Align::Center => deep_text::Align::Center,
            Align::End => deep_text::Align::End,
        },
        ..Label::new(spec.text.clone())
    })
}

/// A label in the body face that sizes to its text.
fn status_label(text: String, (size, weight): (f32, u16)) -> Label {
    Label {
        size,
        weight,
        ..Label::new(text)
    }
}

fn measure(label: &Label) -> (f64, f64) {
    let size = deep_text_gpui::measure(label);
    (f64::from(size.width), f64::from(size.height))
}

/// A box in u as pixels of the frame at `zoom`.
fn px_box(b: [f64; 4], zoom: f64) -> Value {
    json!(b.map(|v| v * zoom))
}

/// The box of every mark a frame draws that a legend would cover: rects, circles, images and
/// texts (their box's width, or their run's, and their run's height), in u.
pub fn occupied(frame: &scene::Frame) -> Vec<[f64; 4]> {
    frame
        .layers
        .iter()
        .flat_map(|l| l.marks.iter())
        .filter_map(|d| match &d.mark {
            Mark::Rect { bounds, .. } | Mark::Image { bounds, .. } => Some(*bounds),
            Mark::Circle { center, r, .. } => {
                Some([center[0] - r, center[1] - r, 2.0 * r, 2.0 * r])
            }
            Mark::Text { spec, origin, .. } => {
                let (w, h) = measure(&label_of(spec)?);
                Some([origin[0], origin[1], spec.width.unwrap_or(w), h])
            }
            Mark::Path { .. } | Mark::Shape { .. } => None,
        })
        .collect()
}

/// The status marks, their labels and the legend, over everything drawn: the legend first and the
/// marks after it, so nothing covers them; and the text snapshot of what they show (each mark's
/// state, color, glyph or word and their boxes, and each legend entry, in pixels of the frame).
pub fn layout(
    status: &[StatusMark],
    occupied: &[[f64; 4]],
    palette: &scene::Palette,
    size: [f64; 2],
    zoom: f64,
) -> (Vec<Prim>, Value) {
    let mut marks = Vec::with_capacity(status.len());
    // The marks' boxes keep the legend clear.
    let mut taken: Vec<[f64; 4]> = occupied.to_vec();
    let mut mark_prims: Vec<Prim> = Vec::new();
    for m in status {
        let [x, y, w, h] = m.bounds;
        // The colored core: the item's own box for a fill, a ring of `core` px around it for a
        // stroke, and for a stroke or a badge a chip at the top right corner carrying the glyph.
        let mut word = None;
        let (core, label, chip) = match m.slot {
            Slot::Fill => {
                // The glyph and the word inside the mark; the glyph alone where both don't fit.
                word = Some(m.word);
                let mut label = status_label(format!("{} {}", m.glyph, m.word), STATUS_LABEL);
                if measure(&label).0 > w - 8.0 {
                    word = None;
                    label = status_label(m.glyph.clone(), STATUS_LABEL);
                }
                (m.bounds, label, None)
            }
            Slot::Stroke | Slot::Badge => {
                let ring = match m.slot {
                    Slot::Stroke => [x - m.core, y - m.core, w + 2.0 * m.core, h + 2.0 * m.core],
                    _ => m.bounds,
                };
                let label = status_label(m.glyph.clone(), STATUS_CHIP);
                let gw = measure(&label).0;
                let ch = CHIP_HEIGHT.max(m.core);
                let cw = ch.max(gw + 8.0);
                let chip = [ring[0] + ring[2] - cw / 2.0, ring[1] - ch / 2.0, cw, ch];
                (ring, label, Some(chip))
            }
        };
        let outline = |prims: &mut Vec<Prim>, b: [f64; 4], r: f64| {
            if let Some((px_w, color)) = m.outline {
                prims.push(Prim::Ring {
                    rect: [
                        b[0] - px_w,
                        b[1] - px_w,
                        b[2] + 2.0 * px_w,
                        b[3] + 2.0 * px_w,
                    ],
                    radius: r + px_w,
                    width: px_w,
                    color,
                });
            }
        };
        if m.slot == Slot::Stroke {
            outline(&mut mark_prims, core, m.radius + m.core);
            mark_prims.push(Prim::Ring {
                rect: core,
                radius: m.radius + m.core,
                width: m.core,
                color: m.color,
            });
        } else if m.slot == Slot::Fill {
            outline(&mut mark_prims, core, m.radius);
            mark_prims.push(Prim::Fill {
                rect: core,
                radius: m.radius,
                color: m.color,
            });
        }
        let host = match chip {
            Some(c) => {
                outline(&mut mark_prims, c, c[3] / 2.0);
                mark_prims.push(Prim::Fill {
                    rect: c,
                    radius: c[3] / 2.0,
                    color: m.color,
                });
                c
            }
            None => core,
        };
        let (tw, th) = measure(&label);
        let origin = [
            (host[0] + (host[2] - tw) / 2.0).round(),
            (host[1] + (host[3] - th) / 2.0).round(),
        ];
        mark_prims.push(Prim::Text {
            label,
            origin,
            color: m.ink,
        });
        taken.push(core);
        taken.extend(chip);
        marks.push(json!({
            "item": m.item, "binding": m.binding, "slot": m.slot.name(), "state": m.state,
            "color": m.color, "bounds": px_box(core, zoom), "chip": chip.map(|c| px_box(c, zoom)),
            "glyph": m.glyph, "word": word, "label": px_box([origin[0], origin[1], tw, th], zoom),
        }));
    }
    // The legend: every state on screen, in the status map's order.
    let mut prims = Vec::new();
    let mut legend = Vec::new();
    let on_screen: Vec<&StatusMark> = look::STATES
        .iter()
        .filter_map(|s| status.iter().find(|m| m.state == *s))
        .collect();
    let ink = palette.get("ink").copied().unwrap_or([0, 0, 0]);
    let labels: Vec<Label> = on_screen
        .iter()
        .map(|m| status_label(format!("{} {}", m.glyph, m.word), (12., 400)))
        .collect();
    let widest = labels.iter().map(|l| measure(l).0).fold(0.0, f64::max);
    // The first corner, top right first, whose box clears every item and status mark; else the
    // first that clears every status mark; else the top right.
    let (lw, lh) = (
        widest + LEGEND_SWATCH + 6.0,
        LEGEND_ROW * on_screen.len() as f64,
    );
    let (right, bottom) = (size[0] - LEGEND_MARGIN - lw, size[1] - LEGEND_MARGIN - lh);
    let corners = [
        [right, LEGEND_MARGIN],
        [right, bottom],
        [LEGEND_MARGIN, bottom],
        [LEGEND_MARGIN, LEGEND_MARGIN],
    ];
    let clear = |c: &[f64; 2], boxes: &[[f64; 4]]| {
        !boxes.iter().any(|b| {
            c[0] < b[0] + b[2] && b[0] < c[0] + lw && c[1] < b[1] + b[3] && b[1] < c[1] + lh
        })
    };
    let marks_only = &taken[occupied.len()..];
    let [x0, y0] = corners
        .iter()
        .find(|c| clear(c, &taken))
        .or_else(|| corners.iter().find(|c| clear(c, marks_only)))
        .copied()
        .unwrap_or(corners[0]);
    for (k, (m, label)) in on_screen.iter().zip(labels).enumerate() {
        let top = y0 + LEGEND_ROW * k as f64;
        let swatch = [
            x0,
            top + (LEGEND_ROW - LEGEND_SWATCH) / 2.0,
            LEGEND_SWATCH,
            LEGEND_SWATCH,
        ];
        prims.push(Prim::Fill {
            rect: swatch,
            radius: 0.0,
            color: m.color,
        });
        let th = measure(&label).1;
        prims.push(Prim::Text {
            label,
            origin: [
                x0 + LEGEND_SWATCH + 6.0,
                (top + (LEGEND_ROW - th) / 2.0).round(),
            ],
            color: ink,
        });
        legend.push(json!({
            "state": m.state, "glyph": m.glyph, "word": m.word, "color": m.color,
            "swatch": px_box(swatch, zoom),
        }));
    }
    prims.extend(mark_prims);
    (prims, json!({"marks": marks, "legend": legend}))
}

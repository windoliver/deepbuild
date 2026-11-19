//! Issue #1592: the chrome's one icon set and its status marks, both drawn, neither set in a font.
//!
//! An icon is one of the kit's icon set, drawn at one of two sizes, roles of the look: `icons.row` in the list and
//! `icons.page` in a page's chrome, its lines at the look's one stroke at either size. The set draws its lines 2 wide
//! on a 24 grid, so each icon is redrawn at the width its size needs for that stroke. A control that shows only an
//! icon keeps its name in the tree (#1453 rule 10): the control builder names the control, not the icon.
//!
//! A status mark is the look's drawn glyph for a status-map entry, in the mark's slot, tinted in the entry's color
//! (#1453 rule 5), its cut showing the fill under it. It's one shape, so no font's fallback sets its metrics.

use std::collections::HashMap;
use std::sync::{Arc, Mutex, OnceLock};

use deep_canvas_marks::look;
use gpui_kit::{assets::Assets, AssetSource as _, *};

use crate::chrome::{marks, sizes, Typed as _};
use crate::states;

/// Where an icon is drawn, which sets its size.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum Place {
    /// In a row or a heading of the list.
    Row,
    /// In a page's chrome.
    Page,
}

impl Place {
    /// The size an icon draws at here.
    pub fn size(self) -> Pixels {
        match self {
            Place::Row => sizes().icon_row,
            Place::Page => sizes().icon_page,
        }
    }
}

/// Needs you's control that pops the section out, on its heading in the list.
pub const POP_OUT: (&str, Place) = ("external-link", Place::Row);

/// Every icon the chrome draws and where, so a contact sheet can show each at its size.
pub const DRAWN: [(&str, Place); 1] = [POP_OUT];

/// The kit's icon `name` (`external-link`, …) at `place`'s size, its lines at the look's one stroke, in `color`.
pub fn icon(name: &'static str, place: Place, color: Hsla) -> Svg {
    svg()
        .data(&bytes(Drawing::Icon(name, place)))
        .size(place.size())
        .flex_none()
        .text_color(color)
}

/// #1592's planted page chrome: an icon of the set at 18 pt, a size no role gives.
pub fn planted_18(color: Hsla) -> Option<Svg> {
    crate::plain::planted("icon-18-on-page").then(|| {
        icon(POP_OUT.0, Place::Page, color).size(px(18.)) // size-literal-exception: #1592's planted wrong program, in an env-plants build only; review 2027-05-18
    })
}

/// The status mark for a status-map entry: its drawn glyph in the mark's slot, tinted in the entry's color, turned
/// `turns` quarter turns, as a working mark turns at each event (#2021).
pub fn mark(entry: &str, turns: usize) -> Div {
    mark_at(entry, sizes().mark, turns)
}

/// [`mark`] drawn `size` on a side, as a contact sheet enlarges it.
pub(crate) fn mark_at(entry: &str, size: Pixels, turns: usize) -> Div {
    let entry = look::STATES
        .into_iter()
        .find(|state| *state == entry)
        .unwrap_or("idle");
    let slot = div()
        .size(size)
        .flex_none()
        .flex()
        .items_center()
        .justify_center();
    // #1592's planted marks: the look's glyph set as text in the chrome's face, as marks were before, whose metrics
    // come from whichever font has the character; and a stale mark drawn in idle's shape.
    if crate::plain::planted("mark-as-font-glyph") {
        return slot.typed(sizes().body).child(states::glyph(entry));
    }
    let shape = if entry == "stale" && crate::plain::planted("stale-mark-as-idle") {
        "idle"
    } else {
        entry
    };
    let drawn = svg()
        .data(&bytes(Drawing::Mark(shape)))
        .size(size)
        .text_color(rgb(states::color(entry)));
    slot.child(if turns == 0 {
        drawn
    } else {
        drawn.with_transformation(Transformation::rotate(radians(
            std::f32::consts::FRAC_PI_2 * turns as f32,
        )))
    })
}

/// What a drawn SVG is: an icon of the set at a place, a status-map entry's mark, or the brand's artwork (#79).
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum Drawing {
    Icon(&'static str, Place),
    Mark(&'static str),
    Brand,
}

/// What the SVG whose atlas tile GPUI keyed by `path` is, when the chrome drew it as an icon, a status mark or the
/// brand's artwork: a replica reads its frame's sprites by it.
pub fn drawing(path: &str) -> Option<Drawing> {
    static BRAND: OnceLock<[String; 2]> = OnceLock::new();
    let brand = BRAND.get_or_init(|| {
        [
            tile_path(crate::brand::TITLE_BAR_MARK),
            tile_path(crate::brand::WELCOME_LOCKUP),
        ]
    });
    if brand.iter().any(|key| key == path) {
        return Some(Drawing::Brand);
    }
    drawings().lock().ok()?.keyed.get(path).copied()
}

/// The bytes each drawing is drawn from, and each drawing by the path GPUI keys its tile by.
#[derive(Default)]
struct Drawings {
    bytes: HashMap<Drawing, Arc<[u8]>>,
    keyed: HashMap<String, Drawing>,
}

fn drawings() -> &'static Mutex<Drawings> {
    static DRAWINGS: OnceLock<Mutex<Drawings>> = OnceLock::new();
    DRAWINGS.get_or_init(Default::default)
}

/// The SVG `drawing` is drawn from, made once: a kit icon with its lines as wide as the look's one stroke at its
/// place's size, or the look's mark for an entry.
fn bytes(drawing: Drawing) -> Arc<[u8]> {
    let mut all = drawings().lock().expect("the drawings");
    if let Some(bytes) = all.bytes.get(&drawing) {
        return bytes.clone();
    }
    let made: Arc<[u8]> = match drawing {
        Drawing::Icon(name, place) => {
            let source = Assets
                .load(&format!("icons/{name}.svg"))
                .ok()
                .flatten()
                .unwrap_or_else(|| panic!("the kit's icon set has {name}"));
            stroked(&String::from_utf8_lossy(&source), f32::from(place.size())).into()
        }
        Drawing::Mark(entry) => marks().svg(entry).unwrap_or_default().into_bytes().into(),
        Drawing::Brand => {
            unreachable!("the brand's artwork is drawn from its own bytes, never through here")
        }
    };
    all.keyed.insert(tile_path(&made), drawing);
    all.bytes.insert(drawing, made.clone());
    made
}

/// The path GPUI keys the atlas tile of an SVG drawn from `data` by, as `svg().data(..)` makes it.
fn tile_path(data: &[u8]) -> String {
    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    std::hash::Hash::hash(data, &mut hasher);
    format!("__binary_svg__{}", std::hash::Hasher::finish(&hasher))
}

/// An icon's SVG with every stroke width set so its lines draw `sizes().icon_stroke` wide at `size`: the width in its
/// own grid is the stroke times the grid's width over the size.
fn stroked(source: &str, size: f32) -> Vec<u8> {
    let grid = source
        .split_once("viewBox=\"")
        .and_then(|(_, rest)| rest.split('"').next())
        .and_then(|view| view.split_whitespace().nth(2))
        .and_then(|width| width.parse::<f32>().ok())
        .unwrap_or(size);
    let width = sizes().icon_stroke * grid / size;
    let mut out = String::with_capacity(source.len());
    let mut rest = source;
    while let Some(at) = rest.find("stroke-width=\"") {
        let (before, after) = rest.split_at(at + "stroke-width=\"".len());
        out.push_str(before);
        out.push_str(&format!("{width}"));
        rest = after.split_once('"').map_or("", |(_, tail)| tail);
        out.push('"');
    }
    out.push_str(rest);
    out.into_bytes()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[std::prelude::v1::test]
    fn an_icon_draws_the_one_stroke_at_either_size() {
        let source = r#"<svg width="24" height="24" viewBox="0 0 24 24" stroke-width="2"><path d="M4 12h16"/></svg>"#;
        let stroke = sizes().icon_stroke;
        for size in [sizes().icon_row, sizes().icon_page] {
            let size = f32::from(size);
            let out = String::from_utf8(stroked(source, size)).unwrap();
            let width: f32 = out
                .split("stroke-width=\"")
                .nth(1)
                .and_then(|w| w.split('"').next())
                .unwrap()
                .parse()
                .unwrap();
            // Drawn at `size`, a line `width` wide on the 24 grid is the look's one stroke.
            assert!(
                (width * size / 24. - stroke).abs() < 1e-4,
                "{size}: {width}"
            );
            assert!(out.ends_with(r#"<path d="M4 12h16"/></svg>"#));
        }
    }

    #[std::prelude::v1::test]
    fn every_icon_the_chrome_draws_is_in_the_kit_s_set_and_named_by_its_tile() {
        for (name, place) in DRAWN {
            let bytes = bytes(Drawing::Icon(name, place));
            assert!(!bytes.is_empty(), "{name}");
            assert_eq!(
                drawing(&tile_path(&bytes)),
                Some(Drawing::Icon(name, place))
            );
        }
        assert_eq!(
            drawing(&tile_path(crate::brand::TITLE_BAR_MARK)),
            Some(Drawing::Brand)
        );
    }
}

//! Issue #390: the canvas's text. One Rust shaper with bundled fonts measures and draws the
//! canvas's text on every platform (the stack Vello uses: parley over HarfRust and skrifa,
//! rasterized by Vello CPU), and where GPUI draws a 2D writer layer its glyphs come from the
//! atlas here, through the GPUI patch's tinted mask sprite, never from GPUI's text system.

pub mod atlas;
pub mod fonts;
pub mod shape;
pub mod unicode;

pub use atlas::{raster_size, Atlas, Page, Placed, PAGE, PAGES};
pub use fonts::{face_of, Face, Role, FACES};
pub use parley::FontData;
pub use shape::{Align, Fit, Glyph, Shaped, Shaper, Spec};
pub use unicode::{Bidi, Dir};

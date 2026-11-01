//! Issue #390: the canvas's text. One Rust shaper with bundled fonts measures and draws the
//! canvas's text on every platform (the stack Vello uses: parley over HarfRust and skrifa,
//! rasterized by Vello CPU), and where GPUI draws a 2D writer layer its glyphs come from the
//! atlas here, through the GPUI patch's tinted mask sprite, never from GPUI's text system.
//! Issue #856: its runs are kept in one shaped-run cache per process, and a long text shapes on
//! the render worker, which its host runs (#140: this crate starts no thread).

pub mod atlas;
pub mod cache;
pub mod fonts;
pub mod shape;
pub mod unicode;

pub use atlas::{raster_size, Atlas, Page, Placed, PAGE, PAGES, PHASES};
pub use fonts::{face_of, Face, Role, FACES};
pub use parley::FontData;
pub use shape::{Align, Fit, Glyph, Shaped, Shaper, Spec};
pub use unicode::{Bidi, Dir};

/// The fonts seam's backend (issue #140; canvas primitives: Seam and backend): bundled fonts only,
/// shaped by parley. Its name and version enter every text content key and result it feeds.
pub const FONTS: deep_canvas_seams::Backend = deep_canvas_seams::Backend {
    name: "fonts.bundled",
    version: if cfg!(feature = "test-fonts-next") {
        "1.0.1"
    } else {
        "1.0.0"
    },
};

//! Issue #402: the cells canvas module (canvas primitives: Cell grid `cells@1`). A terminal's
//! output becomes a grid of typed cells through [`emulator`], frames and row patches against a
//! revision, with the cursor, scroll, links and the terminal's title, cwd, progress and bells; a
//! clipboard read through the terminal's escape is refused and never answered. [`keys`] encodes a
//! key from the program's modes. [`palette`] keeps a
//! cell off the status colors wherever status can show, and [`module`] registers the grid's check
//! and drawing through the registry and seal, on the text module. [`recording`] converts a
//! terminal recording into keyframes and row patches and finds the grid it shows at a time.

pub mod emulator;
pub mod keys;
pub mod logic_grid;
pub mod module;
pub mod palette;
pub mod recording;

//! Issue #391: R1's 2D marks on the CPU, for the line (canvas primitives: Marks, data and
//! diagrams). A frame's draw list per writer layer, path tessellation by content key and zoom
//! bucket, and the content keys of shaped text and writer layers. GPUI draws the list in
//! deep-marks-render; nothing here touches the GPU.
//!
//! Issue #392: bound values with their as-of time, stale once older than `stale_after`; status
//! marks only through status bindings; and look@1 with the clean pipeline look and the status
//! guard ([`look`]).
//!
//! Issue #373: R2's 2D marks: every mark type in a mark set, stars, arcs, frames and groups,
//! gradients on fills and strokes ([`paint`]), soft masks and each item's adjust, with the module's
//! own check ([`check`]).

pub mod animator;
pub mod arrays;
pub mod atlas;
pub mod check;
pub mod code;
pub mod copy;
pub mod data;
pub mod dirty;
pub mod drawn;
pub mod ends;
pub mod fields;
pub mod finish;
pub mod function;
pub mod functions;
pub mod fx;
pub mod implicit;
pub mod key;
pub mod layout;
pub mod look;
pub mod modules;
pub mod outline;
pub mod outline_sources;
pub mod paint;
pub mod path;
pub mod pathops;
pub mod plural;
pub mod print;
pub mod relations;
pub mod runs;
pub mod scene;
pub mod story;
pub mod terrain;
pub mod turn;

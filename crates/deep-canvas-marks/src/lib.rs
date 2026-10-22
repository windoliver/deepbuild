//! Issue #391: R1's 2D marks on the CPU, for the line (canvas primitives: Marks, data and
//! diagrams). A frame's draw list per writer layer, path tessellation by content key and zoom
//! bucket, and the content keys of shaped text and writer layers. GPUI draws the list in
//! deep-marks-render; nothing here touches the GPU.
//!
//! Issue #392: bound values with their as-of time, stale once older than `stale_after`; status
//! marks only through status bindings; and look@1 with the clean pipeline look and the status
//! guard ([`look`]).

pub mod data;
pub mod dirty;
pub mod key;
pub mod look;
pub mod path;
pub mod scene;

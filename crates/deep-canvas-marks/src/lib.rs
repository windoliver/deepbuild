//! Issue #391: R1's 2D marks on the CPU, for the line (canvas primitives: Marks, data and
//! diagrams). A frame's draw list per writer layer, path tessellation by content key and zoom
//! bucket, and the content keys of shaped text and writer layers. GPUI draws the list in
//! deep-marks-render; nothing here touches the GPU.

pub mod data;
pub mod dirty;
pub mod key;
pub mod path;
pub mod scene;

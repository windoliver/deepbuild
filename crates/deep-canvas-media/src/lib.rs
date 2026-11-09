//! Issue #499: the media module's own processing code (canvas primitives: Sound and video on the
//! picture's clock). Audio runs through our own code with pinned math, so output is identical for
//! the same build and CPU architecture.

pub mod doc;
pub mod emitter;
pub mod fixtures;
pub mod eq;
pub mod frames;
pub mod module;
pub mod mix;
pub mod reverb;
pub mod ring;

/// One second in flicks.
pub const FLICKS: i64 = 705_600_000;

/// The wrong program a proof surface plants in this module's own check (#499 AC10): the
/// av_unlinked check comparing only `start`.
pub const PLANTED: [&str; 1] = ["av_link_compares_start_only"];

static PLANTED_NOW: std::sync::Mutex<Option<&'static str>> = std::sync::Mutex::new(None);

/// Plants one of [`PLANTED`] for the checks that follow, or none.
pub fn plant(name: Option<&str>) {
    let found = name.and_then(|n| PLANTED.iter().find(|p| **p == n).copied());
    *PLANTED_NOW.lock().unwrap_or_else(|e| e.into_inner()) = found;
}

/// Whether `name` is planted.
pub fn planted(name: &str) -> bool {
    *PLANTED_NOW.lock().unwrap_or_else(|e| e.into_inner()) == Some(name)
}

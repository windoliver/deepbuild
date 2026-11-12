//! Vello CPU's NEON level, which exists only on aarch64: an x86_64 build (the other machine a
//! check runs under Rosetta 2, #449) has none, as a machine without NEON has none.

use vello_cpu::Level;

/// The NEON level on this machine, or none where there is none.
#[cfg(target_arch = "aarch64")]
pub(crate) fn level() -> Option<Level> {
    Level::new().as_neon().map(Level::Neon)
}

/// The NEON level on this machine, or none where there is none.
#[cfg(not(target_arch = "aarch64"))]
pub(crate) fn level() -> Option<Level> {
    None
}

//! The web player (issue #172; canvas primitives: Export: web player): the canvas core built for
//! wasm32 on one thread. It seals the canvas modules it carries, loads a bundle's document, plays
//! it on its recorded input track as the app does, and answers `probe()`.

pub mod play;
pub mod seal;

#[cfg(target_arch = "wasm32")]
mod cxx;
#[cfg(target_arch = "wasm32")]
mod draw;
#[cfg(target_arch = "wasm32")]
mod gpu;
#[cfg(target_arch = "wasm32")]
mod page;

//! relay@1 (issue #309; canvas primitives: Net: relay protocol relay@1): its wire, the relay
//! DeepBuild ships, the relay suite and the network seam's macOS backend.

#[cfg(not(target_arch = "wasm32"))]
pub mod direct;
#[cfg(not(target_arch = "wasm32"))]
pub mod macos;
#[cfg(not(target_arch = "wasm32"))]
pub mod relay;
#[cfg(not(target_arch = "wasm32"))]
pub mod suite;
pub mod wire;

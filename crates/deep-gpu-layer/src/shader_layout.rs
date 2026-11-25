//! The layout lane (issue #3256): this crate's shader modules as it assembles them, and the
//! structs that have one side only, each with its reason. A `#[repr(C)]` struct names its shader
//! struct beside its definition (`deep_gpu::paired!`), and the test that line makes reads the
//! module from here.
#![cfg(test)]

use std::sync::OnceLock;

use deep_gpu::layout::{Lane, Module};

/// Shader structs bound as a uniform or as storage that no host struct names: the file that
/// declares it, the struct, and why.
const GPU_ONLY: &[(&str, &str, &str)] = &[(
    "testgpu.wgsl",
    "Frame",
    "the test module's one matrix, which testgpu.rs writes as [[f32; 4]; 4], with no host struct",
)];

pub(crate) fn lane() -> &'static Lane {
    static LANE: OnceLock<Lane> = OnceLock::new();
    LANE.get_or_init(|| Lane {
        file: file!(),
        root: env!("CARGO_MANIFEST_DIR"),
        modules: vec![
            Module::new(&["regions.wgsl"], crate::regions::source(false)),
            Module::new(&["scene.wgsl"], include_str!("scene.wgsl")),
        ],
        host_only: &[],
        gpu_only: GPU_ONLY,
        sums_host_sizes: false,
    })
}

#[test]
fn closed() {
    lane().closed();
}

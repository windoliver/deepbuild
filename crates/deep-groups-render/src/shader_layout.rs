//! The layout lane (issue #3256): this crate's shader modules as it assembles them, and the
//! structs that have one side only, each with its reason. A `#[repr(C)]` struct names its shader
//! struct beside its definition (`deep_gpu::paired!`), and the test that line makes reads the
//! module from here. The lane's two small pairs are here too: one whose offsets agree, and one
//! that is there to differ, since the shader's second `vec3<f32>` sits at 16 and the host's
//! second `[f32; 3]` at 12.
#![cfg(test)]

use std::sync::OnceLock;

use deep_gpu::layout::{Lane, Module};

/// Shader structs bound as a uniform or as storage that no host struct names: the file that
/// declares it, the struct, and why.
const GPU_ONLY: &[(&str, &str, &str)] = &[
    (
        "groups.wgsl",
        "Mix",
        "a group's mix, which groups.rs writes word by word, with no host struct",
    ),
    (
        "drawn.wgsl",
        "U",
        "a drawn pass's values, which drawn.rs writes word by word, with no host struct",
    ),
    (
        "drawn.wgsl",
        "V",
        "a drawn 3D pass's view, which drawn.rs writes word by word, with no host struct",
    ),
    (
        "lightfx.wgsl",
        "U",
        "the lights and casters, which lightfx.rs writes word by word, with no host struct",
    ),
    (
        "paintfx.wgsl",
        "U",
        "a paint pass's values, which paintfx.rs writes word by word, with no host struct",
    ),
];

deep_gpu::paired! { offsets_agree: "shader_layout.wgsl", OffsetsAgree3256;
#[repr(C)]
#[allow(dead_code)]
struct OffsetsAgree3256 {
    a: [f32; 3],
    b: f32,
}
}

deep_gpu::paired! { offsets_differ: differs "shader_layout.wgsl", OffsetsDiffer3256;
#[repr(C)]
#[allow(dead_code)]
struct OffsetsDiffer3256 {
    a: [f32; 3],
    b: [f32; 3],
}
}

pub(crate) fn lane() -> &'static Lane {
    static LANE: OnceLock<Lane> = OnceLock::new();
    LANE.get_or_init(|| Lane {
        file: file!(),
        root: env!("CARGO_MANIFEST_DIR"),
        modules: vec![
            Module::new(&["indexed.wgsl"], include_str!("indexed.wgsl")),
            Module::new(&["indexed_up.wgsl"], include_str!("indexed_up.wgsl")),
            Module::new(&["shader_layout.wgsl"], include_str!("shader_layout.wgsl")),
        ],
        host_only: &[],
        gpu_only: GPU_ONLY,
        // #3256's planted comparison, which no shipped build has.
        sums_host_sizes: cfg!(feature = "plant-3256-host-sizes"),
    })
}

#[test]
fn closed() {
    lane().closed();
}

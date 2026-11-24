//! The layout lane (issue #3256): this crate's shader modules as the renderer assembles them, and
//! the structs that have one side only, each with its reason. A `#[repr(C)]` struct names its
//! shader struct beside its definition (`deep_gpu::paired!`), and the test that line makes reads
//! the module from here.
#![cfg(test)]

use std::sync::OnceLock;

use deep_gpu::layout::{Lane, Module};

use crate::Planted;

/// `#[repr(C)]` structs with no shader struct: the file, the struct, and why.
const HOST_ONLY: &[(&str, &str, &str)] = &[
    (
        "lib.rs",
        "AdjustEntry",
        "scene3d.wgsl reads the adjust table as array<vec4<f32>, 768>, three to an entry, with no struct",
    ),
    (
        "fill.rs",
        "Record",
        "scene3d.wgsl reads a fill light from the light grid's words (FILL_LIGHTS), with no struct",
    ),
];

/// Shader structs bound as a uniform or as storage that no host struct names: the file that
/// declares it, the struct, and why.
const GPU_ONLY: &[(&str, &str, &str)] = &[
    (
        "scene3d.wgsl",
        "OitInfo",
        "the per-pixel lists' counter, which the shaders count in; oit.rs resets it as four u32, with no host struct",
    ),
    (
        "mask_dump.wgsl",
        "MaskDump",
        "the mask dump's key and code, which lib.rs writes as four u32, with no host struct",
    ),
    (
        "mirror.wgsl",
        "Params",
        "the mirror's flip, which mirror.rs writes as one [f32; 4], with no host struct",
    ),
    (
        "inset_unlit.wgsl",
        "Unlit",
        "the unlit inset's matrix and scale, which inset.rs writes as 20 f32, with no host struct",
    ),
    (
        "exposure.wgsl",
        "Partial",
        "the reduction's partial sums, which its compute pass writes and the host reads back",
    ),
    (
        "flare.wgsl",
        "Source",
        "the sources the flare's compute pass finds and writes; the host's own are in Params, which is paired",
    ),
    (
        "op.rs",
        "OpFrame",
        "a material operator's frame, which the effects core's emitter declares and writes, outside this crate",
    ),
];

/// The scene's module, in the order `SHADER` joins it.
const SCENE: &[&str] = &[
    "scene3d.wgsl",
    "scene3d_labels_sky.wgsl",
    "tiles.wgsl",
    "fog.wgsl",
    "ao_shade.wgsl",
    "ambient.wgsl",
    "tint.wgsl",
    "caps.wgsl",
    "inset_lit.wgsl",
    "inset.wgsl",
];

/// A pass whose module is one file.
macro_rules! alone {
    ($($name:literal),* $(,)?) => {
        [$(Module::new(&[$name], include_str!($name))),*]
    };
}

pub(crate) fn lane() -> &'static Lane {
    static LANE: OnceLock<Lane> = OnceLock::new();
    LANE.get_or_init(|| {
        let scene = crate::shader(&Planted::default());
        let mut modules = vec![
            Module::new(
                &["mask_dump.wgsl"],
                crate::mask_dump_source(&scene).expect("the scene's band masks"),
            ),
            Module::new(SCENE, scene),
            Module::new(&["output.wgsl"], crate::OUTPUT),
            Module::new(
                &["output.wgsl", "outline.wgsl", "label.wgsl"],
                format!("{}\n{}\n{}", crate::OUTPUT, crate::OUTLINE, crate::LABEL),
            ),
            Module::new(
                &["output.wgsl", "hdr.wgsl"],
                format!("{}\n{}", crate::OUTPUT, include_str!("hdr.wgsl")),
            ),
            Module::new(
                &["inset_unlit.wgsl", "inset.wgsl"],
                concat!(include_str!("inset_unlit.wgsl"), include_str!("inset.wgsl")),
            ),
            Module::new(&["sss.rs"], crate::sss::SHADER),
        ];
        modules.extend(alone![
            "ao.wgsl",
            "backdrop.wgsl",
            "cull.wgsl",
            "diag.wgsl",
            "dof.wgsl",
            "env.wgsl",
            "exposure.wgsl",
            "fill.wgsl",
            "flare.wgsl",
            "history.wgsl",
            "local_tone.wgsl",
            "mirror.wgsl",
            "motion.wgsl",
            "print.wgsl",
            "status.wgsl",
            "sway.wgsl",
            "water.wgsl",
        ]);
        Lane {
            file: file!(),
            root: env!("CARGO_MANIFEST_DIR"),
            modules,
            host_only: HOST_ONLY,
            gpu_only: GPU_ONLY,
            sums_host_sizes: false,
        }
    })
}

#[test]
fn closed() {
    lane().closed();
}

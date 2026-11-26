//! The frames a check that reads pixels gets from its host (#1938), with the light reduction
//! render.exposure asks of each (#2513) and each item's own pass a host measured (#2485).

use std::collections::BTreeMap;

/// One frame a host drew for a check that reads pixels (#1938), at the document's size, as
/// render-back draws it: rows top-down.
#[derive(Clone, Debug, Default)]
pub struct Frame {
    pub t: i64,
    pub size: [u32; 2],
    /// The linear image the output pass reads, before exposure: RGBA per px.
    pub linear: Vec<f32>,
    /// The exposure it was drawn at, a scale on `linear`.
    pub exposure: f64,
    /// The frame as shown: straight RGBA8, sRGB-encoded.
    pub rgba: Vec<u8>,
    /// The object-ID pass: each px's pick, 0 where no surface drew, and the item each pick is.
    pub ids: Vec<u32>,
    pub picks: BTreeMap<u32, String>,
    /// The look's roles it was drawn in, sRGB.
    pub roles: BTreeMap<String, [u8; 3]>,
    /// #2513: the light of its px reduced on the GPU that drew it, which render.exposure reads in
    /// place of `linear`, then left empty: a few KB cross to the CPU, never its px.
    pub reduce: Option<Reduce>,
    /// #2485: what the host measured of each item's own pass at this frame, by item, for a check
    /// that reads effects (effects.audit); empty where it measured none.
    pub passes: BTreeMap<String, ItemPass>,
}

/// One item's own pass as a host drew and timed it (#2485): the most fragments any px took from
/// it (overdraw), and its GPU time in ms by its timestamps; `None` where it couldn't read one.
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct ItemPass {
    pub overdraw: Option<f64>,
    pub gpu_ms: Option<f64>,
}

/// What render.exposure asks of a frame's px (#2513): those whose pick is one of `picks`
/// (sorted; `None`, every px), each px's linear RGB times `exposure`.
#[derive(Clone, Debug, PartialEq)]
pub struct LightQuery {
    pub picks: Option<Vec<u32>>,
    pub exposure: f64,
    /// A px is over when its brightest exposed channel is above `white`, under when below `black`.
    pub white: f64,
    pub black: f64,
    /// Its luminance, `weights` over its exposed RGB, is floored at `floor` before its log2.
    pub weights: [f64; 3],
    pub floor: f64,
}

/// The px a [`LightQuery`] read, those over and under, and the sum of their luminances' log2.
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct LightSums {
    pub px: u64,
    pub over: u64,
    pub under: u64,
    pub log2: f64,
}

/// What a host's reduction runs: a query in, its sums out.
pub type Reducing = dyn Fn(&LightQuery) -> Option<LightSums> + Send + Sync;

/// A host's reduction of one frame it drew (#2513), run on the GPU that drew it.
#[derive(Clone)]
pub struct Reduce(pub std::sync::Arc<Reducing>);

impl std::fmt::Debug for Reduce {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("Reduce")
    }
}

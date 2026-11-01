//! The glow as one shipped pass run as its internal mip chain (Look `look@1`: bloom): the
//! chain's plan from the view's size and the bloom's radius, shared by the frame, the GPU run and
//! the CPU reference, so all three run the same stages at the same sizes.

use std::collections::BTreeMap;

use serde_json::Value;

/// The chain's levels, at most.
pub const MAX_LEVELS: usize = 6;

/// The stage graphs' places in `shipped::glow_stages`.
pub const DOWN_FIRST: usize = 0;
pub const DOWN: usize = 1;
pub const UP: usize = 2;
pub const MIX: usize = 3;

/// One run of the chain: a stage, the levels it reads (`None` is the scene) and the level it
/// writes (`None` is the output), at its size.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Run {
    pub stage: usize,
    /// For a downsample, its source; for an upsample, the smaller level; for the mix, the bloom.
    pub a: Option<usize>,
    /// For an upsample, the same level's downsample.
    pub b: Option<usize>,
    pub out: Option<usize>,
    pub size: [u32; 2],
}

/// The level sizes: halves while both sides stay at least 4 px, at most [`MAX_LEVELS`], of which
/// `radius` (the share of the chain used) are kept.
pub fn levels(size: [u32; 2], radius: f64) -> Vec<[u32; 2]> {
    let half = |s: [u32; 2]| [(s[0] / 2).max(1), (s[1] / 2).max(1)];
    let mut sizes = Vec::new();
    let mut next = half(size);
    while sizes.len() < MAX_LEVELS && next[0] >= 4 && next[1] >= 4 {
        sizes.push(next);
        next = half(next);
    }
    if sizes.is_empty() {
        return sizes;
    }
    let keep =
        ((sizes.len() as f64 * radius.clamp(0.0, 1.0)).ceil() as usize).clamp(1, sizes.len());
    sizes.truncate(keep);
    sizes
}

/// The chain's runs at `size` and the params its stages read: `bloom`'s, with the number of
/// levels added.
pub(crate) fn chain(
    size: [u32; 2],
    bloom: &BTreeMap<String, Value>,
) -> (Vec<Run>, BTreeMap<String, Value>) {
    let radius = bloom
        .get("bloom.radius")
        .and_then(Value::as_f64)
        .unwrap_or(0.85);
    let mut params = bloom.clone();
    params.insert(
        "bloom.levels".into(),
        Value::from(levels(size, radius).len() as u64),
    );
    (plan(size, radius), params)
}

/// The chain's runs in order. Levels 0 … n − 1 are the downsamples; levels n … are the
/// upsamples, each the size of the downsample it adds to.
pub fn plan(size: [u32; 2], radius: f64) -> Vec<Run> {
    let sizes = levels(size, radius);
    let n = sizes.len();
    let mut runs = Vec::new();
    if n == 0 {
        return runs;
    }
    for (k, s) in sizes.iter().enumerate() {
        runs.push(Run {
            stage: if k == 0 { DOWN_FIRST } else { DOWN },
            a: if k == 0 { None } else { Some(k - 1) },
            b: None,
            out: Some(k),
            size: *s,
        });
    }
    let mut small = n - 1;
    for (j, k) in (0..n - 1).rev().enumerate() {
        let out = n + j;
        runs.push(Run {
            stage: UP,
            a: Some(small),
            b: Some(k),
            out: Some(out),
            size: sizes[k],
        });
        small = out;
    }
    runs.push(Run {
        stage: MIX,
        a: Some(small),
        b: None,
        out: None,
        size,
    });
    runs
}

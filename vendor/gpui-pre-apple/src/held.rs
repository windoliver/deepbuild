//! DeepBuild patch (windoliver/deepbuild#1431): what the renderer holds on the device, as the device sizes it, in
//! `held` order: glyph atlas, sprite atlas, path targets, instance buffers and drawables (tiles, targets, buffers).
use gpui::AtlasTextureKind;
use std::sync::{Mutex, atomic::{AtomicU64, Ordering::Relaxed}};
pub(crate) const TARGETS: usize = 2;
pub(crate) const INSTANCES: usize = 3;
static HELD: [[AtomicU64; 2]; 5] = [const { [const { AtomicU64::new(0) }; 2] }; 5];
static SEEN: Mutex<Vec<(usize, usize, u64)>> = Mutex::new(Vec::new());

/// What the device allocated for a texture or a buffer.
pub(crate) fn bytes<T: objc2_metal::MTLResource + objc2::Message>(resource: &T) -> u64 {
    objc2_metal::MTLResource::allocatedSize(resource) as u64
}
pub(crate) fn atlas(kind: AtlasTextureKind) -> usize {
    usize::from(!matches!(kind, AtlasTextureKind::Monochrome))
}
pub(crate) fn took(kind: usize, entries: u64, bytes: u64) {
    HELD[kind][0].fetch_add(entries, Relaxed);
    HELD[kind][1].fetch_add(bytes, Relaxed);
}
pub(crate) fn freed(kind: usize, entries: u64, bytes: u64) {
    let _ = HELD[kind][0].try_update(Relaxed, Relaxed, |v| Some(v.saturating_sub(entries)));
    let _ = HELD[kind][1].try_update(Relaxed, Relaxed, |v| Some(v.saturating_sub(bytes)));
}
/// A drawable `layer` handed over, counted the first time; past three, it replaced the one seen longest ago.
pub(crate) fn drawable(layer: usize, texture: usize, bytes: u64) {
    let Ok(mut seen) = SEEN.lock() else { return };
    if !seen.iter().any(|&(l, t, _)| l == layer && t == texture) {
        if seen.iter().filter(|&&(l, ..)| l == layer).count() >= 3 {
            let oldest = seen.iter().position(|&(l, ..)| l == layer).expect("counted");
            freed(4, 1, seen.remove(oldest).2);
        }
        seen.push((layer, texture, bytes));
        took(4, 1, bytes);
    }
}
pub(crate) fn resized(layer: usize) {
    let Ok(mut seen) = SEEN.lock() else { return };
    seen.retain(|&(l, _, bytes)| l != layer || { freed(4, 1, bytes); false });
}
pub fn held() -> [(u64, u64); 5] {
    std::array::from_fn(|k| (HELD[k][0].load(Relaxed), HELD[k][1].load(Relaxed)))
}

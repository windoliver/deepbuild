//! A frame's readouts and card lines (#419, #504), drawn over the frame as every host shows them:
//! one more draw of the frame with them as its first layer's labels, whose label pass lays them
//! at display size after the frame's effects, and that draw's px laid over the frame where they
//! differ from the frame drawn without them. view3d and deep-show's stills and exports both draw
//! them this way, so they sit at the same place, size and colour, sharp and on top.

use deep_canvas_scene3d::scene::{Layer3, Scene};

/// `scene`'s readouts moved into its first layer's labels (a layer of their own when it has none):
/// the scene the overlay draw reads.
pub fn readouts_as_labels(scene: &mut Scene) {
    let readouts = std::mem::take(&mut scene.readouts);
    match scene.layers.first_mut() {
        Some(l) => l.labels.extend(readouts),
        None => scene.layers.push(Layer3 {
            labels: readouts,
            ..Default::default()
        }),
    }
}

/// Each px of `frame` where the overlay draw `over` differs from `plain`, the same frame drawn
/// without the overlay, becomes `over`'s: 4 bytes a px, all three in one layout.
pub fn lay_over(frame: &mut [u8], over: &[u8], plain: &[u8]) {
    for ((o, p), b) in over
        .as_chunks::<4>()
        .0
        .iter()
        .zip(plain.as_chunks::<4>().0)
        .zip(frame.as_chunks_mut::<4>().0)
    {
        if o != p {
            *b = *o;
        }
    }
}

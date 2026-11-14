//! Each solid's tie rank (#421, #428): only solids whose bounds overlap can share a face, so each
//! takes, in ID order, the least rank no overlapping solid of an earlier ID holds. Two solids that
//! could tie always differ and keep their order every frame, while the depth push stays a few
//! ranks deep, so a thin part just in front of another is never pushed behind it.
//!
//! #450: the ranks are a function of the frame's solids where they stand, so every frame ranks
//! them again and a frame draws the same however it was reached: a seek and a play that passed a
//! frame where two solids touched rank alike. The buffers are kept, so a frame that ranks again
//! allocates nothing once they've grown to its count (#379), and only a changed rank rebuilds the
//! map.

use std::collections::BTreeMap;

use deep_canvas_scene3d::scene::{Scene, Solid};

/// How far apart two bounds may be and still count as touching, m.
const TOUCH: f64 = 1e-5;

/// The buffers a ranking reuses, and the ranks by solid ID.
#[derive(Default)]
pub(crate) struct Ties {
    pub(crate) ranks: BTreeMap<String, u32>,
    /// Each ranked solid's (layer, index), in ID order, its bounds grown by [`TOUCH`] and its rank.
    at: Vec<(usize, usize)>,
    boxes: Vec<([f64; 3], [f64; 3])>,
    rank: Vec<u32>,
    by_x: Vec<usize>,
    active: Vec<usize>,
    /// Each overlapping pair as (later, earlier) places in `at`.
    pairs: Vec<(usize, usize)>,
    used: Vec<u32>,
}

fn grown(s: &Solid) -> ([f64; 3], [f64; 3]) {
    let [lo, hi] = s
        .mesh
        .as_ref()
        .map_or([[-0.5; 3], [0.5; 3]], |m| m.bounds());
    let (mut a, mut b) = ([f64::INFINITY; 3], [f64::NEG_INFINITY; 3]);
    for c in 0..8 {
        let p = [0, 1, 2].map(|k| if c >> k & 1 == 0 { lo[k] } else { hi[k] });
        for (r, m) in s.model.iter().enumerate() {
            let q = m[0] * p[0] + m[1] * p[1] + m[2] * p[2] + m[3];
            a[r] = a[r].min(q - TOUCH);
            b[r] = b[r].max(q + TOUCH);
        }
    }
    (a, b)
}

impl Ties {
    /// Ranks the scene's solids (those a culled batch draws tie by index order instead, #484)
    /// where they stand at this frame. With `changed`, each solid whose rank changed is added to
    /// it as (layer, index), unless it's there already.
    pub(crate) fn rank(&mut self, scene: &Scene, changed: Option<&mut Vec<(usize, usize)>>) {
        let solid = |&(l, i): &(usize, usize)| &scene.layers[l].solids[i];
        self.at.clear();
        for (l, layer) in scene.layers.iter().enumerate() {
            let own = layer
                .solids
                .iter()
                .enumerate()
                .filter(|(_, s)| s.batch == 0);
            self.at.extend(own.map(|(i, _)| (l, i)));
        }
        self.at
            .sort_unstable_by(|a, b| solid(a).id.cmp(&solid(b).id));
        let n = self.at.len();
        self.boxes.clear();
        self.boxes.extend(self.at.iter().map(|p| grown(solid(p))));
        let boxes = &self.boxes;
        self.by_x.clear();
        self.by_x.extend(0..n);
        self.by_x
            .sort_unstable_by(|a, b| boxes[*a].0[0].total_cmp(&boxes[*b].0[0]));
        self.active.clear();
        self.pairs.clear();
        for &i in &self.by_x {
            self.active.retain(|&j| boxes[j].1[0] >= boxes[i].0[0]);
            for &j in &self.active {
                if (1..3).all(|k| boxes[i].0[k] <= boxes[j].1[k] && boxes[j].0[k] <= boxes[i].1[k])
                {
                    self.pairs.push((i.max(j), i.min(j)));
                }
            }
            self.active.push(i);
        }
        self.pairs.sort_unstable();
        self.rank.clear();
        self.rank.resize(n, 0);
        let mut k = 0;
        for i in 0..n {
            self.used.clear();
            while k < self.pairs.len() && self.pairs[k].0 == i {
                self.used.push(self.rank[self.pairs[k].1]);
                k += 1;
            }
            self.used.sort_unstable();
            let mut r = 0;
            for &u in &self.used {
                if u == r {
                    r += 1;
                } else if u > r {
                    break;
                }
            }
            self.rank[i] = r;
        }
        let differs =
            |p: usize| self.ranks.get(solid(&self.at[p]).id.as_str()) != Some(&self.rank[p]);
        if self.ranks.len() == n && !(0..n).any(&differs) {
            return;
        }
        if let Some(moved) = changed {
            for p in (0..n).filter(|&p| differs(p)) {
                if !moved.contains(&self.at[p]) {
                    moved.push(self.at[p]);
                }
            }
        }
        self.ranks.clear();
        for (p, &r) in self.rank.iter().enumerate() {
            self.ranks.insert(solid(&self.at[p]).id.clone(), r);
        }
    }
}

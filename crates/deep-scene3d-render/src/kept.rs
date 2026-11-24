//! The scene a whole prepare draws in place of the one it is given (#2657): its levels of detail
//! resolved, or the water's parts left out. It is kept while the given scene holds, so such a
//! frame copies nothing. Holding is read field by field, and a shared part (a solid's mesh, maps
//! and levels, the scene's images and water) by its address before its content, so a scene
//! patched in place never has what an `Arc` holds walked.

use std::collections::BTreeMap;
use std::sync::Arc;

use deep_canvas_scene3d::scene::{Layer3, Scene, Solid};

/// A solid the derived scene holds others in place of: where it stood among its layer's solids,
/// the solid as given, and how many solids the derived layer holds there.
struct Edit {
    layer: usize,
    at: usize,
    given: Solid,
    outputs: usize,
}

/// The edits that make a derived scene from the scene it was given.
pub(crate) struct Edits(Vec<Edit>);

/// A derived scene and the edits that made it from the scene it was given.
pub(crate) struct Kept {
    pub scene: Scene,
    /// The shadow maps' side the levels were chosen at (0 for the dry scene).
    pub side: u32,
    edits: Edits,
    /// The given scene's own levels' sources (#506), which a resolve may have set.
    sources: Option<Arc<Vec<Layer3>>>,
}

/// The edits that make `derived` from `given` by replacing each solid `edited` names with the
/// solids that carry its ID where it stood (none when `removed`); `None` where that can't be read
/// back exactly, so the frame keeps nothing.
pub(crate) fn edits(
    given: &Scene,
    derived: &Scene,
    edited: impl Fn(&Solid) -> bool,
    removed: bool,
) -> Option<Edits> {
    if given.layers.len() != derived.layers.len() {
        return None;
    }
    let mut edits = Vec::new();
    for (l, (g, d)) in given.layers.iter().zip(&derived.layers).enumerate() {
        let mut j = 0;
        for (at, s) in g.solids.iter().enumerate() {
            if !edited(s) {
                j += 1;
                continue;
            }
            // Read back by ID, so a next solid of the same ID would be ambiguous.
            if !removed && g.solids.get(at + 1).is_some_and(|n| n.id == s.id) {
                return None;
            }
            let outputs = if removed {
                0
            } else {
                let rest = d.solids.get(j..).unwrap_or_default();
                rest.iter().take_while(|o| o.id == s.id).count()
            };
            edits.push(Edit {
                layer: l,
                at,
                given: s.clone(),
                outputs,
            });
            j += outputs;
        }
        if j != d.solids.len() {
            return None;
        }
    }
    Some(Edits(edits))
}

impl Kept {
    /// `scene`, made from `given` by `edits`.
    pub fn new(given: &Scene, scene: Scene, side: u32, edits: Edits) -> Kept {
        Kept {
            sources: given.sources.clone(),
            scene,
            side,
            edits,
        }
    }

    /// Whether `given` is the scene this was made from.
    pub fn holds(&self, given: &Scene) -> bool {
        if !same_but_layers(given, &self.scene)
            || !arc(&given.sources, &self.sources)
            || given.layers.len() != self.scene.layers.len()
        {
            return false;
        }
        let mut edits = self.edits.0.iter().peekable();
        for (l, (g, d)) in given.layers.iter().zip(&self.scene.layers).enumerate() {
            if !same_layer_but_solids(g, d) {
                return false;
            }
            let mut j = 0;
            for (at, s) in g.solids.iter().enumerate() {
                if let Some(e) = edits.next_if(|e| e.layer == l && e.at == at) {
                    if !same_solid(s, &e.given) {
                        return false;
                    }
                    j += e.outputs;
                } else if d.solids.get(j).is_some_and(|o| same_solid(s, o)) {
                    j += 1;
                } else {
                    return false;
                }
            }
            if j != d.solids.len() || edits.peek().is_some_and(|e| e.layer == l) {
                return false;
            }
        }
        true
    }
}

/// The same allocation, or equal content.
fn same<T: PartialEq + ?Sized>(a: &Arc<T>, b: &Arc<T>) -> bool {
    Arc::ptr_eq(a, b) || **a == **b
}

/// Both absent, or the [`same`].
fn arc<T: PartialEq + ?Sized>(a: &Option<Arc<T>>, b: &Option<Arc<T>>) -> bool {
    match (a, b) {
        (None, None) => true,
        (Some(a), Some(b)) => same(a, b),
        _ => false,
    }
}

/// The same keys, each to the [`same`].
fn arcs<K: PartialEq, T: PartialEq>(a: &BTreeMap<K, Arc<T>>, b: &BTreeMap<K, Arc<T>>) -> bool {
    a.len() == b.len() && (a.iter().zip(b)).all(|((ka, a), (kb, b))| ka == kb && same(a, b))
}

fn same_solid(a: &Solid, b: &Solid) -> bool {
    let Solid {
        id,
        shape,
        model,
        color,
        stroke,
        mesh,
        cast_shadow,
        receive_shadow,
        material,
        sort_bias,
        alpha,
        emission,
        maps,
        lod,
        mask,
        receiver_sets,
        caster_sets,
        cast_only,
        inset,
        op,
        cut,
        per_pixel,
        adjust,
        batch,
        row,
        sway,
    } = a;
    *id == b.id
        && *shape == b.shape
        && *model == b.model
        && *color == b.color
        && *stroke == b.stroke
        && arc(mesh, &b.mesh)
        && *cast_shadow == b.cast_shadow
        && *receive_shadow == b.receive_shadow
        && *material == b.material
        && *sort_bias == b.sort_bias
        && *alpha == b.alpha
        && *emission == b.emission
        && arc(maps, &b.maps)
        && arc(lod, &b.lod)
        && *mask == b.mask
        && *receiver_sets == b.receiver_sets
        && *caster_sets == b.caster_sets
        && *cast_only == b.cast_only
        && *inset == b.inset
        && *op == b.op
        && *cut == b.cut
        && *per_pixel == b.per_pixel
        && *adjust == b.adjust
        && *batch == b.batch
        && *row == b.row
        && *sway == b.sway
}

fn same_layer_but_solids(a: &Layer3, b: &Layer3) -> bool {
    let Layer3 {
        id,
        solids: _,
        lines,
        points,
        labels,
        images,
        fades,
        puffs,
        fed,
        draw_names,
        hidden,
    } = a;
    *id == b.id
        && *lines == b.lines
        && *points == b.points
        && *labels == b.labels
        && *images == b.images
        && *fades == b.fades
        && *puffs == b.puffs
        && *fed == b.fed
        && *draw_names == b.draw_names
        && *hidden == b.hidden
}

/// Every field but the layers and their sources, which the caller reads.
fn same_but_layers(a: &Scene, b: &Scene) -> bool {
    let Scene {
        size,
        camera,
        ground,
        layers: _,
        overlays,
        sun,
        lights,
        sky,
        others,
        curves,
        pages,
        motion,
        velocity,
        readouts,
        texels,
        jitter,
        light_cut,
        cutaway,
        crop,
        fragments,
        painted,
        distributions,
        shadowing,
        sample_turn,
        print,
        mirror,
        flare,
        dof,
        optics,
        exposure,
        water,
        under,
        read_reflection,
        read_foam,
        read_normal,
        probes,
        tints,
        volumes,
        stroked,
        pictures,
        projected,
        views,
        sources: _,
    } = a;
    *size == b.size
        && *camera == b.camera
        && *jitter == b.jitter
        && *ground == b.ground
        && *overlays == b.overlays
        && *sun == b.sun
        && *lights == b.lights
        && *sky == b.sky
        && *others == b.others
        && *curves == b.curves
        && *pages == b.pages
        && arc(motion, &b.motion)
        && arc(velocity, &b.velocity)
        && *readouts == b.readouts
        && arcs(texels, &b.texels)
        && *light_cut == b.light_cut
        && *cutaway == b.cutaway
        && *crop == b.crop
        && *fragments == b.fragments
        && *painted == b.painted
        && distributions.len() == b.distributions.len()
        && (distributions.iter().zip(&b.distributions)).all(|(a, b)| same(a, b))
        && *shadowing == b.shadowing
        && *sample_turn == b.sample_turn
        && *print == b.print
        && *mirror == b.mirror
        && arc(flare, &b.flare)
        && arc(dof, &b.dof)
        && *optics == b.optics
        && *exposure == b.exposure
        && arc(water, &b.water)
        && *under == b.under
        && *read_reflection == b.read_reflection
        && *read_foam == b.read_foam
        && *read_normal == b.read_normal
        && *probes == b.probes
        && *tints == b.tints
        && *volumes == b.volumes
        && *stroked == b.stroked
        && *pictures == b.pictures
        && *projected == b.projected
        && *views == b.views
}

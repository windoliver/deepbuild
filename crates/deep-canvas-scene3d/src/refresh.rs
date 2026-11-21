//! A second view's scene, kept from frame to frame (#3016). A mirror or a view inset draws the
//! scene it views from a camera of its own; its scene is made equal to that scene in place each
//! frame, so a frame copies nothing new for it: names and lists keep the room the frame before
//! gave them, shared parts are taken by reference, and a list of named things or a map is cloned
//! only when it differs.

use std::sync::Arc;

use crate::scene::{Image, Label, Layer3, Line, Point, Puff, Scene, Solid};

/// `dst` made equal to `src`, cloned only where it differs.
pub(crate) fn same<T: Clone + PartialEq>(dst: &mut T, src: &T) {
    if dst != src {
        dst.clone_from(src);
    }
}

/// `dst` made the items `src` yields, in order, each written over the one at its place.
fn fill<'a, T: Clone + 'a>(
    dst: &mut Vec<T>,
    src: impl IntoIterator<Item = &'a T>,
    over: fn(&mut T, &T),
) {
    let mut n = 0;
    for s in src {
        match dst.get_mut(n) {
            Some(d) => over(d, s),
            None => dst.push(s.clone()),
        }
        n += 1;
    }
    dst.truncate(n);
}

fn solid(d: &mut Solid, s: &Solid) {
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
    } = s;
    d.id.clone_from(id);
    (d.shape, d.model, d.color, d.stroke) = (*shape, *model, *color, *stroke);
    d.mesh.clone_from(mesh);
    (d.cast_shadow, d.receive_shadow, d.material) = (*cast_shadow, *receive_shadow, *material);
    (d.sort_bias, d.alpha, d.emission) = (*sort_bias, *alpha, *emission);
    d.maps.clone_from(maps);
    d.lod.clone_from(lod);
    (d.mask, d.receiver_sets, d.caster_sets) = (*mask, *receiver_sets, *caster_sets);
    (d.cast_only, d.inset, d.cut, d.per_pixel) = (*cast_only, *inset, *cut, *per_pixel);
    same(&mut d.op, op);
    (d.adjust, d.batch, d.row, d.sway) = (*adjust, *batch, *row, *sway);
}

fn line(d: &mut Line, s: &Line) {
    let Line {
        id,
        segments,
        world,
        color,
        edges,
        over,
        joined,
        dash,
        dash_world,
        cap,
        trail,
        points,
        fog,
    } = s;
    d.id.clone_from(id);
    d.segments.clone_from(segments);
    (d.world, d.color, d.over, d.joined) = (*world, *color, *over, *joined);
    d.edges.clone_from(edges);
    (d.dash, d.dash_world, d.fog) = (*dash, *dash_world, *fog);
    d.cap.clone_from(cap);
    d.trail.clone_from(trail);
    d.points.clone_from(points);
}

fn point(d: &mut Point, s: &Point) {
    let Point {
        id,
        pos,
        size,
        world,
        shape,
        color,
        cloud,
        fog,
    } = s;
    d.id.clone_from(id);
    (d.pos, d.size, d.world, d.color, d.fog) = (*pos, *size, *world, *color, *fog);
    d.shape.clone_from(shape);
    d.cloud.clone_from(cloud);
}

fn label(d: &mut Label, s: &Label) {
    let Label {
        id,
        text,
        role,
        glyphs,
        bounds,
        pos,
        em,
        quad,
        world,
        facing,
        axes,
        color,
        fog,
    } = s;
    d.id.clone_from(id);
    d.text.clone_from(text);
    d.role.clone_from(role);
    d.glyphs.clone_from(glyphs);
    (d.bounds, d.pos, d.em, d.quad, d.world) = (*bounds, *pos, *em, *quad, *world);
    d.facing.clone_from(facing);
    (d.axes, d.color, d.fog) = (*axes, *color, *fog);
}

fn image(d: &mut Image, s: &Image) {
    let Image {
        id,
        asset,
        pos,
        size,
        world,
        facing,
        axes,
        fog,
    } = s;
    d.id.clone_from(id);
    d.asset.clone_from(asset);
    (d.pos, d.size, d.world, d.axes, d.fog) = (*pos, *size, *world, *axes, *fog);
    d.facing.clone_from(facing);
}

fn puff(d: &mut Puff, s: &Puff) {
    let Puff {
        id,
        pos,
        radius,
        aspect,
        density,
        bright,
        seed,
        sun,
        ambient,
        phase,
        shade,
        near_fade,
    } = s;
    d.id.clone_from(id);
    (d.pos, d.radius, d.aspect, d.density) = (*pos, *radius, *aspect, *density);
    (d.bright, d.seed, d.sun, d.ambient) = (*bright, *seed, *sun, *ambient);
    (d.phase, d.shade, d.near_fade) = (*phase, *shade, *near_fade);
}

/// What a view keeps of each layer: the solids `solid` keeps; the lines, points, images and
/// puffs `item` keeps; and its labels, those `item` keeps, or none.
pub(crate) struct Keeps<'a> {
    pub solid: &'a dyn Fn(&str) -> bool,
    pub item: &'a dyn Fn(&str) -> bool,
    pub labels: bool,
}

/// `dst` made the layers of `src`, each holding what `keeps` keeps.
pub(crate) fn layers(dst: &mut Vec<Layer3>, src: &[Layer3], keeps: &Keeps<'_>) {
    dst.truncate(src.len());
    for (n, s) in src.iter().enumerate() {
        if n == dst.len() {
            dst.push(Layer3::default());
        }
        let d = &mut dst[n];
        let Layer3 {
            id,
            solids,
            lines,
            points,
            labels,
            images,
            fades,
            puffs,
            fed,
            draw_names,
        } = s;
        d.id.clone_from(id);
        let item = |id: &String| (keeps.item)(id);
        fill(&mut d.solids, solids.iter().filter(|x| (keeps.solid)(&x.id)), solid);
        fill(&mut d.lines, lines.iter().filter(|x| item(&x.id)), line);
        fill(&mut d.points, points.iter().filter(|x| item(&x.id)), point);
        let labels = labels.iter().filter(|x| keeps.labels && item(&x.id));
        fill(&mut d.labels, labels, label);
        fill(&mut d.images, images.iter().filter(|x| item(&x.id)), image);
        fill(&mut d.puffs, puffs.iter().filter(|x| item(&x.id)), puff);
        same(&mut d.fades, fades);
        same(&mut d.fed, fed);
        same(&mut d.draw_names, draw_names);
    }
}

/// The parts of `src` a view takes as they are, written into `dst`; the rest are the view's,
/// which its own function sets.
pub(crate) fn shared(dst: &mut Scene, src: &Scene) {
    let Scene {
        size: _,
        camera: _,
        ground,
        layers: _,
        overlays: _,
        sun,
        lights,
        sky,
        others,
        curves,
        pages,
        motion: _,
        velocity: _,
        readouts: _,
        texels,
        jitter: _,
        light_cut: _,
        cutaway: _,
        crop,
        fragments,
        painted,
        distributions,
        shadowing,
        sample_turn,
        print,
        mirror: _,
        flare: _,
        dof,
        optics,
        exposure,
        water,
        read_reflection: _,
        read_foam: _,
        read_normal: _,
        probes,
        tints,
        volumes,
        stroked,
        pictures,
        projected,
        views: _,
        sources: _,
    } = src;
    (dst.ground, dst.crop, dst.fragments) = (*ground, *crop, *fragments);
    same(&mut dst.sun, sun);
    same(&mut dst.lights, lights);
    same(&mut dst.sky, sky);
    same(&mut dst.others, others);
    same(&mut dst.curves, curves);
    same(&mut dst.pages, pages);
    // The decoded maps by reference: their texels are never compared.
    let held = dst.texels.len() == texels.len()
        && (dst.texels.iter().zip(texels))
            .all(|((a, x), (b, y))| a == b && Arc::ptr_eq(x, y));
    if !held {
        dst.texels.clone_from(texels);
    }
    same(&mut dst.painted, painted);
    dst.distributions.clone_from(distributions);
    same(&mut dst.shadowing, shadowing);
    dst.sample_turn = *sample_turn;
    same(&mut dst.print, print);
    dst.dof.clone_from(dof);
    same(&mut dst.optics, optics);
    dst.exposure = *exposure;
    dst.water.clone_from(water);
    same(&mut dst.probes, probes);
    same(&mut dst.tints, tints);
    same(&mut dst.volumes, volumes);
    same(&mut dst.stroked, stroked);
    same(&mut dst.pictures, pictures);
    same(&mut dst.projected, projected);
}

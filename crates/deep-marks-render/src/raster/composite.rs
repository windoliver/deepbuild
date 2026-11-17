//! A writer layer's marks composited (moved from raster.rs, #2031): blended groups each from
//! their backdrop and their own content, and a lit group's runs lit in place.

use super::*;

/// Each group that names a blend mode and that `marks` draw through, by its item ID, in the order
/// they first draw.
fn blended<'a>(marks: impl IntoIterator<Item = &'a Drawn>) -> Vec<(String, Blend)> {
    let mut out: Vec<(String, Blend)> = Vec::new();
    for drawn in marks {
        for s in &drawn.scopes {
            if let Scope::Opacity {
                item,
                blend: Some(blend),
                ..
            } = s
            {
                if !out.iter().any(|(g, _)| g == item) {
                    out.push((item.clone(), *blend));
                }
            }
        }
    }
    out
}

/// A blended group's two 8-bit premultiplied inputs, as the layer composited them.
pub(super) struct Inputs {
    pub(super) group: String,
    pub(super) blend: Blend,
    pub(super) backdrop: Pixmap,
    pub(super) source: Pixmap,
}

/// `pixmap` over the whole canvas, pixel for pixel.
pub(super) fn put(ctx: &mut RenderContext, pixmap: Pixmap) {
    let at = *ctx.transform();
    ctx.set_transform(Affine::IDENTITY);
    ctx.reset_paint_transform();
    ctx.set_paint(Image {
        image: ImageSource::Pixmap(Arc::new(pixmap)),
        sampler: sampler(scene::ImageSampling::Nearest),
    });
    ctx.fill_rect(&rect([
        0.0,
        0.0,
        f64::from(ctx.width()),
        f64::from(ctx.height()),
    ]));
    ctx.set_transform(at);
}

/// One writer layer's `marks` drawn by `p`. A layer that holds a group in a blend mode draws
/// alone, so the group blends only with what its own layer drew before it, and each such group
/// is composited from two 8-bit premultiplied pictures, that backdrop and its own content drawn
/// isolated: the inputs a golden's expected value applies the formula to (Frame and group: blend
/// modes), which this returns.
pub(super) fn composite<'s>(
    p: &mut Painter<'s, RenderContext>,
    marks: &[&Drawn],
    new_ctx: &dyn Fn() -> RenderContext,
    raster: RasterizerSettings,
) -> Result<Vec<Inputs>, Value> {
    if blended(marks.iter().copied()).is_empty() {
        p.marks(marks.iter().copied())?;
        return Ok(Vec::new());
    }
    let sub = |p: &Painter<'s, RenderContext>| Painter {
        store: p.store,
        kept: p.kept,
        zoom: p.zoom,
        spans_apart: p.spans_apart,
        anim: p.anim.clone(),
        ..Painter::on(new_ctx())
    };
    let render = |q: &mut Painter<'s, RenderContext>| {
        let mut pixmap = Pixmap::new(q.ctx.width(), q.ctx.height());
        q.ctx.render_with(&mut pixmap, &mut q.resources, raster);
        pixmap
    };
    // #2031: a layer whose only isolated groups are lights draws in place: everything outside a
    // lit run straight into the frame, as with no light, and each lit run drawn alone, lit and
    // laid in at its place in the draw order.
    let isolates =
        |s: &Scope| light_of(s).is_none() && matches!(s, Scope::Opacity { blend: Some(_), .. });
    if !marks.iter().any(|d| d.scopes.iter().any(isolates)) {
        let mut i = 0;
        while i < marks.len() {
            let found = marks[i..].iter().enumerate().find_map(|(k, d)| {
                let at = d.scopes.iter().position(|s| light_of(s).is_some())?;
                Some((i + k, at))
            });
            let Some((start, at)) = found else {
                p.marks(marks[i..].iter().copied())?;
                break;
            };
            p.marks(marks[i..start].iter().copied())?;
            let group = marks[start].scopes[at].item();
            let end = marks[start..]
                .iter()
                .position(|d| !d.scopes.iter().any(|s| s.item() == group))
                .map_or(marks.len(), |n| start + n);
            let mut content = sub(p);
            let placed = *content.ctx.transform();
            let inside: Vec<Drawn> = marks[start..end]
                .iter()
                .map(|d| Drawn {
                    scopes: d.scopes[at + 1..].to_vec(),
                    ..(*d).clone()
                })
                .collect();
            content.marks(inside.iter())?;
            p.texts.append(&mut content.texts);
            let light = light_of(&marks[start].scopes[at]).expect("found lit");
            let source = lit(&render(&mut content), &light, placed);
            let outer = &marks[start].scopes[..at];
            p.scopes.enter(&mut p.ctx, &mut p.resources, outer);
            put(&mut p.ctx, source);
            p.scopes.enter(&mut p.ctx, &mut p.resources, &[]);
            p.scopes.offscreen += 1;
            i = end;
        }
        return Ok(Vec::new());
    }
    let mut inputs = Vec::new();
    let mut layer = sub(p);
    let mut i = 0;
    while i < marks.len() {
        // The next mark inside a group that names a blend, and the group's run of marks.
        let found = marks[i..].iter().enumerate().find_map(|(k, d)| {
            d.scopes.iter().enumerate().find_map(|(at, s)| match s {
                Scope::Opacity {
                    item,
                    alpha,
                    blend: Some(b),
                    ..
                } => Some((i + k, at, item.clone(), *alpha, *b)),
                _ => None,
            })
        });
        let Some((start, at, group, alpha, blend)) = found else {
            layer.marks(marks[i..].iter().copied())?;
            break;
        };
        let end = marks[start..]
            .iter()
            .position(|d| !d.scopes.iter().any(|s| s.item() == group))
            .map_or(marks.len(), |n| start + n);
        layer.marks(marks[i..start].iter().copied())?;
        let backdrop = render(&mut layer);
        let mut content = sub(p);
        // Where the content's units land in its pixels, which a light reads back (#2031).
        let placed = *content.ctx.transform();
        let inside: Vec<Drawn> = marks[start..end]
            .iter()
            .map(|d| Drawn {
                scopes: d.scopes[at + 1..].to_vec(),
                ..(*d).clone()
            })
            .collect();
        // #2031: a lit run's children draw through this compositor too, so a paint part or a
        // blended group inside it composites as it would unlit; a light inside a blended group
        // is reached the same way.
        let lit_run = light_of(&marks[start].scopes[at]).is_some();
        if lit_run
            || inside
                .iter()
                .any(|d| d.scopes.iter().any(|s| light_of(s).is_some()))
        {
            let inside: Vec<&Drawn> = inside.iter().collect();
            composite(&mut content, &inside, new_ctx, raster)?;
        } else {
            content.marks(inside.iter())?;
        }
        p.texts.append(&mut content.texts);
        let source = render(&mut content);
        // #467: a part an item's paint builds from its coverage, which `source` holds.
        let part = match &marks[start].scopes[at] {
            Scope::Opacity {
                effect: Some(e), ..
            } => e.paint.clone(),
            _ => None,
        };
        let source = match part {
            Some(part) => painted(&source, &part, p.zoom as f32),
            None => source,
        };
        // #2031: a lit group's run of lit children, lit at each pixel.
        let light = light_of(&marks[start].scopes[at]);
        let source = match &light {
            Some(l) => lit(&source, l, placed),
            None => source,
        };
        // What the layer drew so far keeps its texts' readings.
        p.texts.append(&mut layer.texts);
        layer = sub(p);
        put(&mut layer.ctx, backdrop.clone());
        let outer = &marks[start].scopes[..at];
        layer
            .scopes
            .enter(&mut layer.ctx, &mut layer.resources, outer);
        let mode = (blend != Blend::Normal).then(|| deep_marks_vello::blend_mode(blend));
        Canvas::push_layer(&mut layer.ctx, None, mode, Some(alpha as f32), None);
        put(&mut layer.ctx, source.clone());
        layer.ctx.pop_layer();
        layer
            .scopes
            .enter(&mut layer.ctx, &mut layer.resources, &[]);
        p.scopes.offscreen += 3;
        if light.is_none() {
            inputs.push(Inputs {
                group,
                blend,
                backdrop,
                source,
            });
        }
        i = end;
    }
    p.texts.append(&mut layer.texts);
    let drawn = render(&mut layer);
    put(&mut p.ctx, drawn);
    Ok(inputs)
}

/// The light of a lit group's scope around its lit children (#2031).
fn light_of(s: &Scope) -> Option<Arc<light::Light>> {
    match s {
        Scope::Opacity {
            effect: Some(e), ..
        } => e.light.clone(),
        _ => None,
    }
}

/// #2031: `source`, a lit group's lit children drawn alone (premultiplied) through `placed`, lit
/// at each pixel's centre.
fn lit(source: &Pixmap, l: &light::Light, placed: Affine) -> Pixmap {
    let back = placed.inverse();
    let mut out = source.data_as_u8_slice().to_vec();
    l.light_pixels(&mut out, usize::from(source.width()), true, |x, y| {
        let p = back * vello_cpu::kurbo::Point::new(x, y);
        [p.x, p.y]
    });
    let alpha_type = ImageAlphaType::AlphaPremultiplied;
    let metadata = PixelMetadata {
        may_have_transparency: true,
        alpha_type,
    };
    Pixmap::from_parts(out, source.width(), source.height(), metadata)
}

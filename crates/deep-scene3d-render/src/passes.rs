//! A frame's passes (moved from lib.rs, #2360): geometry with its ID resolve, per-pixel and glass.

use super::*;

/// The geometry pass into `drawn`'s multisampled targets, then the pass resolving their object
/// IDs and depth (#1173); `timestamps` time the first, since Metal fails a pass's timestamps split
/// over two passes.
/// The geometry pass's object IDs and depth resolved into the targets everything after it reads
/// (#1173); #166's water runs it again once its parts are in.
pub(super) fn resolve_ids(
    encoder: &mut wgpu::CommandEncoder,
    drawn: &Drawn,
    clear_depth: f64,
    rect: Option<[u32; 4]>,
    timestamps: Option<wgpu::RenderPassTimestampWrites<'_>>,
) {
    let mut pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
        label: Some(RESOLVE_PASS),
        color_attachments: &[Some(wgpu::RenderPassColorAttachment {
            view: &drawn.ids,
            resolve_target: None,
            depth_slice: None,
            ops: wgpu::Operations {
                load: match rect {
                    Some(_) => wgpu::LoadOp::Load,
                    None => wgpu::LoadOp::Clear(wgpu::Color::TRANSPARENT),
                },
                store: wgpu::StoreOp::Store,
            },
        })],
        depth_stencil_attachment: Some(wgpu::RenderPassDepthStencilAttachment {
            view: &drawn.depth,
            depth_ops: Some(wgpu::Operations {
                load: match rect {
                    Some(_) => wgpu::LoadOp::Load,
                    None => wgpu::LoadOp::Clear(clear_depth as f32),
                },
                store: wgpu::StoreOp::Store,
            }),
            stencil_ops: None,
        }),
        timestamp_writes: timestamps,
        ..Default::default()
    });
    // Again inside a rectangle (#166's water): what lies outside it is as the first resolve left
    // it.
    if let Some([x, y, w, h]) = rect {
        pass.set_scissor_rect(x, y, w, h);
    }
    pass.set_pipeline(&drawn.resolve.0);
    pass.set_bind_group(0, &drawn.resolve.1, &[]);
    pass.draw(0..3, 0..1);
}

#[allow(clippy::too_many_arguments)]
pub(super) fn geometry_pass<'a>(
    encoder: &mut wgpu::CommandEncoder,
    drawn: &Drawn,
    [r, g, b, a]: [f64; 4],
    clear_depth: f64,
    sky: Option<&SkyDraw>,
    bundles: impl Iterator<Item = &'a wgpu::RenderBundle>,
    puffs: Option<&PuffDraw>,
    timestamps: Option<wgpu::RenderPassTimestampWrites<'_>>,
    crop: Option<[u32; 4]>,
) {
    let (color, resolve_target) = &drawn.color;
    // A resolved color is all that's kept of the multisampled one.
    let color_store = match resolve_target {
        Some(_) => wgpu::StoreOp::Discard,
        None => wgpu::StoreOp::Store,
    };
    deep_gpu::alloc::outside(|| {
        let mut pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
            label: Some(GEOMETRY_PASS),
            color_attachments: &[
                Some(wgpu::RenderPassColorAttachment {
                    view: color,
                    resolve_target: resolve_target.as_ref(),
                    depth_slice: None,
                    ops: wgpu::Operations {
                        load: wgpu::LoadOp::Clear(wgpu::Color { r, g, b, a }),
                        store: color_store,
                    },
                }),
                Some(wgpu::RenderPassColorAttachment {
                    view: &drawn.ids_ms,
                    resolve_target: None,
                    depth_slice: None,
                    ops: wgpu::Operations {
                        load: wgpu::LoadOp::Clear(wgpu::Color::TRANSPARENT),
                        store: wgpu::StoreOp::Store,
                    },
                }),
            ],
            depth_stencil_attachment: Some(wgpu::RenderPassDepthStencilAttachment {
                view: &drawn.depth_ms,
                depth_ops: Some(wgpu::Operations {
                    load: wgpu::LoadOp::Clear(clear_depth as f32),
                    store: wgpu::StoreOp::Store,
                }),
                stencil_ops: None,
            }),
            timestamp_writes: timestamps,
            ..Default::default()
        });
        if let Some([x, y, w, h]) = crop {
            pass.set_scissor_rect(x, y, w, h);
        }
        // The sky first, behind everything (#422).
        if let Some((pipeline, binds)) = sky {
            pass.set_pipeline(pipeline);
            for (i, b) in binds.iter().enumerate() {
                pass.set_bind_group(i as u32, b, &[]);
            }
            pass.draw(0..3, 0..1);
        }
        pass.execute_bundles(bundles);
        // The puffs last, back to front over everything they're in front of (#422).
        if let Some((pipeline, binds, buffer, count)) = puffs {
            pass.set_pipeline(pipeline);
            for (i, b) in binds.iter().enumerate() {
                pass.set_bind_group(i as u32, b, &[]);
            }
            pass.set_vertex_buffer(0, buffer.slice(..));
            pass.draw(0..6, 0..*count);
        }
        drop(pass);
        resolve_ids(encoder, drawn, clear_depth, None, None);
        if let Some((pipeline, bind, previous, drew)) = &drawn.accumulates {
            let linear = drawn.color.1.as_ref().unwrap_or(&drawn.color.0);
            if drew.swap(true, Ordering::SeqCst) {
                let mut pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
                    label: Some(RESOLVE_PASS),
                    color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                        view: linear,
                        resolve_target: None,
                        depth_slice: None,
                        ops: wgpu::Operations {
                            load: wgpu::LoadOp::Load,
                            store: wgpu::StoreOp::Store,
                        },
                    })],
                    ..Default::default()
                });
                pass.set_pipeline(pipeline);
                pass.set_bind_group(0, bind, &[]);
                pass.set_blend_constant(wgpu::Color {
                    r: 0.5,
                    g: 0.5,
                    b: 0.5,
                    a: 0.5,
                });
                pass.draw(0..3, 0..1);
            }
            encoder.copy_texture_to_texture(
                linear.texture().as_image_copy(),
                previous.as_image_copy(),
                previous.size(),
            );
        }
    });
}

/// The per-pixel items' fragments into their lists (#424), after the resolve (#1173).
#[allow(clippy::type_complexity)]
pub(super) fn per_pixel_pass(
    encoder: &mut wgpu::CommandEncoder,
    [linear, ids, depth]: [&wgpu::TextureView; 3],
    pipeline: &wgpu::RenderPipeline,
    binds: &[wgpu::BindGroup; 4],
    draws: &[ClearDraw],
) {
    let load = wgpu::Operations {
        load: wgpu::LoadOp::Load,
        store: wgpu::StoreOp::Store,
    };
    let attach = |view| {
        Some(wgpu::RenderPassColorAttachment {
            view,
            resolve_target: None,
            depth_slice: None,
            ops: load,
        })
    };
    let mut pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
        label: Some("scene3d.per_pixel"),
        color_attachments: &[attach(linear), attach(ids)],
        depth_stencil_attachment: Some(wgpu::RenderPassDepthStencilAttachment {
            view: depth,
            depth_ops: Some(wgpu::Operations {
                load: wgpu::LoadOp::Load,
                store: wgpu::StoreOp::Store,
            }),
            stencil_ops: None,
        }),
        ..Default::default()
    });
    for (i, b) in binds.iter().take(3).enumerate() {
        pass.set_bind_group(i as u32, b, &[]);
    }
    pass.set_pipeline(pipeline);
    for (vertices, indices, count, instances, k, maps, _) in draws {
        pass.set_bind_group(3, maps, &[]);
        pass.set_vertex_buffer(0, vertices.slice(..));
        pass.set_vertex_buffer(1, instances.slice(..));
        pass.set_index_buffer(indices.slice(..), wgpu::IndexFormat::Uint32);
        pass.draw_indexed(0..*count, 0, *k..*k + 1);
    }
}

pub(super) fn glass_pass(
    encoder: &mut wgpu::CommandEncoder,
    [linear, ids, depth]: [&wgpu::TextureView; 3],
    pipeline: Option<&wgpu::RenderPipeline>,
    binds: &[wgpu::BindGroup; 3],
    draws: &[ClearDraw],
    late: &[LateDraw],
    timestamps: Option<wgpu::RenderPassTimestampWrites<'_>>,
) {
    let load = wgpu::Operations {
        load: wgpu::LoadOp::Load,
        store: wgpu::StoreOp::Store,
    };
    let color = |view| {
        Some(wgpu::RenderPassColorAttachment {
            view,
            resolve_target: None,
            depth_slice: None,
            ops: load,
        })
    };
    let mut pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
        label: Some(glass::PASS),
        color_attachments: &[color(linear), color(ids)],
        depth_stencil_attachment: Some(wgpu::RenderPassDepthStencilAttachment {
            view: depth,
            depth_ops: Some(wgpu::Operations {
                load: wgpu::LoadOp::Load,
                store: wgpu::StoreOp::Store,
            }),
            stencil_ops: None,
        }),
        timestamp_writes: timestamps,
        ..Default::default()
    });
    for (i, b) in binds.iter().enumerate() {
        pass.set_bind_group(i as u32, b, &[]);
    }
    for (vertices, indices, count, instances, k, maps, own) in draws {
        // A part with a material operator draws through its own glass pipeline (#486).
        let Some(p) = own.as_ref().or(pipeline) else {
            continue;
        };
        pass.set_pipeline(p);
        pass.set_bind_group(3, maps, &[]);
        pass.set_vertex_buffer(0, vertices.slice(..));
        pass.set_vertex_buffer(1, instances.slice(..));
        pass.set_index_buffer(indices.slice(..), wgpu::IndexFormat::Uint32);
        pass.draw_indexed(0..*count, 0, *k..*k + 1);
    }
    // Blend and add parts, back to front, over the glass (#428).
    for (pipeline, (vertices, indices, count, instances, k, maps)) in late {
        pass.set_pipeline(pipeline);
        pass.set_bind_group(3, maps, &[]);
        pass.set_vertex_buffer(0, vertices.slice(..));
        pass.set_vertex_buffer(1, instances.slice(..));
        pass.set_index_buffer(indices.slice(..), wgpu::IndexFormat::Uint32);
        pass.draw_indexed(0..*count, 0, *k..*k + 1);
    }
}

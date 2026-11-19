//! A 2D document's frame under a look as `film2d` draws it (issue #1561): its items through the
//! document's 2D camera, on the look's paper as that camera and the look's lamps see it, and its
//! writer layers composed over that paper. The live window's 2D frames and deep-show's draw
//! through this, so a look's drawn fields reach each as they reach `film2d`.

use std::collections::BTreeMap;
use std::sync::Arc;

use deep_canvas_drawn::spec::{Kind, Look};
use deep_canvas_marks::drawn::{self, View};
use deep_canvas_marks::scene::{self, Drawn, Palette, Record, Refused, Rgb, Type};
use deep_gpu::device::Device;
use deep_gpu::surface::FORMAT;
use deep_marks_render::gpu::{Options, Vello2d};
use serde_json::{Map, Value};

use crate::drawn::Page;
use crate::groups::{Clock, Groups, Layer};

/// `items`, evaluated at t, as the frame draws them: through the document's 2D camera, when it
/// has one. Answers `page` as that camera and the look's lamps see it.
pub fn placed(
    doc: &Map<String, Value>,
    items: &mut Map<String, Value>,
    (palette, ty): (&Palette, &Type),
    page: Option<&Page>,
) -> Result<Option<Page>, Refused> {
    let lamps = match &ty.drawn {
        Some(look) => drawn::screen_lamps(look, items, palette)?,
        None => Vec::new(),
    };
    let view = drawn::view_of(doc, items);
    if let Some(v) = &view {
        drawn::through(v, items);
    }
    Ok(page.map(|p| p.seen_through(view.as_ref(), lamps)))
}

/// Whether a frame on `page` composites, whatever its marks: its paper and its relief are the
/// compositor's passes.
pub fn on_paper(page: Option<&Page>) -> bool {
    page.is_some_and(|p| p.sheet.is_some() || p.relief.is_some())
}

/// A frame's writer layers as the compositor draws them on `page`, its paper under them.
pub fn layer<'a>(
    layers: &'a [&'a [Arc<Drawn>]],
    size: [u32; 2],
    clock: Clock,
    roles: &'a BTreeMap<String, [f64; 3]>,
    page: Option<&'a Page>,
) -> Layer<'a> {
    Layer {
        layers,
        size,
        options: Options::default(),
        clock,
        roles,
        packs: &[],
        canonical: false,
        base: None,
        keep: false,
        planted: None,
        guard: None,
        other: None,
        page,
        ground: true,
    }
}

/// A frame's surface, premultiplied BGRA rows, over the look's `ground`: opaque RGBA rows.
fn over_ground(bytes: &[u8], ground: Rgb) -> Vec<u8> {
    let mut out = Vec::with_capacity(bytes.len());
    for p in bytes.as_chunks::<4>().0 {
        let under = |c: u8| u32::from(c) * (255 - u32::from(p[3]));
        let over = |s: u8, g: u8| (u32::from(s) + (under(g) + 127) / 255).min(255) as u8;
        out.extend_from_slice(&[
            over(p[2], ground[0]),
            over(p[1], ground[1]),
            over(p[0], ground[2]),
            255,
        ]);
    }
    out
}

/// A look's paper for `doc`, before any frame's camera sees it; the code and path of the role or
/// asset it can't read.
pub fn page_of(
    look: &Look,
    doc: &Map<String, Value>,
    roles: &BTreeMap<String, [f64; 3]>,
) -> Result<Page, (&'static str, String)> {
    Page::of(look, &View::NONE, doc, roles, &Map::new()).map_err(|refusal| {
        let code = match refusal["code"].as_str() {
            Some("asset_unreadable") => "asset_unreadable",
            _ => "role_unresolved",
        };
        (
            code,
            refusal["reason"].as_str().unwrap_or("look").to_string(),
        )
    })
}

/// Whether `look` draws `doc` through a pass Vello CPU has none of: its light, a paper with a
/// tooth or age, or an item's paint naming a fill that is a medium or a line with a profile,
/// a pressure or a dry stroke. Any other document draws in the look's roles alone.
pub fn drawn_by(look: &Look, page: &Page, doc: &Map<String, Value>) -> bool {
    let names = |item: &Value| {
        let paint = &item["params"]["paint"];
        let fill = paint["fill"]["fill"].as_str();
        let line = paint["stroke"]["line"].as_str();
        fill.and_then(|n| look.fill(n).ok().flatten())
            .is_some_and(|f| f.kind != Kind::Flat || f.offset.is_some() || f.pressure.is_some())
            || line
                .and_then(|n| look.line(n).ok().flatten())
                .is_some_and(|l| l.profile.is_some() || l.pressure.is_some() || l.dry > 0.0)
    };
    let items = doc.get("items").and_then(Value::as_object);
    look.light.is_some() || page.textured() || items.is_some_and(|i| i.values().any(names))
}

/// A host's 2D frames drawn off any window, on its own device: Vello GPU and the compositor,
/// kept from frame to frame.
pub struct Frames2 {
    vello: Vello2d,
    groups: Groups,
}

impl Frames2 {
    pub fn new(device: &Device) -> Frames2 {
        Frames2 {
            vello: Vello2d::new(&device.device, FORMAT),
            groups: Groups::new(&device.device),
        }
    }

    /// The frame of `doc` at `t`, whose `items` are evaluated there, in the look's `palette` and
    /// `ty` on `page`: opaque RGBA rows top-down, as `film2d` captures it.
    #[allow(clippy::too_many_arguments)]
    pub fn rgba(
        &mut self,
        device: &Device,
        doc: &Map<String, Value>,
        mut items: Map<String, Value>,
        (palette, ty): (&Palette, &Type),
        page: Option<&Page>,
        t: i64,
        size: [u32; 2],
    ) -> Result<Vec<u8>, (&'static str, String)> {
        let refuse = |r: Refused| (r.code, r.path);
        let page = placed(doc, &mut items, (palette, ty), page).map_err(refuse)?;
        let record = Record {
            pinned: t,
            ..Record::default()
        };
        let none = scene::Planted::None;
        let frame =
            scene::frame_planted(doc, &items, (palette, ty), &record, 1.0, none).map_err(refuse)?;
        let layers: Vec<Vec<Arc<Drawn>>> = frame
            .layers
            .iter()
            .map(|l| l.marks.iter().cloned().collect())
            .collect();
        let slices: Vec<&[Arc<Drawn>]> = layers.iter().map(Vec::as_slice).collect();
        let roles = palette
            .iter()
            .map(|(k, c)| (k.clone(), c.map(|v| f64::from(v) / 255.0)))
            .collect();
        let composed = layer(&slices, size, Clock::of(doc, t), &roles, page.as_ref());
        let (done, ..) = self
            .groups
            .compose(device, &mut self.vello, &composed)
            .map_err(|e| ("not_drawn", e.to_string()))?;
        let d = &device.device;
        let target = d.create_texture(&wgpu::TextureDescriptor {
            label: Some("frame2"),
            size: wgpu::Extent3d {
                width: size[0],
                height: size[1],
                depth_or_array_layers: 1,
            },
            mip_level_count: 1,
            sample_count: 1,
            dimension: wgpu::TextureDimension::D2,
            format: FORMAT,
            usage: wgpu::TextureUsages::RENDER_ATTACHMENT | wgpu::TextureUsages::COPY_SRC,
            view_formats: &[],
        });
        let mut encoder = d.create_command_encoder(&Default::default());
        let view = target.create_view(&Default::default());
        self.groups
            .finish(d, &mut encoder, &done, &view, FORMAT, false);
        device.queue.submit([encoder.finish()]);
        let bytes = crate::read::read_bytes(device, &target);
        Ok(over_ground(&bytes, frame.ground))
    }
}

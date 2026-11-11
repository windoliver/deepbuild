//! Issue #464: a 2D frame through the look's print finish. The base frame (every mark but the
//! separations' inks), each separation's coverage (its role's marks drawn alone) and the finish
//! pass that prints them onto the paper, with the linear target read back when a call asks.

use std::collections::{BTreeMap, BTreeSet};
use std::sync::{Arc, Mutex};

use deep_canvas_marks::print::{self, Print};
use deep_canvas_marks::scene::Rgb;
use deep_scene3d_render::print::{Coverage, Placed, Planted, Printer, LINEAR};
use serde_json::{Map, Value};

/// What a 2D frame prints: the look's print fields and the values this frame draws from.
pub(crate) struct Printing {
    pub print: Arc<Print>,
    pub frame: print::Frame,
    pub placed: Placed,
    pub ground: Rgb,
    /// Each separation's items: those whose fill or stroke names its role.
    pub inks: Vec<BTreeSet<String>>,
    pub planted: Planted,
}

impl Printing {
    /// Every item a separation prints.
    pub fn inked(&self) -> BTreeSet<String> {
        self.inks.iter().flatten().cloned().collect()
    }
}

/// The role an item's paint names, its fill's or else its stroke's.
fn role_of(item: &Value) -> Option<&str> {
    let paint = item.pointer("/params/paint")?;
    paint
        .pointer("/fill/role")
        .or_else(|| paint.pointer("/stroke/role"))
        .and_then(Value::as_str)
}

/// Each separation's items among `items`.
pub(crate) fn inks(print: &Print, items: &Map<String, Value>) -> Vec<BTreeSet<String>> {
    print
        .separations
        .iter()
        .map(|s| {
            items
                .iter()
                .filter(|(_, i)| role_of(i) == Some(s.role.as_str()))
                .map(|(id, _)| id.clone())
                .collect()
        })
        .collect()
}

/// What a call reads back of its frames beyond the slot: the linear target, once written.
#[derive(Clone, Default)]
pub(crate) struct Taps {
    pub want_linear: Arc<Mutex<bool>>,
    pub linear: Arc<Mutex<Option<crate::indexed::Written<wgpu::Texture>>>>,
    pub indices: crate::indexed::IndexTap,
}

impl Taps {
    pub fn wants_linear(&self) -> bool {
        *self.want_linear.lock().unwrap_or_else(|e| e.into_inner())
    }
}

/// The textures a printed 2D frame draws through, kept from frame to frame at one size.
pub(crate) struct Stage {
    pub printer: Arc<Mutex<Printer>>,
    size: [u32; 2],
    pub source: (wgpu::Texture, wgpu::TextureView),
    pub covs: Vec<(wgpu::Texture, wgpu::TextureView)>,
    pub linear: Option<(wgpu::Texture, wgpu::TextureView)>,
}

fn texture(
    device: &deep_gpu::counted::Wgpu,
    label: &str,
    size: [u32; 2],
    format: wgpu::TextureFormat,
    usage: wgpu::TextureUsages,
) -> (wgpu::Texture, wgpu::TextureView) {
    let t = device.create_texture(&wgpu::TextureDescriptor {
        label: Some(label),
        size: wgpu::Extent3d {
            width: size[0],
            height: size[1],
            depth_or_array_layers: 1,
        },
        mip_level_count: 1,
        sample_count: 1,
        dimension: wgpu::TextureDimension::D2,
        format,
        usage,
        view_formats: &[],
    });
    let v = t.create_view(&Default::default());
    (t, v)
}

impl Stage {
    /// The stage for a frame of `size` with `covs` separations and the linear target or not,
    /// reusing `kept`'s textures where they fit.
    pub fn ensure(
        kept: Option<Stage>,
        device: &deep_gpu::counted::Wgpu,
        format: wgpu::TextureFormat,
        size: [u32; 2],
        covs: usize,
        linear: bool,
    ) -> Stage {
        let draw = wgpu::TextureUsages::RENDER_ATTACHMENT | wgpu::TextureUsages::TEXTURE_BINDING;
        let mut stage = match kept {
            Some(s) if s.size == size => s,
            Some(s) => Stage {
                printer: s.printer,
                size,
                source: texture(device, "print source", size, format, draw),
                covs: Vec::new(),
                linear: None,
            },
            None => Stage {
                printer: Arc::new(Mutex::new(Printer::new(device))),
                size,
                source: texture(device, "print source", size, format, draw),
                covs: Vec::new(),
                linear: None,
            },
        };
        while stage.covs.len() < covs {
            stage
                .covs
                .push(texture(device, "print coverage", size, format, draw));
        }
        if linear && stage.linear.is_none() {
            let usage = wgpu::TextureUsages::RENDER_ATTACHMENT | wgpu::TextureUsages::COPY_SRC;
            stage.linear = Some(texture(device, "print linear", size, LINEAR, usage));
        }
        stage
    }

    /// Records the finish from the stage's source into `target`, with each separation's coverage.
    pub fn record(
        &self,
        device: &deep_gpu::counted::Wgpu,
        encoder: &mut wgpu::CommandEncoder,
        printing: &Printing,
        target: &wgpu::TextureView,
        format: wgpu::TextureFormat,
        linear: bool,
    ) {
        let params = deep_scene3d_render::print::params(
            &printing.print,
            &printing.frame,
            self.size,
            printing.placed,
            printing.ground,
            false,
            printing.planted,
        );
        let covs = Coverage::Textures(
            self.covs
                .iter()
                .take(printing.print.separations.len())
                .map(|(_, v)| v)
                .collect(),
        );
        let linear = self.linear.as_ref().filter(|_| linear).map(|(_, v)| v);
        self.printer
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .record(
                device,
                encoder,
                &params,
                &self.source.1,
                &covs,
                target,
                format,
                linear,
            );
    }
}

/// An f32 RGBA texture read back, rows top-down, `w × h × 16` bytes.
pub(crate) fn read_f32(
    device: &deep_gpu::counted::Wgpu,
    queue: &deep_gpu::counted::Queue,
    texture: &wgpu::Texture,
    size: [u32; 2],
) -> Result<Vec<u8>, String> {
    let row = (size[0] * 16).next_multiple_of(wgpu::COPY_BYTES_PER_ROW_ALIGNMENT);
    let buffer = device.create_buffer(&wgpu::BufferDescriptor {
        label: Some("print linear read back"),
        size: u64::from(row) * u64::from(size[1]),
        usage: wgpu::BufferUsages::COPY_DST | wgpu::BufferUsages::MAP_READ,
        mapped_at_creation: false,
    });
    let mut encoder = device.create_command_encoder(&Default::default());
    encoder.copy_texture_to_buffer(
        texture.as_image_copy(),
        wgpu::TexelCopyBufferInfo {
            buffer: &buffer,
            layout: wgpu::TexelCopyBufferLayout {
                offset: 0,
                bytes_per_row: Some(row),
                rows_per_image: None,
            },
        },
        wgpu::Extent3d {
            width: size[0],
            height: size[1],
            depth_or_array_layers: 1,
        },
    );
    queue.submit([encoder.finish()]);
    map_rows(
        device,
        &buffer,
        row as usize,
        (size[0] * 16) as usize,
        size[1] as usize,
    )
}

/// A mapped buffer's rows, each `width` bytes of a `row`-byte stride.
pub(crate) fn map_rows(
    device: &deep_gpu::counted::Wgpu,
    buffer: &wgpu::Buffer,
    row: usize,
    width: usize,
    rows: usize,
) -> Result<Vec<u8>, String> {
    let (tx, rx) = std::sync::mpsc::channel();
    buffer.slice(..).map_async(wgpu::MapMode::Read, move |r| {
        let _ = tx.send(r);
    });
    let _ = device.poll(wgpu::PollType::wait_indefinitely());
    if !matches!(rx.recv(), Ok(Ok(()))) {
        return Err("the read back didn't map".into());
    }
    let data = buffer
        .slice(..)
        .get_mapped_range()
        .map_err(|_| "the read back didn't map".to_string())?;
    let mut out = Vec::with_capacity(width * rows);
    for y in 0..rows {
        out.extend_from_slice(&data[y * row..y * row + width]);
    }
    Ok(out)
}

/// A look's print fields for a 2D frame at document time `t`, or `None` when it prints nothing.
#[allow(clippy::too_many_arguments)]
pub(crate) fn printing(
    look: &Value,
    roles: &BTreeMap<String, Rgb>,
    width: f64,
    seed: u32,
    t: i64,
    reduced_motion: bool,
    items: &Map<String, Value>,
    placed: Placed,
    ground: Rgb,
    planted: Option<crate::Planted>,
) -> Result<Option<Printing>, print::Refused> {
    let print = print::read(look, roles, width)?;
    if print.is_identity() {
        return Ok(None);
    }
    let held = reduced_motion && planted != Some(crate::Planted::GrainFromT);
    let mut frame = print::frame(&print, seed, t, held);
    match planted {
        Some(crate::Planted::GrainFromT) => frame.grain_step = (t / 1000) as u32 ^ 0x5bd1_e995,
        Some(crate::Planted::FlickerWallTime) => {
            if let Some(w) = print.wear {
                let now = std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .map_or(0, |d| d.subsec_nanos());
                frame.flicker = 1.0 + w.flicker * (2.0 * print::unit(now, seed, 0x11) - 1.0);
            }
        }
        _ => {}
    }
    Ok(Some(Printing {
        inks: inks(&print, items),
        print: Arc::new(print),
        frame,
        placed,
        ground,
        planted: Planted {
            vignette_pixels: planted == Some(crate::Planted::VignettePixels),
        },
    }))
}

/// Each pixel's relative luminance (linear Rec. 709 Y) of an RGBA picture.
pub(crate) fn luminance(rgba: &[u8]) -> Vec<f32> {
    let lin = |c: u8| deep_canvas_marks::finish::srgb_decode(f64::from(c) / 255.0);
    rgba.as_chunks::<4>()
        .0
        .iter()
        .map(|p| (0.2126 * lin(p[0]) + 0.7152 * lin(p[1]) + 0.0722 * lin(p[2])) as f32)
        .collect()
}

/// The flicker check (canvas primitives: Flicker check) over a film's frames at `fps`, at its
/// defaults: a transition is a change of relative luminance over 0.1 whose darker frame is below
/// 0.80, made at once by a quarter of the view or more; a flash is a pair of opposing
/// transitions; more than three flashes in any one-second window fail, naming the frame.
pub(crate) fn flicker(frames: &[Vec<f32>], fps: f64) -> Value {
    const DELTA: f32 = 0.1;
    const DARKER_MAX: f32 = 0.8;
    const AREA: f64 = 0.25;
    // Each transition's frame and its sign.
    let mut transitions: Vec<(usize, i8)> = Vec::new();
    for (k, pair) in frames.windows(2).enumerate() {
        let (a, b) = (&pair[0], &pair[1]);
        let (mut up, mut down) = (0usize, 0usize);
        for (x, y) in a.iter().zip(b) {
            if (y - x).abs() > DELTA && x.min(*y) < DARKER_MAX {
                if y > x {
                    up += 1;
                } else {
                    down += 1;
                }
            }
        }
        let n = a.len().max(1) as f64;
        if up as f64 / n >= AREA {
            transitions.push((k + 1, 1));
        } else if down as f64 / n >= AREA {
            transitions.push((k + 1, -1));
        }
    }
    let flashes: Vec<usize> = transitions
        .windows(2)
        .filter(|w| w[0].1 != w[1].1)
        .map(|w| w[1].0)
        .collect();
    let window = fps.max(1.0).round() as usize;
    let failing = flashes.iter().find(|&&at| {
        flashes
            .iter()
            .filter(|&&f| f <= at && f + window > at)
            .count()
            > 3
    });
    match failing {
        Some(at) => serde_json::json!({"verdict": "FAIL", "frame": at, "flashes": flashes.len()}),
        None if frames.len() < 2 => serde_json::json!({"verdict": "INCONCLUSIVE", "flashes": 0}),
        None => serde_json::json!({"verdict": "PASS", "flashes": flashes.len()}),
    }
}

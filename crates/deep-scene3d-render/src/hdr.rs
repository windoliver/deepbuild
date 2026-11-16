//! Issue #177 (canvas primitives: GPU surface: HDR output): the pass that writes the live view's
//! HDR surface, RGBA16Float in extended linear sRGB, from the finished SDR slot and the linear
//! target, rolled off to the display's headroom (hdr.wgsl). It's live only: a check, a golden,
//! render-back and an export never run it, and with no HDR surface a frame doesn't either.

use deep_gpu::device::Device;

use crate::{bind_group, buffer_entry, full_pass, pipeline, target, texture_entry};

const SOURCE: &str = include_str!("hdr.wgsl");
pub const HDR_PASS: &str = "scene3d.hdr";
/// The HDR surface's format.
pub const FORMAT: wgpu::TextureFormat = wgpu::TextureFormat::Rgba16Float;

#[repr(C)]
#[derive(Clone, Copy, bytemuck::Pod, bytemuck::Zeroable, PartialEq)]
struct Params {
    headroom: f32,
    tolerance: f32,
    scale: [f32; 2],
    /// A planted wrong pass (hdr.wgsl), 0 for none.
    plant: u32,
    _pad: [u32; 3],
}

/// The pass, built the first time a view presents HDR.
pub struct HdrPass {
    layout: wgpu::BindGroupLayout,
    pipeline: wgpu::RenderPipeline,
    params: wgpu::Buffer,
    written: Option<Params>,
    /// One bind group per slot, linear target and covered mask, so a warm frame makes none.
    binds: Vec<([wgpu::TextureView; 3], wgpu::BindGroup)>,
}

impl HdrPass {
    pub fn new(device: &Device, output: &str) -> HdrPass {
        let d = &device.device;
        let module = d.create_shader_module(wgpu::ShaderModuleDescriptor {
            label: Some(HDR_PASS),
            source: wgpu::ShaderSource::Wgsl(format!("{output}\n{SOURCE}").into()),
        });
        let mut covered = texture_entry();
        covered.binding = 2;
        let mut slot = texture_entry();
        slot.binding = 3;
        let layout = d.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            label: Some(HDR_PASS),
            entries: &[
                texture_entry(),
                buffer_entry(
                    1,
                    wgpu::ShaderStages::FRAGMENT,
                    wgpu::BufferBindingType::Uniform,
                ),
                covered,
                slot,
                buffer_entry(
                    4,
                    wgpu::ShaderStages::FRAGMENT,
                    wgpu::BufferBindingType::Uniform,
                ),
            ],
        });
        let pipeline_layout = d.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
            label: Some(HDR_PASS),
            bind_group_layouts: &[Some(&layout)],
            immediate_size: 0,
        });
        let pipeline = pipeline(
            d,
            HDR_PASS,
            Some(&pipeline_layout),
            &module,
            ("out_vs", &[]),
            Some(("hdr_fs", &[target(FORMAT, None)])),
            None,
        );
        let params = d.create_buffer(&wgpu::BufferDescriptor {
            label: Some(HDR_PASS),
            size: std::mem::size_of::<Params>() as u64,
            usage: wgpu::BufferUsages::UNIFORM | wgpu::BufferUsages::COPY_DST,
            mapped_at_creation: false,
        });
        HdrPass {
            layout,
            pipeline,
            params,
            written: None,
            binds: Vec::new(),
        }
    }

    /// The pipeline and bind group that write the HDR surface from `slot`, `linear` and
    /// `covered`, rolled off to `headroom`.
    #[allow(clippy::too_many_arguments)]
    pub fn prepare(
        &mut self,
        device: &Device,
        tone: &wgpu::Buffer,
        [linear, covered, slot]: [&wgpu::TextureView; 3],
        headroom: f32,
        deband: f32,
        scale: [f32; 2],
        plant: u32,
    ) -> (wgpu::RenderPipeline, wgpu::BindGroup) {
        let params = Params {
            headroom: headroom.max(1.0),
            tolerance: deband.ceil() + 1.0,
            scale,
            plant,
            _pad: [0; 3],
        };
        if self.written != Some(params) {
            device
                .queue
                .write_buffer(&self.params, 0, bytemuck::bytes_of(&params));
            self.written = Some(params);
        }
        let key = [linear.clone(), covered.clone(), slot.clone()];
        let bind = match self.binds.iter().find(|(k, _)| *k == key) {
            Some((_, b)) => b.clone(),
            None => {
                let b = bind_group(
                    &device.device,
                    HDR_PASS,
                    &self.layout,
                    [
                        wgpu::BindingResource::TextureView(linear),
                        tone.as_entire_binding(),
                        wgpu::BindingResource::TextureView(covered),
                        wgpu::BindingResource::TextureView(slot),
                        self.params.as_entire_binding(),
                    ],
                );
                // A slot ring holds at most three; older targets are gone.
                if self.binds.len() >= 6 {
                    self.binds.remove(0);
                }
                self.binds.push((key, b.clone()));
                b
            }
        };
        (self.pipeline.clone(), bind)
    }
}

/// Records the HDR pass `prepare` made into `into`.
pub fn record(
    encoder: &mut wgpu::CommandEncoder,
    (pipeline, bind): &(wgpu::RenderPipeline, wgpu::BindGroup),
    into: &wgpu::TextureView,
    timestamps: Option<wgpu::RenderPassTimestampWrites<'_>>,
) {
    full_pass(
        encoder,
        HDR_PASS,
        into,
        wgpu::LoadOp::Clear(wgpu::Color::BLACK),
        pipeline,
        bind,
        timestamps,
    );
}

/// An HDR surface off screen, `size` in device px: the stub display's (#177).
pub fn offscreen(device: &Device, size: [u32; 2]) -> wgpu::Texture {
    device.device.create_texture(&wgpu::TextureDescriptor {
        label: Some("scene3d hdr surface"),
        size: wgpu::Extent3d {
            width: size[0].max(1),
            height: size[1].max(1),
            depth_or_array_layers: 1,
        },
        mip_level_count: 1,
        sample_count: 1,
        dimension: wgpu::TextureDimension::D2,
        format: FORMAT,
        usage: wgpu::TextureUsages::RENDER_ATTACHMENT | wgpu::TextureUsages::COPY_SRC,
        view_formats: &[],
    })
}

/// An HDR surface's texels read back: little-endian f16 RGBA, rows top-down, tightly packed.
pub fn read(device: &Device, texture: &wgpu::Texture) -> Option<Vec<u8>> {
    let [w, h] = [texture.width(), texture.height()];
    let row = w * 8;
    let padded =
        row.div_ceil(wgpu::COPY_BYTES_PER_ROW_ALIGNMENT) * wgpu::COPY_BYTES_PER_ROW_ALIGNMENT;
    let view = crate::read_back(
        device,
        HDR_PASS,
        u64::from(padded) * u64::from(h),
        |e, b| {
            e.copy_texture_to_buffer(
                texture.as_image_copy(),
                wgpu::TexelCopyBufferInfo {
                    buffer: b,
                    layout: wgpu::TexelCopyBufferLayout {
                        offset: 0,
                        bytes_per_row: Some(padded),
                        rows_per_image: Some(h),
                    },
                },
                texture.size(),
            );
        },
    )?;
    let mut out = Vec::with_capacity((row * h) as usize);
    for y in 0..h as usize {
        let at = y * padded as usize;
        out.extend_from_slice(&view[at..at + row as usize]);
    }
    Some(out)
}

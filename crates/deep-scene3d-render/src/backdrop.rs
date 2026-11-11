//! What draws behind the scene, first in the geometry pass (#422, #503; canvas primitives: Sky
//! `sky@1`: environment): the sky's pipeline, and a 360° video background in its place. The video
//! background draws the frame the host put in the scene's texels as `video:<sky id>`, mapped
//! around the view as an equirectangular HDR environment is, at the environment's rotation and
//! intensity, and filtered bilinearly in linear light along each pixel's centre ray
//! (backdrop.wgsl). Its texture is written only when the frame changes. Lighting and reflections
//! never read it: the environment's key, cubes and coefficients stay the still environment's, so
//! the video never relights the scene and nothing is prefiltered per frame.

use std::hash::{Hash, Hasher};
use std::sync::Arc;

use bytemuck::{Pod, Zeroable};
use deep_canvas_scene3d::light::Texels;
use deep_canvas_scene3d::scene::Scene;
use deep_canvas_scene3d::sky::{Background, Sky};
use deep_gpu::counted::{Wgpu, Written};
use deep_gpu::device::Device;

use crate::env::Equirect;
use crate::{buffer_entry, culled, target, DEPTH, IDS_MS, LINEAR, SKY_PASS};

const SHADER: &str = include_str!("backdrop.wgsl");
/// The video background's pipeline, drawn in the sky's place (#503).
pub const PASS: &str = "scene3d.video_background";

/// The sky's pipeline: a full-screen triangle at the far plane, behind everything, writing no
/// depth and no object ID.
pub(crate) fn sky_pipeline(
    d: &Wgpu,
    samples: u32,
    module: &wgpu::ShaderModule,
    layout: &wgpu::PipelineLayout,
    forward_z: bool,
) -> wgpu::RenderPipeline {
    behind(
        d,
        samples,
        SKY_PASS,
        (module, layout),
        forward_z,
        ("sky_vs", "sky_fs"),
    )
}

/// A full-screen triangle's pipeline at the far plane, behind everything, writing no depth and
/// no object ID, from `module`'s entry points `vs` and `fs`.
fn behind(
    d: &Wgpu,
    samples: u32,
    label: &str,
    (module, layout): (&wgpu::ShaderModule, &wgpu::PipelineLayout),
    forward_z: bool,
    (vs, fs): (&str, &str),
) -> wgpu::RenderPipeline {
    let depth = wgpu::DepthStencilState {
        format: DEPTH,
        depth_write_enabled: Some(false),
        depth_compare: Some(if forward_z {
            wgpu::CompareFunction::LessEqual
        } else {
            wgpu::CompareFunction::GreaterEqual
        }),
        stencil: Default::default(),
        bias: Default::default(),
    };
    let targets = [target(LINEAR, None), target(IDS_MS, None)];
    culled(
        d,
        samples,
        label,
        Some(layout),
        module,
        (vs, &[]),
        Some((fs, &targets)),
        Some(depth),
        None,
    )
}

/// backdrop.wgsl's `Backdrop`.
#[repr(C)]
#[derive(Clone, Copy, Pod, Zeroable)]
struct Uniform {
    inv: [[f32; 4]; 4],
    eye: [f32; 4],
    forward: [f32; 4],
    k: [f32; 4],
}

/// The video background's pipeline, its group's layout and its uniform, made the first frame one
/// draws.
struct Kit {
    pipeline: wgpu::RenderPipeline,
    layout: wgpu::BindGroupLayout,
    buffer: wgpu::Buffer,
    written: Written,
}

impl Kit {
    /// Its pipeline lays out the solids' groups 0 to 2, which the sky's draw binds, and its own
    /// group 3: the uniform and the frame.
    fn new(d: &Wgpu, groups: &[wgpu::BindGroupLayout; 4], samples: u32, forward_z: bool) -> Kit {
        let layout = d.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            label: Some(PASS),
            entries: &[
                buffer_entry(
                    0,
                    wgpu::ShaderStages::VERTEX_FRAGMENT,
                    wgpu::BufferBindingType::Uniform,
                ),
                wgpu::BindGroupLayoutEntry {
                    binding: 1,
                    visibility: wgpu::ShaderStages::FRAGMENT,
                    ty: wgpu::BindingType::Texture {
                        sample_type: wgpu::TextureSampleType::Float { filterable: false },
                        view_dimension: wgpu::TextureViewDimension::D2,
                        multisampled: false,
                    },
                    count: None,
                },
            ],
        });
        let pipeline_layout = d.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
            label: Some(PASS),
            bind_group_layouts: &[
                Some(&groups[0]),
                Some(&groups[1]),
                Some(&groups[2]),
                Some(&layout),
            ],
            immediate_size: 0,
        });
        let module = d.create_shader_module(wgpu::ShaderModuleDescriptor {
            label: Some(PASS),
            source: wgpu::ShaderSource::Wgsl(SHADER.into()),
        });
        let pipeline = behind(
            d,
            samples,
            PASS,
            (&module, &pipeline_layout),
            forward_z,
            ("vs", "fs"),
        );
        let buffer = d.create_buffer(&wgpu::BufferDescriptor {
            label: Some(PASS),
            size: std::mem::size_of::<Uniform>() as u64,
            usage: wgpu::BufferUsages::UNIFORM | wgpu::BufferUsages::COPY_DST,
            mapped_at_creation: false,
        });
        Kit {
            pipeline,
            layout,
            buffer,
            written: Written::default(),
        }
    }

    /// A texture of `size` for the frames, sRGB so they load in linear light, and its group.
    fn texture(&self, d: &Wgpu, [width, height]: [u32; 2]) -> (wgpu::Texture, wgpu::BindGroup) {
        let texture = d.create_texture(&wgpu::TextureDescriptor {
            label: Some(PASS),
            size: wgpu::Extent3d {
                width,
                height,
                depth_or_array_layers: 1,
            },
            mip_level_count: 1,
            sample_count: 1,
            dimension: wgpu::TextureDimension::D2,
            format: wgpu::TextureFormat::Rgba8UnormSrgb,
            usage: wgpu::TextureUsages::TEXTURE_BINDING | wgpu::TextureUsages::COPY_DST,
            view_formats: &[],
        });
        let view = texture.create_view(&Default::default());
        let bind = crate::bind_group(
            d,
            PASS,
            &self.layout,
            [
                self.buffer.as_entire_binding(),
                wgpu::BindingResource::TextureView(&view),
            ],
        );
        (texture, bind)
    }
}

/// The video background: its kit, the frame its texture holds with the texture and its group, and
/// whether this frame draws it.
#[derive(Default)]
pub(crate) struct Backdrop {
    kit: Option<Kit>,
    shown: Option<(Arc<Texels>, wgpu::Texture, wgpu::BindGroup)>,
    drawn: bool,
}

/// The scene's sky and the video frame it shows behind the scene, when its background is a
/// video whose frame the host put in the scene's texels.
fn video_frame(scene: &Scene) -> Option<(&Sky, &Arc<Texels>)> {
    let sky = scene.sky.as_ref()?;
    if !matches!(sky.background, Background::Video { .. }) {
        return None;
    }
    let t = scene.texels.get(&format!("video:{}", sky.id))?;
    let [w, h] = t.size;
    let whole = t.data.len() == w as usize * h as usize * 4;
    (t.format == "rgba8" && t.mips == 1 && w > 0 && h > 0 && whole).then_some((sky, t))
}

impl Backdrop {
    /// This frame's video background, when the scene has one: its pipeline compiled the first
    /// frame one draws (true then), its frame written when it changed, and the view at `camera`
    /// on a target of `size` px with the environment's rotation and intensity.
    pub(crate) fn prepare(
        &mut self,
        device: &Device,
        scene: &Scene,
        (camera, size): (&[f64; 16], [u32; 2]),
        groups: &[wgpu::BindGroupLayout; 4],
        (samples, forward_z): (u32, bool),
    ) -> bool {
        let Some((sky, frame)) = video_frame(scene) else {
            self.drawn = false;
            return false;
        };
        self.drawn = true;
        let d = &device.device;
        let compiled = self.kit.is_none();
        let kit = (self.kit).get_or_insert_with(|| Kit::new(d, groups, samples, forward_z));
        if !self
            .shown
            .as_ref()
            .is_some_and(|s| Arc::ptr_eq(&s.0, frame))
        {
            let (texture, bind) = match self.shown.take() {
                Some((was, texture, bind)) if was.size == frame.size => (texture, bind),
                _ => kit.texture(d, frame.size),
            };
            let [width, height] = frame.size;
            deep_gpu::alloc::outside(|| {
                device.queue.write_texture(
                    wgpu::TexelCopyTextureInfo {
                        texture: &texture,
                        mip_level: 0,
                        origin: wgpu::Origin3d::ZERO,
                        aspect: wgpu::TextureAspect::All,
                    },
                    &frame.data,
                    wgpu::TexelCopyBufferLayout {
                        offset: 0,
                        bytes_per_row: Some(4 * width),
                        rows_per_image: Some(height),
                    },
                    wgpu::Extent3d {
                        width,
                        height,
                        depth_or_array_layers: 1,
                    },
                )
            });
            self.shown = Some((frame.clone(), texture, bind));
        }
        let inv = crate::ao::invert(camera);
        let cam = &scene.camera;
        let env = sky.environment.as_ref();
        let u = Uniform {
            inv: std::array::from_fn(|c| std::array::from_fn(|r| inv[c * 4 + r] as f32)),
            eye: crate::v4(cam.eye, if cam.perspective { 1.0 } else { 0.0 }),
            forward: crate::v4(cam.forward, if forward_z { 1.0 } else { 0.0 }),
            k: [
                size[0] as f32,
                size[1] as f32,
                env.map_or(1.0, |e| e.intensity) as f32,
                env.map_or(0.0, |e| e.rotation.to_radians()) as f32,
            ],
        };
        deep_gpu::alloc::outside(|| {
            let bytes = bytemuck::bytes_of(&u);
            device.queue.write_changed(&kit.buffer, &kit.written, bytes)
        });
        compiled
    }

    /// The video background's draw this frame, in the sky's place: its pipeline and group 3.
    pub(crate) fn draw(&self) -> Option<(wgpu::RenderPipeline, wgpu::BindGroup)> {
        let kit = self.kit.as_ref().filter(|_| self.drawn)?;
        Some((kit.pipeline.clone(), self.shown.as_ref()?.2.clone()))
    }
}

impl crate::Renderer {
    /// The sky's draw this frame, when it has one (#422): its pipeline and the solids' groups,
    /// the maps' group 3 since #423; or the video background's pipeline and its own group 3.
    pub(crate) fn sky_draw(&self) -> Option<crate::SkyDraw> {
        let p = self.sky_pipeline.clone().filter(|_| self.sky)?;
        let maps = || (p, self.maps.by_index(0).clone());
        let (p, group) = self.backdrop.draw().unwrap_or_else(maps);
        let shade = self.ao.shade().clone();
        Some((
            p,
            [
                self.frame_bind.clone(),
                self.lights_bind.clone(),
                shade,
                group,
            ],
        ))
    }
}

/// `video_background_prefiltered`'s wrong program (#503): the environment's source is the video
/// background's frame, keyed by its texels, so each new frame prefilters the environment again
/// and every reflection shows the video.
pub(crate) fn planted_source(on: bool, scene: &Scene) -> Option<(u64, &Arc<Texels>)> {
    if !on {
        return None;
    }
    let (_, frame) = video_frame(scene)?;
    let mut h = std::collections::hash_map::DefaultHasher::new();
    frame.size.hash(&mut h);
    frame.data.hash(&mut h);
    Some((h.finish(), frame))
}

/// A video frame's sRGB texels as linear radiance.
pub(crate) fn equirect(frame: &Texels) -> Equirect {
    let decode = |c: f64| {
        if c <= 0.04045 {
            c / 12.92
        } else {
            ((c + 0.055) / 1.055).powf(2.4)
        }
    };
    let linear: Vec<f32> = (0..=255u8)
        .map(|c| decode(f64::from(c) / 255.0) as f32)
        .collect();
    Equirect {
        size: frame.size,
        rgb: (frame.data.chunks_exact(4))
            .map(|p| [0, 1, 2].map(|i| linear[usize::from(p[i])]))
            .collect(),
    }
}

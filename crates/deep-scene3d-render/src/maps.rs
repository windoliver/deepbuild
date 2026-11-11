//! Issue #423: a material's texture maps on the GPU (canvas primitives: Material: texture maps).
//! Each map is uploaded once per key (its source's hash, its format and the transcoder's
//! version, as the decode worker made it) with its whole mip chain; each material's maps are one
//! bind group, group 3 of the solids' draws, with one sampler per map: linear min, mag and mip
//! filters, its wrap, and anisotropy up to its `filter_taps`. Samplers are bindings, so changing
//! one never recompiles a pipeline.

use std::collections::BTreeMap;
use std::sync::Arc;

use bytemuck::{Pod, Zeroable};
use deep_canvas_scene3d::light::{Maps, Texels, Wrap};

/// The maps in the order the shader numbers them: base color, metallic-roughness, normal,
/// occlusion, emission.
pub const SLOTS: usize = 5;

#[repr(C)]
#[derive(Clone, Copy, Pod, Zeroable)]
struct SlotUniform {
    u: [f32; 4],
    v: [f32; 4],
}

#[repr(C)]
#[derive(Clone, Copy, Pod, Zeroable)]
struct MapsUniform {
    slots: [SlotUniform; SLOTS],
    has: [u32; 4],
    values: [f32; 4],
}

/// The wgpu format a map's texels name.
pub fn format(name: &str) -> Option<wgpu::TextureFormat> {
    use wgpu::TextureFormat as F;
    Some(match name {
        "bc7-rgba-unorm-srgb" => F::Bc7RgbaUnormSrgb,
        "bc7-rgba-unorm" => F::Bc7RgbaUnorm,
        "bc5-rg-unorm" => F::Bc5RgUnorm,
        "bc4-r-unorm" => F::Bc4RUnorm,
        "rgba8unorm-srgb" => F::Rgba8UnormSrgb,
        "rgba8unorm" => F::Rgba8Unorm,
        _ => return None,
    })
}

/// The maps' bindings: the uniform at 0, the textures, then their samplers. A material
/// operator's pipeline (#429) adds its own after them.
pub fn layout_entries() -> Vec<wgpu::BindGroupLayoutEntry> {
    let mut entries = vec![crate::buffer_entry(
        0,
        wgpu::ShaderStages::FRAGMENT,
        wgpu::BufferBindingType::Uniform,
    )];
    for k in 0..SLOTS as u32 {
        entries.push(wgpu::BindGroupLayoutEntry {
            binding: 1 + k,
            visibility: wgpu::ShaderStages::FRAGMENT,
            ty: wgpu::BindingType::Texture {
                sample_type: wgpu::TextureSampleType::Float { filterable: true },
                view_dimension: wgpu::TextureViewDimension::D2,
                multisampled: false,
            },
            count: None,
        });
    }
    for k in 0..SLOTS as u32 {
        entries.push(wgpu::BindGroupLayoutEntry {
            binding: 1 + SLOTS as u32 + k,
            visibility: wgpu::ShaderStages::FRAGMENT,
            ty: wgpu::BindingType::Sampler(wgpu::SamplerBindingType::Filtering),
            count: None,
        });
    }
    entries
}

pub fn layout(d: &deep_gpu::counted::Wgpu) -> wgpu::BindGroupLayout {
    d.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
        label: Some("scene3d maps"),
        entries: &layout_entries(),
    })
}

/// What the maps put on the GPU: each texture once by key, each material's bind group once by
/// its maps, and the stand-in group a solid without maps binds.
pub struct Store {
    pub layout: wgpu::BindGroupLayout,
    textures: BTreeMap<String, (wgpu::Texture, wgpu::TextureView)>,
    samplers: BTreeMap<([Wrap; 2], u8), wgpu::Sampler>,
    /// This frame's texels by image hash (the scene's).
    pub texels: BTreeMap<String, Arc<Texels>>,
    groups: BTreeMap<String, (u32, wgpu::BindGroup)>,
    pub none: wgpu::BindGroup,
    white: wgpu::TextureView,
    /// Textures uploaded, for a check that a second load makes none.
    pub uploads: u32,
    /// The bytes the device holds for the maps' textures.
    pub bytes: u64,
    next: u32,
}

fn sampler(d: &deep_gpu::counted::Wgpu, wrap: [Wrap; 2], taps: u8) -> wgpu::Sampler {
    let mode = |w: Wrap| match w {
        Wrap::Repeat => wgpu::AddressMode::Repeat,
        Wrap::Clamp => wgpu::AddressMode::ClampToEdge,
        Wrap::Mirror => wgpu::AddressMode::MirrorRepeat,
    };
    d.create_sampler(&wgpu::SamplerDescriptor {
        label: Some("scene3d map"),
        address_mode_u: mode(wrap[0]),
        address_mode_v: mode(wrap[1]),
        address_mode_w: wgpu::AddressMode::ClampToEdge,
        mag_filter: wgpu::FilterMode::Linear,
        min_filter: wgpu::FilterMode::Linear,
        mipmap_filter: wgpu::MipmapFilterMode::Linear,
        anisotropy_clamp: u16::from(taps.max(1)),
        ..Default::default()
    })
}

impl Store {
    pub fn new(d: &deep_gpu::counted::Wgpu, queue: &deep_gpu::counted::Queue) -> Store {
        let layout = layout(d);
        let white = d.create_texture(&wgpu::TextureDescriptor {
            label: Some("scene3d map stand-in"),
            size: wgpu::Extent3d {
                width: 1,
                height: 1,
                depth_or_array_layers: 1,
            },
            mip_level_count: 1,
            sample_count: 1,
            dimension: wgpu::TextureDimension::D2,
            format: wgpu::TextureFormat::Rgba8Unorm,
            usage: wgpu::TextureUsages::TEXTURE_BINDING | wgpu::TextureUsages::COPY_DST,
            view_formats: &[],
        });
        crate::write_texture(queue, &white, 0, &[255; 4], 4, [1, 1]);
        let white = white.create_view(&Default::default());
        // A placeholder until the stand-in below is bound, in an empty layout so it's valid (#1285).
        let empty = d.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            label: None,
            entries: &[],
        });
        let mut store = Store {
            none: d.create_bind_group(&wgpu::BindGroupDescriptor {
                label: None,
                layout: &empty,
                entries: &[],
            }),
            layout,
            textures: BTreeMap::new(),
            samplers: BTreeMap::new(),
            texels: BTreeMap::new(),
            groups: BTreeMap::new(),
            white,
            uploads: 0,
            bytes: 0,
            next: 1,
        };
        store.none = store.bind(d, queue, &Maps::default(), 1);
        store
    }

    /// The maps' index in draw keys (0 when none of their texels is here, so the solid draws
    /// without them), made the first time a frame draws them; `taps` is the look's (or the
    /// planted one's) default.
    pub fn group(&mut self, d: &deep_gpu::counted::Wgpu, queue: &deep_gpu::counted::Queue, maps: &Maps, taps: u8) -> u32 {
        let present: String = maps
            .slots()
            .iter()
            .map(|(_, s)| match s {
                Some(s) if self.texels.contains_key(&s.sha) => '1',
                _ => '0',
            })
            .collect();
        if !present.contains('1') {
            return 0;
        }
        let key = format!("{}|{present}|{taps}", maps.key);
        if !self.groups.contains_key(&key) {
            let g = self.bind(d, queue, maps, taps);
            let n = self.next;
            self.next += 1;
            self.groups.insert(key.clone(), (n, g));
        }
        self.groups[&key].0
    }

    /// The bind group of maps with key `n`, or the stand-in.
    pub fn by_index(&self, n: u32) -> &wgpu::BindGroup {
        self.groups
            .values()
            .find(|(k, _)| *k == n)
            .map_or(&self.none, |(_, g)| g)
    }

    fn texture(&mut self, d: &deep_gpu::counted::Wgpu, queue: &deep_gpu::counted::Queue, sha: &str) -> Option<String> {
        let t = self.texels.get(sha)?.clone();
        // Kept by the source's hash and its format.
        let key = format!("{sha}:{}", t.format);
        if self.textures.contains_key(&key) {
            return Some(key);
        }
        let format = format(&t.format)?;
        let size = wgpu::Extent3d {
            width: t.size[0],
            height: t.size[1],
            depth_or_array_layers: 1,
        };
        let texture = d.create_texture(&wgpu::TextureDescriptor {
            label: Some("scene3d map"),
            size,
            mip_level_count: t.mips,
            sample_count: 1,
            dimension: wgpu::TextureDimension::D2,
            format,
            usage: wgpu::TextureUsages::TEXTURE_BINDING | wgpu::TextureUsages::COPY_DST,
            view_formats: &[],
        });
        let (bw, bh) = format.block_dimensions();
        let block = u64::from(format.block_copy_size(None).unwrap_or(4));
        let mut at = 0usize;
        for level in 0..t.mips {
            let w = (t.size[0] >> level).max(1);
            let h = (t.size[1] >> level).max(1);
            let (cols, rows) = (w.div_ceil(bw), h.div_ceil(bh));
            let len = (u64::from(cols) * u64::from(rows) * block) as usize;
            let bytes = t.data.get(at..at + len)?;
            deep_gpu::alloc::outside(|| {
                queue.write_texture(
                    wgpu::TexelCopyTextureInfo {
                        texture: &texture,
                        mip_level: level,
                        origin: wgpu::Origin3d::ZERO,
                        aspect: wgpu::TextureAspect::All,
                    },
                    bytes,
                    wgpu::TexelCopyBufferLayout {
                        offset: 0,
                        bytes_per_row: Some(cols * block as u32),
                        rows_per_image: Some(rows),
                    },
                    wgpu::Extent3d {
                        width: cols * bw,
                        height: rows * bh,
                        depth_or_array_layers: 1,
                    },
                )
            });
            at += len;
        }
        self.uploads += 1;
        self.bytes += at as u64;
        let view = texture.create_view(&Default::default());
        self.textures.insert(key.clone(), (texture, view));
        Some(key)
    }

    /// An image's view by its hash, uploaded the first time it's asked for, or the white
    /// stand-in when this frame holds no texels for it (#431: a material operator's texture
    /// input).
    pub fn view_of(
        &mut self,
        d: &deep_gpu::counted::Wgpu,
        queue: &deep_gpu::counted::Queue,
        sha: &str,
    ) -> wgpu::TextureView {
        match self.texture(d, queue, sha) {
            Some(key) => self.textures[&key].1.clone(),
            None => self.white.clone(),
        }
    }

    fn bind(
        &mut self,
        d: &deep_gpu::counted::Wgpu,
        queue: &deep_gpu::counted::Queue,
        maps: &Maps,
        taps: u8,
    ) -> wgpu::BindGroup {
        let layout = self.layout.clone();
        self.bind_with(d, queue, maps, taps, &layout, Vec::new())
    }

    /// `maps`' bind group in `layout`, with `extra` bound after the maps' own: a material
    /// operator's inputs (#429).
    pub fn bind_with(
        &mut self,
        d: &deep_gpu::counted::Wgpu,
        queue: &deep_gpu::counted::Queue,
        maps: &Maps,
        taps: u8,
        layout: &wgpu::BindGroupLayout,
        extra: Vec<wgpu::BindGroupEntry<'_>>,
    ) -> wgpu::BindGroup {
        let mut u = MapsUniform::zeroed();
        let slots = maps.slots().map(|(_, s)| s);
        let mut keys: [Option<String>; SLOTS] = Default::default();
        let mut wraps = [([Wrap::Repeat; 2], 1u8); SLOTS];
        for (k, slot) in slots.iter().enumerate() {
            u.slots[k] = SlotUniform {
                u: [1.0, 0.0, 0.0, 0.0],
                v: [0.0, 1.0, 0.0, 0.0],
            };
            let Some(s) = slot else { continue };
            let Some(key) = self.texture(d, queue, &s.sha) else {
                continue;
            };
            let format = self.texels[&s.sha].format.clone();
            let [r0, r1] = s.transform;
            u.slots[k] = SlotUniform {
                u: [r0[0] as f32, r0[1] as f32, r0[2] as f32, 0.0],
                v: [r1[0] as f32, r1[1] as f32, r1[2] as f32, 0.0],
            };
            u.has[0] |= 1 << k;
            if s.uv == 1 {
                u.has[1] |= 1 << k;
            }
            if k == 2 && format.starts_with("bc5") {
                u.has[2] = 1;
            }
            keys[k] = Some(key);
            // A map's own taps, else the look's; a planted look of 1 holds every map to 1.
            wraps[k] = (s.wrap, if taps == 1 { 1 } else { s.taps.unwrap_or(taps) });
        }
        u.values = [
            maps.normal_scale as f32,
            maps.occlusion_strength as f32,
            maps.alpha_cutoff as f32,
            0.0,
        ];
        let buffer = d.create_buffer_init(
            &wgpu::util::BufferInitDescriptor {
                label: Some("scene3d maps"),
                contents: bytemuck::bytes_of(&u),
                usage: wgpu::BufferUsages::UNIFORM,
            },
        );
        for w in wraps {
            self.samplers
                .entry(w)
                .or_insert_with(|| sampler(d, w.0, w.1));
        }
        let views: Vec<&wgpu::TextureView> = keys
            .iter()
            .map(|k| k.as_ref().map_or(&self.white, |k| &self.textures[k].1))
            .collect();
        let mut entries = vec![wgpu::BindGroupEntry {
            binding: 0,
            resource: buffer.as_entire_binding(),
        }];
        for (k, v) in views.iter().enumerate() {
            entries.push(wgpu::BindGroupEntry {
                binding: 1 + k as u32,
                resource: wgpu::BindingResource::TextureView(v),
            });
        }
        for (k, w) in wraps.iter().enumerate() {
            entries.push(wgpu::BindGroupEntry {
                binding: 1 + (SLOTS + k) as u32,
                resource: wgpu::BindingResource::Sampler(&self.samplers[w]),
            });
        }
        entries.extend(extra);
        d.create_bind_group(&wgpu::BindGroupDescriptor {
            label: Some("scene3d maps"),
            layout,
            entries: &entries,
        })
    }
}

//! Material operators in the 3D renderer (issue #429; canvas primitives: GPU operator, Operator
//! output): a solid whose material names a `gpu.material@1` draws through a pipeline of its own,
//! compiled once per operator when a scene that holds it is prepared, whose fragment stage runs
//! the core's WGSL for the checked operator and lays its outputs over the material's values.

use std::collections::BTreeMap;
use std::hash::{Hash, Hasher};

use deep_canvas_effects::graph::{From, Ty};
use deep_canvas_effects::{check, emit, graph, interp, module};
use deep_canvas_scene3d::scene::SolidOp;

use crate::{buffer_entry, draw_pipeline, mesh_buffers};

/// The bind group the operator's inputs take, after the frame, the lights and ambient occlusion:
/// the texture maps' (#423), at bindings after theirs.
const INPUTS_GROUP: u32 = 3;
const INPUTS_BINDING: u32 = 1 + 2 * crate::maps::SLOTS as u32;
/// A group no layout holds: the operator's frame there becomes a private the entry fills.
const FRAME_GROUP: u32 = 9;
const ENTRY: &str = include_str!("op.wgsl");

/// What one of a material operator's texture inputs binds (#431): an image by its hash, decoded
/// as a map is with its mips, or the copy of the opaque scene `backdrop` reads.
#[derive(Clone, Debug, PartialEq)]
pub(crate) enum TexIn {
    Asset(String),
    Backdrop,
}

/// One material operator on the GPU: its pipeline, and its group's layout and inputs, which
/// bind with each solid's maps.
pub(crate) struct MatOp {
    pub pipeline: wgpu::RenderPipeline,
    /// Its pipeline as a see-through part draws it, blending over what's behind (#431), at the
    /// frame's samples, and after the resolve at one, as the parts after the opaque copy draw.
    pub blend: wgpu::RenderPipeline,
    pub blend_late: wgpu::RenderPipeline,
    /// A fade's depth pass and its color where that depth is equal, through it (#432).
    pub fade: [wgpu::RenderPipeline; 2],
    /// Its depth pipeline for a shadow map, when it writes its coverage (#446).
    pub shadow: Option<wgpu::RenderPipeline>,
    /// Its pipelines as a transmissive part draws it and as a subsurface part's share takes it
    /// (#486), each made the first time a prepared scene holds such a part.
    pub glass: Option<wgpu::RenderPipeline>,
    pub share: Option<wgpu::RenderPipeline>,
    module: wgpu::ShaderModule,
    pipeline_layout: wgpu::PipelineLayout,
    pub layout: wgpu::BindGroupLayout,
    /// Its texture inputs in binding order, after its uniform and sampler.
    pub textures: Vec<TexIn>,
    buffer: wgpu::Buffer,
    sampler: wgpu::Sampler,
    /// With a light response (#485): the flag its returns raise when one is negative or not
    /// finite, bound after its textures.
    pub range: Option<wgpu::Buffer>,
}

impl MatOp {
    /// Its inputs as entries after the maps' own: `views` one per texture input, in order.
    pub fn entries<'a>(&'a self, views: &[&'a wgpu::TextureView]) -> Vec<wgpu::BindGroupEntry<'a>> {
        let mut out = vec![
            wgpu::BindGroupEntry {
                binding: INPUTS_BINDING,
                resource: self.buffer.as_entire_binding(),
            },
            wgpu::BindGroupEntry {
                binding: INPUTS_BINDING + 1,
                resource: wgpu::BindingResource::Sampler(&self.sampler),
            },
        ];
        for (k, v) in views.iter().enumerate() {
            out.push(wgpu::BindGroupEntry {
                binding: INPUTS_BINDING + 2 + k as u32,
                resource: wgpu::BindingResource::TextureView(v),
            });
        }
        if let Some(range) = &self.range {
            out.push(wgpu::BindGroupEntry {
                binding: INPUTS_BINDING + 2 + self.textures.len() as u32,
                resource: range.as_entire_binding(),
            });
        }
        out
    }

    /// Clears its light responses' range flag before a frame (#485).
    pub fn clear_range(&self, queue: &wgpu::Queue) {
        if let Some(range) = &self.range {
            deep_gpu::alloc::outside(|| queue.write_buffer(range, 0, &[0; 4]));
        }
    }

    /// Whether a light response of its returned a negative or non-finite value in the frame
    /// just drawn: its flag, read back.
    pub fn range_raised(&self, device: &deep_gpu::device::Device) -> bool {
        let Some(range) = &self.range else {
            return false;
        };
        crate::read_back(device, "scene3d light response range", 4, |e, staging| {
            e.copy_buffer_to_buffer(range, 0, staging, 0, 4);
        })
        .is_some_and(|b| b[..4] != [0; 4])
    }

    /// Whether it reads the opaque scene's copy.
    pub fn reads_backdrop(&self) -> bool {
        self.textures.contains(&TexIn::Backdrop)
    }

    /// Makes its glass pipeline, or its share pipeline with `share`, unless it has it; whether
    /// it made one.
    pub fn make(&mut self, d: &deep_gpu::counted::Wgpu, samples: u32, forward_z: bool, share: bool) -> bool {
        if share && self.share.is_none() {
            self.share = Some(crate::sss::share_pipeline(
                d,
                samples,
                &self.pipeline_layout,
                &self.module,
                "op_sss_fs",
            ));
            return true;
        }
        if !share && self.glass.is_none() {
            let planted = crate::Planted {
                forward_z,
                ..Default::default()
            };
            let glass = usize::from(crate::GLASS);
            self.glass = Some(crate::shaded_clear_pipeline(
                d,
                samples,
                &self.module,
                &self.pipeline_layout,
                &planted,
                glass,
                true,
                "op_glass_fs",
            ));
            return true;
        }
        false
    }
}

/// What a solid's operator is keyed by: its item as the operator check reads it, so equal
/// operators share one pipeline. Never 0, which the solids without one take.
pub(crate) fn key(op: &SolidOp) -> u64 {
    let mut h = std::collections::hash_map::DefaultHasher::new();
    op.id.hash(&mut h);
    op.item.to_string().hash(&mut h);
    h.finish() | 1
}

/// Whether an operator's coverage reads t, so a shadow map it casts into is keyed by t (Light
/// policy: local shadows); with `any_t`, the planted wrong program's question, whether it reads t
/// at all. `false` for an operator that doesn't read as one.
pub(crate) fn coverage_moves(op: &SolidOp, any_t: bool) -> bool {
    fn refs(a: &graph::Arg, out: &mut Vec<String>) {
        if let graph::Arg::Ref(name, _) = a {
            out.push(name.clone());
        }
    }
    let Some(o) = module::operator_of(&op.id, &op.item).and_then(|i| graph::read(&i).ok()) else {
        return false;
    };
    let time = |name: &str| {
        o.inputs
            .get(name)
            .is_some_and(|i| matches!(i.from, From::Time))
            || o.steps.get(name).is_some_and(|s| s.op == "t@1")
    };
    if !any_t {
        // What decides its coverage: its alpha and its discards' conditions.
        let mut todo = Vec::new();
        if let Some(a) = o.outputs.get("alpha") {
            refs(a, &mut todo);
        }
        let discards = o.steps.iter().filter(|(_, s)| s.op == "discard_if@1");
        todo.extend(discards.map(|(name, _)| name.clone()));
        let mut seen = std::collections::BTreeSet::new();
        while let Some(name) = todo.pop() {
            if !seen.insert(name.clone()) {
                continue;
            }
            if time(&name) {
                return true;
            }
            if let Some(step) = o.steps.get(&name) {
                step.args.values().for_each(|a| refs(a, &mut todo));
                todo.extend(step.when.clone());
            }
        }
        return false;
    }
    o.inputs.keys().chain(o.steps.keys()).any(|name| time(name))
}

/// Whether `op` changes nothing its part shades with (#485): no step, no output and no light
/// response of its own, such as an operator that names only the defaults core.light@1 and
/// core.ambient@1; its part draws as its material's own.
pub(crate) fn changes_nothing(op: &SolidOp) -> bool {
    module::operator_of(&op.id, &op.item)
        .and_then(|i| graph::read(&i).ok())
        .is_some_and(|o| o.steps.is_empty() && o.outputs.is_empty() && o.responses.is_empty())
}

/// Whether a solid's material operator reads the opaque scene's copy (#431).
pub(crate) fn reads_backdrop(op: &SolidOp) -> bool {
    module::operator_of(&op.id, &op.item)
        .and_then(|i| graph::read(&i).ok())
        .is_some_and(|o| module::backdrop_step(&o.steps).is_some())
}

/// The solid's seed for `seed@1`: a hash of the document's seed and its ID, as the GPU layer keys
/// an item's effects (Effect: `seed: item`).
pub(crate) fn seed(doc_seed: u64, id: &str) -> u32 {
    let mut h =
        interp::hash1(doc_seed as u32) ^ interp::hash1((doc_seed >> 32) as u32 ^ 0x9e37_79b9);
    for b in id.bytes() {
        h = interp::hash1(h ^ u32::from(b));
    }
    h
}

/// scene3d.wgsl's lines a material operator's light responses replace (#485): its defaults'
/// stubs, from this line to [`STUBS_END`].
const STUBS: &str = "// RESPONSES:";
const STUBS_END: &str = "// END RESPONSES";

/// What a response's return adds to the light loop (#485; Operator output: light response): as it
/// is, or, with a negative or non-finite component, 0 with the operator's range flag raised.
const ANSWERED: &str = "fn answered(c: vec3<f32>) -> vec3<f32> {
    let bits = bitcast<vec3<u32>>(c) & vec3<u32>(0x7f800000u);
    if all(bits != vec3<u32>(0x7f800000u)) && all(c >= vec3<f32>(0.0)) {
        return c;
    }
    atomicStore(&op_range, 1u);
    return vec3<f32>(0.0);
}
";

/// scene3d.wgsl with `c`'s light responses in place of the defaults' stubs, its range flag at
/// `binding` of the operator's group; as it is for an operator with none.
fn answering(scene: &str, c: &check::Checked, binding: u32) -> Result<String, String> {
    if c.responses.is_empty() {
        return Ok(scene.into());
    }
    let (Some(a), Some(b)) = (scene.find(STUBS), scene.find(STUBS_END)) else {
        return Err("scene3d.wgsl's response stubs moved".into());
    };
    let mut text = format!(
        "@group({INPUTS_GROUP}) @binding({binding}) var<storage, read_write> op_range: atomic<u32>;\n{ANSWERED}"
    );
    for (name, port) in [("light", "LightIn"), ("ambient", "AmbientIn")] {
        let has = c.responses.contains_key(name);
        let body = if has {
            format!("answered(op_{name}(a))")
        } else {
            "vec3<f32>(0.0)".into()
        };
        text.push_str(&format!(
            "const HAS_{}: bool = {has};\nfn response_{name}(a: {port}) -> vec3<f32> {{\n    return {body};\n}}\n",
            name.to_uppercase()
        ));
    }
    Ok(format!("{}{text}{}", &scene[..a], &scene[b..]))
}

/// A light's `light_hash` for a light response (#485): its ID's bytes folded through the CPU's
/// fixed hash, as [`seed`] keys a solid, with no document seed, so a light keeps its hash in
/// every document.
pub(crate) fn light_hash(id: &str) -> u32 {
    id.bytes().fold(interp::hash1(0), |h, b| interp::hash1(h ^ u32::from(b)))
}

/// Checks and compiles `op` into the renderer's solid pipeline: `scene` is scene3d.wgsl, `groups`
/// the frame's, the lights' and ambient occlusion's layouts. Refused with the reason when the
/// operator check refuses it, it reads a texture or storage (which land with the 3D frame's
/// targets), or the device rejects its pipeline.
pub(crate) fn compile(
    d: &deep_gpu::counted::Wgpu,
    scene: &str,
    groups: [&wgpu::BindGroupLayout; 3],
    forward_z: bool,
    options: emit::Options,
    samples: u32,
    op: &SolidOp,
) -> Result<MatOp, String> {
    let item = module::operator_of(&op.id, &op.item).ok_or("not a gpu.material@1 item")?;
    let refused = |issues: Vec<graph::Issue>| {
        let first = issues
            .first()
            .map_or(String::new(), |i| format!("{}: {}", i.code, i.message));
        format!("the operator check refuses it: {first}")
    };
    let checked = graph::read(&item)
        .and_then(|o| check::check(&o))
        .map_err(refused)?;
    if checked.op.kind != graph::Kind::Material {
        return Err("not a material operator".into());
    }
    // An image by its hash and the opaque scene's copy draw in 3D (#431); storage and other
    // targets land with the 3D frame's targets.
    let texture_of = |from: &From| match from {
        From::Asset(sha) => Some(TexIn::Asset(sha.clone())),
        From::Target { op, output } if op == "core" && output == "backdrop" => {
            Some(TexIn::Backdrop)
        }
        _ => None,
    };
    if let Some((name, _)) = checked.op.inputs.iter().find(|(_, i)| {
        matches!(i.ty, Ty::Storage(..) | Ty::Tex3(_))
            || matches!(i.from, From::Storage { .. })
            || (matches!(i.from, From::Target { .. }) && texture_of(&i.from).is_none())
    }) {
        return Err(format!(
            "input {name}: a material operator's storage and target inputs don't draw in 3D yet"
        ));
    }
    let textures: Vec<TexIn> = checked
        .textures
        .iter()
        .filter_map(|n| texture_of(&checked.op.inputs[n].from))
        .collect();
    let snippet = emit::material(&checked, options, [FRAME_GROUP, INPUTS_GROUP]);
    let frame = format!("@group({FRAME_GROUP}) @binding(0) var<uniform> op_frame: OpFrame;");
    if !snippet.contains(&frame) {
        return Err("the emitter's frame binding moved".into());
    }
    // Its inputs move after the maps' bindings, which share the group: the uniform, the
    // sampler, then each texture.
    let mut snippet = snippet.replace(&frame, "");
    let mut decls = vec![
        "var<uniform> op_inputs".to_string(),
        "var op_smp".to_string(),
    ];
    decls.extend(checked.textures.iter().map(|n| format!("var in_{n}")));
    for (k, decl) in decls.iter().enumerate() {
        let at = format!("@group({INPUTS_GROUP}) @binding({k}) {decl}");
        if !snippet.contains(&at) {
            return Err("the emitter's input bindings moved".into());
        }
        snippet = snippet.replace(
            &at,
            &format!(
                "@group({INPUTS_GROUP}) @binding({}) {decl}",
                INPUTS_BINDING + k as u32
            ),
        );
    }
    // Its light responses beside its own function, in place of the defaults' stubs (#485).
    let answers = emit::responses(&checked, options, &snippet);
    let range_at = INPUTS_BINDING + 2 + textures.len() as u32;
    let scene = answering(scene, &checked, range_at)?;
    let source = format!("{scene}\n{snippet}\n{answers}\n{ENTRY}");
    let mut entries = crate::maps::layout_entries();
    entries.push(buffer_entry(
        INPUTS_BINDING,
        wgpu::ShaderStages::FRAGMENT,
        wgpu::BufferBindingType::Uniform,
    ));
    entries.push(wgpu::BindGroupLayoutEntry {
        binding: INPUTS_BINDING + 1,
        visibility: wgpu::ShaderStages::FRAGMENT,
        ty: wgpu::BindingType::Sampler(wgpu::SamplerBindingType::Filtering),
        count: None,
    });
    for k in 0..textures.len() as u32 {
        entries.push(wgpu::BindGroupLayoutEntry {
            binding: INPUTS_BINDING + 2 + k,
            visibility: wgpu::ShaderStages::FRAGMENT,
            ty: wgpu::BindingType::Texture {
                sample_type: wgpu::TextureSampleType::Float { filterable: true },
                view_dimension: wgpu::TextureViewDimension::D2,
                multisampled: false,
            },
            count: None,
        });
    }
    if !checked.responses.is_empty() {
        entries.push(buffer_entry(
            range_at,
            wgpu::ShaderStages::FRAGMENT,
            wgpu::BufferBindingType::Storage { read_only: false },
        ));
    }
    let inputs_layout = d.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
        label: Some("scene3d material operator"),
        entries: &entries,
    });
    let scope = deep_gpu::device::push_scope(d, wgpu::ErrorFilter::Validation);
    let module = d.create_shader_module(wgpu::ShaderModuleDescriptor {
        label: Some("scene3d material operator"),
        source: wgpu::ShaderSource::Wgsl(source.into()),
    });
    let layout = d.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
        label: Some("scene3d material operator"),
        bind_group_layouts: &[
            Some(groups[0]),
            Some(groups[1]),
            Some(groups[2]),
            Some(&inputs_layout),
        ],
        immediate_size: 0,
    });
    let pipeline = draw_pipeline(
        d,
        samples,
        &module,
        &layout,
        forward_z,
        None,
        "mesh_vs",
        "op_mesh_fs",
        &mesh_buffers(),
    );
    // As a see-through part (#431): its premultiplied color over what's behind, depth-tested
    // and writing no depth or object ID, as the renderer's blend parts draw.
    let blend = crate::op_blend_pipeline(d, samples, &module, &layout, forward_z, false);
    let blend_late = crate::op_blend_pipeline(d, samples, &module, &layout, forward_z, true);
    let fade = crate::fade_pipelines(d, samples, &module, &layout, forward_z, "op_mesh_fs");
    // Its coverage holes let the light through (#446): the shadow passes' depth state, drawn
    // under the frame group and its own alone.
    let cuts = |o: &graph::Operator| {
        o.outputs.contains_key("alpha") || o.steps.values().any(|s| s.op == "discard_if@1")
    };
    let shadow = cuts(&checked.op).then(|| {
        let layout = d.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
            label: Some("scene3d material operator shadow"),
            bind_group_layouts: &[Some(groups[0]), None, None, Some(&inputs_layout)],
            immediate_size: 0,
        });
        crate::shadow_pipeline(
            d,
            "scene3d material operator shadow",
            &layout,
            &module,
            ("mesh_vs", &crate::mesh_buffers()),
            "op_shadow_fs",
        )
    });
    if let Some(e) = block_on(scope.pop()) {
        return Err(format!("the device rejects its pipeline: {e}"));
    }
    let values = interp::inputs(&checked, &BTreeMap::new(), &BTreeMap::new());
    let buffer = d.create_buffer_init(
        &wgpu::util::BufferInitDescriptor {
            label: Some("scene3d material operator inputs"),
            contents: &emit::input_bytes(&checked, &values),
            usage: wgpu::BufferUsages::UNIFORM,
        },
    );
    let sampler = d.create_sampler(&wgpu::SamplerDescriptor {
        label: Some("scene3d material operator"),
        mag_filter: wgpu::FilterMode::Linear,
        min_filter: wgpu::FilterMode::Linear,
        // Trilinear between an image's mips (#431), as the operators' runner samples.
        mipmap_filter: wgpu::MipmapFilterMode::Linear,
        ..Default::default()
    });
    let range = (!checked.responses.is_empty()).then(|| {
        d.create_buffer(&wgpu::BufferDescriptor {
            label: Some("scene3d light response range"),
            size: 4,
            usage: wgpu::BufferUsages::STORAGE
                | wgpu::BufferUsages::COPY_DST
                | wgpu::BufferUsages::COPY_SRC,
            mapped_at_creation: false,
        })
    });
    Ok(MatOp {
        range,
        pipeline,
        blend,
        blend_late,
        fade,
        shadow,
        glass: None,
        share: None,
        module,
        pipeline_layout: layout,
        textures,
        layout: inputs_layout,
        buffer,
        sampler,
    })
}

/// An error scope's result, which resolves at once on a device whose work is polled.
fn block_on<F: std::future::Future>(f: F) -> F::Output {
    let mut cx = std::task::Context::from_waker(std::task::Waker::noop());
    let mut f = std::pin::pin!(f);
    loop {
        if let std::task::Poll::Ready(v) = f.as_mut().poll(&mut cx) {
            return v;
        }
        std::thread::yield_now();
    }
}

/// The inverse of a 4 × 4 matrix (rows), by Gauss-Jordan elimination with partial pivoting; zero
/// when it is singular.
pub(crate) fn invert(m: &[[f64; 4]; 4]) -> [[f64; 4]; 4] {
    let mut a = *m;
    let mut out = [[0.0; 4]; 4];
    for (i, row) in out.iter_mut().enumerate() {
        row[i] = 1.0;
    }
    for c in 0..4 {
        let p = (c..4)
            .max_by(|&x, &y| a[x][c].abs().total_cmp(&a[y][c].abs()))
            .unwrap_or(c);
        if a[p][c].abs() < 1e-300 {
            return [[0.0; 4]; 4];
        }
        a.swap(c, p);
        out.swap(c, p);
        let k = a[c][c];
        for j in 0..4 {
            a[c][j] /= k;
            out[c][j] /= k;
        }
        for r in (0..4).filter(|&r| r != c) {
            let f = a[r][c];
            for j in 0..4 {
                a[r][j] -= f * a[c][j];
                out[r][j] -= f * out[c][j];
            }
        }
    }
    out
}

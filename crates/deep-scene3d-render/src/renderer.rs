use super::*;

pub struct Renderer {
    pub(super) planted: Planted,
    /// The buffer #1903's planted `uploads_every_transform` writes every item's transform into.
    pub(super) planted_transforms: Option<wgpu::Buffer>,
    /// The diagnostic views' pipelines (#427), made on first use.
    pub(super) diag: Option<Box<diag::Pipes>>,
    /// Motion blur by velocity (#419): its pipelines, and this frame's pass when it blurs.
    pub(super) motion: motion::MotionPass,
    pub(super) motion_frame: Option<motion::Frame>,
    /// The core's velocity and emission targets (#431), built only while read, and this frame's
    /// draws of them.
    pub core: targets::Core,
    pub(super) velocity_frame: Option<motion::TargetFrame>,
    pub(super) emission_frame: Option<targets::EmissionFrame>,
    pub(super) epoch: u64,
    /// The material maps' textures and bind groups (#423), and the look's default taps.
    pub(super) maps: maps::Store,
    pub(super) filter_taps: u8,
    pub(super) frame_buffer: wgpu::Buffer,
    pub(super) frame_bind: wgpu::BindGroup,
    pub(super) frame_layout: wgpu::BindGroupLayout,
    /// Each material operator's pipeline, by [`op::key`], compiled the first time a prepared
    /// scene holds it, or why it can't draw (#429).
    pub(super) materials: BTreeMap<u64, Result<op::MatOp, String>>,
    /// Each material operator's group with one solid's maps, by (operator, maps) key.
    pub(super) op_binds: BTreeMap<(u64, u32), wgpu::BindGroup>,
    /// Each material operator with a light response that a solid drew through, by key: its ID
    /// and the time it last drew at (#485).
    pub(super) answering: BTreeMap<u64, (String, f64)>,
    /// The time each operator last raised `light_response.range` at, so it raises once a time.
    pub(super) raised: BTreeMap<String, u64>,
    /// The material operators that change nothing their parts shade with, by key: their parts
    /// draw as their materials' own (#485).
    pub(super) plain_ops: BTreeSet<u64>,
    /// The lights this frame's policy shades and the DFG table, for the solids' shading (#421).
    pub(super) lights_buffer: wgpu::Buffer,
    pub(super) lights_bind: wgpu::BindGroup,
    pub(super) lights_layout: wgpu::BindGroupLayout,
    pub(super) dfg_buffer: wgpu::Buffer,
    /// Bumped whenever the lights' bind group is made again (the cascades' texture, the
    /// environment's cubes): a new bind group is a new resource in the draw key.
    pub(super) lights_generation: u64,
    /// The key sun's cascades (#422).
    pub(super) cascaded: Cascaded,
    /// The local lights' shadow maps (#446).
    pub(super) locals: local::Locals,
    /// What a shadow frame's `light.w` holds: −1, or −2 to pancake its near plane.
    pub(super) shadow_mark: f32,
    /// The IES tables' atlas (#446).
    pub(super) ies: local::Tables,
    /// The terrain overlays' cells (#537).
    pub(super) tints: tint::Store,
    /// The projected insets (#506), and the unlit ones' pass with the clip-to-world matrix it
    /// reads, made when one draws.
    pub(super) insets: inset::Store,
    pub(super) unlit: Option<inset::Unlit>,
    pub(super) to_world: Option<[f32; 16]>,
    /// The light grid this frame, and the buffer its cells are in (#446).
    pub(super) clusters: Option<clusters::Grid>,
    pub(super) cluster_buffer: wgpu::Buffer,
    /// The environment's prefilter and cubes (#422).
    pub(super) env: EnvState,
    /// Whether this frame has a sky, which draws first; its pipeline once compiled (#422); the
    /// video background that draws in its place (#503).
    pub(super) sky: bool,
    pub(super) sky_pipeline: Option<wgpu::RenderPipeline>,
    pub(super) backdrop: backdrop::Backdrop,
    /// This frame's point sets from a depth video, as the effects wrote them (#503).
    pub(super) clouds: clouds::Clouds,
    /// This frame's puffs, back to front, and their pipeline once compiled (#422).
    pub(super) puffs: Option<(wgpu::Buffer, u32)>,
    pub(super) puff_records: Set,
    pub(super) puff_pipeline: Option<wgpu::RenderPipeline>,
    /// The see-through solids' pipelines, blend and add, each compiled the first time a batch
    /// draws one.
    pub(super) solid_layout: wgpu::PipelineLayout,
    pub(super) clear_pipelines: [Option<wgpu::RenderPipeline>; 6],
    /// Blend and add over the glass, which draws after the resolve (#428, #1173).
    pub(super) late_pipelines: [Option<wgpu::RenderPipeline>; 2],
    /// This frame's adjust table (#424), each distinct adjust once, entry k + 1 at k.
    pub(super) adjust_buffer: wgpu::Buffer,
    pub(super) adjusts: Vec<AdjustEntry>,
    /// This frame's lobe table (#428), each distinct lobe set once, entry k + 1 at k.
    pub(super) lobe_buffer: wgpu::Buffer,
    pub(super) lobe_table: Vec<LobeEntry>,
    /// The opaque scene's copy with mips while a scene holds a transmissive part (#428), and the
    /// texel that stands in for it.
    pub(super) glass: Option<glass::Glass>,
    pub(super) glass_stub: wgpu::TextureView,
    /// The subsurface share and spread while a scene holds a part whose subsurface spreads
    /// (#481).
    pub(super) subsurface: Option<sss::Subsurface>,
    /// Whether the DFG buffer holds the sheen table yet (#428).
    pub(super) sheen_written: bool,
    /// The per-pixel resolve's lists (#424), and its resolve and sorted-fallback pipelines once
    /// a frame draws a per-pixel item.
    pub(super) oit: oit::Oit,
    pub(super) oit_pipelines: Option<[wgpu::RenderPipeline; 2]>,
    /// Each solid's rank by ID (#421), ranked again each frame (#450); and which way the planted
    /// ties_by_submission submits this frame.
    pub(super) ties: crate::ties::Ties,
    pub(super) flip: bool,
    pub(super) tone_buffer: wgpu::Buffer,
    /// What each per-frame uniform last uploaded (#1903).
    pub(super) written: Uniforms,
    pub(super) output_layout: wgpu::BindGroupLayout,
    /// What the passes after the finish cover this frame (their layer, which the view holds), as
    /// the output pass's undithered mask; one clear texel with none (#418).
    pub(super) covered: (Option<std::sync::Arc<[u8]>>, wgpu::TextureView),
    pub(super) mesh_pipeline: wgpu::RenderPipeline,
    /// The opaque material solids' pipelines culling back faces, and front faces (mirrored).
    pub(super) mesh_culled: [wgpu::RenderPipeline; 2],
    /// The solids' pipeline in a frame with a capped cutaway, its caps at their plane's depth,
    /// compiled the first time one draws; and whether this frame has one (#424).
    pub(super) cut_pipeline: Option<wgpu::RenderPipeline>,
    /// The GPU cull's kernels and the pipelines that read a row list, compiled the first time a
    /// batch needs them (#484); the groups those pipelines lay out; this frame's stale views.
    pub(super) rows: Option<Rows>,
    pub(super) row_groups: [wgpu::BindGroupLayout; 4],
    pub(super) cull_runs: Vec<cull::Run>,
    /// The document's instances outputs (#484), which their instancers draw from.
    pub(super) sources: Vec<cull::Source>,
    /// Draws every batch from the CPU's f64 cull, the reference a GPU frame is judged against.
    pub(super) cpu_cull: bool,
    /// #1637: whether the camera's lists are culled by occlusion too (a view's `occlusion: off`
    /// clears it); the camera's prepass depth and pyramid; and this frame's occluders and tests.
    pub(super) occlusion: bool,
    pub(super) pyramid: Option<Arc<cull::Pyramid>>,
    pub(super) occluders: Vec<(usize, RowDraw)>,
    pub(super) occlude_runs: Vec<cull::Occlude>,
    /// This frame's light probes (#427), whose captures see every solid (#1637's report).
    pub(super) probe_ids: Vec<String>,
    pub(super) capped: bool,
    /// Ambient occlusion's prepass, passes and the solids' group 2 (#418).
    pub(super) ao: ao::Passes,
    /// The scene3d shader module and the solids' vertex layouts, which the ao prepass shares.
    pub(super) scene_module: wgpu::ShaderModule,
    pub(super) families: Families,
    pub(super) output_pipeline: wgpu::RenderPipeline,
    /// The output pass into the finished frame, for the passes after the finish (#382).
    pub(super) output_f32: wgpu::RenderPipeline,
    /// The finished frame (status::FINISHED), made when a frame has passes after the finish.
    pub(super) finished: Option<(wgpu::Texture, wgpu::TextureView, [u32; 2])>,
    /// #464: the look's print finish for the frame being drawn (its fields, the frame's values,
    /// the ground, each item's color for its separations), the pass, and the frame it reads.
    pub(super) print: Option<(
        Arc<deep_canvas_marks::print::Print>,
        deep_canvas_marks::print::Frame,
        [u8; 3],
    )>,
    pub(super) print_colors: BTreeMap<String, [u8; 3]>,
    pub(super) printer: Option<Arc<Mutex<print::Printer>>>,
    pub(super) print_source: Option<(wgpu::TextureView, [u32; 2], wgpu::TextureFormat)>,
    /// #465: the mirror's pass, made when a frame first has a mirror, and whether this frame has.
    pub(super) mirrorer: Option<Box<mirror::Mirrorer>>,
    pub(super) mirroring: bool,
    /// #506: each view inset's own renderer, by the inset's ID, drawn whole before this view's
    /// geometry, one level deep.
    pub(super) views: BTreeMap<String, Box<Renderer>>,
    /// #465: the flare's passes, made when a frame first has a flare, and whether this frame has.
    pub(super) flarer: Option<Box<flare::Flarer>>,
    pub(super) flaring: bool,
    /// #468: the depth of field's passes, made when a frame first has one, and whether this
    /// frame has.
    pub(super) doffer: Option<Box<dof::Dofer>>,
    pub(super) dofing: bool,
    /// #166: the water's pass, made when a frame first has water, and whether this frame has.
    pub(super) waterer: Option<Box<water::Waterer>>,
    pub(super) watering: bool,
    /// #166: view3d's `reflection` target while a frame asks for it: each mirror part's lookup.
    pub(super) reflection: Option<(wgpu::Texture, wgpu::TextureView, [u32; 2])>,
    /// #268: view3d's `foam` target while a frame asks for it: the water's foam share.
    pub(super) foam: Option<(wgpu::Texture, wgpu::TextureView, [u32; 2])>,
    /// #968: view3d's `normal` target while a frame asks for it: the water's shaded normal.
    pub(super) normal: Option<(wgpu::Texture, wgpu::TextureView, [u32; 2])>,
    /// The pass resolving the geometry pass's object IDs and depth (#1173), and the planted
    /// resolve_accumulates_frames' blend of the previous frame.
    pub(super) resolve: wgpu::RenderPipeline,
    pub(super) accumulate: Option<wgpu::RenderPipeline>,
    /// Render pipelines this renderer compiled, so a patch's new ones can be counted (#379).
    pub(super) compiled: u32,
    /// Each pipeline it compiled, by name, in the order it compiled them (#854).
    pub(super) names: Vec<&'static str>,
    /// Each pipeline made, with its items, feature set and target (#432); how many of `names`
    /// it has logged; and what the next new names were made for, by name.
    pub log: created::Log,
    pub(super) logged: usize,
    pub(super) made_for: BTreeMap<&'static str, (Vec<String>, String, String)>,
    /// Whether the warm-up makes the shadow maps' pipelines: not under the planted
    /// warms_view_only, which leaves them to the first frame (#432).
    pub warm_shadows: bool,
    /// The opaque solids' pipelines that shade extra lobes, by cull: none, back, front (#432).
    pub(super) lobed: [Option<wgpu::RenderPipeline>; 3],
    /// The glass copy's mip pass, kept once made (#432).
    pub(super) glass_kit: Option<glass::Kit>,
    /// Whether a mask-alpha part casts this frame: its sets draw into shadow maps only then.
    pub(super) mask_casts: bool,
    pub(super) meshes: BTreeMap<Shape, Mesh>,
    /// The swaying meshes' rest vertices, weights and params (#2016).
    pub(super) sways: sway::Sways,
    pub(super) batches: BTreeMap<String, Batch>,
    /// The glyph atlas, held while a frame draws a label, and the layout and sampler it binds by.
    pub(super) atlas: Option<AtlasTexture>,
    pub(super) mask: (wgpu::BindGroupLayout, wgpu::Sampler),
    pub(super) picks: BTreeMap<String, u32>,
    pub(super) next_generation: u64,
    pub(super) targets: Option<Targets>,
    /// The batches this frame draws, in layer order.
    pub(super) order: Vec<String>,
    pub(super) ground: [f64; 4],
    pub(super) counts: Counts,
    /// The planted slow_gpu_frame twin's pipeline.
    pub(super) busy: Option<wgpu::RenderPipeline>,
    pub(super) shadow: Shadow,
    /// This frame's camera: world to clip (column-major), the eye and the near plane.
    pub(super) camera: Camera,
    /// The camera's view axis this frame (#166's `depth` target reads along it).
    pub(super) forward: [f64; 3],
    pub profiler: Option<Profiler>,
    /// #463: the scene's crop (Scene::crop) this frame.
    pub(super) crop: Option<[f64; 4]>,
    /// The next frame's HDR surface and the headroom it rolls off to (#177), and the pass once
    /// a view first presents HDR.
    pub hdr: Option<HdrFrame>,
    pub(super) hdr_pass: Option<hdr::HdrPass>,
    /// The look's deband amplitude, which the HDR pass allows between the slot and the output.
    pub(super) deband: f32,
    /// The GPU surface it draws through, and the upscale's pipelines once compiled (#386).
    pub surface: Surface,
    pub upscale: Option<Arc<Upscale>>,
    /// Frame history resolves this frame (#173): lines 1 device px or thinner, outlines and
    /// labels draw after it at display size, through the camera unjittered; `jitter` is its
    /// window frame's offset, display px right and down, added to the scene's.
    pub history: bool,
    pub jitter: [f64; 2],
    /// The window a view's frames draw into and what this frame does with it (#173).
    pub frame_history: history::State,
    /// The key sun's cascade maps at this many times their size: 2 at the climb's top rung
    /// (#425), else 1.
    pub shadow_scale: u32,
    /// The frame's full size, and its targets below scale 1.
    pub(super) size: [u32; 2],
    pub(super) low: Option<Low>,
    pub(super) low_bytes: Option<u64>,
    pub(super) outlines: Outlines,
    /// The linear image this frame's output pass reads when passes between geometry and output
    /// wrote one (#418's `pre_tone`); `None`, the linear target.
    pub(super) pre_tone: Option<wgpu::TextureView>,
    /// The output pass's bind group over a post module's own target, with that target and the
    /// covered mask it binds.
    pub(super) post_bind: Option<(wgpu::TextureView, wgpu::TextureView, wgpu::BindGroup)>,
}

/// The pass that draws thin lines and outlines at full size after the upscale (#386).
pub(super) struct Outlines {
    pub(super) pipeline: wgpu::RenderPipeline,
    /// The screen-size labels' pass after the upscale, over the same frame and depth (#1174).
    pub(super) labels: wgpu::RenderPipeline,
    pub(super) layout: wgpu::BindGroupLayout,
    /// The camera over the full-size slot, and over the internal size (the planted programs').
    pub(super) display: wgpu::Buffer,
    pub(super) internal: wgpu::Buffer,
    /// Each with the core's depth target, made with the targets.
    pub(super) binds: Option<[wgpu::BindGroup; 2]>,
    /// The solids' strokes, and the status outlines.
    pub(super) strokes: Set,
    pub(super) statuses: Set,
}

/// A box's silhouette from `cam`: each edge between a face turned toward the camera and one
/// turned away, in world space. `model` maps the unit box (rows of a 3×4 matrix).
pub(super) fn silhouette(
    model: &[[f64; 4]; 3],
    cam: &deep_canvas_scene3d::scene::Camera,
) -> Vec<[[f64; 3]; 2]> {
    let col = |c: usize| [model[0][c], model[1][c], model[2][c]];
    let at = |l: [f64; 3]| {
        let mut p = [0.0; 3];
        for (r, v) in p.iter_mut().enumerate() {
            *v = model[r][0] * l[0] + model[r][1] * l[1] + model[r][2] * l[2] + model[r][3];
        }
        p
    };
    let cross = |a: [f64; 3], b: [f64; 3]| {
        [
            a[1] * b[2] - a[2] * b[1],
            a[2] * b[0] - a[0] * b[2],
            a[0] * b[1] - a[1] * b[0],
        ]
    };
    let dot = |a: [f64; 3], b: [f64; 3]| a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
    let det = dot(col(0), cross(col(1), col(2)));
    // Whether face `axis` on side `t` (0: −, 1: +) faces the camera. Its normal is the inverse
    // transpose's column, from the other two columns' cross product.
    let facing = |axis: usize, t: usize| {
        let n = cross(col((axis + 1) % 3), col((axis + 2) % 3));
        let sign = if t == 1 { 1.0 } else { -1.0 } * det.signum();
        let mut centre = [0.0; 3];
        centre[axis] = t as f64 - 0.5;
        let toward = if cam.perspective {
            let c = at(centre);
            [cam.eye[0] - c[0], cam.eye[1] - c[1], cam.eye[2] - c[2]]
        } else {
            [-cam.forward[0], -cam.forward[1], -cam.forward[2]]
        };
        dot(n, toward) * sign > 0.0
    };
    let mut out = Vec::new();
    for axis in 0..3 {
        let (b, c) = ((axis + 1) % 3, (axis + 2) % 3);
        for tb in 0..2 {
            for tc in 0..2 {
                if facing(b, tb) == facing(c, tc) {
                    continue;
                }
                let mut p = [0.0; 3];
                p[b] = tb as f64 - 0.5;
                p[c] = tc as f64 - 0.5;
                p[axis] = -0.5;
                let start = at(p);
                p[axis] = 0.5;
                out.push([start, at(p)]);
            }
        }
    }
    out
}

/// A builder's mesh's contour as seen from `cam` (#1162): in world space, each edge between a
/// triangle that faces the camera and one that doesn't, and each edge only one triangle holds
/// when that one faces it. Vertices at one position are one, so a mesh with split normals has
/// the same edges as its welded form.
pub(super) fn contour(
    mesh: &deep_canvas_scene3d::geom::Mesh,
    model: &[[f64; 4]; 3],
    cam: &deep_canvas_scene3d::scene::Camera,
) -> Vec<[[f64; 3]; 2]> {
    use std::collections::BTreeMap;
    let at = |l: [f64; 3]| {
        let mut p = [0.0; 3];
        for (r, v) in p.iter_mut().enumerate() {
            *v = model[r][0] * l[0] + model[r][1] * l[1] + model[r][2] * l[2] + model[r][3];
        }
        p
    };
    let world: Vec<[f64; 3]> = mesh.positions.iter().map(|p| at(*p)).collect();
    // One index per distinct position, by its bits.
    let mut weld: BTreeMap<[u64; 3], u32> = BTreeMap::new();
    let ids: Vec<u32> = world
        .iter()
        .enumerate()
        .map(|(i, p)| *weld.entry(p.map(f64::to_bits)).or_insert(i as u32))
        .collect();
    let sub = |a: [f64; 3], b: [f64; 3]| [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
    let mut faces_by_edge: BTreeMap<(u32, u32), Vec<bool>> = BTreeMap::new();
    for t in mesh.indices.as_chunks::<3>().0 {
        let [a, b, c] = t.map(|i| ids[i as usize]);
        let [pa, pb, pc] = [a, b, c].map(|i| world[i as usize]);
        let (u, v) = (sub(pb, pa), sub(pc, pa));
        let n = [
            u[1] * v[2] - u[2] * v[1],
            u[2] * v[0] - u[0] * v[2],
            u[0] * v[1] - u[1] * v[0],
        ];
        let toward = if cam.perspective {
            sub(cam.eye, pa)
        } else {
            [-cam.forward[0], -cam.forward[1], -cam.forward[2]]
        };
        let front = n[0] * toward[0] + n[1] * toward[1] + n[2] * toward[2] > 0.0;
        for (x, y) in [(a, b), (b, c), (c, a)] {
            if x != y {
                faces_by_edge
                    .entry((x.min(y), x.max(y)))
                    .or_default()
                    .push(front);
            }
        }
    }
    // In screen px about the eye: an edge whose both sides the mesh covers all along it is a
    // fold inside the outline (a mitre seen across a corner), never the outline itself.
    let proj = |p: [f64; 3]| {
        let d = sub(p, cam.eye);
        let dot = |a: [f64; 3]| d[0] * a[0] + d[1] * a[1] + d[2] * a[2];
        let k = if cam.perspective {
            cam.scale / dot(cam.forward).max(1e-9)
        } else {
            cam.scale
        };
        [dot(cam.right) * k, dot(cam.up) * k]
    };
    let flat: Vec<[[f64; 2]; 3]> = mesh
        .indices
        .as_chunks::<3>()
        .0
        .iter()
        .map(|t| t.map(|i| proj(world[ids[i as usize] as usize])))
        .collect();
    let covered = |q: [f64; 2]| {
        flat.iter().any(|[a, b, c]| {
            let side = |p: [f64; 2], r: [f64; 2]| {
                (r[0] - p[0]) * (q[1] - p[1]) - (r[1] - p[1]) * (q[0] - p[0])
            };
            let (x, y, z) = (side(*a, *b), side(*b, *c), side(*c, *a));
            (x >= 0.0 && y >= 0.0 && z >= 0.0) || (x <= 0.0 && y <= 0.0 && z <= 0.0)
        })
    };
    let outer = |a: [f64; 3], b: [f64; 3]| {
        let (pa, pb) = (proj(a), proj(b));
        let (dx, dy) = (pb[0] - pa[0], pb[1] - pa[1]);
        let len = (dx * dx + dy * dy).sqrt();
        if len < 1e-9 {
            return false;
        }
        let n = [-dy / len * 1.5, dx / len * 1.5];
        [0.125, 0.375, 0.625, 0.875].iter().any(|s| {
            let m = [pa[0] + dx * s, pa[1] + dy * s];
            !covered([m[0] + n[0], m[1] + n[1]]) || !covered([m[0] - n[0], m[1] - n[1]])
        })
    };
    faces_by_edge
        .into_iter()
        .filter(|(_, f)| match f.as_slice() {
            [one] => *one,
            many => many.iter().any(|x| *x) && many.iter().any(|x| !*x),
        })
        .map(|((a, b), _)| [world[a as usize], world[b as usize]])
        .filter(|[a, b]| outer(*a, *b))
        .collect()
}

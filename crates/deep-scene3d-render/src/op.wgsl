// Issue #429: a solid whose material names a material operator draws through this entry, which
// runs the operator's steps over the fragment (the core's WGSL, its globals prefixed `op_`) and
// lays each output it sets over the material's own value before the lights shade it; its
// emission adds after, as a material's does.

var<private> op_frame: OpFrame;

// The operator's outputs at a fragment: this target's camera and size, and the solid's own time
// and seed, over its normal in its mesh's space, the world's, and the view's (x right, y up, z to
// the eye).
fn run_op(in: MeshOut) -> MatOut {
    let size = frame.viewport.xy;
    op_frame = OpFrame(
        frame.clip,
        frame.inverse_clip,
        frame.eye,
        vec4<f32>(size, 1.0 / size),
        vec4<f32>(bitcast<f32>(in.op.x), 0.0, 0.0, 0.0),
        vec4<u32>(in.op.y, 0u, 0u, 0u),
    );
    let world = normalize(in.normal);
    let toward = cross(frame.right.xyz, frame.up.xyz);
    let view = vec3<f32>(dot(world, frame.right.xyz), dot(world, frame.up.xyz), dot(world, toward));
    // The planted bump_ignores_handedness (#486): every tangent's frame read as right-handed.
    let tangent = select(in.tangent, vec4<f32>(in.tangent.xyz, 1.0), planted(P_BUMP_HAND));
    return op_material(MatGeom(in.pos, normalize(in.object_n), world, view, in.uv.xy, in.world, tangent));
}

// A shadow pass's fragment under a material operator (#446): the operator's alpha below the mask's
// cutoff lets the light through, as shadow_fs lets a cut or a band's mask.
@fragment
fn op_shadow_fs(in: MeshOut) {
    if ((in.flags & CUT) != 0u && cut_hides(in.world))
        || !band_keeps(vec2<u32>(in.pos.xy), in.pick, in.mask.x) {
        discard;
    }
    let o = run_op(in);
    if (o.wrote.x & 2u) != 0u && o.base.w < ALPHA_CUTOFF {
        discard;
    }
}

// The outputs whose values live in the part's lobe entry (#486): sheen, sheen roughness,
// diffuse roughness, sheen color, iridescence thickness, translucency, transmission, subsurface
// and anisotropy.
const TABLE_LOBES: u32 = 2048u | 4096u | 16384u | 32768u | 65536u | 131072u | 262144u | 524288u | 1048576u;

fn op_wrote(o: MatOut, bit: u32) -> bool {
    return (o.wrote.x & bit) != 0u;
}

// The part as its operator leaves it: each output it wrote replaces its material field, clamped
// into that field's range (#429, #486). A lobe in the part's lobe entry is replaced in a copy of
// the entry, which `lobe` then reads; the check let it write only lobes the material has, so the
// entry is there. The entry of a material whose operator writes its sheen holds the sheen's color
// unweighted, and its weight in the last row's w (lib.rs's `lobe_entry`).
fn op_overlay(in: MeshOut, o: MatOut) -> MeshOut {
    var m = in;
    if op_wrote(o, 1u) {
        m.base = vec4<f32>(max(o.base.rgb, vec3<f32>(0.0)), in.base.w);
    }
    if op_wrote(o, 2u) {
        // Its coverage: the operator's alpha times the item's opacity.
        m.emission.w = clamp(o.base.w, 0.0, 1.0) * bitcast<f32>(in.op.z);
    }
    if op_wrote(o, 4u) {
        m.emission = vec4<f32>(o.emission.rgb, m.emission.w);
    }
    if op_wrote(o, 8u) {
        m.surface.x = clamp(o.mr.x, 0.0, 1.0);
    }
    if op_wrote(o, 16u) {
        m.surface.y = clamp(o.mr.y, 0.0, 1.0);
    }
    // The planted lobe_output_scales_field (#486): the output times the field.
    let scales = planted(P_LOBE_SCALES);
    if op_wrote(o, 32u) {
        m.surface.z = max(select(o.mr.z, o.mr.z * in.surface.z, scales), 0.0);
    }
    if op_wrote(o, 64u) {
        op_occlusion = clamp(o.mr.w, 0.0, 1.0);
    }
    if op_wrote(o, 128u) {
        op_normal = vec4<f32>(o.normal.xyz, 1.0);
    }
    if op_wrote(o, 256u) {
        op_coat_normal = vec4<f32>(o.coat_normal.xyz, 1.0);
    }
    if op_wrote(o, 512u) {
        m.surface.w = clamp(select(o.coat.x, o.coat.x * in.surface.w, scales), 0.0, 1.0);
    }
    if op_wrote(o, 1024u) {
        m.specular.w = clamp(select(o.coat.y, o.coat.y * in.specular.w, scales), 0.0, 1.0);
    }
    if op_wrote(o, 8192u) {
        m.specular = vec4<f32>(max(o.specular.rgb, vec3<f32>(0.0)), m.specular.w);
    }
    let k = lobe_index(in);
    if k != 0u && (o.wrote.x & TABLE_LOBES) != 0u {
        var e = lobe_table[k - 1u].v;
        if (o.wrote.x & (2048u | 4096u | 32768u)) != 0u {
            let color = select(e[0].rgb, max(o.sheen.rgb, vec3<f32>(0.0)), op_wrote(o, 32768u));
            let weight = select(e[7].w, clamp(o.coat.z, 0.0, 1.0), op_wrote(o, 2048u));
            let rough = select(e[0].w, clamp(o.coat.w, 0.0, 1.0), op_wrote(o, 4096u));
            e[0] = vec4<f32>(color * weight, rough);
        }
        if op_wrote(o, 1048576u) {
            e[1].x = clamp(o.aniso.x, -1.0, 1.0);
            e[1].y = radians(o.aniso.y);
        }
        if op_wrote(o, 16384u) {
            e[1].z = clamp(o.specular.w, 0.0, 1.0);
        }
        if op_wrote(o, 262144u) {
            e[3].x = clamp(o.lobes.y, 0.0, 1.0);
        }
        if op_wrote(o, 65536u) {
            e[5].y = max(o.sheen.w, 0.0);
        }
        if op_wrote(o, 131072u) {
            e[7].y = clamp(o.lobes.x, 0.0, 1.0);
        }
        // Subsurface only where the part's own is on this frame: its second entry, the color and
        // the mean free paths, is there only then (lib.rs's `subsurface_entry`).
        if op_wrote(o, 524288u) && e[7].z > 0.0 {
            e[7].z = clamp(o.lobes.z, 0.0, 1.0);
        }
        op_lobes = e;
        op_lobes_on = true;
    }
    return m;
}

fn op_mesh(in: MeshOut, front: bool) -> Targets {
    // The texture coordinates' derivatives, while every pixel of the quad still runs (#423).
    let g = array<vec4<f32>, 2>(dpdx(in.uv), dpdy(in.uv));
    let local_n = normalize(cross(dpdx(in.local), dpdy(in.local)) + vec3<f32>(0.0, 1e-9, 0.0));
    let m = op_overlay(in, run_op(in));
    // With no light, no sky and no environment it takes the view's key light.
    return shade(m, front, local_n, g, true);
}

@fragment
fn op_mesh_fs(in: MeshOut, @builtin(front_facing) front: bool) -> Targets {
    return op_mesh(in, front);
}

// A transmissive part through its operator (#486), drawn over the resolved opaque scene as
// glass_fs draws one.
@fragment
fn op_glass_fs(in: MeshOut, @builtin(front_facing) front: bool) -> Resolved {
    let t = op_mesh(in, front);
    return Resolved(t.color, t.id.x | (t.id.y << 16u));
}

// A subsurface part's share through its operator (#486), as sss_fs takes a part's.
@fragment
fn op_sss_fs(in: MeshOut, @builtin(front_facing) front: bool) -> Share {
    return share(op_overlay(in, run_op(in)), front, true);
}

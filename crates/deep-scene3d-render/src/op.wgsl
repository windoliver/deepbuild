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
    return op_material(MatGeom(in.pos, normalize(in.object_n), world, view));
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

// Its depth always written, as a lit smooth material's is (#1278: `mesh_late_fs`).
@fragment
fn op_mesh_fs(in: MeshOut, @builtin(front_facing) front: bool) -> LateTargets {
    // The texture coordinates' derivatives, while every pixel of the quad still runs (#423).
    let g = array<vec4<f32>, 2>(dpdx(in.uv), dpdy(in.uv));
    let local_n = normalize(cross(dpdx(in.local), dpdy(in.local)) + vec3<f32>(0.0, 1e-9, 0.0));
    let o = run_op(in);
    var m = in;
    if (o.wrote.x & 1u) != 0u {
        m.base = vec4<f32>(max(o.base.rgb, vec3<f32>(0.0)), in.base.w);
    }
    if (o.wrote.x & 2u) != 0u {
        // Its coverage: the operator's alpha times the item's opacity.
        m.emission.w = clamp(o.base.w, 0.0, 1.0) * bitcast<f32>(in.op.z);
    }
    if (o.wrote.x & 4u) != 0u {
        m.emission = vec4<f32>(o.emission.rgb, m.emission.w);
    }
    if (o.wrote.x & 8u) != 0u {
        m.surface.x = clamp(o.mr.x, 0.0, 1.0);
    }
    if (o.wrote.x & 16u) != 0u {
        m.surface.y = clamp(o.mr.y, 0.0, 1.0);
    }
    // With no light, no sky and no environment it takes the view's key light.
    let t = shade(m, front, local_n, g, true);
    return LateTargets(t.color, t.id, in.pos.z);
}

// Ambient lighting: sky and environment terms, fed by ao_shade.wgsl visibility.
// A sky's ambient light (#418) on a material: its diffuse share by the normal under ambient
// occlusion, and its specular share from the mirror direction through the DFG table with the
// multiple scattering restored, so rough metal under the sky keeps its brightness. None without
// a sky.
fn sky_light(in: MeshOut, n: vec3<f32>, s: Surface) -> vec3<f32> {
    if frame.sky_top.w <= 0.0 {
        return vec3<f32>(0.0);
    }
    let v = select(normalize(lights.view.xyz), normalize(lights.view.xyz - in.world), lights.view.w > 0.5);
    if s.k != 0u {
        return ambient_lobes(in, n, v, s, false);
    }
    let rough = clamp(s.rough, 0.045, 1.0);
    let dfg_v = dfg_at(max(dot(n, v), 1e-4), rough);
    let albedo = max(dfg_v.x + dfg_v.y, 1e-4);
    let f0 = dielectric_f0(s);
    let e = f0 * dfg_v.x + dielectric_f90(s) * dfg_v.y;
    let metal = s.base * dfg_v.x + dfg_v.y;
    var spec = mix(e * (1.0 + f0 * (1.0 / albedo - 1.0)), metal * (1.0 + s.base * (1.0 / albedo - 1.0)), s.metallic);
    let r = reflect(-v, n);
    // A rough lobe sees the sky's average over the hemisphere, as a diffuse one does.
    let reflected = mix(sky_at(r), sky_at(n), rough * rough);
    let diffuse = s.base * (1.0 - s.metallic) * (1.0 - e);
    return diffuse * sky_at(n) * occlusion(in.pos.xy, in.world, normalize(in.normal), diffuse) + spec * reflected;
}

// The environment's light on a material (#422): its irradiance by the normal on the diffuse
// lobe under ambient occlusion, and its prefiltered radiance along the mirror direction at the
// lobe's roughness on the specular lobes, each through the DFG table with the multiple
// scattering restored, the dielectric and metal lobes shaded apart and mixed by metallic.
fn env_light(in: MeshOut, n: vec3<f32>, s: Surface) -> vec3<f32> {
    let v = select(normalize(lights.view.xyz), normalize(lights.view.xyz - in.world), lights.view.w > 0.5);
    if s.k != 0u {
        return ambient_lobes(in, n, v, s, true) * env.k.z;
    }
    let rough = clamp(s.rough, 0.045, 1.0);
    let dfg_v = dfg_at(max(dot(n, v), 1e-4), rough);
    let off = (lights.count.z & NO_COMP) != 0u;
    let f0 = dielectric_f0(s);
    let e = f0 * dfg_v.x + dielectric_f90(s) * dfg_v.y;
    var spec: vec3<f32>;
    if (lights.count.z & PREMIX) != 0u {
        let pf0 = mix(f0, s.base, s.metallic);
        let pf90 = mix(dielectric_f90(s), 1.0, s.metallic);
        spec = (pf0 * dfg_v.x + pf90 * dfg_v.y) * compensation(pf0, dfg_v, off);
    } else {
        let metal = (s.base * dfg_v.x + dfg_v.y) * compensation(s.base, dfg_v, off);
        spec = mix(e * compensation(f0, dfg_v, off), metal, s.metallic);
    }
    let diffuse = s.base * (1.0 - s.metallic) * (1.0 - e);
    let r = reflect(-v, n);
    let lod = rough * env.k.y;
    return (diffuse * env_irradiance(n) * occlusion(in.pos.xy, in.world, normalize(in.normal), diffuse) + spec * env_radiance(r, lod)) * env.k.z;
}

// The ambient light along `d` at roughness `rough`: the environment's prefiltered radiance, or
// the sky's, its average over the hemisphere for a rough lobe.
fn ambient_along(d: vec3<f32>, n: vec3<f32>, rough: f32, from_env: bool) -> vec3<f32> {
    if from_env {
        return env_radiance(d, rough * env.k.y);
    }
    return mix(sky_at(d), sky_at(n), rough * rough);
}

// The ambient irradiance ÷ π facing `n` and facing −n, in one pass over the coefficients: the
// first band's terms change sign with the direction.
fn ambient_irradiance2(n: vec3<f32>, from_env: bool) -> array<vec3<f32>, 2> {
    if !from_env {
        return array<vec3<f32>, 2>(sky_at(n), sky_at(-n));
    }
    let d = env_dir(n);
    let w = env.m.x;
    let c = array<vec3<f32>, 9>(
        mix(env.sh[0].rgb, env.sh_to[0].rgb, w), mix(env.sh[1].rgb, env.sh_to[1].rgb, w),
        mix(env.sh[2].rgb, env.sh_to[2].rgb, w), mix(env.sh[3].rgb, env.sh_to[3].rgb, w),
        mix(env.sh[4].rgb, env.sh_to[4].rgb, w), mix(env.sh[5].rgb, env.sh_to[5].rgb, w),
        mix(env.sh[6].rgb, env.sh_to[6].rgb, w), mix(env.sh[7].rgb, env.sh_to[7].rgb, w),
        mix(env.sh[8].rgb, env.sh_to[8].rgb, w),
    );
    let odd = 0.488603 * (c[1] * d.y + c[2] * d.z + c[3] * d.x);
    let even = 0.282095 * c[0]
        + 1.092548 * (c[4] * (d.x * d.y) + c[5] * (d.y * d.z) + c[7] * (d.x * d.z))
        + 0.315392 * (3.0 * d.z * d.z - 1.0) * c[6]
        + 0.546274 * (d.x * d.x - d.y * d.y) * c[8];
    return array<vec3<f32>, 2>(max(even + odd, vec3<f32>(0.0)), max(even - odd, vec3<f32>(0.0)));
}

// The environment's or the sky's light on a part with extra lobes (#428), as `env_light` and
// `sky_light` shade the base lobes: the diffuse by its irradiance (EON's albedo for rough
// diffuse, the back's irradiance through thin translucency), the specular through the DFG table
// with its Fresnel replaced by the film's and its mirror ray bent toward the anisotropy, sheen
// by its albedo over both, and the flakes' mirror rays mixed in by weight.
fn ambient_lobes(in: MeshOut, n: vec3<f32>, v: vec3<f32>, s: Surface, from_env: bool) -> vec3<f32> {
    let k = s.k;
    let rough = clamp(s.rough, 0.045, 1.0);
    let nv = max(dot(n, v), 1e-4);
    let dfg_v = dfg_at(nv, rough);
    let off = from_env && (lights.count.z & NO_COMP) != 0u;
    let L = entry_of(k);
    let x1 = L[1];
    let tr = L[2];
    let film = L[5];
    let irid = L[4].w;
    let amount = L[7].y;
    let f0 = lobe_weight(s) * lobe_f0(s);
    var e = f0 * dfg_v.x + lobe_weight(s) * dfg_v.y;
    var metal = s.base * dfg_v.x + dfg_v.y;
    if irid > 0.0 {
        let albedo = dfg_v.x + dfg_v.y;
        e = mix(e, iridescence(film.x, nv, film.y, f0) * albedo, irid);
        metal = mix(metal, iridescence(film.x, nv, film.y, s.base) * albedo, irid);
    }
    let spec = mix(e * compensation(f0, dfg_v, off), metal * compensation(s.base, dfg_v, off), s.metallic);
    var r = reflect(-v, n);
    if x1.x != 0.0 {
        // The mirror ray bent toward the stretched lobe (KHR_materials_anisotropy's bent normal).
        let ab = cross(s.t, v);
        let an = cross(ab, s.t);
        let bend = 1.0 - abs(x1.x) * (1.0 - rough);
        r = reflect(-v, normalize(mix(an, n, bend * bend * bend * bend)));
    }
    var rho = s.base * (1.0 - s.metallic) * (1.0 - L[3].x);
    if x1.z > 0.0 && !planted(P_LAMBERT) {
        // FON alone keeps only its single scattering's albedo (the planted wrong program).
        rho = select(eon_albedo(rho, x1.z, nv), rho * fon_e(nv, x1.z), planted(P_FON));
    }
    // The diffuse keeps what the compensated specular doesn't take, so a part never reflects
    // more than it receives, F0 1 included.
    let taken = min(e * compensation(f0, dfg_v, off), vec3<f32>(1.0));
    let irr = ambient_irradiance2(n, from_env);
    var diffuse = rho * (1.0 - max3(taken)) * irr[0];
    if tr.w < 0.0 {
        diffuse = diffuse * (1.0 - amount)
            + (1.0 - s.metallic) * tr.rgb * amount * (1.0 - max3(taken)) * irr[1];
    }
    diffuse = diffuse * occlusion(in.pos.xy, in.world, normalize(in.normal), rho) * sss_keep;
    let sp = spec_on();
    var out = diffuse + spec * ambient_along(r, n, rough, from_env) * sp;
    let sheen = L[0];
    if max3(sheen.rgb) > 0.0 {
        let a = s.sheen_ev;
        out = out * (1.0 - max3(sheen.rgb) * a) + sheen.rgb * a * irr[0] * sp;
    }
    if film.z > 0.0 {
        let fv = max(dot(s.flake, v), 1e-4);
        let col = lobe(k, 6u).rgb;
        let cr = max(sqrt(sqrt(s.flake_a2)), 0.045);
        let fd = dfg_at(fv, cr);
        let flake = (col * fd.x + fd.y) * compensation(col, fd, off);
        out = mix(out, flake * ambient_along(reflect(-v, s.flake), s.flake, cr, from_env) * sp, film.z);
    }
    return out;
}

// A direction turned into the environment's own frame: back by its rotation about +Y.
fn env_dir(d: vec3<f32>) -> vec3<f32> {
    let c = cos(env.k.w);
    let s = sin(env.k.w);
    return vec3<f32>(c * d.x - s * d.z, d.y, s * d.x + c * d.z);
}

// The prefiltered radiance along `d` at mip `lod`, mixed toward the second environment by `by`.
fn env_radiance(d: vec3<f32>, lod: f32) -> vec3<f32> {
    let e = env_dir(d);
    let a = textureSampleLevel(env_cube, env_sampler, e, lod).rgb;
    if env.m.x <= 0.0 {
        return a;
    }
    return mix(a, textureSampleLevel(env_cube_to, env_sampler, e, lod).rgb, env.m.x);
}

// The irradiance ÷ π a surface facing `n` gets, from the nine coefficients.
fn env_irradiance(n: vec3<f32>) -> vec3<f32> {
    let d = env_dir(n);
    let b0 = 0.282095;
    let b = array<f32, 9>(
        b0,
        0.488603 * d.y,
        0.488603 * d.z,
        0.488603 * d.x,
        1.092548 * d.x * d.y,
        1.092548 * d.y * d.z,
        0.315392 * (3.0 * d.z * d.z - 1.0),
        1.092548 * d.x * d.z,
        0.546274 * (d.x * d.x - d.y * d.y),
    );
    var a = vec3<f32>(0.0);
    var t = vec3<f32>(0.0);
    for (var k = 0u; k < 9u; k++) {
        a += env.sh[k].rgb * b[k];
        t += env.sh_to[k].rgb * b[k];
    }
    return max(mix(a, t, env.m.x), vec3<f32>(0.0));
}

// The sky's ambient light along `d`, from below to above.
fn sky_at(d: vec3<f32>) -> vec3<f32> {
    return mix(frame.sky_low.rgb, frame.sky_top.rgb, d.y * 0.5 + 0.5);
}

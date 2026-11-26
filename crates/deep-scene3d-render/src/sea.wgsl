// #3033: a sea's waves. Water with a sea draws through water.wgsl with this file after it and the
// sea's table in its uniform (water.rs: `sea_source`), four waves a lane, longest first. Each wave
// only lifts the water: its height at rest point x is a × cos(K · x + ψ), K its wavenumber along
// its heading and ψ its phase at the frame's t, so the point at rest under a point of the surface
// is that point. Water without a sea never compiles this and reads none of the table.

// water.rs's SEA_WAVES and SEA_DRAWN, in lanes of four.
const SEA_LANES: u32 = 16u;
const SEA_DRAWN_LANES: u32 = 4u;

// The waves the vertex stage draws, the table's longest: what moves the surface, so what
// `mesh_vs` and the bed's test read.
fn waves_scaled(x: vec2<f32>, t: f32, scale: f32) -> Waved {
    var up = vec4<f32>(0.0);
    for (var i = 0u; i < SEA_DRAWN_LANES; i++) {
        up += params.sea_a[i] * cos(params.sea_kx[i] * x.x + params.sea_kz[i] * x.y + params.sea_at[i]);
    }
    var w: Waved;
    w.offset = vec3<f32>(0.0, dot(up, vec4<f32>(1.0)) * scale, 0.0);
    w.tx = vec3<f32>(1.0, 0.0, 0.0);
    w.tz = vec3<f32>(0.0, 0.0, 1.0);
    w.steep = 0.0;
    return w;
}

// The pixel's waves at its rest point: the slopes of the whole table, over the stretch of sea the
// pixel at `xy` and depth `z` spans around `p`: `wide` across the view, and along it as the view
// `v` grazes the surface (seen from straight above the stretch is square, and any heading
// serves). A wave's share falls from 1 to 0 as that stretch grows from half its length to its
// length across its crests, so a wave too fine for the pixel reads as its mean; a pixel finer
// than half the shortest wave sums every wave whole. Foam reads how steep the crests stand, each
// wave its steepness's share of its slope where it rises, and only where foam is on.
fn sea_shaded(rest: vec2<f32>, scale: f32, xy: vec2<f32>, z: f32, size: vec2<f32>, p: vec3<f32>, v: vec3<f32>, facing: f32) -> Waved {
    let wide = distance(world_at(xy + vec2<f32>(0.0, 1.0), z, size), p);
    let sideways = length(v.xz);
    let toward = select(vec2<f32>(1.0, 0.0), v.xz / sideways, sideways > 1e-4);
    let along = toward * (wide / max(facing, 0.02));
    let foamy = params.look.y < 1.0;
    var sx = vec4<f32>(0.0);
    var sz = vec4<f32>(0.0);
    var steep = vec4<f32>(0.0);
    if !foamy && params.sea.x * (length(along) + wide) <= 3.14159265 {
        for (var i = 0u; i < SEA_LANES; i++) {
            let s = sin(params.sea_kx[i] * rest.x + params.sea_kz[i] * rest.y + params.sea_at[i]);
            sx += params.sea_sx[i] * s;
            sz += params.sea_sz[i] * s;
        }
    } else {
        for (var i = 0u; i < SEA_LANES; i++) {
            let span = abs(params.sea_kx[i] * along.x + params.sea_kz[i] * along.y) + params.sea_k[i] * wide;
            let keep = clamp(2.0 - span / 3.14159265, vec4<f32>(0.0), vec4<f32>(1.0));
            if all(keep == vec4<f32>(0.0)) {
                continue;
            }
            let th = params.sea_kx[i] * rest.x + params.sea_kz[i] * rest.y + params.sea_at[i];
            let s = sin(th) * keep;
            sx += params.sea_sx[i] * s;
            sz += params.sea_sz[i] * s;
            if foamy {
                steep += params.sea_steep[i] * max(cos(th), vec4<f32>(0.0)) * keep;
            }
        }
    }
    var w: Waved;
    w.offset = vec3<f32>(0.0);
    w.tx = vec3<f32>(1.0, -dot(sx, vec4<f32>(1.0)) * scale, 0.0);
    w.tz = vec3<f32>(0.0, -dot(sz, vec4<f32>(1.0)) * scale, 1.0);
    w.steep = dot(steep, vec4<f32>(1.0)) * scale;
    return w;
}

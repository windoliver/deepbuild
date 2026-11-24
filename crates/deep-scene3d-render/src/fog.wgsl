
// ---- the sky's fog (#422, #1992) and, in a frame under water, the water's absorption (#3034),
// concatenated after scene3d.wgsl

// Fog on a lit surface or a mark at `world` (#422, #1992; Sky `sky@1` and its height fog): the
// distance fog by its curve, over the distance from the eye whatever the curve, and the mist
// below the height fog's top along the ray's length beneath it, mixed toward the fog's color or
// what the background shows along the ray.
fn fogged(c: vec3<f32>, world: vec3<f32>) -> vec3<f32> {
    let ramp = env.fog.y > 1.5;
    if env.low.w < 0.5 || (env.fog.x <= 0.0 && env.fog.w <= 0.0 && !ramp) {
        return drowned(c, world);
    }
    let ray = world - env.eye.xyz;
    let dist = length(ray);
    let a = env.fog.x * dist;
    var keep = select(exp(-a), exp(-a * a), env.fog.y > 0.5);
    if ramp {
        keep = 1.0 - clamp((dist - env.range.x) / (env.range.y - env.range.x), 0.0, 1.0);
    }
    if env.fog.w > 0.0 {
        // The share of the ray below the top, from the eye to the surface.
        let y0 = env.eye.y;
        let y1 = world.y;
        var below = 0.0;
        if y0 <= env.fog.z && y1 <= env.fog.z {
            below = 1.0;
        } else if y0 <= env.fog.z || y1 <= env.fog.z {
            let cross = (env.fog.z - y0) / (y1 - y0);
            below = select(1.0 - cross, cross, y0 <= env.fog.z);
        }
        keep *= exp(-env.fog.w * dist * below);
    }
    var tint = env.fog_color.rgb;
    if env.fog_color.w > 0.5 {
        tint = background(ray / max(dist, 1e-6));
    }
    return drowned(mix(tint, c, keep), world);
}

// #3034: in a frame under water, what reaches the eye of a color `c` at `world`: a share
// exp(−d ÷ depth) of it over the ray's length d in the water, from the eye to the point or to
// where the ray leaves through the surface at rest, and the color deep water takes for the rest.
fn drowned(c: vec3<f32>, world: vec3<f32>) -> vec3<f32> {
    if env.under.z < 0.5 {
        return c;
    }
    var d = distance(world, env.eye.xyz);
    if env.under_color.w > 0.5 {
        // The planted tint: the point's depth below the surface, whatever the distance seen.
        d = max(env.under.x - world.y, 0.0);
    } else if env.under.z < 1.5 && world.y > env.under.x {
        d *= (env.under.x - env.eye.y) / (world.y - env.eye.y);
    }
    return mix(env.under_color.rgb, c, exp(-d * env.under.y));
}

// What the background shows along a ray `d` that meets nothing, seen the same way: the ray is in
// the water up to the surface when it rises to it, and without end otherwise.
fn drowned_far(d: vec3<f32>) -> vec3<f32> {
    let c = background(d);
    if env.under.z < 0.5 {
        return c;
    }
    var seen = 0.0;
    if env.under.z < 1.5 && d.y > 0.0 {
        seen = select(exp(-(env.under.x - env.eye.y) / d.y * env.under.y), 1.0, env.under_color.w > 0.5);
    }
    return mix(env.under_color.rgb, c, seen);
}

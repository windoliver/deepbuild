// The structural steps' planted wrong programs (#483), reachable only through `--planted`:
// `reverse` turns a sort's input around, so a stable sort keeps equal keys in decreasing index;
// `append` compacts by an atomic counter's returned value, in whatever order the adds land.

struct Params { n: u32, arg: u32, tiles: u32, _pad: u32 };
@group(0) @binding(0) var<uniform> p: Params;

@group(0) @binding(1) var<storage, read> rev_src: array<u32>;
@group(0) @binding(2) var<storage, read_write> rev_dst: array<u32>;

@compute @workgroup_size(256)
fn reverse(@builtin(global_invocation_id) g: vec3<u32>) {
    if (g.x < p.n) {
        rev_dst[g.x] = rev_src[p.n - 1u - g.x];
    }
}

@group(0) @binding(1) var<storage, read> app_src: array<u32>;
@group(0) @binding(2) var<storage, read> app_flag: array<u32>;
@group(0) @binding(3) var<storage, read_write> app_out: array<u32>;
@group(0) @binding(4) var<storage, read_write> app_count: array<atomic<u32>>;

@compute @workgroup_size(256)
fn append(@builtin(global_invocation_id) g: vec3<u32>) {
    if (g.x < p.n && app_flag[g.x] != 0u) {
        let at = atomicAdd(&app_count[0], 1u);
        app_out[at] = app_src[g.x];
    }
}

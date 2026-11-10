# #2189 evidence

Made on 2026-11-10 on a Mac17,10 (Apple M5 Max, 64 GB), from release `deep-gpu` builds of this branch and of its base
(#2185's tip, `24c9efe45`), running #1903's `envelope` call on Metal with `docs/evidence/1903/run.mts`'s scenes, 1 s
runs and no first frame wait. The Mac was shared and loaded; byte counts don't depend on load.

## What the device held

[`alloctrace.rs`](alloctrace.rs) swaps the Metal device's `newTextureWithDescriptor:` (with and without an IOSurface),
`newBufferWithLength:options:` and `newBufferWithBytes:length:options:` for wrappers that keep a weak reference to each
resource. Whenever the device's `currentAllocatedSize` passes the run's peak, it lists every resource still alive by
label with its `allocatedSize`. The traced resources cover all but 2.4 MB of the device's figure; the rest was on the
device before the first view opened.

The every-pass scene at 3456 × 2234 on the copy path, internal scale 0.5 (1728 × 1117), no history window. "Main +
mirror" rows add the view's renderer and the mirror's own renderer, which draws at half the full size, here also
1728 × 1117 (213.8 MB on the device, 209.4 MB estimated).

| Resource | Device at peak, base | Estimate, base | Estimate, this branch |
|---|---|---|---|
| 3 slots, BGRA8 at full size | 94.5 MB | 92.6 MB | 92.6 MB |
| 3 copy-path read-back buffers | 92.7 MB | 0 | 92.6 MB |
| Core targets (linear, IDs, depth), main + mirror | 63.6 MB | 30.9 MB | 61.8 MB |
| 4× MSAA IDs and depth (the color is memoryless), main + mirror | 126.0 MB | 0 | 123.5 MB |
| GPU cull: prepass depth (4×) and depth pyramid, main + mirror | 85.5 MB | 0 | 82.4 MB |
| Glyph atlas, main + mirror | 17.3 MB | 0 | 16.8 MB |
| Sun cascades, 4 × 2048² Depth32, main + mirror | 135.3 MB | 0 | 134.2 MB |
| Upscale: internal-size output and full-size target | 39.6 MB | 38.6 MB | 38.6 MB |
| wgpu's indirect-draw validation buffers | 2.1 MB | 0 | 2.1 MB |
| Instance records | 0.1 MB | 0 | 0.1 MB |
| Flare, env, cull-list and uniform buffers | 0.3 MB | 0 | 0 |
| On the device before the view | 2.4 MB | | |
| **Total** | **659.2 MB** | **162.1 MB** | **644.8 MB (−2.2%)** |

The scene's shadowed lamp, its flare and its sky hold no local map, flare target or env cube: the light policy keeps
no local shadow for it, the flare draws without targets and the sky has no environment.

`separate-items` at the same size: 378.1 MB on the device; 162.1 MB estimated at the base; 368.8 MB estimated now
(−2.5%): slots 92.6, read-back 92.6, core targets 30.9, MSAA 61.8, cull 41.2, upscale 38.6, atlas 8.4, validation
2.1, records 0.6. It has no cascades or mirror.

## After the change

At 3456 × 2234 the every-pass scene is refused at check:

```json
{"code":"over_budget","severity":"error","ids":[],"path":"size","actual":{"size":[3456,2234],"gpu_bytes":644762384,"cap_bytes":256000000},"what":"a 3456 × 2234 view needs 644.8 MB of GPU memory at scale 0.5 with a 0-frame window, past its class's 256 MB"}
```

At 1280 × 800 both fixtures play, and the envelope's `gpu_memory` row reports the estimate beside the peak:

| Fixture | `peak_bytes` | `estimate_bytes` | Estimate − peak |
|---|---|---|---|
| every-pass scene | 226,492,416 | 218,405,562 | −3.6% |
| `separate-items` | 63,782,912 | 58,507,093 | −8.3% |

The smaller view's gap is per-texture padding in the GPU's tiled layout (2.7 MB) and the 2.3 MB the device holds before
any view; the check's fit leaves 5% of the cap for what the estimate doesn't itemize.

## Proof runs

- `tests/acceptance/2189/` (the blind suite) against the base binary: 3 of 3 fail. The full-screen scene is admitted
  and peaks at 659,161,088 B; the reply has no refusal and no `estimate_bytes`. Against this branch: 3 of 3 pass.
- `live::tests::the_check_refuses_the_full_screen_every_pass_scene_naming_what_the_device_held`, with admit's shape
  put back to the base's formula (16 bytes a pixel, nothing fixed, no read-back), fails: the scene is admitted at an
  estimate of 162 MB ([regression-reverted.txt](regression-reverted.txt)). With the change it passes
  ([regression-fixed.txt](regression-fixed.txt)).

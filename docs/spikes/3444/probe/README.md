# #3444's probe: three patches on the pinned wgpu crates

The readings of this spike come from a build of the app's own binaries against copies of `wgpu`, `wgpu-core` and
`wgpu-hal` 30.0.1 that carry these patches. Nothing in the repository changes: the copies live outside it, and cargo
is told of them in the config of a checkout kept for the build.

```sh
# Each crate as the registry holds it, copied, then patched:
cp -R ~/.cargo/registry/src/index.crates.io-*/wgpu-hal-30.0.1 <copies>/ && (cd <copies> && patch -p1 < wgpu-hal-30.0.1.patch)
# ... the same for wgpu-30.0.1 and wgpu-core-30.0.1. Then, in a checkout of main kept for this build, three lines
# under [patch.crates-io] in .cargo/config.toml:
#   wgpu = { path = "<copies>/wgpu-30.0.1" }
#   wgpu-core = { path = "<copies>/wgpu-core-30.0.1" }
#   wgpu-hal = { path = "<copies>/wgpu-hal-30.0.1" }
cargo build --release --offline -p deep-gpu-layer --bin deep-gpu
```

The three lines go in the config file and not on cargo's command line: `deep-physics-rapier`'s build script runs
`cargo tree --locked` on the same lock, and a patch given only to the outer cargo makes it ask for another. Cargo
rewrites that checkout's `Cargo.lock` for the three path sources, so neither file is ever committed.

With `DEEP_3444_PROBE` unset the patched crates write nothing. Set to a file, each hook appends one JSON object a
line. Every row has `ev`, `t_ns` (the monotonic clock, from the probe's first use), `unix_ms`, `pid`, `thread` and
`call`: the number of the `wgpu::Device::create_*` call the row was made inside, on the same thread, or 0.

| Row | Written by | Fields |
|---|---|---|
| `create` | wgpu, around `create_shader_module`, `create_render_pipeline` and `create_compute_pipeline` | `kind`, `label`, `ns`: the time inside the call |
| `stage_module` | wgpu-core, as it resolves a pipeline's stage | `stage`, `module`: the module's label |
| `stage` | wgpu-hal, `load_shader` | `stage`, `entry`, `override_ns` (naga's `process_overrides`), `msl_ns` (naga's Metal source writer), `metal_ns` (`newLibraryWithSource`), `untouched` (the override step handed the module back as it was), `module_entry_points`, `module_overrides`, `module_functions`, `kept_functions`, `constants`, `msl_bytes`, `unkept` |
| `hal_pipeline` | wgpu-hal, `create_render_pipeline` and `create_compute_pipeline` | `kind`, `label`, `hal_ns` (the whole call), `state_ns` (Metal's making of the pipeline state) |
| `instance` | wgpu-core, once the instance is made | `flags_bits`, `validation_indirect_call`: the flags read back from the instance |
| `device` | wgpu-core, as a device opens | `label`, `backend`, `adapter`, `flags_bits`, `validation_indirect_call`, `indirect_validation` (whether the device validates indirect calls) |
| `pass_encode` | wgpu-core, around each pass's encode at `finish()` | `kind`, `label`, `commands`, `ns` |
| `submit` | wgpu-core, as `Queue::submit` begins | `device`, `command_buffers_before`, and the device's own counters: `query_sets`, `buffers`, `textures`, `render_pipelines`, `compute_pipelines`, `shader_modules` |
| `command_buffer` | wgpu-hal, a completed handler on each committed buffer | `seq` (its place in commit order), `label`, `gpu_start_s`, `gpu_end_s`, `kernel_start_s`, `kernel_end_s`: Metal's own clock |
| `query_set` | wgpu-hal, `create_query_set` and `destroy_query_set` | `op` (`create`, `refused`, `destroy`), `ty`, `label`, `queries`, `device_counter`, `probe_count`, `hal_device`, `error` |

Four changes are not rows:

- With `DEEP_3444_UNKEPT` set to a line, `load_shader` appends it as a comment to each Metal source before Metal
  compiles it. The system keeps what Metal compiled, by its source, for every later process of the user, so a
  source that ends with a line no earlier run wrote is compiled anew, as on a Mac that never drew the scene. The
  `stage` row says `unkept`.
- With `DEEP_3444_MSL_DIR` set to a folder, `load_shader` keeps each Metal source there as naga wrote it,
  `<n>-<stage>-<entry>.metal`.

- `wgpu-hal`'s manifest takes `wgpu-types` with its `counters` feature, so wgpu's internal counters count in the
  whole build. The app takes wgpu without it, and they then read 0.
- `wgpu-core`'s `Instance::new` reads `WGPU_VALIDATION_INDIRECT_CALL` as wgpu's own `InstanceFlags::with_env` would:
  `0` clears the flag, anything else sets it, unset leaves the descriptor's. The app's instance never calls
  `with_env`, so on main the variable does nothing. This is how one binary runs both sides of the indirect rounds.

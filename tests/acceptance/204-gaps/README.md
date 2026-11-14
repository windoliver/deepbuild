# Gap tests for #204: past the criteria, inside the Scope

Written by #204's implementer, not the blind job, for a part of the Scope that `tests/acceptance/204/` doesn't reach.
It was shown to fail on the wrong program before it was committed.

| Test | Scope line it holds | Wrong program it fails on |
|---|---|---|
| after a pack is installed, `registries` lists each of its presets under `synth.preset@1` as `<pack>.<name>@<major>`, origin `pack`, kit PASS; before, it lists none | "a preset {nodes, edges, out, params …, cost per voice} is an entry of the synth.preset@1 registry (the registries task), filled by first-party packs and packs" | the host before its `vet` sealed a pack's presets: the registry lists none (`expected [] to deeply equal [ …(2) ]`) |

## Run

```sh
npm ci
PATH="$HOME/.rustup/toolchains/1.99.1-aarch64-apple-darwin/bin:$PATH" CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 \
  node node_modules/vitest/vitest.mjs run --root tests/acceptance/204-gaps --no-file-parallelism --testTimeout=3600000
```

It reuses `tests/acceptance/204/helpers.ts` unchanged: the deep-show build, `writePack`, `installCall` and the engine
preset.

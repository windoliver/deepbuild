# Acceptance tests for #1316: 3D renderer — environment-lit textured glTF frames differ between runs

Written first, from issue #1316 (its text and its two acceptance criteria), the design and the base commit
`1b4929ae7` ("Merge pull request #3436 …"), by a job that never saw an implementation; none existed. The implementing
agent doesn't edit these files (AGENTS.md, Proof); a dispute goes to a blind redraft of this job (design: Dogfooding).
Lean: one file per criterion, one test each.

## What was read

- Issue #1316. #428 and #78 for vocabulary only (#428's AC9 taste call keyed to the screenshots' SHA-256s).
- `docs/technical-design.md`: Dogfooding; The reference Macs; AGENTS.md (Proof).
- At the base: `tests/acceptance/428/helpers.ts` (`useGpu`, `runGpu`, the Khronos fetch by SHA-256 into
  `~/.cache/deepbuild-acceptance/khronos`, `look`, `SHOW_LOOK`, `SHOW_SKY`, `sessionDoc`, `view3dCall`, `readLinear`),
  `428/reference.ts` (`decodePng`; `readGltf` and `traceable` only to compute the two views' framing once, now
  constants), `428/taste.test.ts` (AC9's three-quarter showcase view, its sun metered for the filmic look, 1280 × 800),
  `428/TASTE.json` (its note that the chair and dispersion frames vary run to run, #1316),
  `tests/acceptance/319/helpers.ts` (the reference-Mac list: Mac15,7, Mac15,12, Mac17,10, Mac18,1),
  `crates/deep-gpu-layer/src/main.rs` (`Planted::parse` and `--planted`: an unknown name is `bad_input`),
  `crates/deep-gpu-layer/src/view3d/parse.rs` (`assets`, `uris`, `licenses` are optional).

## What the base already does

`deep-gpu run` draws a `view3d` call's frame 0 into a final PNG and a linear f32 RGBA target, each named by its
SHA-256. Nothing at the base checks that two fresh processes give the same bytes for an environment-lit textured glTF;
the issue reports they don't (SheenChair: 12 to ~30,000 pixels; DispersionTest: ~250 floor pixels; one in four renders
of the chair at the #428 merge base). There is no planted race at the base: `--planted environment_texture_race` is
refused as an unknown name.

## The scene

Each sample, fetched by its pinned SHA-256 at glTF-Sample-Assets `edc7c9e67c` (never committed), drawn as one
`mesh.asset@1` item in #428's AC9 three-quarter view (camera framed from the sample's triangle bounds, fov 40°,
1280 × 800, the size where the issue counted the pixels), under #428's daylight `sky@1` that lights by its
environment (`environment: {from: sky, intensity: 1}`, no flat ambient) and #428's AC9 sun (1.89 lx from (−40°, 25°),
no shadow), filmic at EV100 0. Targets `final` and `linear`, frame 0, one `view3d` call per fresh `deep-gpu run`
process.

## The check (`helpers.ts`: `sameEveryRun`)

Draws a sample in fresh processes and compares every run's final and linear SHA-256 with the first run's. It returns
`null`, or a problem string that starts with the sample's name and lists each differing run, the target, and how many
pixels differ (linear: pixels whose 16 bytes differ, with the worst relative change; final: decoded RGBA pixels that
differ). It logs how many distinct final and linear targets the runs gave. It returns a value rather than throwing,
so AC2 asserts on the returned problem (the proof lane's at-assertion rule).

## The planted race

`deep-gpu run --planted environment_texture_race`: the implementer adds this name to deep-gpu's `Planted` table so that
it brings back the cause the fix removes (the race on the environment-lit textured path), reachable only through
`--planted`. A race may show in only some runs, so AC2 draws each sample in up to 10 fresh processes, stopping at the
first that differs, and passes when the check returns a problem for at least one sample and every such problem names
its sample.

## How to run

```sh
CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 node node_modules/vitest/vitest.mjs run --root tests/acceptance/1316 --no-file-parallelism --reporter=verbose
node node_modules/typescript/bin/tsc -p tests/acceptance/1316/tsconfig.json
```

Each file builds deep-gpu (`cargo build --locked --bin deep-gpu`) once and copies it out of `target/`. It needs macOS
on a reference Mac (else INCONCLUSIVE) and the two samples in `~/.cache/deepbuild-acceptance/khronos` or the network
(else BLOCKED). `lane.json` runs the files alone: they share the GPU.

## Criteria to tests

| Criterion | ID | Test | Wrong programs it catches |
|---|---|---|---|
| AC1: SheenChair and DispersionTest, drawn by `view3d` with an environment-lit `sky@1` and a sun, give byte-identical final and linear targets at frame 0 in 10 fresh processes on the reference Mac | `#1316.a4e5e495` | `ac1-identical.test.ts`: `AC1 #1316.a4e5e495 SheenChair and DispersionTest under an environment-lit sky@1 and a sun give the same final and linear bytes at frame 0 in 10 fresh deep-gpu run processes each` | The base's race (any run's final or linear bytes differ from the first's); a renderer that differs only in the linear target, or only in the final; a race that touches only one of the samples |
| AC2: A planted race that reproduces the cause fails that check, naming the sample | `#1316.33db7d22` | `ac2-planted-race.test.ts`: `AC2 #1316.33db7d22 with --planted environment_texture_race, frame 0 differs between fresh deep-gpu run processes and the check's problem names the sample` | A deep-gpu with no such planted program (the base: `bad_input`); a planted program that doesn't race (same bytes in 10 runs of each sample); a check that misses a difference or doesn't name the sample |

No twins here; the implementer adds them if the lanes need them.

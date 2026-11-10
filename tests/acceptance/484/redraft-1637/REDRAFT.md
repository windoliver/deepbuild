# #484 criterion 1 blind redraft, after #1637: the camera's kept set with occlusion on

Test: `forest.test.ts` in this folder, one `describe` with two `it`s, the frozen file's first two tests under their ID
(`#484.31f1249b`), each name ending "(redraft 1637)". The criterion (1) is quoted in full at the top of the file. It
imports `../helpers.ts` unchanged and copies nothing from it.

Written from issue #484 (criterion 1), issue #1637 ("Occlusion from this frame's depth"), the frozen
`tests/acceptance/484/` (`forest.test.ts`, `helpers.ts`, `README.md`, `tsconfig.json`) and base a9d2e682 (AGENTS.md;
`docs/technical-design.md`, Dogfooding; `vitest.config.ts`; `scripts/lanes.mjs`; a search of
`docs/technical-design.md` and `docs/canvas-primitives.md` for occlusion, which finds no occlusion cull at the base;
`tests/acceptance/140/view/PARITY-REDRAFT.md` and `39-redraft/vitest.config.ts` for form). I never read an implementation,
the #1637 suite or any diff.

## What was disputed

The frozen orbit test and its `gpu_cull_by_center` twin compare the GPU's `cull` rows for the camera `view` with the
CPU's f64 cull's, at occlusion's default, and require the GPU's set to hold the CPU's. #1637 lands after #484. With
occlusion on, the default, the camera pass's kept set is the frustum cull further culled by a depth pyramid from this
frame's prepass, so it rightly leaves out trees that other trees hide, and that containment fails on a right program.
#1637 keeps cascades', probes' and insets' sets as they were. It also names `occlusion: off` on a view, which draws the
same frame unculled by occlusion.

## What changed

- **The camera's kept set is compared through `occlusion: 'off'`.** A new call, `off` (the orbit, `cull_report`,
  `occlusion: 'off'`), carries the comparison for all five views: its kept set holds the CPU's in each, and neither side
  keeps all 100,000 trees. The shipped default's `reported` call is still compared, but only in the four cascades,
  which #1637 leaves alone. Nothing is compared for the default's camera `view` rows. That is the one assertion dropped,
  because #1637 makes it false.
- **The CPU reference also carries `occlusion: 'off'`.** The criterion's reference is "the CPU's f64 cull", a frustum
  cull. With occlusion off, nothing but that cull decides what the `cpu` call's frame draws or what it reports.
- **Pixel hashes.** At every orbit frame, the shipped default (`plain` and `reported`) and `off` must each hash as the
  CPU cull's frame. The default call's hash against the CPU cull's is unchanged. `off` is held to the same hash because
  its kept set is now the one being compared, as the frozen file held `reported`.
- **The twin.** At frame 0, `crownProblems` runs the CPU cull (occlusion off) in one process, and in a second process,
  with or without the plant, an `occlusion: 'off'` call and a shipped-default call. Each of the two GPU calls has
  `cull_report` and the crown click. The off call is held to the CPU's set in all five views and the default call in
  the cascades, and both clicks must name trees#73105. Under `--planted gpu_cull_by_center` the off call's view loses
  trees#73105 ("frame 0, view: element trees#73105 … (occlusion off)") and both clicks miss it, so the failure still
  names the element and the frame. The correct program must still pass first.
- **Two processes for the orbit.** `plain` and `reported` run in one process, `off` and `cpu` in a second, both on
  one machine. Four 61-frame calls in one process would come near `run`'s 30-minute limit, which the frozen file's
  three calls already approached. Pixel hashes are compared across processes, as the frozen file's `count_read_back`
  test already does.

Unchanged: the forest, the orbit (61 frames at 6 fps, 960 × 540), the seek from frame 60 to 12 in one session and its
hash equal to playing's frame 12, `cpu_culled` and `counts_read_back` at 0 on every frame of the shipped default
`plain` call, `cull: 'cpu'`'s `cpu_culled` of at least 100,000 as the control, one indirect draw per batch (2) in the
view at every frame and in each cascade at frame 0, 4 shadow maps, the crown click at frame 0 on the default, the
2 s > 10 s fixture check, and every failure sentence's frame and element. The frozen third test (`--planted
count_read_back`) reads only pixel hashes after a seek, which #1637 doesn't change, so it isn't redrafted.

## Readings

- **`occlusion: 'off'` is a field of the `view3d` call**, sent as the string `"off"`, absent meaning on. #1637 puts it
  "on a view". The frozen `View3d` type has no such field and `helpers.ts` can't be edited, so the file widens the type
  locally (`type Call = View3d & { occlusion?: 'off' }`) and still sends every call through `view3dCall`.
- **The default's camera kept set isn't otherwise checked here.** That the kept set is a subset of the frustum set, and
  that it holds every element with a pixel, are #1637's criteria, tested in #1637's suite, not #484's.
- **`cull: 'cpu'` with `occlusion: 'off'`** is accepted as one call. If the binary refuses the pair, the test fails
  ("refused the scenario"). It doesn't pass.

## Wrong programs it still fails

- `--planted gpu_cull_by_center`: the off call's view leaves out trees#73105 at frame 0, and both crown clicks miss it.
- A GPU frustum cull that drops any CPU-kept tree, in any view with occlusion off or in any cascade at the default.
- An occlusion pass that changes a pixel: the default's hash differs from the CPU cull's.
- A cull that keeps everything, read back counts, a CPU cull on the worker, a missing indirect draw or shadow map,
  and a seek that draws a stale frame: each fails as it did in the frozen file.
- The base: there is no `deep-gpu` surface for these fields, so the test fails at the scenario or the build. This was
  not run.

## Checks

**Not run.** Under this job's limits I built nothing, ran no tests and did no type-check. The file is type-checked by
the folder's own config, because `tests/acceptance/484/tsconfig.json` includes `./**/*.ts`:

```sh
npx tsc -p tests/acceptance/484/tsconfig.json
```

## Run it

There is no `vitest.config` under `tests/acceptance/484/`, so with `--root tests/acceptance/484` vitest's default
include (`**/*.test.ts`) also finds this subfolder. Vitest's file filter matches substrings, so give the folder in the
filter. A bare `forest.test.ts` would also run the frozen file.

```sh
npx vitest run --root tests/acceptance/484 --no-file-parallelism redraft-1637/forest.test.ts
```

The README's command without a filter now runs this file too. `scripts/lanes.mjs` lists `tests/acceptance/484/` under
`alone`, so the lanes already run this folder alone. Its `slow` list names `tests/acceptance/484/forest.test.ts`, the
frozen file, which runs over two minutes. This file adds a fourth orbit call, so it will run longer still. Whether to
add `tests/acceptance/484/redraft-1637/forest.test.ts` to `slow` is the owner's call at merge.

## At merge

The frozen `forest.test.ts` stays as written. The owner's call at merge is to swap its first two tests for these two
and keep its `count_read_back` test as it stands.

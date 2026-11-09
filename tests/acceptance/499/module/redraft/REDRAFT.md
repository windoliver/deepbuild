# #499 AC5 blind redraft: an asset read through the decode worker in a build without media

This is a blind redraft of one criterion, `#499.64602440`. It lives in `seal-redraft.test.ts`, with its own `helpers.ts`
and `tsconfig.json`. It was written from issue #499, the design and base commit `f1e8736e` ("Merge pull request #1742").
The job never saw an implementation of #499, any other branch, PR or worktree, or any other `tests/acceptance/499` folder.

The criterion, copied from the issue:

> A test canvas module that reads an asset through the decode worker seals and probes its asset in a build with the media
> module left out; a planted test module whose probe calls through the media module is refused at that build's seal,
> naming media

The ID is the first 8 hex digits of the SHA-256 of that text, trimmed and with whitespace collapsed
(`scripts/proof-change.mjs:153`).

## What was read

- **Issue #499:** Scope, Fields, the 17 criteria (AC5 is the fifth), Proof ("the build that seals without media") and
  Depends on (#498: the decode worker sits "outside the media module"; #185: a build seals one implementation of each
  interface).
- **`docs/technical-design.md`:**
  - 1096, Canvas modules:
    - "Ring-critical pieces stay in the core and are never modules: the device gate and capture, the decode worker with its asset probes, …"
    - "a missing required one refuses startup"
    - optional dependencies and `module_missing`
    - build sets
  - 1121: the module table's `media` row (depends on core; motion optional).
  - 1137: the Document envelope ("one whose canvas module this build lacks is refused with `module_missing`").
  - 1909–1917: The media module and Media asset.
  - 2623, Dogfooding, and 2654, Tests written first.
- **`docs/canvas-primitives.md`:**
  - 308 and 310, Document envelope: `requires.modules` and `assets: {id → {sha256, license}}`.
  - 1008, Canvas module: "reads only what it declares"; "a missing required dependency refuses the seal".
  - 1052, Registry and seal: dependency ranges, every read resolved, "Any failure refuses startup".
  - 7107, Asset: `probe.streams[].sample_rate` and `duration: flick`; "probed once in the decode worker".
  - 7606 and 7616, Decode worker: "the trusted ring's host for the codecs seam …, never the media module's, and runs the
    asset probes, so tables, meshes, video frames, sequences, chunks and recordings are probed and decoded in a build
    without media".
- **Base code and suites, for conventions and surfaces:**
  - `tests/acceptance/305/`: the README's build-set features, test canvas modules, the `seal_refused` line with exit 2
    and its reasons, and `registry`.
  - `185/redraft/`: the layout of a redraft.
  - `498/decode/`: `workers`, `decode_worker`, the `probe` job's `file` hash, and the WAV made by node.
  - `497/helpers.ts`: `eval`'s `arrays`.
  - `397/`: a document's `assets` entry.
  - `crates/deep-show/Cargo.toml`: the `test-leave-out-*` features.
  - `crates/deep-show/src/main.rs`:
    - 1724, `modules(set)`, where the leave-out features `retain` on manifest name.
    - 1791, where the base's `media` module joins the full set.
  - `src/media.rs`: the decode worker's helper process and `workers`.
  - `crates/deep-canvas-scene3d/src/emitters.rs`: the base's `media` manifest, `implements: "media@1"`.
  - `crates/deep-canvas-test-modules/src/lib.rs`: the test modules' `manifest(name, deps)` at 22.
  - `crates/deep-codecs/src/lib.rs`: the probe's WAV stream, with `sample_rate` and `duration` as `[frames, rate]`.

## The surface an implementer builds

All of it is in `deep-show`. Nothing here adds a binary.

### Cargo features of `deep-show`

| Feature | What it does |
|---|---|
| `test-leave-out-media` | The build set's list without the canvas module named `media`. In `modules(set)` this is `out.retain(\|m\| m.manifest.name != "media")`, as `test-leave-out-vector` does. If a shipped module requires media, drop it too, as `test-leave-out-motion` does, so the set still seals. |
| `test-probe` | Adds the honest test canvas module `test.probe` (below). |
| `test-probe-via-media` | Adds the planted twin, which is also named `test.probe` (below). It is never combined with `test-probe`. |

The tests build two feature sets:

- `full,test-leave-out-media,test-probe`
- `full,test-leave-out-media,test-probe-via-media`

### The honest test canvas module `test.probe`

- **Manifest:** `test.probe` 1.0.0, `implements: "test.probe@1"`, `depends_on: {}`. Only the core: no media, and no
  dependency on any other module.
- **Kind:** `test.probe@1`, with two params:
  - `box`, as `rect@1`'s.
  - `asset: string`, an ID in the document's `assets` map. That entry is `{sha256, license}`, and the bytes are in the
    evidence store at `<evidence>/<2 hex>/<62 hex>`.
- **Probing:** at check, the module gets the asset's probe from the core's decode worker. This is the same helper
  process and `probe` job that `media_import` uses (#498). It never goes through the media module.
- **Arrays:** two, owned by `test.probe`, holding the item's values and read in the frame:
  - `test.probe.sample_rate`: an integer, Hz. It is the first audio stream's `sample_rate`.
  - `test.probe.duration`: an integer, flicks. It is that stream's `duration`, converted exactly from its own time
    base (`[frames, rate]` × 705,600,000 / rate).

### The planted twin

The twin is the same module `test.probe`, with the same kind and arrays, but its probe calls through the media module.
It therefore declares `media` (`^1`) as a required dependency, or reads a media array that it declares. In the build
without media, the seal refuses it before any scenario is read. The refusal is #305's line, and the process exits 2:

```json
{"ok": false, "code": "seal_refused", "reason": "missing_dependency" | "unresolved_read", "modules": ["media", "test.probe"], "arrays": [...]}
```

### Calls, unchanged from the base suites

| Call | Reply the test reads | From |
|---|---|---|
| `{"call": "registry"}` | `modules` and `state` | #305 |
| `deep_show` of the document, with `include: ["issues"]` | `outcome: "presented"` | |
| `{"call": "eval", "doc", "t": 0, "arrays": ["test.probe.sample_rate", "test.probe.duration"]}` | `outcome: "evaluated"` and `arrays: {name → integer}` | #497 |
| `{"call": "workers"}` | `workers: [{pid, role, jobs: [{op, file}]}]` | #498 |

## What the tests check

**Honest half.** The build is `full,test-leave-out-media,test-probe`. The fixture is a 1.5 s mono 16-bit WAV at
22,050 Hz (33,075 frames), made by node and kept in a temporary evidence store by its SHA-256. The document is a board
with a `rect@1` and one `test.probe@1` item that names asset `tone`. It has `requires.modules: {"test.probe": "^1"}`
and names no media kind. The test passes when all of these hold:

- deep-show starts, which means the seal passed.
- `registry.modules` has `test.probe` and not `media`, and its state is `sealed` or `ready`.
- The document is `presented`.
- `eval` reads `test.probe.sample_rate` = 22,050 and `test.probe.duration` = 1,058,400,000.
- `workers` never lists deep-show's own pid.
- `workers` lists a `decode_worker` that ran a `probe` job on the WAV's hash.

**Planted half.** The build is `full,test-leave-out-media,test-probe-via-media`, given the same scenario. The test
passes when all of these hold:

- deep-show exits 2.
- It writes one line, `seal_refused`, and no reply.
- The reason is `missing_dependency` or `unresolved_read`.
- `modules` holds `media` and `test.probe`.

**How the tests fail a wrong program:**

| Wrong program | Where it fails |
|---|---|
| Probes through media | The honest half fails, because the build won't seal. |
| Puts the decode worker inside the media module | Both builds lose their probe. |
| Probes in deep-show's own process | The `workers` check fails. |
| Fakes the values without probing | The 22,050 Hz / 1.5 s numbers can't be guessed. |
| Seals the twin anyway | The planted half fails. |

## Readings where the issue and design leave a choice

- **"Seals"** means deep-show starts and `registry` reports the sealed set. **"Probes its asset"** means the module's
  own arrays carry the probe's values, and `workers` shows the probe ran in a decode worker on that file's hash.
- **"Calls through the media module"** can only reach the seal as a declared dependency or read, because a module "reads
  only what it declares". So the refusal may be `missing_dependency` or `unresolved_read`. Both are #305's reasons.
- **"Naming media"** means `modules` contains `media`. The test also requires `test.probe` in `modules`, so the refusal
  is the twin's and not some other module's.
- The full set, rather than `core`, is used because it is the shipped set that holds the media module at the base. The
  test then shows that the set still seals and probes with media left out.

## How to run

```sh
npm ci                         # once, if node_modules is missing
CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 npx vitest run --root tests/acceptance/499/module/redraft --no-file-parallelism
node node_modules/typescript/bin/tsc -p tests/acceptance/499/module/redraft/tsconfig.json   # type-check
```

- **Builds:** the file runs `cargo build --locked --bin deep-show --no-default-features --features <set>` once for
  each of its two feature sets in `beforeAll`. It copies each binary out of `target/debug` (or `$CARGO_TARGET_DIR`) under
  its own name into a temporary folder, and removes that folder after.
- **Temporary state:** each test's evidence store is a temporary folder, deleted after the test.
- **Dependencies:** node built-ins and vitest only.
- **Platform:** cargo is the only platform need. Without it, every test fails with `BLOCKED:`. The WAV decodes through
  the decode worker's own decoder, so no platform codec or ffmpeg is needed.
- **Lanes:** `scripts/lanes.mjs` needs this folder in its one-at-a-time list, because the file builds a cargo binary.
- **Cleanup:** a run with `--root` may leave `node_modules/.vite` here; delete it.

## Not run

- No cargo build was run, because the disk and CPU are shared. These tests have not run at the base.
- At the base, the first build fails: `deep-show` has no `test-leave-out-media`, `test-probe` or `test-probe-via-media`
  feature. Both tests then fail at the build getter. That failure is the missing behavior.
- The type-check (`tsc -p`) passed.

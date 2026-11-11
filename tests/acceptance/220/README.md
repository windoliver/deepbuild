# Acceptance tests for #220: the typeset job, a formula's LaTeX or Typst as an SVG with one id per term

Written first, blind, from issue #220 (its Scope, Fields, five acceptance criteria and Proof), the design sections it
names and base commit `a9f78a6b` ("design(#220): the typeset job's outputs, issues and source in deep_job's terms, warm
and cold, and a drawn match_morph"), by a job that never saw an implementation; none exists at the base. The
implementing agent doesn't edit these files (AGENTS.md, Proof); a dispute goes to a blind redraft of this job (design:
Dogfooding).

## What was read

- Issue #220, live (`gh issue view 220 --repo windoliver/deepbuild`), no comments. The tags below are computed from its
  checkbox texts.
- `docs/canvas-primitives.md`: Asset job (jobs keyed by hash(tool@version, params, input hashes), outputs stored by
  hash, kinds through `deep.registerJob` and tools through `deep.registerJobTool`, a tool qualified to give the same
  bytes on each target triple); **Asset job: typeset** (its fields; "In `deep_job`'s terms": no inputs, outputs `svg`
  and `probe`, `made_by.input` the parts' sources joined by one space, the `deep:typeset` metadata, `data-source` on each
  part group; part ids; the issues, the first two the kind's output checks, answered `failed` with `check` and a
  `reason` holding the issue's fields as JSON, keeping nothing; Semantics: parts joined and typeset once, one `<g id>` a
  part, `parts_apart`, outlines only, `currentColor`, `unknown_command`, the alt compared with ASCII whitespace removed,
  "one build gives the same bytes on every target triple"; Cost: warm and cold); Vector and formula `vector@1` and its
  quote (`src`, `size`, `colors` with `currentColor`, `alt`, parts by id, match_morph across two imports).
- `docs/technical-design.md`: Films and figures on the canvas (Formulas and text), Vector and formula, Dogfooding.
  `AGENTS.md`.
- At the base, for surfaces only: `packages/hub/src/jobs.ts` (deep_job's list and run, the receipt's `cache`, a failed
  output check answered `{status: "failed", check, outcome, reason}` with nothing kept), `packages/hub/src/tools.ts`
  (deep_job's strict arguments: `params` as JSON text), `packages/extension-host/src/host.ts` (`runTool`: `node
  <run.dir>/<run.entry>` with `{params, inputs}` on stdin and `{outputs}` on stdout, each output in base64; install's
  qualification), `src/job-kinds.ts` (`kindOf`, which at the base refuses a kind that declares no input),
  `packages/jobs/bakes/` (the one first-party job plug-in, and `tests/acceptance/1819/` installing it from its folder),
  `packages/evidence` (the store's `<2 hex>/<62 hex>` files), `crates/deep-show` (`hub.rs`'s `inline_vectors`: `deep
  show` runs `deep_canvas_vector::check` and answers its issues; `film.rs`'s `film.morphs`), `crates/deep-canvas-vector`
  (`check`, the SVG import, `lower::placement`), `crates/deep-canvas-motion/src/morph.rs` (a piece's centre is the lerp
  of its two parts' box centres; curves flattened within 0.001 u), `crates/deep-marks-render` (`deep-canvas-render check`
  runs the same `deep_canvas_vector::check`), `scripts/benchmark.mjs` (`fingerprint`, `judgeLimit`),
  `scripts/proof-change.mjs` (`criterionId`), `.node-version`.
- Suites as models: `1922` (hub, `deep install`, deep_job over MCP, README layout), `494` (`deep-show run`, `film.morphs`),
  `406` (vector issues), `408-redraft-ac5` (Docker for a second triple, judgeLimit, INCONCLUSIVE), `501` (the taste
  test), `1819` (a first-party job plug-in installed from `packages/jobs/`).

## Criteria and files

Each `describe` and `it` title starts with `AC<n>` and the criterion's tag: `#220.` and the first 8 hex digits of the
SHA-256 of the checkbox's text, trimmed, white space collapsed (`scripts/proof-change.mjs`'s `criterionId`).

| AC | Tag | File | Tests |
|---|---|---|---|
| AC1 | `#220.a1078979` | `parts.test.ts` | five part groups, no `<text>` or `<use>`; the parts' union equals the one part point for point; two runs (two hubs) the same bytes; this Mac and linux/amd64 the same bytes |
| AC2 | `#220.ec8a4363` | `morph.test.ts` | the shared ids; the match morph's pieces at 0, 0.5 and 1 s |
| AC3 | `#220.472f9775` | `issues.test.ts` | `\ce{H2O}`: `typeset.unknown_command`, nothing written; `e^{i` and `\pi}`: `typeset.parts_apart`; alt `a^2+b^2=c^3`: `formula.alt_mismatch`, and the matching alt not |
| AC4 | `#220.e4f3b85e` | `budgets.test.ts` | the 40-glyph SVG under 64 KB; warm under 50 ms and cold under 1 s by judgeLimit |
| AC5 | `#220.56b932fa` | `taste.test.ts` | the recorded taste call on the check run's pictures |

## Run them

macOS, the repo's Node first on `PATH`:

```sh
npm ci                                    # once, if node_modules is missing
NO_COLOR=1 npx vitest run --root tests/acceptance/220 --testTimeout=600000 --no-file-parallelism
node node_modules/typescript/bin/tsc -p tests/acceptance/220/tsconfig.json
rm -rf tests/acceptance/220/node_modules/.vite
```

- **Builds.** Each hub file's `beforeAll` runs `npm run build --workspaces` (the hub and `deep` run from
  `packages/cli/dist/main.js`) and `cargo build --locked -p deep-hook` (the hub won't start without it); `morph.test.ts`
  and `issues.test.ts` also run `cargo build --locked --bin deep-show --no-default-features --features full` and copy the
  binary out of `target/` (honoring `CARGO_TARGET_DIR`). Cargo runs with `CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0`
  unless they are set. While the plug-in folder is missing nothing is built: every hub test fails at its first assertion.
  `--root` keeps the repo's `vitest.config.ts` out, which can't load until the workspaces are built; once they are,
  `npx vitest run tests/acceptance/220 …` runs the same files.
- **Lanes.** The files start hubs and build cargo binaries, and `budgets.test.ts` times: the implementer adds
  `'tests/acceptance/220/'` to `alone` and `'tests/acceptance/220/budgets.test.ts'` to `timed` in `scripts/lanes.mjs`
  (this job writes only this folder). The supervisor's sandbox needs a shell that may start it (in Claude Code, the Bash
  tool with its sandbox off).
- **The second target triple** needs, once per machine, with the network: `docker pull --platform linux/amd64
  node:24.22.0-bookworm-slim` (the version is `.node-version`'s; the test's message names the current one). The suite pulls and
  builds no image; without Docker or that image the triple test is INCONCLUSIVE.
- **Safety.** Every hub folder is under `/tmp/dh220-*` (short, for the hub's socket path) and removed after its file;
  every hub, `deep` command and `deep mcp` runs with `HOME` in its world's folder and without the caller's `DEEP_*`,
  `CLAUDE*`, `CODEX*`, `ACCEPTANCE_*`, `NODE_OPTIONS`; every process is one this suite started, stopped by its PID;
  nothing is stopped by name or port. Nothing leaves 127.0.0.1; the Linux container runs with `--network none`.
- **The proof** (the SVGs, the replies, the morph's pieces, the times) is written to `$TMPDIR/deep-220-proof/`.

## The surface under test

The issue and the design name the job kind `typeset`, its plug-in of its own, `deep install`, `deep_job`, the outputs
`svg` and `probe`, the part groups, the issues, `vector@1` and `match_morph`. Where they leave a name or shape open, this
job picked the reading most faithful to them; each is listed here so the implementer builds to it.

1. **The plug-in** is the folder **`packages/jobs/typeset/`** (a reading: the design names "a first-party plug-in of its
   own, apart from the 3D asset-tools plug-in", and at the base `packages/jobs/bakes/` is the only first-party job
   plug-in), with `deepbuild.json` and `index.ts`, installed with `deep install <folder>` as you, confirmed by the
   stubbed OS (`DEEP_HUB_TEST_CONFIRM`). `deep_job {op: "list"}` then lists the kind `typeset` with its first tool
   `typst-mitex@<version>`; the version is read from that list. `ACCEPTANCE_220_PLUGIN=<folder>` installs another
   folder in its place (Plants).
2. **deep_job** over `deep mcp`, as an agent's MCP client calls it: `{op: "run", kind: "typeset", tool:
   "typst-mitex@<version>", params: "<JSON text>", inputs: []}`. Done: `{status: "done", outputs: {svg: {sha256}, probe:
   {sha256}}, receipt: {…, cache: "miss" | "hit"}}`; each output's bytes are read from the hub's evidence store at
   `<home>/.deepbuild/evidence/<sha[0..2]>/<sha[2..]>` and checked against the hash; the probe is a JSON object. A kind
   issue: `{status: "failed", check: "<the issue's code>", reason: "<text>"}` with no `outputs`, the reason holding the
   issue's fields as a JSON object (the design's words; at the base the hub writes the output check's failure messages
   into `reason`).
3. **The params** are the design's `typeset {…}` with every default written out: `{syntax: "latex_math", parts:
   [{source}, …], display: true, font: "new_computer_modern_math", macros: []}`, so a run of the tool's own process
   gets what the hub gives it. The criteria's `parts: ["a^2", "+", …]` are read as the design's `parts: [{source:
   "a^2"}, …]`, no `id`. "The same source typeset as one part" is `parts: [{source: "a^2 + b^2 = c^2"}]`, the five
   sources joined by one space (the job's source).
4. **A part group** is a `<g>` element carrying both `id` and `data-source`.
5. **The tool's own process** is `node <plug-in>/<run.dir>/<run.entry>` in `run.dir`, with `PATH=/usr/bin:/bin` and
   `HOME` a temp folder, as the extension host runs it. `run.dir` and `run.entry` come from the plug-in's own
   registration: the suite imports `<plug-in>/index.ts` and calls its default export with a `deep` that records
   `registerJobTool("typeset", {tool: "typst-mitex@…", run: {dir, entry}, …})`. **The process takes one request a line**
   on stdin, the job API's `{params, inputs: {}}`, answers each with one line on stdout, `{outputs: {svg: <base64>,
   probe: <base64>}}`, as it arrives and in order, and exits 0 at the end of its input. The hub's single request,
   written with no newline and ended by the end of input, is the one-request case, so the hub's runs are unchanged. A
   reading: the design defines warm as "a later typeset in a tool process that has already typeset one", so one
   process takes more than one request, and the job API's own object a line is the smallest way to give it them.
6. **The second target triple** is x86_64 Linux: the same plug-in folder mounted read-only in a linux/amd64 container
   of `node:<.node-version's version>-bookworm-slim`, `--network none`, the same request on stdin (the design: "built once to
   WebAssembly and run by its Node entry, with its fonts in its own folder, so one build gives the same bytes on every
   target triple"). The first is this Mac's.
7. **The match morph** is #494's surface at the base: `deep-show run` (`full`) with a scenario of your shell, `deep show`
   of a film (`profile: film`, an 800 × 450 page, a still 2D camera, `requires.modules.vector`) holding two vector@1
   items `{src, size, colors: {currentColor: "ink"}, alt}` and a transition `{from, to, kind: "match_morph", at:
   "0.5s", span: "1s", progress: "linear", match_morph: {}}`, then `eval {doc, t, film: true}`, whose
   `film.morphs.<transition>.pieces` are `{from: "<item>#<part id>" | null, to, center, opacity}`. The SVGs are the
   job's bytes, put in the scenario's own evidence store by their SHA-256.
8. **`formula.alt_mismatch`** is read from `deep show` in the same `deep-show run`: an issue in the reply's issues with
   `code: "formula.alt_mismatch"`, `severity: "error"` and the item's ID in `ids` (or as `item`). `deep show` runs the
   vector import (`deep_canvas_vector::check`, which also serves `deep-canvas-render check`), and the design puts this
   check in that import ("The vector import reads the source from the SVG's own `deep:typeset` metadata"), where an
   agent's document meets the job's SVG.

## How each criterion is read

- **AC1** (`parts.test.ts`). The five parts run once in a world. Their SVG, read by this suite's XML reader, has no
  element whose local name is `text` or `use`, and exactly five part groups whose `data-source` values are the five
  sources. The same source as one part runs in the same world and writes one part group. **Point for point**: each
  group's outlines are every sub-path drawn inside it (`path`, `rect`, `polygon`, `polyline`, `line`, `circle`,
  `ellipse`, inside `g`, `a` and `svg`), relative commands made absolute, H and V as L, S and T as C and Q, every
  transform from the root applied; the union of the five groups' sub-paths and the one group's sub-paths are equal as
  multisets, verb for verb and point for point within 0.001 user units. The same comparison of the union with its first
  part moved by 0.01 must fail, so the comparison can't pass vacuously, and each part must draw at least one sub-path.
  **Two runs**: the same params in a second world (its own hub and home), both receipts `cache: "miss"`, the same SVG
  hash. **Two target triples**: the tool's own process on this Mac, given the job's request, writes the job's SVG
  bytes, and so does the tool in the linux/amd64 container. Without Docker or the image, or when the container decides
  nothing (Docker can't start it, exit 125; it runs out of time, 124 or the client's timeout; Node under emulation is
  killed, 132, 137 or 139), that test is INCONCLUSIVE; the tool's own failure there (another exit, no answer line) fails.
- **AC2** (`morph.test.ts`). A: `a^2`, `+`, `b^2`, `=`, `c^2`; B: `a^2`, `=`, `c^2`, `-`, `b^2`; no ids. **Ids**: in each
  SVG exactly one part group has each shared source as its `data-source`, its id the same in A and B and equal to the
  design's id from its source (`t-a_5e2`, `t-b_5e2`, `t-c_5e2`, `t-_3d`). **The morph**: both SVGs imported as `fa` (at
  (50, 40)) and `fb` (below it), each sized to its viewBox at one scale k (at most 700 u wide and 160 u high), so the
  import places a user-space point p at pos + k (p − viewBox origin). A shared part's old place is the centre of the
  bounds of its group's curves in A (curve extrema, not control points), placed as fa places it; its new place the
  same in B, placed as fb. At p = 0, 0.5 and 1 (0, 0.5 and 1 s), exactly one piece goes `fa#<id>` → `fb#<id>` for each
  shared part, its centre within 0.5 u of old + p (new − old) and its opacity at least 0.99; the only pieces with a
  side missing are A's `+` going out (opacity 1, then strictly between, then 0, within 0.01) and B's `-` coming in (the
  reverse), and there are no other pieces. Each shared part's places are more than 10 u apart, so the fixture
  discriminates.
- **AC3** (`issues.test.ts`). `\ce{H2O}` as one part: `status: "failed"`, `check: "typeset.unknown_command"`, no
  `outputs`, and some JSON object written in `reason` has `command: "\ce"` and `at` the byte range [0, 3] (read as `[0,
  3]`, `{start: 0, end: 3}` or `"0..3"`). **Writes nothing**: the evidence store's files by hash are the same after the
  run as before it. `e^{i` and `\pi}`: `status: "failed"`, `check: "typeset.parts_apart"`, no `outputs`, and some JSON
  object in `reason` has `parts` holding both, each by its source or its id. **The alt**: the five parts' SVG, imported
  as `eq` with alt `a^2+b^2=c^3`, gets an error `formula.alt_mismatch` naming `eq`; the same with alt `a^2+b^2=c^2`
  (the job's source with its spaces removed) gets no `formula.alt_mismatch` and is presented.
- **AC4** (`budgets.test.ts`). The 40-glyph formula is the letters a to t joined by ` + `, one letter squared: 20
  letters, 19 plus signs and one 2. Through deep_job its probe's `glyphs` is 40 and its SVG is under 65,536 bytes (64
  KB as this codebase counts a KB). **Times**: one untimed process, then five; in each, the first request (the square
  on a) is **cold**, from the process's start to its answer line, its load included; a second request in the same
  process (the square on another letter, so no answer is a cached one) is **warm**, from writing it to its answer line.
  Each answer must be an SVG whose probe counts 40 glyphs. judgeLimit (the perf lane's, imported from
  `scripts/benchmark.mjs`, with the load at each process's start and end) judges the five warm times against 50 ms and
  the five cold against 1,000 ms: FAIL fails; anything but PASS (off a reference Mac, on battery, loaded) is
  INCONCLUSIVE, never a pass.
- **AC5** (`taste.test.ts`). Reads the record only (The taste call).

## Plants

Twin plug-in folders the implementer provides, each the plug-in with one wrong program, run in the plug-in's place
with `ACCEPTANCE_220_PLUGIN=<folder>`; each must fail the named test at the named assertion, and the run is the
implementer's proof that the test bites:

| Twin | The wrong program | Fails |
|---|---|---|
| `typeset-apart` | typesets each part on its own and sets them side by side | AC1's union ("the union … equals …") |
| `typeset-use` | writes each glyph once in `<defs>` and draws it with `<use>` | AC1's "no `<use>` element" |
| `typeset-stamped` | writes the time of the run into its `<metadata>` | AC1's two runs ("the same SHA-256") |
| `typeset-index-ids` | ids by position (`t-0`, `t-1`, …) | AC2's ids, and the morph's pieces |
| `typeset-no-checks` | registers no output checks, so a probe's issues pass | AC3's `\ce` and `parts_apart` ("failed") |
| `typeset-slow` | waits 60 ms before each answer | AC4's warm time (FAIL on a reference Mac) |

Inside the tests: AC1's comparison must catch one part moved by 0.01; AC2's fixture must move every shared part more
than 10 u; AC3's alt control fails a check that raises `formula.alt_mismatch` always or compares the spaces; the base
(no typeset kind, no alt check) fails every test.

## Known limits

- The SVG reader is this suite's own. It skips `defs`, `symbol`, `clipPath`, `mask`, `pattern`, `marker`, `metadata`,
  `title`, `desc` and `style` (they draw only where referenced, and no `<use>` may reference them), places a nested
  `<svg>` by its `x` and `y` only, compares an arc's radii and flags as written, counts only an arc's end points in
  bounds, and leaves stroke widths out of bounds. A typesetter's glyphs are filled outlines of lines and Béziers.
- "Writes nothing" reads the evidence store's files; the hub's cache file is not read.
- AC4's 40 glyphs are the probe's own count. The times are the tool's process's, not the hub's run (each hub run starts
  a fresh process, so only a cold time could be read there).
- The probe's `made_by`, `license`, `parts`, `baseline` and boxes, `currentColor`, outside references, the generated
  skill and the macros are in the Scope but in no criterion; no test reads them.
- On a machine that is itself x86_64 Linux the triple test is INCONCLUSIVE: the container would be the same triple.

## The taste call

The check run writes three files to `docs/evidence/220/`: `five-parts.png` (the typeset SVG of a^2 + b^2 = c^2 with its
five part groups), `match-morph.png` (the match_morph between a^2 + b^2 = c^2 and a^2 = c^2 - b^2), each taken from the
exported file, and `match-morph.apng` (a recording of the 1 s match_morph). The owner's one call goes in
`tests/acceptance/220/TASTE.json`:

```json
{ "issue": 220, "criterion": "#220.56b932fa", "verdict": "looks_right", "who": "…", "when": "2026-11-10T09:00:00Z",
  "screenshots": { "five-parts.png": "<sha256>", "match-morph.png": "<sha256>", "match-morph.apng": "<sha256>" }, "note": "…" }
```

`verdict` is `looks_right` or `looks_wrong`; `screenshots` names all three with their SHA-256. No pictures, no call, or
a call on other bytes is INCONCLUSIVE; `looks_wrong` fails. No test judges a picture. This job writes no TASTE.json.

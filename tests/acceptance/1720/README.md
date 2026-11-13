# Acceptance tests for #1720: the live hub's canvas core has no packs, so the castle example is refused

Written first, blind, from issue #1720 (read live with `gh issue view 1720`: its text, Scope, four acceptance criteria, Proof and
Depends on), the design sections it links and base commit `ba3bb543` (`main`, "Merge pull request #2208 …", which descends from
`de304b9f`, "Merge pull request #2192 … feat/1820-pack-assets", with no change for #1720 between them), by a job that never saw an
implementation; none existed. The implementing agent doesn't edit these files (AGENTS.md, Proof); a dispute goes to a blind redraft
of this job (design: Dogfooding).

## What was read

- `docs/canvas-primitives.md`: Pack ("It's checked once per version, and a published version never changes"; Cost: "Checked once per
  version"; a familiar-names pack's recipe states its conversions), Pack: retired and missing (the store's row per pack version, the
  notice `pack_missing {pack, version, ids}`), Pack: kinds in any pack.
- `docs/technical-design.md`: "Five ways in, all onto the same core" (the MCP tools row: `deep_show`, and `deep_kinds`, which "lists
  kinds, recipes, packs … and maps the words of other 3D tools onto them with their conversions", each entry with "the origin
  (first-party, a pack, a plug-in or an agent)"; the Canvas contract row), Dogfooding and "Who drafts it".
- The sibling suites: `tests/acceptance/1718/` (the house style copied here: deep_kinds through the hub and `deep mcp`, the agent
  stand-in, the installed tree), `806/` (deep_show through the hub and `deep mcp`), `306/` (the pack store, `install_pack`, the
  `packs` call and its `checks` count), `412/` (deep_kinds against `deep-show run`), `26/` (`deep mcp`, the agent stand-in
  `fixtures/agent.mjs`, `callTool`), `41/` (the installed tree), and `994/` and `1202/` for how a suite reads `deep doctor --json`.
- At the base: `packages/hub/src/canvas.ts` (`shape`, `Canvas`, `renderStill`), `packages/hub/src/core.ts` (`canvasWorld`, `show`,
  `preparePackAssets`, `kinds`, `install` for a pack folder, `health`, `mcpCall`), `packages/hub/src/packs.ts` (the hub's pack store),
  `packages/hub/src/doctor.ts` and `canvas-doctor.ts`, `crates/deep-show/src/packs.rs`, `main.rs` (`CanvasSide`), `kinds.rs`
  (`kinds_word`, `listing`), `registries.rs` (`pack_entries`), `familiar.rs`, `crates/deep-canvas/src/document/packs.rs` (`PackId`,
  `Packs::admit`, `checks`), `packs/*/pack.json`, `packs/examples/castle.json`, `scripts/install-prefix.mjs`.

## What the base has

- **A pack store in the hub, which nothing fills with the first-party packs.** Since #1820 the hub keeps installed pack versions under
  `<root>/packs/` (`packages/hub/src/packs.ts`, one JSON record per version, kept across restarts); `deep install <pack folder>` stages
  a version, has the canvas core run `install_pack` (the pack check), and admits it; `canvasWorld` hands the store's packs to the
  canvas core as the world's `packs`. Nothing reads `packs/` at start, and no first-party `pack.json` carries the `id` (`owner/name`)
  that `readPack` requires.
- **The castle refused before the canvas core.** deep_show of a document naming a pack version the store lacks answers
  `{"status": "BLOCKED", "outcome": "refused", "cause": "pack_missing: deepbuild/composites@1.0.0", "snapshots": []}`
  (`core.ts`, `preparePackAssets`).
- **No familiar words.** `deep_kinds word BoxGeometry` through the hub answers `{"word": "BoxGeometry", "code": "no_match", …}` (#1718's
  fix is in the base, so the call itself is taken); `deep-show run` with the familiar pack in its store answers `familiar.box@1` with
  the pack's conversion, `pack: "deepbuild/familiar@1.0.0"`, `renamed_from`, `core` and `set_digest`.
- **No pack in the listing.** Even with all seven first-party packs in `deep-show run`'s store, no page of `deep_kinds list` (12 pages)
  names a pack version: the listing has rows for registry entries packs fill, and these packs fill none.
- **Two first-party packs the canvas core's pack check refuses.** `deep-show run` with the seven in its store admits blender,
  composites, familiar, godot and unreal, and refuses fx and chrome-fx with `unknown_field` at `operators` and `functions`: #306's check
  doesn't take those fields yet, while `crates/deep-canvas-effects` compiles both packs in (`fx.rs`, `chrome_fx.rs`) under its own
  operator check. The criterion names every folder with a pack.json, so the suite holds all seven to it (Readings, below).
- **A weak recipe check.** The base's pack check admits a recipe whose step reads an input it doesn't declare, or names a kind no module
  registers; it refuses an input whose default lies outside its own range (`out_of_range` at `recipes/<kind>/inputs/<input>/default`).
- **The castle with its pack.** `deep-show run` with the first-party packs in its store presents `castle.json` with no issue; without
  them it answers `unknown_kind` notices, one per composite (`notices`).
- **A per-call count.** The canvas core (`deep-show canvas`) replays its whole scenario at every call with a fresh store, so a pack in
  the world's `packs` is checked again at every call, and its `checks` (#306's `packs` row) reads 1 in every replay and every process:
  it can't count across calls or hub restarts.
- **No packs in the release.** `scripts/install-prefix.mjs` lays out no `packs/` in the installed tree.

`BASE-FAILURE.txt` is the run at the base: all five tests fail. AC1, AC2, AC3's listing and AC4 fail at their criterion's own
assertion (AC1's failure naming `deepbuild/composites@1.0.0`); AC3's plant stops where the release ships no first-party pack to
plant beside, before its listing and doctor. `restarts.test.ts` was run alone once more after a change in how it reports only.

## Run them

```sh
npm ci && npm run build --workspaces     # the tests run the built CLI: deep hub run, deep mcp, deep doctor; install-prefix copies dist/
node node_modules/vitest/vitest.mjs run --root tests/acceptance/1720 --no-file-parallelism --testTimeout=600000
node node_modules/typescript/bin/tsc -p tests/acceptance/1720/tsconfig.json
```

Node 24, `git` and `cargo` on the `PATH`. Each file builds the canvas core and deep-hook once (`cargo build --locked --bin
deep-show`, then `--bin deep-hook`, in separate runs so neither changes the other's features), in the checkout's `target/` with
`CARGO_TARGET_DIR` dropped, since that is where the checkout's hub looks for both; the hub refuses to start without a deep-hook. Set
`CARGO_INCREMENTAL` and `CARGO_PROFILE_DEV_DEBUG` for the run as for your own build, or the tests' builds rebuild. `planted.test.ts`
also lays out #41's installed tree (`node scripts/install-prefix.mjs --prefix /tmp/dh1720-p-*`), deleted after the file; its deep-hook
is the checkout's build copied to `<tree>/target/debug/deep-hook`, where the tree's hub looks next, as #1718's suite does.

`scripts/lanes.mjs` needs `'tests/acceptance/1720/'` in its `alone` list: the files build cargo, start hubs, restart one and lay out
an installed tree, as #26's, #412's, #806's and #1718's folders do. This README is the instruction; the implementer makes that edit.

Every process runs with `HOME` a temporary folder under `/tmp/dh1720-*` (a socket path must fit in 104 bytes), so the hub's root is
`<home>/.deepbuild` and the real `~/.deepbuild`, `~/.claude` and `~/.codex` are never touched. `deep doctor` runs with a `PATH` of
Node's folder and the system folders only, so no `claude` or `codex` of the machine runs. Each test stops only processes it started,
by PID (`helpers.ts`, `cleanup`, and `t26.stopHub` for a restart). Nothing is written into the checkout's own `packs/`: the plant goes
into the installed tree. No test uses the network.

## The surface under test

Only what the issue names: **`deep hub run`** in a temporary HOME (the checkout's, and the installed tree's for the plant); **a Claude
Code session bound by its hooks**, #26's agent stand-in sending SessionStart, UserPromptSubmit and PreToolUse from hook processes it
starts, the hub's record holding its `session.start`; **`deep mcp`** started as that agent's child (#26's `op: mcp`), with `initialize`
and `tools/call` of **`deep_show`** (`{doc: <a fresh ULID>, document: <castle.json's text>}`) and **`deep_kinds`** (`{op: "word", word:
"BoxGeometry"}`, `{op: "list"}` and `{op: "list", cursor}`), every other field left out (null, #26); the reply is the tool result's
`structuredContent`, else its first text block's JSON (#26's `outcomeOf`); **`deep-show run`** for the reference answer (one scenario,
`packs: [{"id": "deepbuild/familiar", "dir": <packs/familiar-1.0.0>}]` and the one deep_kinds call), run with the binary the hub runs
as its canvas core, and for the plant's own pack check (#306's `packs` call); **`deep doctor --json`**; and, for criterion 4, **the
store's own count**, read from the hub's pack store under `<home>/.deepbuild/packs/` (Readings, below). No tool, call, flag or variable
in this suite is invented for the implementation to build.

## Criteria to tests

| Criterion | Tests |
|---|---|
| AC1 | `hub.test.ts` (1): through the checkout's hub and the bound session's `deep mcp`, deep_show of `packs/examples/castle.json` as it is answers outcome `presented`, and nothing in the reply is a `pack_missing` (an issue's code, or any text) or an `unknown_kind` notice (`castleFailures`). A `pack_missing` failure names the pack IDs its text holds: on the base, `deepbuild/composites@1.0.0` |
| AC2 | `hub.test.ts` (1): deep_kinds `word BoxGeometry` through the same `deep mcp` is no error, its target is `familiar.box@1`, its conversion is the familiar pack.json's own text for BoxGeometry, and its JSON text equals that of `deep-show run`'s answer with the familiar pack installed (`wordFailures`) |
| AC3 | `hub.test.ts` (1): every page of `deep_kinds list` on the checkout's live hub names each folder of the checkout's `packs/` with a `pack.json`, with the version its pack.json gives (`listed`). `planted.test.ts` (1): in the installed tree, a planted pack folder beside the shipped first-party packs, refused by the canvas core's own pack check (`deep-show run`'s `packs` row), is named nowhere in the tree's hub's listing while each shipped pack is listed with its version, and `deep doctor --json` holds an item naming it at level `warn` or `fail` |
| AC4 | `restarts.test.ts` (1): the checkout's hub started in one home, then stopped by PID and started again twice; in each run deep_kinds `word BoxGeometry` through a `deep mcp` answers `familiar.box@1`; afterwards the store under `<home>/.deepbuild/packs/` keeps, for each first-party pack version, exactly one count of its pack check's runs, and it is 1 (`storeCounts`) |

## Readings where the issue leaves a choice

- **The first-party packs' IDs.** A pack.json gives `name` and `version` but no owner. The issue's own evidence and the base name the
  owner `deepbuild` (the castle's `packs: ["deepbuild/composites@1.0.0"]`, `pack_missing (deepbuild/composites at 1.0.0)`;
  `crates/deep-show/src/familiar.rs`, `deepbuild/familiar`), so each pack version's ID is `deepbuild/<name>@<version>`, and
  `deep-show run`'s reference installs the familiar pack as `deepbuild/familiar`.
- **"Every folder under `packs/` with a `pack.json`"** is read at test time from the checkout's `packs/` (at the base: blender,
  chrome-fx, composites, familiar, fx, godot and unreal; `studio-1.0.0/` holds only looks and `examples/` no pack.json, so neither is
  one). The test lists them itself, so a pack added later is held to the same criterion.
- **"Listed … each with its version"** is read on every page of `deep_kinds list`, following `next`: some value in the listing is the
  pack version's ID `deepbuild/<name>@<version>` (the shape a pack's registry entries already carry in `pack` at the base,
  `registries.rs`, `pack_entries`), or one object holds both `deepbuild/<name>` and `version: <version>`. Where in the listing, and the
  origin `first_party` the Scope names, are left to the implementer; no criterion states them.
- **"Presented with no `pack_missing` issue and no `unknown_kind` notice"** is read on the deep_show reply: outcome `presented`, no
  object anywhere in it with code `pack_missing` or `unknown_kind`, and no text holding `pack_missing` (the base's refusal says it in
  `cause`, not in an issue). The castle is sent as its file holds it, for a fresh document ID, with the default `include`. **"The test
  names the pack"**: the failure lists every `owner/name@version` the `pack_missing` text holds.
- **"The pack's conversion text"** is `aliases.BoxGeometry.conversion` of the familiar pack's `pack.json`. **"Byte-equal"** is read on
  JSON text: the tool's value (as #26 reads it) serialized as it was parsed, key order kept, equals `deep-show run`'s reply serialized
  the same way, every field included (`pack`, `renamed_from`, `core` and `set_digest` among them: the reference runs the binary the
  hub runs as its canvas core). **"With the pack installed"** is the familiar pack alone in `deep-show run`'s store.
- **Where the planted pack folder lives.** The issue's packs are "the first-party packs that ship in its release", and the checkout's
  own `packs/` is shared by every session on the machine, so the plant goes into a release: #41's installed tree
  (`scripts/install-prefix.mjs`, the layout the hub ships in, with its own `bin/deep`, hub and canvas core). The folder that holds the
  shipped packs is found by content, as the parent of every pack folder whose `pack.json` is byte for byte one of the checkout's, so
  the suite doesn't fix where the release keeps them; a tree that ships none fails the test, since its hub can install none.
- **"Whose recipe fails the pack check"**: the plant (`fixtures/plant1720-1.0.0/`) is a well-formed pack whose one recipe's input
  `width` defaults to 1 m, outside its own range of 2 to 10 m (the base's check admits an undeclared input or an unknown kind, so
  neither would do). The test proves the check refuses it with the canvas core the tree ships (`deep-show run`, #306's `packs` row
  `state: refused` with issues: `out_of_range` at `recipes/plant1720.box@1/inputs/width/default` at the base) before it reads the hub.
- **fx and chrome-fx.** Both are folders of `packs/` with a pack.json, so criterion 3 lists them like the others, though the base's
  #306 check refuses them (above). Whether the fix widens the pack check to their `operators` and `functions` (Pack's own fields) or
  lists them from the effects module's own check is the implementer's; the listing must name each with its version either way. If
  the intent was that only the packs the canvas core's check admits are listed, that is a dispute for a redraft, not a reading this
  suite can take: the criterion says every folder.
- **"Absent from the listing"** is read as no page of `deep_kinds list` holding the text `plant1720` at all (no kind, recipe, entry or
  pack of it), beside every shipped first-party pack listed with its version, so the plant's absence isn't an empty listing.
- **"Named by `deep doctor`"** is read on `deep doctor --json` (one doctor.item@1 per line): an item whose `item`, `code`, `evidence`
  or `fix` holds `plant1720`, at level `warn` or `fail`. An item at `ok` reads "Nothing to do", which can't be how the doctor names a
  pack its check refused. The doctor runs after the listing, since the issue installs the packs "when the core starts" and the
  listing's call is what starts the hub's canvas core.
- **"Across two hub restarts"** is three runs of the checkout's hub in one home (start, then two restarts), each stopped by its PID with
  SIGTERM. Each run starts the canvas core with a deep_kinds word lookup through a fresh `deep mcp` and must answer `familiar.box@1`,
  so the packs are installed in every run: "once per version" is then about checks, not about installing only once.
- **"The store's own count".** The issue installs the packs "through the pack check, once per version, as #306's store does": #306's
  store keeps, per pack version, how many times its check ran (`checks`, a count "the binary kept, not its word",
  `crates/deep-show/src/packs.rs`). At the base the canvas core's store lives one call long (above), so a count that spans hub
  restarts can only be kept where pack versions outlive the process: the hub's pack store under `<root>/packs/`
  (`packages/hub/src/packs.ts`, one JSON record per version, and the design's "Pack version in the store"). The test reads every
  JSON record under `<home>/.deepbuild/packs/` and takes, for each first-party version, the `checks` of each object whose `ref` is
  `deepbuild/<name>@<version>` or whose `id` and `version` are the pack's: there must be exactly one, and it must be 1. The field's
  name is #306's; the record's file name and the rest of its shape are the implementer's. A store with no count, or a count per run,
  fails naming the version.
- **Sessions.** Criteria 1 to 3 run through one Claude Code session bound by its hooks (deep_show needs one; deep_kinds doesn't, at
  the base, `mcpCall`). Criterion 4 uses a `deep mcp` started by hand in each run, since deep_kinds needs no session and a session
  wouldn't outlive the hub's restart.

## Not tested, because no criterion asks

The origin `first_party` on the listing and its recipes and aliases (a Scope line, not a criterion); the castle's pixels or its
render-back; the `deep show` CLI and `deep export`; Codex sessions; studio's looks; retired packs, pack assets and `deep install` of
outside packs; any other word than BoxGeometry; the Proof line's side-by-side display, which `BASE-FAILURE.txt` and the branch's run
give.

## Files

- `helpers.ts`: temporary homes, the hub from a given `deep`, the bound session and its `deep mcp`, the castle through deep_show and
  its check (`castleFailures`), the familiar word and its `deep-show run` reference (`wordFailures`), the listing (`listing`,
  `listed`), the store's counts (`storeCounts`), the installed tree, its shipped packs and the plant, `deep doctor --json`.
- `fixtures/plant1720-1.0.0/`: the planted pack folder (`pack.json` and its one recipe, `box@1.json`).
- `hub.test.ts` (AC1, AC2, AC3's listing), `planted.test.ts` (AC3's plant), `restarts.test.ts` (AC4).
- `tsconfig.json`: type-checks the suite under the root's strict options with `allowImportingTsExtensions`.
- `BASE-FAILURE.txt`: the run at the base.

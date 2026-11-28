# Blind redraft of four acceptance tests for #3525: the catalogue is listed as a read

Written blind, at base `b134dd38f` (origin/main), by a job that saw only issue #3525 (body, Scope, eight checkbox
criteria, Proof), `AGENTS.md`, `docs/technical-design.md` (the issue's sections) and the repo at that commit. No
implementation of #3525 existed and none was read; no other checkout, branch, diff or PR of #3525 was opened. This job
redrafts the 1st, 2nd, 5th and 6th criteria only. The implementer doesn't edit these files (AGENTS.md, Proof).

Read at the base, for surfaces only: `packages/hub/src/tools.ts` (`deep_kinds`' and `deep_job`'s schemas, `toolList`),
`packages/hub/src/mcp.ts` (how `deep mcp` reads stdin and writes stdout), `packages/hub/src/hub-canvas.ts` (`kinds`,
`assets`), `packages/hub/src/libraries.ts` (`fetch`, the standing rule), `packages/hub/src/packs.ts` (`shipped`),
`scripts/skill.mjs` (`HINTS`), `packages/hub/annotations.json`, `adapters/claude-code.facts.json` (`mods.holdsWhen`),
`crates/deep-show/gallery/` (the logic counter, the guides, `gallery.json`, familiar names), and the suites reused below.

## Run

```sh
npm ci && npm run build --workspaces        # the CLI (deep mcp, deep hub run)
cargo build -p deep-hook --bin deep-show     # the hub needs deep-hook; deep_kinds and deep_show reach the canvas core
NO_COLOR=1 node node_modules/vitest/vitest.mjs run --root tests/acceptance/3525-redraft --no-file-parallelism --testTimeout=900000
node node_modules/typescript/bin/tsc -p tests/acceptance/3525-redraft/tsconfig.json
```

The folder runs alone (`lane.json`): each file starts real hubs with sandboxed plug-ins, a library over HTTPS on
127.0.0.1 and agent stand-ins, and AC6 holds a 40 s `deep_wait`. Needs `openssl` on `PATH`. Everything lives under
`/tmp/dh806-*` / `/tmp/dh26-*` with `HOME` there; every process is stopped by its PID (#806's and #26's cleanup).
Nothing leaves 127.0.0.1. No model is called.

## Surfaces

- **`deep mcp` over its stdio by raw JSON-RPC lines**: #2898's `Raw` (AC1), and #2898's `Bound` (AC2, AC5, AC6): the
  `deep mcp` that is the child of #806's Claude Code stand-in, bound to its session by its hooks.
- **The fixture hub** (`helpers.ts` `lookupWorld`): `deep hub run` in a temp home, with #806's world file (a minted
  document on the main panel), the confirmation stub and a test CA. One session per stand-in, each seeded with an open
  taste ask before the hub starts (#26's seed). Before anything is judged, the first session draws the gallery's logic
  counter (`crates/deep-show/gallery/logic-counter.json`, its program put in the store as you would drop it in) on that
  document, so `bindings` has a real logic item to read; then it makes one `deep_kinds list`, because a fresh hub
  installs the packs the release ships on its first lookup, once per store (`packs.ts` `shipped`), and the world waits
  for the store to settle.
- **The fixture library source** (`library.ts`): one model, #1731's CC0 `pine-chair` (same record and bytes as
  #1731's `library.ts`), served with #1731's API under a per-world test CA; #1731's fill (`fixtures/shelf`) installed
  by `deep install`, turned on (`library.on`), with the standing rule `library.rule {library, licenses: [CC0-1.0]}`, so a
  fetch of the model lands with no ask. A form that brought the asset in would show it at once.
- **The record**: `events.read` as the cli role. "No new asset, ask, job, evidence or revision, and no process started"
  is read as no new event of the kinds `helpers.ts` `CHANGES` matches (`ask.*`, `job.*`, `run.started`, `evidence.*`,
  `asset.*`, `library.*`, `doc.patched`, `revision.*`, `process.starting`/`tracked`, and #2898's claim, open item,
  action and proposal kinds). The record of the call itself (`tool.*`, `mcp.*`, `source.called`) is not judged.
- **The store**: every file under `<home>/.deepbuild/evidence`, before and after each call; and the library's request
  log (`/files/...` served).
- **The stand-in client** (`helpers.ts` `Client`), as the issue reads Claude Code 2.1.332: a call to a tool listed
  `readOnlyHint: true` runs beside other read-only calls; any other call runs alone, after every call before it has
  ended, and later calls wait for it. In plan mode a call to a tool not listed read-only is held and never sent, as
  `adapters/claude-code.facts.json` `mods.holdsWhen` (case `plan`) says.
- **The generated table**: `scripts/skill.mjs` run in a scratch copy of `scripts/`, `docs/`, `skills/`,
  `packages/hub` and `crates/deep-canvas/src/craft.json`, with `annotations.json` removed first; the
  `packages/hub/annotations.json` it writes.
- **Each call's arguments** are built from the listed schema (`argsFor`): every field it lists, null where the call
  gives none, so a change that drops the fetch fields is called with exactly what it lists.

## Criteria, tests, expected values and wrong programs

IDs are `criterionId` of each checkbox's text (`scripts/proof-change.mjs`).

| ID | Criterion (short) | Test | Expected | Wrong program and how it fails |
|---|---|---|---|---|
| `#3525.2c40eb3b` | `deep mcp` lists `deep_kinds` read-only and idempotent, equal to the generated table | `listed.test.ts` | `deep_kinds` annotations: `readOnlyHint: true`, `idempotentHint: true`, `openWorldHint: true` (Scope: "It stays open-world"), and the whole entry (title and four hints) equal to `deep_kinds` in the `annotations.json` that `scripts/skill.mjs` generates | the merge base: lists `readOnlyHint false` (and `idempotentHint false`); fails naming `deep_kinds` and each hint |
| `#3525.aacef461` | every form of `deep_kinds`' schema changes nothing; planted `deep_kinds` with `fetch` fails naming the asset | `forms.test.ts` | for each value of `deep_kinds`' `op` enum, its call (table `lookups()`: `list`, `word BoxGeometry`, `search counter`, `read` of the guide `logic` and of the logic counter's example hash, `gallery`, `sheet`, `step_ceilings`, `field logic@1`, `closure camera@1.projection`, `bindings` of the drawn `counter` in `rust`, `assets chair`; `fetch {library, id}` only if the schema still lists it) gains no `CHANGES` event, no store file and no library file; a listed form the table lacks is a failure | the merge base, whose `deep_kinds` still takes `fetch`: fails naming `pine-chair`'s `.gltf` and `.bin` with their hashes; the planted `kinds-fetch` server (below), in a world of its own: must fail on `op fetch`, naming `pine-chair` |
| `#3525.db140e2e` | a plan-mode client sends `list`, `field`, `read`, `word`: all four answer | `plan.test.ts` | none held; each answers a value, not an error | the merge base: all four held (`deep_kinds` listed `readOnlyHint false`); fails naming the first, `deep_kinds list` |
| `#3525.92738dfb` | with a `deep_wait` held, four lookups sent together answer before the wait ends, with their bytes alone; planted mixer fails naming both IDs | `together.test.ts` | each of the four (`list`, `field`, `read`, `word`) answers before the session's `deep_wait` on its open ask ends, with the result bytes it gave sent alone | the merge base: the client runs the four after the wait (not listed read-only), so each answers only after it ends, named by request ID; the planted `mix` server (below): must fail with a line `request <id> (deep_kinds <op>) was answered with the reply of request <id> (deep_kinds <op>)` |

Every lookup's arguments were run on the base, through the same hub, and answer there with a value (none refused, and
`word BoxGeometry` is `mapped`). Sent alone twice, each gives the same bytes.

## Planted programs (`fixtures/plant.mjs`)

Loaded into a real `deep mcp` with `node --import`, chosen by `PLANT_3525` (JSON), carried into the stand-in's `deep
mcp` by its environment. `deep mcp` reads its client with `fs.read` on fd 0 (`packages/hub/src/mcp.ts`, `requests`),
so the plant reads there first (patched `fs.read`, `syncBuiltinESMExports`) and writes through a patched
`process.stdout.write`. Each is the server under test with one wrong thing in it, however the change builds its list.

- `{"kind":"kinds-fetch"}`: a `deep_kinds` that still takes `fetch`. When the listing's `deep_kinds` `op` leaves out
  `fetch`, the plant puts `fetch` back in that enum, with `library` and `id` fields, and sends a `deep_kinds` call with
  `op: "fetch"` to the other listed tool whose own enum field lists `fetch` (the issue's drafted place, a form of
  `deep_job`), with that tool's listed fields (`library`, `id` from the call, the rest null). Where `deep_kinds` already
  takes `fetch` (the merge base) it changes nothing. It assumes the drafted form takes the merge base's fetch fields,
  `library` and `id`, as this job was told to take it; if the change's form names them otherwise, the plant can't reach
  it and the planted assertion fails, which is this test's failure, not the change's: redraft the plant.
- `{"kind":"mix","tool":"deep_kinds","holdMs":10000}`: a reply to a `deep_kinds` call waits up to 10 s for another
  `deep_kinds` reply with other bytes; the two go out swapped, each under its own request ID. A lone reply goes out
  unchanged after 10 s (so the alone calls stay right). Checked on the base with the four sent together straight to
  the server: every reply came back with another's bytes.

A twin for the before lane is each plant applied to the change as above; the merge base itself is the `deep_kinds`
that still takes `fetch`, and a client that runs non-read-only calls one at a time is the base for AC5 and AC6.

## What this job could not settle

- **`assets` stores a thumbnail on the base.** A first `assets` search of a library stores each row's thumbnail
  (`evidence.stored`, kind `asset.thumbnail`, a new store file). The criterion asks for no new evidence and no new
  store file after every form, and the issue's Scope says every form changes nothing but the record of the call, so
  this test holds `assets` to that too: on the base it fails on `assets` as well as on `fetch`. A change that keeps
  storing thumbnails fails it; whether a thumbnail counts is the issue's to decide, not this test's.
- **The first lookup installs the release's packs.** On a fresh hub the first `deep_kinds` call stores the shipped
  packs (once per store) and, under load, can answer `unavailable` while it does. The world makes that call before
  anything is judged (Surfaces). That is setup, not one of the judged calls.
- The plants were run on the base only (where `kinds-fetch` is a no-op); `kinds-fetch`'s rewrite was checked against a
  stand-in server whose listing drops `fetch` from `deep_kinds` and lists it in `deep_job`'s `op`.
- #2898's `fixtures/plant.mjs` reads stdin through `process.stdin` events, which `deep mcp` never emits; its `mix` and
  `records` plants likely never see a call. Noted, not changed (outside this folder).

## The base run

`BASE-FAILURE.txt`: the folder run once on the base checkout, home paths shown as `~`. Each test fails at its first
criterion assertion, for the reason the table gives.

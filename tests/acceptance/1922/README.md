# Acceptance tests for #1922: the job API

Written first, blind, by a job that never saw an implementation of #1922; none exists at the base (`0c4a4ec7`). The
implementing agent doesn't edit these files (AGENTS.md, Proof); a dispute goes to a blind redraft of this job (design:
Dogfooding).

## What was read

- Issue #1922 (`gh issue view 1922`): Scope, the seven criteria, Proof. The IDs are computed from its checkbox text.
- `docs/technical-design.md`: the Building blocks table's Job row; the extension API list (`deep.registerJob(kind, job)`
  `{ schema, outputs, key, output_checks, qualification }`, `deep.registerJobTool(kind, tool)` `{ name@version, params,
  run, qualification }`); the one-slot rule under composition ("Two pieces can't fill one slot ... unless its manifest
  says it replaces the first"); the slot table (`job.kind@1`, one per kind; the kind's qualification, many per kind,
  "a tool that lowercases the last letter of `test.upper`'s fixtures"); Dogfooding. `AGENTS.md`.
- `docs/canvas-primitives.md`, Asset job: "keyed by hash(tool@version, params, input hashes), so a rerun with the same
  key is a cache hit", the tool's build "(its binary, wheel or container image, by hash)", "Each output is stored by
  hash", "nothing it makes changes the document", "a third party adds one with one approval once it passes the kind's
  qualification", "an output enters it only after the kind's output checks pass".
- At the base, for surfaces and conventions only: `packages/extension-host` (`runtime/deep.mjs`'s API list and how a
  plug-in's calls cross to the host, functions kept on its side; `src/host.ts`'s `install`, `admit`, `installKits`,
  `copyPackage`, `runCheck`; `src/digest.ts`'s `packageDigest`), `packages/contracts` (`extension-api.json`,
  `hub-slots.json`, `src/manifest.ts`, `src/canonical.ts`), `packages/conformance` (check.kind@1's `CheckResult`),
  `packages/hub` (`src/tools.ts`'s strict schemas, which take no free-form object; `src/core.ts`'s `mcpCall`, which
  binds no session for `deep_kinds`; `src/plant.ts`'s `DEEP_HUB_PLANT`; `src/libraries.ts`'s authority ask and
  standing rule), `packages/supervisor` (`process.starting` / `process.tracked`), `scripts/proof-change.mjs`
  (`criterionId`). The suites `1731` (the template: layout, README, helpers, fixtures, BASE-FAILURE), `1718`, `1537`,
  `348` (a check through `deep.registerCheck`).

## Criteria and files

Each `describe` title is the criterion's ID and its text. The ID is `#1922.` and the first 8 hex digits of SHA-256 of
the checkbox's text after `- [ ] `, trimmed, white space collapsed (`scripts/proof-change.mjs`'s `criterionId`).

| AC | ID | File | Tests |
|---|---|---|---|
| AC1 | `#1922.3a2c91a2` | `pinned.test.ts` | unpinned and unregistered tools refused, no process, no document change; the paid tool held for one authority ask, your yes, your standing rule |
| AC2 | `#1922.08e9adc6` | `upper.test.ts` | one install, the list, "abc" to "ABC" by hash with its receipt, the rerun a hit with no process |
| AC3 | `#1922.c2d25c7b` | `tools.test.ts` | a second plug-in's tool beside the first; the planted tool `upper-lowlast@1.0.0` refused naming a fixture, never listed |
| AC4 | `#1922.a5d4640f` | `holder.test.ts` | the second registration refused naming the kind and its holder, the replacing one installed; the failed output check |
| AC5 | `#1922.fd1b18ec` | `key.test.ts` | 3 of 3 misses, 5 of 5 hits; planted hubs `job-key-params-text`, `job-key-no-version` |
| AC6 | `#1922.985dc2cb` | `rebuild.test.ts` | the same version with one byte changed refused, the hit kept, the next version joined; planted hub `job-build-entry-only` |
| AC7 | `#1922.583e414e` | `build.test.ts` | the receipt's build is the files' digest, two folders one build; planted hubs `job-build-hashes-paths`, `job-build-hashes-mtimes` |

## Run them

macOS, the repo's Node (24.22.0) first on `PATH`:

```sh
export PATH="$HOME/.local/share/fnm/node-versions/v24.22.0/installation/bin:$PATH"
npm ci                                           # once
npm run build --workspaces                       # the tests run packages/cli/dist/main.js
CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 cargo build --locked -p deep-hook    # the hub won't start without it
NO_COLOR=1 npx vitest run tests/acceptance/1922 --testTimeout=600000 --no-file-parallelism
node node_modules/typescript/bin/tsc -p tests/acceptance/1922/tsconfig.json
```

- **One at a time:** every test starts its own hub, which starts sandboxed plug-ins and the tools' processes through
  the supervisor, so the implementer adds `tests/acceptance/1922/` to `alone` in `scripts/lanes.mjs` (not done here:
  this job writes tests only). The supervisor's sandbox needs a shell that may start it (in Claude Code, the Bash tool
  with its sandbox off).
- **Needs:** `ps`.
- **Safety:** every folder is under `/tmp/dh1922-*`, removed after its file; every hub, `deep` command and `deep mcp`
  runs with `HOME` in its world's temp folder and without the caller's `DEEP_*`, `CLAUDE*`, `CODEX*`, `NODE_OPTIONS`;
  every process this suite starts is stopped by its PID; nothing is stopped by name or port. Nothing leaves
  127.0.0.1. No model is called: the "paid" tool is a local program that only declares a cost.
- **The proof** (the issue's Proof line) is written to `$TMPDIR/deep-1922-proof/`, rewritten each run: the list, the
  runs and receipts, the asks, the refusals, and each planted hub's failures.

## The world (`helpers.ts`)

One world per test: a temp home; **a real hub** (`deep hub run`) with `DEEP_HUB_TEST_CONFIRM` (the OS confirming you,
stubbed, as #1731's and #363's suites do) and, for a planted hub, `DEEP_HUB_PLANT`; **a project folder** holding the
inputs, the working folder of **a `deep mcp`** spoken to as an agent's MCP client does (`initialize`, then
`tools/call`); and **the hub's socket as the cli role** (the control token and this process as the peer) for
`events.read`, `evidence.read` and `job.rule`. Plug-ins are installed with `deep install <folder>` as you.

**The test plug-ins** (each folder copied per use, its `*.fixture` files renamed, the tool's two files laid in
`./tool`, `probe.json` written, its manifest's digest set by the extension host's `packageDigest`):

| Plug-in | Fixture | Registers |
|---|---|---|
| `test/upper-kind@1.0.0` | `fixtures/kind` | the check `test.upper_only`, the kind `test.upper`, and its first tool `upper-a@1.0.0` |
| `test/upper-more@1.0.0` (and `1.0.1`) | `fixtures/more` | the tool `upper-b@<version>` |
| `test/upper-paid@1.0.0` | `fixtures/more` | the tool `upper-paid@1.0.0`, `cost: {usd: 0.02}` |
| `test/upper-lowlast@1.0.0` (planted) | `fixtures/more` + `fixtures/tool/lowlast-case.mjs` | the tool `upper-lowlast@1.0.0`, which lowercases the last letter |
| `test/upper-rival@1.0.0` | `fixtures/rival` | the kind `test.upper` again, with its own check `test.upper_rival`, no tool |
| `test/upper-heir@1.0.0` | `fixtures/rival` | the same, its manifest saying `replaces: ["test.upper"]` |

**The tool** (`fixtures/tool`) is a program of two files: `upper.mjs`, its entry, and `case.mjs`, its second file,
which holds what it does (upper case, or lower case for `case: lower`, trimmed first for `trim: true`) and a comment
`build mark: a` whose one byte AC6 changes to `b`, so the change is to the files and not to what the tool writes.

## The surface under test (readings where the issue leaves a choice)

The issue and the design name `deep.registerJob(kind, {schema, outputs, key, output_checks, qualification})`,
`deep.registerJobTool(kind, {name@version, params, run, qualification})`, the slot `job.kind@1` under the one-slot
rule, `replaces`, `deep_job`, outputs by hash, the receipt, the build, the authority ask and the standing rule. Where
they leave a name or shape open, this job picked the smallest surface the design and the base code imply; each choice
is listed here so the implementer builds to it.

1. **Manifest fields.** A plug-in lists the kinds it registers as `jobs: ["test.upper"]` and the tools as
   `job_tools: [{kind: "test.upper", tool: "upper-a@1.0.0"}]` (the design: what a piece registers is in its manifest
   too), its check kinds in `checks` as today, and `deep.registerJob` / `deep.registerJobTool` in `requires.preview`. A
   second registration of a kind says it replaces the first with `replaces: ["test.upper"]`, as a check kind does.
   **Known tension:** `src/manifest.ts`'s prefix rule names a check kind a plug-in adds `ext.<plugin>.<name>`; the issue
   names the check `test.upper_only` (and this suite's rival `test.upper_rival`), so the implementation must let these
   names install (the base never reached that rule: the schema refused `/jobs` first).
2. **`deep.registerJob('test.upper', descriptor)`**, all data, no function:
   ```ts
   {
     schema: { params: <JSON Schema: {case: enum [upper, lower], trim: boolean, default false}, case required>,
               inputs: { text: { media: 'text/plain' } } },
     outputs: { text: { media: 'text/plain' } },
     key: ['tool', 'params', 'inputs'],          // hash(tool@version, params, input hashes); the hub computes it
     output_checks: ['test.upper_only'],          // check kinds, registered through deep.registerCheck
     qualification: { fixtures: [{ name, params, inputs: { text: '<UTF-8 text>' }, expect: { text: '<UTF-8 text>' } }] },
   }
   ```
   The three fixtures are `fx-greeting` ("hello" → "HELLO"), `fx-sentence` ("Done right, 42 times" → "DONE RIGHT, 42
   TIMES") and `fx-route` ("route 66" → "ROUTE 66"), each with `params: {case: "upper"}`. Fixture texts are strings,
   read as their UTF-8 bytes.
3. **`deep.registerJobTool('test.upper', descriptor)`**, all data:
   ```ts
   { tool: 'upper-a@1.0.0',                       // name@version, the field the Asset job's `tool` names
     params: <the same JSON Schema>,
     run: { dir: 'tool', entry: 'upper.mjs' },    // the tool's files are every file under run.dir; Node runs the entry
     qualification: { same_bytes: true },         // the tool's claim; no criterion reads it
     cost?: { usd: 0.02 } }                       // a paid tool's price per run (AC1); absent for an unpaid one
   ```
   It joins the kind only after the hub runs the kind's qualification on it at install: each fixture's output must be
   the expected bytes, else the install is refused, naming the fixture (AC3).
4. **How the hub runs a tool** (a miss, or a qualification fixture): as one process of its own, outside the hub's
   process (through the supervisor, so the record gets `process.starting`), `node <installed plug-in>/<run.dir>/<entry>`,
   given on stdin one JSON object `{params: <the canonical params>, inputs: {text: "<the input's bytes, base64>"}}` and
   writing on stdout one JSON object `{outputs: {text: "<base64>"}}`. A missing `trim` reads as false in the tool too.
5. **The output check** runs as check.kind@1 runs today (`run(spec, ctx)` in the plug-in, answering a `CheckResult`),
   with `spec.outputs: {text: "<the output's bytes, base64>"}`. `test.upper_only` fails an output holding a lower-case
   letter, its failure's `test` and message naming `test.upper_only`.
6. **The build** of a tool is `packageDigest` of its `run.dir` folder as installed (`d1:<hex>`: each file's path in
   that folder, mode and SHA-256), so a copy anywhere with any modified times has the same build. The list and every
   receipt name it as `build`. A refusal "naming both builds" holds each build's hex digits, at least its first 12.
7. **`deep_job` arguments** (the strict tool schema's subset, every field nullable but `op`; a field left out reads null):
   `{op: "list" | "run", kind: string, tool: string (name@version), params: string (the params' JSON text, since the
   strict schemas take no free-form object), inputs: [{name: "text", path: "<absolute path>"}]}`. Like `deep_kinds`, it
   needs no session: the suite's `deep mcp` has none.
8. **`deep_job` replies.** List: `{kinds: [{kind, plugin, tools: [{tool, plugin, build}]}]}`, `plugin` the holder's
   or the tool's plug-in id. Run, done: `{status: "done", outputs: {text: {sha256}}, receipt: {kind, tool, key, build,
   cache: "hit" | "miss"}}`, the output's bytes in the evidence store (`evidence.read {sha}` finds them); `key` any
   string. Run, held for an ask: `{status: "held", ask: "ask:<id>"}`, the same call again answering the same way
   until the job ran. Run, refused: a tool error or `{status: "refused", reason}`. Run whose output failed a check: any
   reply not `status: "done"` whose text names the check, with no `outputs` and no hash of the failed output.
9. **A paid call and your standing rule.** A run of a tool with a `cost` is held with exactly one ask, `kind:
   "authority"`, its data naming the tool (`upper-paid`) and the cost (`0.02`), with an option whose `decision` is
   `allow`; your yes is `deep inbox answer <ask> <that option>`, and it covers that call. Your standing rule is the cli
   method **`job.rule {tool: "<name@version>", usd: <most per run>}`**, counted once the OS confirms you; a run of that
   tool costing no more needs no ask.
10. **Process counts** ("starts no process", "starts one process") are the `process.starting` events the record gains
    (`events.read` on the cli role) from just before a `deep_job` call to 500 ms after its reply.
11. **Refused at install** is `deep install <folder>` exiting non-zero; "naming" reads its stdout and stderr together.
    "Changes no document" is read as: the record gains no `doc.patched` event and the project folder's files keep their
    bytes and modified times.
12. **The cache outlives a reinstall**: outputs are kept by key, so a refused reinstall (AC6) or an upgrade of the
    tool's plug-in (AC5's bump) doesn't drop it.

## Plants

The planted hubs are the implementer's, selected with `DEEP_HUB_PLANT` as `src/plant.ts` selects every other; at the
base each name is refused ("names no planted program"), so those tests fail there.

| Plant | Criterion | The wrong program | Read as failed when |
|---|---|---|---|
| `job-key-params-text` | AC5 | the key hashes the params' JSON text as written, not the canonical params | the judge fails "reordering the params' keys" and "omitting trim", each naming the params |
| `job-key-no-version` | AC5 | the key leaves out the tool's version | the judge fails "a bump of the tool's version" (a hit serving the old output), naming the version |
| `job-build-entry-only` | AC6 | the build hashes only the tool's entry file | the judge finds the same-version reinstall with `tool/case.mjs` changed accepted, naming `tool/case.mjs` |
| `job-build-hashes-paths` | AC7 | the build hashes the files' paths (where they are installed) | the judge fails, each failure naming `upper-b@1.0.0` |
| `job-build-hashes-mtimes` | AC7 | the build hashes the files' modified times | the same |

The planted tool `upper-lowlast@1.0.0` (AC3) is a plug-in, not a hub plant: the hub's qualification must refuse it.

## How each criterion is read

- **AC1** (`pinned.test.ts`): with test/upper-kind installed, runs of `test.upper` on "abc" naming tool `null`,
  `upper-a`, `upper-a@1`, `upper-a@^1.0.0`, `upper-a@latest` and `upper-a@2.0.0` (no plug-in registered it) are each
  refused with no output and no process; `upper-a@1.0.0` is done with "ABC" and one process; no `doc.patched` event,
  no ask, and the project folder unchanged. The paid tool: two calls held, one authority ask naming the tool and 0.02,
  no process; after your yes, the call again until not held is done with "ABC", one process in all, still one ask; a
  run on another input is held again (your yes covered one call); after `job.rule` it is done with "XYZ", one process,
  no ask.
- **AC2** (`upper.test.ts`): the install raises no ask; the list has `test.upper` held by `test/upper-kind` with
  `upper-a@1.0.0`; "abc" is done with `outputs.text.sha256` = SHA-256("ABC"), stored, a receipt `{kind: test.upper,
  tool: upper-a@1.0.0, key, cache: miss}` and one process; the rerun is `cache: hit` with the same key and output and
  no process.
- **AC3** (`tools.test.ts`): `upper-b@1.0.0` (plugin `test/upper-more`) is listed beside `upper-a@1.0.0` (plugin
  `test/upper-kind`) and runs "abc" to "ABC"; the planted `test/upper-lowlast` install is refused naming at least one
  of `fx-greeting`, `fx-sentence`, `fx-route` (the planted tool fails all three), no kind lists `upper-lowlast@...`, and
  a run naming it is refused with no process.
- **AC4** (`holder.test.ts`): `test/upper-rival`'s install is refused, its words naming `test.upper` as a whole name
  and `test/upper-kind`, which still holds it; `test/upper-heir` (replaces) installs and holds it. In a new world,
  `upper-a@1.0.0` on "ABC" with `{"case":"lower"}`, twice: not done, names `test.upper_only`, no output and no
  SHA-256("abc") in the reply, the first starting at least one process; the store has no SHA-256("abc"); the same input
  with `{"case":"upper"}` is done with "ABC".
- **AC5** (`key.test.ts`, `judgeKey`): with `upper-b@1.0.0` and input `in.txt` = "abc", the base run with
  `{"case":"upper","trim":false}` (miss, one process); then, each must be a hit with the base's key, "ABC" and no
  process: `{"trim":false,"case":"upper"}`; `{"case":"upper"}`; the same bytes rewritten with the modified time an
  hour on; the file renamed `renamed.txt`; the project folder renamed `proj-moved` (deep mcp restarted there, the path
  absolute in the new place). Then each must be a miss with another key and one process: the file holding "abd"
  ("ABD"); `{"case":"upper","trim":true}` on "abc"; test/upper-more 1.0.1's `upper-b@1.0.1`. Each failure starts with
  its case's words and names the key's part.
- **AC6** (`rebuild.test.ts`, `judgeRebuild`): as the criterion; the refusal must name `upper-b` and both builds; after
  it, `upper-b@1.0.0` on "abc" is a hit with no process; test/upper-more 1.0.1 (the changed files) installs, is listed
  as `upper-b@1.0.1` with the changed build, misses "abc" once (one process, that build in its receipt) and then hits.
- **AC7** (`build.test.ts`, `judgeBuild`): the receipt's `build` is `packageDigest(<plug-in>/tool)`; the same plug-in
  copied to `/tmp/dh1922-*/elsewhere/deeper/two` with every modified time set to 2001 installs (exit 0), deep_job lists
  `upper-b@1.0.0` with that one build, and the next receipt names it.

## Known limits

- "After one approval" is read as the install's one confirmation (the stubbed OS) and no ask raised; a hub that asks a
  second time after qualification fails AC2.
- The params' float rule (−0 stored as +0) and the target triple are in Scope but no criterion; neither is read. A tool
  that runs off the machine (#1924) isn't read.
- "Changes no document" reads the record and the project folder; no canvas document is opened (the canvas core isn't
  needed for any criterion), so a job writing a document some other way than `doc.patched` isn't seen.
- "Never a verdict" and "runs as a runner job" are read only through the process the record shows outside the hub.
- Process counts are a window on the whole record: a process the hub starts for some other reason inside that window
  counts too. No such start was seen at the base around an idle `deep_job` call.

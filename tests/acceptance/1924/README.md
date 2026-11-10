# Acceptance tests for #1924: job tools off the machine

Written first, blind, by a job that never saw an implementation of #1924; none exists at the base (`d51be2c3`). The
implementing agent doesn't edit these files (AGENTS.md, Proof); a dispute goes to a blind redraft of this job (design:
Dogfooding).

## What was read

- Issue #1924 (`gh issue view 1924`): Scope, the two criteria, Proof ("The hosted tool's one ask"). The IDs are
  computed from its checkbox text.
- `docs/technical-design.md`: Privacy (files leave the machine "only by hash from the evidence store, never by path";
  origin from the writer's connection: made by DeepBuild, chosen by you, or put there by an agent; an agent's file
  "leaves only after an ask that names its hash and where it goes, asked once for that pair"; "Each receipt lists every
  file that went out, by hash and destination"); the extension API list (`deep.registerJobTool(kind, tool)` "a tool
  for a registered kind, a hosted model among them", `deep.fetch` "only to a host its grant names"); Building blocks
  (the Job row; Runner: an image model's call "over https or plain http on loopback only"); Evidence (`origin`, "It
  can never: ... leave when an agent put it there, unless you approved its hash for that destination"). `AGENTS.md`.
- `docs/canvas-primitives.md`, Generation job: `provider` "a hosted model reached through a source, or an open model on
  a host", `endpoint`, `runtime: {where: service | host, host}`, and "An open model's tool declares its weight files by
  hash, checked on the host before each call and entered in the key; ... a tool that runs off the machine takes files
  only by hash from the evidence store, one an agent put there after one ask naming its hash and host".
- At the base, for surfaces and conventions only: `packages/hub/src/jobs.ts` (deep_job's run, its replies `done`,
  `held` with `ask`, `refused`, the receipt), `src/tools.ts` (deep_job's strict schema, a field left out reading null),
  `src/core.ts` (`deep_job` binds no session; `deep_evidence` stores a file of the session's folder with origin agent;
  `evidence.read`; the extension host's options), `src/server.ts` (an `mcp` hello binds the session of its parent
  process), `src/plant.ts` (`DEEP_HUB_PLANT`); `packages/extension-host/src/job-kinds.ts` (`kindOf`, `toolOf`,
  `buildOf`) and `host.ts` (`jobs`, `jobsAt`'s qualification at install, `runTool`, the grant's `hosts` and
  `deep.fetch`); `packages/contracts/src/manifest.ts` (`checkJobs`); `packages/evidence/src/index.ts` (the `Peer` a
  writer connects as, `send`'s reasons and its approval per hash and destination); `scripts/proof-change.mjs`
  (`criterionId`). The suites `1922` (the template: layout, README, helpers, fixtures, BASE-FAILURE) and `26` (the
  agent stand-in, `fixtures/agent.mjs`, copied here, and its hooks).

## Criteria and files

Each `describe` title is the criterion's ID and its text. The ID is `#1924.` and the first 8 hex digits of SHA-256 of
the checkbox's text after `- [ ] `, trimmed, white space collapsed (`scripts/proof-change.mjs`'s `criterionId`).

| AC | ID | File | Tests |
|---|---|---|---|
| AC1 | `#1924.a5540bf8` | `hosted.test.ts` | the clean hub (`judgeHosted`); planted hubs `job-host-asks-again`, `job-host-sends-early` |
| AC2 | `#1924.05593ee1` | `weights.test.ts` | the clean hub (`judgeWeights`); planted runners `job-weights-call-anyway`, `job-weights-not-keyed` |

## Run them

macOS, the repo's Node (24.22.0) first on `PATH`:

```sh
export PATH="$HOME/.local/share/fnm/node-versions/v24.22.0/installation/bin:$PATH"
npm ci                                           # once
npm run build --workspaces                       # the tests run packages/cli/dist/main.js
CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 cargo build --locked -p deep-hook    # the hub won't start without it
NO_COLOR=1 npx vitest run tests/acceptance/1924 --testTimeout=600000 --no-file-parallelism
node node_modules/typescript/bin/tsc -p tests/acceptance/1924/tsconfig.json
```

- **One at a time:** every test starts its own hub, which starts sandboxed plug-ins through the supervisor, so the
  implementer adds `tests/acceptance/1924/` to `alone` in `scripts/lanes.mjs` (not done here: this job writes tests
  only). The supervisor's sandbox needs a shell that may start it (in Claude Code, the Bash tool with its sandbox off).
- **Needs:** `ps`, `git` (the agent's working folder is a repo of its own).
- **Safety:** every folder is under `/tmp/dh1924-*`, removed after its file; every hub, `deep` command, agent stand-in
  and `deep mcp` runs with `HOME` in its world's temp folder and without the caller's `DEEP_*`, `CLAUDE*`, `CODEX*`,
  `NODE_OPTIONS`; every process this suite starts is stopped by its PID; nothing is stopped by name or port. Nothing
  leaves 127.0.0.1: the test hosts are HTTP servers this test process serves on 127.0.0.1, closed after the file. No
  model is called and no weights exist: the test host reports weight hashes it is told to.
- **The proof** (the issue's Proof line, the hosted tool's one ask, is `seen.held` in `ac1-hosted-clean.json`) is
  written to `$TMPDIR/deep-1924-proof/`, rewritten each run: each judge's failures and what it saw, each host's
  requests, for the clean hub and each planted one.

## The world (`helpers.ts`)

One world per test: a temp home whose evidence store already holds **a render DeepBuild made**; **an agent's working
folder**, a git repo of its own holding `.deepbuild/done.yaml`, `notes.txt` (the file the agent attaches) and
`draft.txt` (named by path, never attached); **the agent stand-in** (`fixtures/agent.mjs`, copied from #26's suite)
started in that folder, its Claude Code session established through its hooks (SessionStart, UserPromptSubmit,
PreToolUse), whose own `deep mcp` (its child, so bound to its session) makes every `deep_evidence` and `deep_job` call;
**a real hub** (`deep hub run`) with `DEEP_HUB_TEST_CONFIRM` (the OS confirming you, stubbed, as #1922's suite does)
and, for a planted hub, `DEEP_HUB_PLANT`; and **the hub's socket as the cli role** for `events.read` and
`evidence.read`. Plug-ins are installed with `deep install <folder>` as you, and your yes is `deep inbox answer`.

**The test plug-ins** (each folder copied per use, its `*.fixture` files renamed, `probe.json` written, its manifest's
digest set by the extension host's `packageDigest`):

| Plug-in | Fixture | Registers |
|---|---|---|
| `test/hosted-kind@1.0.0` | `fixtures/kind` | the kind `test.hosted`, no tool |
| `test/hosted-a@1.0.0` | `fixtures/tool` | `hosted-a@1.0.0`, on test host A |
| `test/hosted-b@1.0.0` | `fixtures/tool` | `hosted-b@1.0.0`, on test host B |
| `test/open-model@1.0.0` | `fixtures/tool` | `open-a@1.0.0` on test host O, declaring `model.safetensors` and `tokenizer.json` by hash, needing `fp16` |
| `test/open-model@1.0.1` | `fixtures/tool` | `open-a@1.0.0` again, `model.safetensors` under a new hash |

## The test host

`startHost()` serves HTTP on `127.0.0.1:<a free port>` from this test process and records every request it gets
(method, path, body bytes), so "sends nothing" and "before the call" are read from that record. It answers:

- `POST /run` with `{params, inputs: {text: "<the input's bytes, base64>"}}`: `{outputs: {text: "<base64>"}}`, the text
  written in the params' case (trimmed first for `trim: true`), as #1922's test.upper tool writes it.
- `GET /report`: `{weights: [{name, sha256}], capabilities: [string]}`, what the test sets for that moment.
- Anything else: 404.

A request **carries** a file when its body holds the file's bytes raw, in base64 (either alphabet) or in hex.

## The surface under test (readings where the issue leaves a choice)

The issue and the design name `deep.registerJobTool`, `deep_job`, the evidence store and its origin rule, the ask
naming a file's hash and the tool's host, the receipt listing every file sent by hash and host, weight files declared by
hash, the capabilities a call needs, the host's report before each call, BLOCKED with an unblock ask, and the job key.
Where they leave a name or shape open, this job picked the smallest surface the design and the base code imply; each
choice is listed here so the implementer builds to it.

1. **The kind.** `test.hosted` is registered as #1922's kinds are (`deep.registerJob`, all data): params `{case: enum
   [upper, lower], trim: boolean, default false}`, `case` required; one input `text` and one output `text`; `key:
   ['tool', 'params', 'inputs']`; `output_checks: []`; one qualification fixture `fx-greeting` ("hello" to "HELLO",
   `{case: "upper"}`). Nothing in it says its tools run off the machine: that is each tool's.
2. **How a tool says it runs on a host.** Its `deep.registerJobTool` descriptor gives `run: {url:
   "http://127.0.0.1:<port>/run"}` in place of #1922's `run: {dir, entry}`, and its manifest's `job_tools` entry names
   that host: `{kind: "test.hosted", tool: "hosted-a@1.0.0", host: "127.0.0.1:<port>"}` (what a piece reaches is in
   its manifest, as a library source's one `host` is; plain http, as the design allows on loopback). The hub makes the
   call, as `deep.fetch` and an image model's call are made, never the plug-in's code.
3. **The call.** One `POST` to `run.url` per call, its body the JSON object `{params: <the canonical params>, inputs:
   {text: "<the input's bytes, base64>"}}` (#1922's tool's stdin, sent over HTTP), answered with `{outputs: {text:
   "<base64>"}}`; the output is stored by hash and named in the reply as #1922's are. A hosted tool still qualifies at
   install on the kind's fixtures through the same call, so the test host gets the fixture before any job; no window
   this suite reads includes an install's qualification.
4. **`deep_job` names an input by hash:** `inputs: [{name: "text", sha256: "<64 hex>"}]`, the file the evidence store
   holds under that hash (the strict schema's item gains a nullable `sha256`; a field left out reads null, as in
   #1922). An input naming `path` to a tool that runs off the machine is refused before any file is read, read here as:
   a path to a file in the agent's folder (`draft.txt`) and a path to no file get the same answer once each path is
   written `<path>` (both `isError` or both `status: refused`), the answer holds no hash of the file, the store gains no
   entry for it, no host gets a request and no ask is raised.
5. **The ask for an agent's file.** A run whose input the store holds with origin `agent` is held (`{status: "held",
   ask: "ask:<id>"}`, the reply #1922's paid call gives), and called again until your answer it stays held on the same
   ask: one ask per job, of any kind, whose data's JSON holds the file's 64-hex SHA-256 and the host as `127.0.0.1:<port>`,
   with an option whose `decision` is `allow`; your yes is `deep inbox answer <ask> <that option>`. After it, the call
   again until not held is done. The approval is per pair, file hash and host: another job of the same pair (other
   params, so not a cache hit) runs with no ask; the same file to another tool's host is held on a new ask. "Sends
   nothing before your answer" is read as: neither host gets any request from the first call until your yes.
6. **A render DeepBuild made.** The base has no renderer that writes to the store, so the world puts one there before
   the hub starts, through `@deepbuild/evidence`'s public entry, as a writer connected as `{role: "deepbuild", via:
   "render"}`: origin `deepbuild` from the connection (#15), kind `render`, redaction `complete`, and a license that
   allows every way out (`export`, `report`, `post`, and `job`, the via this suite reads a hosted job's send as), so
   neither the redaction nor the license rule asks. It goes to host B, which has no answer from you, with no ask.
7. **The receipt** of every done run lists what it sent: `receipt.sent: [{sha256, host}]`, exactly the files that went
   (here, the one input) with the host as `127.0.0.1:<port>` (a scheme or path around it is ignored).
8. **The open model's declaration.** The descriptor adds `weights: [{name: "model.safetensors", sha256}, {name:
   "tokenizer.json", sha256}]` and `needs: ["fp16"]`, the capabilities its call needs.
9. **What the host reports, and how.** Before each call the hub reads `GET <the tool's host>/report`, answered
   `{weights: [{name, sha256}], capabilities: [string]}`. A declared file the report lists under another hash (or not
   at all), or a needed capability it doesn't list, makes the run BLOCKED with nothing sent: the reply's `status` is
   `blocked` (any case), no `POST /run` reaches the host, and the record gains an ask of kind `unblock` whose data's
   JSON names the file (`model.safetensors`) or the capability (`fp16`). Each run is judged on the report read before
   it: the capability case runs after the file is restored, under params no run used yet.
10. **The key holds the weight hashes**, read two ways: a done run's receipt names both declared hashes, and
    `test/open-model@1.0.1`, declaring the same `open-a@1.0.0` with a new hash for `model.safetensors` (the host
    reporting it), installs and makes the first run's job (same input and params) a miss that calls the host once, its
    receipt naming the new hash. The weights are the key's, not the tool's build: a hosted tool's new declaration under
    the same version must install, which #1922's same-version build rule must not refuse.

## Plants

The planted hubs are the implementer's, selected with `DEEP_HUB_PLANT` as `src/plant.ts` selects every other; at the
base each name is refused ("names no planted program"), so those tests fail there, at the hub's start.

| Plant | Criterion | The wrong program | Read as failed when |
|---|---|---|---|
| `job-host-asks-again` | AC1 | the approval of an agent's file for a host isn't kept for that pair | the judge fails "a second job with the same file and host", naming `hosted-a@1.0.0` and the file's hash |
| `job-host-sends-early` | AC1 | the agent's file goes to the host before your answer | the judge fails "nothing sent before your answer", naming `hosted-a@1.0.0` and the file's hash, holding the agent's file |
| `job-weights-call-anyway` | AC2 | the runner calls the host whatever the report says | the judge fails "a weight file swapped" and "the capability missing", each saying it called anyway, naming `open-a@1.0.0` and the render's hash |
| `job-weights-not-keyed` | AC2 | the key leaves out the weight hashes | the judge fails "a new hash under the same version" (served from the earlier run), naming `open-a@1.0.0` and the render's hash |

"Naming the job" is read as the failure holding the tool's name@version and the input's hash; each judge writes the
job as `the job test.hosted <tool> <params> on <input hash>`.

## How each criterion is read

- **AC1** (`hosted.test.ts`, `judgeHosted`): in order, (1) hosted-a on the agent's `notes.txt` by hash, twice before
  your answer: both held, one ask in the record naming the hash and host A, no request to host A or B; (2) your yes,
  then the call again until not held: done with the notes in upper case by hash, host A got the file once, the receipt
  lists `{notes, host A}`, no further ask; (3) hosted-a on the notes with `{case: lower}`: no ask, done, host A got it
  once, the receipt lists it; (4) hosted-b on the notes: held on one new ask naming the hash and host B, no request to
  host B; (5) hosted-b on the render: no ask, done, host B got it once, the receipt lists `{render, host B}`; (6)
  hosted-a with an input naming the path of `draft.txt`, and then of a missing file, as choice 4 reads it.
- **AC2** (`weights.test.ts`, `judgeWeights`): open-a on the render by hash, (1) with host O reporting both hashes and
  `fp16`, `{case: upper}`: done, one call carrying the render, the receipt naming both hashes; (2) host O reporting a
  new hash for `model.safetensors`, `{case: lower}`: BLOCKED, an unblock ask naming `model.safetensors`, no call; (3)
  host O reporting both hashes and no capability, `{case: upper, trim: true}`: BLOCKED, an unblock ask naming `fp16`,
  no call; (4) host O reporting the new hash and `fp16`, test/open-model 1.0.1 installed, `{case: upper}` again: done,
  one call (a miss of step 1's cache), the receipt naming the new hash.

## Known limits

- "Before any file is read" is read from what can be seen outside the hub (one answer for a file and for nothing, no
  hash, nothing stored or sent); a hub that reads the file and then answers exactly as for a missing path isn't seen.
- The ask's kind for an agent's file isn't read; only that it is one ask, naming the hash and the host, with a yes.
- A cache hit's receipt (nothing sent) isn't read: no AC1 run here is a hit.
- The open model's report is read only through its effects: a run that is BLOCKED, or not, before the call.
- The render is seeded into the store before the hub starts (choice 6), not made by a renderer.

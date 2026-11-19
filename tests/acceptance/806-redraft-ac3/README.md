# Blind redraft of #806 AC3: a deep_show call from a `deep mcp` bound to no session is refused, draws nothing, and the record gains no revision

Written blind, from issue #806 (`gh issue view 806`: its title, Scope, the Writer layer and Render-back lines, and this one
criterion), the design sections it links, and the base commit, by a job that never saw the work, its diff or the dispute
(design: Dogfooding). The implementing agent doesn't edit these files (AGENTS.md, Proof).

**Base commit.** The brief named `c21400b43` ("Merge pull request #2828 …"). This worktree's HEAD is `c26bdb5be` ("Merge
pull request #2786 …"), a descendant of it. The commits between are #1512's review rules (the hub's review path and the
app's rules page), #1928's face checks (in the deep-show crate's checks and the 3D scene), #1411's compile pool and #1041's
web player (the deep-show crate's export); by their file names and the two diffs seen (What was read), none is deep_show's
binding, the `deep mcp` path or the app's canvas panel. Everything here was read and run at `c26bdb5be`.

## What was read

- `docs/technical-design.md`: the deep hub, DeepBuild app and `deep mcp` rows of One hub per user; the MCP tools row of the
  interfaces table under Extension API (`deep_show` "draws any canvas document … on the agent's own claim or ask"; "Errors
  share one shape"); Socket roles, One role per credential ("The hub binds the process to the session whose hooks came from its
  parent process … A call that binds to no session reads only what belongs to no session … and never claims, asks, draws or
  attaches evidence"); Dogfooding; Tests written first.
- `docs/canvas-primitives.md`: Writer layer, Document session, Admission and latch (`deep_show → presented | refused |
  not_presented(hidden | timeout)` within 2 s), Render-back.
- At the base, for the surfaces and the harness only: `tests/acceptance/806/README.md`, `helpers.ts`, `figure.ts`;
  `tests/acceptance/26/README.md`, `helpers.ts`, `binding.test.ts`; `tests/acceptance/393/README.md` (the reply, and its
  reading of an unbound call) and the parts of `393/helpers.ts` #806's world uses (`DOC`, `PANELS`, `board`, `buildBinary`);
  `packages/evidence/src/index.ts`'s store interface and object layout; the root `tsconfig.json`; `scripts/lanes.mjs`'s
  `alone` list; `scripts/throttle.mjs`'s usage.
- Not read: the rest of `tests/acceptance/806/` (its first AC3 draft `unbound.test.ts`, `REDRAFT.md`, `PROOF.md`,
  `PROOF-RUN.txt`, `BASE-FAILURE.txt` and its other tests), the hub's plant list, and any hub, `deep mcp`, CLI or app
  source. Seen in passing:
  #806's README, read as the brief asked, describes the first AC3 draft in one table row and one reading ("Unbound calls are
  replies"); to compare the brief's base with HEAD, the `c21400b43..c26bdb5be` diff of `packages/hub/src/core.ts` (#1512's
  review rules) and `crates/deep-show/src/logic.rs` (#1928's face check); and the `deep-replica-canvas` bin entry in
  `crates/deep-replica/Cargo.toml`, to know what to build.

## Run it

```sh
npm ci --ignore-scripts && npm run build --workspaces   # the test runs the built CLI: deep hub run, deep mcp
export CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0
cargo build --locked -q -p deep-show -p deep-hook       # the brief's setup
cargo build --locked -q --bin deep-replica-canvas       # the app's replica; the file builds it again in beforeAll (#806's useApp)
node node_modules/typescript/bin/tsc -p tests/acceptance/806-redraft-ac3/tsconfig.json
npx vitest run --root tests/acceptance/806-redraft-ac3 --no-file-parallelism --testTimeout=600000
rm -rf tests/acceptance/806-redraft-ac3/node_modules   # Vitest's cache from --root
```

Run Vitest with the same `CARGO_*` settings as the builds, or the file's own `cargo build` starts over. macOS only: the app's
replica draws with GPUI's offscreen Metal renderer, and off macOS the test fails `INCONCLUSIVE:` (#806's `App.start`). Its
homes are under `/tmp/dh806-*`, every process runs with `HOME` there, nothing touches the real `~/.deepbuild`, `~/.claude` or
`~/.codex`, and it stops only the processes it started, by PID (#806's `cleanup`). No network.

**Lane.** It belongs in `scripts/lanes.mjs`'s one-at-a-time `alone` list, as `tests/acceptance/806/` is: it starts a real
hub, two agent stand-ins with their `deep mcp`, a third `deep mcp` and the app's replica, and waits out 2 s windows. This
job didn't edit `lanes.mjs`.

## The surface under test

Only what the issue and the design name, reached through #806's and #26's harness, imported rather than copied:

- **`deep_show` through `deep mcp`**, called as an MCP client calls it (#26's `listTools`, `callTool`; #806's `showArgs`,
  `showSchema`): from a `deep mcp` this test process started (#806's `hand`, #26's `McpProcess`), and from the Claude Code
  stand-in's own `deep mcp`.
- **The hub's record**: every event, through `events.read` on a `cli` connection (#26's `events`).
- **The evidence store**: its objects by hash, `<home>/.deepbuild/evidence/<2 hex>/<62 hex>` (the store's layout in
  `packages/evidence`, whose public entry has no listing); each new object is read back through `openEvidenceStore` (#806's
  `readEvidence`) to tell a drawing or the figure from anything else (Ambiguities: "Draws nothing").
- **The app**: #806's headless replica of the canvas panel (`deep-replica-canvas`), connected to the hub as the app is; its
  `sync` and its `drawn.jsonl`, one line for each revision it drew (#806's `App`).
- **The world**: #806's `openFigures({ app: true })`, its six-item figure (`FIGURE`) and `SHOW` (`t: "0s"`, 320 × 200,
  `include: ["issues", "pixels"]`), on the world file's minted document `DOC.a`.

## What the test does

One test, `AC3 …`, with the criterion quoted above it. First, the `deep mcp` started by hand lists `deep_show`. Then:

1. From it, deep_show of the figure on a document no one has drawn: refused, with no snapshot. After 2 s and the app's
   `sync`: no revision new to the record, no drawing or figure new to the evidence store, no revision new to the app's drawn
   list.
2. The twin: the Claude Code session files a claim and makes the same call from its own `deep mcp`. It is presented at
   revision 1, so step 1 minted no revision of that document; the record now names the document at revision 1, the store
   holds the reply's snapshot, and the app drew the figure's six items; and the refusal reading rejects this outcome. So each
   reading sees a draw when there is one, and its silence in steps 1 and 3 means something.
3. From the `deep mcp` started by hand again, deep_show on that same document, the figure retitled: refused, and nothing new
   in the record, the store or the app.

## Ambiguities, and the reading taken

- **"Refused."** The issue says the reply is #393's, unchanged (`presented | refused | not_presented`), and #393's suite
  answers an unbound call with `outcome: "refused"` and a code of its own, `no_session`; #26 reads a tool's refusal, an
  unbound `deep_claim` included, as a tool result with `isError` holding error@2 ("Errors share one shape"). The criterion
  names neither the form nor a code, so either counts: a value whose `outcome` is `refused`, or, with no `outcome`, a tool
  result with `isError`. Never a JSON-RPC error, and never #26's `unavailable`, since a hub that can't be reached isn't a hub
  refusing. No code is read.
- **"Bound to no session"** is made, not asked: a `deep mcp` this test process started, so no session's hooks came from its
  parent (One role per credential), in the worktree where a Claude Code and a Codex session run, so a hub that binds by
  folder or to the latest session has one to pick. When it calls, no unspent PreToolUse names deep_show, so no per-call stamp
  can bind it either: the sessions' only PreToolUse is a `Bash` call, and the Claude Code twin binds by its process and
  stamps nothing.
- **It lists `deep_show`.** A `deep mcp`'s tool list can't hang on its binding, since one process may serve several sessions
  and bind each call; so the process lists deep_show, and a refusal can't be only an unknown tool.
- **"Draws nothing"**: no snapshot in the reply; no new line in the app's drawn list (the app is open, since only then can a
  draw in it be seen); and no drawing or figure new to the evidence store: no PNG (render-back's snapshots are PNGs kept there
  by hash, so a render that isn't returned still shows), and no object whose text names the call's document, the figure's
  title or its `bar-*` items (a stored revision or issue list of it). Other new objects don't count. The base showed why: the
  hub stores 13 of the canvas core's own programs (wasm modules, `logic@1` recipes, weights) on its first deep_show, bound or
  not, with no event in the record (Base result). They are neither a drawing nor a revision, and "never … attaches evidence"
  is about a session's evidence, which a call bound to none has none of. A draft that counted every new object failed on them.
- **"The record gains no revision"**: the set of revisions the record holds doesn't grow. A revision in the record is read as
  an event whose data holds a revision number (a key `rev` holding a number, at any depth: #393's and Render-back's name),
  keyed by the world document the event names, or `?` when it names none, so a revision minted on any document counts. The
  event's kind isn't read, and a revision the record already held, named again, is not a new one. The twin's reply at
  revision 1 says the same from the document's side.
- **When to look**: 2 s after each call (deep_show answers within 2 s: Admission and latch), then the app's `sync`, then the
  record, the store and the app's list.
- **Two unbound calls**: one on a fresh document and one on a document a session holds, its figure retitled, so a hub that
  takes the writer from the document's holder instead of the connection presents it as revision 2 and fails.
- **The twin's claim**: the session files one first (`deep_claim`), since deep_show draws on the agent's own claim (the MCP
  tools row). The claim isn't tied to the document; the world file minted it.

## Wrong programs it fails on

Not run: #806's README names planted hubs for AC2 and AC4 only (the plant list itself wasn't read), and this job writes no
code outside its folder.

- A hub that binds a parentless `deep mcp` to a session, by folder or to the latest one: step 1's call is presented, with a
  snapshot, and recorded.
- One that takes the writer from the document's holder: step 3 is presented as revision 2.
- One that draws or renders before it refuses: a PNG or the figure in the store, or a line in the app's drawn list, in step 1
  or 3.
- One that records the refused revision: a revision new to the record.
- One with no `deep_show`, or none for a process bound to no session: the tool list.

What does run is step 2: the same readings, applied to a bound call's draw, each see it, and the refusal reading rejects its
presented outcome. A hub that did for the process started by hand what it does for a bound one would leave exactly that.

## Base result

**PASS** at `c26bdb5be` (`BASE-RESULT.txt`): one test, 48 s. #806's work has landed at this commit (the issue is closed), so
the base is not a program without the work; it shows the test passes on the work as it stands, not that it fails on a wrong
one.

Before it, one run of an earlier draft at the same commit failed. That draft counted every object new to the evidence store,
and step 1's call, though refused with the record and the app quiet, was followed by 13 new objects. Two runs of a probe (a
temporary file here, deleted) then showed the store empty through 30 s of an idle world, the 13 objects only after a deep_show from the
process started by hand (answered `{"outcome": "refused", "code": "no_session", …}`) with no new event, and the same 13 among
a bound first call's 17 objects in a fresh world. So they're the canvas core's own programs, stored on its first deep_show
whether it binds or not, and the reading was narrowed to drawings and the figure (Ambiguities: "Draws nothing"). Whether a
call bound to no session should reach the canvas core at all is outside this criterion; it is noted here, not tested.

The builds and both runs went directly under `nice -n 10`: the throttle granted nothing for over ten minutes while a timed
request held its queue.

## Files

- `ac3-unbound.test.ts`: the test.
- `tsconfig.json`: as `tests/acceptance/806/`'s: the root's strict options, `allowImportingTsExtensions`, `noEmit`.
- `BASE-RESULT.txt`: the run at the base, trimmed, with the earlier draft's failing run and the probe's readings.

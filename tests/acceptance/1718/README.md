# Acceptance tests for #1718: deep_kinds through deep mcp refuses every op with unlisted_field at /at, a field the agent never sent

Written first, blind, from issue #1718 (read live with `gh issue view 1718`: its text, Scope, three acceptance criteria, Proof and
Depends on), the design sections it links and base commit `f1e8736e` (`origin/main`, "Merge pull request #1742 …"), by a job that
never saw an implementation; none existed. The implementing agent doesn't edit these files (AGENTS.md, Proof); a dispute goes to a
blind redraft of this job (design: Dogfooding).

## What was read

- `docs/technical-design.md`: the MCP tools row of "Five ways in, all onto the same core" (the `deep_kinds` paragraph, "That corpus,
  not memory or a newer release's docs, is the authority for what this core can do"; "Errors share one shape … the value it refused at
  the path it names"), Dogfooding and "Who drafts it". `docs/canvas-primitives.md`: Canvas module.
- The sibling suites, in full: `tests/acceptance/412/` (deep_kinds against `deep-show run`: its README's op table and refusal rule,
  helpers, BASE-FAILURE), `tests/acceptance/806/` (deep_show through the hub and `deep mcp`: temp HOME, sessions bound by their hooks,
  `/tmp/dh806-*` socket paths, cleanup by PID, `DEEP_HUB_PLANT`), `tests/acceptance/26/` (`deep mcp`, the agent stand-in
  `fixtures/agent.mjs`, `startHub`, `callTool`, `errorOf`), and `tests/acceptance/41/bundled/` for the installed tree.
- At the base: `crates/deep-show/src/main.rs` (`CanvasSide::scenario`, which stamps `at` on every call but `deep_query`, `geometry`
  and `fn`, and `CanvasSide::line`), `crates/deep-show/src/kinds.rs` (`kinds_reply`, the per-op field list and its `unlisted_field`
  refusal), `packages/hub/src/core.ts` (`mcpCall`: deep_kinds needs no session; `kinds`: the call sent to the canvas core with the
  null fields dropped, a refusal rethrown at `/params/arguments` + the core's path), `packages/hub/src/canvas.ts` (`canvasCore`: the
  `deep-show` shipped beside the hub's code, else the newer of the checkout's `target/release` and `target/debug` build; `Canvas`:
  one `{"world": …}` line when the world changes, then one `{"call": …}` line per call), `packages/hub/src/tools.ts` (the deep_kinds
  schema: `op` and the nullable `registry`, `cursor`, `word`, `query`, `example`, `guide`, `offset`; `checkArguments`),
  `packages/hub/src/plant.ts`, `scripts/install-prefix.mjs` (#41's installed tree).

## What the base has

Through the hub every deep_kinds op is refused: the hub sends `{"call": {"call": "deep_kinds", "op": …}}` to `deep-show canvas`,
`CanvasSide::scenario` adds `at`, and `kinds_reply` answers `unlisted_field` at `/at` ("Leave out at: gallery takes only cursor."),
which the hub returns as the tool's error at `/params/arguments/at`. `deep-show run` answers the same calls (it doesn't stamp them).
`deep_kinds` refuses a field its op doesn't take (#412), and the hub's own schema check lets `cursor` through on any op; at the base
`cursor` on `word` is already refused at `/params/arguments/cursor` (the agent's fields come before the stamped `at`), so criterion 2's
test passes on the base and guards that the fix keeps it. The hub has no seam to swap its canvas core: it runs the `deep-show` shipped
beside its code, else the checkout's build. `BASE-FAILURE.txt` is the run at the base: AC1's six tests and AC3's fail, AC2's passes.

## Run them

```sh
npm ci && npm run build --workspaces     # the tests run the built CLI: deep hub run, deep mcp; install-prefix copies dist/
node node_modules/vitest/vitest.mjs run --root tests/acceptance/1718 --no-file-parallelism
node node_modules/typescript/bin/tsc -p tests/acceptance/1718/tsconfig.json
```

Node 24, `git` and `cargo` on the `PATH`. Each file builds the canvas core and deep-hook once (`cargo build --locked --bin
deep-show`, then `--bin deep-hook`, in separate runs so neither changes the other's features), in the checkout's `target/` with
`CARGO_TARGET_DIR` dropped, since that is where the checkout's hub looks for both; the hub refuses to start without a deep-hook.
`planted.test.ts` also lays out #41's installed tree (`node scripts/install-prefix.mjs --prefix /tmp/dh1718-p-*`), which copies the
built workspaces and their third-party packages, deleted after the file. The tree's deep-hook would be npm's optional package
`@deepbuild/deep-hook-<platform>-<arch>`, which the checkout's `node_modules` doesn't hold, so the test copies the checkout's build to
`<tree>/target/debug/deep-hook`, where the tree's hub looks next (`packages/hub/src/paths.ts`, `deepHook`). A cold build of
`deep-show` took about 20 minutes on the reference run; warm, the suite runs in under 3 minutes.

`scripts/lanes.mjs` needs `'tests/acceptance/1718/'` in its `alone` list: the files build cargo, start hubs and lay out an installed
tree, as #26's, #412's and #806's folders do. This README is the instruction; the implementer makes that edit.

Every process runs with `HOME` a temporary folder under `/tmp/dh1718-*` (a socket path must fit in 104 bytes), so the hub's root is
`<home>/.deepbuild` and the real `~/.deepbuild`, `~/.claude` and `~/.codex` are never touched. Each test stops only processes it
started, by PID (`helpers.ts`, `cleanup`; the hub's canvas core ends with the hub, its stdin closed). No test uses the network.

## The surface under test

Only what the issue names: **`deep hub run`** in a temporary HOME; **a Claude Code session bound by its hooks**, #26's agent
stand-in sending SessionStart, UserPromptSubmit and PreToolUse from hook processes it starts, the hub's record holding its
`session.start`; **`deep mcp` started as that agent's child** (#26's `op: mcp`), with `initialize` and `tools/call deep_kinds`;
**`deep-show run`** for the reference replies, one scenario holding the one call (`{"evidence", "calls": [{"call": "deep_kinds", …}]}`),
run with the same binary the hub runs as its canvas core (`helpers.ts`, `checkoutCore`, the hub's own rule). The tool's arguments are
the issue's: `{op: "sheet"}`, `{op: "list"}`, `{op: "search", query: "box"}`, `{op: "word", word: "BoxGeometry"}`, `{op: "gallery"}`,
`{op: "read", example: <hash>}`, every other field left out (null, #26); the reply is the tool result's `structuredContent`, else its
first text block's JSON (#26's `outcomeOf`). No name in this suite is invented for the implementation to build.

## Criteria to tests

| Criterion | Tests |
|---|---|
| AC1 | `hub.test.ts` (6), one per op in the issue's order: through the checkout's hub and the bound session's `deep mcp`, deep_kinds answers without isError, and its value equals, field for field apart from `core` and `set_digest`, `deep-show run`'s reply to the same call. Every failure starts `deep_kinds <op>:` (`kindsFailures`); on the base each is `answered isError: unlisted_field at /params/arguments/at: …` |
| AC2 | `hub.test.ts` (1): `{op: "word", word: "BoxGeometry", cursor: "abc"}` is a tool error, error@2, code `unlisted_field` at `/params/arguments/cursor` |
| AC3 | `planted.test.ts` (1): the installed tree with its canvas core replaced by the planted one fails criterion 1's check for every op, a failure naming the op and `/params/arguments/at`, the plant's log holding a stamped deep_kinds call of that op; the same tree with its own canvas core passes the check for every op |

## Readings where the issue leaves a choice

- **The planted `deep-show canvas`.** The base offers no seam that swaps the hub's canvas core (no plant name, no variable; the hub
  runs the `deep-show` shipped beside its code or the checkout's build), and a test feature in `deep-show` would be a name this suite
  invents. So the plant is the test's own wrapper around the real binary (`fixtures/stamps-at.mjs`): it runs the real `deep-show` with
  the same arguments and, on `canvas`, puts `at` on every call line the hub sends but `deep_query`, `geometry` and `fn`, with the merge
  base's value (the call's index from 1 times ten frames at 120 Hz, in flicks), logging each stamp. It reaches the hub through the one
  place the hub reads a canvas core from outside the checkout's `target/`: #41's installed tree, `<tree>/packages/hub/dist/deep-show`
  (`scripts/install-prefix.mjs`), renamed `deep-show.real` and replaced by a shell script that execs the wrapper. Whatever the fix, a
  `deep-show` whose canvas side stamps `at` onto the call again is this program, and the issue says it must fail criterion 1.
- **"Fails the first criterion"** is read as criterion 1's check failing on the plant for every op, naming it, beside the same check
  passing on the same installed tree with its own canvas core. Without that second half the plant's failure would show nothing on the
  base, where the real core fails the same way; with it, criterion 3 fails on the base, since the unplanted core fails too.
- **`deep mcp` in criterion 3** is the checkout's, started by the agent stand-in as in criterion 1; the installed tree's hub is the
  one under test, and the plant lives only in its canvas core.
- **"The gallery's first hash"** is `examples[0].hash` of `deep-show run`'s gallery reply, so `read` is called with a real hash on the
  base too, where the hub's gallery answers nothing.
- **"Equals, apart from `core` and `set_digest`"** compares every top-level field of the two replies but those two, by their JSON;
  a field one side has and the other lacks is a difference. `list` and `search` are compared on their first page (no cursor sent).
- **"With a session bound by its hooks"**: deep_kinds needs no session at the base (`mcpCall`), so the binding is established and its
  `session.start` read from the record before the calls, and not asserted further.
- **AC2's `cursor`** is any string (`"abc"`): the refusal comes before the cursor is read. Its path is the agent's argument's,
  `/params/arguments/cursor`, as the hub prefixes the canvas core's path.

## Not tested, because no criterion asks

Codex sessions; a `deep mcp` bound to no session; deep_kinds' other refusals (#412's suite has them on `deep-show run`); `registry`,
`guide` and `offset`; paging past the first page; the Proof line's side-by-side display, which `BASE-FAILURE.txt` and the branch's
run give.

## Files

- `helpers.ts`: temporary homes, the hub from a given `deep`, the bound session and its `deep mcp`, the deep_kinds calls and their
  `deep-show run` references, criterion 1's check (`kindsFailures`), the installed tree and the plant.
- `fixtures/stamps-at.mjs`: the planted canvas core's wrapper.
- `hub.test.ts` (AC1, AC2), `planted.test.ts` (AC3).
- `tsconfig.json`: type-checks the suite under the root's strict options with `allowImportingTsExtensions`.
- `BASE-FAILURE.txt`: the run at the base.

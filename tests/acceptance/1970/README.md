# Acceptance tests for #1970: refusals that name where a name belongs

Written first, from issue #1970 ("Refusals that name where a name belongs: a field set on the wrong kind names the
kind that defines it, and a misspelt MCP name names the nearest one": its Scope, its two acceptance criteria and its
Proof line), the design sections it links, and base commit `2df533990` ("Merge pull request #2185 …"), by a job that
never saw an implementation; none existed. The implementing agent doesn't edit these files (AGENTS.md, Proof); a
dispute goes to a blind redraft of this job (design: Dogfooding).

## What was read

- The issue, read live with `gh issue view 1970`, and its oracle page (`doneright/oracles/issues/1970.md` in
  `DeepBuildAI/deepbuild`, branch `doneright`): no upstream test checks either criterion; both are held to our own
  fixtures.
- `docs/technical-design.md`: "Five ways in, all onto the same core" (the MCP tools, errors in one shape) and the
  Dogfooding paragraph (blind acceptance tests, the redraft on a dispute).
- `docs/canvas-primitives.md`: Item and kind ("A field the kind's version doesn't define is an error
  (`unknown_field`) … An `unknown_kind` or `unknown_field` issue names up to three close names"), Registry and seal,
  and Registry and seal: registries.
- `AGENTS.md` (Proof).
- At the base, for surfaces and conventions only: `tests/acceptance/412/` (`names.test.ts`, `helpers.ts`: close names
  on `unknown_field`), `tests/acceptance/389/` (`deep-canvas check` driven by JSON lines), `tests/acceptance/26/`
  (`deep mcp` against a real hub in a temporary home); `crates/deep-canvas/src/main.rs` (`check`, `apply`),
  `crates/deep-canvas/src/kinds.rs` (`test.rect@1` with `w`, `h`, `fill`; `test.dot@1` with `radius`, `fill`),
  `crates/deep-canvas/src/document/mod.rs` and `close.rs` (an issue's `fix` and `close`, the close names' distance and
  reach), `crates/deep-canvas/src/document/apply.rs` (a patch's shape; each patch is checked by the same check);
  `packages/hub/src/mcp.ts`, `tools.ts` (how `deep mcp` forwards a call and how the hub refuses an unlisted argument
  or an enum value) and `packages/contracts/schemas/error@2.json` (one `remediation` string per refusal).

## What the base already does, which the tests don't credit

Each of these is from the base run (`BASE-FAILURE.txt`).

- The document check and a patch refuse `w` on a `test.dot@1` with `unknown_field` at `items/d/params/w`, `what`
  "test.dot@1.0 does not define `w`". Its fix is the code's one line ("Remove the field, or require the kind's minor
  that defines it.") and, since neither `radius` nor `fill` is within reach of `w` by spelling, it carries no close
  names. It names no kind. The same document without `w` checks clean.
- `deep mcp` refuses `docs` with `unlisted_field` at `/params/arguments/docs` and `include: ["pixel"]` with `enum` at
  `/params/arguments/include/0`. Each remediation lists every choice once ("the schema lists only doc, document, …";
  "Give one of issues, audit, timing, pixels."). So `doc` and `pixels` already appear in the text, as one entry of a
  list; the tests read that as naming nothing, as the criterion says the base does.
- `zzzzzz` is refused the same way, listing the fields: today's behavior, which AC2 keeps.

## Run them

```sh
npm ci                                   # once, if node_modules is missing
npm run build --workspaces               # AC2 runs the built CLI, packages/cli/dist/main.js: deep hub run, deep mcp
CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 node node_modules/vitest/vitest.mjs run --root tests/acceptance/1970 --no-file-parallelism --testTimeout=600000
node node_modules/typescript/bin/tsc -p tests/acceptance/1970/tsconfig.json
```

`cargo` must be on the `PATH`. `field.test.ts` builds `deep-canvas` once (`cargo build --locked -p deep-canvas --bin
deep-canvas`) and `mcp.test.ts` builds `deep-hook` once (the hub refuses to start without it), each honouring
`CARGO_TARGET_DIR` and failing its test if the build fails. The hub looks for `deep-hook` only under `<repo>/target`,
so leave `CARGO_TARGET_DIR` unset for `mcp.test.ts`, or put a built `deep-hook` there. `mcp.test.ts` starts one hub
and one `deep mcp` in a folder under `/tmp/dh1970-*` with `HOME` there (a socket path must fit in 104 bytes on
macOS), so it never touches your `~/.deepbuild`, and stops both by PID after the file, never by name or port. Node
built-ins and vitest only. A run with `--root tests/acceptance/1970` may leave Vitest's cache in
`tests/acceptance/1970/node_modules`; delete it.

`BASE-FAILURE.txt` holds the base run: AC1 fails naming the field `w`; AC2's first run was BLOCKED (no `deep-hook`
built), the file then gained the `deep-hook` build with no assertion changed, and its one verdict run fails on `docs`
and `pixel` while the `zzzzzz` part passes.

## The surfaces under test

- **AC1, the document check and a patch:** `deep-canvas check` with `{"doc": <document>}` and `deep-canvas apply`
  with `{"doc", "writer", "patches"}`, one JSON line in and one out, as #389's suite drives them. The document is a
  `figure` with one layer written by `agent-a` and one item `d` of `test.dot@1` at `[0, 0, 0]`; it holds no
  `test.rect@1` item, so the kind can come only from the build. The patch sets `items/d/params/w` to 10. The tests
  read an issue's `code`, `path`, `fix`, `fix_ops`, `close` and any other field the issue carries besides its own
  (`check`, `code`, `severity`, `ids`, `path`, `actual`, `what`, `carried`, `forms`, `step`).
- **AC2, `deep mcp`:** started by hand from the test process against `deep hub run` in a temporary home, spoken to as
  an MCP client speaks it (`initialize`, `tools/list`, `tools/call`). A refusal is a tool result with `isError`
  whose value is error@2; the tests read its `path` and its one `remediation`. deep_show's fields and include's
  values are read from the input schema `tools/list` gives, not written into the tests. No session is bound: the
  hub holds a call's arguments to its schema before it binds the call.

No plant names, flags, scenario fields or new binaries: neither criterion names a planted twin, and both name the
merge base as the program the tests must fail on.

## Readings of what the criteria leave open

- **"whose fix names `test.rect@1` before any close name" (AC1).** An issue's fix is its remediation: its `fix`
  text, its `fix_ops`, any field the issue carries besides its own (listed above) and its `close` names. The test
  passes when `test.rect@1` (not a later major such as `@10`) is named in the fix outside `close`, or is the first
  `close` entry naming it with no name by spelling before it. An entry before it that names another kind (such as
  `test.slab@1`, whose first major defined `w`) is not a close name by spelling and is allowed. `what` is not the
  fix: naming the kind only there fails.
- **"a different kind in the build" (AC1).** The build is the one `deep-canvas` holds; the document holds no
  `test.rect@1` item. The test doesn't require `test.rect@1` to be the only kind named.
- **"a document check or patch" (Scope, AC1).** Both are run; each must name the kind. A patch's refusal is the
  same check on the patched document, so the patch adds one line of coverage, not a second behavior.
- **"a remediation naming `doc`" and "naming `pixels`" (AC2).** The base's remediation already contains `doc` and
  `pixels`, each once in the full list, and the criterion says the base names nothing. So naming means singling
  out: the remediation names the nearest choice more often than some other choice (`singlesOut`). That holds for a
  remediation that names only the nearest choice and for one that names it and then lists every choice; it fails a
  remediation that lists every choice once, or names another choice as nearest. Names are counted as words, so
  `doc` inside `docs` or `document` doesn't count.
- **"`zzzzzz` names none and lists the fields as today" (AC2).** `zzzzzz` stands in place of `doc`, as an argument
  name (the criterion's "lists the fields"). Its refusal is at `/params/arguments/zzzzzz`, names every field the
  listed schema has, and singles none out. Its wording and code are not compared with the base's.
- **The `include` refusal's path (AC2).** The criterion names no path; the test requires one under
  `/params/arguments/include` (the base's is `/params/arguments/include/0`). Neither refusal's code is asserted.
- **The unknown tool (Scope).** The scope's third case has no criterion, so nothing here tests it.

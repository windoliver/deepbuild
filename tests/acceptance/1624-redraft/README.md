# #1624 blind redraft: the unit lane runs each reference-Mac budget file alone

Unadopted draft. Inputs used: the issue, AGENTS.md, the base design and the base tree. Nothing was run.

## Mapping

Criterion 1 names the check `tests/preflight.test.mjs › the unit lane runs each reference-Mac budget file alone, after
the parallel block`, which must pass with its `scripts/known-failures.json` entry removed. The replacement is
`alone.test.mjs › #1624.alone the unit lane runs each reference-Mac budget file alone, after the parallel block`.

| Issue condition | Where |
| --- | --- |
| "The test reads only the folders under `tests/acceptance/`" | `gatedFiles()` lists entries with `withFileTypes` and keeps directories, so `plans.ts` is never read as a folder |
| Files calling `environmentProblem()` must be run alone | `callsEnvironmentProblem()` finds the call by parsing, not by a substring, so a name in a comment or string does not count |
| `308/`, `45/` and `1017/budgets.test.ts` "aren't in `alone`" | the first loop requires the scan to find them (and `14/`); the last `deepEqual` then lists any that no `alone` filter covers |
| "after the parallel block" | the two vitest commands of the `unit` lane are found in order; the first has no `--no-file-parallelism`, the second has it; the first must exclude each gated file |

The depth is the existing check's: files directly inside each issue folder. Nested files such as
`140/platform/budgets.test.ts` are not demanded, because the issue lists only the three above as failing once the read is fixed.

## Intended failures on the base

The enumeration passes on the base. The check then fails at the last `deepEqual`, with an actual list holding
`tests/acceptance/1017/budgets.test.ts`, `tests/acceptance/308/budgets.test.ts` and `tests/acceptance/45/budgets.test.ts`
and an expected `[]`. It fails there, not by an exception, because no file is read as a folder. It passes once those three
join `alone` in `scripts/lanes.mjs`. If the parallel block does not exclude one of them, the first `deepEqual` fails too.

## Not duplicated

- Criterion 2 (`tests/acceptance/1114/timed-list.test.mjs`) already exists and is its own check; not redone here.
- Criterion 3 (the unit lane drops `1330/start.live.test.ts` and lists no skip from it) is a different check; this file does not cover it.
- No planted-list test: #1114's does that job for `timed`, and this one fails on the real lists.

## Prerequisites

- `typescript` resolvable from the repo (as #1114's helpers use it) and `scripts/lanes.mjs` importable. No git, no network, no build.
- Run with `node --test tests/acceptance/1624-redraft/alone.test.mjs`. It is not in any lane list; adding it is the implementer's lane edit, and I did not make it.

## Policy contradictions and decisions

1. Dogfooding: the implementing agent cannot change acceptance tests, but the issue's Scope tells it to change this
   check ("The test reads only the folders"). `tests/preflight.test.mjs` is not under `tests/acceptance/`, so the
   issue's instruction arguably wins. If it is a criterion check, the replacement here stands in, and the original's
   fix is not the implementer's to make. Needs the owner's decision which applies.
2. The criterion also requires the old test's `known-failures.json` entry to leave. If the old test is replaced and not
   fixed, the entry names a test that no longer exists. `known-failures-check.mjs` may then complain.
   Needs the owner's decision: drop the entry, or keep the old test and fix it.
3. The `lanes.mjs` edit that makes this pass carries a signed approval tag, as the issue says. This draft edits no lane
   list, so it needs no tag. Adopting it, or the diff below, needs the owner's approval.
4. The lane's `alone` and `byHand` lists are not exported from `lanes.mjs` as far as I could tell. The draft reads them
   through the `unit` lane's commands, as the existing check does.

## Unadopted diff proposal for the existing test (`tests/preflight.test.mjs`)

Legitimate only under the issue's Scope. Shortest change at lines 186-188:

```diff
-  const gated = readdirSync(new URL('tests/acceptance/', root))
-    .flatMap((issue) => readdirSync(new URL(`tests/acceptance/${issue}/`, root)).map((file) => `tests/acceptance/${issue}/${file}`))
+  const gated = readdirSync(new URL('tests/acceptance/', root), { withFileTypes: true })
+    .filter((entry) => entry.isDirectory())
+    .flatMap(({ name: issue }) => readdirSync(new URL(`tests/acceptance/${issue}/`, root)).map((file) => `tests/acceptance/${issue}/${file}`))
```

Plus `lanes.mjs` entries for 308, 45 and 1017, and removing the known-failures entry. Both need the approval tag. The old
test still reads sources with `includes('environmentProblem()')`, so it matches in comments and strings; the replacement does not.

# Acceptance tests for #3585: tags a TS test imports through a `.js` specifier

Written first, blind, from issue #3585 (its text as of 2026-11-26: the description and its two acceptance criteria;
it links no design section), `AGENTS.md`, the house style of `tests/acceptance/569/` and the base commit `914bd5f29`.
The implementing agent doesn't edit these files (AGENTS.md, Proof); a dispute goes to a blind redraft by this job.

## Run

```sh
node --test 'tests/acceptance/3585/*.test.mjs'
```

No network, no `gh`, no bay grant. Each test builds a scratch git repository under the system temporary folder and
removes it afterwards; nothing is written into this checkout.

## Surface

`tagsWithImports(root, rev, path)`, exported by `scripts/proof-change.mjs`, the function the issue names and the one
the `before` and `trace` lanes call to read a test's tags. Each test calls it twice, on the worktree (`rev` null) and on
the commit, and requires both to read the same tags. The lanes themselves (`node scripts/proof.mjs before trace`) are
not driven: `before` waits on a bay-pair grant this machine may not give within the run, and the issue puts the fault
in the shared resolver both lanes read through, so the function is the smallest real surface. The planted issue is
`#9001`; its tags are built at runtime from criterion texts (`criterionId` from `../569/helpers.mjs`).

## Tests

| Criterion | Test | What it proves | At 914bd5f29 |
|---|---|---|---|
| `#3585.53dc07b0` | `a test importing helpers.ts by the name ./helpers.js reads its tags` | A `.js` specifier reaches its `.ts` source | Fails: `got []` |
| `#3585.53dc07b0` | `… helpers.tsx by the name ./helpers.js …` | `.js` reaches `.tsx` (TypeScript's mapping) | Fails: `got []` |
| `#3585.53dc07b0` | `… helpers.mts by the name ./helpers.mjs …` | `.mjs` reaches `.mts` | Fails: `got []` |
| `#3585.53dc07b0` | `… helpers.cts by the name ./helpers.cjs …` | `.cjs` reaches `.cts` | Fails: `got []` |
| `#3585.53dc07b0` | `… helpers.tsx by the name ./helpers.jsx …` | `.jsx` reaches `.tsx` | Fails: `got []` |
| `#3585.53dc07b0` | `tags reach through a chain of .js specifiers naming .ts modules` | The far imports are walked too: test → `helpers.ts` → `ids.ts`, each named `.js` | Fails: `got []` |
| `#3585.f42fa3e6` | `./helpers.js naming an existing helpers.js reads helpers.js, not helpers.ts` (and the `.mjs`/`.mts`, `.cjs`/`.cts`, `.jsx`/`.tsx` pairs) | An existing named file wins over the TypeScript file beside it: its tag is read, the sibling's is not | Passes (the base never tries the `.ts` name); fails on twin `ts-over-existing-js` |

Every test at the base fails for the issue's reason: the resolver never tries the TypeScript name, so the walk stops at
the test file and no tag is read (`BASE-FAILURE.txt`, home paths redacted).

## Twin

`twins.json` names `ts-over-existing-js` for `#3585.f42fa3e6`: `tagsWithImports` walks the imports with a resolver that
tries the TypeScript name before the named file, the wrong fix the second criterion rules out. It is kept as its wrong
lines (`twins/ts-over-existing-js/lines.json`), replacing the `tagsWithImports` line of `scripts/proof-change.mjs`, the
line a resolver fix should leave unchanged; if the fix rewrites that line the twin goes stale and needs a redraft
(`twins/README.md`). Checked by hand in a scratch copy of the base: with the twin's lines laid, the six
`#3585.53dc07b0` tests pass and the four `#3585.f42fa3e6` tests fail (`the existing helpers.js's tag is missing: got
["#9001.…"]`); with a resolver that tries the TypeScript name only after the named file, all ten pass.
`node scripts/twins-lint.mjs` reports no finding for this suite.

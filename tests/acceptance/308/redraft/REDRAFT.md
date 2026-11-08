# #308 surface location: blind redraft

**Dispute** (`DISPUTE.md`). The tests that drive controls build `cargo build --locked -p deep-canvas --bin deep-canvas`
and run `deep-canvas input`. No correct program can meet that build line:

1. The input module depends on the core (technical design, the module table's `input` row), so a `deep-canvas` binary
   that links it is a cargo package cycle (`deep-canvas → input → deep-canvas`). The same holds for #489's follow
   channel in `deep-canvas-motion`.
2. The only way around the cycle puts the module inside the core, which breaks "the core never imports an extension"
   (AGENTS.md).
3. The `lookup` op reports `ns`, a wall-clock time; the canvas lint keeps clock reads out of the `deep-canvas*` crates.
   #391/#489 put motion's proof binary in its own package, `crates/deep-motion`, for that reason.

**What changed.** Only where the `input` subcommand is built from: package `deep-input` at `crates/deep-input`, binary
`deep-input`, run as `deep-input input`. The input and output JSON lines, the ops, the documents, the planted names
and every expected value are the original's. No test file, fixture or assertion changes. `helpers.ts` here is a
whole-file replacement for `../helpers.ts` (its paths resolve from `tests/acceptance/308/`, so it only works there).
`README-surface.md` lists the README lines to replace. The test files' header comments still say `deep-canvas input`
(grammar.test.ts line 2, budgets.test.ts line 6, track.test.ts line 1); they are comments in files nobody edits, and
the messages a reader sees come from `CANVAS_NAME`.

`diff ../helpers.ts helpers.ts`:

```
1c1
< // Test-side tools for the #308 acceptance tests: the `deep-canvas input` subcommand (README: The surface under
---
> // Test-side tools for the #308 acceptance tests: the `deep-input input` subcommand (README: The surface under
22c22
< export const CANVAS_NAME = 'deep-canvas';
---
> export const CANVAS_NAME = 'deep-input';
106c106
< // Builds: `deep-canvas` once per file; `deep-show` once per feature set per file, each copied under its own name.
---
> // Builds: `deep-input` once per file; `deep-show` once per feature set per file, each copied under its own name.
114c114
< /** `cargo build --locked -p deep-canvas --bin deep-canvas`, once per file; fails each test that asks for the binary when it can't be built. */
---
> /** `cargo build --locked -p deep-input --bin deep-input` (the input module's proof binary, package `crates/deep-input`), once per file; fails each test that asks for the binary when it can't be built. */
117,118c117,118
<   beforeAll(() => { error = cargo(['build', '--locked', '-p', 'deep-canvas', '--bin', CANVAS_NAME]); }, 7_200_000);
<   return { bin: () => { expect(error, `the binary builds: cargo build --locked -p deep-canvas --bin ${CANVAS_NAME}`).toBe(''); return join(TARGET, 'debug', exe(CANVAS_NAME)); } };
---
>   beforeAll(() => { error = cargo(['build', '--locked', '-p', 'deep-input', '--bin', CANVAS_NAME]); }, 7_200_000);
>   return { bin: () => { expect(error, `the binary builds: cargo build --locked -p deep-input --bin ${CANVAS_NAME}`).toBe(''); return join(TARGET, 'debug', exe(CANVAS_NAME)); } };
163c163
< // The `deep-canvas input` surface (README: `input`)
---
> // The `deep-input input` surface (README: `input`)
198c198
< /** `deep-canvas input`: one answer per line, in order; the run exits 0 with one line out per line in. Each answer is accepted. */
---
> /** `deep-input input`: one answer per line, in order; the run exits 0 with one line out per line in. Each answer is accepted. */
```

**Written blind.** This redraft was written from the issue, the technical design's Dogfooding section, the original
suite at `tests/acceptance/308/`, `DISPUTE.md`, `crates/deep-motion/Cargo.toml` and the #200 and #185 redrafts. No
implementation of the input module was read (`crates/deep-canvas-input`, `crates/deep-input` or uncommitted crate
changes); none exists in this working tree.

**Base run** (`BASE-FAILURE.txt`). `cargo build --locked -p deep-input --bin deep-input` exits 101 with "package ID
specification `deep-input` did not match any packages", the expected reason: the proof binary doesn't exist at the
base. Not run: the typecheck and the vitest suite, because this worktree has no `node_modules`.

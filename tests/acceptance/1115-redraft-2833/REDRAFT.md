# Blind redraft of #1115's tests that #2833's limit contradicts

#2833 raises the Linux test-class limit in `scripts/throttle.mjs`'s `LIMITS` from 4 to 6; darwin stays at 2. `tests/acceptance/1115/no-grant.test.mjs` hard-codes `LIMIT = darwin ? 2 : 4` and has that many holders fill the test class before it expects the throttle to end a job with no grant. With 6 grants, 4 holders leave two free, the job gets a grant and runs, and the three `#1115.1f2f1fa0` tests can't see a job with no grant. This folder redrafts those three from #1115's criterion (as `tests/acceptance/1115/README.md` quotes it), #2833's text and its comment, and the base `c26bdb5b`, drafted by a blind job under the design's Dogfooding rule. The surface is #2833's comment: the machine's test limit is the one `scripts/throttle.mjs` states for the platform on its `LIMITS` line.

The originals are not edited or deleted; a person approves the swap (#2833's comment records the owner's approval of these redrafts). Run with:

```
node --test 'tests/acceptance/1115-redraft-2833/*.test.mjs'
```

`no-grant.test.mjs` imports `tests/acceptance/1115/helpers.mjs`, unchanged. `helpers.mjs` here holds the one thing that doesn't fit: `testLimit()`, which reads the checkout's `scripts/throttle.mjs` (the file the holders run, `THROTTLE` in 1115's helpers) as text, since `LIMITS` isn't exported. It takes the one line starting `const LIMITS =`, requires the form `process.platform === '<name>' ? {…} : {…}`, picks the object for the current platform, and requires exactly one `test: <positive integer>` in it. Anything else throws an Error naming the file and what couldn't be read, at the test file's load, so the file fails; no number is ever assumed.

## What each redraft replaces

One change serves all three: `const LIMIT = process.platform === 'darwin' ? 2 : 4;` becomes `const LIMIT = testLimit();`. Test names, criterion IDs, fixtures, assertions and expected values are the originals', line for line (`diff ../1115/no-grant.test.mjs no-grant.test.mjs` shows only the header comment, the imports and that line).

| Original (path › test) | Criterion | Why the old expectation no longer holds | Replaced by |
|---|---|---|---|
| `1115/no-grant.test.mjs` › #1115.1f2f1fa0 a vitest job ended with no grant reads INCONCLUSIVE, not FAIL: its files read so in affected.mjs, and a later run with a grant passes | #1115.1f2f1fa0 | Its 4 holders don't fill a 6-grant test class, so the job is granted and the refused run reads `PASS affected: …` | `no-grant.test.mjs` › same name, filling `testLimit()` grants |
| `1115/no-grant.test.mjs` › #1115.1f2f1fa0 a vitest job ended with no grant reads INCONCLUSIVE when a line of output came before the throttle's | #1115.1f2f1fa0 | The same: the summary reads `PASS affected: …` | `no-grant.test.mjs` › same name, the same way |
| `1115/no-grant.test.mjs` › #1115.1f2f1fa0 a unit lane whose vitest job ended with no grant reads INCONCLUSIVE, not FAIL | #1115.1f2f1fa0 | The class isn't full, so no `INCONCLUSIVE no grant` line appears | `no-grant.test.mjs` › same name, the same way |

## Kept as they are

- Every other file of `tests/acceptance/1115/`: none reads the throttle's test limit.
- `tests/acceptance/1115/helpers.mjs`, including its throttle shim (the `test`-class `--wait` of 0.02 minutes) and `hold`, which run the checkout's real `scripts/throttle.mjs`.
- `tests/acceptance/1115/twins.json`: the redrafts keep the criterion ID, so it maps them too.

## On the base and on a throttle that meets #2833

Run on the Spark (Linux, 20 cores, load about 16 to 24), each file once per program, each inside a `systemd-run --user` unit with `MemoryMax=24G`, `MemorySwapMax=2G`. The tests point `HOME` at a sandbox, so the machine's own throttle table wasn't touched.

On the base `c26bdb5b` (Linux limit 4) the redraft passes:

```
$ node --test tests/acceptance/1115-redraft-2833/no-grant.test.mjs
✔ #1115.1f2f1fa0 a vitest job ended with no grant reads INCONCLUSIVE, not FAIL: its files read so in affected.mjs, and a later run with a grant passes (3651.067978ms)
✔ #1115.1f2f1fa0 a vitest job ended with no grant reads INCONCLUSIVE when a line of output came before the throttle's (2005.438804ms)
✔ #1115.1f2f1fa0 a unit lane whose vitest job ended with no grant reads INCONCLUSIVE, not FAIL (4906.383157ms)
ℹ tests 3
ℹ pass 3
ℹ fail 0
```

On a throwaway worktree of `c26bdb5b` whose only change is `test: 4` → `test: 6` on the Linux branch of `LIMITS` (not kept), the redraft passes:

```
$ node --test tests/acceptance/1115-redraft-2833/no-grant.test.mjs
✔ #1115.1f2f1fa0 a vitest job ended with no grant reads INCONCLUSIVE, not FAIL: its files read so in affected.mjs, and a later run with a grant passes (6996.303154ms)
✔ #1115.1f2f1fa0 a vitest job ended with no grant reads INCONCLUSIVE when a line of output came before the throttle's (2916.159933ms)
✔ #1115.1f2f1fa0 a unit lane whose vitest job ended with no grant reads INCONCLUSIVE, not FAIL (4831.637291ms)
ℹ tests 3
ℹ pass 3
ℹ fail 0
```

The original there fails all three, as the table says:

```
$ node --test tests/acceptance/1115/no-grant.test.mjs
✖ #1115.1f2f1fa0 a vitest job ended with no grant reads INCONCLUSIVE, not FAIL: its files read so in affected.mjs, and a later run with a grant passes (2221.89803ms)
    the summary of a run with no grant reads otherwise
    actual: 'PASS affected: 0 new, 0 already failing on main, 0 inconclusive or blocked, 0 listed skips, 2 passed, …'
✖ #1115.1f2f1fa0 a vitest job ended with no grant reads INCONCLUSIVE when a line of output came before the throttle's (2136.052727ms)
    the summary of a run with no grant reads otherwise
✖ #1115.1f2f1fa0 a unit lane whose vitest job ended with no grant reads INCONCLUSIVE, not FAIL (2686.226614ms)
    the test class was not full, so this run shows nothing
ℹ tests 3
ℹ pass 0
ℹ fail 3
```

`testLimit()` was also checked by hand: it reads 4 for Linux and 2 for darwin from the base's line, and throws on a `LIMITS` line of another form. The darwin branch of the tests is written but unrun here (no Mac run).

A redraft that passes on the base proves nothing new about #1115's criterion by itself: the wrong programs for it are #1115's twins, unchanged.

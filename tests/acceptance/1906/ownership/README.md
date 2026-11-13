# #1906, the children criterion: blind acceptance coverage

Written from the issue, `docs/technical-design.md` and the base commit 331b68be only. Supplemental: it covers one
criterion and replaces no other test.

> Every child the core thread starts is in `children.ts`'s table at exit: a test fails on the merge base for the two forks

with the scope line "The two forks go through `children.ts`" and the issue's sites, `open-items.ts:57-60` and
`scope.ts:82`.

## What `forks.test.ts` checks

One real hub (`deep hub run`) and one Claude Code session sent over the hub's socket in the hook protocol's lines.
`fixtures/threads.mjs` is loaded into every thread of the hub and records each child process a thread starts.

| Fork (base site) | What the record shows, unchanged | What must hold after the fold |
| --- | --- | --- |
| `open-items.ts` `git diff -U0 <base>` | the placeholder added to `src/auth.js` is an open item | every start of it is made in `children-worker.js` |
| `open-items.ts` `git ls-files -o` | the placeholder in the new `src/refresh.js` is an open item | a start of it is made in `children-worker.js` |
| `scope.ts` `git log --first-parent --no-merges` | `claim.sized` has the usual 17 lines over 3 files, read from the repo's history | every start of it is made in `children-worker.js` |

The hub runs with no `DEEP_HUB_TEST_ACCEPTED`, so `scope.ts` reads the repo's own history; #324's suite always hands
that list, so it never reaches the fork. The gate's snapshot runs the same `git ls-files -o` from `packages/gate`,
which is not one of the issue's two forks, so that row asks for one start, not every start.

`children.ts` starts its children from a thread of its own (`children-worker.js`, base). A job reaches that thread
only through `children.ts`, which holds it in its table of jobs until the child's result comes back. So "started in
`children-worker.js`" is how a fork that goes through `children.ts` is seen from outside.

## What it does not check

`children.ts` on the base exports no table and has no behavior at the hub's exit, and the design names neither. This
suite adds no test API for one and asserts nothing about shutdown.

## How to run

```
cargo build --locked -q -p deep-hook   # the hub refuses to start without it
node scripts/throttle.mjs test --wait 10 -- scripts/lease npx vitest run tests/acceptance/1906/ownership/forks.test.ts --no-file-parallelism
```

It reuses #324's world and record readers (`tests/acceptance/324/helpers.ts`), read-only.

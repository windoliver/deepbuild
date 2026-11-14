# Acceptance tests for #1906, AC3: every child the core thread starts is in `children.ts`'s table at exit

Written blind from issue #1906 (Scope, the third acceptance criterion and Proof), `docs/technical-design.md` (One hub
per user: the deep hub "tracks every process it starts"; Platforms: process ownership; Rules every primitive follows:
universal rules are tested as properties; Dogfooding), `AGENTS.md` and the base commit `bcd02c238`
(`packages/hub/src/children.ts`, `children-worker.ts`, `open-items.ts`, `scope.ts`, `session-facts.ts`, `core.ts` for
how it calls them, and `packages/gate/src/size.ts`), by a job that never saw an implementation. The implementing
agent doesn't edit these files (AGENTS.md, Proof); a dispute goes to a blind redraft.

## How to run

```sh
npm run build --workspaces        # once: children.ts starts its thread from dist/children-worker.js
node node_modules/vitest/vitest.mjs run tests/acceptance/1906/exit
```

macOS or Linux with `bash`, `git` and `ps`. Everything is under one `dh1906-*` temp folder, removed after the file.
No process is stopped by this suite: each child ends by itself. The property runs 1,000 cases from seed 1906, a few
real processes each, so it takes minutes on a quiet machine.

## The surface under test

The issue names `children.ts`'s table and no export for it, so none is asked for.

- **The core's thread** is the test's thread. It loads the hub's built modules that `core.ts` loads and calls them as
  `core.ts` does: `OpenItems.atClaim` (open-items.ts), `SizeScope.usual` (scope.ts, which also measures each accepted
  change through `packages/gate`), `commitsBetween` (session-facts.ts) and `startOf` (children.ts). Each call's answer
  is checked too, on a real repository and a real record.
- **Every child is real.** PATH is led by stand-ins for `git` and `ps` (`helpers.ts`, `world`). A stand-in runs the
  real program on the same streams, then notes that it is at its exit, with its parent and its command, and holds
  there on a pipe of its own until the test's thread has read the tables, 3 s at most. Only children whose parent is
  this process count.
- **The table is read where it is** (`helpers.ts`, `tables`): every Map, Set and array that a top-level name of the
  built `children.js` holds, or that an object such a name holds keeps in a field of its own, private fields
  included. The names come from the file's syntax tree, the values from the scope its exported functions close over,
  read through V8's inspector (`[[Scopes]]`). On the base that is `waiting`.
- **In the table at exit** (`helpers.ts`, `watched`): at a child's exit, the tables hold an entry (a Map's key, a
  Set's or an array's element) that they did not hold before the call and that no earlier child of the call was
  given. So each child needs an entry of its own, there from before its exit until the thread has seen the exit. A
  child that ran with the starting thread held for its whole life can't be read and fails, saying so.

## What each test proves, and the base

`children-at-exit.test.ts`. Each fixture first checks that the reading is live: the children `children.ts` already
runs (`git rev-list`, `ps`) are in the table at exit.

| Test | Proves | On `bcd02c238` |
|---|---|---|
| the first fork | open-items.ts's `git diff` and `git ls-files` at a claim | fails: both in no table |
| the second fork | scope.ts's `git log` for the accepted changes | fails: in no table |
| a child started through another package | each `git` `packages/gate`'s `measure` runs for scope.ts on the core's thread | fails: each in no table |
| 1,000 seeded runs of the core's calls | the universal: every child of every generated run of one or two calls | fails, and shrinks to one call |

The third and fourth go past the two forks the issue lists, as "every child" reads. The three fixtures are the
property's smallest failing cases, kept.

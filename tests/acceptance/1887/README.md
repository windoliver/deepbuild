# Acceptance tests for #1887: `deep.schedule.read` is published, and the parity check covers every method

Written first, blind, from issue #1887 ("`deep.schedule.read` is in the published extension API, and the parity check
covers every method the host serves": its report, Scope, three acceptance criteria and Proof) as the brief quoted it,
the design and base commit `72fe11a11` ("Merge pull request #2523 …"), by a job that never saw an implementation; none
existed, and no other branch, worktree or pull request was read, nor the live issue. The implementing agent doesn't
edit these files (AGENTS.md, Proof); a dispute goes to a blind redraft of this job (design: Dogfooding). Lean: one test
per criterion, in one file, through the check as it is run.

| AC | ID | File (tests) |
|---|---|---|
| AC1 | `#1887.a39d9bc9` | `slots-parity.test.mjs` (1): the check on the merge base's published API, then on the checkout |
| AC2 | `#1887.69370a95` | `slots-parity.test.mjs` (1): the check with a method planted in the runtime's table, and with an entry planted in the published API |
| AC3 | `#1887.4a851c74` | `slots-parity.test.mjs` (1): the count on the check's `PASS slots:` line |

IDs are `scripts/proof-change.mjs`'s `criterionId` (sha256 of the text, first 8 hex) over each criterion's text as the
brief gave it, after `- [ ] `; the live issue body wasn't read, so they aren't checked against it. Each test's name
starts with its ID.

## What was read

- `AGENTS.md`; `docs/technical-design.md`: Extension API (TypeScript, in-process) (the issue's design link) and
  Dogfooding.
- At the base: `scripts/slots-check.mjs` (its `--api` and `--table` flags, its `FAIL slots:` and `PASS slots:` lines,
  its exit statuses, its count, its one-way `deep.register*` comparison); `packages/extension-host/runtime/deep.mjs`
  (the `API` table, 43 methods, `deep.schedule.read` among them, and how `deep` is built from it);
  `packages/contracts/extension-api.json` (42 entries, `deep.schedule` and no `deep.schedule.read`);
  `packages/contracts/src/slots.ts` (`extensionApi`, `ApiEntry`); `packages/extension-host/src/index.ts` (it re-exports
  the table); `scripts/proof-change.mjs` (`criterionId`); `scripts/lanes.mjs` (the `alone` list);
  `scripts/known-failures.json`. Suites `2497/` for the house format and `349/` for the slot check's own suite
  (`slotting.ts`, `slot-list.test.ts`).

## Readings where the issue leaves a choice

- **"the merge base's published API"**: `packages/contracts/extension-api.json` at `git merge-base HEAD origin/main`,
  read from git and given to the check with `--api`. Once the work is on main the merge base holds the entry too; the
  test then reads the file at the parent of the commit that first wrote the entry (`git log -S`), so it keeps its
  meaning there. It needs `origin/main` and that history: a shallow clone without them fails with `BLOCKED:`.
- **"fails … naming `deep.schedule.read`"**, and **"fail the check by name"**: the check exits 1, its status for a
  finding, and one of its `FAIL slots:` lines names the method as itself (`deep.schedule` alone doesn't name
  `deep.schedule.read`). The line's other words are the implementer's.
- **"passes once the entry exists"**: `packages/contracts/extension-api.json` has one `deep.schedule.read` entry (the
  Scope's first line), and `node scripts/slots-check.mjs` on the checkout exits 0 with one `PASS slots:` line and no
  `FAIL slots:` line. Nothing is taken off "passes": a machine where the check has an unrelated finding fails this
  half (below).
- **"A planted runtime method with no published entry"**: `deep.schedule.planted1887`, a copy of the table's own
  `deep.schedule.read` entry under that name. It doesn't start with `deep.register`, since the base's check already
  compares those. A register method, `deep.registerPlanted1887`, is planted beside it as the control: the base's check
  names it, so a run that doesn't name it never read the planted table, and the test fails with `BLOCKED:` rather than
  blame the check.
- **"a planted published entry the runtime doesn't serve"**: the checkout's published API plus one entry,
  `deep.planted1887.published`, a copy of `deep.readNow`'s entry under that name, given with `--api`. It is no
  register method, so it adds no slot and no table row is missing for it; the base's check passes it.
- **"The slot count the check prints is unchanged"**: the number on the `PASS slots: <n> slots …` line of `node
  scripts/slots-check.mjs` on the checkout is 16. That is the base's count on the base's API file by the base
  script's own rule: every `deep.register*` entry counts its variants, or 1 when it names none (13 register methods,
  `deep.registerSource` with 4 variants: 12 + 4). The line keeps that start; the rest of it is the implementer's.

## The copy

AC2's runtime plant is made on a copy, so no tracked file is written and nothing else running in the checkout sees a
planted table. The copy is a temp folder holding real copies of `scripts/` and `packages/extension-host/` (the check
and the runtime file it imports, with the plant), links to every other package (the built `contracts` and
`conformance` among them) and to everything else at the top of the checkout, and a `node_modules` whose
`@deepbuild/*` links point at the copy's packages. The check is run as the copy's `scripts/slots-check.mjs` with the
copy as its working folder. So a check that reads the table from `runtime/deep.mjs` beside it, as the base does, or
through `@deepbuild/extension-host` or the copy's `packages/extension-host/dist`, reads the planted one. A check that
reached the table through another package's built files would read the checkout's and miss the plant; the control
turns that into `BLOCKED:`. The plant needs the table to hold one entry written `{ method: 'deep.schedule.read', … }`
in `runtime/deep.mjs`, where the issue cites it. The planted file's `API` export is read back before the check runs.

## Run them

```sh
npm ci && npm run build --workspaces     # once: the check imports packages/contracts/dist and packages/conformance/dist
node --test --test-reporter=spec tests/acceptance/1887/slots-parity.test.mjs
```

Node built-ins only. Four runs of the check (each ran the kits in 7 to 25 s here, at load 50 to 80); the tests allow 15
minutes each. The temp folder is removed after the file. Nothing is skipped, and nothing in the checkout is written.

**What the machine needs.** AC1's second half and AC3 need `node scripts/slots-check.mjs` to pass on the checkout,
so they need a machine where the check has no unrelated finding. The reference Mac is one. On the Linux box these were
written on, lsof 4.95.0 writes a tracefs warning and exits 1, the environment kit reads that as `lsof failed`, and the
check prints one `FAIL slots: deep.registerEnvironment …` line and exits 1 at the base and on any branch. There, run the
file with a folder first on PATH whose `lsof` is:

```sh
#!/bin/sh
exec /usr/bin/lsof -w "$@"
```

Without it on that box: AC1 fails at "doesn't pass with the entry published" on a right branch, AC3 fails for want of a
`PASS slots:` line, and both show the unrelated line. AC1's first half and both halves of AC2 are judged by the named
method's own `FAIL slots:` line and exit 1, so they read the same with or without the unrelated finding.

## Base results

`BASE-FAILURE.txt` is the one run at the base with lsof healthy (3 tests, 2 fail, 1 passes, nothing BLOCKED), whole,
with the checkout's path replaced.

- **AC1 fails**, as it must, for the issue's reason: on the merge base's API file, which has no `deep.schedule.read`
  entry while the runtime's table lists the method, the check exits 0 with `PASS slots: 16 slots …`.
- **AC2 fails**, as it must, for the issue's reason, in both halves, each reported. Runtime plant: the check on the
  copy names `deep.registerPlanted1887` (so it read the planted table) and not `deep.schedule.planted1887`. Published
  plant: the check exits 0 with its `PASS` line.
- **AC3 passes: it already holds at the base**, whose check prints 16. It can't fail there, since "unchanged" is about
  the work; it is kept to fail a change that moves the count.

Without the lsof wrapper on this box the same run fails all three: AC1 and AC2 for the same reasons (no line names
the method; the control is named), AC3 because the check prints no `PASS slots:` line.

The tests were also run on throwaway programs outside the checkout, in a scratch clone at the base that was then
deleted, to see that they can pass and what fails them: a clone with a `deep.schedule.read` entry and a check that
compares every method both ways passes all three (lsof healthy); the same clone with that work committed and
`origin/main` moved onto it passes AC1 through the `git log -S` reading; the same check counting `deep.schedule.read`
as a slot prints 17 and fails AC3.

## Not tested, because no criterion reaches it here

The entry's own fields (its params, digest, since and stability), and the other places a published method is written
(the generator, digests, the API report, the guide): their own checks hold those. What `deep.schedule.read` does when
called (#365's suite). The check's `--table` flag and its slot findings (#349's suite). The words of the finding
beyond the method's name. Whether `scripts/lanes.mjs` runs the check (#349).

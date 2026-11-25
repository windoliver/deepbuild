# Acceptance tests for #2062: a provider that keeps no digests can't match a use that states one, a tie between providers breaks the same under every locale, and a failed series reopen is tried again

Written first, blind, from issue #2062, the design and base commit `7cb1e5c4a62cd797b00839bb2c27d730937303f6`
(origin/main), by a job that never saw an implementation: no other branch, commit, worktree, pull request, transcript
or note was read. The implementing agent doesn't edit these files (AGENTS.md, Proof); a dispute goes to a blind redraft
of this job (design: Dogfooding).

| AC | ID | File (tests) | What it requires |
|---|---|---|---|
| AC1 | `#2062.dd448700` | `wiring.test.ts` (2) | `u`, whose use of `x@1` states a digest, and `p`, whose row keeps none, don't install beside each other, whichever comes second: refused at install, the refusal naming `u`, `x@1` and `p`, nothing wired and the refused one not installed |
| AC2 | `#2062.9bf72360` | `wiring.test.ts` (2) | with no digest on `u`'s use the pair is wired: both install, and `p`'s next version reaches `u` along the edge; with a digest on the use and the same one kept for minor 0, the host lists the edge |
| AC3 | `#2062.1c13446a` | `wiring.test.ts` (2) | `chart` and `czar` both match a use that names neither: under the cs locale it resolves to `chart`; `a-b` and `a_b`: it resolves to `a-b`, whose `-` is the smaller code unit |
| AC4 | `#2062.1800089a` | `reopen.test.ts` (1) | the record's first read fails once: the first land rejects, naming the read; the second lands; the closed minute's rollup holds exactly its values |
| AC5 | `#2062.926f3013` | `reopen.test.ts` (1) | three batches of one minute before a restart, a reopen that fails once after reading 2 of them and succeeds on its second try: the minute's rollup counts 3 values of each series |

The IDs are `scripts/proof-change.mjs`'s `criterionId` (sha256 of the criterion's text after `- [ ] `, whitespace
collapsed, first 8 hex), computed from the live issue body. Each test's full name carries its tag and its `AC<n>`.

## What was read

- Issue #2062's body; `AGENTS.md`; `node scripts/design-section.mjs --issue 2062` (Composition; Socket roles and
  contract versions; Extension API), and in `docs/technical-design.md` Dogfooding and How we know version 0 works;
  `docs/parallel-proof.md`.
- At the base: `packages/extension-host/src` (`index.ts`, `compose.ts`, `series.ts`, `host.ts`'s install, check, load,
  edges, tick and timer, `sources.ts`'s series call), `runtime/deep.mjs`, `packages/contracts/src/manifest.ts` and
  `schemas/extension.{manifest,compose}@1.json`, the entries of `packages/{record,evidence,supervisor,asks}/src`,
  `scripts/proof-change.mjs` and `scripts/proof-runs.mjs` (criterion IDs, what counts as a failure at an assertion, how
  twins are laid), and suites `103/` and `262/` (how they reach the host, the record and the evidence store). No code is
  imported from another suite.

## The surface under test

`@deepbuild/extension-host`'s public entry (`packages/extension-host/src/index.ts`): `openExtensionHost`, and on the
host `install`, `check`, `load`, `installed`, `edges`, `readSource` (whose series call is a land), `tick` and `rollup`.
The record is reached through `@deepbuild/record`'s entry (`openRecord`; its `composition.tested`,
`composition.reopened` and `reading.batch` events), the evidence store through `@deepbuild/evidence`'s. No function of
`compose.ts` and no `SeriesStore` is called directly: every criterion shows through the entry.

`world.ts` opens the real record, evidence store, asks core, supervisor and host on one controlled clock, and writes the
test packages to temp folders; `helpers.ts` adds what needs the test runner; `under-locale.mjs` is the process AC3 runs
under another locale.

## How each criterion is read

- **The fixture pair.** Packages `test/u` and `test/p` (an ID is `owner/name`). `x@1` is a bare name, which a manifest
  lists only beside a `replaces` of that name, so each provider of it has `replaces: ["x@1"]`. The rows carry the schema
  of minor 0, the same on both sides, so nothing but the digests differs. The digest is the schema's `d1Digest`.
- **AC1, "the edge from `u` to `p`".** The refusal names the user, the interface and the provider; its wording is the
  implementation's. Since an install's type check also holds the uses of what it provides, the pair is tried in both
  orders. The schema path the refusal may name isn't asked for: the two schemas don't differ.
- **AC2, "wired" with no digest on either side.** `extension.manifest@1` requires a `uses` row's `digest`, so a package
  whose use states none installs but never passes its check, never loads, and so is never in `edges()`, which lists
  loaded packages. What the install wired shows in the record: when `p`'s next version installs, #103's
  `composition.tested` and `composition.reopened` name each piece the graph holds as its user. Those two events, for `u`,
  are the edge. With the digest kept, `u` loads and `edges()` lists it.
- **AC3, "under the `cs` locale".** A process's locale is fixed when it starts, so the tie runs in a process of its own
  with `LC_ALL=cs_CZ.UTF-8` (ICU reads the variable; the OS needs no such locale installed). The process reports its
  locale and how it orders `czar` and `chart`, which the test checks first, so a Node with no Czech collation fails
  rather than passes. This makes the criterion's own fixture fail on the base, for the reason the issue gives, and not
  only on its plant. The second pair, `a-b` and `a_b`, holds the Scope's "UTF-16 code units, the order the canonical form
  uses": ICU's root order, which every locale starts from, puts `_` before `-`, and code units put `-` (U+002D) before
  `_` (U+005F), so a tie broken by any one fixed locale fails too. The base picks `a_b` under every locale tried (C, en,
  cs). The providers install in the order that puts the wrong one first, so a tie kept in install order fails as well.
- **AC4, "a fixture record store fails its first read once".** `failsFirstRead` wraps the real record store the host is
  given. It is armed just before the first land, since opening a host reads the record for other reasons; the next read
  (`raw`, `read`, `rows`, `table` or `session`) rejects with an error naming it, and everything after passes through.
  "Rejects, naming the read": the land's error, or a cause behind it, or a failed read's `cause`, holds the fixture's
  name of the read. A land that rejected landed nothing, so the record holds the second land's batch alone and the
  rollup holds its values alone, one of each series.
- **AC5, "fails once after rebuilding 2 of them".** The reopen reads the record once and then each batch's file, so the
  failure comes from the evidence store: `failsAtThird` wraps the real one, lets two of the three batch files be read
  (whichever come first), rejects the first look at the third, once, and then passes everything through. The test checks
  that this is what happened before it goes on. Whether the failing tick itself rejects isn't asked. "Its second try
  succeeds" is the next tick. "The rollup counts 3 values for each series" is asserted a series at a time, naming it.
- **Set-up.** Where a test only starts from a package, one that doesn't install, pass its check or load (a package has
  10 s to start, which a loaded machine can overrun) throws a set-up error, never an assertion's failure, so it can't
  stand in for a wrong program.
- **Time.** Every time is on the clock the test sets. The hub's own 250 ms timer is held: `setInterval` is Vitest's fake
  one while the host gets ready, so no tick but the test's comes between a failing read and the land or tick that must
  try again.

## Twins

Each is a whole copy of the base's file with the planted lines and, elsewhere, the right behavior, so it fails only
where its criterion says (`twins.json`):

| Twin | File | Planted | Fails |
|---|---|---|---|
| `refuses-undigested` | `compose.ts` | `mismatch` refuses every row without digests; its tie is right | AC2's first test, naming the edge |
| `cs-locale-tie` | `compose.ts` | `resolve` sorts the IDs with `localeCompare(…, 'cs')`; its digest rule is right | AC3's tests, the first naming `test/chart` and `test/czar` |
| `keeps-failed-windows` | `series.ts` | a reopen that failed is tried again over the windows the failed try left | AC5, naming the series: 5 values, not 3 |

AC1 and AC4 fail on the base and have no plant. AC2 passes on the base, by its own words: it holds what the fix must keep.
`BASE-FAILURE.txt` is the run on the base; `TWINS-RUN.txt` is each twin's run, with the run of a right program (written
from the issue and the design only, never committed) that passes all of them.

## Safety

Every folder is under `/tmp/dh2062-*` and removed after its file; HOME is a temp folder for the tests and every child;
the agent's own `CLAUDE*`, `DEEP_*`, `ANTHROPIC_*` and `AI_AGENT` variables are removed first; the real `~/.deepbuild`
and the Keychain are never touched (the secret store is in memory); nothing reaches the network (the host's HTTP client
is the test's, and answers from a list or refuses). A package's process is stopped only by the host that started it,
and the AC3 process only by its PID; nothing is stopped by name or port. No fixed sleeps. The folder runs alone
(`lane.json`): the supervisor reads the system's one sandbox log stream, and a package has 10 s to start.

Run: `node scripts/throttle.mjs test --wait 720 -- node node_modules/vitest/vitest.mjs run tests/acceptance/2062`.

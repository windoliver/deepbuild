# Acceptance test for #1828, AC3: an update that drops a used interface asks you once on a real hub

On a hub started by `deep hub run`, an update that drops an interface an installed package uses raises one
`extension.update` ask and installs nothing before your yes.

Written blind, at base commit `914bd5f29775cf6b64a4050276afb97e04cdd659` (origin/main), from the issue and the
design only, by a job that saw no implementation of #1828, no other checkout, branch, pull request or stash, and was
told only which criterion to write. The implementing agent does not edit these files (AGENTS.md, Proof); a dispute
goes to a blind redraft of this job (design: Dogfooding).

## Sources

- **The issue**, #1828: its body only (Scope, the three criteria and Proof), no comments, linked PRs or other
  issues' threads. This suite covers its third criterion only.
- **The design**, `docs/technical-design.md`: Blocks for plug-ins that do real work; Extension API (`deep.provide`,
  `deep.use`, `deep.read`); Composition (Declared edges; Changes travel along edges); the Ask sections (Ask, An ask
  and your answer getting back); How we know version 0 works (Criteria to tests, Wrong programs, Dogfooding).
- **`AGENTS.md`**.
- **The base, for surfaces only**: `packages/extension-host/src` (`host.ts`'s `install`, `admit`, `updateHeld`,
  `yours`, `check`, `load`, `start`, the `deep.provide` and `deep.use` dispatch; `compose.ts`'s matching of a use to
  a provider by `name@major`, minor and digest; `host-shared.ts`'s `HostFiles`), `packages/contracts`
  (`checkManifest`, `extension.manifest@1`, `d1Digest`), `packages/asks` (`raise`, `sources.json`'s
  `extension.update` row), `packages/hub/src` (`core.ts` where it opens the host, `trusted-actions.ts`'s `install`,
  `install.ts`, `inbox.ts`, `human-answers.ts`'s `answer`, `client.ts`'s `callAsYou`, `hub-control.ts`'s method
  table, `log-reads.ts`), `scripts/proof-change.mjs` (`criterionId`).
- **Suites**, for their form only, nothing imported: #363's `hub.ts` (a real hub, `deep install`, `events.read`),
  #2402's README and BASE-FAILURE.txt, #139-redraft-2062's `prices.test.ts` (the prices fixture's shape).

## Run it

From the checkout's root, with the workspaces built (`npm ci`, `npm run build --workspaces`):

```sh
NO_COLOR=1 node node_modules/vitest/vitest.mjs run tests/acceptance/1828/redraft --no-file-parallelism --testTimeout=1200000 --hookTimeout=180000 --reporter=verbose
node node_modules/typescript/bin/tsc -p tests/acceptance/1828/redraft/tsconfig.json
```

- HOME is a temp folder (`/tmp/dh1828-*`) for every child, removed at the file's end. Every process stopped is one
  this file started, by PID. No network, no model, no agent.
- A missing build, a hub that won't start or a starting world that won't install throws an Error starting
  `BLOCKED:`, never a pass.

## The surface under test

1. **`deep hub run`** on a temp home, with the OS confirmation stubbed by the base's `DEEP_HUB_TEST_CONFIRM` file
   (answering `confirmed`).
2. **`deep install <folder>`**, run as you run it, a child of the test and of no agent. The hub installs, checks
   conformance and loads the package; the command exits 0 and prints `Installed <id>@<version>`.
3. **The record**, read with `events.read` on the cli role, as `deep` reads it: `ask.created` and `ask.answered`.
4. **`deep inbox --json`** (the ask's handle among its rows) and **`deep inbox answer <ask> <option>`** (your yes,
   on the trusted path once the OS confirms you).
5. **The host's `extensions/installed.json`** under the hub's root, and its install folders
   `extensions/acme/acme/<version>-*`: what is installed, read as files. *(chosen: the base has no `deep` command or
   socket method that lists installed packages; these are the files the hub loads its packages from at its next
   start.)*

### The packages

TypeScript packages from a folder, built by no agent, so they run in the platform sandbox; each `deepbuild.json`
carries its files' digest from the host's own `packageDigest`, and lists the preview methods it calls in
`requires.preview`.

| Package | Manifest | Code |
|---|---|---|
| `acme/acme` 1.0.0 | provides `ext.acme.prices@1`, a reading, minor 0, its JSON Schema and `digests: {0: d1Digest(schema)}` | `deep.provide('ext.acme.prices@1', 'reading', …)` |
| `acme/stocks` 1.0.0 | uses `ext.acme.prices@1` at minor 0 with the same digest | `deep.use('ext.acme.prices@1')` |
| `acme/acme` 2.0.0, the update | provides `ext.acme.prices@2` only, no adapter row for `@1` | `deep.provide('ext.acme.prices@2', …)` |

## Criteria to tests

The ID is `#1828.` and the first 8 hex digits of the SHA-256 of the criterion's checkbox text, trimmed, white space
collapsed (`scripts/proof-change.mjs`'s `criterionId`); the test's name starts with `AC3` and the ID.

| AC | ID | File | What it asserts |
|---|---|---|---|
| AC3 | `#1828.44a54c78` | `update.test.ts` | the starting world installs (both `deep install`s exit 0); the update's `deep install`, run in the background, raises an ask before it ends; 5 s later exactly one `ask.created` names `acme/acme`, `2.0.0` and `ext.acme.prices@1`, and `deep inbox --json` lists it; it is an authority ask, `may_answer: trusted_path`, naming `acme/stocks`, with a yes and a no; the install is still waiting; `installed.json` still says 1.0.0 and no `2.0.0-*` folder exists; `deep inbox answer` with the yes exits 0; the install then exits 0 printing `Installed acme/acme@2.0.0`; `installed.json` says 2.0.0; still one ask; the record holds one `ask.answered` for it, `allow` |

On the base it fails at its first assertion on the ask: the install ends at once with the host's "no asks core"
refusal and no ask is raised (BASE-FAILURE.txt).

## Choices

- **Which ask is `extension.update`'s.** The record doesn't carry the source an ask was raised from, so the test
  knows it by that source's row in ask.sources@2 (`packages/asks/sources.json`): an authority ask answered only on
  the trusted path whose question names the update, the interface it drops and the piece that uses it. The test
  doesn't hold the question's exact words.
- **"One ask"** is read twice while the install waits, 5 s apart, and again after your yes.
- **"Installs nothing before your yes"** is read three ways while the ask is open: the `deep install` has not ended,
  the installed version is still 1.0.0, and none of 2.0.0's bytes were copied into the hub's extensions folder.
- Your no is not part of this criterion and is not tested here.

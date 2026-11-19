# Acceptance test for #1879 AC1, blind redraft

A redraft of #1879's first criterion only. A job that never saw an implementation of #1879 wrote it, and none exists
at the base (`c740dede7`). The implementing agent doesn't edit these files (AGENTS.md, Proof). A dispute goes to
another blind redraft (design: Dogfooding).

## What was read

- Issue #1879 (`gh issue view 1879`): its text, Scope, the three criteria, Proof ("The two starts on a real hub, the
  first failing on the merge base") and Depends on (#348). Only AC1 is written here. The ID comes from the checkbox
  text.
- `docs/technical-design.md`: "One hub per user, a tiny hook client, and extensions in-process", "Extension API
  (TypeScript, in-process)" and "Dogfooding". Also `AGENTS.md`.
- The base, for surfaces and conventions only:
  - `packages/hub/src/hub-command.ts` (`deep hub run [--root] [--safe]`) and `server.ts`'s `runHub` (the ready line).
  - `core.ts`, where each installed package is loaded at start and a refused one is written to stderr as
    `deep hub: extension <id>@<version> not loaded: <reason>`.
  - `install.ts` and `trusted-actions.ts`: `deep install` checks, then loads, and prints `It is not loaded: <reason>`
    when the load is refused.
  - `mcp-operations.ts`: find_actions lists the actions that loaded plug-ins offer, and needs no session.
  - `packages/extension-host/src/host.ts`: its safe-mode refusal `safe mode: the hub loads no extension`.
  - `scripts/proof-change.mjs` (`criterionId`) and `scripts/lanes.mjs` (`testGlobs`).
  - The suites `1922`, `348`, `317` and `363` for layout, how they start a hub and install packages, and the
    action fixture.

## Criterion and file

The `describe` title is the criterion's ID followed by its text. The ID is `#1879.` plus the first 8 hex digits of
the SHA-256 of the checkbox text after `- [ ] `, trimmed, with whitespace collapsed (`scripts/proof-change.mjs`'s
`criterionId`).

| AC | ID | File | Test |
|---|---|---|---|
| AC1 | `#1879.c42142c0` | `safe.test.ts` | a hub started with `--safe` lists none of the installed package's actions, and a load of it is refused with the safe-mode reason |

## Run it

On Linux or macOS, with the repo's Node (24.22.0) first on `PATH`:

```sh
npm ci                                       # once
npm run build --workspaces                   # the test runs packages/cli/dist/main.js
cargo build --locked -p deep-hook            # the hub won't start without target/debug/deep-hook
NO_COLOR=1 node node_modules/vitest/vitest.mjs run --root tests/acceptance/1879-redraft-ac1
node node_modules/typescript/bin/tsc -p tests/acceptance/1879-redraft-ac1/tsconfig.json
```

The proof lanes run it the same way with the repo's `vitest.config.ts` and no flags:
`node node_modules/vitest/vitest.mjs run tests/acceptance/1879-redraft-ac1`. The test sets its own timeout of 600 s.
It starts two real hubs, one after the other, and its sandboxed plug-in runs through the supervisor. So it belongs
in `alone` in `scripts/lanes.mjs`. This job didn't add it there, because it writes only into this folder.

- **Safety:** every folder is under `/tmp/dh1879r1-*` and is removed after the file. Every hub, `deep` command and
  `deep mcp actions` runs with `HOME` in that temp folder and without the caller's `DEEP_*`, `CLAUDE*`, `CODEX*` or
  `NODE_OPTIONS`. Every process is one this file started and is stopped by its PID. A hub's leftover process group
  is the one it leads and is signalled as `kill(-pgid)` only after the hub ends. Nothing is stopped by name or
  port. Nothing leaves the machine.
- **Needs:** nothing beyond the build. No network, no model.

## The world (`helpers.ts`)

The world is a temp home, a project folder that every `deep` command runs in, and a stubbed OS confirmation
(`DEEP_HUB_TEST_CONFIRM`, as in #1922's and #363's suites), so `deep install` counts as you.

The one package is `test/safe1879@1.0.0` (`fixtures/probe`). The fixture folder is copied, `index.ts.fixture` is
renamed, and the digest is set with the extension host's `packageDigest`. When the package loads, it registers one
read action, `ext.safe1879.ping`, which returns its input text in upper case and the text's length. An action whose
answer is only a success flag fails conformance, so it returns real output.

## How the criterion is read

1. **"One installed package."** The package is installed as you with `deep install <folder>`, on an ordinary hub
   (`deep hub run`) in the same home. That hub is then stopped by its PID. On that hub, the install must exit 0 and
   find_actions must list `ext.safe1879.ping`. This shows the surface does show a loaded package. If the harness
   can't get that far, the test throws `BLOCKED`. It never passes in that case.
2. **"No package is loaded."** The same home, started with `deep hub run --safe`. Through `deep mcp actions`,
   find_actions lists no action of `test/safe1879`, right after the ready line and again every 0.5 s for 5 s.
   A package's loaded code is what puts its action on that list, so an empty list means it wasn't loaded.
3. **"A load is refused with the safe-mode reason."** Two loads count:
   - the one the hub tries at its start for each installed package;
   - the one you ask for, `deep install` of the same folder on the safe hub. `deep install` loads what it installs.

   The test passes when either refusal shows the extension host's text `safe mode: the hub loads no extension`:
   - a line of the safe hub's output (stdout or stderr) that names `test/safe1879` and holds the reason;
   - or `deep install`'s output holding it. That output is about this one package only.

   After that install, find_actions still lists none of the package's actions.
4. **"On the merge base the package loads, and the test fails naming it."** At the base, step 2 fails:
   `the hub started with deep hub run --safe loaded test/safe1879: find_actions lists [...]`. See BASE-FAILURE.txt.

## Known limits

- Step 3 has never run on a program that passes step 2. The base fails before it, and no implementation was seen.
  The refusal is read only as words on the hub's output or `deep install`'s output, not from the record.
- "No package is loaded" is read through find_actions, which an agent sees. A package that loaded but registered no
  action wouldn't show there. The fixture registers one, so its load does show.
- AC2 (the same hub started without `--safe` loads the package) and AC3 (the floor's safe-mode suites) aren't
  written here. Step 1 does load the package on an ordinary hub, but only as this test's precondition: it starts
  that hub before the install, not as a restart.

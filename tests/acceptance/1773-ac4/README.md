# Acceptance tests for #1773, criterion 4: `toolLists` skips `deep-actions`

Written first, blind, by a job that saw only the issue, the design and the base commit (e0c90a5a, origin/main); no
fix exists there. The implementing agent doesn't edit these files (AGENTS.md, Proof); a dispute goes to a blind
redraft of this job (design: Dogfooding).

## What was read

- `AGENTS.md`; issue #1773 (`gh issue view 1773 -R windoliver/deepbuild`): its body, Scope, four criteria and Proof.
- `docs/technical-design.md` where it names MCP tool lists at a session's start.
- At the base, for surfaces only: `packages/hub/src/mcp-servers.ts` (`toolLists`, `sourceOf`, `listOf`: user config
  read from `homedir()`'s `.claude.json`, stdio servers started and asked initialize then tools/list) and
  `packages/hub/src/setup.ts` (the `~/.claude.json` entries `deep setup` writes: `deepbuild` as `{type: 'stdio',
  command: <deep>, args: ['mcp']}` when installed, and `'deep-actions'` as `{type: 'stdio', command: <deep-hook>,
  args: ['mcp', 'actions']}`); `scripts/proof-change.mjs` (`criterionId`); `tests/acceptance/1731` and `1338` for
  layout, tsconfig and README conventions.

## Criterion and file

`#1773.260e61bd`: "With `deep-actions` registered in `~/.claude.json` beside `deepbuild`, as `deep setup` writes it,
`toolLists` neither starts that server nor returns a list for it. The merge base lists `deep-actions`"

The ID is `#1773.` and the first 8 hex digits of SHA-256 of the checkbox text after `- [ ] `, trimmed, white space
collapsed (`criterionId` in `scripts/proof-change.mjs`).

- `deep-actions.test.ts`: a fixture HOME whose `~/.claude.json` registers `deepbuild` and `deep-actions` in the
  shapes above, plus a third-party stdio server `notes`. Each command is an executable wrapper named as the real
  program (`deep`, `deep-hook`, `notes-mcp`) that runs `server.mjs` with the config's args. It calls
  `toolLists(cwd)` from `packages/hub/src/mcp-servers.ts` with HOME set to the fixture, and judges: `notes` started
  and listed (else BLOCKED, so a `toolLists` that lists nothing can't pass), `deep-actions` never started (no marker
  file) and not in the returned lists. `deepbuild` is not judged here (criterion 2).
- `server.mjs`: a tiny real stdio MCP server; writes `<markers>/<name>.started` when started, answers initialize
  and tools/list with one tool `<name>_tool`.
- `BASE-FAILURE.txt`: the run at the base, failing because `deep-actions` is started and listed.

Run: `NO_COLOR=1 node node_modules/vitest/vitest.mjs run tests/acceptance/1773-ac4` and
`npx tsc -p tests/acceptance/1773-ac4/tsconfig.json`.

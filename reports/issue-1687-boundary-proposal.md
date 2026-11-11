# Proposed prerequisite for closing #1687

The issue's frozen dependency criterion and its one blind redraft agree: core (including issue-named hub core and reachable helpers/types) must not import concrete extensions. No check is weakened or removed by this proposal.

## Approval requested from the person

Authorize a check-owner edit limited to construction/import/type setup and the corresponding surface description in:

- tests/acceptance/822/hub.test.ts
- tests/acceptance/822/README.md

Use the same outer createCore composition entry as core-worker.ts and server.ts, instead of bare new Core(options, emit). Keep all seven deadline cases, expected values, real record/supervisor/sandbox/process checks, fake-clock timing and cleanup unchanged. The direct-Core setup cannot supply required concrete providers after core's import closure is made extension-free; an optional default helper merely restores forbidden imports. No hidden registry, dynamic-loader disguise, process proxy or copied extension implementation should be used.

With that construction-surface approval, required domain providers can be supplied inward from an outer hub runtime module (checks, environment, decisions, knowledge, forge, workspaces), with no Core->runtime import. Public package exports, socket/MCP behavior and the fake-clock test remain unchanged.

## Other one-time check dispositions

- Original #1687 retained-name oracle flags ordinary local const judged / const runs. The already-created blind ownership redraft passes actual hub/Host/asks moves, with source-pattern/oracle controls. Approval is needed to replace only those original retained-name checks with the frozen redraft; never rename locals or silently skip assertions to game them.
- AC3 redraft has a BLOCKED assertion requiring review of nine computed loader targets across production (including required plugin loaders outside core). Approve independently recorded loader-edge review as that completeness proof, not a ban on dynamic loading and not an automatic PASS. Original absolute extension boundary remains enforced.

Any guarded proposal still follows repo's signed approval mechanism; no signature or approval token can be fabricated by the agent. This file is a proposal, not recorded approval. User messages requesting completion of all gaps are not treated as approval to change acceptance checks' protected setup without this concrete scope.

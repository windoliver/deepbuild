# #1686's planted wrong programs

PR #1710 routed the twelve reads the issue names through `readFacts`, so the merge base already passes every test of
this suite, and each test is proven instead by a wrong program laid over the change. Each twin is a `lines.json` of
the wrong lines (scripts/twins-lint.mjs, the line form):

- `facts-by-path` (`#1686.b9fba25b`): `packages/conformance/src/gate-play.ts` reads Claude Code's facts by
  `join(REPO, 'adapters/claude-code.facts.json')` again, as on the merge base. `tests/facts-entry.test.mjs`, with the
  pattern this change widens to see that form, lists `packages/conformance/src/gate-play.ts:41`, so the suite's
  facts-entry test fails at its `expect`. Under the merge base's pattern the same line passed.
- `refusal-dropped` (`#1686.0140ed0a`): `readFacts` in `packages/adapters/src/facts.ts` checks no name, so
  `readFacts('../package.json')` reads the repo's `package.json`; the test fails at `expect(refused).toBe(true)`.
- `another-agents-facts` (`#1686.1341dfbb`): `readFacts` reads Codex's facts when asked for Claude Code's, so the
  hub's mods tests and runner's unit tests fail.
- `stop-cause-wrong` (`#1686.1341dfbb`): the facts engine in `adapters/index.mjs` calls every reached limit
  `rate_limited`, so `tests/adapters.test.mjs` fails (`expected 'rate_limited'` … `'plan_window_spent'`).
- `otlp-reads-loops` (`#1686.1341dfbb`): otlp reads `loops.facts.json` in place of Claude Code's, so six of otlp's
  tests fail with a 500.

Each was laid over an APFS clone of the change, built with `npm run build --workspaces` and the suite run with
`vitest run tests/acceptance/1686` (this Mac, Nov 26, 2026, load about 40); each test of a tag failed at its own
`expect` under at least one of the tag's twins.

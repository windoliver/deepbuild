# An approved change to this suite's world

On 2026-11-14 the owner chose, on PR #2502, "Original + window fix": keep this suite as #1342's proof, with its
world giving the agent's account a sign-in and one plan-window reading.

Why: every job on the runner waits for its account's first plan-window reading (`packages/runner/src/runner.ts`,
`window`). Without one, the research job never started, no card came, and no right program could pass. Suites 1328
and 63 report a reading the same way. The blind redraft, `50697f597` on `worktree-agent-a8877d81b96755549`, confirmed
the gap. It wasn't taken, because it chose a different contract.

What changed: `helpers.ts`'s `World.open` only, after the hub starts. It writes `.claude.json` with an `oauthAccount`
into the world's home and reports one `windows.report` with room. No test, assertion, fixture answer or plant changed.

# #2068 closure run plan (fixed before this run)

Base: 2baafea73726387c4fabe5057599be0831774f0a. Head: rebased fix/2068-forge-read at 4fe072f32864040fe7fbf36a305cc17e233ea7aa plus a tightened core.ts line ceiling (2637). No production behavior change is planned to address the test environment.

Environment correction: previous ENOTEMPTY leftovers contain only .claude/.claude.json and .claude/backups created by real claude auth/plugin probe children after test teardown. Both sides now receive a PATH containing Node 24.22.2, Rust 1.99.1, and system utilities only; no personal executable directories, real claude or gh, forge tokens or agent billing variables. No test, assertion, cleanup function, provider response or product clock is changed. The original #2068 fixture already supplies its own equivalent allowlisted child environment.

Scheduling correction: one file/worker at a time (test config or VITEST_MAX_WORKERS=1) avoids starting the causal timing scenario alongside unrelated hub process tests. No delay, threshold, scenario value, timeout or test identity is changed. Past inconclusive observations are retained and never converted to passes. This is one environment-corrected run, not retry-until-green.

1. Build both checkouts separately under one build grant. Retain output and status; no stale binaries cross from head to base.
2. Run the unchanged #2068 config once on each side, serially. Expected base: slow/never/pages cases fail on wait/fallback assertions; instant case and all six reused #322 tests pass. Expected head: ten tests pass, none skipped.
3. Run the existing added regressions and affected neighboring files once after the environment correction. Retain all results.
4. Run unmodified scripts/affected.mjs with explicit relevant proof surfaces on base/head, VITEST_MAX_WORKERS=1 and the same hermetic PATH. Compare inherited lint findings by key; do not alter known-failures.json, suppress a failure, or call the raw affected run green if it is not. No WIDE/INCONCLUSIVE line may be hidden.
5. Review full source selection and disclose unrun suites, rather than interpreting an inherited unrelated lint as an open acceptance criterion. All three issue criteria require an actual check result. The machine proof trace's literal-tag metadata is a separate tooling limitation; original blind tests are immutable.
6. Only when all three criteria have qualifying base/head evidence and role/regression proof is sound, mark the existing PR ready with Closes #2068. Do not merge or close the issue manually. Preserve original dirty workspace, failed output, and all unchanged checks.

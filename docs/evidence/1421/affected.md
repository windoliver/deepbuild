# `node scripts/affected.mjs --timed` for #1421

At f873e191 on main d4ed7be7, with the workspace packages built; 2427 s at load 17 (other sessions ran beside it).

    FAIL affected: 189 new, 17 already failing on main, 128 inconclusive or blocked, 0 listed skips, 207 passed

No WIDE line. Its INCONCLUSIVE lines: 2 slow files not run (`tests/acceptance/379/perf-lane.test.ts`, `tests/acceptance/48/harness.test.mjs`); the reference-Mac budget and GPU suites (#465, #365, #262, #18 and others), INCONCLUSIVE off the Mac; the macOS-counter tests (#1404, #724) BLOCKED. Its shards fell back ("SHARD n not used: Try 'cp --help'"), so the alone block ran unsharded.

The 189 "new" failures, none from this change:

- 145 whole-repo lint lines, on files this change doesn't touch: deps (40), secrets (52, home paths and keys in other issues' fixtures), canvas-lint (26), cards (11), slots (6), guide (2), drift, record reader, canvas-closures, slot kits.
- 44 test failures. The node files that reach perf (`tests/acceptance/568/*`, `594/*`, `689/preflight-env`, `tests/preflight.test.mjs`) were run again on a clean main d4ed7be7 checkout with its own `node_modules`: every one of their failures fails there too. They come from this machine: `cargo-clippy` isn't installed for the `stable` toolchain (so preflight's lint lane fails and perf is BLOCKED before measuring), `EISDIR` copying main's `scripts/agents-page-shots`, and the limit judge's INCONCLUSIVE off the reference Mac. The one that passed on main, 689's "RUSTUP_HOME and CARGO_HOME set", hit its 120 s timeout under load here (`spawnSync … ETIMEDOUT`); rerun alone on this branch it passes in 86 s. The rest are reference-Mac `budgets.test.ts` suites and #896/#383/#379, which judge through `judgeTask`'s default metrics (p50Ms, p95Ms, peakBytes), where this change leaves `compare` as it was.

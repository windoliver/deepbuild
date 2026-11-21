# Evidence for #2896: a reply reaches the agent whole

Recorded on the Mac (MacBook Pro), 2026-11-19 and 2026-11-20, while other sessions were busy (the load noted in each run file).
Paths are redacted (`~`, `<scratch>`).

## On the current code (merge of origin/main, after review round 5)

- `suite-run.txt`: the blind acceptance suite, `tests/acceptance/2896`, run serially on the merged branch: **11 of 11 pass**,
  each criterion's planted wrong program among them (`reply-cap-64kb`, `pager-drops-edge-row`, `refusal-schema-12000`,
  `unknown-client-64kb`, and AC1's planted facts file).
  - The Codex walk takes 115 pages (largest 14,148 characters, about 5,400 tokens of 8,000). The Claude Code walk takes 46
    pages (about 35,131 characters and 13,400 tokens of 40,000 and 20,000). Each walk returns all 10,000 rows, and the Codex
    walk's rows hash to the base's (`9913f78e…`).
  - The unknown client's full page is 7,113 characters and 2,717 tokens.
  - deep_drive's `missing_field` (7,907 characters) is the largest refusal. Every refusal is under 9,000 characters as each
    stand-in receives it.
- `unit-fails-first*.txt`: `packages/hub/test/reply-fit.test.ts` run on the code before each review round's fix, failing for
  the reasons the tests name:
  - round 2: a nested path's argument, the whole-schema sentence, Codex's error source, and a call asked once;
  - round 3: a canvas refusal's issues, and the tokenizer's square-time count (5 s timeout);
  - round 4: `by_code` on a first cut, and one token lost at a cut;
  - round 5: two tokens lost at a cut.

  On the current code all 9 tests pass. The hub's MCP neighbours pass too (`canvas-hub-failure`, `mcp-rebind`,
  `mcp-tool-name`, `tools`): 18 of 18 tests in all.
- `cargo-deep-show.txt`: `cargo test -p deep-show` on the merged branch ran 18 test binaries: 85 tests passed and 3 failed.
  - The failures: `the_published_schedule_matches_its_committed_snapshot` (the module set digest differs from
    `schedule/core.json`), `recipe_frames` (`film.blank`), and `render_back_pipeline` (216 pixels off the base's draw).
  - With this branch's four `deep-show` sources put back to the merge base, the same three fail the same way. They come from
    this Mac or main, not from this change. None of them is in `scripts/known-failures.json`.
- `ab-deep-mcp-30d.tsv`: AC7's `deep-mcp-30d` budget command (`node benchmarks/mcp.mjs` under `/usr/bin/time -l`), 5 interleaved
  rounds per side. The base is a fresh GitHub clone at the merge base `4bf2fc7ad`.
  - Instructions retired, median: 4,233.6 M on the change against 4,243.4 M on the base.
  - Peak memory footprint, median: 94.57 MB against 93.50 MB. Max: 94.81 MB against 94.94 MB.
  - This Mac is not the reference Mac, so this is an indication only (AC7 below).

- `draw-ab.tsv`: the walk's 10,000-item draw through `deep mcp`, whose answer wait is 55 s, at the merge base `768bb6051`
  and on the change, alternating, 4 rounds each, at load 74 to 137. Every draw was presented. The medians are 45.0 s on the
  base and 41.9 s on the change. At that load the draw comes within seconds of the wait on both sides. That explains the
  first lanes run's `unavailable` (did not answer in time) at load 106, and it is not a slowdown from this change.

## Earlier runs, on earlier code (kept for what they show)

- `pages-run.txt`, `walk-run.txt`: the same suite's AC2 and AC3/AC4 files at cfb1a94b9, before the review fixes.
- `e2e-pages.json`, from `e2e.test.ts.txt`: a manual drive at cfb1a94b9 through `deep mcp` over stdio on a fixture hub. Three
  clients each page a 3,000-row document's rows by cursor and `deep_kinds`' sheet by offset: Claude Code 2.1.308, Codex
  0.166.0-alpha.5.1, and an unknown client. Their stand-ins keep every page whole.
- `live-claude-attempt.json`, from `live.test.ts.txt`: a real Claude Code (bundled 2.1.326) with `deep mcp` as its MCP server.
  The call reached `deep mcp`, but the fixture hub refused it with `no_session`. So a real session receiving a full page whole is
  **not shown**.

## Not proven here

- **AC7** (budgets on the reference Mac in the local preflight): open. The walk's whole cost is in `suite-run.txt` (115 and 46
  calls, and each page's tokens), but no preflight has reached perf. The A/B above is this Mac's only.
  - `ac7-preflight-mac18.txt`: `scripts/preflight` on this Mac, in a fresh GitHub clone of #2940 with #2957 (the Mac18,1
    as a fourth reference Mac) merged in locally. The lint lane failed with 356 FAIL lines across secrets, canvas-lint,
    deps, waits, size, the vendor patch table and copy literals. None names a file #2940 changes. So perf could only be
    BLOCKED, and the run was stopped during the unit lane, since it held the machine's exclusive timed grant.
  - Main's own preflight wasn't run here to confirm the same failures. AC7 needs a preflight whose checks pass, on main
    with #2957 merged.
- **`node scripts/affected.mjs` on the final tree**: not completed. A run on c08aa56d4 was stopped after 2.5 h, when the disk
  fell under its floor and it began building in this worktree. The checks above were chosen by hand instead.

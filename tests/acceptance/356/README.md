# Acceptance tests for #356: wiki setup, reading your history once, re-reading without rewriting

Written first, blind, by a job that never saw an implementation of #356 (none exists). Second attempt: the first died
on API timeouts before writing a file; its design notes were reused where they held. It read:

- issue #356 (Scope, 7 checkbox criteria, Proof, Depends on) and #357's text for scope boundaries only
- `docs/technical-design.md`: the `wiki` row, The learned layer, Reading by reference
- `AGENTS.md`; the suites of #355 (wiki), #63 (reading, fake reader, budgets), #19/setup (`deep setup` in a temp
  home, launchd stand-in) and #326/setup (`deep-app --set-up`)
- public entries: `@deepbuild/wiki`, `@deepbuild/reading`, `packages/hub/src/setup.ts`, `packages/cli/src/main.ts`
- base commit `c733840f` (origin/main)

The implementing agent doesn't edit these files (AGENTS.md, Proof). A dispute goes to a blind redraft of this job.

## How to run

```sh
export PATH=~/.local/share/fnm/node-versions/v24.22.0/installation/bin:$PATH
npm ci; npm run build --workspaces
cargo build --locked -q -p deep-hook; cargo build --locked -q -p deep-app --bin deep-app
node node_modules/vitest/vitest.mjs run --root tests/acceptance/356 --no-file-parallelism
node node_modules/typescript/bin/tsc -p tests/acceptance/356/tsconfig.json
```

- Folders are under `/tmp/dh356-*`. HOME is a temp folder for every child. No network, no model call: `claude` on the
  login PATH is `fixtures/fake-reader.pl` (a copy of #63's), `launchctl` is #19's launchd stand-in (`fixtures/`).
  Processes are stopped by PID only.
- `--no-file-parallelism`: every file starts real hubs. The implementer adds the folder to `scripts/lanes.mjs`'s
  one-at-a-time list.
- macOS only (launchd stand-in); elsewhere BLOCKED, never a pass.

## The surface under test

All of it is merged surface except the three *invented* readings below.

1. **`deep setup`** (#19) in a temp HOME holding Claude Code history (`~/.claude/projects/<dir>/<id>.jsonl`, entries
   with `uuid`, `message`, `cwd`), Codex history (`~/.codex/sessions/<y>/<m>/<d>/rollout-*.jsonl`) and memory
   (`~/.claude/CLAUDE.md`, repo `CLAUDE.md`). The fake agent is first on the login PATH; the status line forwarder's
   stand-in (`deep-hook statusline` fed `rate_limits`) reports plan windows, as #63's `runReading` does.
2. **`deep-app --set-up`** (#326) and the first `deep status`: the same steps as `deep setup`.
3. **The wiki** at `<home>/.deepbuild/wiki/`: `index.md`, `log.md`, `you.md`, `setup.md`, `rules.md`, `repos/<name>.md`;
   claim lines in #355's format (`- <text> <!-- deep:claim {"id","known","proof","sources"} -->`). Pages are found by
   their claims' quotes, not by name, except the names above (*invented*: the page names are pinned here because the
   issue names "a page about you, one per repo, the setup and your rules").
4. **The ledger** `<home>/.deepbuild/ledger.db` through `@deepbuild/record`, opened read-only after the hub is stopped
   by PID; `events.read` through the hub socket while it runs; `reading.finished@1` events (#63) per reading job.
5. **The runner's jobs** (`job.list`, `job.output` on the hub socket): every free-text read is a runner job of kind `read`.

### Invented here

- **Done**: `deep setup` exits 0 only when its pattern matching is written to the wiki and each reading job it started
  has either finished or is waiting on the plan reserve. A job's findings are on its pages before its
  `reading.finished` event is appended. The tests wait for every started job to finish (bound 300 s).
- **What setup prints** (non-quiet `deep setup`): one stdout line per wiki page whose bytes changed, containing the page's
  path relative to the wiki (`repos/api.md`); `index.md` and `log.md` are never named. A rerun on unchanged history
  prints no such line. (#326's click and first command still print one line each.)
- **Open merge ask**: an unclear merge is one open ask (`inbox.read` on the hub socket) whose question names both
  entities' keys; nothing is merged; a rerun adds no second ask.

## Readings where the issue and the design leave a choice

- **Facts come from `remember:` lines** in your messages (the fake reads them, cited at their message) and from memory
  files (rules). How an implementation's pattern matcher finds start commands is its own; the fixtures state each fact
  both ways so either route passes. The tests never pin a heuristic.
- **"Changes no page"** is byte equality of every file under the wiki except `log.md`, which may only grow by appended lines
  (old bytes a prefix). The issue says re-running "shows only what changed", so a log line is allowed.
- **"A line you deleted"**: the test removes one claim line from a page file and runs setup again. The line is not back, and
  no other page changed.
- **Unclear merge** (2nd half of `482272ce`): a session whose cwd was deleted names repo `shop`, and a live repo `shop` is
  elsewhere. Both paths are exact keys that differ, so nothing merges; the name match alone is the unclear case.
  #357 may later turn install-time asks into deferred questions; the test reads only that one open ask names both keys.
- **Merge keys**: the same repo path in a Claude Code and a Codex session merges into one page, and the same command
  into one claim with `proof` 2. Two repos both named `api` at different paths stay two pages; `npm run dev` and
  `npm run dev:api` stay two claims; `GITHUB_TOKEN` and `GH_TOKEN` stay two.
- **Credentials**: canaries are made-up (Stripe-, GitHub- and URL-password-shaped). They appear in transcripts, tool output,
  an `.env.local` and a Codex `export`. The sweep covers every file under `~/.deepbuild` except `evidence/` (the archive's
  scrubbed copies are #20's) and `jobs/`, in raw, base64 and URL-encoded forms. Names and sources (`GITHUB_TOKEN` from
  `gh auth token`, `STRIPE_API_KEY` from `.env.local`) must appear, so an empty wiki doesn't pass.
- **Read position**: observed through what the fake was delivered (every prompt and tool result it reported). Each old
  message has a unique tag; after the second setup no old tag is in any job that ran in it, and every new session's tag is.
- **Superseded**: a later session says `remember: the api starts with make dev, not npm run dev`; the old claim's line stays on
  the page with both quotes and reads superseded; the slice holds the new one only. Whether the state is `superseded`
  in the JSON or the text is the implementer's: the test accepts the word `superseded` on the line or in its JSON.
- **Timing/plan**: 60 s and 5% count only on a reference Mac in a fit state (#63's gate); elsewhere INCONCLUSIVE with the
  reading. The 4,000-token start slice is a size, judged anywhere, tokens = characters / 4 (nothing in the base defines
  it). The 5-hour window is #63's `WINDOW_TOKENS` calibration (20,000,000).
- **Left out**: the one-time choices (agent, accounts, reserve share, test resources): the issue names no key to pin and
  AGENTS.md forbids inventing one. "Fade faster" is #357's. "No model of its own" has no cheap observation beyond the
  fake being the only agent called.

## Criteria to tests to wrong programs

| ID | Criterion (short) | Tests | Wrong programs |
|---|---|---|---|
| `8e6a9c42` | rerun changes no page; a deleted line stays gone | `rerun.test.ts` | `rewrites` (plant: setup rewrites every page each run), `resurrects` (plant: deleted line relearned) |
| `65dd8324` | no credential value anywhere | `credentials.test.ts` | `copies-values` (plant) |
| `482272ce` | merge on exact keys only; unclear merge asks | `redraft/merge.test.ts`, the blind redraft (below) | `merge-by-name`, `never-merge` (plants) |
| `2339938d` | first finding within 60 s | `click.test.ts` | none planted: the 60 s measure on the real clock is the check (weak: small fixture, see Not done) |
| `abc13a7b` | after the one click the wiki exists | `click.test.ts` | the base (no wiki) |
| `c8728339` | < 5% of a window; start slice < 4,000 tokens; perf-lane task | `budgets.test.ts` | none planted: the plan share is read from the fake's own token counts, so a job that pastes history goes over 5% on its own; the slice size is a plain count |
| `e1fe5789` | ten new sessions read from their position; superseded with both quotes | `reread.test.ts` | `rereads-all`, `deletes-contradicted` (plants) |
| Proof | setup on the fixture corpus, the pages, a second run changing nothing | `rerun.test.ts` Proof | the base |

## Planted programs

The implementer adds each behind `DEEP_HUB_PLANT=<name>` (set for `deep setup` and inherited by the hub through the launchd
stand-in): `rewrites`, `resurrects`, `copies-values`, `merge-by-name`, `never-merge`, `rereads-all`, `deletes-contradicted`. The files with plants (`rerun`, `credentials`, `merge`, `reread`) have a `(wrong program)` case that runs the scenario under the plant and expects the check's problems. `checks.ts` holds pure checks returning problems; each has a test on hand-built input, so the check itself can fail.

## Files

`helpers.ts`, `setup19.ts` (a copy of #19's setup helpers, temp folders `/tmp/dh356-*`), `history.ts` (fixture sessions, canaries, the 212-session corpus), `machine.ts` (the reference-Mac gate and timing judge, copied from #63), `checks.ts`, `fixtures/` (fake reader, launchd stand-in, stubs), `rerun`, `credentials`, `merge`, `reread`, `click` and `budgets` `.test.ts`, `tsconfig.json`, `BASE-FAILURE.txt`.

## Not done, and weak spots

- **No sample fix was run.** No test here has passed on any program, so some may be unpassable for a reason the base can't show (the page names, "done" meaning every runner job ended, `inbox.read`'s shape, the start slice's project id). The first implementer to pass them reports any such case as a redraft request and does not edit the tests.
- The start slice is read from the record after appending a `session.start` for project `api`; the project id the wiki scopes claims to is the implementer's, so the slice may be empty on a correct build. Only its size is judged.
- Appending to an already-read session (a read position inside one source) is not tested: only new sessions, 7 Claude Code and 3 Codex.
- The 60 s test uses the small fixture; the 212-session history is only in the budget test.

## Blind redrafts that replaced first drafts

One first draft couldn't pass on any implementation, so it went to a blind redraft of this job (design: Dogfooding):
a fresh run with the issue, the design and the base commit `c733840f`, never the work, the diff or the dispute. The
redraft fails on the base and passes on the work. On October 29, 2026 the owner approved it in place of the first
draft, and the first draft was removed. The criteria table above names the redraft.

| Criterion | First draft (removed) | Why it couldn't hold | Redraft | Notes |
|---|---|---|---|---|
| `482272ce` | `merge.test.ts` | its `claims()` counted every claim line under the wiki, and #355's wiki writes `questions/<repo>/start.md`, a page derived from the repo page that copies each start claim, so one merged claim always read as two | `redraft/merge.test.ts` | `redraft/README.md`, `redraft/BASE-FAILURE.txt` |

# Acceptance tests for #2024: ⌘K for sessions, pasted references and word search over archived transcripts, with the 200 ms budget

Written first and blind, at base commit `cbd5e4f98` (Merge pull request #2284, `origin/main`), from issue #2024 (updatedAt
2026-11-11T18:12:24Z: its Scope, three acceptance criteria and Proof; no comments), the design and the base, before any
implementation. The implementing agent does not edit these files (AGENTS.md, Proof); a dispute goes to a blind redraft of this
job (design: Dogfooding). There is no taste criterion, so no `TASTE.json`.

## What was read

- Issue #2024; for context only, #329 (the parent and its parts), #884 (the word rule) and #1010 (Continue).
- `docs/technical-design.md`: States people see; Keymap, placement, window (⌘K's ranking, One list and one page, Address,
  Actions); Replica; the deep CLI row (`deep open`); Numbers version 0 has to hold (the merge-base comparison, five runs, the
  reference Macs).
- At the base: `crates/deep-app/src/{commands,hub,views,record,open}.rs` (⌘K's `command-list`, `command-none`, `call_app`,
  the page region and its `claim:` node), `crates/deep-replica/src/drive/{mod,hubcopy,plant}.rs` and `deep_drive.rs`
  (`record_copy`, the real clock, `hub` `slow`, `wait_for`, `act type` as one input, `env-plants`),
  `packages/hub/src/{core,server,hookmap,search}.ts` (the app's methods, `openedPr`, the archive pass at start),
  `packages/record/src/archive.ts` (#1515's index), `packages/archive/src/index.ts`, `packages/wiki/src/index.ts`, the
  contracts' schemas (`session.reading`, `transcript.archived@2`, `decision.created`, `verdict.made`), `adapters/codex.facts.json`,
  `scripts/benchmark.mjs`, `benchmarks/budgets.json`, `scripts/proof-change.mjs` (criterion IDs), and the suites `1462`, `1460`,
  `1461`, `1515`, `355`, `20`, `884`, `2018`, `26`, `16`, `1551`, `48`.

## How to run

With Node 24.22 first on `PATH`, the workspaces built, cargo 1.99.1 on `PATH`, on macOS, in a logged-in session:

```sh
npm ci --ignore-scripts && npm run build --workspaces
export PATH="$HOME/.rustup/toolchains/1.99.1-aarch64-apple-darwin/bin:$PATH" CARGO_HOME="$HOME/.cargo" RUSTUP_HOME="$HOME/.rustup"
node node_modules/vitest/vitest.mjs run --root tests/acceptance/2024 --no-file-parallelism --testTimeout=600000
node node_modules/typescript/bin/tsc -p tests/acceptance/2024/tsconfig.json
```

- **The base doesn't build `deep-hook`.** At `cbd5e4f98`, `crates/deep-contracts/src/generated.rs` is stale against the
  schemas (`RULE_322` is used and never defined), so `cargo build -p deep-hook` fails and the hub has no hook client. The base
  run (`BASE-FAILURE.txt`) put the contracts' own regenerated file in place (`generateRust(listSchemas())`, 52 lines differ),
  built, ran, and restored the tracked file; nothing of it is committed. A branch whose main still has that file needs the same.
- **Builds.** #2018's helpers build `deep-drive` with `--features env-plants`, then plain with `deep-hook`, with #1172's build
  environment (`CARGO_INCREMENTAL=0`, `CARGO_PROFILE_DEV_DEBUG=0`), and copy each out of the target folder into
  `$TMPDIR/dd2018-bin-<uid>-<8 hex of the checkout's path>`, so another worktree's build never stands in. `CARGO_TARGET_DIR` is
  honored. Building them ahead of the run with the same two commands makes the suite's builds no-ops.
- **Headless.** No window opens: ⌘K is read in the replica (the real `deep-drive` on GPUI's test platform), `deep open` and
  `deep find` are the built CLI, the hub is `deep hub run`. No Accessibility or Screen Recording permission is needed.
- **Folders and processes.** HOME is a temp folder for the test process and every child; `CLAUDE*`, `CODEX*`, `DEEP_*` and
  `AI_AGENT` are removed first. This suite's folders are `/tmp/dh2024-*`; the helpers it imports make theirs under
  `/tmp/dh16-*` and `/tmp/dh1515-*`; all are removed after each file. Nothing touches the real `~/.deepbuild`, `~/.claude` or
  `~/.codex`. No network. Only what a test started is stopped, by PID (#16's and #26's cleanup). #2018's helpers are imported
  before #1515's, which moves HOME at import, so the cargo builds keep the real HOME; `CARGO_HOME` and `RUSTUP_HOME` above make
  that hold either way.
- **Timing.** AC3's 200 ms is judged only on a fit, quiet reference Mac (#1551's gate: one of the design's three models, mains
  power, Low Power Mode off, thermal state nominal, 1-minute load at most half the cores); anywhere else it reads INCONCLUSIVE
  with its reading printed, never PASS.
- **Time.** About two minutes on the base once the binaries are built (AC3's world of 1,000 sessions is most of it); an
  implementation adds the five timed queries and the perf-lane task's own run.
- **`--root` cache.** Vitest writes `tests/acceptance/2024/node_modules/.vite/`; delete it before committing.
- **Lanes.** `scripts/lanes.mjs` needs `tests/acceptance/2024/` in `alone` (it builds `deep-drive` twice, starts real hubs and
  many replicas, and times one), as `alone.push('tests/acceptance/2024/')`, in a macOS lane; the implementer makes that edit.

## The surface (my choice where the issue names none)

The issue names ⌘K and `deep open <ref>` and no headless surface. The app is read as the real `deep-drive` (#124), driven over
its stdin, launched once with `{"call": "launch", "launch": {"from": "record_copy", "clock": "real"}}` in the world's HOME, so
it copies a real hub's record and its clock is the wall clock (#2018's binaries and `Replica` class, started here because
`Replica.of` launches on the virtual clock; a replica closed and launched again opens no ⌘K at the base). ⌘K
is `act press "cmd-k"`; a query is `act type`, which the replica delivers as one input, as a paste arrives; Return is `act press
"enter"`. No label, reply or log line credits a criterion: every check reads the window's tree, its page address, or the CLI's
exit and output.

### Pinned here: the implementation must provide these

1. **⌘K's search in a replica.** ⌘K's searches are reads of the hub, and in a replica of its copy (design: Replica, "with its
   own copy of the hub"). A replica launched `from: record_copy` answers ⌘K as the hub would answer the app on the record it
   copied: the record and the archive (each session's archived transcript copy, the wiki's claims, the decisions) as they stood
   when the copy was taken, at launch, before any input. Nothing reaches the record after launch, and nothing is read from an
   agent's own transcript files. How the copy holds the archive is the implementation's (a copy of the ledger, the evidence and
   the wiki pages taken at launch, or the hub's search run on such a copy, for instance).
2. **Hits.** Each hit ⌘K lists is a node inside `command-list` (#1462's list box, role `list_box_option`) whose `id` is
   `hit:` and the handle of what it found or names, as the record writes handles:
   - `hit:session:<session ID's letters and digits>#<message>` for a message of an archived transcript, `<message>` as
     `deep find` and `deep_search` name it (#1515: a Claude Code entry's `uuid`, Codex's line);
   - `hit:session:<session ID's letters and digits>` for a session a pasted reference names;
   - `hit:wiki:<page>#<claim>` for a wiki claim, `hit:decision:<id>` for a decision.
   A click on a hit, or Return on the selected one, opens it through #1460's one open.
3. **A session's page at a message.** Opening a message hit shows its session's page: the window's address starts
   `session/<session ID>` (#1460's form; anything after it is the implementation's), and the page holds a node whose `id` is the
   message's handle, `session:<letters and digits>#<message>`, drawn inside the page's bounds (as #1460's claim page holds
   `claim:<ULID>`).
4. **Two queries in flight.** The replica's `{"call": "hub", "hub": {"state": "slow"}}` (#1461) holds ⌘K's reads too: they
   neither answer nor fail. `{"state": "answering"}` again answers every read it held, **newest first**, each with what its own
   query finds. So the earlier query's answer arrives last, the case the criterion guards against.
5. **The wrong programs** (AC2 names two), in the replica's planted build (`deep-drive --features env-plants`, #2018's), each
   selected by `DEEP_HUB_PLANT` and read through the app's own `plain::planted` check, in no shipped build:
   - `commandk-references-only`: ⌘K takes pasted references as the right program does (a pasted PR URL opens its session) and
     finds no words.
   - `commandk-reads-agent-files`: ⌘K finds words by reading each session's transcript from the agent's own file under HOME
     (`~/.codex/sessions/…`, `~/.claude/projects/…`), as the file is, instead of the archive's copy; otherwise right.
6. **A reference nothing names.** ⌘K draws its `command-none` node (the base's "No match"), whose words (its name, value,
   children and the text drawn inside it) say nothing names the query and name each kind a reference may be: a PR URL, an
   issue URL, `#n`, a commit SHA, a branch, a session ID, an agent app link, an ask handle (matched case aside, as `KINDS` in
   `helpers.ts` has them: `PR` or `pull request`, `issue`, `#n` or `#` and a digit, `SHA` or `commit`, `branch`, `session`,
   `link`, `ask`). `deep open <ref>` resolves the reference with the hub before it reaches the app, so with no app running a
   reference nothing names exits non-zero and its output names the same kinds.
7. **The perf lane.** `benchmarks/budgets.json` has a task whose `initialReason` names `#2024`, valid against the merge base's
   budgets (`scripts/benchmark.mjs` `validateBudgets`), whose command exits 0.

### Merged surfaces, used as they are

`deep-drive` and its calls (`launch` with `from: record_copy` and `clock: real`, `close`, `see` with `address`, `act` press,
type and click, `wait_for` with a `t` or an `{id}` locator and `state: visible`, `hub`); the page region whose `id` is the
address (#1460); the base's record of a pull request a session opened, the core's `session.reading` "Opened pull request
<url>" (#83, `openedPr` in `packages/hub/src/core.ts`); a session's page showing its state word, PASS for a passed claim
(#2018); the hub's archive pass at its start, which copies a Codex rollout under `~/.codex/sessions/`, scrubs it and links it by
`transcript.archived@2` (#20), and its index (#1515); `deep find --json --root` (#1515); `@deepbuild/wiki`'s `openWiki` and
`learn` (#355); #2018's `seedRecord`, `Seeder`, `template`, `quiet`, `deep`, `driveBinaries` and `Replica`; #16's `startHub`,
`childEnv`, `own` and temp homes;
#26's `seed`; #1515's `makeWorld` and `handleOf`; #1551's `timingProblem` and `inconclusive`.

### The fixtures

- **AC1 and AC2's world** (`makeWorld`), seeded with the hub stopped, then a real hub started on it:
  - repo `shop`, a git folder (its project `shop`);
  - **X**, a Codex session of `shop` started two weeks ago (`01a1581d-…`, task "Pool retry tuning"): its `session.start`,
    task and prompt in the record, and its rollout at `~/.codex/sessions/<y>/<m>/<d>/rollout-<time>-<id>.jsonl`, dated then,
    whose agent message reads `Token ghp_… is what the reconnect backoff probe used; it now doubles up to 30 s.`, the key a
    fresh github-pat-shaped string each run (#20's shape; no real key). The hub's own archive copies the rollout when it starts,
    scrubbing the key on the way in; the world waits for X's `transcript.archived`, then checks with the base's `deep find
    "reconnect backoff"` that the archive holds X's message and not the key (BLOCKED otherwise). The rollout stays on disk, as
    a two-week-old one does, holding the key;
  - **P**, a Claude Code session of `shop` (task "Cart totals rounding") whose `gh pr create` opened
    `https://github.com/acme/shop/pull/412` (the core's reading), then a stop, its claim and the core's PASS on it. The PASS is
    `verdict.made@1`'s own PASS fixture with its handles set: at the base `verdict.made@2` publishes only a BLOCKED fixture, so
    #2018's `Seeder.verdict` can't write a PASS;
  - a decision of yours ("Keep the reconnect backoff under 30 seconds for the pool; page someone if it stays there") and the
    wiki claim `wiki:repos/shop#reconnect-backoff`, "Keep the reconnect backoff under 30 seconds for the pool", resting on it.
- **AC3's world** is #1515's (`makeWorld({a: 500, b: 500})`): 1,000 sessions with archived transcripts (every fifth Codex, 40
  messages of seeded filler each, about 16 MB), the named sessions among them, and a real hub that indexes them. The suite waits
  up to 5 minutes for the index to hold all 1,000 (read-only, #1515's `archive_sessions`), then copies the record.

## Criteria, tests and wrong programs

IDs are the first 8 hex of SHA-256 of each criterion's text, whitespace collapsed (`criterionId` in
`scripts/proof-change.mjs`, as `tests/acceptance/48/README.md` defines them).

| Criterion | ID | Tests | Wrong programs it fails on | On the base |
|---|---|---|---|---|
| AC1 | `#2024.cb3a3faf` | `commandk.test.ts`: the PR URL in ⌘K, Return: the window shows `session/<P>` and the page reads PASS. A 10-hex SHA prefix nothing names: `command-none` names every kind, and `deep open` with it exits non-zero naming every kind. With the hub slow, "reconnect backoff" typed, taken back and the PR URL typed; the hub answers again newest first: no hit of X, the claim or a decision shows from then on, and P's hit does | a ⌘K that takes no references (the base); one that says only "No match"; a `deep open` that needs the app to say nothing names it; one that shows whichever answer came last (the earlier query's hits, naming them) | FAIL ×3: Return on the URL left `project/shop`; "No match" and `deep open: the app is not running` name no kind; P's hit never showed |
| AC2 | `#2024.a9de042e` | `commandk.test.ts`: ⌘K "reconnect backoff" lists `hit:session:<X>#<message>` and `hit:wiki:repos/shop#reconnect-backoff`; no ten-character piece of X's key is in ⌘K's list; a click on X's hit shows `session/<X>…` with the message's node on the page. The two plants, each: the judge fails naming X | `commandk-references-only` (no word hit, naming X; it must still open the pasted PR URL); `commandk-reads-agent-files` (it lists X's message, read from the rollout, and shows the key, naming X) | FAIL ×3: no hit of X or the claim; the planted builds are the base, so neither is the named program |
| AC3 | `#2024.04c79639` | `budget.test.ts`: a #2024 perf-lane task, valid against the merge base, that runs; over 1,000 archived sessions, a warm-up then five queries, each one hit (`retryWithBackoffJitter`, `επανασύνδεση`, `连接重试失败`, `重试三次`, `稍后重新尝试`), timed from the query typed into an empty ⌘K to its hit drawn: all five within 200 ms passes, all five over by more than the margin fails, else, or off a fit quiet reference Mac, INCONCLUSIVE | the base (no task; no hit ever draws); a ⌘K that reads each transcript per query (over the budget) | FAIL ×2: no #2024 task; the warm-up's hit never drew in 10 s |

The Proof's "the app's budgets, shown failing first" is AC3 at the base: no hit draws over the archive, and no #2024 task.

## Readings where the issue leaves a choice

- **"Pasting"** is the query arriving as one input (`act type`), which is how the replica delivers text and how a paste reaches
  a text field; the replica has no pasteboard of yours.
- **"Opens the session that made it, with its verdict"**: Return on the first hit shows P's page, and the page's words hold
  `PASS`. "Made it" is the base's record of the PR the session opened.
- **"Lists the kinds accepted"** is read as every kind of the Scope's list named in the one line; "says so" is not judged
  beyond the line being there.
- **"With two queries in flight"** needs the earlier answer to arrive after the later one, so the replica's slow hub hands the
  held reads back newest first (Pinned 4). Taking the first query back with Backspace makes more queries in flight, which
  the same rule covers; "the later one" is the last.
- **"Lists both"** reads the two hits by their ids; other hits (the decision holds the words too) may sit beside them.
- **"Opens its page at that message"** is the message's node on the page, inside the page's bounds; where the page scrolls
  to is left to the implementation as long as the node is drawn there.
- **"A secret scrubbed on the way in"** is a key in X's own rollout that the hub's archive scrubs when it copies it (#20's
  scrub). "Never appears in a hit" is read over everything ⌘K's list holds: no ten-character piece of the key.
- **"Reads the agent's own transcript files"** is caught by the key: the rollout still holds it, the archive doesn't. A
  wrong program that scrubbed on its own reading would not be caught; the plant reads the file as it is (Pinned 5).
- **"Fails, naming the session"**: every AC2 failure names X by its ID and task title; each plant test asserts that.
- **The budget's "first hits draw within 200 ms of the last keystroke"**: the query is one input, so its last keystroke is that
  input; the time is the test's wall clock from sending it to `wait_for` answering that the query's one hit is drawn, which
  holds the two frames the replica draws after the input and the protocol's round trips, so it can only read long. Each query
  has one hit in the world, so its first hit is that one. Five runs after a warm-up, judged as the design's "Numbers" section
  says, with #26's margin (5% or the runs' own spread).

## Scope the criteria don't cover

No criterion names these, so nothing here tests them: issue URLs, `#n`, a full SHA or a prefix something names, branches,
session IDs, agent app links and ask handles as pasted references (only the PR URL and an unnamed SHA prefix are tested);
newest first when several match; `deep open <ref>` opening what a reference names in a running app; ⌘K's commands and keys
(#1462); prompts and tool calls' commands and paths as words (only an agent message is tested); decisions as hits; #884's word
rule beyond plain words; the hit's session, agent, repo, state word and line of context as fields; Continue on an ended
session's hit (#1010); nothing from a hit reaching an agent.

## Disputes and assumptions a redraft may revisit

1. **The replica's copy holds the archive** (Pinned 1). The base's `record_copy` copies the events alone. A replica that
   can't search the archive leaves AC2 and AC3 unseen headless; a redraft could move them to the real `deep-app` on the real hub
   (#1459's probe), at the cost of a window and of timing from outside the process.
2. **Newest first** (Pinned 4) is a property of the replica's copy of the hub only, chosen so the hazard happens every run.
3. **`deep open` says nothing names a reference without an app** (Pinned 6). A redraft may accept "no app runs" first, if the
   owner wants resolution in the app.
4. **The PR's tie** is the core's `session.reading` (#83). If the implementation records a PR its session opened in a new
   event, the fixture would need it too.

## Files

- `helpers.ts`: the environment and temp folders, criterion IDs, the world (seeding, the Codex rollout, the hub, the fixture
  check), the replica on the real clock, ⌘K's hits, AC1's and AC2's judges, the index wait.
- `commandk.test.ts`: AC1 (three tests) and AC2 (one test and its two wrong programs), on one world.
- `budget.test.ts`: AC3, the perf lane and the timing, on #1515's world.
- `tsconfig.json`, `BASE-FAILURE.txt`.

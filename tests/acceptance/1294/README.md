# Acceptance tests for #1294: discarding uncommitted edits is destructive

Hard resets, path checkouts and restores, stash drops and clears, and forced switches discard uncommitted edits to
tracked files, which git can't restore. They are staged first. Past the ceiling they become an authority ask, on a
clean tree they run free, and with the hub stopped they are denied with the command for you to run.

A blind job wrote these tests first. It never saw an implementation of #1294. Sources:

- **The issue**, as the job was given it: Scope, the 5 checkbox criteria, Proof and Depends on (#347, #316, #304, all
  done). The criterion IDs come from that text.
- **The design**, `docs/technical-design.md`: "Before each command", especially the bullet "Destructive commands you
  approved"; the Threats row "A broken hub"; the Dogfooding bullet.
- **The base commit**: `58862789` (origin/main). The base code read:
  - `crates/deep-hook/default-rules.json`, and in `crates/deep-hook/src`: `matcher.rs` (`deletes`, `unknown_reach`,
    `stash_unnamed`, `stage`), `shell.rs` (heredocs), `main.rs` (`denials`, the words it prints when it decides alone).
  - `packages/hub/src/staging.ts`, `packages/hub/src/plant.ts`, `packages/hub/src/undo.ts`.
  - `command.staged@1` in `packages/contracts/src/generated/types.ts`.
  - `scripts/proof-change.mjs` (criterion IDs) and `scripts/lanes.mjs`.
- **Sibling suites, for their conventions**: tests/acceptance/347 (the world, `deep-hook claude-code <event>`,
  INCONCLUSIVE, plants; `fixtures/` are copies of its files), 316 and 304 (seeded rules, hub-stopped runs). Nothing is
  imported from them.

The implementing agent does not edit these files (AGENTS.md, Proof). A dispute goes to a blind redraft of this job.

## How to run

You need Node 24.22 (`.node-version`) first on `PATH`, the Rust toolchain, and `cc` (the Xcode command line tools).
The suite runs on macOS with an APFS `/tmp`.

```sh
npm ci                                   # once, if node_modules is missing
npm run build --workspaces               # the hub and the deep CLI the tests start
cargo build --locked -q -p deep-hook     # target/debug/deep-hook, which every hook runs
npx vitest run --root tests/acceptance/1294 --no-file-parallelism --testTimeout=600000
node node_modules/typescript/bin/tsc -p tests/acceptance/1294/tsconfig.json
```

- Each test starts its own hub, so the folder belongs on `scripts/lanes.mjs`'s one-at-a-time list (`alone`), beside
  #347's. The implementer adds it.
- Every test makes its folders under `/tmp/dh1294-*`, because a Unix socket path must fit in 104 bytes on macOS.
- Every process the suite starts gets `HOME=<tmp>/h` and `TMPDIR=<tmp>/t`. The suite never touches the real
  `~/.deepbuild`, `~/.claude` or `~/.codex`.
- `git commit` in the world's repository runs with `-c core.hooksPath=/dev/null` and the world's home.
- The suite stops only processes it started, by PID (`helpers.ts`: `cleanup`, `stopHub`), never by name or port.
- No network, no model, no `claude` binary. A child never inherits this process's billing keys or its `DEEP_*`,
  `GIT_*`, `XDG_*`, `CLAUDE*`, `CARGO*`, `RUSTUP*` or `npm_*` settings.
- A child's `PATH` is Node's folder, `/usr/bin` and `/bin`. The hub looks for `claude` on `PATH` at a session's start
  and runs `claude auth status` (#1033), so a `PATH` with the real one would run it inside the world.
- Time: a test takes seconds to a minute. The timeouts are 10 minutes, for a loaded machine.
- A passing run prints `proof #1294 …` lines: the tree's digests before, after the run and after the undo, each staged
  copy with its digests, and the hub-stopped denial. Those are the issue's Proof.

## The surface under test

These already exist at the base:

- **deep-hook** (`target/debug/deep-hook`), run as Claude Code runs our hook entry: `deep-hook claude-code <event>`
  with the hook's JSON on stdin, a child of the session's own long-lived process (`fixtures/agent.mjs`).
- **`deep hub run`**, with `DEEP_HUB_TEST_CONFIRM` (#24's OS-confirmation stub) and `DEEP_HUB_PLANT`.
- **The socket**, as the cli role with the control token: `events.read`.
- **`deep undo staged:<id>`** (#347), run by the test process, so outside every session, as your terminal is.
- **`~/.deepbuild/rules.json`**, seeded with `crates/deep-hook/default-rules.json`. A new or changed default entry
  reaches the tests through that file. The tests never read a `match`.
- **`~/.deepbuild/config.json`**: `asks` (no batching) and #347's `staging: { files, seconds, keep }`.
- **`command.staged`** (#347): `data.call` is the call's `tool_use_id`, and the handle is `staged:<event id>`.

### Surfaces this suite chose

The design and the issue leave these open. Each is the smallest one consistent with them.

1. **Each staged copy with its digest: `data.files` on `command.staged`.** The issue's Proof asks for "each staged copy
   with its digests". The event gains a list, one item per copied file:

   ```json
   "files": [{ "path": "src/a.ts", "digest": "<sha-256 of the file's bytes>" }]
   ```

   - `path` is relative to the repository's top, or absolute. The test resolves it against the repository.
   - `digest` is the SHA-256 in lowercase hex, with or without a `sha256:` prefix.
   - The list holds the modified files and only them: staging "copies the modified files". `src/keep.ts`, tracked and
     unedited, must not be in it.
   - `folders` and `until` are not read by this suite. What they hold for such a staging is the implementer's call. The
     implementer changes `command.staged`'s schema and the event catalogue.

2. **A stash entry's undo puts the entry's files in the working tree.** The tests read "restore them on undo" as Scope's
   sentence, "`deep undo staged:<id>` restores each file by digest". After the undo, `src/a.ts` in the tree has the
   digest the entry held. The stash entry itself doesn't come back, and the test doesn't read `git stash list` after
   the undo.

3. **A copy of a stash entry's file is a file with its bytes.** A blob can't be cloned, so "stage that entry's files
   first" shows as a file with the entry's SHA-256 somewhere in the world at the allow. A file kept only inside git's
   object store, compressed, doesn't count. See What each judgement reads.

The issue's planted stagers are selected with `DEEP_HUB_PLANT=<name>` on the hub and on every deep-hook run. See Wrong
programs.

### Playing Claude Code

The test is Claude Code. A call runs only when deep-hook's PreToolUse allows it: exit 0 with no `deny` or `block`. Then
the test runs it as Claude Code's Bash tool would, `/bin/bash -c <command>` in the repository, so the edit really is
discarded before the undo. After that comes its PostToolUse.

### The world

Each test gets one `<tmp>` folder:

- `h/` is HOME: `h/.deepbuild` and `h/.claude/projects/...`.
- `t/` is TMPDIR.
- `repo/` is a git repository. `main` holds tracked `src/a.ts` (64 KiB of text) and `src/keep.ts`. The checked-out
  branch `work` adds one commit with `src/b.ts`, so `git switch -f main` really switches and `HEAD~1` exists.

The edit is written straight to the file, as a person or an earlier session did it, so no hook sees it. An edit is
64 KiB of text no other file holds, so a clone of it shows on APFS and a copy of it can be found by its digest.

## What each judgement reads

**Staged before it runs** (`expectStaged`; AC1, AC2, AC3, AC5):

1. Before the call, a file in the tree has its 64 KiB private (the control). If not, the test is BLOCKED.
2. deep-hook's PreToolUse allows the call. A deny or an ask fails.
3. At that moment, before the command runs, a copy exists:
   - an edit in the tree: APFS reads 0 private bytes for the file, so a clone shares every block of it
     (`fixtures/private-size.c`, `ATTR_CMNEXT_PRIVATESIZE`). This is #347's reading: staging is a copy-on-write copy.
   - an edit in a stash entry: a file with the entry's SHA-256 is somewhere under `<tmp>` (`copiesOf`, by size and
     digest, in any folder, `.git` included).

   If not, the test still runs the command, as Claude Code would, and fails with "`<command>` ran with no copy of
   `<file>`".
4. Within 10 s, the record holds `command.staged` for the call, and its `data.files` is exactly the modified files, each
   with the digest of its bytes.
5. The command runs, exits 0 and discards the edit (or the stash entry). If not, the test is BLOCKED.
6. 2 s later, no ask raised since the call names the command.

**Restored by digest** (`expectRestored`): `deep undo <handle>` exits 0, each file again has the SHA-256 it had before
the command, and `git status` lists those files and nothing else.

**No staging and no ask** (`expectFree`; AC3, and AC5's heredoc written to a file):

1. deep-hook's PreToolUse allows the call.
2. At the allow, no file in the world other than `src/a.ts` holds its bytes.
3. The command runs and leaves `src/a.ts` as it was. If not, the test is BLOCKED.
4. 2 s later, no `command.staged` is recorded for the call, and no ask raised since names it. A failure reads
   "`<command>` (call `<id>`) was staged on a clean tree".

**The authority ask past the ceiling** (`expectAsked`, Scope): `staging.files` is 2 and three tracked files are
modified.

- The call isn't allowed. If it is, the test runs it and fails with "`git reset --hard` ran with no ask".
- deep-hook's reply ends within the hook timeout (`hookTimeouts` in `adapters/claude-code.facts.json`).
- An `ask.created` raised since the call has a `question` holding the command, of `kind` `authority`.
- Every edit keeps its bytes, no `command.staged` is recorded for the call, and within 20 s no copy of an edit is left
  anywhere in the world.

The ask isn't answered. Whether a hold denies or waits within the timeout isn't fixed. Either way the call must not run.

**Hub stopped** (`denialProblem`, AC4 and Scope): the hub ran, the session began, and the hub stopped by its PID.
deep-hook then decides alone.

- `git reset --hard` is denied. If it is allowed, the test runs it and fails.
- The denial's text, stdout and stderr together, holds the exact command and the words "to run", as in "ask the person
  to run it". "It runs: …", the matcher's own detail, doesn't satisfy that.
- `src/a.ts` still has its digest and HEAD hasn't moved.
- `git reset --soft HEAD~1` is allowed, runs, moves HEAD and keeps the edit.

### INCONCLUSIVE

On a loaded machine, deep-hook can miss the hub's acknowledgement and decide alone. `decidedAlone` reads the same traces
#347's does, copied here: deep-hook's own words on stderr, no `tool.before` within 10 s, a `tool.before` marked `late`,
and the hub's reading "through as late".

- `expectStaged` and `expectFree` check when the call isn't allowed.
- `expectAsked` checks whenever deep-hook didn't allow, before it reads the timing or the ask.
- `expectStaged` and `expectAsked` check after the run, before they fail "ran with no copy" or "ran with no ask": a call
  deep-hook allowed alone proves nothing.
- `expectFree` also checks after an allow, once it has found nothing staged and no ask.

A call decided alone is skipped as INCONCLUSIVE, with the load reading, and never passed (`Inconclusive`, `verdict`).
`failureOf` rethrows INCONCLUSIVE and BLOCKED, so neither counts as a planted program's failure. The hub-stopped tests
have no hub to decide, so they have no INCONCLUSIVE.

## Wrong programs

Each wrong program is code the implementer writes. A test selects it with `DEEP_HUB_PLANT=<name>`, set on `deep hub run`
and on every deep-hook run.

- If the stager is in the hub, the plant goes in `packages/hub/src/plant.ts`'s lists.
- If it is in deep-hook, deep-hook reads the same variable.

A plant the base doesn't list stops the hub from starting (`plantOf` throws). Its test then fails BLOCKED, never passes.

| Name | Criterion | What the plant does | The assertion that catches it |
|---|---|---|---|
| `stages-untracked-only` | AC1 | The stager's class covers only untracked and ignored files, so `git reset --hard` over tracked edits runs with no copy. | `expectStaged` step 3: the test requires the failure to hold "`git reset --hard` ran with no copy of src/a.ts". |
| `stages-clean-tree` | AC3 | The stager copies on a clean tree too: it stages `git reset --hard` with nothing to lose. | `expectFree`: the test requires the failure to match "`git reset --hard` (call toolu_…) was staged on a clean tree". |

Other wrong programs these tests fail, with no plant:

- the base, which lets every command of the class through with the hub up and with it down (BASE-FAILURE.txt);
- a stager that copies bytes rather than cloning (AC1 step 3);
- one that allows first and stages after (step 3);
- one that records no digests or the wrong ones (step 4);
- one that copies the whole tree (step 4);
- one that reads only the unstaged diff, so it misses an edit in the index (AC1's fifth test);
- one that reads only the tree, so it misses a stash entry (AC2);
- one whose undo restores other bytes (`expectRestored`);
- a matcher on the literal words, which misses the three spellings or stages a heredoc written to a file (AC5).

## Criteria to tests

Each `describe` names its criterion's ID: `#1294.` and the first 8 hex of the SHA-256 of the criterion's text, trimmed,
whitespace collapsed, `- [ ] ` dropped, as `scripts/proof-change.mjs` computes it. Each test's name starts with the
criterion's number. Every failure message starts with `AC<n> <ID>`. The two Scope tests have no criterion, so they
start with `Scope`.

| ID | Criterion (short) | Test file | Tests |
|---|---|---|---|
| AC1 `#1294.0d52ea18` | with an uncommitted edit to tracked `src/a.ts`, the four commands are staged before they run and undo restores by digest; a stager covering only untracked and ignored files fails, naming the file | `commands.test.ts` (6) | 1–4. `git reset --hard`, `git checkout -- .`, `git restore --staged --worktree .`, `git switch -f main`, each in its own world. 5. `git reset --hard` with the edit in the index. 6. The wrong program `stages-untracked-only`. |
| AC2 `#1294.27ece250` | `git stash drop` and `git stash clear`, with an entry holding tracked edits, stage the entry's files first and restore them on undo | `stash.test.ts` (2) | One test per command. |
| AC3 `#1294.68f6f52b` | the same reset on a clean tree runs with no staging and no ask; a stager that copies anyway fails, naming the call | `clean.test.ts` (2) | 1. Clean tree free, then the same command in the same session, edited, staged and undone. 2. The wrong program `stages-clean-tree`. |
| AC4 `#1294.4cf10768` | hub stopped: `git reset --hard` with tracked edits denied, naming the command for you to run; `git reset --soft HEAD~1` allowed | `hub-stopped.test.ts` (1) | Denied by deep-hook alone, naming the command, the edit still there; the soft reset allowed and run. |
| AC5 `#1294.17b207b0` | spellings matched by effect: `git -c core.pager=cat reset --hard`, `sh -c 'git checkout -- .'`, a heredoc running `git restore .` | `spellings.test.ts` (3) | One test per spelling. The heredoc's first runs the same words in a heredoc written to a file, free. |
| Scope, second bullet | past the ceiling, the command becomes an authority ask | `ceiling.test.ts` (1) | `staging.files` 2, three modified files, `git reset --hard`. |
| Scope, fourth bullet | hub stopped: every command of the class is denied with the command for you to run | `hub-stopped.test.ts` (1) | The five other commands, with tracked edits and a stash entry. |

Two contrasts pass at the base, so each sits inside a test that fails on another part: the clean-tree reset (AC3's first
test, which fails when the same command must be staged) and the soft reset with the hub stopped (AC4's test, which
fails first on the hard reset). So does the heredoc written to a file (AC5's third test).

## What this suite could not encode

- **`git stash clear` with several entries, and a dropped entry that isn't the top one.** The criterion says "an entry",
  so there is one entry and it is the top one.
- **Other spellings of the class**, such as `git checkout -f`, `git reset --merge`, `git restore --worktree .` (named in
  the issue's opening, not its criteria) and `git checkout <ref> -- path`. A criterion names the four, and #316's corpus
  owns respelling. Near misses that discard nothing, such as `git restore --staged .`, aren't judged either.
- **The hub stopped on a clean tree.** The issue doesn't say whether `git reset --hard` is denied there, so no test
  runs it.
- **Which deep-hook or hub part reads the tree.** The tests judge only what comes out: the allow, the copy, the record
  and the undo.
- **The seconds ceiling for a staging of tracked edits.** #347's suite covers the seconds ceiling. The scope test binds
  the files ceiling.
- **A file edited again between the run and the undo.** The issue doesn't say what the undo does then.

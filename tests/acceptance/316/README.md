# Acceptance tests for #316: the deep-hook matcher

Written first, blind, from issue #316 (its text as of October 24, 2026: Scope, the 9 checkbox criteria, Proof and
Depends on; it has no comments), the design sections it links ([Hook protocol (deep-hook and the hub)], [Before
each command]) and those around them ([Hooks are evidence, not a state machine], [One hub per user, a tiny hook
client, and extensions in-process], [Threats, and what stops each one]), the text of its parent #17 and siblings
#315 (done), #317 (next) and #304 (the guard engine, later), and base commit `0b41a19` (origin/main), by a job
that never saw an implementation of #316. The implementing agent does not edit these files (AGENTS.md, Proof); a
dispute goes to a blind redraft of this job.

The issue has 9 checkbox criteria, AC1 to AC9 in the body's order. **This README and these files cover AC1 to
AC8.** AC9 (the seeded 1,000-spellings corpus) is written by a separate blind job in its own file,
`corpus.test.ts`, with its own plant; its contents are not described here. That job imports the surface this
suite's `helpers.ts` exports (listed under [Helpers the corpus job imports](#helpers-the-corpus-job-imports)).

## How to run

With the repo's Node (`.node-version`, 24.22.0) and Rust toolchain:

```sh
npm ci                                   # once, if node_modules is missing
npm run build --workspaces               # twice: the first build after install fails on declaration order
cargo build --locked -q -p deep-hook     # warm the binary so a vitest beforeAll doesn't time out under load
npx vitest run --root tests/acceptance/316 --no-file-parallelism
```

- `--no-file-parallelism` keeps the files from running side by side: each builds deep-hook with cargo, which
  replaces the binary in place, and the git criteria make real worktrees.
- Nothing needs the network. The files build `cargo build --locked -q -p deep-hook` (target/debug) and the one
  planted twin into a target folder of its own, `target/plant-paths-as-written/debug/deep-hook`. The approval test
  (AC5) runs a stub `gh`/`curl` on `PATH`, never GitHub.
- Every test makes its own folders under `/tmp/dh316-*` (a Unix socket path must fit in 104 bytes on macOS), sets
  `HOME` to one of them for every process it starts, and never touches the real `~/.deepbuild`, `~/.claude` or
  `~/.codex`. It stops only processes it started, by PID (`helpers.ts`, `cleanup`), never by name or port. A child
  never inherits this process's billing keys or `DEEP_*`/`GIT_*` settings.
- Type-check with `node node_modules/typescript/bin/tsc -p tests/acceptance/316/tsconfig.json`. The tests reach the
  code only through the `deep-hook` binary and the files under `HOME`; nothing is imported from the packages.

## The surface under test

The issue names deep-hook's matcher but not every place a test can see it, so these tests use the surfaces #315
fixed (deep-hook invoked as a hook entry, the address setting, rules.json, the hub-away decision read as exit 2 or
a `deny` for Claude Code's PreToolUse) and define the smallest additions below. Each is listed again, with why.

### Where the default entries live, and how a test installs them

The issue says the default fail-closed rules "ship as `guard@1` entries (#13) marked `fail_closed`, and they are
the first `rules.json`". The smallest surface the design supports is a repo file, **`crates/deep-hook/default-rules.json`**,
holding `{ "v": 1, "entries": { "<name>": guard@1, … } }`, every entry `fail_closed`. A test copies it **verbatim**
into `$HOME/.deepbuild/rules.json` (`helpers.ts`, `installDefaults`) and then runs deep-hook with no hub.

Why a file, and not `deep setup`, a deep-hook subcommand or the hub: deep-hook's matcher is "the only code that
evaluates a guard's `match`" ([Before each command]; #304), and a `fail_closed` entry must hold "with the hub
down" and "with no new deep-hook build" (#316 Scope). A file the matcher reads needs no hub, no setup step and no
rebuild, so it is the smallest thing all the criteria share. Once #304's hub rewrites `rules.json` at install, the
same file is the seed it starts from; this suite does not test the rewrite (that is #304).

**These tests are blind to the `match` language.** `guard@1`'s `match` is a free string, and the design lets it be
a predicate over the call, an effect class or a tool. The tests never assume a spelling: they install whatever the
implementer ships and assert only the **behaviour** the issue names (which call is denied, which allowed, and what
the denial says). #315's `shell:<glob>` entries must keep matching; that is #315's concern, asserted there.

### How a decision is read

As #315: for Claude Code's PreToolUse, a **deny** is exit code 2 (the reason on stderr) or a stdout
`hookSpecificOutput.permissionDecision` of `deny`; an **allow** is exit 0 with no deny (`helpers.ts`, `decision`).
With the hub stopped deep-hook prints only its own decision. A denial must **carry one shipped entry's `reason`
and that same entry's `next_step` verbatim** (`carriesReasonNextStep`): the denial says why and what to do
instead, in a real entry's words, not a generic line. Since the test is blind to which entry matched, it accepts
any shipped entry whose `reason` and `next_step` both appear in the denial.

### What "the hub stopped" is

Criteria 1–8 all run **with no hub at the address** (`$HOME/.deepbuild/hub.sock`, none started), the plainest of
#315's stopped-hub forms, so the fail-closed matcher is what decides. #315 proved the other stopped forms
(SIGTERM, SIGKILL-with-socket, SIGSTOP) all reach the same fail-open-with-fail-closed path within 50 ms, so this
suite does not repeat them. The hub-up behaviour of the defaults (a `fail_closed` entry still denying with the hub
up and no extension) is exercised by `corpus.test.ts` (AC9) and decided by #304; see
[What depends on other issues](#what-depends-on-other-issues).

### A worktree session, another checkout, a subagent

- **"From inside a worktree session"** is a payload whose `cwd` is a **real git worktree** made in a temp folder
  (`helpers.ts`, `makeRepo`, `addWorktree`), and deep-hook is run with that `cwd` (`hook(..., { cwd })`).
- **"The session's own worktree"** is that same `cwd`; **"another worktree"** is a second worktree of the same
  repo; **"another checkout … the main checkout"** is the repo's primary checkout (`repo.dir`). A cross-checkout
  denial must **name that checkout's real path** (the path the call aimed at, resolved).
- **"From subagents"** is a payload carrying `agent_id` and `agent_type`, as the corpus's subagent payloads do
  (`adapters/corpus/claude-code`). The matcher reads the command, so a subagent's call is denied like any other.

### The config paths and the skills folder

`~/.codex/config.toml` and `~/.claude/settings.json` are `$HOME/.codex/config.toml` and
`$HOME/.claude/settings.json`. A **skills folder** is `$HOME/.claude/skills/<name>/SKILL.md` (Claude Code's skills
live under `~/.claude/skills/`; the facts name no other path). A config denial must **name `deep_propose`**, the
way to propose a change to an agent's config ([Before each command]; Threats, "Agents switching off what watches
them"). The resolution of `..` and symlinks is AC8's own test.

### The dispatch approval

With no hub-side authority path yet (that is #321, deferred — see [What depends on
other issues](#what-depends-on-other-issues)), AC5's **"an approval runs exactly the workflow, branch and inputs it
showed"** is read as: the denial of a `gh workflow run <wf> --ref <branch> -f k=v …` call must **show** the
workflow, the branch and each input, and running that same dispatch (what a person would run from what was shown)
must reach exactly those. The test runs it against a **stub `gh`/`curl` on `PATH`** that records its argv and never
calls the network (`helpers.ts`, `stubBins`), and checks the recorded argv is the workflow, branch and inputs the
denial showed. A **rerun** (`gh run rerun <id>`) is not a dispatch and is allowed.

## Readings where the issue and design leave a choice

- **The default entries themselves** — their names, their `match` spellings, their `reason`/`next_step` wording —
  are the implementer's, shipped in `crates/deep-hook/default-rules.json`. The tests read behaviour, not spelling.
- **"Blocked" / "denied"** is the hub-away deny above (exit 2 or a `deny` decision). An "allowed" call is exit 0
  with no deny.
- **The reason and next step** are checked as a shipped entry's `reason` and `next_step` appearing whole in the
  denial, not as fixed strings (the test is blind to them).
- **"Another checkout"** for AC6 is the repo's main checkout; for AC2's `git -C` it is a second worktree. Both are
  real checkouts of one repo. A cross-checkout denial names the path the call aimed at.
- **The symlink layout (AC8).** `~/.claude/settings.json` is a real symlink to a dotfiles file. The dotfiles folder
  and the extra symlink are **siblings of the home folder** (both under the test's temp folder), so that
  `../dotfiles/claude.json` evaluated from `cwd = HOME` resolves to the linked target, as the criterion's
  `..`-reach requires. The three writes — an Edit of the target, a `sed -i` of `../dotfiles/claude.json`, and a
  Write through a fresh symlink pointing at the target — each land on the file `~/.claude/settings.json` links to,
  so each is denied once `..` and symlinks are resolved and matched against the config's own path and its link
  target.
- **The dispatch approval** is read as above, without a hub (the hub-side ask is #321).
- **The empty-rules control (AC1).** An empty `rules.json` (`{v:1,entries:{}}`) must let `pkill -f node` through,
  proving the rule is data in the file and not compiled into deep-hook (#316 Scope: "a rule you add needs no new
  deep-hook build"). This holds at the base too (#315's deep-hook already allows everything with no matching
  entry), so this one test passes at the base and stays as the control.

## Criteria to tests

Each `describe` names its criterion's ID, `#316.<first 8 hex of SHA-256 of the criterion's text>` (trimmed,
whitespace collapsed, `- [ ] ` dropped), as the trace lane reads tags. Each test's name starts with its
criterion's number.

| ID | Criterion (short) | Tests |
|---|---|---|
| AC1 `#316.47a1dec1` | hub stopped: `pkill -f node` still blocked | `blocked.test.ts` AC1 (2): the deny with reason+next_step, plus a normal command allowed; the empty-rules control (allowed) |
| AC2 `#316.e0cba5a9` | `git stash` and cross-worktree git blocked; `git stash push -m` and own-worktree git allowed | `git.test.ts` AC2 (2): the four calls; `git stash pop` denied too |
| AC3 `#316.26d87d62` | Edit/Write/`sed -i` of an agent config or a skills folder denied, naming `deep_propose` | `config.test.ts` AC3 (2): the four writes denied naming `deep_propose`; an ordinary write allowed |
| AC4 `#316.85c1dfdf` | every kill form blocked, through wrappers and heredocs | `blocked.test.ts` AC4 (2): the nine forms; `lsof`/`pgrep` listing allowed |
| AC5 `#316.b9fa0a58` | dispatch blocked in every form; rerun allowed; approval runs what it showed | `dispatch.test.ts` AC5 (2): the three forms + rerun; the denial shows the dispatch and the shown dispatch runs exactly it |
| AC6 `#316.6b7d29d2` | git aimed at another checkout blocked however aimed, incl. subagents | `git.test.ts` AC6 (1): `cd`, `--git-dir`/`--work-tree`, `GIT_DIR`, a read-only command, a subagent; own-worktree git allowed |
| AC7 `#316.aa88a9ae` | text that only mentions a blocked command is allowed | `blocked.test.ts` AC7 (2): a search, a commit message, a heredoc written to a file; the twin that runs it is denied |
| AC8 `#316.9404dfdb` | symlinked config, its target, a `..` path and a write through a fresh symlink denied, naming `deep_propose`; a paths-as-written matcher fails | `symlink.test.ts` AC8 (2): the run; the wrong program |
| AC9 `#316.39bdfe08` | the seeded 1,000-spellings corpus | `corpus.test.ts` (written by a separate blind job) |

## Wrong programs

One, for AC8's "a rule that matches only the listed paths as written … fails this test, naming the path". AC9's
own wrong program ("a matcher that knows only this issue's spellings fails, naming the first spelling it let
through") lives in `corpus.test.ts`, written by the separate job.

| Name | How it is selected | Criterion | What the plant does | How the test fails on it |
|---|---|---|---|---|
| `plant-paths-as-written` | cargo feature, built into `target/plant-paths-as-written/debug/deep-hook` | AC8 | matches only the literal config paths as written, resolving neither `..` nor symlinks | the Edit of the linked target, the `sed -i ../dotfiles/claude.json` and the Write through the fresh symlink are allowed: the test throws "the write to `<path>` reached the linked config and must be denied", naming the path |

The plant is code the implementer writes. When its feature is absent (the base), the cargo build fails and the
wrong-program test **fails** (it does not pass): "the plant plant-paths-as-written did not build". The base itself
is the wrong program for the rest (BASE-FAILURE.txt).

## What depends on other issues

- **The default entries' `match` language and their precision** are the implementer's, delivered with #316. These
  tests assert only behaviour, so they hold whatever spelling the matcher uses, as long as every named call is
  decided as the issue says.
- **The hub-up decision** (a `fail_closed`/block entry still denying with the hub up and no extension, the two runs
  agreeing call for call) is AC9's "with it up" and belongs to **#304**, the guard engine that has the hub decide a
  matched entry's outcome by scope and mode. This suite (AC1–AC8) runs only with the hub stopped. `helpers.ts`
  exports `startHub`/`stopHub` so `corpus.test.ts` can run both ways.
- **The hub-side authority ask for a dispatch** (holding the call at PreToolUse with an ask that you answer) is
  **#321**, which needs #318's decisions and #19's trusted path. AC5 here tests only the hub-away deny and that the
  shown dispatch equals what runs; it does not file or answer an ask.
- **#315's client** is what these tests drive; #315's `shell:<glob>` matching must keep working, which #315's suite
  asserts. #316 replaces #315's glob-only reading with the matcher under test.

## Helpers the corpus job imports

`corpus.test.ts` (AC9) imports from `helpers.ts`:

- `makeHome`, `rootOf`, `tempDir`, `cleanup` — temp homes and teardown by PID.
- `buildDeepHook({ features? })` — builds the plain binary or a planted twin, returns its path.
- `installDefaults(home)` / `defaultRules()` / `writeRules(home, rules)` / `DEFAULT_RULES` — install the shipped
  default entries as the first `rules.json`, or read/write them.
- `newSession(home, cwd?)`, `bash`/`edit`/`write`, `payload`, `callId` — a session and its hook payloads.
- `hook(home, session, event, body, { binary?, cwd?, env? })` — runs deep-hook as a hook entry runs it, hub away.
- `decision(ran)`, `denialText(ran)`, `shown(ran)`, `carriesReasonNextStep(ran, rules)` — read a decision and a
  denial.
- `startHub(home)` / `stopHub(hub)` / `spawnHub(home)` — a real `deep hub run` at the address, for the "hub up"
  pass and the call-for-call comparison.
- `setAddress(home, address)` — point deep-hook at a given socket.

## Files

- `helpers.ts`: temp homes, the default-entries file installed as `rules.json`, deep-hook built and run as a hook
  entry, the hub as a process, real git checkouts, PATH stubs for gh/curl, symlinks, and the decision/denial
  readers.
- `blocked.test.ts` (AC1, AC4, AC7), `git.test.ts` (AC2, AC6), `config.test.ts` (AC3), `symlink.test.ts` (AC8),
  `dispatch.test.ts` (AC5).
- `tsconfig.json`: the root options with `noEmit` and `allowImportingTsExtensions`.
- `BASE-FAILURE.txt`: the run on the base commit, with the reason each test fails there.

[Hook protocol (deep-hook and the hub)]: ../../../docs/technical-design.md
[Before each command]: ../../../docs/technical-design.md
[Hooks are evidence, not a state machine]: ../../../docs/technical-design.md
[One hub per user, a tiny hook client, and extensions in-process]: ../../../docs/technical-design.md
[Threats, and what stops each one]: ../../../docs/technical-design.md

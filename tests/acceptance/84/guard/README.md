# Acceptance tests for #84: the push, PR and merge defaults

Written first, blind, by a job that never saw an implementation of #84. This folder covers the guard share of the
issue; sibling jobs write the other criteria in their own folders under `tests/acceptance/84/`.

Sources:

- **The issue**: its text as of 2026-11-05T23:06:22Z (`updatedAt`): Scope, the 29 checkbox criteria, Proof and
  Depends on. AC numbers below follow the body's order.
- **The design**, `docs/technical-design.md`: [An agent says it's done], [An ask, and your answer getting back], [The
  done loop], Ask, [Before each command] (the guard engine, `guard@1`, planted calls and twins, hub up and down, MCP
  classes), Pinned to a commit, and the Decided row "Requests that name an action".
- **Base commit** `d722ba3d` (origin/main). Code read: `crates/deep-hook/` (`matcher.rs` effect classes,
  `default-rules.json`), `packages/hub/src/` (`server.ts` `reply`, `gated`; `holds.ts`; `guards.ts`; `plant.ts`;
  `forge.ts`; `ask-tasks.ts`), `adapters/mcp-servers.facts.json`.
- **Conventions**: tests/acceptance/304, 321, 82 and 303. `helpers.ts` adapts 82's and 321's; `fixtures/agent.mjs`
  is 321's. This suite keeps its own copies.

The implementing agent does not edit these files (AGENTS.md, Proof). A dispute goes to a blind redraft of this job.

## How to run

With Node 24.22 (`.node-version`) first on `PATH` and the Rust toolchain:

```sh
npm ci                                   # once, if node_modules is missing
npm run build --workspaces               # the hub and the deep CLI the tests start
CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 cargo build --locked -q -p deep-hook
npx vitest run --root tests/acceptance/84/guard --no-file-parallelism --testTimeout=600000
node node_modules/typescript/bin/tsc -p tests/acceptance/84/guard/tsconfig.json
```

- Each test starts a hub of its own, so the folder belongs on `scripts/lanes.mjs`'s one-at-a-time list (`alone`). The
  implementer adds it.
- Every test makes its folders under `/tmp/dh84g-*` (a Unix socket path must fit in 104 bytes on macOS), sets `HOME`
  to `<tmp>/h` for every process it starts, and never touches the real `~/.deepbuild`, `~/.claude` or `~/.codex`.
- It stops only processes it started, by PID (`helpers.ts`, `cleanup`, `stopHub`), never by name or port.
- No network, no model, no `gh`, no `claude` binary. A call is a PreToolUse payload; an allowed one "runs" as the test
  writing its PostToolUse. The only real effects are the agent's edits and commits in the temp repo. The `github`
  MCP server is only named in a config file. A child never inherits this process's billing keys, forge tokens or
  `DEEP_*`, `GIT_*`, `XDG_*`, `CLAUDE*` or `CODEX*` settings.

## The surface under test

- **deep-hook** (`target/debug/deep-hook`), run as Claude Code runs our hook entry: `deep-hook claude-code <event>`, the
  hook's JSON on stdin, as a child of the session's own process (`fixtures/agent.mjs`).
- **`deep hub run`**, a real process, with `DEEP_HUB_TEST_CONFIRM`, `DEEP_HUB_TEST_DRAFTS`, `DEEP_HUB_TEST_WORK`,
  `DEEP_HUB_TEST_STOP_HOLD_MS` and, for the wrong programs, `DEEP_HUB_PLANT`.
- **The socket**, as the cli role with the control token: `events.read`.
- **`deep inbox answer <ask> <option>`**: your yes. **`deep guard add <file>`**: #304's install. **`deep-hook check`**:
  #304's check mode.
- **Files** under `HOME`: `~/.deepbuild/rules.json`, seeded verbatim from `crates/deep-hook/default-rules.json`;
  `~/.deepbuild/config.json`; `~/.claude.json`, which declares GitHub's official server as the facts file matches it.

### The world

A git repository with one commit on `main`, checked out on the branch `fix-login`, with a `.deepbuild/done.yaml` spec
(one unit check) and a drafted check. One work item, `item-61`, whose R1 is judged by that check. The agent's two edits
make both pass, so a commit of them is PASS on the base today: this is the real gate, not a stand-in.

### The prompts

The issue's own words where it gives them; how the defaults read an ask is left to the implementer, and no test fixes
the rule, only what it does on these prompts:

| Prompt, typed | Names | Used by |
|---|---|---|
| `Fix the login bug in src/auth.js.` | none of push, PR, merge | AC9, AC10, AC11, AC12, AC13 |
| `create PR` | the PR, and so the push | AC11, AC13 |
| `push this branch` | the push | AC9 |
| `Fix https://work.test/acme/shop/issues/61, then create PR.` | the PR, and so the push | AC9, AC29 |
| `merge PR 12` | the merge | AC9, AC29 |

`gh pr create` is called as `gh pr create --fill`, a whole call the agent would make.

## Surfaces the implementer must provide

The issue and the design leave these open. Each is the smallest choice they support, with why. Tests assert behavior,
never wording beyond what's below.

### Naming the rule

"Denied with the rule it breaks" and "naming the rule" read as: **the denial's text (stderr at exit 2, or the deny's
reason) holds the entry's name**, as a whole word, as it stands in `crates/deep-hook/default-rules.json`. The hub
already words a block this way, `… (guard <name>)`. The name itself is the implementer's: the suite finds it in the
denial (`rulesIn`), so `authority-push` or a new name both pass. At least one entry so named must be `mode: block` in
the shipped file, since the guard engine reads a mode and a deny needs `block`. So the defaults can't be a watch entry
beside a hard-coded hold.

"The same rule" (AC10) is one entry named in both denials; a denial may name more than one entry.

### The authority ask

"An authority ask for it is filed" is an `ask.created` in the record, after the denial, `kind: authority`, whose
`question` holds the call's words: the command for a shell call, the tool's name for an MCP call (as #321's suite
reads a hold). AC9 approves the push's through the option with `decision: allow`; the same call then goes through
with no new ask, and the yes covers nothing else. A call the defaults allow raises no ask naming it.

### Merge authority

- **"The commit"** a merge must name is the `commit` of a `claim.made` whose `verdict.made` has `outcome: PASS`. On a
  clean worktree that is HEAD. A denial for no commit or another commit must **name the PASS's commit** (7 or more
  characters of it), the one that would go through. Naming only the wrong commit it was given doesn't count.
- A commit is named by `--match-head-commit <sha>` for `gh pr merge` and `sha` for the MCP tool (`{owner, repo,
  pullNumber, sha}`) and the API (`gh api -X PUT repos/acme/shop/pulls/12/merge -f sha=<sha>`). So `gh api` calls to the
  merge endpoint have to count as merges, which base deep-hook's `effect:merge` doesn't read.
- **A pending `--auto` merge** is a `gh pr merge 12 --auto --match-head-commit <sha>` that went through, in the thread
  that opened PR 12. **"That PR's branch"** is the branch checked out when that thread's `gh pr create` printed the
  PR's link; the test pushes it as `git push origin HEAD` from the same checkout. No forge is reachable, so this can't
  come from the forge alone.
- `gh pr merge --disable-auto 12` goes through in a thread whose ask names the merge, naming no commit, and ends the
  pending merge. After it, `git push origin HEAD` goes through.
- An ask covers every call of what it names in its thread; nothing in the issue spends it on the first one. The
  thread makes several merge calls, as an agent retrying one would.

### The entry that ships (AC29)

The rule named in the denial of `gh pr merge 12 --auto` must have `proofs.<name>.planted` and `proofs.<name>.twin` in
`default-rules.json`, the shape #304 fixed, and `deep guard add` must install it as shipped, exit 0: valid `guard@1`,
planted call matched, twin not.

### Prompts by `from`

The defaults read `user.ask` prompts recorded `from: person` (#303). AC13 first proves the report is recorded
`from: subagent`, or it is BLOCKED.

## Hub up, hub down

Every criterion here says or implies a running hub, since reading a thread's ask takes the record. AC12 also stops the
hub, by PID, and the twin is still allowed. The issue doesn't say whether these entries are `fail_closed`, and the
design allows either ("With the hub down, deep-hook applies the `fail_closed` entries and allows the rest"), so no test
asserts what `gh pr merge 12` does with the hub down.

## Load

The machine is shared. Three readings are spoiled by load, not by the program, and are skipped as **INCONCLUSIVE**, never
passed:

- a prompt, a stop or a call's end deep-hook couldn't hand the hub within its budget (`could not spool`, `spooled …,
  but its sync didn't finish`), since the record then misses or reorders it;
- a call that must be denied but was let through before the hub decided it (the same stderr, or `tool.before` marked
  `late`), or a gate that ran out of time;
- on a loaded machine, a stop let through before its fast-lane checks ended, or no PASS or locked definition in time.

## Wrong programs

Each is code the implementer writes, in `packages/hub/src/plant.ts` (`Plant`), selected with `DEEP_HUB_PLANT`. A plant
the base doesn't list stops the hub from starting, so its test fails BLOCKED, never passes.

| Plant | Criterion | What it does | How the test fails on it |
|---|---|---|---|
| `ask-covers-every-effect` | AC11 | a thread whose ask names any of push, PR or merge has all three go through, the head-commit rule included | `gh pr merge 12` goes through: "… must be denied" |
| `defaults-match-text` | AC12 | the hub ignores the entries deep-hook names for the push, PR and merge defaults and denies a shell call whose command line holds their words as plain text, naming the entry | the twin is denied with the hub up: the failure names the entry |
| `reads-every-from` | AC13 | the defaults read every prompt the thread holds, whatever its `from` | the first `git push origin HEAD` goes through: "… must be denied" |
| `auto-merge-unpinned` | AC29 | `gh pr merge 12 --auto` goes through with no commit, nothing counts as pending, and a push to its branch goes through | the failure names the push `git push origin HEAD` |

The base is the wrong program for each criterion's own test: `BASE-FAILURE.txt`.

## Criteria to tests

Each `describe` and test name starts with its criterion's number and ID, `#84.<first 8 hex of SHA-256 of the text>`
(trimmed, whitespace collapsed, as `scripts/proof-change.mjs` computes it).

| ID | Criterion (short) | Tests |
|---|---|---|
| AC9 `#84.2ff63a22` | an unasked push, PR or merge denied with its rule; an asked one goes through | `asked.test.ts` (2): the three denied with asks filed, your yes runs the push and nothing else; a push-only ask, a PR ask, and a merge ask naming the PASS's commit |
| AC10 `#84.a97b10d7` | the GitHub MCP merge tool without an ask denied with the same rule as `gh pr merge` | `mcp.test.ts` (1): one entry named in both denials, ask filed, the server's read tool still goes through |
| AC11 `#84.b2639179` | "create PR": push and PR go through, merge denied naming the rule; covering every effect fails | `create-pr.test.ts` (2): the flow, with another thread's push denied; the wrong program |
| AC12 `#84.53261593` | hub up: `gh pr merge 12` denied, its twin allowed; a text-matching hub fails, naming the entry | `hubside.test.ts` (2): the flow, check mode agreeing, the twin allowed with the hub stopped; the wrong program |
| AC13 `#84.3e19f28f` | a subagent's "create PR" leaves the push denied; your typed one lets it through; reading every `from` fails | `from.test.ts` (2): the flow; the wrong program |
| AC29 `#84.1337e21d` | a merge with no commit or another denied, naming the commit; `--auto` with no commit then a push fails, naming the push; ships as `guard@1` | `head-commit.test.ts` (2): gh, MCP and API, each form denied and allowed; `--auto` holds the branch until `--disable-auto`; a new head needs its own verdict; the entry installs; the wrong program |

Scope lines these rest on: first-party entries read by `from` and matched by the guard engine (AC12's check mode, AC13,
and block mode in `expectDenied`); "exactly what it names, in that thread" (AC9, AC11); "denied with its rule, and an
authority ask for it is filed" (AC9, AC10, AC11); merge authority covers one head commit, and the `--auto` line (AC29).

## Not asserted

- What `gh pr merge 12` does with the hub down (above).
- That a push to a branch other than the PR's goes through while a merge is pending: an ask may rightly not cover that
  push, so no call here tells the two apart.
- Whether a pending `--auto` merge survives a hub restart.
- A rule, rather than an ask, covering a push, PR or merge ("or a rule covers them"): the issue names no such rule to
  install, and #23's suites own standing rules.

## Files

- `helpers.ts`: the world, the hub, the record, sessions through deep-hook, the rule readers and the judgements
  (`expectDenied`, `expectAllowed`, `expectAuthorityAsk`, `approve`, `expectPass`, `delivered`).
- `asked.test.ts` (AC9), `mcp.test.ts` (AC10), `create-pr.test.ts` (AC11), `hubside.test.ts` (AC12), `from.test.ts`
  (AC13), `head-commit.test.ts` (AC29).
- `fixtures/agent.mjs`: one session's Claude Code, as far as its hooks go. From #321's suite.
- `tsconfig.json`: the root options with `noEmit` and `allowImportingTsExtensions`.
- `BASE-FAILURE.txt`: the run on the base commit, trimmed to each test's failing assertion.

[An agent says it's done]: ../../../../docs/technical-design.md
[An ask, and your answer getting back]: ../../../../docs/technical-design.md
[The done loop]: ../../../../docs/technical-design.md
[Before each command]: ../../../../docs/technical-design.md

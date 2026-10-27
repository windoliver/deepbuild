# Acceptance tests for #304: the guard engine

Written first, blind, from issue #304 (its text as of October 27, 2026, last edited 2026-10-27T19:16:30Z: Scope, the
8 checkbox criteria, Proof and Depends on; it has no comments), the design sections it links ([Before each command],
[Threats, and what stops each one], [Decided], [One hub per user, a tiny hook client, and extensions in-process]) and
two beside them ([Hook protocol (deep-hook and the hub)], [Socket roles and contract versions]), the text of its
dependencies and siblings for context only (#13, #16, #17, #18, #316 (done), #121, #84, #22, #303), and base commit
`0350cf0` (origin/main), by a job that never saw an implementation of #304. The base code read: `crates/deep-hook/`
(`main.rs`, `matcher.rs`, `default-rules.json`), `packages/hub/src/server.ts` (`reply`, `rules`),
`hookmap.ts`, `mcp-servers.ts`, `install.ts`, `confirm.ts`, `setup.ts`, `adapters/mcp-servers.facts.json`,
`adapters/claude-code.facts.json` (`toolKinds`), `packages/contracts/schemas/guard@1.json` and `tool.before@3.json`,
and the suites of #316, #315, #18 and #237 for their conventions. The implementing agent does not edit these files
(AGENTS.md, Proof); a dispute goes to a blind redraft of this job.

The issue has 8 checkbox criteria, AC1 to AC8 in the body's order. This suite covers all eight.

## How to run

With the repo's Node (`.node-version`, 24.22.0) and Rust toolchain:

```sh
npm ci                                   # once, if node_modules is missing
npm run build --workspaces               # the hub and the deep CLI the tests start
cargo build --locked -q -p deep-hook     # warm the binary so a vitest beforeAll doesn't time out under load
npx vitest run --root tests/acceptance/304 --no-file-parallelism
```

- `--no-file-parallelism` keeps the files from running side by side: each builds deep-hook with cargo, which
  replaces the binary in place.
- No planted call, twin or other call is ever executed: each is a PreToolUse payload deep-hook decides on, or a
  check-mode input. Nothing needs the network or a model. The files build `target/debug/deep-hook`, `target/release/deep-hook` (the
  budgets) and the planted twins, each into a target folder of its own (`target/<feature>/debug/deep-hook`). The
  `github` MCP server in AC6 is only named in a config file; nothing contacts it.
- Every test makes its own folders under `/tmp/dh304-*` (a Unix socket path must fit in 104 bytes on macOS), sets
  `HOME` to one of them for every process it starts, and never touches the real `~/.deepbuild`, `~/.claude` or
  `~/.codex`. It stops only processes it started, by PID (`helpers.ts`, `cleanup`, `stopHub`), never by name or
  port. A child never inherits this process's billing keys or `DEEP_*`, `GIT_*`, `XDG_*` or `CLAUDE*` settings.
- Type-check with `node node_modules/typescript/bin/tsc -p tests/acceptance/304/tsconfig.json`. The tests reach the
  code only through the `deep-hook` binary, the `deep` CLI (`packages/cli/dist/main.js`), the hub's socket as the cli
  role (`events.read`) and files under `HOME`; nothing is imported from the packages, except the perf lane's
  `validateBudgets` from `scripts/benchmark.mjs`, as the budgets of #16, #24 and #237 do.

## The surface under test

The issue names what the engine does but leaves open where a test sees it: how an entry carries its planted call
and twin, how you add an entry so the hub rewrites `rules.json`, how deep-hook's check mode is invoked, how a match
names a tool class, where a watched match is recorded, how warn shows the reason, and how a tool's hints and a saved
decision reach the classifier. Each choice below is the smallest the design and the base code support, with why.
The implementer builds to these; the tests assert behaviour (allow or deny, exit codes, which entry is named, what
reaches `rules.json` and the record), never message wording beyond what the issue states.

### Planted calls and twins

**Where they live.** Each entry's planted call and twin ride beside the entries, never inside them, under a top-level
`proofs` object keyed by the entry's name:

```json
{
  "v": 1,
  "entries": { "<name>": { "match": "…", "scope": "…", "mode": "…", "reason": "…", "next_step": "…", "fail_closed": true } },
  "proofs":  { "<name>": { "planted": <call>, "twin": <call> } }
}
```

This is the shape of `crates/deep-hook/default-rules.json` (the first-party defaults: AC2 reads each fail_closed
entry's proofs there) and of the file `deep guard add` installs (below). Why beside and not inside: `guard@1` has
`additionalProperties: false`, and base deep-hook reads `rules.json` as unreadable when an entry carries a field
`guard@1` doesn't list; #316's suite copies `default-rules.json` verbatim in as the first `rules.json`. A sibling key
leaves `guard@1`, deep-hook's reader and #316's suite as they are.

**A call** is the call fields of an agent's PreToolUse payload: `{ "tool_name": "…", "tool_input": { … }, "cwd": "…" }`,
`cwd` optional. A Bash call is `{"tool_name": "Bash", "tool_input": {"command": "gh pr merge 12"}}`. Why: that is what
deep-hook already reads of a call (`main.rs`, `call`), and an MCP or unknown tool is a call the same way.

**Placeholders and the check fixture.** Some default entries match only in a setting (git aimed at another worktree
needs a repository with two checkouts; a kill of the hub needs the hub's PID). So a call's strings may name these
placeholders, which whoever runs the call (the hub at install, a test when it replays it) replaces first:

| Placeholder | Is replaced by |
|---|---|
| `{home}` | the home folder (`$HOME`) |
| `{repo}` | a git repository's main checkout, one commit on `main` |
| `{worktree}` | a linked worktree of `{repo}` (branch `wt`) |
| `{work}` | a plain empty folder; a call that names no `cwd` runs here |
| `{hub_pid}` | the PID of the hub process listening on the hub's socket |

Replacement is plain text, in every string of `tool_input` and in `cwd` (`helpers.ts`, `makeFixture`, `substitute`).
The test entries in this suite use none; only AC2 replays the shipped defaults' proofs through them.

### Installing an entry: `deep guard add <file>`

"A fail_closed entry you add … is copied into `rules.json`", and "the hub rewrites it at each install". The smallest
surface for an entry you write is one CLI command beside `deep install`: **`deep guard add <file>`**, where `<file>`
has the shape above (one or more entries, each with its proofs). It asks the hub at the address setting, as the cli
role with the control token (as `deep install` does), to install them. At that install the hub runs deep-hook's
check mode over each entry's planted call and twin and:

- **exit 0** when every entry's planted call matches and its twin doesn't: each entry is written into
  `$HOME/.deepbuild/rules.json`, `{ "v": 1, "entries": { … } }`, field for field as given, its `mode` and
  `fail_closed` included (`helpers.ts`, `holds`), beside the entries already installed;
- **exit 1**, refused, when an entry's planted call goes through or its twin is matched: the output (stdout or
  stderr) names the entry and the call (its command text for a Bash call), and the refused entry does not reach
  `rules.json`. Each refusal test installs one entry per file, so the tests don't depend on whether a refusal
  refuses the whole file.

Exit codes 2 (usage) and 3 (not decided: the hub couldn't be reached) follow `deep install`'s; the tests don't
assert them. Every hub a test starts gets `DEEP_HUB_TEST_CONFIRM` naming a file that says `confirmed` (the base's
stand-in for the OS confirming you, `confirm.ts`), so an install that asks the OS to confirm you is confirmed, and
one that doesn't ask is unaffected. Each test home starts with `default-rules.json` copied verbatim in as the first
`rules.json` (as #316's suite does), so the default floor is installed before any test entry. Why a CLI command and
not a watched file or `deep install`: an install must be refused with a reason a person reads, which a command
returns; `deep install` takes a signed package with a manifest, far more than an entry you wrote. Every test
entry's `scope` is `all_repos`, the defaults' spelling: the issue and the design spell no one-repo scope, and AC1
asserts only the decision in the shop repo.

### Check mode: `deep-hook check`

"At install the hub runs the same matcher over each entry's planted call and twin, through a check mode this task
adds to deep-hook." The surface: **`deep-hook check`**, reading one JSON object on stdin,
`{"entry": <guard@1>, "call": <call>}` (the call's placeholders already replaced), and printing one JSON line on
stdout, **`{"matched":true}`** or **`{"matched":false}`**, exit 0 (`helpers.ts`, `check`, `checked`). Input it can't
read exits non-zero. Why: the matcher answers whether an entry reads a call, nothing more; what that means
(planted must match, twin mustn't) is the install's to decide. It runs with the caller's `HOME`, as a hook does.
The tests run it directly only in AC8 (its budget); AC4 sees it through the install's refusals. The hub finds the
deep-hook it runs the way `deep setup` does (the newest of this checkout's `target/release` and `target/debug`
builds); the tests build `target/debug` first.

### Tool classes in a `match`: `counts:<class>`

"Tool classes are guard entries too": an entry can match a call by what the tool counts as. The spelling is
**`counts:read`**, **`counts:change`**, **`counts:send`** or **`counts:destructive`**, in deep-hook's `<kind>:<rest>`
form, after the `counts` field `tool.before@3` and the facts file already use for the class. AC5's entry "whose match
is any change" is `counts:change`. A call of a tool the adapter's facts don't list (kind `unknown`) counts as change
(`claude-code.facts.json`: "unknown, which guards treat as change"); a `Read` call (kind `read`) counts as read.

### How a decision is read

As #316's suite: for Claude Code's PreToolUse a **deny** is exit 2 or a stdout `permissionDecision` of `deny`; an
**allow** is exit 0 with no deny (`helpers.ts`, `decision`). **Warn** "allows it and tells the agent the reason": an
allow whose stdout carries `hookSpecificOutput.additionalContext` containing the entry's `reason` (the channel the base
hub already uses to add context at a PreToolUse, `server.ts`, `agentReply`). **Watch** "records a match and allows the
call": an allow whose `tool.before` event, read back through `events.read`, names the entry in `data.matched`
(`tool.before@3` already has that field, "the guard entries in rules.json the call matched, by name"; the base sets it
only on a late call). A twin "passes": allowed, not named in its `tool.before`'s `matched`, and shown no reason.

### Which entry denied: its own words in the denial (AC1)

`terraform apply` creates a cloud resource, so the shipped default `no-unnamed-cloud-resource` (`effect:cloud-resource`,
`fail_closed`) already denies it with the hub away, at base and after. The decision alone can't show that the entry
you added holds the call, or tell it from a rule compiled into deep-hook. So AC1 reads which entry denied the way
#316's suite does, by its words: the hub-away denial of `terraform apply` must carry **the added entry's `reason` and
`next_step`**, which carry a random token nothing compiled can know. When more than one `fail_closed` entry matches a
call, as here, the denial must therefore carry the words of each, or at least of the entry you added; carrying only
the first matched entry's words, as base deep-hook does, fails AC1. The same binary's SHA-256 before the install and
after the denial shows no new build.

### The hub up, the hub stopped

"With the hub up" is a real `deep hub run` on the test's home. "With the hub stopped" is, in AC1 and AC3, the hub
process ended (SIGTERM, by PID) so nothing is at the address, as in #316's suite; in AC2 it is the hub's process
stopped with SIGSTOP, socket and process still there, so a default's planted call that names `{hub_pid}` names a live
PID, and deep-hook gets no acknowledgement and acts as with the hub away (#315 proved the stopped forms reach the same
path). The runs agree call for call when every planted call is denied and every twin allowed in both.

### Tool lists and saved decisions (AC6)

"A server's hints" come from each session's recorded tool lists (#18), and "your decision" from a decision you saved
(#22's asks hold new tools for one). At base the hub records neither: a session's `loads` digest each MCP server's
config but hold no tool list, and no decision names a tool. The facts file's one server is GitHub's official remote
server, so its hints could only come over the network. So the hub reads both from a stand-in only tests set, as it
reads `DEEP_HUB_TEST_CONFIRM` for the OS prompt: **`DEEP_HUB_TEST_MCP_TOOLS`**, naming a JSON file:

```json
{
  "lists":     { "<server>": [ { "name": "<tool>", "annotations": { "readOnlyHint": true, "destructiveHint": false } } ] },
  "decisions": { "<server>": { "<tool>": "read" } }
}
```

`lists` stands for the tool lists sessions recorded for each server (each tool as MCP's `tools/list` gives it, its
hints under `annotations`, optional); `decisions` for the decisions you saved about a tool's class. The class the
adapter counts is read back from the record as `tool.before`'s `data.counts`, the field #18's suite reads. Servers
are matched by name and source as `mcp-servers.ts` matches them: `github` is the official server in the user-scope
config (`$HOME/.claude.json`), `slack` and `forge` are stdio servers the facts file doesn't list.

### Budgets (AC8)

"Compared with the merge base" is the perf lane's comparison, as for #16, #24 and #237: `benchmarks/budgets.json`
must have a task whose `initialReason` (or `changeReason`) names `#304`, timing the hook path with every installed
entry and the check mode; the file must pass `validateBudgets` against the merge base's, and the task's command must
run and exit 0. The issue's own numbers are judged in the test, on the release build:

- **matching every installed entry**: the p95 of a forwarded PreToolUse (`ls`) with `rules.json` holding the shipped
  defaults and 20 entries installed through `deep guard add`, minus the p95 of the same call from a home whose
  `rules.json` is empty and whose address is the same hub, under **2 ms**;
- **inside the hook overhead budget**: that call's p95 minus a native no-op binary's (`fn main() {}`, rustc -O3), under
  **10 ms**;
- **check mode twice**: `deep-hook check` on one entry's planted call, and on its twin, each p95 minus the no-op's,
  under **10 ms**.

Five runs of 400 calls each, interleaved, each call timed from spawn to exit. Before any number is read, the calls
are proven to be the criterion's (the entries installed and in `rules.json`, check mode answering matched and not
matched, the `ls` call allowed both ways). The timing rule is #315's: PASS when all five runs are within the limit,
FAIL when all are over it by more than the margin (the runs' spread, at least 5%), otherwise INCONCLUSIVE. The
readings are always printed; they count only on a reference Mac (Mac15,7 M3 Pro 36 GB or Mac15,12 M3 16 GB) on mains
power, Low Power Mode off, thermals nominal and the 1-minute load average within the core count. Anywhere else the
test is **skipped as INCONCLUSIVE with the readings**, never passed.

## Wrong programs

Each is code the implementer writes. When its cargo feature or plant value is absent (the base), the build fails or
the hub refuses to start (`plantOf` throws), and its wrong-program test **fails** with "the deep-hook build with the
plant … did not build" or "the hub with the plant DEEP_HUB_PLANT=… did not start". It never passes.

| Name | How it is selected | Criterion | What the plant does | How the test fails on it |
|---|---|---|---|---|
| `plant-compiled-rule` | cargo feature on deep-hook, built into `target/plant-compiled-rule/debug/deep-hook` | AC1 | denies any call that runs `terraform apply` with the hub away, from a rule compiled into the binary with its own reason, and reads no entry from `rules.json` | the denial carries none of the words you wrote: "no-terraform-apply-shop: the denial must carry the added entry's reason and next step" |
| `matches-text` | `DEEP_HUB_PLANT=matches-text` | AC3 | the hub ignores the entries deep-hook names and decides a PreToolUse itself, denying a Bash call whose command line contains, as plain text, the words after `run:` of any block entry in `rules.json` | the twin `echo 'gh pr merge 12'` is denied with the hub up: "t-block: with the hub up, its twin … must be allowed" |
| `fail-closed-only-rules` | `DEEP_HUB_PLANT=fail-closed-only-rules` | AC3 | at install the hub writes only the `fail_closed` entries into `rules.json` | t-block is missing from `rules.json`, and its planted call is let through with the hub up: "t-block: the block entry … must be written into rules.json with its mode" |
| `installs-unchecked` | `DEEP_HUB_PLANT=installs-unchecked` | AC4 | at install the hub writes each entry into `rules.json` without running check mode over its planted call and twin | t-leaky installs: "t-leaky: an entry whose planted call … must be refused at install, exit 1" |
| `plant-listed-kinds-only` | cargo feature on deep-hook, built into `target/plant-listed-kinds-only/debug/deep-hook` | AC5 | a `counts:` entry is matched only against calls of the tools deep-hook's own reader lists (Bash, Read, Edit, MultiEdit, Write, NotebookEdit, Grep, apply_patch); a call of any other tool matches none | the `FrobnicateWidgets` call (kind unknown) is allowed: "t-change: the FrobnicateWidgets call, kind unknown, counts as change and must be denied" |
| `trusts-hints` | `DEEP_HUB_PLANT=trusts-hints` | AC6 | the classifier counts a tool as read when its server marks it `readOnlyHint` or its name starts with `get_` or `list_`, before anything else | `list_messages` counts as read: "mcp__slack__list_messages must count as change …" |
| `warn-as-block` | `DEEP_HUB_PLANT=warn-as-block` | AC7 | the hub decides a matched warn entry as it decides block | the warned planted call is denied: "t-mode in warn mode: its planted call … must be allowed" |

The base itself is the wrong program for the rest (AC2, AC8, and AC6's raising half): `BASE-FAILURE.txt`.

## Criteria to tests

Each `describe` names its criterion's ID, `#304.<first 8 hex of SHA-256 of the criterion's text>` (trimmed,
whitespace collapsed, `- [ ] ` dropped, as `scripts/proof-change.mjs` computes it). Each test's name starts with its
criterion's number.

| ID | Criterion (short) | Tests |
|---|---|---|
| AC1 `#304.eb6ac0ef` | a fail_closed entry you add is copied into rules.json, denies `terraform apply` in the shop repo with the hub stopped, no new build; twin `terraform plan` allowed; a compiled-in rule fails | `added.test.ts` AC1 (2): the flow, the denial carrying the added entry's words; the wrong program |
| AC2 `#304.0ec8d962` | every default fail_closed entry denies its planted call and allows its twin, hub stopped and up, agreeing | `defaults.test.ts` AC2 (1) |
| AC3 `#304.c5114696` | block entry written with its mode; hub up denies `gh pr merge 12`, allows `echo 'gh pr merge 12'`; hub stopped allows both; fail_closed entry denies either way; text-matching hub and fail_closed-only rules.json fail | `hubside.test.ts` AC3 (3): the flow; two wrong programs |
| AC4 `#304.be770632` | entries whose planted call goes through, or whose twin is denied, refused at install naming entry and call, neither in rules.json; unchecked install fails | `install.test.ts` AC4 (2): the refusals with a control entry that installs; the wrong program |
| AC5 `#304.1dc6d830` | a call recorded with kind unknown meets an any-change entry and is denied; a kind-read call allowed; listed-kinds-only engine fails | `kinds.test.ts` AC5 (2): the flow; the wrong program |
| AC6 `#304.6f492bf5` | `list_messages` change; facts-read + `destructiveHint` destructive; `delete_branch` + `readOnlyHint` destructive; only facts or a saved decision moves to read | `classes.test.ts` AC6 (2): the six tools; the wrong program |
| AC7 `#304.dfd8896b` | watch records and allows, warn allows with the reason, block denies; the twin passes in all three; warn-as-block fails | `modes.test.ts` AC7 (2): the three modes; the wrong program |
| AC8 `#304.cabba859` | budgets: matching every entry < 2 ms p95 added, inside 10 ms over process start; check mode twice, each inside it; vs the merge base | `budgets.test.ts` AC8 (2): the perf lane task; the timed calls |


## What depends on other issues

- **Recording each session's MCP tool lists** (#18's "each server with its tool list") and **saving a decision about
  a tool** (#22, #321) are not in the base; AC6 reaches the classifier through `DEEP_HUB_TEST_MCP_TOOLS` until they
  are. Once they land, a redraft can feed the same six tools through them.
- **Moving an entry from watch to warn to block after a replay proves it precise** is epic #8's. AC7 installs the entry
  in each mode in a home of its own, so no promotion rule is exercised; AC3 installs a block entry directly, as the
  criterion does.
- **The push, PR and merge defaults** (#84), **asks for new MCP tools** (#22) and **the rules page** (#121) are out of
  scope; nothing here asserts them.
- Under heavy machine load a hook can miss the hub's 20 ms acknowledgement and fall back to the hub-away decision
  (#315). A hub-up assertion that fails that way shows the call's time in its message (`shown`); the tests do not
  retry or loosen for it.

## Files

- `helpers.ts`: temp homes, the defaults seeded as the first `rules.json`, test entries and guard files, `deep guard
  add`, deep-hook built and run as a hook entry or in check mode, the check fixture and its placeholders, the hub as a
  process, `events.read` through the socket, and the timing tools.
- `added.test.ts` (AC1), `defaults.test.ts` (AC2), `hubside.test.ts` (AC3), `install.test.ts` (AC4), `kinds.test.ts`
  (AC5), `classes.test.ts` (AC6), `modes.test.ts` (AC7), `budgets.test.ts` (AC8).
- `tsconfig.json`: the root options with `noEmit` and `allowImportingTsExtensions`.
- `BASE-FAILURE.txt`: the run on the base commit, trimmed to each test's failing assertion and reason.

[Before each command]: ../../../docs/technical-design.md
[Threats, and what stops each one]: ../../../docs/technical-design.md
[Decided]: ../../../docs/technical-design.md
[One hub per user, a tiny hook client, and extensions in-process]: ../../../docs/technical-design.md
[Hook protocol (deep-hook and the hub)]: ../../../docs/technical-design.md
[Socket roles and contract versions]: ../../../docs/technical-design.md

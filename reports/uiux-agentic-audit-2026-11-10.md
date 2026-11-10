# UI/UX and agent-use audit, 2026-11-10

Base: main at `f38d2b39`, then merged with main at `a04378eb`. Asked for: audit package by package, apply KISS, and hill-climb on a simpler UI/UX and on
how well an agent can use DeepBuild.

## Outcome

Five fixes, each with a test that failed first: +105 −26 handwritten lines in 11 files, not counting this report. Fourteen findings were
measured and not applied, because each changes a design line, a blind suite or code an open pull request rewrites.

This is not a line-by-line read of every package. It is every surface a person or an agent meets, run and measured:
the `deep` commands, the MCP tools, the skill, the hook replies and five app views. The last section says what was
run, what was only read and what was not looked at.

## How it was measured

- **Commands.** 93 `deep` command forms in a throwaway home with no hub running, and 27 against a live hub in a
  throwaway home set up through `deep setup`, with stand-ins for the service manager as #1359's suite has them.
- **Agent session.** One scripted session: hooks sent as deep-hook sends them, and a real `deep mcp` child making 15
  tool calls. No real agent ran and no model was called.
- **Tokens.** The skill and `tools/list`, counted with `gpt-tokenizer`, a dev dependency of the repo. Other models
  count differently, so read the numbers as relative.
- **App.** Five views drawn headless by a `deep-replica` built at `e2378df8`, a commit in main but not its head.

## Scoreboard

| Measure | main | this change |
|---|---|---|
| Skill, tokens every session loads | 1,868 | 1,524 (−18.4%) |
| `deep mcp` tool list, tokens | 6,588 | 6,143 (−6.8%) |
| Both together | 8,456 | 7,667 (−9.3%) |
| `deep_drive`'s schema, tokens | 2,333 | 1,888 |
| Commands whose `--help` leaves out a flag they take, of 7 checked | 7 | 0 |
| `deep numbers` lines that print `undefined` | 1 | 0 |
| Command forms that end in a Node stack trace, of 93 | 1 | 0 |
| #45 AC2's blind test (`tests/acceptance/45/hub.test.ts`) | fails | passes |
| `deep --help`, words | 792 | 824 (worse by 32) |

The token rows are counted on main at `a04378eb` and on this branch after merging it; the others were measured at
`f38d2b39`, and the lines they read are unchanged on main since.

Measured and unchanged, with the hub down (43 forms that need it): 21 different first lines; 41 print an errno and the
socket's path twice; 29 open with the verdict word BLOCKED; 8 name a fix; 4 exit 1 where the rest exit 3.

## Fixed

| Requirement | Change | Failed first, then passed |
|---|---|---|
| Every row of `deep numbers` has its unit, source and age (#45 AC2) | `hub/src/core.ts`: the hand-backs reading carries `unit`, `source`, `basis` and `age_ms` as every other row does. `hub/src/numbers.ts`: an empty detail prints nothing. The line was `handbacks_sent_back: 0 undefined · undefined · undefined · undefinedms []` | New case in `hub/test/numbers.test.ts`. #45 AC2's blind test failed on main at "handbacks_sent_back names its source" and passes unchanged |
| A command never ends in a stack trace | `hub/src/hosts.ts`: `deep run follow` reads the hub's token inside the call it already catches. In a home where no hub ever ran it printed Node's `readFileUtf8` trace | New case in `cli/test/cli.test.ts` |
| A command's help names every flag it takes (#1359: an agent asks for help before it uses a command) | `cli/src/main.ts`: eight usage lines gain the flags each command's own usage already names: `start` (`--home`, `--mode`, `--until`, `--host`, `--json`), `rules` and `session rules` (`--json`), `show` (`--removes`, `--t`, `--size`, `--include`), `read` and `find` (`-- <what>`), `hub run` (`--safe`) | New table in `cli/test/cli.test.ts`: 7 of 7 failed on main |
| The skill says each thing once | `scripts/skill.mjs`: a tool's line stands under the first block that names it; a later block says `deep_propose, as under Check.` Nine repeated lines became short pointers. Every block, every Never cell and every tool name stay | New `tests/skill.test.mjs`. #26's blind drift test passes unchanged |
| The tool list says each thing once | `hub/src/tools.ts`: `deep_drive` writes a locator at five places, since the strict subset takes no `$ref`. Its seven fields are described at the call's own locator and listed bare at the other four | New `hub/test/tools.test.ts`. #26's strict-schema test passes unchanged |

The help change adds words to `deep --help`. That is the cost of a per-command help an agent can trust; #1814 owns
making the first screen shorter.

## Found and not applied, most useful first

### For agents

1. **`deep_status` tells an agent nothing at the start of a task.** The skill says to begin with it. On a new
   session it answers `{"session", "gates", "claims": []}`. It names no check the repo's spec holds, no open ask and
   no open item, so the names `deep_claim`'s predictions and `deep_run` need are learnt from a refusal. Make it the
   orientation call. It changes a design row and #26's suite, so it needs an issue.
2. **Four canvas tools are 61% of the tool list in every session:** `deep_show`, `deep_drive`, `deep_kinds` and
   `deep_job` take 3,741 of 6,143 tokens. A session that fixes a test never calls them. `deep-actions` is already a
   second server entry; the canvas tools could be a third, or listed only where the spec uses the canvas.
3. **Each block's Never cell is loaded twice,** once in the skill and once in each tool's description (1,555 tokens
   of descriptions). #26's criterion 2d751e6d pins both, so this is the owner's call.
4. **A machine setting that is missing is refused as the agent's argument.** `deep_ask` in a home with no ask
   deadline answers code `type` at `/params/deadline`, not retryable, for a field the tool doesn't have. `asRefused`
   in `hub/src/core.ts` maps every named field to `type`.
5. **`deep_env` answers `{"status": "BLOCKED"}` with `isError` false,** so an agent that reads `isError` takes it as
   done.
6. **Two first steps.** The SessionStart context says to declare work with `deep_claim`; the skill says to begin
   with `deep_status`.
7. **A refused pattern prints the regular expression:** "Give commit in the form ^[0-9a-f]{40}$." The schema's own
   description says "by its full SHA".

### For people, in the terminal

8. **`deep inbox` never shows the option IDs `deep inbox answer` takes.** A line holds the question, kind, repo,
   session, age, default and handle. The IDs are only in `--json`, or in the refusal after a wrong guess. Seven
   suites read these lines (#24, #27, #111, #355, #667, #1463, #1510), so it wasn't changed here.
9. **A usage error in a fresh home sets the machine up first.** `deep status --typo` and `deep env` with no
   arguments write the hooks and call the service manager, then fail. #19 AC16's blind contract test
   (`tests/acceptance/19/doctor/contract.test.ts`) fails with 38 lines, 32 of them this. It isn't in
   `scripts/known-failures.json`. The setup step in `cli/src/main.ts` is unchanged here, so this is main's.
10. **The hub-down numbers above** are #1812's ground. Eight commands answer bad arguments with "Unsupported
    command." in place of their usage: `off now`, `update`, `debug`, `open`, `session`, `explain`, `kinds`,
    `mcp bogus`. #1812 names three.
11. **`deep doctor` right after a clean `deep setup` from a checkout exits 1:** `hub.service` FAIL, with a fix that
    names `deep hub promote`, which `deep --help` doesn't list. With Homebrew's Node the reason reads "in a
    checkout, /opt/homebrew", since Homebrew's prefix is a git checkout. Owned by #1361 and #2124.
12. **Three commands succeed in silence:** `deep hub start` (in #1812), `deep secret list` with no secret, and
    `deep find` with no hit, which prints an empty line.

### The app

13. **The views drawn here are the shell #1453 replaces.** The first screen had a bottom band reading "Session ·
    queued" for a session that doesn't exist, and "Agents" sat over the session rows as their heading. Pull request
    #2167 (#1461, one list and one page) was merged into main the same morning, after the replica used here was
    built, so these draws are of the shell before it. The app on main's head was not drawn. No app code is changed
    here.

### Found on the way

14. `tests/agent-eval.test.mjs` fails on main: it lists eight tools and the skill names fourteen. It fails with the
    same six reasons before and after this change.
15. `tsc --noEmit` fails on main at `a04378eb` with one error: `packages/hub/test/job-session-close.test.ts` builds
    a `JobDeps` with no `adopt`, which #1819 added to the type after #1925 wrote the test.
16. `scripts/repo-rules.mjs` fails on main at `a04378eb` with 14 lines: 12 dependencies with no entry in
    `scripts/repo-rules.json` and two packages with no card. #2173 and #2178 hold the three oldest.
17. A test can reach the real service manager. Of the 99 acceptance helpers that run the built `deep`, 90 set no
    stand-in for it. On the machine this audit ran on, the hub's login-service label was held by a job loaded from
    a temp home that carries the prefix #667's helper gives its homes.

## Verification

Run once each after the last edit, and the first three lines once more after merging main at `a04378eb`:

- `packages/cli/test/cli.test.ts`: 24 of 25 pass. The 25th is BLOCKED as on main: no Node older than 24.22.0 here.
- `packages/hub/test/numbers.test.ts`, `packages/hub/test/tools.test.ts`, `tests/skill.test.mjs`: all pass.
- Blind suites, unchanged: `tests/acceptance/45/hub.test.ts`, `tests/acceptance/26/tools.test.ts` and
  `tests/acceptance/1359/help-table.test.ts`: all pass. #84's replay case that reads the hand-backs reading passed
  before the merge and was not run after it.
- `tsc --noEmit`: passed before the merge. After it, it fails with main's one error (finding 15) and none in a file
  this change touches.
- `scripts/proof-guard.mjs`: exit 0. `scripts/public-text.mjs`: 0 names in the change.
- #19's contract test reads `deep --help`; the forms it runs are the same 54 before and after.

Not run: `node scripts/affected.mjs`, the preflight, the timed budgets, any Rust test (no Rust changed), the six
suites that read `deep inbox`, and #19's contract test on the merge base. No real agent session was run, so whether
the shorter skill changes what an agent does is not measured; `scripts/agent-eval.mjs` is the tool for that and it
spends plan usage.

## What was covered

| Package or crate | Run | Read | Not looked at |
|---|---|---|---|
| `cli` | every listed command, 120 runs | `main.ts` whole | |
| `hub` | every command; 15 tool calls; four hook events | `tools.ts`, `mcp.ts`, `client.ts`, `authority.ts`, `inbox.ts`, `hub-command.ts`, `codes.ts`; parts of `setup.ts`, `service.ts`, `status.ts`, `doctor.ts`, `numbers.ts` | `core.ts` beyond `deep_status`, the hand-backs reading and `asRefused`: about 8,000 lines |
| `asks`, `verdicts`, `readings`, `reading` | through the hub | the refusal list, `line.ts`'s head, `panel.ts`, the usage text | the rest |
| `deep-hook` | built; called by the hub | `default-rules.json`: all 38 entries name a next step | its Rust |
| `deep-app`, `deep-replica` | five views drawn | `README.md` | all Rust source |
| `channels`, `pi`, `paseo`, `github` | | | all: the text a phone, pi or a pull request shows |
| The other 26 packages; `deep-show` and the canvas, GPU and text crates | | | all: none prints to a person or an agent on the paths run |

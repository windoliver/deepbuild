# Acceptance tests for #332: environment resources: accounts, screens and GPUs leased per session, credentials by reference, budgets per resource and seed records

Written first, blind, on October 29, 2026, from issue #332 (its text as of that day: Scope, the 8 checkbox criteria,
Proof and Depends on), the issues it names (#4, #36, #121, #86, #580, #260, #331, read for scope only),
`docs/technical-design.md` (the env-local row of First-party extensions that ship on by default; Threats, and what
stops each one; the Lease and Budget primitives; Sandbox and budgets; the Extension API's `deep.registerEnvironment`
and `deep.lease`; the Hub slots table's `environment@1` row; The stack a check runs against; Redaction by value;
Dogfooding), `AGENTS.md`, the acceptance tests of #331 and #86 for their conventions and surfaces, and
`packages/env-local`, `packages/leases`, `packages/budget`, `packages/supervisor`, `packages/hub`, `packages/cli`,
`packages/extension-host` and `packages/conformance` as they are at the base commit
`4ee8c992cfe10224c056858e004cc815604ccf9f` (main), read for their public surfaces only, by a job that never saw an
implementation of #332. The implementing agent doesn't edit these files (AGENTS.md, Proof); a dispute goes to a blind
redraft of this job.

The issue has 8 checkbox criteria, AC1 to AC8 in the body's order.

## How to run

On macOS, with the repo's Node (24.22.0) first on `PATH`:

```sh
npm ci                                            # once, if node_modules is missing
npm run build --workspaces                        # the tests run the built CLI, packages/cli/dist/main.js
node node_modules/vitest/vitest.mjs run --root tests/acceptance/332 --no-file-parallelism
node node_modules/typescript/bin/tsc -p tests/acceptance/332/tsconfig.json
```

- `--no-file-parallelism`: the files start real hubs and stacks on ports leased from 3000 up.
- Nothing needs the network, Docker, a keychain or a real account. Every stack is the test's own dev server
  (`fixtures/server.mjs`) on 127.0.0.1; every hub is a hub on a temp folder (`deep hub run --root`); every
  credential is a made-up fake in a dotfile under a temp HOME.
- Every test makes its folders under `/tmp/dh332-*`, points `HOME` at a temp folder for itself and every child,
  removes the agent's own `CLAUDE_*` and `DEEP_*` variables first, and never touches the real `~/.deepbuild`. The
  suite stops only processes it started or whose PID files its fixtures wrote, by PID, after checking the PID still
  runs one of its programs (`helpers.ts`, `cleanup`); never by name or port.
- With `--root` here, Vitest may write a cache under `tests/acceptance/332/node_modules/.vite/`; delete it before
  committing.

## The surface under test

The issue and the design name `deep env up`, `deep env down`, the environment's lease kinds (`lease.kind@1`, exact
keys for accounts, screens and GPUs, leased per session), credentials "by variable and source (a dotfile, a CLI login
or a keychain item)", the core's budgets (#86) with "runs, a dollar cap and an end date", the seed step's record "of
its source, when that source was copied and its migration revision", and a run's clone of the seed's template (#580).
They give no `done.yaml` keys for any of these, no variable names, and no event for a clone's record. These tests
define the smallest surface that reaches every criterion, with those names; each choice is listed here so a dispute
can name it.

### The repo's environment block (`.deepbuild/done.yaml`), beyond #331's

#331's keys (`up`, `ports`, `ready`) as #331 defined them, plus:

```yaml
environment:
  up: "<command line>"
  ports: [web]
  ready: { http: "http://127.0.0.1:${web}/health", within: 20 }
  host: APP_HOST                                        # the variable each stack process reads its worktree's own host name from
  leases:                                               # variable -> a lease.kind@1 kind and its exact keys
    SHOP_ACCOUNT: { kind: account, keys: [shop-test-1, shop-test-2] }
    GPU:          { kind: gpu, keys: [gpu-0] }
    SCREEN:       { kind: screen, keys: [screen-1, screen-2] }
    DEPLOY:       { kind: deploy, keys: [deploy-a, deploy-b] }
  credentials:                                          # variable -> its source; never a value
    SHOP_API_KEY: { dotfile: "~/.shop/test.env" }       # the dotfile's NAME=value line for the variable's own name
  seed: { run: "<command line>", database: DATABASE }   # the seed step, and the variable that hands it the template and each run its clone
```

- **Leases.** Each entry is a key of that kind, leased through the hub's lease table and handed to every process of
  the stack in the variable (`SHOP_ACCOUNT=shop-test-1`), as #331 hands a port. The record holds each as
  `lease.acquired@1` with `resource: {host: local, kind: <kind>, key: <key>}`, and its `holder` names the **session**
  whose `deep env up` leased it (the session's ID, with or without its dashes, appears in the holder). The kind names
  `account`, `gpu`, `screen` and `deploy` are this suite's choice (the design says "test accounts, phone numbers,
  simulators, screens and GPUs"; "deploy targets" is the issue's). A session's down ends its own leases
  (`lease.released`) and no other session's. When no key is free, `deep env up` is BLOCKED (exit 3, `status:
  'BLOCKED'`) and its `cause` names the lease holding it: the lease's ID (its `lease.acquired` event's `subject` or
  `data.id`), its holder, or the holding session's ID.
- **Host name.** "Each worktree gets its own host name" is read as: the stack's processes get, in the variable `host`
  names, an RFC 1123 host name that differs between two worktrees and is not `localhost`, `127.0.0.1` or `::1`.
  Whether it resolves, and to what, isn't tested.
- **Credentials.** `dotfile` is named from HOME (`~/`); the value is that file's line for the variable's name.
  env-local loads it into the stack's process alone. The issue's other sources (a CLI login, a keychain item) aren't
  tested: neither can be made without touching the machine's real logins or keychain.
- **Seed.** The seed step runs by `/bin/sh` in the folder the stack starts from, with `DATABASE` (the variable
  `seed.database` names) set to the path of the template database it must write (a file database, as the design's
  SQLite case), and `DEEP_SEED_RECORD` set to a path where it leaves its **completion record**, the JSON `{source,
  copied_at, migration}`. A seed step that exits 0 without writing it has seeded "without its completion record".
  Each run's app processes get, in the same variable, the path of the run's own clone of the template.

### Sessions and `deep env up`

A session is a Claude Code session the hub knows by its hooks (SessionStart, UserPromptSubmit, PreToolUse over the
hub's socket, each hook a child of the agent's process), as #331's and #26's suites establish one. "Session B's `deep
env up`" is that agent running `deep env up --root <hub> --json` through its Bash tool: the PreToolUse for that Bash
call (`tool_input.command` the command line) is stamped from the agent's process, and the command then runs as the
agent's child in the session's worktree (`agents.ts`, `fixtures/agent.mjs`). How the hub binds the command to its
session (the stamp, the process tree, the worktree) is the implementer's; the tests read only the holder the record
shows and what each stack was given.

### Budgets

Through the ledger's public entry (`@deepbuild/budget`, `openLedger`, on `@deepbuild/record` and `@deepbuild/asks`
as #86's suite opens them, `ledger.ts`). `BudgetInput` gains the design's `runs`: `{scope, runs, cap_usd, ends}`. A
run asks to start with `ledger.request(core, {run, check, inputs, issue, resource?})`; "goes ahead without an ask" is
`status: 'started'` with no `ask.created` in the record; "is the first to ask" is an outcome that isn't `started` and
names an ask (`BLOCKED` with `ask`, or `asked`), with exactly one `ask.created` in the record, that run's.

### Computer use

A computer-use step is a call of the agent's computer-use tools, `mcp__computer-use__<action>`, as Claude Code asks
the PreToolUse hook about it before it runs. A screen is named as that tool names a display (`switch_display
{display}`), and the `screen` kind's keys are those names; a window is named by its app (`open_application {app}`).
"Denied" is the hook's reply (hook.reply@2): exit 2, or `hookSpecificOutput.permissionDecision` (or `decision`)
`deny`/`block` in its stdout.

### Journeys, seeds and clones (#580's surface, ahead of it)

A journey is a check that needs the app, started through the hub's `run.start` with `environment: true` in a plain
folder standing for its temporary checkout, as #331's suite reads "dependent checks"; BLOCKED is the run finishing
`missing` (`run.finished@1`), which the verdict table makes BLOCKED, with the cause in its `findings`. The clone's
record is read off the record: some event other than `run.started`/`run.finished` that names the run (its handle
appears in the event) and holds, in its data, the seed record's `source`, `copied_at` and `migration` values, the
template's digest (the SHA-256 hex of the template's bytes as the seed step left them), and, under a key containing
`clon`, a time (ms or ISO 8601) within the run. Its event kind and field names are otherwise the implementer's.

### Test-only variable

| Variable | Effect |
|---|---|
| `DEEP_HUB_PLANT=env-clone-without-record` | the planted wrong program: a run's database is cloned from the template without its seed record |

## Criteria to tests

Each `describe` carries the criterion's ID, `#332.<first 8 hex of the SHA-256 of its text>` (trimmed, whitespace
collapsed, `- [ ] ` dropped; the command in `tests/acceptance/48/README.md`), and each test's name starts with its
criterion's number. A test headed `(wrong program)` runs the scenario against the planted twin the criterion names and
expects the criterion's reading to fail on it.

| ID | Criterion (whole) | Tests: each condition and where it is asserted | At this base |
|---|---|---|---|
| AC1 `#332.17008cc5` | A stack started by `deep env up` gets its credentials without the agent seeing a value or a path | `credentials.test.ts` (1). *Gets its credentials*: the stack's server reports the SHA-256 of the `SHOP_API_KEY` it was given, equal to the dotfile's value's. *Without the agent seeing a value*: the value (raw, and base64 in the record) is in neither `deep env up`'s nor `deep env down`'s output, nor the record (`events.read`), nor any file in the worktree or under the hub's root (the record's files, evidence, logs), though the server prints it at start. *Or a path*: the dotfile's absolute path is in none of the commands' output nor the record | fails at `credentials.test.ts:40`: the stack was given no `SHOP_API_KEY` |
| AC2 `#332.895dd0e2` | With session A holding `shop-test-1`, session B's `deep env up` gets another account or is BLOCKED, naming A's lease, and never starts with `shop-test-1`, and a run over a resource's cap is BLOCKED with the cap named | `accounts.test.ts` (2). *Session A holding shop-test-1*: A's stack gets `SHOP_ACCOUNT=shop-test-1` and the record holds its `account` lease under A. *B gets another account or is BLOCKED, naming A's lease*: with `shop-test-1` the only key, B's up is either ready with another account or BLOCKED, exit 3, its cause naming A's lease; with two keys, A and B each get their own, each under its session, and A's down ends only A's. *Never starts with shop-test-1*: B's stack, if up, wasn't given it, and no `lease.acquired` for it names B. `budgets.test.ts` (1), *a run over a resource's cap is BLOCKED with the cap named*: a $3 run on `shop-test-1` under a $2 resource budget (and a $10 issue budget with room) is `BLOCKED`, cause `budget`, naming the resource's budget, its ask naming `shop-test-1` and `$2`, nothing reserved | accounts fail at `accounts.test.ts:28` and `:68`: no account was leased or given. The cap test passes: #86's ledger already blocks a run over a resource budget's cap and names it |
| AC3 `#332.bc78ea57` | With a budget of 10 runs and $10 approved for an issue, the eleventh run, or one that would pass $10, is the first to ask | `budgets.test.ts` (2). *The eleventh run*: ten $0.50 runs each `started` with no ask and charged, $5 left; the eleventh doesn't start and names an ask, the record's first and only. *Or one that would pass $10*: three $3 runs started with no ask; the fourth ($12) doesn't start and names the first and only ask | the eleventh fails at `budgets.test.ts:32`: it starts (the ledger has no runs limit). The $10 test passes: #86's cap |
| AC4 `#332.0d4c185f` | A journey on a database seeded without its completion record is BLOCKED, naming the missing record | `seed.test.ts` (1): a seed step that exits 0 without its record; the journey's run finishes `missing`, its findings naming the seed and the record; the seed step ran; the journey's process never ran | fails at `seed.test.ts:76`: the run finishes `failed` (no seed step runs, the journey runs on no database) |
| AC5 `#332.447b1838` | Screens and deploy targets are leased like ports, and each worktree gets its own host name | `screens.test.ts` AC5 (1): two sessions in two worktrees; *leased like ports*: each stack gets a screen and a deploy target from its pool, different from the other's, each recorded as a `lease.acquired` under its session, and A's down ends A's two leases and neither of B's. *Its own host name*: each stack gets a valid host name in `APP_HOST`, different between the worktrees and not the loopback's | fails at `screens.test.ts:45`: no screen was given |
| AC6 `#332.346b8a56` | A computer-use step on a screen or window the session doesn't lease is denied, so your own browser is never touched | `screens.test.ts` AC6 (1): session A leases `screen-2`; *on a screen it doesn't lease*: A's `switch_display` to `screen-1` is denied; *or window, so your own browser is never touched*: A's `open_application` of Google Chrome is denied; session B, which leases no screen, is denied a `screenshot` and a `left_click`; the control: A's `switch_display` to `screen-2` is not denied | fails at `screens.test.ts:99`: the hub replies exit 0, allowing the step |
| AC7 `#332.e24a8c75` | A GPU is leased to one session at a time, like a port or a test account | `gpu.test.ts` (1): A's stack gets `gpu-0` under A's lease; B's up while A holds it is BLOCKED naming A's lease or comes up without `gpu-0`, and no lease on it names B; after A's down ends A's lease, B's up gets `gpu-0` under B's own lease | fails at `gpu.test.ts:24`: no GPU was given |
| AC8 `#332.92539e14` | A run's database cloned from the seed's template carries the template's seed record (its source, when that source was copied and its migration revision) with the template's digest and the time it was cloned; a clone of a template kept without its record is BLOCKED, naming the missing record, and a cloner that copies the database without its record fails this test | `seed.test.ts` (3). *Cloned from the seed's template*: the journey passes, the app serving the template's content from a path that isn't the template's. *Carries the template's seed record ... with the template's digest and the time it was cloned*: the record reading above. *A clone of a template kept without its record is BLOCKED, naming the missing record*: a seed step that leaves no record, then two runs (the one that seeds the template and the next, on the kept template), each `missing` naming the seed record, no journey run. *A cloner that copies the database without its record fails this test*: `(wrong program)`, the same scenario on `DEEP_HUB_PLANT=env-clone-without-record`, where the reading must fail, naming the seed record | the first two fail at `seed.test.ts:96` and `:116`: the run finishes `failed`. The wrong program fails BLOCKED: the base hub refuses the plant's name (`DEEP_HUB_PLANT=env-clone-without-record names no planted program`) |

### Proof

The issue's Proof: "Two sessions never sharing an account or a GPU, credentials never seen by the agent, and the
eleventh run asking, each shown failing first." All four fail on the base at an assertion (BASE-FAILURE.txt):
`accounts.test.ts:28` (and `:68`), `gpu.test.ts:24`, `credentials.test.ts:40`, `budgets.test.ts:32`. None rests on a
`toThrow`. The account and GPU tests fail at their first condition, that session A's stack is given the leased key:
the base leases no account or GPU at all, so "B never shares it" can't fail before "A holds it" does.

### How each criterion is read, where the issue leaves a choice

- **AC1.** "The agent" sees what `deep env up`/`down` print, the record (which `deep mcp` serves), and the worktree;
  the hub's root is scanned too, since the design keeps values out of "the record, the spec, evidence or the
  checkout" and the scope puts loaded values on the run's scrub list. "A path" is the dotfile's resolved absolute path;
  the `done.yaml` reference (`~/.shop/test.env`) is the environment's own text, which the agent may read.
- **AC2.** "A resource's cap" is read as the dollar cap of a budget whose scope is the resource (the scope's "a
  spending budget per resource ... a dollar cap"), the account `shop-test-1`; "with the cap named" as the BLOCKED
  outcome naming that budget and its raise ask's question naming the resource and `$2`. A lease kind's `cap` field
  (the number of keys leased at once) isn't what this reads.
- **AC3.** Counting runs counts every run that started against the budget, charged or not.
- **AC4/AC8.** "A template kept without its record" can't be made from outside without knowing where env-local keeps
  templates, so it is formed by a seed step that leaves no record: the template exists without one, and every run on
  it, the seeding run's and the next, must be BLOCKED. "The template's digest" is read as the SHA-256 of the
  template's bytes as the seed left them.
- **AC6.** The screen a step acts on, when the step names none, is the one the session is on, which it doesn't lease
  when it leases none.

## What depends on other issues

- **#580** (warm stacks, templates and clones) isn't on main at the base. AC4 and AC8 define the seed step, the
  template and the per-run clone through the surface above; #332 can't pass them without that much of #580's seed
  and clone path.
- **#121** (rules into `guard@1` entries), **#260** (OpenTelemetry for a journey run, R2) and the wiki setup are in
  the issue's Scope but in no criterion, so nothing here tests them.

## Files

- `helpers.ts`: temp folders and HOME, PID-file cleanup, test repos, worktrees and checkouts with the environment
  block, the hub as a process and its line protocol, `deep env up`/`down`, the stack's `/env` report, file scans for a
  value, and hook-reply reading.
- `agents.ts`: the agent stand-in as the hub sees it: sessions by hooks, `deep env up`/`down` through its Bash tool,
  PreToolUse for any tool, and `namesLease`.
- `ledger.ts`: a ledger world on a real record with the asks core (adapted from #86's suite).
- `credentials.test.ts` (AC1), `accounts.test.ts` (AC2), `budgets.test.ts` (AC2's cap, AC3), `seed.test.ts` (AC4,
  AC8), `screens.test.ts` (AC5, AC6), `gpu.test.ts` (AC7).
- `fixtures/server.mjs` (the repo's dev server: `/health`, `/env` with the credential only as a digest, `/db`),
  `fixtures/seed.mjs` (the seed step, with or without its record), `fixtures/journey.mjs` (a journey that needs a
  seeded database), `fixtures/agent.mjs` (the agent stand-in, adapted from #331's).
- `tsconfig.json`: the root options with `noEmit` and `allowImportingTsExtensions`; it type-checks clean at the base.
- `BASE-FAILURE.txt`: the run on the base commit.

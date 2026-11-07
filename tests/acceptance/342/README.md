# Acceptance tests for #342: session cleanup, the transcript archived before a desktop delete, env up volumes reaped, a teardown task per outside resource, and the stack pool

Written first, blind, by a job that never saw an implementation of #342; none existed. The implementing agent doesn't
edit these files (AGENTS.md, Proof); a dispute goes to a blind redraft of this job (design: Dogfooding).

What was read:

- Issue #342 as of 2026-11-06: Scope, the 6 checkbox criteria (AC1 to AC6 in the body's order), Proof and Depends on
  (#80, #36, #20; #88, #331 and #580 as it names them).
- `docs/technical-design.md`: First-party extensions that ship on by default (env-local's row, Warm stacks), Threats and
  what stops each one, Dogfooding, Tasks only you can do, Tasks close themselves. `AGENTS.md` (Proof).
- `spikes/80/decision.json` and its hook logs: what each desktop app fires.
- At the base `c12a65bbe9c0fa26a677b2fd65e12146b3a24016` (main, 2026-11-06), for surfaces and conventions only:
  `tests/acceptance/20`, `331`, `332`, `580`, `80`, `965`, `323`, `packages/hub`, `packages/archive`,
  `packages/env-local`, `packages/record`, `packages/asks`, `packages/contracts`, `packages/checks-command`.

What the base does: the archive copies at the hub's start and hourly, and only from `~/.codex/sessions`. A verified
`SessionEnd` leaves a `deep env up` stack standing: the same stack comes down in about 2 s through `deep env down`, but at
`SessionEnd` no lease ends and nothing is stopped. Nothing raises a teardown task. `stack.slot` reclaim exists (#580), so AC5's
main test passes at the base. BASE-FAILURE.txt has one run.

## Run them

```sh
export PATH="/opt/homebrew/bin:/opt/homebrew/opt/rustup/bin:$PATH"   # this Mac's Node and cargo
export DOCKER_HOST=unix://$HOME/.colima/default/docker.sock          # Colima's socket, resolved before the tests change HOME
export DOCKER_CONFIG=$HOME/.docker                                   # where `docker compose` is found, for the same reason
npm ci                                  # once
npm run build --workspaces              # every test starts `deep hub run` from packages/cli/dist
cargo build --locked -p deep-hook       # the sessions' hooks
docker pull busybox:1.36 && docker pull postgres:16 && docker pull redis:7   # once; the tests pull nothing
NO_COLOR=1 node node_modules/vitest/vitest.mjs run --root tests/acceptance/342 --no-file-parallelism
node node_modules/typescript/bin/tsc -p tests/acceptance/342/tsconfig.json
```

- **`DOCKER_HOST` and `DOCKER_CONFIG` are required** wherever the Docker context or the compose plugin is named from the
  real HOME, as on Colima: HOME is a temp folder for the tests, the hub and every session. Without them the Docker tests
  read BLOCKED, naming what's missing.
- `--no-file-parallelism`, since stacks lease ports from one range and each hub is a real one.
- On a Mac with Docker in a VM that shares only HOME, as Colima does, a bind mount from `/tmp` arrives empty. The compose
  sample here uses none, so AC2, AC4 and AC6 don't care. #580's sample binds `./db/init`, which holds only a marker file,
  so AC5's Postgres starts without it and nothing here reads it.
- `DEEP_HUB_PLANT` on a hub that doesn't list the plant is BLOCKED, never a pass.
- Delete `tests/acceptance/342/node_modules/.vite` if Vitest leaves one.
- **Elapsed:** 468 s on the base at load 80 to 120. AC2 and AC6 wait out a 30 s budget on purpose.

### The Node a check needs

**Checks can't run under Homebrew's Node.** It links 16 libraries from `/opt/homebrew/opt`, and the check sandbox reads only
the folder Node sits in, so `node --test` in any sandboxed check dies at load (`dyld: ... file system sandbox blocked open()`)
and the run ends `uncounted: evidence altered reads`. That isn't #342's: every suite whose checks run in the sandbox meets it.
`checksCanRun()` turns it into BLOCKED, naming the library, at the point AC3 first needs a check. AC3's check stage therefore
needs the repo's Node from `.node-version` as nodejs.org builds it (24.22.0), which links nothing outside its own folder.

## The surface under test

The issue names `deep env up`, SessionEnd, `~/.codex/archived_sessions`, `stack.slot`, teardown tasks and their cost. It gives
no event, field or setting for what a session's end does, or for how an outside resource is known. These tests define the
smallest surface that reaches every criterion; each choice is listed so a dispute can name it.

### Sessions

- **The apps are played, the rest is real.** Each session has an agent process of its own (`fixtures/agent.mjs`), whose
  children are real `deep-hook` runs and its Bash tool's commands, with the payloads `spikes/80/logs` recorded, its
  transcript in `~/.claude/projects` or its rollout in `~/.codex/sessions/YYYY/MM/DD/rollout-<time>-<id>.jsonl`, each carrying
  the newest version its facts cover.
- **A delete or a Claude desktop archive** is `SessionEnd` with `reason: other`. **Codex Desktop's Archive** is a rename of the
  rollout into `~/.codex/archived_sessions/`, keeping its name, with no hook.
- **`deep env up`** runs through the session's Bash tool as a child of its agent process, with no `--root`.
- **The agent's program runs from `node_modules/@anthropic-ai/claude-code/cli.mjs`**, since the hub takes a resume from a new
  process only when that process's arguments read as Claude Code's (#1033). A Codex resume isn't played.
- **The hub's root is the installed `~/.deepbuild`** of the temp HOME, with `rules.json` from `crates/deep-hook` and `asks` in
  `config.json`, since the hub refuses a task with no deadline in your settings.

### AC1: the archive

- `transcript.archived`, as #20 defined it: `data.session` the session's handle, `data.evidence` the copy's SHA-256. A copy is
  read through `openEvidenceStore(...).read(sha)`, and must equal the source through `scrubText` at the source's last line,
  with the source gone.
- **Time:** 31 s, the time Codex Desktop leaves the rollout, is this criterion's limit in both apps. AC4 holds the 5 s.
- **`archived_sessions` has no budget in the issue**, so the test asks only for the pass at the hub's start. The transcript
  is new since the last pass, so a program reading only `sessions` has nothing to find. It doesn't require a watch.
- Hook program: both apps' `SessionEnd` reach the hub through `deep-hook claude-code SessionEnd` and `deep-hook codex SessionEnd`.

### AC2 and AC6: volumes

- **The sample:** one `busybox:1.36` service, one named volume `data`, `ports: ["${web}:3000"]`. The stack's volume is
  `<project>_data`, with `project` as `deep env up --json` reports it, read by `docker volume inspect` and by the compose
  project label.
- **The bare volume** is `docker volume create dh342-bare-<hex>` through the Bash tool, with its PreToolUse and PostToolUse.
- **A Codex thread's Archive ends its session**, from the scope, so its volume is gone inside the 60 s this test allows. This
  needs the hub to see the rollout move while it runs. A dispute can name the test: the criterion's words are "after it
  ends", and the scope's are "A session ends by its SessionEnd, Archive or your Remove".
- **A kill:** `SIGKILL` to the agent process. `session.gone` (existing, #992) is how the test knows the hub saw it, and must
  still be appended. Its schema's "The session has ended" no longer holds; its text may change, its kind may not.
- **A second `deep env up`** in another repo follows the kill, since a new lease is when the base walks every stack whose
  session is gone. The volume and stack must stand 31 s after that, with `/health` answering 200.
- **Resume:** a new agent process, the same session ID and transcript, `SessionStart` with `source: resume`, then `SessionEnd`.

### AC3: outside resources

**The issue doesn't say how a resource becomes known, and this is the widest choice in the suite.** An agent saying so would
be its word (invariant 1), and nothing watches a provider, so the repo's spec says what creates one and the hub reads the
session's recorded Bash calls. `.deepbuild/done.yaml` gains a top-level `resources` block beside `checks`:

```yaml
checks:
  instance-gone: { type: command, run: "node --test .deepbuild/checks/gone.test.mjs", min_tests: 1 }
resources:
  cloud-instance:                                    # the kind's name
    created_by: '^\./bin/fakecloud create instance\b'  # a regex; a Bash command it matches creates one
    key: 'created (\S+)'                             # a regex over the call's stdout; group 1 names the resource
    cost: 49                                         # USD
    check: instance-gone                             # a check in `checks` that passes once the resource is gone
```

- **The task** is an `ask.created` with `kind: unblock`, one per resource, `question` holding the key, `cost_usd` the cost
  (#320's field) and `proves` the check's name. It may be raised at the call or at the session's end: the test reads it after
  `SessionEnd`, within 30 s.
- **The check run** gets the resource's key in `DEEP_RESOURCE_KEY`, on a snapshot of the session's folder, as #323's "I did it"
  runs one. A session that has ended must still be able to run it.
- **`deep inbox answer ask:<id> done`** is the trigger, as "I did it" is at the base. The design's "tasks close themselves"
  gives no interval, so a program that also closes the task unprompted passes: answering a closed task isn't a failure.
- **The task stays open** on a check that doesn't pass, whether by keeping its ask or raising a new one naming the key, as the
  base's `didIt` does. A task is open when no `ask.answered`, `defaulted`, `escalated`, `cancelled`, `superseded` or `moot`
  has it as `subject`.
- **Closed** is the run's `run.finished` with `data.check` the task's `proves` and `outcome: passed`, and no open task.
- **The provider** is `bin/fakecloud`, which writes `.cloud/<key>`. A resource lives in the session's folder because a check's
  sandbox reads only its checkout: outside it, `existsSync` is false, and "gone" would pass with the resource still there.
  `fixtures/gone-check.mjs`, which the repo holds as `.deepbuild/checks/gone.test.mjs`, therefore also requires `.cloud/provider`, so a check that can't see the provider fails closed.

### AC4's judgement

Readings start just before the hook runs. The transcript's reading ends at `transcript.archived`'s `ts`, the volume's at the
first `docker volume inspect` that fails. Four sessions (two per app) and two stacks. `judge` and `verdictOf` from #580's
helpers: every run within its limit is PASS (load only slows a reading); over it, on a loaded machine or off a reference Mac,
INCONCLUSIVE, a skip naming the reading; on a fit machine, every run over by more than the margin is FAIL. A session never
archived inside 31 s, or a volume standing at 60 s, is a plain failure, not a reading. "Compared with the merge base": the base
has no reading to compare, since it copies hourly and leaves the volume. AC6's 30 s is judged the same way.

### AC5: the pool

`{ "stack": { "slot": 1 } }` on #580's bench, whose helpers are imported. `stack.served` as #580 defines it. Any `ask.created`
after the claim fails the test. The journeys' outcomes aren't read, since the rule doesn't depend on them. A compose project's
name is a leased key that goes back to the pool, so C's stack can reuse B's project and volume names: a B volume counts as
gone when no volume has its name and its creation time (`volumeId`).

### Plants

`DEEP_HUB_PLANT=<name>`, tests only, through `packages/hub/src/plant.ts`. All four are new.

| Plant | Criterion | What it does | How the test fails on it |
|---|---|---|---|
| `reap-session-volumes` | AC2 | at a session's end, removes every volume its Bash calls made with `docker volume create` as well as its stack's | the failure names the bare volume |
| `teardown-closes-on-word` | AC3 | closes a teardown task on "I did it", with no check | the failure names the resource still at the provider |
| `pool-asks-which-stack` | AC5 | raises an ask about which stack to stop when the pool is full | the failure carries the ask's question |
| `reap-on-kill` | AC6 | treats `session.gone` as the session's end and takes its stack down | the failure names the volume |

Beyond the plants: AC1 reads the copy's bytes with the source gone, so a program that only records the event fails, and each
session's last line is written just before it ends, so a copy from an earlier pass fails.

## Criteria to tests

| ID | File | Tests |
|---|---|---|
| AC1 `#342.c44dce7a` | `archive.test.ts` | Claude desktop and Codex Desktop: `SessionEnd`, a copy holding the last line inside 31 s, read back whole with the source gone. A Codex thread archived with no hook, read from `archived_sessions`, its last line included |
| AC2 `#342.af0f0d14` | `volumes.test.ts` | `SessionEnd`: the stack's volume gone, the bare one standing once the lease has ended. A Codex Archive with no hook: the volume gone. Plant: `reap-session-volumes` |
| AC3 `#342.f889fe59` | `teardown.test.ts` | two instances and a number: three tasks at their costs; "I did it" with the resource there leaves its task open; gone, its check passes and only its task closes. Plant: `teardown-closes-on-word` |
| AC4 `#342.70f069fa` | `budgets.test.ts` | transcript within 5 s, volumes within 30 s |
| AC5 `#342.fe43a696` | `pool.test.ts` | `stack.slot` 1: idle B's containers and volumes go, C is served, no ask. Plant: `pool-asks-which-stack` |
| AC6 `#342.d43f4556` | `interrupted.test.ts` | `SIGKILL`, `session.gone`, a second stack, 31 s: the volume and stack stand. Resume and `SessionEnd`: gone within 30 s. Plant: `reap-on-kill` |

## What this doesn't test

- **Not yet run past the base:** no implementation exists, so nothing here has passed end to end. What ran instead is in
  BASE-FAILURE.txt. A helper bug past those points is a dispute for a blind redraft, not a fault of the work.
- **AC3's check stage has never run a real check to `passed` or `failed`.** The task flow ran on the base through a real
  `deep_ask` task: the answer closes the ask, the check runs, a run that doesn't pass raises it again. On this Mac those runs
  were `uncounted` (The Node a check needs), and the check file was run by hand outside the sandbox in its four cases.
- **`your Remove`** ends a session in the scope, but no such surface exists at the base. It's R2's, and no test reaches it.
- **A host shutdown or a hub restart with an interrupted session.** The scope says it keeps its volumes and stacks; AC6 names
  only SIGKILL, and at the base the hub's stop takes every stack down. The implementing PR should say what it does there.
- **A warm stack at a session's end:** covered by #580's AC6, not repeated. **A stack whose journey runs at reclaim, and the
  wait for a slot:** covered by #580's AC7.
- **An interrupted session's stack when the pool is full.** The issue doesn't say which rule wins.
- **"On the reference Mac in the local preflight" (AC4):** no task is added to `benchmarks/budgets.json`. This Mac is a
  Mac17,10, so an over-budget reading here can only be INCONCLUSIVE.
- **A resource no spec declares.** The hub can't see it, as with anything else "the supervisor can't prove it started".

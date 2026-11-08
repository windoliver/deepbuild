# Acceptance tests for #1337: people in the record

Written first, blind, by a job that never saw an implementation of #1337; none existed. The implementing agent doesn't
edit these files (AGENTS.md, Proof); a dispute goes to a blind redraft of this job (design: Dogfooding).

The issue has four checkbox criteria, AC1 to AC4 in the body's order. Each test's name carries its criterion's ID
(`#1337.` and the first 8 hex digits of SHA-256 of the criterion's text, white space collapsed, as
`scripts/proof-change.mjs` reads it):

| AC | ID | File |
|---|---|---|
| AC1 | `#1337.e27cfa33` | `actor.test.ts` (and its plant) |
| AC2 | `#1337.dfaf2997` | `scope.test.ts` |
| AC3 | `#1337.2fe9c60c` | `reads.test.ts` (and its plant) |
| AC4 | `#1337.092487e3` | `one-person.test.ts` (an existing record), `visible.test.ts` (the merge-base comparison) |

## What was read

- Issue #1337 as of 2026-11-07, as the job's brief quoted it: Scope, the four criteria, Proof ("A fixture project with
  two people, and the merge-base comparison"), Depends on (#1336, merged).
- `docs/technical-design.md`: One hub for a project shared by several people; Socket roles and contract versions (its
  People in the record bullet, One role per credential, Your hub wherever it runs); One event log, with tables built
  from it (the `events` table: `actor`, `scope`, `project_id`); Privacy; the "Callers posing as others" row of Threats;
  Dogfooding. `AGENTS.md`.
- At the base `9d31efdb9027284b0617d1185154a1e4fe6c61f4` (main, 2026-11-07), for surfaces and conventions only:
  `packages/hub/src/core.ts` (the constant `YOU = { actor: 'you', scope: 'you' }` every connection gets, `events.read`'s
  event text with `project`), `server.ts` (hellos: `app` and `cli` with the control token, `mcp`; a first line with no
  hello is a hook; the method roles), `paths.ts` (`repoOf`: a folder name and a digest of the repo's path),
  `plant.ts` (`DEEP_HUB_PLANT`; a hub refuses to start with a plant it doesn't list), `confirm.ts`
  (`DEEP_HUB_TEST_CONFIRM`), `mods.ts` (the hub runs `claude plugin list --json`), `packages/record/src/index.ts`
  (`openRecord`); the suites `tests/acceptance/1325` (layout), `16` (its helpers, imported by path: the hub as a
  process, the line protocol, a session's hook payloads; its writer test, which this one's AC1 follows), `666`–`669`
  (the one-person e2e checkpoints AC4 runs).

## What the base does

Every event is stamped `actor: "you"`, `scope: "you"`; there is no second person, no credential but the control token,
and no read filter. A repo's project is `<folder name><8 hex of SHA-256 of its real path>`, so two clones read as two
projects. Every test fails or reads BLOCKED; `BASE-FAILURE.txt` has the run.

## Run them

macOS or Linux, with the repo's Node (`.node-version`, 24.22.0):

```sh
export PATH="$HOME/.local/share/fnm/node-versions/v24.22.0/installation/bin:$PATH"
npm ci                          # once
npm run build --workspaces      # every test runs packages/cli/dist/main.js
NO_COLOR=1 node node_modules/vitest/vitest.mjs run --root tests/acceptance/1337 --no-file-parallelism
node node_modules/typescript/bin/tsc -p tests/acceptance/1337/tsconfig.json
```

`visible.test.ts` also needs a built checkout of the merge base (AC4, below); without one it reads BLOCKED. Each world
lives under `/tmp/dh1337-*` (a short path, for the hub's socket) and is removed at the end; every process is stopped by
its PID. No model is called and nothing leaves 127.0.0.1. With `--root` here, Vitest writes its cache to
`tests/acceptance/1337/node_modules/.vite/`; delete it before committing.

## The world (`helpers.ts`)

A fixture project with two people, as the Proof asks. **maya** owns the hub: `deep hub run` with `HOME` her home, so
the hub's root is `<maya>/.deepbuild`, and she holds its control token. **bob** joins the project `acme/shop`.

- Repos, all real git, nothing fetched: a bare `acme/shop` with one commit, cloned three times: maya's at
  `<maya>/src/shop` (origin `https://github.com/acme/shop.git`), a second of hers at `<maya>/work/shop-2` (origin
  `git@github.com:acme/shop.git`), bob's at `<bob>/code/shop` (origin `https://github.com/acme/shop`). maya's own repo
  `<maya>/src/notes` (origin `https://github.com/maya/notes.git`), outside the project; and `<maya>/src/scratch`, with
  no remote.
- A session is an agent process (`fixtures/agent.mjs`) whose children carry its hooks (`fixtures/hook.mjs`, #16's hook
  client with a person's hello added), with `HOME` the person's home and the session's transcript under it. It sends
  SessionStart, UserPromptSubmit and PreToolUse (hook.request@1, Claude Code payloads from #16's helpers).
- Stand-ins for boundaries this repo doesn't own: the forge (`DEEP_HUB_TEST_FORGE` at a server on 127.0.0.1 that
  answers 404 to everything), and first on `PATH` a `gh` with no login, and a `claude` and a `codex` that list no
  plugins and do nothing else. `GH_TOKEN` and `GITHUB_TOKEN` are unset for the hub. `DEEP_HUB_TEST_CONFIRM` names a
  file holding `confirmed`, so a step that asks the OS to confirm the owner is confirmed.

## The surface under test: what the implementation must meet

The issue and design name a person's credential, the connection stamping the actor, scopes and reads, but no command,
message or plant. These are the choices this suite made; each is the smallest the design implies.

1. **Adding a person: `person.add`**, a socket method on the owner's `cli` connection (the control token):
   `{"v":1,"id":…,"method":"person.add","params":{"person":"bob","repo":"<absolute path of a clone of the project's repo>"}}`.
   The project is that clone's repo, by its forge identity. The result is `{"person": <the actor bob's events carry>,
   "token": <bob's credential>}`, both non-empty strings, `person` not `you`. (The design's one-time invite and an
   encrypted connection are "built later"; this is the local-socket stand-in for an invite, and whether it asks the OS
   to confirm the owner is the implementation's: the test confirms any such ask.)
2. **A person's reads**: a connection whose first line after the hub's hello is `{"v":1,"hello":"cli","token":<bob's
   credential>}`, answered by a line without `error`; then `events.read` (`{after, limit}`, paged by `log_pos`) and
   `sessions.read`, as the owner calls them today, return what bob may see.
3. **A person's hooks**: a hook connection that first says `{"v":1,"hello":"hook","token":<bob's credential>}` (after
   the hub's hello line), then sends the hook request line as today. The hub may answer the hello with one line
   without `error`, or not at all; the acknowledgement and the reply follow as today. A hook connection with no hello
   is the owner's, as every hook is today.
4. **Actors**: the owner's events read `actor: "you"`, as every event does today (and as AC4's existing record must keep
   reading); bob's events read the `person` that `person.add` returned. An event's own fields (here the payload's
   `actor`) never set it.
5. **Project scope**: an event's `project` (`project_id`) and `scope` as `events.read` serves them, and a session row's
   `project_id` in `sessions.read`.
6. **Plants (`DEEP_HUB_PLANT`)**, listed in `packages/hub/src/plant.ts` like the others; a hub that doesn't list one
   refuses to start, which reads BLOCKED:

   | Plant | The wrong program | Read by |
   |---|---|---|
   | `actor-from-payload` | a hub that takes an event's actor from the payload's `actor` field | AC1: fails, naming the event |
   | `reads-unfiltered` | a reader without the scope filter: a person's `events.read` and `sessions.read` return every row | AC3: fails, naming the row |

7. **The merge base's build (AC4)**: `DEEPBUILD_1337_BASE` names a checkout of the merge base of `HEAD` and
   `origin/main` (`DEEPBUILD_1337_MAIN` overrides the ref) with `npm ci`, `npm run build --workspaces` and deep-hook
   built in it. One way, from this worktree, at a short path of your own:

   ```sh
   base=$(git merge-base HEAD origin/main)
   git worktree add --detach /Users/Shared/deepbuild-1337-base "$base"
   (cd /Users/Shared/deepbuild-1337-base && npm ci && npm run build --workspaces && CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 cargo build --locked -p deep-hook)
   DEEPBUILD_1337_BASE=/Users/Shared/deepbuild-1337-base NO_COLOR=1 node node_modules/vitest/vitest.mjs run --root tests/acceptance/1337 visible.test.ts
   git worktree remove /Users/Shared/deepbuild-1337-base
   ```

## How each criterion is read

- **AC1** (`actor.test.ts`): bob is added to acme/shop. bob's session, in his clone, sends its three hooks over
  connections that present his credential, each payload carrying `"actor": "you"`. maya's session, in her clone, sends
  hers with no hello, each payload carrying bob's actor. Read by the owner, each event must be in the record under its
  ID with its own connection's person: bob's three with bob's actor, maya's three with `you`. A failure names the
  event's ID, its hook, its connection and what was stored. With `actor-from-payload` the same judgment must fail,
  naming one of the six events.
- **AC2** (`scope.test.ts`): bob is added to acme/shop when the hub can add him (so a hub that reads forge identity only
  once a project has people is judged where it does; at the base it can't, and the test goes on as a one-person hub).
  maya works in her two clones of acme/shop, at two different paths, one named by HTTPS and one by SSH. Every event of
  both sessions must name one `project` and one `scope`, the same for both, and both session rows the same
  `project_id`. Two guards keep a wrong program from passing: maya/notes reads as another project, and the repo with no
  remote keeps its path scope, the value the base computes (the issue's Scope: "A repo with no remote keeps its path
  scope"). The forge is written nothing.
- **AC3** (`reads.test.ts`): bob is added to acme/shop. maya works in maya/notes, her own repo (her personal scope), and
  in her clone of acme/shop; the owner's read holds both sessions' events first. bob then reads with his credential.
  His `events.read` must hold no event of maya's notes session (by the IDs sent, or the session) and his
  `sessions.read` no row of it; a failure names the row (the event's ID, or the session's). So that an empty read can't
  pass, his read must hold every event of maya's acme/shop session and its row: the project's work is shared with every
  person on it (design: What's shared). With `reads-unfiltered` the same judgment must fail, naming a row of maya's
  notes session.
- **AC4, an existing one-person record opens unchanged** (`one-person.test.ts`): `fixtures/one-person/ledger.db` is a
  record the base's hub wrote: maya alone, two sessions (a clone of acme/shop with a remote, and a repo with no remote),
  each SessionStart, UserPromptSubmit, PreToolUse, PostToolUse and Stop, 21 events, every one `actor: "you"`.
  `fixtures/one-person/read.json` is what the base's hub reads back when it opens that record again: every event it
  held, as `events.read` serves it, and the two session rows. The hub under test opens a copy, and the owner's read must
  hold each event exactly as the base read it (every field) and each session row's identity (`id`, `agent`,
  `project_id`, `worktree`, `branch`, `thread_id`, `parent_id`) unchanged. A failure names the event and the fields
  that changed. Then the hub must add a second person; until it can, the test reads BLOCKED, never PASS, since the
  criterion is about opening an old record with the hub that has people.
- **AC4, against the merge base the one-person e2e runs show no visible change** (`visible.test.ts`): the one-person e2e
  runs are the early end-to-end checkpoints, each one person and what they see of a session: `tests/acceptance/666`
  (`fast.test.ts`: a session's hooks reach the record through deep-hook and the hub), `667` (every file: an ask from
  raised to answered in the terminal), `668` (`fast.test.ts`: `deep setup`, a watched session in `deep status`, undo)
  and `669` (`fast.test.ts`: a false done held and sent back with its verdict line). Each runs, unchanged, in the merge
  base's checkout and in this one, one after the other, with a JSON report; every test must end the same way in both.
  One that passed there and fails here, or the reverse, or one only one side ran, fails, naming it with both ends. A
  difference where one side was skipped or its message reads INCONCLUSIVE (load; their own timing judges) reads
  INCONCLUSIVE. First the hub here must add a second person, else BLOCKED; then a missing or wrong base checkout, or a
  base run with no report, reads BLOCKED. The live files (`session.live.test.ts`) aren't run: they spend plan usage.

### Regenerating the record fixture

`DEEPBUILD_1337_MAKE_RECORD=1 node node_modules/vitest/vitest.mjs run --root tests/acceptance/1337 one-person.test.ts -t writes`
rewrites both files from the checkout it runs in. It ran once, at the base `9d31efdb` (`read.json` names it); run it
only at a base, never on the implementation. The ledger holds only the test's own temporary paths, no user data.

## Values the issue leaves open, and what these tests chose

1. **How a second person's credential is issued**: `person.add` (surface 1), naming the project by a clone.
2. **How a connection names its person**: the credential in the hello, `cli` for reads and `hook` for hooks (surfaces
   2 and 3). A hook with no hello is the owner's, so a one-person hub's hooks are as today.
3. **Who "another actor" is in AC1**: from bob's connection, the owner (`you`); from the owner's, bob. The claim is the
   payload's `actor` field, the event's own field as the agent sends it.
4. **"Project scope" in AC2**: an event's `project` and `scope`, and a session row's `project_id`. "Two different
   paths": two clones of one repo on one machine, named by HTTPS and SSH: one forge identity.
5. **"Another person's personal scope" in AC3**: maya's session in her own repo outside the project; "a person's
   read": `events.read` and `sessions.read` on that person's connection.
6. **"Opens unchanged" in AC4**: every event the record held reads back as the base reads it, field for field, and its
   session rows keep their identity; events the hub appends on opening aren't compared.
7. **"The one-person e2e runs" and "no visible change" in AC4**: the fast tests of #666–#669, each test's end at the
   merge base against here.

## Known limits

- AC2 reads two clones on one machine, both maya's; a clone on bob's machine sending through his credential is not
  read separately (AC1 sends from bob's clone, but reads only the actor).
- AC3 reads one direction: bob reading maya's personal scope. maya reading anything at bob's personal scope isn't
  read; the design keeps a person's own work on their own hub.
- AC4's comparison judges each test's end, not every line a suite's output shows; a change those suites don't assert
  wouldn't show. #670 and #671 (`deep show` figures and 3D scenes) aren't among the runs compared.
- `visible.test.ts` runs four suites twice: about 20 minutes or more, and they time hooks, so run it with the machine
  as quiet as the suites' own READMEs ask. It has never run against an implementation; its comparison was checked in a
  throwaway run of #667 against itself (below, BASE-FAILURE.txt).
- The issue's text was taken from the job's brief, not read from GitHub by this job (no network); the IDs are computed
  from that text.

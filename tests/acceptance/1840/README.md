# Acceptance tests for #1840: deep_search from a person's session filters decisions by scope

Written first, blind, by a job that never saw an implementation of #1840; none existed. The implementing agent doesn't
edit these files (AGENTS.md, Proof); a dispute goes to a blind redraft of this job (design: Dogfooding).

The issue has one checkbox criterion, AC1. Each test's name carries its ID, `#1840.5abd3b51`: the first 8 hex digits
of SHA-256 of the criterion's text, trimmed and white space collapsed (`scripts/proof-change.mjs`, `criterionId`),
computed from the text as this job's brief quoted it:

> On a hub with two people, `deep_search` from the second person's session returns a decision saved at the project's
> scope and none the owner saved at their personal scope. A planted search with no scope filter on decisions fails,
> naming the decision

| AC | ID | File |
|---|---|---|
| AC1 | `#1840.5abd3b51` | `search.test.ts`: the criterion, and its plant |

## What was read

- Issue #1840 as the job's brief quoted it (labels bug, area:hub): the problem statement (`search()` reads every
  recorded decision matching the query with no scope filter; `covers` is applied to wiki claims only), Scope ("deep_search
  filters decisions by scope, as the other reads #1337 built do"), AC1, Proof ("Two people on one hub, the owner's
  personal and project decisions, and the second person's search, on the branch and the merge base"), Depends on #1337.
- `docs/technical-design.md`: One hub for a project shared by several people (Who writes the record; What's shared,
  which lists "decisions they saved for all their repos" among a person's personal scope and says "Reads filter by
  scope, so a person never reads another's personal scope"; Who approves what); Who drafts it, under Dogfooding.
  `AGENTS.md`.
- At the base `2ded12b8a` (main, Nov 12 2026), for surfaces and conventions only: `packages/hub/src/search.ts`
  (`search()`, its decisions query, `covers` on wiki hits), `mcp-operations.ts` (`find`, `bind`: a deep mcp's own
  session or the PreToolUse stamped for the call; `askFor`: a choice with a recommendation goes on at once,
  provisional), `people.ts` (`person.add`, `scopeOf`), `session-state.ts` (`seenBy`, the filter #1337 built for
  `events.read` and `sessions.read`; `verify`; `mcpHello`), `core.ts` (`connection`: the actor and the event's `scope`),
  `human-answers.ts` (`ask.answer`), `trusted-actions.ts` (the trusted path), `plant.ts`, `packages/asks/src/index.ts`
  (`answer` and `saveAt`: an option you choose is saved at the ask's repo, or its session; `saveDecision` at `all`),
  `decision-keys.ts` (`scopeOf`), `paths.ts` (`hubAddress`, `projectIdOf`), `tools.ts` (deep_ask's and deep_search's
  arguments); the suites `tests/acceptance/1337` (its world and `hook.mjs`, imported by path), `16` (the hub as a
  process, hooks, the address setting), `26` (deep mcp, deep_ask, deep_search, `seed`), `884`, `806` and `1330` (how a
  Codex session's calls are stamped, and an owner's `asks` settings), `2043` (this README's model).

## What the base does

`search()` lists every `decision.created` whose ask's question holds the query's words, whoever saved it and at
whatever scope. bob's search from his session on acme/shop returns the decision maya saved for all her repos and the
one from her own repo maya/notes, beside the project's. The main test fails on that assertion; the planted test reads
BLOCKED, since the base doesn't list the plant. `BASE-FAILURE.txt` has the run.

## Run it

macOS or Linux, with the repo's Node (`.node-version`, 24.22.0) and Rust (1.99.1):

```sh
export PATH="$HOME/.local/share/fnm/node-versions/v24.22.0/installation/bin:$PATH"
npm ci                          # once
npm run build --workspaces      # the tests run packages/cli/dist/main.js: deep hub run, deep mcp
CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 cargo build --locked -q -p deep-hook   # the hub refuses to start without it
NO_COLOR=1 node node_modules/vitest/vitest.mjs run --root tests/acceptance/1840 --no-file-parallelism --testTimeout=600000
node node_modules/typescript/bin/tsc -p tests/acceptance/1840/tsconfig.json
```

Each test starts one hub; a run takes a few seconds. Worlds live under `/tmp/dh1337-*` (#1337's `tempDir`, a short
path for the hub's socket) and are removed at the end; every process this suite starts (hubs, agent stand-ins, their
deep mcp) is stopped by its PID. No model is called and nothing leaves 127.0.0.1 (#1337's stand-in forge, `gh`,
`claude` and `codex`). With `--root` here, Vitest writes its cache to `tests/acceptance/1840/node_modules/.vite/`;
delete it before committing.

## The world

#1337's fixture project with two people (`tests/acceptance/1337/helpers.ts`, `world` and `joinBob`): **maya** owns the
hub (`deep hub run` with `HOME` her home, her control token); **bob** is added to `acme/shop` with `person.add` on her
control connection and holds his own credential. The clones are #1337's: maya's `<maya>/src/shop`, bob's
`<bob>/code/shop` (one forge identity, so one project), and maya's own repo `<maya>/src/notes`
(`https://github.com/maya/notes.git`, outside the project). The scene, in order:

1. **maya's decision for all her repos** (`all`). Before the hub starts, its record is seeded through the record and
   the asks core (#26's `seed`): a choice ask the core raises in no session, her answer `files` on the trusted path
   (`cli`), then `saveDecision(…, 'all')`. That is the path the shipped hub takes to save an answer for all your repos
   (the wiki's merge of two folders does exactly this); the base has no socket method that saves a decision at `all`.
   The hub then opens that record (#1337's `ledger` option).
2. **maya's settings**: her `config.json` gets an `asks` block declaring a choice's deadline (`2d`) and default
   (`recommended`), as #1330's suite writes it; without one, deep_ask is refused BLOCKED.
3. bob is added; bob's `~/.deepbuild/config.json` names the hub's socket (`hub.address`, #16's setting), so his deep
   mcp reaches the project's hub.
4. **The project's decision** (`repo:<acme/shop>`): maya's Claude Code session in her clone of acme/shop
   (SessionStart, UserPromptSubmit, PreToolUse from an agent process's children; its deep mcp bound by its process)
   calls `deep_ask` for a choice with a recommendation, so it goes on at once; maya answers it with `ask.answer` on her
   control connection, confirmed by the OS stand-in (`DEEP_HUB_TEST_CONFIRM`). The asks core saves it at the ask's
   repo: the project's scope.
5. **maya's decision in her own repo** (`repo:<notes>`): the same, from her Claude Code session in maya/notes.
6. **bob's session**: a Codex session in his clone of acme/shop whose three hooks present his credential
   (`{v:1, hello:'hook', token}`, #1337's `hook.mjs`) and carry no transcript path. Its agent process runs the real
   `deep mcp` as a child (`fixtures/agent.mjs`). Each of his deep_* calls is preceded by the PreToolUse Codex fires
   for it (`mcp__deep__<tool>` with the call's arguments), which binds the call to his session (#39, as #806's suite
   stamps it).
7. bob calls `deep_status` (it must name his session), then `deep_search` with the word all three questions hold,
   following `next` until no page is left.

Before judging, the owner's `events.read` and `sessions.read` must show the scene as written, or the run reads
BLOCKED, never PASS: each `decision.created` with the scope above (`repo:` + its session's `project_id`, and `all`),
maya's two sessions in two projects, bob's session in acme/shop's project, and bob's three events with his actor.

## How the criterion is read

- **Passes** when every page of bob's search is a value with `hits`; no hit cites (`source`) the `decision:<id>` of
  either of maya's personal decisions, or holds the word only that decision's question holds (`marker`), in any field;
  and some hit cites the project's decision. A failure lists each personal decision bob read: its source, its
  question, why it is personal and its scope, and the hit.
- **The wrong program** (`DEEP_HUB_PLANT=search-decisions-unfiltered`): the same scene on a hub with the plant, and the
  same judgment must fail with a message naming one of maya's personal decisions (its `decision:<id>` or its
  question). The base is that program, so the base run is also the plant's check against this judgment.

## Values the issue leaves open, and what these tests chose

1. **"A decision the owner saved at their personal scope"**: two, both maya's. The design's What's shared lists as a
   person's personal scope "their repos and workspaces outside the project, decisions they saved for all their repos".
   So: one at `all` (the issue's own example: "the decisions the owner saved for all their repos"), and one from her
   own repo outside the project, at `repo:<notes>`. A fix that applies the base's `covers` to decisions drops the second
   and still shows the first; a fix that hides only `all` shows the second. Each fails here.
2. **"The second person's session"**: bob's session on acme/shop, as the hub knows it from hooks presenting his
   credential, with deep_search reached the way an agent's session reaches it: its own `deep mcp`. It is a Codex
   session with no transcript path because on the base a Claude Code session is a live session only if its
   transcript is under the hub owner's own `~/.claude/projects` (`session-state.ts`, `verify`): bob's, in his own home,
   never is, so his deep mcp binds to no session and his deep_* calls are refused or read unbound. A Codex hook may
   carry no transcript path (its facts), and such a session is checked by its folder and process alone, which fits a
   person whose transcript stays on their own machine (design: What's shared).
3. **"A decision saved at the project's scope"**: maya's answer to a choice raised in her session on acme/shop,
   saved by the asks core at `repo:<acme/shop's project>`, the scope its card shows. That it's maya's (the owner's)
   makes it the case a filter by who saved it gets wrong: the project's decisions are shared whoever saved them.
4. **"Returns"**: a hit citing `decision:<id>`, deep_search's citation for a decision (#26), on any page.
5. **The plant's name**: `search-decisions-unfiltered`, a search that reads decisions with no scope filter, as the
   base does.
6. **The query**: one random word that only the three questions hold.

## What the implementation must provide

- The plant `search-decisions-unfiltered` in `packages/hub/src/plant.ts` (the `Plant` type and `PLANTS`), selected
  with `DEEP_HUB_PLANT` like the others. Until it is listed, the hub refuses to start with it and the planted test
  reads BLOCKED.
- Nothing else is asked of the hub: no new method, setting or environment variable. Every surface above exists on the
  base.

## Known limits

- One direction only: bob reading maya's personal decisions. maya, or a third person, reading bob's isn't read; nor
  what bob's search shows of decisions he saved himself.
- A decision at `session:<id>` of one of maya's sessions isn't read separately; nor a search bound to no session (a
  deep mcp started by hand), nor a Claude Code session of bob's (point 2 above).
- bob is on the hub's machine, through its local socket. Over the network the base's hub refuses a `mcp` hello
  (#1338), so a search from another machine can't be tested yet.
- The event's own `scope` column (#1337) isn't asserted: the judgment is what deep_search returns. On the base an
  owner's answer from the CLI writes `decision.created` with `scope: "you"` whatever the decision's own scope, so a fix
  that filters decisions only by that column would hide the project's decision too, which the positive half catches.
- The passing side has never run: there is no implementation yet.
- The issue's text was taken from the job's brief, not read from GitHub (no network); the ID is computed from that text.

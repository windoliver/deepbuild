# Acceptance tests for #84: what reaches you, and what goes back (reach)

Written first, blind, by a job that never saw an implementation of #84 (there is none on the base). Sibling jobs write
the issue's other criteria; this folder covers the twelve below. Sources:

- **The issue**: its text as of 2026-11-05T23:06:22Z (`updatedAt`): Scope, the acceptance criteria and Depends on.
- **The design**, `docs/technical-design.md`: An agent says it's done (Questions at the stop, A question holds the
  send-back), An ask, and your answer getting back (Every ask ends, Asks stay current, Tasks only you can do, Could the
  agent do it?, Work goes on while you decide, Where they reach you), The done loop, Ask, Budget, What each agent gives
  us (`questionTools`), and the Question card in `docs/canvas-primitives.md`.
- **The base commit**: `d722ba3d` (origin/main). The base code read, to learn how to drive it: `packages/hub/src/`
  (`core.ts`, `holds.ts`, `inbox.ts`, `numbers.ts`, `server.ts`, `plant.ts`), `packages/asks`, the schemas `ask.created@4`,
  `question.proceeded@1`, `claim.sent_back@1`, `crates/deep-app/src/{kinds,question}.rs`, and `adapters/*.facts.json`.
- **Sibling suites, for their conventions**: tests/acceptance/82 (the world, the hub, both agents' sessions, `failureOf`,
  the load rule) and 325 (deep_ask, `deep inbox answer`, prices), 321 (how a proceed is read).

The implementing agent does not edit these files (AGENTS.md, Proof). A dispute goes to a blind redraft of this job.

## How to run

With Node 24.22 (`.node-version`) first on `PATH` and the Rust toolchain. An older Node misreads every run: on 23.9 R1
reads `INVALID 0/1` and the stop is let through, so no reading on it counts.

```sh
npm ci                                   # once, if node_modules is missing
npm run build --workspaces               # the hub and the deep CLI the tests start
CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 cargo build --locked -q -p deep-hook
node node_modules/vitest/vitest.mjs run --root tests/acceptance/84/reach --no-file-parallelism --testTimeout=600000
node node_modules/typescript/bin/tsc -p tests/acceptance/84/reach/tsconfig.json
```

- Every test starts hubs of its own, so the folder belongs on `scripts/lanes.mjs`'s one-at-a-time list (`alone`). The
  implementer adds it.
- Every test makes its folders under `/tmp/dh84r-*`, sets `HOME` to `<tmp>/h` for every process it starts, and never
  touches the real `~/.deepbuild`, `~/.claude` or `~/.codex`.
- It stops only processes it started, by PID (`helpers.ts`, `cleanup`), never by name or port.
- No network, no model, no `claude` or `codex` binary, no `gh` call. A child never inherits this process's billing keys,
  forge tokens or its `DEEP_*`, `GIT_*`, `XDG_*`, `CLAUDE*` or `CODEX*` settings.
- Hubs run with `DEEP_HUB_TEST_STOP_HOLD_MS=20000`.

## Criteria and tests

| ID | Criterion, shortened | Test |
|---|---|---|
| `#84.986a9302` | A "please sign in" task whose browser profile is leased goes back to the agent | `tasks.test.ts`, LEASED |
| `#84.804317c5` | Every task only you can do can be answered "the agent can do it" in one tap | `tasks.test.ts`, ONE_TAP |
| `#84.93a842f3` | A step for a repo's owner goes back when you or the agent have access; an option needing a missing tool never reaches you | `tasks.test.ts`, OWNER (2 tests) |
| `#84.a35c51d3` | A replay of the month's hand-backs records how many went back; each names a tool | `replay.test.ts` (and a plant) |
| `#84.b85e1a32` | When you choose B after the agent went on with A | `switch.test.ts` (and a plant) |
| `#84.29e07ab1` | A choice the final message says the agent made on its own becomes a provisional card | `provisional.test.ts`, ON_ITS_OWN |
| `#84.21aff0fa` | A choice goes on at once with the recommended one, and your later answer switches it | `provisional.test.ts`, GOES_ON |
| `#84.649e58d4` | A Codex card approving a run inside the budget never reaches you | `codex.test.ts`, BUDGET_CARD |
| `#84.a45e1085` | A Codex card with a stated default never waits on you | `codex.test.ts`, DEFAULT_CARD |
| `#84.d85d8803` | AskUserQuestion is caught at PreToolUse; a covered one is answered through `allow` | `ask-user-question.test.ts` |
| `#84.a7a12533` | "unblock: sign in at https://login-github.example/session to continue": plain text with its host | `urls.test.ts`, URL_PLAIN (and a plant) |
| `#84.28df6377` | `STRIPE_API_KEY` opens its entry field; Codex's sign-in offers `codex login` | `urls.test.ts`, TRUSTED_PATH |

## Surfaces the implementer must provide

The design and the issue name the Stop and PreToolUse replies, the record, `deep inbox`, `inbox.read`, `numbers.read`,
`deep_ask` and `ask.answer`. They leave these open, so this suite chose the smallest one for each:

- **`DEEP_HUB_TEST_REACH`**: a JSON file, read at each check, standing for what the could-the-agent-do-it check reads on
  a real machine. Only tests set it. Its shape is `Reach` in `helpers.ts`:
  - `tools`: `{name, kind: cli | mcp | browser | computer, provider?, signed_in?, connector?, read_only?, reads?}`;
  - `profiles`: `{profile, provider, leased}`, a signed-in browser profile, usable only when `leased` is true;
  - `credentials`: `{secret, provider?}`, a secret held by reference, and the provider a task may name it by;
  - `grants`: `{grant, step}`, your standing grants;
  - `access`: `{repo, who: you | agent, via}`, who already has access to a repo, and the tool it goes through.

  A task names what it needs by a provider ("sign in to GitHub"), a secret's name, a tool's name, a table a tool `reads`,
  or a repo. A send-back names the tool to use by its `name`, the profile by `profile`, or the secret by `secret`.
- **An option `the agent can do it`**: every unblock's `options` holds one whose id or label matches
  `/the agent can do it/i`, whichever source raised the task (a stop, `deep_ask`, a stop's block). Answering it with
  `deep inbox answer <ask> <option>` is the one tap.
- **`ask.card`**: a socket method for the `app` and `cli` roles, `{ask: 'ask:<id>'}`, returning the question card's
  document: the asks core's `Card` with the ask's text. The shell draws the card from this.
- **`opens`**: on `ask.card`'s result and on the task's `inbox.read` row, where the trusted path sends you:
  `{kind: 'secret', name: 'STRIPE_API_KEY'}` for a secret's entry field, `{kind: 'sign_in', command: 'codex login'}` for
  the sign-in command the agent's facts name. `deep inbox` prints the secret's name or the command on the task's line.
  `adapters/codex.facts.json` names `login status` today; the command that signs in is a facts entry to add.
- **The reading `handbacks_sent_back`**: a row of `numbers.read`, `value` the hand-backs sent back with the tool to use,
  `detail` one row per hand-back in the sample, sent back or not. A hand-back is an unblock the check ran on: a stop's or
  a card's. The replay plays them through hooks like any session, so the reading reads the hub's record.
- **`deep_ask` on a choice**: returns at once with the recommended option, its value naming that option and saying it
  is provisional or can be undone. Today it waits, and it raises every ask with `provisional: false`.
- **An AskUserQuestion's option as a saved decision**: the choice ask raised for a call keeps each option's label as it
  was written, or an id the `answers` map can be built from, so `answers[question]` is the option's label as the call
  wrote it. The key comes from the requirement the question names and the options, never the question's words.

## Reading the criteria

- **A task from a stop** is what the stop's last message hands to a person. These tests write it in the form the issue's
  own criterion uses, `unblock: …`, so the sort has a structural line to read. A plain question at a stop is the sibling
  jobs' subject.
- **A choice from a stop** names its requirement (`R1`) and its two options, so its ask can be filled from structure
  (design: "with its options and what it is pinned to"). "Should it be blue?" is the sibling jobs' subject.
- **"Goes back to the agent"** is a Stop reply that keeps the turn going, naming the tool, with no ask raised. These
  sessions have a failing requirement, so a send-back may ride in the same reply; a reply that doesn't name the tool
  fails, so an ordinary send-back doesn't pass as one.
- **"A check of B"** (SWITCH) is a run of a requirement's check on a commit made after your answer. R1's check passes on
  either store, so only the commit tells them apart: a green run on A's commit proves nothing about B.
- **"One send-back"** (SWITCH): the commits under A appear in one reply only, across the stop after your answer and the
  no-work stop after it.
- **"Your later answer switches it"** (GOES_ON, DEFAULT_CARD): what the agent hears names your option and the one it
  went on with, the `undoes` the asks core already hands over, so an answer that reads like a first answer fails.
- **"With no URL the agent wrote"** (TRUSTED_PATH) is read on where a task sends you: `opens`, `where`, `steps` and the
  options hold no URL. The question's own words may keep the URL as plain text, which URL_PLAIN governs.
- **A stated default** (DEFAULT_CARD) is said in the question and in the option's label, `(default)`.
- **The replay's sample** is built from `adapters/corpus` shapes, not lifted from a month of private transcripts, which
  the repo must not hold: ten hand-backs, two of each class the criterion names. Its count is a reading. The test fails
  only on a hand-back sent back naming no tool the check found, one that neither went back nor reached you, and a
  reading that disagrees with what the replay saw.
- **No stimulus names a command to run.** The base hub runs what a final message tells you to run (#323: a shell block,
  or a backticked command after "run"), and quotes its output in the send-back. So a hand-back written that way starts a
  real CLI and echoes the tool's name back, which would pass the replay with no tool found. Every hand-back here is in
  prose, with the tool's name absent from the agent's words; `namesWord` is case-sensitive, so "Vercel" isn't `vercel`.

## Codex cards

The corpus holds no `request_user_input` call: no recorded session raised one. The card here is the tool's own input,
`{questions: [{id, header, question, options: [{label, description}]}]}`, sent as a PreToolUse with
`tool_name: 'request_user_input'`, the name `adapters/codex.facts.json` lists under `questionTools`. A block reason is
how Codex hears the answer (issue, Scope), so an answered card is `decision: deny`, or exit 2, with its reason.

## Plants

| Plant (`DEEP_HUB_PLANT`) | On the base | Criterion | The wrong program | What the test requires |
|---|---|---|---|---|
| `sends-back-no-tool` | **new** | `#84.a35c51d3` | a hand-back goes back with the tool's name left out | fails, naming the hand-back's id |
| `records-switch-only` | **new** | `#84.b85e1a32` | your switch is recorded and nothing else happens, so the claim passes on A's commits | fails |
| `link-from-agent-url` | **new** | `#84.a7a12533` | a view makes the agent's URL a link or a button | fails, naming the link |

A plant the hub doesn't list stops `deep hub run` ("names no planted program"); the test then fails with `BLOCKED: plant
<name> not listed …`. The implementer adds them to `packages/hub/src/plant.ts`.

Criteria that name no plant carry a twin in the same test, so no blanket answer passes: a profile you didn't lease, a repo
nobody has access to, a run no budget covers, a report that chose nothing, a near-miss AskUserQuestion.

## Load

A hook deep-hook couldn't hand to the hub within its budget, and a stop let through before its fast-lane runs ended
while the 1-minute load is past the core count, are INCONCLUSIVE: a skip naming the load, never a pass or a fail
(`helpers.ts`, `unreached`, `heldOut`). So is `deep_ask` taking 15 s or more under that load.

## Files

- `helpers.ts`: the world, the hub, the record's readers, both agents' sessions, the waiter, `deep_ask`, your answers, and
  `wentBack`, `reachedYou`, `linkFields`.
- `fixtures/agent.mjs`: each session's agent stand-in, the parent of that session's deep-hook runs and its `deep mcp`.
- `fixtures/handbacks.json`: the replay's sample and what the check can find for it.
- `tsconfig.json`: the root's strict options with `noEmit` and `allowImportingTsExtensions`.
- `BASE-FAILURE.txt`: the run on the base commit, trimmed to each test's failing assertion.

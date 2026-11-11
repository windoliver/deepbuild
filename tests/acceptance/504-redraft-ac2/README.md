# Blind redraft of #504's criterion 2: an agent's figure or film explains and never proves

`#504.3b622b2f` — "An agent's figure or film never appears in Needs you and never feeds a verdict; it shows beside an opened
ask or in a receipt's explains-never-proves section"

This folder is the blind redraft of #504's second acceptance criterion (docs/technical-design.md, Dogfooding: "A disputed test
goes to a fresh run of that job, with the same inputs and the criterion, never the work, the diff or the dispute"). It was
written from the issue, the design and the base commit only, by a job that never saw an implementation of #504, its first
draft (`tests/acceptance/504*/`), its branches, pull requests or other worktrees.

The implementing agent doesn't edit these files (AGENTS.md, Proof).

## What was read

- Base commit `a04378eb2` ("Merge pull request #2190 from windoliver/worktree-hungry-booth-587310").
- The issue, windoliver/deepbuild#504 (`gh issue view 504`, read 2026-11-10): Scope, Fields, its nine acceptance criteria, Proof,
  Depends on. The criterion's ID, `#504.3b622b2f`, is `scripts/proof-change.mjs`'s `criterionId` (line 153) over the live text.
- Its oracle page, `doneright/oracles/issues/504.md` in DeepBuildAI/deepbuild (branch `doneright`): no upstream test; criterion 2
  is "App flows: the generated skill, Needs you and where an ask may draw during present mode".
- `AGENTS.md` lines 14-25 (Proof).
- `docs/technical-design.md`:
  - 300-310 (Check health to Carried across sessions; 307: "Each line of a receipt also names its proof … and a lower proof is
    never shown as a higher one");
  - 477 (the MCP tools row: `deep_show` "draws any canvas document … on the agent's own claim or ask, or on the prompt its turn
    answers … you see it when you open them, it is never pushed, and a picture is never proof");
  - 561-568 (Canvas: "Agents draw the same scenes through `deep_show`, as their own layer; a figure explains and never proves");
  - 591-593 (Films and figures on the canvas: "A figure explains and never proves"), 621 (Export: "A film can be attached to a
    claim as an explanation, never as evidence"), 925 ("A picture explains and never proves");
  - Needs you and asks: 2042 (One list and one page: "The list holds the heading Needs you with the one count and a row per open
    ask"), 2080 (`needs-you@1`), 2248 ("Asks and tasks wait in Needs you and in `deep inbox`"), 2252 ("Looking at an ask never
    answers it"), 2303 (the view row: Needs you's rows, "presented on its question card beside them"; an item leaves Needs you
    "never because you looked"); `provisional` in `packages/hub/src/core.ts` (below);
  - 2628-2632 (Criteria to tests, Criteria in a checked shape, Wrong programs, the edit guard) and 2652 (Dogfooding).
- `docs/canvas-primitives.md`: 297 (a document's `id`, "minted by the hub"), 805-815 (Question card: "the view draws the evidence
  beside it, such as a sheet or a diff"), 3547 (`piece.code_change`'s `subject`: "the claim it explains, never proves"), 8304 ("a
  document check passes a claim only when the document is itself the work: when the claim's definition names it among its
  deliverables").
- The base's code, only for which surfaces exist and how they behave:
  - `packages/hub/src/core.ts`: `mcpCall` (6710), the canvas side's `show` (6819) and `recordRevision` (6968), `inbox` (6154),
    `askCard` (6191), `change` (6072, changes/:id, "a claim … and its receipt"), `askFor` (7175: a taste call or choice with a
    recommended option is provisional and returns at once with `status: 'provisional'`; without one it waits in `waitFor`),
    `claim` (7354: records `claim.made`, runs nothing);
  - `packages/hub/src/canvas.ts` (the world file `DEEP_HUB_TEST_SHOW`, read again when it changes; `shape`; `showCall`),
    `show.ts` (`deep show`), `tools.ts` (the `deep_show`, `deep_ask`, `deep_claim` schemas), `server.ts` (roles, line 55 and
    98-99; `plantOf(process.env.DEEP_HUB_PLANT)`, 1449), `plant.ts` (`Plant`, `plantOf`), `mcp.ts` (calls served concurrently);
  - `packages/asks/src/index.ts` (`Card`, 139-174; `InboxRow`, 222-241; `card`, 913);
  - `crates/deep-show/src/hub.rs` (`deep show --check`'s verdict, 2488-2503 and 2614-2626: with `--claim`, PASS only when the
    claim's deliverables name the document, else INCONCLUSIVE), `verdict.rs` (the claim verdict on deliverables), `main.rs`
    (how the world's `docs` and `claims` are read, 996-1120: extra keys in a `docs` entry are ignored);
  - the suites whose seams this one reuses: `tests/acceptance/806/` (README, `helpers.ts`, `figure.ts`, `sessions.test.ts`,
    `fixtures/agent.mjs`), `26/helpers.ts` and `26/ask.test.ts`, `393/README.md` and `393/helpers.ts`, and `308/helpers.ts` and
    `391/loops.test.ts` for a film document's shape.

## Run them

```sh
npm ci                                    # once, if node_modules is missing
npm run build --workspaces                # the tests run the built CLI, packages/cli/dist/main.js: deep hub run, deep mcp, deep show
cargo build --locked -p deep-hook         # once: the hub's rule sync and guards look for deep-hook under target/
npx vitest run --root tests/acceptance/504-redraft-ac2 --no-file-parallelism
npx tsc -p tests/acceptance/504-redraft-ac2/tsconfig.json   # type-check: the root's strict options, allowImportingTsExtensions, noEmit
```

The file builds the hub's canvas core once, `cargo build --locked --bin deep-show` (#393's `buildBinary`), and fails each test,
naming the build, when it doesn't build. It starts three hubs one after another (the honest one, then each planted one), each in a
temporary home under `/tmp/dh806-*` (#806's helpers make them; a socket path must fit in 104 bytes), with `HOME` there, so nothing
touches the real `~/.deepbuild` or `~/.claude`. It stops only processes it started, by PID (#806's `cleanup`), and uses no network.
A run with `--root` leaves Vitest's cache in `tests/acceptance/504-redraft-ac2/node_modules/.vite`; delete it.

`scripts/lanes.mjs` needs this folder in its one-at-a-time list, as #806's and #393's are (the implementer makes that edit; this job
writes tests only):

```js
alone.push('tests/acceptance/504-redraft-ac2/')
```

Nothing here needs macOS, a GPU or the app: render-back snapshots come from the hub's headless worker (Vello CPU).

## The surface under test

The issue names no wire for this criterion. These tests reach the code only through the surfaces #806 and #26 already defined,
plus the four names marked **invented here**, the smallest the criterion needs.

### Calls

- **`deep hub run`**, with `HOME` the test's home and #806's seams in its environment: `DEEP_HUB_TEST_SHOW=<world file>` and
  `DEEP_HUB_TEST_CONFIRM` (#806's `startHub`), and `DEEP_HUB_PLANT` for the planted hubs.
- **The agent's hooks**: #806's Claude Code stand-in (`fixtures/agent.mjs`) sends SessionStart, UserPromptSubmit and a PreToolUse,
  each from a hook process it started, so the hub knows its process; its `deep mcp` is its child and binds to its session.
- **`deep mcp`, `tools/call`**:
  - `deep_claim {task_ref, attempt, commit, scope}` → `{claim: "claim:<id>", …}` (#26's `claimArgs`).
  - `deep_ask {kind: "choice", question, options: [{id: "left", …}, {id: "right", …}], recommended: "left", steps, where, why,
    check, thread, subject: null}`. Its handle is read from the record's `ask.created` (`ask:<event id>`, as #26 reads it), never
    from the call's return: at the base an ask with a recommended option returns at once as provisional, an implementation may make
    it wait, and the tests hold either way. The call is left running if it waits.
  - `deep_show {doc, document, t: "0s", size: [320, 200], include: ["issues", "pixels"]}` → #393's reply; each of the four must be
    `presented` at a numeric `rev`, or the world is BLOCKED.
- **`deep show --doc <ID> --document <file> --t 0s --size 320x200 --include issues,pixels --check --claim <claim> --json`**, run in
  the agent's process tree (#806's `deepShowCli`), so it acts as the agent's session → `{outcome, rev, result, …}`.
- **The hub's socket**, on a `cli` connection with the control token (#806's `hubCall`, #26's `events`):
  - `inbox.read {}` → `{asks: [{ask, question, …}], rows: [{id, …}], offers}`: what Needs you lists.
  - `ask.card {ask}` → the question card's document, which must now carry **`beside`** (below).
  - `changes.read {id: "claim:<id>"}` → `{change: {claim, runs, verdicts, line, second, checks, asks, produced, next_issue}}`, which
    must now carry **`explains`** (below).
  - `events.read` → every event; the tests read `ask.created`, and every kind starting `verdict.` or `run.`.

### Fields

- **World file `docs.<doc ID>.on`** — *invented here.* The handle (`ask:<id>`, `claim:<id>`) of the claim, ask or prompt the hub
  minted the document for (MCP tools row: `deep_show` draws "on the agent's own claim or ask, or on the prompt its turn answers";
  the `deep_show` tool's `doc` is "the doc ID the hub minted for your claim, ask or prompt"). #806's world file stands in for the
  hub's minting (`docs: {doc ID: {panel, document?}}`); this adds where each document belongs. The tests write it once the claim and
  the ask exist; the hub reads the world file again whenever it changes.
- **World file `claims.<claim>`** — #393's and #806's `{session, deliverables}`, written here with `deliverables: []`: the claim's
  definition names no deliverable, so nothing the agent shows on it is the work.
- **`ask.card`'s `beside: [{doc, rev}]`** — *invented here.* The documents agents showed on that ask, which the view draws beside
  its card when you open it: `doc` the doc ID (bare or as `doc:<ID>`, any case), `rev` the document's newest revision, the number
  the agent's calls' replies named. Exactly the documents shown on that ask, each once.
- **`changes.read`'s `change.explains: [{doc, rev}]`** — *invented here.* The receipt's explains-never-proves section: the documents
  agents showed on that claim, the same shape and rule.

### Planted programs

Each is selected with `DEEP_HUB_PLANT`, the hub's existing plant option (`packages/hub/src/plant.ts`), set on `deep hub run` and on
the agent so its `deep mcp` has it too, as #806 does; no new variable selects anything. The implementer adds both names to `Plant`.
An unknown name makes the hub refuse to start, so at the base each planted test fails BLOCKED.

| Name | The wrong program | The check it must fail |
|---|---|---|
| `figure-in-needs-you` | A hub that puts each figure or film an agent shows on its ask or claim in Needs you: when it presents an agent's revision of a document the world file places on an ask or a claim, it raises an ask for you naming the document, so `inbox.read` lists it. | `needsYouFailures`, with a failure that names one of the four documents or an ask other than the agent's own. |
| `figure-feeds-verdict` | A hub that takes an agent's figure or film on its claim as proof: when it presents an agent's revision of a document the world file places on a claim, it records a verdict on that claim from the revision's document check (a `verdict.made` whose subject is the claim), so `changes.read`'s `verdicts` lists it. | `verdictFailures`, with a failure that names the claim. |

A planted hub is read every 500 ms for up to 15 s after the flow, so its wrong behaviour may land after the call that caused it.

## What the tests do

One flow (`helpers.ts`, `runFlow`), run once on the honest hub and once on each planted one:

1. The agent files a claim (`deep_claim`) and a choice ask with a recommended option (`deep_ask`).
2. The world file names four documents the hub minted: a figure and a film on the ask, a figure and a film on the claim; and the
   claim, with no deliverable.
3. The tests read `inbox.read` and the claim's `changes.read`, and note the record's last log position.
4. The agent shows all four with `deep_show`: the figure is #806's six-item release figure with `profile: "figure"`; the film is a
   `profile: "film"` document with a 2 s transport and three bars.
5. The agent checks the figure on its claim against that claim with `deep show --check --claim`, a caption changed so it makes a
   revision of its own.
6. After 1.5 s the tests read `inbox.read`, `changes.read`, `ask.card` and the events after the mark (`observe`).

`explains.test.ts`, every test named `#504.3b622b2f …`:

- **Never in Needs you** (`needsYouFailures`): `inbox.read` lists no ask and no row it didn't list before step 4; its reply names
  none of the four doc IDs and no snapshot hash the replies named; the record holds no `ask.created` after the mark.
- **Never feeds a verdict** (`verdictFailures`): the claim's `runs`, `verdicts`, `checks` and `line` in `changes.read` equal what they
  were before step 4, and none names a doc ID; the record holds no `verdict.*` or `run.*` event after the mark about the claim or a
  document; the agent's `deep show --check --claim` isn't `PASS`.
- **Beside an opened ask** (`besideFailures`): `ask.card`'s `beside` lists the figure and the film on the ask, once each, at their
  newest revisions, and nothing else (so not the two on the claim).
- **In the receipt's explains-never-proves section** (`explainsFailures`): `changes.read`'s `change.explains` lists the figure and
  the film on the claim, once each, at their newest revisions (the figure's is the one its `deep show --check` presented), and
  nothing else.
- **Planted `figure-in-needs-you`** and **planted `figure-feeds-verdict`**: the same flow on the planted hub fails the first and the
  second check, naming what it should.

## Readings

- **Needs you** is `inbox.read`: the inbox projection `deep inbox` and the app's Needs you read (asks, and the open asks' rows), with
  the record's `ask.created` behind it. "Never appears" is read strictly: no ask or row for it, and its doc ID and snapshots appear
  nowhere in that reply, not even on the agent's own ask's row. Opening the ask is a different read, `ask.card`.
- **Never feeds a verdict** is read on the claim's receipt and the record: what the agent shows on its claim, and its own check of a
  figure against the claim, adds no run, verdict or check to the claim, changes no line, and is never `PASS` while the claim names no
  deliverable (Document check, canvas-primitives 8304). The base already holds this, so its proof is the planted twin.
- **Beside an opened ask** is the question card's document, `ask.card`, which the app reads when it presents the card; the view draws
  the evidence beside the card (Question card). **The receipt** is `changes.read` (core.ts: "changes/:id: a claim … and its
  receipt").
- **Where a document belongs** comes from the hub, never from the agent's call: here the world file's `on`, standing in for the hub's
  minting, as #806's `docs` does. A figure on the claim is not beside the ask, and one on the ask is not in the receipt.
- **A figure or a film**: one document of each profile on each. Both explain; neither is a deliverable.
- **Revision**: the entry names the document's newest revision, the highest `rev` a presented reply named.
- **Timing**: nothing here depends on whether a call's return or an event arrives first. The ask's handle comes from the record; the
  honest hub is read once, 1.5 s after the last call answered; a planted hub is read until it fails or 15 s pass.

## Not tested

- The app drawing a figure beside the card, or anything in pixels; present mode and where an ask may draw during it (the oracle's
  note); notifications, so "never pushed" beyond Needs you's list.
- A Codex session, a document on the prompt a turn answers, and an agent's layer on the project map.
- A document the claim's definition names among its deliverables, which is the work and may pass a claim on its document check.
- Who minted a document outside the test seam: how the hub mints a doc ID for an ask or a claim in production.
- The generated skill the oracle page mentions.

## Base

Not run: the machine was shared and loaded, so neither the suite nor a build ran for this draft. `BASE-FAILURE.txt` gives, per test,
the assertion it fails at on the base, read from the base's code. `npx tsc -p tests/acceptance/504-redraft-ac2/tsconfig.json` is clean.

## Files

- `explains.test.ts`: the six tests.
- `helpers.ts`: the world, the flow, `observe`, the four checks and the plant names; it reuses #806's helpers by import.
- `tsconfig.json`: #806's.
- `BASE-FAILURE.txt`: per test, where it fails on the base.

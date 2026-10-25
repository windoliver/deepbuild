# Acceptance tests for #667: an ask from raised to answered in the terminal, and one nobody answers takes its default

Written first, blind, from issue #667 (its text as of October 25, 2026: Scope, the five acceptance criteria, Proof and
Depends on), `docs/technical-design.md` (An ask, and your answer getting back; the Lifecycles, Ask and Decision and rule
primitives; Socket roles and contract versions, with "The trusted path is a device you paired"; the threat rows
"Injected answers" and "Agents driving other agents' terminals"; Dogfooding) and the base commit `7dcab7c`
(`origin/main`, with #318, #319, #24, #26 and #34 merged and nothing of #667). What was read at the base beyond the
design: the READMEs, helpers and scenarios of `tests/acceptance/24`, `34`, `319` and `318`, and `26`'s agent world and
fixture; `packages/hub/src/{core,server,wire,confirm,inbox,mcp,tools}.ts`, `packages/asks/src/index.ts` and
`packages/asks/sources.json`. No implementation of #667 existed or was looked for. The implementing agent doesn't edit
these files (AGENTS.md, Proof); a dispute goes to a blind redraft by this job.

## Run

```sh
export PATH=$HOME/.local/share/fnm/node-versions/v24.22.0/installation/bin:$PATH   # Node 24.22 (.node-version)
npm ci && npm run build --workspaces     # once: the tests run the built CLI, packages/cli/dist/main.js, and the hub it starts
npx vitest run tests/acceptance/667      # from the checkout's root
npx tsc -p tests/acceptance/667          # type-check the tests
```

No network, no git, no tmux. Each test makes its own folder under `/tmp/dh667-*` (a socket path must fit in 104
bytes), runs every process with `HOME` there, so the hub's root is `<home>/.deepbuild`, and never touches your real
`~/.deepbuild`. It stops only processes it started, by PID (`helpers.ts`, `cleanup`): the hubs, the agent stand-in,
its `deep mcp` and every `deep` command; never by name or port. Every hub runs with `DEEP_HUB_TEST_CONFIRM` naming the
test's stub file, so no test can raise a real Touch ID prompt. The tests start real hubs; the unit lane should run
this folder alone, as it does #24's and #34's (`scripts/lanes.mjs`, which this job doesn't edit). The tests import
nothing #667 adds: the record and the asks core as they are, for seeding only. `npx tsc -p tests/acceptance/667`
reports no errors on the base.

Each test prints its proof when it ends (`helpers.ts`, `Proof`; Vitest shows it for a failing test, and for every
test with `--silent=false`): `deep inbox`'s output at each
step, the stream's frames with their log positions and the hub start they came from, and the record's ask, answer and
decision rows with their log positions, timestamps and data. Failure messages name the criterion (`AC<n> #667.<id>`)
and the ask.

## The surface

The tests reach the code only through what the issue and its dependencies name:

- **`deep inbox`** and **`deep inbox answer <ask> <option>`** (#24), run as child processes with `HOME` set: by you
  (a child of the test process), or by the agent through its own shell (inside its process tree). Their output is
  #24's: lines starting `ask:<ULID>`, the first four fields the handle, kind, session and age.
- **`deep inbox undo <ask>`**, new here (below).
- **The hub**, `deep hub run`, with #16's and #24's test settings: `DEEP_HUB_TEST_CLOCK` (the hub's clock starts at
  that time and moves with real time), `DEEP_HUB_TEST_CONFIRM` (#24's file stub: `confirmed` is the OS confirming
  you, anything else a cancelled prompt, read at each confirmation) and `DEEP_HUB_PLANT`.
- **The socket**, as a `cli` connection holding the control token: `events.read` (the record's rows), `inbox.read`
  and `stream.subscribe` (#34's App API read and live stream: frames `{v, id, event}` in log_pos order, resumed after
  a hub start with a new subscription after the last log_pos held).
- **The agent stand-in** (`fixtures/agent.mjs`, after #24's and #26's): its hooks establish its session; its own
  `deep mcp` raises asks with `deep_ask` (#26) into the hub's asks core under that session and waits for their
  answers there; it runs `deep` commands through its shell.
- **`~/.deepbuild/config.json`**'s `asks` block (#319), written by the test: setup's drafts with the issue's
  deadlines, choice `4h` and authority `1d`, the fold at 5, and no `batch`, so every ask shows when it's raised.
- **The record and asks core** (`@deepbuild/record`, `@deepbuild/asks`), only to seed the authority ask before the hub
  starts, as #24's tests seed theirs.

### `deep inbox undo <ask>` (new)

AC4's "an undo opens it again", from the terminal, since the person uses only `deep inbox`. It takes the handle of an
ask that took its default, exits 0 and prints the handle when the ask is open again. The hub records the undo as an
event about the ask (its `subject` the handle, or its `data.ask`), which the stream frames after the `ask.defaulted`.
The ask is then open: `deep inbox` lists it, `inbox.read` holds it with a status other than `closed` and the outcome
`unanswered`, and `deep inbox answer` on it counts. The event kind, the socket method and whether the undo asks the OS
to confirm you are the implementer's; the tests run it with the confirmation stubbed `confirmed`.

### Wrong programs

Selected with `DEEP_HUB_PLANT=<name>` on `deep hub run`. Neither exists at the base (`packages/hub/src/wire.ts` lists
the plants); the implementer adds both names. #24's `answer-on-peer-check` and `answer-on-token` don't fit: the hub
refuses an answer from inside an agent's process tree before either plant acts.

| Name | What the plant does | Criterion | How the test fails on it |
|---|---|---|---|
| `answer-inside-session` | counts a `cli` answer from a process whose peer check finds an agent session's process above it, as if you had answered (the OS still asked) | AC3 | `AC3 #667.4014b343: ask ask:… (answered by deep inbox answer run inside session …'s process tree, the OS confirming) counted…` |
| `skip-default-at-deadline` | never takes an ask's default: past its deadline the ask stays open | AC4, AC5 | `AC4 #667.ca2b4f95: ask ask:… (the choice ask) is still open N s past its deadline…`; `AC5 #667.b1086458: ask ask:… (the sixth ask, folded into the exception) is still open N s past its deadline…` |

## Readings where the issue leaves a choice

- **Raised by a test process standing in for a session.** The choice and taste asks are raised by the agent stand-in's
  own `deep mcp` with `deep_ask`, into the running hub's asks core, so "within a second of its append" and "the test
  process that raised it gets the answer" have a live append and a raiser waiting on it. `deep_ask` takes no authority
  ask (only DeepBuild writes an `allow` option), and nothing else at the base raises one into a running hub, so the
  authority ask is raised through the asks core (`effect.push`, under the agent's session and the project `shop`) with
  the hub stopped, as #24's tests do. Its deadline and default are left out, so the core fills them from the settings.
- **The 4-hour choice deadline and the 1-day authority deadline** come from `config.json`; the tests check that each
  `ask.created` carries its raise time plus 4 hours, or 1 day, and the default `sqlite` (the recommended option) or
  `decline` (no).
- **Moving the hub's clock.** The hub's clock is set only at its start (`DEEP_HUB_TEST_CLOCK`), so the test stops the
  hub by PID and starts it again with its clock 20 s before the deadline. The deadline then passes while the hub runs,
  and the hub must close the ask by itself: the test reads only the record (`events.read`) while it waits (no
  `deep inbox`, no `inbox.read`, no answer, any of which could close an overdue ask on the way), until the hub's clock
  (bounded from below by the ready line) is 15 s past the deadline. The default must then be on the stream too. A hub that starts so slowly that its clock may already be past
  the deadline is BLOCKED, naming the start time. The stream consumer resumes after its last log_pos on each start.
- **"By its deadline."** The default must be recorded no earlier than the deadline (its `ts`) and within 15 s of the
  hub's clock after it; an ask still open then fails, naming the ask. The 15 s is generous for load (the machine ran
  at load ~100); it isn't a budget the design states.
- **"Within a second of its append."** The append's time is the `ask.created`'s `ts`; the first hub runs with no test
  clock, so its clock is the wall clock. You run `deep inbox` back to back from before the raise. Every run started a
  second or more after the append must list the ask (FAIL otherwise, whatever the load). The first run that lists it
  must end within 1,000 ms of the append; one that started in time but ended later is INCONCLUSIVE (skipped with the
  reading and the load average), never PASS. Its age field must be the time since the append when it ran.
- **"At the same log position."** The stream's frame for the ask comes within 5 s (generous: #34 holds the stream to
  50 ms at p95) at the log_pos `events.read` holds its `ask.created` at; an `inbox.read` taken before the raise reflects an earlier log_pos and doesn't hold it; one taken
  after the frame reflects that log_pos or later and holds it.
- **"Every step shows the same on the stream"** (the issue's summary): at the end of each test, every `ask.*`,
  `answer.*` and `decision.*` event the record holds after the stream's start is framed exactly once, at its log_pos,
  as the same event, within 5 s, and no frame differs from the record (`expectStreamMatchesRecord`).
- **"A decision with its scope."** The scope the ask's card shows: this repo's, `repo:<project>`, when the ask's
  `ask.created` names a project, else its session's, `session:<the session's letters and digits>`, as the base hub
  saves one for an ask with no repo. `deep inbox answer` prints it, and the decision carries the ask, the answer and
  that scope.
- **"Gets the answer once."** The agent's waiting `deep_ask` returns `{status: answered, answer: files}` (or, past
  its 40 s wait, its `deep_wait` does). A second answer, `sqlite`, is refused (a non-zero exit), the record keeps one
  `ask.answered`, and the agent's `deep_wait` still returns `files`.
- **AC3's order.** One authority ask: from inside the agent's process tree first, with the OS stub confirming, so
  only the peer check can refuse it (a hub that leans on the confirmation alone counts it); then by you with the stub
  `cancelled`; then by you with it `confirmed`. Each refused answer is checked in the record (no closing event, no
  decision) before its exit code, so a planted hub fails naming the criterion.
- **AC4's default.** The choice takes `sqlite`, its recommended option, with decision `none`; the authority ask takes
  `decline` with decision `deny`, and saves no decision. Both read `closed`/`defaulted` in `inbox.read` and leave
  `deep inbox`. "Opens it again" includes that your answer then counts: an ask the hub closes again at once isn't open.
- **AC5's six.** Five taste calls (3-day deadlines, recommended `green`) and then a choice (4 hours, recommended
  `files`), all by `deep_ask` from one session, so the sixth is the one that folds. "Inside one exception in `deep
  inbox`": one line of kind `exception` for that session whose text says "keeps asking", and the sixth either has no
  line of its own or its line says `folded`; `inbox.read` holds it `folded` and none of the first five. "In bulk" is
  the exception's option `together` (#319), which answers each of the six with its recommended option.
- **AC5's "the deadline".** The folded ask keeps its own deadline and default (design: "A folded ask … keeps its own
  deadline and default"). With nobody answering, the clock moves past the sixth's 4-hour deadline: the sixth must
  take `files` then, and the exception, whose deadline is the same, must close too (by its default or as cancelled);
  the five taste calls, due in 3 days, stay open and stay in `deep inbox`. A hub that lets the deadline pass with the
  sixth still open fails, naming it.

## Criteria, tests and wrong programs

IDs are the first 8 hex digits of SHA-256 of each criterion's text, trimmed, whitespace collapsed and the leading
`- [ ] ` dropped (the command in `tests/acceptance/48/README.md`). Each test name starts with its criterion's number
and ID.

| # | ID | Tests | Wrong programs it fails on | On the base |
|---|---|---|---|---|
| AC1 | `#667.84442921` | `raised.test.ts`: one | a listing without the ask's kind, session or age, or a second late; a frame at another log position, or none; an inbox read that holds the ask before its append | FAIL: the base hub doesn't frame the asks core's appends (the listing half holds) |
| AC2 | `#667.b25a1d05` | `raised.test.ts`: one | no decision, or one at another scope; the ask left in `deep inbox`; no answered frame; the answer not delivered, or a second one taken | FAIL: the `answer.refused` the second answer left is never framed (everything else holds) |
| AC3 | `#667.4014b343` | `authority.test.ts`: one; `plants.test.ts`: one | plant `answer-inside-session`; a hub that counts an answer without the OS confirming you | PASS (#24's checks hold); the plant test FAILs: unknown plant |
| AC4 | `#667.ca2b4f95` | `deadlines.test.ts`: one; `plants.test.ts`: one | plant `skip-default-at-deadline`; a hub that defaults only when something reads the inbox; no `deep inbox undo` | FAIL: the choice ask still open 15 s past its deadline; the plant test FAILs: unknown plant |
| AC5 | `#667.b1086458` | `fold.test.ts`: two; `plants.test.ts`: one | plant `skip-default-at-deadline` (names the folded ask); a bulk answer that closes only the exception | bulk PASS (#319's fold holds); deadline FAIL: the folded ask still open 15 s past its deadline; the plant test FAILs: unknown plant |

No implementation of #667 was run: the passing side of each test that fails on the base, and each plant's failure,
are unverified until the implementation exists.

## Files

- `helpers.ts`: temp homes and cleanup by PID; the settings; the authority ask seeded through the asks core; the hub
  with its clock, confirmation stub and plant, restarted before a deadline; the socket, `events.read`, `inbox.read`;
  the stream consumer and its check against the record; `expectClosedByDeadline`; the `deep inbox` line parser; the
  agent stand-in, `deep_ask`; the proof.
- `fixtures/agent.mjs`: the agent stand-in and its hook client.
- `scenarios.ts`: AC3, AC4 and AC5's deadline, shared with `plants.test.ts`.
- `raised.test.ts` (AC1, AC2), `authority.test.ts` (AC3), `deadlines.test.ts` (AC4), `fold.test.ts` (AC5),
  `plants.test.ts` (AC3, AC4, AC5).
- `tsconfig.json`: the root's strict options with `noEmit` and `allowImportingTsExtensions`.
- `BASE-FAILURE.txt`: the base run.

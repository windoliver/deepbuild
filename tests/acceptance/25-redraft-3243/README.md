# Issue #25: two criteria, redrafted blind

Written from issue #25, `docs/technical-design.md` and the base commit `118ec119f` only.

## Criteria to tests

| Criterion | ID | Test | Wrong program (twin) |
|---|---|---|---|
| AC1 A held stop continues with the answer | `#25.0215da31` | `held.test.ts`: an answer given while the stop is held comes back as that Stop's `decision: block`, and the turn goes on with it | `answer-skips-held-stop` |
| AC4 An answer that lands while the session's stop is held and its waiter is alive goes back through the Stop hold only, the waiter exits without waking, and the transcript shows the answer's ID once; a host that sends it by both routes fails this test, naming the routes | `#25.1eae4ef9` | `one-route.test.ts`: with the stop held and the waiter alive, the answer goes back by the Stop hold only, the waiter exits without waking, and the transcript shows its ID once | `both-routes` |

Both tests run a real hub (`deep hub run`), `deep setup` into a temporary home, and the Claude Code stand-in of
`tests/acceptance/25/routes/fixtures/claude.mjs`, which runs every entry setup wrote into Claude Code's user
settings (deep-hook in the foreground, the waiter in the background) and the session's own `deep mcp`. You answer
with `deep inbox answer`. The infrastructure is imported from `../25/routes/helpers.ts`; the ask is this folder's own
(`asking.ts`).

## The ask

The agent calls `deep_ask` with `kind: choice`, two options and `recommended: null` (the tool's other fields null).

The design says which asks go on at once and which leave the session waiting on you:

- "A taste call or a choice between options proceeds on the recommended option at once, marked as undoable" (An ask,
  and your answer getting back: Work goes on while you decide), and an ask's shape: "With a provisional ask, work goes
  on with the recommended option".
- "A stop that ends on a question that becomes a step only you can take, an exception, or a taste call or choice that
  isn't provisional leaves the agent waiting on you" (An agent says it's done: A question holds the send-back).

A choice with no recommended option has nothing to go on with, so it isn't provisional: the agent waits on you, and
its stop is the one the issue's Scope holds ("Stop hold: `decision: block` with the answer as the reason, only when
the agent left a question"). Each test first checks the ask is recorded not provisional and deep_ask didn't tell the
agent to go on.

A stop is shown held by events, never by a wait: the hub's record of the session's `agent.stop` and the waiter Claude
Code started at that Stop running, with the Stop hook still unanswered. Waits are bounded by `waitFor` deadlines.

## A starved machine

"A hub that takes a request and doesn't acknowledge it within 50 ms of the hook's start counts as down for that call"
(design: A broken hub), and deep-hook then fails open: the Stop goes through unheld for a reason that is the
machine's. Such a try says nothing of the hold, so it is no verdict (asking.ts, `untilFed`):

- deep-hook's fail-open evidence, for the session's hooks: its stderr saying even its spool ran out of the hook's
  50 ms (`spooled <id>, but its sync didn't finish within the hook's 50 ms`, `could not spool <id> within the hook's
  50 ms`), the hook's line in deep-hook's spool (it spools a hook only when it lets it through as with the hub down:
  no reply in time, or its watchdog's let-through at 50 ms; `"late":true` when it reached the hub unacknowledged), or the hub's reading `deep-hook let <event> <id>
  through as late`. `could not spool <id>: <error>` is a broken spool, not a starved hook, and isn't counted.
- The spool is watched for the whole try (`fs.watch` on the hub's folder, woken by each write to the spool folder) and
  read again as each hook returns: the hub's replay moves and removes a line within about 2 s, and a hook let through
  before its request reached the hub leaves no reading (the hub's `lateAnswered` runs only for a request it has). A watch that
  fails as it runs (Linux's recursive watch adding a folder or file already gone, or the inotify limit) is closed on
  its 'error', and the reads after each hook go on.
- The stop with the ask open is checked twice: once the hub has it on its record, before you answer, and again when
  it ends after your answer without it (no `decision: block` carrying the answer), since a Stop the hub recorded can
  still be let through late once the first check passed. The first counts any of the session's hooks (one let
  through unseen may leave the hub nothing to hold); the second counts only that Stop's own (it was held when you
  answered, so an earlier hook's fail-open doesn't explain a missing answer, and a hub that drops the answer can't
  read INCONCLUSIVE by it); the continued turn's Stop, where a fail-open would look like the right answer, counts only
  its own. The control session's hook is judged from the same mark: readings of every session are marked.
- "Its own", from a Stop's mark: a stderr of a run after the mark, a Stop's spool line not seen at the mark, and a
  late reading that names a Stop (`deep-hook let Stop <id> through as late`, the hub's lateAnswered) whose ID wasn't
  spooled by the mark. The hub writes a reading only as it replays the spool, so an earlier hook's (a PostToolUse let
  through late) can land after the mark, set off by the Stops; it names that hook's event and ID and isn't counted.
- A Stop that ended unheld with that evidence: the try is made again with a fresh home, hub and Claude Code, up to 5
  tries (and no new try after 8 minutes, inside the file's 15-minute timeout); then the test skips with a reason
  starting `INCONCLUSIVE:`.
- Each judged Stop has a hook of another kind, a control session's UserPromptSubmit, fired beside it to the same hub
  at the same time. If in all 5 tries that hook got through (a DeepBuild entry ran, exit 0, no fail-open evidence)
  while the session's Stop failed open, the machine gave hooks their time and the hub failed the Stop: the test fails.
  So a hub that fails every Stop the same way (never acknowledges in time, acknowledges after 50 ms, closes the
  connection, refuses it, or replies with what deep-hook can't parse, all of which deep-hook spools) reads FAIL, not
  INCONCLUSIVE, while its other hooks get through. The control is not a Stop because such a hub would fail a control
  Stop too and read as a starved machine. What still reads INCONCLUSIVE: a hub that fails every hook alike, as a
  machine that starves every hook does; this test can't tell those apart. Unmarked spool lines still count as
  evidence: the watchdog's let-through before deep-hook reached the hub (a starved machine) writes one.
- The agent's deep_ask PreToolUse has the same control beside it: deep_ask binds to its session by the PreToolUse
  the hub stamped, so one deep-hook let through as with the hub down leaves the call refused (unbound) and the ask
  never filed. A refused deep_ask with that PreToolUse's own fail-open evidence is a starved try, judged as a Stop's.
- Whether the Stop had ended is read once for the check before your answer and its assertion: a Stop that ends
  between two reads can't reach the assertion without its evidence checked.
- A Stop that ended unheld without the evidence fails at its assertion as before. The provisional reply (exit 0,
  `{"systemMessage":"says done · …"}`, nothing spooled, no 50 ms line) carries none of it.

## Twins

Each twin is a whole-file copy of `packages/hub/src/plant.ts` at the base with one line changed: `plantOf` returns
the planted program when `DEEP_HUB_PLANT` is unset, so the hub runs that wrong program always.

- `twins/answer-skips-held-stop`: the hub lets the held stop go when the answer comes, leaving the answer to the
  waiter. AC1 fails at its assertion that the Stop got `decision: block` carrying the answer.
- `twins/both-routes`: the hub sends the answer through the Stop hold and also hands it to the waiter, which exits 2.
  AC4 fails at its assertion naming the routes it went by ("the Stop hold (decision: block) and the waiter (exit 2 …)").

## Runs

`BASE-RESULTS.txt` holds the runs at the base and on each twin; a hub that doesn't hold, and one that closes every
Stop, failing; a starved deep-hook (every hook starved, before its request reaches the hub and after) reading
INCONCLUSIVE, and FAIL when only the session's Stop starves; with the commands and the machine's load.

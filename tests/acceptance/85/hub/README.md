# Acceptance tests for #85 on the real hub: the Slack thread and the network task

Written blind from issue #85, `docs/technical-design.md` as of `1941ca24` (the paragraphs **Tasks close themselves.**, **A network you must reconnect is found by trying it.** and **A chat-app task reads Slack, read-only.**) and the base commit `121ccac2`, read only to learn how to drive the hub. `tests/acceptance/85/` proves these criteria on the asks core with fakes; this folder proves them through `deep hub run`. The implementing agent doesn't edit these files (AGENTS.md, Proof); a dispute goes to a blind redraft by this job.

## Run

```sh
export PATH="$HOME/.nvm/versions/node/v24.22.0/bin:$PATH"
npm run build --workspaces
node node_modules/vitest/vitest.mjs run tests/acceptance/85/hub --testTimeout=120000
```

The tests run the real clock: about two minutes on an idle Mac. `BASE-FAILURE.txt` holds the base run.

## What's real and what's faked

The hub, its socket, its record, `deep mcp` and TCP are real. Slack is the one boundary faked: a real local HTTP server speaking `conversations.replies`, named by `slack.json`'s `api`. Hook lines are written to the socket as deep-hook writes them. Every port comes from the OS, and processes are stopped by PID.

## The surfaces read

- `deep_ask` with `kind: unblock` and `thread: {link, expect}`, `check` null, through `deep mcp` after its PreToolUse stamp. A raise shows as `ask.created`; a refusal as the tool's error.
- The record's `agent.stop` (`owner`, `cause`, `signature`), `ask.created`, `ask.moot`, `ask.answered` and `session.continued` (`because`, `task`).
- `inbox.read` on the hub's cli connection, for Needs you and the card.
- `session.wait`, as the waiter runs it, for one session's wake.

## How the design was read

- **"The card" on the hub is the `inbox.read` row.** It's the one surface the hub has for an ask you see. On the base the row has no `missing`. These tests read `row.missing`, the shape of the asks core's `Card.missing`: `{check, reasons, link}`.
- **"Open in Needs you"** is the `inbox.read` rows still open by their own `status` and `outcome` (`unanswered` until closed): the read holds every ask, closed and superseded ones too.
- **"Sends the claim back with the thread link"** is that `missing`, its `link` the thread's, as `tests/acceptance/85/README.md` reads it. The agent's own send-back line isn't asserted.
- **The moot's "host"** is asserted as `127.0.0.1:<port>` somewhere in `ask.moot`'s data; no field name is required.
- **`because` on a thread close** isn't asserted: the design names none for it.
- **"The token only goes in Authorization"**: `Bearer <token>`, and the request's URL and body don't hold it.
- **`conversations.replies` is the only method**: the design says the connector's one method reads with it, so other read methods fail the test as well as `chat.*`.
- **`channel` and `ts`** are Slack's own parameters: the link's channel and `1700000000.000100` for `p1700000000000100`, in the query or a form body.
- **`api`** is a base URL ending in `/api`, as Slack's own does; the fake answers any path ending `/conversations.replies`.
- **`slack.json` is written before the hub starts**, so a hub that reads it once at start and one that reads it per raise both pass.
- **A `slack.json` not mode 0600** reads as "not on": a thread task is refused, naming the file.
- **"After your post"**: a message holding the expected text before your post, and your own post holding it, don't close the task, as the core's rule says.
- **"Only your post since the task was raised counts, by its message time"** (design at `1941ca24`): posts and replies in the tests carry Slack `ts` values of the real clock, taken after the raise. An exchange a minute before the raise doesn't close the task; nor does a new reply with no new post of yours, or a reply older than your new post.
- **At most once every 5 s** is checked as gaps of 4.5 s or more between arrivals at the fake, allowing for delivery.
- **The first try after the port opens** must arrive within 7 s (5 s and 2 s for delivery); raises and closings get 15 s (the issue's 10 s and a margin for load); resumes are held to the design's 30 s from the first accepted connection.
- **A stop "over 10 minutes old"** is stamped 11 minutes before now, its session's earlier hooks just before that. "Isn't tried" reads as no connection reaches a listening port and `owner` isn't `you` on a closed one.

## Not covered here

- The 1.5 s limit on a try: a local port refuses at once, and a host that swallows packets needs a network this suite doesn't touch.
- The `api.anthropic.com:443` default: no test leaves the machine.
- The 5 s cadence on a closed port: a refused connection leaves no trace to count. It's bounded from above by the first try after the port opens.

## Files

- `helpers.ts`: the hub, hook lines, cli calls, the waiter, the record, sessions, TCP listeners, the fake Slack, `deep_ask` through `deep mcp`, and the token scan.
- `thread.test.ts`: `#85.e12ca936`, 5 tests.
- `network.test.ts`: `#85.0fa0b6d4`, 7 tests.

---

# Criteria 13 and 15: the cut-off turn and the held FAIL

Added blind, from issue #85 as of November 1, 2026 (criteria 13 to 15 and the Scope lines added since the suite above was written: "The automatic continue's text names each change or send call of the cut-off turn that started with no recorded end, marked outcome unknown, to check before acting, and an identical send is denied at PreToolUse with the earlier result" and "While a session's newest stop carries a cause whose task is open … a slow-lane FAIL … wait[s] on its row and go[es] with the resume when the task's check passes"), `docs/technical-design.md` as of the base `c69c9acf` (Tasks close themselves; Starting a session from the app, the block of calls marked outcome unknown and the send denied at PreToolUse; Every stop is judged; Turns DeepBuild causes), and the base, read only to learn how to drive the hub: `helpers.ts` above, `packages/hub/test/continues.test.ts` (the waiter and `StopFailure`), `tests/acceptance/83/helpers.ts` (`test.verdict`, the forge's shape, a tool call's hooks and transcript entries) and `tests/acceptance/48/fixtures/fake-agent.mjs`. Criterion 14 and the resume-skip line run on the asks core in `tests/acceptance/85/continue/`. The implementing agent doesn't edit these files (AGENTS.md, Proof); a dispute goes to a blind redraft by this job.

## Run

```sh
npm run build --workspaces
node node_modules/vitest/vitest.mjs run tests/acceptance/85/hub/cutoff.test.ts tests/acceptance/85/hub/held.test.ts --no-file-parallelism --testTimeout=240000
node node_modules/typescript/bin/tsc -p tests/acceptance/85/hub/tsconfig.json
```

The real clock; about 25 s on the base, longer once the scenarios run to their end (each plant test runs its scenario twice or three times). Neither file needs deep-hook: hook lines are written to the socket as deep-hook writes them (`hook`, `hookReply`), so no Rust build is needed here, and `cargo` isn't on this machine's PATH. `BASE-FAILURE.txt` holds the base run (its second part).

## The fake agent, and what's real

The hub, its socket, its record and its routes are real. **The Claude Code stand-in is the test's**: `tests/acceptance/48/fixtures/fake-agent.mjs` runs no tool call in an interactive session and knows no PreToolUse, so the criterion's "fake agent" is driven here at the one surface the hub sees, the hook lines Claude Code's hooks send and the transcript Claude Code writes (`toolUseEntry`, `toolResultEntry`, `assistantSays`, `completedCall`, `startedCall`, `wakeTurn`), and `gh pr create` is run as what it does, one POST to the forge (`ghPrCreate`), when and only when its PreToolUse reply lets it through (`denies`). **The forge** (`startForge`) is GitHub-shaped: `POST /repos/<o>/<r>/pulls` opens a PR, `GET …/pulls` and `…/pulls/<n>` read them; every PR it holds came from one POST. **The waiter** is `session.wait` on a cli connection, as the suite above runs it. **The FAIL** lands by `test.verdict` (the hub started with `DEEP_HUB_TEST_VERDICT=1`), which appends the `verdict.made` and `claim.sent_back` the gate would, on a claim the session's earlier turn of work made. **The host the session's API calls go to** is a local listener (`ANTHROPIC_BASE_URL`), so a `server_error` stop is the service's and no test leaves the machine.

## The surfaces read

- The hook's reply to a `PreToolUse` line (hook.reply@2: `exit`, `stdout`, `stderr`), read with its ack (`hookReply`). **"Denied at PreToolUse"** is a reply that ends the call as Claude Code reads one: `exit: 2` with its words on stderr (the hub's own denials), or `decision: block` / `hookSpecificOutput.permissionDecision: deny` on stdout (`denies`); its words (`replyWords`) must name the call.
- **The continue's text as the session hears it**: the waiter's wake (`session.wait`'s `text`), the route an idle Claude Code session has. The Stop hold's reply and the next prompt's context carry the same block by the issue's words and aren't driven here.
- The record's `session.continued`, `claim.made`, `claim.sent_back`, `ask.created` (`proves`, `unblocks`), `ask.moot`, `agent.stop` (`cause`, `owner`) and `tool.before`/`tool.after` (`call` pairs them).
- `inbox.read` for the open task, `sessions.read` for the row's `cause`, `test.verdict` for a landed verdict.

## How the criteria were read

### The cut-off turn (`#85.d3d3e12b`, `cutoff.test.ts`)

Turn 1 you typed ends normally and Claude Code starts the waiter. Turn 2 you typed ("Fix the cart total (#7) and open the PR."): `git status` runs to its end (PreToolUse, tool_result, PostToolUse); `gh pr create --title … --body …` is let through at PreToolUse and runs (the forge gets PR #1); the connection drops before PostToolUse (`StopFailure`, `server_error`, the host reachable). The hub records one `session.continued` (`because: transient`) and the waiter wakes the session.

- **"Continues with that call named as outcome unknown"**: the wake's text contains `gh pr create` and the words `outcome unknown` (case-insensitive). A line naming `git status`, which ended, as outcome unknown fails: it has a recorded end.
- **"The forge receives one PR"**: the stand-in acts on the wake (`wakeTurn`, a UserPromptSubmit whose prompt is the wake's text, not a prompt you typed) and sends the identical `gh pr create`; it runs it only if the hub lets it through. The forge then holds exactly one PR.
- **"An identical send is denied at PreToolUse with the earlier result"**: the identical call's reply denies, and its words name `gh pr create`. What "the earlier result" says for a call with no recorded end isn't held to a sentence.
- **Wrong programs**: a continue that omits the call (the wake's text with every line naming `gh pr create` dropped) fails naming the call; one that lets the identical call run (the reply read as the empty allow) opens a second PR and fails naming it. Both are planted at the test's side around the real hub (`Plant`), since the hub is real here.

### The held FAIL (`#85.f2490b59`, `held.test.ts`)

Five sessions each do a turn of work (an Edit, "Done.", Stop: a claim each, the stop let through) and then stop on the revoked sign-in (`StopFailure`, `authentication_failed`): one unblock task, owner you, each row's cause `sign_in_required`. The first session's waiter runs (Claude Code starts one at StopFailure too). A journey FAIL lands on the first session's claim (`test.verdict`, FAIL, round 1, check `journey`, with its finding), as the slow lane's would.

- **"No waiter fires"**: 8 s on, the first session's waiter hasn't been given a wake, no `session.continued` exists, the task is still the one open row. The failure message names the delivery the waiter was woken with.
- **"After `/login`"**: the task's check passes, a PASS verdict on the check the task `proves`, planted on the fifth session's claim (any claim serves; the first's would make a later verdict on the FAIL's own claim). The task is `ask.moot`, every session has its `session.continued` (`task_closed`) within 30 s.
- **"The FAIL arrives in the resumed turn"**: the first session's wake text names the task (the resume) and carries the FAIL: its verdict or claim handle, the check's finding, or `FAIL` with the check's name (`carriesFail`).
- **Wrong program**: a waiter that wakes the stopped session as the FAIL lands (`wakesOnFail`, the real waiter raced with a wake naming the sent-back verdict) fails at "no waiter fires", naming the delivery.

## Criteria, tests and wrong programs

| # | ID | Criterion (short) | Tests | Wrong programs it fails on | On the base |
|---|---|---|---|---|---|
| 13 | `#85.d3d3e12b` | a turn cut off before PostToolUse continues naming `gh pr create` as outcome unknown; one PR; the identical call denied | `cutoff`: two | plant: omits the call (fails naming it); plant: lets the identical call run (fails naming the second PR); the base | FAIL: the continue's text names no call (`expected 'DeepBuild: this turn stopped on a dro…' to contain 'gh pr create'`) |
| 15 | `#85.f2490b59` | a sign-in task open on five sessions, a journey FAIL on one: no waiter fires; the FAIL arrives in the resumed turn | `held`: two | plant: a waiter that wakes the stopped session (fails naming the delivery); the base | FAIL: the resumed turn carries the resume alone (`… arrives in the resumed turn: "DeepBuild: the task that blocked this session, ask:…, closed. …": expected false to be true`); the base fires no waiter either |

## Files (added)

- `helpers.ts`: additions at its end (nothing above changed; `withHub` takes an optional third `extra` environment): `hookReply`, `denies`, `replyWords`, `callId`, `toolUseEntry`, `toolResultEntry`, `assistantSays`, `completedCall`, `startedCall`, `wakeTurn`, `stopTurn`, `signInStop`, `claimOf`, `unblocksOf`, `provesOf`, `rowOf`, `plantVerdict`, `REQ`, `startForge`, `ghPrCreate`.
- `cutoff.test.ts`: `#85.d3d3e12b`, 2 tests.
- `held.test.ts`: `#85.f2490b59`, 2 tests.

# Acceptance tests for #85 on the real hub: the Slack thread and the network task

Written blind from issue #85, `docs/technical-design.md` (the paragraphs **Tasks close themselves.**, **A network you must reconnect is found by trying it.** and **A chat-app task reads Slack, read-only.**) and the base commit `121ccac2`, read only to learn how to drive the hub. `tests/acceptance/85/` proves these criteria on the asks core with fakes; this folder proves them through `deep hub run`. The implementing agent doesn't edit these files (AGENTS.md, Proof); a dispute goes to a blind redraft by this job.

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
- **At most once every 5 s** is checked as gaps of 4.5 s or more between arrivals at the fake, allowing for delivery.
- **The first try after the port opens** must arrive within 7 s (5 s and 2 s for delivery); raises and closings get 15 s (the issue's 10 s and a margin for load); resumes are held to the design's 30 s from the first accepted connection.
- **A stop "over 10 minutes old"** is stamped 11 minutes before now, its session's earlier hooks just before that. "Isn't tried" reads as no connection reaches a listening port and `owner` isn't `you` on a closed one.

## Not covered here

- The 1.5 s limit on a try: a local port refuses at once, and a host that swallows packets needs a network this suite doesn't touch.
- The `api.anthropic.com:443` default: no test leaves the machine.
- The 5 s cadence on a closed port: a refused connection leaves no trace to count. It's bounded from above by the first try after the port opens.

## Files

- `helpers.ts`: the hub, hook lines, cli calls, the waiter, the record, sessions, TCP listeners, the fake Slack, `deep_ask` through `deep mcp`, and the token scan.
- `thread.test.ts`: `#85.e12ca936`, 4 tests.
- `network.test.ts`: `#85.0fa0b6d4`, 7 tests.

# 0019: What the app, hook-test and package code moved for size said in comments

Status: accepted (#3719, and main's size findings at fc09a09cb on `crates/deep-hook/tests/cli.rs`, `packages/extension-host/src/host.ts` and `packages/asks/src/index.ts`, which no issue names). The size ratchet's fix moves one named concept to a file of its own, and a new file starts with no comments (0001). Each note below is what a comment on the moved code said, with the file and the symbol it now governs. Nothing here is a new decision.

## deep-app

- **The dock draws each group's displayed panel as a cached view (#1482).** `crates/deep-app/src/views/cached_panels.rs`, `CachedPanels`. A panel draws again only when it's notified or the window refreshes, so a pointer over the list draws nothing on the page beside it. The list draws each of its rows as a cached view, and GPUI draws a cached view's own cached views again whenever it draws that view, so the list itself is not cached: it draws when a row does, and reuses the rest.
- **When the hub is read, and when the window says it isn't answering.** `crates/deep-app/src/record/hub_watch.rs`, `HubWatch`. It holds when to read the hub, and whether it answered the last read: since when reads have failed and when to try next, and since when the window has said the hub isn't answering and since when it's been down. `tick` reads at `now` unless the hub is down and its next try isn't due; `read` says whether it answered. Until a down hub has been down `SHOW_AFTER`, it's tried again at every tick. #1461's planted watch says the hub is down at the first read that gets no answer. `down` says whether the window says the hub isn't answering, and `since` since when that hub has been down.

## deep-hook's tests

- **A print run's waiter must not wait (#668, #992).** `crates/deep-hook/tests/waiters/mod.rs`.
  - `waiter_under` runs the waiter under an agent with `flag` in its argv: a shell that runs it as its child and stays (`exit $?` keeps the shell from exec'ing it), with the Stop payload on stdin and no hub. With `entry_shell` the agent runs it the way Claude Code runs an entry, as a lone command under `/bin/sh -c`, which dash keeps as the waiter's parent and macOS's sh execs (#992). The agent leads a process group of its own. It returns the agent and when it started.
  - `claude -p` waits for its async Stop entries before it exits, and a waiter waits for its agent to exit: a print run has no later turn to wake, so its waiter must not wait, hub or no hub (#668). An interactive agent's waiter keeps waiting for an answer to wake its session, under its entry's shell too.
  - Where the entry's shell stays, as dash does, the chain is `claude -p` -> `/bin/sh -c '<waiter>'` -> the waiter, and the print run is the shell's parent, not the waiter's (#668, #992).
  - `kill_group` SIGKILLs the process group `leader` leads, by the syscall: `/usr/bin/kill -KILL -<pgid>` without `--` reads the group as -1 on Linux and ends every process of the user. kill(2) takes plain integers; a negative pid names one process group. Timed out, the agent is gone but its group isn't: the entry's shell and the waiter still in it go too.

## The extension host's routes

`packages/extension-host/src/routes.ts`.

- **node:http loads only for a package turned on.** `turnOn`. It is about 2.7 MB of heap the hub's core otherwise never holds.
- **A request has the call deadline to arrive whole.** `turnOn`. One that fails is that request's alone.
- **A package revoked while its listener bound is refused.** `turnOn`. Unloading it closes this listener too.
- **Trust is checked again once a body has arrived.** `serve`. Its body took time to arrive, so trust is checked again before the package sees it.
- **`BODY` is the largest request body a route takes.**

## An ask's chat-app thread

`packages/asks/src/threads.ts`, `readThreads`.

- **Only your post since the task was raised counts.** An old exchange in the thread never closes a new task.

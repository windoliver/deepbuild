# #1501 manual end-to-end run on the Spark (Linux arm64)

Date: 2026-11-07T21:24:34.112Z, load 137.25. Real `deep-hook` (target/debug) against a real `deep hub run`, no forwarder; rules.json = the shipped defaults (35 entries). Expected column: the issue's words. A row marked "deep-hook alone" is one where the hub missed its 50 ms acknowledgement under load and deep-hook applied the floor itself; the acceptance suite (`hubDecides`) reads the hub's own reply on each connection and is the proof of the hub's side.

## 1. Hub up, session on Claude Code 9.9.9 (a version the facts don't list)

| Call | Expected | deep-hook decided | What it printed |
|---|---|---|---|
| `Edit .deepbuild/done.yaml` | denied, naming the guard (floor) | **deny** (deep-hook alone: the hub missed its 50 ms) (exit 2, 37 ms) | deep-hook: spooled 01M6VYCA0B8QVY6K57TTJF1NST, but its sync didn't finish within the hook's 50 ms DeepBuild blocked this: A repository's .deepbuild/ holds its spec and definition of done, which change only by your decisi |
| `Write ~/.claude/settings.json` | denied, naming the guard (floor) | **deny** (exit 2, 35 ms) | DeepBuild blocked this: An agent's hook, MCP, permission, plugin and skill config change only by your decision, never by an agent's write. Propose the change with deep_propose instead. It writes ~/.cla |
| `deep off` | denied, naming the guard (floor) | **deny** (exit 2, 51 ms) | DeepBuild blocked this: `deep off` turns every gate watch-only: it switches DeepBuild off or around it, so it takes effect only once the OS confirms you, never from an agent's call. If you mean it, run that command yours |
| `rm -rf "$X"/*` | denied, naming the guard (floor) | **deny** (exit 2, 24 ms) | DeepBuild blocked this: A delete whose reach can't be worked out before it runs, such as a script file's or one over a pattern, can remove files git can't restore, and with the hub down nothing can stage them first or as |
| `npm install left-pad` | watch entry: recorded, runs | **allow** (exit 0, 21 ms) | (nothing printed) |
| `git push origin main` | block, not fail_closed (push-needs-ask): watch-only, runs | **allow** (exit 0, 14 ms) | (nothing printed) |

### Stop of a worked turn

Stop: exit 0 after 29 ms (a held stop waits ~60 s), stdout "" → not held

### Health reading

> This session runs claude-code 9.9.9, past the versions its facts cover: it is recorded unverified, and its holds and every block but the floor are watch-only until the live smoke test widens the range to 9.9.9. The floor still holds: its fail_closed guard entries deny as they do with the hub stopped.

7 tool.before events recorded for the session, 7 of them unverified.

## 2. Hub stopped (SIGTERM by PID 1892291), same session, same calls

| Call | Expected | deep-hook decided | What it printed |
|---|---|---|---|
| `Edit .deepbuild/done.yaml` | denied by deep-hook alone, naming the guard | **deny** (deep-hook alone: the hub missed its 50 ms) (exit 2, 36 ms) | deep-hook: spooled 01M6VYCASVEKW0HACKRVGV2Y4H, but its sync didn't finish within the hook's 50 ms DeepBuild blocked this: A repository's .deepbuild/ holds its spec and definition of done, which change only by your decisi |
| `Write ~/.claude/settings.json` | denied by deep-hook alone, naming the guard | **deny** (exit 2, 33 ms) | DeepBuild blocked this: An agent's hook, MCP, permission, plugin and skill config change only by your decision, never by an agent's write. Propose the change with deep_propose instead. It writes ~/.cla |
| `deep off` | denied by deep-hook alone, naming the guard | **deny** (exit 2, 22 ms) | DeepBuild blocked this: `deep off` turns every gate watch-only: it switches DeepBuild off or around it, so it takes effect only once the OS confirms you, never from an agent's call. If you mean it, run that command yours |
| `rm -rf "$X"/*` | denied by deep-hook alone, naming the guard | **deny** (exit 2, 29 ms) | DeepBuild blocked this: A delete whose reach can't be worked out before it runs, such as a script file's or one over a pattern, can remove files git can't restore, and with the hub down nothing can stage them first or as |
| `git push origin main` | not fail_closed: fails open, runs | **allow** (exit 0, 54 ms) | (nothing printed) |

## 3. Hub up again, session on Claude Code 2.1.308 (the newest listed version), for comparison

| Call | Expected | deep-hook decided | What it printed |
|---|---|---|---|
| `Edit .deepbuild/done.yaml` | denied, naming the guard | **deny** (deep-hook alone: the hub missed its 50 ms) (exit 2, 46 ms) | deep-hook: spooled 01M6VYCE6D27S14YGA3H8BWP3X, but its sync didn't finish within the hook's 50 ms DeepBuild blocked this: A repository's .deepbuild/ holds its spec and definition of done, which change only by your decisi |
| `Write ~/.claude/settings.json` | denied, naming the guard | **deny** (deep-hook alone: the hub missed its 50 ms) (exit 2, 35 ms) | deep-hook: spooled 01M6VYCE7DC5TEM29QTWTRTDZN, but its sync didn't finish within the hook's 50 ms DeepBuild blocked this: An agent's hook, MCP, permission, plugin and skill config change only by your decision, never by a |
| `deep off` | denied, naming the guard | **deny** (exit 2, 26 ms) | DeepBuild blocked this: `deep off` turns every gate watch-only: it switches DeepBuild off or around it, so it takes effect only once the OS confirms you, never from an agent's call. If you mean it, run that command yours |
| `rm -rf "$X"/*` | gated: staged or asked, not denied outright | **deny** (exit 2, 39 ms) | DeepBuild held this: `rm -rf "$X"/*`'s reach is unknown and it can't be staged, and no ask could be raised for it (BLOCKED: no deadline for authority asks is declared in your settings or the repo's done.yaml (asks.deadli |
| `git push origin main` | block entry gated: asks, not watch-only | **deny** (exit 2, 592 ms) | DeepBuild held this: `git push origin main` needs your authority, and no ask could be raised for it (BLOCKED: no deadline for authority asks is declared in your settings or the repo's done.yaml (asks.deadline.authority)) |

End: 2026-11-07T21:24:42.338Z, load 137.47.

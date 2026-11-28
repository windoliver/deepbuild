# Twins for #1812's criteria e264e123 and 5a83f2e0 (redraft 1814)

The frozen suite has no twins: its tables failed on #1812's own merge base, where `deep inbox` printed a raw socket
error. On this redraft's base, `9bbe0f24c`, #1812 is in and both tables pass, so each criterion's wrong program is kept
here as its wrong lines, applied to the change's file when the before lane runs (`scripts/proof-runs.mjs`,
`twinOverlay`). None touches a file under `tests/`. Each line edited is in the base once.

| Criterion | Twin | Edits | The one rule it breaks | Where it fails |
|---|---|---|---|---|
| `#1812.e264e123` | `inbox-raw-socket-error` | `packages/hub/src/inbox.ts`, `    if (!read) return notAnswered(error);` | `deep inbox`, with the hub down, prints the socket error's own words (`can't reach the hub at <socket>: connect ENOENT <socket>`) where it would print its database's list under the one sentence, and exits 3: the wrong program the criterion names | `hub-down.test.ts`: "1 of the 57 commands that call the hub don't print the one sentence …", the line `deep inbox prints no line saying the hub isn't answering; deep inbox prints an errno, ENOENT; deep inbox prints "<home>/.deepbuild/hub.sock" twice` |
| `#1812.e264e123` | `raw-socket-error` | `packages/hub/src/client.ts`, the `return` of `failure()` | Every command that reports through the one function prints an unanswered call's own words (the socket error) instead of the one sentence; only a missing control token still gets the sentence | `hub-down.test.ts`: "55 of the 57 commands …", each line naming the command, its errno and the socket path printed twice |
| `#1812.5a83f2e0` | `hub-start-fix` | `packages/hub/src/client.ts`, `  if (!setUp) return "The hub isn't answering; set this home up with deep setup.";` | A home nobody set up is told `deep hub start` as the fix | `not-set-up.test.ts`: "41 of the 41 commands …", each line `deep <command>'s sentence doesn't name the fix, deep setup …; … names deep hub start in a home that isn't set up` |

Each wrong file, with its edit laid on the base's `packages/hub/src`, passes `tsc` under the repo's settings
(`noUnusedLocals` included), so a twin fails the test, not the build.

## Checked here

Each was run as a plant on the base's built `packages/hub/dist/inbox.js` or `client.js`, through a Node load hook that
replaces the same line (in its compiled form) as the file loads, so nothing on disk changed. Results in
`../BASE-RESULTS.txt`, checks 2, 3, 4 and 6.

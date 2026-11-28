# Twins for the 2958 tests

AC1's test and the source scan (AC3) fail on the merge base at their assertions. AC2 ("with no such config,
`deep-app --hub-check` reaches the installed hub as before") passes there by design, so `../twins.json` names a planted
wrong program it must catch. The twin is kept in the line form (`tests/acceptance/1832/README.md`, "The line form"):
one edit, laid over the change.

| Criterion | Twin | Rule it breaks |
|---|---|---|
| `#2958.db948145` (AC2, the installed hub with no config) | `default-socket-elsewhere` | With no `hub.address` configured, the app's hub address is the installed hub's socket, `~/.deepbuild/hub.sock` |

## `default-socket-elsewhere`

**Edit.** In `crates/deep-app/src/hub.rs`, `address()`'s one line of body, the fallback for no configured address,
`configured_address().unwrap_or_else(|| root().join("hub.sock"))`, becomes
`configured_address().unwrap_or_else(|| root().join("app").join("hub.sock"))`. With no config, the app looks for its
hub at `~/.deepbuild/app/hub.sock`, where no hub listens. A configured `hub.address` is still followed.

**Test it fails.** `hub-check.test.mjs` › `AC2 #2958.db948145 with no hub.address configured, deep-app --hub-check
reaches the installed hub as before`. `deep-app --hub-check` connects to the missing socket, which fails at once with
an I/O error (no retry in `HubClient::connect`), so it prints `deep-app: the hub at ... didn't answer: Io(...)` on
stderr, nothing on stdout, and exits 1. The test fails in `answeredAsApp` at its second assertion, the `assert.match`
on stdout's first line, with the message `no hub.address, the installed hub at ~/.deepbuild/hub.sock: stdout's first
line doesn't start with "hub ok": exit 1, ...`. The first assertion (finished within 60 s) holds, so the failure is at
an assertion, not a timeout or a crash. It fails the same way whichever token file the change's one function picks for
that address, beside it (`~/.deepbuild/app/control.token`, absent) or the installed root's, since the socket itself is
not there.

**Where its `find` line comes from, and when it goes stale.** The line is `address()`'s body in
`crates/deep-app/src/hub.rs` at the base, and it appears once in that file. #2958 changes where the token is read,
not how the address is found: the issue names `address()` as the function that already follows `hub.address`, and its
fix adds a function returning the token file for that address. The twin goes stale (reads `BLOCKED before:` naming
`default-socket-elsewhere` and `crates/deep-app/src/hub.rs`) only if the change rewrites that line, for instance by
inlining or restructuring `address()`'s fallback, or if main changes the installed socket's name or `address()`'s body.

**Other criteria.** AC1 (`#2958.9c0089ca`) passes on it: that test writes a `hub.address`, so `configured_address()`
answers and the edited fallback is never reached. AC3's source scan passes on it: the edit names no `control.token`.
The twin compiles: it only adds a `.join("app")` to a `PathBuf` expression.

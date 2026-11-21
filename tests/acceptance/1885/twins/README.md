# Twins for the 1885 tests

AC1's tests and the source scan fail on the merge base at their assertions. AC2 ("with no such config, each command
reaches the installed hub as before") passes there by design, so `../twins.json` names a planted wrong program it
must catch. The twin replaces `packages/hub/src/paths.ts` with the change's own file, one rule wrong.

| Criterion | Twin | What it gets wrong |
|---|---|---|
| `#1885.44a33ba0` (AC2, the installed hub with no config) | `no-config-no-token` | `hubControl` looks the token up only for a configured `hub.address`; with no config a command presents no token, so the installed hub refuses it |

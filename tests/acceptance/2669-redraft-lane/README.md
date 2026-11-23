# Blind redraft for #2669: a lane dispute

The proof lanes' before lane ran `../2669/status83.test.ts` (`#2669.6995f057`) in a bay copy, which has no
`target/`. The lanes copy the hub's binaries (deep-hook, deep-show) into a copy's `target/debug/` only for a test whose
code, through the bindings it imports, names the hub's or the CLI's package (`selectBinaries` in
`scripts/proof-binaries.mjs`). That file imported only `NODE, REPO, run, shown` from `../83/helpers.ts`, none of
which does, so its bay got no deep-hook and every inner `83/status.test.ts` test was BLOCKED ("no deep-hook is built
under target").

`status83.test.ts` here is the same test for `#2669.6995f057`, but it imports #83's `CURRENT` checkout (whose CLI is
`packages/cli/dist/main.js`) and checks that CLI is built before the run, which is true: the inner suite starts this
checkout's hub through it. The lanes therefore place the hub's binaries for it.

| Criterion | File | Twin |
|---|---|---|
| `#2669.6995f057` | `status83.test.ts` | `status-never-asked`: `isStatusQuestion` in `packages/hub/src/verdict-chat.ts` always answers false, so #83's status questions go to the model and `83/status.test.ts` fails at its assertions. |

This redraft adds and deletes nothing in `tests/acceptance/2669/`.

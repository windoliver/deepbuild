# Hand e2e for #3005

A real `deep hub run` from this checkout's build, its home under `$TMPDIR`, then `deep install` of
`packages/jobs/score`, `import` and `typeset` (`e2e.sh`). macOS 27.2, Node 24.22, 2026-11-21, under heavy load
(the `uptime` line heads each transcript). Home paths are redacted to `~`.

| Build | TMPDIR | score | import | typeset |
|---|---|---|---|---|
| base `512d194bb` (`e2e-before.txt`) | `/tmp/e3005/link` (symlinked) | Installed, exit 0 | REFUSED "wrote no {outputs}", exit 1 | REFUSED "wrote no {outputs}", exit 1 |
| base `512d194bb` | `/private/tmp/e3005/real` | Installed, exit 0 | Installed, exit 0 | Installed, exit 0 |
| fix `e1494d5ff` (`e2e-after.txt`) | `/tmp/e3005/link` (symlinked) | Installed, exit 0 | Installed, exit 0 | Installed, exit 0 |
| fix `e1494d5ff` | `/private/tmp/e3005/real` | Installed, exit 0 | Installed, exit 0 | Installed, exit 0 |

The "before" rows ran the same checkout with only `packages/extension-host/src/jobs.ts` put back as at the base and
`packages/extension-host` rebuilt (`dist/jobs.js spawns by real path: 0` in its header).

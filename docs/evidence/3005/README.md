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

Each transcript is two runs of `e2e.sh` from one wrapper, which `mkdir -p`'d `/private/tmp/e3005/{link,real}`, printed
`uptime` first and piped everything through `sed -e "s#$HOME#~#g"`; those lines and the redaction are the wrapper's,
not the script's:

```bash
{ uptime; TMPDIR=/tmp/e3005/link bash e2e.sh "after, symlinked …"; echo; TMPDIR=/private/tmp/e3005/real bash e2e.sh "after, real …"; } 2>&1 | sed -e "s#$HOME#~#g" > e2e-after.txt
```

The "before" rows ran the same checkout with only `packages/extension-host/src/jobs.ts` put back as at the base
(`git show 512d194bb:packages/extension-host/src/jobs.ts > packages/extension-host/src/jobs.ts`) and
`npm run build -w packages/extension-host`; the wrapper also printed the note on the transcript's second line, and
`dist/jobs.js spawns by real path: 0` in each header shows that build ran. The fix was then restored and rebuilt.
The hub-ready check that exits 2 was added to `e2e.sh` after these runs; both transcripts show the hub ready.

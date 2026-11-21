# Evidence for #2484: lsof's mount warnings and the environment kit

The fix (`-w` on both of the kit's lsof calls in `packages/conformance/src/slots/environment.ts`) landed in
`86a6431f6`; `before.txt` and `after.txt` are that fix's own evidence, written by `86a6431f6`,
`4b53ec85e` and `cbdb671ab` (each section names its run); this change doesn't touch them. The issue was reopened because no test
named its criteria; `tests/acceptance/2484/` now does. The hand e2e below was run at main `dcb63a0a0` on macOS (arm64),
Node 24.22.0, after `npm ci` and `npm run build --workspaces`.

## Hand e2e

`bin/lsof` stands in for a machine with a mount lsof can't stat: it runs the real lsof and adds lsof's
`WARNING: can't stat() … file system` lines to stderr on every call unless `-w` is among the flags, as real lsof does.
No real mount was made (one makes every lsof on the Mac warn, which other work on the machine would read).

- `e2e.sh` (screenshot `e2e-fix.png`): the stand-in on PATH warns without `-w` and is silent with it; both
  calls exit 1 because that pid listens on nothing (real lsof's status, which the kit must read beside the warning);
  `node scripts/slots-check.mjs` exits 0 (`PASS slots: 17 slots …`), and every one of its lsof calls carried `-w`;
  through the built package (`port.mjs`), the reference fill passes, and a fill that really listens on a second port
  beside its lease is still refused (`FAIL unleased_port … listens on 127.0.0.1:N besides the lease`).
- `e2e-base.sh` (screenshot `e2e-contrast.png`): the same stand-in against the kit without `-w` (twin
  `warning-reads-unreadable`, the base's reading) built into `dist`: the slot check exits 1 with the issue's line
  (`planted fill leaves-grandchild is first refused on health-route as BLOCKED "the environment's listening ports can't
  be read (lsof failed)…"`); main's file restored and rebuilt, it exits 0 again.

Run from the repo root with Node 24 on PATH: `bash docs/evidence/2484/e2e.sh`, `bash docs/evidence/2484/e2e-base.sh`
(the second refuses to start if `environment.ts` has local edits, overwrites it with the twin and rebuilds
`@deepbuild/conformance`, and restores and rebuilds it on any exit).
The screenshots are the Terminal window that ran them, title bar cropped.

## Not checked

Linux, where the issue was seen; a real mount lsof can't stat; whether `-w` is enough for every warning lsof prints.

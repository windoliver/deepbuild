# #2629 hand e2e: one package, two umasks, one digest

Run by hand on macOS on 2026-11-20 with Node 24. Two fresh GitHub clones of `windoliver/deepbuild` were made at
`44efe5f`, sparse over `packages/jobs` and `docs/extension-guide`. One was made under `umask 002`: its files are 664,
and `import/tool/lottie.wasm`, which git records as 100755, is 775. The other was made under `umask 022`, so its files
are 644/755. Each transcript lists the executable file and the first plain files of each package.

`e2e.sh <checkout> <label>` runs the build of the repo it sits in. It starts a real `deep hub run` in a fresh home.
There, `DEEP_HUB_TEST_CONFIRM` stands in for the OS confirming you, as the acceptance suites do. Then it runs
`deep install` on `packages/jobs/score` and `packages/jobs/import` from that checkout, and stops the hub by its PID.
Each transcript's header names the build:
- HEAD.
- Whether `packages/extension-host/src` is as committed.
- The mode expression in the built `dist/digest.js`.
- Whether the built `dist/host.js` still chmods its copies.

| Build | umask 002 checkout | umask 022 checkout |
|---|---|---|
| `aa02a30e4` with `digest.ts` and `host.ts` put back to base `eb027b613` (`stat.mode & 0o7777`), rebuilt | both **REFUSED**: score's files digest `d1:12d86c45…`, import's `d1:971c85d9…`, not their stamped digests ([before-002](e2e-before-002.txt)) | both installed ([before-022](e2e-before-022.txt)) |
| `aa02a30e4` as committed, rebuilt | both installed ([after-002](e2e-after-002.txt)) | both installed ([after-022](e2e-after-022.txt)) |

On the committed build, `packageDigest` of the four folders, read through the built public entry, is in
[digests-after.txt](digests-after.txt). score gives `d1:fd6d8bea…` in both checkouts and import gives `d1:8fb7886b…` in
both. Each is the digest stamped in that package's `deepbuild.json`.

Temp paths in the transcripts are shown as `<tmp>/`. To rerun: `TMPDIR=<dir> bash docs/evidence/2629/e2e.sh
<checkout> <label>` after `npm run build --workspaces`.

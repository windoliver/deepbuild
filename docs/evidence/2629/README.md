# #2629 hand e2e: one package, two umasks, one digest

Run by hand on macOS on 2026-11-20 with Node 24. Two fresh GitHub clones of `windoliver/deepbuild` were made, sparse
over `packages/jobs` and `docs/extension-guide`. One was made under `umask 002`, so its files are 664 and
`import/tool/lottie.wasm` is 775. The other was made under `umask 022`, so its files are 644/755.

`e2e.sh <checkout> <label>` runs this branch's own build. It starts a real `deep hub run` in a fresh home. There,
`DEEP_HUB_TEST_CONFIRM` stands in for the OS confirming you, as the acceptance suites do. Then it runs
`deep install` on `packages/jobs/score` and `packages/jobs/import` from that checkout, and stops the hub by its PID.

| Run | umask 002 checkout | umask 022 checkout |
|---|---|---|
| Base build (`eb027b613` digest.ts and host.ts) | both **REFUSED**: score's files digest `d1:12d86c45…`, import's `d1:971c85d9…`, not their stamped digests ([before-002](e2e-before-002.txt)) | both installed ([before-022](e2e-before-022.txt)) |
| This branch | both installed ([after-002](e2e-after-002.txt)) | both installed ([after-022](e2e-after-022.txt)) |

On this branch, `packageDigest` of the four folders, read through the built public entry, is in
[digests-after.txt](digests-after.txt). score gives `d1:fd6d8bea…` in both checkouts and import gives `d1:8fb7886b…` in
both. Each is the digest stamped in that package's `deepbuild.json`.

Temp paths are shown as `<tmp>/`.

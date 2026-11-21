# #2977 hand e2e: a real hub's first sandboxed install, before and after

I ran this by hand on 2026-11-20 on macOS 27.2.1 (26B7131), with Node 24.22. On this Mac, sandbox reports carry no subsystem. The checkout was a fresh GitHub clone at `cf770e2af` (this branch).

`e2e.sh <label>` uses the build of the repo it sits in:
- It starts a real `deep hub run` in a fresh home. `DEEP_HUB_TEST_CONFIRM` stands in for the OS confirming you, as in #2629's e2e.
- It times `deep install` of `packages/jobs/score` and then `packages/jobs/import`. An install runs the package's code in the platform sandbox through the hub's supervisor, so the first install waits for the supervisor's report-stream warm-up.
- It lists the hub's `log stream` children at ready and after the installs.

For "before", `packages/supervisor/src/supervisor.ts` was put back to the base `ee05e7257` and the supervisor rebuilt. Base and branch runs were interleaved: after, before, after, before. Load was 12–14 throughout.

| Build | First install (`score`) | `log stream` children at ready → after |
|---|---|---|
| Base `supervisor.ts` | 9,627 ms ([before-1](e2e-before-1.txt)), 9,715 ms ([before-2](e2e-before-2.txt)) | the subsystem filter's → the kernel's |
| This branch | 652 ms ([after-1](e2e-after-1.txt)), 682 ms ([after-2](e2e-after-2.txt)) | all three filters' → the kernel's |

- **The difference.** On the base, the first install waits out the subsystem filter's whole 10 s warm, because no report shows through that filter. Only then does the kernel's filter start. On this branch, all three streams warm at once and the kernel's is kept.
- **No error from this change.** On both builds the hub keeps one stream, and its stderr shows only Node's `stripTypeScriptTypes` experimental warning.
- **A refusal on both builds.** `deep install packages/jobs/import` is refused on both base and branch: "lottie-import@1.0.0 wrote no {outputs}". The refusal comes from that job tool's qualification and is unrelated to the report stream.

Temp paths in the transcripts are shown as `<tmp>/` and the checkout as `<checkout>`. To rerun: `npm run build --workspaces` and `cargo build -p deep-hook`, then `TMPDIR=<short dir> bash docs/evidence/2977/e2e.sh <label>`, with Node 24 as `node` on PATH. The hub's socket path must fit macOS's 104-byte limit.

# Mac round after merging main ce6866e65 (2026-11-23)

MacBook Pro (`machine.txt`). One fresh GitHub clone, on AC power, screen unlocked at every step (`exits.txt` has each
step's load, free disk and exit code). The account name is redacted as `<user>`.

- **main** ce6866e65 (the merge base of both PRs)
- **PR #3012** 15d3f1f09 (its fix, with main merged in)
- **PR #3028** df5bd5bf5 (its fix, stacked on 15d3f1f09, with main merged in)

| Suite | main | #3012 | #3028 |
|---|---|---|---|
| `tests/acceptance/1546/ac1-journey.test.ts` | 5 of 6 fail; the three seeds and the planted-view seed die on `resize` (deep-drive exits mid-call) | 4 of 6 pass, no panic | 4 of 6 pass, no panic |
| `tests/acceptance/1427/ac7-shipped.test.ts` | 4 of 4 fail; deep-drive exits in `deep_app::card::tick` on `motion_check` | 4 of 4 fail on assertions, no panic | 4 of 4 pass, three runs in a row |
| `node scripts/motion.mjs` | not run | not run | exit 0 twice; the outputs are byte-identical and give the same three hashes as at 856d10ed2 before the merge |

The two #1546 tests that still fail at both heads want a finding that names a `needs-you` view. Since #1461 the
Needs you section is drawn inside the sidebar's view, so the findings name `deepbuild/sidebar`
(`pr3012-1546-ac1.txt`). That is a test written against an older app and needs a blind redraft. Neither PR changes
those tests.

Proof lanes (`node scripts/proof.mjs guard before trace`) at each head: `pr3012-lanes.txt` and `pr3028-lanes.txt`.
Guard passes at both heads. `before` has no tagged test in either change to run. Trace reads no issue line for #3012,
and `Part of #1427` with the issue's other criteria open for #3028.

## End to end (e2e)

`e2e-terminal.png` and `e2e-terminal.txt` record one run in a real Terminal window, in the clone at df5bd5bf5.
`e2e-panics.mjs` drives one `deep-drive` process:

1. Launch 1 hovers an ask row and resizes the window to 1200 × 800. On main this is the `resize` panic.
2. Launches 2 and 3 run in the same process, with the clock stepped 3 s. On main a later launch panics in `card::tick`.
3. `motion_check` runs the shipped journeys in that same process, as launches 4 to 6.

Every reply is ok and nothing panics (`e2e: no error, no panic`, exit 0). The `motion_check` hashes after three
earlier launches in the process equal those from a fresh process (`scripts/motion.mjs`). So the stale `PAGE` and
`BOX_TALL` that #3012's review named do not change a later launch's recording. Then `scripts/motion.mjs` exits 0
and the AC7 suite passes 4 of 4 (its fourth run at this head).

`e2e-launch1-after-resize.png` and `e2e-launch2-after-3s.png` are the replica's own window screenshots from that run.
They show the hovered ask row, and in launch 2 its tooltip. Launch 1 was captured 1 s after the hover, before the
row's 1,500 ms tooltip delay ends, so it shows no tooltip. Launch 3's screenshot is the same size as launch 2's and
was not kept. A fresh agent checked the screenshots against the log and found no error, no panic and no personal
data.

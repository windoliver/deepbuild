# Evidence for #1921: sizes in metres without scale, and one body per instancer element in one instanced draw

Recorded on the reference Mac on 2026-11-11, on the change at 3dff361b1. The blind suite `tests/acceptance/1921/` (commit 1a7d1abe4) was written from the issue, the design and base 35df4523f by a job that never saw the implementation, and is unchanged. Main hadn't moved from the base, so no merge was needed.

| File | Criteria | What it shows |
|---|---|---|
| `blind-suite.txt` | 1–6 | Each blind file run once: 12 of 12 tests pass (ac1 4, ac2 2, ac3 1, ac4 1, ac5 2, ac6 2). This includes both planted outputs failing as their criteria require, and the 2 ms `step_p95` budget judged PASS on this Mac at load 8–12. |
| `drop-proof.json` | 2, 3, 4, 6 | See the breakdown below. |

What `drop-proof.json` records about the 800-body drop:

- **Build order.** Its 801 bodies are built in element-ID order: `balls#1000` … `boxes#1399`, then `ground`.
- **Step hashes.** Over 600 steps it differs from its one-by-one twin at 0 of 601 step hashes, with samples at 8 steps.
- **Rest rows.** It writes 800 `rest` rows, the last at step 326.
- **Draw list.** At each of the 301 view3d frames the camera holds exactly 2 indirect draws, `boxes` and `balls` in a batch each, and no encoded batch names an element.
- **Uploads.** Each frame reports how many elements it uploaded per instancer. All 800 upload while every body moves, and the 137 frames after the last body sleeps upload none.

The suite's base run is the blind job's `tests/acceptance/1921/BASE-FAILURE.txt`.

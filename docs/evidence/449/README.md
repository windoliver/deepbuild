# #449 evidence: particles with bursts, bounces, kill regions, turbulence, emit regions, landing, surfaces and counts by class

The blind suites are `14e5aa0fb` (criteria 1 to 11 and 17) and `e30a4d21a` (criteria 12 to 16), written from the
issue, the design and base `cbd5e4f98` by jobs that saw no implementation, and unedited since.

| File | Criteria | What it shows |
|---|---|---|
| `blind-suite.txt` | 1 to 17 | The proof run of every file of `tests/acceptance/449/` once, on the change merged with `origin/main` (`07e74d4d8`): 16 of 17 files and 42 of 43 tests pass, AC17 then INCONCLUSIVE. After the landing map's fix (below), `ac7-landing` 5/5 and `taste` 1/1 on the recorded call: every criterion passes. |
| `sparks-on-impact.png` | 17 | The lab's three balls, an instancer moved by its world's output, with sparks burst from `lab.occurrences` where the first lands, at 0.5 s (640 × 360). |
| `six-plane-box.png` | 17 | The bead in the six-plane box at 0.8 s. |
| `landing.png` | 17 | The rain landing on the cube's top and the floor at 1.5 s. |
| `sparks.apng`, `landing.apng` | 17 | The sparks over 2 s and the landing over 2.5 s, 30 fps, the canvas's own frames unchanged. |
| `checks.txt` | | The touched crates' unit tests, the neighbouring particle suites, the canvas lint, the size ratchet and the public-text check, as run. |

Every picture is the check run's own (`taste.test.ts` writes them to `target/acceptance/449/`; they are copied here
byte for byte). SHA-256:

```
e5fbe8a37c8825798fa01b71d575345faa8ddf3315c7f6c3675bccb88e8d7b48  sparks-on-impact.png
7eae8f32fb8881f3c64bc995068ad306f5e6735dc6a40b5972ccb40050d8a3b6  six-plane-box.png
f75977138c1eb1f0817558b67eb0ef19f8e6ce4828a782903c7279830c0c5311  landing.png
2e86b0504d343c5aad4280f44027186ae0dc9119a2bfe59a13916814edb47980  sparks.apng
e841e8c6aa2832ef6b754e7fe059c5c53636089c540aed0119f878bc61f79f5b  landing.apng
```

The call on exactly these is recorded in `tests/acceptance/449/TASTE.json`: looks right, made on the owner's
delegation in session. Validating the first pictures found drops resting in mid-air beside the cube's walls once
every drop had landed: the map counted faces that only touch a cell's border, and its bilinear read ramped from the
cube's top to the floor across one cell. The map now takes each cell's inside and steps at the midpoint between
centres across a cliff (more than two cells' height between neighbours), so the walls stay clean; AC7, which leaves
out particles within two cells of an edge, passes unchanged.

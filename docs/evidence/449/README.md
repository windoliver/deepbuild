# #449 evidence: particles with bursts, bounces, kill regions, turbulence, emit regions, landing, surfaces and counts by class

The blind suites are `14e5aa0fb` (criteria 1 to 11 and 17) and `e30a4d21a` (criteria 12 to 16), written from the
issue, the design and base `cbd5e4f98` by jobs that saw no implementation, and unedited since.

| File | Criteria | What it shows |
|---|---|---|
| `blind-suite.txt` | 1 to 17 | The proof run of every file of `tests/acceptance/449/` once, on the change merged with `origin/main` (`07e74d4d8`): 16 of 17 files and 42 of 43 tests pass; the one left is AC17's taste call, INCONCLUSIVE until it is recorded. |
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
25ea9708ed03c41071d5a8eb80d64ee4c7082817137b13908c36ecc43809281b  landing.png
2e86b0504d343c5aad4280f44027186ae0dc9119a2bfe59a13916814edb47980  sparks.apng
eae7c3d2794a4cc7129eaa7b96e8490eb1b7867519d1c99433c079a00a6d7d42  landing.apng
```

The owner's call on exactly these goes in `tests/acceptance/449/TASTE.json`, as the suite's README says.

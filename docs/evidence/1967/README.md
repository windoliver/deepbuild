# #1967 evidence: a test run replayed from a terminal recording

The issue's Proof line: "A code-change film as a document: its test run replayed from a terminal recording."

| File | What it is |
|---|---|
| `run.rec` | The test run that proved this change, recorded with times: `cargo test --locked -p deep-canvas-cells --lib recording:: -- --test-threads=1`, its stdout only, in the recording format (the size `{"cols": 104, "rows": 12}`, then one `{"at": flicks from the start, "text"}` line a chunk of output, `\n` written as a terminal's `\r\n`). |
| `film.json` | The document: a board whose one cell grid plays `run.rec` from film time 0 (`play: {asset: <its SHA-256>, start: "0s", in: 0, rate: [1, 1]}`). |
| `readings.txt` | What `deep-show run` answered: `media_import` of the recording (kind `terminal`, probe `{cols 104, rows 12, span 15.74 s, keyframes 16}`, the cells module's emulator as decoder); `deep show` of the film (presented, no issues); and `determinism` at 1.0 s, 1.57 s, 8.0 s and 15.8 s, each side's grid text. At every time the seeked grid equals the played one, cell for cell, and the two renders are the same picture. |
| `grid-at-1.00s.png` | The render at 1.0 s, before the run printed anything (its first output is at 1.56 s). |
| `grid-at-1.57s.png` | The render at 1.57 s: five tests passed and the sixth, the upstream recordings, running. The render at 8.0 s is the same picture (`readings.txt`), since that test prints nothing until 15.74 s. |
| `grid-at-15.80s.png` | The render at 15.8 s: the whole run, with its result line. |

The 104-column grid wraps the longest test name onto the next row, as the terminal did.

Made with this branch's `target/debug/deep-show` on Nov 11, 2026; the recorder was a 20-line Node script that timed each chunk of the command's stdout with `process.hrtime`.

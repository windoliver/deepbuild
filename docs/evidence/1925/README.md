# Evidence for #1925: a running job's row counts from its tool's own counters

Written by the blind suite `tests/acceptance/1925/` (each test's `proof()`), one run per file on 2026-11-10, on the
change at `b93d0752` (base `d51be2c3`), macOS 27.2 on a Mac17,10 under a load average of about 130 to 180, Node
24.22.2. Each file holds the judge's failures (none for count and reopen; the planted tool's one for planted), every
read of the list every 200 ms, the encoder's own log of when it wrote each batch of 15 frames, and the run's outputs.

| File | What it shows |
|---|---|
| `count.json` | The 600-frame encode on `encode-a@1.0.0`. At 30.4 s its row first gives a time left, `225 of 600 · 50 s left`. At 40.4 s, with 300 frames written by the encoder's log, it reads `test.encode · running · 300 of 600 · 40 s left`; the last frame came at 80.0 s, 39.6 s later, so the time left was about 1% off. The rerun is a cache hit. |
| `planted.json` | The planted tool `encode-guess@1.0.0`, which reports elapsed time over the 40 s it expects. Its row reads `300 of 600` at 20.3 s while its encoder had written 150 frames, and the judge fails it, naming the job: ``the job's row job:628446af… (test.encode on encode-guess@1.0.0) showed "300 of 600" at 20.3 s while its tool had written 150 frames of 600``. |
| `reopen.json` | The same encode with the app (`deep-drive` on a copy of the hub's record). Opened when the row first read 300 of 600, the app draws `test.encode · 300 of 600 · 40 s left`; it is closed, the encoder writes on to frame 600 and the job ends done; opened again 4 s later in a new process, it draws `test.encode · 330 of 600 · 36 s left`, the encoder's true count then, never 0. |

Not shown here, because no criterion reads it: a tool with no counter (its row says running and how long it has run,
never a count or a bar), a provider's percent, and no time left before 30 s. Fast tests hold those:
`packages/hub/test/job-rows.test.ts`, `packages/extension-host/test/job-counters.test.ts` and
`crates/deep-app/src/states.rs` (`a_job_row_counts_only_from_its_tools_counter`).

# #1322 acceptance tests

Blind suite for #1322 (`measureOnce` leaves the measured command and its children running when it stops a run).
Run: `node --test 'tests/acceptance/1322/*.test.mjs'` (macOS or Linux).

The measured command (`processes.mjs`) records its PID, starts a child that records its own and sleeps 30 s, and
per test sleeps, floods stdout or exits. After `measureOnce` throws, each test waits up to 5 s for both PIDs to be
gone; every test SIGKILLs any recorded PID still alive when it ends, so a wrong program leaves nothing running.

| Criterion | File | Test |
|---|---|---|
| `#1322.0e535c64` timeout leaves nothing | `timeout.test.mjs` | a 5000 ms timeout with `follow = false`, and again with `follow = true` (the counting runner wraps the command when a counter builds): `ETIMEDOUT`, both PIDs recorded, neither alive |
| `#1322.2df04a4b` maxBuffer leaves nothing | `max-buffer.test.mjs` | the command writes 40 MiB past the 32 MiB `maxBuffer` and stays alive with its child: `ENOBUFS`, neither alive |
| `#1322.160d30bf` an in-time run is measured as before | `in-time.test.mjs` | exit 0: status 0, `stdout` `measured\n`, `output` `measured\nwarn\n`, `elapsedMs` ≥ 300, `cpuMs` ≥ 300, `peakBytes` > 10 MiB, finite loads, `uncounted` `[]`, `qos` null; exit 3: status 3 returned, not thrown; streamed: status 0, empty `output`/`stdout`, CPU and RSS read; a background child of a run that exited in time is still alive (no group kill on success) |

`processes.mjs` is the shared fixture, not a test.

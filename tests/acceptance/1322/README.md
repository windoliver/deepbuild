# #1322 acceptance tests

Blind suite for #1322 (`measureOnce` leaves the measured command and its children running when it stops a run).
Run: `node --test 'tests/acceptance/1322/*.test.mjs'` (macOS or Linux, Node 24).

## How the tests wait

No test waits for time to pass. `processes.mjs` (the shared fixture, not a test) listens on a Unix socket before the
run. The measured command records its PID, then starts a child that does the same. Each one connects to the socket,
says `pid <role> <pid>` and holds the connection for its whole life (60 s at most). The kernel closes a process's
connection when it exits. So "the measured command and its child are gone" is an event: both PIDs were said, and
every connection has ended. "The child is still running" is an event too. The child answers SIGUSR2 with
`alive <pid>` on its connection, and a dead or zombie child can't. The one timer is a 20 s `// deadline:` that bounds
each of these waits. It is well under the leftovers' 60 s life, so a wrong program fails at an assertion instead of
hanging. Each test SIGKILLs any recorded PID still alive when it ends, so a wrong program leaves nothing running.

| Criterion | File | Test |
|---|---|---|
| `#1322.0e535c64` timeout leaves nothing | `timeout.test.mjs` | a 5000 ms timeout with `follow = false`, and again with `follow = true` (the counting runner wraps the command when a counter builds): `ETIMEDOUT`, both PIDs said, every connection ended |
| `#1322.2df04a4b` maxBuffer leaves nothing | `max-buffer.test.mjs` | the command writes 40 MiB past the 32 MiB `maxBuffer` and stays alive with its child: `ENOBUFS`, both PIDs said, every connection ended |
| `#1322.160d30bf` an in-time run is measured as before | `in-time.test.mjs` | exit 0: status 0, `stdout` `measured\n`, `output` `measured\nwarn\n`, `elapsedMs` ≥ 300, `cpuMs` ≥ 300, `peakBytes` > 10 MiB, finite loads, `uncounted` `[]`, `qos` null; exit 3: status 3 returned, not thrown; streamed: status 0, empty `output`/`stdout`, CPU and RSS read; a background child of a run that exited in time still answers SIGUSR2 after the command said `exit` (no group kill on success) |

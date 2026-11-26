# #3587, blind redraft: event waits

This is a blind suite for #3587, written from the issue, the design (docs/technical-design.md, docs/parallel-proof.md
sections 6 and 7b) and base b48a47db7 alone.

It was written under the wait-ratchet rule, a rule given to the job: as the header of scripts/wait-ratchet.mjs says, a
test waits for the event it needs, never for time to pass; a `sleep(…)`, `Atomics.wait`, a `setTimeout` or
`setInterval` timer, or a clock difference inside an assertion is a fixed wait, and a timer or clock check that only
bounds a wait, so all it can do is turn a hang into a failure, is allowed with a `// deadline: <why>` marker, one marker
for one finding.

Run it with `node --test --test-concurrency=1 tests/acceptance/3587-redraft-waits/waits.test.mjs`. `BASE-FAILURE.txt`
holds its run on the base.

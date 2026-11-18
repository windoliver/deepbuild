# Dispute: criterion 2's third-connection test (`ac2-join-only.test.ts`, third test)

The first draft makes four third connections to the relay while the match is open: a random ID that opens, a random ID
that joins, the match's ID one digit off that opens, and the same one-digit-off ID that joins. It then fails any third
connection that receives a message other than `hello`, `joined` or `refused`.

The last two connections name the same ID. The shipped relay (#309, `packages/contracts/slots/relay@1.json`) opens a
match for a `join` with `open: true`, seats a `join` with `open: false` in a match it holds, and sends `start` to every
copy of a match once its last seat is taken. So those two connections become the two copies of a match of their own,
and each receives that match's `start`. Nothing from the match under test reaches them: no frame, no message naming its
ID. The test fails all the same, on a right program and a wrong one alike.

Shown on this change with the suite's own run: every other assertion of the test holds (the copies' hashes, the door's
log of what each copy sent, each copy's `sockets` log, no cookie, credential or secret), and its only two failures are

```
the third connection with the ID one digit off, opening received a start message
the third connection with the ID one digit off, joining received a start message
```

The test went to a fresh run of the blind job with the same inputs and the criterion (never the work, the diff or this
dispute), given the base fact above about the shipped relay. Its redraft is `tests/acceptance/549-redraft-ac2/`: the
same test with each third connection given an ID of its own, so none can fill a match with another. The file's other
three tests are not disputed.

## The redraft on the work

Run on November 17, 2026 at `8b42e8c71`, under a build grant:

```
 RUN  v5.0.5 ~/doneright-549/tests/acceptance/549-redraft-ac2
 Test Files  1 passed (1)
      Tests  1 passed (1)
   Duration  446.98s (tests 100%)
```

The redraft passes where the first draft fails, so by the design's Dogfooding rule the dispute came to the owner once,
with both drafts and the failing output above.

## The owner's call

November 17, 2026, in the session that built this change: "Redraft proves it". Criterion 2's third-connection half is
proved by the redraft, which runs in the first draft's place (`scripts/lanes.mjs`); this file, with its other three
tests, which pass and are not disputed, runs by hand.

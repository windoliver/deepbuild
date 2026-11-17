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
dispute), given the base fact above about the shipped relay. Its redraft is `tests/acceptance/549-redraft-ac2/`; this
file's third test moves to the by-hand list (`scripts/lanes.mjs`) when the redraft lands. The file's other three tests
are not disputed.

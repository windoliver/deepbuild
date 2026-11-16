# An approved change to this suite's world

On 2026-11-15 the owner approved, on PR #2671, "Approve world fix": keep this suite as #1349's proof, with the blind
job's own fix to its stand-in model (63e77c736, written up in `WORLD-FIX.md`).

Why: the model's CONNECT handler called `socket.setEncoding('utf8')`, which Node 24 refuses on an HTTP server's socket
("Changing the socket encoding is not allowed per RFC7230 Section 3"). So no prompt reached the model, no card ever
came, and no right program could pass. The job that wrote the suite made the fix from that error alone, without
seeing the work, and showed it working with no DeepBuild involved.

What changed: `helpers.ts`'s `Model.start` 'connect' handler only. It reads the tunnel's bytes as Buffers and decodes
the first line itself. No test, assertion, expected value, criterion's judge or plant changed.

A `deep/approved/` tag for it needs the owner's touch key, which `scripts/proof-change.mjs` requires; none is signed.

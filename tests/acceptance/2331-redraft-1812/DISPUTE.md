# Dispute: #2331's hub-down line in `deep inbox`, after #1812

**The first draft's test can't pass on #1812's work.** #1812's Scope says "One sentence for a hub that isn't answering, from one function, in every command: that it isn't answering, since when if the record says, and the one fix". Its first criterion names `deep inbox`. Its Scope also says "An exit or a line an acceptance suite pins moves only through that suite's blind redraft". The first draft's `#2331.04651a1b` test, "deep inbox, the hub down, …", holds stdout's first line to be exactly today's `The hub isn't answering, since <HH:MM>; this is the list its database holds.`, which names no fix.

One run on the work (`05d624f27`, before main was merged in) fails there, at check (c). It passes exit 3 and the time:

```
AssertionError: deep inbox's first line says the hub isn't answering and since when, as today: "The hub isn't answering, since 22:35; start it with deep hub start. This is the list its database holds."; one of ["The hub isn't answering, since 11:59; this is the list its database holds.", …]
```

The file's hub-up test, `week.test.ts` and `judges.test.ts` don't read that line.

**The redraft.** A fresh run of the blind job wrote this folder (commit `4a57e50fb`, cherry-picked as `bc4cdf847`). It was given #2331, #1812, the frozen suite, #1812's blind suite, the design and the base `c0a9de979`, which holds no implementation of #1812. It never saw the work, the diff or this dispute. Its one test copies the world, the run and checks (a), (b), (d) and (e) byte for byte. Check (c) now takes the first line of stdout, then stderr, that says the hub isn't answering. That line must say `since <HH:MM>` at one of the same minutes, name `deep hub start`, and name neither `deep setup` nor `BLOCKED`. At the base it fails at (c) only, for the missing fix (`BASE-RESULTS.txt`).

On the work merged with main, at `bc4cdf847`, one run passes it: `Test Files 1 passed (1); Tests 1 passed (1)`.

## Your call, once

- **Swap in the redraft** (recommended): it runs in the first draft's place. The swap retires only the hub-down test of `tests/acceptance/2331/inbox.test.ts`, since that file's hub-up test still holds. The signed approval tag on that change is owed with it.
- **A third draft**: name the reading to change, and a blind job writes this test again on that ruling.

Until then both drafts stay in the lanes as their commits registered them, and neither draft was edited.

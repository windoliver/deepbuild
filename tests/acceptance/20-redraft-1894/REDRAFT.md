# #20 blind redraft, after #1894: the record is opened with the adapters' transcript readers

#20's suite opens its own record over an evidence store (`tests/acceptance/20/helpers.ts`, `openWorld`) and, for AC10,
has that record read message `m40` of an archived Claude Code transcript: a learned change quotes it at
`session:<id>#m40`, and the record applies the change only when the quote is at its handle. #1894 moves each agent's
transcript reader out of the record and into its adapter: "an adapter owns its transcript reader; the record takes turns
in one shape and names no agent". A record opened with no `readers` reads no turn from any archived transcript, so a quote
at a `session:<id>#<message>` handle is "not at its handle". Whoever opens a record over an evidence store passes
`readers: transcriptReaders` from `@deepbuild/adapters`. No criterion, expected value, fixture or plant of #20 is touched:
only how the suite's own record is opened.

Written from issue #1894, the design it links, `tests/acceptance/20/` and base `e87cefc44`. It never saw an
implementation of #1894, and was not run: the base checkout it was written in has no `node_modules`.

| Original (path › test) | Criterion | Why no program meeting #1894 can pass it |
|---|---|---|
| `20/growth.test.ts` › AC10 the session at 10 lines, then at 50: two copies with their own events, the record links the newest, and #m40 resolves | `#20.7a50eb28` | `20/helpers.ts`'s `openWorld` opens the record with `openRecord({ path, now, evidence })`, no readers. Under #1894 that record reads no turn of the archived copy, so the learned change quoting `m40` is refused as not at its handle, and the test stops at "resolves through the newest copy: a learned change quoting message m40 there is applied" |
| `20/growth.test.ts` › AC10 (wrong program) an archive that copies once leaves #m40 unresolved: the quote is refused as not at its handle, and this test fails naming the handle | `#20.7a50eb28` | it runs the same scenario on the real archive first, in a world from the same `openWorld`, and stops at the same assertion before the twin is reached |

What changed, and nothing else:

| | In #20's suite | In the redraft |
|---|---|---|
| `openWorld` (`helpers.ts`) | `openRecord({ path, now, evidence })` | the same function, copied with its unexported `counting`, and the record opened with `readers: transcriptReaders` too. It first asserts that `@deepbuild/adapters` exports `transcriptReaders`, read from the module as a namespace, so the base fails at that assertion and not at link time |
| The rest of `helpers.ts` | | #20's, by `export * from '../20/helpers.ts'` |
| `growth.test.ts` | imports `./helpers.ts` and `./wrong.ts` | imports the redraft's `./helpers.ts` and `../20/wrong.ts`; otherwise copied as it is, but for its comments |

At the base both tests fail at `@deepbuild/adapters exports transcriptReaders (#1894)`: the base has no such export.

Wrong programs: #20 has no `twins.json` and no `twins/` folder. Its wrong programs are test-side twins of the archive in
`20/wrong.ts`. The redraft imports `copyOnceArchive` from there as it is: the twin writes through the world's record and
store, so it runs on the record the redraft opened, and its expected reading (one copy, the change refused as "not at its
handle", `resolves` throwing the handle) is the original's.

Lanes: #20 has no `lane.json`, and the redraft writes none. `scripts/lanes-lists.mjs` lists the whole folder
`tests/acceptance/20/` in `alone` and `tests/acceptance/20/budgets.test.ts` in `timed`; no file of #20 is in `slow`,
`byHand`, `exclusive` or `redrafted`. Nothing lists `tests/acceptance/20-redraft-1894/` yet.

Files of #20 that need no redraft:

| File | Why |
|---|---|
| `budgets.test.ts`, `copies.test.ts`, `quiet.test.ts`, `readback.test.ts`, `secrets.test.ts` | they read the record's events (`transcript.archived`, `archive.quiet`, `ask.created`) and the copies' bytes from the evidence store by hash. None reads a message of a transcript through the record |
| `ci.test.ts` | CI logs from the fake forge and `ci.archived` events; no transcript |
| `retention.test.ts` | events and stored bytes; the hub it starts (`hub.ts`) is a child process that opens its own record for the retention pass, and no turn is read |
| `wrong.ts`, `forge.ts`, `generate.ts`, `hub.ts` | `wrong.ts`'s `privateLedgerArchive` opens a second record with no evidence store, only to append its own links; the others open no record |

How to run: `npx vitest run --root tests/acceptance/20-redraft-1894`.

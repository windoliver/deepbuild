# Memory hill-climb, 2026-11-10

Base: main at `435141d5`. Asked for: audit package by package and hill-climb memory use.

After a start on a record of 30 days, the hub's physical footprint is 85.2 MB where it was 109.7 MB, and an idle
`deep mcp` holds 17.5 MB where it held 19.1 MB. Seven changes, each measured against the base and each with a test
that fails on the base. The Rust crates were not audited: see [Not covered](#not-covered).

## How it was measured

Wall time was not used: the machine's load average was between 50 and 390 throughout, and it was swapping. Memory was
read four ways, on a build of the base and a build of the change run turn about:

- **Each thread's heap**, through the hub's inspector after two full collections, as `benchmarks/hub-churn.mjs` reads it.
- **Physical footprint, resident memory, the malloc zone and V8's own pages**, from `vmmap -summary`, 15 s after the
  hub's ready line. Resident memory leaves out what the machine compressed, so it moved by 30 MB between like runs;
  the footprint moved by 3 MB.
- **The malloc high-water mark and its call tree**, from `malloc_history -highWaterMark`.
- **Each module's own cost**, by importing an entry's modules one at a time, dependencies first, in a fresh process,
  with a full collection after each.

The record is #16 AC12's: 30 days, 20 sessions a day of ten turns, 90,600 events, a 51 MB ledger. The tools are not
in the repo. Off a reference Mac these are readings, never budget verdicts.

## Measured

Six runs a side, turn about, the median and the range.

| Hub, 30 days of history, 15 s after ready | Base | Change |
|---|---|---|
| Physical footprint | 109.7 MB (107.3 to 110.6) | 85.2 MB (83.2 to 88.8) |
| Peak footprint | 182.1 MB (158.6 to 201.1) | 146.0 MB (122.9 to 150.7) |
| malloc zone, dirty and compressed | 46.9 MB | 29.9 MB |
| V8's pages | 49.8 MB | 43.2 MB |
| Resident memory (`ps`) | 145.5 MB (117.4 to 148.8) | 120.1 MB (115.2 to 122.1) |

| Heap after a full collection | Base | Change |
|---|---|---|
| Core thread, 30 days of history | 26.16 MB | 21.49 MB |
| Core thread, empty record | 22.47 MB | 19.33 MB |
| Main thread | 8.61 MB | 8.17 MB |
| Parser thread | 8.97 MB | 8.77 MB |

| | Base | Change |
|---|---|---|
| malloc high-water mark at a start, 30 days (one run a side) | 24.9 MB | 15.4 MB |
| of it, SQLite's page cache | 15.9 MB | 1.6 MB |
| Idle `deep mcp`, physical footprint (six runs a side) | 19.0 to 19.3 MB | 17.0 to 17.9 MB |
| Idle `deep mcp`, heap held beyond what it uses | 4.2 to 4.4 MB | 1.2 to 1.5 MB |

## What changed

| Change | Where | What it saves |
|---|---|---|
| The check for a newer record, and every read-only connection the record opens, hold SQLite's 2 MB page cache. They held better-sqlite3's 16 MB; the check walks every event at each start and filled it. | `hub/src/readonly-core.ts`, `record/src/storage.ts` | 14 MB of the start's malloc peak, and the fragments it left |
| The collection each thread makes once started is a memory-reducing one. A plain `gc()` freed the garbage and kept its pages: the core's heap stayed at 65 to 96 MB for 20 MB in use until V8 shrank it, 10 s later on an idle machine and not within 19 s on a loaded one. | `hub/src/settle.ts` | the core's heap is 29 MB from its ready line on |
| `deep mcp` makes that collection too. It never collected after its start, and it idles for a session's life. | `hub/src/mcp.ts` | 1.6 MB a session |
| A schema's text is kept only for `getSchema`. The record reads all 268 schemas once at its open, and each text stayed for good: 1.54 MB in the core, of which 10 texts were ever read twice. | `contracts/src/schemas.ts` | 1.5 MB in the core, 0.2 MB in the parser |
| The work kit loads `node:http` in the case that serves. The core thread loaded it, with TLS and HTTP/2 behind it, for a fixture server it never starts. | `checks-work/src/kit.ts` | 1.5 MB in the core |
| The hub's event loop reads the record's generation through `@deepbuild/record/meta`, and the archive and the hub's memory module take `ulid` from `@deepbuild/record/ids`. The main thread loaded the store, its projections and the learned layer for one function. | `record/src/meta.ts`, `hub/src/server.ts`, `hub/src/memory.ts`, `archive/src/index.ts` | 0.4 MB in the main thread; it loads 55 files where it loaded 61 |
| `node:inspector` loads in the one planted program that closes it. Every thread, `deep mcp` and each command that reads a plant loaded it. | `hub/src/plant.ts` | 0.1 to 0.3 MB a thread or process |

**What you can see.** The memory-reducing collection takes longer than the plain one: about 60 ms of CPU in the core
where it took 20, so the hub's ready line comes that much later; hooks are acknowledged from the moment the socket
exists, as before. `deep mcp` takes about 10 ms more CPU to start (60 ms against 50, 15 runs a side). A second reader of
a schema reads its file again: 10 more small reads at a hub's start.

## Verification

| Check | Result |
|---|---|
| `packages/hub/test/startup-memory.test.ts`, 5 cases | all fail on the base for the reason each names; all pass here |
| `packages/record/test/record.test.ts`, 2 new cases | the cache case fails on the base; the case for a file that is no database fails on a reader that sets its cache unguarded; both pass here |
| `packages/contracts/test/contracts.test.ts`, 1 new case | fails on the base: 1.63 MB stay after 0.98 MB of schemas are read and dropped; passes here |
| The main thread's case, with `server.js` importing the record's main entry again | fails, naming the three modules |
| The planted `churn-no-full-collection` | the inspector closes on both sides |
| `tsc --noEmit` | see the PR: the errors it reports are in files this change does not touch |
| `node scripts/affected.mjs` | see the PR |

The cache cases assert the pragma each connection sets, through a spy on better-sqlite3, not memory itself: its build
keeps no memory statistics. The memory is the high-water reading above.

## Found and not applied

- **Sources kept at two bytes a character.** 51 built files hold a character above U+00FF, mostly `…` and curly
  quotes in messages, so V8 keeps each whole source as a two-byte string: 1,470 KB more in the core thread, 165 KB in
  the main thread, 45 KB in the parser. `hub/dist/core.js` alone is 630 KB of it, for 37 characters. The fix is escapes
  in 54 source files, or a build step that writes them. An owner's call: it changes how messages are written.
- **The scrubber's tables in the main thread**, 0.6 MB: `hub/src/hookmap.ts` holds the adapter registry the event
  loop needs and the line parser it never runs, and the parser imports the scrubber.
- **The asks core decodes every event at a start** (the Nov 9 audit's 02 F4), so the core's heap climbs to 64 to
  96 MB before the collection. With it fixed the start's peak would fall further.
- **`deep mcp` reads a line of any length.** Fed input with no newline, its heap reached 196 MB in 2.5 s. A cap is a
  visible change.
- **The contracts entry loads its code generators and its lint** in every thread, about 0.15 MB each.
- **Still in the code from the Nov 9 audit**: the source recording that keeps every answer (03 F1), the action
  results kept by request ID (03 F4) and each ended job's output (03 F3). #1866 covers the claim state.

## Not covered

- **Rust crates.** None was read or measured for this audit beyond building deep-hook, whose debug build peaks at
  1.5 MB for `--version`. The Nov 9 write-ups' memory findings (the mesh cache, `Steps::checkpoints`, the proxy
  pictures, the call log) were not checked again.
- **TypeScript packages no long-lived process loads**: buying, channels, checks-journey, config-eval, jobs, otlp,
  paseo, pi, proof and sources.
- **The app.** Its 300 MB budget needs a window, and the screen was not in reach.

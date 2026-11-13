# @deepbuild/record

## What it is for

The append-only SQLite event log and the projections rebuilt from it by replay (#14), plus the learned layer's check (#62) and the one replay comparison rule (#112). Almost every other package reads or appends through it: the hub, leases, supervisor, verdicts, runner, wiki, reading and the extensions.

## Where new code goes

- `src/index.ts`: the store, append and read; `src/projections.ts`: every table but `events`, each a function of the events alone.
- `src/lifecycle.ts`: the gate that moves asks, ask-tasks, leases, claims and open items only through their lifecycle tables; a move no row allows stays out of the projections and is recorded as `move.refused` (#570).
- `src/learned.ts`: the learned layer; `src/replay.ts`: the replay comparison; `src/storage.ts`: the storage the record writes through; `src/trust.ts`: project trust, one decision in the record that the extension host, the wiki and the hub all read.
- `src/ids.js`, typed by `src/ids.d.ts`: the database-free public `@deepbuild/record/ids` entry for event IDs and their timestamps. Plain JavaScript keeps it usable before a build and inside installed packages; the main entry re-exports `ulid` for existing callers.
- `src/meta.ts`: the public `@deepbuild/record/meta` entry, a record's writer generation through a read-only connection and `RecordError`, so the hub's event loop reads the generation without loading the store, its projections or the schemas. The main entry re-exports both.
- Regression tests go in `test/`; acceptance tests live in `tests/acceptance/14`, `62` and `112` and are never edited.
- A projection never reads a clock, setting, file or evidence bytes; state that comes from time comes from an event that says so.

## What it may import

The bottom of the core: only `@deepbuild/contracts`, `@deepbuild/evidence`, better-sqlite3 and `node:` built-ins, each through its public entry. Everything else stands on it, so it never imports another workspace package, an extension, or the hub, CLI or app.

## Deviations

- `src/storage.ts`: ships `testStorage()`, the design's test VFS that keeps writes in memory until a sync, beside the real storage, so the hub core takes its storage by injection (design: Fault injection).

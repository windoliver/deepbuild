# @deepbuild/archive

## What it is for

The transcript archive (#20), a first-party extension that ships on by default. Each pass copies every new or grown agent transcript into the evidence store, redacted, links it to its session with a transcript.archived event, copies completed CI runs before the forge deletes them, raises a "rotate this key" ask for a key pasted into chat, and raises archive.quiet when an agent worked a day with nothing captured. The hub opens it (`openArchive`) and reads `cwdOf`.

## Where new code goes

- `src/index.ts`: the whole archive. What it already copied is read back from the record, never kept in memory, so a restart copies nothing twice; keep it that way.
- Sources come from each adapter's facts (`transcripts.home`, `transcripts.path`): a new agent's folder goes in its facts file, not here.
- Tests: `test/` for regressions beyond the acceptance suite in `tests/acceptance/20/`.

## What it may import

Extension layer. It reaches `@deepbuild/adapters`, `@deepbuild/asks`, `@deepbuild/evidence` and `@deepbuild/record` through their package entries, plus `node:` built-ins. It never imports `@deepbuild/hub`, the CLI or the app; the hub imports it.

## Deviations

None.

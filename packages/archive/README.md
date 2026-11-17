# @deepbuild/archive

## What it is for

The transcript archive (#20), a first-party extension that ships on by default. Each pass copies every new or grown agent transcript into the evidence store, redacted, links it to its session with a transcript.archived event, copies completed CI runs before the forge deletes them, raises a "rotate this key" ask for a key pasted into chat, and raises archive.quiet when an agent worked a day with nothing captured. The hub opens it (`openArchive`) and reads `cwdOf`.

## Where new code goes

- `src/index.ts`: source discovery, archive links and rotate asks. `transcript.archived@4` names the copied source prefix, all its evidence parts, and whether its final scrub unit is safe to continue. Version 3 parts and versions 1/2 whole copies remain readable; a v3 checkpoint without the safety bit is conservatively rebuilt on growth. Persisted checkpoints come from the record, so a restart copies nothing twice.
- `src/copy.ts` and `src/copy-worker.ts`: serialized, backpressured transcript copying off the hub's loop, with one reusable input buffer per copy. One worker serves the copies that follow each other, so a pass loads the scrub's rules once; after a transcript of 8 MiB or more it ends at once, before the evidence store's digest worker starts. Complete lines are scrubbed with lookahead before storage; the same scan supplies pasted-key matches. A changed tail waits one pass, a stable tail is copied with its continuation safety recorded, and source identity/change times are rechecked before the link. If a stable incomplete line or structured value later grows, its copy is rebuilt rather than appending outside its earlier mask. A grown transcript's copy also reads the copied prefix's last whole lines again, within the scrub's reach, as context: when what was added changes how they scrub, whatever the rule, the copy starts again from the transcript's first byte instead of appending. Concurrent copies of one session serialize through the checkpoint.
- Sources come from each adapter's facts (`transcripts.home`, `transcripts.path`, and `transcripts.archived` where its agent moves a transcript it archives): a new agent's folder goes in its facts file, not here.
- Tests: `test/` for regressions beyond the acceptance suites in `tests/acceptance/20/` and `tests/acceptance/2365/`. `benchmarks/archive-growth.mjs` measures the 100 MB + 1 MB workload; `reports/2365.md` tracks incomplete proof.

## What it may import

Extension layer. It reaches `@deepbuild/adapters`, `@deepbuild/asks`, `@deepbuild/evidence` and `@deepbuild/record` through their package entries, plus `node:` built-ins. It never imports `@deepbuild/hub`, the CLI or the app; the hub imports it.

## Deviations

- A pass over a grown transcript hashes the prefix it already copied, in a bounded buffer, before it appends; only the new text is scrubbed and stored. No portable metadata signal distinguishes an append from an in-place rewrite plus append, and #2365's Scope allows the read (reworded with the owner's approval on 2026-11-15).
- The target part size is 1 MiB: each cut scans its lookahead again, which at 256 KiB cost the 5 MB backlog a quarter more instructions. A line, or the lines one scrub mask covers, is one unit and is never split (#2365's Scope: a part ends at a line's end, and no line is scrubbed in two halves). A copy therefore holds about one part, the scrub's reach (64 KiB, or three times the longest held value) and its largest unit, whatever the transcript's size; a transcript that is one line is held whole.
- The context a grown transcript's copy reads again is the whole lines within that reach. A match that starts earlier, or on a line longer than the reach, and ends in what was added is not seen.

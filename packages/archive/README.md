# @deepbuild/archive

## What it is for

The transcript archive (#20), a first-party extension that ships on by default. Each pass copies every new or grown agent transcript into the evidence store, redacted, links it to its session with a transcript.archived event, copies completed CI runs before the forge deletes them, raises a "rotate this key" ask for a key pasted into chat, and raises archive.quiet when an agent worked a day with nothing captured. The hub opens it (`openArchive`) and reads `cwdOf`.

## Where new code goes

- `src/index.ts`: source discovery, archive links and rotate asks. `transcript.archived@3` names the copied source prefix and all its evidence parts; versions 1 and 2 still read as whole copies. Persisted checkpoints come from the record, so a restart copies nothing twice.
- `src/copy.ts` and `src/copy-worker.ts`: serialized, backpressured transcript copying off the hub's loop. Complete lines are scrubbed with lookahead before storage; a changed tail waits one pass, a stable tail is copied, and source identity/change times are rechecked before the link. Concurrent copies of one session serialize through the checkpoint.
- Sources come from each adapter's facts (`transcripts.home`, `transcripts.path`, and `transcripts.archived` where its agent moves a transcript it archives): a new agent's folder goes in its facts file, not here.
- Tests: `test/` for regressions beyond the acceptance suites in `tests/acceptance/20/` and `tests/acceptance/2365/`. `benchmarks/archive-growth.mjs` measures the 100 MB + 1 MB workload; `reports/2365.md` tracks incomplete proof.

## What it may import

Extension layer. It reaches `@deepbuild/adapters`, `@deepbuild/asks`, `@deepbuild/evidence` and `@deepbuild/record` through their package entries, plus `node:` built-ins. It never imports `@deepbuild/hub`, the CLI or the app; the hub imports it.

## Deviations

- Pending #2365 scope decision: verifying arbitrary rewrites still reads/hashes the old source prefix; only the new text is scrubbed and stored. No portable metadata signal distinguishes an append from an in-place rewrite plus append.
- The target part size is 256 KiB. A line or a single multi-line scrub mask is indivisible, so an arbitrarily large one is not yet memory-bounded. Do not claim the issue closed until these scope/proof gaps in `reports/2365.md` are settled.

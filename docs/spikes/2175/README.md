# #2175: what deep-hook's start costs, symbol by symbol, and which imports the forward path needs

About 20 M of the instructions a deep-hook call retires are spent before `main` runs, and the Nov 10 audit found
that most of what the hook adds to an empty Rust program's start comes from the number of system symbols it imports,
about 60 K instructions each. This folder attributes each of the 148 imports to the code that pulls it in, traces
which of them the forward path really calls, and tries the two cuts that looked largest. The proof is
`tests/acceptance/2175/`.

## Files

- `imports.mjs`: the attribution. `node docs/spikes/2175/imports.mjs` builds the release deep-hook, lists its
  imports (`nm -u`), reads each one's callers from the disassembly (`otool -tV`: every `bl` or `b` to its symbol stub,
  under the function it sits in), and traces three paths with a dylib inserted by `DYLD_INSERT_LIBRARIES` that
  interposes every imported function and logs the first call to each made from deep-hook's own `__TEXT` (libSystem
  calling itself isn't counted). It prints record.json's `imports`. `node docs/spikes/2175/imports.mjs table` prints
  the table below from record.json.
- `measure.mjs`: the cuts. `node docs/spikes/2175/measure.mjs` builds the release deep-hook from the merge base as it
  is and with each cut's patch, then runs 15 rounds, every variant in each round in a turning order (interleaved run
  by run), each variant's `--version` and then a forwarded PreToolUse Read with the hub away, under `/usr/bin/time -l`.
  It prints record.json's `cuts`: per variant its imports, its size, every reading and the medians.
- `cut-a-spawn.patch`, `cut-b-joined.patch`, `cut-ab-both.patch`: the cuts as tried, against the merge base. They are
  prototypes for the measurement, not for merging (What each cut costs, below).
- `record.json`: `imports` and `cuts`, as the two scripts printed them.

## The paths traced

- `--version`: `deep-hook --version`.
- hub answers: `deep-hook claude-code PreToolUse` with a Read on stdin, and a stand-in hub on `~/.deepbuild/hub.sock`
  that says hello, acknowledges the call and sends the empty reply. It must answer one call and nothing may spool.
- hub away: the same Read with no hub: the call spools and starts `deep-hook spool-sync`, which the trace follows too
  (two processes). It must leave a spool line.

The tracer can't follow five imports, which are read from their callers alone: `___stack_chk_guard` is data,
`dyld_stub_binder` and `__tlv_bootstrap` are called by dyld, and `_bzero` and `_strlen` crash the process when
interposed even alone (dyld or libSystem calls them where the trampoline can't run).

RESULTS_PLACEHOLDER

# Acceptance tests for #1901: content keys from declared fields, and the build digest in the machine fingerprint

Written first, from issue #1901 (its scope, its two acceptance criteria, its Proof line and its Oracle note,
which says no upstream test checks either criterion), the design sections it names and those they lean on,
and base commit `d51be2c3` ("Merge pull request #2108 …"), by a job that never saw an implementation; none
existed. The implementing agent doesn't edit these files (AGENTS.md, Proof); a dispute goes to a blind
redraft of this job (design: Dogfooding).

What was read:

- `docs/canvas-primitives.md`: Content key ("Any value a key or a compared hash covers is hashed field by
  field or through a layout with no padding, never as memory, so bytes the program never wrote can't reach
  a key"); Determinism class (a same-machine result's environment fingerprint "enters the content key of
  every cache that holds GPU output", and "The fingerprint also names the build: the digest of the sources
  of the canvas core and its modules that the binary was built from, so a rebuilt binary never reads a
  frame, capture or final its predecessor drew"); Carried state: the cache manifest (after a restart an entry
  is read only when its key and "the build its environment fingerprint names" match); Export: path-traced
  finals (a final's frames kept by hash).
- `docs/technical-design.md`: Dirty classes and content key, Document check, Canvas modules, How we know
  version 0 works (Dogfooding).
- At the base: AGENTS.md; `tests/acceptance/855/` (deep-show built per Cargo feature set and copied out,
  JSON lines, `--planted` and `--costs` startup arguments, criterion IDs), `tests/acceptance/387/` and
  `tests/acceptance/896/`; `crates/deep-show/src/main.rs` (`start_args`: `--planted <name>` and `--costs
  <path>`, anything else `bad_input` and exit 2; the call names) and `hub.rs` (the scenario's `machine`,
  #379, read only for the planted cost check's speed); `crates/deep-canvas/src/schedule/` (`Hasher`: `hash@1`
  SHA-256 and `hash@2` BLAKE3 over length-prefixed fields cut to 128 bits; `Canonical`, #855's
  declared-field encoding of typed results); the environment fingerprints in
  `crates/deep-show/src/kit/goldens.rs` (`backend/adapter/os/driver`) and `crates/deep-gpu-layer/src/golden.rs`
  (OS, GPU, driver, wgpu); `crates/deep-canvas-loop` (the loop canvas module, #453).

What the base already does and these tests don't credit: keys and result digests go through `Hasher` over
length-prefixed fields, and typed results encode through `Canonical`. But neither environment fingerprint
names the build, nothing keeps a frame, capture or final on disk across processes, there is no way to ask a
process for its fingerprint, and no key input held in a struct with padding is reachable. So these tests
define the surface below.

## Run them

They build `deep-show` and, for criterion 1, change one tracked source file for one build, so they run with
`--no-file-parallelism` and nothing else building in the checkout. `scripts/lanes.mjs` needs this folder in
its `alone` list; this README is the instruction, and the implementer makes that edit.

```sh
npm ci                                       # once, if node_modules is missing
export PATH="$HOME/.rustup/toolchains/1.99.1-aarch64-apple-darwin/bin:$PATH"   # where cargo isn't on PATH
CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 npx vitest run --root tests/acceptance/1901 --no-file-parallelism --testTimeout=600000
npx tsc -p tests/acceptance/1901/tsconfig.json   # type-check
```

Every build is `cargo build --locked --bin deep-show --no-default-features --features full`, its binary
copied out of `target/debug` under its own name into the test's temporary folder; there are no test
features. `build-digest.test.ts` builds three times: the checkout as it is (`previous`; nothing to do when
`target/debug` is current), then with `crates/deep-canvas-loop/src/lib.rs` changed (`changed`), then again
after that file is restored (`same`). The change appends a comment and `const _: () = ();`. Only
deep-show depends on deep-canvas-loop, so at the base each rebuild compiles that small crate and deep-show
itself (how the implementation computes the digest decides what else); on a loaded shared Mac, plan on a
few minutes each. The file is restored byte for byte in a `finally`, and on
SIGINT, SIGTERM, SIGHUP or exit while the build runs; the test then checks its bytes and its `git status`
line are as they were. A run that finds the change already in the file (an earlier run killed with
SIGKILL) stops before building and says to restore it. Builds and processes are started by `spawnSync`
and stopped only by their own timeouts. `padding.test.ts` builds once (a no-op after the other file).
Every test writes into its own temporary folder and deletes it. A run with `--root tests/acceptance/1901`
leaves Vitest's cache in `tests/acceptance/1901/node_modules/.vite`; delete it.

`BASE-FAILURE.txt` is the run at the base, after one build of the base: both tests fail there at the
missing surface, before any rebuild (`--cache` answers `bad_input` and exit 2; a scenario with
`padded_key` answers `bad_input`), and the base's answer to each other new surface (`--planted
fingerprint_without_sources` and `--planted key_hashes_raw_bytes` answer `bad_input` and exit 2; a scenario
with `fingerprint` or `draw` answers `bad_input`), with the board presented.

## The surface under test

The issue names a fingerprint, a cache, a rebuild, a padded key input and two planted programs, but no code
API. These tests extend `deep-show run` and keep #393's, #305's and #855's conventions: one scenario line
in, one JSON line out with a reply per call, `bad_input` for a line or argument it can't take, and planted
programs reachable only through `--planted`. What follows is what this issue adds, kept as small as the
criteria need.

### Startup arguments

`deep-show run [--planted <name>] [--costs <path>] [--cache <dir>]`, each at most once, in any order;
anything else stays `bad_input` and exit 2.

- `--cache <dir>`: the folder where the process keeps the GPU output it draws (frames, captures and finals)
  across processes, and reads it back from. Nothing else a process writes is shared between the tests'
  processes (each has its own evidence store).
- `--planted fingerprint_without_sources`: the fingerprint the cache keys entries by leaves out the source
  digest; everything else is unchanged (criterion 1's wrong program).
- `--planted key_hashes_raw_bytes`: `padded_key` keys the fixture by its raw bytes, its memory with its
  padding, instead of its declared fields (criterion 2's wrong program).

### `fingerprint`

`{"call": "fingerprint"}` answers `{"fingerprint": {…, "build": string}}`: the machine (environment)
fingerprint this process keys GPU output by. Its other members are the implementer's (the design names the
GPU's name and core count, the OS build, the wgpu and naga versions and the backend). `build` is the digest
of the sources of the canvas core and its modules the binary was built from, in lowercase hex, at least
128 bits. How it is computed (which files, which hash) is the implementer's; the tests only compare it
between builds.

### `draw`

`{"call": "draw", "doc", "t", "output": "frame" | "capture" | "final"}` draws the document's current
revision at `t` as that kind of GPU output, through the cache, and answers `{"output", "entry": string,
"read": boolean}`:

- `entry` names the cache entry that holds the output: the same string whenever any process reads or
  writes that entry, so an entry one process reads is named as the process that wrote it named it.
- `read` is true when the output came from an entry already in the cache (nothing was drawn), false when
  it was drawn, and then kept in the cache.

The tests draw a 2D board, for which the three outputs hold one raster (the one its still at `t` stores,
#501's export frame): a frame as the view keeps it, a capture as a snapshot keeps it, and a final as an
export keeps a final's frame. Each output has its own entry, so a cache that keys one output by the build
and another not fails.

### `padded_key`

`{"call": "padded_key", "fields": integer, "seeds": [integer, integer]}` builds the binary's padded
fixture twice and keys each build, answering `{"struct": string, "size": integer, "padding": [integer],
"raw": [string, string], "keys": [string, string]}`:

- the fixture is a key input held in a struct with padding (a Rust type whose layout leaves bytes between
  or after its fields), `struct` its name, `size` its size in bytes and `padding` the offsets of its
  padding bytes;
- both builds hold the same field values, drawn from the seed `fields`; build *i*'s padding bytes are filled
  from a random source seeded with `seeds[i]`, and `raw[i]` is the struct's memory (`size` bytes, lowercase
  hex) as build *i* left it before it was keyed;
- `keys[i]` is build *i*'s content key (128 bits, lowercase hex), computed as the core keys a content key's
  input, under the process's hash.

## Criteria to tests

IDs are the first 8 hex digits of SHA-256 of each criterion's text, trimmed, with whitespace collapsed
(#305's command). Each test's name starts with its criterion's ID. Each criterion names its wrong program;
its test runs it through `--planted` and asserts it fails the way the criterion says, naming what it says.

| ID | Criterion (the issue's text) | Test, and the wrong programs it fails on |
|---|---|---|
| `#1901.b2add21a` | The machine fingerprint also names the build, the digest of the canvas core's and its modules' sources the binary was built from: after a rebuild with one module's source changed, no frame, capture or final cached by the previous binary is read, while a rebuild from the same sources reuses them; a fingerprint without the source digest serves the old frame and fails this test, naming the cache entry | `build-digest.test.ts`. Three binaries, each run once over one `--cache` folder in this order, each presenting the board and drawing its frame, capture and final at 0.5 s: `previous` (the checkout as it is) draws all three into the empty cache; `same` (rebuilt after the change was undone) names `previous`'s build and reads every entry `previous` named; `changed` (rebuilt with deep-canvas-loop's `lib.rs` changed) names another build and reads none. "Fails this test, naming the cache entry": with `--planted fingerprint_without_sources` on all three over a fresh cache, `changed` reads the frame entry `previous` wrote, and the comparison fails with one line naming that entry. Wrong programs: the base (no `--cache`); a fingerprint without the source digest; a digest of the core's sources alone; one built from the binary, the commit, a version number or the checkout read at run time (the change touches no code path, and every binary runs after the file is restored); a cache that keys one output but not another by the build; a cache that never reads (`same` must reuse) |
| `#1901.95394721` | A fixture key input held in a struct with padding, built twice with its padding bytes filled from two seeded random sources, gives the same content key both times; a planted key that hashes the struct's raw bytes gives two keys and fails, naming the struct | `padding.test.ts`. `padded_key` with fields from seed 1 and padding from seeds 1901 and 2, then 7 and 42, and fields from seed 2 with 1901 and 2: in each, the two builds' bytes differ in at least one padding byte and nowhere else, and their two keys are equal; the other padding seeds give the first key again; the other fields give another key. "Gives two keys and fails, naming the struct": with `--planted key_hashes_raw_bytes`, the two builds still differ only in padding, their keys differ, and the comparison fails with one line naming the struct. Wrong programs: the base (no `padded_key`); a key over raw bytes; padding never filled (the planted key would then give one key); a key that ignores the fields |

The Proof line's values are printed by the tests: the padded fixture's two content keys per call
(`padding.test.ts`), and each binary's build and, per output, the cache entry it read or drew
(`build-digest.test.ts`).

## Readings where the issue and design leave a choice

- **"The machine fingerprint"** is the environment fingerprint a same-machine result carries (Determinism
  class), which enters the key of every cache of GPU output. At the base it exists only as the kit's and
  the GPU layer's golden fingerprints, so `fingerprint` reports the one the cache keys by.
- **"A rebuild with one module's source changed"** is a rebuild of the same binary with one canvas
  module's source file changed, the loop module's (in the full set, depended on only by deep-show, so the
  rebuild stays small). The change touches no code path, so the two binaries draw the same pixels: only a
  digest of the sources tells them apart, and the test observes the cache's reads, not pixels.
- **"A rebuild from the same sources"** is the binary built again after the file is restored byte for byte,
  so cargo compiles it again from sources equal to `previous`'s.
- **"No frame, capture or final cached by the previous binary is read"** is observed through `draw`'s
  `read` per output; "reuses them" is `same` reading each entry `previous` named. The order (`previous`,
  `same`, `changed`) leaves open whether a binary removes entries another build wrote (the cache manifest
  removes and rebuilds such an entry).
- **"Serves the old frame and fails this test, naming the cache entry"**: the planted fingerprint lets
  `changed` read the frame `previous` drew, and the test's comparison, the same one the shipped program
  passes, fails with a line naming that entry.
- **"A fixture key input held in a struct with padding"** is a struct the binary holds for this test and
  keys the way the core keys a content key's input; "two seeded random sources" are two seeds; "built
  twice" is the same field values with the padding filled from each. `raw` shows the padding really
  differs; another `fields` seed shows the key reads the fields.
- **"Fails, naming the struct"** is the test's comparison failing with a line naming the struct the reply
  names, as #855's planted result fails its comparison naming the operator.

Not tested, because no criterion asks or the surface can't reach it: goldens recorded under another build
(the design reads them INCONCLUSIVE); the cache manifest's other rules (the bytes' sha256, the disk budget,
removal); a change to the canvas core's own sources (the criterion changes a module's); path-traced finals
themselves (none exists at the base; `draw`'s final is the kept export frame of a 2D board); which
shipped keys this issue moves from memory to declared fields (the scope names the rule, the criterion one
fixture).

## Upstream tests (the Oracle lane)

The issue's Oracle note says no upstream test checks either criterion: the source digest in the fingerprint
and the cache rules are ours, and UE6's padding test runs only against Unreal's key builder. So these tests
are the local proof for both.

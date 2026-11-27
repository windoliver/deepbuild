# Acceptance tests for #3611: a fresh canvas core takes each shipped pack's verdict from the store

Written first, blind, from issue #3611 as it reads on November 26, 2026 (its opening paragraph, `Runs on:`, Scope, six
acceptance criteria and Proof line; it has no comments), the design sections it links, the design step its first Scope
line asks for (the section "Pack: a check's result, kept" and the two sentences added beside it, written before any
code; below, "the design step"), and base commit `35956a44a` (`origin/main`, whose last merge is #3492), by a job that
never saw an implementation; none existed. The implementing agent doesn't edit these files (AGENTS.md, Proof); a dispute
goes to a blind redraft of this job (design: Dogfooding). Lean: one test per criterion, one more where a clause needs a
run of its own, and the three planted cores the criteria name.

## Files

| File | Criterion | What it runs |
|---|---|---|
| `ac1-second-core.test.mjs` | `#3611.d8311031` | two fresh cores in turn with the release's packs on one store: counts, rows, listing, the store's files |
| `ac2-changed.test.mjs` | `#3611.8b256396` | four test packs, seven fresh cores: changed bytes, a required version's changed bytes, a row of another build, a planted build; the same under each of two planted cores |
| `ac3-damaged.test.mjs` | `#3611.ce0f9025` | six test packs, three fresh cores: five damaged rows and a whole one; the same under the planted core; and one shipped pack whose check's evidence is gone |
| `ac4-beside.test.mjs` | `#3611.f11db91d` | three test packs, two fresh cores, and between them a process that is not the hub writing two rows |
| `ac4-hub.test.mjs` | `#3611.f11db91d` | a real hub and `deep mcp`: the hub's own store after its core checked the release's packs, read for its rows and for the launch key |
| `ac5-refused.test.mjs` | `#3611.55062395` | three refused test packs, four fresh cores |
| `ac6-task.test.mjs` | `#3611.3b726ffd` | `benchmarks/budgets.json` and the lane's validator; starts no core |
| `ac6-first-reply.test.mjs` | `#3611.3b726ffd` | the first reply's time and memory on a filled store, six fresh cores after the one that fills it |
| `core.mjs` | | the binary, a core and its lines, the world, the calls, folders, deadlines, `must` |
| `store.mjs` | | the store's files as the design step lays them out: read, checked, rewritten, damaged |
| `packs.mjs` | | the release's packs, read at test time, and test packs written into a test's folder |
| `judge.mjs` | | the judges: each criterion decided from rows, counts and files, as sentences |
| `forger.mjs` | | the process that is not the hub (criterion 4): a command of its own |
| `hub.mjs` | | `deep hub run`, `deep mcp`, their binaries |
| `twins.json` | | `{}`: no twin folder (The planted cores, below) |
| `lane.json` | | the folder runs alone |
| `BASE-FAILURE.txt` | | each file run once at the base: every test's failing assertion, how long each file took, and the probes' readings |

## What was read

- The issue, and of the issues it names only the words it cites: #3531's closing comment (the readings, the per-pack
  table, "Who may write the row is not settled"), #3529, #3445, #1720, #3044, #579, #310, #171.
- The design step. `docs/canvas-primitives.md`: Pack, Pack: dependencies, Pack: retired and missing, Carried state: the
  cache manifest. `docs/technical-design.md`: Threats, and what stops each one (Agents gaming checks, Agents switching
  off what watches them, What a command's children do); Numbers version 0 has to hold (Every task carries its own
  budgets, The reference Macs); How we know version 0 works (Criteria to tests, Wrong programs). `docs/parallel-proof.md`:
  sections 5 to 7 and 12a. AGENTS.md, CONTRIBUTING.md.
- At the base, for surfaces and never for expected values: `crates/deep-show/src/packs.rs` (`install`, `rows_reply`,
  `ADMITTED`, `LIB_CHECKS`), `sandbox.rs` (`Host`, `vet`, `VETTED`), `hub.rs` (`install_pack`, `required_first`, the
  `packs`, `sandbox` and `fingerprint` calls), `kept.rs` (`BUILD`), `canvas_side.rs` (`serve`, `line`), `main.rs`
  (`scenario`: the fields it reads, `planted`), `build.rs` (`DEEP_SOURCE_DIGEST`), `kinds.rs`;
  `crates/deep-canvas/src/document/packs.rs` (`manifest_of`, `Packs::admit`, `checks`) and `packs/deps.rs`;
  `crates/deep-sandbox-wasmtime/src/lib.rs` (`compiles`); `crates/deep-show/tests/pack_vet_once.rs`, `canvas_packs.rs`;
  `packages/hub/src/packs.ts`, `canvas.ts` (`Canvas`, `shape`, `checkPacks`), `hub-canvas.ts` (`canvasWorld`, `kinds`),
  `mcp.ts` (`ANSWER_MS`); `scripts/proof-runs.mjs` (`atAssertion`, `twinsOf`, a file's 20 minutes), `proof-binaries.mjs`,
  `benchmark.mjs` (`judgeLimit`, `validateBudgets`, `fingerprint`), `lanes-lists.mjs`; `benchmarks/budgets.json`,
  `benchmarks/process-reader.mjs`; the suites `306/`, `1720/`, `26/` (the hub and `deep mcp` by hand), `2694/`, `3262/`,
  `161/` (a budget held by a suite), `412/` (`deep_kinds list` and its pages), `1901/` (`fingerprint`).
- Nothing else: no other branch, worktree, pull request or note, and no run of the work.

## How to run

```sh
npm ci --ignore-scripts                              # once, if node_modules is missing
npm run build --workspaces                           # ac4-hub runs the built CLI
export CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0
cargo build --locked --bin deep-show                 # every file but ac6-task drives it
cargo build --locked --bin deep-hook                 # ac4-hub's hub doesn't start without it

node --test tests/acceptance/3611/ac1-second-core.test.mjs
node --test tests/acceptance/3611/ac2-changed.test.mjs
node --test tests/acceptance/3611/ac3-damaged.test.mjs
node --test tests/acceptance/3611/ac4-beside.test.mjs
node --test tests/acceptance/3611/ac4-hub.test.mjs
node --test tests/acceptance/3611/ac5-refused.test.mjs
node --test tests/acceptance/3611/ac6-task.test.mjs
node --test tests/acceptance/3611/ac6-first-reply.test.mjs
for f in tests/acceptance/3611/*.mjs; do node --check "$f"; done     # syntax check; the files are plain JavaScript
```

macOS or Linux, Node 24.22 first on `PATH`, `cargo`, `git`. One file at a time: each holds cores, one starts a hub and
one reads times. Each file that drives a core builds `deep-show` once (`cargo build --locked --bin deep-show`, debug,
in the environment as given, so a fresh build compiles nothing) unless the proof run supplies `DEEP_BIN_DIR`, and runs
the core from there. `ac4-hub` builds `deep-show` and `deep-hook` the same way, in the checkout's own `target/` with
`CARGO_TARGET_DIR` dropped, since a hub finds both only there; under a proof run it builds nothing and finds the copies
the run put there for a test that names the CLI's package.

| File | Needs | What it starts | At the base |
|---|---|---|---|
| `ac1-second-core` | `deep-show` | one core through the release's 21 packs' checks, then a second that runs none; each also pages the whole `deep_kinds` listing | 16.5 s: one core, then it fails |
| `ac2-changed` | `deep-show` | 21 short-lived cores of test packs (seven a test) | 17.4 s: one core a test |
| `ac3-damaged` | `deep-show` | 9 short-lived cores, three of them with one shipped pack that carries a library | 19.8 s: 5 cores |
| `ac4-beside` | `deep-show` | 2 short-lived cores and one node process | 5.9 s: one core |
| `ac4-hub` | `packages/*/dist`, `target/{release,debug}/deep-show` and `deep-hook` | one hub whose core checks the release's 21 packs once, and one node process | 17.9 s: the whole test, to its last line |
| `ac5-refused` | `deep-show` | 4 short-lived cores | 6.2 s: 2 cores |
| `ac6-task` | `git`, `origin/main` | nothing where it fails; `git` twice and the lane's validator once where the task is there | 0.1 s |
| `ac6-first-reply` | `deep-show`; `target/release/deep-show` of the same sources for a result that counts | 1 short-lived core (3 where a release build is there), one core through the 21 packs' checks, then 6 that run none | 5.7 s: one core |

At the base the eight files took 89.5 s together, one at a time, on a debug build at a one-minute load of 52 to 88
(`BASE-FAILURE.txt`). On the change the short-lived cores are more (37 against 12) and the 21 packs are checked three
times (the first core of `ac1-second-core`, the hub's core, and the core that fills `ac6-first-reply`'s store): at
the base a debug core checked them in 9 to 11 s and paged the 19 pages of its listing in a little over 2 s, and a core
given a test pack answered in 0.2 s. So the suite should end within a few minutes there at such a load; no file was
run on the change. A core's answer has 12 minutes and a file 18, inside the
20 the proof lanes give a file; past either the test ends `INCONCLUSIVE`, naming the answer it waited for. Temporary
folders are `/tmp/dh3611-*` (a hub's socket path must fit in 104 bytes), each removed by its test; every process is
stopped by its PID (a core, the hub, `deep mcp`, the process that is not the hub). The hub runs with `HOME` in such a
folder, so the real `~/.deepbuild` is never touched. Nothing uses the network.

## The surface under test

**The canvas core**, `deep-show canvas`: one JSON line in, one answer line out, as `packages/hub/src/canvas.ts` sends
them. A test sends the world the hub's `shape` builds with no session and no document, then calls:

```json
{"world": {"evidence": "<root>/evidence", "sessions": {}, "record": {}, "panels": {"main": {"rect": [0, 0, 800, 600]}}, "docs": {},
           "packs": [{"id": "test/kept3611whole", "dir": "<folder>"}],
           "pack_checks": {"dir": "<root>/packs/checked", "key": "<64 hex digits>"}}}
{"call": {"call": "packs"}}
{"call": {"call": "fingerprint"}}
{"call": {"call": "deep_kinds", "op": "list"}}
```

In these files the test stands where the hub stands. It makes the launch key (32 random bytes, made at run time),
keeps it in its own memory, and gives it to each core it starts, in the world's `pack_checks`, on the core's input
pipe. It lays a folder out as a hub's root, `<root>/evidence/` and `<root>/packs/checked/`, and makes both folders
before the first core starts. Every core of one test gets the same store, key and evidence store, as the cores of one
hub launch do. No hub runs in between: a hub adds nothing these criteria read, and it can't give a core a test pack's
changed bytes or a row the test wrote. `ac4-hub` is the one file with a real hub.

**From the design step**, read exactly as it names them:

- `pack_checks: {dir, key}` in the world: the store's folder and the launch key in hex.
- The store: one file per pack version in `dir`, named by the SHA-256 of `owner/name@version` in hex, with `.json`.
- A file: two lines, the row as one line of JSON, then its mark: the HMAC-SHA-256, in hex, of the first line's bytes
  (what comes before the first line end) under the launch key's 32 bytes. The tests read the hex in either case and
  write it in the case the core wrote. A line end after the mark is kept as the core wrote it.
- The row's members the tests read: `pack` (`owner/name`) and `version`, as a `packs` row holds them; `digest`, a string;
  `requires`, an object whose key `owner/name@version` holds the digest that version's own row holds; `build`, equal to
  the `fingerprint` call's `fingerprint.build`; `outcome`, `installed` or `refused`; `issues`, a list; `left`; and
  `left_sha256`, 64 hex digits. They are top-level members of the first line's one object: a test changes `build`,
  `left_sha256`, `outcome` or `issues` in place and leaves every other byte of the line as the core wrote it.
- The `packs` call: a row's `checks` is 0 for a result this core took from the store and 1 for a check it ran. A row
  holds what the base's holds (`pack`, `version`, `state`, `checks`, `issues`, `layouts`, `named_by`), and the tests
  read the first six.

**Names that are this suite's own**, which the implementer provides as the tests spell them:

| Name | What it is | Example |
|---|---|---|
| `counts` beside `packs` | The design step gives the `packs` call `counts: {kits, fields, rewrites, runs, compiles}` and doesn't say where. The tests read it as a member of the call's reply, beside `packs`: five whole numbers, what this process's pack checks have run since it started | `{"packs": [{"pack": "test/kept3611whole", "version": "1.0.0", "state": "installed", "checks": 0, "issues": [], "layouts": [], "named_by": 0}], "counts": {"kits": 0, "fields": 0, "rewrites": 0, "runs": 0, "compiles": 0}}` |
| `takes_row_of_another_digest`, `takes_row_of_another_build`, `admits_on_unreadable_row` | The three planted cores, each a value of a world's `planted` (The planted cores) | `{"world": {…, "planted": "takes_row_of_another_digest"}}` |
| `targets.first_reply_ms` | The issue's 500 ms in the budget task that names criterion 6 (What the implementer adds) | `"targets": {"first_reply_ms": 500}` |

Nothing else is invented. `esc_to_root` (below) is a wrong program the base already has.

### The planted cores

Each is one of the core's wrong programs, named by a world's `planted` as the base's are (`crates/deep-show/src/main.rs`
`scenario`, which reads a world's and a scenario's alike): data on the core's input, never an environment variable, a
build feature or a twin folder, so none needs a build of its own and `twins.json` is `{}`. A test of a planted core
runs its criterion's whole sequence with every core started on a world that plants it, the core that fills the store
too, and the same judge must fail. A core that doesn't take such a world fails that test at its first line, naming the
planted core; so the three fail on the merge base, which knows none of them.

A planted core is a wrong program like any other to the rule that binds a row to `planted`: its rows name it, and it
takes only rows that do. Past the one fault below, each does exactly what the shipped core does.

| `planted` | Exactly what it does | Fails |
|---|---|---|
| `takes_row_of_another_digest` | Before it takes a row, it doesn't compare the row's `digest` with the digest of the pack as it read it from the folder. So a row whose mark verifies and whose `requires`, `build`, `planted`, `left_sha256` and evidence hold is taken though the pack's bytes changed: the version reads with the row's outcome, issues and layouts, `checks` 0, no part of its check runs, and the file stays as it is. It still works out each pack's digest from the bytes read: it holds a version at that digest when it compares the `requires` of a version that requires it, and writes that digest in the row of a check it runs | `ac2-changed` (2): the changed pack reads installed with `checks` 0 where its changed bytes are refused; the failure names `test/kept3611changed@1.0.0` and that the row is of another digest |
| `takes_row_of_another_build` | Before it takes a row, it doesn't compare the row's `build` with this build's source digest. Every other comparison stays | `ac2-changed` (3): the pack whose row names another build reads `checks` 0; the failure names `test/kept3611built@1.0.0`, "another build" and both digests |
| `admits_on_unreadable_row` | When a version's file is there and its bytes can't be read as text (the read fails, or the bytes aren't UTF-8), it admits the version as installed with no issues and no layouts, runs no part of its check (`checks` 0, `counts` unmoved) and leaves the file as it is. With no file, or a file that reads as text whatever it holds, it does what the shipped core does | `ac3-damaged` (2): the pack whose file can't be read reads installed with `checks` 0; the failure names `test/kept3611unreadable@1.0.0` and that its row can't be read |

### The process that is not the hub

`forger.mjs` is criterion 4's "process that is not the hub", writing "as an agent's child would". It is a command of its
own, `node forger.mjs <root> '<rows to write>'`, started by the test with the root and the rows as its only arguments,
`PATH` as its whole environment and its input closed. It runs as you, so it reads and writes every file under the
hub's root. Neither the hub nor a core started it, so it holds nothing they hold in memory.

- **What it knows.** What is public: the design step's words on where a row lives and what a file holds, and each
  pack's `owner/name@version`. And what any process running as you can read: every file under the root, the hub's own
  rows among them, with each row's digest, required digests, build, planted programs, `left` and `left_sha256`. It
  doesn't know the launch key.
- **What it does first.** It looks for the key: it reads every file under the root (links not followed, a file past
  256 MB counted and left) and tries, as the key, everything that reads as 32 bytes: a file of 32 bytes; 64 hex digits
  (each window of a run of up to 128), as the bytes they spell and as their own text; a base64 word of 43 or 44
  characters; a JSON list of 32 numbers under 256. A key is found when it makes the mark of the shortest row.
- **What it writes.** With a key it found, rows marked with it. With none, a key of its own, and:
  - for `open`, a version its own check refuses: the hub's row with `outcome` changed to `installed` and `issues` to
    `[]`, every other member as the hub wrote it (so its digest, required digests, build, planted programs and kept
    hash all hold), under a mark made with the forger's key;
  - for `shut`, a version whose check passes: the hub's row with `outcome` changed to `refused`, and the hub's own mark
    left on it.
- **Why a core that took its row would be wrong.** `open` would read installed: a version that never passed its check,
  admitted on the word of a file any command's child can write, which is an agent's word taken as a check's result
  (invariants 1 and 3; the threat rows Agents gaming checks and What a command's children do). `shut` would read
  refused: a command's child would have switched a pack off for every agent of the hub.

In `ac4-beside` the test is the hub and wrote its key nowhere, so the forger finds none, unless a core wrote the key
it was given to a file under the root, which fails the test, naming the file. In `ac4-hub` the root is a real hub's,
and the forger only looks: a hub that keeps its launch key in a file there fails, naming the file.

## Criteria to tests

IDs are `criterionId` of `scripts/proof-change.mjs` (the first 8 hex digits of the SHA-256 of each criterion's text,
trimmed, white space collapsed), checked against the issue's body. Each test's name starts with `AC<n> #3611.<id>`.
Every test of criteria 1 to 5 fails on the merge base at an assertion of this suite's.

| Criterion | Test | What it holds | A wrong program it fails on, and what the failure names |
|---|---|---|---|
| AC1 `#3611.d8311031` | `ac1-second-core` (1) | The first core, on an empty store with every shipped pack: `counts` holds five whole numbers, each 1 or more; each row's `checks` is 1; a file for each version is in the store. The second, on that store: each count is 0 at its first reply (`packs`, its first call) and after its listing; each row's `checks` is 0; its rows equal the first's but for `checks`; every page of its `deep_kinds list` equals the first's; no file of the store was written again | The work, with a core that writes each row and takes none: the second core's count of kits, and each pack whose check ran again. The merge base: no `counts`, no file |
| AC2 `#3611.8b256396` | `ac2-changed` (1) | After the first core: each file as the design step says, `build` this build's, the requiring pack's `requires` naming the required version at its own row's digest. Then a pack's bytes change (to bytes its check refuses), a required version's bytes change, and a row is rewritten as of another build: the next core runs all four checks (`checks` 1), the changed pack reads refused, the files are replaced, and the core after takes all four (`checks` 0). A core with `esc_to_root` planted runs all four again; so does a core without it on that core's rows; the core after takes all four | The work, with a row not bound to the digests of the versions it requires: `test/kept3611requiring@1.0.0`, and that `test/kept3611required@1.0.0`, which it requires, is at another digest |
| | `ac2-changed` (2), (3) | The same sequence and judge under `takes_row_of_another_digest` and under `takes_row_of_another_build` | The two planted cores: the pack, and that its digest, or its build, differed |
| AC3 `#3611.ce0f9025` | `ac3-damaged` (1) | Five rows damaged, each its own way (removed; unreadable; cut short inside the row; cut short before the mark; `left_sha256` another hash, under a mark that verifies): the next core runs each check (`checks` 1), takes the whole row beside them (`checks` 0), and the core after takes all six | The work, with a core that doesn't compare the kept hash: `test/kept3611hash@1.0.0`, and that it read as installed without its check |
| | `ac3-damaged` (2) | The same under `admits_on_unreadable_row` | The planted core: `test/kept3611unreadable@1.0.0`, whose row can't be read |
| | `ac3-damaged` (3) | One shipped pack whose check keeps a library's bytes in the evidence store: a second core given that store takes its row; a third given an empty evidence store runs its check | The work, with a core that doesn't look for what `left` kept: the pack, and that its evidence is gone |
| AC4 `#3611.f11db91d` | `ac4-beside` (1) | After the forger wrote its two rows: `open` reads refused with its check's issues, `checks` 1; `shut` reads installed, `checks` 1; `kept`, untouched, `checks` 0; the forger found no key under the root | The work, with a core that verifies no mark: `test/kept3611open@1.0.0`, read installed on a row a process that is not the hub wrote, where its own check refuses it |
| | `ac4-hub` (1) | A real hub, after its core answered the first call that needs the release's packs: `<home>/.deepbuild/packs/checked/` holds, for each shipped version, a two-line file whose row names the pack and version and whose mark is 64 hex digits; and no file under the hub's root holds a key that makes a row's mark | The work, with a hub that writes its launch key to a file under its root: the file. The work, with a hub that gives its core no `pack_checks`: the versions with no row |
| AC5 `#3611.55062395` | `ac5-refused` (1) | Three packs refused by their check, with issues. The second core takes all three (`checks` 0), refused with the same issues. Then one's bytes change to bytes that pass, and one's row is rewritten as of another build: the third core checks those two (the first now installed, the second refused with the same issues) and not the untouched one; the fourth takes all three | The work, with a core that keeps no row for a refusal: `test/kept3611stays@1.0.0`, checked again by the second core |
| AC6 `#3611.3b726ffd` | `ac6-task` (1) | A task of `benchmarks/budgets.json` names this criterion, holds `targets.first_reply_ms: 500`, `margin: 0.5` and #3611 in its `initialReason`, and the file passes the lane's validator against the merge base's | The work without the task: the criterion's ID |
| | `ac6-first-reply` (1) | On a filled store, five fresh cores after a warm-up: each ran no part of a pack check; on a release build on a reference Mac at rest, each first reply within 500 ms by the lane's `judgeLimit`; anywhere else, or on a dev build, `INCONCLUSIVE` with the times, loads and memory | The work, with a core that checks again on a filled store: how much the timed core ran. The merge base: no check's result kept |

## Readings where the issue and the design leave a choice

- **"The shipped packs"** are read at test time: each folder of the checkout's `packs/` that holds a `pack.json`, in
  order, offered as `{id: "deepbuild/<name>", dir: <that folder>}`, the owner the hub reads them under (`readPack`). 21
  at the base. A pack added later is held to the same criterion.
- **"A second fresh canvas core … started on a store the first filled"** is a second process given the first's world:
  the same packs, store, launch key and evidence store, as two cores of one hub launch have. Both criterion 1 and the
  design step need the three: a row counts only under the launch key that marked it and while the evidence its check
  kept is there.
- **"Its first call"** is `packs`, the call that carries the counts. The counts are read again after the listing, where
  they must still be 0: a core that puts its checks off until something is asked has not taken their results.
- **"Its own count … is 0"** says nothing unless the count can move, so the first core's count of each of the five
  must be 1 or more. The release's packs make each move: #3531's table has compiles, rewrites, fixture runs, field
  checks and the kind kit all above 0.
- **"Equal the first core's but for the count of checks run"**: the `packs` rows compared with `checks` taken out of
  each, in the first core's order; the listing compared page by page, whole. `counts` is a count of checks run and is
  not compared.
- **No file written again** (criterion 1): a core writes a row for a check it ran (the design step's Cost: "one small
  file written per check"), so a second core that ran none leaves each file's bytes, inode and modification time as
  they were. It is a second witness to the core's own count, from outside the core.
- **"A build of other sources"** is tested without a second build of `deep-show`: the test, which holds the launch
  key as the hub does, rewrites a row as such a build would have left it under this launch: the same row, its `build`
  another digest, marked with the launch key. That is the row a core finds when the hub's checkout was built again
  while the hub ran (the hub starts the newer of its builds). Nothing but `build` is wrong with it, so only a core
  that compares `build` runs the check. `ac5-refused` uses the same row for a refusal.
- **"A planted build"** is a core started with a wrong program planted, any one: the test plants `esc_to_root`, which
  the base has and which touches nothing a pack's check reads. Both ways: that core runs the checks again on rows a core
  without it wrote, and a core without it runs them again on that core's rows.
- **"Replace the row"** is held by what follows: the next fresh core takes the row (`checks` 0) with the state the
  check just gave, and for the two cases a file can show, the file names the new digest, or this build with a mark that
  verifies. That a row is written under another name and renamed is not read.
- **"A pack whose bytes changed under the same folder"** changes to bytes its own check refuses, so a core that took
  the row of the other digest reads `installed` for bytes that are refused: the wrong verdict, not only a wrong count.
- **"Unreadable"** is a file whose bytes are no text (each byte `0xff`) under mode `000`. To a process that isn't root
  the read fails; to root, whom a mode doesn't hold, the bytes still are no row. The planted core's test is
  `INCONCLUSIVE` as root.
- **"Cut short"** is two files: one cut inside its first line, and one cut before its mark with its first line whole,
  which is the cut a lenient reader takes. Cutting one byte is not used: where a file ends in a line end, that leaves
  two whole lines.
- **"Whose kept hash doesn't match"** is the row's `left_sha256` changed to another hash, under a mark made with the
  launch key, so the mark verifies and only the kept hash is wrong.
- **"Never reads as installed"**: none of the damaged rows gives `installed` with `checks` 0. Each pack passes its
  check, so each reads installed after its check ran, with `checks` 1.
- **Evidence the check kept that is gone** is in the issue's Scope and the design step and in no criterion. Its test
  is tagged with criterion 3, the closest: a row that can't be taken as it stands runs the check. "Gone" is an empty
  evidence store given to the next core. If that core takes the row and its store lacks nothing the first has, the
  pack's check kept nothing there and the test is `BLOCKED`.
- **Criterion 4, twice.** `ac4-beside` holds "is not taken: the check runs" on the core, with the hub's own untouched
  row taken beside the two, so the merge base, which takes no row, fails it. `ac4-hub` holds what only a real hub can
  show: that the mark's key is in the hub's memory and in no file an agent's child can read.
- **Criterion 5's "only"** is held within one launch: the untouched refusal is not checked again by any of three later
  cores, and the two whose digest or build changed are. See The design step and the criteria, below.
- **Criterion 6** is a budget, held as the design and #161's suite hold one. A budget criterion that says "in the
  local preflight" is met by the budget window's record once a task of `benchmarks/budgets.json` names it
  (`docs/parallel-proof.md`, 12a); the window compares the task's time and memory with the merge base's at the task's
  margin, 20 samples a side. So `ac6-task` asks for the task, and "compared with the merge base" and "within its
  margin" are the window's. `ac6-first-reply` takes the suite's own reading by the design's rule for a timing result:
  five runs after a warm-up, each a fresh process, judged by `scripts/benchmark.mjs` `judgeLimit` with the load at each
  run's start and end; a result only on a reference Mac on mains power, Low Power Mode off, thermal state nominal, at
  a load within the cores, and only of a release build ("none timing a debug build"; #3531: "a reading from a dev
  build … is a reading, never the result"). Anything else is `INCONCLUSIVE` with every reading in the message, never a
  pass, and never a fail for the time. It waits for no quiet machine.
- **The build timed** is `target/release/deep-show` when the checkout holds one whose source digest is that of the
  build the suite drives, else that build, as a dev build. The suite builds no release binary: build one first for a
  result that counts.
- **A first reply's time** runs from the core's start to the answer to `packs`, the world and the call both written at
  once. **Its memory after that reply** is the core's physical footprint (`benchmarks/process-reader.mjs`), as #2694
  reads memory; where it can't be read it is missing, never 0.
- **Who makes the store's folder** is not said. The tests that stand as the hub make it before the first core starts.

## The design step and the criteria

- **Criterion 5 is narrower than the design step.** "A refused version … is checked again only when its digest or
  the build changes"; the design step also checks it again under a new launch key ("A hub started again makes a new
  key: its first core checks each version once and replaces the rows"), on a planted core's row, when a version it
  requires is at another digest, and when evidence its check kept is gone. The test holds the criterion's two causes
  and that nothing else in one launch checks an untouched refusal again; it asserts nothing across launch keys.
- **Criterion 1 and "A version that carries a provider keeps no row."** A shipped pack with a provider would have its
  check run by the second core, whose counts would not be 0. No shipped pack carries one at the base, so the two agree
  today. The tests excuse a version with a provider from having a row, and nothing else.
- **No test holds** "It is never … put in an environment variable or an argument, sent over the hub's socket, logged or
  recorded" beyond the files under the hub's root, in the forms the forger tries; "A replaced row is written whole
  under another name and renamed into place"; the Cost line; "keep a compiled program"; or "A core given no
  `pack_checks` … reads no row and writes none", which leaves nothing to read.

## What isn't asserted, because no criterion says so

- Through a real hub: that a second core of one hub takes the first's rows, and that a hub started again checks each
  version once more. Each needs the release's packs checked through a hub again, minutes a time, and a hub answers no
  call that carries a core's counts.
- The first reply's time off its conditions, and any ratio between the two cores' times. The memory against the merge
  base's: the suite has no merge base to read; the budget task has.
- What `left` holds, how `planted` is written in a row, the digest's own form, and a row's `layouts`.
- That a pack taken from the store draws, expands or links as a checked one does, past its rows and the listing
  being equal.
- `install_pack` and `uninstall_pack` calls, and a pack offered to a running core.
- What the issue puts out of this task: a compiled module kept across starts, compiling once a process, cheaper checks.

## What the implementer adds outside this folder

- **The three planted cores**, as The planted cores says, where the core reads a world's `planted`.
- **`scripts/lanes.mjs`**: the timed file. `lane.json` already puts the folder in the alone block.

  ```js
  // #3611's suite times a fresh core's first reply on a filled store, on the reference Mac.
  timed.push('tests/acceptance/3611/ac6-first-reply.test.mjs');
  ```

- **`benchmarks/budgets.json`**: a task that names criterion 6, which `ac6-task` reads. Its id, its command and what
  the command measures are the implementer's, in the form the other tasks take:

  ```json
  {"id": "…", "command": ["node", "benchmarks/….mjs"], "margin": 0.5, "limits": {},
   "targets": {"first_reply_ms": 500}, "criteria": ["#3611.3b726ffd"], "initialReason": "Issue #3611 first measurement: …"}
  ```

- Nothing else. No line of this suite needs an edit elsewhere to run.

## What was run

**Phase 1**, before the base was built: no cargo, no `deep-show` and no hub ran.

- Every file passes `node --check`.
- Each judge of `judge.mjs`, the files of `store.mjs` and the forger's search and writes were run on planted inputs as
  a plain node script: 90 checks, each judge passing a good input and failing each wrong one with a sentence that names
  what its criterion names (the forger finds a key planted in a file in each of its forms, and none where there is none).
- The core-driving files (all but `ac4-hub`) were run against a throwaway stand-in for `deep-show canvas`, a node
  script that modelled the design step over a toy check, given as `DEEP_BIN_DIR`: all pass on it but
  `ac6-first-reply`, which reads `INCONCLUSIVE` as a dev build's, and `ac6-task`, which fails with no task. With one
  fault planted in the stand-in at a time, the tagged test failed naming the pack: a core that takes no row, verifies
  no mark, compares no kept hash, no required digest, no build, no planted programs, looks for no evidence, keeps no
  refusal, takes a refusal without its issues, writes a row it took again, counts nothing, lists a taken pack
  otherwise, or writes its key to a file. A stand-in that knows no store and no planted core, as the merge base, failed
  every test at its assertion. The stand-in was deleted; it is no part of the suite, and it is the only place a test
  of this suite was seen to pass.

**Phase 2**, at the base, on the caller's debug build of `deep-show` and `deep-hook` (`BASE-FAILURE.txt` has every
run and reading):

- Probes first, each a node script driving the base's core through `core.mjs`, or its hub through `hub.mjs`. What
  phase 1 had only read from the base's code held on its program: a test pack installs; with its input's default 0 it
  is refused with one `out_of_range` issue; a pack that lists another in `requires.packs` and uses nothing of it
  installs; bytes changed under the same folder are read by the next fresh core; a world that plants `esc_to_root` is
  taken and its rows are a shipped core's; `fingerprint` answers in canvas mode; the shipped library pack's check puts
  10 objects in an evidence store a core with no pack leaves empty; the listing with the 21 packs is 19 pages; two
  fresh cores give the same listing, page for page, and the same rows; the hub starts and answers `deep_kinds list`
  through a `deep mcp` started by hand within the 55 s that gives a call; and the forger's search of a real hub's root
  (310 files) takes a tenth of a second, finds no key there, and finds one the probe wrote into a file there.
- No probe showed a fixture or a helper to be wrong: no test file, helper or judge changed after phase 1. This README
  and `BASE-FAILURE.txt` are what phase 2 wrote.
- Each file ran once, one at a time, by its own command above. The machine's throttle was asked once and gave no grant
  in its five minutes, so the files ran directly. All twelve tests fail at the base, each at an assertion of this
  suite's, none at load and none `BLOCKED` or `INCONCLUSIVE`: the ten of criteria 1 to 5 because the base keeps and
  takes no check's result (the three planted cores' because the base has no such core), the two of criterion 6
  because it has no budget task and no filled store. No run compiled a workspace crate.
- Not run, since the base fails before them: any test's steps past its first failing assertion; the three planted
  cores against the judges; `ac6-first-reply`'s timing, its memory reader and its choice of a release build;
  `ac6-task`'s two `git` commands (its validator step was probed on the base's own file with the example task above
  added, and answered `valid`).

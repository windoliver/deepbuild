# Acceptance tests for #2696: built files hold no character above U+00FF

Written before any implementation, by a job that saw only the issue, the design and the base commit
`3c500c0c8f9b43172d733decddd04705f73317b6`. It read no branch, pull request or other session's work for this issue.

## What I read

- Issue #2696, and what it links: the sixth question of #2664 by the issue's own words, and
  `reports/package-story-memory-2026-11-13.md` (Measured; Found and not applied, 1).
- `AGENTS.md` (Proof) and `docs/technical-design.md`: How it installs, Numbers version 0 has to hold, How we know
  version 0 works (Dogfooding; tests written first), What done means, fixed at the start.
- The base commit, for the surfaces: each package's `build` script and what it reads outside its folder;
  `scripts/lanes.mjs` (`checks`, the lint lane's commands, `lane.json`, how `node --test` and vitest files are picked);
  `scripts/proof-runs.mjs`, `scripts/proof-change.mjs` and `scripts/proof-binaries.mjs` (the before lane's copies,
  `criterionId`, at-assertion, the hub's programs in a copy's `target/debug/`);
  `packages/hub/test/startup-memory.test.ts` and `packages/hub/test/hub.ts`; `packages/hub/src/settle.ts` and the
  built `packages/hub/dist/paths.js` and `core.js` (how a hub finds deep-hook; where the core throws);
  `tests/acceptance/16/budgets.test.ts` and `helpers.ts` (AC12's 30-day record and its start); and the suites of
  #3065, #2651, #2403 and #1873 for form.

## Setup

- Node 24.22, `npm ci`, `npm run build --workspaces`. The heap test also needs a `deep-hook` under `target/release/`
  or `target/debug/` (`cargo build -p deep-hook`): a hub of a checkout starts with nothing else. The lanes put one in
  each copy for a test that names the hub, which `base.test.mjs` does.
- `git` with the merge base's objects and the ref `origin/main`. No network, no model, no GPU.
- Run each file alone, as the lanes do: `node --test tests/acceptance/2696/<file>`. `lane.json` says the folder runs
  beside nothing else.

## The files

| File | What it is |
|---|---|
| `base.test.mjs` | This build against the merge base's: AC1, AC2, AC3 (two tests), AC4 |
| `newfile.test.mjs` | A new source file built in a scratch copy: AC5, and AC2's raw template |
| `lint.test.mjs` | The lint lane's commands on a planted unescaped built file: AC5 |
| `helpers.mjs` | Built files and their characters, the two trees, messages as the engine reads them, the record, a hub's heap |
| `load.mjs` | A child: loads every entry of every package of a tree and writes the strings it exports |
| `heap-preload.mjs` | A preload: the thread that loads the hub's core collects twice and writes its heap |
| `lane.json` | The folder runs alone |
| `BASE-FAILURE.txt` | The suite's output on the base build |

## Surfaces, and what I assumed where the issue is silent

1. **A built file** is every regular file under `packages/<package>/dist`, at any depth. Its **characters** are
   those of its bytes read as UTF-8; a file whose bytes are no UTF-8 text is a compiled program and is left out
   (`packages/hub/dist/deep-confirm` and `packages/supervisor/dist/helper` on the base). So `.d.ts`, `.json` and
   `.tsbuildinfo` files count: the criterion says "no built file". On the base 78 of 534 text files hold such a
   character: 71 `.js`, 6 `.d.ts`, 1 `.json`. An astral character counts as one character above U+00FF.
2. **The build** is `npm run build --workspaces` at the root. The tests read the checkout as it is built and never
   build it: the lanes build each copy before the tests run, and a test's own build would rewrite `dist`.
3. **The merge base's build.** `git merge-base HEAD origin/main`, which is HEAD itself on a checkout that sits on main
   and the same commit in both of the before lane's copies (each has a `.git` with every ref). `helpers.mjs` (`trees`)
   takes that commit's root entries but `tests`, `docs` and `reports` with `git archive` into a scratch folder, gives
   it a `node_modules` whose entries link to this checkout's installed packages (its own workspace packages by their
   relative links), and runs `npm run build --workspaces` there. It installs nothing: the issue says no dependency is
   added, so both builds have the same packages. Beside it lies `head`, a copy of this checkout as it stands, builds
   included, laid out the same way: same folder, names of one length, same `node_modules`, the same `deep-hook`, no
   `.git`. Everything that runs a module of one build runs the other from its twin tree, so only the built files
   differ. On the base the two trees' built files were byte for byte the same but `packages/contracts/dist/.tsbuildinfo`.
   The merge base is built once, in `base.test.mjs`, on first use, and removed when the file ends. The lanes run each
   `.mjs` file in a process of its own, so every test that needs it is in that one file.
4. **A message** (AC2) is every string a built `.js` or `.mjs` file writes that holds a character above U+00FF: a
   string literal's value, a template's cooked pieces, a tagged template's cooked and raw pieces, and a name (the
   base has four property names in Chinese). Each is read by the engine from the literal's own text
   (`vm`), so an escape counts as what it means; TypeScript's parser only finds the literals. The built files of both
   builds are compared file by file, message by message, in order. A `.json` file with such a character is compared
   by its parsed value. That is how "compares every message that holds such a character" is read: the base's 104
   messages sit inside functions, and no package entry exports one (0 exported strings with such a character on the
   base), so comparing exports alone would compare nothing. "Loads both builds of each package" is `load.mjs` on each
   tree: every entry a `package.json` names in `exports` or `main` is imported, and every string it exports (to any
   depth, no function called, no getter read) and everything printed while loading is compared. "Prints" is also
   `deep --help` from each build, compared whole.
5. **The raw template** (AC2's wrong program). The base's built files hold no tagged template with such a character,
   so a step that escapes inside a raw template changes nothing in today's `dist`, and `base.test.mjs` cannot see it.
   `newfile.test.mjs` gives the build one: its new source file exports ``String.raw`C:\new\table “raw”… \u0041` ``, and the
   test compares the built module's value with the written one.
6. **An error thrown from `packages/hub/dist/core.js`** (AC3): `Core.prototype.testClock.call({}, params)` in a child,
   with no hub. With no parameter the engine raises a TypeError on the line that reads it (2786 on the base); with
   `{ advance_ms: -1 }` the core's own `throw refuse(…)` runs (2788). The line is the first frame of the stack in
   `packages/hub/dist/core.js`. The test asserts the lines equal the merge base's, never a number, and is BLOCKED if
   the base's lines do not come after the core's first character above U+00FF. Columns are not compared.
7. **A file's number of lines** is one more than its line feeds. Every text file the merge base builds must be built
   by this build with the same number; a file only this build has is not counted against it.
8. **#16's 30-day record** is AC12's `seedHistory` (`tests/acceptance/16/budgets.test.ts`, not exported there, so
   copied): 30 days, 20 sessions a day of ten turns, 90,600 events, written through this checkout's built record
   package into one root. Each hub starts on its own copy of that root.
9. **The core thread's heap, read as `startup-memory.test.ts` reads.** At the base that file reads no heap of the core
   thread; the Nov 13 report gives the number (23.4 MB a side, one run) and not its program. So the reading is put
   together from that file's own means: a preload through `NODE_OPTIONS=--import` whose load hook names the thread
   that loads `packages/hub/dist/core.js` (its first test), and a heap written whole under its name by a rename (its
   `idleHeap`). The preload's thread waits for the test's word, makes two full collections
   (`gc({ type: 'major', execution: 'sync' })` twice, `gc` got as `settle.ts` gets it) and writes
   `process.memoryUsage()`; the number is `heapUsed`, which in a worker is that thread's own heap. The word comes 15 s
   after the hub's ready line, the wait #16 AC12 and the report use before they call a hub idle.
   **Fairness:** one machine, one run, one record; `deep hub run` from each tree in turn (base, this build, five
   times), each on a fresh home; the medians are compared. Readings on the base lay within 90 KB of each other but
   one, 1.4 MB low, taken at load 200: hence five a side and the median, never one reading or a mean.
   **1.2 MB** is read as 1.2 × 2^20 bytes, as that file counts MB.
10. **The lint lane** is the entry named `lint` in `checks` of `scripts/lanes.mjs`. Its node commands run as the lane
    starts them (from the checkout's root, in order), without the lane's throttle, lease and evidence record, which
    would write a record for a tree that holds a plant. `cargo fmt` and `cargo clippy` are left out: they read Rust
    sources and no package's `dist`. **Fails, naming it:** some command exits non-zero and a line of its output holds
    the planted file's path; by the issue's Scope ("naming the file and the line"), such a line also holds the line's
    number, 23, as a number of its own. Many of the lane's commands fail on main on this Mac for other reasons, so an
    exit code alone is never read.
11. **The planted unescaped built file** is `packages/verdicts/dist/planted-2696-unescaped.js` in this checkout: what a
    build with no escaping step leaves. It is in the checkout because the lint reads the checkout it sits in, and I
    do not know its script's name or how it finds its root. The test removes it in a `finally`, in the file's `after`
    and at the process's exit; nothing else in the checkout changes, and no tracked file is touched.
12. **The new source file** is `packages/verdicts/src/planted2696.ts` in a scratch copy of this checkout
    (`copyCheckout`), never in the checkout. It is built there by `npm run build --workspace packages/verdicts`, the
    script `npm run build --workspaces` runs for that package: the issue puts the step at the end of each package's
    build. `verdicts` is a package built by `tsc -p tsconfig.json` alone. The source's `.js` and `.d.ts` are both read.

## The tests

| Criterion | Test | On the base |
|---|---|---|
| AC1 `#2696.5a61170b` | `base.test.mjs`: no built file under `packages/*/dist` holds a character above U+00FF; BLOCKED unless 53 or more do on the merge base | **fails at its assertion**, naming the count, the base's count and the first file and line |
| AC2 `#2696.6fbf771a` | `base.test.mjs`: every message with such a character reads the same in both builds; each package's entries load, export and print the same; `deep --help` prints the same | passes: a **guard** |
| AC2 `#2696.6fbf771a` | `newfile.test.mjs`: the new file's four strings, a raw template among them, read as written once built | passes: a **guard** |
| AC3 `#2696.534150b4` | `base.test.mjs`: each text file the merge base builds has the same number of lines in this build | passes: a **guard** |
| AC3 `#2696.534150b4` | `base.test.mjs`: the two errors thrown from the core name the lines they name on the merge base | passes: a **guard** |
| AC4 `#2696.be4d3304` | `base.test.mjs`: the core thread's heap, median of five, is at least 1.2 MB under the merge base's | **fails at its assertion**, with every reading |
| AC5 `#2696.ced33c08` | `newfile.test.mjs`: the new source file's built files hold no character above U+00FF | **fails at its assertion**, naming each file, line and character |
| AC5 `#2696.ced33c08` | `lint.test.mjs`: a lint-lane command fails naming the planted built file, and its line | **fails at its assertion**, listing each command's exit |

### The guards, and the wrong program each needs

A guard passes on the merge base by its nature: the base's build is compared with itself. Each needs a planted wrong
program to show it can fail. I wrote none: a twin replaces the step, which does not exist yet.

- **AC2, the new file's strings** (`newfile.test.mjs`): the issue's own plant, a step that escapes inside a raw
  template. `raw` then reads `C:\new\table \u201Craw\u201D\u2026 \u0041` where `“raw”…` was written, and the test names it.
- **AC2, every message** (`base.test.mjs`): the raw-template plant cannot fail it (surface 5). It needs a step that
  changes a message of today's build: one that writes a wrong escape, such as `\u2025` for `…`, or one that escapes
  the backslash too. The test then names the file, the line and both readings of the string.
- **AC3, both tests**: a step that changes a file's lines, such as one that writes a line of its own at the head of
  each file it rewrites, or drops the last line feed. The line counts differ, and the core's errors come from 2787
  and 2789.

The issue's second plant, a build that leaves a file unescaped, is AC5's: `lint.test.mjs` plants that build's output
itself, and AC1 and AC5's first test fail on such a build with no plant, as they do on the merge base.

## What a run leaves

Nothing. Scratch folders under the system's temp folder and `/tmp` (homes need short paths for sockets) are removed
in each file's `after`. Hubs and other children are stopped by PID. The checkout's tracked files and `packages/*/dist`
are as they were once `lint.test.mjs` has removed its one file.

## Left open by the issue, and not guessed

- **The step's script, its name and where it is called from.** No test names one. The tests reach it only through
  `npm run build --workspaces`' per-package build and through the lint lane's command list.
- **The escape's spelling** (`\u2026`, `\u{2026}`, a surrogate pair for an astral character, an entity in JSON). The
  tests read values, never spellings.
- **What the step does to a raw template** (leave the build failing, or write `${'\u2026'}`). Only the value is
  asserted. `base.test.mjs` compares tagged templates piece by piece, so a step that splits one would differ there;
  the base has none with such a character.
- **Regular expressions.** 14 of the base's built literals with such a character are regular expressions. A pattern
  is no string a module exports or prints, and its `source` changes when its text does, so no test compares them.
  A step that changes what one matches is caught by nothing here.
- **`.d.ts` files and comments.** They count as built files for AC1 and AC5 (surface 1). Their text is not compared
  for AC2: a declaration is not loaded and a comment is no message.
- **The lint's message.** Only that a failing command's output line holds the path, and the number 23. Which command,
  its wording and the form of `file:line` are open.
- **"Line starts are unchanged"** (Scope) is asserted only as AC3 states it: line counts, and the line of two errors.
- **1.2 MB** as 1.2 × 2^20 bytes (surface 9); 1.2 × 10^6 would be the looser reading.
- **Which heap number.** `heapUsed` of `process.memoryUsage()` in the core's thread. The report's 1,455 KB is the
  sources' own size; the criterion's 1.2 MB leaves room for the rest.

## Untestable as written

- **"Read as `packages/hub/test/startup-memory.test.ts` reads it."** At the base commit that file has no reading of the
  core thread's heap after two full collections, so there is no program to follow exactly. Surface 9 is the nearest
  reading built from what the file does have. If main gains such a reading, this test should take it.
- **"Every string a built module exports or prints."** No test can call every function of every module, and no entry
  exports a string with such a character. The messages are compared where they are written instead (surface 4).

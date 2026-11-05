# Acceptance tests for #1017: shared build products, cloned copy-on-write and keyed by their inputs

Written first, blind, by a job that never saw an implementation of #1017; none existed. The implementing agent doesn't
edit these files (AGENTS.md, Proof); a dispute goes to a blind redraft of this job (design: Dogfooding).

What was read:

- Issue #1017 as of 2026-11-04T22:34:23Z: Scope, Fields (`environment.products[]`), the eight acceptance criteria,
  Proof and Depends on (#31, #236, #237, #304, #1015).
- `docs/technical-design.md`: Sessions that know about each other (the session map, hard stops, the after-the-call
  comparison for a command whose reach can't be worked out, Load), Lease, Scale later, First-party extensions that ship
  on by default (env-local's start steps, kept installs for the two most recent keys, cache folders cloned
  copy-on-write, never build output; the `done.yaml` example), Threats (Collateral damage, What a command's children
  do, Agents switching off what watches them), and Dogfooding.
- At the base (`79d98cbc`): `packages/env-local/src/index.ts` (`readEnvironment`: `up` or `compose` and `ready.http`
  required, no `products`), `packages/gate/src/checkouts.ts` (#31's checkouts, `cloneIn` with `cp -c`, the
  `links-dependencies` plant), `packages/hub/src/core.ts` (`hookReply` for SessionStart, `projectTrusted` reading
  `~/.claude.json`, the spec checks), `packages/hub/src/server.ts`, `packages/hub/src/heavy.ts` (#1015's `deep lease`,
  merged), `packages/hub/src/guards.ts` and `crates/deep-hook/default-rules.json` (guard names, `(guard <name>)` in
  every deny, `no-deepbuild-home-write`, `no-unknown-reach-delete`), `packages/hub/src/plant.ts`,
  `packages/contracts/schemas/guard@1.json`, `scripts/proof-change.mjs` (criterion IDs), and the suites
  `tests/acceptance/1015`, `31`, `304`, `347`, `18/mapping` and `1097` for format and helpers.

What the base does: no `products` anywhere. The environment reader knows `up`, `compose`, `ports`, `ready`, `host`,
`leases`, `credentials` and `seed`; nothing builds a product, there is no store under `~/.deepbuild/`, and a session
start places nothing, so a new worktree builds everything cold. Only #31's temporary checkouts clone ignored folders
in, from the live worktree. No `product.built` event exists, no guard entry names a store, and the hub refuses a
`DEEP_HUB_PLANT` it doesn't list.

## Run them

```sh
npm ci                            # once, if node_modules is missing
npm run build --workspaces        # every file starts `deep hub run` from packages/cli/dist
cargo build --locked -p deep-hook # the sessions' hooks (the helper builds it if missing)
NO_COLOR=1 node node_modules/vitest/vitest.mjs run tests/acceptance/1017/<file>.test.ts --testTimeout=600000   # one file at a time
node node_modules/typescript/bin/tsc -p tests/acceptance/1017/tsconfig.json
```

Use the repo's Node (`.node-version`, 24.22.0: vitest forks its workers with the Node that runs it, and `NODE` is that one, so the hub runs on it too) on macOS (APFS, `hdiutil`, `diskutil`). Each scenario makes its own
test volume: a sparse APFS disk image under `$TMPDIR/dh1017-img-*`, mounted at `/tmp/dh1017-*/v` (short, so the hub's
socket path fits), and puts the test's `HOME` on it, so the hub's root `~/.deepbuild/`, the product store in it, the
sample repos and every worktree share one volume nothing else writes to. Free space is read off that volume
(statfs, blocks available, after a `sync`). The volume is detached and its image removed after the scenario. Sparse
images hold only what is written; every volume is 40 to 500 GB in name so it has more than the 30 GB floor free.

Nothing needs the network, a model, a sign-in or a real `claude` (a stub lists no plugins). The builds are real and
offline, from the user's own caches: Cargo and rustup through `CARGO_HOME` and `RUSTUP_HOME`, uv through
`UV_CACHE_DIR` and `UV_PYTHON_INSTALL_DIR`, npm from tarballs inside the sample repo; `CARGO_NET_OFFLINE`, `UV_OFFLINE`
and `UV_PYTHON_DOWNLOADS=never` are set, and `RUSTC_WRAPPER` is empty so the user's sccache (in `~/.cargo/config.toml`)
isn't used. These variables reach the hub as they reach every command; the hub's product builds must see them as any
build of the user's does, or the builds fail offline. Every process a test starts (the hub, a `tail -f` holding a file
open) is stopped by its PID, never by name or port.

The scenarios run sessions the way #18's mapping suite scripts them: a made-up Claude Code session whose real
deep-hook calls carry its payloads (`SessionStart`, the prompt, a tool call's `PreToolUse` and `PostToolUse`,
`SessionEnd`). The builds a session's agent would run (`cargo build`, `npm test`, `uv sync`) are run by the test in
the worktree, with the world's environment, not through a hook, so #1015's lease is not in their way.

Rough times at load 50 on the reference Mac: `placement.test.ts` 10 to 30 min (three scenarios, each two cold Cargo
builds of about 150 crates and one of 3), `toolchains.test.ts`, `keys.test.ts`, `stale.test.ts` and `readonly.test.ts`
5 to 20 min, `floor.test.ts` 10 to 30 min (it writes about 3 GB), `budgets.test.ts` 30 to 60 min on a fit machine (it
writes 15.5 GB once) and seconds elsewhere. **`dogfood.test.ts` is the heavy one**: one cold build of this repo, the
hub's build of the entries, and ten worktrees each with its first build, hours, and up to 150 GB written; it runs only
with 150 GB free on the host disk, and reads INCONCLUSIVE otherwise.

### The fixtures

- **Cargo** (AC1, AC4): a workspace of 3 crates, `cart` (serde, serde_json, image), `paths` (regex, toml, chrono;
  `pub const DIR: &str = env!("CARGO_MANIFEST_DIR")`, a test printing it and a `where` binary) and `app` (tokio,
  hyper, rayon, rand, anyhow, and the other two), with `rust-toolchain.toml` naming this repo's channel. Its
  `Cargo.lock` is resolved in the test by `cargo generate-lockfile --offline`, which picks only crates already in
  `~/.cargo/registry`: about 190 packages, about 150 compiled on macOS. The test is BLOCKED if fewer than 120
  dependencies resolve. A cold build takes about 25 s on 12 cores and 0.7 GB.
- **npm** (AC1, AC3): a workspace (`packages/lib`, `@shop/lib`) with one dependency, `dh-pad`, from a tarball in the
  repo (`vendor/dh-pad-<version>.tgz`, made by the test), so `npm ci` needs no registry; `npm test` (`node --test`)
  needs both installed. Its lockfile comes from `npm install --package-lock-only --offline`.
- **uv** (AC2): `pyproject.toml` with lxml, attrs, click, httpx and pygments from the user's uv cache, `.python-version`
  3.13, `uv.lock` from `uv lock --offline`, and a `unittest` test; the `.venv` is about 28 MB in 850 files.
- **No toolchain** (AC5, AC6, AC8): products built by the repo's own scripts (`sh gen.sh`, `sh build.sh`,
  `node gen.mjs`) from a key file, so the size of what they write is set by the test.
- Each sample repo is a main checkout with an `origin` (a bare repo beside it), `origin/HEAD` at `origin/main`;
  worktrees are made by `git worktree add` from `origin/main`, as an agent or its harness makes one. The repos are
  trusted the way the base reads trust: Claude Code's workspace trust in `~/.claude.json`, for the main checkout and
  each worktree, written before its session starts.

## Criteria to tests

Each test's name starts with its criterion's ID and tag (`#1017.<first 8 hex of the SHA-256 of the criterion's
text>`, as `scripts/proof-change.mjs` computes it). Each planted wrong program runs the same scenario and must fail it,
naming what the criterion says.

| ID | File | Tests |
|---|---|---|
| AC1 `#1017.c28516b5` | `placement.test.ts` | the second worktree has `target` and `node_modules` before its first prompt, adds under 5% of the first worktree's disk, its first `cargo build` compiles exactly `app`, `cart`, `paths`, and `npm test` passes; planted `product-symlinks` and `product-hard-links`, each failing on "a build in the second worktree changed the store: <file under ~/.deepbuild/products/>" |
| AC2 `#1017.e992d16d` | `toolchains.test.ts` | the same with `uv.lock` and `.venv`: in place, under 5%, `uv sync --frozen` installs nothing, the tests pass; planted `products-cargo-npm-only`, failing naming `.venv` |
| AC3 `#1017.85ef10d9` | `keys.test.ts` | a worktree whose lockfile names `dh-pad` 1.1.0, while the store keeps 1.0.0's key, gets no `node_modules`, and `npm ci` and `npm test` pass; planted `nearest-key`, failing naming `dh-pad@1.0.0` |
| AC4 `#1017.6173fa31` | `stale.test.ts` | a worktree checked out before the entry, its branch changing `cart`: either its first `cargo build` compiles `cart` and `paths` and `where` prints its own folder, or no `target` is placed and its session start names `target`; planted `places-stale`, failing naming `` `paths` `` |
| AC5 `#1017.653f197c` | `readonly.test.ts` | a Write into a kept product's file and `rm -rf ~/.deepbuild/products` denied naming `(guard no-product-store-write)`; an agent-written script's change to the kept file recorded on its attempt, and the next worktree receiving the rebuilt entry; planted `store-writable`, failing naming `out/stamp` |
| AC6 `#1017.c7fa0b5b` | `floor.test.ts` | at the floor plus 1 GB the next key's entry build waits until both ended worktrees' products are gone, its line naming the 30 GB floor; `wt-a` before `wt-b`; `wt-c`, held open by `tail -f`, keeps its products; no source or edit changes; planted `reclaims-open-worktree`, failing naming `pid <n> (tail)` |
| AC7 `#1017.abb8d808` | `dogfood.test.ts` | ten worktrees of this repo, one after another, under 10% of ten cold builds' disk, each first build compiling only this repo's crates and building its packages with no install |
| AC8 `#1017.15579648` | `budgets.test.ts` | a 15 GB `target` and a 500 MB `node_modules` in place under 2 s from a new worktree's session start, five runs, judged by #1097's rule; the perf lane's task naming #1017, valid against the merge base's `benchmarks/budgets.json`, exits 0 |

### AC1, `placement.test.ts`

The first worktree `wt-1` is made from `origin/main` and built as today (`cargo build --workspace --locked`, `npm ci`)
before any session starts in the repo, with the volume's free space read before it was made and after its builds.
Then a session starts in `wt-1` (SessionStart, a prompt), which is how the hub learns of the repo, and the test waits
for a `product.built` of `target` and of `node_modules` (up to 20 min). Every kept entry is read (each file's size,
modification time and inode). The second worktree `wt-2` is made from `origin/main`, and its session's SessionStart
runs; right after it returns, before the prompt, both folders must be in place, and the free space read before `wt-2`
was made less the free space now must be under 5% of the first worktree's. Then its first `cargo build --workspace
--locked` runs (its log is printed: the Proof), and no file under the kept entries may have changed, appeared or gone,
else the failure names the files. Then the build must succeed and compile exactly the 3 workspace crates (the
`Compiling` lines), and `npm test` must pass with nothing installed first. The planted stores fail at the store
check. (For an exact clone, cargo rebuilds the 3 crates because `wt-2`'s sources are newer than the entry; it
rebuilds no dependency, since a path dependency's hash is relative to the workspace root.)

### AC2, `toolchains.test.ts`

AC1's scenario with the uv sample and the `venv` product (`path: .venv`): `uv sync --frozen` in `wt-1` as today;
`.venv` in place in `wt-2` before its prompt and under 5% of `wt-1`'s disk; its first `uv sync --frozen` must print
no install (`+ name==`, `- name==`, `Installed n packages`), and `uv run --frozen python -m unittest` must pass. The
planted manifest fails at "must have .venv in place", or, if the hub never builds the entry, at the wait for its
`product.built`, which names `venv (.venv)`.

### AC3, `keys.test.ts`

A session in the main checkout; the store builds `node_modules` for the lockfile naming `dh-pad` 1.0.0. A branch
`pad-2` moves `dh-pad` to 1.1.0 (its own tarball and lockfile); `wt-pad` is made on it, and its session starts. If a
`node_modules` was placed, every package in it at a version the worktree's lockfile doesn't name is listed in the
failure (`dh-pad@1.0.0 (the lockfile names 1.1.0)`); then none may be placed. `npm ci` and `npm test` must pass
there, as today.

### AC4, `stale.test.ts`

`wt-old` is made and its branch commits a change to `cart/src/lib.rs`, 2 s before any session, so its files are older
than anything the hub builds after. A session in the main checkout; the store builds `target`. Then `wt-old`'s
session starts. If `target` was placed, its first `cargo build` must compile `cart` and `paths` (else the failure
names each left Fresh), and `target/debug/where` must print `wt-old/paths`, not the store's checkout. If it wasn't
placed, its session start's context must name `target`. Without DeepBuild touching any timestamp, a clone left as it
is reads Fresh (checked by hand on this Mac: both crates stay Fresh and `where` prints the folder the entry was built
in), which is what the planted store does.

### AC5, `readonly.test.ts`

A product with no toolchain, `gen` (`out`, keyed by `gen.lock`, built by `sh gen.sh`, which writes `out/stamp` =
`built`). Once it is kept, a session in `wt-1`: its Write of `<entry>/stamp` must be denied, the reason holding
`(guard no-product-store-write)`; then its Bash `rm -rf <home>/.deepbuild/products` the same (the test never runs it,
whatever the reply). Then the agent writes `tidy.sh`, which finds the kept file only when it runs, makes it writable
and appends `tampered`; the call is allowed and run, and its PostToolUse sent. Within 60 s the record must hold an
event, after that call, whose JSON names the file (absolute, or relative to the store) and the session's ID or the
call's ID. Then, after the next `product.built` of `gen` (waited up to 10 min), a new worktree `wt-2`'s session
starts, and its `out/stamp` must read `built`. If the script couldn't change the file at all, the reading is
INCONCLUSIVE (nothing to find), never PASS.

### AC6, `floor.test.ts`

A product `blob` (`out`, keyed by `blob.lock`) whose build writes 1.3 GB and marks its start and end with its key in a
file the test reads. Once kept, three worktrees `wt-c`, `wt-a`, `wt-b` each receive it at their session's start (else
the test fails before the floor), then each gets 0.2 GB and 1,500 small files of its own build in `out/`, an edited
`README.md` and an untracked `notes.txt`; a `tail -f` holds `wt-c/out/held.log` open; their sessions end in that
order, 1.5 s apart. The volume is held at 31 GB free (the 30 GB floor plus 1 GB). `main` moves to `blob 2` (pushed and
fetched), a worktree `wt-d` is made from it and its session starts: the entry for the new key must be built, and it
can't start without taking the volume under the floor (31 − 1.3 GB). The test reads every 10 ms which worktrees' `out/`
are gone and when the build started (up to 20 min). Asserted in order: `wt-c`'s products never went (the failure
names the holder's PID and `tail`); no tracked, edited or untracked file of the three changed; the build started;
both `wt-a`'s and `wt-b`'s products went before it started (removing only `wt-a`'s leaves 31.2 GB, still too little);
a line names the floor ("floor" and "30 GB") in `wt-d`'s session start, in an event since the trigger, or in
`status.read`; `wt-a`'s went no later than `wt-b`'s; and if both went within one reading, the order reads
INCONCLUSIVE.

### AC7, `dogfood.test.ts`

A bare clone of this checkout (sharing its objects) as `origin`, a clone of it on the test volume, and on its `main`
a commit adding `.deepbuild/done.yaml` with the issue's `target` and `node_modules` products, pushed. One cold build
(`npm ci`, `cargo build --workspace --locked`) in that clone before the hub knows it gives one cold build's disk,
checkout included. A session there; the store builds both (up to 4 h). Then ten worktrees `dog-1` to `dog-10`, made
one after another from `origin/main`, each with its session's start and its first build (`cargo build --workspace
--locked`, `npm run build --workspaces`): each must compile only crates `cargo metadata --no-deps` lists and build the
packages with no install; the ten together, free space before the first less free space after the tenth, must be
under 10% of ten cold builds'. Its log is the Proof's disk use.

### AC8, `budgets.test.ts`

1. On a fit reference Mac only (`environmentProblem()` of #1097's suite: model, mains power, Low Power Mode, thermal
   state, load within the cores) and with 60 GB free on the host; elsewhere INCONCLUSIVE, with nothing built. Products
   `target` (2,000 files of 7.5 MB and 30,000 of 4 KB, 15 GB) and `node_modules` (20,000 files of 25 KB, 500 MB),
   built by `node gen.mjs`. Five new worktrees, each timed from its SessionStart's call until both folders hold every
   file (the session start's return, if they do then); judged against 2 s by #1097's `judge`.
2. `benchmarks/budgets.json` has a task whose `initialReason` or `changeReason` names `#1017`, valid by
   `validateBudgets` against the pinned merge base's file (`79d98cbc`), and its command exits 0.

## Names this suite picks

The issue and the design leave these open; each is the smallest plain choice, and the implementation matches it.

1. **The store** is `~/.deepbuild/products/` (the hub's root, so it follows `HOME`); each kept entry is a folder named
   as its product's `path` (its last part: `target`, `node_modules`, `.venv`, `out`) somewhere under it, holding what
   the build left in that folder. The tests find entries by that name, at any depth, and never read anything else
   there. No variable points the store elsewhere: it is on the test volume because `HOME` is.
2. **`product.built`**, an event in the record (read with `events.read`) once a store entry is complete and can be
   placed, with `data.product` the product's `name`. The tests wait for it before making the next worktree.
3. **When the hub builds**: once a session starts in a repo whose default branch's key has no kept entry, with no
   other call; it builds from `origin/HEAD` (here `origin/main`) as last fetched.
4. **When a worktree receives its products**: by the time its SessionStart's reply returns (the tests look right
   after it, before the first prompt).
5. **The guard entry** the environment ships is named `no-product-store-write`; a deny names it as every deny does,
   `(guard no-product-store-write)`. `no-deepbuild-home-write` doesn't count: it isn't the environment's, and it does
   no after-the-call check.
6. **A change found after a call** is recorded as any event after the call whose JSON names the changed file and the
   session's or the call's ID; its kind is open.
7. **The floor's line** holds "floor" and "30 GB" in one text: the waiting worktree's session start, an event since
   the entry build was due, or a `status.read` row.
8. **GB** is 10^9 bytes, as macOS reports disk sizes, so the floor is 30,000,000,000 bytes of free space as statfs
   gives it to a program (blocks available).
9. **An entry build waits** when starting it would take free space under the floor, counting the size of that
   product's last kept entry; at the floor plus 1 GB a 1.3 GB entry waits. A plain "under the floor now" rule would
   start it, and fails AC6.
10. **`key_values`** are written as commands (`rustc --version`, `node --version`, `uv --version`); read as literal
    values, they still make the same key for every worktree here.
11. **`done.yaml`'s environment** also names `up: "true"`, `ports: [web]` and `ready.http`, which the base's reader
    requires; nothing starts it. Product `name`s are `target`, `node_modules`, `venv`, `gen`, `blob`.
12. **Trust**: a product's build runs once the repo is trusted as the base reads trust, `~/.claude.json`'s
    `projects[<path>].hasTrustDialogAccepted`, written for the main checkout and every worktree.
13. **Plants**, `DEEP_HUB_PLANT=<name>` in the environment of the hub and every hook; the hub lists each, so it starts
    with it: `product-symlinks` and `product-hard-links` (AC1: the store links its folders into the worktree, by a
    symlink, or by hard links file by file), `products-cargo-npm-only` (AC2: a manifest that knows only Cargo's and
    npm's products), `nearest-key` (AC3: no exact key, the nearest one is cloned), `places-stale` (AC4: the clone is
    placed whatever the worktree's sources), `store-writable` (AC5: a session can write the store, unguarded and
    unchecked), `reclaims-open-worktree` (AC6: reclaim ignores open files).

## Open points (choices the issue leaves open; the tests assert the least they can)

1. **"Before its session's first prompt"** is read right after SessionStart returns. Whether the hub also places when
   DeepBuild makes a worktree (#575) isn't exercised: no worktree here is DeepBuild's.
2. **"With no install"** for npm is `npm test` run with nothing installed first; for uv, `uv sync --frozen` printing no
   install. A local wheel was tried for the uv sample and dropped: uv records its absolute path, so a clone is
   reinstalled from it whatever DeepBuild does.
3. **The 5%** is read off the test volume, which also holds the hub's record; what the hub writes during a session
   start counts against the second worktree.
4. **AC4's two outcomes** are both accepted; a session start that "says why" is one naming `target`.
5. **"Recorded on its attempt"**: a scripted session has one attempt, so the session's ID (or the call's) stands for it.
6. **Readings** (bytes added after cloning, first build's time, the store's size, worktrees served per key), the line
   on a file system that can't clone, a product folder already in place, the 2 h idle rule, store entries going last,
   and a check's temporary checkout getting no build output aren't asserted: no criterion names them.
7. **AC8's merge base** is the perf lane's comparison; the merge base places nothing, so the 2 s is also judged here on
   its own.
8. **AC7 cost**: the dogfood run builds this repo cold once and the entries once; ten cold builds are one measured
   times ten.

# Issue #2345, criterion 4: independent review of the three loader-review digests

This is an independent review by a reviewer who is not #2236's author and wrote no product code.

## Verdicts

| Input in `tests/acceptance/1687/ac3-redraft/reviewed-loaders.json` at `1c4d1f0e2` | Value | Verdict |
|---|---|---|
| `packages/hub/src/core.ts` | `c160f8ae015a02dd681bc39ea5484dd39912380f9a9fad9bfd723eb152061cd4` | CONFIRMED |
| `packages/hub/src/plant.ts` | `1a82106b562df4a509d56d491ccbcc406227089d97a8c98ba3b637564dcbba8e` | CONFIRMED |
| `packages/hub/src/server.ts` | `189d26d521d4cb0ceff88832a0a1fcf89fc3a6573f77bd5fec016c715bc77ad2` | CONFIRMED |

Each value equals the checker's own identity of that file at `1c4d1f0e2`. I read every member that changed since the last independent review. None touches the loader trust chain. The review's completeness check passes at `1c4d1f0e2` (2 of 2 cases).

Everything below comes from committed bytes. I did not rely on #2236's commit messages or reports. Identities were computed with each commit's own `graph.mjs` `syntaxDigest`, applied as `reviewed-loaders.mjs` applies it: `syntaxDigest(ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true))`. TypeScript is 5.9.3 in `package-lock.json` at every commit used, and in the checkout I ran with. `syntaxDigest`, `reviewed-loaders.mjs` and `ac3.test.mjs` are byte-identical from `acc5121c5` to `1c4d1f0e2`. Only `graph.mjs`'s `extensionPackages` set changed, in `ae24da95c`.

## Which commit last set each value before `39bee16ae`

The table only ever existed on #2236's branch; main never held it. Its `current.inputs` for the three files changed only here:

| Commit | `core.ts` | `plant.ts` | `server.ts` |
|---|---|---|---|
| `acc5121c5` (table created) | `e6507f88…` | `2fd2bf07…` | `750f0273…` |
| `cd178e26f` (shutdown review) | `b5a1d4ab…` | unchanged | unchanged |
| `ae24da95c` (merge provenance review) | `6315da92…` | `43dd5c3e…` | `17c626a3…` |
| `39bee16ae` (author re-record) | `9e6e9273…` | `1a82106b…` | `189d26d5…` |
| `be4ba76dc` (author's merge of main) | `c160f8ae…` | unchanged | unchanged |
| `1c4d1f0e2` (PR merge) | unchanged | unchanged | unchanged |

- `ae24da95c` last set all three values before `39bee16ae`. Between them no commit touched the table or `tests/acceptance/1687/ac3-redraft/`. `cd178e26f`'s values were all superseded by `ae24da95c`.
- `ae24da95c` changed only `MERGE-PROVENANCE-REVIEW.md` (new), `graph.mjs` (two extension package names) and the table. It changed no product code. Its document says it is an independent check-owner review.
- Its three values equal the checker's identity of the blobs committed at `ae24da95c`, so it froze the exact committed bytes.
- Not verifiable from git: all 27 first-parent commits on #2236's branch carry one author and committer identity. So git cannot show that `ae24da95c` was made by someone other than the author. Its independence rests on its content and its own statement. To avoid resting only on that, I also read the trust-chain members of the three files at `1c4d1f0e2` directly (listed under each file below).
- `5909a30a1` (#1906's review) comes after the merge and takes `be4ba76dc`'s values as its starting point. It did not review these deltas.

## Commits and blobs

| File | (a) last independent review, `ae24da95c` | (b) `39bee16ae` | (c) `be4ba76dc` | At `1c4d1f0e2` |
|---|---|---|---|---|
| `core.ts` | blob `1c911753a06a3f8c3559fd6e53e434a29cf43e47` → `6315da929fa0a52ed13fd84874ea9c4ac49e10411013f7bc30a5c19def65d5e2` | blob `2136668c339bc79894033a32276c0fa10b1b17e8` → `9e6e9273be332ab9b7ffb02e0d7ccab5864ff87f7fbcc757fc06ac648a7736fd` | blob `33e8d62c38c596a8ed09fd3edc918a5b57f3ab17` → `c160f8ae…` | blob `33e8d62c38c5…` → `c160f8ae…` = table |
| `plant.ts` | blob `63b7f7fb13cd32694cd01f46b435c8ce833e2fd5` → `43dd5c3e8485b9289a4002020aa187f43fea1ce2c65aacfb86d43210e861b0b9` | blob `94941dde66f00667380cb729483361672e4bb6e4` → `1a82106b…` | — | blob `94941dde66f0…` → `1a82106b…` = table |
| `server.ts` | blob `544c681ec62e7cae33804e579a58b7de9bb2a3e5` → `17c626a3d8f08632f437be2c6243767302db7dae55a213e59253796f70f9548f` | blob `59c1cb3e078db8a2cee8dbbfa3c7d2794779d011` → `189d26d5…` | — | blob `59c1cb3e078d…` → `189d26d5…` = table |

Each recorded value equals the identity of the blob at the commit that recorded it. Blob ids from the hashed bytes match `git rev-parse`.

Where the changes came from:

- From (a) to (b), the three files changed only in merge `9e8912fd4` (main `afadc469d`, merge base `db8d9ed76`). Its PR-side parent `9099a378e` still held the (a) blobs.
- `plant.ts`: the merge took main's blob `94941dde66f0` whole. The PR side had not changed the file.
- `server.ts`: the committed blob equals a clean three-way text merge (`diff3 -m`) of (a), base `b0aa9d5c1574` and main `518c5f695778`.
- `core.ts`: the text merge conflicts, because #2236 had split the file. The author resolved it by hand. The same merge created `packages/hub/src/session-flags.ts`, which neither parent has.
- From (b) to (c), `core.ts` changed only in merge `be4ba76dc` (main `651bf06d3`, base `afadc469d`). This merge was also resolved by hand (three text conflicts).
- `1c4d1f0e2` changes nothing under `packages/` or `adapters/` relative to `be4ba76dc`.

## Member-level deltas

Method: I keyed top-level statements and class members by kind and name, compared each with `syntaxDigest`, and read the old and new text of every changed member. I also compared class headers and member order. Every whole-file identity change is explained by the members listed.

### `plant.ts`, (a) → (b): CONFIRMED

Changed: 2 of 21 statements. None added or removed, and order is unchanged.

- `type Plant`: eight new plant names. Five are for #2019 (`retry-reads-working`, `sent-back-without-hold`, `repeat-by-command`, `repeat-notifies-each`, `repeat-raises-ask`) and three for #1100 (`set-up-line-says-nothing-blocks`, `set-up-line-to-stdout`, `silent-steps`).
- `PLANTS`: the same eight names.

Trust chain: not touched. `activePlant()` still returns `DEEP_HUB_PLANT` as is, and `plantOf` still checks exact membership. Both are unchanged. The `mcp-loads-hub` loader in `mcp.ts` `runMcp` is still gated by `server === 'deep' && activePlant() === 'mcp-loads-hub'`, and its scope identity `a0a3031f…` is unchanged. New names are distinct strings and cannot select it. No loader or import changed.

### `server.ts`, (a) → (b): CONFIRMED

Changed: 3 added, 1 removed, 5 changed (the class `Hub` entry is the container of the member changes; its header is unchanged).

- `import { gatesOff } from './watch.js'` is added, and the local `function gatesOff(root)` is removed. `watch.ts`'s `gatesOff(dir)` has the same body: it reads `<dir>/gates.json`.
- `Hub.open()`: the only change is `gatesOff(this.root)` → `gatesOff(this.root.dir)`.
- `Hub.lastFailed` (new map) and `Hub.failedAgain()` (new method) track a session's last failed call.
- `Hub.hook()`: a call that fails like the last one is held for the core's reply.
- `ALLOWED`: adds `['setup.report', ['cli']]`. Its handler in `hub-control.ts` checks steps against `setup-steps.ts`'s fixed list and appends `setup.step` events.
- `setGatesOff`: a doc comment only (JSDoc is part of the AST identity).

Trust chain: not touched. I read the whole new `Hub.open()`. It still picks `host` only from `DEEP_HUB_TEST_HOST` and `index` only from `DEEP_HUB_TEST_INDEX`. It still builds the core with `coreInline` only under the `commit-on-event-loop` plant, else with `coreWorker`. Those lines are unchanged. `coreInline`, which holds the frozen `createCore` call `130dfe59…` and loads `./hub-runtime.js` by a literal import, is unchanged. So is `coreWorker`. `server.ts` is not in core's closure.

### `core.ts`, (a) → (b) → (c): CONFIRMED

(a) → (b), merge `9e8912fd4`: 2 added, 11 changed (class `Core` is the container; its header is unchanged).

- `import { SessionFlags } from './session-flags.js'` and the field `Core.flags` are added.
- `wireStopJudging`, `wireTranscripts`, `wireSessionState`: each passes `flags: () => this.flags`.
- `wireHookServices`: builds `SessionFlags` from record, clock, asks, agents, root, siblings, transcript reader, state, mcp, append, queue and an agent-trust reader. `TranscriptReader` also gets the clock.
- `openResources`: adds four timers and one immediate run of `SessionFlags` methods.
- `recoverRecord`, `handleHook`: `readTranscript` also gets `this.flags.modelCalled(session)`. `handleHook` also calls `flags.versionRead`.
- `hookPrograms`: after its reading, it calls `flags.watchOnly`.
- `settleHook`: a repeated failure calls `flags.repeated`.
- `buildReply`: `PostToolUseFailure` also gets the tool-call reply.

(b) → (c), merge `be4ba76dc`: 1 changed member (plus its container).

- `wireRunServices`: the runner's `kind` callback takes `stop`. It passes `{ run, worktree, stop }` to `checkKinds.run`. `this.providers.checks.kinds(...)` also gets `supervisor`, `checkouts` and the object-store path.

Trust chain: not touched.

- No changed member holds a computed `import()` or its scope. `core.ts` has no loader site at (a) or at `1c4d1f0e2`.
- Both inward provider calls are unchanged: `this.providers.environment.host(this.supervisor, this.options.host)` (`7c5b277b…`, in the unchanged `openExecution`) and `this.providers.knowledge.index(this.root.wiki, this.options.index)` (`ee88c11d…`). The latter is still the first statement of `openResources`; the additions come after it and only schedule `SessionFlags` work. Nothing in `core.ts` assigns to `this.options`.
- `providers.checks.kinds` is not a frozen provider call and takes no module path. In `hub-runtime.ts` `createCore`, whose scope identity `629b1f89…` is unchanged, it is `(o) => new Kinds(o)`. `kinds.ts` is outside core's closure. It uses `supervisor` only for the timing check's sandboxed `/bin/sh -c` steps in `speed.ts` (`inherit: false`, write grant limited to the checkout and a temp folder). It uses `checkouts` for baseline checkouts and the store path for blob reads. `runner.mjs` is referenced only by `extension-host`.
- The new import adds six hub files to core's type-inclusive closure (280 → 286 files): `session-flags.ts`, `watch.ts`, `doctor.ts`, `canvas-doctor.ts`, `setup-steps.ts`, `contracts.ts`. None of them is `hub-runtime.ts` or `kinds.ts`, and none reaches an extension package. None has a computed import. A text scan of them and of every changed member found no `createRequire`, `getBuiltinModule`, `eval`, `new Function`, `node:vm` or `import.meta.resolve`.

## Program-level checks at `1c4d1f0e2`

I built the committed program with the checker's own `snapshot(root, '1c4d1f0e2')` and evaluated `reviewedGraph`:

- Against its own table: no review problems.
- The nine site identities match the table, lines included: `conformance/src/bin.ts:46`, `extension-host/runtime/deep.mjs:87`, `extension-host/runtime/runner.mjs:33`, `extension-host/src/host.ts:1743` and `:1745`, `hub/src/hub-runtime.ts:43` and `:54`, `hub/src/mcp.ts:118`, `pi/src/index.ts:398`.
- `extensionSideCalls`: two, `runner.mjs:3:4dca52d8…` and `host.ts:3:fec1d5b5…`. Both equal the table.
- `providerCalls`: four, `core-worker.ts:017570be…` (`createCore`), `core.ts:7c5b277b…` (`environment.host`), `core.ts:ee88c11d…` (`knowledge.index`), `server.ts:130dfe59…` (`createCore`). All equal the table.
- Core's type-inclusive closure over the augmented edges (286 files) reaches neither `hub-runtime.ts`, `kinds.ts`, `server.ts`, `mcp.ts` nor any extension file. `graph.mjs` `boundary()` gives 0 violations and 0 unclassified packages. This was computed, not run as a test case.
- Earlier tables against this same program: `ae24da95c`'s table fails on exactly `plant.ts`, `core.ts` and `server.ts`, and nothing else. `39bee16ae`'s table fails on `core.ts` only. So the re-records covered only these three inputs. Every other frozen input, site, caller and provider call still matches the last independent review.
- At `ae24da95c` itself, its own table gives no review problems (closure 280 files, same reach results).

## Completeness check

One run, in a clean checkout of `1c4d1f0e2`. Its `packages/`, `adapters/` and `tests/acceptance/1687/` are byte-identical to the commit, with no extra files. Node v24.22.2, TypeScript 5.9.3. The pattern selects the two cases that call `completeReview`: the completeness case and the oracle case that proves the review rejects planted wrong programs and the base.

```sh
node --test --test-reporter=tap --test-name-pattern="AC3 completeness|reviewed loaders reject" tests/acceptance/1687/ac3-redraft/ac3.test.mjs
```

```text
ok 1 - AC3 completeness: every computed loader matches its independently reviewed input and boundary
# external dependency edges (not traversed): 800; reviewed computed loaders: 9
ok 2 - oracle: reviewed loaders reject unreviewed, mutated, escaping and core-hidden paths
# tests 2
# pass 2
# fail 0
# duration_ms 18326.668792
```

Exit status 0.

## Not verified, and limits

- That `ae24da95c` was made by someone other than #2236's author. Git cannot show it (one identity for all commits); see above.
- I did not run the other `ac3.test.mjs` cases (cycles, boundary), any other suite, `scripts/affected.mjs` or a build.
- AST identity is a review lock, not a proof of behavior. It ignores `//` comments and whitespace but counts JSDoc.
- This review is not a signed approval. The guard's signed approval for #2236 is a separate item in #2345.
- No digest was changed.

## Rerun

Run from the repo root. `X` is an empty scratch folder. `M` is a clean checkout of `1c4d1f0e2` after `npm ci`.

```sh
X=<scratch folder>; M=<checkout of 1c4d1f0e2>

# 1. The three table values at each commit.
for c in acc5121c5 cd178e26f ae24da95c e4f24691b 39bee16ae 1468df644 be4ba76dc 1c4d1f0e2; do
  git show $c:tests/acceptance/1687/ac3-redraft/reviewed-loaders.json | node -e 'let s="";process.stdin.on("data",(d)=>s+=d).on("end",()=>{const i=JSON.parse(s).current.inputs;for(const f of ["core","plant","server"])console.log(process.argv[1],f,i[`packages/hub/src/${f}.ts`])})' $c
done

# 2. Committed blobs, and the merge sides.
git rev-parse {ae24da95c,39bee16ae,be4ba76dc,1c4d1f0e2}:packages/hub/src/{core,plant,server}.ts
git rev-parse {db8d9ed76,9099a378e,afadc469d,9e8912fd4}:packages/hub/src/{core,plant,server}.ts
git rev-parse {afadc469d,1468df644,651bf06d3,be4ba76dc}:packages/hub/src/core.ts
git diff --stat be4ba76dc 1c4d1f0e2 -- packages adapters

# 3. Each commit's own checker identity of the three files.
for c in ae24da95c 39bee16ae be4ba76dc 1c4d1f0e2; do
  mkdir -p "$X/$c" && git archive $c packages tests/acceptance/1687 package.json | tar -x -C "$X/$c" && ln -sfn "$M/node_modules" "$X/$c/node_modules"
  node --input-type=module -e '
    const [root, c] = process.argv.slice(1);
    const { syntaxDigest } = await import(`${root}/tests/acceptance/1687/ac3-redraft/graph.mjs`);
    const ts = (await import("node:module")).createRequire(`${root}/package.json`)("typescript");
    const { readFileSync } = await import("node:fs");
    for (const f of ["core", "plant", "server"]) {
      const file = `packages/hub/src/${f}.ts`;
      console.log(c, file, syntaxDigest(ts.createSourceFile(file, readFileSync(`${root}/${file}`, "utf8"), ts.ScriptTarget.Latest, true)));
    }' "$X/$c" $c
done

# 4. The deltas read above.
git diff ae24da95c 39bee16ae -- packages/hub/src/core.ts packages/hub/src/plant.ts packages/hub/src/server.ts
git diff 39bee16ae be4ba76dc -- packages/hub/src/core.ts

# 5. server.ts at 39bee16ae is a clean three-way merge of main's change.
git show 9099a378e:packages/hub/src/server.ts > "$X/s.pr"; git show db8d9ed76:packages/hub/src/server.ts > "$X/s.base"; git show afadc469d:packages/hub/src/server.ts > "$X/s.main"
diff3 -m "$X/s.pr" "$X/s.base" "$X/s.main" | diff - <(git show 39bee16ae:packages/hub/src/server.ts) && echo clean

# 6. Earlier tables against the final program, with the checker's own snapshot and reviewedGraph.
for c in ae24da95c 39bee16ae 1c4d1f0e2; do git show $c:tests/acceptance/1687/ac3-redraft/reviewed-loaders.json > "$X/table.$c.json"; done
node --input-type=module -e '
  const [checker, rev, ...tables] = process.argv.slice(1);
  const { snapshot } = await import(`${checker}/graph.mjs`);
  const { reviewedGraph } = await import(`${checker}/reviewed-loaders.mjs`);
  const { readFileSync } = await import("node:fs");
  const snap = snapshot(process.cwd(), rev);
  for (const t of tables) console.log(t.split("/").at(-1), JSON.stringify(reviewedGraph(snap, JSON.parse(readFileSync(t, "utf8")).current).reviewProblems));
' "$X/1c4d1f0e2/tests/acceptance/1687/ac3-redraft" 1c4d1f0e2 "$X"/table.{ae24da95c,39bee16ae,1c4d1f0e2}.json

# 7. The completeness check.
(cd "$M" && node --test --test-reporter=tap --test-name-pattern="AC3 completeness|reviewed loaders reject" tests/acceptance/1687/ac3-redraft/ac3.test.mjs)
```

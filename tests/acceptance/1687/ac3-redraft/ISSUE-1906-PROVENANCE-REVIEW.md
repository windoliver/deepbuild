# Issue 1906 provenance continuation

## Authority and scope

Independent check-owner source review under the scoped proposal
`/private/tmp/deep-1906-proof/loader-review-proposal.md`, continuing the
approval recorded in `reports/issue-1687-boundary-proposal.md`. The reviewer is
not the implementing agent of #1906 and wrote no production code. This is a
source review and a metadata correction. It is not a signature, an approval
tag or token, an acceptance-test result, or permission to relax AC3. The
repo's signed guard for a change under `tests/acceptance/` still applies
before this lands; nothing here stands in for it.

Reviewed tree: `0715e9ff5548618c04fc3f72d3a7ce116f00ecef` (implementation
merge `040e6aa6f`, main `81a5a9b2f`), clean apart from an untracked
`node_modules`.

Read first: AGENTS.md; the design's hub/extension responsibilities, Extension
API, Composition, Proof, Dogfooding and edit-guard rules; `graph.mjs`,
`reviewed-loaders.mjs`, `reviewed-loaders.json`, `ac3.test.mjs`,
`REVIEWED-LOADERS.md`, `SHUTDOWN-PROVENANCE-REVIEW.md` and
`MERGE-PROVENANCE-REVIEW.md`.

## Which bytes the frozen table described

The hashes were not regenerated and compared with themselves. Each frozen
`current` identity was first matched to committed bytes by walking the full
git history of each input (14 to 1356 commits per file) and computing the
checker's own AST identity for every blob. Each frozen identity belongs to
exactly one blob, and commit `be4ba76dc10ce14d6441e271f8d924adfd802cb9`, the
last commit that touched the table, carries all ten of them plus all nine
site identities.

| Input | Git blob behind the frozen identity | Raw SHA-256 of that blob |
|---|---|---|
| conformance/src/bin.ts | `031f5020dfeb` | `4d96ffd9d02a24396aa8c9451b2f339ac534004b151388b5c5d8334cff3ed5f9` |
| extension-host/src/host.ts | `e74a047076e8` | `0cece2c8615e0b7803a5c0494dfcae40f3a0657af30285ecade8c59ee3f086f0` |
| extension-host/src/digest.ts | `e09fe41531bd` | `ad0dc924822cfe6fdb709384123a74f32f82e4e669240af063a6d2951f3beeb8` |
| extension-host/runtime/deep.mjs | `26010f29c436` | `a8c8974eb29b16112f62ecf9b1a5ec1ed4d4f64aabb9f430e6d3d89442ab3b4b` |
| extension-host/runtime/runner.mjs | `5bac358a44a0` | `4f353bfc410c5a2724e906b5b72153b32f5a17669347ca87f08fa1c952fbdc65` |
| hub/src/plant.ts | `94941dde66f0` | `51c988358cf8f4c2e5cb82013391105e891bfa12547b7a60c79bc27246a89833` |
| hub/src/core.ts | `33e8d62c38c5` | `63547f0420a05341c068b1fa3e9eccb20b1c79ab6979b9e8e5743f81c52d9d1c` |
| hub/src/server.ts | `59c1cb3e078d` | `789297aeca05235339849fbfffa7a8d691868c48bc359b0525746c8987aab19e` |
| hub/src/core-worker.ts | `32fd910cfba1` | `47d107c646850df61ecfece48cd295b07df0351156de6799b35258c79279addf` |
| hub/src/search.ts | `c04cf7467a9e` | `19487f9eacb2c10a6766eaf9202a04919443c08e687c7842a757bc88160737f7` |

The delta reviewed is therefore `be4ba76dc` → the tree above, in two parts:
main (`be4ba76dc..81a5a9b2f`: plant, core, server, core-worker, search) and
#1906 (`81a5a9b2f..0715e9ff5`: host, core, server, core-worker). bin.ts,
digest.ts, deep.mjs and runner.mjs are byte-identical to the reviewed blobs.
`hub-runtime.ts`, `mcp.ts`, `wire.ts`, `kinds.ts`, `pi/src/index.ts`,
`conformance/src`, `extension-host/runtime` and every file under
`tests/acceptance/1687` have no diff from `be4ba76dc`.

## Review of each delta

A member-level AST comparison (every top-level statement and class member of
the old blob against the current file) bounds what was read:

- **host.ts.** Changed: the `./sources.js` import, `Host.updateHeld`,
  `Host.yours`, `Host.fetch`. Nothing added or removed (328 members each
  side). `updateHeld` now raises its ask through the existing `yours` helper:
  same authority ask, 24 h deadline, `default: 'decline'`, `fallback: 'you'`;
  it proceeds only on a recorded `allow`, and `yours` returns `undefined`
  rather than `false` when the host closes, so the two refusals keep their
  own wording (the other `yours` callers treat it as falsy). `fetch` sends
  through `sources.ts` `nodeFetch`: still `redirect: 'manual'`, still cut at
  1 MiB, with `AnswerTooLarge` mapped to the old refusal. Neither is a module
  load, and neither feeds one. `start`, `sandboxed`, `runTests`, `hubBound`,
  `snapshot`, `loadNow`, `dispatch` and `testPackage` are unchanged:
  the hub loader still imports only the snapshot's `index.ts` with the
  digest/start query; hub placement still needs `builtBy === null`, an
  `index.ts` and an exact release id/version/digest (the
  `hub-unless-agent-built` plant is still the only other branch); test paths
  still come from recursive `tests/` enumeration with the same suffix filter,
  joined under `ext.folder`; the supervisor still gets
  `[process.execPath, RUNNER, path, folder, entry]`, `cwd: folder`,
  `inherit: false` and the same read/socket grant. No RPC or dispatch
  argument reaches either `import`.
- **core.ts (main).** `Core.handleHook` consults the delivery token before
  session verification; `Core.mcpHello` takes the socket fd and returns the
  parent the OS reports (#2070). No import, option or provider argument
  changes.
- **core.ts (#1906).** `renameSync`/`writeFileSync` leave the `node:fs`
  import; `writeAtomic` joins the `./vfs.js` import; a literal `yaml` import
  is added for the new `doneSpec` reader, which parses
  `<cwd>/.deepbuild/done.yaml` as data. `options` becomes a field holding
  `{ ...options, forge: options.forge ?? 'https://api.github.com' }`, so
  `host` and `index` pass through untouched. The other changed members swap
  `(q, p) => this.record.raw(q, p)` for the existing `this.raw`, fold event
  appends into `appendCore`, and call `delivery.answers.*` directly. The two
  inward provider calls are identical by their locked identities:
  `this.providers.knowledge.index(this.root.wiki, this.options.index)` and
  `this.providers.environment.host(this.supervisor, this.options.host)`. No
  concrete module path, fallback or hidden loader enters Core.
- **server.ts.** Main: the parser pool replaces a parser that ends and
  refuses the lines it held, `hub.health` reports the parser count, and the
  MCP hello forwards the socket fd. #1906: `isObj` is now `isRecord` from
  `@deepbuild/contracts`, a core package, with the same predicate. The
  `DEEP_HUB_TEST_HOST` / `DEEP_HUB_TEST_INDEX` selection and the inline
  `createCore(options, onFrame, onAsking, onAcking, onScrub)` call are
  unchanged.
- **core-worker.ts.** Main: the `mcp-hello` request carries `fd`. #1906: a
  literal side-effect import of `./children.js`. The worker's `createCore`
  call is identical by its locked identity.
- **search.ts.** An optional `decides(scope)` filter on decisions (#1840).
  It holds no loader since the index loader moved to `hub-runtime.ts`, and
  `pageClaims` and `IndexFill` are unchanged.
- **plant.ts.** Four new plant names (#1840, #1606, #2043), in the `Plant`
  type and the `PLANTS` list; no other statement changed, so `mcp-loads-hub`
  and its selector are as reviewed. The only non-`import` module access is the
  already reviewed literal `process.getBuiltinModule('node:inspector')`.

Checked on the current tree with the checker's own functions (read-only
diagnostic, not a test): nine computed loaders, the same nine expressions; no
new or missing site; seven site scopes unchanged; both `extensionSide` callers
still pass three arguments with unchanged identities; all four provider and
`createCore` caller identities unchanged; zero forbidden edges, zero
unclassified packages, zero unresolved literal edges; Core's type-inclusive
closure (288 modules, 278 at runtime) does not reach `hub-runtime.ts` or
`kinds.ts`; runtime cyclic edges 3/3 and type-inclusive 18/16 against the
pinned base, none new; the base's two arbitrary Core loaders still report
UNSAFE.

No boundary violation and no unreviewed loader input was found.

## Outside this lock, noted for the parent

`packages/hub/src/children.ts` (#1906), now imported for effect by
`core-worker.ts` and `children-worker.ts`, loads `node:child_process` through
`createRequire(import.meta.url)('node:child_process')` and wraps its three
synchronous functions process-wide. The specifier is a constant Node built-in,
so it is not a computed loader, and the existing limit already says this check
is not an alias detector: `graph.mjs` sees `require(...)` and `import(...)`
only, and would not list a `createRequire` call whatever its argument. It does
not change which module any reviewed loader imports. Whether the wrapped
functions keep native behaviour is runtime behaviour for #1906's own tests,
not something this review certifies.

## Exact locks updated

Only these `current` values changed. Each prior value is the AST identity of
the blob in the table above; each new value is the identity of the reviewed
file, whose raw SHA-256 is given so a later import can detect drift.

| Lock | Previously reviewed | Reviewed current | Raw SHA-256 of reviewed file |
|---|---|---|---|
| host.ts / Host scope (both sites) | `ff9c3921fbdf1d37532f70c0c659eabec73e38bff584931b45bf1089797311a4` | `ba6705627643de075b8fb2c90b3417a9f68999251559c50d15d46dc344d3b952` | as host.ts below |
| extension-host/src/host.ts input | `1100b892542a1bc6a474eda4a5317e39d76c6862cb6ad3326797f26c191e60ac` | `53c5a887b1238ce1383eb988a040953e9811e217c5d14331bbb8df895b8a7384` | `922bf5d9cf76598e6bcee91cbe86ce77b27f623b83f55f37ca31ea77e2f1ee16` |
| hub/src/plant.ts input | `1a82106b562df4a509d56d491ccbcc406227089d97a8c98ba3b637564dcbba8e` | `647c34f1440978d0f43320f768f3048f60a6319e6f78b82b4b5c42fcc39b1c6d` | `14db6f7643aa6fea90daecdc4208403705af9e1515fcc2fd19423a2490205eea` |
| hub/src/core.ts input | `c160f8ae015a02dd681bc39ea5484dd39912380f9a9fad9bfd723eb152061cd4` | `72b082a9b6ad403030978560c1bb43bdc2edf98976f0eef9984e374611c5689a` | `2a23276598237497848f9e0f5e273b6ac6864b4c0b24a403454d7e2c32db59cf` |
| hub/src/server.ts input | `189d26d521d4cb0ceff88832a0a1fcf89fc3a6573f77bd5fec016c715bc77ad2` | `abeb21c7be1c06955a65331203defd2d633774e235d5a130bcbec111596ddd0a` | `06b818ac6f947df7d69e7c348f50ad4cec1b4bbf6bebfcc76490f5f54192e36c` |
| hub/src/core-worker.ts input | `6a07ece8c581d2fe60f567ebe4eb304dc1114ff95a7eb71530bd9a8aea16362d` | `7f6455593a94b659feacca6fc73a06277dd5c5feb21ca93ab2c9a5aa6903df61` | `c2074e871da6d1a59b22eb204b33c9e4ccee85cfaceee31918de7a0e4e58df8f` |
| hub/src/search.ts input | `cb63ca4d303e52fc584eae8d6f07782d8f7362ea137fd19186a5843e9535c70f` | `50880b61da487fc5e2622862f5a5a51c04ab5172118946dc04acb2683a0258fb` | `68066052c30353e8a0ebee59a8a29479c0ba7de6070594b1335b64a34b616d2b` |

`reviewed-loaders.json` went from SHA-256 `917a1da658d2…f45d00` to
`8b8534e38c2d…eb8876`: eight changed lines. A field-by-field comparison with
HEAD shows `format`, `basis`, `baseRevision`, the whole `base` block, the site
count (9), every site's `from`, `line`, `expression`, `expressionDigest`,
`scope`, `kind`, `origin`, `boundary`, `proof` and `target`,
`current.extensionSideCalls` and `current.providerCalls` equal. The two Host
diagnostic `line` values (1743, 1745) are left stale on purpose; the loaders
now sit at 1727 and 1729, and line is not identity. `graph.mjs`,
`reviewed-loaders.mjs`, every test and `REVIEWED-LOADERS.md` are untouched.

## Requirement → change → evidence

- Computed-loader completeness → the eight values above → before: the saved
  unchanged runs fail the completeness case and the oracle case, naming five
  inputs on main `81a5a9b2f` and the Host site plus six inputs on the #1906
  tree; a diagnostic on this checkout reproduced the same seven problems.
  After: the four unchanged files pass 29 of 29.
- Wrong sources still rejected → nothing changed → in that same run the
  qualification case plants an unreviewed loader file, a changed import
  expression, a `tests/` path escaping to `..`, a core-to-runtime import, a
  hidden Core loader and a concrete extension path in Core's index argument;
  each must fail `completeReview`, as must the base, and the case passed.
- Real loader behaviour → reused, not rerun →
  `loader-boundary.test.ts` 3/3 on base and on the #1906 tree, as recorded
  in `reports/issue-1906-results.json` and the parent's saved logs.

Command, under a throttle `test` grant:

```
node scripts/throttle.mjs test --wait 30 -- scripts/lease node --test \
  tests/acceptance/1687/full/structure.test.mjs \
  tests/acceptance/1687/ownership-redraft/oracle.test.mjs \
  tests/acceptance/1687/ownership-redraft/structure.test.mjs \
  tests/acceptance/1687/ac3-redraft/ac3.test.mjs
```

(two reporter flags added, to keep a TAP copy). `scripts/lease` found no
`deep` on PATH and no built CLI, so the command ran unleased; nothing was
built to change that. Logs, diagnostics and the handoff are under
`/private/tmp/deep-1906-proof/loader-owner-*`.

## Limits

This certifies loader provenance for the tree named above and nothing else:
not #1906's behaviour, not the sandbox on every platform, not release or
full-issue PASS. Any later edit to a locked input or scope fails the check
again and needs its own review. No build, remote lane, affected run or
preflight was run here; the parent owns the affected classification. No
signed approval exists for this change, and none was created.

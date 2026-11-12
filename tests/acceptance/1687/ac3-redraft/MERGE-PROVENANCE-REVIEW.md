# AC3 merge provenance continuation

## Authority and scope

Independent check-owner continuation of the explicit approval recorded in
`reports/issue-1687-boundary-proposal.md` and
`reports/issue-1687-approved-check-changes.md`, plus this task's authorization to
classify the two upstream packages. This is source review, not a signature,
cryptographic approval, acceptance-test result or permission to relax AC3.

Reviewed the working-tree merge of main
`46bb7a35767f5bb5af26e161e9e3ef0e20ad4f68` into HEAD
`ca0b0bb6f0c81b0482b6e33797c6b17fb170abb8`, including the parent's ReviewRounds
inversion. Compared against the last reviewed snapshot
`f8d0cff0ae93c6b06981d4fe959c6883f12c68a7`, not HEAD alone. All ten frozen
input AST hashes and nine site identities match that prior snapshot; the deltas
below explain every current mismatch. No source digest changed between the
before and after diagnostic snapshots.

Read AGENTS.md, the design's hub/extension responsibilities, Extension API,
Composition, remote-machine blocks, and proof/guard/Dogfooding rules; both
approval reports; graph.mjs, reviewed-loaders.mjs/json, REVIEWED-LOADERS.md and
SHUTDOWN-PROVENANCE-REVIEW.md. No product code, test body, assertion, runner,
lane, limit, known failure, signature or base review was edited.

## Independently classified packages

Both new packages are **extensions**, for their responsibilities, not because of
which candidate modules import them. Every old core and extension role remains.

- `checks-host`: its package.json public entry is `src/index.ts` (built
  `dist/index.js`). README's “What it is for” and the entry define `setting` and
  `machine` check.kind@1 fills, with budgets and kits, and a machine-definition
  draft. They produce check outcomes, not verdicts. The design's Extension API
  `registerCheck`, Composition check.kind@1 slot, and “Done, for a machine” under
  remote-machine blocks place these concrete runners outside the kernel.
- `routing-replay`: its package.json public entry is `src/index.ts` (built
  `dist/index.js`). README explicitly describes an extension on the asks core;
  the entry replays a frozen Hydra corpus on its own clock/record, writes as
  `ext:routing-replay`, and reports counts. It is the design's “Routing replay”
  application of asks, not the asks primitive, record, or trusted ring.

Adding exactly these names to extensionPackages is a prerequisite to applying
AC3's unchanged absolute boundary to new main packages. Unknown packages still
block; there is no wildcard, neutral role or import-driven role inference.

## Loader and input review

- **Host:** the entire diff from the reviewed snapshot is a type import and two
  runJobTool input signatures changing to JobBytes. Inspected job-kinds/jobs
  deltas: input arrays/encoding and job-output budget are not module targets.
  Re-read snapshot/copyPackage, packageDigest, check/load, hubBound, start,
  sandboxed and runTests. The immutable copy is digested with symlinks refused;
  normal hub placement still requires builtBy=null, index.ts and exact release
  id/version/digest; trust and exact conformance digest still gate load. The
  existing hub-unless-agent-built wrong-program branch is not waived. Test paths
  still come only from recursive tests/ enumeration with the same suffix filter.
  Supervisor argv still fixes the snapshot folder/entry and private connection,
  with inherit=false. Neither JobBytes nor RPC dispatch supplies a module path.
- **Outer runtime/Core:** the runtime adds the public checks-review itemOutcomes
  import and supplies it as mandatory checks.reviewOutcomes. Both arbitrary
  host/index loaders and their path transformations are unchanged, remain
  outside Core's closure, and have no sandbox claim. Core still forwards only
  this.options.host/index; server still selects the same test environment inputs;
  worker and inline createCore calls are unchanged. Core's other changes wire
  Landing, host recording, and counted review rounds, not concrete module paths.
  ReviewRounds imports only types from checks-port; ReviewItem/ReviewRound are
  structural contracts, not extension type aliases. StopJudging uses that port;
  Kinds and concrete check imports stay outside Core. No optional fallback or
  hidden import reintroduces checks-review into Core.
- **MCP:** runMcp adds shedStartup before the existing plant guard. settle.ts
  calls only fixed V8/VM GC facilities. The directory, .js filter and
  server=deep/activePlant=mcp-loads-hub guard are identical. Every top-level hub
  source counterpart, including new Landing/ReviewRounds and self, still
  contributes graph edges; no cycle is exempted.
- **Plant:** reviewed all new plant names and unchanged mcp-loads-hub selector.
  The inspector import becomes the literal built-in
  process.getBuiltinModule('node:inspector'); it is not a computed target or a
  concrete-extension escape. No new computed-loader waiver is introduced.
- **Server:** writerGeneration now uses the explicit public record/meta export;
  the other diff adds method/role rows. Neither changes loader inputs, worker
  transfer, or inline construction. Inspected record/package.json and meta.ts.
- **Unchanged sites:** re-read the conformance CLI's explicit --fill resolution,
  extensionSide's test dispatch/default importer, sandbox runner's fixed entry
  and optional stripped source, and pi's constant package/version import. Both
  production extensionSide callers still supply argument three; all four
  provider/createCore caller identities are unchanged. No new/missing site.

### Exact AST locks updated

Only current locks below change; all expression identities, origins, boundary
text, kinds, proof references, caller identities and base bytes remain intact.
Diagnostic line numbers move only for the runtime and MCP.

| Lock | Previously reviewed | Reviewed current |
|---|---|---|
| host.ts / Host scope (both sites) | `e4161b2fa5d94d871a6e6b2fb0a4f3db570aabbb418ed5175df6989620ffd97f` | `ff9c3921fbdf1d37532f70c0c659eabec73e38bff584931b45bf1089797311a4` |
| hub-runtime.ts / createCore scope (both sites) | `46fa9bd7324e053edc00de9906e7aadc756113cbbb2a5d30d4d5c24d860eac8b` | `629b1f89309d7771d06f99a30dadf5f13b2860a9f41bd84eca556c03be43c7ef` |
| mcp.ts / runMcp scope | `131721f174a2128e7767ed62eaf7bd5768e104f7c0a0d265efc823859ac6ebe2` | `a0a3031f3d2b22ca281a7c6ef618d938ec3af5c9252d5fbb125c6941aeb16db3` |
| extension-host/src/host.ts input | `49e618f835fea6d17993bfbffbcfa39e5e5ed996606de7990f5a9278194682cf` | `1100b892542a1bc6a474eda4a5317e39d76c6862cb6ad3326797f26c191e60ac` |
| hub/src/plant.ts input | `2fd2bf07d3a7bc05a8eaf6327b7fd85fe1e7e5549a42f4f5f46cd764b56133b2` | `43dd5c3e8485b9289a4002020aa187f43fea1ce2c65aacfb86d43210e861b0b9` |
| hub/src/core.ts input | `b5a1d4ab6dfd6a2ee3a2129745ab801089bdea7cbe3979f81f83fcef6149efa8` | `6315da929fa0a52ed13fd84874ea9c4ac49e10411013f7bc30a5c19def65d5e2` |
| hub/src/server.ts input | `750f027319b1c4e4e3d0fc751bf699e393ca9f9724ae18a99df9d819cabc101c` | `17c626a3d8f08632f437be2c6243767302db7dae55a213e59253796f70f9548f` |

## Requirement → change → diagnostic evidence

- Computed-loader completeness → only reviewed current identities above → before
  diagnostic reports one site-inventory mismatch plus four changed inputs;
  after reports no review problems, with the same nine expressions.
- Absolute extension boundary → two explicit extension roles → after reports
  zero unclassified packages, zero violations and zero unresolved edges. Core's
  runtime closure has 245 nodes; its type-inclusive closure 265. Neither reaches
  hub-runtime.ts, kinds.ts or checks-review. New closure modules versus the
  reviewed snapshot are contracts/words, record/meta, Landing and ReviewRounds;
  their imports introduce no extension dependency.
- Preserve cycle and rejection semantics → graph changes only two set entries;
  reviewed-loaders.mjs and every check remain untouched → runtime cyclic edges
  base/current 3/3, type-inclusive 18/16, no new cyclic edges. Base arbitrary Core
  loaders still report their two UNSAFE problems. Byte comparison confirms base
  review prefix unchanged, caller locks unchanged, and no graph algorithm diff.

The read-only Node/TypeScript AST diagnostics are saved at
`/tmp/deep-1687-close-boundary-{before,after}.json`, including raw SHA-256 for every
scanned source and exact closure inventories. The handoff at
`/tmp/deep-1687-close-boundary-result.md` lists reviewed source digests. These are
not test passes. No build, suite, mutant execution, affected run or preflight was
launched. The parent owns one coordinated affected run and must report its WIDE
and INCONCLUSIVE lines. Existing failures and historical proof are retained.

No AC3 boundary violation was found in this snapshot. Merge-index conflicts for
core.ts/kinds.ts still appear as UU despite parseable working files; resolving
those and proving runtime behavior belong to the parent. This does not certify
all upstream behavior or close #1687. Source drift invalidates this disposition;
new/changed/unknown loaders, changed inputs/callers, core-to-runtime reach and
unclassified packages retain their fail-closed checks. The existing mutant
checks are unchanged and unrun here. Any required signed guard approval still
needs a real person's signature over the actual change; none is fabricated.

## Refresh after the merge of main `afadc469d` (2026-11-12)

The owner approved, in conversation, re-recording the three whole-file input
digests that merge changed. It was done by the change's own author, not by an
independent reviewer, and no signed approval exists.

| Input | Reviewed above | After the merge |
|---|---|---|
| hub/src/plant.ts | `43dd5c3e8485…` | `1a82106b562df4a509d56d491ccbcc406227089d97a8c98ba3b637564dcbba8e` |
| hub/src/core.ts | `6315da929fa0…` | `9e6e9273be332ab9b7ffb02e0d7ccab5864ff87f7fbcc757fc06ac648a7736fd` |
| hub/src/server.ts | `17c626a3d8f0…` | `189d26d521d4cb0ceff88832a0a1fcf89fc3a6573f77bd5fec016c715bc77ad2` |

Only those three lines of `reviewed-loaders.json` changed. With the old digests
the completeness case named exactly these three inputs and nothing else: the
nine loader sites, their scopes, the `extensionSide` callers and the four
provider calls matched as frozen. `plant.ts` and `server.ts` changed on main
alone (new plant names for #2019 and #1100; `server.ts` holds no loader site).
`core.ts` gained the wiring of `session-flags.ts`. After the refresh the four
structure files pass 29 of 29.

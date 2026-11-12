# #1687 AC3 — independent blind redraft

> No new import cycle, and the core never imports an extension

Inputs: the supplied issue body and owner comment, `AGENTS.md`, the technical design,
and checkout **c52f1c66d22886c336189d41237265e82843c34a**. No earlier acceptance draft,
implementation branch, other worktree, dispute, or network input was read. This job
writes only this directory. No commits, product changes, or existing-check edits.
The owner's request for one PR changes delivery granularity, not any criterion.

## What “core” means

Design anchors: **Scope**, **One hub per user**, **Extension API**, **Building blocks**,
**Composition** and **First-party extensions that ship on by default**.

The core is the record, gate enforcement, asks, and adapter **contract**, not all
code executing in the hub process and not just a filename. The kernel owns the
record, contracts, capabilities, two rules, and trusted path. The trusted ring
(supervisor and installer on the hub side) is not a plug-in. The extension host
implements loading, grants, and these contracts; the word “extension” in its
package name does not make it an extension. A concrete resolver, check runner,
environment, wiki, archive, or forge integration remains an extension even when
first-party, signed, or shipped by default. Concrete agent adapters are distinct
from their registry/contract; the base's `@deepbuild/adapters` package documents the
latter role. No permission to import arbitrary concrete adapters follows from it.

`graph.mjs` freezes the base package-role map, corroborated by those packages'
base READMEs, rather than inferring roles from the candidate's chosen imports.
The core roots cover contracts, record/evidence, asks/budget, gate/verdicts/leases,
adapter registry, conformance, readings, runner, supervisor and extension host.
They also include **the issue-named `packages/hub/src/core.ts`**: the issue and base
hub README both identify it as the core. No new implementation filename, seam
class, method name or count is required. Imports are followed through helpers,
barrels, type edges and shared services, stopping and reporting at an extension.
Renaming a helper cannot hide an edge. A missing issue-named core or a new workspace
package without a reviewed role is BLOCKED rather than silently omitted.

The entire hub package is **not** declared core: the design says it hosts both
core and extensions. Its CLI/client entry and an outer composition layer may
connect them. That does not make code imported by the core an exempt composition
layer. Wiring may supply providers inward through contracts/options without an
outward core import. The base hub README permits the *package* to import shipped
extensions; it does not override AC3 for the *core*. Accordingly, existing core
imports are not an allowlist: **“never” has no “new” qualifier**.

The base mixes responsibilities: it has five direct extension edges from the
issue-named core, plus fifteen further edges in its dependency closure. These are
reported, not grandfathered. The package `gate` contains the mandatory floor;
classifying it as the replaceable done-gate plug-in solely by name would be wrong.
Conversely, the oracle cannot detect an extension implementation copied into a
core-labelled file. Semantic responsibility still needs independent review.

**Precise clarification, only if this boundary is contested:** does the owner
intend the issue-named hub core (and dependencies it reaches) to obey the absolute
boundary, as drafted here, or intend part of that very module to be a composition
root outside core? If the latter, the person must specify the responsibility
boundary and how it remains independently checkable. Neither the current imports
nor merely renaming their containing file establishes an exemption. No answer is
assumed, no criterion is waived, and the test remains red pending the normal
one-redraft adjudication. No second draft or comparison was made here.

## Public entry and behavior

This redraft changes neither. The base hub manifest publishes `.`, `./hub`,
`./lease`, `./mcp`, and `./mcp-exec`; the main entry exposes command wrappers, not
an exported `Core` that a test should demand. Internal extraction or inward
provider injection can retain those public entries and the same socket/hook/MCP
behavior. The boundary check does not require moving or removing public exports,
changing command signatures, dropping a shipped feature, disabling guards, or
changing how checks and answers are judged.

The existing `tests/package-deps.test.mjs` was reused unchanged: **2/2 passed**.
It checks declared workspace dependencies and relative cross-package source
imports in its supported syntax. It does **not** prove unchanged exported types,
all public-subpath rules, module acyclicity, or behavioral equivalence. Do not
promote that result into those claims.

Behavioral proof belongs to AC1, outside this AC3-only job. Existing
`packages/hub/test/extensions.test.ts` exercises real socket replies with/without
a loaded extension, guard precedence, late handlers and recorded events;
`packages/hub/test/gate-stop.test.ts` exercises the real stop path. These are not
duplicated or run here. The full issue still needs its affected before/after
results and moved twins. A green dependency graph alone cannot close #1687.

## What the graph checks prove

- Enumerate production JS/TS under `packages/` and `adapters/`, including runtime
  modules and declarations; exclude test/fixture/kit/corpus/build output and native
  build helpers. Read only selected pinned-base blobs and current source files;
  do not execute the product. Non-code data is a terminal dependency.
- Parse with the existing TypeScript dependency. Include static imports, side
  effects, re-exports, literal dynamic imports, `require`, import-equals, and
  import-type queries. Resolve workspace entries/subpaths using manifests, relative
  paths, and the repo's `dist` → `src` convention. Unresolved local literals block.
- Check **runtime** and **type-inclusive** graphs separately. `import type` and
  `export type` disappear at runtime but still couple architecture, so they count
  for the unqualified import-cycle/core-boundary criterion. With the base's
  `verbatimModuleSyntax`, `import { type T }` emits `import {}` and
  `export { type T } from` emits `export {} from`; both retain runtime edges.
  This was also confirmed directly with TypeScript 5.9.3. Declaration-file edges
  are architectural only. Dynamic literal edges describe possible, not necessarily
  eager, execution. A graph cycle does not itself prove a runtime failure.
- For each graph compare **cyclic directed file edges**, not package.json
  dependencies, edge counts, or SCC membership alone, against the fixed issue
  base. An edge is cyclic iff its target reaches its source. A new chord inside
  an existing SCC fails, as does an old acyclic edge newly placed on a cycle.
  An unchanged or removed cycle is not *new*. Type-to-runtime promotion can fail
  the runtime comparison even with an unchanged type-inclusive graph. Existing
  cycles remain reported design debt, not evidence that “no import cycles” holds.
- For the boundary check use the type-inclusive dependency closure. No baseline
  waiver, type exemption, or arbitrary helper exemption. This is stronger than
  searching the issue's three original files for package-name strings.

**Limits are not PASS:** this is not a typecheck, bundler, loader, API diff,
sandbox test, or execution test. It does not traverse third-party dependencies,
Rust/Swift modules, process/worker launch paths, `eval`, aliased loaders or custom
loader behavior. Export wildcard patterns, package aliases and unfamiliar local
resolution produce unresolved literals rather than guessed edges where detected.
Conditional resolution models this repository's development/types/default source
entries, not every possible deployment condition. The base contains **9 computed
import sites** whose targets need independent resolution; a separate completeness
assertion is deliberately **BLOCKED**, not an empty successful graph. Legitimate
plug-in loading is required by the design: this is an inability to prove those
edges statically, **not a new policy banning dynamic loading**. A future reviewer
must distinguish host-mediated loading under the contract from named concrete
extension imports, without weakening the core boundary.

## Requirement → check → wrong-program proof

| Requirement/guard | Check | Qualification |
|---|---|---|
| No new runtime cycle | `noCycles(..., true)` | planted three-file cycle, self-cycle, extra SCC chord, cross-package return edge, type-to-runtime promotion |
| No new type-inclusive cycle | `noCycles(..., false)` | planted type import/re-export cycle; unchanged and removed controls |
| Core never imports extension | `noExtensions` | same assertion rejects seven source forms at each of four locations (core, helper, asks, extension host), including public subpath and relative target; base itself is red |
| No missing input passes | `complete`, classification and completeness assertions | missing literal target, unknown package and computed import fixture each rejected |
| Graph algorithm, not a vacuous assertion | `cyclicEdges` qualification | all 512 directed three-node graphs checked against independent transitive closure |

All **five qualification tests passed**; violating fixtures are in-memory source
maps, never edited product files or copies of existing acceptance twins. Tests
assert the actual acceptance assertion rejects each planted violation, not merely
that a fixture contains an import string.

## Runs and exact results

Commands (from repository root):

```sh
node --test --test-reporter=tap tests/acceptance/1687/ac3-redraft/ac3.test.mjs
node --test --test-reporter=tap tests/package-deps.test.mjs
node scripts/affected.mjs --list tests/acceptance/1687/ac3-redraft/ac3.test.mjs tests/acceptance/1687/ac3-redraft/graph.mjs
```

| Saved output (under this directory) | Exit | Result |
|---|---:|---|
| `runs/ac3-base.tap` | 1 | 9 tests: **7 passed, 2 failed**, 0 skipped; 5 qualification passes, 2 literal-cycle comparison passes, absolute boundary FAIL, computed-target completeness BLOCKED (Node represents the latter as a failed assertion) |
| `runs/package-deps.tap` | 0 | 2 passed, 0 failed/skipped; reused check only |
| `runs/affected-list.txt` | 1 | Selection failed before running checks: `cargo` absent from PATH; existing runner throws `TypeError` in `crates()` while accessing missing `stderr` |
| `runs/base-inventory.json` | — | 359 modules; 2 runtime and 17 type-inclusive cyclic edges; 20 forbidden boundary edges; 9 computed import sites; literal unresolved list empty |

Each command's numeric exit is also saved in the matching `.exit` file. Local
checkout prefixes in TAP/stack output are redacted to `<repo>`; assertions,
relative source paths and results are unchanged. Inventory is a reading, not a
separate acceptance pass. All test commands ran once, without retries or edits
to a failing test. Dependencies were already available; no install was needed.

**Affected WIDE/INCONCLUSIVE lines:** none emitted; selection crashed before those
reports. Thus affected verification is **BLOCKED**, not PASS or “no affected
checks.” Only selection was attempted: the full runner would also invoke broad
lint lanes, beyond the user's direct-structural-test scope. No full build, suites,
preflight, API comparison or behavioral regression run was performed.

Delivery review: all added code serves AC3 or qualifies its oracle; 278 JS lines.
With this explanation the handwritten total exceeds the approximate 400-line PR
guideline. It stays together because this is the one blind redraft: its boundary,
planted-oracle proof and explicit proof limits must accompany the frozen tests,
not become a second draft or a separate policy change. No product code is added.
Only this redraft directory is untracked; tracked product and check files are
unchanged. **AC3 is not proven at base, and no full-issue closure is claimed.**

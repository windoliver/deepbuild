# Approved AC3 computed-loader disposition

This is the independent check-owner implementation of the user-approved
`reports/issue-1687-boundary-proposal.md`, not a second blind draft or a signed
approval token. Original `runs/` evidence is unchanged. The nine-site table is
`reviewed-loaders.json`: file, diagnostic line, exact expression, SHA-256 AST
expression and containing-declaration identity, permitted input origin, required
boundary and proof references. Line shifts/comments do not change identity;
changed code, a new/missing loader or a changed trust-chain input fails review.

## Concrete review

| Site | Disposition / boundary |
|---|---|
| conformance `bin.ts` `main` | Explicit standalone CLI `--fill` operand, resolved as a file URL. This tool executes the caller's chosen fill, not a hub extension install. No sandbox claim. Freeze its CLI-only provenance. |
| extension-host `deep.mjs` default `imports` | Unrestricted default, **unused** by both production callers. Freeze the caller inventory and their third argument; adding a caller or dropping the explicit importer blocks. |
| extension-host `runner.mjs` `import(url)` | Private host-supplied snapshot folder, fixed `index.ts` or host-enumerated test file, running **inside** the supervisor's sandbox. Optional stripped TypeScript retains that file URL. |
| extension-host `Host.start` `import(url)` | Snapshot `index.ts`, digest/start query. Hub placement requires builtBy=null and exact release id/version/digest; otherwise sandbox. Trust and conformance for those bytes checked before load. |
| extension-host `Host.start` test callback | Only `Host.runTests` sends this method: recursive `tests/` enumeration with `.test.ts/.mjs/.js` suffix under the same snapshot; no dispatch argument chooses a module. Snapshot digest refuses symlinks. |
| original Core host loader | **Unsafe in core**: arbitrary `CoreOptions.host` could name a concrete extension. Not grandfathered. Implementation moves it to the outer `hub-runtime.ts` provider, with no core import back to that module. |
| original search index loader | Same unsafe in-core arbitrary path; moved to outer `hub-runtime.ts`. Inward index capability remains on the original clock/thread. |
| hub `mcp.ts` directory loader | Explicit `mcp-loads-hub` wrong-program plant. Add **all** top-level hub source counterparts of built `.js` files to both graphs, including its self-edge. Do not exempt its cycles. |
| pi `index.ts` version import | Type-cast constant `@earendil-works/pi-coding-agent`; add its literal external edge. It is not a dynamic user path. |

The two provider loaders are safe for this criterion only **outside the core's
transitive, type-inclusive closure**. The review independently checks that
condition. Importing the runtime back into core fails both review and the
unchanged `noExtensions` assertion. No exemption allows a fixed concrete
extension specifier, a new loader, or a changed path transformation to disappear.
Core roots/classification, type-inclusive cycles and absolute extension boundary
are unchanged. Static extra edges are used by cycle and boundary assertions,
not just printed as documentation. Base arbitrary core loaders stay BLOCKED.

## Dynamic proof, not an allowlist

Reused unchanged `348/places.test.ts` and `348/conformance.test.ts`: 11/11 passed
in the recorded run. Real record/supervisor/sandbox, tracked child PID, canary
refusal versus in-process control, changed release bytes, exact conformance
digest and the `hub-unless-agent-built` wrong program are exercised.

Reused `103/wiring.test.ts` AC15 only: 3/3 selected cases passed; seven unrelated
cases were deselected, not counted. This executes package tests in the sandbox.

`loader-boundary.test.ts` fills the missing proof for **both** test-file callbacks:
a nested test module must execute exactly one test, in the expected real process,
with the sandbox denying an outside canary and the released control reading it.
Missing/no-op importers, errors and zero tests cannot pass. The same scenario
rejects the planted in-process unlisted package. Three cases passed.

Structural qualification mutates the actual source snapshot, not the review:
new loader file, changed import expression, `tests/` path escaping to `..`, a
core-to-runtime import and a hidden new core loader each fail `completeReview`.
The original base also fails it. The first combined structural run passed 25/25;
with the added concrete edges the base/current cyclic counts were runtime 3/3,
type-inclusive 18/16, and concrete extension boundary violations 20/0.
These are local source/test results, not release, signature or full-issue PASS.

## Limits and maintenance

AST identity is a conservative review lock, not a proof of arbitrary JavaScript
semantics. A trust-chain source edit blocks until independently reviewed; agents
must not refresh hashes to finish. This remains a module-graph check, not a
sandbox verification on every platform, alias/eval detector, package-manager
resolution proof, or third-party dependency audit. External modules remain
terminal graph nodes. Dynamic installed package targets are bounded by the
reviewed host contract and real sandbox proof, not treated as statically known
files. All commands/results, equality audit and exact approval mapping are saved
under `/tmp/deep-1687-check-owner-*`; final handoff names unrun checks.

The repo's guarded-check signed approval mechanism still applies before landing.
The user's scoped approval authorizes these edits but this file/table does not
fabricate a signature, approval tag or token.

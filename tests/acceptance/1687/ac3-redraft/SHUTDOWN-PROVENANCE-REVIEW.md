# Shutdown-only provenance continuation

Authority: the user's final loader-review continuation of the already approved
`reports/issue-1687-boundary-proposal.md`. This permits only the current
`packages/hub/src/core.ts` input digest correction after independent review; it
is not a new criterion, an automatic re-record, or a signed approval token.

HEAD `acc5121c5ee839e1eff8c51fb13eacc0a30c5894` predates the production DI
worktree, so comparing with HEAD alone would misidentify the reviewed delta.
Reversing exactly `await this.state.flushStates();` to
`await this.state.stating;` in current Core reproduces the full-source AST digest
already frozen in the review table:

- Prior: `e6507f889d948cbc9347a3eadada4b5eca295ad78f993f0899edc6e2595372f2`
- Current: `b5a1d4ab6dfd6a2ee3a2129745ab801089bdea7cbe3979f81f83fcef6149efa8`

The member comparison changes only `Core.stop`; imports and both inward loader
provider calls are identical. Inspection of `SessionState` finds retained timer
and wake handles, cancellation/resolution of the 200 ms debounce, and shutdown
waiting through `statesSettled()`. `Core.stop` already sets `stopping` before
this drain, and retains its final `recordStates()` call. This changes shutdown
scheduling, not module selection or provider-input provenance.

All nine loader expression/scope identities, the other nine locked input
sources, both `extensionSide` callers, and all four provider-call identities
still match. The host and index loaders remain in outer `hub-runtime.ts`;
Core passes the same `this.options.host` / `this.options.index` values. Server
input selection and worker/inline construction are unchanged from the reviewed
snapshot. Core cannot reach the outer runtime through its type-inclusive graph.
No loader disposition, base digest, proof reference, cycle rule, or absolute
extension-boundary assertion is changed.

Before correction the unchanged completeness test failed solely with
`reviewed input/guard changed: packages/hub/src/core.ts`. Proof, the exact
one-line reconstructed-source diff, source hashes, affected selection, test
outputs and final integrity audit are under `/tmp/deep-1687-loader-final-*`.
The existing source-mutant oracle remains unchanged. No #822 setup, assertion,
fake-clock behavior or cleanup is edited; its two standalone cases and five
invalid-deadline cases remain seven. Shutdown runtime verification and broader
issue closure belong to the parent, not this provenance review.

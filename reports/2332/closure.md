# #2332 closure attempt on current main

**BLOCKED / draft only.** Base `d8c46f0d58162ff0a4a483544149316aec960637`; implementation correction `c5b6ac163`. The earlier −26.056% reading in `measurements.json` is historical, not a verdict for this merge base.

## Code gaps corrected

| Gap | Change | Proof so far |
| --- | --- | --- |
| First hooks still launched Git for an empty product store in a folder without a spec | `Products.hook` bypasses discovery only when no stored/placed products exist and no spec covers the folder. It does not bypass guard observation when any product exists. | The existing products-start scenario through the real hub recorded one product Git lookup before, zero after; saved assertion failure and success. Same scenario now passes. Full affected test is unrun. |
| Startup-memory regression expects the kind-table module at core readiness | `Kinds` routing module is loaded statically; `openKinds` imports actual fills at first use. Speed-check implementation imports are deferred, not the table. | Existing startup-memory criterion failed before and passed after through the real hub's module-loader trace. Hub TypeScript build exits 0. Full existing test remains unrun for lack of grant. |
| First-hook non-increase was judged as “no statistically detected rise” | Independent blind closure check and fresh blind redraft, exact 0% threshold, uncertainty never PASS | Both drafts retained byte-for-byte with hashes. Redraft self-tests passed; real complete comparison has not run. |

## Blind check dispute

`tests/acceptance/2332/closure/` cannot run against the real protocol: its positive control sends `matched: []` for `pkill -f node`, then expects the hub to deny it. The design assigns matching to `deep-hook`; the hub consumes matched entries and does not parse shell text. An unchanged-code sanity run is INVALID/INCONCLUSIVE on that control, not evidence of a production failure. No implementation was changed to accommodate it.

The one blind redraft in `closure-redraft/` received the issue, design and base only, never the dispute, first draft or implementation. It instead requires acknowledgements and each actual event through `events.read`; the base sanity run reached those assertions. It adds a bounded-quiescence check and requires 20 pairs, exact thresholds, and valid machine fingerprints before/after memory samples. Its full real run is unrun. On 2026-11-15 the owner explicitly answered **yes** to using the protocol-correct redraft. `scripts/lanes.mjs` now routes the redraft acceptance through a timed grant, while retaining the original loose comparison by hand. Neither draft's bytes changed; both remain present, and the invalid first closure draft's failure remains disclosed.

## Check results and environment

- Candidate hub build: `tsc -p packages/hub/tsconfig.json`, exit 0 after the code changes.
- `node scripts/affected.mjs packages/hub/test/startup-memory.test.ts`: `FAIL affected: 92 new, 0 already failing on main, 11 inconclusive or blocked, 0 listed skips, 0 passed` after 1,865 s. It explicitly reports `INCONCLUSIVE ... no test grant came within 30 min`; ten queued lint jobs also got no grant. Other findings include existing code mappings and environment-kit probes blocked by `ps`/`lsof` failures under load. They were **not** waived or recorded into known failures.
- WIDE: none in selection. Whole source selection reaches 2,181 tests and two Rust crates; this closure attempt has not run them. Prior focused results are documented separately in `README.md` and are not reused as current-main passes.
- Both initial workspace builds got `INCONCLUSIVE no grant` after 10 minutes. A subsequent base build was stopped after another 16 minutes in the queue, before it ran. Only owned job PIDs were stopped.
- The strict real-hub sanity run on the previously built base recorded valid hook replies and events, but all three hooks failed to settle in the frozen 20 s bound. The two-side diagnostic hit its overall 180 s deadline. No sample was discarded or retried to obtain a pass.
- Current-base lint comparison was attempted; both sides of repo-rules and vendor-rebase timed out. The comparison then hit its overall deadline. Null exit statuses are **INCONCLUSIVE**, not equality/PASS. Last turn's base comparisons remain historical only.
- OS fingerprint: Mac17,10 / Apple M5 Max / 64 GiB / macOS 26B8119 / Node 24.22.2; **battery**, Low Power Mode off, thermal **fair**. Load readings exceeded 300 on 18 cores. AC3 is INCONCLUSIVE until mains and thermal nominal; budget work also needs the scheduled timed grant.
- Original acceptance files and both closure drafts are unchanged. No frozen budget, schema, decision, known-failure table or test expectation was changed.

## To complete

1. Connect mains power and let the machine reach thermal nominal; wait for the existing build/test queues, without killing other sessions.
2. Build the current main base and candidate through the existing throttle. Rebuild `deep-hook` in each checkout if absent; no target sharing.
3. **Approved:** use `closure-redraft/` as the executable closure check; retain the protocol-invalid `closure/` draft unchanged. The owner need not answer this again.
4. Run the frozen redraft once on both fully built trees, with `DEEP_2332_BASE` pointing to the base and `DEEP_2332_EVIDENCE` to a new evidence directory. Keep its default thresholds; do not tune `DEEP_2332_QUIET` after seeing results. Require 20 valid alternated pairs and nominal-thermal memory. Separately run the existing budget-task proof.
5. Complete `node scripts/affected.mjs` and compare unrelated failures against the same main without weakening them. Disclose every WIDE/INCONCLUSIVE line and unresolved failure.
6. Only then replace `Part of #2332` with `Closes #2332` and mark the PR ready.

## Deviations retained

The blind redraft job started extra evidence-copy builds despite being told to leave builds to the parent; those were stopped by their owned PIDs and do not count as successful builds. The implementation diagnostics manually reached the existing test assertions while the official affected invocation was waiting for its grant; these do not replace that unrun invocation. The supplemental blind scripts are larger than requested; they are preserved rather than edited by the implementation agent. No test, check or golden was edited to finish.

# #2068 acceptance draft

**Base:** `1c4d1f0e2aaad8c6a6573848823566d04ff73d17`.
**Status: UNRUN.** No build, typecheck, test, base failure or fixed result has been observed in this restricted drafting job. Expected failures below are predictions from the base code, not PASS/FAIL evidence.

## Entry

From the repository root, with the base's dependencies already installed, Node **24.22+**, git and the Rust toolchain:

```sh
npm run build --workspaces && cargo build --locked -q -p deep-hook && node node_modules/vitest/vitest.mjs run --config tests/acceptance/2068/vitest.config.ts
```

Separate unrun static check:

```sh
node node_modules/typescript/bin/tsc -p tests/acceptance/2068/tsconfig.json
```

The entry runs the four new cases serially and **unchanged** `tests/acceptance/322/github.test.ts`. That existing file needs the real deep-hook binary. Its several role/negative-control scenarios can take minutes. A missing dependency, failed build/import/setup, timeout, skipped test or INCONCLUSIVE message is not acceptance proof. There is no base/branch switch or expected-failure wrapper around the new tests.

## Criterion → assertion

Criteria are numbered by checkbox order in `ISSUE-2068.json`.

| Criterion | Proof / named assertions |
|---|---|
| AC1: A's issue prompt, B PostToolUse 100 ms later, each forge request takes 5 s; B records before the first answer | `forge-wait.test.ts`, **AC1 forge wait**: exact B hook ID, session and `tool.after`; first committed observation precedes the forge's first response attempt. Both sockets are opened before the interval. A is not awaited before sending B. Every request in this fixture uses a real 5,000 ms timer. |
| AC2: never-answering forge, bounded prompt recording and task from your words | **AC2 never forge wait**: prompt and task committed by the acknowledged outer hold; prompt keeps its text and person origin; task names the expired-token request and is referenced by that prompt. B must also be recorded by this bound. A returned hook alone cannot satisfy these assertions. |
| AC2: A's row says the issue could not be read | **AC2 forge wait: A's session row…** reads `rows.read {detail:true}`, the app/deep-status row surface, and requires both the source and inability to read it in its visible explanation/detail. A hidden log warning alone is insufficient. Soft assertions allow the base's missing warning to be reported alongside its wait failures. |
| Scope / AC2: one deadline for the whole read, not one renewed per request/page | **AC2 pages-forever forge wait**: issue succeeds, then successive comments pages answer without delay and advertise another page. The same prompt/task/words deadline assertions must hold despite continuing successful requests. This distinguishes a whole-read bound from shortened per-request timeouts. No extra product duration is chosen. |
| AC3: instant twin preserves criteria and authors/roles | **AC3 instant source**: two issue prompts, authored respectively by the repo owner and a collaborator listed only on membership page 2. No handed definition: real source criteria must become the opened tasks' full requirements, each carrying the correct author and role. |
| AC3: “each author's role, as #322 has it” | Reuse `322/github.test.ts`: AC4 outside comment, membership rather than signed text, owner attribution and outside-author addition; AC14 automated app account with write access; AC15 complete/incomplete paged membership. It asserts the locked requirements' authors/roles and retains its planted-wrong-reader controls. We do not duplicate those scenarios or their drafting/approval fixtures. |

## Measurement and expected base behavior

The new cases enter through **`deep hub run` and the published hook socket protocol**. They run the real parser workers, adapter, core, GitHub HTTP source, task machinery, SQLite writer and row projections. The test supplies agent input/transcript lines and live process identities, as the existing #85 hub tests do; it does not replace these components or import private kernel functions.

`ledger.db`'s design-published `events` table is observed through a **read-only** SQLite connection. Polls record a commit-visibility interval `(last scan, first scan finding the event]`, with `log_pos`. Event `ts`, minted at hook start, is **not** a commit time. An `events.read` RPC would queue behind the defect and confound the measurement. A final scan immediately before each HTTP answer makes the AC1 ordering directly observable.

Each measured case prints one `ISSUE2068_TIMING` JSON line **before** its wait assertions, including:

- configured 100 ms offset and actual B socket-send offset;
- A/B commit-observation intervals relative to A's send;
- every forge request/answer time, and whether the client had already disconnected;
- B's first committed observation minus the first forge answer;
- for AC2, the publicly acknowledged hold and deadline snapshots;
- date, Node version, OS platform/architecture and the baseline SHA.

Preserve stdout from each unchanged base/fix run and label it externally with the commit actually run. `baseline` in the JSON always identifies the comparison baseline, **not** the executing revision. The test deliberately waits for B after a bad ordering instead of throwing at 5 s: on the base's five serial requests it should report about **25 s**; on a fix it should report B before the first **5 s** response attempt. AC2 should expose the base's roughly **20 s** request-timeout wait and missing row warning. These are **unmeasured expectations**, not assertions of a required implementation duration. The instant twin and reused #322 guards should pass on the base; none has been run here.

HTTP uses an OS-assigned port on `127.0.0.1` only (`DEEP_HUB_TEST_FORGE`, already present on the base). A never-answering request receives neither headers nor body. A cancelled slow request still gets its scheduled 5 s server response attempt, labelled disconnected; cancellation cannot turn the ordering into a vacuous pass. No global fetch replacement, fake clock, real token, model, real forge or live Internet call is needed. New worlds have isolated homes and disposable repos with no remote, an allowlisted environment, and an empty GH_TOKEN (no Authorization header and no `gh auth token`). Only owned child processes are stopped, by their child handles/PIDs.

## Interpretations / remaining gaps

- **Exact read deadline is unspecified and not exported on this base.** The relational check uses the prompt's existing `hold_until_ms`: the read and fallback must fit inside the hold advertised for that prompt's context. It asserts no new 500 ms/1 s/2 s read constant and does not require equality with the hold. This proves an externally useful upper bound, **not** compliance with a separately chosen, shorter internal deadline. If “within the read's deadline” is intended to permit a read outliving that prompt hold, that relation needs an owner decision/blind redraft; do not silently weaken the check. No private constant or invented setting is used.
- The scope's whole-read condition gets one adversarial paging case. It does not prescribe an abort mechanism, a retry policy, a page cap, or resource reclamation beyond the observed bound. Credential-acquisition latency is not exercised: obtaining real credentials is prohibited and no public token-delay fixture exists here. That portion of the overall read remains unproven.
- Warning **wording and placement within a row are not fixed** by the issue. The check accepts source/read-failure vocabulary in existing visible explanation fields or deep-status row detail, without an exact message, flag code or state word. It does not demand “stuck”, a particular schema revision, a particular task-ID spelling or a new RPC. A semantically equivalent message outside that vocabulary needs review, not automatic re-recording. The warning's own deadline/persistence is not stated; its final visible presence is checked, while prompt/task commitment is checked at the hold.
- Native timers/socket delivery have scheduling jitter. We retain literal 5 s timers and a 100 ms send separation and report actual times, rather than substituting faster fixtures or asserting a new tolerance. If the forge had not begun by B's arrival, AC1 reports INCONCLUSIVE, never PASS. Poll intervals straddling a deadline likewise report INCONCLUSIVE. The time figures are causal-test readings, **not** a p50/p95 speed claim or the design's reference-Mac budget proof. Scheduled multi-sample budget checks, machine fingerprints/power/thermals, and fixed-commit runs remain unrun.
- The Rust hook client's forwarding/fail-open and native app rendering are not re-proven by the new cases; they enter at the named hook protocol and row API. The reused #322 cases do exercise deep-hook. No new acceptance lane registration or production change is made.

## Provenance

Independent, pre-implementation draft made solely from this archive: `AGENTS.md`, `ISSUE-2068.json`, the design's **One event log**, **Numbers version 0 has to hold**, **What done means, fixed at the start**, **Dogfooding**, and the hook protocol; relevant base hub/record/adapter code and exports; #16, #85 and #322 test conventions. `helpers.ts` reuses #16's existing `Conn`/control/ID helpers (same repository/license); #322's role proof is run in place, not copied or edited. No working session, worktree, diff, transcript from a working agent, external path, or implementation was accessed. Only new files in this directory were written. Requirement-to-assertion review was static; nothing missing or unrun is PASS.

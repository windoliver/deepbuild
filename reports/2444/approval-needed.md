# Decisions needed to finish #2444

This is a request for approval, not a change to any existing check or requirement. No listed result below is a full preflight PASS.

## Automatic work completed

- AC1's listed/unlisted runner behavior, current-main diagnostic and incomplete-report protections have passing fixture proof.
- The two #1622 Effect entries passed unchanged on clean `ccbdefd1f1a6a475732d2e00cc047b3cc39e02bd` after its pinned spike dependencies were installed. Both entries were removed, without changing their checks, dates or expected values (`effect-clean-main.txt`).
- #1114's unchanged check found 20 missing timing classifications. Those files now join `timed`; 11 automated budget files missing from `alone` now run serially. The original check and the independently drafted #1624 AC2 checks pass (`1624-timed-green.txt`). No checks were removed.
- A reproduced runner bug could turn the #327 custom harness's BLOCKED cases into a LISTED target. Cargo's result reader now preserves the actual BLOCKED case and summary. Five relevant checks pass (`cargo-blocked-red.txt`, `cargo-blocked-green.txt`). This closes a false-pass gap; it does not excuse the manual work.

## Approval request: correct check defects, retaining the required behavior

### 1. #1624: automatic lane membership versus by-hand tests

The existing `tests/preflight.test.mjs` scans `plans.ts` as a directory and never reaches its assertions. A blind job proposed directory-only enumeration; all assertions remain. The proposal is **not applied** (`tests/acceptance/1624/preflight-folders-only.patch.md`).

After the legitimate automatic-list corrections, that proposal still fails because it demands these already-by-hand tests appear in the automatic serial block:

- `tests/acceptance/112/live.test.ts`
- `tests/acceptance/21/sessions.live.test.ts`
- `tests/acceptance/824/budgets.long.test.ts`

A fresh job with the same base/issue/design only, no work or dispute, independently redrafted the check. It fails on exactly those three files too (`1624-redraft-result.txt`). No further blind redraft will be requested for this dispute.

**Decision requested:** confirm that the automated serial-block invariant applies to tests actually selected for that local lane, while tests deliberately assigned by-hand or their own lane remain explicitly unrun there. Approve a separately reviewable correction of the existing discovery/check to use that selected set, with planted coverage proving that an automated timing file missing from the serial block still fails and no by-hand test is silently run. Also approve #1624's explicitly requested `1330/start.live.test.ts` by-hand classification after its real file-list check can run. This does not count an unrun criterion as PASS or remove the live-test requirements; they remain separately required at their named depth.

Without that decision, the faithful original and redrafted checks stand failing. Adding live files to `alone` only to make the check pass would start plan-spending tests the design says are by-hand; that is not an acceptable workaround.

### 2. #1620: the planted loader is no longer a wrong program

`tests/acceptance/326/panels/planted.rs` calls the real `deep_app::mount_panel`, expecting it to access a dependency host. The product now correctly refuses that dependency before fetching. Re-enabling the fetch would violate #326 and weaken security.

A blind job proposes a standalone wrong loader through gpui-shell's original loader, with real loopback observations and the same refusal/no-network requirement. See `tests/acceptance/1620/README.md` and `planted_loader_proposal.rs`. It is **uncompiled, unwired and unadopted**. The original check is unchanged.

**Decision requested:** approve validating and, only once proven, adopting the independent wrong-program correction as a separate check-only commit, retaining the real product's refusal check unchanged. The original required failure remains until approval and proof; no known-failure removal before that.

### 3. #327: actual accessibility evidence, not a hard-coded BLOCKED placeholder

Three cases in `tests/acceptance/327/card.rs:169-194` always panic BLOCKED: Voice Control, Switch Control and VoiceOver. The common harness counts these as unrun and returns nonzero. The README asks a person to record results, but the code has no input that can consume such a record. Product changes cannot make those checks pass.

**Decision requested:** approve commissioning a blind evidence-ingestion check, bound to the actual tested commit, seven card kinds and required interactions, rejecting missing/stale evidence. A person must then perform the Voice Control/Switch Control confirmation-and-cancellation steps and VoiceOver spoken-content steps described in `tests/acceptance/327/README.md`. No such evidence exists here, and no fixture or agent statement substitutes for it. The manual criteria remain required; nothing will skip, retire or auto-pass them.

### 4. #1623: literal terminal fixture versus the no-literal census

The remaining census failure is two wire-color literals in an existing `#[cfg(test)]` case in `crates/deep-app/src/cells.rs`. They have dated guard exceptions, but #882's census deliberately accepts no literal even in a test. The blind assessment is `tests/acceptance/1623/PROPOSAL.md`.

**Decision requested:** approve a separate test-fixture correction using the look's actual terminal palette as input and preserving the parser's run/fill/cursor assertions plus an explicit non-background fill contrast. This changes fixture values and therefore needs approval despite the drafting job calling it “product code only.” The implementer has not applied it. Moving/encoding the same literals just to evade the census is rejected.

## Required process and measurement after the decisions

- Protected tooling commits need the maintainer's hardware-backed SSH approval tags, under the documented `README.md#approve-an-edit-to-a-check` process. No agent may sign or push those tags.
- Workspace preparation is still awaiting the machine's real build grant. The first 60-minute wait returned `INCONCLUSIVE no grant`, exit 3, without building (`workspace-prepare-no-grant.txt`). An explicitly resumed setup run is pending; it is not proof. That build is needed before the memory-overrule test, Vitest's real lane listing and broader verification can run.
- Resolve the five remaining listed entries and any unlisted failures without changing checks to finish. Run affected checks once per correction and preserve every unrun result.
- Only after the required checks and approvals, measure a full preflight on clean **current main** on a quiet reference Mac, with nominal thermal state, actual date/load/output/elapsed time. The 900 s budget is unchanged. A budget proposal, if needed, requires an actual measured run and separate approval. This PR cannot assert AC2 from a branch fixture or a grant wait.

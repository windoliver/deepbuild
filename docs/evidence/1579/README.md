# #1579 evidence: a signature says what it's for

Run on the Linux box (spark-c89f, Node 24.22.0), branch `claude/issue-1579-signature-scope-9ba6fa` against merge base `6042ef5a`.

## Manual end to end against a real hub

`e2e.test.ts.txt` is the driver (run with `vitest --globals` from a scratch folder, `E2E_REPO` naming the checkout). It starts a
real `deep hub run` with `HOME` a temp folder through suite 1579's helpers, pairs a device with the OS stand-in, and sends each
signed request over the hub's socket as the app does. Each request (sig cut short) and the hub's reply are printed verbatim.

- `e2e-branch.txt`, this branch:
  - **1.** A signed undo counts.
  - **2. Wrong method.** The same signature sent as `ask.answer` is refused at `/params/signature/signed/method`, naming `ask.undo`.
  - **3. Cross-hub.** A signature for another hub is refused at `/params/signature/signed/hub`, naming both hub IDs.
  - **4. Stale.** A signature 11 minutes old on the hub's clock is refused at `/params/signature/signed/at`.
  - **5. Replayed.** The spent undo, replayed from another connection after the ask defaulted again, is refused at `/params/signature/signed/once`.
  - **6–7.** A fresh answer and a signed unpair count.
  - Inbox outcomes after the run: the refused asks stay `unanswered`, and the undo's ask stays `defaulted`.
- `e2e-base.txt`: suite 1579's `base/merge-base.check.ts` run at the merge base.
  - It accepts the undo's signature on `ask.answer`.
  - It accepts a signature 11 minutes old, and a replayed undo.
  - It refuses a signed unpair whichever device signs it.

## Suites

- `tests/acceptance/1579`, on this branch:
  - `signatures.test.ts` and `design.test.ts`: 15/15 pass, the planted `signature-skips-time` hub failing the kit at `at` alone.
  - `app.test.ts`: the hub half and the judge's own check pass. The app half is BLOCKED here, because deep-app doesn't compile
    on Linux at main (`gpui-pre-wgpu`, E0004 `PrimitiveBatch::Chrome`). It needs the Mac.
  - At the base, see `tests/acceptance/1579/BASE-FAILURE.txt`.
- `node scripts/affected.mjs`: `FAIL affected: 1463 new, 186 already failing on main, 535 inconclusive or blocked, 21 listed skips,
  1945 passed, in 15231 s`. No WIDE line. The INCONCLUSIVE lines are:
  - 242 macOS-only or missing-input tests (replica, Metal, launchd, real pi, Codex);
  - 53 timed files not run;
  - 29 slow files not run.
- The "new" list, checked against the merge base:
  - **The lint lines (fmt, clippy, secrets, deps, canvas-lint, slots, guide).** They are in files this change doesn't touch.
  - **171 test files: every NEW-failing test was run at the merge base.** 232 fail there too. Of the 55 that didn't, 30 files were
    run again on the branch, and all pass but the cases below:
    - `tests/acceptance/340/flow/terminal.test.ts` fails at the base too.
    - `tests/acceptance/1097/warn.test.ts` failed on deep-hook's 50 ms sync at load 21, and passes twice on the branch and twice
      at the base at load 12.
    - `env-resources`, `1556/twins` and `39/replies` (no codex) fail at the base too.
  - **Caused by this change:** five tests in `tests/acceptance/34/answers.test.ts` failed, because #34's `signed()` helper
    signed in the retired format. A hand edit of the helper (`helper-draft-hand.diff`) was reverted. The owner chose the
    design's blind redraft, so a fresh job redrafted the helper from #1579's issue and the base alone
    (`helper-draft-blind.md`). The suite fails 5/7 with the base helper and passes 7/7 with the redraft, with no assertion
    changed. The rest of suite 34 fails as it does at the base: `app.test.ts` can't build deep-app on Linux, and the 5
    `stream.test.ts` tests fail at the base too. `tests/acceptance/327` fails only `answers-redraft/ac2.test.ts`, as it
    does at the base (the ask "was already answered").
- `tests/acceptance/65` (channels): 27/30 fail at the base and on the branch alike on Linux, because `deep install` refuses the
  channel packages' envelope digest here.
  - On the Mac at a1e0e945, the branch and the base shared 17 failures. One test was new: AC16, where a phone's answer
    replayed to a second hub was refused naming `card_hash` instead of `hub`.
  - The channel now judges hub, device and key before the card it never sent.
  - The re-run on the Mac at the new head is pending.

## The app on the Mac

At a1e0e945 the suite `tests/acceptance/1579` passed 18/18, the app half included. deep-app's `device::` tests and
`confirm-enroll` passed too. Since then the app and the hub's trusted path haven't changed; only the channel check order
and the test helpers have.

# #34's signed(): the blind redraft

The owner sent the hand edit of #34's `signed()` (kept as `helper-draft-hand.diff`) to the design's blind redraft
(Dogfooding). A fresh job saw only #1579's issue and the base commit's tree (`git archive 6042ef5a`, no history, no branch
code) and wrote `tests/acceptance/34/helpers.ts` and `tests/acceptance/65/helpers.ts` as committed here.

The readings it chose where the issue leaves the format open:

- The envelope is `signature: { signed, sig }`, as phones and channels sign at base, for the issue's one verifier.
- The fields are `device`, `method`, `hub` (the hello's `hub`), `at` (ms), `once` (a fresh UUID) and `params_hash`.
  `params_hash` is SHA-256 hex over the RFC 8785 bytes of every param but `signature`, the `device` param included.
- The method is `ask.answer`, because every caller sends one.
- For a forged key (`{ id }` of another paired device), it signs that device's hub, so the forgery differs only in its key.
- Suite 65 reads the hub from one hello after its own raw `device.pair`.

Results on this branch: `answers.test.ts` failed 5/7 with the helper reverted to base, and passes 7/7 with the redraft. No
assertion or call site changed.

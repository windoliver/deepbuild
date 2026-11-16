# Human-signature gate for #2331's protected proposals

The owner approved the helper correction and later directed adoption in response to the exact two-file proposal.
Those instructions authorize the work but are not a fabricated security-key signature. The repository's actual
`readApprovals` returned no valid approvals for this change. The local SSH agent lists no identities.

A maintainer listed in `.deepbuild/approvers` must sign annotated tags under `deep/approved/` using the listed key's
normal touch/biometric path. Use the maintainer's existing secure-key setup; do not generate a new approver, substitute
a plain key, loosen the verifier or forge an authenticator flag. Each proposal is isolated to the files below.

| Commit | `Approves:` lines |
|---|---|
| `188fd91cdafb1b7d7aee3a3a9bef71c7dfb00d12` | `tests/acceptance/1463/helpers.ts` |
| `b1ba07ee96ca2f46cf082f0dc24d4f16878dce1c` | `tests/acceptance/1463/list.test.ts`; `tests/acceptance/992/agree.test.ts` |
| `a67f7dbaa46a60b7c009d877122c23e0c9cb97af` | `tests/acceptance/2331/kit.ts`; `tests/acceptance/2331/tsconfig.json`; `tests/acceptance/2331/twins.json`; `tests/acceptance/2331/twins/locale-clock/packages/hub/src/list.ts`; `tests/acceptance/2331/twins/utc-clock/packages/hub/src/list.ts` |
| `40cf1d64579b0e09d9df98a6e3833beb7d37ccd5` | `scripts/lanes.mjs` |
| `0fdd1716e97cc9bc2d11756f1e6f3768b523ae6d` | `tests/acceptance/2331-regression/tsconfig.json`; `tests/acceptance/2331-regression/twins.json`; `tests/acceptance/2331-regression/twins/utc-clock/packages/hub/src/list.ts` |

Example shape, after reviewing a proposal and using the maintainer's already configured signing identity:

```sh
git -c gpg.format=ssh tag -s deep/approved/188fd91cd-helper \
  188fd91cdafb1b7d7aee3a3a9bef71c7dfb00d12 \
  -m 'Approves: tests/acceptance/1463/helpers.ts'
```

For multiple files, put one `Approves: <path>` line per file in the tag message. Publish only the exact approval tags
created after that review, then run the real proof guard. No tag was created by this agent, and the guard is not
reported passing. The complete combined regression/timing/trace checks are separate gates; a signature does not make
an unrun or inconclusive check pass.

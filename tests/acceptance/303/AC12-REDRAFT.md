# AC12 blind redraft: `checkfile-redraft.test.ts`

## The criterion

`#303.ec3af335`, the issue's AC12 as the owner amended it on 2026-11-09, word for word:

> A drafted check file under `.deepbuild/` changed after the lock by a write the guard didn't recognize makes the next
> claim's recomputed hash differ from the locked one: the claim's checks run the approved bytes kept by digest in the
> hub, and the change becomes a proposal naming the file; a lock that hashes requirement records with check paths but
> not their bytes gives the same hash and fails this test

Every test name and failure message starts with `AC12 #303.ec3af335`.

## Inputs used

- The issue text, with AC12 as amended.
- `docs/technical-design.md`: How runs become one of five verdicts, **Protection** ("The guard is a first refusal; the
  record is the proof … the definition's hash covers the bytes of each drafted check … A write the guard didn't
  recognize changes no check: the claim is judged on the approved bytes, and the difference becomes a proposal naming
  the files"); What done means, **Locked** ("The core's gate runner recomputes the hash at every claim"); Threats, the
  row **What a command's children do** ("A hook sees the call an agent makes, such as `npm test`, never what the
  processes it starts do … claims are judged on the approved bytes of specs and drafted checks"); Dogfooding.
- The base commit `414947b4`: the suite's shared `helpers.ts`, `README.md` (The surface under test, Wrong programs),
  `fixtures/agent.mjs` and `tsconfig.json`, imported unchanged; the hub's surfaces `events.read` and `evidence.read`
  (`packages/hub/src/core.ts`), the `run.started`/`run.finished` and `learn.proposed` kinds, and the plant names
  `hash-check-paths` and `runs-disk-bytes` (`packages/hub/src/plant.ts`); the shipped guards,
  `crates/deep-hook/default-rules.json`, through `deep-hook match`.
- Not read: the first draft `checkfile.test.ts`, `BASE-FAILURE.txt`, other redraft notes, #322's suite, any history of
  them, the GitHub issues or PRs named in the brief.

## The write the guard didn't recognize

The agent (1) edits `package.json`'s test script to `node tools/fixup.mjs && node -e 0`, (2) writes `tools/fixup.mjs`,
whose source builds the check file's path from pieces (`['.deep', 'build', '/checks/'].join('')` + `'expired' +
'-token.sh'`), and (3) runs `npm test`, whose child rewrites `.deepbuild/checks/expired-token.sh` to `exit 0`.

Why this one: the design says the hook sees the call, `npm test`, "never what the processes it starts do", so a write
made by a command's child is the case the design itself names, where the guard is only a first refusal and the record
must be the proof. No call names `.deepbuild/`, so a guard that learns to read more forms of a call (interpreters'
`-c`, redirections, here-docs) still doesn't see it. A guard that did stop it makes the test BLOCKED, never a pass.

Checked on the base with `deep-hook match` and the shipped default rules (HOME a scratch home holding them):

| Call | Matched |
|---|---|
| `Bash npm test` | nothing |
| `Edit package.json` | nothing |
| `Write tools/fixup.mjs` (the helper) | nothing |
| `Bash python3 -c "open('.deepbuild/checks/expired-token.sh','w')…"` | `no-deepbuild-spec-write` |
| `Bash echo exit 0 > .deepbuild/checks/expired-token.sh` | `no-deepbuild-spec-write` |
| `Write .deepbuild/checks/expired-token.sh` | `no-deepbuild-spec-write` (denied) |

So `python3 -c` is a write the base's guard *does* recognize. In the test itself every call goes only when the session's
real deep-hook PreToolUse allows it.

## Scenario

One session, the handed definition for `make the auth middleware reject expired tokens` with R1's check the drafted
file (`asserts: [<file>:3]`) and R2 with none. Turn 1: the prompt, the lock, a Read and an Edit of `src/auth.ts`, a stop
(the control claim). Turn 2: the issue's typed question `explain how the auth middleware checks expiry` (opens no task;
its turn does work, so its stop is a claim, AC10), the three calls above, a stop (the next claim).

## Assertion to source

| Assertion | Source |
|---|---|
| The task's definition locks before the change (else BLOCKED) | criterion: "changed after the lock" |
| Each call is allowed by deep-hook, and the file on disk is rewritten (else BLOCKED) | criterion: "a write the guard didn't recognize"; design, children row |
| Control: the claim before the change recomputes the locked hash, and its run of R1 records `failed` | design, Locked; a control so "differs" is caused by the change |
| The next claim's recomputed hash differs from the locked one | criterion, first clause; design, Protection ("covers the bytes") |
| The lock's R1 names the SHA-256 of the file's bytes at the lock, and `evidence.read` finds it | criterion: "approved bytes kept by digest in the hub" |
| A `*.proposed` event after the change names the file | criterion: "the change becomes a proposal naming the file"; design, Protection |
| The next claim's run of R1 (`run.started` tied to the claim, `run.finished`) records `failed`, though the disk file exits 0 | criterion: "the claim's checks run the approved bytes"; README, The claim's run of R1's check |

## Wrong programs

| Plant | What it does | Assertion it fails |
|---|---|---|
| `hash-check-paths` | the lock and its recompute hash requirement records with check paths, not bytes | "… must make the next claim's recomputed hash differ from the locked one", naming the file |
| `runs-disk-bytes` | the claim's checks run the file on disk | "… the claim's checks run the approved bytes of `<file>` …", naming the file (the disk file exits 0, and its run records `uncounted`) |

Each twin test requires its message to carry its clause and `.deepbuild/checks/expired-token.sh`. A BLOCKED setup is
rethrown by `failureOf`, never read as the plant's failure.

## What was run, and what was not

Run on the base `414947b4` (Linux arm64): `npm ci`, `npm run build --workspaces`, `cargo build -p deep-hook`;
`npx tsc -p tests/acceptance/303/tsconfig.json --noEmit` (exit 0); `npx vitest run
tests/acceptance/303/checkfile-redraft.test.ts`: `Tests  3 passed (3)`. A throwaway copy that logged the twins'
messages showed `hash-check-paths` failing on "must make the next claim's recomputed hash differ from the locked one …
it recomputed the same: claim.made …" and `runs-disk-bytes` on "the claim's checks run the approved bytes of
.deepbuild/checks/expired-token.sh … it recorded run.finished … outcome uncounted"; the copy was deleted.

Not run: the rest of #303's suite, `scripts/affected.mjs`, the preflight, the Mac, and a real `claude` binary (the
test plays Claude Code, as the suite's README says).

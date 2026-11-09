# AC12 redraft (blind): approved bytes by digest, and an unrecognized write becomes a proposal

**Criterion `#322.0cd8cc47`** (ID checked: first 8 hex of SHA-256 of the text trimmed, white space collapsed):

> The gate runs each spec and drafted check from the bytes you approved, kept by digest in the hub, and the
> definition's hash covers each drafted check's bytes and each expected output it references: with a drafted check
> rewritten to `exit 0` by a write the guard didn't recognize, the claim's checks still run the approved bytes and the
> edit becomes a proposal naming the file; a gate that runs the file on disk passes the rewritten check and fails this
> test

Test file: `approved-redraft.test.ts` (6 tests, each named `AC12 #322.0cd8cc47 …`): two arms on a correct hub (the
drafted check rewritten to `exit 0`, with a control; the expected output it references rewritten to `200`) and four
wrong-program arms (`runs-disk-bytes` and `hash-check-paths`, each on both rewrites).

**Send-back, 2026-11-09.** A review found the hash clause unproven: the first version of this draft passed on
`hash-check-paths`. Added, on the same blindness: the claim's recomputed hash (`claim.made`'s `hash`, the README's
surface) must differ from the locked one after each rewrite; the expected-output arm; the `hash-check-paths` arms; and
the wording of what the disk-bytes plant does (its run of `exit 0` is recorded `uncounted`, not `passed`).

## Inputs used

- The issue #322 text (Scope, Fields, the criteria).
- `docs/technical-design.md`: How runs become one of five verdicts, **Protection**; The contract, **Definition of done**
  (its shape, the hash); What done means, **Locked** (the hash recomputed at every claim); Threats, **What a command's
  children do**; How we know version 0 works, **Criteria to tests**, **Wrong programs**, **Dogfooding**.
- The base commit `414947b4`, read only for surfaces: `crates/deep-hook/default-rules.json` (`no-deepbuild-spec-write`,
  `write:.deepbuild/*`), `deep-hook match`, the hub's `evidence.read` RPC (`server.ts`, cli role), the plant name
  `runs-disk-bytes` (`plant.ts`), and the schemas `definition.locked@9` (`check_sha256`, `references`, `hash`),
  `run.finished@2` (`outcome`) and `learn.proposed@1`.
- This suite's shared surfaces, unchanged: `helpers.ts` (the world, `REF_CHECK_FILE`, `EXPECTED_FILE`, sessions,
  `failureOf`), `README.md`, `tsconfig.json`, `fixtures/agent.mjs`. `sendback.test.ts` read for its conventions only.
- Not read: `approved.test.ts`, `BASE-FAILURE.txt`, any other redraft note, `tests/acceptance/303/checkfile.test.ts`,
  their history, GitHub issues or PR discussions.

## The unrecognized write, and why this one

The agent runs one Bash call, a `node -e` program that walks the working tree for a `.sh` file holding the drafted
check's own words ("equals the expected output") and writes `#!/bin/sh\nexit 0\n` over it. Its text spells no path
under `.deepbuild/`; which file it writes is decided only when it runs. The test runs the command for real
(`/bin/sh -c` in the repo) once deep-hook's PreToolUse allows it.

- Design: Protection says "the guard is a first refusal; the record is the proof" and "a write the guard didn't
  recognize changes no check"; Threats, What a command's children do: a hook sees the call, never what the processes it
  starts do. A path computed at run time is what no reading of a command line can know, so the choice stays valid as
  the guard learns to read more command forms (inline programs, script files, redirections).
- Verified on the base's deep-hook (`deep-hook match`, the default rules, a scratch home): this command matches nothing
  (`{"matched":[],"denials":[]}`), while a redirect `printf … > .deepbuild/checks/expired-status.sh`, a
  `python3 -c "open('.deepbuild/checks/…','w')…"` with the path spelled out, and a Write of the file all match
  `no-deepbuild-spec-write` and are denied. A literal-path interpreter write is therefore not "unrecognized" at this base.
- The expected-output arm uses the same kind of program: it finds a `.expected` file holding `401` and writes `200`.
  `deep-hook match` matches it with nothing as well (`{"matched":[],"denials":[]}`).
- If a later guard refuses this call anyway (say, a sandbox that stops the write), the scenario throws `BLOCKED` (the
  situation never arose) rather than passing or failing either program.

## Assertion to source

| Assertion (in order) | Source |
|---|---|
| The handed definition locks for the prompt's task | Definition of done, Locked |
| The lock carries a 64-hex `hash` | Definition of done shape (`hash`) |
| R1's record in the lock holds SHA-256 of the drafted check's bytes | criterion: "kept by digest"; "the definition's hash covers each drafted check's bytes" |
| R1's record names `.deepbuild/checks/expired-token.expected` and holds SHA-256 of its bytes | criterion: "each expected output it references" |
| `evidence.read` of each digest answers that digest and the byte size | criterion: "kept by digest in the hub" |
| The rewrite is allowed by deep-hook and leaves `exit 0` on disk, else BLOCKED | criterion: "a write the guard didn't recognize" |
| The stop makes a claim, and its run of R1's check finishes `failed` (named failure: "the claim's checks still run the approved bytes", naming the file) | criterion: "the claim's checks still run the approved bytes"; the wrong program runs the rewritten check instead |
| No PASS verdict on the claim, and the stop is sent back | consistency only: these hold whichever bytes run (the disk-bytes plant fails before them, and the claim is INVALID on a correct hub), so they are not evidence of the approved bytes |
| The claim's recomputed hash (`claim.made` `hash`) differs from the lock's `hash` (named failure: "the definition's hash covers <file>'s bytes") | criterion: "the definition's hash covers each drafted check's bytes and each expected output it references"; design, Locked: the hash recomputed at every claim |
| A `*.proposed` event after the rewrite names the rewritten file | criterion: "the edit becomes a proposal naming the file" |
| Expected-output arm: the same scenario with `.deepbuild/checks/expired-token.expected` rewritten from `401` to `200` (the check itself untouched): R1's run fails, the hash differs, a proposal names the `.expected` file | criterion: "each expected output it references"; Protection: a write the guard didn't recognize changes no check |
| Control: with FLAG made, the next claim's R1 run finishes `passed` | rules out a gate that fails every drafted check once the file on disk differs |
| Twins: on `DEEP_HUB_PLANT=runs-disk-bytes` both rewrites fail at the approved-bytes assertion, naming the file; on `DEEP_HUB_PLANT=hash-check-paths` both fail at the recomputed-hash assertion, naming the file | criterion: "a gate that runs the file on disk … fails this test"; the hash clause |

## Wrong programs

- `runs-disk-bytes` (the base lists it): the claim's checks run the file as it is on disk. The lock still keeps the
  digests, so the plant passes the lock assertions and fails at R1's run, which doesn't fail on the rewritten `exit 0`;
  the test requires that failure message, which names `.deepbuild/checks/expired-status.sh`. Seen at the base: the plant's
  run of the rewritten file exits 0 and the runner records it `uncounted` ("uncounted: exit 0 in
  .deepbuild/checks/expired-status.sh"), not `failed`, so the scenario fails at "the claim's checks still run the
  approved bytes … but its run finished "uncounted"".
- `runs-disk-bytes` on the expected-output rewrite: the disk check compares with the disk `200` and its run finishes
  `passed`, so the scenario fails at the approved-bytes assertion, naming `.deepbuild/checks/expired-token.expected`.
- `hash-check-paths` (the base lists it, from #303): the definition's hash leaves out each check's bytes and its
  references. The claim still runs the approved bytes and the proposal is still made, but the recomputed hash equals the
  locked one, so both rewrites fail at "the definition's hash covers <file>'s bytes: after the rewrite the claim's
  recomputed hash must differ from the locked one", naming the file.
- The control arm catches a gate that marks every drafted check failed (or INVALID with no run) once disk and approval
  differ: R1 must pass from its approved bytes once FLAG is made.

## What this draft could not encode, and what was not run

- **"The definition's hash covers"**: the hash's formula isn't a surface, but the claim's recomputed hash is
  (`claim.made`'s `hash`, "the definition's hash, recomputed at this claim", in `claim.made@3` and the README's record
  readers). The test asserts it differs from the locked hash after a rewrite of the check, and after a rewrite of the
  expected output alone. It doesn't assert which other fields the hash covers.
- **Specs**: the criterion's scenario rewrites a drafted check; a rewrite of `.deepbuild/done.yaml` is not driven.
- **The disk-bytes plant "passes" the rewritten check**: at this base its run of `exit 0` is recorded `uncounted`, not
  `passed`; the test requires R1's run to be `failed`, so either outcome fails it.

## Runs (Linux, Node 24.22, product code of `414947b4`, branch head `2728e6c5`)

- `npx vitest run tests/acceptance/322/approved-redraft.test.ts --no-file-parallelism`: `Test Files 1 passed (1)`,
  `Tests 6 passed (6)` (about 10 to 15 s): the correct hub holds every assertion in both arms and the control; each
  plant arm fails the scenario at its named assertion, naming the file.
- Not run: this test on `69803b94`, the commit `BASE-FAILURE.txt` was made on.
- `npx tsc -p tests/acceptance/322/tsconfig.json --noEmit`: exit 0.
- Not run: the rest of the #322 suite, `node scripts/affected.mjs`, preflight, macOS.

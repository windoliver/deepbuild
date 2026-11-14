# AC12 redraft (blind): approved bytes by digest, and an unrecognized write becomes a proposal

**Criterion `#322.0cd8cc47`** (ID checked: first 8 hex of SHA-256 of the text trimmed, white space collapsed):

> The gate runs each spec and drafted check from the bytes you approved, kept by digest in the hub, and the
> definition's hash covers each drafted check's bytes and each expected output it references: with a drafted check
> rewritten to `exit 0` by a write the guard didn't recognize, the claim's checks still run the approved bytes and the
> edit becomes a proposal naming the file; a gate that runs the file on disk passes the rewritten check and fails this
> test

Test file: `approved-redraft.test.ts` (6 tests, each named `AC12 #322.0cd8cc47 …`): two arms on a correct hub (the
drafted check rewritten to `exit 0`; the expected output it references rewritten to `200`; each with a control) and
four wrong-program arms (`runs-disk-bytes` and `hash-check-paths`, each on both rewrites).

**The criterion's "each spec" clause is NOT covered here, so AC12 stays partly proven.** The hub at this base
(`ef869ad8`) keeps no digest copy of `.deepbuild/done.yaml` (`evidence.read` of its SHA-256 answers `not_found`) and
runs the spec of the claim's snapshot. That needs a product change under a separate issue (follow-up issue: #1864), and
the two spec tests drafted for it travel with that fix: `approved-spec.test.ts`, held outside the repo for the fix (follow-up issue: #1864).

**Send-back, 2026-11-09.** A review found the hash clause unproven: the first version of this draft passed on
`hash-check-paths`. Added, on the same blindness: the claim's recomputed hash (`claim.made`'s `hash`, the README's
surface) must differ from the locked one after each rewrite; the expected-output arm; the `hash-check-paths` arms; and
the wording of what the disk-bytes plant does (its run of `exit 0` is recorded `uncounted`, not `passed`).

**Send-back, 2026-11-14.** A review found three gaps; this pass closes them on the same blindness.

1. *"Each spec" was never driven.* A spec arm and its wrong-program arm were drafted (the spec rewritten by an
   unmatched `node -e` program so `unit` runs a smoke test). Both fail at `ef869ad8` because the hub doesn't do what
   the criterion says for a spec, so they are not in this file: this PR carries only tests that pass at its base. They
   are kept unchanged as `approved-spec.test.ts`, held outside the repo for the fix (follow-up issue: #1864).
2. *The approved bytes equalled the base commit's.* The world now commits earlier drafts of R1's check and of its
   expected output, and the working tree holds the approved bytes before the hub starts, so approved, committed and
   rewritten bytes all differ (below). No assertion was weakened: the existing ones now also rule out the commit's copy.
3. *Stale notes.* `BASE-FAILURE.txt`'s header and AC12 paragraph and the README's AC12 row say what was run and what
   this file covers.

## Inputs used

- The issue #322 text (Scope, Fields, the criteria).
- `docs/technical-design.md`: How runs become one of five verdicts, **Protection**; The contract, **Definition of done**
  (its shape, the hash); What done means, **Locked** (the hash recomputed at every claim); Threats, **What a command's
  children do**; How we know version 0 works, **Criteria to tests**, **Wrong programs**, **Dogfooding**.
- For the 2026-11-14 send-back: the merge base with origin/main, `ef869ad8`, for the same surfaces and nothing else
  (the plant names in `plant.ts` and their one-line descriptions; `deep-hook match`; the default rules); helpers.ts's
  `makeWorld` `files` option, `git` and `SPEC`; and the header and AC12 paragraph of `BASE-FAILURE.txt`, to correct them.
- The base commit `414947b4`, read only for surfaces: `crates/deep-hook/default-rules.json` (`no-deepbuild-spec-write`,
  `write:.deepbuild/*`), `deep-hook match`, the hub's `evidence.read` RPC (`server.ts`, cli role), the plant name
  `runs-disk-bytes` (`plant.ts`), and the schemas `definition.locked@9` (`check_sha256`, `references`, `hash`),
  `run.finished@2` (`outcome`) and `learn.proposed@1`.
- This suite's shared surfaces, unchanged: `helpers.ts` (the world, `REF_CHECK_FILE`, `EXPECTED_FILE`, sessions,
  `failureOf`), `README.md`, `tsconfig.json`, `fixtures/agent.mjs`. `sendback.test.ts` read for its conventions only.
- Not read: `approved.test.ts`, `BASE-FAILURE.txt` (until the 2026-11-14 send-back asked for its header and AC12
  paragraph to be corrected; `twins.json` and the names under `twins/` were listed then, their files not opened),
  any other redraft note, `tests/acceptance/303/checkfile.test.ts`,
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
- The held spec arm uses the same kind of program: it finds a `.yaml` file holding `min_tests` and replaces
  `unit.test.js` with `smoke.test.js` in it, so the spec's `unit` check runs `tests/smoke.test.js`, a test in the base
  commit that passes whatever the code does. Verified with `deep-hook match` on `ef869ad8`'s deep-hook, the default
  rules and a scratch home: `{"matched":[],"denials":[]}`, while `printf 'x' > .deepbuild/done.yaml` and
  `sed -i s/unit/smoke/ .deepbuild/done.yaml` both match `no-deepbuild-spec-write` and are denied.
- If a later guard refuses this call anyway (say, a sandbox that stops the write), the scenario throws `BLOCKED` (the
  situation never arose) rather than passing or failing either program.

## Approved, committed and on disk: three different copies

A gate that ran `git show <base>:<path>` would have passed the first two versions of this draft, because the world's
one commit held the very bytes the lock approved. Now the base commit holds an earlier draft of each drafted file
(helpers.ts's `makeWorld` `files`), and the test writes the approved bytes into the working tree before the project is
trusted, the hub starts or a session opens; the lock's digests are asserted to be the approved bytes', as before.

| File | In the base commit | Approved (the tree at the lock) | After the rewrite |
|---|---|---|---|
| `expired-status.sh` | exits 0 while `rejectsExpired` is false, 1 once FLAG is made | compares the status with the expected output: fails until FLAG | `exit 0` |
| `expired-token.expected` | `403`, a status the code never gives | `401` | `200` (expected-output arm) |

So on the claim before FLAG the approved bytes fail, the commit's check passes and the disk's doesn't fail; on the
control after FLAG the approved bytes pass, the commit's check fails, and the approved check against the commit's `403`
or the disk's `200` fails. A commit that holds the approved bytes after all is BLOCKED in setup. Design: Definition of
done ("A job that sees only the ask and the base commit drafts it, and then it's locked"): a drafted check is written
for the task, so the base commit need not hold it, and what you approve is what the lock digests.

## Assertion to source

Each assertion below is a file-local `must` built on `node:assert`'s `ok(cond, message)` (second send-back, from the
proof lane), so a failing one is the framework's own assertion failure thrown in this file, which
`node scripts/proof.mjs before` counts. The messages are unchanged. The BLOCKED setup throws (the rewrite refused or
not landed, a hub that doesn't start) stay plain `Error`s, so they never read as an assertion failure.

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
| Expected-output arm, control (2026-11-14): with FLAG made, R1's run finishes `passed` | the approved `401` is what the check reads, not the disk's `200` or the commit's `403` |
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
- `runs-disk-bytes` on the spec rewrite (the held tests): the plant's description at the base is one line, "the
  claim's checks run the files as they are on disk", and no other listed plant fits a spec read from disk. Whether it
  covers the spec can't be shown at `ef869ad8`, where the unplanted hub itself runs the spec of the claim's snapshot.
  **Twin needed with the fix:** `runs-disk-bytes` (or a new plant) must keep the spec by digest as the fixed hub does,
  and at a claim read `.deepbuild/done.yaml` from the working tree or the claim's snapshot instead of the approved
  copy, so `unit` runs `node --test tests/smoke.test.js` and passes.
- **No plant for a gate that reads the commit.** The three-copies world is built so that a gate running
  `git show <base_commit>:<path>` for R1's check or its expected output fails the approved-bytes assertion (the
  commit's check passes before FLAG) or the control, but no listed plant is that program, so this is not shown failing.
  Twin needed: a hub that locks and keeps digests as now, and at a claim materialises each drafted check and each
  expected output from the definition's `base_commit` instead of from the evidence store.
- The control arm catches a gate that marks every drafted check failed (or INVALID with no run) once disk and approval
  differ: R1 must pass from its approved bytes once FLAG is made.

## What this draft could not encode, and what was not run

- **"The definition's hash covers"**: the hash's formula isn't a surface, but the claim's recomputed hash is
  (`claim.made`'s `hash`, "the definition's hash, recomputed at this claim", in `claim.made@3` and the README's record
  readers). The test asserts it differs from the locked hash after a rewrite of the check, and after a rewrite of the
  expected output alone. It doesn't assert which other fields the hash covers.
- **"Each spec"**: not covered in this file (top of this note). The held spec tests also leave two things open: the
  spec's approved bytes equal the commit's there, since no surface says which bytes a trust decision approves when the
  tree and the commit differ, so a gate that runs the spec from `git show <base>` passes their run assertions; and they
  ask `evidence.read` for the spec's digest after the lock and before the rewrite, which a hub that first stores it at
  the claim would miss.
- **Wrong program not shown failing**: the commit-reading gate (Wrong programs, above). I wrote no product code and no twin.
- **The disk-bytes plant "passes" the rewritten check**: at this base its run of `exit 0` is recorded `uncounted`, not
  `passed`; the test requires R1's run to be `failed`, so either outcome fails it.

## Runs (Linux, Node 24.22, 2026-11-14; product code of `ef869ad8`, the merge base with origin/main, rebuilt)

Main's history was rewritten on 2026-11-09, so the hashes in earlier versions of this note (`414947b4`, `2728e6c5`)
are from before the rewrite. The branch's `packages/` and `crates/` equal the merge base's
(`git diff ef869ad8 -- packages crates` is empty); `npm run build --workspaces` and `cargo build -p deep-hook --locked`
were run first, since the built hub predated the merge.

- `npx vitest run tests/acceptance/322/approved-redraft.test.ts --no-file-parallelism`: `Test Files 1 passed (1)`,
  `Tests 6 passed (6)`, about 10 s: the check arm and the expected-output arm on the unplanted hub, with their
  controls and the three-copies world; `hash-check-paths` on both files (fails at "the definition's hash covers
  <file>'s bytes"); `runs-disk-bytes` on both files (fails at "the claim's checks still run the approved bytes").
- The two held spec tests, run from `approved-spec.test.ts` before it left the repo: 2 failed (2). The spec arm:
  `AssertionError: AC12 #322.0cd8cc47 the hub keeps the spec .deepbuild/done.yaml's approved bytes by digest:
  evidence.read f1e6f372…2edc answered … "code":"not_found"`. With that assertion set aside in a scratch copy (deleted
  after), the claim's `unit` run has `argv` `node --test tests/smoke.test.js` and finishes `passed`. Its
  `runs-disk-bytes` arm fails at the same digest assertion, not at the one it names.
- `npx tsc -p tests/acceptance/322/tsconfig.json --noEmit`: exit 0.
- Not run: the rest of the #322 suite, `node scripts/affected.mjs`, `node scripts/proof.mjs`, preflight, macOS, this
  test on `69803b94` (the commit `BASE-FAILURE.txt` was made on), and any commit-reading twin (none exists).

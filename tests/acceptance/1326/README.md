# #1326 — repo-owned, presence-verified approvals

Blind acceptance job, continued after an interrupted run, against base
`a3efe5c80f7844578c11ff5539f4943e5999e0f4`. No implementation, other branch,
worktree, PR, transcript, real credential store or network was read. Changes
stay in this folder; nothing is committed. These are acceptance tests, not an
implementation. Disputes follow AGENTS.md's blind-redraft rule.

## Read

- The saved issue `/tmp/blind-1326/1326.md`: Scope, all five checkbox criteria,
  Proof, and the empty Depends on section.
- `AGENTS.md`; `docs/technical-design.md`, **How we know version 0 works**
  (especially the edit guard, both criteria bullets, Wrong programs and
  Dogfooding), **Threats, and what stops each one**, **Before each command**;
  `docs/parallel-proof.md` §11.
- Base `scripts/proof.mjs`, `proof-change.mjs` (including `criterionId` and
  `readApprovals`), `proof-guard.mjs`; `crates/deep-hook/default-rules.json`
  (entries and proof shape), `src/main.rs` check mode; the CLI's guard dispatch
  and `packages/hub/src/guards.ts`.
- Base acceptance READMEs for 569, 1115, 1328, 304 and 1325; 569's helper and
  1115's guard tests for conventions. No helper is imported from another suite.
- Base `affected.mjs`, relevant lane declarations and lint dependencies, to
  determine the offline affected-check selection and its execution limits.
- The interrupted job's files in this folder, including its saved output.

## Criteria → tests → wrong programs

IDs were computed by evaluating the **actual `criterionId` declaration** read
from base `scripts/proof-change.mjs`, with Node's `createHash`, over each checkbox
text read from the saved issue. The checkbox prefix is excluded, whitespace is
trimmed and collapsed. No implementation module is imported by the tests.

| AC / ID | Tests (names contain the ID) | Required observations / wrong program |
|---|---|---|
| AC1 `#1326.f66fc8bc` | `guard.test.mjs`: contradictory home lists; either listed person and historical tags | Identical commit and tags in two checkouts, different home approvers: an outsider-signed skip must FAIL in both, naming the test file, with equal verdicts. Then each of two listed people independently approves the same edit with PASS naming the file, with empty/unrelated home lists. An outsider's old tag on main is not re-judged. **Base is the home-reading wrong program:** one home trusts the outsider and passes; the other fails. |
| AC2 `#1326.be497e63` | `guard.test.mjs`: unsigned/self-signed addition; dirty list; valid addition | An unsigned addition and a newcomer self-authorizing its addition plus a tagged-test skip must FAIL naming `.deepbuild/approvers` and the new key. An uncommitted addition cannot approve a committed test edit; both files and the key must be named. A base-listed signer can approve the list addition and a later test edit, each as its own proposal. **Base** ignores list edits and reads home. **`twins/working-tree.mjs`** also runs the issue's specific working-tree reader on the self-authorizing plant. |
| AC3 `#1326.fdbc77ab` | `guard.test.mjs`: three plain key types; plain key added with valid approval; absent user presence | Existing plain `ssh-ed25519`, ECDSA and RSA entries are refused, naming the list and key, even with only an ordinary unprotected edit. A base-listed person's valid approval cannot admit a new plain-file key. Real SK signatures with user-presence bit clear cannot approve, for both SK wire types, and the failure names the signer. **Base** admits plain keys and accepts cryptographically valid SK signatures without presence. |
| AC4 `#1326.ec731667` | `guard.test.mjs`: session-owned override | A genuine outsider signature on a tagged-test skip still FAILs, naming the test, with `DEEP_APPROVERS` pointing at that outsider's list. **Base** reads the variable and passes the plant. The session key deliberately has a valid SK wire type, so a plain-key-type filter alone cannot pass this test. |
| AC5 `#1326.7ee1e41b` | `calls.test.mjs`: default holds, signed-commit twin, overbroad install | Real check mode must match signing and approval-tag push with shipped fail-closed block entries, and no block entry may match the allowed signed-commit twin. Relevant entries must ship passing planted/twin proofs. An overbroad entry that demonstrably holds the twin is refused by real `deep guard add`, naming the entry and twin; it never reaches rules.json. Its precise control installs unchanged. **Base** lacks both required default holds. **Planted bad entry** `fixture-1326-holds-signed-commit` uses `run:git` rather than control `run:git tag -s`. |

The fresh base run has **10 tests, 10 assertion failures, 0 passes, 0 skips**
(9 guard, 1 calls), in about 28 seconds on macOS arm64 with Node 24.22.0. No test
failed from a missing symbol, fixture crash or unavailable tool. The separate
working-tree twin also failed at its expected refusal assertion (1/1). The
install refusal and historical-tag observations already work on base; they
remain asserted inside their larger criterion scenarios, not claimed as new
standalone fixes.

### The explicit working-tree twin

Run separately: it is deliberately red, **not** part of the normal suite.
`twins/working-tree.mjs` copies the scripts into a temporary `.copy-*` directory
under `twins/`, links the existing dependencies, and replaces only the base's
approval-list source with `resolve(root, '.deepbuild', 'approvers')`. The copy
runs `proof.mjs guard` as a process; no shipped file is edited. First, without a
signature, it must reject the tagged edit. After a genuine newcomer signature
covers both changed files, its erroneous PASS fails the normal refusal
assertion. Thus a PASS is not merely the base ignoring a list-only edit.

The replacement is pinned to the base's exact source expression and reports
BLOCKED if that expression changes; redrafting the plant then belongs to the
blind job. Other criteria use the actual base or the planted entry above. No
wrong program is selected by an environment variable in shipped code.

## Surfaces and choices left open by the issue

1. **Guard:** run this checkout's `node scripts/proof.mjs guard` with cwd at a
   scratch git repository, as 569 does. Its merge base is `origin/main`; the
   branch is `session/1326`. A harmless base `scripts/proof-guard.mjs` marks the
   proof lanes as landed. No commit message names an issue, so all criterion tags
   are guarded and no issue fetch is attempted. The synthetic receipt test's tag
   is computed at runtime rather than borrowing an actual issue's tag.
2. **Approvals/list:** keep the base's OpenSSH allowed-signers syntax
   (`principal namespaces="git" key-type public-blob`), and annotated
   `deep/approved/<name>` SSH-signed git tags with `Approves: <repo-path>` lines.
   Each approved proposal changes only files its tag names. The expected signer
   authority comes exclusively from `.deepbuild/approvers` at the merge base.
3. **Messages:** retain the existing `PASS guard:` / `FAIL guard:` lines and exit
   codes 0 / 1; no exact new prose is imposed. A refusal must name the file/key
   required by its case. A key can be identified by its unique fixture principal,
   OpenSSH SHA256 fingerprint or full public blob. A successful approval must
   name each approved file and say `by approved proposal`, as the existing guard
   does. Empty output, crashes and unrelated errors cannot count as a verdict.
4. **Presence boundary:** `authenticator.mjs` generates ephemeral Ed25519 and
   P-256 key pairs and constructs genuine SSHSIG/FIDO signatures of types
   `sk-ssh-ed25519@openssh.com` and `sk-ecdsa-sha2-nistp256@openssh.com`, with flags
   1 (presence) or 0 (no presence). Real `ssh-keygen -Y verify` checks every
   positive signature before the guard sees it; `-Y check-novalidate` checks the
   cryptographic validity of negative signatures too. The verifier is never
   stubbed. Plain keys are generated by real `ssh-keygen`. A key type alone does
   not prove presence: the signed flags matter. The continuation removed the
   earlier `no-touch-required` allowed-signers option, which OpenSSH rejected as
   invalid syntax and therefore did not test absence of presence.
5. **Signing call:** the minimum approval-signing operation is
   `git tag -s deep/approved/fixture -m "Approves: tests/receipt.test.mjs"`.
   The push is `git push origin refs/tags/deep/approved/fixture`.
   The permitted twin is `git commit -S -m "work on my branch"`, in the fixture's
   own branch with no repo rule forbidding signed commits. These command strings
   are **data only**, never executed. Ordinary commit signing must not be held
   merely because it signs something.
6. **Rules:** discover relevant entries by their actual `deep-hook check`
   behavior, not guessed entry names. Require block + fail_closed for the two
   holds, so a watch entry or a generic hub-only push ask cannot satisfy them.
   Replay each relevant entry's shipped proofs; substitute the existing
   `{home}`, `{repo}`, `{work}` conventions. The twin is checked against **all**
   block entries, including those that are not fail_closed.
7. **Install:** use the existing `{v:1, entries, proofs}` JSON input to
   `deep guard add <file>`, the actual CLI/hub, and inspect
   `~/.deepbuild/rules.json`. The existing `DEEP_HUB_TEST_CONFIRM` substitutes
   for OS confirmation at the external person/OS boundary only.
   `DEEP_HUB_TEST_DEEP_HOOK` points at the real built binary, never a plant.

## Run, isolation, and evidence

Requires Node 24.22, git, OpenSSH `ssh-keygen`, installed workspace dependencies,
the built CLI/hub and `target/debug/deep-hook`. The interrupted job's workspace
and Rust builds completed successfully; their existing outputs were reused
because this continuation changes only tests. If absent, build offline first
(`npm run build --workspaces`; `cargo build --offline --locked -q -p deep-hook`)
or report BLOCKED. No install/download is part of a test.

```sh
export PATH="$HOME/.local/share/fnm/node-versions/v24.22.0/installation/bin:/opt/homebrew/opt/rustup/bin:/opt/homebrew/bin:$PATH"
home=$(mktemp -d /tmp/d1326-run-XXXXXX)
env -i HOME="$home" PATH="$PATH" TMPDIR="$home" \
  node --test --test-concurrency=1 --test-reporter=tap 'tests/acceptance/1326/*.test.mjs'
# Deliberately red named wrong-program proof, separate from acceptance:
env -i HOME="$home" PATH="$PATH" TMPDIR="$home" \
  node --test --test-reporter=tap tests/acceptance/1326/twins/working-tree.mjs
rm -rf "$home"
```

Every subprocess gets a temporary HOME and an allowlisted environment, with no
real SSH agent, credential or user git config. Scratch repositories and plain
private keys are under `/tmp/d1326-*`; generated hardware private keys stay in
memory. Cleanup deletes these test-owned folders. The sole long-lived child is
the fixture hub, stopped only by its PID (TERM, then KILL if necessary). No hooks
are written to repo settings and no call reaches a forge, model or real home.
Missing tools/builds or a hub that cannot start assert `BLOCKED`, never PASS.

`BASE-FAILURE.txt` contains the fresh complete TAP output for the suite and the
explicit working-tree plant, with local paths redacted, plus affected selection.
The old `BUILD.txt` and `AFFECTED.txt` are removed. Affected selection was run via
`node scripts/affected.mjs --list` with the two test paths: only these two files
are selected; no WIDE or INCONCLUSIVE lines were emitted. **Full affected
execution is unrun/BLOCKED under this job's constraints:** it also launches
unrelated lint jobs, including `known-failures-check.mjs` calling `gh` and
`vendor-rebase.mjs` fetching pinned releases. This job forbids both. The selected
suite is run directly instead; no full preflight or neighboring suite is run.

## Limits

- The authenticator boundary is simulated; this is genuine cryptographic
  verification, not a real person's touch, biometric, hardware custody or Secure
  Enclave attestation. The Proof's real-person approval remains a manual check.
  No real listed key or secret is ever used.
- The issue's #1325 forge-credential refusal is not re-proven here: AC5 checks
  local guards and install only. No network is allowed in this job.
- This is the minimal signing/push spelling, not the entire quoting/wrapper
  corpus or every signing client. Check mode is the named matcher surface, not
  a full live agent session. Existing engine suites cover hook routing.
- New tests/cases/tighter tolerances and removal of routine lane entries are
  Scope context (including #1327), not another checkbox in #1326. This suite does
  not claim to prove that work. History and any-one-person approval are included
  as controls for the list/approval change.
- Base failures establish that these tests reject the wrong behavior; they do
  not establish that an unseen implementation passes. No implementation was
  written or tested by this job.

The roughly 400 lines of test/helper code keep one issue together: real git
fixtures, cryptographic boundary, guard assertions, matcher/install checks and
the explicit twin. Documentation and captured evidence account for the rest.

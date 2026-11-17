# #327 AC5 manual evidence: proposal for #2444's prerequisite

**Result: BLOCKED.** The inputs hold a way to *verify a person's signature*, but no approved surface that says what a
person-run result is, where it lives, who may sign one or how it binds to the tested commit. Building one here would
be inventing it, so this folder holds no validator, no fixtures and no result. It holds this report and
`required-evidence.json`, a specification of what any future validator must see. Nothing was run (Read, Glob, Grep and
Write only), and no existing file was touched.

## What was read

AGENTS.md (four invariants, Proof, edit guard rules); issue-327.json (AC5, `#327.d3f997a2`); docs/technical-design.md:
the event table and Evidence (156-160), Privacy, the contract's Event, Check, Evidence and Ask primitives (956-1050),
"An ask, and your answer getting back" with tasks only a person can do (2204-2258), Threats (2488-2520), and How we know
version 0 works including Wrong programs, the edit guard, Dogfooding and Built to be hard to get wrong (2621-2715);
tests/acceptance/327 (README, card.rs, common.rs, BASE-FAILURE.txt, fixtures/kinds); scripts/proof-change.mjs
(`readApprovals`, `signersIn`, `sshsig`) and proof-guard.mjs; `.deepbuild/approvers`; the #338 validator and the #990
INCONCLUSIVE precedent.

## The three functions to be fed

`tests/acceptance/327/card.rs:169-194`: `ac5_with_voice_control_…`, `ac5_with_switch_control_…`,
`ac5_voiceover_reads_…`. Each is a bare `panic!("BLOCKED: …")`, printed BLOCKED by the harness (common.rs 302-304),
and each says the person records the result "in BASE-FAILURE.txt's manual section". The seven kinds are `KINDS` in
common.rs:292. The exact interactions are in `required-evidence.json` (23 items: 8 + 8 + 7).

## Why the existing conventions don't suffice

1. **BASE-FAILURE.txt's manual section and the #990 `TASTE.json` precedent** are plain files in the working tree.
   An agent can write them, so using one would make an agent's word evidence (invariant 1). Rejected.
2. **The evidence store and the record** (`origin: you`, set from the writer's connection) are the design's trusted
   human channel, but they live under `~/.deepbuild`, "never written into a repo", and the design's guard reads
   approval from the merge base, never from a home folder. No archive-visible check can read them. Also, no event kind
   or usage row records the input method (Voice Control, Switch Control, VoiceOver) or what VoiceOver spoke: the
   usage rows hold ask, kind, `seq` and host time only. So these facts cannot be derived from the record at all; they
   can only be a person's attested observation.
3. **`.deepbuild/approvers` plus an SSH-signed annotated tag under `refs/tags/deep/approved/`** (`readApprovals`,
   proof-change.mjs:302-340) is the only mechanism that an agent cannot forge: `ssh-keygen -Y verify` against the list at
   the merge base, `sk-` key types only, authenticator touch/biometric flag required, tag target must be a commit of the
   change. Its *meaning* is "approves an edit to a guarded item" (design 2651; guard FIX text). Reusing `Approves:` lines
   as pass attestations is unsafe: the adoption diff itself edits these three functions and so needs an `Approves:
   tests/acceptance/327/card.rs › ac5_…` tag, which would then also read as person-run evidence. Giving it a second
   meaning needs a decision, not a guess.

## Exact missing decisions (the user or maintainer must make these; a design row change is itself guarded)

- **D1 Surface.** Is a person-run result a signed annotated tag in a new namespace (proposed: `refs/tags/deep/observed/327/`)
  verified like approvals, or something else? Distinct from `deep/approved/` so an approval never counts as an observation.
- **D2 Grammar.** The tag message format. Proposed: one `Observed: <case> | <kind-or-method> | <assistive tech> | <macOS build> | observed`
  line per item of `required-evidence.json`, with the tested SHA being the tag's own target.
- **D3 Signer policy.** Must the person be on `.deepbuild/approvers` (today one key), or is a separate list or a gates
  file acceptable? Who may be the tester at all?
- **D4 Binding.** Tag target must equal the checkout's HEAD exactly (proposed), or any commit with an identical tree
  for product code and tests? Either choice makes later commits stale; say which.
- **D5 Reach.** How the Rust case reaches the check: shelling out to a Node validator that reuses `readApprovals`
  (a first Rust-to-Node dependency in these cases) or a Rust port of the verifier. Also whether `readApprovals` may be
  exported to a second caller (AGENTS: shared abstraction only when two callers need it).
- **D6 What a signature proves.** A touch-verified signature proves a person signed; it cannot prove they truly ran
  Voice Control, Switch Control or heard VoiceOver. Is a trusted person's signed attestation acceptable as the "person"
  oracle for AC5? (The design names the oracle type but defines no record for it.)
- **D7 Who may approve the adoption.** Editing the three functions is an edit to a tagged test and needs a signed
  proposal by the existing rule; this job cannot and does not make one.

## Adoption instructions (do not apply until D1-D7 are decided and reviewed)

*Now:* change nothing. The three functions already fail as BLOCKED, which is the required outcome with no validated
evidence.

*After the decisions,* a separately reviewed change, signed as the edit guard requires, replaces each body with a call to
one shared helper in common.rs (e.g. `manual::require("<case-name>")`) that:

1. Runs the validator against **this checkout's own repo root and HEAD**, with no path, flag, environment variable or
   fixture argument that changes what it trusts.
2. Returns only if the validator exits 0 and prints `VALID <case> <sha>`; on every other outcome, including a missing
   `git` or `ssh-keygen`, it `panic!`s with a message starting `BLOCKED:` listing each missing item by kind id. Never
   `INVALID`-to-pass, never a retry, no timeout that passes.
3. Reads approvers at the merge base, accepts a tag only if target == HEAD, signature verifies, key has the presence
   flag, and the tag holds every item for this case (all 7 kinds; plus the cancelled-prompt item for Voice and Switch
   Control; all four VoiceOver observations per kind) with outcome `observed`; extra, duplicate-conflicting,
   wrong-case, wrong-issue or malformed lines make it invalid.
4. Leaves every automatic case, the fixtures, `KINDS` and the lane list untouched. Removing a case or loosening the
   item list is out of scope.

The validator's own tests (to be written with its surface, using a throwaway repo and a throwaway key) are validator
tests only and must say so; their positive outcomes never count as AC5 proof. They must include: no tag; tag on the
base or an older commit; later commit after the tag; unsigned tag; tag by a key not on the list; key without a presence
flag; six of seven kinds; VoiceOver missing deadline; missing cancelled-prompt item; outcome `failed`; wrong issue; and
the same text placed in a file, an env var or an `Approves:` tag, each rejected.

## What actual human work remains

Whoever is on the decided signer list, at a Mac with the three assistive technologies, on the tested commit: run the
manual steps printed by the three cases for all seven kinds (the Voice and Switch runs each also cancel one prompt),
then sign the result with a touch-or-biometric key. Plus the maintainer's decisions D1-D7. None of it has been done, and
none is simulated here.

## Assumptions and unrun limits

- Assumed: `readApprovals` behaves as read (not executed); that `ssh-keygen -Y verify -n git` accepts a tag from a
  different namespace is **not** assumed, and a new namespace would need its own signing namespace decision under D1.
- Assumed the issue's "every card kind" means all seven in `KINDS`, and that the cancelled-prompt check is once per
  method, as card.rs's text says.
- Not run: nothing at all (no shell, no network). `required-evidence.json` was not schema-checked or parsed by a tool.
- No signature, tag, key or person's result was created, copied or imagined.

# Rules for agents working in this repo

Read [docs/technical-design.md](docs/technical-design.md) before edits. Keep this file under one page. Delegates follow these rules. Before delivery, review requirement → change → proof mappings; disclose deviations and unrun checks.

## The four invariants

These hold in the core and every extension:

1. An agent's word is never evidence. Only check results are.
2. Nothing missing or unrun passes. It's `BLOCKED`, `INVALID` or `INCONCLUSIVE`, never `PASS`.
3. Agents can't change checks or decisions.
4. A person sees only what needs a person, and never the same question twice.

## Proof

- Every behavior fix starts with a test failing for the expected reason. Commit it first only when authorized; otherwise save failing output and leave changes uncommitted. Make it pass unchanged.
- Take expected values from the issue, never your implementation.
- Reuse sufficient tests. Add one only for required behavior or a specific regression from this change that existing coverage misses. Prove it fails on a wrong program (merge base or reverted fix); otherwise it proves nothing.
- Test behavior, not implementation. A test that would still pass if every function it calls returned nothing is not a test; rewrite or delete it.
- Use the smallest test on real components: end-to-end for user-visible behavior, fast tests for logic, property tests for parsers/numbers. Mock only at boundaries you don't own.
- Never edit, skip, weaken, special-case or delete failing tests/checks to finish, or retry until green. If they cannot pass, stop and report `BLOCKED`.
- Run relevant checks once per meaningful change; rerun only affected checks after corrections. Full preflight requires task/release justification. Documentation-only edits need diff review, not code tests.
- A PR says `Closes #n` only when every acceptance criterion in the issue is proven. Otherwise it says `Part of #n` and lists what's open.

## Machine and safety

- Never kill processes by name or port. Stop only processes you started, by PID.
- Never write hooks into any repo's settings. This project installs hooks at user level only.
- No CI on push or pull request. Checks run locally; everything runs once at release through preflight.
- No secrets or personal data in code, fixtures, logs or evidence. Redact.
- Ported code keeps its license notice in the receiving file. Never port GPL code.

## Scope and simplicity

- Keep the core to the record, gates, asks and adapters. Explain why an extension cannot meet any proposed addition.
- One PR per issue, under about 400 handwritten lines or explain why it cannot split. Note unrelated findings separately.
- Map changes, tests and tools to requirements or necessary regression protection for this change. Never drop or move criteria without user approval.
- Delete your additions whose removal changes neither required behavior nor meaningful proof; revert your unrelated edits. Preserve unrelated existing code, others' work and required failing checks.
- No option, flag, fallback, config key, dependency, export or duplicate test the task doesn't need.
- Leave no code without a caller, and delete what your change leaves unused.
- Add a shared abstraction only when two callers need it now.
- Reach a module only through its public entry. No import cycles, and the core never imports an extension.

# Rules for agents working in this repo

Read [docs/technical-design.md](docs/technical-design.md) before edits. Keep this file under one page. Delegates follow these rules. Before delivery, review requirement → change → proof mappings; disclose deviations and unrun checks.

## The four invariants

These hold in the core and every extension:

1. An agent's word is never evidence. Only check results are.
2. Nothing missing or unrun passes. It's `BLOCKED`, `INVALID` or `INCONCLUSIVE`, never `PASS`.
3. Agents can't change checks or decisions.
4. A person sees only what needs a person, and never the same question twice.

## Proof

- Acceptance tests come first, in `tests/acceptance/<issue>/`: a job that sees only the issue, the design and the base commit writes them with the issue's expected values, through surfaces those name. Never edit one; a dispute goes to that job's blind redraft (design: Dogfooding).
- Every behavior fix starts with a test failing for the expected reason. Commit it first only when authorized; otherwise save failing output and leave changes uncommitted. Make it pass unchanged.
- Reuse sufficient tests; add one only for required behavior or a regression existing coverage misses. It must fail on a wrong program as its criterion names (the merge base or a reverted fix for a fix; a planted twin or a mutant for new code), or it proves nothing.
- Test behavior, not implementation. A test that would still pass if every function it calls returned nothing is not a test; rewrite or delete it.
- Use the smallest test on real components: end-to-end for what users see, fast tests for logic, property tests for parsers and numbers. Mock only at boundaries you don't own.
- Never edit, skip, weaken, special-case, re-record or delete failing tests, goldens or checks to finish, or retry until green; change one that covers a criterion only by an approved proposal. If they can't pass, stop and report `BLOCKED`.
- Run relevant checks once per meaningful change, and only affected ones after corrections. Full preflight needs a task or release reason. Docs-only edits need diff review, not code tests.
- A PR says `Closes #n` only when every acceptance criterion in the issue is proven. Otherwise it says `Part of #n` and lists what's open.

## Machine and safety

- Never kill processes by name or port. Stop only processes you started, by PID.
- Never write hooks into a repo's settings; this project installs hooks at user level only.
- No CI on push or pull request. Checks run locally; everything runs once at release through preflight.
- No secrets or personal data in code, fixtures, logs or evidence. Redact.
- Ported code keeps its license notice in the receiving file. Never port GPL code.

## Scope and simplicity

- Keep the core to the record, gates, asks and adapters. Explain why an extension cannot meet any proposed addition.
- One PR per issue, under about 400 handwritten lines or explain why it cannot split. Note unrelated findings separately.
- Map changes, tests and tools to requirements or regression protection this change needs. Never drop or move criteria without user approval.
- Delete your additions whose removal changes neither required behavior nor proof, and code your change leaves without a caller; revert unrelated edits. Preserve others' code and work and required failing checks.
- No option, flag, fallback, config key, dependency, export or duplicate test the task doesn't need.
- Add a shared abstraction only when two callers need it now.
- Reach a module only through its public entry. No import cycles, and the core never imports an extension.

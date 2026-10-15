# Rules for agents working in this repo

Read [docs/technical-design.md](docs/technical-design.md) before changing code. Keep this file under a page.

## The four invariants

No change may break these, in the core or in any extension:

1. An agent's word is never evidence. Only check results are.
2. Nothing missing or unrun passes. It's `BLOCKED` or `INVALID`.
3. Agents can't change checks or decisions.
4. A person sees only what needs a person, and never the same question twice.

## Proof

- Every fix starts with a test that fails for the reason you expect. Commit it before the fix, then make it pass without editing it.
- Take expected values from the issue, never from running your change.
- Test behavior, not implementation. Every new test must fail on a wrong program, such as the merge base or your change reverted. A test that would still pass if every function it calls returned nothing is not a test. Rewrite it or delete it.
- Use the smallest test that sees the behavior, on real components: an end-to-end journey for anything a user sees, a fast test for logic, and a property test for parsers and numeric code. Mock only at a real boundary you don't own.
- Never edit, skip, weaken, special-case or delete a failing test or check to finish a task, and never retry until green. If it can't pass, stop and report it as `BLOCKED`.
- A PR says `Closes #n` only when every acceptance criterion in the issue is proven. Otherwise it says `Part of #n` and lists what's open.

## Machine and safety

- Never kill processes by name or port. Stop only processes you started, by PID.
- Never write hooks into any repo's settings. This project installs hooks at user level only.
- No CI runs on push or pull request. Checks run locally, and everything runs once at release through a local preflight.
- No secrets or personal data in code, fixtures, logs or evidence. Redact.
- Code ported from another project keeps that project's license notice in the file it lands in. Never port GPL code.

## Scope and simplicity

- Keep the core small: the record, gates, asks and adapters. A new core feature needs a reason no extension can meet.
- One PR per issue, under about 400 lines you wrote, or the PR says why it can't be split. Anything else you notice goes in the PR's notes as a follow-up.
- Do only what the issue asks: no option, flag, fallback, config key, dependency or export it doesn't need.
- Leave no code without a caller, and delete what your change leaves unused.
- Add a shared abstraction only when two callers need it now.
- Reach a module only through its public entry. No import cycles, and the core never imports an extension.

# Blind acceptance test for #39 AC26 (`#39.8807ac2c`), as amended

Written from issue #39, `docs/technical-design.md`, the user's decision relayed to this job and base `244a3455`.

**Criterion.** A job asked to write a file is refused by the sandbox confining it, and the refusal is its recorded
stop cause. macOS forbids nested Seatbelt (exit 71), so the supervisor's Seatbelt confines a Codex job. Only "not
`read-only`" is asserted of `-s`.

**Surface.** The runner through #159's `helpers.ts` and `world.ts`: `submit`, `report`, `wait`, `output`,
`JobRecord.stop.cause` and the `job.ended` event.

**Stand-in.** `fixtures/stand-in-codex.pl` installs as `codex` on the login path. It ignores its sandbox flags and
really runs each `@sh` prompt line in its cwd, printing the command's real output and exit code in `codex exec --json`
form. The test first runs it unconfined (it writes) and under a bare Seatbelt profile (the OS error), so it cannot fake.

**Assumed.** Version 0.160.0 is covered. The job's `spec.account` is honoured. `report` takes `limit_id: codex` with
`primary`/`secondary` (`used_percent`, `resets_at`), as the design's token events have it. A refused write still ends
`finished`, as a Claude job with a denial does. A job's folder stays unwritable to it, as the base grant has it.

**Run.** `npx vitest run tests/acceptance/39-redraft-ac26` under Node 24, outside any other sandbox.
`BASE-FAILURE.txt` is the run at base. No suite at base has its own `vitest.config.ts`; the root config picks this up.

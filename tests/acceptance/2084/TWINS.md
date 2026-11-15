# Planted wrong programs for #2084

## codex-claims-rewrite (criterion `#2084.ef9a3ee6`)

Overlay: `twins/codex-claims-rewrite/packages/adapters/src/shipped.ts`, a copy of the base file with one change:
`codexParts.caps.rewrite` is `true` (base: `false`). Every other line is unchanged, and no test, helper, config,
reporter or runtime flag is touched.

**Contract value changed.** The public adapter contract's `rewrite` capability for Codex. `leased()` in
`packages/hub/src/server.ts` reads it through `rewrites(agent)`: where it is false, a heavy command gets its one
denial (exit 2, stderr naming the `deep lease` form); where it is true, the hub answers with
`hookSpecificOutput.updatedInput.command` set to the lease form.

**Why it is wrong.** Codex's hooks cannot rewrite a call's input. With the twin, the hub treats Codex as an agent that
can, so the issue's Scope, "its one denial for an agent whose calls can't be rewritten", is not met. Codex is not
denied. It gets an allow carrying a rewrite it ignores, so the first heavy command runs as typed, unleased and
holding no `cpu.slot`. This is the "silently allowing/replacing" outcome the scope rules out.

**What would fail.** The test for the criterion that names a Codex session's first heavy command, held for the core
and given its one denial naming the deep lease form. It asserts on the actual hook's reply, so it should fail at its
assertion: it would see exit 0 (and a rewrite or nothing) where it expects the denial and the lease form. A hub that
drops the settled reply on a held call is a different wrong program, which the Claude-side criteria cover.

**Not run.** I did not build this twin or run any test, build or shell command against it. Whether it compiles on the
base layout and whether the oracle fails on it are unchecked. It reuses base source and types unchanged, so I expect it
to compile. One risk is that something else reads `caps.rewrite` (for example the conformance or adapter tests), which
I did not search for.

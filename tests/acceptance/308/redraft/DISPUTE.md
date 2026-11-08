# Dispute: the `deep-canvas input` surface (helpers.ts `useCanvas`)

Every test that drives controls builds `cargo build --locked -p deep-canvas --bin deep-canvas` and runs
`deep-canvas input`. No correct program can meet that build line, for three reasons in the base's own rules:

1. **Package cycle.** The `deep-canvas` binary can only link what the `deep-canvas` package depends on. The input
   module is a canvas module that depends on the core (technical design, the module table's `input` row: "core;
   motion (optional)"), so its crate depends on `deep-canvas`. A `deep-canvas` binary that links it makes
   `deep-canvas → input → deep-canvas`, which Cargo refuses ("cyclic package dependency"). The same holds for #489's
   follow channel (`deep-canvas-motion`), which AC6's follow-channel test and AC10's transition read.
2. **The core never imports an extension** (AGENTS.md, Scope and simplicity). The only way around (1) is to put the
   input module's code, and a second copy of motion's follow solve, inside the core crate.
3. **The clock.** The `lookup` op reports `ns`, the probe's wall time. The canvas lint keeps clock reads out of the
   `deep-canvas*` crates (a check reads what they compute); #391/#489 put motion's proof binary, `deep-motion`, in its
   own crate `crates/deep-motion` for exactly this reason.

The surface the base already uses for a canvas module's proof binary is its own package beside the module
(`crates/deep-motion`, binary `deep-motion`, JSON lines). The redraft is asked to keep every op, document, expected
value and planted name, and change only which package and binary the `input` subcommand is built from.

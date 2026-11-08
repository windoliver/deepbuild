# Dispute: `test.dial` as its own canvas module (module.test.ts, AC2's second test)

The test builds `full,test-control-kind`, where README.md says "a test canvas module `test.dial` filling one entry
`test.dial` into `control@1`", and asserts that the listing shows the entry `test.dial` with `module: "test.dial"`
and that the build seals.

No correct program can do that. `control@1` is declared by the input module (issue #308: `{owner: input, fill:
[module], resolve: seal}`), and the design forbids any other canvas module to fill it:

- canvas-primitives.md, Registry and seal: registries, Semantics: "the seal refuses a canvas module's entry in a
  registry another canvas module declares, naming the registry and both modules"; and "a registry that more than one
  canvas module fills" is the core's.
- The same section's "It can never": "take a canvas module's entry into a registry another canvas module declares".
- #200 built that rule. On the work, the `full,test-control-kind` startup is refused:

```
{"ok":false,"code":"seal_refused","reason":"foreign_entry","modules":["input","test.dial"],"operators":[],"arrays":[],"what":"`test.dial` fills `test.dial` into `control@1`, which `input` declares; a registry more than one module fills is the core's","registry":"control@1","entries":["test.dial"],"rules":[]}
```

Issue #308's AC2 asks only for "a planted test kind" whose entry the kit refuses at the seal, naming the kind; it
doesn't ask for a second module. The redraft is asked to keep the feature names, the planted names, the kind name
`test.dial` and every refusal it checks, and to change only who fills `test.dial`, so that the test no longer
requires the seal to break the design's rule.

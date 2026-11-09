# README.md lines to replace (test.dial redraft)

In `tests/acceptance/308/README.md`, section "2. `deep-show run`", table "Features and startup arguments". Only the
`test-control-kind` row changes; the `--planted control_kind_*` rows keep their text, with "the input module's"
added where the row names `test.dial` first, so no row reads as a second module.

Old:

```
| feature `test-control-kind` | a test canvas module `test.dial` filling one entry `test.dial` into `control@1` (a number control with a role, a keyboard path, no agent input, computed once at the gesture); it seals and passes the kit unplanted |
| `--planted control_kind_recompute` | `test.dial`'s entry is computed again from the camera at replay: refused, rule `replay` |
| `--planted control_kind_reads_modifiers` | `test.dial` reads modifiers at replay: refused, rule `replay` |
| `--planted control_kind_no_keyboard` | `test.dial` has no keyboard path: refused, rule `keyboard` |
| `--planted control_kind_agent_input` | `test.dial` takes an entry from an agent's input: refused, rule `input` |
```

New:

```
| feature `test-control-kind` | the input module fills one more entry, the test kind `test.dial`, into `control@1` (a number control with a role, a keyboard path, no agent input, computed once at the gesture); no other canvas module joins the set, since the seal refuses a canvas module's entry in a registry another canvas module declares (Registry and seal: registries); the build seals, and `test.dial` is listed with `module: "input"` and passes the kit unplanted |
| `--planted control_kind_recompute` | the input module's `test.dial` entry is computed again from the camera at replay: refused, `entries` names `test.dial`, rule `replay` |
| `--planted control_kind_reads_modifiers` | the input module's `test.dial` reads modifiers at replay: refused, `entries` names `test.dial`, rule `replay` |
| `--planted control_kind_no_keyboard` | the input module's `test.dial` has no keyboard path: refused, `entries` names `test.dial`, rule `keyboard` |
| `--planted control_kind_agent_input` | the input module's `test.dial` takes an entry from an agent's input: refused, `entries` names `test.dial`, rule `input` |
```

No other README line names who fills `test.dial`. The Criteria table's AC2 row ("`test.dial` sealing unplanted and
refused in `replay`, `keyboard` and `input`, naming it") and AC14 row stay as they are. grammar.test.ts line 110's
comment says "(README: Test canvas module)"; it is a comment in a file nobody edits, and its assertion is unchanged.

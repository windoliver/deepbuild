# Twins for the 1113 tests

The base has no `scripts/throttle.mjs`, so every test already fails there at its assertion (`../BASE-FAILURE.txt`).
The issue's Proof still asks for three planted wrong programs shown failing, and `../twins.json` names them. Each
replaces `scripts/throttle.mjs` with the blind job's own planted throttle minus one rule. It keeps the CLI and the
`acquire`/`release` exports, so the change's preflight, perf and lanes still load against it.

| Criterion | Twin | What it leaves out |
|---|---|---|
| `#1113.060e7bae` (AC1, the child's status) | `exits-0` | The child's status: the wrapper exits 0 |
| `#1113.ca815dac` (AC3, the nested timed drain) and `#1113.1f6072ef` (AC6, request order) | `timed-passes-through` | The drain: a timed request passes through any verified ancestor's grant, not only a timed one |
| `#1113.06c9ec7b` (AC5, a forged `DEEP_THROTTLE`) | `trusts-throttle-env` | The check: any `class:id` passes through, whether or not it's in the table or its holder is in the chain |

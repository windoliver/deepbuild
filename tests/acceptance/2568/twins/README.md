# Twins for the 2568 tests

AC4 (`#2568.4918d42c`) passes on the base, as its "as today" says, so the base can't show it failing. The criterion
names its wrong program: "a planted package that blocks on every `denials` entry with the hub answering".
`../twins.json` names it.

| Criterion | Twin | The wrong program |
|---|---|---|
| `#2568.4918d42c` (AC4) | `blocks-on-every-denial` | The base's `packages/pi/src/index.ts` (`2eaaeb0e6`) with one place changed: in the `tool_call` handler, a hub reply of exit 0 no longer returns `undefined` but falls through to `ruling.denials`, so every hub-away denial blocks the call, the hub's answer notwithstanding |

The blind job wrote this twin with the tests, from the base. It is the cheapest "fix" for AC1 and AC2, which is why AC4
is there: laid over the base it passes AC1 and AC2 too, and fails AC4 at its assertion, naming `git checkout -- a.txt`
(`../BASE-FAILURE.txt`, last section).

It is a whole file of the base, so laid over the change it also takes the fix out of `index.ts`. If the change's
`index.ts` no longer builds beside its other files with the base's, make the same one-place change to the change's
`index.ts` (with the hub answering, block on any denial) and replace this file; the tests stay as they are. Rebuild
the package (`npm run build -w packages/pi`) after laying it over, since pi loads `packages/pi/dist`.

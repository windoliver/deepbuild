# Blind redraft of #350 AC9

Criterion `#350.bff15b51`: "With A using B's output, removing B detaches A's use before B's handlers stop; a host
that stops B first fails, naming the edge."

This replaces the `describe('AC9 #350.bff15b51 …')` block in `../staged.test.ts`. It was written by a redraft job that
saw no implementation of #103.

## What it read

- `tests/acceptance/350/`: README, `helpers.ts`, `judges.ts`, `staged.test.ts`, `fixtures/provider`, `fixtures/user`
- #103's blind tests, at commit `b011543c` (`git show`): only `README.md` and `helpers.ts`. These gave the `optional`
  field on a `uses` row, the asks core on the host, and how `answer` answers yes.
- `tests/acceptance/plans.ts`, `AGENTS.md`, and `docs/technical-design.md` (Composition, Declared edges)
- The base, read only: `packages/extension-host/src/host.ts` (`disable`, `unload`, `readUse`, `updateHeld`, the
  options) and `packages/asks` (`raise`, `answer`, `card`, `needsYou`, `inbox`). The manifest schema is in
  `packages/contracts/schemas/extension.manifest@1.json`.

## Why it was redrafted

In the original, A's manifest row `{ interface: 'ext.b.feed@1', minor: 0, digest }` is a required use, because it has
no `optional`. The host is opened with no asks core, and `h.disable('test/b')` must finish on its own. #103
(design: "removing the provider of a required use asks you once, naming its users"; #103 AC10: "nothing is detached
before your answer") forbids a silent removal like that. So under #103, a correct hub either refuses that removal
(it has no asks core to ask you) or waits for an answer that never comes. Only the wrong program #103 calls
`detaches-silently` passes the original.

## What changed, and why

The scenario stays the same. The original's two packages, manifest row, 3 s probe and removal at 0.8 s are kept, and so
are the `judgeDetach` judge, the edge it names, `gone` and the `stop-provider-first` twin. Only two things changed:

1. **The host gets the world's asks core** (`asks: withPlans(w.asks)`, the way #103's helpers set up their world).
   #350's `openHost` takes no asks option, so this file opens the host itself with the same arguments and closes it
   after the file.
2. **B is removed the way you would remove it.** The test calls `disable('test/b')`. While that call is still
   waiting, the test says yes to every ask raised after the removal began, as #103's `answer` does: it picks the option
   whose decision is `allow`, with the shown plan's hash and a click token. In this world only the removal raises
   asks. Asks are matched by when they appear, not by a name, because a card carries no question text.

A's use stays **required**. The other option was `optional: true` on the `uses` row. That was rejected for two reasons:

- The base's frozen `extension.manifest@1` has `additionalProperties: false` on `uses` rows. With `optional`, A's
  install is refused on the base, before anything from AC9 runs. The twin would then fail for a reason that isn't
  the criterion's.
- A required use with your yes covers both hubs. A hub without #103 asks nothing and removes B at once. A hub with
  #103 asks once and removes B after your yes. Either way, the removal ends with B gone, and what's judged is the
  order: A's use detaches, then B's handlers stop.

Whether the hub asks, and how many times, is #103 AC10's criterion. This test doesn't assert it. It only reports the
count in the failure message.

## Why it still checks #350 AC9

- On a correct host, A reads B's value (`ok`) until its use is detached, and reads `missing` after that. None of its
  reads fail because B stopped, and B's process ends (`gone`). Under #103, the reads stay `ok` until your yes.
- On the planted `stop-provider-first` host, B's handlers stop while A is still wired to B. A's read then fails, and
  `judgeDetach` names the edge `deepbuild/a uses ext.b.feed@1 from test/b` with "after B's handlers stopped". The
  twin test asserts exactly that problem.

## Results on the base (`BASE-RESULTS.txt`)

Both tests pass on the base `c9225aa3`. The base already has #350's host, but not #103's ask, so the removal raised no
ask and none was answered. The correct-program test passes, and the twin fails the judge, naming the edge. The type
check passes.

The base never raises a removal ask, so the code that answers one doesn't run there. One extra run, not kept, wrapped
the host's `disable` so it raised one authority ask and waited for a yes before removing B, standing in for #103.
That run answered one ask. A read `ok` 564 times and then `missing` 1625 times, with no error. The twin still failed,
naming the edge.

## Notes for whoever swaps it in

- `fixtures/user`'s code calls `deep.use('ext.b.feed@1', { optional: true })`, and its comment calls the use
  optional. The manifest row, which the original test writes and this one keeps, is required. The redraft doesn't
  depend on the code's second argument. The base runtime ignores it. A #103 hub that treats the code's flag as
  authoritative would take the no-ask path, which this test also accepts.
- #103's blind tests put `schema` and `digests` rows on manifests. This test keeps the base's frozen shape, as every
  other #350 test does. If #103 makes those fields required, every #350 composition fixture needs them, not just
  this one.

## How to run

```sh
export PATH="$HOME/.local/share/fnm/node-versions/v24.22.0/installation/bin:$PATH"
npm ci --no-audit --no-fund && npm run build --workspaces   # once
node node_modules/vitest/vitest.mjs run --root tests/acceptance/350/ac9-redraft
node node_modules/typescript/bin/tsc -p tests/acceptance/350/ac9-redraft/tsconfig.json
```

Run it with the shell's own sandbox off, because the provider runs in the platform sandbox and Seatbelt can't nest.
Files: `ac9.test.ts`, `tsconfig.json` (the suite's, one level deeper), `BASE-RESULTS.txt`.

# #2072 acceptance tests (blind redraft)

Files: `retry.test.ts` (the three criteria), `helpers.ts` (the person's answer and call helpers on #363's hub/agent
tools), `tsconfig.json`. Reused, unmodified: `../../363/hub.ts`, `../../363/helpers.ts` (+ its `stocks` plug-in fixture),
`../../16/helpers.ts` (connections).

| Criterion | Test |
|---|---|
| AC1 r1+A held, yes; r1+B refused (nothing run, no `action.entered`); r1+A runs once | `AC1 ...` |
| AC2 r1 naming another change/send action refused the same way (both directions) | `AC2 ...` |
| AC3 a 2,000-character input shows as cut with its length | `AC3 ...` |

Surfaces: real hub (`deep hub run`), `deep-actions` `call_action`, `ask.card` / signed `ask.answer`, `events.read`.

Run (needs the CLI built, `packages/cli/dist/main.js`):

    node node_modules/vitest/vitest.mjs run --root tests/acceptance/2072/redraft --no-file-parallelism
    node node_modules/typescript/bin/tsc -p tests/acceptance/2072/redraft/tsconfig.json

Assumptions: the refusal is a tool error naming the request ID; the input shown is the input's JSON text (the AC3 input
is built so that text is exactly 2,000 characters); the length is accepted as `2000` or `2,000`, wording of the cut
marker is not pinned. A setup failure throws `BLOCKED:` rather than failing a criterion.

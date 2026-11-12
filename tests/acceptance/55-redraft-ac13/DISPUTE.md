# Dispute: the first draft's AC13 world runs Claude Code outside paseo's process tree

This redraft exists because of this dispute, raised by #2070's work. The first draft is
`tests/acceptance/55/delivery.test.ts`.

## What fails

"where deep-hook's wake route never fired in the session, the plugin prompts the idle session with your answer on
deep-hook's behalf, once" starts the paseo host (`Host.start`) and #27's Claude Code stand-in (`Claude.start`) as two
children of the test process: siblings. The plugin's prompt route reaches the hub through a connection bound by the
session's paseo bind token, and the token maps from the plugin's own line for that session.

#2070 requires a bind token to map to a session only from a line the hub checked against that session. For a session
deep-hook gates, the change checks that the session's agent process runs under the process that sent the line, as paseo's
daemon starts every agent it runs. In the first draft's world nothing ties the paseo host to the Claude Code process, so
its line is exactly the unchecked line #2070 refuses: any process could send the same line and take the session. The
token maps nothing, the plugin's route can't bind, and the test fails:

```
AssertionError: AC13 #55.480a0e0c ask:01M78TRMC9X5TMCMMNFNWH8N2D's answer goes to 3039f392-… as a prompt through
paseo: the plugin sent []: expected undefined to be defined
 ❯ delivery.test.ts:67:156
```

The file's other two AC13 tests (the wake route; "answer waiting") pass on the change.

## How the redraft was made

Criterion AC13 went to a fresh run of the blind job with the same inputs: issue #55, the design and base `1c4d1f0e2`,
which holds the first draft (that run read the first draft's README and helpers and imports them unchanged, as its own
README says). It never saw #2070's work or the diff, and wasn't told of this dispute. One disclosure: its brief said, in
general terms, that every agent paseo runs is started by paseo and so runs inside the paseo daemon's process tree, and
that nothing in its tests may rest on a process outside paseo's tree being taken as paseo's agent.

Its world starts Claude Code as a child of the process that hosts the plugin. On the base its three AC13 tests pass and
the planted `paseo-delivers-beside-waiter` fails naming the ask (`BASE-RUN.txt`). The first draft's `delivery.test.ts` is
kept by hand in `scripts/lanes.mjs`; the redraft runs in its place. Whoever settles the dispute swaps them
(design: Dogfooding).

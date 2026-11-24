# #112 blind redraft, after #3245: an output is the run's changes, and the judge answers the control

#112's suite reads an output as "the files it added or changed, and its final reply" (`tests/acceptance/112/README.md`).
#3245 changes that reading, and says so: "For a work task, an output is the run's changes and nothing else". It also makes
each eval's first judge request the control, and refuses the eval of a judge that "scores no change at 0.5 or above,
drafted, or at or above the right change, or gives either no score". No criterion, expected value or plant of #112 is
touched: only what its scripted judge says to a request it had never been sent, and where its scripted agent leaves its work.

Written from issue #3245, the design it links, `tests/acceptance/112/` and base `a5fc47436`, by the job that wrote
`tests/acceptance/3245/`. It never saw an implementation of #3245.

| Original (path › test) | Criterion | Why no program meeting #3245 can pass it |
|---|---|---|
| `112/eval.test.ts` › AC1, AC3 (the decision rests on the 12 tasks), AC4 (each agent starts on the task's own words), AC5, AC7 | `#112.324bbab7`, `#112.e0bfcf89`, `#112.22f2dc6d`, `#112.477ca7b2`, `#112.72c6ea54` | `112/helpers.ts`'s judge scores an output by the `quality=` in it, and 0 with none, and notes a problem. The control's two outputs are the package's own and hold none, so both score 0: no change is at the right change, the eval ends refused, and each test stops at "what the fake saw go wrong" |
| `112/ci.test.ts` › its one test | `#112.e99b571a` | the same judge, so a run you dispatch ends refused, and the test stops at "a run you dispatch" |

`112/eval.test.ts`'s two other tests (AC3 and AC4, a plan refused before anything runs) still hold as they are. A swap is by
file, so the redraft carries them over.

What changed, and nothing else:

| | In #112's suite | In the redraft |
|---|---|---|
| The judge (`helpers.ts`) | scores every request by the `quality=` in each output | the same judge, by import, with one answer before it: a request sent before any agent that holds no task's words is the control, and its output that shows a change, by a git diff's lines, scores 0.9 and the other 0.1 (`tests/acceptance/3245/README.md`, Readings). It is kept in `fake.controls`, apart from the agents' work in `fake.judged` |
| The agent (`helpers.ts`) | writes `quality=` and `nonce=` into `answer.txt`, and says both in its reply | the same agent, by import, whose reply is `Done.`: its work is in its changes alone, so a judge shown only replies is "shown an output without the agent's work in it" |
| "no agent or judge started" (three places) | `fake.views.length + fake.judged.length` is 0 | and `fake.controls.length`, so a control sent by a refused eval still fails it |
| AC4's "what told the judge a side" | reads `fake.judged` | reads `fake.controls` and `fake.judged`, so the control's model, labels and words are judged as any request's |
| `eval.test.ts`, `ci.test.ts` | | otherwise copied as they are, but for their opening comments |

#112's plans mark no task as graded on words, so each task is a work task (`tests/acceptance/3245/README.md`, The surface
under test). `rule.test.ts` and `widen.test.ts` start no eval and need no redraft. `live.test.ts` has the real judge.

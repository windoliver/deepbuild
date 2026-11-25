# #2495 blind redraft, after #3245: the judge answers the control

#3245's Scope: "Each eval's first judge request is that control, under labels like any other's. A judge that scores no
change at 0.5 or above, drafted, or at or above the right change, or gives either no score, ends the eval refused ... and
no agent starts." No criterion, expected value or plant of #2495 is touched: only what its fake `codex` says to a request it
had never been sent.

Written from issue #3245, the design it links, `tests/acceptance/2495/` and base `a5fc47436`, by the job that wrote
`tests/acceptance/3245/`. It never saw an implementation of #3245.

| Original | Why no program meeting #3245 can pass it |
|---|---|
| `2495/report.test.ts`, all three tests (AC1, AC2 adopt, AC2 regresses) | `2495/helpers.ts`'s fake `codex` scores an output by the `quality=` in it, and 0 with none. The control's two outputs are the package's own and hold none, so both score 0: no change is at the right change, each eval ends refused with no agent started, and each test stops at "the fixture's eval reads adopt" or "reads regresses" |

What changed, and nothing else:

| | In #2495's suite | In the redraft |
|---|---|---|
| `helpers.ts` | the fake `codex` | #2495's helpers by import, and its world with the fake `codex` written over: a request that holds no task's words ("Fix the cart total in case") is the control, and its output that shows a change, by a git diff's lines, scores 0.9 and the other 0.1 (`tests/acceptance/3245/README.md`, Readings). Every other request is scored as #2495's scores it |
| `report.test.ts` | | copied as it is, with one line added to its opening comment |

The fixture's agents write their `quality=` into `answer.txt` as well as their reply, and its plans mark no task as graded on
words, so under #3245 every output is the change, which holds it: the fixture's agents stay.

`tests/acceptance/2495/closure/` needs no redraft: its plan measures tokens alone, so its eval asks no judge.

Not run on the base.

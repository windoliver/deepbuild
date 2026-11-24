# #2077 blind redraft, after #3245: the judge answers the control

#3245's Scope: "Each eval's first judge request is that control, under labels like any other's. A judge that scores no
change at 0.5 or above, drafted, or at or above the right change, or gives either no score, ends the eval refused ... and
no agent starts." No criterion, expected value or plant of #2077 is touched: only what its scripted judge says to a request
it had never been sent.

Written from issue #3245, the design it links, `tests/acceptance/2077/` and `303/helpers.ts`, and base `a5fc47436`, by the
job that wrote `tests/acceptance/3245/`. It never saw an implementation of #3245.

| Original | Criteria | Why no program meeting #3245 can pass it |
|---|---|---|
| `2077/removal.test.ts`, all three cases | `#2077.c76c4641`, `#2077.d2415960`, `#2077.c43a0799` | `2077/launcher.mjs`'s judge throws on an output with no `quality=` and `nonce=` in it (adopt, regresses), and gives no grade at all (INCONCLUSIVE). The control's two outputs are the package's own, so each case's eval ends refused with no agent started, and the test stops at "the runner actually starts the configuration replay when room returns" |

What changed, and nothing else:

| | In #2077's test | In the redraft |
|---|---|---|
| `launcher.mjs` | the judge answers every request | the same launcher, by import, with one answer before it: a request that holds no archived task's words ("Fix cart item ") is the control, and its output that shows a change, by a git diff's lines, scores 0.9 and the other 0.1 (`tests/acceptance/3245/README.md`, Readings). Every other request goes to #2077's judge as it is, so the INCONCLUSIVE case still gets no grade, for the agents' work alone |
| what the judge was sent | `{kind: 'judge', ...}` in the trace | the control is `{kind: 'control', ...}`: "neither side nor judge starts past your reserve" still reads an empty trace, so a control sent past the reserve fails it, and "the real eval consults its external judge" still counts the agents' work alone |
| `boundary.mjs` | loads its folder's `launcher.mjs` | copied as it is: it loads this folder's |
| `helpers.ts` | `start` names its folder's `boundary.mjs` | #2077's helpers by import, with `start` over again naming this folder's. Its 30 s bound is a timer with its `// deadline:` reason, as `scripts/wait-ratchet.mjs` asks of a new file |
| `removal.test.ts` | | copied as it is, but for a line of its opening comment |

Each archived session in #2077's fixture holds a prompt and no tool call, so it changed no file: under #3245 its task is
graded on words and its output is the reply, where #2077's agents write their `quality=` and `nonce=`. So #2077's judge
reads what it always read, and the fixture stays.

Not run on the base.

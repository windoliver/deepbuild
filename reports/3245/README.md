# #3245: the proof, on the merge base and on the change

The built `runEval` of each side, driven by one script with stub agents and a stub judge. No model, agent or judge ran.
The plan is six work tasks with one repeat a side, read on November 23, 2026.

- **Six tasks.** Both sides make the same change, and the change side's replies end "Done. All tests pass and every
  criterion is verified." The planted judge scores a reply's words. The base reads `adopt`; the change reads
  INCONCLUSIVE, with each pair's two outputs equal byte for byte.
- **A change of 30,000 characters.** The base grades its first 20,000. The change gives it no grade, names 30,000 and
  20,000, and reads INCONCLUSIVE, naming the tasks.
- **A judge that scores no change 0.9.** The base grades with it. The change is refused before any agent starts.
- **Budget.** Judge requests go from 6 to 7, and agent runs stay at 12.

## Merge base, `a5fc47436`

```
== six work tasks, both sides the same change, the change side says it is done; a judge that believes a reply
outcome: adopt
reason: the one-sided 95% bound beats the base on every declared measure over 6 tasks: grade's mean gain 0.6 has a bound of 0.6 over 6 tasks
first call: agent; judge requests 6, agent runs 12
pairs whose two outputs are equal byte for byte: 0 of 6
requests that show the reply: 6 of 6
== a change of 30,000 characters on every change side
outcome: INCONCLUSIVE
reason: INCONCLUSIVE: grade's mean gain 0 has a bound of 0 over 6 tasks, so it neither adopts nor regresses
first call: agent; judge requests 6, agent runs 12
grades of the 30,000-character runs: [0.9,0.9,0.9,0.9,0.9,0.9]
longest output sent: 20000
report: "(no such field)"
== a judge that scores no change 0.9
outcome: INCONCLUSIVE
reason: INCONCLUSIVE: grade's mean gain 0 has a bound of 0 over 6 tasks, so it neither adopts nor regresses
first call: agent; judge requests 6, agent runs 12
runs: 12; control: "(none)"
```

## The change

```
== six work tasks, both sides the same change, the change side says it is done; a judge that believes a reply
outcome: INCONCLUSIVE
reason: INCONCLUSIVE: grade's mean gain 0 has a bound of 0 over 6 tasks, so it neither adopts nor regresses
first call: judge; judge requests 7, agent runs 12
pairs whose two outputs are equal byte for byte: 6 of 6
requests that show the reply: 0 of 6
== a change of 30,000 characters on every change side
outcome: INCONCLUSIVE
reason: INCONCLUSIVE: grade is missing for t1, t2, t3, t4, t5, t6, so it neither adopts nor regresses
first call: judge; judge requests 7, agent runs 12
grades of the 30,000-character runs: [null,null,null,null,null,null]
longest output sent: 313
report: [{"task":"t1","side":"change","repeat":1,"size":30000,"cap":20000},{"task":"t2","side":"change","repeat":1,"size":30000,"cap":20000},{"task":"t3","side":"change","repeat":1,"size":30000,"cap":20000},{"task":"t4","side":"change","repeat":1,"size":30000,"cap":20000},{"task":"t5","side":"change","repeat":1,"size":30000,"cap":20000},{"task":"t6","side":"change","repeat":1,"size":30000,"cap":20000}]
== a judge that scores no change 0.9
outcome: refused
reason: the judge gpt-reserve scored no change 0.9 and a change that does what was asked 0.9 in the control, so its grades decide nothing: no change must score below 0.5 and below that change
first call: judge; judge requests 1, agent runs 0
runs: 0; control: {"right":0.9,"none":0.9}
```

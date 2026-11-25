# Evidence for #2748

#2748 adds no UI, so there is no screen to film. `shown.png` is drawn from the verbose log of one run of
`tests/acceptance/2748/passes.test.ts` through real hubs (`deep hub run`, the real deep-hook and git; only the second
model is planted), with an evidence strip above it. The run was made on Nov 23, 2026 under the machine's test grant, on
the change over base `5fcfb690b`, on a Mac17,10, which is not a reference Mac.

- `passes-on-change.txt`: that run, 5 of 5 passed, each planted hub failing its criterion's test. The base's run, 5 of 5
  failed, is `tests/acceptance/2748/BASE-FAILURE.txt`.
- `budgets.txt`: criterion 6's file, INCONCLUSIVE at its machine gate.
- `budget-probe.txt`: a throwaway copy of that file with only the gate removed, never committed: "starts no job" held on
  all five samples, and the hold's gain read as noise at a load of about 130 on 18 cores. A reading, never proof.

# Evidence for #1417: graph.layout's cost and the size cap at check

Taken on the Spark (Linux aarch64, 20 cores, 1-minute load about 30) at 93bf3553, which merges origin/main as of
2026-11-08. Nothing here is visual, so there is no screenshot.

- `e2e.mjs` / `e2e.txt`: the canvas check path, `deep-show run`'s `deep_show` call on the shipped build, with one
  `graph@1` item per board. In the data view class (2 ms of frame CPU), 1,000 nodes present (about 1.3 ms). 10,000
  and 100,000 nodes are refused with `over_budget`: `ids` holds the graph, `actual.operators["graph.layout"]` is the
  layout's estimate (16.5 ms and 204.9 ms), and `what` names the costliest operator, `graph.layout`. The same
  100,000 nodes beside a rect a clip moves are refused too. In the export class (no frame cap) they present.
- `acceptance-linux.txt`: `tests/acceptance/1417` with the verbose reporter. 5 pass. AC3's comparison skips as
  INCONCLUSIVE because this is not the reference Mac. Its printed pairs are readings off the Mac, not proof:
  estimate/measured 0.958, 0.982 and 1.024 at 100, 1,000 and 10,000 nodes. On main (the merge base), the
  100,000-node board presents with no issue.
- AC3 on the reference Mac: queued through the Mac runner; its output goes to `mac-1417-acceptance.txt` here when
  it runs.

The layout's coefficient, 46 ns per row and doubling (rows = nodes + edges), was fitted on the Spark from
`deep-graph layout`'s `timed` answers (minimum of 25 to 60 runs: 44 to 49 ns from 100 to 10,000 nodes). It sits in the
graph module, not in `costs.json`. The bench fits the operator's per-item term apart from it, and doesn't measure
it. That is a deviation from "coefficients come from micro-benchmarks on the reference Mac" until a follow-up moves it
into the bench.

// #1417.52357c9c: "A 100,000-node graph is refused at check with `over_budget`, naming the operator and its estimate;
// on main it passes the check".
//
// Through `deep-show run` (the shipped `full` build): a board in the data view class (graphs' class in the budget
// table, Frame CPU 2 ms) holding one graph@1 item of 100,000 nodes in 100 ranks of 1,000, sent by `deep_show`. The
// check refuses it with one error `over_budget` whose `ids` hold the graph, whose `what` names `graph.layout`, and whose
// `actual.operators["graph.layout"]` is the layout operator's estimate, past the class's CPU cap by itself (README:
// Assumed surfaces). The merge base's own `deep-show`, built from `git archive` of it, presents the same board.
import { describe, expect, it } from 'vitest';
import {
  CLASS_CPU_MS, OPERATOR, checked, graphDoc, issuesOf, layoutEstimate, mergeBase, mergeBaseShow, num, obj, overBudget, show,
  str, useEvidence, useShowBuilds,
} from './helpers.ts';

const ID = '#1417.52357c9c';
const build = useShowBuilds([['full']]);
const evidence = useEvidence();
const BUDGET = { class: 'data_view' };
const DOC = '01JB1417000000000000000001';

describe(`${ID} a 100,000-node graph over its class`, () => {
  it(`${ID} is refused at check with over_budget, naming ${OPERATOR} and its estimate`, () => {
    const reply = checked(build(['full']), evidence(), DOC, graphDoc(100000, BUDGET));
    const issue = overBudget(reply, 'the 100,000-node graph in a data view');
    console.log(`${ID}: the refused graph: ${show(issue, 3000)}`);
    expect(issue['ids'], 'over_budget names the graph item among its top contributors').toEqual(expect.arrayContaining(['g']));
    expect(str(issue['what'], 'over_budget: what'), `the refusal's text names the operator ${OPERATOR}`).toContain(OPERATOR);
    const estimate = layoutEstimate(issue, 'the 100,000-node graph');
    const total = num(obj(issue['actual'], 'over_budget: actual')['cpu_ms'], 'actual.cpu_ms');
    expect(estimate, `${OPERATOR}'s estimate alone (${estimate} ms) passes the data view's ${CLASS_CPU_MS} ms of CPU a frame`).toBeGreaterThan(CLASS_CPU_MS);
    expect(estimate, `${OPERATOR}'s estimate is part of the document's (${total} ms)`).toBeLessThanOrEqual(total * (1 + 1e-9));
  }, 3_600_000);

  it(`${ID} on main (the merge base) the same graph passes the check`, () => {
    const sha = mergeBase();
    const base = mergeBaseShow(sha);
    expect(base.error, `the merge base ${sha.slice(0, 12)} builds deep-show`).toBe('');
    const reply = checked(base.path, evidence(), DOC, graphDoc(100000, BUDGET));
    const issues = issuesOf(reply, 'the merge base');
    console.log(`${ID}: merge base ${sha.slice(0, 12)}: outcome ${String(reply['outcome'])}, issues ${show(issues, 800)}`);
    expect(issues.filter((i) => i['code'] === 'over_budget'), 'the merge base raises no over_budget').toEqual([]);
    expect(reply['outcome'], `the merge base passes the check and presents the graph: ${show(reply, 1500)}`).toBe('presented');
  }, 7_200_000);
});

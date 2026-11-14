// #1417.52357c9c: "A 100,000-node graph is refused at check with `over_budget`, naming the operator and its
// estimate; on main it passes the check".
//
// Through `deep-show run` and its `deep_show` call (the full build, on screen in a panel, issues only): one data-view
// board holding one graph@1 item of 100,000 nodes (README: The document). Here it is refused at check, its
// `over_budget` issue naming `graph.layout` and carrying that operator's estimate in `actual` (README: Assumed
// surfaces); at the merge base with origin/main the same bytes are presented with no error and no `over_budget`.
import { describe, expect, it } from 'vitest';
import { OPERATOR, TIMEOUT, bigBoard, deepShow, estimatesIn, issuesOf, namesOperator, show, useEvidence, useShow } from './helpers.ts';

const ID = '#1417.52357c9c';
const bin = useShow(['head', 'base']);
const evidence = useEvidence();
/** The data view's frame CPU cap in ms (canvas primitives: the budget class table): an estimate the graph is over is past it. */
const DATA_VIEW_CPU_MS = 2;

describe(`${ID} a 100,000-node graph against its class's budget`, () => {
  it(`${ID} is refused at check with over_budget, naming the operator ${OPERATOR} and its estimate`, () => {
    const reply = deepShow(bin('head'), evidence(), bigBoard());
    const issues = issuesOf(reply);
    expect(reply['outcome'], `the board is refused at check: ${show(reply)}`).toBe('refused');
    expect(reply['snapshots'], 'refused before it shows, with no snapshot').toEqual([]);
    const over = issues.filter((i) => i['code'] === 'over_budget' && i['severity'] === 'error');
    expect(over.length, `an over_budget error refuses it: ${show(issues)}`).toBeGreaterThan(0);
    const named = over.filter(namesOperator);
    expect(named.length, `an over_budget error names the operator ${OPERATOR}: ${show(over)}`).toBeGreaterThan(0);
    const estimates = named.flatMap(estimatesIn);
    expect(estimates.some((ms) => ms > DATA_VIEW_CPU_MS),
      `the issue naming ${OPERATOR} carries its estimate in actual, in ms, past the data view's ${DATA_VIEW_CPU_MS} ms: ${show(named)}`).toBe(true);
  }, TIMEOUT);

  it(`${ID} on main the same document passes the check`, () => {
    const reply = deepShow(bin('base'), evidence(), bigBoard());
    const issues = issuesOf(reply);
    expect(issues.filter((i) => i['severity'] === 'error'), 'the merge base raises no error at check').toEqual([]);
    expect(issues.filter((i) => i['code'] === 'over_budget'), 'nor any over_budget').toEqual([]);
    expect(reply['outcome'], `the merge base presents it: ${show(reply)}`).toBe('presented');
  }, TIMEOUT);
});

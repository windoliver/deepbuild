// #202.4661a547: "A pack the working agent wrote, whose rule is the only cover of a requirement, leaves that
// requirement INCONCLUSIVE with an approval ask, never PASS, while the same rule from an installed pack the agent
// didn't write still sends the claim back when it fails; and a planted resolver that counts the agent's own rule as
// cover passes that requirement and fails, naming the rule"
//
// asserts: in `r1`, the working agent (session alpha) installs acme/shelf@1.0.0 through its own session and shows its
// deliverable board, one bookcase s1 {width 1.6, dividers 1} on which shelf.span holds; alpha's claim, whose one
// requirement is the check input {kind: kind_rules} (so shelf.span is its only cover), is judged: the requirement is
// INCONCLUSIVE, the claim not PASS, and an approval ask names the requirement. With the same pack installed by the
// scenario (not written by the agent) and a bookcase s2 {width 2.0, dividers 1} on which shelf.span fails, the
// requirement is FAIL with the shelf.span issue on s2 and the claim FAIL. Under `planted:
// "counts_agent_rule_as_cover"` the first claim's requirement passes, and the check fails naming shelf.span.
// Wrong programs: the planted resolver (named); the merge base (kind_rules unrun, BLOCKED; shelf refused).

import { expect, it } from 'vitest';
import {
  ALPHA, BOOKCASE, DOC, PACKS, R1, SHELF, SPAN, agentShow, bindingFailures, board, failsNaming, installPack, item, mentions, none, packAt, packRow,
  requirementRow, run, scenario, show, useBuilds, useEvidence, verdictCall, type JsonObject,
} from './helpers.ts';

const builds = useBuilds([R1]);
const evidence = useEvidence();

const CLAIM = 'claim-alpha';
const REQ = 'req-spans';
const claims: JsonObject = { [CLAIM]: { session: ALPHA.id, deliverables: [DOC.a], requirements: [{ id: REQ, check: { kind: 'kind_rules' } }] } };
const at = [packAt(SHELF)];

/** The agent installs its own shelf pack, shows a bookcase that holds shelf.span, and its claim is judged. */
function agentsOwn(planted?: string): { install: JsonObject; shown: JsonObject; verdict: JsonObject } {
  const holds = board('The agent\'s bookcase', at, [item('s1', BOOKCASE, { width: 1.6, dividers: 1 }, 'a0')]);
  const [install, shown, verdict] = run(builds.bin(R1), scenario(evidence(), [installPack(SHELF, ALPHA.id), agentShow(DOC.a, holds), verdictCall(CLAIM)], { claims, planted }));
  return { install: install!, shown: shown!, verdict: verdict! };
}

it('#202.4661a547 the working agent\'s own pack rule, the only cover of a requirement, leaves it INCONCLUSIVE with an approval ask, while the same rule from a pack it didn\'t write sends the claim back when it fails', () => {
  const own = agentsOwn();
  expect(own.install['outcome'], `the agent's pack installs through its session: ${show(own.install)}`).toBe('installed');
  expect(own.shown['outcome'], `the agent's board is presented: ${show(own.shown)}`).toBe('presented');
  none(bindingFailures(own.verdict, REQ, SPAN), 'the requirement only the working agent\'s own rule covers');

  const breaks = board('A bookcase too wide for its bays', at, [item('s2', BOOKCASE, { width: 2.0, dividers: 1 }, 'a0')]);
  const [packs, shown, verdict] = run(builds.bin(R1), scenario(evidence(), [PACKS, agentShow(DOC.a, breaks), verdictCall(CLAIM)], { packs: [SHELF], claims }));
  expect(packRow(packs!, SHELF).state, 'the pack the agent didn\'t write installs').toBe('installed');
  expect(shown!['outcome'], `the board is shown: ${show(shown!)}`).not.toBe('refused');
  const row = requirementRow(verdict!, REQ);
  expect(row?.['result'], `the same rule from a pack the agent didn't write fails the requirement when it fails: ${show(verdict!)}`).toBe('FAIL');
  expect(mentions(row!['issues'], SPAN) && mentions(row!['issues'], 's2'), `the requirement's issues hold shelf.span on s2: ${show(row!['issues'] ?? null)}`).toBe(true);
  expect(verdict!['result'], 'and the claim goes back: FAIL').toBe('FAIL');
}, 1_800_000);

it('#202.4661a547 a planted resolver that counts the agent\'s own rule as cover passes that requirement and fails this check, naming the rule', () => {
  failsNaming(bindingFailures(agentsOwn('counts_agent_rule_as_cover').verdict, REQ, SPAN), [SPAN], 'the resolver that counts the agent\'s own rule as cover');
}, 1_800_000);

// Criterion 3 of #1352, redrafted blind for #3402: each agent's route on a hosted machine is written down from its
// provider's own terms, as allowed, API key only, or not allowed. The first draft's check, on the section found by its
// anchor, `cloud-hub` (README.md). Offline: it reads docs/technical-design.md in this checkout.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AGENTS, readDesign, routesCheck } from './helpers.mjs';

test('#1352.fbaaa304 criterion 3 (redraft): the section anchored cloud-hub gives each agent the design supports a line naming it with its route on a hosted machine (allowed, API key only, or not allowed) and a link to its provider\'s terms', () => {
  const { routed, problems } = routesCheck(readDesign());
  // No message of its own, so the failure prints each problem: no section, or an agent by name.
  assert.deepEqual(problems, []);
  assert.deepEqual(routed, AGENTS.map(([agent]) => agent), 'the agents with a route written down are not the six');
});

// #23.b2a26445 a standing rule whose evidence can't decide is frozen (it keeps deciding at its scope but can't
// widen), a FAIL revokes it, and each change of state is recorded and shown.

import { test } from 'vitest';
import { failRevokes, frozenKeepsDeciding, inRuleWorld, NO_BREAKAGE_39, SEVEN_IN_40 } from './scenarios.ts';

const LONG = 300_000;

test('#23.b2a26445 a rule whose evidence can\'t decide is frozen: it keeps deciding in its repo, can\'t widen to another, and once its evidence decides it is active again and widens; each change of state recorded and shown', async () => {
  await inRuleWorld(NO_BREAKAGE_39, frozenKeepsDeciding());
}, LONG);

test('#23.b2a26445 a FAIL revokes the rule: recorded and shown, it answers nothing in its repo, can\'t widen, and stays revoked', async () => {
  await inRuleWorld(SEVEN_IN_40, failRevokes());
}, LONG);

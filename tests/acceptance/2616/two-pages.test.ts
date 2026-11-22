// #2616 AC1 and AC2: a head of 45 check runs, 30 on page 1 and 15 on page 2, read by Forge.pull as the receipt reads
// its pull request, on the recorded forge (helpers.ts).
import { expect, it } from 'vitest';
import { fortyFive, label, recordedForge, requests, stateOf } from './helpers.ts';

it('AC1 #2616.eb2caca2 against a recorded forge whose head has 45 check runs over two pages, its one unfinished run on the second, the pull request reads checks running', async () => {
  const head = fortyFive(true);
  const forge = await recordedForge(head);
  try {
    const state = await stateOf(forge);
    expect(state, `${label(head, head.unfinished!)} is the head's one unfinished run, and the pull request reads ${String(state)}\nthe recorded forge was asked:\n${requests(forge.asked)}`).toBe('checks running');
  } finally {
    await forge.close();
  }
}, 180_000);

it('AC2 #2616.f16645e8 with every run on both pages completed and no pending status, the same head of 45 check runs reads open', async () => {
  const head = fortyFive(false);
  const forge = await recordedForge(head);
  try {
    const state = await stateOf(forge);
    expect(state, `all 45 of the head's check runs, 30 on page 1 and 15 on page 2, completed, the head has no commit status, and the pull request reads ${String(state)}\nthe recorded forge was asked:\n${requests(forge.asked)}`).toBe('open');
  } finally {
    await forge.close();
  }
}, 180_000);

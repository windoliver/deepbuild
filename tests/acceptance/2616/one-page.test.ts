// #2616 AC3: a head of 12 check runs, one page, read by Forge.pull as the receipt reads its pull request, on the
// recorded forge (helpers.ts). The planted reader that asks for a page the forge didn't name is the twin
// asks-past-last-page (twins.json).
import { expect, it } from 'vitest';
import { label, recordedForge, requests, stateOf, twelve } from './helpers.ts';

it("AC3 #2616.58c0bef1 a head with 12 check runs, one of them unfinished, reads checks running from one request for check runs, and asks for no page the forge didn't name", async () => {
  const head = twelve();
  const forge = await recordedForge(head);
  try {
    const state = await stateOf(forge);
    const unnamed = forge.asked.filter((a) => a.checkRuns && !a.named).map((a) => a.request);
    expect(unnamed, `the reader asked for a page of check runs the recorded forge didn't name: ${unnamed.join(', ')}\nthe recorded forge was asked:\n${requests(forge.asked)}`).toEqual([]);
    const runs = forge.asked.filter((a) => a.checkRuns).map((a) => a.request);
    expect(runs, `the head's 12 check runs fit one page, and the reader asked for check runs ${runs.length} times: ${runs.join(', ')}`).toHaveLength(1);
    expect(state, `${label(head, head.unfinished!)} is unfinished, and the pull request reads ${String(state)}\nthe recorded forge was asked:\n${requests(forge.asked)}`).toBe('checks running');
  } finally {
    await forge.close();
  }
}, 180_000);

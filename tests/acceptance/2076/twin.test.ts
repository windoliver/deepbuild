import { afterAll, describe, expect, it } from 'vitest';
import { callTool } from '../111/helpers.ts';
import { MOMENT, agentIn, cleanupAll, hubFor, inbox, momentWorld, proposals, rejectMoment, settle, stopHub } from './helpers.ts';

afterAll(cleanupAll, 120_000);
const AC3 = '#2076.8efd8683';

describe(`${AC3} an agent's own deep_propose of a rejected direction`, () => {
  it(`${AC3} an agent's deep_propose that names \`moment\`, which you rejected, is refused citing your decision and never reaches you; one naming another direction does`, async () => {
    const w = momentWorld();
    const hub = await hubFor(w);
    try {
      const saved = await rejectMoment(w, hub);
      const { agent } = await agentIn(w, 'what do the date helpers do?');
      const stopped = await callTool(agent, 'deep_propose', { target: 'the date helpers', change: `Parse every date with \`${MOMENT}\`, marker zircon`, evidence: null });
      expect(stopped.isError, `the agent's proposal of \`${MOMENT}\` is refused: ${JSON.stringify(stopped.reply).slice(0, 800)}`).toBe(true);
      expect(JSON.stringify(stopped.value), 'the refusal cites your decision by its handle').toContain(`decision:${saved.id}`);
      expect(proposals(await settle(hub, () => true, 0), 'zircon'), 'no proposal of it is recorded').toEqual([]);
      expect(await inbox(w), 'you aren\'t asked about it').not.toContain('zircon');

      const other = await callTool(agent, 'deep_propose', { target: 'the date helpers', change: 'Parse every date with `dayjs`, marker jasper', evidence: null });
      expect(other.isError, `a direction you didn't reject isn't refused: ${JSON.stringify(other.reply).slice(0, 800)}`).toBe(false);
      expect(await inbox(w), 'and reaches you').toContain('jasper');
    } finally {
      await stopHub(hub);
    }
  }, 300_000);
});

// #1906 AC4: the shared duration parser must retain each caller's accepted units, not silently widen them.
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import fc from 'fast-check';
import { expect, it, vi } from 'vitest';
import { longestDeadline } from '../src/claude-settings.js';
import { Channels, type ChannelAsk } from '../src/channels.js';
import { Devices } from '../src/trusted.js';

it('longest ask deadline keeps the whole-number m/h/d grammar (1000 cases, seed 1906)', () => {
  const root = mkdtempSync(join(tmpdir(), 'duration-1906-'));
  try {
    fc.assert(fc.property(fc.integer({ min: 0, max: 1000 }), fc.constantFrom('s','m','h','d'), (n, unit) => {
      writeFileSync(join(root, 'config.json'), JSON.stringify({ asks: { deadline: { one: `${n}${unit}` } } }));
      expect(longestDeadline(root)).toBe(unit === 's' ? undefined : n * { m: 60_000, h: 3_600_000, d: 86_400_000 }[unit as 'm'|'h'|'d']);
    }), { seed: 1906, numRuns: 1000 });
    for (const value of ['1.5h', '-1m', '5M', ' 5m', 5, null, {}, []]) {
      writeFileSync(join(root, 'config.json'), JSON.stringify({ asks: { deadline: { one: value, two: '2h' } } }));
      expect(longestDeadline(root)).toBe(7_200_000);
    }
  } finally { rmSync(root, { recursive: true, force: true }); }
});

it.each([['30s',30_000],['2m',120_000],['1h',3_600_000],['1d',86_400_000]] as const)('channel escalation still accepts %s', async (unseen, delay) => {
  const root = mkdtempSync(join(tmpdir(), 'channel-duration-1906-'));
  let now = Date.UTC(2026, 0, 1, 12);
  const sent: string[] = [];
  writeFileSync(join(root, 'channels.json'), JSON.stringify({ channels: { first: {}, next: {} }, routes: [{ kinds: ['choice'], to: ['first'], next: ['next'], unseen, urgent: true }] }));
  const ask: ChannelAsk = { handle: 'ask:ONE', kind: 'choice', question: 'Keep the heading?', options: [{ id: 'keep', label: 'Keep' }], status: 'shown', outcome: 'unanswered', answer: null, plan: null, revision: 1 };
  const channels = new Channels({ root, hub: 'test', now: () => now, devices: new Devices(join(root,'devices.json')), loaded: () => [{ name: 'first', kind: 'chat', steps: false },{ name:'next', kind:'chat', steps:false }], asks: async () => [ask], append: async () => {}, answer: async () => {}, cancel: async () => {}, call: async (name, op) => { if (op === 'receive') return { answers: [], seen: [], conflict: null }; sent.push(name); return { outcome:'delivered', ack: 'accepted' }; } });
  vi.useFakeTimers({ toFake: ['setInterval','clearInterval','Date'] });
  vi.setSystemTime(now);
  channels.start();
  try {
    await vi.advanceTimersByTimeAsync(500);
    expect(sent).toEqual(['first']);
    now += delay - 1;
    await vi.advanceTimersByTimeAsync(250);
    expect(sent).toEqual(['first']);
    now++;
    await vi.advanceTimersByTimeAsync(250);
    expect(sent).toEqual(['first','next']);
  } finally { channels.stop(); vi.useRealTimers(); rmSync(root, { recursive: true, force: true }); }
});

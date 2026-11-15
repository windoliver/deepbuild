// #2123.8ad68fab A channel send that answers nothing backs off as a stalled send. Given a Channels whose call answers
// null and one live ask routed to it, when ticks run for two seconds, then deliver was called once and again only at
// its back-off, and channel.delivered with outcome stalled is on the record.
//
// The surface is the criterion's own: the hub's `Channels` (packages/hub/src/channels.ts), the real class with the
// real `Devices`, its settings read from a real channels.json. What it is given stands in only for what a channel
// package's provider and the rest of the hub give it: `call` (the package's answer, here null for a deliver, as a
// deliver that returns nothing arrives), `asks` (one live ask) and `append` (the record). The ticks are the class's
// own 250 ms timer, run on a clock the test controls, as packages/hub/test/duration-fold.test.ts runs them, so a slow
// machine changes nothing: two seconds of ticks are eight ticks.
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Channels, type ChannelAsk } from '../../../packages/hub/src/channels.ts';
import { Devices } from '../../../packages/hub/src/trusted.ts';
import { AC } from './helpers.ts';

const CHANNEL = 'chat';
const ASK: ChannelAsk = {
  handle: 'ask:01JD2123CHANNEL0000000001', kind: 'choice', question: 'Keep the cache in SQLite or in plain files?',
  options: [{ id: 'sqlite', label: 'SQLite' }, { id: 'files', label: 'Plain files' }], status: 'shown', outcome: 'unanswered', answer: null, plan: null, revision: 1,
};
/** The longest a failed send waits before it goes again, with room: the back-off the base's own sends take ends well inside it. */
const BACK_OFF_BOUND_MS = 60_000;

let root: string | undefined;
let channels: Channels | undefined;
afterEach(() => {
  channels?.stop();
  vi.useRealTimers();
  if (root) rmSync(root, { recursive: true, force: true });
  root = channels = undefined;
});

describe(`${AC.channel} A channel send that answers nothing backs off as a stalled send`, () => {
  it(`${AC.channel} a Channels whose call answers null, one live ask routed to it: in two seconds of ticks deliver is called once, channel.delivered with outcome stalled is on the record, and deliver is called again only at its back-off`, async () => {
    root = mkdtempSync(join(tmpdir(), 'dh2123-channel-'));
    writeFileSync(join(root, 'channels.json'), JSON.stringify({ channels: { [CHANNEL]: {} }, routes: [{ kinds: [ASK.kind], to: [CHANNEL] }] }));
    const start = Date.UTC(2026, 10, 10, 12);
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] });
    vi.setSystemTime(start);
    /** When each deliver was called, in ms of ticks since the start. */
    const delivers: number[] = [];
    const record: { kind: string; data: Record<string, unknown>; at: number }[] = [];
    channels = new Channels({
      root, hub: 'hub-2123', now: () => Date.now(), devices: new Devices(join(root, 'devices.json')),
      loaded: () => [{ name: CHANNEL, kind: 'chat', steps: false }],
      asks: async () => [ASK],
      append: async (kind, data) => { record.push({ kind, data, at: Date.now() - start }); },
      answer: async () => undefined, cancel: async () => undefined,
      call: async (_name, op) => {
        if (op === 'receive') return { answers: [], seen: [], conflict: null };
        delivers.push(Date.now() - start);
        return null;
      },
    });
    channels.start();

    // When: ticks run for two seconds.
    await vi.advanceTimersByTimeAsync(2000);
    const stalled = () => record.filter((e) => e.kind === 'channel.delivered' && e.data.channel === CHANNEL && e.data.thread_key === ASK.handle && e.data.outcome === 'stalled');
    expect(delivers, `deliver calls in two seconds of ticks, by when each was made (ms); the record: ${JSON.stringify(record.map((e) => [e.kind, e.data.outcome, e.at]))}`).toHaveLength(1);
    expect(stalled(), `channel.delivered events with outcome stalled for ${ASK.handle} on ${CHANNEL}; the record holds ${JSON.stringify(record.map((e) => [e.kind, e.data.outcome]))}`).toHaveLength(1);

    // And again only at its back-off: the next deliver comes later, once, and is recorded stalled too.
    for (let waited = 0; delivers.length < 2 && waited < BACK_OFF_BOUND_MS; waited += 250) await vi.advanceTimersByTimeAsync(250);
    expect(delivers, `deliver calls once the back-off has passed, by when each was made (ms)`).toHaveLength(2);
    expect(delivers[1]! - delivers[0]!, 'ms from the first deliver to the one at its back-off: more than one 250 ms tick').toBeGreaterThan(250);
    await vi.advanceTimersByTimeAsync(250);
    expect(delivers, 'deliver calls one tick after the back-off send: it backs off again').toHaveLength(2);
    expect(stalled(), 'channel.delivered events with outcome stalled after the second send').toHaveLength(2);
  }, 120_000);
});

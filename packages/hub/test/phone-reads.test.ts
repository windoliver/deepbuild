// Reads a phone can afford (#1576), the parts tests/acceptance/1576 leaves out: an events.read page holds at most 1 MiB
// of events past its first and says when there is more; a session's page reads a window of its 10 newest returns or its
// newest 1 MiB, older ones by page; and sessions.read's later pages find every settled session once. Each fails on the
// merge base: its first page holds every event, it has no session.page, and its sessions.read has no page.
import net from 'node:net';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { ulid } from '../src/wire.js';
import { hookLine, send, session, withHub } from './hub.js';

type Line = Record<string, any>;
const MIB = 1 << 20;
const sleep = (ms: number) => new Promise((done) => setTimeout(done, ms));
const bytes = (events: Line[]) => events.reduce((sum, e) => sum + Buffer.byteLength(JSON.stringify(e)), 0);

/** The app's connection: `call` resolves with a method's result, or throws its refusal. */
async function asApp(root: string): Promise<{ call: (method: string, params: Line) => Promise<Line>; close: () => void }> {
  const sock = net.connect(join(root, 'hub.sock'));
  const lines: Line[] = [];
  let buf = '';
  sock.on('data', (d) => { buf += d; let i; while ((i = buf.indexOf('\n')) >= 0) { lines.push(JSON.parse(buf.slice(0, i))); buf = buf.slice(i + 1); } });
  const until = async <T>(f: () => T | undefined): Promise<T> => { for (let i = 0; i < 1200; i++) { const v = f(); if (v) return v; await sleep(50); } throw Error('no answer from the hub'); };
  await until(() => lines[0]);
  sock.write(`${JSON.stringify({ v: 1, hello: 'app', token: readFileSync(join(root, 'control.token'), 'utf8').trim() })}\n`);
  await until(() => lines.find((l) => l.role));
  let n = 0;
  return {
    call: async (method, params) => {
      const id = `c${++n}`;
      sock.write(`${JSON.stringify({ v: 1, id, method, params })}\n`);
      const reply = await until(() => lines.find((l) => l.id === id));
      if (!reply.result) throw Error(`${method} was refused: ${JSON.stringify(reply.error)}`);
      return reply.result;
    },
    close: () => sock.destroy(),
  };
}

it('events.read, a session\'s page and sessions.read each read a page a phone can afford, and paging finds the rest once', async () => {
  await withHub(async (root, home) => {
    const socket = join(root, 'hub.sock');
    const hook = (id: string, event: string, extra: Line) => send(socket, hookLine(ulid(Date.now()), event, session(home, id).payload(event, extra)));
    // A: twelve turns, each a prompt and a stop. B: 160 prompts of 8,000 characters, over 1 MiB, then a stop. 28 others
    // with one turn each, stopped: with A and B, 30 settled. D: started, no prompt yet, so live; no session is left
    // working, so no quiet mark lands while the test reads.
    const [a, b, d] = ['15760000-1111-4222-8333-00000000000a', '15760000-1111-4222-8333-00000000000b', '15760000-1111-4222-8333-00000000000d'];
    const others = Array.from({ length: 28 }, (_, i) => `15760000-1111-4222-8333-${String(i).padStart(12, '0')}`);
    await hook(a, 'SessionStart', { source: 'startup' });
    for (let i = 0; i < 12; i++) {
      await hook(a, 'UserPromptSubmit', { prompt: `turn ${i}` });
      await hook(a, 'Stop', { stop_hook_active: false });
    }
    await hook(b, 'SessionStart', { source: 'startup' });
    for (let i = 0; i < 160; i++) await hook(b, 'UserPromptSubmit', { prompt: `${String(i).padStart(4, '0')} ${'x'.repeat(7995)}` });
    await hook(b, 'Stop', { stop_hook_active: false });
    for (const id of others) {
      await hook(id, 'SessionStart', { source: 'startup' });
      await hook(id, 'UserPromptSubmit', { prompt: 'one turn' });
      await hook(id, 'Stop', { stop_hook_active: false });
    }
    await hook(d, 'SessionStart', { source: 'startup' });
    const app = await asApp(root);
    // Settled: the log's end hasn't moved for a second.
    const end = async () => { let after = 0; for (;;) { const p = await app.call('events.read', { after, limit: 1000 }); if (!p.events.length) return after; after = p.log_pos; } };
    for (let was = -1, now = await end(); now !== was; was = now, await sleep(1000), now = await end());

    // events.read: each page's events past its first come to at most 1 MiB, a page the cap ended says `more`, and
    // paging on finds every event once, in order.
    const pages: Line[] = [];
    for (let after = 0; ;) {
      const page = await app.call('events.read', { after, limit: 1000 });
      pages.push(page);
      if (!page.events.length) break;
      after = page.log_pos;
    }
    const first = pages[0]!;
    expect(bytes(first.events.slice(0, -1)), 'the first page past its last event').toBeLessThan(MIB);
    expect(first.more, 'a page the byte cap ended says there is more').toBe(true);
    const all = pages.flatMap((p) => p.events as Line[]);
    expect(all.map((e) => e.log_pos), 'every event once, in order').toEqual([...new Set(all.map((e) => e.log_pos))].sort((x, y) => x - y));
    expect(all.filter((e) => e.session === b && e.kind === 'user.ask').length, "every one of B's prompts").toBe(160);

    // A session's page: A's window holds its 10 newest returns, and its next page the two before and its start.
    const ofA = all.filter((e) => e.session === a);
    const windowA = await app.call('session.page', { session: a });
    expect(windowA.events.filter((e: Line) => e.kind === 'agent.stop').length, "A's window holds 10 returns").toBe(10);
    expect(windowA.events.every((e: Line) => e.session === a), "A's window holds only A's events").toBe(true);
    expect(typeof windowA.next, 'an older window is there to read').toBe('string');
    const olderA = await app.call('session.page', { session: a, page: windowA.next });
    expect(olderA.next, 'nothing older than the second window').toBeNull();
    expect([...olderA.events, ...windowA.events].map((e: Line) => e.log_pos), "the two windows hold every A event once, in order").toEqual(ofA.map((e) => e.log_pos));
    // B's window is its newest 1 MiB at most, its newest event in it; following next finds every B event once.
    const ofB = all.filter((e) => e.session === b);
    const windows: Line[] = [await app.call('session.page', { session: b })];
    expect(bytes(windows[0]!.events.slice(1)), "B's window past its first event").toBeLessThan(MIB);
    expect(windows[0]!.events.at(-1).log_pos, "B's window ends on its newest event").toBe(ofB.at(-1)!.log_pos);
    while (windows.at(-1)!.next && windows.length < 10) windows.push(await app.call('session.page', { session: b, page: windows.at(-1)!.next }));
    expect(windows.reverse().flatMap((w) => w.events).map((e: Line) => e.log_pos), "B's windows hold every B event once, in order").toEqual(ofB.map((e) => e.log_pos));

    // sessions.read: D live; A, B and the 28 others settled, 25 on the first page and the other 5 on the next.
    const listed = await app.call('sessions.read', {});
    const settled = [a, b, ...others];
    const firstSettled = listed.sessions.filter((s: Line) => settled.includes(s.id));
    expect(listed.sessions.some((s: Line) => s.id === d), 'the live session on the first page').toBe(true);
    expect(firstSettled.length, 'the 25 newest settled on the first page').toBe(25);
    expect(listed.rest, 'the rest counted').toBe(5);
    const second = await app.call('sessions.read', { page: listed.next });
    expect([second.rest, second.next], 'the last page').toEqual([0, null]);
    expect([...firstSettled, ...second.sessions].map((s: Line) => s.id).sort(), 'every settled session once').toEqual([...settled].sort());
    app.close();
  });
}, 600_000);

// AC3: three extensions that add context, deny, and miss the hook's deadline give the same reply in every order they
// registered or finished in: the deny stands, the context stays within the total bound, the late one is recorded as
// failed, and its late reply changes no later request. AC8: past the bound, the first-party z-notes stays whole and
// the outside packages a and b are cut to equal shares of what's left; a host that joins by ID alone, and one that
// keeps a whole and cuts b, each fail, naming the extension.
//
// AC3's three are outside packages in the sandbox, each filling its own templates. Every registration order (the
// order they load in, all six) runs with both finishing orders of the two in time (context first, deny first), on
// a fresh world each: twelve runs. Each run sends two requests: the first with an 800 ms deadline, which the late
// one misses (it answers after 2.2 s), and the second right after with a 6 s deadline, which the late one meets
// after 2 s, so its late reply to the first arrives while the second is still waiting on it. Each block of the late
// one names the call it answers, so its first reply taken for the second shows.
import { describe, expect, it } from 'vitest';
import type { HookReply, Plant } from '../../../packages/extension-host/src/index.ts';
import { blocksOf, chars, installAndLoad, openHost, openWorld, pkg, releaseEntry, toolBefore } from './helpers.ts';
import { A, B, judgeCut, roomFor, Z_NOTES } from './judges.ts';

const CTX = 'test/ctx';
const DENY = 'test/deny';
const LATE = 'test/late';
const DEADLINE = 800;
const BOUND = 5_000;

/** Every order of a list. */
const orders = <T>(items: T[]): T[][] => (items.length <= 1 ? [items] : items.flatMap((x, i) => orders([...items.slice(0, i), ...items.slice(i + 1)]).map((rest) => [x, ...rest])));
/** The reply as the agent and the record get it; a failure's wording (which may give times) is reduced to who failed. */
const shape = (r: HookReply) => ({ order: r.order, bound: r.bound, denies: r.denies, context: r.context, failed: r.failed.map((f) => f.extension).sort() });

interface Run { registration: string[]; first: 'context' | 'deny'; r1: HookReply; r2: HookReply }
async function run(registration: string[], first: 'context' | 'deny'): Promise<Run> {
  const w = await openWorld();
  const h = await openHost(w);
  const dirs: Record<string, string> = {
    [CTX]: await pkg('hooker', { manifest: { id: CTX }, probe: { role: 'context', delay: first === 'context' ? 20 : 250 } }),
    [DENY]: await pkg('hooker', { manifest: { id: DENY }, probe: { role: 'deny', delay: first === 'deny' ? 20 : 250 } }),
    [LATE]: await pkg('hooker', { manifest: { id: LATE }, probe: { role: 'late', first: 2_200, next: 2_000 } }),
  };
  for (const id of registration) await installAndLoad(h, dirs[id]!);
  const r1 = await h.hook(toolBefore(DEADLINE, BOUND));
  const r2 = await h.hook(toolBefore(6_000, BOUND));
  await h.close();
  return { registration, first, r1, r2 };
}
let all: Promise<Run[]> | undefined;
const runs = (): Promise<Run[]> => (all ??= (async () => {
  const out: Run[] = [];
  for (const registration of orders([CTX, DENY, LATE])) for (const first of ['context', 'deny'] as const) out.push(await run(registration, first));
  return out;
})());

describe('AC3 #350.b88afef3 three extensions that add context, deny, and miss the deadline give the same reply in every order they registered or finished in: the deny stands, the context stays within the bound, the late one is recorded as failed, and its late reply changes no later request', () => {
  it('AC3 all six registration orders, each with both finishing orders, give the same first reply and the same second reply', async () => {
    const [base, ...rest] = await runs();
    for (const r of rest) {
      const where = `registered ${r.registration.join(', ')}, ${r.first} finishing first`;
      expect(shape(r.r1), `${where}: the first reply`).toEqual(shape(base!.r1));
      expect(shape(r.r2), `${where}: the second reply`).toEqual(shape(base!.r2));
    }
  }, 600_000);

  it('AC3 the deny stands, the context stays within the total bound, and the one past the deadline is recorded as failed and adds nothing', async () => {
    for (const r of await runs()) {
      const where = `registered ${r.registration.join(', ')}, ${r.first} finishing first`;
      for (const reply of [r.r1, r.r2]) {
        expect(reply.denies.map((d) => d.extension), `${where}: the deny stands`).toEqual([DENY]);
        expect(reply.denies[0]?.reason, `${where}: the deny's reason, from its template`).toContain('claim:01K74G1Z3X5V7T9R1P3N5M7K9H');
        expect(reply.context.reduce((n, b) => n + chars(b.text), 0), `${where}: context within the bound`).toBeLessThanOrEqual(BOUND);
        expect(blocksOf(reply, CTX).length, `${where}: the context block`).toBe(1);
      }
      expect(r.r1.failed.map((f) => f.extension), `${where}: only the late one is recorded as failed`).toEqual([LATE]);
      expect(blocksOf(r.r1, LATE), `${where}: the late one added nothing to the request it missed`).toEqual([]);
    }
  }, 600_000);

  it('AC3 the late one\'s reply to the first request, arriving while the second waits on it, changes nothing in the second', async () => {
    for (const r of await runs()) {
      const where = `registered ${r.registration.join(', ')}, ${r.first} finishing first`;
      const late = blocksOf(r.r2, LATE).map((b) => b.text).join(' | ');
      expect(late, `${where}: the second request got the late one's own reply to it`).toMatch(/call 2\b/);
      expect(late, `${where}: the late one's reply to the first request reached the second`).not.toMatch(/call 1\b/);
      expect(r.r2.failed, `${where}: nothing failed in the second request`).toEqual([]);
    }
  }, 600_000);
});

describe('AC8 #350.170a7bd3 three contexts past the bound, from the first-party z-notes and the outside a and b, keep z-notes whole and cut a and b to equal shares of what\'s left; a host that joins by ID alone, and one that keeps a whole and cuts b, fail, naming the extension', () => {
  /**
   * The scenario: z-notes in the hub from the release, acme/a and acme/b in the sandbox. A first request with room
   * for everything gives each whole block; a second's bound is z-notes' block plus the room `roomFor` leaves.
   */
  async function scenario(plant?: Plant): Promise<{ full: HookReply; cut: HookReply; room: number }> {
    const notes = await pkg('notes');
    const a = await pkg('outside', { manifest: { id: A } });
    const b = await pkg('outside', { manifest: { id: B } });
    const w = await openWorld();
    const h = await openHost(w, { release: [await releaseEntry(notes)], ...(plant ? { plant } : {}) });
    for (const dir of [notes, a, b]) await installAndLoad(h, dir);
    const places = Object.fromEntries((await h.loaded()).map((l) => [l.id, l.place]));
    expect(places, 'z-notes in the hub, a and b in the sandbox').toEqual({ [Z_NOTES]: 'hub', [A]: 'sandbox', [B]: 'sandbox' });
    const full = await h.hook(toolBefore(10_000, 100_000));
    for (const id of [Z_NOTES, A, B]) expect(blocksOf(full, id).length, `${id}'s block with room for everything`).toBe(1);
    const room = roomFor(full);
    const z = chars(blocksOf(full, Z_NOTES)[0]!.text);
    const cut = await h.hook(toolBefore(10_000, z + room));
    return { full, cut, room };
  }

  it('AC8 z-notes is kept whole, and a and b are each cut to half the room left, keeping their starts', async () => {
    const { full, cut, room } = await scenario();
    expect(judgeCut(full, cut, room)).toEqual([]);
  }, 120_000);

  it('AC8 (wrong program) a host that joins by ID alone cuts z-notes and fails, naming it', async () => {
    const { full, cut, room } = await scenario('join-by-id-alone');
    const problems = judgeCut(full, cut, room);
    expect(problems.some((p) => p.startsWith(`${Z_NOTES}, the first-party extension, was cut`)), JSON.stringify(problems)).toBe(true);
  }, 120_000);

  it('AC8 (wrong program) a host that keeps a whole and cuts b fails, naming a', async () => {
    const { full, cut, room } = await scenario('cut-in-join-order');
    const problems = judgeCut(full, cut, room);
    expect(problems.some((p) => p.startsWith(`${A} got`) && p.includes('kept whole')), JSON.stringify(problems)).toBe(true);
  }, 120_000);
});

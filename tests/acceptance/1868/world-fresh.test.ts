// #1868.a903f1c6: a reading recorded after the world was built shows in the next deep_show's world, and an ask answered
// since shows as done. A planted world built once at start reads the old values and fails this test, naming the reading.
//   node_modules/.bin/vitest run tests/acceptance/1868/world-fresh.test.ts
// One hub of this checkout, started on a record that already holds a session's open ask and one reading (probe.mjs,
// seed-world), so a world built at the hub's start holds both. That session starts through its hooks from an agent
// stand-in (agent.mjs) and calls deep_show and deep_query through that agent's own `deep mcp`. What a deep_show's world
// held is read as #393 reads it: a document that binds a value to a reading the world doesn't hold is refused with
// ref_unresolved naming the handle. The state the world gives an ask is the one a status mark bound to it reads:
// deep_query's status of the mark in the revision the deep_show presented, or, when the deep_show's status binding
// can't be drawn for that state, the state its issue names at the binding's source (`status_bindings/<id>/source:
// <state>`). The base's status map has no `done`, so on the base a mark bound to a done ask is refused that way.
//   1. deep_show of a document bound to the ask and the seeded reading: presented, the ask needs_you. Every program
//      must pass this: by now the world is built, at the hub's start or at this call.
//   2. The hub records a reading: two other sessions in two worktrees of #1018's sample repo claim the same task, and
//      the second claim reads a check as carried from the first session's run, which the gate records as a reading
//      (`runs saved by carrying across sessions`, value 1) under a handle of its own. And you answer the ask (ask.answer).
//   3. The next deep_show, of a document bound to that reading: presented, not refused ref_unresolved naming it.
//   4. The deep_show after, of a document bound to the ask: the ask's state reads done, not needs_you.
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { afterEach, describe, it } from 'vitest';
import { cleanup, type Ev } from '../29/h-d.ts';
import { FIXED_CART } from '../31/helpers.ts';
import { draft, makeTrees, open, removeTemp, requirement, SAMPLE, settled, startHub, stop, stopHub, vitestCheck, writes, type Hub } from '../1018/helpers.ts';
// @ts-expect-error lib.mjs is plain JavaScript, shared with this folder's node --test files.
import { Agent, as, makeWorktree, probe, resultOf, ulid, unbuilt } from './lib.mjs';

const SESSION = '18680002-0000-4000-8000-000000001868';
const FILL = 'items/gate/params/paint/fill', TEXT = 'items/count/params/text';
const CARRIED = 'runs saved by carrying across sessions';

// #1018's AC2 scenario: three drafted checks, two of which leave src/cart.ts out, so the second claim carries them.
const PROMPT = 'make the checkout total take the discount off';
const PRICE = '.deepbuild/checks/price.sh', FORMAT = '.deepbuild/checks/format.sh', JOURNEY = '.deepbuild/checks/journey:checkout';
const FILES: Record<string, string> = {
  ...SAMPLE,
  'src/price.ts': 'export const withTax = (amount: number): number => Math.round(amount * 1.2);\n',
  'src/format.ts': 'export const money = (amount: number): string => `$${amount.toFixed(2)}`;\n',
  'test/price.test.ts': "import { expect, it } from 'vitest';\nimport { withTax } from '../src/price.ts';\n\nit('adds the tax', () => {\n  expect(withTax(100)).toBe(120);\n});\n",
  'test/format.test.ts': "import { expect, it } from 'vitest';\nimport { money } from '../src/format.ts';\n\nit('shows dollars', () => {\n  expect(money(9)).toBe('$9.00');\n});\n",
  'test/checkout.test.ts': "import { expect, it } from 'vitest';\nimport { total } from '../src/cart.ts';\n\nit('checks out with the discount taken off', () => {\n  expect(total({ items: [100], discount: 10 })).toBe(90);\n});\n",
  [PRICE]: vitestCheck('test/price.test.ts'),
  [FORMAT]: vitestCheck('test/format.test.ts'),
  [JOURNEY]: vitestCheck('test/checkout.test.ts'),
};
const CART_B = 'export interface Cart { items: number[]; discount: number }\nexport function total(cart: Cart): number {\n  let sum = 0;\n  for (const item of cart.items) sum += item;\n  return sum - cart.discount;\n}\n';

/** A board with a status mark bound to `askHandle`'s state, a count bound to `readingHandle`'s value, or both, as #393's suite draws one. */
const board = (title: string, askHandle: string | null, readingHandle: string | null) => ({
  format: 1, profile: 'board', title, description: `${title}, drawn by a test agent through deep_show.`, size: [320, 120],
  items: {
    back: { id: 'back', kind: 'rect@1', name: 'Backdrop', order: 'a0', params: { box: [0, 0, 320, 120] } },
    gate: { id: 'gate', kind: 'rect@1', name: 'Ask state', order: 'a1', params: { box: [16, 16, 96, 24] } },
    count: { id: 'count', kind: 'text@1', name: 'Reading', order: 'a2', params: { text: '', font: 'body', size: 13, numerals: 'tabular', widest: '9999999', box: { w: 160, h: 20 } }, at: { pos: [16, 64, 0] } },
  },
  ...(askHandle ? { status_bindings: { 'gate-state': { target: FILL, source: askHandle } } } : {}),
  ...(readingHandle ? { bound_values: { 'the-reading': { target: TEXT, source: readingHandle } } } : {}),
});

// Removing the worlds' cloned installs takes a while on a loaded machine.
afterEach(async () => {
  await cleanup();
  removeTemp();
}, 300_000);

describe('#1868 the world a deep_show reads', () => {
  it('#1868.a903f1c6 a reading recorded after the world was built shows in the next deep_show\'s world, and an ask answered since shows as done', async () => {
    const blocked = unbuilt({ canvas: true });
    if (blocked) throw Error(blocked);
    const world = makeTrees(FILES, [draft(PROMPT, [
      requirement('R1', 'Prices carry the tax', PRICE), requirement('R2', 'Amounts show as dollars', FORMAT), requirement('R3', 'Checkout takes the discount off', JOURNEY),
    ])], 2);
    const worktree = makeWorktree(world.tmp);
    const seeded = await probe('seed-world', { ledger: join(world.root, 'ledger.db'), now: Date.now(), session: SESSION, worktree });
    if (seeded.state !== 'open') throw Error(`BLOCKED: the seeded ask ${seeded.ask} reads ${seeded.state} in the record, not open`);
    let hub: Hub | undefined;
    let agent: any;
    try {
      hub = await startHub(world);
      const live = hub;
      agent = new Agent(live, worktree, SESSION);
      await agent.establish();
      /**
       * deep_show of a board bound to `ask`, to `reading`, or to both: its outcome, the handles it couldn't resolve, and
       * the ask's state as the status mark reads it (the head comment). Each is a document of its own, at its first revision.
       */
      const shown = async (title: string, ask: string | null, reading: string | null) => {
        const doc = ulid();
        const reply = (await agent.tool('deep_show', { doc, document: board(title, ask, reading), include: ['issues'] })).value ?? {};
        const issues: any[] = Array.isArray(reply.issues) ? reply.issues : [];
        const missing: string[] = issues.filter((issue) => issue?.code === 'ref_unresolved').map((issue) => String(issue.actual ?? JSON.stringify(issue)));
        const named = issues.map((issue) => /^status_bindings\/gate-state\/source: ([a-z_]+)$/.exec(String(issue?.path))?.[1]).find((state) => state !== undefined);
        if (reply.outcome !== 'presented' || !ask) return { outcome: String(reply.outcome), missing, reply, state: named, rows: {} };
        const rows = (await agent.tool('deep_query', { doc, what: 'rows', paths: [FILL] })).value ?? {};
        return { outcome: 'presented', missing, reply, state: rows.values?.[FILL]?.[0]?.status as string | undefined, rows };
      };
      const said = (reply: unknown) => JSON.stringify(reply).slice(0, 700);
      /** The readings the record holds, oldest first, as events.read gives them. */
      const readings = async (): Promise<Ev[]> => resultOf(await as(live, 'cli', (call: any) => call('events.read', { kinds: ['reading.recorded'] })), 'events.read').events;

      // 1. The world as the record stood when the hub started.
      const first = await shown('World one', seeded.ask, seeded.reading);
      if (first.outcome !== 'presented' || first.state !== 'needs_you') {
        throw Error(`BLOCKED: the fixture doesn't read as seeded, so nothing later can be judged: a deep_show bound to the session's open ask ${seeded.ask} and the reading ${seeded.reading} seeded before the hub started was ${first.outcome} and the ask read ${JSON.stringify(first.state)}: ${said(first.reply)} ${said(first.rows)}`);
      }
      const before = new Set((await readings()).map((event) => event.id));

      // 2. Since then: a reading recorded by the hub (a check carried across two sessions), and the ask answered by you.
      const a = await open(live, world, world.trees[0]!, PROMPT);
      const b = await open(live, world, world.trees[1]!, PROMPT);
      await writes(a, { 'src/cart.ts': FIXED_CART });
      await stop(a);
      await settled(live, world, [a]);
      await writes(b, { 'src/cart.ts': CART_B });
      await stop(b);
      const after = await settled(live, world, [a, b]);
      const recorded = (await readings()).filter((event) => !before.has(event.id));
      const carried = recorded.find((event) => String(event.data.source).startsWith(CARRIED) && /^reading:[0-9A-HJKMNP-TV-Z]{26}$/.test(String(event.data.reading)));
      if (!carried) {
        throw Error(`BLOCKED: the hub recorded no reading for a check carried across the two sessions, so there is no reading recorded after the world was built: the readings recorded since are ${said(recorded.map((event) => event.data))}; the claims read ${said(after.claims.map((c) => ({ claim: c.claim, outcome: c.outcome, line: c.line })))}`);
      }
      const added = String(carried.data.reading);
      resultOf(await as(live, 'cli', (call: any) => call('ask.answer', { ask: seeded.ask, option: seeded.option })), 'ask.answer');

      // 3. The next deep_show's world holds the reading.
      const second = await shown('World two', null, added);
      assert.ok(second.outcome === 'presented' && !second.missing.includes(added),
        `the reading ${added} (${carried.data.value} ${carried.data.unit}, "${carried.data.source}"), recorded at log_pos ${carried.log_pos} after the world was built, is not in the next deep_show's world: the deep_show that binds a value to it was ${second.outcome}${second.missing.length ? `, ref_unresolved naming ${second.missing.join(', ')}` : ''}: ${said(second.reply)}`);

      // 4. And the answered ask reads done.
      const third = await shown('World three', seeded.ask, null);
      assert.equal(third.state, 'done', `${seeded.ask}, answered since the world was built, shows as ${JSON.stringify(third.state)} in the deep_show's world, not done (the deep_show before it read the reading ${added}; this one was ${third.outcome}): ${said(third.reply)} ${said(third.rows)}`);
    } finally {
      await agent?.stop();
      if (hub) await stopHub(hub);
    }
  }, 1_800_000);
});

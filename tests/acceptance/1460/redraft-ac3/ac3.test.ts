// Blind redraft of #1460 AC3's two real-app tests (README: The dispute). The world is #83's, kept to what AC3 needs: a
// real hub on a temp home with `deep setup` run, and one Claude Code stand-in session that asked through deep_ask and
// left the ask open. The real `deep-app` runs on that home and is read from outside its process by #1459's probe;
// `deep open` is the checkout's built CLI with HOME the world's.
//
// The judge counts every event the hub's record gains between before and after the open, whatever its writer or kind,
// and names each by kind, log_pos and writer. It sets apart only what the design says no app or CLI call can write
// (README, Pinned 2): events written through an agent's own connections, and the hub's reading of an agent session's
// liveness.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as t83 from '../../83/helpers.ts';
import { cleanup as cleanup16 } from '../../16/helpers.ts';
import { RealApp, settled } from '../../1459/helpers.ts';
import { appBinary, askAt, hookBinary, ID, MIN, type Ev } from '../helpers.ts';

afterAll(async () => { await t83.cleanup(); await cleanup16(); }, 60_000);

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

// ---- The judge (README, Pinned 2).

/** A writer that is an agent's own connection: deep-hook (`hook`) or a session's `deep mcp` (`mcp`, `mcp:<session>`). */
const AGENT_WRITER = /^(hook|mcp)(:|$)/;
/** The hub's reading of an agent session's liveness, from that session's hooks and from time alone. */
const LIVENESS = new Set(['session.state', 'session.attention']);
const named = (e: Ev): string => `${e.kind} (log_pos ${e.log_pos}, written by ${e.writer})`;
/** Every event after `before`, named: `counted` is what an open could have written, `apart` what the rule sets apart. */
function gained(events: readonly Ev[], before: number): { counted: string[]; apart: string[] } {
  const after = events.filter((e) => e.log_pos > before);
  const isApart = (e: Ev): boolean => AGENT_WRITER.test(e.writer) || LIVENESS.has(e.kind);
  return { counted: after.filter((e) => !isApart(e)).map(named), apart: after.filter(isApart).map(named) };
}

// ---- The world.

interface World { h: t83.Home; hub: t83.Hub; s: t83.Session; ask: string; app: RealApp }
let world: World;
const identifiers = async (app: RealApp): Promise<string[]> => (await app.nodes()).map((n) => n.identifier).filter((i): i is string => !!i);
/** `app` launched on the world's home, once it has read the record: the asking session's row is in its tree. */
async function launched(h: t83.Home, s: t83.Session, bin: string): Promise<RealApp> {
  const app = await RealApp.launch(h.home, bin);
  const ready = await settled(async () => ((await identifiers(app)).includes(`session:${s.id}`) ? [] : ['no row']), 120_000);
  if (ready.length) throw Error(`BLOCKED: the real app never showed session ${s.id}'s row: ${app.stderr().slice(-600)}`);
  return app;
}
const lastPos = (events: readonly t83.Ev[]): number => Math.max(0, ...events.map((e) => e.log_pos));

beforeAll(async () => {
  await hookBinary();
  const h = t83.makeHome();
  const hub = await t83.hubWithSetup(h);
  const s = t83.newSession(h);
  const asker = await t83.begin(h, s, 'Pick a header colour.');
  const question = `Which header colour for ${Date.now()}?`;
  void asker.deepTool(s, 'deep_ask', { kind: 'choice', question, options: [{ id: 'blue', label: 'Blue' }, { id: 'green', label: 'Green' }], recommended: 'blue', steps: null, where: null, why: null, check: null }, 600_000).catch(() => undefined);
  const asked = await t83.waitFor(async () => (await t83.allEvents(hub)).find((e) => e.kind === 'ask.created' && e.session === s.id && e.data?.question === question), 60_000, `the deep_ask "${question}" filed`);
  world = { h, hub, s, ask: `ask:${asked.id}`, app: await launched(h, s, await appBinary()) };
}, 30 * MIN);

/**
 * `deep open ask/<id>` against the running app: what's wrong with its run and the window, and what the record gained
 * from before the open until the card shows and three seconds pass.
 */
async function openAsk(): Promise<{ failures: string[]; counted: string[]; apart: string[] }> {
  const before = lastPos(await t83.allEvents(world.hub));
  const address = askAt(world.ask);
  const failures: string[] = [];
  const ran = await t83.deep(world.h, ['open', address], {}, 60_000);
  if (ran.code !== 0) failures.push(`deep open ${address} ${t83.shown(ran)}`);
  failures.push(...await settled(async () => {
    const have = await identifiers(world.app);
    return [address, 'question-card'].filter((id) => !have.includes(id)).map((id) => `after deep open ${address}: no node of the real window has the accessibilityIdentifier ${id}; it has ${JSON.stringify(have.filter((i) => /\//.test(i) || i === 'question-card')).slice(0, 300)}`);
  }));
  await sleep(3000);
  return { failures, ...gained((await t83.allEvents(world.hub)) as unknown as Ev[], before) };
}

describe(`AC3 ${ID.unarmed} \`open\` on an ask presents its card unarmed, and the record gains no answer. A planted \`open\` that writes an event fails, naming the event`, () => {
  it(`AC3 ${ID.unarmed} deep open ask/<id> presents the ask's card in the running app, the hub's record gains no event from it, and the ask stays open`, async () => {
    const { failures, counted, apart } = await openAsk();
    expect(failures).toEqual([]);
    expect(counted, `open writes nothing to the record (set apart by the rule: ${JSON.stringify(apart)})`).toEqual([]);
    const open = (await t83.inboxRead(world.hub)).map((a) => a.ask ?? a.handle);
    expect(open, `${world.ask} is still open in the inbox`).toContain(world.ask);
  }, 10 * MIN);

  it(`AC3 ${ID.unarmed} (wrong program) plant-open-writes-event, an open that writes an event, fails, naming the event`, async () => {
    const planted = await appBinary('plant-open-writes-event');
    await world.app.stop();
    world.app = await launched(world.h, world.s, planted);
    try {
      const { failures, counted } = await openAsk();
      expect(failures, 'the planted app opens the ask too').toEqual([]);
      expect(counted, 'the planted open\'s event is found and named').not.toEqual([]);
      for (const e of counted) expect(e, 'each event is named by its kind, log_pos and writer').toMatch(/^[a-z][a-z_.]* \(log_pos \d+, written by [^)]+\)$/);
    } finally {
      await world.app.stop();
    }
  }, 20 * MIN);
});

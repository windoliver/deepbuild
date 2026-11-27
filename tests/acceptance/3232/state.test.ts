// AC5: the session on the open page goes from says done to sent back, round 1 of 3, and one entry holds its name,
// "sent back" and the round; a recorded turn whose 30 tool events change the doing line 30 times in 60 s adds none.
//
// Two runs, each on a real hub's record with the replica at the reference window (README, The fixtures):
// - the send-back: Cart totals has stopped with a claim (says done), its page open; the core's verdict FAIL and its
//   send-back, round 1, are appended as the core appends them, and what the hub then builds is fed;
// - the turn: Search box's agent is at work, its page open; fifteen Reads, each a PreToolUse and a PostToolUse as
//   its agent sends them (#2021's recorded payloads) through the hub's hook entry, one event every 2 s of
//   the replica's clock, each changing the doing line.
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { shared } from '../16/helpers.ts';
import { makeWorld } from '../2018/helpers.ts';
import { callOf, readResponse } from '../2021/helpers.ts';
import { blocked, byId, changed, cleanup, flicks, MIN, SECOND, sessionOf, Stage, Turn } from './helpers.ts';
import { ID, noneAdded, PLANT, said, stateLine, type Read, type Snapshot } from './judges.ts';

afterAll(cleanup, 5 * MIN);
const LIMIT = 180 * MIN;
const HELD = 'the shipped app must pass this judge first, or a plant it fails proves nothing';
const APART_MS = 3 * SECOND;

// ---- The send-back.

const NAME = 'Cart totals';
/** The round, as the design writes it: "sent back … shown with its round, such as 1 of 3". */
const ROUND = '1 of 3';
interface SentBack { who: string; before: Read; after: Read }
async function sendBack(): Promise<SentBack> {
  let claim = '';
  const w = await makeWorld({
    repos: ['shop'],
    seed: async (s, T) => {
      const at = T - 20 * MIN;
      await s.start('cart', 'shop', at);
      await s.task('cart', NAME, at + 1000);
      await s.prompt('cart', 'sum the cart', at + 2000);
      const call = await s.toolStart('cart', at + 3000);
      await s.toolEnd('cart', call, at + 9000);
      claim = (await s.stop('cart', T - 5 * MIN)) ?? blocked('the seeded stop made no claim');
    },
  });
  const stage = await Stage.on(w);
  try {
    const id = w.sessions.cart?.id ?? blocked('the world has no session cart');
    const who = `session:${id} ("${NAME}")`;
    const word = async (): Promise<unknown> => (await stage.row(`session:${id}`))?.word;
    if ((await word()) !== 'says done') blocked(`the fixture didn't hold: ${who} reads ${said(await word())} after its stop's claim, not says done`);
    await stage.d.open(`session/${id}`);
    await stage.d.wait(APART_MS);
    const before = await stage.read();
    await changed(stage, async (s, at) => {
      const verdict = await s.verdict('cart', claim, 'FAIL', at);
      await s.sentBack('cart', claim, verdict, 1, at + 1);
    });
    if ((await word()) !== 'sent back') blocked(`the fixture didn't hold: ${who} reads ${said(await word())} after its claim's FAIL was sent back, not sent back`);
    await stage.d.wait(APART_MS);
    return { who, before, after: await stage.read() };
  } finally {
    await stage.stop();
  }
}

// ---- The recorded turn.

const WORKER = 'Search box';
const EVENTS = 30;
/** One event every 2 s of the replica's clock: 30 in 60 s. */
const EVERY_MS = 2 * SECOND;
/** The doing line's words on the session's page (#2021's node, `session-doing`), without its time. */
function doingOf(s: Snapshot): string | null {
  const n = byId(s, 'session-doing');
  if (!n) return null;
  const inside = (b: number[]): boolean => b[0]! >= n.bounds[0]! - 1 && b[1]! >= n.bounds[1]! - 1 && b[0]! + b[2]! <= n.bounds[0]! + n.bounds[2]! + 1 && b[1]! + b[3]! <= n.bounds[1]! + n.bounds[3]! + 1;
  const text = typeof n.name === 'string' && n.name.trim() ? n.name : (s.runs ?? []).filter((r) => inside(r.bounds)).map((r) => r.text).join(' ');
  return text.split(' · ')[0]!.trim() || null;
}
interface TurnRun { who: string; before: Read; after: Read; changes: number }
async function turn(plant?: string): Promise<TurnRun> {
  const w = await makeWorld({
    repos: ['shop'],
    seed: async (s, T) => {
      await s.start('search', 'shop', T - 10 * MIN);
      await s.task('search', WORKER, T - 10 * MIN + 1000);
    },
  });
  const stage = await Stage.on(w, plant ? { plant } : {});
  try {
    const made = w.sessions.search ?? blocked('the world has no session search');
    const who = `session:${made.id} ("${WORKER}")`;
    const session = sessionOf(w, made);
    const agent = new Turn(stage, session);
    const file = (name: string): string => join(session.cwd, name);
    // Its turn begins before its page opens, so its word turning to working is no change on the open page.
    const first = callOf('Read', { file_path: file('README.md') });
    await agent.hook('SessionStart');
    await agent.hook('UserPromptSubmit', { prompt: 'add a search box' });
    await agent.hook('PreToolUse', { call: first });
    await agent.hook('PostToolUse', { call: first, response: readResponse(first) });
    const word = async (): Promise<unknown> => (await stage.row(`session:${made.id}`))?.word;
    if ((await word()) !== 'working') blocked(`the fixture didn't hold: ${who} reads ${said(await word())} once its turn began, not working`);
    await stage.d.open(`session/${made.id}`);
    await stage.d.wait(APART_MS);
    const before = await stage.read();
    let line = doingOf((await stage.d.see()).snapshot);
    let changes = 0;
    const t0 = stage.d.t;
    let read = first;
    for (let k = 0; k < EVENTS; k++) {
      if (k % 2 === 0) {
        read = callOf('Read', { file_path: file(`src/part${k / 2}.ts`) });
        await agent.hook('PreToolUse', { call: read });
      } else await agent.hook('PostToolUse', { call: read, response: readResponse(read) });
      const now = doingOf((await stage.d.see()).snapshot);
      if (now !== line) changes++;
      line = now;
      await stage.d.waitTo(t0 + flicks((k + 1) * EVERY_MS), 250);
    }
    const took = (stage.d.t - t0) / flicks(SECOND);
    if (changes !== EVENTS || took > 61) blocked(`the fixture didn't hold: the turn's ${EVENTS} tool events changed ${who}'s doing line ${changes} times in ${took.toFixed(1)} s of the replica's clock, not ${EVENTS} times in 60 s (it reads ${said(line)})`);
    if ((await word()) !== 'working') blocked(`the fixture didn't hold: ${who} reads ${said(await word())} at the end of its turn's 60 s, not working`);
    await stage.d.wait(APART_MS);
    return { who, before, after: await stage.read(), changes };
  } finally {
    await stage.stop();
  }
}
const turned = (r: TurnRun): string[] => noneAdded({ what: `the recorded turn of ${r.who}, whose ${EVENTS} tool events changed its doing line ${r.changes} times in 60 s,`, before: r.before, after: r.after });
const shipped = shared(() => turn());

describe(`AC5 ${ID.state} a state word that changes on the open page is announced once; a turn's doing line never is`, () => {
  it(`AC5 ${ID.state}: the session on the open page goes from says done to sent back, round 1 of 3; one entry holds its name, "sent back" and the round`, async () => {
    const r = await sendBack();
    expect(stateLine({ who: r.who, name: NAME, round: ROUND, before: r.before, after: r.after })).toEqual([]);
  }, LIMIT);

  it(`AC5 ${ID.state}: a recorded turn whose 30 tool events change the doing line 30 times in 60 s adds none`, async () => {
    expect(turned(await shipped())).toEqual([]);
  }, LIMIT);

  it(`AC5 ${ID.state} wrong program: a planted window that announces the doing line (${PLANT.doingLine}) fails, naming the count`, async () => {
    expect(turned(await shipped()), HELD).toEqual([]);
    const failures = turned(await turn(PLANT.doingLine)).join('\n');
    expect(failures, `${PLANT.doingLine} wasn't caught naming the count`).toMatch(new RegExp(`changed its doing line ${EVENTS} times in 60 s, added ${EVENTS} entries: `));
  }, LIMIT);
});

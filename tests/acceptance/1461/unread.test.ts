// AC5, AC12 and AC17: unread, one rule. A row is unread from a change in its state until its page has been open in the
// front window for a second while you're present. The replica on a copy of a real hub's record, on its virtual clock:
// its window is the front window, its acts are your input at its clock, and you're present within 2 minutes of one
// (README, Pinned 4). A change is the `row.set` the core writes for it, fed (helpers.ts `feedState`). The weight is the
// title's drawn weight (Pinned 2); `deep status --json` is the real CLI against the real hub.
import { spawn } from 'node:child_process';
import { afterAll, describe, expect, it } from 'vitest';
import { hookRequest, openAs, own, result, sendHook, tokenOf } from '../16/helpers.ts';
import { quiet } from '../1463/helpers.ts';
import { ulid } from '../26/helpers.ts';
import {
  cleanup, feedState, ID, jsonRows, makeWorld, MIN, replicaOf, sessionOf, weightFailures, type Row, type SessionSpec, type World,
} from './helpers.ts';

afterAll(cleanup, 60_000);
const rowOf = (rows: Row[], id: string): Row => rows.find((x) => x.id === id) ?? (() => { throw Error(`see's rows hold no ${id}`); })();
const sid = (w: World, key: string): string => `session:${sessionOf(w, key).id}`;

describe(`AC5 ${ID.unreadClears} a row's unread weight`, () => {
  const SPECS: SessionSpec[] = [
    { key: 'u1', project: 'shop', title: 'Cart totals', state: 'finished' },
    { key: 'u2', project: 'shop', title: 'Checkout page', state: 'finished' },
    { key: 'u3', project: 'docs', title: 'Release notes', state: 'finished' },
  ];
  let world: World | undefined;
  async function unreadFailures(plant?: string): Promise<string[]> {
    world ??= await makeWorld(SPECS);
    const w = world;
    const [u1, u2] = [sid(w, 'u1'), sid(w, 'u2')];
    const r = await replicaOf(w, {}, plant);
    const out: string[] = [];
    try {
      await r.wait(500);
      await r.hover({ id: 'list' });
      const rows = (await r.see()).rows;
      await feedState(r, rowOf(rows, u1), 'working');
      // An agent's message: a hook's activity line, which changes no state.
      await r.feed(sessionOf(w, 'u2').id, { v: 1, id: ulid(), kind: 'session.activity', writer: 'hook', actor: 'you', scope: 'you', subject: `session:${sessionOf(w, 'u2').id.replace(/[^0-9A-Za-z]/g, '')}`, data: { activity: 'Ran npm test and read its output' } });
      await r.wait(500);
      const changed = (await r.see()).snapshot;
      out.push(...weightFailures(changed, u1, 'medium', 'after its state changed'));
      out.push(...weightFailures(changed, u2, 'regular', 'with no change, only an agent\'s message'));
      await r.click({ id: u1 }, `opening ${u1}'s page`);
      await r.wait(1200);
      out.push(...weightFailures((await r.see()).snapshot, u1, 'regular', 'once its page was open for a second while you were present'));
    } finally {
      await r.stop();
    }
    return out;
  }

  it(`AC5 ${ID.unreadClears}: a row's unread weight clears once its page has been open for a second while you're present, and a row with no change has none`, async () => {
    expect(await unreadFailures()).toEqual([]);
  }, 30 * MIN);

  it(`AC5 ${ID.unreadClears} wrong program: a planted row marked unread from an agent's message fails, naming the row`, async () => {
    expect((await unreadFailures('unread-on-message')).join('\n')).toMatch(/with no change, only an agent's message, row session:\S+'s title is drawn at weight \d+, medium/);
  }, 30 * MIN);
});

describe(`AC12 ${ID.firstSighting} a first sighting isn't unread`, () => {
  it(`AC12 ${ID.firstSighting}: on first launch over a record with 50 finished sessions, only the failed one reads unread`, async () => {
    const projects = ['shop', 'docs', 'search', 'billing', 'infra'];
    const specs: SessionSpec[] = Array.from({ length: 50 }, (_, i) => ({ key: `f${i}`, project: projects[i % 5]!, title: `Task ${String(i + 1).padStart(2, '0')}`, state: i === 17 ? 'failed' : 'finished' }));
    const w = await makeWorld(specs);
    const failed = sid(w, 'f17');
    const out: string[] = [];
    const status = await jsonRows(w, 'status');
    for (const row of status.rows.filter((x) => String(x.id).startsWith('session:'))) {
      if (row.unread !== (row.id === failed)) out.push(`deep status --json reads ${row.id} ("${row.title}") ${row.unread ? 'unread' : 'read'}${row.id === failed ? ', though it ended failed' : ', on its first sighting'}`);
    }
    const r = await replicaOf(w, { size: [1512, 2200] });
    try {
      await r.wait(1000);
      const s = (await r.see()).snapshot;
      for (const spec of specs) {
        const id = sid(w, spec.key);
        out.push(...weightFailures(s, id, id === failed ? 'medium' : 'regular', id === failed ? 'on first launch, the failed session' : 'on first launch, a finished session'));
      }
    } finally {
      await r.stop();
    }
    expect(out).toEqual([]);
  }, 30 * MIN);
});

describe(`AC17 ${ID.presence} read only while you're present`, () => {
  const SPECS: SessionSpec[] = [
    { key: 'P', project: 'shop', title: 'Cart totals' },
    { key: 'Q', project: 'shop', title: 'Checkout page' },
    { key: 'R', project: 'shop', title: 'Billing page' },
  ];
  let world: World | undefined;
  /** The virtual-clock journey; with `firstHalf`, only the PASS with its page open and the one only drawn. */
  async function presenceFailures(plant?: string, firstHalf = false): Promise<string[]> {
    world ??= await makeWorld(SPECS);
    const w = world;
    const [P, Q, R] = [sid(w, 'P'), sid(w, 'Q'), sid(w, 'R')];
    const r = await replicaOf(w, {}, plant);
    const out: string[] = [];
    try {
      await r.wait(500);
      const rows = (await r.see()).rows;
      await r.click({ id: P }, `opening ${P}'s page`);
      await r.wait(10_000);
      await feedState(r, rowOf(rows, P), 'PASS');
      await feedState(r, rowOf(rows, Q), 'PASS');
      await r.wait(1200);
      const first = (await r.see()).snapshot;
      out.push(...weightFailures(first, P, 'regular', 'a second after it reached PASS with its page open and input 10 s ago'));
      out.push(...weightFailures(first, Q, 'medium', 'a second after it reached PASS with only its row drawn'));
      await r.wait(1000);
      out.push(...weightFailures((await r.see()).snapshot, Q, 'medium', 'two seconds after it reached PASS with only its row drawn'));
      if (firstHalf) return out;

      await r.click({ id: R }, `opening ${R}'s page`);
      await r.wait(310_000);
      await feedState(r, rowOf(rows, R), 'PASS');
      await r.wait(1200);
      out.push(...weightFailures((await r.see()).snapshot, R, 'medium', 'a second after it reached PASS with its page open but no input for 5 minutes'));
      await r.click({ id: P }, 'coming back: a press on another row');
      await r.click({ id: R }, `opening ${R}'s page again`);
      await r.wait(500);
      await r.click({ id: P }, `leaving ${R}'s page after half a second`);
      await r.wait(1000);
      out.push(...weightFailures((await r.see()).snapshot, R, 'medium', 'after its page was open for half a second'));
      await r.click({ id: R }, `opening ${R}'s page a third time`);
      await r.wait(2000);
      out.push(...weightFailures((await r.see()).snapshot, R, 'regular', 'after its page was open for 2 s while you were present'));
      const { hub } = await r.close();
      if (!hub) out.push('the trace keeps no hub calls, so the hub never learns a row was read (README, Pinned 5)');
      else {
        const read = hub.filter((c) => c.method === 'row.read').map((c) => String(c.params.id));
        for (const id of [P, R]) if (!read.includes(id)) out.push(`the app never told the hub ${id} was read (no row.read for it)`);
        if (read.includes(Q)) out.push(`the app told the hub ${Q} was read, though only its row was drawn`);
      }
    } finally {
      await r.stop();
    }
    return out;
  }

  it(`AC17 ${ID.presence}: on a virtual clock, the PASS with its page open and input 10 s ago reads regular a second later, the one only drawn reads medium, and the one after 5 minutes without input reads medium, stays medium after half a second open, and is regular after 2 s`, async () => {
    expect(await presenceFailures()).toEqual([]);
  }, 30 * MIN);

  it(`AC17 ${ID.presence}: in deep status --json, a changed row reads unread until the app tells the hub it was read, and one never read stays unread`, async () => {
    const w = await makeWorld([{ key: 't', project: 'shop', title: 'Cart totals' }, { key: 'u', project: 'shop', title: 'Checkout page' }]);
    const out: string[] = [];
    for (const key of ['t', 'u']) {
      const s = sessionOf(w, key).session;
      const agent = spawn('/bin/sleep', ['3600'], { stdio: 'ignore' });
      own(agent.pid);
      for (const event of ['SessionStart', 'Stop']) await sendHook(w.hub.socket, { ...hookRequest(s, event), pid: agent.pid!, ppid: agent.pid! }, 15_000);
    }
    await quiet(w.hub);
    const [t, u] = [sid(w, 't'), sid(w, 'u')];
    const before = (await jsonRows(w, 'status')).rows;
    for (const id of [t, u]) if (before.find((x) => x.id === id)?.unread !== true) out.push(`deep status --json reads ${id} read after its turn stopped, a change in its state`);
    const app = await openAs(w.hub.socket, 'app', tokenOf(w.root));
    try {
      result(await app.call('row.read', { id: t }));
    } catch (error) {
      out.push(`the hub doesn't take row.read from the app (README, Pinned 6): ${(error as Error).message.slice(0, 200)}`);
    } finally {
      app.close();
    }
    await quiet(w.hub);
    const after = (await jsonRows(w, 'status')).rows;
    if (after.find((x) => x.id === t)?.unread !== false) out.push(`deep status --json still reads ${t} unread after the app told the hub it was read`);
    if (after.find((x) => x.id === u)?.unread !== true) out.push(`deep status --json reads ${u} read, though nothing read it`);
    expect(out).toEqual([]);
  }, 30 * MIN);

  it(`AC17 ${ID.presence} wrong program: a planted app that marks the first case, the PASS with its page open, fails, naming the row`, async () => {
    expect((await presenceFailures('read-needs-reopen', true)).join('\n')).toMatch(/with its page open and input 10 s ago, row session:\S+'s title is drawn at weight \d+, medium/);
  }, 30 * MIN);

  it(`AC17 ${ID.presence} wrong program: a planted app that clears the row only drawn from the list fails, naming the row`, async () => {
    expect((await presenceFailures('read-when-drawn', true)).join('\n')).toMatch(/with only its row drawn, row session:\S+'s title is drawn at weight \d+, regular/);
  }, 30 * MIN);
});

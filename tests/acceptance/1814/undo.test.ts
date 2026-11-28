import { afterAll, describe, expect, it } from 'vitest';
import { cleanup as cleanup1810, deep, eventsOf, makeWorld, quiet, type Ev, type Ran, type WorldSpec } from '../1810/helpers.ts';
import { ID, SECOND, cleanup } from './helpers.ts';

afterAll(async () => { await cleanup(); await cleanup1810(); }, 60 * SECOND);

const SPEC: WorldSpec = {
  title: 'Docs refresh',
  asks: [{ question: 'Keep the cart on SQLite or plain files?', options: [['sqlite', 'SQLite'], ['files', 'Plain files']], default: 'sqlite', then: 'default' }],
};

interface Undone { handle: string; r: Ran; events: Ev[]; session: string }
async function undone(command: (handle: string) => string[]): Promise<Undone> {
  const w = await makeWorld(SPEC);
  const handle = w.asks[0]!.handle;
  const before = await quiet(w.hub);
  const r = await deep(w, command(handle));
  await quiet(w.hub);
  const events = (await eventsOf(w.hub)).filter((e) => e.log_pos > before);
  return { handle, r, events, session: w.s.id };
}

const shownRun = (r: Ran) => `exit ${r.code}, stdout ${JSON.stringify(r.stdout.slice(0, 1500))}, stderr ${JSON.stringify(r.stderr.slice(0, 1500))}`;

function shape(u: Undone): string[] {
  return u.events.map((e) => {
    const { kind, writer, actor, scope, data } = e as Ev & { actor?: unknown; scope?: unknown };
    return JSON.stringify({ kind, writer, actor, scope, data })
      .split(u.handle).join('<ask>')
      .split(u.session).join('<session>')
      .replace(/\b[0-9A-HJKMNP-TV-Z]{26}\b/g, '<ulid>')
      .replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z/g, '<time>')
      .replace(/\d{13,}/g, '<ms>');
  });
}

describe(`${ID.undo} deep undo on a defaulted ask`, () => {
  it(`${ID.undo} deep undo on a defaulted ask's handle appends what deep inbox undo appends`, async () => {
    const inbox = await undone((handle) => ['inbox', 'undo', handle]);
    if (inbox.r.code !== 0 || !inbox.events.length) throw Error(`BLOCKED: deep inbox undo ${inbox.handle} must undo the defaulted ask and append to the record: ${shownRun(inbox.r)}; ${inbox.events.length} events`);
    const mine = await undone((handle) => ['undo', handle]);
    expect(mine.r.code, `deep undo ${mine.handle} must undo the defaulted ask as deep inbox undo does (exit 0): ${shownRun(mine.r)}`).toBe(0);
    expect(shape(mine), `deep undo ${mine.handle} must append the events deep inbox undo appends, with handles, IDs and times read as placeholders`).toEqual(shape(inbox));
  }, 900 * SECOND);
});

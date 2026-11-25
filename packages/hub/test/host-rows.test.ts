// A session on a host (#999), over a record: its events and its row carry the host its hooks' connection named, it is
// listed under that host, and while the host's link is down its row reads quiet with why, never finished.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fixtures, type JsonValue } from '@deepbuild/contracts';
import { openRecord } from '@deepbuild/record';
import { expect, it } from 'vitest';
import { listText } from '../src/list.js';
import { buildRows, orderOf, rowVersion } from '../src/rows.js';
import { sessionStates } from '../src/status.js';
import { ulid } from '../src/wire.js';

const S = '7c4d5e60-0999-4222-8333-444455550999';
const HERE = '7c4d5e60-0999-4222-8333-444455550998';
const HOST = 'gpu-box';
type Data = Record<string, JsonValue>;
const data = (kind: string): Data => (fixtures(kind)[0] as { data: Data }).data;
const link = (up: boolean, hub = '1.0'): Data => ({ host: HOST, up, why: up ? null : 'the link to gpu-box ended (ssh exit 255)', hook_version: up ? '0.0.0' : null, hook_contract: up ? '1.0' : null, hub_version: up ? '0.0.1' : null, hub_contract: up ? hub : null });

async function world(run: (w: { query: (sql: string) => Promise<unknown[]>; hook: (kind: string, d: Data, session?: string) => Promise<void>; core: (kind: string, v: number, d: Data, session?: string) => Promise<void>; read: () => ReturnType<typeof sessionStates>; now: () => number }) => Promise<void>): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), 'deep-host-rows-'));
  const record = await openRecord({ path: join(dir, 'ledger.db'), now: Date.now });
  let at = Date.now();
  const query = (sql: string) => record.raw(sql);
  const subject = (session: string) => ({ subject: `session:${session.replace(/[^0-9A-Za-z]/g, '')}` });
  try {
    await run({
      query, now: () => at,
      // The session on the host comes over the host's link; the other over this machine's own socket.
      hook: async (kind, d, session = S) => { await record.append({ writer: 'hook', actor: 'you', scope: 'you', session, agent: 'claude-code', ...(session === S ? { host: HOST } : {}) }, { v: 1, id: ulid(++at), kind, ts: at, seq: `${BigInt(at) * 1_000_000n}`, data: d }); },
      core: async (kind, v, d, session) => { await record.append({ writer: 'core', actor: 'you', scope: 'you', ...(session ? { session } : {}) }, { v, id: ulid(++at), kind, ts: at, ...(session ? subject(session) : {}), data: d }); },
      read: () => sessionStates(query, at + 1),
    });
  } finally {
    await record.close();
    rmSync(dir, { recursive: true, force: true });
  }
}
const prompt: Data = { msg: 1, text: 'fix the flaky checkout test', tasks: [], from: 'person' };

it('each event of a session on a host carries the host, and one on this machine carries none', async () => {
  await world(async (w) => {
    await w.hook('session.start', data('session.start@1'));
    await w.hook('user.ask', prompt);
    await w.hook('session.start', data('session.start@1'), HERE);
    expect(await w.query(`SELECT DISTINCT host FROM events WHERE session_id = '${S}'`)).toEqual([{ host: HOST }]);
    expect(await w.query(`SELECT DISTINCT host FROM events WHERE session_id = '${HERE}'`)).toEqual([{ host: null }]);
    expect(await w.query('SELECT id, host FROM sessions ORDER BY id')).toEqual([{ id: HERE, host: null }, { id: S, host: HOST }]);
  });
});

it('reads quiet with why while its host\'s link is down, never finished, and at work again once a hook comes after the link returns', async () => {
  await world(async (w) => {
    await w.hook('session.start', data('session.start@1'));
    await w.hook('user.ask', prompt);
    await w.hook('session.start', data('session.start@1'), HERE);
    await w.hook('user.ask', prompt, HERE);
    expect((await w.read()).map((r) => [r.id, r.state])).toEqual(expect.arrayContaining([[S, 'working'], [HERE, 'working']]));
    await w.core('host.link', 1, link(false));
    await w.core('session.attention', 2, { state: 'unknown' }, S);
    const down = (await w.read()).find((r) => r.id === S)!;
    expect([down.state, down.rule, down.plain, down.host]).toEqual(['quiet', 'quiet', 'the link to gpu-box is down', HOST]);
    expect(down.facts.map((f) => f.kind)).toContain('host.link');
    // The session on this machine is untouched by another machine's link.
    expect((await w.read()).find((r) => r.id === HERE)!.state).toBe('working');
    await w.core('host.link', 1, link(true));
    await w.hook('user.ask', prompt);
    const back = (await w.read()).find((r) => r.id === S)!;
    expect([back.state, back.plain]).toEqual(['working', 'at work']);
  });
});

it('says so on its row, naming both, when its host\'s deep-hook is a contract major apart from the hub, and says nothing a minor apart', async () => {
  await world(async (w) => {
    await w.hook('session.start', data('session.start@1'));
    await w.hook('user.ask', prompt);
    await w.core('host.link', 1, link(true, '1.4'));
    expect((await w.read()).find((r) => r.id === S)!.plain).toBe('at work');
    await w.core('host.link', 1, link(true, '2.0'));
    const apart = (await w.read()).find((r) => r.id === S)!;
    expect(apart.plain).toBe("at work · gpu-box's deep-hook 0.0.0 speaks contract 1.0 and the hub 0.0.1 speaks contract 2.0, a major apart, so its hooks send the hub nothing");
  });
});

it('is listed under its host\'s name, as a session here is under its project\'s', async () => {
  await world(async (w) => {
    await w.hook('session.start', data('session.start@1'));
    await w.hook('user.ask', prompt);
    await w.hook('session.start', data('session.start@1'), HERE);
    await w.hook('user.ask', prompt, HERE);
    const rows = await buildRows(w.query, await w.read(), []);
    const on = rows.find((r) => r.session === S)!;
    const here = rows.find((r) => r.session === HERE)!;
    expect([on.host, rowVersion(on), here.host, rowVersion(here)]).toEqual([HOST, 5, undefined, 1]);
    const text = listText([here, on].sort((a, b) => (orderOf(a) < orderOf(b) ? -1 : 1)), { now: w.now() });
    const lines = text.split('\n');
    // Its host's name is its heading, its row directly under it; the one here keeps its project's.
    expect(lines[lines.indexOf(HOST) + 1], text).toMatch(new RegExp(`^  ${on.title}  claude-code  working`));
    expect(lines[lines.indexOf(here.project ?? 'no repo') + 1], text).toMatch(new RegExp(`^  ${here.title}  claude-code  working`));
  });
});

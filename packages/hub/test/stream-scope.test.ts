// A stream scoped to the list's rows (#1575): the rows every reader shows (#1463) come as row.set events, so a reader
// of the list, as a phone's list page is, gets those and no other kind, with the head its reply names marked as for a
// session's scope. The blind suite (tests/acceptance/1575) holds the session scope; this holds the list's.
import net from 'node:net';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { ulid } from '../src/wire.js';
import { hookLine, send, session, withHub } from './hub.js';

const sleep = (ms: number) => new Promise((done) => setTimeout(done, ms));

it("a reader scoped to the list gets the list's rows and no other event", async () => {
  await withHub(async (root, home) => {
    const sock = net.connect(join(root, 'hub.sock'));
    let buf = '';
    const lines: Record<string, any>[] = [];
    sock.on('data', (d) => { buf += d; let i; while ((i = buf.indexOf('\n')) >= 0) { lines.push(JSON.parse(buf.slice(0, i))); buf = buf.slice(i + 1); } });
    const until = async <T>(f: () => T | undefined): Promise<T> => { for (let i = 0; i < 600; i++) { const v = f(); if (v) return v; await sleep(50); } throw Error('no answer from the hub'); };
    await until(() => lines[0]);
    sock.write(`${JSON.stringify({ v: 1, hello: 'app', token: readFileSync(join(root, 'control.token'), 'utf8').trim() })}\n`);
    await until(() => lines.find((l) => l.role));
    sock.write(`${JSON.stringify({ v: 1, id: 'list', method: 'stream.subscribe', params: { after: 0, scope: { kind: 'list' } } })}\n`);
    const reply = await until(() => lines.find((l) => l.id === 'list' && 'result' in l));
    expect(reply.result, 'subscribed, the reply naming the head').toMatchObject({ subscribed: true, after: 0, head: expect.any(Number) });
    await until(() => lines.find((l) => l.id === 'list' && 'caught_up' in l));
    // A session that starts gets a row: a row.set, among the session's own events.
    const id = '15750000-1111-4222-8333-000000000001';
    const s = session(home, id);
    await send(join(root, 'hub.sock'), hookLine(ulid(Date.now()), 'SessionStart', s.payload('SessionStart', { source: 'startup' })));
    const row = await until(() => lines.find((l) => l.id === 'list' && l.event?.kind === 'row.set' && l.event.data?.session === id));
    expect(row.event.data.listed, "the session's row joins the list").toBe(true);
    await sleep(500);
    const kinds = lines.filter((l) => l.id === 'list' && l.event).map((l) => l.event.kind as string);
    expect(kinds.filter((k) => k !== 'row.set'), 'a reader of the list gets no other kind').toEqual([]);
    sock.destroy();
  });
}, 120_000);

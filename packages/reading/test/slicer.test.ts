// #63's scope beyond its acceptance tests: `deep find` returns handles to transcript messages, your decisions, text
// evidence and wiki claims with a line of context each, a reply past the cap says where to continue, and a reading
// job's `find` searches only the sessions that job was given. Real record, evidence store and wiki in a temp folder.
import { createHash } from 'node:crypto';
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, test, vi } from 'vitest';
import { validate } from '@deepbuild/contracts';
import { openEvidenceStore } from '@deepbuild/evidence';
import { openRecord, ulid, type Connection, type RecordStore } from '@deepbuild/record';
import { openWiki } from '@deepbuild/wiki';
import { CAP, findCommand, NotFound, openSlicer, readCommand, type Slice, type Slicer } from '../src/index.ts';

const YOU: Connection = { writer: 'app', actor: 'you', scope: 'you' };
const dirs: string[] = [];
const records: RecordStore[] = [];
afterEach(async () => {
  for (const r of records.splice(0)) await r.close();
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});
let t = Date.now() - 3_600_000;
const tick = () => (t += 1000);

/** A hub's root with one archived session per entry, each message one of its lines. */
async function root(sessions: string[][], id = (i: number) => `m${i}`, role = 'user'): Promise<{ dir: string; record: RecordStore; handles: string[] }> {
  const dir = mkdtempSync(join(tmpdir(), 'reading63-'));
  dirs.push(dir);
  const store = await openEvidenceStore({ root: join(dir, 'evidence'), now: () => t });
  const record = await openRecord({ path: join(dir, 'ledger.db'), now: () => t, evidence: store });
  records.push(record);
  const handles: string[] = [];
  for (const lines of sessions) {
    const session = ulid(tick());
    await record.append({ writer: 'hook', actor: 'you', scope: 'you', session, project: 'api', agent: 'claude-code' }, { v: 1, id: ulid(t), kind: 'session.start', ts: t, data: { agent: 'claude-code', worktree: dir, branch: 'main', thread: session } });
    const jsonl = lines.map((text, i) => JSON.stringify({ type: 'user', uuid: id(i), message: { role, content: text } })).join('\n');
    const put = await store.connect({ role: 'deepbuild', via: 'capture' }).put({ bytes: new TextEncoder().encode(jsonl), kind: 'transcript', source: 'claude-code', redaction: 'complete', license: { name: 'own', allows: [] } });
    if (put.status !== 'stored') throw Error(put.reason);
    await record.append(YOU, { v: 1, id: ulid(tick()), kind: 'transcript.archived', ts: t, data: { session: `session:${session}`, evidence: put.evidence.sha256 } });
    handles.push(`session:${session}`);
  }
  await record.sync();
  return { dir, record, handles };
}

test('find returns the message, decision, evidence and wiki handles holding the words, ignoring case, a line of context each', async () => {
  const { dir, record, handles } = await root([['The api starts on port 3000', 'nothing here'], ['the web build uses PORT 5173']]);
  const wiki = await openWiki({ record, folder: join(dir, 'wiki'), now: tick });
  expect((await wiki.learn([{ page: 'repos/api', id: 'port', text: 'api listens on port 3000', scope: 'repo:api', sources: [{ at: `${handles[0]}#m0`, quote: 'The api starts on port 3000' }] }])).written).toEqual(['wiki:repos/api#port']);
  const decision = ulid(tick());
  await record.append({ writer: 'core', actor: 'you', scope: 'you' }, { v: 1, id: decision, kind: 'decision.created', ts: t, data: { key: 'a'.repeat(64), scope: 'all', answer: 'keep the dev port at 3000', ask: `ask:${ulid(t)}` } });
  const note = await record.keep(YOU, { bytes: new TextEncoder().encode('Ops note: the staging PORT is 8080.'), kind: 'note', source: 'ops.md' });
  await record.sync();
  const slicer = await openSlicer(dir);
  try {
    const found = await slicer.find('port');
    expect(found.hits.map((h) => h.handle).sort()).toEqual([`${handles[0]}#m0`, `${handles[1]}#m0`, `decision:${decision}`, note, 'wiki:repos/api#port'].sort());
    expect(found.hits.find((h) => h.handle === note)?.context).toBe('Ops note: the staging PORT is 8080.');
    expect(found.hits.find((h) => h.handle === `${handles[1]}#m0`)?.context).toBe('the web build uses PORT 5173');
    expect(found.next).toBeUndefined();
    // What a hit names reads back: a wiki claim by its handle.
    expect((await slicer.read('wiki:repos/api#port')).text).toBe('api listens on port 3000');
    // Within a job, only the sessions it was given.
    expect((await slicer.find('port', undefined, [handles[1]!])).hits.map((h) => h.handle)).toEqual([`${handles[1]}#m0`]);
  } finally {
    slicer.close();
  }
});

test("a session's slices, joined, are its messages joined by line breaks, even cut exactly at a message's end", async () => {
  const messages = ['a'.repeat(CAP), 'NEXT', `${'b'.repeat(CAP - 5)}`, 'c'.repeat(CAP + 3), 'END'];
  const { dir, handles } = await root([messages]);
  const slicer = await openSlicer(dir);
  try {
    let joined = '';
    let slice = await slicer.read(handles[0]!);
    for (let n = 0; ; n++) {
      expect(slice.text.length).toBeLessThanOrEqual(CAP);
      joined += slice.text;
      if (slice.next === undefined) break;
      expect(n).toBeLessThan(20);
      slice = await slicer.read(handles[0]!, slice.next);
    }
    expect(joined).toBe(messages.join('\n'));
  } finally {
    slicer.close();
  }
});

test('a slice of many tiny messages stays within the cap with its message list, and covers only what it holds', async () => {
  const { dir, handles } = await root([Array.from({ length: 5000 }, () => 'x')]);
  const slicer = await openSlicer(dir);
  try {
    let slice = await slicer.read(handles[0]!);
    let seen = 0;
    for (let n = 0; ; n++) {
      expect(slice.text.length + JSON.stringify(slice.messages).length).toBeLessThanOrEqual(CAP);
      // Each slice ends at a message's end: it covers the messages it lists, no more.
      expect(slice.covers).toBe(`messages ${seen + 1} to ${seen + slice.messages!.length} of 5000`);
      seen += slice.messages!.length;
      if (slice.next === undefined) break;
      expect(n).toBeLessThan(5000);
      slice = await slicer.read(handles[0]!, slice.next);
    }
    expect(seen).toBe(5000);
  } finally {
    slicer.close();
  }
});

test("a find hit's context holds the match even where lowercasing changes the text's length", async () => {
  const { dir } = await root([[`${'İ'.repeat(300)} NEEDLE here`]]);
  const slicer = await openSlicer(dir);
  try {
    const found = await slicer.find('needle');
    expect(found.hits[0]!.context).toContain('NEEDLE');
  } finally {
    slicer.close();
  }
});

/** Every slice of a handle, following its cursors, each reply as JSON within the cap. */
async function walk(slicer: Slicer, handle: string): Promise<Slice[]> {
  const out = [await slicer.read(handle)];
  while (out[out.length - 1]!.next !== undefined) {
    expect(out.length).toBeLessThan(200);
    out.push(await slicer.read(handle, out[out.length - 1]!.next));
  }
  for (const s of out) expect(JSON.stringify(s).length).toBeLessThanOrEqual(CAP);
  return out;
}

test('a reply is within the cap as the JSON a tool returns, however its text escapes', async () => {
  const control = '\u0001'.repeat(3 * CAP);
  const mixed = `"quoted"\\ ${'\u001b[31mred\u001b[0m\n'.repeat(1500)}`;
  const { dir, handles } = await root([[control, mixed]]);
  const slicer = await openSlicer(dir);
  try {
    expect((await walk(slicer, handles[0]!)).map((s) => s.text).join('')).toBe(`${control}\n${mixed}`);
    expect((await walk(slicer, `${handles[0]}#m0`)).map((s) => s.text).join('')).toBe(control);
    expect((await walk(slicer, `${handles[0]}#m1`)).map((s) => s.text).join('')).toBe(mixed);
  } finally {
    slicer.close();
  }
});

test("a find reply is within the cap as JSON, and its continuations hold every hit once", async () => {
  const { dir, handles } = await root([Array.from({ length: 3000 }, () => 'a')]);
  const slicer = await openSlicer(dir);
  try {
    const seen: string[] = [];
    let found = await slicer.find('a', undefined, handles);
    for (let n = 0; ; n++) {
      expect(JSON.stringify(found).length).toBeLessThanOrEqual(CAP);
      seen.push(...found.hits.map((h) => h.handle));
      if (found.next === undefined) break;
      expect(n).toBeLessThan(3000);
      found = await slicer.find('a', found.next, handles);
    }
    expect(new Set(seen).size).toBe(3000);
  } finally {
    slicer.close();
  }
});

test('a cursor never issued is refused: inside a surrogate pair, or past the hits', async () => {
  const { dir, handles } = await root([['😀abc']]);
  const slicer = await openSlicer(dir);
  try {
    await expect(slicer.read(`${handles[0]}#m0`, 'c1')).rejects.toThrow(NotFound);
    await expect(slicer.read(handles[0]!, 'm0.1')).rejects.toThrow(NotFound);
    await expect(slicer.find('a', 'h99')).rejects.toThrow(NotFound);
  } finally {
    slicer.close();
  }
});

test("a message whose handle alone passes the cap is refused, never a slice that loops or overflows", async () => {
  const { dir, handles } = await root([['x'.repeat(5 * CAP)]], () => 'A'.repeat(CAP + 100));
  const slicer = await openSlicer(dir);
  try {
    await expect(slicer.read(handles[0]!)).rejects.toThrow(NotFound);
  } finally {
    slicer.close();
  }
});

test("a find hit's context holds the match where the whole text and its characters lowercase differently", async () => {
  const { dir } = await root([[`${'x'.repeat(500)} ΟΔΟΣ end`]]);
  const slicer = await openSlicer(dir);
  try {
    expect((await slicer.find('οδος')).hits[0]?.context).toContain('ΟΔΟΣ');
    expect((await slicer.find('ΟΔΟΣ')).hits[0]?.context).toContain('ΟΔΟΣ');
  } finally {
    slicer.close();
  }
});

test("a cut reply's continuation line keeps the root it read and quotes the query for the shell", async () => {
  const { dir, handles } = await root([['x'.repeat(2 * CAP), ...Array.from({ length: 400 }, () => `$HOME it's a needle #tag ${'y'.repeat(60)}`)]]);
  const out: string[] = [];
  const spy = vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => { out.push(String(chunk)); return true; });
  try {
    expect(await readCommand([handles[0]!, '--root', dir])).toBe(0);
    expect(await findCommand(["it's a needle", '--root', dir])).toBe(0);
    expect(await findCommand(['#tag', '--root', dir])).toBe(0);
  } finally {
    spy.mockRestore();
  }
  const last = (s: string) => s.trimEnd().split('\n').pop()!;
  const slicer = await openSlicer(dir);
  const next = (await slicer.read(handles[0]!)).next;
  slicer.close();
  expect(last(out[0]!)).toBe(`deep read ${handles[0]} --slice ${next} --root ${dir}`);
  expect(last(out[1]!)).toMatch(new RegExp(`^deep find 'it'\\\\''s a needle' --slice h\\d+ --root ${dir.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`));
  // A word the shell would read as a comment is quoted.
  expect(last(out[2]!)).toMatch(/^deep find '#tag' --slice h\d+ --root /);
  // A flag is never taken as the root's folder.
  const err = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  try {
    expect(await readCommand([handles[0]!, '--root', '--json'])).toBe(2);
  } finally {
    err.mockRestore();
  }
});

test("one message with an outsize role never blocks reading the session", async () => {
  const { dir, handles } = await root([['first', 'second']], undefined, 'r'.repeat(CAP + 1000));
  const slicer = await openSlicer(dir);
  try {
    expect((await walk(slicer, handles[0]!)).map((s) => s.text).join('')).toBe('first\nsecond');
  } finally {
    slicer.close();
  }
});

test("a query starting with '-' is found after --", async () => {
  const { dir } = await root([['build with -Werror always']]);
  const out: string[] = [];
  const spy = vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => { out.push(String(chunk)); return true; });
  try {
    expect(await findCommand(['--root', dir, '--', '-Werror'])).toBe(0);
  } finally {
    spy.mockRestore();
  }
  expect(out.join('')).toContain('build with -Werror always');
});

test('a message with an empty role gives a slice its contract holds', async () => {
  const { dir, handles } = await root([['hello']], undefined, '');
  const slicer = await openSlicer(dir);
  try {
    const slice = await slicer.read(handles[0]!);
    expect(validate('reading.slice@1', slice).ok).toBe(true);
  } finally {
    slicer.close();
  }
});

test('a query as long as the cap still gets a reply within the cap', async () => {
  const { dir } = await root([['x'.repeat(9000)]]);
  const slicer = await openSlicer(dir);
  try {
    const found = await slicer.find('x'.repeat(CAP));
    expect(found.hits.length).toBe(1);
    expect(found.hits[0]!.handle.length + found.hits[0]!.context.length + 1).toBeLessThanOrEqual(CAP);
  } finally {
    slicer.close();
  }
});

test('reading and finding write nothing under the root, even where the evidence journal is due for compaction', async () => {
  const { dir, handles } = await root([['The api starts on port 3000']]);
  // A journal with many superseded lines: the writing store compacts it when it opens.
  const journal = join(dir, 'evidence', 'records.jsonl');
  const line = readFileSync(journal, 'utf8').split('\n')[0]!;
  writeFileSync(journal, `${`${line}\n`.repeat(2000)}`);
  const before = snapshot(dir);
  const slicer = await openSlicer(dir);
  try {
    expect((await slicer.read(`${handles[0]}#m0`)).text).toBe('The api starts on port 3000');
    expect((await slicer.find('port')).hits.length).toBe(1);
  } finally {
    slicer.close();
  }
  expect(snapshot(dir)).toEqual(before);
});

/** Every file under a folder, with its bytes' hash, the record's own SQLite side files aside. */
function snapshot(dir: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const e of readdirSync(dir, { withFileTypes: true, recursive: true })) {
    const path = join(e.parentPath, e.name);
    if (e.isFile() && !/ledger\.db-(wal|shm)$/.test(e.name)) out[path] = createHash('sha256').update(readFileSync(path)).digest('hex');
  }
  return out;
}

test('a find past the cap is cut, says where to continue, and its continuations hold every hit once', async () => {
  const lines = Array.from({ length: 400 }, (_, i) => `line ${i}: the needle is here, ${'x'.repeat(60)}`);
  const { dir } = await root([lines]);
  const slicer = await openSlicer(dir);
  try {
    const seen: string[] = [];
    let found = await slicer.find('NEEDLE');
    for (let n = 0; ; n++) {
      expect(found.hits.reduce((sum, h) => sum + h.handle.length + h.context.length + 1, 0)).toBeLessThanOrEqual(CAP);
      seen.push(...found.hits.map((h) => h.handle));
      if (found.next === undefined) break;
      expect(n).toBeLessThan(400);
      found = await slicer.find('NEEDLE', found.next);
    }
    expect(seen.length).toBe(400);
    expect(new Set(seen).size).toBe(400);
  } finally {
    slicer.close();
  }
});

test("a find hit's context never starts or ends inside a surrogate pair", async () => {
  const { dir } = await root([['a' + '😀'.repeat(60) + ' port ' + '😀'.repeat(60)]]);
  const slicer = await openSlicer(dir);
  try {
    const [hit] = (await slicer.find('port')).hits;
    expect(hit!.context).toContain('port');
    // No lone surrogate at either end, or anywhere.
    expect(hit!.context).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/);
  } finally {
    slicer.close();
  }
});

test('a slice that continues inside a message says where in it it starts', async () => {
  const { dir, handles } = await root([['y'.repeat(20_000)]]);
  const slicer = await openSlicer(dir);
  try {
    const first = await slicer.read(handles[0]!);
    const offset = Number(/^m0\.(\d+)$/.exec(first.next!)![1]);
    const second = await slicer.read(handles[0]!, first.next);
    expect(second.covers).toMatch(new RegExp(`^messages 1 to 1 of 1, from character ${offset + 1} of message 1, up to character \\d+ of message 1$`));
  } finally {
    slicer.close();
  }
});

// #355's scope beyond its acceptance tests: the default index's tables in the ledger, your edits kept as decisions,
// and standing questions rewritten as the wiki learns. Real record, evidence store and pages in a temp folder.
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, test } from 'vitest';
import { openEvidenceStore } from '@deepbuild/evidence';
import { openRecord, ulid, type Connection, type RecordStore } from '@deepbuild/record';
import { openWiki, type Wiki } from '../src/index.ts';

const YOU: Connection = { writer: 'app', actor: 'you', scope: 'you' };
const dirs: string[] = [];
const records: RecordStore[] = [];
afterEach(async () => {
  for (const r of records.splice(0)) await r.close();
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

let t = Date.now() - 3_600_000;
const tick = () => (t += 1000);
/** A record, a wiki over it, and one session of `api` in which you said each line. */
async function world(lines: string[]): Promise<{ record: RecordStore; wiki: Wiki; folder: string; session: string; at: (i: number) => string }> {
  const dir = mkdtempSync(join(tmpdir(), 'wiki355-'));
  dirs.push(dir);
  const store = await openEvidenceStore({ root: join(dir, 'evidence'), now: () => t });
  const record = await openRecord({ path: join(dir, 'ledger.db'), now: () => t, evidence: store });
  records.push(record);
  const session = ulid(tick());
  await record.append({ writer: 'hook', actor: 'you', scope: 'you', session, project: 'api', agent: 'claude-code' }, { v: 1, id: ulid(t), kind: 'session.start', ts: t, data: { agent: 'claude-code', worktree: dir, branch: 'main', thread: session } });
  const jsonl = lines.map((text, i) => JSON.stringify({ type: 'user', uuid: `m${i}`, message: { role: 'user', content: `Remember: ${text}.` } })).join('\n');
  const put = await store.connect({ role: 'deepbuild', via: 'capture' }).put({ bytes: new TextEncoder().encode(jsonl), kind: 'transcript', source: 'claude-code', redaction: 'complete', license: { name: 'own', allows: [] } });
  if (put.status !== 'stored') throw Error(put.reason);
  await record.append(YOU, { v: 1, id: ulid(tick()), kind: 'transcript.archived', ts: t, data: { session: `session:${session}`, evidence: put.evidence.sha256 } });
  const folder = join(dir, 'wiki');
  return { record, wiki: await openWiki({ record, folder, now: tick }), folder, session, at: (i) => `session:${session}#m${i}` };
}
const claim = (w: { at: (i: number) => string }, id: string, text: string, i: number) => ({ page: 'repos/api', id, text, scope: 'repo:api', sources: [{ at: w.at(i), quote: text }] });

test('the default index is the ledger\'s: claims, sources and links tables and FTS5 text, rebuilt from the log alike, holding only claims in force', async () => {
  const lines = ['The api queue runs on redis', 'The api docs are at https://docs.example.invalid/api?token=opensesame'];
  const w = await world(lines);
  await w.wiki.learn([claim(w, 'queue', lines[0]!, 0), claim(w, 'docs', lines[1]!, 1)]);
  // A claim the core refuses on what it read (its quote is at no message) is in no table, though it was appended.
  await w.record.append({ writer: 'core', actor: 'you', scope: 'you' }, {
    v: 1, id: ulid(tick()), kind: 'learn.applied', ts: t,
    data: { layer: 'learned', target: 'wiki:repos/api#ghost', diff: '+ - The ghost <!-- deep:claim {"id":"ghost","known":"you","proof":1,"sources":[]} -->', evidence: [{ at: w.at(0), quote: 'words nobody said' }], scope: 'repo:api', replay: null, applied_by: 'rule:install', supersedes: null },
  });
  const rows = async (table: string) => (await w.record.table(table)).rows.map((r) => JSON.stringify(r, (_, v: unknown) => (typeof v === 'bigint' ? Number(v) : v)));
  const claims = await w.record.raw('SELECT handle, known, proof, state FROM wiki_claims ORDER BY handle');
  expect(claims).toEqual([
    { handle: 'wiki:repos/api#docs', known: 'you', proof: 1, state: 'in force' },
    { handle: 'wiki:repos/api#queue', known: 'you', proof: 1, state: 'in force' },
  ]);
  expect(await w.record.raw('SELECT claim, at FROM wiki_sources ORDER BY claim')).toEqual([{ claim: 'wiki:repos/api#docs', at: w.at(1) }, { claim: 'wiki:repos/api#queue', at: w.at(0) }]);
  expect(await w.record.raw('SELECT url FROM wiki_links')).toEqual([{ url: 'https://docs.example.invalid/api' }]);
  expect(await w.record.raw("SELECT handle FROM wiki_text WHERE wiki_text MATCH '\"redis\"'")).toEqual([{ handle: 'wiki:repos/api#queue' }]);
  const before = { claims: await rows('wiki_claims'), sources: await rows('wiki_sources'), links: await rows('wiki_links') };
  await w.record.rebuild();
  expect({ claims: await rows('wiki_claims'), sources: await rows('wiki_sources'), links: await rows('wiki_links') }, 'the tables rebuild from the log to what the appends built').toEqual(before);
  // A rolled-back claim leaves every table, its text too.
  const [docs] = (await w.record.raw("SELECT change FROM wiki_claims WHERE handle = 'wiki:repos/api#docs'")) as { change: string }[];
  await w.record.rollBack(YOU, { change: docs!.change.slice('doc:'.length) });
  expect(await w.record.raw("SELECT handle FROM wiki_claims WHERE handle = 'wiki:repos/api#docs'")).toEqual([]);
  expect(await w.record.raw("SELECT handle FROM wiki_text WHERE wiki_text MATCH '\"docs\"'")).toEqual([]);
});

test('your edits to a page stand until you keep them, and are kept as decisions of yours: a changed line, a removed one and an added one', async () => {
  const lines = ['The api queue runs on redis', 'The api cache is warmed at boot'];
  const w = await world(lines);
  await w.wiki.learn([claim(w, 'queue', lines[0]!, 0), claim(w, 'cache', lines[1]!, 1)]);
  const file = join(w.folder, 'repos/api.md');
  const edited = readFileSync(file, 'utf8').split('\n')
    .map((l) => l.replace('The api queue runs on redis', 'The api queue runs on rabbitmq'))
    .filter((l) => !l.includes('warmed at boot'))
    .flatMap((l) => (l.startsWith('# ') ? [l, '', 'The api logs go to stderr'] : [l])).join('\n');
  writeFileSync(file, edited);
  // The wiki writing again leaves your edit as it is.
  await w.wiki.write();
  expect(readFileSync(file, 'utf8'), 'a page you edited is never written over').toBe(edited);
  await expect(w.wiki.keepEdits({ writer: `mcp:${w.session}`, actor: 'you', scope: 'you', session: w.session }), 'an agent can\'t keep edits').rejects.toThrow(/only you/);
  const kept = await w.wiki.keepEdits(YOU);
  expect(kept).toHaveLength(3);
  const decisions = (await w.record.read({ after: 0, limit: 1000 })).filter((e) => e.kind === 'decision.created' && kept.includes(`decision:${e.id}`));
  expect(decisions.map((d) => [d.actor, (d.data as { answer: string }).answer]).sort()).toEqual([
    ['you', 'The api logs go to stderr'], ['you', 'The api queue runs on rabbitmq'], ['you', 'no: The api cache is warmed at boot'],
  ]);
  const page = readFileSync(file, 'utf8');
  expect(page).toContain('- The api queue runs on rabbitmq <!-- deep:claim {"id":"queue","known":"decision"');
  expect(page).toContain('- The api logs go to stderr <!-- deep:claim');
  expect(page).not.toContain('redis');
  expect(page).not.toContain('warmed at boot');
  // The start slice holds your words, and none of what you changed or removed as a line of its own.
  const slice = (await w.record.startSlice(w.session)).map((e) => e.text);
  expect(slice).toEqual(expect.arrayContaining(['The api queue runs on rabbitmq', 'The api logs go to stderr', 'no: The api cache is warmed at boot']));
  expect(slice.filter((text) => text.includes('redis') || text === 'The api cache is warmed at boot')).toEqual([]);
});

test('a standing question is a page the wiki rewrites from the repo\'s claims as it learns', async () => {
  const lines = ['`api` starts with npm run dev', '`api` starts with npm run serve', 'The api queue runs on redis'];
  const w = await world(lines);
  await w.wiki.learn([claim(w, 'start', lines[0]!, 0), claim(w, 'queue', lines[2]!, 2)]);
  const question = join(w.folder, 'questions/api/start.md');
  const first = readFileSync(question, 'utf8');
  expect(first.split('\n')[0]).toBe('# How does api start?');
  expect(first).toContain('- `api` starts with npm run dev <!-- deep:claim');
  expect(first).toContain('"claim":"wiki:repos/api#start"');
  expect(first).not.toContain('redis');
  await w.wiki.learn([{ ...claim(w, 'start-serve', lines[1]!, 1), supersedes: 'wiki:repos/api#start' }]);
  const second = readFileSync(question, 'utf8');
  expect(second, 'the question\'s page is rewritten to the claim that superseded the first').toContain('npm run serve');
  expect(second).not.toContain('npm run dev');
});

// Invariant 3: agents can't change your decisions. A claim you removed or corrected stays as you left it, however
// many times it was learned before, and no learned claim brings it back, restates it or supersedes it.
const removeLine = (folder: string, s: string): void => {
  const file = join(folder, 'repos/api.md');
  writeFileSync(file, readFileSync(file, 'utf8').split('\n').filter((l) => !l.includes(s)).join('\n'));
};
const L = 'The api queue runs on redis';
/** The page as the wiki wrote it; a page with no claim left is gone. */
const page = (folder: string): string => (existsSync(join(folder, 'repos/api.md')) ? readFileSync(join(folder, 'repos/api.md'), 'utf8') : '');

test('a line you remove leaves the wiki, though a restatement held it over an earlier learning', async () => {
  const w = await world([L]);
  await w.wiki.learn([claim(w, 'queue', L, 0)]);
  expect((await w.wiki.learn([{ ...claim(w, 'queue', L, 0), supersedes: 'wiki:repos/api#queue' }])).written).toEqual(['wiki:repos/api#queue']);
  removeLine(w.folder, 'redis');
  expect((await w.wiki.keepEdits(YOU)).length).toBe(1);
  expect(await w.record.raw("SELECT handle FROM wiki_claims WHERE state = 'in force'")).toEqual([]);
  expect(page(w.folder)).not.toContain('redis');
});

test('a claim you removed is not learned again', async () => {
  const w = await world([L]);
  await w.wiki.learn([claim(w, 'queue', L, 0)]);
  removeLine(w.folder, 'redis');
  await w.wiki.keepEdits(YOU);
  const again = await w.wiki.learn([claim(w, 'queue', L, 0)]);
  expect(again.written).toEqual([]);
  expect(again.dropped[0]?.reason).toMatch(/is yours/);
  expect(page(w.folder)).not.toContain('redis');
});

test('a claim you corrected and then removed is not learned again in its first words', async () => {
  const w = await world([L]);
  await w.wiki.learn([claim(w, 'queue', L, 0)]);
  const file = join(w.folder, 'repos/api.md');
  writeFileSync(file, readFileSync(file, 'utf8').replace('runs on redis', 'runs on sqs'));
  await w.wiki.keepEdits(YOU);
  removeLine(w.folder, 'sqs');
  await w.wiki.keepEdits(YOU);
  expect((await w.wiki.learn([claim(w, 'queue', L, 0)])).written).toEqual([]);
  expect(page(w.folder)).not.toContain('redis');
});

test('a claim you removed is not learned again in other Unicode forms of its words', async () => {
  const T = 'The api café queue runs on redis';
  const w = await world([T.normalize('NFC')]);
  await w.wiki.learn([claim(w, 'queue', T.normalize('NFC'), 0)]);
  removeLine(w.folder, 'redis');
  await w.wiki.keepEdits(YOU);
  expect((await w.wiki.learn([claim(w, 'queue', T.normalize('NFD'), 0)])).written).toEqual([]);
});

test('once you revoke your removal, the claim may be learned again', async () => {
  const w = await world([L]);
  await w.wiki.learn([claim(w, 'queue', L, 0)]);
  removeLine(w.folder, 'redis');
  const [decision] = await w.wiki.keepEdits(YOU);
  await w.record.append({ writer: 'core', actor: 'you', scope: 'you' }, { v: 1, id: ulid(tick()), kind: 'decision.revoked', ts: t, data: { decision: decision! } });
  expect((await w.wiki.learn([claim(w, 'queue', L, 0)])).written).toEqual(['wiki:repos/api#queue']);
});

test('a restated claim you remove or correct leaves none of its wordings in the start slice', async () => {
  for (const edit of [(f: string) => removeLine(f, 'redis'), (f: string) => writeFileSync(join(f, 'repos/api.md'), page(f).replace('runs on redis 7', 'runs on sqs'))]) {
    const w = await world([L, `${L} 7`]);
    await w.wiki.learn([claim(w, 'queue', L, 0)]);
    await w.wiki.learn([{ ...claim(w, 'queue', `${L} 7`, 1), supersedes: 'wiki:repos/api#queue' }]);
    edit(w.folder);
    await w.wiki.keepEdits(YOU);
    const slice = (await w.record.startSlice(w.session)).map((e) => e.text);
    expect(slice.filter((text) => text === L || text === `${L} 7`)).toEqual([]);
  }
});

test('no learned claim supersedes a claim you corrected', async () => {
  const lines = [L, 'The api cache is warmed at boot'];
  const w = await world(lines);
  await w.wiki.learn([claim(w, 'queue', L, 0)]);
  const file = join(w.folder, 'repos/api.md');
  writeFileSync(file, readFileSync(file, 'utf8').replace('runs on redis', 'runs on sqs'));
  await w.wiki.keepEdits(YOU);
  const other = await w.wiki.learn([{ ...claim(w, 'cache', lines[1]!, 1), supersedes: 'wiki:repos/api#queue' }]);
  expect(other.written).toEqual([]);
  expect(other.dropped[0]?.reason).toMatch(/is yours/);
  expect(await w.record.raw("SELECT handle FROM wiki_claims WHERE state = 'in force' ORDER BY handle")).toEqual([{ handle: 'wiki:repos/api#queue' }]);
});

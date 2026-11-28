import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { expect } from 'vitest';
import * as adapters from '../../../packages/adapters/src/index.ts';
import { openEvidenceStore } from '../../../packages/evidence/src/index.ts';
import { openRecord, type Event } from '../../../packages/record/src/index.ts';
import { openAsks, type AsksPlant, type Delivery } from '../../../packages/asks/src/index.ts';
import { resolverDecisions } from '../../../packages/resolver-decisions/src/index.ts';
import { withDeclared } from '../declared.ts';
import { hook, jsonl, scheduled, sha256, T0, typed, type World } from '../1098/helpers.ts';

export * from '../1098/helpers.ts';

const who = { actor: 'you', scope: 'you' };

export async function openWorld(plant?: AsksPlant): Promise<World> {
  expect('transcriptReaders' in adapters, '@deepbuild/adapters exports transcriptReaders (#1894)').toBe(true);
  const dir = mkdtempSync('/tmp/dh1098-');
  let now = T0;
  const clock = { now: () => now, set: (ms: number) => { now = ms; } };
  const evidence = await openEvidenceStore({ root: join(dir, 'evidence'), now: clock.now });
  const readers = (adapters as unknown as { transcriptReaders?: unknown }).transcriptReaders;
  const record = await openRecord({ path: join(dir, 'record.db'), now: clock.now, evidence, readers } as unknown as Parameters<typeof openRecord>[0]);
  const deliveries: Delivery[] = [];
  const asks = withDeclared(await openAsks({ record, now: clock.now, deliver: (d) => { deliveries.push(structuredClone(d)); }, ...(plant ? { plant } : {}) }));
  asks.registerResolver('resolver-decisions', resolverDecisions({ record }));
  const projects = new Map<string, string>();
  const msgs = new Map<string, number>();
  const capture = evidence.connect({ role: 'deepbuild', via: 'capture' });
  let minted = 0;
  const ulid = (): string => {
    const C = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
    let time = '';
    for (let t = clock.now(), i = 0; i < 10; i++, t = Math.floor(t / 32)) time = C[t % 32] + time;
    let tail = '';
    for (let n = ++minted, i = 0; i < 16; i++, n = Math.floor(n / 32)) tail = C[n % 32] + tail;
    return time + tail;
  };
  const events = async (kind?: string): Promise<Event[]> => {
    const all: Event[] = [];
    for (let after = 0; ;) {
      const page = await record.read({ after, limit: 1000, ...(kind ? { kinds: [kind] } : {}) });
      all.push(...page);
      if (page.length < 1000) break;
      after = page[page.length - 1]!.log_pos;
    }
    return all;
  };
  const w: World = {
    dir, clock, record, evidence, asks, deliveries, events,
    start: async (session, project, worktree) => {
      const cwd = worktree ?? join(dir, 'work', session);
      mkdirSync(cwd, { recursive: true });
      projects.set(session, project);
      await record.append(hook(session, project), { v: 1, id: ulid(), kind: 'session.start', ts: clock.now(), data: { agent: 'claude-code', worktree: cwd, branch: 'main', thread: `T${session}` } });
      return { session, cwd, lines: [], named: new Map() };
    },
    prompt: async (t, text, from = 'person') => {
      const msg = msgs.get(t.session) ?? 0;
      msgs.set(t.session, msg + 1);
      await record.append(hook(t.session, projects.get(t.session)!), { v: 2, id: ulid(), kind: 'user.ask', ts: clock.now(), data: { msg, text, tasks: [], from } });
      return from === 'person' ? typed(t, clock.now(), text) : scheduled(t, clock.now(), text);
    },
    archive: async (t) => {
      const bytes = Buffer.from(jsonl(t), 'utf8');
      const put = await capture.put({ bytes, kind: 'transcript-copy', source: 'archive:claude-code', redaction: 'complete', license: { name: 'session', allows: [] } });
      if (put.status !== 'stored') throw Error(`the evidence store refused the transcript of ${t.session}: ${put.reason}`);
      const sha = put.evidence.sha256;
      await record.append({ writer: 'core', ...who, agent: 'claude-code', project: projects.get(t.session)! }, {
        v: 2, id: ulid(), kind: 'transcript.archived', ts: clock.now(), evidence: [sha],
        data: { session: `session:${t.session}`, evidence: sha, source: { size: bytes.length, sha256: sha256(bytes) } },
      });
      return sha;
    },
    row: async (ask) => (await asks.inbox()).find((r) => r.ask === ask),
    close: async () => { await record.close(); rmSync(dir, { recursive: true, force: true }); },
  };
  return w;
}

export async function inWorld<T>(scenario: (w: World) => Promise<T>, plant?: AsksPlant): Promise<T> {
  const w = await openWorld(plant);
  try {
    return await scenario(w);
  } finally {
    await w.close();
  }
}

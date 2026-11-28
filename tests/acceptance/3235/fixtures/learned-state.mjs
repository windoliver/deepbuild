import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const [checkout, added] = process.argv.slice(2);
const { openRecord, ulid } = await import(pathToFileURL(join(checkout, 'packages/record/dist/index.js')).href);
const { openEvidenceStore } = await import(pathToFileURL(join(checkout, 'packages/evidence/dist/index.js')).href);

const dir = mkdtempSync(join(tmpdir(), 'ac3235-learned-'));
let clock = Date.UTC(2026, 9, 5, 9, 0, 0);
const now = () => clock;
const tick = () => (clock += 1000);
try {
  const store = await openEvidenceStore({ root: join(dir, 'evidence'), now });
  const record = await openRecord({ path: join(dir, 'record.sqlite'), now, evidence: store });
  const you = { writer: 'app', actor: 'you', scope: 'you' };
  const session = ulid(tick());
  await record.append({ writer: 'hook', actor: 'you', scope: 'you', session, project: 'notes', agent: 'claude-code' }, { v: 1, id: ulid(clock), kind: 'session.start', ts: clock, data: { agent: 'claude-code', worktree: '~/src/notes', branch: 'main', thread: session } });
  const words = 'the release notes step runs the tests before it writes the notes';
  const transcript = `${JSON.stringify({ type: 'user', uuid: 'm1', sessionId: session, message: { role: 'user', content: words } })}\n`;
  const put = await store.connect({ role: 'deepbuild', via: 'capture' }).put({ bytes: new Uint8Array(Buffer.from(transcript)), kind: 'transcript', source: 'claude-code', redaction: 'complete', license: { name: 'own', allows: [] } });
  await record.append(you, { v: 1, id: ulid(tick()), kind: 'transcript.archived', ts: clock, data: { session: `session:${session}`, evidence: put.evidence.sha256 } });
  const id = ulid(tick());
  await record.append({ writer: 'core', actor: 'you', scope: 'you' }, {
    v: 1, id, kind: 'learn.applied', ts: clock,
    data: { layer: 'learned', target: 'step:release-notes', diff: `+ run: ${added}`, evidence: [{ at: `session:${session}#m1`, quote: 'runs the tests before it writes the notes' }], scope: `session:${session}`, replay: { tasks: 20, regressions: 0 }, applied_by: 'rule:localfirst', supersedes: null },
  });
  const row = (await record.table('learned_layer')).rows.find((r) => String(r.id) === id);
  await record.close();
  process.stdout.write(`${JSON.stringify({ state: row?.state ?? null, reason: row?.reason ?? null })}\n`);
} finally {
  rmSync(dir, { recursive: true, force: true });
}

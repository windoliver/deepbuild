// The archive pass of benchmarks/reading.mjs alone. usage: node passonly.mjs <repo> <find|slice|none|one>
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const [repo, task] = process.argv.slice(2);
const dist = (pkg) => import(`${repo}/packages/${pkg}/dist/index.js`);
const [{ shipped }, { openArchive }, { openAsks }, { openEvidenceStore }, { openRecord }] = await Promise.all(['adapters', 'archive', 'asks', 'evidence', 'record'].map(dist));
const T0 = 1_760_013_451_000;
function session(seed, count, size) {
  let a = seed >>> 0;
  const rng = () => { a = (a + 0x6d2b79f5) >>> 0; let t = Math.imul(a ^ (a >>> 15), a | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const words = 'the cart total tax fix test run build page item price user step list order value return error check case'.split(' ');
  const text = () => Array.from({ length: Math.ceil(size / 5) }, () => words[Math.floor(words.length * rng())]).join(' ');
  const id = `${seed.toString(16).padStart(8, '0')}-0000-4000-a000-${String(seed).padStart(12, '0')}`;
  const lines = Array.from({ length: count }, (_, n) => JSON.stringify({ type: n % 2 ? 'assistant' : 'user', uuid: `m${n + 1}`, sessionId: id, cwd: '/tmp/shop', timestamp: new Date(T0 + n * 1000).toISOString(), message: { role: n % 2 ? 'assistant' : 'user', content: text() } }));
  return { id, text: lines.join('\n') + '\n' };
}
const root = mkdtempSync(join(tmpdir(), 'deep-passonly-'));
try {
  const now = () => T0;
  const env = { HOME: root, CLAUDE_CONFIG_DIR: join(root, 'claude') };
  const folder = join(env.CLAUDE_CONFIG_DIR, 'projects', '-tmp-shop');
  mkdirSync(folder, { recursive: true });
  const sessions = task === 'find' ? Array.from({ length: 300 }, (_, i) => session(0x1515 + i, 40, 400))
    : task === 'slice' ? [...Array.from({ length: 50 }, (_, i) => session(0x6300 + i, 60, 1000)), session(0x63ff, 1000, 300)]
    : task === 'one' ? [session(0x6300, 60, 1000)] : [];
  for (const s of sessions) writeFileSync(join(folder, `${s.id}.jsonl`), s.text);
  const hub = join(root, 'hub');
  const store = await openEvidenceStore({ root: join(hub, 'evidence'), now });
  const record = await openRecord({ path: join(hub, 'ledger.db'), now, evidence: store });
  const asks = await openAsks({ record, now, deliver: () => undefined });
  const archive = await openArchive({ record, evidence: store, asks, adapters: shipped(), env, connection: { writer: 'ext:deepbuild/archive', actor: 'you', scope: 'you' }, now });
  await archive.pass();
  await record.sync?.();
  await record.close();
} finally { rmSync(root, { recursive: true, force: true }); }
process.exit(0);

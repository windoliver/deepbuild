// Reading by reference's workload, for the perf lane's budgets (issue #63): node benchmarks/reading.mjs slice.
// One process archives seeded Claude Code sessions into a record in a temp folder, then reads slices of them as `deep
// read` does, failing unless each holds at most 8,192 characters and each cut one's cursor leads on to the end. The
// issue's 200 ms per `deep read` stays in tests/acceptance/63/budgets.test.ts.
// `find` (issue #1515): the same archive of 300 sessions, indexed as the hub indexes it, then `deep find` queries for
// part of a word, a Greek and a Chinese word, failing unless each finds its seeded message. The issue's 100 ms per
// search stays in tests/acceptance/1515/budgets.test.ts.
// `lookup` (issue #2024): an archive of 1,000 sessions, indexed so, then ⌘K's lookup of a whole word, a Greek and a
// Chinese word, failing unless each finds its seeded message. The issue's 200 ms to ⌘K's first hit stays in
// tests/acceptance/2024/budget.test.ts.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { shipped } from '../packages/adapters/dist/index.js';
import { openArchive } from '../packages/archive/dist/index.js';
import { openAsks } from '../packages/asks/dist/index.js';
import { openEvidenceStore } from '../packages/evidence/dist/index.js';
import { CAP, lookup, openSlicer } from '../packages/reading/dist/index.js';
import { openRecord, openRecordReader } from '../packages/record/dist/index.js';

const T0 = 1_760_013_451_000;

/** A seeded session of `count` messages of about `size` characters, as Claude Code writes its transcript. */
function session(seed, count, size) {
  let a = seed >>> 0;
  const rng = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), a | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const words = 'the cart total tax fix test run build page item price user step list order value return error check case'.split(' ');
  const text = () => Array.from({ length: Math.ceil(size / 5) }, () => words[Math.floor(words.length * rng())]).join(' ');
  const id = `${seed.toString(16).padStart(8, '0')}-0000-4000-a000-${String(seed).padStart(12, '0')}`;
  const lines = Array.from({ length: count }, (_, n) => JSON.stringify({ type: n % 2 ? 'assistant' : 'user', uuid: `m${n + 1}`, sessionId: id, cwd: '/tmp/shop', timestamp: new Date(T0 + n * 1000).toISOString(), message: { role: n % 2 ? 'assistant' : 'user', content: n % 2 ? [{ type: 'text', text: text() }] : text() } }));
  return { id, handle: `session:${id.replace(/[^0-9A-Za-z]/g, '')}`, text: lines.join('\n') + '\n' };
}

const task = process.argv[2];
const root = mkdtempSync(join(tmpdir(), 'deep-reading-bench-'));
try {
  if (!['slice', 'find', 'lookup'].includes(task)) throw Error(`Unknown task ${task}; one of: slice, find, lookup`);
  const searches = task !== 'slice';
  const now = () => T0;
  const env = { HOME: root, CLAUDE_CONFIG_DIR: join(root, 'claude') };
  const folder = join(env.CLAUDE_CONFIG_DIR, 'projects', '-tmp-shop');
  mkdirSync(folder, { recursive: true });
  const sessions = searches
    ? Array.from({ length: task === 'find' ? 300 : 1000 }, (_, i) => session(0x1515 + i, 40, 400))
    : [...Array.from({ length: 50 }, (_, i) => session(0x6300 + i, 60, 1000)), session(0x63ff, 1000, 300)];
  // The words `find` looks for, each in one message of one session.
  const seeded = { thBackoffJit: 'retryWithBackoffJitter', 'ανασύνδ': 'επανασύνδεση', '重试': '连接重试失败' };
  if (searches) Object.values(seeded).forEach((word, i) => { const s = sessions[100 * i + 7]; s.text = s.text.replace('"content":"', `"content":"${word} `); });
  for (const s of sessions) writeFileSync(join(folder, `${s.id}.jsonl`), s.text);
  const hub = join(root, 'hub');
  const store = await openEvidenceStore({ root: join(hub, 'evidence'), now });
  const record = await openRecord({ path: join(hub, 'ledger.db'), now, evidence: store });
  const asks = await openAsks({ record, now, deliver: () => undefined });
  const archive = await openArchive({ record, evidence: store, asks, adapters: shipped(), env, connection: { writer: 'ext:deepbuild/archive', actor: 'you', scope: 'you' }, now });
  await archive.pass();
  if (searches) await record.indexTranscripts();
  await record.sync();
  const slicer = await openSlicer(hub);
  try {
    if (task === 'lookup') {
      const reader = openRecordReader({ path: join(hub, 'ledger.db'), evidence: store });
      try {
        for (let n = 0; n < 10; n++) {
          for (const [i, word] of Object.values(seeded).entries()) {
            const want = `${sessions[100 * i + 7].handle}#m1`;
            if (!(await lookup(reader, word)).hits.some((h) => h.handle === want)) throw Error(`⌘K's lookup of ${word} didn't find ${want}`);
          }
        }
      } finally {
        reader.close();
      }
    } else if (task === 'find') {
      for (let n = 0; n < 10; n++) {
        for (const query of Object.keys(seeded)) if (!(await slicer.find(query)).hits.length) throw Error(`deep find ${query} found nothing`);
      }
    } else {
      const archived = await slicer.archived();
      if (archived.length !== sessions.length) throw Error(`${archived.length} of ${sessions.length} sessions archived`);
      // Every slice of the long session, then message 900 and its continuations, as an agent's reads would come.
      const long = sessions[sessions.length - 1];
      for (const handle of [long.handle, `${long.handle}#m900`, ...sessions.slice(0, 10).map((s) => s.handle)]) {
        let slice = await slicer.read(handle);
        for (let n = 0; ; n++) {
          if (slice.text.length > CAP) throw Error(`${handle}: a slice of ${slice.text.length} characters, past the cap`);
          if (slice.next === undefined) break;
          if (n > 1000) throw Error(`${handle}: a slice's next leads round in circles`);
          slice = await slicer.read(handle, slice.next);
        }
      }
    }
  } finally {
    slicer.close();
  }
  await record.close();
} finally {
  rmSync(root, { recursive: true, force: true });
}

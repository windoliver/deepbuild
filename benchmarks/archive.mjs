// The transcript archive's workloads, for the perf lane's budgets (issue #20): node benchmarks/archive.mjs <task>.
// Each run opens a record, an evidence store and the asks core in a temp folder, writes seeded Claude Code
// transcripts under a temp CLAUDE_CONFIG_DIR, and runs the archive's passes on them, failing unless every session's
// newest copy reads back as its transcript, redacted. The issue's own numbers stay in tests/acceptance/20/budgets.test.ts.
import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { shipped } from '../packages/adapters/dist/index.js';
import { openArchive } from '../packages/archive/dist/index.js';
import { openAsks } from '../packages/asks/dist/index.js';
import { openEvidenceStore, scrubText } from '../packages/evidence/dist/index.js';
import { openRecord } from '../packages/record/dist/index.js';

const T0 = 1_760_013_451_000;
const MB = 1_000_000;
const MINUTE = 60_000;

/** A seeded Claude Code transcript's lines, about `size` bytes: prompts, answers and tool results with file text. */
function transcript(seed, size) {
  let a = seed >>> 0;
  const rng = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), a | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const words = 'the cart total tax fix test run build page item price user step list order value return error check case const import export function await'.split(' ');
  const text = (n) => Array.from({ length: n }, () => words[Math.floor(words.length * rng() ** 2)]).join(' ');
  const id = `${seed.toString(16).padStart(8, '0')}-0000-4000-a000-${String(seed).padStart(12, '0')}`;
  const lines = [];
  for (let bytes = 0, n = 0; bytes < size; n++) {
    const content = n % 3 === 2 ? [{ type: 'tool_result', tool_use_id: `toolu_${n}`, content: Array.from({ length: 40 }, () => `  ${text(8)};`).join('\n') }] : text(30);
    const line = JSON.stringify({ parentUuid: n ? `m${n - 1}` : null, type: n % 3 === 1 ? 'assistant' : 'user', message: { role: n % 3 === 1 ? 'assistant' : 'user', content }, uuid: `m${n}`, timestamp: new Date(T0 + n * 1000).toISOString(), cwd: '/tmp/shop', sessionId: id });
    lines.push(`${line}\n`);
    bytes += line.length + 1;
  }
  return { id, lines };
}

const task = process.argv[2];
const root = mkdtempSync(join(tmpdir(), 'deep-archive-bench-'));
try {
  let now = T0;
  const env = { HOME: root, CLAUDE_CONFIG_DIR: join(root, 'claude') };
  const folder = join(env.CLAUDE_CONFIG_DIR, 'projects', '-tmp-shop');
  mkdirSync(folder, { recursive: true });
  const store = await openEvidenceStore({ root: join(root, 'evidence'), now: () => now });
  const record = await openRecord({ path: join(root, 'ledger.db'), now: () => now, evidence: store });
  const asks = await openAsks({ record, now: () => now, deliver: () => undefined });
  const archive = await openArchive({ record, evidence: store, asks, adapters: shipped(), env, connection: { writer: 'ext:deepbuild/archive', actor: 'you', scope: 'you' }, now: () => now });
  const pathOf = (s) => join(folder, `${s.id}.jsonl`);
  const write = (s, upTo) => writeFileSync(pathOf(s), s.lines.slice(0, upTo).join(''));
  const current = async (sessions) => {
    const newest = new Map((await record.read({ after: 0, kinds: ['transcript.archived'] })).map((e) => [e.data.session, e.data.evidence]));
    for (const s of sessions) {
      const sha = newest.get(`session:${s.id.replace(/[^0-9A-Za-z]/g, '')}`);
      if (!sha || Buffer.from(await store.read(sha)).toString('utf8') !== scrubText(readFileSync(pathOf(s), 'utf8'))) throw Error(`session ${s.id} is current in the archive`);
    }
  };
  if (task === 'live') {
    // Ten sessions 1 MB in, each gaining 12 lines a minute; one pass a minute for five minutes.
    const live = Array.from({ length: 10 }, (_, i) => ({ s: transcript(0x2070 + i, 2 * MB), at: 0 }));
    for (const l of live) {
      for (let bytes = 0; bytes < MB; l.at++) bytes += l.s.lines[l.at].length;
      write(l.s, l.at);
    }
    await archive.pass();
    for (let minute = 0; minute < 5; minute++) {
      for (const l of live) { appendFileSync(pathOf(l.s), l.s.lines.slice(l.at, l.at + 12).join('')); l.at += 12; }
      now += MINUTE;
      await archive.pass();
    }
    await current(live.map((l) => l.s));
  } else if (task === 'month') {
    // A day's sessions at a smaller scale: four 5 MB transcripts, copied at half and whole.
    const day = Array.from({ length: 4 }, (_, i) => transcript(0x2030 + i, 5 * MB));
    for (const s of day) write(s, s.lines.length >> 1);
    await archive.pass();
    for (const s of day) write(s, s.lines.length);
    now += 6 * 60 * MINUTE;
    await archive.pass();
    await current(day);
  } else if (task === 'backlog') {
    // A 100 MB backlog: twenty 5 MB transcripts, archived in one pass.
    const backlog = Array.from({ length: 20 }, (_, i) => transcript(0x2010 + i, 5 * MB));
    for (const s of backlog) write(s, s.lines.length);
    await archive.pass();
    await current(backlog);
  } else throw Error(`Unknown task ${task}; one of: live, month, backlog`);
  await record.close();
} finally {
  rmSync(root, { recursive: true, force: true });
}

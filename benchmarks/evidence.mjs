// One evidence-store workload per run, for the perf lane's budgets (issue #15): node benchmarks/evidence.mjs <task>.
import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { crc32, deflateSync } from 'node:zlib';
import { openEvidenceStore } from '../packages/evidence/dist/index.js';

const DAY = 86_400_000;
const license = { name: 'CC0-1.0', allows: [] };
const root = mkdtempSync(join(tmpdir(), 'deep-evidence-bench-'));
const chunk = (type, data) => {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length);
  head.write(type, 4, 'latin1');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([Buffer.from(type, 'latin1'), data])));
  return Buffer.concat([head, data, crc]);
};

const workloads = {
  // A 1,200 × 1,400 RGB screenshot stored uncompressed: just over 5 MB.
  async 'put-5mb'(store) {
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(1200, 0);
    ihdr.writeUInt32BE(1400, 4);
    ihdr.set([8, 2, 0, 0, 0], 8);
    const rows = randomBytes((1200 * 3 + 1) * 1400);
    for (let y = 0; y < 1400; y++) rows[y * (1200 * 3 + 1)] = 0;
    const png = Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(rows, { level: 0 })), chunk('IEND', Buffer.alloc(0))]);
    await store.connect({ role: 'deepbuild', via: 'journey' }).put({ bytes: png, kind: 'screenshot', source: 'bench', redaction: 'complete', license, declares: 'png' });
  },
  // 8 MB of build output with 16 held values and a run's env, in 64 KB chunks.
  async 'redact-8mb'(store) {
    const held = Array.from({ length: 16 }, () => randomBytes(24).toString('base64url'));
    const lines = [];
    for (let i = 0, size = 0; size < 8 * 1_048_576; i++) {
      const line = i % 500 === 0 ? `step ${i}: token ${held[i % 16]}\n` : `step ${i}: compiled module ${randomBytes(6).toString('base64url')} in ${i % 97} ms\n`;
      lines.push(line);
      size += line.length;
    }
    const text = Buffer.from(lines.join(''));
    const sink = store.connect({ role: 'deepbuild', via: 'job' }).text({ kind: 'log', source: 'bench', redaction: 'complete', license, run: { held, env: { CI: 'true', API_TOKEN: held[0], BUILD_ID: held[1] } } });
    for (let at = 0; at < text.length; at += 65_536) await sink.write(text.subarray(at, at + 65_536));
    await sink.close();
  },
  // A retention pass over 36 days of records at 500 a day, one in ten cited: it removes the 6 oldest days.
  async 'retain-30d'(store, clock) {
    const cited = new Set();
    for (let n = 0; n < 36 * 500; n++) if (n % 10 === 0) cited.add(n.toString(16).padStart(64, '0'));
    clock.now = 36 * DAY;
    await store.retain({ cited, archived: new Set() });
  },
};

const task = process.argv[2];
if (!workloads[task]) throw Error(`Unknown task ${task}; one of: ${Object.keys(workloads).join(', ')}`);
try {
  const clock = { now: 0 };
  if (task === 'retain-30d') {
    // The records are written straight into the store's journal, so the run times the pass, not 18,000 puts.
    const records = Array.from({ length: 36 * 500 }, (_, n) => JSON.stringify({
      sha256: n.toString(16).padStart(64, '0'), size: 512, type: 'binary', kind: 'log', source: 'bench', origin: 'deepbuild',
      redaction: 'complete', license, derivedFrom: [], intake: 'captured', storedAt: Math.floor(n / 500) * DAY + (n % 500) * 1000,
    }));
    writeFileSync(join(root, 'records.jsonl'), `${records.join('\n')}\n`);
  }
  const store = await openEvidenceStore({ root, now: () => clock.now });
  await workloads[task](store, clock);
} finally {
  rmSync(root, { recursive: true, force: true });
}

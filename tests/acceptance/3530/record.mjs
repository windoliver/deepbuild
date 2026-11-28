import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { judgeFixtures, recordedOf } from './judges.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, '..', '..', '..');
const FILE = join(HERE, 'base.json');
const FIRST_RECORDING_SOURCE = join(REPO, 'tests', 'acceptance', '2324', 'fixtures', 'base-bake.json');
const BIN = join(REPO, 'target', 'debug', 'deep-logic');
const check = process.argv.includes('--check');

const kept = existsSync(FILE) ? JSON.parse(readFileSync(FILE, 'utf8')) : null;
if (check && !kept) throw Error(`no ${FILE} to check against`);
const { piece, track, steps } = kept ?? JSON.parse(readFileSync(FIRST_RECORDING_SOURCE, 'utf8'));
for (const [id, item] of Object.entries(piece.items)) {
  const sha = createHash('sha256').update(Buffer.from(piece.assets[item.params.program] ?? '', 'base64')).digest('hex');
  if (sha !== item.params.program) throw Error(`fixture ${id}'s program isn't the bytes its item names (${item.params.program})`);
}
if (!existsSync(BIN)) throw Error(`${BIN} isn't built: cargo build --locked --bin deep-logic`);
const ran = spawnSync(BIN, [], { cwd: REPO, input: `${JSON.stringify({ call: 'bake', piece, track, steps })}\n`, encoding: 'utf8', maxBuffer: 1 << 30 });
if (ran.status !== 0) throw Error(`deep-logic exited ${ran.status ?? ran.signal}: ${ran.stderr.slice(-2000)}`);
const reply = JSON.parse(ran.stdout.trim().split('\n').at(-1));
if (reply.ok !== true) throw Error(`deep-logic didn't bake the piece: ${JSON.stringify(reply).slice(0, 2000)}`);

if (check) {
  const problems = judgeFixtures(kept, reply);
  for (const problem of problems) console.log(problem);
  console.log(problems.length ? `${problems.length} differences from the recording of ${kept.commit}` : `no difference from the recording of ${kept.commit}: ${Object.keys(kept.items).length} fixtures, ${kept.steps} steps`);
  process.exitCode = problems.length ? 1 : 0;
} else {
  const commit = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: REPO, encoding: 'utf8' }).stdout.trim();
  const dirty = spawnSync('git', ['status', '--porcelain', '--', 'crates', 'Cargo.lock', 'Cargo.toml'], { cwd: REPO, encoding: 'utf8' }).stdout.trim();
  if (dirty) throw Error(`the merge base is recorded from its own sources, and these differ from ${commit}:\n${dirty}`);
  const items = recordedOf(reply, steps);
  const body = Object.entries(items).map(([id, item]) => `    ${JSON.stringify(id)}: ${JSON.stringify(item)}`).join(',\n');
  const head = JSON.stringify({ commit, made_by: 'node tests/acceptance/3530/record.mjs, at the merge base, on its debug deep-logic (cargo build --locked --bin deep-logic)', piece, track, steps });
  writeFileSync(FILE, `${head.slice(0, -1)},\n  "items": {\n${body}\n  }\n}\n`);
  console.log(`wrote ${FILE}: ${Object.keys(items).length} fixtures, ${steps} steps, at ${commit}`);
}

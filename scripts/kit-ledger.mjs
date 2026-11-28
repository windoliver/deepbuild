import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const at = process.argv.indexOf('--root');
const root = at === -1 ? fileURLToPath(new URL('../', import.meta.url)) : resolve(process.argv[at + 1] ?? '.');
const blocked = (why) => {
  console.log(`BLOCKED kit ledger: ${why}`);
  process.exit(3);
};

const build = spawnSync('cargo', ['build', '--locked', '--bin', 'deep-show'], { cwd: root, encoding: 'utf8' });
if (build.status !== 0) blocked(`cargo build --bin deep-show failed in ${root}:\n${(build.stderr ?? build.error?.message ?? '').slice(-2000)}`);
const target = process.env.CARGO_TARGET_DIR ? resolve(root, process.env.CARGO_TARGET_DIR) : join(root, 'target');
const dir = mkdtempSync(join(tmpdir(), 'deep-kit-ledger-'));
let modules;
try {
  const dump = spawnSync(join(target, 'debug', 'deep-show'), ['kinds', '--dump', dir], { cwd: root, encoding: 'utf8', maxBuffer: 1 << 30 });
  let line;
  try { line = JSON.parse(dump.stdout.trim().split('\n')[0]); } catch { line = null; }
  if (dump.status !== 0 || line?.ok !== true) blocked(`deep-show kinds --dump exited ${dump.status}: ${dump.stdout.slice(0, 2000)}${dump.stderr.slice(-2000)}`);
  modules = JSON.parse(readFileSync(line.path, 'utf8')).modules;
} finally {
  rmSync(dir, { recursive: true, force: true });
}

const ledger = JSON.parse(readFileSync(join(root, 'crates', 'deep-show', 'kit-ledger.json'), 'utf8'));
const fails = [];
for (const { name, kit: { digest } } of modules) {
  const record = ledger[name];
  if (!record) fails.push(`${name}: the ledger holds no record; the tree's digest is ${digest}`);
  else if (record.digest !== digest) fails.push(`${name}: the ledger holds digest ${record.digest}, the tree's is ${digest}`);
  else if (record.verdict !== 'PASS') fails.push(`${name}: the ledger's verdict at the tree's digest ${digest} is ${record.verdict}`);
}
for (const f of fails) console.log(`FAIL kit ledger: ${f}`);
if (fails.length) process.exit(1);
console.log(`PASS kit ledger: ${modules.length} canvas modules held as PASS at the tree's digests`);

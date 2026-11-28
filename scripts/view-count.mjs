import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const KEPT = 'crates/deep-app/view-count.json';
const BUILD = ['build', '--locked', '--release', '-p', 'deep-app', '--bin', 'deep-app', '--features', 'canvas-fixture'];

const checkout = fileURLToPath(new URL('../', import.meta.url));
const at = process.argv.indexOf('--root');
const root = at === -1 ? checkout : resolve(process.argv[at + 1] ?? '.');
const write = process.argv.includes('--write');
const blocked = (why) => {
  console.log(`BLOCKED view count: ${why}`);
  process.exit(3);
};
const refusedTotal = (count) => Object.values(count.refused).flat().length;
const reasonByPath = (count) => new Map(Object.entries(count.refused).flatMap(([reason, paths]) => paths.map((path) => [path, reason])));
const isCount = (count) => Number.isInteger(count?.counted) && typeof count.refused === 'object' && count.refused !== null
  && Object.values(count.refused).every((paths) => Array.isArray(paths) && paths.every((path) => typeof path === 'string'));

if (process.platform !== 'darwin') blocked(`the app's 3D view draws on macOS, and this is ${process.platform}`);
const build = spawnSync('cargo', BUILD, { cwd: checkout, encoding: 'utf8', maxBuffer: 1 << 28 });
if (build.status !== 0) blocked(`cargo ${BUILD.join(' ')} failed in ${checkout}:\n${(build.stderr ?? build.error?.message ?? '').slice(-2000)}`);
const target = process.env.CARGO_TARGET_DIR ? resolve(checkout, process.env.CARGO_TARGET_DIR) : join(checkout, 'target');
const ran = spawnSync(join(target, 'release', 'deep-app'), ['--view-count', root], { cwd: checkout, encoding: 'utf8', maxBuffer: 1 << 28 });
let counted;
try {
  counted = JSON.parse((ran.stdout ?? '').trim().split('\n').at(-1));
} catch {
  counted = null;
}
if (ran.status !== 0 || !isCount(counted)) blocked(`deep-app --view-count exited ${ran.status}: ${(ran.stdout ?? '').slice(0, 2000)}${(ran.stderr ?? ran.error?.message ?? '').slice(-2000)}`);

let base = null;
try {
  const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  base = JSON.parse(git('show', `${git('merge-base', 'HEAD', 'origin/main').trim()}:${KEPT}`));
} catch {
  base = null;
}

if (write) {
  if (isCount(base) && refusedTotal(counted) > refusedTotal(base)) {
    console.log(`FAIL view count: the view refuses ${refusedTotal(counted)} documents and the merge base keeps ${refusedTotal(base)}: the count only falls`);
    process.exit(1);
  }
  writeFileSync(join(root, KEPT), `${JSON.stringify(counted, null, 2)}\n`);
  console.log(`PASS view count: wrote ${KEPT}: ${counted.counted} 3D documents, ${refusedTotal(counted)} refused`);
  process.exit(0);
}

const fails = [];
let kept;
try {
  kept = JSON.parse(readFileSync(join(root, KEPT), 'utf8'));
} catch (error) {
  kept = null;
  fails.push(`${KEPT}: the tree keeps no count that can be read: ${error.message}`);
}
if (kept !== null && !isCount(kept)) {
  kept = null;
  fails.push(`${KEPT}: it isn't {"counted": <n>, "refused": {"<reason>": ["<path>", ...]}}`);
}
const listed = reasonByPath(kept ?? { refused: {} });
const refused = reasonByPath(counted);
for (const [path, reason] of refused) {
  if (!listed.has(path)) fails.push(`${path}: the view refuses it (${reason}) and the count leaves it out`);
  else if (listed.get(path) !== reason) fails.push(`${path}: the count lists it under ${listed.get(path)} and the view refuses it (${reason})`);
}
for (const [path, reason] of listed) {
  if (!refused.has(path)) fails.push(`${path}: the count lists it under ${reason} and the view draws it`);
}
if (kept !== null && kept.counted !== counted.counted) fails.push(`counted ${counted.counted}, the file says ${kept.counted}`);
if (kept !== null && isCount(base) && refusedTotal(kept) > refusedTotal(base)) fails.push(`the file keeps ${refusedTotal(kept)} refused documents and the merge base keeps ${refusedTotal(base)}: the count only falls`);
for (const fail of fails) console.log(`FAIL view count: ${fail}`);
if (fails.length) process.exit(1);
console.log(`PASS view count: ${counted.counted} 3D documents, ${refused.size} refused, as ${KEPT} says`);

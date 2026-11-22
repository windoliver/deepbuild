// The twins lint (#1832): a planted twin kept as whole copied files goes stale as main moves, since the copy doesn't
// move with it, so twins are kept as their wrong lines, in a lines.json at the top of the twin's folder, applied to the
// file as the change holds it when the before lane runs (scripts/proof-runs.mjs, twinOverlay). This lists every twin a
// suite's tests/acceptance/<suite>/twins.json names whose folder still holds any other file, as the lane lists files
// (git's, less those it ignores): one `FAIL twins: <folder>: ...` line per twin, however many criteria name it, and
// exit 1; or the one line `PASS twins`. A twins/ folder no twins.json names holds a suite's own fixtures, never a twin.
// A twins.json the lane can't read is listed too. `--root <dir>` checks another checkout.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { listFiles } from './proof-change.mjs';

const blocked = (why) => {
  console.log(`BLOCKED twins: ${why}\n  Fix: node scripts/twins-lint.mjs [--root <checkout>], at a git checkout holding tests/acceptance`);
  process.exit(2);
};
const at = process.argv.indexOf('--root');
if (at !== -1 && (!process.argv[at + 1] || process.argv[at + 1].startsWith('--'))) blocked('--root takes a folder');
const root = at === -1 ? fileURLToPath(new URL('../', import.meta.url)) : process.argv[at + 1];
if (!existsSync(join(root, 'tests/acceptance'))) blocked(`${root} holds no tests/acceptance`);
let files;
try {
  files = listFiles(root).filter((path) => path.startsWith('tests/acceptance/'));
} catch (error) {
  blocked(`git cannot list the files of ${root}: ${String(error.message).split('\n')[0]}`);
}

const findings = [];
for (const file of files.filter((path) => /^tests\/acceptance\/[^/]+\/twins\.json$/.test(path)).sort()) {
  const suite = file.slice(0, -'/twins.json'.length);
  let twins;
  try {
    twins = JSON.parse(readFileSync(join(root, file), 'utf8'));
  } catch (error) {
    findings.push(`${file}: is not JSON (${String(error.message).split('\n')[0]})`);
    continue;
  }
  // As the lane reads it (scripts/proof-runs.mjs, twinsOf): each criterion tag to a list of twin folder names.
  const shaped = twins && typeof twins === 'object' && !Array.isArray(twins) && Object.values(twins).every((names) => Array.isArray(names) && names.every((name) => typeof name === 'string' && /^[\w.-]+$/.test(name) && name !== '..' && name !== '.'));
  if (!shaped) {
    findings.push(`${file}: must map each criterion tag to a list of twin folder names`);
    continue;
  }
  for (const name of [...new Set(Object.values(twins).flat())].sort()) {
    const folder = `${suite}/twins/${name}`;
    const whole = files.filter((path) => path === folder || path.startsWith(`${folder}/`)).map((path) => path.slice(folder.length + 1) || name).filter((path) => path !== 'lines.json').sort();
    if (whole.length) findings.push(`${folder}: holds ${whole.length === 1 ? 'a whole file' : `${whole.length} whole files`}, ${whole.join(', ')}`);
  }
}

for (const finding of findings) console.log(`FAIL twins: ${finding}`);
if (findings.length) console.log("  Fix: Keep each twin as its wrong lines in the twin's lines.json, converted by a blind redraft of its suite (tests/acceptance/1832/README.md, The line form).");
else console.log('PASS twins');
process.exit(findings.length ? 1 : 0);

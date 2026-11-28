// The twins lint (#1832, #3291): a twin kept as whole copied files goes stale as main moves, so twins are kept as their
// wrong lines in a lines.json at the top of the twin's folder (scripts/proof-runs.mjs, twinOverlay). This lists every
// twin a suite's twins.json names whose folder holds any other file, as the lane lists files: one `FAIL twins: <folder>:
// ...` line per twin and exit 1, or `PASS twins`. A twins/ folder no twins.json names holds fixtures, never a twin; an
// unreadable twins.json is listed. `--root <dir>` checks another checkout. `--listed`, as the lint lane runs it, passes
// the twins scripts/whole-file-twins.json names that its copy at the merge base with origin/main names too, so the list
// only shrinks as scripts/size-ratchet.mjs's ceilings do, and fails each entry whose folder holds no whole file.
import { execFileSync } from 'node:child_process';
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

const LIST = 'scripts/whole-file-twins.json';
const listed = process.argv.includes('--listed');
const parseList = (text, from) => {
  const list = JSON.parse(text);
  if (!Array.isArray(list) || !list.every((entry) => typeof entry === 'string')) throw Error(`${from} isn't a list of twin folders`);
  return new Set(list);
};
let list = new Set();
let base = null;
if (listed) {
  try {
    list = parseList(readFileSync(join(root, LIST), 'utf8'), LIST);
  } catch (error) {
    console.log(`INVALID twins: ${LIST} can't be read: ${error.message}\n  Fix: Restore ${LIST}: a JSON list of the twin folders, tests/acceptance/<suite>/twins/<twin>, still kept as whole files.`);
    process.exit(1);
  }
  const git = (...args) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 64 * 1024 * 1024 });
  let at;
  try {
    at = git('merge-base', 'HEAD', 'origin/main').trim();
  } catch {}
  if (at && git('ls-tree', '--name-only', at, '--', LIST).trim()) base = parseList(git('show', `${at}:${LIST}`), `${LIST} at the merge base`);
}

const findings = [];
const whole = new Map();
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
    const held = files.filter((path) => path === folder || path.startsWith(`${folder}/`)).map((path) => path.slice(folder.length + 1) || name).filter((path) => path !== 'lines.json').sort();
    if (held.length) whole.set(folder, `${folder}: holds ${held.length === 1 ? 'a whole file' : `${held.length} whole files`}, ${held.join(', ')}`);
  }
}

let left = 0;
for (const [folder, finding] of whole) {
  if (!listed) findings.push(finding);
  else if (!list.has(folder)) findings.push(finding);
  else if (base && !base.has(folder)) findings.push(`${finding}; ${LIST} at the merge base doesn't name it, and a twin is never added to the list`);
  else left++;
}
const stale = listed ? [...list].filter((folder) => !whole.has(folder)).sort() : [];
for (const folder of stale) findings.push(`${folder}: named in ${LIST}, but holds no whole file a twins.json names`);

for (const finding of findings) console.log(`FAIL twins: ${finding}`);
if (findings.length > stale.length) console.log("  Fix: Keep each twin as its wrong lines in the twin's lines.json, converted by a blind redraft of its suite (tests/acceptance/1832/README.md, The line form).");
if (stale.length) console.log(`  Fix: Take each stale entry off ${LIST}: the list only shrinks.`);
if (!findings.length) console.log(listed ? `PASS twins: ${left} whole-file twin${left === 1 ? '' : 's'} left, each named in ${LIST}${base ? '' : '; no list at a merge base with origin/main to compare with'}` : 'PASS twins');
// exitCode, not exit(): piped stdout drains first, so a slow reader gets every finding.
process.exitCode = findings.length ? 1 : 0;

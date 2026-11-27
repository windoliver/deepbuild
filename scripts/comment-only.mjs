import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SOURCE, tokens } from './comment-source.mjs';

const USAGE = 'node scripts/comment-only.mjs <path>';
const root = fileURLToPath(new URL('../', import.meta.url));
const git = (...args) => execFileSync('git', ['--literal-pathspecs', ...args], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024 });
const under = process.argv[2];
if (process.argv.length !== 3 || under.startsWith('-')) {
  console.log(`BLOCKED comment-only: it takes one path\n  Fix: ${USAGE}`);
  process.exit(2);
}

let at;
let changed;
try {
  at = git('merge-base', 'HEAD', 'origin/main').trim();
  if (!existsSync(join(root, under)) && !git('ls-tree', '--name-only', at, '--', under).trim()) throw Error(`fatal: no ${under} in the work tree or at the merge base`);
  changed = [...new Set([...git('diff', '--name-only', '--no-renames', '-z', at, '--', under).split('\0'), ...git('ls-files', '-z', '--others', '--exclude-standard', '--', under).split('\0')])].filter(Boolean).sort();
} catch (error) {
  console.log(`BLOCKED comment-only: git can't compare ${under} with the merge base with origin/main: ${error.message.split('\n').find((line) => /fatal|error/.test(line)) ?? error.message.split('\n')[0]}\n  Fix: Run it in a git checkout that has origin/main, on a path inside it: ${USAGE}`);
  process.exit(2);
}

const out = [];
const fail = (line) => out.push(`FAIL comment-only: ${line}\n  Fix: Take the change to the code out of the pass, or land it as a change of its own: a pass removes comments and white space only.`);
for (const path of changed) {
  let was = null;
  let now = null;
  try {
    was = git('show', `${at}:${path}`);
  } catch {}
  try {
    now = readFileSync(join(root, path), 'utf8');
  } catch {}
  if (was === null) fail(`${path}: not at the merge base, so all of it is new`);
  else if (now === null) fail(`${path}: deleted`);
  else if (!SOURCE.test(path)) fail(`${path}: changed, and not a source file whose comments it can tell from its code`);
  else {
    const [before, after] = [tokens(path, was), tokens(path, now)];
    const first = before.findIndex((token, index) => token.text !== after[index]?.text);
    const differs = first !== -1 ? first : after.length > before.length ? before.length : -1;
    const line = now.slice(0, after[differs]?.at ?? now.length).split('\n').length;
    if (differs !== -1) fail(`${path}:${line}: its code differs from the merge base's: ${JSON.stringify(after[differs]?.text ?? 'the end of the file')} where the merge base has ${JSON.stringify(before[differs]?.text ?? 'the end of the file')}`);
  }
}

if (out.length) console.log(out.join('\n'));
else console.log(`PASS comment-only: ${changed.length} file${changed.length === 1 ? '' : 's'} changed under ${under}, each with the code its merge base ${at.slice(0, 9)} holds, comments and white space aside`);
process.exitCode = out.length ? 1 : 0;

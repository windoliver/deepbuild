// A test that starts this checkout's perf.mjs or preflight.mjs (or tests/preflight.test.mjs, which starts
// preflight.mjs) from a copy of the whole scripts/ folder claims the machine's timed grant: throttle.mjs is beside
// perf.mjs in the copy, and both scripts request timed, waiting up to 60 minutes (docs/parallel-proof.md,
// section 6). Inside an affected.mjs block that request is nested under the block's test grant, and while it is
// pending no top-level grant on the machine starts: the table drains for every session until the block's
// neighbours finish. Such a file belongs in lanes.mjs's timed list, so it runs only under a timed grant its request
// passes through on. A file whose code names HOME (a table of its own) or throttle.mjs (a copy it filters or
// rewrites) handles the table itself, and a copy of perf.mjs alone, with no throttle.mjs beside it, takes no
// grant. Checked by reading this checkout's tree, as #1114's grep does for the timing helpers.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { timed } from '../scripts/lanes.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const CHILD = new Set(['spawn', 'spawnSync', 'execFile', 'execFileSync', 'exec', 'execSync', 'fork']);
const COPIES = new Set(['readdirSync', 'cpSync']);
const MEASURED = /(?:^|\/)(?:perf\.mjs|preflight(?:\.test)?\.mjs)$/;

const literals = (node, out = []) => {
  if (ts.isStringLiteralLike(node) || ts.isTemplateLiteralToken(node)) out.push(node.text);
  ts.forEachChild(node, (child) => { literals(child, out); });
  return out;
};
/** What a file's code does: starts a measured run, copies a folder whole, names HOME or throttle.mjs itself. */
function reads(path) {
  const text = readFileSync(join(root, path), 'utf8');
  const source = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, false, path.endsWith('.ts') ? ts.ScriptKind.TS : ts.ScriptKind.JS);
  const found = { starts: false, copies: false, handles: false };
  const visit = (node) => {
    if (ts.isCallExpression(node)) {
      const callee = node.expression;
      const name = ts.isIdentifier(callee) ? callee.text : ts.isPropertyAccessExpression(callee) ? callee.name.text : null;
      if (CHILD.has(name) && node.arguments.some((argument) => literals(argument).some((literal) => MEASURED.test(literal)))) found.starts = true;
      if (COPIES.has(name)) found.copies = true;
    }
    if ((ts.isIdentifier(node) && node.text === 'HOME') || ((ts.isStringLiteralLike(node) || ts.isTemplateLiteralToken(node)) && /HOME|throttle\.mjs/.test(node.text))) found.handles = true;
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}
/** Whether a test file, with the helpers.mjs beside it when it uses one, takes the machine's timed grant. */
function takesTimed(file) {
  const parts = [reads(file)];
  const helpers = join(dirname(file), 'helpers.mjs');
  if (readFileSync(join(root, file), 'utf8').includes('helpers') && existsSync(join(root, helpers))) parts.push(reads(helpers));
  const any = (key) => parts.some((part) => part[key]);
  return any('starts') && any('copies') && !any('handles');
}
/** The test files git lists under tests/, tracked and untracked but not ignored. */
const testFiles = () => execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard', 'tests'], { cwd: root, encoding: 'utf8', maxBuffer: 1 << 28 })
  .split('\0').filter((path) => /^tests\/.*\.test\.(?:mjs|ts)$/.test(path) && existsSync(join(root, path)));
const covers = (list, file) => list.some((entry) => (entry.endsWith('/') ? file.startsWith(entry) : file === entry));

test('every test file that starts perf.mjs or preflight.mjs from a copy of scripts/ on the machine\'s table is in lanes.mjs timed list', () => {
  const taking = testFiles().filter(takesTimed).sort();
  assert.ok(taking.length, 'no test file starts perf.mjs or preflight.mjs from a copy of scripts/, so the check checks nothing');
  const missing = taking.filter((file) => !covers(timed, file));
  assert.deepEqual(missing, [], `test files that take the machine's timed grant but are not in lanes.mjs's timed list:\n${missing.join('\n')}`);
});

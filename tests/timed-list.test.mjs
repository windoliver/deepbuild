// A test that starts this checkout's perf.mjs or preflight.mjs from a copy of the whole scripts/ folder takes the
// machine's timed grant: throttle.mjs is beside perf.mjs in the copy, and both scripts claim timed for 60 minutes
// (docs/parallel-proof.md, section 6). Inside an affected.mjs block that claim is a nested timed request, which
// drains the table for every session on the machine until the block's neighbours finish. Such a file belongs in
// lanes.mjs's timed list, so it runs only under a timed grant its request passes through on. A file with a HOME of
// its own, or one that names throttle.mjs, handles the table itself (a sandbox, or a copy it rewrites), and a copy
// of perf.mjs alone, with no throttle.mjs beside it, takes no grant. Checked by reading this checkout's tree, as
// #1114's grep does for the timing helpers.
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import ts from 'typescript';
import { CHECKOUT, covers, lanesLists, trackedFiles } from './acceptance/1114/helpers.mjs';

const CHILD = new Set(['spawn', 'spawnSync', 'execFile', 'execFileSync', 'exec', 'execSync', 'fork']);
const COPIES = new Set(['readdirSync', 'cpSync']);
const MEASURED = /(?:^|\/)(?:perf|preflight)\.mjs$/;

const literals = (node, out = []) => {
  if (ts.isStringLiteralLike(node) || ts.isTemplateLiteralToken(node)) out.push(node.text);
  ts.forEachChild(node, (child) => { literals(child, out); });
  return out;
};
/** What a file's code does: starts perf.mjs or preflight.mjs, copies a folder whole, handles the table itself. */
function reads(path) {
  const text = readFileSync(join(CHECKOUT, path), 'utf8');
  const source = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, false, path.endsWith('.ts') ? ts.ScriptKind.TS : ts.ScriptKind.JS);
  const found = { starts: false, copies: false, handles: /\bHOME\b|throttle\.mjs/.test(text) };
  const visit = (node) => {
    if (ts.isCallExpression(node)) {
      const callee = node.expression;
      const name = ts.isIdentifier(callee) ? callee.text : ts.isPropertyAccessExpression(callee) ? callee.name.text : null;
      if (CHILD.has(name) && node.arguments.some((argument) => literals(argument).some((literal) => MEASURED.test(literal)))) found.starts = true;
      if (COPIES.has(name)) found.copies = true;
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}
/** Whether a test file, with the helpers.mjs beside it when it uses one, takes the machine's timed grant. */
function takesTimed(file) {
  const parts = [reads(file)];
  const helpers = join(dirname(file), 'helpers.mjs');
  if (readFileSync(join(CHECKOUT, file), 'utf8').includes('helpers') && existsSync(join(CHECKOUT, helpers))) parts.push(reads(helpers));
  const any = (key) => parts.some((part) => part[key]);
  return any('starts') && any('copies') && !any('handles');
}

test('every test file that starts perf.mjs or preflight.mjs from a copy of scripts/ on the machine\'s table is in lanes.mjs timed list', () => {
  const taking = trackedFiles(CHECKOUT).filter((path) => /^tests\/.*\.test\.(?:mjs|ts)$/.test(path)).filter(takesTimed).sort();
  assert.ok(taking.length, 'no test file starts perf.mjs or preflight.mjs from a copy of scripts/, so the check checks nothing');
  const { timed } = lanesLists();
  assert.ok(Array.isArray(timed), `scripts/lanes.mjs exports no timed list (got ${JSON.stringify(timed)})`);
  const missing = taking.filter((file) => !covers(timed, file));
  assert.deepEqual(missing, [], `test files that take the machine's timed grant but are not in lanes.mjs's timed list:\n${missing.join('\n')}`);
});

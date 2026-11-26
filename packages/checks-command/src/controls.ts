// Controls in every run (#1099, the part #33's corpus needs): the report a run's result is read from comes from the
// test tool's reporter, in the process of the code under test, so code that rewrites results on import passes both the
// base run and check health. Each Vitest or node:test file in the run's checkout gets one test after its last line
// whose assertion is false by construction, under a name drawn for the run; a run keeps its result only when the report
// shows each control of a file it ran failed at the line written for it. In a file that focuses tests its control is
// focused too, so it runs; one a filter other than the command's own left out can't hold, and the run can't pass (#2081).
// Controls are never tests of the check: left out of its counts, failures and listing, and the file is put back as it
// was once the run ends. Nor is a control's failure the tool's: a run that fails nothing else exits 0, so a step chained
// after it runs and any failing exit is the run's own. node:test's control is a todo test, whose failure the tool reports
// and doesn't count; Vitest counts its own as passed once the runner's reporter has its failure (vitest-reporter.mjs).
import { randomBytes } from 'node:crypto';
import { chmodSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import type { Failure } from '@deepbuild/conformance';
import { focusesTests, type Listed } from './listing.js';
import { CONTROL, isControl, type Ran } from './report.js';

/** Writes a file whose approved bytes the hub keeps read-only, putting its mode back after. */
function rewrite(path: string, text: string): void {
  const { mode } = statSync(path);
  chmodSync(path, mode | 0o200);
  try { writeFileSync(path, text); } finally { chmodSync(path, mode); }
}

/** The words a run's evidence and its check's reason carry when a control didn't fail where it was written. */
const UNRECORDED = "the report can't record a failure";
const TEST_FILE = /\.(test|spec)\.[cm]?[jt]s$/;
/** Folders whose test files are another tree's, never the run's: dependencies, and fixtures a test copies as a repo of its own. */
const SKIP = new Set(['node_modules', '.git', 'fixtures', '__fixtures__', 'testdata']);

export interface Control extends Listed { block: string }

/** One run's checkouts at a time plant and put back, so two runs in one checkout never write a file at once. */
const queue = new Map<string, Promise<unknown>>();
function serial<T>(key: string, fn: () => T | Promise<T>): Promise<T> {
  const next = (queue.get(key) ?? Promise.resolve()).then(fn, fn);
  const tail = next.then(() => undefined, () => undefined);
  queue.set(key, tail);
  void tail.then(() => { if (queue.get(key) === tail) queue.delete(key); });
  return next;
}

function testFiles(root: string, dir = root, out: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(e.name) || e.name.startsWith('deep-check-run')) continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) testFiles(root, p, out);
    else if (e.isFile() && TEST_FILE.test(e.name)) out.push(relative(root, p));
  }
  return out;
}

/** The control block for a file, by the tool and module form its own text uses, and whether the tool is node:test; null for a file of another tool. Its names carry the run's draw, so two runs' controls in one file never clash. */
async function blockFor(text: string, file: string, name: string, draw: string): Promise<{ block: string; node: boolean } | null> {
  const n = JSON.stringify(name);
  const [d, t, e] = [`__deepSuite${draw}`, `__deepControl${draw}`, `__deepCheck${draw}`];
  if (/['"]vitest['"]/.test(text)) {
    // The listing reads the file as planted, so it sees in this focus one the source states as `{ only: true }`.
    const only = (await focusesTests(text, file)) ? '.only' : '';
    // Vitest can't be required, and takes an import in a CommonJS file too.
    return { node: false, block: `\nimport { test as ${t}, expect as ${e} } from 'vitest';\n${t}${only}(${n}, () => { ${e}(0).toBe(1); });\n` };
  }
  if (/['"]node:test['"]/.test(text)) {
    const esm = /^\s*(import|export)\s/m.test(text);
    // node:test runs focused tests alone only under --test-only, which a script the command runs may give it.
    const only = "{ only: process.execArgv.includes('--test-only') }";
    // In a suite of its own: node:test takes a todo test that fails at the top of a file as why the file's process failed.
    return { node: true, block: esm ? `\nimport { describe as ${d}, test as ${t} } from 'node:test';\nimport ${e} from 'node:assert';\n${d}(${n}, ${only}, () => { ${t}(${n}, { todo: true }, () => { ${e}.strictEqual(0, 1); }); });\n`
      : `\nrequire('node:test').describe(${n}, ${only}, () => { require('node:test').test(${n}, { todo: true }, () => { require('node:assert').strictEqual(0, 1); }); });\n` };
  }
  return null;
}

/** Appends one control to each Vitest and node:test file of the checkout. */
export function plantControls(checkout: string): Promise<Control[]> {
  return serial(checkout, async () => {
    const out: Control[] = [];
    for (const file of testFiles(checkout)) {
      const path = join(checkout, file);
      const text = readFileSync(path, 'utf8');
      const draw = randomBytes(6).toString('hex');
      const name = `${CONTROL}${draw}`;
      const made = await blockFor(text, file, name, draw);
      if (!made) continue;
      const { block, node } = made;
      const body = text.endsWith('\n') ? text : `${text}\n`;
      // The control's assertion is the block's last line, after the file's lines and the blank one the block opens with.
      const line = body.split('\n').length - 1 + block.split('\n').length - 1;
      rewrite(path, `${body}${block}`);
      out.push({ test: name, file, line, tagged: false, block, ...(node ? { names: [name, name] } : {}) });
    }
    return out;
  });
}

/** Takes each control back out, leaving its file's bytes as they were. */
export function removeControls(checkout: string, controls: Control[]): Promise<void> {
  return serial(checkout, () => {
    for (const c of controls) {
      const path = join(checkout, c.file);
      let text: string;
      try { text = readFileSync(path, 'utf8'); } catch { continue; }
      const at = text.lastIndexOf(c.block);
      if (at >= 0) rewrite(path, text.slice(0, at) + text.slice(at + c.block.length));
    }
  });
}

/**
 * Why the run's report can't be trusted to record a failure: a control of a file it ran that didn't fail at its line;
 * null when every one did. `leftOut`: each is only missing, left out by what `leftOutBy` names. Such a run can fail, never pass.
 */
export function unheld(controls: Control[], ran: Ran[], failures: Failure[], filesRan: Set<string>, leftOutBy: (c: Listed) => string[]): { why: string; leftOut: boolean } | null {
  let out: { why: string; leftOut: boolean } | null = null;
  for (const c of controls) {
    // A file the run reported no test of (one that failed to load) fails on its own; its control proves nothing.
    if (!filesRan.has(c.file) || !ran.some((t) => t.file === c.file && !isControl(t.test))) continue;
    const r = ran.find((t) => t.test.includes(c.test));
    const f = failures.find((x) => x.test.includes(c.test));
    const at = `${c.file}:${c.line}`;
    if (!r) {
      const by = leftOutBy(c);
      const why = `${UNRECORDED}: its control ${c.test} in ${c.file} is missing from the report`;
      if (!by.length) return { why, leftOut: false };
      out ??= { why: `${why}: ${by.join(' and ')} left it out`, leftOut: true };
    } else if (r.attempts.at(-1) !== 'failed' || !f) return { why: `${UNRECORDED}: its control ${c.test} at ${at} was reported passed`, leftOut: false };
    else if (f.file !== c.file || f.line !== c.line) return { why: `${UNRECORDED}: its control ${c.test} failed at ${f.file}:${f.line}, not at ${at}`, leftOut: false };
  }
  return out;
}
export { isControl };

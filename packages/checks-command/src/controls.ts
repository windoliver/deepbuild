// Controls in every run (#1099, the part #33's corpus needs): the report a run's result is read from comes from the
// test tool's reporter, in the process of the code under test, so code that rewrites results on import passes both the
// base run and check health. Each Vitest or node:test file in the run's checkout gets one test after its last line
// whose assertion is false by construction, under a name drawn for the run; a run keeps its result only when the report
// shows each control of a file it ran failed at the line written for it. Controls are never tests of the check: left
// out of its counts, failures and listing, and the file is put back as it was once the run ends.
import { randomBytes } from 'node:crypto';
import { chmodSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import type { Failure } from '@deepbuild/conformance';
import type { Ran } from './report.js';

/** Writes a file whose approved bytes the hub keeps read-only, putting its mode back after. */
function rewrite(path: string, text: string): void {
  const { mode } = statSync(path);
  chmodSync(path, mode | 0o200);
  try { writeFileSync(path, text); } finally { chmodSync(path, mode); }
}

/** Every control's name starts so, whichever run drew it: a run that shares its checkout leaves its own out too. */
const CONTROL = 'deepbuild control ';
/** The words a run's evidence and its check's reason carry when a control didn't fail where it was written. */
const UNRECORDED = "the report can't record a failure";
const TEST_FILE = /\.(test|spec)\.[cm]?[jt]s$/;
/** Folders whose test files are another tree's, never the run's: dependencies, and fixtures a test copies as a repo of its own. */
const SKIP = new Set(['node_modules', '.git', 'fixtures', '__fixtures__', 'testdata']);

export interface Control { file: string; name: string; line: number; block: string }

/** One run's checkouts at a time plant and put back, so two runs in one checkout never write a file at once. */
const queue = new Map<string, Promise<unknown>>();
function serial<T>(key: string, fn: () => T): Promise<T> {
  const next = (queue.get(key) ?? Promise.resolve()).then(fn, fn);
  queue.set(key, next.catch(() => undefined));
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

/** The control block for a file, by the tool and module form its own text uses; null for a file of another tool. Its names carry the run's draw, so two runs' controls in one file never clash. */
function blockFor(text: string, name: string, draw: string): string | null {
  const esm = /^\s*(import|export)\s/m.test(text);
  const n = JSON.stringify(name);
  const [t, e] = [`__deepControl${draw}`, `__deepCheck${draw}`];
  if (/['"]vitest['"]/.test(text)) {
    return esm ? `\nimport { test as ${t}, expect as ${e} } from 'vitest';\n${t}(${n}, () => { ${e}(0).toBe(1); });\n`
      : `\nrequire('vitest').test(${n}, () => { require('vitest').expect(0).toBe(1); });\n`;
  }
  if (/['"]node:test['"]/.test(text)) {
    return esm ? `\nimport ${t} from 'node:test';\nimport ${e} from 'node:assert';\n${t}(${n}, () => { ${e}.strictEqual(0, 1); });\n`
      : `\nrequire('node:test')(${n}, () => { require('node:assert').strictEqual(0, 1); });\n`;
  }
  return null;
}

/** Appends one control to each Vitest and node:test file of the checkout. */
export function plantControls(checkout: string): Promise<Control[]> {
  return serial(checkout, () => {
    const out: Control[] = [];
    for (const file of testFiles(checkout)) {
      const path = join(checkout, file);
      const text = readFileSync(path, 'utf8');
      const draw = randomBytes(6).toString('hex');
      const name = `${CONTROL}${draw}`;
      const block = blockFor(text, name, draw);
      if (!block) continue;
      const body = text.endsWith('\n') ? text : `${text}\n`;
      // The control's assertion is the block's last line, after the file's lines and the blank one the block opens with.
      const line = body.split('\n').length - 1 + block.split('\n').length - 1;
      rewrite(path, `${body}${block}`);
      out.push({ file, name, line, block });
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

/** Why the run's report can't be trusted to record a failure: a control of a file it ran that didn't fail at its line; null when every one did. */
export function unheld(controls: Control[], ran: Ran[], failures: Failure[], filesRan: Set<string>): string | null {
  for (const c of controls) {
    // A file the run reported no test of (one that failed to load) fails on its own; its control proves nothing.
    if (!filesRan.has(c.file) || !ran.some((t) => t.file === c.file && !isControl(t.test))) continue;
    const r = ran.find((t) => t.test.includes(c.name));
    const f = failures.find((x) => x.test.includes(c.name));
    const at = `${c.file}:${c.line}`;
    if (!r) return `${UNRECORDED}: its control ${c.name} in ${c.file} is missing from the report`;
    if (r.attempts.at(-1) !== 'failed' || !f) return `${UNRECORDED}: its control ${c.name} at ${at} was reported passed`;
    if (f.file !== c.file || f.line !== c.line) return `${UNRECORDED}: its control ${c.name} failed at ${f.file}:${f.line}, not at ${at}`;
  }
  return null;
}
export const isControl = (test: string): boolean => test.includes(CONTROL);

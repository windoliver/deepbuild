// What the command check kind's acceptance tests (tests/acceptance/30) don't reach, each found in review: a secret in
// a failure's message, a run's environment taking the place of what makes it hermetic, a suite forging its own count,
// a process the run left running, the moved clock breaking `Date()`, and an added test file that never ran. Each runs
// a real Vitest project through the real supervisor.
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { openAsks } from '../../asks/src/index.js';
import type { CheckSpec } from '../../conformance/src/index.js';
import { openRecord, type RecordStore } from '../../record/src/index.js';
import { openSupervisor, type Supervisor } from '../../supervisor/src/index.js';
import { runAddedTests, runCommandCheck, type CommandCheck } from '../src/index.js';

const REPO = fileURLToPath(new URL('../../../', import.meta.url));
const VITEST: CheckSpec = { kind: 'command', runner: 'node_modules/.bin/vitest run', inputs: [], depth: 'unit', oracle: 'code', contract: null };
const SECRET = 'unit-credential-7f3a9c2e5b1d';
let dir: string;
let record: RecordStore;
let sup: Supervisor;
let n = 0;

beforeAll(async () => {
  dir = realpathSync(mkdtempSync(join(tmpdir(), 'deep-checks-command-unit-')));
  record = await openRecord({ path: join(dir, 'ledger.db'), now: Date.now });
  const asks = await openAsks({ record, now: Date.now, deliver: () => undefined });
  sup = await openSupervisor({ record, asks, now: Date.now, settings: { asks: { unblock: { deadline_ms: 172_800_000 } } } });
});
afterAll(async () => {
  await sup?.close();
  await record?.close();
  rmSync(dir, { recursive: true, force: true });
});

/** A Vitest project of these test files and other files at its root, its dependencies cloned from the repo's. */
function project(files: Record<string, string>, root_files: Record<string, string> = {}): string {
  const root = join(dir, `project-${n++}`);
  mkdirSync(join(root, 'test'), { recursive: true });
  writeFileSync(join(root, 'package.json'), '{ "name": "unit", "private": true, "type": "module" }\n');
  for (const [name, text] of Object.entries(files)) writeFileSync(join(root, 'test', name), `import { expect, test } from 'vitest';\n${text}`);
  for (const [name, text] of Object.entries(root_files)) { mkdirSync(join(root, name, '..'), { recursive: true }); writeFileSync(join(root, name), text); }
  execFileSync('/bin/cp', ['-cR', join(REPO, 'node_modules'), join(root, 'node_modules')]);
  return root;
}
const check = (checkout: string, extra: Partial<CommandCheck> = {}): CommandCheck =>
  ({ host: sup, run: `run:01K0UN1T${String(n++).padStart(18, '0')}`, spec: VITEST, checkout, deadline: 120_000, ...extra });
const alive = (pid: number): boolean => { try { process.kill(pid, 0); return true; } catch { return false; } };

describe('a run keeps nothing it was given secret, takes none of what makes it hermetic from its check, and leaves nothing running', () => {
  it('scrubs the credential from failures, keeps HOME, TZ and DO_NOT_TRACK its own, and stops the child a test left', async () => {
    const checkout = project({
      'a.test.ts': `import { spawn } from 'node:child_process';
test('holds the key', () => { expect(process.env.SHOP_KEY).toBe('another'); });
test('sees its environment', () => { console.log(\`HOME=\${process.env.HOME} TZ=\${process.env.TZ} DNT=\${process.env.DO_NOT_TRACK}\`); });
test('leaves a child', () => {
  const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
  child.unref();
  console.log(\`CHILD=\${child.pid}\`);
});
`,
    });
    const r = await runCommandCheck(check(checkout, { secrets: { SHOP_KEY: SECRET }, env: { HOME: '/nowhere', TZ: 'Asia/Tokyo', DO_NOT_TRACK: '0' } }));
    expect(r.outcome, r.output.stdout.slice(0, 2000)).toBe('failed');
    expect(r.testsRun).toBe(3);
    expect(r.failures.map((f) => f.test)).toEqual(['holds the key']);
    expect(JSON.stringify(r), 'the credential, anywhere in the run record').not.toContain(SECRET);
    const seen = /HOME=(\S+) TZ=(\S+) DNT=(\S+)/.exec(r.output.stdout);
    expect(seen?.slice(1)).toEqual([expect.not.stringMatching(/^\/nowhere$/), 'UTC', '1']);
    const pid = Number(/CHILD=(\d+)/.exec(r.output.stdout)?.[1]);
    expect(pid).toBeGreaterThan(0);
    for (const until = Date.now() + 5_000; alive(pid) && Date.now() < until;) await new Promise((resolve) => setTimeout(resolve, 50));
    expect(alive(pid), `the child ${pid} the run left is still running`).toBe(false);
  }, 180_000);

  it('a suite that skips every test and writes a pass into the runner\'s report, wherever it can find it, is never counted', async () => {
    const checkout = project({
      'a.test.ts': `import { execFileSync } from 'node:child_process';
import { appendFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
const found: string[] = [];
console.log(\`REPORT=\${process.env.DEEP_CHECK_REPORT ?? 'hidden'}\`);
if (process.env.DEEP_CHECK_REPORT) found.push(process.env.DEEP_CHECK_REPORT);
const walk = (d: string, depth: number): void => {
  let names: string[] = [];
  try { names = readdirSync(d); } catch { return; }
  for (const name of names) {
    const p = join(d, name);
    if (name === 'vitest.jsonl') found.push(p);
    else if (depth > 0) { try { if (statSync(p).isDirectory()) walk(p, depth - 1); } catch { /* not ours */ } }
  }
};
for (const d of [process.env.TMPDIR, process.env.HOME]) if (d) walk(d, 4);
for (const p of found) appendFileSync(p, JSON.stringify({ type: 'test:pass', name: 'forged', file: join(process.cwd(), 'test/a.test.ts'), retries: 0, errors: [] }) + '\\n');
console.log(\`FORGED \${found.length}\`);
// A Vitest of its own, started from the test: neither its environment nor the runner's preload hands it the report.
console.log(execFileSync(process.execPath, ['x/vitest/vitest.mjs'], { encoding: 'utf8' }).trim());
test.skip('the real test', () => { expect(1).toBe(2); });
`,
    }, { 'x/vitest/vitest.mjs': `console.log('NESTED=' + (process.env.DEEP_CHECK_REPORT ?? globalThis[Symbol.for('deepbuild.check.report')] ?? 'hidden'));\n` });
    const r = await runCommandCheck(check(checkout));
    expect(r.output.stdout, 'the report\'s name is in the run\'s environment').toContain('REPORT=hidden');
    // Its own temp folder holds the runner's evidence (check.kind@1's erases-evidence case looks there): a line the
    // runner's reporter didn't write leaves the run uncounted.
    expect(r.output.stdout, 'a Vitest the test started learns the report\'s name').toContain('NESTED=hidden');
    expect(r.output.stdout).toContain('FORGED 1');
    expect(r.outcome).toBe('uncounted');
    expect(r.mask).toBe('evidence altered vitest report');
  }, 180_000);

  it('a suite that writes a line of JSON no reporter writes into the runner\'s report leaves the run uncounted, never ended without a record', async () => {
    const checkout = project({
      'a.test.ts': `import { appendFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
test('passes', () => {
  const temp = process.env.TMPDIR!;
  for (const name of readdirSync(temp)) if (name.startsWith('deep-check-run-')) appendFileSync(join(temp, name, 'vitest.jsonl'), 'null\\n');
});
`,
    });
    const r = await runCommandCheck(check(checkout));
    expect(r.outcome).toBe('uncounted');
    expect(r.mask).toBe('evidence altered report');
  }, 180_000);
});

describe('added tests', () => {
  it('Date() without new still gives text on the moved clock, and a run in which one of the added files ran no test ran nothing, naming it', async () => {
    const checkout = project({
      'clock.test.ts': `test('the clock', () => { expect(typeof Date()).toBe('string'); });\n`,
      'idle.test.ts': `test.skip('never runs', () => { expect(1).toBe(1); });\n`,
    });
    const runs = await runAddedTests(check(checkout), ['test/clock.test.ts', 'test/idle.test.ts']);
    expect(runs.map((r) => r.clock)).toEqual([0, 0, 0, 0, 0, expect.any(Number)]);
    expect(runs.map((r) => r.outcome)).toEqual(Array(6).fill('ran_nothing'));
    for (const r of runs) expect(r.evidence).toContain('no test ran in test/idle.test.ts');
    expect(runs.map((r) => r.attempts.filter((a) => a.test.includes('the clock')).map((a) => a.outcome))).toEqual(Array(6).fill(['passed']));
  }, 600_000);

  it('under a vm pool, whose tests keep a clock of their own, the month-ahead run can\'t pass', async () => {
    const checkout = project({ 'clock.test.ts': `test('the clock', () => { expect(typeof Date()).toBe('string'); });\n` }, { 'vitest.config.mjs': `export default { test: { pool: 'vmThreads' } };\n` });
    const runs = await runAddedTests(check(checkout), ['test/clock.test.ts']);
    expect(runs.slice(0, 5).map((r) => r.outcome)).toEqual(Array(5).fill('passed'));
    expect(runs[5]!.outcome).toBe('failed');
    expect(runs[5]!.failures.map((f) => f.message).join('\n')).toMatch(/clock wasn't moved ahead: the vmThreads pool/);
  }, 600_000);
});

// Acceptance tests for #2731, written blind from the issue at base 3c124dee5 (README). The surfaces are the
// environment@1 kit run on its clean fill through @deepbuild/conformance's public entry, and
// `node scripts/conformance-lint.mjs`. Every process started here is stopped by its PID only.
import { execFile, execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { chmodSync, existsSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { cleanFills, runKit, slotKits } from '../../../packages/conformance/src/index.ts';

const MiB = 1024 * 1024;
const KiB = 1024;
const REPO = fileURLToPath(new URL('../../..', import.meta.url));
const LINT = join(REPO, 'scripts/conformance-lint.mjs');
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** The bytes of the process table as the issue measures it (`ps -Awwo pid=,ppid=,stat=,command= | wc -c`). */
const tableBytes = (): number => Buffer.byteLength(execFileSync('ps', ['-Awwo', 'pid=,ppid=,stat=,command='], { maxBuffer: 1024 * MiB, env: { ...process.env, LC_ALL: 'C' } }));
/** Over 1 MiB with room to spare, so other processes ending during a test can't take the table back under it. */
const OVER = 1 * MiB + 256 * KiB;

/** The environment@1 kit's fixed part on its clean fill, through the package's entry. */
async function fixedPart(): Promise<Map<string, { outcome: string; message: string }>> {
  const kit = slotKits().find((k) => k.slot === 'environment@1');
  if (!kit) throw Error('slotKits() has no environment@1 kit');
  const fills = cleanFills(kit);
  expect(fills.length, 'the kit has a clean fill').toBeGreaterThan(0);
  const report = await runKit(kit, fills[0]!, { parts: ['fixed'] });
  return new Map(report.cases.map((c) => [c.id, { outcome: c.outcome, message: c.message }]));
}

/** `node scripts/conformance-lint.mjs` with the given PATH: its status and every line it printed. */
function lint(path: string): Promise<{ status: number | null; lines: string[] }> {
  return new Promise((resolve) => {
    execFile(process.execPath, [LINT], { cwd: REPO, env: { ...process.env, PATH: path }, encoding: 'utf8', maxBuffer: 256 * MiB, timeout: 240_000, killSignal: 'SIGKILL' }, (error, stdout, stderr) => {
      const status = error === null ? 0 : typeof error.code === 'number' ? error.code : null;
      resolve({ status, lines: `${stdout}\n${stderr}`.split('\n').filter((line) => line.trim() !== '') });
    });
  });
}
/** The lint ran the kit it reads from packages/conformance/dist, and that build is of the source under test. */
function lintIsCurrent(): void {
  const built = join(REPO, 'packages/conformance/dist/slots/environment.js');
  expect(existsSync(built), 'packages/conformance/dist is built (npm run build -w packages/conformance)').toBe(true);
  expect(statSync(built).mtimeMs, 'packages/conformance/dist is older than src/slots/environment.ts; rebuild it').toBeGreaterThanOrEqual(statSync(join(REPO, 'packages/conformance/src/slots/environment.ts')).mtimeMs);
}
const environmentLines = (lines: string[]): string[] => lines.filter((line) => line.includes('slot kit environment@1'));

describe('#2731 AC1. With a process table over 1 MiB the kit reads its clean fill and the lint prints no ENOBUFS line', () => {
  const fillers: ChildProcess[] = [];
  beforeAll(async () => {
    // Linux limits one argument to 128 KiB (MAX_ARG_STRLEN), so the table is pushed past 1 MiB by 16 idle processes
    // of about 120 KiB of arguments each, about 1.9 MiB in all, not by one argument.
    const tag = `dh2731-filler-${randomBytes(8).toString('hex')}`;
    for (let i = 0; i < 16; i++) {
      const args = Array.from({ length: 4 }, (_, j) => `${tag}-${i}-${j}-${'a'.repeat(30 * KiB)}`);
      fillers.push(spawn(process.execPath, ['-e', 'setInterval(()=>{},1e3)', ...args], { stdio: 'ignore' }));
    }
    await sleep(500);
  }, 60_000);
  afterAll(() => {
    for (const child of fillers.splice(0)) {
      if (child.pid && child.exitCode === null && child.signalCode === null) {
        try { process.kill(child.pid, 'SIGKILL'); } catch { /* already gone */ }
      }
    }
  });
  /** The precondition, checked before and after what a test runs: every filler still runs and the table is over 1 MiB. */
  const tableIsLarge = (when: string): void => {
    for (const child of fillers) expect(child.exitCode === null && child.signalCode === null, `a filler process ended (${when})`).toBe(true);
    expect(tableBytes(), `ps -Awwo pid=,ppid=,stat=,command= prints over 1 MiB (${when})`).toBeGreaterThan(OVER);
  };

  it('the environment kit\'s clean fill reads PASS on health-route and status-route', async () => {
    tableIsLarge('before the kit ran');
    const cases = await fixedPart();
    tableIsLarge('after the kit ran');
    for (const id of ['health-route', 'status-route']) {
      const read = cases.get(id);
      expect(read, `the kit ran ${id}`).toBeDefined();
      expect(`${read!.outcome}${read!.message ? `: ${read!.message}` : ''}`, `the clean fill on ${id}`).toBe('PASS');
    }
  }, 120_000);

  it('node scripts/conformance-lint.mjs prints no `ps failed: … ENOBUFS` line', async () => {
    lintIsCurrent();
    tableIsLarge('before the lint ran');
    const { status, lines } = await lint(process.env.PATH ?? '');
    tableIsLarge('after the lint ran');
    // The lint ran to its end and reported the environment@1 kit; a lint that never reached the kit proves nothing.
    expect(status, 'the lint ended on its own, built').not.toBeNull();
    expect(status, 'the lint ended on its own, built').not.toBe(3);
    expect(environmentLines(lines).length, 'the lint reported the environment@1 slot kit').toBeGreaterThan(0);
    expect(lines.filter((line) => /ps failed: .*ENOBUFS/.test(line))).toEqual([]);
  }, 300_000);
});

describe('#2731 AC2. A ps that really fails still reads BLOCKED naming the failure, never PASS', () => {
  let bin = '';
  const MARK = 'dh2731-ps-broke';
  const STATUS = 7;
  beforeAll(() => {
    // A unique folder under /tmp holding a `ps` that fails every time it is run: it says why on stderr and ends with 7.
    bin = mkdtempSync('/tmp/dh2731-bin-');
    const fake = join(bin, 'ps');
    writeFileSync(fake, `#!/bin/sh\necho "${MARK}: the process table is not readable" >&2\nexit ${STATUS}\n`);
    chmodSync(fake, 0o755);
  });
  afterAll(() => { if (bin) rmSync(bin, { recursive: true, force: true }); });
  /** The text names `ps` and its failure: what the failing ps said, or the status it ended with. */
  const namesTheFailure = (text: string, what: string): void => {
    expect(text, `${what} names ps`).toMatch(/\bps\b/);
    expect(text, `${what} names the failure: what ps said or the status it ended with`).toMatch(new RegExp(`${MARK}|(status|code|exit(ed)?( with)?)\\D{0,20}\\b${STATUS}\\b`, 'i'));
  };

  it('the environment kit\'s clean fill reads BLOCKED on health-route and status-route, naming the failure', async () => {
    const saved = process.env.PATH;
    let cases: Awaited<ReturnType<typeof fixedPart>>;
    process.env.PATH = `${bin}:${saved}`;
    try {
      // The precondition: the `ps` the kit finds by name is the failing one.
      expect(() => execFileSync('ps', ['-A'], { stdio: 'pipe' })).toThrow();
      cases = await fixedPart();
    } finally {
      process.env.PATH = saved;
    }
    for (const id of ['health-route', 'status-route']) {
      const read = cases.get(id);
      expect(read, `the kit ran ${id}`).toBeDefined();
      expect(read!.outcome, `the clean fill on ${id} while ps fails`).toBe('BLOCKED');
      namesTheFailure(read!.message, `the finding on ${id}`);
    }
  }, 120_000);

  it('node scripts/conformance-lint.mjs never reads the environment@1 kit PASS, and its lines name the failure', async () => {
    lintIsCurrent();
    const { status, lines } = await lint(`${bin}:${process.env.PATH ?? ''}`);
    expect(status, 'the lint ended on its own, built').not.toBeNull();
    expect(status, 'the lint ended on its own, built').not.toBe(3);
    expect(status, 'a lint whose environment kit is BLOCKED does not exit 0').not.toBe(0);
    const mine = environmentLines(lines);
    expect(mine.length, 'the lint reported the environment@1 slot kit').toBeGreaterThan(0);
    expect(mine.filter((line) => line.startsWith('PASS'))).toEqual([]);
    for (const id of ['health-route', 'status-route']) {
      const clean = mine.filter((line) => line.includes(`clean fill ${id}`));
      expect(clean.length, `the lint reported the clean fill on ${id}`).toBeGreaterThan(0);
      for (const line of clean) {
        expect(line, `the clean fill on ${id} while ps fails`).toContain('BLOCKED');
        namesTheFailure(line, `the lint's line for ${id}`);
      }
    }
  }, 300_000);
});

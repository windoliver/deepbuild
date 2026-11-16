// Acceptance tests for #2634, written blind from the issue at base 1e3b798c5 (README). The surface is
// `processesNaming` from tests/acceptance/159/helpers.ts. Every process started here is stopped by its PID only.
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { inspect } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';
import { processesNaming } from '../159/helpers.ts';

const MiB = 1024 * 1024;
const KiB = 1024;
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

const started: ChildProcess[] = [];
const dirs: string[] = [];
afterEach(() => {
  for (const child of started.splice(0)) {
    if (child.pid && child.exitCode === null && child.signalCode === null) {
      try { process.kill(child.pid, 'SIGKILL'); } catch { /* already gone */ }
    }
  }
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** A node that idles, with `args` after the script, stopped by PID in afterEach. */
function idle(args: string[]): ChildProcess {
  const child = spawn(process.execPath, ['-e', 'setInterval(()=>{},1e3)', ...args], { stdio: 'ignore' });
  started.push(child);
  return child;
}

/** The process table as the helper reads it, with a buffer big enough to measure it. */
const table = (): string => execFileSync('ps', ['-A', '-ww', '-o', 'pid=,pgid=,args='], { encoding: 'utf8', maxBuffer: 1024 * MiB, env: { ...process.env, LC_ALL: 'C' } });

describe('#2634 AC1. A large process table is read, not refused', () => {
  it('returns the process naming the needle, and throws nothing, while ps -A -ww prints over 1 MiB', async () => {
    const needle = `dh2634-needle-${randomBytes(8).toString('hex')}`;
    const filler = `dh2634-filler-${randomBytes(8).toString('hex')}`;
    // Linux limits one argument to 128 KiB (MAX_ARG_STRLEN) and procps-ng 4 shows at most 128 KiB of a command line,
    // so the table is pushed past 1 MiB by several processes with ~2 MiB of arguments in all, not by one argument.
    const chunk = (tag: string) => Array.from({ length: 4 }, (_, i) => `${tag}-${i}-${'a'.repeat(30 * KiB)}`);
    const target = idle([needle, ...chunk('n')]);
    for (let i = 0; i < 16; i++) idle([filler, ...chunk(`f${i}`)]);
    await sleep(500);
    for (const child of started) expect(child.exitCode, 'a child exited early').toBeNull();

    const size = Buffer.byteLength(table());
    expect(size, 'ps -A -ww -o pid=,pgid=,args= printed over 1 MiB').toBeGreaterThan(1 * MiB + 256 * KiB);

    let found: ReturnType<typeof processesNaming> = [];
    expect(() => { found = processesNaming(needle); }).not.toThrow();
    const mine = found.filter((p) => p.pid === target.pid);
    expect(mine, 'the needle process is returned').toHaveLength(1);
    expect(mine[0]!.args).toContain(needle);
    expect(found.every((p) => p.args.includes(needle))).toBe(true);
  }, 60_000);
});

describe('#2634 AC2. What the helper throws or prints stays small', () => {
  it('a failing ps that prints 4 MiB gives an error naming ps and its status, serialized under 64 KiB', () => {
    const bin = mkdtempSync(join(tmpdir(), 'dh2634-bin-'));
    dirs.push(bin);
    const fake = join(bin, 'ps');
    // 4 MiB of rows shaped like the real table, then exit 1.
    writeFileSync(fake, '#!/bin/sh\nnode -e \'const r="  4242  4242 dh2634-fake-row "+"x".repeat(1000)+"\\n";process.stdout.write(r.repeat(Math.ceil(4*1048576/r.length)))\'\nexit 1\n');
    chmodSync(fake, 0o755);
    expect(Buffer.byteLength(execFileSync('sh', ['-c', `"${fake}" || true`], { maxBuffer: 64 * MiB }))).toBeGreaterThanOrEqual(4 * MiB);

    const savedPath = process.env.PATH;
    const writes: string[] = [];
    const out = process.stdout.write.bind(process.stdout);
    const errw = process.stderr.write.bind(process.stderr);
    const capture = (w: typeof out) => ((chunk: unknown, ...rest: unknown[]) => {
      writes.push(String(chunk));
      return (w as (...a: unknown[]) => boolean)(chunk, ...rest);
    }) as typeof out;
    let thrown: unknown;
    process.env.PATH = `${bin}:${savedPath}`;
    process.stdout.write = capture(out);
    process.stderr.write = capture(errw);
    try {
      processesNaming(`dh2634-needle-${randomBytes(8).toString('hex')}`);
    } catch (error) {
      thrown = error;
    } finally {
      process.stdout.write = out;
      process.stderr.write = errw;
      process.env.PATH = savedPath;
    }

    expect(thrown, 'processesNaming throws when ps fails').toBeInstanceOf(Error);
    const error = thrown as Error & Record<string, unknown>;
    expect(error.message).toMatch(/\bps\b/);
    expect(error.message, 'the message names the exit status or the error code').toMatch(/(status|code|exit(ed)?( with)?)\D{0,20}\b1\b|\bE[A-Z0-9]{3,}\b/i);

    const own: Record<string, unknown> = { message: error.message };
    for (const key of Object.keys(error)) own[key] = error[key];
    const inspected = inspect(error, { depth: Infinity, maxStringLength: Infinity, maxArrayLength: Infinity, showHidden: false });
    const ownInspected = inspect(own, { depth: Infinity, maxStringLength: Infinity, maxArrayLength: Infinity });
    // spawnSync's error carries itself as `error`; a circular reference is written once, as vitest's serializer does.
    const seen = new WeakSet<object>();
    const json = JSON.stringify(own, (_key, value: unknown) => {
      if (typeof value === 'object' && value !== null) {
        if (seen.has(value)) return '[Circular]';
        seen.add(value);
      }
      return value;
    });
    expect(Buffer.byteLength(inspected), 'util.inspect of the error').toBeLessThan(64 * KiB);
    expect(Buffer.byteLength(ownInspected), 'util.inspect of message and own enumerable properties').toBeLessThan(64 * KiB);
    expect(Buffer.byteLength(json), 'JSON.stringify of message and own enumerable properties').toBeLessThan(64 * KiB);
    expect(`${inspected}${json}`.split('dh2634-fake-row').length - 1, 'the table rows do not reach the error').toBe(0);

    const printed = writes.join('');
    expect(Buffer.byteLength(printed), 'what reached the console').toBeLessThan(64 * KiB);
    expect(printed).not.toContain('dh2634-fake-row');
  }, 60_000);
});

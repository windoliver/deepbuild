// #2484: the environment kit (environment@1) reads lsof's exit 1 as "found nothing" only when stderr is empty, so a
// machine where lsof warns about a mount it can't stat (and still answers) reads every empty answer as unreadable.
//
// lsof is the OS's, a boundary this repo doesn't own. The kit runs `lsof` by name from PATH, so each test puts a
// stand-in `lsof` first on PATH. The warning stand-in runs the real lsof and adds the issue's mount warning to stderr
// unless lsof is asked to suppress warnings (`-w`), as the real one does; so the answer is the real lsof's, and a fix
// that passes `-w` and a fix that tolerates warning lines both pass. The failing stand-ins model an lsof that fails
// for another reason: a real error beside the warning, lsof missing from PATH, lsof killed by a signal.
//
// The kit is reached through the conformance package's public entry: `kitProblems` is what `scripts/slots-check.mjs`
// runs for each kit, `runKit` the kit runner.
import { type ChildProcess, spawn } from 'node:child_process';
import { chmodSync, existsSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanFills, kitProblems, runKit, slotKits } from '../../../packages/conformance/src/index.ts';
import type { EnvironmentFill, EnvironmentHandle } from '../../../packages/conformance/src/index.ts';

const AC1 = '#2484.43cad8f7';
const AC2 = '#2484.c9d8cf75';
const LIMIT = 180_000;

const kit = () => slotKits().find((k) => k.slot === 'environment@1')!;
const realLsof = ['/usr/sbin/lsof', '/usr/bin/lsof', '/sbin/lsof', '/bin/lsof'].find((p) => existsSync(p));
const realPs = ['/bin/ps', '/usr/bin/ps'].find((p) => existsSync(p));

// The issue's warning, two lines per mount, as lsof prints it on every call on that machine.
const WARNING = [
  "lsof: WARNING: can't stat() tracefs file system /sys/kernel/debug/tracing",
  '      Output information may be incomplete.',
  "lsof: WARNING: can't stat() nsfs file system /run/docker/netns/default",
  '      Output information may be incomplete.',
].join('\n');
// A real error, not a warning, as lsof prints when it can't do what it was asked.
const ERROR = "lsof: can't read the open files table: Permission denied";

const sq = (s: string): string => `'${s.replace(/'/g, `'\\''`)}'`;
// Whether lsof was told to suppress warnings: `-w` alone or among bundled single-letter flags such as `-nPw`.
const QUIET = `quiet=0; for a in "$@"; do case "$a" in -[abhlnNOPRtUVwX]*) case "$a" in *w*) quiet=1;; esac;; esac; done`;
const warn = `if [ "$quiet" = 0 ]; then printf '%s\\n' ${sq(WARNING)} >&2; fi`;

/** A folder holding an `lsof` stand-in with the given body after the warning flag is worked out. */
function standIn(body: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'deep-2484-lsof-'));
  writeFileSync(join(dir, 'lsof'), `#!/bin/sh\n${QUIET}\n${body}\n`);
  chmodSync(join(dir, 'lsof'), 0o755);
  return dir;
}
const dirs: string[] = [];
const path = process.env.PATH;
afterEach(() => {
  process.env.PATH = path;
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});
/** Put the stand-in first on PATH for the rest of the test. */
const use = (dir: string): void => { dirs.push(dir); process.env.PATH = `${dir}:${path}`; };

// The machine of the issue: the real lsof's answer and status, with the mount warning on stderr unless -w.
const warningLsof = (): string => { if (!realLsof) throw new Error('BLOCKED: no lsof on this machine to stand behind the stand-in'); return standIn(`${warn}\n${sq(realLsof)} "$@"\nexit $?`); };
// lsof failing for another reason, with the warning beside it: no answer, a real error, status 1.
const failingLsof = (): string => standIn(`${warn}\nprintf '%s\\n' ${sq(ERROR)} >&2\nexit 1`);
// The real lsof with the warning on every call but the working-folder one (`-d cwd`), which fails with a real error.
const failingCwdLsof = (): string => {
  if (!realLsof) throw new Error('BLOCKED: no lsof on this machine to stand behind the stand-in');
  return standIn(`${warn}\ncwd=0; prev=; for a in "$@"; do if [ "$prev" = -d ] && [ "$a" = cwd ]; then cwd=1; fi; prev="$a"; done\nif [ "$cwd" = 1 ]; then printf '%s\\n' ${sq(ERROR)} >&2; exit 1; fi\n${sq(realLsof)} "$@"\nexit $?`);
};
// An lsof that prints only the warning and is then killed by a signal: no answer at all.
const killedLsof = (): string => standIn(`${warn}\nkill -KILL $$`);

const outcomes = (report: { cases: { outcome: string; codes: string[] }[] }) => report.cases.map((c) => [c.outcome, ...c.codes]);

/**
 * A fill whose handle names a process that carries the run token and listens on nothing, while a separate server
 * outside the environment (no run token, not under the handle's process) answers health on the leased port. The
 * kit's first lsof reading of the environment then has nothing to show: real lsof ends with 1 and no output, and the
 * kit refuses the fill for listening on nothing.
 */
function listensOnNothing(children: ChildProcess[]): EnvironmentFill {
  const server = `
    const [port, token] = process.argv.slice(1);
    require('node:http').createServer((q, s) => { if (q.url === '/ping') { s.writeHead(204); s.end(); return; } s.writeHead(200, { 'content-type': 'application/json' }); s.end(JSON.stringify({ ok: true, token })); })
      .listen(Number(port), '127.0.0.1');
    process.on('SIGTERM', () => process.exit(0));`;
  const pairs = new Map<number, ChildProcess[]>();
  return {
    slot: 'environment@1', revision: 1,
    up: (spec, lease, checkout) => new Promise<EnvironmentHandle>((resolve, reject) => {
      const http = spawn(process.execPath, ['-e', server, String(lease.port), spec.token], { stdio: 'ignore', cwd: checkout });
      const idle = spawn(process.execPath, ['-e', 'process.on("SIGTERM", () => process.exit(0)); setTimeout(() => {}, 30_000);', lease.token], { stdio: 'ignore', cwd: checkout });
      children.push(http, idle);
      pairs.set(idle.pid!, [http, idle]);
      const until = Date.now() + 5000;
      const poll = (): void => {
        fetch(`http://127.0.0.1:${lease.port}/ping`).then(() => resolve({ id: `idle-${idle.pid}`, port: lease.port, pid: idle.pid! }), () => (Date.now() < until ? setTimeout(poll, 20) : reject(Error('the health server did not come up'))));
      };
      poll();
    }) as unknown as EnvironmentHandle,
    down: (handle) => { for (const c of pairs.get(handle.pid) ?? []) c.kill('SIGTERM'); },
  };
}

describe('#2484: lsof mount warnings and the environment kit', () => {
  it(`${AC1} the slot check's kit checks pass the environment kit on a machine whose lsof warns about a mount it can't stat`, () => {
    use(warningLsof());
    // The issue's line comes from these problems: planted leaves-grandchild first refused as BLOCKED listeners_unknown.
    // They also run the clean fill on every fixed case, so a clean fill that stops passing under the warning shows here.
    const problems = kitProblems(kit());
    expect(problems.map((p) => `${p.check} ${p.name}: ${p.reason}`)).toEqual([]);
  }, LIMIT);

  it(`${AC1} the planted leaves-grandchild fill is refused with its own fault, not as an unreadable table, when lsof warns`, async () => {
    use(warningLsof());
    const k = kit();
    const planted = k.planted.find((p) => p.name === 'leaves-grandchild')!;
    const report = await runKit(k, planted.fill as EnvironmentFill, { parts: ['fixed'] });
    expect(outcomes(report)).toEqual([['FAIL', 'process_left'], ['FAIL', 'process_left']]);
    for (const c of report.cases) expect(c.message).toContain('left its process running after down');
  }, LIMIT);

  it(`${AC1} an environment that listens on nothing is refused for it, not read as unreadable, when lsof warns`, async () => {
    use(warningLsof());
    const children: ChildProcess[] = [];
    try {
      const report = await runKit(kit(), listensOnNothing(children), { parts: ['fixed'] });
      expect(outcomes(report)).toEqual([['FAIL', 'unleased_port'], ['FAIL', 'unleased_port']]);
      for (const c of report.cases) expect(c.message).toMatch(/listens on nothing/);
    } finally {
      for (const c of children) c.kill('SIGKILL');
    }
  }, LIMIT);

  it(`${AC2} an lsof that ends with 1 and a real error beside the warning reads BLOCKED, never PASS or "listens on nothing"`, async () => {
    use(failingLsof());
    const k = kit();
    const clean = await runKit(k, cleanFills(k)[0]!, { parts: ['fixed'] });
    expect(outcomes(clean)).toEqual([['BLOCKED', 'listeners_unknown'], ['BLOCKED', 'listeners_unknown']]);
    for (const c of clean.cases) expect(c.message).toMatch(/lsof failed/);
    const children: ChildProcess[] = [];
    try {
      const nothing = await runKit(k, listensOnNothing(children), { parts: ['fixed'] });
      expect(outcomes(nothing)).toEqual([['BLOCKED', 'listeners_unknown'], ['BLOCKED', 'listeners_unknown']]);
      for (const c of nothing.cases) expect(c.message).not.toMatch(/listens on nothing/);
    } finally {
      for (const c of children) c.kill('SIGKILL');
    }
  }, LIMIT);

  it(`${AC2} an lsof whose working-folder reading fails with a real error reads BLOCKED, not PASS`, async () => {
    use(failingCwdLsof());
    const k = kit();
    const report = await runKit(k, cleanFills(k)[0]!, { parts: ['fixed'] });
    expect(outcomes(report)).toEqual([['BLOCKED', 'folders_unknown'], ['BLOCKED', 'folders_unknown']]);
    for (const c of report.cases) expect(c.message).toMatch(/lsof failed/);
  }, LIMIT);

  it(`${AC2} lsof missing from PATH reads BLOCKED, never PASS or "listens on nothing"`, async () => {
    if (!realPs) throw new Error('BLOCKED: no ps on this machine');
    // A PATH with ps and nothing else: the kit can read the process table and can't run lsof.
    const dir = mkdtempSync(join(tmpdir(), 'deep-2484-nolsof-'));
    dirs.push(dir);
    symlinkSync(realPs, join(dir, 'ps'));
    process.env.PATH = dir;
    const k = kit();
    const children: ChildProcess[] = [];
    try {
      const clean = await runKit(k, cleanFills(k)[0]!, { parts: ['fixed'] });
      expect(outcomes(clean)).toEqual([['BLOCKED', 'listeners_unknown'], ['BLOCKED', 'listeners_unknown']]);
      const nothing = await runKit(k, listensOnNothing(children), { parts: ['fixed'] });
      expect(outcomes(nothing)).toEqual([['BLOCKED', 'listeners_unknown'], ['BLOCKED', 'listeners_unknown']]);
    } finally {
      for (const c of children) c.kill('SIGKILL');
    }
  }, LIMIT);

  it(`${AC2} an lsof killed by a signal after printing only the warning reads BLOCKED, never PASS or "listens on nothing"`, async () => {
    use(killedLsof());
    const k = kit();
    const children: ChildProcess[] = [];
    try {
      const clean = await runKit(k, cleanFills(k)[0]!, { parts: ['fixed'] });
      expect(outcomes(clean)).toEqual([['BLOCKED', 'listeners_unknown'], ['BLOCKED', 'listeners_unknown']]);
      const nothing = await runKit(k, listensOnNothing(children), { parts: ['fixed'] });
      expect(outcomes(nothing)).toEqual([['BLOCKED', 'listeners_unknown'], ['BLOCKED', 'listeners_unknown']]);
    } finally {
      for (const c of children) c.kill('SIGKILL');
    }
  }, LIMIT);
});

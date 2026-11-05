// #880.e0afc5f5, blind redraft (README.md here): on the reference Mac, a manual run: Touch ID accepted gives a counted
// answer within 2 s of the touch; Touch ID cancelled leaves the ask open with "the prompt was cancelled". A person runs
// it: the real built deep-confirm and the real Secure Enclave, through the suite's copy of the hub, no confirmation
// stub. Without the opt-in a person sets, or off a reference Mac, it is skipped as INCONCLUSIVE, never passed.
//
// The touch is observed without ps: a small watcher (WATCH_C, built with cc) finds the helper among the hub's
// descendants through libproc and takes its exit time from the kernel (kqueue NOTE_EXIT, and the exit time the
// kernel keeps in the process's rusage). The helper takes the touch, signs and exits, so its exit is the touch's
// latest moment as the hub sees it; the count is the hub's own ask.answered timestamp. Neither depends on how fast
// this loaded Mac schedules the test process.

import { execFileSync, spawn } from 'node:child_process';
import { closeSync, openSync, realpathSync, writeFileSync, writeSync } from 'node:fs';
import { basename, join } from 'node:path';
import { afterEach, expect, test } from 'vitest';
import { childEnv, cleanup, events, expectCountedOnce, expectOpen, MINUTE, NODE, own, ready, run, shown, sleep, tempDir, type Hub, type Ran, type Rig } from '../helpers.ts';

const OPT_IN = 'DEEP_880_TOUCH_ID';
const REFERENCE_MACS = ['Mac15,7', 'Mac15,12'];
const TOUCH_TO_COUNT_MS = 2000;
/** How long each answer waits for you: a person's time, not a machine's. */
const PERSON_MS = 10 * MINUTE;
/** How long before the helper's process is gone the hub may record the answer it already read from the helper. */
const READ_BEFORE_EXIT_MS = 250;

let tty: number | undefined;
afterEach(() => {
  if (tty !== undefined) try { closeSync(tty); } catch { /* closed */ }
  tty = undefined;
});
afterEach(cleanup, 60_000);

/** Tells the person, on the terminal at once (vitest may hold console output) and in the test's log. */
function say(text: string): void {
  console.log(text);
  try {
    tty ??= openSync('/dev/tty', 'w');
    writeSync(tty, `\u0007\n${text}\n\n`);
  } catch { /* no terminal: the log line stands */ }
}

/** Why this machine isn't a reference Mac, or null. */
function notReference(): string | null {
  if (process.platform !== 'darwin') return `platform ${process.platform}`;
  const model = execFileSync('sysctl', ['-n', 'hw.model'], { encoding: 'utf8' }).trim();
  return REFERENCE_MACS.includes(model) ? null : `not a reference Mac (${model}; the reference Macs are ${REFERENCE_MACS.join(' and ')})`;
}

// ---- The watcher. Bounded: it tracks at most 64 helpers, reads the kernel's process lists into buffers sized at
// each call, and prints a line per start and exit. It never kills anything.
const WATCH_C = String.raw`
// argv: <hub pid> <helper path> <helper name>. The hub's descendants match by path or name; any process of this
// user by exact path. Lines: "ready <t>", "start <pid> <started> <seen> <path>", "exit <pid> <t> <exact|woke|late>",
// times in ms since the epoch. It exits when its stdin closes.
#include <libproc.h>
#include <mach/mach_time.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/event.h>
#include <sys/proc.h>
#include <sys/proc_info.h>
#include <sys/resource.h>
#include <time.h>
#include <unistd.h>

#define MAXW 64
static pid_t tracked[MAXW];
static int exited[MAXW];
static int ntracked;
static int kq;
static pid_t hub;
static const char *want_path, *want_name;

static double now_ms(void) {
  struct timespec t;
  clock_gettime(CLOCK_REALTIME, &t);
  return (double)t.tv_sec * 1e3 + (double)t.tv_nsec / 1e6;
}

/* The exit time the kernel keeps while the process is a zombie ("exact"); else fallback, when the watcher learnt of it. */
static double exit_time(pid_t p, double fallback, const char **how) {
  struct rusage_info_v4 ri;
  memset(&ri, 0, sizeof ri);
  uint64_t abs_now = mach_absolute_time();
  double ms_now = now_ms();
  if (proc_pid_rusage(p, RUSAGE_INFO_V4, (rusage_info_t *)&ri) != 0 || ri.ri_proc_exit_abstime == 0 || ri.ri_proc_exit_abstime > abs_now) return fallback;
  mach_timebase_info_data_t tb;
  mach_timebase_info(&tb);
  *how = "exact";
  return ms_now - (double)(abs_now - ri.ri_proc_exit_abstime) * tb.numer / tb.denom / 1e6;
}

static void report_exit(int i, double woke, const char *fallback_how) {
  if (exited[i]) return;
  exited[i] = 1;
  const char *how = fallback_how;
  double t = exit_time(tracked[i], woke, &how);
  printf("exit %d %.3f %s\n", tracked[i], t, how);
  fflush(stdout);
}

static void consider(pid_t p, int by_name) {
  if (p <= 0 || ntracked >= MAXW) return;
  for (int i = 0; i < ntracked; i++) if (tracked[i] == p) return;
  char path[PROC_PIDPATHINFO_MAXSIZE];
  if (proc_pidpath(p, path, sizeof path) <= 0) return;
  const char *base = strrchr(path, '/');
  base = base ? base + 1 : path;
  if (strcmp(path, want_path) != 0 && !(by_name && strcmp(base, want_name) == 0)) return;
  double seen = now_ms();
  struct proc_bsdinfo bi;
  double started = -1;
  if (proc_pidinfo(p, PROC_PIDTBSDINFO, 0, &bi, sizeof bi) == (int)sizeof bi) started = (double)bi.pbi_start_tvsec * 1e3 + (double)bi.pbi_start_tvusec / 1e3;
  int i = ntracked++;
  tracked[i] = p;
  exited[i] = 0;
  struct kevent ev;
  EV_SET(&ev, p, EVFILT_PROC, EV_ADD | EV_ONESHOT, NOTE_EXIT, 0, NULL);
  int failed = kevent(kq, &ev, 1, NULL, 0, NULL) < 0;
  printf("start %d %.3f %.3f %s\n", p, started, seen, path);
  fflush(stdout);
  if (failed) report_exit(i, now_ms(), "late");
}

/* The pids of type/arg, into a buffer sized at the call; the caller frees it. */
static int list(int type, uint32_t arg, pid_t **out) {
  int bytes = proc_listpids(type, arg, NULL, 0);
  if (bytes <= 0) return 0;
  size_t cap = (size_t)bytes / sizeof(pid_t) + 1024;
  pid_t *buf = malloc(cap * sizeof(pid_t));
  if (!buf) return 0;
  bytes = proc_listpids(type, arg, buf, (int)(cap * sizeof(pid_t)));
  if (bytes <= 0) { free(buf); return 0; }
  *out = buf;
  return bytes / (int)sizeof(pid_t);
}

static void scan_descendants(void) {
  pid_t queue[1024];
  int head = 0, tail = 0;
  queue[tail++] = hub;
  while (head < tail) {
    pid_t *kids = NULL;
    int n = list(PROC_PPID_ONLY, (uint32_t)queue[head++], &kids);
    for (int k = 0; k < n; k++) {
      if (kids[k] <= 0) continue;
      consider(kids[k], 1);
      if (tail < 1024) queue[tail++] = kids[k];
    }
    free(kids);
  }
}

static void scan_all(void) {
  pid_t *all = NULL;
  int n = list(PROC_UID_ONLY, (uint32_t)getuid(), &all);
  for (int k = 0; k < n; k++) consider(all[k], 0);
  free(all);
}

/* A helper gone without its NOTE_EXIT reaching the watcher: its exit is reported as late. */
static void check_gone(void) {
  for (int i = 0; i < ntracked; i++) {
    if (exited[i]) continue;
    struct proc_bsdinfo bi;
    if (proc_pidinfo(tracked[i], PROC_PIDTBSDINFO, 0, &bi, sizeof bi) != (int)sizeof bi || bi.pbi_status == SZOMB) report_exit(i, now_ms(), "late");
  }
}

int main(int argc, char **argv) {
  if (argc != 4) { fprintf(stderr, "usage: watch <hub pid> <helper path> <helper name>\n"); return 2; }
  hub = (pid_t)atoi(argv[1]);
  want_path = argv[2];
  want_name = argv[3];
  kq = kqueue();
  if (kq < 0) { perror("kqueue"); return 1; }
  struct kevent in;
  EV_SET(&in, 0, EVFILT_READ, EV_ADD, 0, 0, NULL);
  if (kevent(kq, &in, 1, NULL, 0, NULL) < 0) { perror("kevent stdin"); return 1; }
  scan_descendants();
  scan_all();
  printf("ready %.3f\n", now_ms());
  fflush(stdout);
  double last_all = now_ms();
  for (;;) {
    struct kevent got[16];
    struct timespec wait = { 0, 5 * 1000 * 1000 };
    int n = kevent(kq, NULL, 0, got, 16, &wait);
    double woke = now_ms();
    for (int e = 0; e < n; e++) {
      if (got[e].filter == EVFILT_READ) {
        char b[256];
        if (read(0, b, sizeof b) <= 0) return 0;
      } else if (got[e].filter == EVFILT_PROC && (got[e].fflags & NOTE_EXIT)) {
        for (int i = 0; i < ntracked; i++) if (tracked[i] == (pid_t)got[e].ident) report_exit(i, woke, "woke");
      }
    }
    scan_descendants();
    if (woke - last_all >= 250) { scan_all(); last_all = woke; }
    check_gone();
  }
}
`;

/** The watcher, built with cc into a temp folder of this suite. */
function buildWatcher(): string {
  const dir = tempDir();
  const bin = join(dir, 'watch');
  writeFileSync(join(dir, 'watch.c'), WATCH_C);
  try {
    execFileSync('cc', ['-O2', '-o', bin, join(dir, 'watch.c')], { stdio: 'pipe' });
  } catch (error) {
    throw Error(`BLOCKED: building the helper watcher with cc failed: ${String((error as { stderr?: Buffer }).stderr ?? error)}`);
  }
  return bin;
}

/** A helper process the watcher saw: its kernel start time (or when first seen), and its exit. */
interface Seen { pid: number; path: string; started: number; exited?: number; how?: string }
interface Watch { helpers: Map<number, Seen>; onStart?: (h: Seen) => void; stop(): Promise<void> }

async function watch(bin: string, hub: Hub, helper: string): Promise<Watch> {
  const child = spawn(bin, [String(hub.pid), helper, basename(helper)], { stdio: ['pipe', 'pipe', 'pipe'] });
  own(child.pid);
  child.stdin.on('error', () => { /* it's gone */ });
  const w: Watch = {
    helpers: new Map(),
    async stop() {
      child.stdin.end();
      for (const deadline = Date.now() + 5000; child.exitCode === null && child.signalCode === null && Date.now() < deadline;) await sleep(50);
      if (child.exitCode === null && child.signalCode === null) try { process.kill(child.pid!, 'SIGKILL'); } catch { /* gone */ }
    },
  };
  let err = '';
  child.stderr.setEncoding('utf8').on('data', (d: string) => (err = (err + d).slice(-4096)));
  const started = await new Promise<boolean>((resolve) => {
    const timer = setTimeout(() => resolve(false), 2 * MINUTE);
    child.on('exit', () => { clearTimeout(timer); resolve(false); });
    const line = (l: string): void => {
      const f = l.split(' ');
      if (f[0] === 'ready') { clearTimeout(timer); resolve(true); }
      if (f[0] === 'start') {
        const h: Seen = { pid: Number(f[1]), started: Number(f[2]) > 0 ? Number(f[2]) : Number(f[3]), path: f.slice(4).join(' ') };
        w.helpers.set(h.pid, h);
        w.onStart?.(h);
      }
      if (f[0] === 'exit') {
        const h = w.helpers.get(Number(f[1]));
        if (h && h.exited === undefined) Object.assign(h, { exited: Number(f[2]), how: f[3] });
      }
    };
    // Lines are short; a partial line longer than any the watcher prints is dropped, so this buffer stays small.
    let pending = '';
    child.stdout.setEncoding('utf8').on('data', (d: string) => {
      pending += d;
      for (let nl = pending.indexOf('\n'); nl >= 0; nl = pending.indexOf('\n')) {
        line(pending.slice(0, nl));
        pending = pending.slice(nl + 1);
      }
      if (pending.length > 8192) pending = '';
    });
  });
  if (!started) {
    await w.stop();
    throw Error(`BLOCKED: the helper watcher didn't start: ${err}`);
  }
  return w;
}

interface Answered { r: Ran; since: number; helpers: Seen[] }
/**
 * `deep inbox answer <ask> approve` with the helper watched: `tell` is said when the hub starts deep-confirm, which
 * shows Touch ID. It waits for you for up to PERSON_MS, then a little for the helper's exit to be reported.
 */
async function answer(rig: Rig, hub: Hub, bin: string, ask: string, tell: string): Promise<Answered> {
  const w = await watch(bin, hub, realpathSync(rig.helper));
  try {
    const since = Date.now();
    let told = false;
    w.onStart = () => { if (!told) { told = true; say(tell); } };
    const nag = setInterval(() => { if (!told) say(`>>> still waiting for the hub to start deep-confirm and show Touch ID for ${ask} (${Math.round((Date.now() - since) / 1000)} s); don't touch anything yet`); }, 30_000);
    const r = await run(NODE, [rig.cli, 'inbox', 'answer', ask, 'approve'], { env: childEnv(rig), cwd: rig.tmp, timeoutMs: PERSON_MS }).finally(() => clearInterval(nag));
    const mine = () => [...w.helpers.values()].filter((h) => h.started >= since - 1000);
    for (const deadline = Date.now() + 5000; mine().some((h) => h.exited === undefined) && Date.now() < deadline;) await sleep(50);
    return { r, since, helpers: mine() };
  } finally {
    await w.stop();
  }
}

const iso = (t: number | undefined): string => (t === undefined || !Number.isFinite(t) ? 'never' : new Date(t).toISOString());

test('#880.e0afc5f5 on the reference Mac, Touch ID accepted counts the answer within 2 s of the touch; cancelled leaves the ask open with "the prompt was cancelled"', async (ctx) => {
  if (process.env[OPT_IN] !== '1') ctx.skip(`INCONCLUSIVE: a manual run on the reference Mac; a person sets ${OPT_IN}=1, records the screen, and touches or cancels when told (redraft/README.md)`);
  const problem = notReference();
  if (problem) ctx.skip(`INCONCLUSIVE: ${problem}`);

  const bin = buildWatcher();
  say('>>> Setting up a test home with the real deep-confirm (a minute or more on a busy Mac). Touch nothing until told.');
  const { rig, hub, asks: [accept, cancel] } = await ready(['release v1', 'release v2'], { realHelper: true });

  // Touch ID accepted.
  say(`>>> Step 1 of 2: answering ${accept}. Touch nothing until this terminal says TOUCH.`);
  const a = await answer(rig, hub, bin, accept!, `>>> ${iso(Date.now())} Touch ID is opening for ${accept}: TOUCH THE SENSOR to accept, as soon as the panel shows.`);
  expect(a.helpers.length, `the hub ran deep-confirm (${rig.helper}) to answer ${accept}, which showed Touch ID: ${shown(a.r)}`).toBeGreaterThan(0);
  expect(a.r.code, `Touch ID accepted: deep inbox answer ${accept} approve exits 0: ${shown(a.r)}; hub stderr ${JSON.stringify(hub.stderr().slice(-1500))}`).toBe(0);
  await expectCountedOnce(hub, accept!, 'approve', 'Touch ID accepted');

  const ran = a.helpers.filter((h) => h.exited !== undefined).sort((x, y) => x.exited! - y.exited!);
  const touched = ran[ran.length - 1];
  if (!touched) throw Error(`INCONCLUSIVE: deep-confirm (pids ${a.helpers.map((h) => h.pid).join(', ')}) was still running 5 s after deep inbox answer exited, so its exit can't mark the touch; the screen capture decides the 2 s`);
  const recorded = (await events(hub)).find((e) => e.kind === 'ask.answered' && e.subject === accept) as { ts?: unknown } | undefined;
  const ts = Number(recorded?.ts);
  // The hub's own timestamp for the count, when it is one: not before it could have read the helper's reply.
  const hubCount = Number.isFinite(ts) && ts >= touched.exited! - READ_BEFORE_EXIT_MS && ts <= a.r.end + 50 ? ts : undefined;
  const counted = hubCount ?? a.r.end;
  const afterTouch = Math.round(counted - touched.exited!);
  say([
    `>>> Touch ID shown (deep-confirm ${touched.pid} started)  ${iso(touched.started)}`,
    `>>> touch taken (deep-confirm exited, ${touched.how})        ${iso(touched.exited)}`,
    `>>> hub recorded ask.answered                         ${iso(Number.isFinite(ts) ? ts : undefined)}${hubCount === undefined ? ' (not used: outside the answer)' : ''}`,
    `>>> deep inbox answer exited                          ${iso(a.r.end)}`,
    `>>> touch to counted: ${afterTouch} ms (limit ${TOUCH_TO_COUNT_MS} ms), measured to ${hubCount === undefined ? "the command's exit" : "the hub's record"}`,
  ].join('\n'));
  expect(afterTouch, `the answer counted ${afterTouch} ms after deep-confirm took the touch and exited; within ${TOUCH_TO_COUNT_MS} ms`).toBeLessThanOrEqual(TOUCH_TO_COUNT_MS);

  // Touch ID cancelled.
  say(`>>> Step 2 of 2: answering ${cancel}. Do not touch the sensor.`);
  const c = await answer(rig, hub, bin, cancel!, `>>> ${iso(Date.now())} Touch ID is opening for ${cancel}: press CANCEL on the panel as soon as it shows. Do not touch the sensor.`);
  say(`>>> deep inbox answer ${cancel} exited ${c.r.code} at ${iso(c.r.end)}: ${JSON.stringify(`${c.r.stdout}${c.r.stderr}`.trim().slice(0, 300))}`);
  expect(c.helpers.length, `the hub ran deep-confirm (${rig.helper}) to answer ${cancel}, which showed the Touch ID you cancelled: ${shown(c.r)}`).toBeGreaterThan(0);
  expect(c.r.code, `Touch ID cancelled: deep inbox answer ${cancel} approve exits 3: ${shown(c.r)}`).toBe(3);
  expect(`${c.r.stdout}\n${c.r.stderr}`, `Touch ID cancelled: the refusal says "the prompt was cancelled": ${shown(c.r)}`).toContain('the prompt was cancelled');
  await expectOpen(hub, cancel!, 'Touch ID cancelled');
  say('>>> Done. Stop the screen recording.');
}, 2 * PERSON_MS + 10 * MINUTE);

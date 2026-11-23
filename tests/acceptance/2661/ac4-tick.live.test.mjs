// AC4: an idle app with a quiet hub blocks its UI thread for under 1 ms a tick, read from the tick's own timer, and an
// event that arrives is applied within one tick plus one frame, as #1546 holds it. A planted tick that stops reading
// fails, naming the event it never applied.
//
// By hand only, on a Mac with a display (it shows a real window), never in CI:
//   DEEP_LIVE_2661=1 node --test tests/acceptance/2661/ac4-tick.live.test.mjs      (cargo on PATH)
//
// As #1546 holds it (tests/acceptance/1546, criterion 4): `deep-live --view needs-you --out <file> --watch` is the real
// app window on a hub's record, read through the app's one record reader on its tick; it sends no input, forces no
// frame, and writes a line per frame it draws with every name under Needs you. Here the hub is a stand-in on the
// window's socket ($HOME/.deepbuild/hub.sock, a home of the test's own): it answers the reads at connect with an empty
// record and then stays quiet, until the test sends an `ask.created` on the subscription. An event's delay is from the
// moment the stand-in wrote it to the `at` of the first frame whose Needs you names its question: within the reader's
// tick (250 ms, record::TICK) plus one 60 Hz frame. A miss with the load average above the core count reads
// INCONCLUSIVE, never a pass.
//
// The blocked time is NOT read from the tick's own timer: the base has no such timer and the issue names no place it
// is read (README, Open points). The test reads the UI thread from outside instead: macOS's `sample` takes the window's
// main thread every millisecond for 10 s of a quiet hub, and the samples it finds waiting in a socket receive
// (`__recvfrom`) are its blocked milliseconds, divided by the 40 ticks of those 10 s.
//
// The plant: `DEEP_HUB_PLANT=tick-stops-reading`, read only in a build with the env-plants feature (#1408): the tick
// stops reading the hub. The implementer adds it (README, The planted tick). This file's judge must fail it, naming
// the event it never applied; at the base the name selects nothing.
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { cpus, loadavg } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import { after, describe, test } from 'node:test';
import assert from 'node:assert/strict';

const REPO = fileURLToPath(new URL('../../../', import.meta.url));
const LIVE = join(process.env.CARGO_TARGET_DIR ?? join(REPO, 'target'), 'debug', 'deep-live');
const OPTED = process.env.DEEP_LIVE_2661 === '1';
const TICK_MS = 250;
const FRAME_MS = 1000 / 60;
export const BOUND_MS = TICK_MS + FRAME_MS;
const BLOCKED_MS = 1;
const SAMPLE_S = 10;
const PLANT = 'tick-stops-reading';
const START = '01KB2661LIVESTART000000001';
// The methods the app calls, which its hello check needs listed (crates/deep-app/src/hub.rs, NEEDS).
const NEEDS = ['inbox.read', 'stream.subscribe', 'events.read', 'notifications.report', 'views.shown', 'views.hidden', 'row.read', 'canvas.drawn', 'canvas.user'];

const owned = [];
const homes = [];
after(() => {
  for (const pid of owned) try { process.kill(pid, 'SIGTERM'); } catch {}
  for (const home of homes) rmSync(home, { recursive: true, force: true });
});

/**
 * The judge: each event sent, with when it was sent, against the frames the window drew. An event is applied when a
 * frame drawn after it names its question under Needs you; one never drawn, or drawn later than the bound, fails,
 * named by its kind, its ID and its question.
 */
export function judge(sent, frames, bound = BOUND_MS) {
  const failures = [];
  const delays = [];
  for (const event of sent) {
    const question = event.data.question;
    const shown = frames.find((f) => f.at >= event.sentAt && (f.names ?? []).some((n) => n.includes(question)));
    if (!shown) {
      failures.push(`${event.kind} ${event.id} ("${question}") was never applied: no frame drawn after it names it`);
      continue;
    }
    const ms = shown.at - event.sentAt;
    delays.push(ms);
    if (ms > bound) failures.push(`${event.kind} ${event.id} ("${question}") was applied ${ms} ms after it arrived, past ${bound.toFixed(1)} ms`);
  }
  return { status: failures.length ? 'FAIL' : 'PASS', failures, delays };
}

/** A stand-in hub on `socket`: the reads at connect answer an empty record; `send` appends an event and streams it. */
function standIn(socket, token) {
  const log = [];
  const subscribers = [];
  const server = createServer((conn) => {
    let buffer = '';
    let hello = false;
    const write = (line) => conn.write(`${JSON.stringify(line)}\n`);
    write({ v: 1, hello: 'deep-hub', start: START, contract: '1.0', features: NEEDS });
    conn.setEncoding('utf8').on('data', (data) => {
      buffer += data;
      for (let i = buffer.indexOf('\n'); i >= 0; i = buffer.indexOf('\n')) {
        const line = buffer.slice(0, i);
        buffer = buffer.slice(i + 1);
        let call;
        try { call = JSON.parse(line); } catch { continue; }
        if (!hello) {
          hello = true;
          if (call.hello !== 'app' || call.token !== token) return write({ v: 1, id: null, error: { code: 'credential', retryable: false } });
          write({ v: 1, role: 'app' });
          continue;
        }
        const end = log.length;
        const result = {
          'inbox.read': () => ({ start: START, log_pos: end, asks: [] }),
          'events.read': () => ({ start: START, log_pos: end, events: log.filter((e) => e.log_pos > (call.params?.after ?? 0)).slice(0, call.params?.limit ?? 1000) }),
          'stream.subscribe': () => {
            subscribers.push({ conn, id: call.id });
            return { subscribed: true, after: call.params?.after ?? end, start: START };
          },
        }[call.method]?.() ?? {};
        write({ v: 1, id: call.id, result });
      }
    });
    conn.on('error', () => {});
  });
  server.listen(socket);
  return {
    subscribed: () => subscribers.length > 0,
    close: () => server.close(),
    /** Appends an ask.created and writes it to every subscriber; answers the event with when it was written. */
    send(n) {
      const event = {
        v: 1, id: `01KB2661LIVEASK00000000${String(n).padStart(3, '0')}`, kind: 'ask.created', writer: 'core', actor: 'you', scope: 'you',
        session: '01KB2661LIVESESS000000001', ts: Date.now(), log_pos: log.length + 1,
        data: { kind: 'taste', question: `Live 2661 ask ${n}: which header colour, ${Date.now()}?`, options: [{ id: 'blue', label: 'Blue header', decision: 'none' }, { id: 'green', label: 'Green header', decision: 'none' }], recommended: 'blue', default: 'blue', deadline: Date.now() + 86_400_000, owner: 'you' },
      };
      log.push(event);
      for (const { conn, id } of subscribers) conn.write(`${JSON.stringify({ v: 1, id, event })}\n`);
      return { ...event, sentAt: Date.now() };
    },
  };
}

function buildLive() {
  const r = spawnSync('cargo', ['build', '--locked', '-p', 'deep-replica', '--bin', 'deep-live', '--features', 'env-plants'], { cwd: REPO, encoding: 'utf8', timeout: 7_200_000, maxBuffer: 256 * 1024 * 1024 });
  if (r.status !== 0 || !existsSync(LIVE)) assert.fail(`BLOCKED: deep-live can't be built: ${r.error?.message ?? ''}${(r.stderr ?? '').split('\n').filter((l) => /^error/.test(l)).slice(0, 6).join('\n')}`);
}

/** A home of the test's own, set up, with the stand-in on its socket, and deep-live --watch on it. */
async function liveWindow(plant) {
  const home = `/tmp/da2661-live-${process.pid}-${homes.length}`;
  homes.push(home);
  rmSync(home, { recursive: true, force: true });
  mkdirSync(join(home, '.deepbuild'), { recursive: true });
  const token = `stand-in-token-${process.pid}`;
  writeFileSync(join(home, '.deepbuild', 'control.token'), `${token}\n`);
  writeFileSync(join(home, '.deepbuild', 'setup-finished.json'), '{}\n');
  const hub = standIn(join(home, '.deepbuild', 'hub.sock'), token);
  const out = join(home, 'needs-you.watch.jsonl');
  const env = { ...process.env, HOME: home, ...(plant ? { DEEP_HUB_PLANT: plant } : {}) };
  for (const key of Object.keys(env)) if (/^GIT_/.test(key)) delete env[key];
  const child = spawn(LIVE, ['--view', 'needs-you', '--out', out, '--watch'], { cwd: REPO, env, stdio: ['ignore', 'ignore', 'pipe'] });
  owned.push(child.pid);
  let stderr = '';
  child.stderr.setEncoding('utf8').on('data', (d) => (stderr += d));
  const lines = () => (existsSync(out) ? readFileSync(out, 'utf8') : '').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return {}; } });
  const readyBy = Date.now() + 60_000;
  while (!lines().some((l) => l.ready === true) && Date.now() < readyBy && child.exitCode === null) await sleep(50);
  return {
    hub, child, home,
    ready: lines().some((l) => l.ready === true),
    frames: () => lines().filter((l) => typeof l.frame === 'number'),
    stderr: () => stderr,
    stop() { try { process.kill(child.pid, 'SIGTERM'); } catch {} hub.close(); },
  };
}

/** The window's main thread, sampled every millisecond for `seconds`: the samples it spent in a socket receive. */
function blockedSamples(pid, seconds, file) {
  const r = spawnSync('/usr/bin/sample', [String(pid), String(seconds), '1', '-mayDie', '-file', file], { encoding: 'utf8', timeout: (seconds + 60) * 1000 });
  if (r.status !== 0 || !existsSync(file)) return { error: `sample exited ${r.status}: ${(r.stderr || r.stdout || r.error?.message || '').slice(0, 400)}` };
  const text = readFileSync(file, 'utf8');
  const graph = text.split('\nCall graph:\n')[1] ?? '';
  // The main thread's section runs from its header to the next thread's.
  const threads = graph.split(/\n(?=\s{4}\d+ Thread_)/);
  const main = threads.find((t) => /com\.apple\.main-thread/.test(t.split('\n')[0]));
  if (!main) return { error: `sample's report names no main thread:\n${graph.slice(0, 600)}` };
  const total = Number(main.match(/^\s*(\d+) Thread_/)?.[1]);
  const inRecv = [...main.matchAll(/^[\s+!:|]*(\d+) __recvfrom /gm)].reduce((sum, [, n]) => sum + Number(n), 0);
  return { total, inRecv };
}

describe('#2661 AC4 the tick on a quiet hub, as #1546 holds it', { skip: !OPTED && 'by hand only: DEEP_LIVE_2661=1' }, () => {
  test('an idle app with a quiet hub blocks its UI thread under 1 ms a tick, and an event that arrives is applied within one tick plus one frame', { timeout: 7_800_000 }, async () => {
    if (process.platform !== 'darwin') assert.fail('INCONCLUSIVE: the app runs on macOS; this needs its window');
    buildLive();
    const live = await liveWindow(null);
    try {
      if (!live.hub.subscribed()) assert.fail(`BLOCKED: deep-live --watch never reached the stand-in hub in 60 s: ${live.stderr().slice(-1200)}`);
      const failures = [];

      // Idle, the hub quiet: the main thread's time in a socket receive, per tick.
      await sleep(1000);
      const sampled = blockedSamples(live.child.pid, SAMPLE_S, join(live.home, 'sample.txt'));
      if (sampled.error) assert.fail(`BLOCKED: the UI thread can't be sampled: ${sampled.error}`);
      // The samples' share of the 10 s, over its ticks: a loaded Mac takes fewer than one sample a millisecond.
      const ticks = (SAMPLE_S * 1000) / TICK_MS;
      const perTick = (sampled.inRecv / sampled.total) * SAMPLE_S * 1000 / ticks;
      if (!(perTick < BLOCKED_MS)) failures.push(`idle with a quiet hub, the UI thread waited in a socket receive in ${sampled.inRecv} of ${sampled.total} samples over ${SAMPLE_S} s: ${perTick.toFixed(2)} ms a tick, not under ${BLOCKED_MS} ms`);

      if (!live.ready) assert.fail(`${failures.length ? `FAIL: ${failures.join("; ")}; and ` : ""}BLOCKED: the window drew no frame in 60 s though its reader subscribed (a locked screen or a sleeping display draws none), so no event can be judged`);

      // Three events, each applied within the tick plus a frame.
      const sent = [];
      for (let n = 1; n <= 3; n++) {
        sent.push(live.hub.send(n));
        await sleep(900);
      }
      await sleep(2000);
      const judged = judge(sent, live.frames());
      if (judged.status !== 'PASS') {
        const late = judged.failures.every((f) => / past /.test(f));
        if (late && loadavg()[0] > cpus().length) assert.fail(`INCONCLUSIVE: ${judged.failures.join('; ')}, with the load average at ${loadavg()[0].toFixed(1)} on ${cpus().length} cores; this is not a pass`);
        failures.push(...judged.failures);
      }
      console.log(`blocked ${perTick.toFixed(2)} ms a tick (${sampled.inRecv} of ${sampled.total} samples); events applied after ${judged.delays.join(', ')} ms`);
      assert.deepEqual(failures, [], `FAIL: ${failures.join('; ')}`);
    } finally {
      live.stop();
    }
  });

  test('a planted tick that stops reading fails, naming the event it never applied', { timeout: 7_800_000 }, async () => {
    if (process.platform !== 'darwin') assert.fail('INCONCLUSIVE: the app runs on macOS; this needs its window');
    buildLive();
    const live = await liveWindow(PLANT);
    try {
      const deadline = Date.now() + 30_000;
      while (!live.hub.subscribed() && Date.now() < deadline) await sleep(50);
      if (!live.ready) assert.fail("BLOCKED: the planted window drew no frame on the stand-in hub (" + (live.hub.subscribed() ? "its reader subscribed" : "no reader subscribed") + "), so whether its tick applies an event can not be seen; the plant reads until the window is ready, then stops");
      const event = live.hub.send(1);
      await sleep(5000);
      const judged = judge([event], live.frames());
      assert.equal(judged.status, 'FAIL', `the planted tick (${PLANT}) applied ${event.kind} ${event.id} ("${event.data.question}") after ${judged.delays.join(', ')} ms: no plant stopped the tick's reads`);
      assert.match(judged.failures.join('; '), new RegExp(`${event.id}.*never applied`), `the judge names the event the planted tick never applied: ${judged.failures.join('; ')}`);
    } finally {
      live.stop();
    }
  });
});

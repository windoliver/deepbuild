// #315 AC7, blind redraft (AC7-REDRAFT.md). Two hooks of one session, deep-hook's clock fixed by the test to the
// same nanosecond (DEEP_HOOK_TEST_CLOCK_NS, README, Test-only settings): both carry that stamp as `seq`, get two
// different ULIDs, and are two events in the record, each recorded with that stamp. Once with the hub up (the
// requests read through a forwarder), once with the hub stopped (the requests read from the spool, recorded when
// the hub starts). The first draft's check compared both halves with the hub-up half's stamp; here the stamp each
// half fixed is the one its check expects, and each half is a test of its own so each shows its own result.
import { afterEach, describe, expect, it } from 'vitest';
import {
  bash, buildDeepHook, cleanup, forwarder, hook, jsonLines, makeHome, newSession, readSpool, setAddress, settleEvents,
  startHub, stopHub, tempDir, ULID, type Ev, type Line,
} from './helpers.ts';

afterEach(cleanup, 60_000);

const STAMP_A = '1760013451123456789';
const STAMP_B = '1760013451123456790';
const clock = (ns: string) => ({ DEEP_HOOK_TEST_CLOCK_NS: ns });

/** The two requests carry `stamp`, have two different ULIDs, and each is one event in the record, stamped `stamp`. */
function check(requests: Line[], events: Ev[], stamp: string, how: string): void {
  expect(requests.map((l) => l.seq), `${how}: both requests carry the fixed stamp ${stamp}`).toEqual([stamp, stamp]);
  const [x, y] = requests.map((l) => l.id as string);
  expect(ULID.test(x ?? '') && ULID.test(y ?? ''), `${how}: each has a ULID (${x}, ${y})`).toBe(true);
  expect(x, `${how}: the two IDs differ`).not.toBe(y);
  for (const id of [x, y]) {
    const e = events.filter((ev) => ev.id === id);
    expect(e.length, `${how}: ${id} is in the record once`).toBe(1);
    expect(e[0]!.seq, `${how}: ${id} recorded with the fixed stamp ${stamp}`).toBe(stamp);
  }
}

describe('AC7 #315.2a5a4d2b two hooks of one session with the clock fixed to the same nanosecond get different IDs, and both are in the record (redraft)', () => {
  it('AC7 hub up: two PreToolUse hooks of one session stamped …789 carry that stamp, two different IDs, and are two events stamped …789', async () => {
    const binary = await buildDeepHook();
    const home = makeHome();
    const s = newSession(home);
    const hub = await startHub({ home });
    const f = await forwarder(tempDir(), hub.socket);
    setAddress(home, `unix:${f.path}`);
    for (let i = 0; i < 2; i++) {
      const r = await hook(home, s, 'PreToolUse', bash(s, 'ls'), { binary, env: clock(STAMP_A) });
      expect(r.code, `hook ${i + 1} with the hub up: ${r.stderr}`).toBe(0);
    }
    await f.close();
    const sent = jsonLines(f.upText()).filter((l) => l.event === 'PreToolUse' && l.payload?.session_id === s.id);
    const events = await settleEvents(hub, (all) => sent.every((l) => all.some((e) => e.id === l.id)));
    await stopHub(hub);
    check(sent, events, STAMP_A, 'hub up');
  }, 300_000);

  it('AC7 hub stopped, then started: two PreToolUse hooks of one session stamped …790 are spooled with that stamp and two different IDs, and are two events stamped …790', async () => {
    const binary = await buildDeepHook();
    const home = makeHome();
    const s = newSession(home);
    // The hub has run once and is stopped.
    let hub = await startHub({ home });
    await stopHub(hub);
    for (let i = 0; i < 2; i++) {
      const r = await hook(home, s, 'PreToolUse', bash(s, 'ls'), { binary, env: clock(STAMP_B) });
      expect(r.code, `hook ${i + 1} with the hub stopped: ${r.stderr}`).toBe(0);
    }
    const spooled = readSpool(home).requests.map((r) => r.json).filter((l) => l.event === 'PreToolUse' && l.payload?.session_id === s.id);
    hub = await startHub({ home });
    const events = await settleEvents(hub, (all) => spooled.every((l) => all.some((e) => e.id === l.id)));
    await stopHub(hub);
    check(spooled, events, STAMP_B, 'hub stopped, then started');
  }, 300_000);
});

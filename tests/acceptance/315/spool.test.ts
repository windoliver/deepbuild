// #315 AC4, AC6 and AC7: the spool while the hub is down and the stamps on every event. Hooks run with the hub
// stopped are in the record once it starts, in the order they ran, none lost. deep-hook's clock is fixed by the
// test through DEEP_HOOK_TEST_CLOCK_NS (README, Test-only settings), so the stamps are known: they are spooled as
// those exact strings, recorded as them in order, a spool replayed twice appends nothing, and two hooks stamped
// the same nanosecond still get two IDs and two events.
import { copyFileSync, mkdirSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  bash, buildDeepHook, cleanup, forwarder, hook, jsonLines, makeHome, newSession, payload, readSpool, rootOf, setAddress, settleEvents,
  spoolText, startHub, stopHub, tempDir, ULID, type Ev, type Line, type Session,
} from './helpers.ts';

afterEach(cleanup, 60_000);

const STAMP_A = '1760013451123456789';
const STAMP_B = '1760013451123456790';
const clock = (ns: string) => ({ DEEP_HOOK_TEST_CLOCK_NS: ns });

describe('AC4 #315.bf6d3707 events from hooks that ran while the hub was stopped are in the record after it starts, in order, with none lost', () => {
  it('AC4 two sessions\' hooks, run one after another with the hub stopped mid-session, are each in the record once, in the order they ran, after the turn the hub saw', async () => {
    const binary = await buildDeepHook();
    const home = makeHome();
    let hub = await startHub({ home });
    const a = newSession(home);
    const b = newSession(home);
    // Each hook's JSON carries a mark of its own (its tool_use_id, or a marker field), so its request can be found.
    const marked = (s: Session, event: string) => (event.endsWith('ToolUse') ? payload(s, event) : payload(s, event, { marker: `${event}-${Math.random().toString(36).slice(2)}` }));
    // Turn 1 of session a reaches the hub.
    for (const event of ['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'Stop']) {
      const r = await hook(home, a, event, marked(a, event), { binary });
      expect(r.code, `turn 1 ${event}: ${r.stderr}`).toBe(0);
    }
    const before = await settleEvents(hub, (all) => all.filter((e) => e.writer === 'hook').length >= 5);
    const seen = new Set(before.map((e) => e.id));
    await stopHub(hub);

    // With the hub stopped: turn 2 of a, and session b, interleaved, one hook after another.
    const ran: string[] = [];
    const steps: [Session, string][] = [
      [a, 'UserPromptSubmit'], [b, 'SessionStart'], [a, 'PreToolUse'], [b, 'UserPromptSubmit'], [a, 'PostToolUse'], [a, 'PreToolUse'],
      [b, 'PreToolUse'], [a, 'PostToolUse'], [b, 'PostToolUse'], [a, 'Stop'], [b, 'Stop'],
    ];
    for (const [s, event] of steps) {
      const body = marked(s, event);
      ran.push((body.tool_use_id ?? body.marker) as string);
      const r = await hook(home, s, event, body, { binary });
      expect(r.code, `${event} with the hub stopped: ${r.stderr}`).toBe(0);
    }
    const spooled = readSpool(home).requests;
    const idOf = (mark: string) => spooled.find((r) => (r.json.payload?.tool_use_id ?? r.json.payload?.marker) === mark)?.json.id as string | undefined;
    const ids = ran.map(idOf);
    expect(ids.every((id) => typeof id === 'string'), `every hook run with the hub stopped is in the spool: ${JSON.stringify(ids)}`).toBe(true);

    hub = await startHub({ home });
    const after = await settleEvents(hub, (all) => ids.every((id) => all.some((e) => e.id === id)));
    await stopHub(hub);
    const lost = ids.filter((id) => !after.some((e) => e.id === id));
    expect(lost, `events lost: the first is ${lost[0]}`).toEqual([]);
    for (const id of ids) expect(after.filter((e) => e.id === id).length, `${id} is in the record once`).toBe(1);
    const order = ids.map((id) => after.find((e) => e.id === id)!.log_pos);
    expect(order, 'in the record in the order the hooks ran (log_pos)').toEqual([...order].sort((x, y) => x - y));
    const seqs = ids.map((id) => BigInt(after.find((e) => e.id === id)!.seq ?? '0'));
    expect(seqs.every((seq, i) => i === 0 || seq > seqs[i - 1]!), 'their stamps rise in the order the hooks ran').toBe(true);
    const lastSeen = Math.max(...after.filter((e) => seen.has(e.id)).map((e) => e.log_pos));
    expect(order.every((pos) => pos > lastSeen), 'after the turn the hub saw before it stopped').toBe(true);
  }, 300_000);
});

describe('AC6 #315.8366a61c with the clock fixed, hooks stamped …789 and …790 are spooled with those exact strings and recorded in that order; replaying the spool again appends nothing', () => {
  it('AC6 the two stamps, spooled, recorded as two events in order, and the same spool put back and replayed appends nothing', async () => {
    const binary = await buildDeepHook();
    const home = makeHome();
    const s = newSession(home);
    // The hub has run once and is stopped.
    let hub = await startHub({ home });
    await stopHub(hub);
    for (const stamp of [STAMP_A, STAMP_B]) {
      const r = await hook(home, s, 'PreToolUse', bash(s, 'ls'), { binary, env: clock(stamp) });
      expect(r.code, r.stderr).toBe(0);
    }
    const text = spoolText(home);
    for (const stamp of [STAMP_A, STAMP_B]) expect(text, `the spool holds "seq":"${stamp}" as written`).toContain(`"seq":"${stamp}"`);
    const requests = readSpool(home).requests.map((r) => r.json);
    const idA = requests.find((l) => l.seq === STAMP_A)?.id as string;
    const idB = requests.find((l) => l.seq === STAMP_B)?.id as string;
    expect([idA, idB].every((id) => ULID.test(id ?? '')), 'each spooled request has its ULID').toBe(true);
    const saved = join(tempDir(), 'saved-spool');
    mkdirSync(saved);
    for (const name of readSpool(home).files) copyFileSync(join(rootOf(home), 'spool', name), join(saved, name));

    hub = await startHub({ home });
    const first = await settleEvents(hub, (all) => [idA, idB].every((id) => all.some((e) => e.id === id)));
    await stopHub(hub);
    const a = first.filter((e) => e.id === idA);
    const b = first.filter((e) => e.id === idB);
    expect([a.length, b.length], 'two events, one for each stamp').toEqual([1, 1]);
    expect([a[0]!.seq, b[0]!.seq], 'recorded with those exact stamps').toEqual([STAMP_A, STAMP_B]);
    expect(a[0]!.log_pos < b[0]!.log_pos, `…789 before …790 in the record (log_pos ${a[0]!.log_pos}, ${b[0]!.log_pos})`).toBe(true);

    // The same spool again.
    mkdirSync(join(rootOf(home), 'spool'), { recursive: true });
    for (const name of readdirSync(saved)) copyFileSync(join(saved, name), join(rootOf(home), 'spool', name));
    hub = await startHub({ home });
    const again = await settleEvents(hub, () => false, { quietMs: 5000 });
    await stopHub(hub);
    const added = again.filter((e) => e.writer !== 'core' && !first.some((f) => f.id === e.id));
    expect(added.map((e) => `${e.kind} ${e.id} seq ${e.seq}`), 'replaying the same spool again appends nothing').toEqual([]);
    expect([again.filter((e) => e.id === idA).length, again.filter((e) => e.id === idB).length], 'each ID still once').toEqual([1, 1]);
  }, 300_000);
});

describe('AC7 #315.2a5a4d2b two hooks of one session with the clock fixed to the same nanosecond get different IDs, and both are in the record', () => {
  it('AC7 hub up and hub stopped: two hooks stamped the same nanosecond carry that stamp, two different IDs, and are two events', async () => {
    const binary = await buildDeepHook();
    const home = makeHome();
    const s = newSession(home);
    let hub = await startHub({ home });
    const f = await forwarder(tempDir(), hub.socket);
    setAddress(home, `unix:${f.path}`);
    for (let i = 0; i < 2; i++) expect((await hook(home, s, 'PreToolUse', bash(s, 'ls'), { binary, env: clock(STAMP_A) })).code).toBe(0);
    await f.close();
    const up = jsonLines(f.upText()).filter((l) => l.event === 'PreToolUse');
    const check = (requests: Line[], events: Ev[], how: string) => {
      expect(requests.map((l) => l.seq), `${how}: both requests carry the fixed stamp`).toEqual([STAMP_A, STAMP_A]);
      const [x, y] = requests.map((l) => l.id as string);
      expect(ULID.test(x ?? '') && ULID.test(y ?? ''), `${how}: each has a ULID`).toBe(true);
      expect(x, `${how}: the two IDs differ`).not.toBe(y);
      for (const id of [x, y]) {
        const e = events.filter((ev) => ev.id === id);
        expect(e.length, `${how}: ${id} is in the record once`).toBe(1);
        expect(e[0]!.seq, `${how}: ${id} recorded with the fixed stamp`).toBe(STAMP_A);
      }
    };
    let events = await settleEvents(hub, (all) => up.every((l) => all.some((e) => e.id === l.id)));
    check(up, events, 'hub up');
    await stopHub(hub);

    setAddress(home, undefined);
    for (let i = 0; i < 2; i++) expect((await hook(home, s, 'PreToolUse', bash(s, 'ls'), { binary, env: clock(STAMP_B) })).code).toBe(0);
    const spooled = readSpool(home).requests.map((r) => r.json).filter((l) => l.payload?.session_id === s.id);
    hub = await startHub({ home });
    events = await settleEvents(hub, (all) => spooled.every((l) => all.some((e) => e.id === l.id)));
    await stopHub(hub);
    check(spooled, events, 'hub stopped, then started');
  }, 300_000);
});

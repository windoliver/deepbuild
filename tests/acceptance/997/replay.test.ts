// #997 AC1: a session that armed Claude Code's Monitor waits on its watch, not finished. The recorded session (the
// fixture corpus's `monitor` set: a Monitor call, three wakes from its events, a TaskStop of the watch) is replayed
// hook by hook through the real deep-hook into `deep hub run`. After each Stop the session's row (`status.read`) is
// read; each Stop's loop reading is its agent.stop's `data.loop`; the gate's judgements are the core's `claim.made`
// for the session; a notification is a Stop the row reads as handed back to you (README, Open points). The merge
// base's reading is the planted wrong program `DEEP_HUB_PLANT=monitor-unread`, and the same assertions run on a
// made-up twin of the session shaped as the issue describes, so the merge base can be replayed before a recording exists.
import { spawnSync } from 'node:child_process';
import { afterAll, describe, expect, it } from 'vitest';
import { cleanup, failureOf, makeHome, NODE, REPO, startHub, type Line } from '../18/mapping/helpers.ts';
import { AC1, anywhere, judgements, notifications, PLANT, recorded, replay, rowShown, shapeOf, stopsOf, twin, waitsOnMonitor, type Recorded, type Replay } from './helpers.ts';

afterAll(cleanup, 60_000);

const TURN = ['turn 1 (your prompt, which armed the monitor)', 'turn 2 (the monitor\'s first event)', 'turn 3 (its second event)', 'turn 4 (its third event, which stopped the watch)'];

/** Every way the replay differs from what AC1 says, each naming its turn. */
function problems(r: Replay, s: Recorded): string[] {
  const out: string[] = [];
  const shape = shapeOf(s);
  if (r.rows.length !== 4) out.push(`the replay read ${r.rows.length} Stops, not 4`);
  const stops = stopsOf(r);
  for (const [i, { row }] of r.rows.entries()) {
    const loop = stops[i]?.data.loop as Line | undefined;
    if (i < 3) {
      if (!waitsOnMonitor(row)) out.push(`${TURN[i]}: its stop must read waiting on its monitor while the watch runs; the row reads "${rowShown(row)}"`);
      if (loop?.state !== 'looping') out.push(`${TURN[i]}: its stop's loop reading must be looping while the watch runs; it is ${JSON.stringify(loop ?? null)}`);
    } else if (waitsOnMonitor(row)) out.push(`${TURN[i]}: the watch ended at TaskStop, yet the row still reads "${rowShown(row)}"`);
  }
  // The gate judges the claim once, after the watch ends: after TaskStop's PostToolUse is in the record.
  const ended = r.events.find((e) => e.kind === 'tool.after' && e.data.call === shape.taskStop.tool_use_id)?.log_pos ?? Infinity;
  const turnAt = (pos: number) => { const n = stops.filter((e) => e.log_pos < pos).length; return TURN[Math.max(0, Math.min(3, n - 1))]!; };
  const judged = judgements(r);
  const early = judged.filter((e) => e.log_pos < ended);
  if (early.length) out.push(`the gate judged the claim while the watch still ran, at ${early.map((e) => turnAt(e.log_pos)).join(', ')}`);
  if (judged.length - early.length !== 1) out.push(`the gate must judge the claim once after the watch ends; it judged it ${judged.length - early.length} times after TaskStop (${judged.length} in all)`);
  const told = notifications(r);
  if (told.length !== 1 || told[0] !== 4) out.push(`you must be notified once, at ${TURN[3]}; you were notified ${told.length} times, at ${told.map((n) => TURN[n - 1]).join(', ') || 'no turn'}`);
  // A turn a monitor's event started is not yours.
  const wakes = r.events.filter((e) => e.kind === 'user.ask' && String(e.data.text ?? '').includes('<task-notification>'));
  if (wakes.length !== shape.wakes.length) out.push(`the record holds ${wakes.length} of the monitor's ${shape.wakes.length} events as prompts`);
  for (const [i, ask] of wakes.entries()) if (ask.data.from === 'person' || ask.data.from === 'app') out.push(`${TURN[i + 1]}: the monitor's event is recorded as started by you (from: ${String(ask.data.from)})`);
  return out;
}
function holds(r: Replay, s: Recorded, label: string): void {
  console.log(`AC1 ${label}: rows after each stop: ${r.rows.map(({ stop, row }) => `stop ${stop} "${rowShown(row)}"`).join('; ')}; loop readings: ${stopsOf(r).map((e) => JSON.stringify(e.data.loop ?? null)).join(', ')}; judgements: ${judgements(r).length}; notified at stops [${notifications(r).join(', ')}]`);
  const found = problems(r, s);
  expect(found, `${label}: ${found.join('; ')}`).toEqual([]);
}
async function replayed(s: Recorded, plant?: string): Promise<Replay> {
  const hub = await startHub(makeHome(), plant);
  try {
    return await replay(hub, s);
  } finally {
    try { process.kill(hub.pid, 'SIGTERM'); } catch { /* gone */ }
  }
}
function theRecording(): Recorded {
  const s = recorded();
  expect(s, `BLOCKED: no claude-code version the facts cover holds the recorded session adapters/corpus/claude-code/<version>/monitor/ (README, The fixture)${anywhere().length ? `; uncovered versions holding one: ${anywhere().join(', ')}` : ''}`).toBeDefined();
  return s!;
}

describe(`${AC1} Replaying the recorded monitor session, the row reads waiting on its monitor between wakes, the gate judges the claim once after the watch ends, and you are notified once; the merge base reads finished after the first stop, notifies four times, and fails, naming the turns`, () => {
  it(`${AC1} the fixture corpus holds the session: a Monitor call arming a watch, three wakes from its events, a TaskStop of the watch, and its expected events, replaying clean`, () => {
    const s = theRecording();
    expect(s.meta.scenario, `${s.where}/session.json names its scenario`).toBe('monitor');
    const shape = shapeOf(s);
    expect(shape.problems, `${s.where} must hold: ${shape.problems.join('; ')}`).toEqual([]);
    const missing = s.cases.flatMap((c, i) => (Array.isArray(c.expect) ? [] : [`events.jsonl:${i + 1}`]));
    expect(missing, `${s.where}: every recorded payload is stored with the events its adapter must map it to`).toEqual([]);
    const out = spawnSync(NODE, ['scripts/corpus.mjs', 'replay'], { cwd: REPO, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 }).stdout;
    const ref = s.where.replace('adapters/corpus/', '');
    const mine = out.split('\n').flatMap((l) => { try { const v = JSON.parse(l) as Line; return v.session === ref ? [v] : []; } catch { return []; } });
    expect(mine.length, `node scripts/corpus.mjs replay reads ${ref}`).toBeGreaterThan(0);
    const bad = mine.filter((v) => (v.type === 'payload' ? v.result !== 'match' : !v.verified));
    expect(bad.map((v) => JSON.stringify(v).slice(0, 400)), `${ref} replays clean`).toEqual([]);
  }, 120_000);

  it(`${AC1} the recorded session, replayed through deep-hook into the hub: waiting on its monitor at each stop before the watch ends, one judgement after it, one notification`, async () => {
    const s = theRecording();
    holds(await replayed(s), s, `the recorded session ${s.where}`);
  }, 300_000);

  it(`${AC1} (the merge base's reading) a hub that reads loop facts without Monitor (DEEP_HUB_PLANT=${PLANT}) reads finished after the first stop, notifies four times, and fails this test, naming the turns`, async () => {
    const s = theRecording();
    const r = await replayed(s, PLANT);
    const failure = await failureOf(() => holds(r, s, `the recorded session under ${PLANT}`));
    expect(failure, 'the merge base\'s reading must fail AC1').not.toBeNull();
    expect(r.rows[0]?.row?.state, `the merge base reads ${TURN[0]} as finished`).toBe('finished');
    expect(failure, 'the failure counts four notifications').toContain('notified 4 times');
    for (const turn of TURN.slice(0, 3)) expect(failure, `the failure names ${turn}`).toContain(turn);
  }, 300_000);

  it(`${AC1} the session as the issue describes it (the made-up twin, README), replayed into the hub: the same readings`, async () => {
    const s = twin();
    expect(shapeOf(s).problems, 'the twin holds what the issue describes').toEqual([]);
    holds(await replayed(s), s, 'the made-up twin');
  }, 300_000);

  it(`${AC1} (the merge base's reading) the made-up twin under DEEP_HUB_PLANT=${PLANT} reads finished after the first stop, notifies four times, and fails this test, naming the turns`, async () => {
    const s = twin();
    const r = await replayed(s, PLANT);
    const failure = await failureOf(() => holds(r, s, `the made-up twin under ${PLANT}`));
    expect(failure, 'the merge base\'s reading must fail AC1').not.toBeNull();
    expect(r.rows[0]?.row?.state, `the merge base reads ${TURN[0]} as finished`).toBe('finished');
    expect(failure, 'the failure counts four notifications').toContain('notified 4 times');
    for (const turn of TURN.slice(0, 3)) expect(failure, `the failure names ${turn}`).toContain(turn);
  }, 300_000);
});

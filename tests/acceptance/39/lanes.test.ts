// AC17, AC18, AC19, AC25: the slow lane against Codex's 45-minute Stop timeout, and deep_ask against tool_timeout_sec. A
// slow check's expected time and deadline are declared (README: Assumed surfaces); its real run takes seconds, so nothing
// waits 20 minutes, and what's judged is the hub's decision to hold at the stop.
import { writeFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import {
  AC, allEvents, begin, choice, cleanup, codexHook, control, Daemon, doctor, editStopTimeout, finished, hookShown, hubWithSetup, inSlowLane, makeHome, MINUTE, newThread, patch, rowOf, shown, SLOW_ASK, slowLane, slowRepo, startHub, stopEntry, stopHub, STOP_TIMEOUT_S, tag, waitFor, type Line,
} from './helpers.ts';

afterEach(cleanup, 60_000);
const WITHIN = (s: number) => (STOP_TIMEOUT_S - s) * 1000;
const context = (r: { reply: Line | undefined }) => String(r.reply?.hookSpecificOutput?.additionalContext ?? '');
async function turn(h: ReturnType<typeof makeHome>, cwd: string) {
  const t = newThread(h, { cwd });
  await begin(h, t, SLOW_ASK);
  await patch(h, t, 'tax.txt', 'tax');
  return t;
}

describe(`${AC[17]} A FAIL from a 20-minute check reaches the agent in the same turn`, () => {
  it(`${AC[17]} a check expected to take 20 minutes runs in the slow lane while the stop is held, and its FAIL is the stop's own decision: block`, async () => {
    const h = makeHome();
    const repo = slowRepo(h, { expected_ms: 20 * MINUTE, deadline_ms: 20 * MINUTE, sleepS: 3 });
    const hub = await hubWithSetup(h);
    const t = await turn(h, repo);
    const r = await codexHook(h, t, 'Stop', {}, 120_000);
    const events = await allEvents(hub);
    expect(inSlowLane(events), `${AC[17]} the 20-minute check ran in the slow lane: ${events.filter((e) => e.kind.startsWith('run.')).map((e) => JSON.stringify(e.data)).join(' ')}`).toBe(true);
    expect(r.reply?.decision, `${AC[17]} the FAIL continues the same turn: ${hookShown(r)}`).toBe('block');
    expect(String(r.reply?.reason), `${AC[17]} naming the FAIL`).toMatch(/FAIL|sent back/);
  }, 240_000);
});

describe(`${AC[18]} With the slow lane's expected time at 20 minutes and Codex's Stop hook entry edited to 300 s, the hub at start and deep doctor show the slow-lane relation broken, naming 300 s and 45 minutes, and a stop with a 20-minute check isn't held: Codex gets its reply at once, the claim stays pending, the session's row says why, and the FAIL arrives with your next message. A hub that holds anyway is cut off at 300 s and lets the stop through with no verdict, and that version fails this test`, () => {
  it(`${AC[18]} the relation is broken at start and in doctor, naming both values; the stop is answered at once, pending, the row says why, and the FAIL comes at your next message`, async () => {
    const h = makeHome();
    slowLane(h, 20 * MINUTE);
    const repo = slowRepo(h, { expected_ms: 20 * MINUTE, deadline_ms: 20 * MINUTE, sleepS: 6 });
    let hub = await hubWithSetup(h);
    expect(stopEntry(h)?.hook.timeout, `${AC[18]} setup's Stop entry exists in ${h.hooksFile}`).toBe(STOP_TIMEOUT_S);
    editStopTimeout(h, 300);
    await stopHub(hub);
    hub = await startHub(h);
    const health = JSON.stringify(await control(hub, 'health'));
    expect(health, `${AC[18]} the hub at start shows the relation broken, naming 300 s and 45 minutes: ${health.slice(0, 800)}`).toMatch(/slow.lane[^"]*broken[^"]*300 s[^"]*45 minutes|slow.lane[^"]*broken[^"]*45 minutes[^"]*300 s/i);
    const d = await doctor(h);
    expect(d.stdout, `${AC[18]} deep doctor too: ${shown(d)}`).toMatch(/300 s/);
    expect(d.stdout, `${AC[18]} deep doctor names 45 minutes`).toMatch(/45 minutes/);
    const t = await turn(h, repo);
    const r = await codexHook(h, t, 'Stop', {}, 120_000);
    expect(r.ran.ms, `${AC[18]} Codex gets its reply at once, not after the 6 s check: ${hookShown(r)}`).toBeLessThan(5000);
    expect(r.reply?.decision, `${AC[18]} no verdict in this reply`).toBeUndefined();
    expect(finished(await allEvents(hub)).length, `${AC[18]} the check hasn't ended at the reply: the claim stays pending`).toBe(0);
    expect(JSON.stringify(await rowOf(hub, t.id)), `${AC[18]} the row says why`).toMatch(/300 s/);
    await waitFor(async () => finished(await allEvents(hub)).length > 0, 60_000, 'the check to end');
    t.turn = crypto.randomUUID();
    const next = await codexHook(h, t, 'UserPromptSubmit', { prompt: 'What happened?' });
    expect(context(next), `${AC[18]} the FAIL arrives with your next message: ${hookShown(next)}`).toMatch(/FAIL/);
  }, 300_000);
});

describe(`${AC[19]} With tool_timeout_sec = 8 for DeepBuild's MCP server in a Codex config fixture, the deep_ask relation shows broken, and a deep_ask returns at once with the ask's ID, deadline and default; with 60 it says "still waiting" at 55 s`, () => {
  it(`${AC[19]} at 8 s: broken, naming 8 s, and deep_ask returns at once with ID, deadline and default`, async () => {
    const h = makeHome();
    await hubWithSetup(h);
    writeFileSync(h.configToml, '[mcp_servers.deep]\ntool_timeout_sec = 8\n');
    const d0 = await doctor(h);
    expect(d0.stdout, `${AC[19]} the deep_ask relation shows broken: ${shown(d0)}`).toMatch(/deep_ask[^\n]*broken[^\n]*8 s/);
    const t = newThread(h);
    const d = Daemon.start(h, t.cwd);
    await d.begin(t);
    await d.init();
    const { reply, ms } = await d.ask(t, choice(`At once ${tag()}?`), 30_000);
    const text = JSON.stringify(reply);
    expect(ms, `${AC[19]} at once: ${text.slice(0, 400)}`).toBeLessThan(4000);
    expect(text, `${AC[19]} the ask's ID`).toMatch(/ask:/);
    expect(text, `${AC[19]} its deadline`).toMatch(/deadline/i);
    expect(text, `${AC[19]} its default`).toMatch(/default/i);
    d.stop();
  }, 180_000);
  it(`${AC[19]} at 60 s: deep_ask says "still waiting" at 55 s`, async () => {
    const h = makeHome();
    await hubWithSetup(h);
    writeFileSync(h.configToml, '[mcp_servers.deep]\ntool_timeout_sec = 60\n');
    const t = newThread(h);
    const d = Daemon.start(h, t.cwd);
    await d.begin(t);
    await d.init();
    const { reply, ms } = await d.ask(t, choice(`Wait ${tag()}?`), 70_000);
    expect(JSON.stringify(reply), `${AC[19]} says still waiting`).toMatch(/still waiting/i);
    expect(ms, `${AC[19]} at 55 s, 5 s before the 60 s it was given`).toBeGreaterThanOrEqual(53_000);
    expect(ms, `${AC[19]} at 55 s, before Codex cuts it off`).toBeLessThanOrEqual(58_000);
    d.stop();
  }, 180_000);
});

describe(`${AC[25]} On a controlled clock with Codex's Stop hook timeout at 45 minutes, a stop whose slow check's deadline ends 3 s before the timeout isn't held: Codex gets its reply at once, the claim stays pending and the verdict comes with your next message; with the deadline 10 s before the timeout, the stop is held and a FAIL at the deadline reaches the agent in the same turn; a hub that holds for any deadline before the timeout holds the first stop and fails this test`, () => {
  it(`${AC[25]} deadline 3 s before the timeout: not held, pending, and the verdict comes with your next message`, async () => {
    const h = makeHome();
    const repo = slowRepo(h, { expected_ms: WITHIN(3), deadline_ms: WITHIN(3), sleepS: 6 });
    const hub = await hubWithSetup(h, { clock: Date.now() });
    const t = await turn(h, repo);
    const r = await codexHook(h, t, 'Stop', {}, 120_000);
    expect(r.ran.ms, `${AC[25]} this stop isn't held for its 6 s check: a hub that holds for any deadline before the timeout fails here: ${hookShown(r)}`).toBeLessThan(5000);
    expect(r.reply?.decision, `${AC[25]} no verdict at this stop`).toBeUndefined();
    const at = await allEvents(hub);
    expect(inSlowLane(at), `${AC[25]} the check's run is in the slow lane`).toBe(true);
    expect(finished(at).length, `${AC[25]} pending at the reply`).toBe(0);
    await waitFor(async () => finished(await allEvents(hub)).length > 0, 60_000, 'the check to end');
    t.turn = crypto.randomUUID();
    const next = await codexHook(h, t, 'UserPromptSubmit', { prompt: 'Well?' });
    expect(context(next), `${AC[25]} the verdict with your next message: ${hookShown(next)}`).toMatch(/FAIL/);
  }, 240_000);
  it(`${AC[25]} deadline 10 s before the timeout: held, and the check's FAIL is the stop's decision: block in the same turn`, async () => {
    const h = makeHome();
    const repo = slowRepo(h, { expected_ms: WITHIN(10), deadline_ms: WITHIN(10), sleepS: 3 });
    const hub = await hubWithSetup(h, { clock: Date.now() });
    const t = await turn(h, repo);
    const r = await codexHook(h, t, 'Stop', {}, 120_000);
    expect(inSlowLane(await allEvents(hub)), `${AC[25]} the check's run is in the slow lane`).toBe(true);
    expect(r.ran.ms, `${AC[25]} held until the check ended`).toBeGreaterThanOrEqual(2500);
    expect(r.reply?.decision, `${AC[25]} the FAIL reaches the agent in the same turn: ${hookShown(r)}`).toBe('block');
  }, 240_000);
});

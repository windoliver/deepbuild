// AC3: with the app open, the hub is stopped and deep-hook spools a Claude Code permission request; the hub starts, the
// app reconnects and receives 20 events from another session's live hooks, each with a newer ID and `seq` than the
// spooled request, and then the hub replays the spool: the ask shows in Needs you within 1 s of the replay. An app that
// keeps its place by event ID takes the older request as already seen and never shows the ask, which then reaches its
// default unseen; that version fails this test, naming the ask.
//
// The app is the real window on a real hub (#1546's `deep-live --view needs-you --watch`, the app's own record reader
// and tick, one line per frame). Session A's permission request goes through the real deep-hook binary while the hub
// is stopped, so deep-hook spools it. The spool is held aside, byte for byte, while the hub starts and session B's
// 20 hooks (10 calls, each before and after) reach it live on the hook wire; then it goes back where deep-hook wrote
// it, and the hub's pass for a spool that lands while it runs replays it (README, Disputes 3). The replay's moment is
// when a cli subscriber on the hub's stream gets the request's event, by its ID. The ask is the `ask.created` of
// session A the replay brings; it shows once a frame's Needs you lists its row (#1461's `ask:<ULID>`).
import { afterAll, describe, expect, it } from 'vitest';
import {
  agentSession, appBins, blocked, cleanup, deepHook, deepHookRun, eventsOf, hubOf, holdSpool, ID, inconclusive, live, logPos, makeHome, MINUTE, needCli, payload,
  PLANT, shownIn, sleep, spooled, stopHub, stream, timingProblem, Watch, type Ev, type Hub,
} from './helpers.ts';

afterAll(cleanup, 5 * MINUTE);

const LIMIT_MS = 1000;
/** How long after the replay a Needs you that never shows the ask is watched. */
const WATCHED_MS = 15_000;
const COMMAND = 'npm publish --tag next';

interface Outcome { failures: string[]; ask?: string; delayMs?: number }

/** The issue's scenario with the app built plain, or with `plant`; what went wrong, naming the ask where it can. */
async function scenario(plant?: string): Promise<Outcome> {
  needCli();
  const [built] = await Promise.all([appBins(), deepHook()]);
  const home = makeHome();
  let hub: Hub | undefined = await hubOf(home);
  let watch: Watch | undefined;
  let subscribed: Awaited<ReturnType<typeof stream>> | undefined;
  try {
    const a = agentSession(home);
    const b = agentSession(home);
    for (const s of [a, b]) {
      await live(hub, s, 'SessionStart');
      await live(hub, s, 'UserPromptSubmit', { prompt: s === a ? 'publish the package' : 'run the test shards' });
    }
    const call = { tool_name: 'Bash', tool_input: { command: COMMAND, description: 'Publish the package' }, tool_use_id: 'toolu_publish' };
    await live(hub, a, 'PreToolUse', call);

    // The app is open on the hub; then the hub stops, and deep-hook spools A's permission request.
    watch = await Watch.start((plant ? built.plants : built.plain).live, home, plant);
    await stopHub(hub);
    hub = undefined;
    const asked = await deepHookRun(home, a.s, 'PermissionRequest', payload(a.s, 'PermissionRequest', {
      tool_name: 'Bash', tool_input: call.tool_input,
      permission_suggestions: [{ type: 'addRules', rules: [{ toolName: 'Bash', ruleContent: 'npm publish:*' }], behavior: 'allow', destination: 'session' }],
    }));
    const request = spooled(home).find((r) => r.event === 'PermissionRequest' && r.session === a.s.id)
      ?? blocked(`deep-hook spooled no permission request with the hub stopped: exit ${asked.code}, ${asked.stdout.slice(-300)} ${asked.stderr.slice(-600)}`);
    const held = holdSpool(home);

    // The hub starts and the app reconnects.
    const restarted = Date.now();
    hub = await hubOf(home);
    const start = await logPos(hub);
    if (!(await watch.first((f) => f.log_pos >= start, restarted, 2 * MINUTE))) {
      return { failures: [`the app never reconnected: no frame in 2 minutes holds the hub's record at log_pos ${start} (its last is at ${watch.last()?.log_pos ?? 'none'})`] };
    }
    // 20 events from B's live hooks, each newer by ID and seq than the spooled request.
    const sent: string[] = [];
    for (let n = 0; n < 10; n++) {
      const shard = { tool_name: 'Bash', tool_input: { command: `npm test -- --shard=${n + 1}/10` }, tool_use_id: `toolu_shard_${n}` };
      sent.push(await live(hub, b, 'PreToolUse', shard));
      sent.push(await live(hub, b, 'PostToolUse', { ...shard, tool_response: { stdout: 'ok', stderr: '', interrupted: false } }));
    }
    const twenty = (await eventsOf(hub)).filter((e) => sent.includes(e.id));
    if (twenty.length !== 20) blocked(`the hub recorded ${twenty.length} of B's 20 hooks as events`);
    const older = twenty.filter((e) => e.id <= request.id || (e.seq !== undefined && BigInt(e.seq) <= BigInt(request.seq)));
    if (older.length) blocked(`${older.length} of B's events aren't newer than the spooled request (${request.id}, seq ${request.seq}) by ID and seq: ${JSON.stringify(older.map((e) => [e.id, e.seq]))}`);
    const last = Math.max(...twenty.map((e) => e.log_pos));
    if (!(await watch.first((f) => f.log_pos >= last, restarted, MINUTE))) {
      return { failures: [`the app didn't receive B's 20 events: its frames stop at log_pos ${watch.last()?.log_pos ?? 'none'}, and the 20th is at ${last}`] };
    }

    // Then the spool lands and the hub replays it.
    subscribed = await stream(hub, last);
    const back = Date.now();
    held.back();
    const frameOf = async (match: (e: Ev) => boolean, ms: number) => {
      const by = Date.now() + ms;
      for (;;) {
        const found = subscribed!.frames().find((f) => match(f.event));
        if (found || Date.now() > by) return found;
        await sleep(20);
      }
    };
    const replayed = await frameOf((e) => e.id === request.id, MINUTE);
    if (!replayed) return { failures: [`the hub didn't replay the spooled permission request (${request.id}) within a minute of the spool landing`] };
    const created = await frameOf((e) => e.kind === 'ask.created' && e.session === a.s.id, WATCHED_MS);
    if (!created) return { failures: [`the replayed permission request of session ${a.s.id} (${COMMAND}) raised no ask: the record holds no ask.created for it, so Needs you has nothing to show`] };
    const ask = `ask:${created.event.id}`;
    const question = String(created.event.data.question ?? '');
    const shown = await watch.first((f) => shownIn(f).rows.includes(ask), back, WATCHED_MS + (created.at - replayed.at));
    if (!shown) return { ask, failures: [`Needs you never showed the ask ${ask} ("${question}") in the ${WATCHED_MS / 1000} s after the replay; its last frame lists ${JSON.stringify(watch.last() ? shownIn(watch.last()!).rows : [])}`] };
    return { ask, failures: [], delayMs: shown.at - replayed.at };
  } finally {
    subscribed?.conn.close();
    await watch?.stop();
    if (hub) await stopHub(hub);
  }
}

let clean: Outcome | undefined;
const cleanRun = async (): Promise<Outcome> => (clean ??= await scenario());

describe(`#2026 AC3 ${ID.replay}`, () => {
  it('a permission request spooled while the hub was down shows in Needs you within 1 s of its replay, after 20 newer events', async () => {
    const outcome = await cleanRun();
    expect(outcome.failures).toEqual([]);
    const reading = `${outcome.ask} drawn in Needs you ${outcome.delayMs!.toFixed(0)} ms after the replay (limit ${LIMIT_MS})`;
    console.log(`#2026 AC3: ${reading}`);
    if (outcome.delayMs! <= LIMIT_MS) return;
    const problem = timingProblem();
    if (problem) inconclusive(`${problem}; ${reading}`);
    expect.fail(`the replayed ask showed later than 1 s after the replay: ${reading}`);
  }, 60 * MINUTE);

  it(`an app that keeps its place by event ID (${PLANT.byId}) never shows the ask, and fails naming it`, async () => {
    expect((await cleanRun()).failures, 'the clean run already fails AC3, so the plant can\'t be told from it').toEqual([]);
    const planted = await scenario(PLANT.byId);
    expect(planted.failures.filter((f) => planted.ask !== undefined && f.startsWith('Needs you never showed the ask') && f.includes(planted.ask)), `the app that keeps its place by event ID wasn't caught, naming the ask: ${JSON.stringify(planted)}`).not.toEqual([]);
  }, 60 * MINUTE);
});

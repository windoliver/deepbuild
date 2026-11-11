// AC3, redrafted: with the app open, the hub is stopped and deep-hook spools a Claude Code permission request; the hub
// starts, the app reconnects and receives 20 events from another session's live hooks, each with a newer ID and `seq`
// than the spooled request, and then the hub replays the spool: the ask shows in Needs you within 1 s of the replay. An
// app that keeps its place by event ID takes the older request as already seen and never shows the ask, which then
// reaches its default unseen; that version fails this test, naming the ask.
//
// The scenario is the first draft's (../2026/replay.test.ts), on the real window (#1546's `deep-live --view needs-you
// --watch`): A's permission request goes through the real deep-hook while the hub is stopped, the spool is held aside
// while the hub starts and B's 20 hooks reach it live on the hook wire, then it goes back and the hub's pass for a spool
// that lands while it runs replays it. The replay's moment is when a cli subscriber on the hub's stream gets the
// request's event, by its ID; the ask shows once a frame's Needs you lists its row (#1461's `ask:<ULID>`).
//
// What the redraft changes (README, The dispute): the wrong program that keeps its place by event ID is a reader that
// meets the replayed request itself, in the hub, where under the design it can fail; the app is always the plain
// build. Every way the ask fails to show fails with one sentence that names the spooled request and, once raised, the ask.
// The home declares the ask settings setup drafts, without which no correct hub could raise the ask.
import { rmSync } from 'node:fs';
import { tmpdir, userInfo } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { draftAskSettings } from '../../../packages/asks/src/index.ts';
import { startHub } from '../16/helpers.ts';
import {
  agentSession, appBins, blocked, cleanup, deepHook, deepHookRun, eventsOf, holdSpool, ID, inconclusive, live, logPos, makeHome, MINUTE, needCli,
  payload, rootOf, shownIn, sleep, spooled, stopHub, stream, timingProblem, Watch, type Ev, type Hub,
} from '../2026/helpers.ts';

afterAll(cleanup, 5 * MINUTE);
// helpers.ts `appBins` copies the app over its last copies in $TMPDIR/da2026-bin-<uid>/, in place. macOS kills a
// signed binary rewritten in place once it has run (SIGKILL at exec, with nothing on stderr), so this run's copies go
// to new files (README, Run it).
beforeAll(() => {
  const bin = join(tmpdir(), `da2026-bin-${userInfo().uid}`);
  for (const name of ['deep-replica-plain', 'deep-live-plain', 'deep-replica-plants', 'deep-live-plants']) rmSync(join(bin, name), { force: true });
});

const LIMIT_MS = 1000;
/** How long after the replay a Needs you that never shows the ask is watched. */
const WATCHED_MS = 15_000;
const COMMAND = 'npm publish --tag next';

/**
 * The planted wrong programs (README, Plants): each a reader in the hub that keeps its place by event ID, not by
 * `log_pos`. Selected with DEEP_HUB_PLANT on the hub alone (packages/hub/src/plant.ts); the app stays plain.
 */
const PLANT = {
  /** The spool replay takes a spooled request as already recorded once the record holds an event whose ID sorts at or after the request's own. */
  replay: 'replay-keeps-place-by-id',
  /** The asks core reads hook events from the newest event ID it has read: a request whose ID sorts at or before it is taken as already read and raises no ask. */
  asks: 'asks-keep-place-by-id',
} as const;

/** How every failure to show the ask begins; the spooled request's ID follows it. */
const NEVER = 'Needs you never showed an ask for the permission request';

interface Outcome { failures: string[]; request?: string; ask?: string; delayMs?: number }

/** The issue's scenario, with the hub plain or running `plant`; what went wrong, naming the request and its ask. */
async function scenario(plant?: string): Promise<Outcome> {
  needCli();
  const [built] = await Promise.all([appBins(), deepHook()]);
  const home = makeHome();
  // Every ask needs its kind's deadline and default declared, or the asks core refuses it BLOCKED (invariant 2): the
  // home gets what setup drafts into the hub's config.json (setup.ts calls this very function), which makeHome() leaves out.
  await draftAskSettings(rootOf(home));
  // The hub is the program under test: a plant goes to it alone, in each of its starts (#16's `startHub`).
  const hubOf = (): Promise<Hub> => startHub({ home, ...(plant ? { plant } : {}) }, 10 * MINUTE);
  let hub: Hub | undefined = await hubOf();
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
    watch = await Watch.start(built.plain.live, home);
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
    hub = await hubOf();
    const start = await logPos(hub);
    if (!(await watch.first((f) => f.log_pos >= start, restarted, 2 * MINUTE))) {
      return { request: request.id, failures: [`the app never reconnected: no frame in 2 minutes holds the hub's record at log_pos ${start} (its last is at ${watch.last()?.log_pos ?? 'none'})`] };
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
      return { request: request.id, failures: [`the app didn't receive B's 20 events: its frames stop at log_pos ${watch.last()?.log_pos ?? 'none'}, and the 20th is at ${last}`] };
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
    // The ask never showing, however far the request got: the request by its ID, session and command, then why.
    const missing = (why: string, ask?: string): Outcome => ({
      request: request.id, ...(ask ? { ask } : {}),
      failures: [`${NEVER} ${request.id} of session ${a.s.id} (\`${COMMAND}\`), spooled while the hub was down: ${why}`],
    });
    const replayed = await frameOf((e) => e.id === request.id, MINUTE);
    if (!replayed) {
      return missing(spooled(home).some((r) => r.id === request.id)
        ? 'the hub never took it from the spool: it is still in deep-hook\'s spool a minute after the spool landed'
        : `the hub took the spool up but recorded nothing under its ID: no frame on the hub's stream after log_pos ${last} carries ${request.id} in the minute after the spool landed`);
    }
    const created = await frameOf((e) => e.kind === 'ask.created' && e.session === a.s.id, WATCHED_MS);
    if (!created) return missing(`the hub replayed it at log_pos ${replayed.event.log_pos}, after B's 20 events, but raised no ask for it: no ask.created of session ${a.s.id} reached the hub's stream in the ${WATCHED_MS / 1000} s after the replay`);
    const ask = `ask:${created.event.id}`;
    const question = String(created.event.data.question ?? '');
    const shown = await watch.first((f) => shownIn(f).rows.includes(ask), back, WATCHED_MS + Math.max(0, created.at - replayed.at));
    if (!shown) {
      return missing(`the hub raised its ask ${ask} ("${question}"), but no frame of Needs you listed it in the ${WATCHED_MS / 1000} s after the replay; its last frame lists ${JSON.stringify(watch.last() ? shownIn(watch.last()!).rows : [])}`, ask);
    }
    return { request: request.id, ask, failures: [], delayMs: shown.at - replayed.at };
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
    const reading = `${outcome.ask} drawn in Needs you ${outcome.delayMs!.toFixed(0)} ms after the replay of ${outcome.request} (limit ${LIMIT_MS})`;
    console.log(`#2026 AC3: ${reading}`);
    if (outcome.delayMs! <= LIMIT_MS) return;
    const problem = timingProblem();
    if (problem) inconclusive(`${problem}; ${reading}`);
    expect.fail(`the replayed ask showed later than 1 s after the replay: ${reading}`);
  }, 60 * MINUTE);

  for (const [plant, where] of [[PLANT.replay, 'the hub\'s spool replay'], [PLANT.asks, 'the hub\'s asks core']] as const) {
    it(`a reader that keeps its place by event ID in ${where} (${plant}) never shows the ask, and fails naming it`, async () => {
      expect((await cleanRun()).failures, 'the clean run already fails AC3, so the plant can\'t be told from it').toEqual([]);
      const planted = await scenario(plant);
      console.log(`#2026 AC3 ${plant}: ${JSON.stringify(planted)}`);
      const named = planted.failures.filter((f) => planted.request !== undefined && f.startsWith(`${NEVER} ${planted.request} `));
      expect(named, `the hub that keeps its place by event ID in ${where} wasn't caught, naming the missing ask: ${JSON.stringify(planted)}`).not.toEqual([]);
    }, 60 * MINUTE);
  }
});

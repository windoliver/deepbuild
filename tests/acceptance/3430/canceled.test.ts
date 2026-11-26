// #3430: a turn stopped in paseo isn't a failed turn. paseo ends a turn `completed`, `failed` (with an error) or
// `canceled` (with a reason); the plugin must send that outcome as paseo gave it, and the facts read a canceled turn as
// any interrupted turn: no stop, no claim, the row reads interrupted, until your next prompt. An outcome the facts
// don't list marks the session unverified and names it. Paseo is #55's stand-in around the real plugin
// (tests/acceptance/55/fixtures/paseo-host.mjs), firing agent.turn.after with the outcome shapes paseo 0.15.0 declares
// (README, The world); the hub and the plugin are real. No live paseo daemon: no criterion needs one.
// First: what you gave the suite by hand, before ../29's helpers (loaded through ../55) delete DEEP_* (#55 D1).
import '../55/env.ts';
import net from 'node:net';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { startHub } from '../27/helpers.ts';
import {
  ASK_SETTINGS, CART, FALSE_DONE, Host, about, cleanup, commitFalseDone, create, editConfig, events, fakeAgent, kinds, makeHome, needPlugin, said,
  specRepo, toolCall, turnEnds, turnStarts, waitFor, within, type Ev, type Fake, type Line,
} from '../55/helpers.ts';

afterEach(cleanup, 120_000);

/** Each criterion's tag: `#3430.` and the first 8 hex of SHA-256 of its text, trimmed, whitespace collapsed. */
const AC = {
  canceled: '#3430.98bfee96',
  still: '#3430.77661745',
  next: '#3430.920b7e03',
  unlisted: '#3430.5c4cf6e4',
} as const;

const PROMPT = 'Make the cart total take the 10% discount off.';
/** paseo 0.15.0's PluginTurnOutcome (packages/plugin/src/server/lifecycle.ts): what agent.turn.after carries. */
const CANCELED = { kind: 'canceled', reason: 'Stopped from the paseo app' };
const RATE_LIMITED = { kind: 'failed', error: { message: 'rate limit' } };
const COMPLETED = { kind: 'completed' };
/** An outcome kind no paseo release the facts cover sends, and the facts don't list. */
const UNLISTED_KIND = 'timed_out';
/** What the gate leaves in the record when it runs for a session: a claim, its checks, its verdict, a held stop, a send-back. */
const GATE_KINDS = new Set(['claim.made', 'check', 'verdict.made', 'stop.held', 'claim.sent_back']);
/** The row of a turn you interrupted (packages/hub/src/status.ts, the interrupted rule). */
const INTERRUPTED = 'its turn was interrupted';

// ---- deep status's rows, read through the hub's socket on a cli connection, as #55's helpers read the record.
function control(home: string, method: string, params: Line, timeoutMs = 60_000): Promise<Line> {
  const root = join(home, '.deepbuild');
  const token = readFileSync(join(root, 'control.token'), 'utf8').trim();
  return new Promise((resolve, reject) => {
    const sock = net.connect(join(root, 'hub.sock'));
    let buffer = '';
    let step = 0;
    // deadline: a hub that never answers fails the read instead of hanging the test.
    const timer = setTimeout(() => { sock.destroy(); reject(Error(`no reply to ${method} within ${timeoutMs} ms`)); }, timeoutMs);
    sock.setEncoding('utf8');
    sock.on('error', (error) => { clearTimeout(timer); reject(error); });
    sock.on('data', (chunk: string) => {
      buffer += chunk;
      for (let i = buffer.indexOf('\n'); i >= 0; i = buffer.indexOf('\n')) {
        let line: Line | undefined;
        try { line = JSON.parse(buffer.slice(0, i)) as Line; } catch { line = undefined; }
        buffer = buffer.slice(i + 1);
        if (step === 0) { step = 1; sock.write(`${JSON.stringify({ v: 1, hello: 'cli', token })}\n`); }
        else if (step === 1 && line?.role !== undefined) { step = 2; sock.write(`${JSON.stringify({ v: 1, id: 1, method, params })}\n`); }
        else if (step === 2 && line?.id === 1) {
          clearTimeout(timer);
          sock.destroy();
          if (line.error) reject(Error(`${method} refused: ${JSON.stringify(line.error)}`));
          else resolve(line.result as Line);
        }
      }
    });
  });
}
/** The session's row as `deep status` lists it (status.read, behind every hook the hub received). */
async function rowOf(home: string, session: string): Promise<Line | undefined> {
  const rows = ((await control(home, 'status.read', {})).rows ?? []) as Line[];
  return rows.find((r) => r.id === session || String(r.id).endsWith(session));
}
const rowSays = (row: Line | undefined): string => (row ? `${String(row.state)}: ${String(row.why)}` : 'no row');
const stopsOf = (evs: readonly Ev[], session: string): Ev[] => evs.filter((e) => e.kind === 'agent.stop' && e.session === session);
const gateOf = (evs: readonly Ev[], session: string): Ev[] => evs.filter((e) => GATE_KINDS.has(e.kind) && about(e, session));
/** Whether the record marks an event unverified: events.read gives each event's `verified`, and a reading may say so. */
const unverifiedMarks = (evs: readonly Ev[], session: string): Ev[] => evs.filter((e) => about(e, session) && ((e as Line).verified === false || (e.kind === 'session.reading' && /unverified/i.test(JSON.stringify(e.data)))));

/** A Copilot agent run through paseo (no hooks of its own: the plugin gates it), in #55's fixture repo, opened with the plugin's MCP server. */
async function copilot(): Promise<{ home: string; repo: { dir: string }; host: Host; f: Fake }> {
  needPlugin();
  const { home } = makeHome();
  editConfig(home, (c) => { c.asks = ASK_SETTINGS; });
  const repo = specRepo(home);
  await startHub(home);
  const host = await Host.start(home);
  const f = fakeAgent('copilot', repo.dir);
  await create(host, f);
  return { home, repo, host, f };
}
type World = Awaited<ReturnType<typeof copilot>>;
/** Your prompt starts a turn; the agent edits the cart and commits, as an agent at work in its folder does. */
async function working(w: World, turn: string): Promise<void> {
  await turnStarts(w.host, w.f, turn, PROMPT);
  commitFalseDone(w.repo.dir);
  toolCall(w.f, turn, 'edit', { type: 'edit', filePath: join(w.repo.dir, 'src/cart.js'), oldString: CART, newString: FALSE_DONE });
}
/** paseo ends the turn with `outcome`; the agent reads idle. Waits until the plugin's handlers returned. */
async function ends(w: World, turn: string, outcome: Line): Promise<void> {
  const fired = await turnEnds(w.host, w.f, turn, { words: 'Working on it.', outcome });
  if (fired.errors?.length) throw Error(`agent.turn.after failed in the plugin: ${JSON.stringify(fired.errors)}`);
  await w.host.settled(fired);
}
/** The turn's end reached the record: a stop of the session, or its row reading interrupted. */
async function landed(w: World): Promise<{ evs: Ev[]; row: Line | undefined }> {
  return waitFor(async () => {
    const evs = await events(w.home);
    const row = await rowOf(w.home, w.f.session);
    return stopsOf(evs, w.f.session).length || String(row?.why ?? '').includes(INTERRUPTED) ? { evs, row } : undefined;
  }, 120_000, `the canceled turn of session ${w.f.session} to reach the record (a stop, or its row reading interrupted)`, 500)
    .catch(async (e: Error) => ({ evs: await events(w.home), row: await rowOf(w.home, w.f.session), late: e.message }));
}

it(`${AC.canceled} a Copilot turn canceled in paseo is recorded with no agent.stop, the gate doesn't run, and its row reads that its turn was interrupted`, async () => {
  const w = await copilot();
  await working(w, 't1');
  await ends(w, 't1', CANCELED);
  const { evs, row } = await landed(w);
  const stops = stopsOf(evs, w.f.session);
  expect(stops.map(said), `${AC.canceled} paseo canceled this turn (${JSON.stringify(CANCELED)}): an interrupted turn has no stop, but the record holds ${stops.map(said).join('; ')}; plugin errors ${JSON.stringify(w.host.errors()).slice(0, 400)}`).toEqual([]);
  // A gate that would run on this turn's end shows within this bound.
  const gate = await within(15_000, async () => { const g = gateOf(await events(w.home), w.f.session); return g.length ? g : undefined; }) ?? [];
  expect(gate.map(said), `${AC.canceled} the gate doesn't run for a canceled turn`).toEqual([]);
  expect(rowSays(row), `${AC.canceled} the session's row reads that its turn was interrupted; the session's record: ${kinds(evs.filter((e) => about(e, w.f.session)))}`).toContain(INTERRUPTED);
}, 400_000);

it(`${AC.still} a turn that failed with the error "rate limit" is still a failed stop whose cause reads rate_limited`, async () => {
  const w = await copilot();
  await working(w, 't1');
  await ends(w, 't1', RATE_LIMITED);
  const stop = await waitFor(async () => stopsOf(await events(w.home), w.f.session)[0], 120_000, `the failed turn's stop of session ${w.f.session}`, 500).catch(() => undefined);
  const evs = await events(w.home);
  expect(stop, `${AC.still} the failed turn is a stop; the session's record: ${kinds(evs.filter((e) => about(e, w.f.session)))}`).toBeDefined();
  expect(stopsOf(evs, w.f.session).map((s) => ({ outcome: s.data.outcome, cause: s.data.cause })), `${AC.still} one failed stop whose cause reads rate_limited: ${stopsOf(evs, w.f.session).map(said).join('; ')}`).toEqual([{ outcome: 'failed', cause: 'rate_limited' }]);
}, 400_000);

it(`${AC.still} a completed turn is still a finished stop`, async () => {
  const w = await copilot();
  await working(w, 't1');
  await ends(w, 't1', COMPLETED);
  const stop = await waitFor(async () => stopsOf(await events(w.home), w.f.session)[0], 120_000, `the completed turn's stop of session ${w.f.session}`, 500).catch(() => undefined);
  const evs = await events(w.home);
  expect(stop, `${AC.still} the completed turn is a stop; the session's record: ${kinds(evs.filter((e) => about(e, w.f.session)))}`).toBeDefined();
  expect(stopsOf(evs, w.f.session).map((s) => s.data.outcome), `${AC.still} one finished stop: ${stopsOf(evs, w.f.session).map(said).join('; ')}`).toEqual(['finished']);
}, 400_000);

it(`${AC.next} your next prompt in the session clears the interrupted reading a canceled turn left`, async () => {
  const w = await copilot();
  await working(w, 't1');
  await ends(w, 't1', CANCELED);
  const { evs, row } = await landed(w);
  expect(rowSays(row), `${AC.next} before your next prompt, the canceled turn reads interrupted; the session's record: ${kinds(evs.filter((e) => about(e, w.f.session)))}`).toContain(INTERRUPTED);
  // Your next prompt: paseo starts the session's next turn.
  await turnStarts(w.host, w.f, 't2', 'Carry on, and take the discount off this time.');
  const after = await waitFor(async () => { const r = await rowOf(w.home, w.f.session); return r && !String(r.why ?? '').includes(INTERRUPTED) ? r : undefined; }, 60_000, 'the row to stop reading interrupted', 500)
    .catch(async () => rowOf(w.home, w.f.session));
  expect(rowSays(after), `${AC.next} your next prompt clears the interrupted reading`).not.toContain(INTERRUPTED);
}, 400_000);

it(`${AC.unlisted} an outcome the facts don't list marks the session unverified and names the outcome`, async () => {
  const w = await copilot();
  await working(w, 't1');
  const before = unverifiedMarks(await events(w.home), w.f.session).length;
  await ends(w, 't1', { kind: UNLISTED_KIND });
  const named = (evs: readonly Ev[]): Ev[] => evs.filter((e) => about(e, w.f.session) && JSON.stringify(e.data ?? {}).includes(UNLISTED_KIND));
  await waitFor(async () => named(await events(w.home)).length > 0, 120_000, `an event of session ${w.f.session} naming ${UNLISTED_KIND}`, 500).catch(() => undefined);
  const evs = await events(w.home);
  expect(named(evs).map(said), `${AC.unlisted} the record names the outcome paseo gave (${UNLISTED_KIND}); the session's record: ${evs.filter((e) => about(e, w.f.session)).map((e) => `${said(e).slice(0, 300)} verified ${String((e as Line).verified)}`).join('; ')}`).not.toEqual([]);
  const marks = unverifiedMarks(evs, w.f.session);
  expect(marks.length, `${AC.unlisted} the session is marked unverified at that turn's end (an event recorded verified: false, or a reading saying unverified): ${marks.map(said).join('; ') || 'none'}`).toBeGreaterThan(before);
}, 400_000);

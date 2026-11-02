// AC27, AC29, AC30: what a Codex session's own records say: its token events' windows, its goal, its heartbeat. Replayed
// from the corpus's rollouts or written as Codex writes them; read from the session's row and its stop's event.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { AC, allEvents, begin, cleanup, codexHook, COVERED, hubWithSetup, makeHome, MINUTE, newThread, ofSession, parseObject, REPO, rowOf, startHub, stopHub, tag, type Home, type Hub, type Line, type Thread } from './helpers.ts';

afterEach(cleanup, 60_000);
const appendRollout = (t: Thread, entry: Line) => writeFileSync(t.transcript, `${JSON.stringify(entry)}\n`, { flag: 'a' });
const reading = async (hub: Hub, t: Thread): Promise<string> => {
  const stops = ofSession(await allEvents(hub), t.id, 'agent.stop');
  return `${JSON.stringify(await rowOf(hub, t.id))} ${JSON.stringify(stops.at(-1)?.data ?? {})}`;
};

// ---- AC27: windows.
const snapshot = (limit: string, primary: number, secondary?: number) => ({
  timestamp: new Date().toISOString(), type: 'event_msg',
  payload: { type: 'token_count', info: { total_token_usage: { input_tokens: 1, cached_input_tokens: 0, output_tokens: 1, reasoning_output_tokens: 0, total_tokens: 2 } }, rate_limits: { limit_id: limit, plan_type: 'pro', primary: { used_percent: primary, window_minutes: 300, resets_at: 2_000_000_000 }, ...(secondary === undefined ? {} : { secondary: { used_percent: secondary, window_minutes: 10_080, resets_at: 2_000_100_000 } }) } },
});
describe(`${AC[27]} A Codex token event whose snapshot has limit_id: image_gen leaves the account's codex windows unchanged, and a snapshot without a weekly window keeps the last weekly reading, shown with its age, instead of reading it as 0%`, () => {
  it(`${AC[27]} an image_gen snapshot moves neither codex window; a snapshot with no weekly keeps the last weekly, with its age, never 0% used or 100% left`, async () => {
    const h = makeHome();
    let hub = await hubWithSetup(h, { clock: Date.now() });
    const t = newThread(h);
    await begin(h, t);
    appendRollout(t, snapshot('codex', 69, 40));
    await codexHook(h, t, 'Stop');
    const row = () => rowOf(hub, t.id).then((r) => JSON.stringify(r));
    expect(await row(), `${AC[27]} the 5-hour window reads as room: 31% left`).toMatch(/31% left/);
    expect(await row(), `${AC[27]} the weekly window: 60% left`).toMatch(/60% left/);
    t.turn = crypto.randomUUID();
    appendRollout(t, snapshot('image_gen', 95, 96));
    await codexHook(h, t, 'Stop');
    expect(await row(), `${AC[27]} image_gen leaves the 5-hour window unchanged`).toMatch(/31% left/);
    expect(await row(), `${AC[27]} and the weekly`).toMatch(/60% left/);
    expect(await row(), `${AC[27]} neither reads image_gen's numbers`).not.toMatch(/\b5% left|\b4% left/);
    await stopHub(hub);
    hub = await startHub(h, { clock: Date.now() + 30 * MINUTE });
    t.turn = crypto.randomUUID();
    appendRollout(t, snapshot('codex', 70));
    await codexHook(h, t, 'Stop');
    const after = await row();
    expect(after, `${AC[27]} the 5-hour moves on`).toMatch(/30% left/);
    expect(after, `${AC[27]} the last weekly stays, not 100% left`).toMatch(/60% left/);
    expect(after, `${AC[27]} never read as 0% used`).not.toMatch(/100% left/);
    expect(after, `${AC[27]} shown with its age`).toMatch(/\b(?:30|31)\s*(?:m|min|minutes?)\b(?:\s*ago)?|\bago\b/);
  }, 240_000);
});

// ---- AC29: goals, replayed from the corpus.
function replayGoal(h: Home): { lines: Line[]; transcript: string; session: string } {
  const dir = join(REPO, `adapters/corpus/codex/${COVERED}/goal`);
  const lines = readFileSync(join(dir, 'events.jsonl'), 'utf8').split('\n').flatMap((l) => { const v = parseObject(l); return v ? [v.payload as Line] : []; });
  const transcript = join(h.codexHome, 'sessions', 'rollout-goal.jsonl');
  mkdirSync(join(h.tmp, 'goal'), { recursive: true });
  return { lines, transcript, session: String(lines[0]!.session_id) };
}
describe(`${AC[29]} From recorded Codex goal sessions, each goal turn before the last reads at its Stop as looping with an active goal, and the last, in which the goal record turns complete, reads at its Stop as a loop with no automatic prompt left; an adapter that reads the goal only from its continuation prompts reads the last turn as looping and fails this test, naming the turn`, () => {
  it(`${AC[29]} the corpus's goal session: at each Stop, the goal status the rollout's records then hold; the last turn's Stop reads no automatic prompt left`, async () => {
    const h = makeHome();
    const hub = await hubWithSetup(h);
    const { lines, transcript, session } = replayGoal(h);
    const rollout = readFileSync(join(REPO, `adapters/corpus/codex/${COVERED}/goal/transcript.jsonl`), 'utf8').trimEnd().split('\n');
    const cwd = join(h.tmp, 'goal');
    const t: Thread = { id: session, cwd, transcript, turn: '', version: COVERED };
    const turns = [...new Set(lines.flatMap((l) => (l.turn_id ? [String(l.turn_id)] : [])))];
    expect(turns.length, 'the corpus\'s goal session has three turns').toBe(3);
    const seen: string[] = [];
    for (const l of lines) {
      // The rollout up to and including this event's turn, as Codex would have written it when the hook fired.
      const end = rollout.findLastIndex((r) => l.turn_id && r.includes(String(l.turn_id)));
      writeFileSync(transcript, `${rollout.slice(0, end + 1).join('\n')}\n`);
      const { session_id: _s, transcript_path: _p, cwd: _c, hook_event_name: event, ...rest } = l;
      t.turn = String(l.turn_id ?? '');
      await codexHook(h, t, String(event), rest);
      if (event === 'Stop') seen.push(await reading(hub, t));
    }
    expect(seen.length, 'a Stop per turn').toBe(3);
    for (const [i, text] of seen.slice(0, -1).entries()) expect(text, `${AC[29]} turn ${turns[i]} reads at its Stop as looping with an active goal: ${text.slice(0, 500)}`).toMatch(/goal[^"]*active/i);
    expect(seen[2], `${AC[29]} the last turn ${turns[2]}, whose goal record turned complete, isn't read as looping`).not.toMatch(/goal[^"]*active/i);
    expect(seen[2], `${AC[29]} turn ${turns[2]} reads as a loop with no automatic prompt left`).toMatch(/no automatic prompt/i);
  }, 240_000);
});

// ---- AC30: heartbeats, as the automation in Codex's home.
const LAST_RUN = Date.UTC(2026, 9, 30, 12, 0, 0);
function automation(h: Home, id: string, status: string, target: string): void {
  const dir = join(h.codexHome, 'automations', id);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'automation.toml'), [`version = 1`, `id = "${id}"`, `kind = "heartbeat"`, `name = "${id}"`, `prompt = "Check the build."`, `status = "${status}"`, `rrule = "FREQ=MINUTELY;INTERVAL=15"`, `target_thread_id = "${target}"`, `created_at = ${LAST_RUN - 60 * MINUTE}`, `updated_at = ${LAST_RUN - 60 * MINUTE}`, `last_run_at = ${LAST_RUN}`, ''].join('\n'));
}
describe(`${AC[30]} A heartbeat automation with kind = "heartbeat", status = "ACTIVE", rrule = "FREQ=MINUTELY;INTERVAL=15" and the thread as its target reads as that thread's next automatic prompt, due at the schedule's next time after its last run, and the same automation PAUSED, or one that targets another thread, as none; an adapter that reads every active heartbeat as the session's fails this test, naming the automation`, () => {
  const DUE = new Date(LAST_RUN + 15 * MINUTE).toISOString();
  const DUE_TEXT = new RegExp(`${DUE.slice(0, 16)}|${LAST_RUN + 15 * MINUTE}`);
  async function stopWith(h: Home, name: string, status: string, target: (t: Thread) => string): Promise<string> {
    const hub = await hubWithSetup(h, { clock: LAST_RUN + 5 * MINUTE });
    const t = newThread(h);
    automation(h, name, status, target(t));
    await begin(h, t, `<heartbeat>\n  <automation_id>${name}</automation_id>\n  <instructions>Check the build.</instructions>\n</heartbeat>\n`);
    await codexHook(h, t, 'Stop');
    return reading(hub, t);
  }
  it(`${AC[30]} ACTIVE and targeting the thread: its next automatic prompt, due 15 minutes after the last run`, async () => {
    const name = `beat-${tag()}`;
    const text = await stopWith(makeHome(), name, 'ACTIVE', (t) => t.id);
    expect(text, `${AC[30]} the row names the heartbeat ${name}: ${text.slice(0, 500)}`).toContain(name);
    expect(text, `${AC[30]} due at the schedule's next time after its last run, ${DUE}`).toMatch(DUE_TEXT);
  }, 180_000);
  it(`${AC[30]} PAUSED: no automatic prompt`, async () => {
    const name = `beat-${tag()}`;
    const text = await stopWith(makeHome(), name, 'PAUSED', (t) => t.id);
    expect(text, `${AC[30]} ${name} paused is no next prompt`).not.toMatch(DUE_TEXT);
    expect(text, `${AC[30]} reads none: ${text.slice(0, 500)}`).toMatch(/no automatic prompt/i);
  }, 180_000);
  it(`${AC[30]} ACTIVE but targeting another thread: not this session's; an adapter that reads every active heartbeat as the session's fails here, naming ${'the automation'}`, async () => {
    const name = `beat-${tag()}`;
    const text = await stopWith(makeHome(), name, 'ACTIVE', () => '019a0000-0000-7000-8000-0000000000ff');
    expect(text.includes(name), `${AC[30]} the automation ${name} targets another thread, yet this session reads it`).toBe(false);
    expect(text, `${AC[30]} reads none: ${text.slice(0, 500)}`).toMatch(/no automatic prompt/i);
  }, 180_000);
});

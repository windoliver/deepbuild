// #965 starters the blind suite doesn't drive: your words sent from the app while a loop's turn runs, your answer to a
// deep_ask the turn made, each starting the journey at that turn's green stop; and a session that ends while its
// journey is held, which starts it. Through the real hub, deep-hook and deep mcp, on #965's acceptance world
// (tests/acceptance/965/helpers.ts).
import { readFileSync } from 'node:fs';
import net from 'node:net';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { answer } from '../../../tests/acceptance/29/h-d.ts';
import {
  allEvents, begin, cleanup, failureOf, heldOf, journeysOn, judgedAt, landing, runStarted, settle, shownHeld, stopHub,
  J, WAKE_LINE, type Ev, type Hub, type Line, type Run, type Session,
} from '../../../tests/acceptance/965/helpers.ts';

afterEach(cleanup, 60_000);

/** One request on an `app` connection with the control token, as the app sends it. */
function asApp(hub: Hub, method: string, params: Line): Promise<Line> {
  const token = readFileSync(join(hub.root, 'control.token'), 'utf8').trim();
  return new Promise((resolve, reject) => {
    const sock = net.connect(hub.socket);
    let buffer = '';
    let step = 0;
    sock.setEncoding('utf8');
    sock.on('error', reject);
    sock.on('data', (chunk: string) => {
      buffer += chunk;
      let i: number;
      while ((i = buffer.indexOf('\n')) >= 0) {
        const line = JSON.parse(buffer.slice(0, i)) as Line;
        buffer = buffer.slice(i + 1);
        if (step === 0) sock.write(`${JSON.stringify({ v: 1, hello: 'app', token })}\n`);
        else if (step === 1) sock.write(`${JSON.stringify({ v: 1, id: 1, method, params })}\n`);
        else if (line.id === 1) {
          sock.destroy();
          if (line.error) reject(Error(`${method} refused: ${JSON.stringify(line.error)}`));
          else resolve(line.result as Line);
        }
        step = Math.min(step + 1, 2);
      }
    });
  });
}

/** The turn's deep_ask through the session's own deep mcp, which you answer while the call waits. */
async function askedAndAnswered(r: Run): Promise<void> {
  const s = r.s as unknown as Session & { mcp(method: string, params: Line, notify?: boolean): Promise<Line>; mcpReady: boolean };
  if (!s.mcpReady) {
    await s.mcp('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'hub-965', version: '0' } });
    await s.mcp('notifications/initialized', {}, true);
    s.mcpReady = true;
  }
  const question = 'Round half up or half to even?';
  const args = { kind: 'choice', question, options: [{ id: 'up', label: 'Half up' }, { id: 'even', label: 'Half to even' }], recommended: 'up', steps: null, where: null, why: null, check: null, subject: null };
  let reply: Line = {};
  const call = s.call('mcp__deep__deep_ask', args, {
    effect: async () => {
      const asked = s.mcp('tools/call', { name: 'deep_ask', arguments: args });
      const [created] = (await settle(r.hub, (e) => e.some((x) => x.kind === 'ask.created' && x.session === s.id && x.data.question === question), 30_000))
        .filter((x) => x.kind === 'ask.created' && x.session === s.id && x.data.question === question);
      const answered = await answer(r.w, created!, 'up');
      if (answered.code !== 0) throw Error(`BLOCKED: deep inbox answer must exit 0: ${answered.stderr.slice(0, 600)}`);
      reply = await asked;
    },
    response: { content: [{ type: 'text', text: '{}' }] },
  });
  await call;
  if (!JSON.stringify(reply).includes('"up"')) throw Error(`BLOCKED: deep_ask came back without your answer: ${JSON.stringify(reply).slice(0, 1200)}`);
}

/** AC1's /loop session, with `starter` in its second turn: that turn's stop starts the journey, and the third holds again. */
async function loop(starter: 'words' | 'answer', plant?: string): Promise<void> {
  const r = await begin({ plant });
  const { hub, s, clock } = r;
  try {
    const snaps: Record<string, string | undefined> = {};
    for (let k = 1; k <= 3; k++) {
      await s.scheduled('/loop keep the cart total right');
      await s.editCart(k);
      if (k === 2 && starter === 'words') await asApp(hub, 'session.note', { session: s.id, text: 'Keep the rounding in one place.', request: `r${Date.now()}` });
      if (k === 2 && starter === 'answer') await askedAndAnswered(r);
      await s.wakeup(60);
      const seen = await s.stop(`Pass ${k}: the cart rounds each line.`);
      const { stop } = await judgedAt(hub, s, k, seen);
      snaps[`S${k}`] = stop.snapshot;
      let events: Ev[];
      if (k === 2) {
        events = await runStarted(hub, stop.snapshot);
        expect(journeysOn(events, stop.snapshot).map((x) => String(x.data.lane)), `stop 2: your ${starter} in the loop's turn starts the journey at its green stop, on S2`).toEqual(['slow']);
        expect(heldOf(events, J, snaps.S1)?.started_by, `stop 2: the held place starts by your ${starter}: ${shownHeld(events)}`).toBe(starter);
      } else {
        await landing();
        events = await allEvents(hub);
        expect(journeysOn(events, stop.snapshot), `stop ${k}: a loop's turn with none of your words or answers holds the journey`).toEqual([]);
        expect(seen.line, `stop ${k}: its line names the held journey`).toContain(WAKE_LINE);
      }
      if (k < 3) await clock.pass(seen.at + 55_000 - clock.now());
    }
  } finally {
    await stopHub(hub);
  }
}

it('your words sent from the app while a loop\'s turn runs start the journey at its stop; the next turn holds again', async () => {
  await loop('words');
}, 420_000);

it('your answer to the turn\'s deep_ask starts the journey at its stop; the next turn holds again', async () => {
  await loop('answer');
}, 420_000);

it('(wrong program) a runner that counts your words only when they start a turn fails at stop 2 for the app\'s words and your answer', async () => {
  for (const starter of ['words', 'answer'] as const) {
    const failure = await failureOf(() => loop(starter, 'words-only-at-turn-start'));
    expect(failure, `a runner that misses your ${starter} mid-turn must fail`).toContain('stop 2');
  }
}, 840_000);

it('a session that ends while its journey waits for the loop starts the journey', async () => {
  const { hub, s } = await begin();
  try {
    await s.scheduled('/loop keep the cart total right');
    await s.editCart(1);
    await s.wakeup(60);
    const seen = await s.stop('Pass 1: the cart rounds each line.');
    const { stop } = await judgedAt(hub, s, 1, seen);
    await landing();
    expect(journeysOn(await allEvents(hub), stop.snapshot), 'the turn scheduled its next wake-up, so the journey waits').toEqual([]);
    await s.hook('SessionEnd', { reason: 'prompt_input_exit' });
    const events = await runStarted(hub, stop.snapshot);
    expect(journeysOn(events, stop.snapshot).map((x) => String(x.data.lane)), 'the session ended, and its wake-up with it: the journey starts on S1').toEqual(['slow']);
    expect(heldOf(events, J, stop.snapshot)?.started_by, `the held place starts as the loop paused: ${shownHeld(events)}`).toBe('loop_paused');
  } finally {
    await stopHub(hub);
  }
}, 420_000);

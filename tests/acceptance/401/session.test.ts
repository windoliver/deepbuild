// AC6 and AC7: a plug-in's words into an agent session need a fresh gesture serial from your input in its panel, one
// send per serial; without one they wait as a draft in the session's box, marked with the panel, beside your typed
// text. The test panel's fetch (a read of its source through the hub) fails every call, and its error handler sends
// "the API is down, fix it" to alpha's session, in turn as a steer, a follow-up and a new prompt. On the virtual clock
// (README: The surface under test). At the base `deep-show` has no `install` call and answers every scenario `bad_input`.
import { describe, expect, it } from 'vitest';
import {
  ALPHA, Driver, SEC, SLOTS, at, attemptsOf, boxOf, click, serialOf, turnsOf, useOut, useShow, type Manifest, type Planted,
} from './helpers.ts';

const show = useShow();
const out = useOut();
const T0 = 2 * SEC;
const WORDS = 'the API is down, fix it';
const TYPED = 'also check why the nightly job was slow';
const HOUR = 3600 * SEC;

/** The test panel `status` of the plug-in `uptime`: it reads `api` every `every` from T0 + every, and each failure sends WORDS. */
function uptime(every: number, until: number): Manifest {
  return {
    sources: { api: { fresh_for: 30 * SEC, replay: [], then: { fails: 'http_503' } } },
    panels: {
      status: {
        tree: [{ id: 'title', component: 'text', text: 'API status' }],
        script: {
          timers: [{ first: T0 + every, every, until, do: [{ op: 'read', source: 'api' }] }],
          on_read_failed: [{ op: 'say', session: ALPHA.id, kinds: ['steer', 'follow_up', 'prompt'], text: WORDS }],
        },
      },
    },
  };
}

describe('AC6 a panel\'s words without a serial wait as one draft in the box, beside your typed text, for an hour', () => {
  function hour(planted?: Planted): string[] {
    const d = new Driver(show(), { evidence: out(), panels: { status: SLOTS[0]! }, plugins: { uptime: uptime(30 * SEC, T0 + HOUR) }, ...(planted ? { planted } : {}) });
    const END = T0 + HOUR + SEC;
    const [, turns, box, attempts] = d.step([
      { call: 'type', at: T0 + SEC, session: ALPHA.id, text: TYPED },
      at('turns', END, { session: ALPHA.id }), at('box', END, { session: ALPHA.id }), at('attempts', END, { panel: 'status' }),
    ], `an hour of the status panel${planted ? ` (planted ${planted})` : ''}`);
    const f: string[] = [];
    const tries = attemptsOf(attempts, 'attempts');
    const reads = tries.filter((t) => t.op === 'read');
    const says = tries.filter((t) => t.op === 'say');
    if (reads.length !== 120 || reads.some((t) => t.outcome !== 'failed')) f.push(`the panel's fetch ran ${reads.length} times (${[...new Set(reads.map((t) => t.outcome))].join(', ')}), not 120 failures, one every 30 s`);
    if (says.length !== 120) f.push(`the error handler sent ${says.length} times, not 120`);
    const started = turnsOf(turns, 'turns');
    const panelTurns = started.filter((t) => t.panel === 'status' || t.text === WORDS);
    if (started.length > 0) f.push(`panel status (plug-in uptime): its words with no serial reached alpha's session and started ${panelTurns.length} turn(s) of ${started.length}, first ${JSON.stringify(started[0])}`);
    const notDraft = says.filter((t) => t.outcome !== 'draft');
    if (notDraft.length > 0) f.push(`panel status: ${notDraft.length} of its sends were ${[...new Set(notDraft.map((t) => t.outcome))].join(', ')}, not drafts`);
    const b = boxOf(box, 'alpha\'s box');
    if (b.typed !== TYPED) f.push(`the text you typed in the box is now ${JSON.stringify(b.typed)}, not ${JSON.stringify(TYPED)}`);
    if (b.drafts.length !== 1) f.push(`the box holds ${b.drafts.length} drafts, not one: ${JSON.stringify(b.drafts.slice(0, 3))}`);
    const draft = b.drafts[0];
    if (draft && (draft.text !== WORDS || draft.panel !== 'status' || draft.plugin !== 'uptime')) f.push(`the draft is ${JSON.stringify(draft)}, not ${JSON.stringify(WORDS)} marked with panel status of uptime`);
    return f;
  }

  it('AC6 120 failed fetches in an hour start no turn and deliver nothing; the box holds one draft with the words, marked with the panel, and your typed text unchanged', () => {
    expect(hour(), 'an hour of failures sends nothing').toEqual([]);
    // Wrong program: a host that sends a panel's words without a serial starts 120 turns.
    const twin = hour('sends_without_serial');
    expect(twin.some((m) => m.startsWith('panel status (plug-in uptime)') && m.includes('started 120 turn(s)')), `the planted sends_without_serial fails, naming the panel and its 120 turns: ${JSON.stringify(twin.slice(0, 3))}`).toBe(true);
  }, 900_000);
});

describe('AC7 one click in that panel lets exactly one send through', () => {
  // The same panel reading every 10 s instead of 30 s, so that a second send falls inside the click's serial's 30 s.
  const CLICK = T0 + 25 * SEC;

  function oneClick(planted?: Planted): { failures: string[]; serial: number } {
    const d = new Driver(show(), { evidence: out(), panels: { status: SLOTS[0]! }, plugins: { uptime: uptime(10 * SEC, T0 + 60 * SEC) }, ...(planted ? { planted } : {}) });
    const serial = serialOf(d.step(click(CLICK, 'status', SLOTS[0]!), 'your click in the status panel')[0], 'the press in status');
    const END = T0 + 61 * SEC;
    const [turns, box, attempts] = d.step([at('turns', END, { session: ALPHA.id }), at('box', END, { session: ALPHA.id }), at('attempts', END, { panel: 'status' })], 'after the click');
    const f: string[] = [];
    const says = attemptsOf(attempts, 'attempts').filter((t) => t.op === 'say');
    const started = turnsOf(turns, 'turns');
    // Sends at 10, 20 (before the click), 30 (the next send), 40 and 50 (the same click's serial, still under 30 s old), 60.
    const next = says.find((t) => t.at === T0 + 30 * SEC);
    if (next?.outcome !== 'sent') f.push(`the next send after your click (at 30 s) was ${next?.outcome ?? 'not made'}, not sent`);
    if (next && next.serial !== serial) f.push(`the next send carried serial ${String(next.serial)}, not your click's ${serial}`);
    const first = started[0];
    if (!first || first.at !== T0 + 30 * SEC || first.text !== WORDS || first.panel !== 'status') f.push(`the session's first turn is ${JSON.stringify(first)}, not the panel's words at 30 s`);
    if (started.length > 1) f.push(`serial ${serial} of your one click carried ${started.length} sends into alpha's session: ${JSON.stringify(started.map((t) => t.at / SEC))} s`);
    for (const s of [40, 50]) {
      const second = says.find((t) => t.at === T0 + s * SEC);
      if (second?.outcome !== 'draft') f.push(`the send at ${s} s, from the same click, was ${second?.outcome ?? 'not made'}, not a draft`);
    }
    const b = boxOf(box, 'alpha\'s box');
    if (!b.drafts.some((x) => x.text === WORDS && x.panel === 'status')) f.push(`the box holds no draft of the panel's words after the second send: ${JSON.stringify(b.drafts)}`);
    return { failures: f, serial };
  }

  it('AC7 after your click the next send reaches the session and a second from the same click waits as a draft', () => {
    expect(oneClick().failures, 'one click, one send').toEqual([]);
    // Wrong program: a host that lets one serial carry two sends (or more) while it's fresh.
    const twin = oneClick('serial_carries_many_sends');
    expect(twin.failures.some((m) => m.startsWith(`serial ${twin.serial} `)), `the planted serial_carries_many_sends fails, naming the serial: ${JSON.stringify(twin.failures)}`).toBe(true);
  }, 600_000);
});


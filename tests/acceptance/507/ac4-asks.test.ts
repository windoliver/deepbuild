// AC4 #507.bd1e985c: "With two displays and present mode on display B, an ask created while presenting opens its card
// on display A within 1 s, and neither the card nor a toast raised then draws on B, checked on B's presented frames;
// with one display, the same ask only adds one to the menu bar's count, draws nothing on the presented frames, starts
// its deadline when present mode ends, and its card then opens"
//
// The nine-stage piece (helpers.ts `ninePiece`) presented full screen; → at 1 s plays it from stage 1 toward stage 2,
// so its display presents frames from 1 s to 5 s. The ask (#400's scenario `card`, with a 60 s `deadline`) is created at
// 3 s. With two displays your latest input before it is on B (a click on the piece at 0.9 s and → at 1 s), so a card
// that follows your input would open on B; a plug-in's panel on A raises a toast at 3.5 s (#401's script `toast` op,
// with the serial of your click there at 0.5 s). With one display, Esc at 7 s ends present mode. Wrong programs: a card
// or toast drawn on the presented display, a card that waits or opens late, a deadline that runs while the card can't
// show, a card that never opens once present mode ends.
import { describe, expect, it } from 'vitest';
import {
  A, ASK, B, DISPLAY_A, DISPLAY_B, DOC, Driver, FILM_PANEL, MS, TIMEOUT, TOOL_PANEL, arr, cardState, click, enterPresent, fl, framesOf, int,
  key, menuBar, ninePiece, none, obj, presentEntry, presentOf, presentState, secs, show, shownFrames, str, useShow, useTemp, type JsonObject,
} from './helpers.ts';

const ID = 'AC4 #507.bd1e985c';
const bin = useShow();
const temp = useTemp();

const ASKED = fl(3);
const DEADLINE = fl(60);
const CARD: JsonObject = {
  ask: ASK, question: 'Send the handout to the room now?', options: [{ id: 'send', label: 'Send' }, { id: 'wait', label: 'Wait' }],
  size: [360, 180], at: ASKED, deadline: DEADLINE,
};
interface Card { display: string | null; states: { state: string; at: number }[]; deadlineAt: number | null; raw: JsonObject }
function cardOf(reply: JsonObject | undefined, what: string): Card {
  const c = obj(obj(reply, what)['card'], `${what}: card`);
  const states = arr(c['states'], `${what}: card.states`).map((s, i) => { const o = obj(s, `${what}: states[${i}]`); return { state: str(o['state'], 'state'), at: int(o['at'], 'at') }; });
  expect('deadline_at' in c, `${what}: card.deadline_at is reported (null while it hasn't started): ${show(c)}`).toBe(true);
  return { display: typeof c['display'] === 'string' ? c['display'] : null, states, deadlineAt: c['deadline_at'] === null ? null : int(c['deadline_at'], `${what}: card.deadline_at`), raw: c };
}

describe(`${ID} an ask while presenting: on the other display, or waiting in the menu bar with one display`, () => {
  it(`${ID} with present mode on B, the ask's card opens on A within 1 s, and neither it nor a toast raised then draws on B`, () => {
    const d = new Driver(bin(), { evidence: temp(), displays: [DISPLAY_A, DISPLAY_B], doc: DOC.nine, tool: true, card: CARD });
    const [installed] = d.step([{
      call: 'install', at: MS, plugin: 'notes-tool',
      manifest: { panels: { [TOOL_PANEL]: { tree: [{ id: 'label', component: 'text', text: 'Tool' }], script: { timers: [{ first: fl(3.5), every: fl(10), until: fl(3.5), do: [{ op: 'toast', text: 'Saved your place' }] }] } } } },
    }], 'the plug-in installed');
    expect(obj(installed, 'install')['installed'], `the plug-in is installed: ${show(installed)}`).toBe(true);
    enterPresent(d, DOC.nine, ninePiece(), B, 'the nine-stage piece on B');
    const r = d.step([
      ...click(fl(0.5), TOOL_PANEL, [100, 100]),
      ...click(fl(0.9), FILM_PANEL, [960, 540]),
      key(fl(1), 'ArrowRight'),
      { call: 'attempts', at: fl(3.6), panel: TOOL_PANEL },
      { call: 'toasts', at: fl(3.6) },
      presentState(fl(4)),
      cardState(fl(4)),
      framesOf(fl(6)),
    ], 'the ask while presenting on B');
    presentEntry(r[4], 'advance', '→ on stage 1');
    const failures: string[] = [];
    const tried = arr(obj(r[5], 'attempts')['attempts'], 'attempts').map((a, i) => obj(a, `attempts[${i}]`));
    if (!tried.some((a) => a['op'] === 'toast' && a['outcome'] === 'done')) failures.push(`the plug-in's toast at 3.5 s was not raised: ${show(tried)}`);
    for (const t of arr(obj(r[6], 'toasts')['toasts'], 'toasts').map((x, i) => obj(x, `toasts[${i}]`))) {
      if (t['shown'] === true && t['display'] === B) failures.push(`a toast draws on B, the presented display: ${show(t)}`);
    }
    const p = presentOf(r[7], 'present at 4 s');
    if (!p.on || p.display !== B) failures.push(`present mode isn't on B at 4 s: ${show(p.raw)}`);
    const card = cardOf(r[8], 'the card at 4 s');
    const first = card.states[0];
    if (card.display !== A) failures.push(`the card opens on ${String(card.display)}, not on display A`);
    if (!first || first.state !== 'presented' || first.at < ASKED || first.at > ASKED + fl(1)) failures.push(`the card is not presented within 1 s of the ask at 3 s: ${show(card.raw)}`);
    const onB = shownFrames(r[9], 'the piece\'s frames').filter((f) => f.display === B && f.vsync >= ASKED && f.vsync <= fl(6));
    if (onB.length < 30) failures.push(`B presented ${onB.length} frames of the playing piece from 3 s to 6 s, too few to check`);
    for (const f of onB) if (f.over.includes('card') || f.over.includes('toast')) failures.push(`B's frame at ${secs(f.vsync)} draws ${f.over.join(', ')} over the piece`);
    none(failures, 'the ask and the toast with present mode on B');
  }, TIMEOUT);

  it(`${ID} with one display, the ask only adds one to the menu bar's count, draws nothing, and starts its deadline and opens when present mode ends`, () => {
    const d = new Driver(bin(), { evidence: temp(), displays: [DISPLAY_A], doc: DOC.nine, card: CARD });
    enterPresent(d, DOC.nine, ninePiece(), A, 'the nine-stage piece on the one display');
    const ENDED = fl(7);
    const r = d.step([
      key(fl(1), 'ArrowRight'),
      menuBar(fl(2.5)), menuBar(fl(3.5)),
      cardState(fl(3.5)), cardState(fl(6.5)), framesOf(fl(6.5)),
      key(ENDED, 'Escape'),
      presentState(fl(7.5)),
      cardState(fl(8.5)),
    ], 'the ask while presenting on the one display');
    presentEntry(r[0], 'advance', '→ on stage 1');
    const failures: string[] = [];
    const count = (x: JsonObject | undefined, what: string): number => int(obj(x, what)['count'], `${what}: count`);
    const [c0, c1] = [count(r[1], 'the menu bar at 2.5 s'), count(r[2], 'the menu bar at 3.5 s')];
    if (c1 !== c0 + 1) failures.push(`the menu bar's count goes from ${c0} to ${c1} with the ask, not up by one`);
    for (const [i, at] of [[3, 3.5], [4, 6.5]] as const) {
      const c = cardOf(r[i], `the card at ${at} s`);
      if (c.states.length !== 0) failures.push(`at ${at} s, in present mode, the card has been ${show(c.states)}`);
      if (c.deadlineAt !== null) failures.push(`at ${at} s, in present mode, the ask's deadline has started (${secs(c.deadlineAt)})`);
    }
    const onA = shownFrames(r[5], 'the piece\'s frames').filter((f) => f.display === A && f.vsync >= ASKED && f.vsync <= fl(6.5));
    if (onA.length < 30) failures.push(`the display presented ${onA.length} frames of the playing piece from 3 s to 6.5 s, too few to check`);
    for (const f of onA) if (f.over.length) failures.push(`the presented frame at ${secs(f.vsync)} draws ${f.over.join(', ')} over the piece`);
    if (presentOf(r[7], 'present at 7.5 s').on) failures.push('present mode still runs after Esc');
    const after = cardOf(r[8], 'the card at 8.5 s');
    const first = after.states[0];
    if (!first || first.state !== 'presented' || first.at < ENDED || first.at > ENDED + fl(1)) failures.push(`the card doesn't open within 1 s of present mode ending at 7 s: ${show(after.raw)}`);
    if (after.display !== A) failures.push(`the card opens on ${String(after.display)}, not on the one display`);
    if (after.deadlineAt === null || after.deadlineAt - DEADLINE < ENDED || after.deadlineAt - DEADLINE > ENDED + fl(0.1)) failures.push(`the deadline isn't 60 s from present mode's end at 7 s: deadline_at ${after.deadlineAt === null ? 'null' : secs(after.deadlineAt)}`);
    none(failures, 'the ask with one display');
  }, TIMEOUT);
});

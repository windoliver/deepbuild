// AC3: windows on 60 Hz and 120 Hz displays present at their own rates, and each frame shows every writer's newest
// revision at the latch. On the hub's virtual display clock (#96's, per display here: A at 120 Hz, B at 60 Hz 3 ms
// out of phase, each latch 2 ms before its vsync, 0.5 ms of the checker per patch), so a run reads no wall time and
// replays exactly. Two agents patch two shared boards, x in the main window on A and y popped out onto B, faster
// than either display refreshes, so each window has something new at every latch and presents a frame at every vsync
// of its own display, and at none of the other's; when they stop, nothing more is drawn. At the base `deep-show`
// reads no `displays` and answers the scenario `bad_input`.
import { describe, expect, it } from 'vitest';
import {
  A, ALPHA, B, BRAVO, DOC, Driver, LEAD, MS, PERIOD_A, PERIOD_B, clickPanel, framesOf, num, obj, onGrid, opened, popOut, presentedCall, sharedBoard, ulid,
  useOut, useShow, type Display, type Frame, type JsonObject, type Planted,
} from './helpers.ts';

const show = useShow();
const out = useOut();
const T0 = 20 * PERIOD_A;
const S0 = T0 + 200 * MS; // the first patch
const PATCHES = 150; // per board: one every 2 ms for 300 ms, alpha and bravo by turns
const SPAN: [number, number] = [S0 + 20 * MS, S0 + 270 * MS]; // 250 ms: 30 vsyncs of A, 15 of B
const QUIET = S0 + 330 * MS; // past the last patch's check, its latch and the frame that shows it on either display
const END = S0 + 900 * MS;

interface Sent { doc: string; writer: string; rev: number; checked: number }
interface Run { sent: Sent[]; x: Frame[]; y: Frame[]; main: string; popped: string }

function run(planted?: Planted): Run {
  const what = `two agents writing on two displays${planted ? ` (planted ${planted})` : ''}`;
  const d = new Driver(show(), {
    evidence: out(), displays: [A, B], ...(planted ? { planted } : {}),
    docs: [
      { doc: DOC.x, panel: 'x', document: sharedBoard('Orders, live'), seed: true },
      { doc: DOC.y, panel: 'y', document: sharedBoard('Refunds, live'), seed: true },
    ],
  });
  const sy = clickPanel(d, T0, 'y', what);
  const y = opened(d.one(popOut(T0 + 100 * MS, 'y', B.uuid, sy), `${what}: pop y out onto B`), `${what}: pop y out onto B`);
  const [w] = d.step([{ call: 'windows', at: T0 + 150 * MS }], `${what}: windows`);
  const main = (obj(w, 'windows')['windows'] as JsonObject[] | undefined)?.find((x) => x['kind'] === 'main')?.['window'];
  const calls: JsonObject[] = [];
  const meta: { doc: string; writer: string }[] = [];
  for (const [doc, offset, prefix] of [[DOC.x, 0, '01JB400P'], [DOC.y, MS, '01JB400Q']] as const) {
    for (let k = 0; k < PATCHES; k++) {
      const who = k % 2 === 0 ? ALPHA : BRAVO;
      const tag = who === ALPHA ? 'alpha' : 'bravo';
      calls.push({
        call: 'deep_show', session: who.id, doc, at: S0 + offset + k * 2 * MS,
        // Each patch adds a dot of its writer's own on base 0, so every one rebases cleanly whenever it arrives (#96).
        patch: {
          patch: ulid(prefix, k + 1), doc, base: 0, reason: 'add a dot',
          ops: [{ op: 'create', item: { id: `${tag}.d${k}`, kind: 'rect@1', name: `Dot ${k}`, order: `b${String(k).padStart(3, '0')}`, params: { box: [0, 0, 8, 8], paint: { fill: { role: 'ink' } } }, at: { pos: [10 + 12 * (k % 45), 20 + 12 * Math.floor(k / 45), 0] } } }],
        },
      });
      meta.push({ doc, writer: tag });
    }
  }
  calls.push(presentedCall(END, 'x'), presentedCall(END, 'y'));
  const r = d.step(calls, `${what}: the patches`);
  const sent = meta.map((m, i) => {
    const p = r[i]!;
    expect(p['outcome'], `patch ${i + 1} (${m.writer} on ${m.doc === DOC.x ? 'x' : 'y'}) applies: ${JSON.stringify(p).slice(0, 400)}`).toBe('applied');
    return { ...m, rev: num(p['rev'], `patch ${i + 1}: rev`), checked: num(p['checked'], `patch ${i + 1}: checked`) };
  });
  return { sent, x: framesOf(r[meta.length], `${what}: x's frames`), y: framesOf(r[meta.length + 1], `${what}: y's frames`), main: typeof main === 'string' ? main : '(no main window)', popped: y.window };
}

/** What one window's frames got wrong against its own display: rate, phase, pacing display, window, frame_seq, and the revision at each latch. */
function windowFailures(r: Run, name: 'x' | 'y', display: Display, window: string): string[] {
  const f: string[] = [];
  const frames = r[name];
  const doc = name === 'x' ? DOC.x : DOC.y;
  const label = display === A ? 'A (120 Hz)' : 'B (60 Hz)';
  const inSpan = frames.filter((fr) => fr.vsync >= SPAN[0] && fr.vsync < SPAN[1]);
  const want = (SPAN[1] - SPAN[0]) / (display === A ? PERIOD_A : PERIOD_B);
  if (inSpan.length !== want) f.push(`window ${name} presented ${inSpan.length} frames in 250 ms, not ${want}, its display ${label}'s rate`);
  for (const fr of frames.filter((x) => x.vsync >= S0)) {
    if (!onGrid(display, fr.vsync)) f.push(`window ${name}'s frame at ${fr.vsync} is not at a vsync of ${label}`);
    if (fr.display !== display.uuid) f.push(`window ${name}'s frame at ${fr.vsync} is paced by ${fr.display}, not ${label}`);
    if (fr.window !== window) f.push(`window ${name}'s frame at ${fr.vsync} names window ${fr.window}, not ${window}`);
  }
  inSpan.forEach((fr, i) => { if (i > 0 && fr.frame_seq !== inSpan[i - 1]!.frame_seq + 1) f.push(`window ${name}'s frame_seq goes ${inSpan[i - 1]!.frame_seq} → ${fr.frame_seq} between consecutive frames`); });
  // Every writer's newest revision at the latch: the frame at vsync v shows exactly the newest revision checked by v − lead.
  const mine = r.sent.filter((s) => s.doc === doc);
  for (const fr of inSpan) {
    const latch = fr.vsync - LEAD;
    for (const writer of ['alpha', 'bravo']) {
      const newest = Math.max(0, ...mine.filter((s) => s.writer === writer && s.checked <= latch).map((s) => s.rev));
      if (newest > fr.rev) f.push(`window ${name}'s frame at ${fr.vsync} shows revision ${fr.rev}, older than ${writer}'s newest revision ${newest} checked by its latch ${latch}`);
    }
    const unchecked = mine.filter((s) => s.rev <= fr.rev && s.checked > latch);
    if (unchecked.length > 0) f.push(`window ${name}'s frame at ${fr.vsync} shows revision ${fr.rev}, holding ${unchecked.length} patch(es) not yet checked at its latch ${latch}`);
  }
  // Never drawn unasked: once the writers stop, nothing new reaches the window, and it presents nothing.
  const late = frames.filter((fr) => fr.vsync > QUIET);
  if (late.length > 0) f.push(`window ${name} presented ${late.length} frame(s) after the last patch had shown, with nothing new to draw (first at ${late[0]!.vsync})`);
  return f;
}

describe('AC3 windows on 60 Hz and 120 Hz displays present at their own rates, and each frame shows every writer\'s newest revision at the latch', () => {
  it('AC3 x on A presents at 120 Hz and y on B at 60 Hz, each at its own display\'s vsyncs, each frame with alpha\'s and bravo\'s newest revisions at its latch', () => {
    const r = run();
    expect([...windowFailures(r, 'x', A, r.main), ...windowFailures(r, 'y', B, r.popped)], 'each window paced by its own display, with every writer\'s newest revision at its latch').toEqual([]);
    // Wrong program: one clock, the main display's, paces both windows; y then fails, naming its display.
    const twin = run('one_clock_for_all');
    const failed = windowFailures(twin, 'y', B, twin.popped);
    expect(failed.some((m) => m.includes('B (60 Hz)')), `the planted one_clock_for_all fails on y: ${JSON.stringify(failed.slice(0, 3))}`).toBe(true);
  }, 900_000);
});

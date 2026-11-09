// AC3: the frame clock's kit case, armed evaluation against every vsync, stays byte-identical over the visible
// region. Judged on any machine. The kit case runs the board over its span plus 5 s (4 s + 5 s) on a virtual
// 60 Hz display, once armed and once evaluating every vsync, with the view panned card → spinner → card → note.
// The wrong programs: the base (it never sleeps, so the comparison holds only because nothing is skipped), the
// planted `view_meets_by_center` (an item counts only when its center is in view) and the planted
// `return_draws_stale_value`.
import { describe, expect, it } from 'vitest';
import {
  MOTION_BIN, V_CARD, V_NOTE, V_SPIN, VSYNC_60, batch, compareVisible, fixture, isObject, presentedIn, regionOf, rotZ, run, sec,
  secondsOf, useBinaries, viewAt, type JsonValue, type Pan, type Vsync,
} from './helpers.ts';

useBinaries('deep-motion');

const DOC = fixture('board.json');
const TO = sec(9);
const PANS: Pan[] = [{ at: sec(2), rect: V_SPIN }, { at: sec(4), rect: V_CARD }, { at: sec(6), rect: V_NOTE }];

const kit = (mode: 'armed' | 'every_vsync', planted?: string): Vsync[] =>
  run({ doc: DOC, to: TO, mode, view: V_CARD, pans: PANS, ...(planted ? { planted } : {}) });

describe('AC3 the frame clock\'s kit case, armed evaluation against every vsync, stays byte-identical over the visible region', () => {
  it('AC3 armed and every-vsync runs agree byte for byte over the view at all 541 vsyncs, while the armed run sleeps once only still items are in view', () => {
    const armed = kit('armed');
    const every = kit('every_vsync');
    expect(every.every((v) => v.presented), 'the every-vsync run presents at every vsync').toBe(true);
    // Not vacuous: the armed run must skip what the view doesn't show. The base arms one per frame here.
    const asleep = presentedIn(armed, sec(6), TO);
    expect(asleep.length, `with only the still note in view the armed run presents nothing after the pan at 6 s; it presented ${asleep.length}`).toBe(0);
    expect(compareVisible(DOC, armed, every, V_CARD, PANS), 'the armed run shows what an every-vsync run evaluates, over the view').toBeNull();
    // And it presents wherever something visible moves: edge's box reaches into the card view though its center doesn't.
    const missing = armed.filter((v) => v.t < sec(6) && !v.presented).map((v) => secondsOf(v.t));
    expect(missing.slice(0, 5), 'a frame at every vsync before 6 s: edge turns in the card view, the spinner in its own').toEqual([]);
    expect(armed[sec(6) / VSYNC_60]!.presented, 'the pan to the note arms a frame').toBe(true);
    // The loops really move, and the view really leaves them.
    expect(rotZ(every[1]!.items, 'edge', 'every vsync 1'), 'edge turns between vsyncs').not.toBe(rotZ(every[0]!.items, 'edge', 'every vsync 0'));
    expect(rotZ(every[sec(7) / VSYNC_60]!.items, 'spinner', 'every 7 s'), 'the spinner turns on, out of view').not.toBe(rotZ(every[sec(6.5) / VSYNC_60]!.items, 'spinner', 'every 6.5 s'));
    const shown = regionOf(DOC, every[0]!.items, viewAt(V_CARD, PANS, 0), 'every vsync 0');
    expect(shown.inside, 'the card view holds the card and edge, and not the spinner').toEqual(['card', 'edge']);
  });

  it('AC3 (wrong program) the planted view_meets_by_center, which counts an item only when its center is in view, stops on the card view and fails the comparison, naming edge', () => {
    const armed = kit('armed', 'view_meets_by_center');
    const every = kit('every_vsync');
    expect(presentedIn(armed, 0, sec(2) - VSYNC_60), 'the planted clock presents nothing after the first frame on the card view').toEqual([]);
    const failure = compareVisible(DOC, armed, every, V_CARD, PANS);
    expect(failure, 'the comparison fails on the planted twin').not.toBeNull();
    expect(failure!, 'at the first vsync after the first frame').toMatch(/^at vsync 1 \(t = 11760000 flicks/);
    expect(failure!, 'naming edge, whose box meets the view').toMatch(/item edge\b/);
    expect(failure!, 'and only edge').not.toMatch(/item (card|note|spinner)\b/);
  });

  it('AC3 (wrong program) the planted return_draws_stale_value fails the comparison at the first pan that brings a looping item into view, at 2 s, naming the spinner', () => {
    const armed = kit('armed', 'return_draws_stale_value');
    const every = kit('every_vsync');
    const failure = compareVisible(DOC, armed, every, V_CARD, PANS);
    expect(failure, 'the comparison fails on the planted twin').not.toBeNull();
    expect(failure!, 'at the pan to the spinner view, 2 s').toMatch(new RegExp(`^at vsync ${sec(2) / VSYNC_60} \\(`));
    expect(failure!, 'naming the spinner, drawn with its data from the frame before the pan').toMatch(/item spinner\b/);
  });

  it('AC1 AC2 AC3 the run reads its view: a view rect that is not four numbers with a positive size, a pan off a vsync, pans out of order and an unknown planted value each answer bad_input', () => {
    const base = { doc: DOC, to: sec(1), mode: 'armed', refresh_hz: 60 };
    const lines: JsonValue[] = [
      { ...base, view: { rect: [0, 0, 960] } },
      { ...base, view: { rect: [0, 0, 0, 540] } },
      { ...base, view: { rect: 'all' } },
      { ...base, view: { rect: V_CARD }, pans: [{ at: VSYNC_60 + 1, rect: V_SPIN }] },
      { ...base, view: { rect: V_CARD }, pans: [{ at: 2 * VSYNC_60, rect: V_SPIN }, { at: VSYNC_60, rect: V_CARD }] },
      { ...base, view: { rect: V_CARD }, planted: 'no_such_plant' },
      { ...base, view: { rect: V_CARD } },
    ];
    const answers = batch(MOTION_BIN, ['run'], lines);
    const refusals = answers.slice(0, -1).map((a) => (isObject(a) ? { ok: a['ok'], code: a['code'] ?? null } : a));
    expect(refusals, 'each malformed line is refused as bad_input').toEqual(refusals.map(() => ({ ok: false, code: 'bad_input' })));
    const last = answers.at(-1);
    expect(isObject(last) && last['ok'] === true, `the well-formed line is accepted: ${JSON.stringify(last).slice(0, 300)}`).toBe(true);
  });
});

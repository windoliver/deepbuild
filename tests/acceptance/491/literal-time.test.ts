// Criterion 4: "A cue written as a literal 12.5 s in a film with a tempo map raises literal_time_with_tempo_map, and
// the bar:beat form it offers lands on the same flick"
//
// Through `deep-motion eval`. A film whose tempo map runs 96 BPM in 4/4 for 4 bars (10 s), then 120 BPM in 4/4, and
// a cue marker `hit` written as the literal `12.5s`. The document is accepted (a notice is not a refusal), the cue at
// 12.5 s, and the answer's `notices` hold one with code `literal_time_with_tempo_map` naming the cue, whose offered
// fix includes a bar:beat form (a string `<bar>:<beat>b`). Written back as the cue's time, that form must resolve to
// the same flick, 8,820,000,000. No upstream test (oracle page).
import { describe, expect, it } from 'vitest';
import { TIMEOUT, arr, evalOk, film, fl, isObject, markerT, mentions, segment, show, stringsIn, tempoMap, useMotion, type JsonObject } from './helpers.ts';

const motion = useMotion();
const map = tempoMap([segment('0s', 96, [4, 4], 16), segment('5:1b', 120, [4, 4], 8)]);
const cueDoc = (t: string): JsonObject => film('literal', [], { tempo_map: map, markers: { hit: { kind: 'cue', t } } }, { span: '14s' });

describe('criterion 4: a literal time in a film with a tempo map raises literal_time_with_tempo_map', () => {
  it('criterion 4: the cue at the literal 12.5 s raises literal_time_with_tempo_map, and the bar:beat form it offers lands on the same flick', () => {
    const a = evalOk(motion.bin(), { doc: cueDoc('12.5s'), times: [0] }, 'the literal cue');
    expect(markerT(a, 'hit', 'the literal cue'), 'the literal cue resolves to 12.5 s').toBe(fl(12.5));
    const notices = arr(a.notices ?? null, 'the answer\'s notices');
    const notice = notices.find((n) => isObject(n) && n['code'] === 'literal_time_with_tempo_map' && mentions(n, 'hit'));
    expect(notice, `a literal_time_with_tempo_map notice names the cue hit: ${show(notices)}`).toBeDefined();
    const forms = stringsIn(notice).filter((s) => /^\d+:\d+b$/.test(s));
    expect(forms.length, `the notice offers a bar:beat form: ${show(notice)}`).toBeGreaterThan(0);
    const b = evalOk(motion.bin(), { doc: cueDoc(forms[0]!), times: [0] }, `the cue written as the offered ${forms[0]}`);
    expect(markerT(b, 'hit', `the cue at ${forms[0]}`), `the offered form ${forms[0]} lands on the literal's flick`).toBe(fl(12.5));
  }, TIMEOUT);
});

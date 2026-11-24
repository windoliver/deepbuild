// AC6 #3236.310067e5: "A document with a pick control on the same set behaves as #539 says, unchanged, and gains no
// second Tab stop"
//
// The fixture scatter with #539's pick control `place` on its rows, with `focus` (one Tab stop, the default label the
// key), and the slider `speed` after it. As #539 says (Control: picks on rows and grid focus), and as the base already
// does on drawn rows: Tab enters the rows at the first drawn row, `scatter#0`; Right follows reading order over the
// drawn rows, #1, #2, #3, #4, then #6 past the missing row 5; each landing is announced by its label, the key (its
// text's integers exactly [key]); no key appends an entry, and Enter appends one pick `{control: place, value: {set: 0,
// key: [6, 0]}}`, the track's only entry. Then Tab focuses `speed`, and the next Tab leaves the document's stops
// (focus none), as at #539: no second stop for the set's reading focus before or after the controls.
// Wrong programs: a reading focus beside the pick control's (a second Tab stop); announcements of values instead of
// the control's label; the missing row focused.
import { describe, it } from 'vitest';
import { DOC, SCATTER, pickControl, rowId, scatterDoc, slider } from './fixtures.ts';
import {
  AC, Script, TIMEOUT, appendedOf, binOf, entryText, fociOf, intsOf, none, prebuild, presented, rowAnnouncements, runShow, scenario, seenOf, show,
  trackOf, useTemp,
} from './helpers.ts';

prebuild();
const temp = useTemp();
const D = DOC(6);
const WALK = [0, 1, 2, 3, 4, 6];

describe(`${AC[6]} a pick control on the same set keeps #539's focus, and the set gains no second Tab stop`, () => {
  it(`${AC[6]} with a pick control on the scatter, Tab, Right, Enter and Tab behave as #539 says, and Tab finds no second stop`, () => {
    const s = new Script();
    s.present(D, scatterDoc(D, { controls: { place: pickControl([SCATTER]), speed: slider('Speed') } }));
    s.scope();
    const keys = [s.key('Tab'), ...WALK.slice(1).map(() => s.key('ArrowRight'))];
    const enter = s.key('Enter');
    const tabs = [s.key('Tab'), s.key('Tab')];
    const seen = s.see();
    const track = s.track(D);
    const r = runShow(binOf(), scenario(temp(), [D], s.calls), 'AC6 the pick control on the scatter');
    presented(r[0]!, 'the scatter with a pick control');
    const f: string[] = [];
    const foci = fociOf(r, keys, 'the walk');
    const want = WALK.map((k) => rowId(SCATTER, k));
    if (show(foci) !== show(want)) f.push(`Tab and Right focus ${show(foci)}, not #539's ${show(want)}`);
    keys.forEach((i, k) => { for (const e of appendedOf(r[i]!, `key ${k + 1}`)) f.push(`key ${k + 1} appends ${entryText(e)}; moving the focus writes no entry`); });
    const picks = appendedOf(r[enter]!, 'Enter');
    const pick = picks.length === 1 ? picks[0]! : null;
    if (!pick || pick['control'] !== 'place' || show(pick['value']) !== show({ set: 0, key: [6, 0] })) f.push(`Enter on ${rowId(SCATTER, 6)} appends ${show(picks.map(entryText))}, not one entry of place with {set: 0, key: [6, 0]}`);
    const after = fociOf(r, tabs, 'the Tabs after Enter');
    if (show(after) !== show(['speed', null])) f.push(`after the rows, Tab focuses ${show(after[0])} and then ${show(after[1])}, not speed and then nothing: a second Tab stop`);
    const heard = rowAnnouncements(seenOf(r[seen]!, 'see'), SCATTER);
    if (show(heard.map((a) => a.id)) !== show(want)) f.push(`the rows are announced as ${show(heard.map((a) => a.id))}, not once each for ${show(want)}`);
    for (const a of heard) if (show(intsOf(a.text)) !== show([Number(a.id.slice(SCATTER.length + 1))])) f.push(`${a.id} is announced as ${JSON.stringify(a.text)}, not by its label, the key`);
    const held = trackOf(r[track]!, 'the track');
    if (held.length !== 1) f.push(`the input track holds ${show(held.map(entryText))}, not the one pick`);
    none(f, 'the pick control on the scatter');
  }, TIMEOUT);
});

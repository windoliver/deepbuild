// AC6 #222.46f1db03: "film.layout (#99) runs at the end of each `cues.<id>` marker a cue list writes, as it does at
// every other cue end"
//
// A 1920 × 1080 film (#408's form, stored as revision 0, judged through a claim whose one requirement is
// `{kind: "film.layout"}` at its defaults): the text@1 label `tag` ("Speed", 32 u, centred in its 240 × 42 box at
// (496, 479), as #408's), and the path@1 `bar`, a 4 u line from x = 300 to 900 at y = 100, above the label. Its cue
// list moves the bar: `down` sets its position to (0, 500) over 0–1 s, through the label's middle; `stay` waits 1 s;
// `up` sets it back to (0, 100) over 2–3 s. The film also holds one hand-written cue marker, `beat`, from 1 s to
// 1.5 s. Cue ends: 1 s (`cues.down`), 1.5 s (`beat`), 2 s (`cues.stay`, the bar still through the label) and 3 s
// (`cues.up`, the bar clear). film.layout FAILs with exactly one `layout.crossing`, text `tag`, stroke `bar`, first
// seen at 1 s and seen at exactly 1, 1.5 and 2 s.
//
// Wrong programs: film.layout reading only the document's own markers (ts = [1.5], t = 1.5 s); a cue list whose
// markers aren't cue ends (the same); a check that runs at every frame or only at the list's end (other times).
import { describe, it } from 'vitest';
import {
  AC, CLAIM, TIMEOUT, brief, docId, field, fl, flicksOf, isObject, layoutClaim, layoutRow, namesItem, none, run, scenario, showTime, storedFilm,
  useFolders, useShow, type JsonObject,
} from './helpers.ts';

const show = useShow();
const folder = useFolders();

const DOC = docId(1);
const bar: JsonObject = { id: 'bar', kind: 'path@1', name: 'Bar', order: 'a0001', params: { d: 'M 300 0 L 900 0', paint: { stroke: { role: 'ink', width: 4 } } }, at: { pos: [0, 100, 0] } };
const tag: JsonObject = { id: 'tag', kind: 'text@1', name: 'Text tag', order: 'a0002', params: { text: 'Speed', font: 'body', size: 32, box: { w: 240, h: 42 }, align: 'center' }, at: { pos: [496, 479, 0] } };
const list: JsonObject = {
  id: 'list', kind: 'cues@1', name: 'Cue list', order: 'a0003', params: {
    cues: [
      { id: 'down', targets: ['bar'], span: '1s', set: { 'at/pos': [0, 500, 0] } },
      { id: 'stay', span: '1s' },
      { id: 'up', targets: ['bar'], span: '1s', set: { 'at/pos': [0, 100, 0] } },
    ],
  },
};
const filmed = storedFilm(DOC, 'A bar the cue list moves through a label', [bar, tag, list], { span: 4, markers: { beat: { kind: 'cue', name: 'cue beat', t: '1s', span: '0.5s' } } });

describe(`${AC[6]} film.layout runs at the end of every cue a cue list writes`, () => {
  it(`${AC[6]} film.layout checks at the end of each cues.<id> marker the cue list writes, beside the film's own cue ends`, () => {
    const [verdict] = run(show(), scenario(folder(), [{ call: 'verdict', claim: CLAIM }], { stored: { [DOC]: filmed }, claims: layoutClaim(DOC) }));
    const row = layoutRow(verdict!);
    const issues = (Array.isArray(row['issues']) ? row['issues'] : []).filter(isObject);
    const failures: string[] = [];
    if (row['result'] !== 'FAIL') failures.push(`film.layout is ${brief(row['result'])}, not FAIL: ${brief(row)}`);
    const crossings = issues.filter((i) => i['code'] === 'layout.crossing');
    if (crossings.length !== 1) failures.push(`film.layout raises ${crossings.length} layout.crossing issues, not one: ${brief(crossings)}`);
    const hit = crossings.find((i) => namesItem(field(i, 'text'), 'tag') && namesItem(field(i, 'stroke'), 'bar'));
    if (!hit) failures.push(`no layout.crossing names the text tag and the stroke bar: ${brief(issues)}`);
    else {
      if (hit['severity'] !== 'error') failures.push(`the layout.crossing is a ${brief(hit['severity'])}, not an error`);
      const t = flicksOf(field(hit, 't'));
      if (t !== fl(1)) failures.push(`the crossing is first seen at ${t === null ? brief(field(hit, 't')) : showTime(t)}, not 1 s`);
      const tsRaw = field(hit, 'ts');
      const ts = Array.isArray(tsRaw) ? tsRaw.map(flicksOf) : null;
      const want = [1, 1.5, 2].map(fl);
      if (!ts || JSON.stringify(ts) !== JSON.stringify(want)) failures.push(`the crossing is seen at ${brief(tsRaw)}, not exactly at the cue ends 1, 1.5 and 2 s (${want.join(', ')} flicks)`);
    }
    none(failures, 'film.layout checks the film at every cue end, the cue list\'s among them');
  }, TIMEOUT);
});

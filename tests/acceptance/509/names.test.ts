// #509.9f77940a: "A Latin name heard as other words fails with a respelling fix, and in a 10-character Chinese line a
// one-character error fails while a homophone passes"
//
// The Latin name: the line `l1`, "Every Quercus here grows slowly", marks `Quercus` in `names`; its recording says other
// words where the name stands ("Every quick bus here grows slowly", spoken word by word by `say`), so whatever the
// transcriber writes there is not the name, by phonemes or by letters. Heard back through the real transcriber (as in
// cut.test.ts), the transcript row FAILs with a narration.mismatch error naming l1 and the name among what it lists as
// missing or wrong, whose fix is a respelling in the line's `say`. The Chinese line: through the pure comparison
// `media_heard` (locale zh-CN), the 10-character line 我们明天去公园散步吧 heard with one character changed to another
// syllable (去 qu to 来 lai) does not match and names the pair; heard with a homophone (园 to 元, both yuan) matches.
import { describe, expect, it } from 'vitest';
import {
  AC, FULL, SPEECH, TIMEOUT, assetOf, errors, fieldOf, film, hear, heardBack, mismatchesOf, openWorld, proof, recorded, show, stage, take, useShow, useTemp,
  withPlugin, words, type JsonObject,
} from './helpers.ts';

const shows = useShow([FULL]);
const temp = useTemp();
const TEXT = 'Every Quercus here grows slowly';
const SPOKEN = ['Every', 'quick bus', 'here', 'grows', 'slowly'];
const LINE = '我们明天去公园散步吧';
const HOMOPHONE = '我们明天去公元散步吧';
const ERROR = '我们明天来公园散步吧';

/** Whether a mismatch lists the name: among its missing words, or as the expected side of a wrong pair. */
function namesQuercus(i: JsonObject): boolean {
  return words(fieldOf(i, 'missing')).includes('quercus') || words(fieldOf(i, 'wrong')).includes('quercus') || words(fieldOf(i, 'expected')).includes('quercus');
}

describe(`${AC[2]} a Latin name heard as other words fails with a respelling fix; a one-character error in a Chinese line fails and a homophone passes`, () => {
  it(`${AC[2]} the marked name Quercus heard as other words fails the line l1 with narration.mismatch, its fix a respelling in say`, async () => {
    const w = await openWorld([]);
    await withPlugin(w, SPEECH);
    const voice = stage(w.evidence, take(TEXT, { groups: SPOKEN }));
    const doc = film({ span: 5, lines: { l1: recorded('voice_l1', TEXT, 0.5, { names: ['Quercus'] }) }, assets: { voice_l1: assetOf(voice) } });
    const j = await heardBack(shows.bin(FULL), w, doc, 'the line whose name is heard as other words');
    proof('ac2-latin-name.json', { verdict: j.verdict, transcripts: j.transcripts });
    expect(j.row['result'], `the transcript row FAILs: ${show(j.row, 2500)}`).toBe('FAIL');
    const named = mismatchesOf(j.row, 'l1').filter(namesQuercus);
    expect(named.length, `a narration.mismatch error names l1 and lists the name Quercus as missing or wrong: ${show(errors(j.row, 'narration.mismatch'), 2500)}`).toBeGreaterThan(0);
    expect(named.some((i) => words(i['fix']).includes('say') && words(i['fix']).includes('quercus')), `its fix is a respelling of Quercus in the line's say: ${show(named.map((i) => i['fix'] ?? null), 1500)}`).toBe(true);
  }, TIMEOUT);

  it(`${AC[2]} in the 10-character line ${LINE}, heard with 去 as 来 it fails naming that pair; heard with 园 as its homophone 元 it passes`, () => {
    expect(Array.from(LINE).length, 'the fixture line is 10 characters').toBe(10);
    const [error, homophone] = hear(shows.bin(FULL), temp(), [
      { expected: LINE, heard: ERROR, locale: 'zh-CN' },
      { expected: LINE, heard: HOMOPHONE, locale: 'zh-CN' },
    ], 'the Chinese line heard back');
    proof('ac2-chinese.json', { error: error!.raw, homophone: homophone!.raw });
    expect(error!.match, `one character heard as another syllable does not match: ${show(error!.raw)}`).toBe(false);
    expect([error!.wrong.length, error!.missing.length, error!.extra.length], `it is one wrong pair, nothing missing or extra: ${show(error!.raw)}`).toEqual([1, 0, 0]);
    const pair = error!.wrong[0]!;
    expect(/去|^qu$/.test(pair[0]) && /来|^lai$/.test(pair[1]), `the wrong pair is [去, 来] (or their syllables, qu and lai): ${show(error!.raw)}`).toBe(true);
    expect(homophone!.match, `a homophone, 元 for 园 (both yuan), matches: ${show(homophone!.raw)}`).toBe(true);
    expect([homophone!.wrong.length, homophone!.missing.length, homophone!.extra.length], 'the homophone leaves nothing wrong, missing or extra').toEqual([0, 0, 0]);
  }, TIMEOUT);
});

// #509.9f77940a and #509.b4d021e2 (Oracle lane, port): pypinyin at df101577145af2eb1abe5656e592e34e3bb56d23,
// tests/test_pinyin.py, the readings the Oracle page pins for criteria 2 and 5, run against our code (zh.readings@1 is
// pypinyin 0.55.0's dictionary, toneless; Synthesized lines, `say` and pace).
// Criterion 2, toneless syllables, through `media_heard {locale: zh-CN}`: upstream's NORMAL style reads 中心 as zhong xin
// (test_pinyin_initials), 中国人 as zhong guo ren (test_lazy_pinyin) and 嗷嗷 as ao ao (test_pinyin_finals); so each,
// heard written with other characters of those syllables, matches, and heard with one syllable changed (中 as 张, zhang),
// does not. Upstream's heteronym case 朝阳 (NORMAL, heteronym=True: [[zhao, chao], [yang]]) matches when heard as 潮阳
// (chao) or 招阳 (zhao), never as 早阳 (zao). Which homophones stand for the syllables is this lane's choice; the
// syllables are upstream's.
// Criterion 5, a polyphonic character must carry its reading in `say`: 朝 (zhao, chao) and 行 (test_custom_pinyin_dict2:
// 同行 reads tong hang, and tong xing once its phrase is changed) are characters of zh.polyphonic@1; a Chinese line
// holding either with no reading in `say` is refused with narration.polyphonic naming the character and its upstream
// readings, and with the reading in brackets it compiles. 中, whose two readings (zhōng, zhòng) are one without tones,
// is in no such list: a line holding it compiles with no reading.
//
// The test characters and readings are ported from that file, under its licence:
//   The MIT License (MIT)
//   Copyright (c) 2016 mozillazg, 闲耘 <hotoo.cn@gmail.com>
//   Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated
//   documentation files (the "Software"), to deal in the Software without restriction, including without limitation the
//   rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit
//   persons to whom the Software is furnished to do so, subject to the following conditions: The above copyright notice
//   and this permission notice shall be included in all copies or substantial portions of the Software.
//   THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE
//   WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR
//   COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
//   OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
import { describe, expect, it } from 'vitest';
import { AC, FULL, TIMEOUT, assetOf, coded, fieldOf, film, filmRun, hear, proof, recorded, stage, timeCall, toneTake, useShow, useTemp, words, type JsonObject } from '../509/helpers.ts';

const shows = useShow([FULL]);
const temp = useTemp();

const HEARD: { from: string; expected: string; heard: string; match: boolean }[] = [
  { from: 'test_pinyin_initials: 中心 NORMAL [[zhong], [xin]]', expected: '中心', heard: '钟新', match: true },
  { from: 'test_pinyin_initials: 中心, one syllable changed', expected: '中心', heard: '张心', match: false },
  { from: 'test_lazy_pinyin: 中国人 [zhong, guo, ren]', expected: '中国人', heard: '钟锅任', match: true },
  { from: 'test_pinyin_finals: 嗷嗷 NORMAL [[ao], [ao]]', expected: '嗷嗷', heard: '熬熬', match: true },
  { from: 'test_heteronym 朝阳 NORMAL heteronym [[zhao, chao], [yang]]: chao', expected: '朝阳', heard: '潮阳', match: true },
  { from: 'test_heteronym 朝阳 NORMAL heteronym [[zhao, chao], [yang]]: zhao', expected: '朝阳', heard: '招阳', match: true },
  { from: 'test_heteronym 朝阳: zao is no reading of 朝', expected: '朝阳', heard: '早阳', match: false },
];
const POLYPHONIC: { from: string; text: string; char: string; readings: string[]; say: string }[] = [
  { from: 'test_heteronym 朝阳: [zhao, chao]', text: '朝阳照在山上', char: '朝', readings: ['zhao', 'chao'], say: '朝[zhao]阳照在山上' },
  { from: 'test_custom_pinyin_dict2 同行: hang, then xing', text: '我们是同行', char: '行', readings: ['hang', 'xing'], say: '我们是同行[hang]' },
];

/** A Chinese line `zh` with `text` (and `say`), compiled by `time @zh`: every reply. */
function compile(text: string, say: string | null, what: string): JsonObject[] {
  const evidence = temp();
  const doc = film({ span: 3, lines: { zh: recorded('voice_zh', text, 0.5, { locale: 'zh-CN', ...(say ? { say } : {}) }) }, assets: { voice_zh: assetOf(stage(evidence, toneTake(text, 1.5))) } });
  return filmRun(shows.bin(FULL), evidence, doc, [timeCall('@zh')], what);
}

describe(`${AC[2]} ${AC[5]} pypinyin's toneless syllables and heteronyms (df10157714) on our comparison and our refusal`, () => {
  it(`${AC[2]} each upstream reading heard as other characters of its syllables matches, and a changed syllable does not`, () => {
    const got = hear(shows.bin(FULL), temp(), HEARD.map((c) => ({ expected: c.expected, heard: c.heard, locale: 'zh-CN' })), 'the upstream readings');
    proof('oracle-pinyin-heard.json', HEARD.map((c, i) => ({ ...c, ours: got[i]!.raw })));
    const failures = HEARD.flatMap((c, i) => (got[i]!.match === c.match ? [] : [`${c.from}: ${c.expected} heard as ${c.heard} ${got[i]!.match ? 'matches' : 'does not match'}: ${JSON.stringify(got[i]!.raw)}`]));
    expect(failures, failures.join('\n')).toEqual([]);
  }, TIMEOUT);

  it(`${AC[5]} a line holding 朝 or 行 with no reading in say is refused with narration.polyphonic naming it and upstream's readings; with its reading it compiles, and 中 needs none`, () => {
    const failures: string[] = [];
    const seen: JsonObject = {};
    for (const p of POLYPHONIC) {
      const bare = compile(p.text, null, `${p.text} with no reading`);
      const read = compile(p.text, p.say, `${p.text} with ${p.char}'s reading`);
      seen[p.char] = { bare, read };
      const found = coded(bare, 'narration.polyphonic');
      const names = (o: JsonObject): boolean => JSON.stringify(o).includes(p.char) && p.readings.every((r) => words(fieldOf(o, 'readings') ?? o).includes(r));
      if (!found.some(names)) failures.push(`${p.from}: ${p.text} with no reading isn't refused with narration.polyphonic naming ${p.char} and ${p.readings.join(', ')}: ${JSON.stringify(bare).slice(0, 1200)}`);
      if (coded(read, 'narration.polyphonic').length || read[1]!['outcome'] !== 'resolved') failures.push(`${p.from}: with say ${p.say} the line doesn't compile: ${JSON.stringify(read).slice(0, 1200)}`);
    }
    const plain = compile('中心在这里', null, '中心 with no reading');
    seen['中'] = plain;
    if (coded(plain, 'narration.polyphonic').length || plain[1]!['outcome'] !== 'resolved') failures.push(`中 (zhōng, zhòng, one reading without tones) needs no reading, yet the line doesn't compile: ${JSON.stringify(plain).slice(0, 1200)}`);
    proof('oracle-pinyin-polyphonic.json', seen);
    expect(failures, failures.join('\n')).toEqual([]);
  }, TIMEOUT);
});

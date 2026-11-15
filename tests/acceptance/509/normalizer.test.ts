// #509.637f3d04: "The normalizer alone settles a fixture of digits, ordinals, times, years, percentages and thousands
// separators read as words"
//
// Through the pure comparison `media_heard {expected, heard, locale: en}` (Check input: narration.transcript@1), which
// answers the comparison narration.transcript@1 makes with no record and no person: each form written in digits in the
// script and heard as words matches, both sides reading the same tokens after normalizer@1, with nothing missing, extra
// or wrong; where the design gives the token (1200, 1030, 31st, 1999) the tokens hold it. "Alone" is read as no names, no
// exception ask and no record: the comparison settles it. Each form's near miss (one word off) does not match, so a
// normalizer that matches everything fails here.
import { describe, expect, it } from 'vitest';
import { AC, FULL, TIMEOUT, hear, proof, useShow, useTemp, type Heard } from './helpers.ts';

const shows = useShow([FULL]);
const temp = useTemp();

/** Each form: the script's text, the words it is heard as, the token the design gives (if it gives one), a near miss. */
const FORMS: { form: string; written: string; spoken: string; token?: string; miss: string }[] = [
  { form: 'digits', written: 'She counted 7 ducks', spoken: 'she counted seven ducks', miss: 'she counted eleven ducks' },
  { form: 'ordinals', written: 'We met on the 31st', spoken: 'we met on the thirty first', token: '31st', miss: 'we met on the thirty second' },
  { form: 'times', written: 'The bus leaves at 10:30', spoken: 'the bus leaves at ten thirty', token: '1030', miss: 'the bus leaves at ten forty' },
  { form: 'years', written: 'It opened in 1999', spoken: 'it opened in nineteen ninety nine', token: '1999', miss: 'it opened in nineteen ninety eight' },
  { form: 'percentages', written: 'Prices rose 25% this year', spoken: 'prices rose twenty five percent this year', miss: 'prices rose twenty six percent this year' },
  { form: 'thousands separators', written: 'The hall seats 1,200 people', spoken: 'the hall seats one thousand two hundred people', token: '1200', miss: 'the hall seats one thousand three hundred people' },
];

describe(`${AC[6]} normalizer@1 alone settles digits, ordinals, times, years, percentages and thousands separators read as words`, () => {
  it(`${AC[6]} each form written in digits and heard as words matches with the same tokens on both sides, and its near miss does not`, () => {
    const pairs = FORMS.flatMap((f) => [{ expected: f.written, heard: f.spoken, locale: 'en' }, { expected: f.written, heard: f.miss, locale: 'en' }]);
    const got = hear(shows.bin(FULL), temp(), pairs, 'the normalizer fixture');
    proof('ac6-normalizer.json', FORMS.map((f, i) => ({ ...f, heard: got[2 * i]!.raw, near_miss: got[2 * i + 1]!.raw })));
    const failures: string[] = [];
    FORMS.forEach((f, i) => {
      const h: Heard = got[2 * i]!;
      const m: Heard = got[2 * i + 1]!;
      if (!h.match) failures.push(`${f.form}: ${JSON.stringify(f.written)} heard as ${JSON.stringify(f.spoken)} does not match: ${JSON.stringify(h.raw)}`);
      if (h.missing.length || h.extra.length || h.wrong.length) failures.push(`${f.form}: the comparison leaves missing ${JSON.stringify(h.missing)}, extra ${JSON.stringify(h.extra)}, wrong ${JSON.stringify(h.wrong)}`);
      if (JSON.stringify(h.expected) !== JSON.stringify(h.heard)) failures.push(`${f.form}: the two sides read different tokens after normalizer@1: ${JSON.stringify(h.expected)} and ${JSON.stringify(h.heard)}`);
      if (f.token && !h.expected.includes(f.token)) failures.push(`${f.form}: ${JSON.stringify(f.written)} reads ${JSON.stringify(h.expected)}, without the token ${f.token} the design gives`);
      if (m.match) failures.push(`${f.form}: the near miss ${JSON.stringify(f.miss)} matches ${JSON.stringify(f.written)}: ${JSON.stringify(m.raw)}`);
    });
    expect(failures, failures.join('\n')).toEqual([]);
  }, TIMEOUT);
});

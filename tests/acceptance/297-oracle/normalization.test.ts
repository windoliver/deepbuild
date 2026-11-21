// Oracle lane for AC6 #297.cd44d20a: An entry typed as "e" followed by U+0301 shows as "é" while the input track keeps
// the typed bytes by hash; a planted text that normalizes the entry changes the track's hash and fails, naming the entry
//
// Upstream: the normalizer's conformance run, icu4x b1cec62bb7 components/normalizer/tests/tests.rs:936-1102
// (test_conformance), over Unicode's NormalizationTest.txt: each line's c2 is the NFC form of c1, c2 and c3, and c4 of
// c4 and c5 (its line 141 composes e followed by U+0301 to é). Run on our code (README): each input the body face draws
// and the #297 rules take is committed by seat 1 to `name` (a recorded track, `track`'s `load`), one a step, and the
// frame at that step must show the file's NFC form (`eval`'s `shown`). Keeping the typed bytes in the track is ours and
// stays in tests/acceptance/297/ac06-nfc-shown.test.ts.
import { describe, expect, it } from 'vitest';
import {
  AC, DOC, NORMALIZATION, NORMALIZATION_SHA256, Script, TIMEOUT, at, commit, drawnBy, entryText, named, none, piece, presented, putEvidence, runShow,
  scenario, seatsProgram, shownOf, takes, trackOf, useShow, useTemp, vendored,
} from './helpers.ts';

const show = useShow();
const temp = useTemp();
const D = DOC(30);
const MAX_BYTES = 64;

interface Case { line: number; input: string; nfc: string }
/** Each distinct input of the file's five columns with the NFC form it must show as, those the body face draws (Inter,
 * the clean look's body font) and the #297 rules take as typed. */
function cases(): { kept: Case[]; lines: number } {
  const inter = drawnBy('Inter-Regular.ttf');
  const seen = new Map<string, Case>();
  let lines = 0;
  vendored(NORMALIZATION, NORMALIZATION_SHA256).split('\n').forEach((raw, n) => {
    const line = raw.replace(/#.*/, '').trim();
    if (line === '' || line.startsWith('@')) return;
    const cols = line.split(';').slice(0, 5).map((c) => String.fromCodePoint(...c.trim().split(/\s+/).map((h) => Number.parseInt(h, 16))));
    if (cols.length < 5) return;
    lines += 1;
    for (const [input, nfc] of [[cols[0], cols[1]], [cols[1], cols[1]], [cols[2], cols[1]], [cols[3], cols[3]], [cols[4], cols[3]]] as [string, string][]) {
      if (!seen.has(input) && takes(input, [inter], MAX_BYTES) && takes(nfc, [inter], MAX_BYTES)) seen.set(input, { line: n + 1, input, nfc });
    }
  });
  return { kept: [...seen.values()], lines };
}
/** The judge: each case's shown string must be the file's NFC form. */
function judge(list: Case[], shown: (c: Case, k: number) => string | undefined): string[] {
  return list.flatMap((c, k) => {
    const got = shown(c, k);
    return got === c.nfc ? [] : [`NormalizationTest.txt line ${c.line}: ${named(c.input)} shows ${got === undefined ? 'nothing it reports' : named(got)}, not its NFC form ${named(c.nfc)}`];
  });
}

describe(`${AC[6]} Oracle: the entry text shows the NFC form NormalizationTest.txt gives`, () => {
  it(`${AC[6]} every input the body face draws shows as the file's NFC form, run on our entry text`, () => {
    const { kept, lines } = cases();
    console.log(`${AC[6]} Oracle: ${kept.length} inputs from ${lines} lines of NormalizationTest.txt, the rest drawn by no bundled body face or refused by the #297 rules`);
    expect(kept.length, 'the file gives inputs the body face draws').toBeGreaterThan(1000);
    // The judge first: the file's own answers pass, and the typed bytes shown as they are, or their NFD, fail on line 141.
    none(judge(kept, (c) => c.nfc), 'the judge on the file\'s own NFC forms');
    const acute = kept.find((c) => c.input === 'e\u{0301}');
    expect(acute?.line, 'line 141 composes e followed by U+0301').toBe(141);
    expect(judge(kept, (c) => c.input).some((f) => f.startsWith('NormalizationTest.txt line 141:')), 'the judge fails bytes shown as typed, on line 141').toBe(true);
    expect(judge(kept, (c) => c.input.normalize('NFD')).length, 'the judge fails NFD forms').toBeGreaterThan(0);

    const ev = temp();
    const seats = seatsProgram();
    putEvidence(ev, seats.bytes);
    const s = new Script();
    s.present(D, piece('nfc', seats, [entryText('form', 1, { pos: [16, 80], order: 'a1', w: 440 })], { maxBytes: MAX_BYTES, span: `${Math.ceil((kept.length + 60) / 60)}s` }));
    s.track(D, trackOf(kept.map((c, k) => commit(k + 1, 1, c.input))));
    const frames = kept.map((_, k) => s.eval(D, at(k + 1)));
    const r = runShow(show(), scenario(ev, [D], s.calls), 'the Oracle lane: NormalizationTest.txt\'s inputs, one a step');
    presented(r[0]!, 'the Oracle lane\'s piece');
    none(judge(kept, (_, k) => shownOf(r[frames[k]!]!, `the frame at step ${k + 1}`)['form']), 'NormalizationTest.txt run on our entry text');
  }, TIMEOUT);
});

// AC3 (README: word.test.ts): `deep_kinds` op `word` answers a word of an installed pack's census with its state and
// reason, through `deep-show run`; a planted census row in `refused` with no reason is refused by the pack check
// (`install_pack`) and by `census.mjs --check`, each naming the row's word.

import { describe, expect, it } from 'vitest';

import {
  census, commitAll, failNamingFailures, installPack, installed, namesCensus, packAt, runShow, show, sub, stubTree, useShow, useTemp, writeNames,
  type JsonObject,
} from './helpers.ts';

const AC3 = '#1493.cd0a4e1c';
const bin = useShow();
const temp = useTemp();
const word = (w: string): JsonObject => ({ call: 'deep_kinds', op: 'word', word: w });

describe(`${AC3} deep_kinds answers a word with its census state and reason`, () => {
  it(`${AC3} deep_kinds on a refused word returns refused and its reason, and on an undecided word open; a planted row in refused with no reason fails, naming the row`, () => {
    const right = writeNames(temp(), '1.0.0');
    const c = namesCensus();
    delete ((c['names'] as JsonObject[]).find((r) => r['name'] === 'Ticker')!)['reason'];
    const planted = writeNames(temp(), '1.0.1', { census: c });
    const [a, ticker, gizmo, b] = runShow(bin(), { evidence: sub(temp(), 'evidence'), calls: [installPack(right), word('Ticker'), word('Gizmo'), installPack(planted)] });

    const ok = installed(a!, right);
    expect(ok.outcome, `${packAt(right)}, whose census is whole, installs: ${show(ok.raw, 3000)}`).toBe('installed');
    expect([ticker!['state'], ticker!['reason']], `deep_kinds word Ticker, refused in the census for imperative: ${show(ticker)}`).toEqual(['refused', 'imperative']);
    expect(gizmo!['state'], `deep_kinds word Gizmo, open in the census: ${show(gizmo)}`).toBe('open');

    const r = installed(b!, planted);
    expect(r.outcome, `${packAt(planted)}, whose refused row Ticker gives no reason, is refused by the pack check: ${show(r.raw, 3000)}`).toBe('refused');
    const atCensus = r.issues.filter((i) => String(i['path'] ?? '').startsWith('census/'));
    expect(atCensus.some((i) => JSON.stringify(i).includes('Ticker')), `an issue at census/… names the row Ticker: ${show(r.issues, 3000)}`).toBe(true);

    const s = stubTree(temp());
    const sc = s.readCensus();
    delete ((sc['names'] as JsonObject[]).find((x) => x['name'] === 'Ticker')!)['reason'];
    s.writeCensus(sc);
    commitAll(s.tree);
    expect(failNamingFailures(census(['--check'], s.tree, s.home), 'Ticker', 'census.mjs --check on a refused row Ticker with no reason'), 'the census check').toEqual([]);
  }, 3_600_000);
});

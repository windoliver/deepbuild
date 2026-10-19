import { afterAll, describe, expect, it } from 'vitest';
import { openEvidenceStore } from '../../../packages/evidence/src/index.ts';
import { anyUse, removeRoots, storeText, stored, T0, tempRoot, text } from './helpers.ts';
import { fixtureFor, GITLEAKS_TAG, goRegExp, loadGitleaks, type Fixture } from './gitleaks.ts';

afterAll(removeRoots);

const { rules, global } = loadGitleaks();
const fixtures: Fixture[] = [];
const noFixture: string[] = [];
rules.forEach((rule, n) => {
  const f = fixtureFor(rule, global, 0x1513_0000 + n);
  if (f) fixtures.push(f);
  else noFixture.push(rule.id);
});

describe(`AC13 every gitleaks ${GITLEAKS_TAG} default rule`, () => {
  it(`AC13 the pinned config's ${rules.length} rules each have a generated key the rule matches, or are named`, () => {
    console.log(`AC13 gitleaks ${GITLEAKS_TAG}: ${fixtures.length} of ${rules.length} rules have a fixture; no fixture for: ${noFixture.join(', ') || 'none'}`);
    // The generator's own floor, so a broken generator can't pass the next test with few fixtures.
    expect(rules.length).toBe(222);
    expect(noFixture).toEqual(['pkcs12-file']); // the one rule with a path and no pattern
    for (const f of fixtures) {
      const rule = rules.find((r) => r.id === f.rule)!;
      expect(goRegExp(rule.regex!).test(f.line), `${f.rule}: fixture does not match its rule`).toBe(true);
      expect(f.line.includes(f.secret)).toBe(true);
    }
  });

  it('AC13 a generated key for each rule is redacted from a log; the first rule whose key survives is named', async () => {
    const store = await openEvidenceStore({ root: tempRoot(), now: () => T0 });
    const writer = store.connect({ role: 'deepbuild', via: 'job' });
    const survived: string[] = [];
    for (const f of fixtures) {
      const log = `2026-10-18T11:59:59Z INFO step 3: fetching\n${f.line}2026-10-18T12:00:01Z INFO step 5: ok\n`;
      const hash = stored(await storeText(writer, { kind: 'log', source: `fixture:${f.rule}`, redaction: 'complete', license: anyUse }, [log]));
      if (text(await store.read(hash)).includes(f.secret)) survived.push(f.rule);
    }
    // A redactor with a hand list of formats fails here, naming the first rule it misses.
    expect(survived, `first rule whose key survives redaction: ${survived[0]} (${survived.length} in all: ${survived.join(', ')})`).toEqual([]);
  });
});

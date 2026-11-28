// #3428's AC5 against the stand-in paseo and a local npm registry that answers 404 for the facts' install source
// (README, The worlds): the source is named before paseo's config.json is written, and `deep setup --undo` afterwards
// changes nothing. The source's other side, one that resolves, is setup.test.ts's install on the facts' newest paseo.
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { AC, changing, cleanup, installs, linesOf, newestCovered, redact, setup, shown, shownCalls, source, undo, world } from './world.ts';

afterEach(cleanup, 120_000);

describe(`${AC[5]} A source that answers 404 is named before paseo's config.json is written, and deep setup --undo afterwards changes nothing`, () => {
  it(`${AC[5]} the facts' source answers 404 from npm's registry: deep setup names it and hands paseo nothing to write, and deep setup --undo changes nothing`, async () => {
    const w = await world({ version: newestCovered(), plugin: 'none', registry: 'answers 404', hub: true });
    const { source: s, name } = source();
    const file = redact(w, w.configFile);
    const r = await setup(w);
    const lines = linesOf(r);
    const calls = w.calls();
    const ofPaseo = JSON.stringify(lines.filter((l) => /paseo|404|not found/i.test(l)).map((l) => redact(w, l)));
    expect(installs(calls).map((c) => `paseo ${(c.args as string[]).join(' ')}`), `${AC[5]} ${s} answers 404 from npm's registry: deep setup handed paseo's ${file} to paseo plugin install before checking the source; it said ${ofPaseo}`).toEqual([]);
    expect(changing(calls).map((c) => `paseo ${(c.args as string[]).join(' ')}`), `${AC[5]} with ${s} answering 404, no paseo command that writes ${file} runs; it ran ${shownCalls(calls)}`).toEqual([]);
    expect(readFileSync(w.configFile, 'utf8'), `${AC[5]} deep setup wrote paseo's ${file} with ${s} answering 404; it said ${ofPaseo}`).toBe(w.before.toString('utf8'));
    expect(w.registry.asked.filter((a) => a.startsWith('GET ') && a.includes(name)), `${AC[5]} deep setup asked npm's registry for ${name} before it named the source`).not.toEqual([]);
    const named = lines.find((l) => (l.includes(s) || l.includes(name)) && /404|not found|doesn't resolve|does not resolve|didn't resolve|did not resolve/i.test(l));
    expect(named, `${AC[5]} deep setup names ${s} as answering 404; it said ${ofPaseo}`).toBeDefined();

    const before = w.calls().length;
    const u = await undo(w);
    expect(u.code, `${AC[5]} deep setup --undo exits 0: ${shown(u)}`).toBe(0);
    const later = w.calls().slice(before);
    expect(changing(later).map((c) => `paseo ${(c.args as string[]).join(' ')}`), `${AC[5]} deep setup --undo after a setup that wrote nothing of paseo's runs no paseo command that changes it; it ran ${shownCalls(later)}`).toEqual([]);
    expect(readFileSync(w.configFile, 'utf8'), `${AC[5]} deep setup --undo leaves paseo's ${file} byte for byte as it was`).toBe(w.before.toString('utf8'));
  }, 600_000);
});

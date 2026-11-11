// AC3 #220.472f9775: "`\ce{H2O}` fails `typeset.unknown_command` naming `\ce` at bytes 0..3 and writes nothing;
// parts `e^{i` and `\pi}` fail `typeset.parts_apart` naming both; a vector naming the job's output with `alt`
// `a^2+b^2=c^3` fails `formula.alt_mismatch`"
//
// The two job issues through deep_job (README: The surface under test, 2 and How each criterion is read): each run
// answers `failed` with `check` the issue's code and no outputs, and its `reason` holds the issue's fields as JSON:
// `{command: "\ce", at: [0, 3]}` (the range also read as {start, end} or "0..3"), and `{parts: …}` naming `e^{i` and
// `\pi}` by source or by id. "Writes nothing": the evidence store holds the same files after the \ce run as before it.
// The document issue through `deep show` in `deep-show run` (README: The surface under test, 8): a film with a vector@1
// `eq` over the SVG the job wrote for a^2 + b^2 = c^2, its alt `a^2+b^2=c^3`, is answered with an error
// `formula.alt_mismatch` naming `eq`; the same vector with alt `a^2+b^2=c^2` (the job's source with its spaces removed)
// is presented with no such issue, so a check that raises it always, or compares the spaces, fails.
import { describe, expect, it } from 'vitest';
import {
  AC, DOC, TIMEOUT, film, isObj, issuesOf, jsonObjectsIn, mustHavePlugin, mustTypeset, openWorld, paramsOf, parseXml, partId, present, proof,
  putStore, rangeOf, runShow, scenario, show, storeFiles, stringsIn, tempDir, typeset, useBuilds, vector, viewBoxOf, type Line, type V2,
  type World,
} from './helpers.ts';

const built = useBuilds({ show: true });
let world: Promise<World> | undefined;
const theWorld = () => (world ??= (async () => { built.hub(); return openWorld(); })());

describe(`${AC[3]} a command the tool can't convert, parts that split a term, and an alt that differs from the job's source each fail, naming what`, () => {
  it(`${AC[3]} \\ce{H2O} fails typeset.unknown_command naming \\ce at bytes 0..3 and writes nothing`, async () => {
    mustHavePlugin();
    const w = await theWorld();
    const before = storeFiles(w);
    const o = await typeset(w, paramsOf(['\\ce{H2O}']));
    const after = storeFiles(w);
    proof('ac3-unknown-command.json', o.value);
    expect(!o.isError && o.value['status'], `deep_job answers \\ce{H2O} failed: ${o.text.slice(0, 1500)}`).toBe('failed');
    expect(o.value['check'], `the failure names the check typeset.unknown_command: ${o.text.slice(0, 1500)}`).toBe('typeset.unknown_command');
    expect(o.value['outputs'], 'the failed run gives no outputs').toBeUndefined();
    const reason = String(o.value['reason'] ?? '');
    const named = jsonObjectsIn(reason).filter((x) => x['command'] === '\\ce' && JSON.stringify(rangeOf(x['at'])) === '[0,3]');
    expect(named.length, `the reason holds the issue's fields as JSON, naming the command \\ce at bytes 0..3: ${reason.slice(0, 1500)}`).toBeGreaterThan(0);
    expect(after.filter((f) => !before.includes(f)), 'the failed run writes nothing: the evidence store gains no file').toEqual([]);
  }, TIMEOUT);

  it(`${AC[3]} parts e^{i and \\pi} fail typeset.parts_apart naming both`, async () => {
    mustHavePlugin();
    const w = await theWorld();
    const parts = ['e^{i', '\\pi}'];
    const o = await typeset(w, paramsOf(parts));
    proof('ac3-parts-apart.json', o.value);
    expect(!o.isError && o.value['status'], `deep_job answers the parts ${parts.join(' and ')} failed: ${o.text.slice(0, 1500)}`).toBe('failed');
    expect(o.value['check'], `the failure names the check typeset.parts_apart: ${o.text.slice(0, 1500)}`).toBe('typeset.parts_apart');
    expect(o.value['outputs'], 'the failed run gives no outputs').toBeUndefined();
    const reason = String(o.value['reason'] ?? '');
    const names = (x: Line, s: string): boolean => stringsIn(x['parts']).some((v) => v === s || v === partId(s));
    const named = jsonObjectsIn(reason).filter((x) => x['parts'] !== undefined && parts.every((s) => names(x, s)));
    expect(named.length, `the reason holds the issue's fields as JSON, its parts naming both ${parts.join(' and ')} (by source or id): ${reason.slice(0, 1500)}`).toBeGreaterThan(0);
  }, TIMEOUT);

  it(`${AC[3]} a vector naming the job's output with alt a^2+b^2=c^3 fails formula.alt_mismatch`, async () => {
    mustHavePlugin();
    const bin = built.show();
    const w = await theWorld();
    const t = await mustTypeset(w, paramsOf(['a^2', '+', 'b^2', '=', 'c^2']), 'a^2 + b^2 = c^2');
    const vb = viewBoxOf(parseXml(t.svg.toString('utf8')));
    const k = Math.min(700 / vb[2], 300 / vb[3]);
    const size: V2 = [vb[2] * k, vb[3] * k];
    const store = tempDir();
    const src = putStore(store, t.svg);
    const wrong = film('alt-wrong', [vector('eq', src, size, [50, 50], 'a^2+b^2=c^3')]);
    const right = film('alt-right', [vector('eq', src, size, [50, 50], 'a^2+b^2=c^2')]);
    const [r1, r2] = runShow(bin, scenario(store, [present(DOC.a, wrong), present(DOC.b, right)]));
    const mismatches = (r: Line | undefined): Line[] => issuesOf(r ?? {}, store).filter((i) => i['code'] === 'formula.alt_mismatch');
    const namesEq = (i: Line): boolean => (Array.isArray(i['ids']) && i['ids'].includes('eq')) || i['item'] === 'eq';
    proof('ac3-alt.json', { wrong: r1, right: r2 });
    const raised = mismatches(r1);
    expect(raised.some((i) => namesEq(i) && i['severity'] === 'error'), `deep show of a vector naming the job's SVG with alt a^2+b^2=c^3 fails formula.alt_mismatch, an error naming eq: ${show(issuesOf(r1 ?? {}, store))}`).toBe(true);
    expect(mismatches(r2), `the same vector with alt a^2+b^2=c^2, the job's source with its spaces removed, raises no formula.alt_mismatch: ${show(issuesOf(r2 ?? {}, store))}`).toEqual([]);
    expect(isObj(r2) && r2['outcome'], `the same vector with alt a^2+b^2=c^2 is presented: ${show(r2)}`).toBe('presented');
  }, TIMEOUT);
});

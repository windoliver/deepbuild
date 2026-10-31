// AC8 and AC14 (#139): the ecosystem corpus. Before each release every extension, pack and document DeepBuild has made
// or shipped runs against the candidate; the report lists only failures the previous release didn't have; a new failure
// holds the release until the owner marks it fixed or accepted, an accepted one with its break file.
// The corpus is `contracts/corpus.json`: members `{ name, group, samples: [{ schema, value }] }`, a member failing when a
// sample doesn't validate against the candidate's published schema of that name (README: the ecosystem corpus).
// `record --release R1` also records which members failed in R1 (contracts/releases/R1.corpus.json); `corpus --release R2`
// runs them against the candidate; the owner's marks are in contracts/corpus-decisions.json.
import { describe, expect, it } from 'vitest';
import {
  addSchema, at, diffLines, edit, expectFailNaming, expectPass, failLines, fork, record, schemaFile, scratch, shown, step, breakFile, writeJson, type Json, type StepPlant, type Tree,
} from './helpers.ts';

const GOOD = { id: 'a' };
const sample = (schema: string, value: Json = GOOD) => ({ schema, value });
const MEMBERS: { name: string; group: string; samples: unknown[] }[] = [
  ...Array.from({ length: 7 }, (_, i) => ({ name: `api-sentence/${i + 1}`, group: 'api-sentence', samples: [sample('sparkle@1')] })),
  { name: 'gallery/spinner', group: 'gallery', samples: [sample('spinner@1')] },
  { name: 'gallery/orbit', group: 'gallery', samples: [sample('orbit@1')] },
  { name: 'art-motion/rocket', group: 'art-motion', samples: [sample('sparkle@1')] },
  { name: 'earlier-release/R1/basic', group: 'earlier-release', samples: [sample('sparkle@1')] },
  { name: 'extension/stocks', group: 'extension', samples: [sample('sparkle@1')] },
  { name: 'pack/lights', group: 'pack', samples: [sample('sparkle@1')] },
];

/** The scene: gallery/orbit already fails in R1 (its sample lacks the id its kind requires); everything else passes. R1 recorded. */
function cutR1(): Tree {
  const t = scratch('corpus');
  for (const kind of ['sparkle@1', 'spinner@1', 'orbit@1']) addSchema(t, kind);
  writeJson(at(t, 'contracts/corpus.json'), { members: MEMBERS.map((m) => (m.name === 'gallery/orbit' ? { ...m, samples: [sample('orbit@1', {})] } : m)) });
  record(t, 'R1');
  return t;
}
/** The planted break in one gallery document's kind: spinner@1 now requires a field the document doesn't have. */
function breakSpinner(t: Tree): void {
  edit(t, schemaFile('spinner@1'), (s) => { s.properties.mass = { type: 'number' }; s.required.push('mass'); });
}
const corpus = (t: Tree, plant?: StepPlant | string) => step(['corpus', '--release', 'R2'], { root: t.root, plant, timeoutMs: 300_000 });
const decide = (t: Tree, decision: Json[]) => writeJson(at(t, 'contracts/corpus-decisions.json'), decision);

describe('#139.9dd2cc13 before each release every extension, pack and document DeepBuild made or shipped runs against the candidate, and the report lists only the failures the previous release didn\'t have', () => {
  it('AC8 the step runs every member of every group, and with the candidate unchanged it passes, listing the failure R1 already had apart', () => {
    const t = cutR1();
    const r = corpus(t);
    for (const m of MEMBERS) expect(r.out, `the corpus run names ${m.name}`).toContain(m.name);
    expect(r.code, `only a failure R1 already had: no new failure\n${shown(r)}`).toBe(0);
    expect(failLines(r), 'no FAIL line for the known failure').toEqual([]);
    expect(r.out.split('\n').some((l) => /^KNOWN/.test(l) && l.includes('gallery/orbit')), `gallery/orbit is listed apart, as a known failure\n${shown(r)}`).toBe(true);
  }, 300_000);

  it('AC8 a planted break in one gallery document\'s kind fails it, naming the document and the first value that differs; the known failure stays listed apart', () => {
    const t = cutR1();
    breakSpinner(t);
    const r = corpus(t);
    expectFailNaming(r, 'the planted break in gallery/spinner', 'gallery/spinner', 'mass');
    expect(failLines(r), 'exactly one new failure').toHaveLength(1);
    expect(failLines(r).some((l) => l.includes('gallery/orbit')), 'the failure R1 already had is never reported as new').toBe(false);
    expect(r.out.split('\n').some((l) => /^KNOWN/.test(l) && l.includes('gallery/orbit')), 'and is listed apart').toBe(true);
  }, 300_000);
});

/** The held release: the planted break, no decision recorded. Throws what the criterion names when the step lets the release through. */
function heldRelease(plant?: StepPlant): void {
  const t = cutR1();
  breakSpinner(t);
  const r = corpus(t, plant);
  if (r.code === 0) throw Error(`a release preflight that only reports the new corpus failure passed it with gallery/spinner failing and no decision: ${shown(r)}`);
  expectFailNaming(r, 'the held release', 'gallery/spinner');
}

describe('#139.493afaff a new failure in the ecosystem corpus holds the release until the owner marks it fixed or accepted, an accepted one with its break file', () => {
  it('AC14 the planted break leaves the release preflight failed, naming the document, until one of the two is recorded', () => {
    heldRelease();
  }, 300_000);

  it('AC14 (wrong program) a release preflight that only reports it passes, and this test fails it', () => {
    expect(() => heldRelease('report-only')).toThrow(/a release preflight that only reports the new corpus failure passed it/);
  }, 300_000);

  it('AC14 accepted, with its break file quoting the exact line and the workaround, releases it; accepted with no break file does not', () => {
    const t = cutR1();
    breakSpinner(t);
    const line = diffLines(corpus(t)).filter((l) => l.includes('gallery/spinner'));
    expect(line.length, 'the failure prints a diff line naming the document').toBeGreaterThan(0);
    const noFile = fork(t);
    decide(noFile, [{ member: 'gallery/spinner', release: 'R2', decision: 'accepted' }]);
    expectFailNaming(corpus(noFile), 'accepted with no break file', 'gallery/spinner');
    const quoted = fork(t);
    const file = breakFile(quoted, 'R1', 'R2', '139', line, 'Give the spinner a mass.');
    decide(quoted, [{ member: 'gallery/spinner', release: 'R2', decision: 'accepted', break: file.slice(quoted.root.length + 1) }]);
    expectPass(corpus(quoted), 'accepted with its break file');
    const other = fork(t);
    const wrong = breakFile(other, 'R1', 'R2', '139', line.map((l) => l.replace('gallery/spinner', 'gallery/other')), 'Give the spinner a mass.');
    decide(other, [{ member: 'gallery/spinner', release: 'R2', decision: 'accepted', break: wrong.slice(other.root.length + 1) }]);
    expectFailNaming(corpus(other), 'accepted with a break file quoting another line', 'gallery/spinner');
  }, 300_000);

  it('AC14 marked fixed releases it only when the document passes again: the owner\'s word alone is not evidence', () => {
    const t = cutR1();
    breakSpinner(t);
    decide(t, [{ member: 'gallery/spinner', release: 'R2', decision: 'fixed' }]);
    expectFailNaming(corpus(t), 'fixed while the document still fails', 'gallery/spinner');
    edit(t, schemaFile('spinner@1'), (s) => { delete s.properties.mass; s.required = s.required.filter((x: string) => x !== 'mass'); });
    expectPass(corpus(t), 'fixed once the document passes');
  }, 300_000);

  it('AC14 the release preflight runs the corpus: a release-only lane runs the contract step\'s corpus command', async () => {
    const lanes = (await import(new URL('../../../scripts/lanes.mjs', import.meta.url).href)) as { releaseLanes: { name: string; commands: string[][] }[] };
    const lane = lanes.releaseLanes.find((l) => l.commands.some((c) => c.some((a) => a.endsWith('contract-diff.mjs')) && c.includes('corpus')));
    expect(lane, `a release lane runs "contract-diff.mjs corpus": ${JSON.stringify(lanes.releaseLanes.map((l) => l.name))}`).toBeDefined();
  });
});

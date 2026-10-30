// AC1 and AC2 (#139): the preflight's contract step diffs the candidate's published contracts against every earlier
// release. A removed or reshaped method fails, naming the method and the release it arrived in; a break passes only
// with a reviewed file that quotes the exact diff line and the workaround, and the release notes list it.
// The scene: R1 (the scratch tree as it is) and R2 (R1 plus the stable method `deep.arrived`, since R2) are recorded;
// the candidate is R3.
import { describe, expect, it } from 'vitest';
import {
  breakFile, check, diffLines, expectFailNaming, expectPass, failLines, needStep, releasesR1R2, removeApi, reshapeApi, shown, step, type StepPlant, type Tree,
} from './helpers.ts';

const retype = (params: { properties: { type: { type: string } } }): void => { params.properties.type = { type: 'integer' } as never; };

describe('#139.0a8054ec removing or reshaping a published method without a break file fails the preflight, naming the method and the release it arrived in', () => {
  it('AC1 the candidate that changes nothing passes (the pass side of every test below)', () => {
    const t = releasesR1R2();
    expectPass(check(t, 'R3'), 'R3 equal to R2');
  }, 120_000);

  it('AC1 removing deep.arrived, which arrived in R2, fails naming the method and R2', () => {
    const t = releasesR1R2();
    removeApi(t, 'deep.arrived');
    expectFailNaming(check(t, 'R3'), 'a removed method', 'deep.arrived', /arrived in R2/);
  }, 120_000);

  it('AC1 removing deep.on, which arrived in R1, fails naming the method and R1', () => {
    const t = releasesR1R2();
    removeApi(t, 'deep.on');
    expectFailNaming(check(t, 'R3'), 'a removed method', 'deep.on', /arrived in R1/);
  }, 120_000);

  it('AC1 retyping a field of deep.arrived fails naming the method, the field and R2', () => {
    const t = releasesR1R2();
    reshapeApi(t, 'deep.arrived', retype);
    expectFailNaming(check(t, 'R3'), 'a reshaped method', 'deep.arrived', 'type', /arrived in R2/);
  }, 120_000);
});

/** A reshaped deep.arrived with its diff line, as the step prints it with no break file. */
function reshaped(): { t: Tree; lines: string[] } {
  const t = releasesR1R2();
  reshapeApi(t, 'deep.arrived', retype);
  const r = check(t, 'R3');
  expectFailNaming(r, 'the reshaped method, no break file', 'deep.arrived');
  const lines = diffLines(r).filter((l) => l.startsWith('diff: R2_R3 '));
  expect(lines.length, `the step prints diff lines for the R2 to R3 change of deep.arrived, each starting "diff: R2_R3 "\n${shown(r)}`).toBeGreaterThan(0);
  for (const l of lines) expect(l, 'a diff line names the entry').toContain('deep.arrived');
  return { t, lines };
}

/** The wrong-line scenario: a break file quoting another entry's line. Throws what the criterion names when the step passes it. */
function quotedOtherLine(plant?: StepPlant): void {
  const { t, lines } = reshaped();
  breakFile(t, 'R2', 'R3', '139', lines.map((l) => l.replace('deep.arrived', 'deep.other')));
  const r = step(['check', '--release', 'R3'], { root: t.root, ...(plant ? { plant } : {}) });
  if (r.code === 0) throw Error(`a break file quoting a different line passed: the step exits 0 for it (${plant ?? 'the shipped step'})`);
  expectFailNaming(r, 'a break file quoting a different line', 'deep.arrived');
}

describe('#139.5c4d4a53 a planted break whose break file quotes a different line fails; one that quotes the exact line passes, and the release notes list it', () => {
  it('AC2 a break file that quotes a different line fails, still naming the method', () => {
    quotedOtherLine();
  }, 120_000);

  it('AC2 a break file with the exact line and no workaround fails', () => {
    const { t, lines } = reshaped();
    breakFile(t, 'R2', 'R3', '139', lines, '');
    expectFailNaming(check(t, 'R3'), 'a break file with no workaround', 'deep.arrived');
  }, 120_000);

  it('AC2 a break file that quotes the exact line and the workaround passes, and the release notes list it', () => {
    const { t, lines } = reshaped();
    breakFile(t, 'R2', 'R3', '139', lines, 'Pass the field as an integer.');
    expectPass(check(t, 'R3'), 'the break with its reviewed file');
    const notes = step(['notes', '--release', 'R3'], { root: t.root });
    expect(notes.code, `the notes command succeeds\n${shown(notes)}`).toBe(0);
    for (const part of ['deep.arrived', ...lines, 'Pass the field as an integer.', '139']) expect(notes.stdout, `the release notes list the break: ${part}`).toContain(part);
  }, 120_000);

  it('AC2 (wrong program) a step that accepts any break file passes the different line, and this test fails it', () => {
    needStep();
    expect(() => quotedOtherLine('any-break-file')).toThrow(/a break file quoting a different line passed/);
  }, 120_000);

  it('AC2 the diff runs against every earlier release: a break file for R2 to R3 alone leaves the R1 to R3 diff failing, naming R1_R3', () => {
    const t = releasesR1R2();
    removeApi(t, 'deep.on');
    const bare = check(t, 'R3');
    const lines = diffLines(bare);
    const second = lines.filter((l) => l.startsWith('diff: R2_R3 '));
    expect(second.length, `a diff line for R2 to R3\n${shown(bare)}`).toBeGreaterThan(0);
    expect(lines.some((l) => l.startsWith('diff: R1_R3 ')), `and one for R1 to R3\n${shown(bare)}`).toBe(true);
    breakFile(t, 'R2', 'R3', '139', second);
    const r = check(t, 'R3');
    expectFailNaming(r, 'only R2_R3 reviewed', 'deep.on', 'R1_R3');
    expect(failLines(r).some((l) => l.includes('R2_R3')), 'the reviewed R2_R3 diff no longer fails').toBe(false);
    breakFile(t, 'R1', 'R3', '139', lines.filter((l) => l.startsWith('diff: R1_R3 ')));
    expectPass(check(t, 'R3'), 'both pairs reviewed');
  }, 120_000);
});

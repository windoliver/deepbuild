// AC6 #538.8cc15bf5: A group with 40 dialogue children and flip {array: story.line, map: {0 to 39 → its children}} shows
// child 37 alone while story.line is 37, the same frame when seeked to from the end; story.line 52 shows no child and
// raises flip.unmapped naming 52, story.line and the step; and a planted flip that holds the last child shown on an
// unmapped value shows child 37 and fails, naming the step
//
// The dialogue (fixtures.ts `dialogueDoc`): `dialogue`, a group whose 40 text children `l0` to `l39` all stand at (8,
// 12), flipped by `story.line[0]` (programs.ts `storyProgram`: 12 before step 20, 37 at steps 20 to 59, 52 at 60 to 89,
// 5 from 90). The frame read is the one the hub's session draws (`frames` and `eval`, the scheduler's frame), not a
// replay of the document's items. Played: `frames` from 0 to step 60 with each frame's pixel hash. Seeked: on a second
// session, `eval` at step 119 (the transport's last frame), then at step 45. "Child 37 alone" is the hash of the group
// holding `l37` alone, with no flip and no logic (`dialogueRef(37)`); "no child" is a frame that draws nothing. The issue
// is `eval`'s at step 60.
import { describe, expect, it } from 'vitest';
import { LINE, lineAt, storyProgram } from './programs.ts';
import { dialogueDoc, dialogueRef } from './fixtures.ts';
import {
  AC, DOC, TIMEOUT, at, binOf, evalCall, failsNaming, field, framesCall, framesOf, inked, issuesOf, names, none, pngOf, prebuild, presented,
  putEvidence, runShow, scenario, show, showCall, snapshotOf, str, useTemp, type JsonObject, type Planted,
} from './helpers.ts';

prebuild(['full']);
const temp = useTemp();
const D = { play: DOC(1), seek: DOC(2), ref: DOC(3) };
const SHOWN = 37;
const PLAYED = LINE.unmapped + 1;
const SEEK_AT = 45;
const END = 119;

interface Run { ev: string; ref: string; played: string[]; seeked: string | null; issues: JsonObject[] }
function flipRun(planted?: Planted): Run {
  const ev = temp();
  const program = storyProgram();
  putEvidence(ev, program.bytes);
  const calls: JsonObject[] = [
    showCall(D.ref, dialogueRef(SHOWN)), evalCall(D.ref, 0),
    showCall(D.play, dialogueDoc(program)), framesCall(D.play, PLAYED, { pixels: true }), evalCall(D.play, at(LINE.unmapped), { pixels: false }),
    ...(planted ? [] : [showCall(D.seek, dialogueDoc(program)), evalCall(D.seek, at(END)), evalCall(D.seek, at(SEEK_AT))]),
  ];
  const r = runShow(binOf(), scenario(ev, Object.values(D), calls, planted), 'AC6 the dialogue');
  presented(r[0]!, 'the group holding child 37 alone, with no flip');
  presented(r[2]!, 'the dialogue');
  const played = framesOf(r[3]!, PLAYED, 'the dialogue played from 0').map((f, k) => str(f['pixel_hash'], `the dialogue's frame ${k}: pixel_hash`));
  if (!planted) presented(r[5]!, 'the dialogue, a second session');
  return { ev, ref: snapshotOf(r[1]!, 'child 37 alone'), played, issues: issuesOf(r[4]!), seeked: planted ? null : snapshotOf(r[7]!, 'the dialogue at step 45, seeked from the end') };
}
/** The judge: while story.line is 37 each played frame is child 37 alone, and at step 60 (52, unmapped) no child shows;
 * a failure names the step. */
function playFailures(run: Run): string[] {
  const out: string[] = [];
  for (let k = LINE.first; k < PLAYED; k++) {
    const h = run.played[k]!;
    if (lineAt(k) === SHOWN && h !== run.ref) out.push(`step ${k} (story.line 37): the frame isn't child 37 alone`);
    if (lineAt(k) === 52) {
      const ink = inked(pngOf(run.ev, h, `the frame at step ${k}`));
      if (ink > 0) out.push(`step ${k} (story.line 52, unmapped): shows ${h === run.ref ? 'child 37' : 'a child'} (${ink} px drawn), not no child`);
    }
  }
  return out;
}

describe(`${AC[6]} a flip whose child a logic array picks`, () => {
  it(`${AC[6]} story.line 37 shows child 37 alone, played and seeked from the end; story.line 52 shows no child and raises flip.unmapped naming 52, story.line and the step`, () => {
    const run = flipRun();
    none(playFailures(run), 'the dialogue played from step 20 to step 60');
    expect(run.seeked, 'seeked to step 45 from the end, the frame is child 37 alone').toBe(run.ref);
    expect(run.seeked, 'and it is the frame played to step 45').toBe(run.played[SEEK_AT]);
    const raised = run.issues.filter((i) => i['code'] === 'flip.unmapped');
    const naming = raised.filter((i) => field(i, 'value') === 52 && names(String(field(i, 'array')), 'story.line') && field(i, 'step') === LINE.unmapped);
    expect(naming.length, `eval at step 60 raises flip.unmapped {value: 52, array: story.line, step: 60}; its issues: ${show(run.issues, 2500)}`).toBeGreaterThan(0);
  }, TIMEOUT);

  it(`${AC[6]} planted flip_holds_last_child shows child 37 at step 60 and fails, naming the step`, () => {
    const run = flipRun('flip_holds_last_child');
    expect(run.played[LINE.unmapped], 'under the planted flip, step 60 still shows child 37').toBe(run.ref);
    failsNaming(playFailures(run), [/step 60\b/], 'the dialogue under flip_holds_last_child');
  }, TIMEOUT);
});

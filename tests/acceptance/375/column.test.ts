import { describe, expect, it } from 'vitest';
import {
  LAYOUT_BIN, boxOf, children, clone, expectBadInput, fixture, item, measure, near, params, solve, solveAll, useBinaries,
  type Box, type JsonObject,
} from './helpers.ts';

useBinaries('deep-layout', 'deep-text');

const DOC = fixture('column.doc.json');
const FRAME = 'card';
/** The criterion's column: gap 12 and padding 8. */
const GAP = 12;
const PADDING = 8;
/** The second item's text, grown by one line (an explicit line break; text@1 breaks lines by UAX #14). */
const GROWN = 'Checks are waiting on you\nbefore the plan can go ahead';

function grown(): JsonObject {
  const doc = clone(DOC);
  params(doc, 'status')['text'] = GROWN;
  return doc;
}

/** The fixture is the criterion's column: three text items in a column frame with gap 12 and padding 8. */
function expectFixture(doc: JsonObject): string[] {
  const frame = params(doc, FRAME);
  expect([frame['layout'], frame['gap'], frame['padding']], 'the fixture frame is a column with gap 12 and padding 8').toEqual(['column', GAP, PADDING]);
  const kids = children(doc, FRAME);
  expect(kids, 'the frame holds three items, in order key order').toEqual(['title', 'status', 'note']);
  for (const id of kids) expect(item(doc, id)['kind'], `${id} is a text item`).toBe('text@1');
  return kids;
}

/**
 * The column hugs its three text leaves: each leaf is the size the canvas's one shaper measures for
 * it, placed at the padding with the gap between, and the frame is padding + content + padding.
 */
function expectHugs(doc: JsonObject, boxes: Record<string, Box>, what: string): void {
  const kids = expectFixture(doc);
  const frame = boxOf(boxes, FRAME, what);
  const boxesOfKids = kids.map((id) => boxOf(boxes, id, what));
  const measured = measure(kids.map((id) => params(doc, id)));
  // The frame sits where its `at.pos` puts it.
  near(frame.x, 40, `${what}: the frame's x (at.pos)`);
  near(frame.y, 32, `${what}: the frame's y (at.pos)`);
  let y = frame.y + PADDING;
  for (const [i, id] of kids.entries()) {
    const b = boxesOfKids[i]!;
    const m = measured[i]!;
    // A text leaf measured by anything but the shaper (a char-count estimate, a system font, zero) fails here.
    near(b.w, m.width, `${what}: ${id}'s width is the shaper's (deep-text fit)`);
    near(b.h, m.height, `${what}: ${id}'s height is the shaper's (deep-text fit, ${m.lines} line(s))`);
    // A layout that ignores padding puts the leaves at the frame's edge.
    near(b.x, frame.x + PADDING, `${what}: ${id} starts at the left padding`);
    // A layout that ignores the gap (or the padding) stacks the leaves at other heights.
    near(b.y, y, `${what}: ${id} sits ${i === 0 ? 'at the top padding' : `${GAP} u below ${kids[i - 1]}`}`);
    y += m.height + GAP;
  }
  const widest = Math.max(...measured.map((m) => m.width));
  const tall = measured.reduce((sum, m) => sum + m.height, 0) + GAP * (kids.length - 1);
  near(frame.w, PADDING + widest + PADDING, `${what}: the frame hugs its widest item's width plus the padding on both sides`);
  near(frame.h, PADDING + tall + PADDING, `${what}: the frame hugs its items' heights, two gaps and the padding`);
}

describe('AC1 a column frame of three text items with gap 12 and padding 8 hugs them within 0.5 u and moves the third down by the second\'s new height when its text grows by one line', () => {
  it('AC1 the column hugs its three text items within 0.5 u, each measured by the shaper', () => {
    expectHugs(DOC, solve(DOC, 'the column'), 'the column');
  });

  it('AC1 when the second item\'s text grows by one line, the third moves down by its new height and the frame still hugs', () => {
    const doc = grown();
    const [before, after] = solveAll([DOC, doc], 'the column, then with the second text grown');
    const [was, now] = measure([params(DOC, 'status'), params(doc, 'status')]);
    expect(now!.lines, 'the grown text is one line longer as the shaper breaks it').toBe(was!.lines + 1);
    const grew = now!.height - was!.height;
    expect(grew > 0, `the grown text is taller (by ${grew} u)`).toBe(true);
    const status = [boxOf(before!, 'status', 'before'), boxOf(after!, 'status', 'after')] as const;
    const note = [boxOf(before!, 'note', 'before'), boxOf(after!, 'note', 'after')] as const;
    const title = [boxOf(before!, 'title', 'before'), boxOf(after!, 'title', 'after')] as const;
    const frame = [boxOf(before!, FRAME, 'before'), boxOf(after!, FRAME, 'after')] as const;
    near(status[1].h - status[0].h, grew, 'the second item grows by one line\'s height (the shaper\'s)');
    // A layout that keeps the third where it was (or moves it by anything but the second's growth) fails here.
    near(note[1].y - note[0].y, grew, 'the third item moves down by exactly the second\'s height change');
    near(note[1].y, status[1].y + status[1].h + GAP, 'the third item sits 12 u below the second\'s new bottom');
    near(title[1].y, title[0].y, 'the first item stays put');
    near(frame[1].h - frame[0].h, grew, 'the frame grows by the same height');
    expectHugs(doc, after!, 'the column with the second text grown');
  });

  it('AC1 deep-layout solve answers bad_input to a line it can\'t read', () => {
    expectBadInput(LAYOUT_BIN, 'solve');
  });
});

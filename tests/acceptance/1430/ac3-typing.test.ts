// AC3 #1430.550b2a5e: "One typed character in a 50 KB text reshapes one paragraph"
//
// One `deep-text shape` process lays the long text (100 paragraphs, 51,299 bytes) out at 640 px, then the same text with
// `q` typed at character 256 of paragraph 42, sent whole as the next line at the same width (README: How a typed
// character is sent). The second line's `shaped` must list that one paragraph, as typed, and nothing else.
// `--planted whole_text` is this criterion's wrong program: a long text shaped as one run, as at the base, so a typed
// character reshapes all of it.
import { describe, expect, it } from 'vitest';
import {
  AC, LONG_TEXT, TIMEOUT, TYPED_PARAGRAPH, TYPED_TEXT, TYPING_WIDTH, countIn, layoutAt, longTextFailures, none, shapeLines, typedFailures,
  useRelease,
} from './helpers.ts';

useRelease('deep-text');
const ID = AC[3];
const TYPING = [layoutAt(LONG_TEXT, TYPING_WIDTH), layoutAt(TYPED_TEXT, TYPING_WIDTH)];

describe(`${ID} a long text shapes per paragraph, so typing reshapes only the paragraph it changes`, () => {
  it(`${ID} one character typed into a 50 KB text of 100 paragraphs reshapes the one paragraph it changes`, () => {
    none(longTextFailures(), 'the long text');
    none(typedFailures(shapeLines(TYPING).replies), 'the typed character');
  }, TIMEOUT);

  it(`${ID} the planted program that shapes a long text as one run reshapes all of it for one typed character and fails, naming what it reshaped`, () => {
    const failures = typedFailures(shapeLines(TYPING, 'whole_text').replies);
    expect(countIn(failures, /reshaped \d+ texts?, ([\d,]+) characters in all/, 'the planted whole-text shaper'), `the planted program reshaped more than the typed paragraph's ${TYPED_PARAGRAPH.length} characters`).toBeGreaterThan(TYPED_PARAGRAPH.length);
  }, TIMEOUT);
});

import { describe, expect, it } from 'vitest';
import { COUNTER_TICKS, LABEL_300, TEXT_BIN, counterFailures, judge, runLines, shape, shapeReply, useRelease } from './helpers.ts';

useRelease('deep-text');

/** Warm lines per run: at 2 µs a glyph, 5,000 shapes of 300 glyphs may take 3 s, far past the start-up noise the difference removes. */
const WARM_LINES = 5_000;
const WARM_US_PER_GLYPH = 2;

describe('AC1 text is shaped once and reused: a warm 300-glyph label under 2 µs a glyph, and a counter that reuses every repeated text', () => {
  it('AC1 on an optimized build, shaping a 300-glyph label already shaped once takes under 2 µs per glyph (five runs after a warm-up)', () => {
    const label = { text: LABEL_300 };
    // Measured from outside the program: a process that shapes the label once, against one that shapes it once
    // and then 5,000 times more; the difference is the 5,000 warm shapes, line reading and writing included.
    const pair = (): number => {
      const once = runLines(TEXT_BIN, ['shape'], [label]);
      const cold = shapeReply(once.lines[0], 'the first shape of the label');
      expect(cold.glyphs, 'the label shapes to 300 glyphs').toBe(300);
      expect(cold.shaped, 'the first shape of the label in a fresh process shapes it, to its 300 glyphs').toEqual([{ text: LABEL_300, glyphs: 300 }]);
      const warm = runLines(TEXT_BIN, ['shape'], [label, ...Array.from({ length: WARM_LINES }, () => label)]);
      warm.lines.forEach((line, i) => {
        const r = shapeReply(line, `shape line ${i + 1} of the label`);
        expect(r.glyphs, `line ${i + 1}: the label's run has its 300 glyphs`).toBe(300);
        // A shaper with no cache fails here, naming the glyphs it shaped again.
        if (i > 0) expect(r.shaped, `line ${i + 1}: the label, shaped once already, is shaped again (${r.shaped.reduce((s, x) => s + x.glyphs, 0)} glyphs)`).toEqual([]);
      });
      return (Math.max(0, warm.ms - once.ms) * 1000) / (WARM_LINES * 300);
    };
    pair();
    const runs = Array.from({ length: 5 }, pair);
    judge('µs per glyph shaping the 300-glyph label warm', runs, WARM_US_PER_GLYPH);
  }, 1_800_000);

  it('AC1 a counter that ticks 60 times reuses every run whose text repeats: each of its 12 texts is shaped once, the 48 repeats shape nothing', () => {
    const { replies } = shape(COUNTER_TICKS.map((text) => ({ text, number: true })));
    expect(counterFailures(COUNTER_TICKS, replies), 'the counter\'s ticks').toEqual([]);
  }, 1_800_000);

  it('AC1 the planted shaper with no cache shapes each tick and fails, naming the glyphs it shaped', () => {
    const { replies } = shape(COUNTER_TICKS.map((text) => ({ text, number: true })), 'no_cache');
    const failures = counterFailures(COUNTER_TICKS, replies);
    expect(failures.length, 'the planted shaper with no cache fails the counter\'s check').toBeGreaterThan(0);
    expect(failures.join('\n'), 'the failure names the glyphs shaped again').toMatch(/shaped it again: [1-9]\d* glyphs shaped/);
    expect(failures.at(-1), 'the failure names every glyph shaped against the distinct texts\' glyphs').toMatch(/shaped [1-9]\d* glyphs where the counter's 12 distinct texts have [1-9]\d*/);
  }, 1_800_000);
});

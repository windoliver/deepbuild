// Criterion 5 (#3401.51a09d90): no generated heading's own text is over 8,192 bytes. The largest is printed with its
// size as a diagnostic, for the PR to name; the PR's text is not a surface a test reads.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CP, HEADING_LIMIT, generatedOf, read } from './helpers.mjs';

test('#3401.51a09d90 AC5: no generated heading\'s own text is over 8,192 bytes', (t) => {
  const { section, headings } = generatedOf(read(CP));
  assert.ok(section, `${CP} has no heading with the anchor #registries-and-closed-lists`);
  assert.ok(headings.length >= 2, `${CP} holds its field lists under ${headings.length} generated headings inside Registries and closed lists, not several, each under a heading of its own`);
  assert.equal(section.rows.length, 0, `${section.rows.length} generated rows sit under the section's own heading, outside every generated heading`);
  const over = headings.filter((heading) => heading.size > HEADING_LIMIT).map((heading) => `${heading.key}: ${heading.size} bytes of its own text`);
  assert.deepEqual(over, [], `${over.length} generated headings hold more than ${HEADING_LIMIT} bytes of their own text`);
  const largest = headings.reduce((a, b) => (b.size > a.size ? b : a));
  t.diagnostic(`${headings.length} generated headings; the largest is ${largest.key}, ${largest.size} bytes of its own text`);
});

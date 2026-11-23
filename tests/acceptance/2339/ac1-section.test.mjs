// #2339 criterion 1, read from the design itself: the Principles section, where it sits, how many lines it holds,
// and each line one sentence of at most 160 characters with a link into the design (README: The surface).
import assert from 'node:assert/strict';
import test from 'node:test';
import { CHECKOUT, DESIGN, NEXT_HEADING, designLinks, invariants, principles, read, render, sentences } from './helpers.mjs';

test('#2339.2ae5a05d criterion 1: docs/technical-design.md has a "Principles" section before "What version 0 builds, and what waits", of 8 to 12 lines, each one sentence of at most 160 characters with a link into the design', () => {
  const section = principles(read(CHECKOUT, DESIGN));
  assert.ok(section, `${DESIGN} has no heading "Principles"`);
  assert.ok(section.beforeNext, `the Principles section (line ${section.heading.index + 1}) does not end before "${NEXT_HEADING}" (line ${(section.nextIndex ?? -1) + 1})`);
  const count = section.lines.length;
  assert.ok(count >= 8 && count <= 12, `the Principles section holds ${count} lines, not between 8 and 12:\n${section.lines.map((l) => l.raw).join('\n')}`);
  const inv = invariants(read(CHECKOUT, 'AGENTS.md'));
  const problems = [];
  for (const line of section.lines) {
    const text = render(line.content);
    if (text.length > 160) problems.push(`${DESIGN}:${line.number} reads ${text.length} characters, over 160: ${text}`);
    // An invariant's own line keeps AGENTS.md's sentences word for word (criterion 2), so it may hold as many
    // sentences as the invariant does; every other line holds one.
    const invariant = line.ordinal <= 4 ? inv.find((i) => i.number === line.ordinal) : undefined;
    const allowed = invariant && text.includes(render(invariant.text)) ? sentences(invariant.text).length : 1;
    const held = sentences(line.content);
    if (held.length > allowed) problems.push(`${DESIGN}:${line.number} holds ${held.length} sentences, not ${allowed}: ${held.map((s) => JSON.stringify(s)).join(' ')}`);
    if (!designLinks(line.content).length) problems.push(`${DESIGN}:${line.number} links nothing in the design: ${line.raw}`);
  }
  assert.deepEqual(problems, [], problems.join('\n'));
});

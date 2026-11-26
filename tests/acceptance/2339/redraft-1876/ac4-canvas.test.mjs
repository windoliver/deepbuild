// #2339 criterion 4, redrafted blind (README.md, beside this file): the canvas reference's "Conventions every
// primitive uses" opens with a link to the design's Principles section, and on a scratch copy of the checkout's whole
// tree the design links lane fails a canvas reference without that link, naming the heading it belongs under.
import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { CANVAS, CHECKOUT, CONVENTIONS, DESIGN, conventions, failed, namesHeading, principles, read, scratch, shown, toSection, withoutSectionLinks } from './helpers.mjs';

const copy = scratch();
after(() => copy.remove());

test('#2339.6eaafe21 criterion 4: the canvas reference\'s "Conventions every primitive uses" opens with a link to the section', () => {
  const { anchors } = principles(read(CHECKOUT, DESIGN));
  const { heading, first } = conventions(read(CHECKOUT, CANVAS));
  const links = first.flatMap(({ line }) => toSection(line, anchors));
  assert.ok(links.length >= 1, `the first paragraph under "${CONVENTIONS}" (${CANVAS}:${heading.index + 1}) holds no link to the design's Principles section (${DESIGN}#${[...anchors].join(' or #')}):\n${first.map(({ line }) => line).join('\n') || '(no paragraph before the next heading)'}`);
});

test('#2339.6eaafe21 criterion 4: a planted canvas reference without the link fails the design links lane, naming the heading it belongs under', (t) => {
  copy.unplanted(t);
  const { anchors } = principles(copy.read(DESIGN));
  const text = copy.read(CANVAS);
  const { heading, anchors: ids, opening } = conventions(text);
  // Each link to the section under the heading, up to the next heading, becomes its label; no other line changes.
  const lines = text.split('\n');
  for (const { index } of opening) lines[index] = withoutSectionLinks(lines[index], anchors);
  assert.notEqual(lines.join('\n'), text, `"${CONVENTIONS}" (${CANVAS}:${heading.index + 1}) holds no markdown link to the section to take out, so the plant would change nothing`);
  assert.deepEqual(opening.flatMap(({ index }) => toSection(lines[index], anchors)), [], `the planted canvas reference still links the section under "${CONVENTIONS}"`);
  copy.write(CANVAS, lines.join('\n'));
  const run = copy.lane();
  failed(run, `a canvas reference whose "${CONVENTIONS}" (${CANVAS}:${heading.index + 1}) has no link to the Principles section`);
  assert.ok(namesHeading(run, { text: CONVENTIONS, slug: heading.id, anchors: ids, line: heading.index + 1 }), `the lane failed without naming the heading "${CONVENTIONS}" (${CANVAS}:${heading.index + 1}): ${shown(run)}`);
});

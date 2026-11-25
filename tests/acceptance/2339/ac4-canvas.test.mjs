// #2339 criterion 4: docs/canvas-primitives.md's "Conventions every primitive uses" opens with a link to the Principles
// section, and the design links lane fails a planted copy without it, naming the heading (README: The canvas link).
import assert from 'node:assert/strict';
import test from 'node:test';
import { CANVAS, CHECKOUT, CONVENTIONS, DESIGN, headings, principles, prose, read, resolve, runLane, shown, targets, write, clean } from './helpers.mjs';

/** The heading "Conventions every primitive uses" and its opening: the lines after it up to its first subheading. */
function conventions(text) {
  const all = headings(text);
  const heading = all.find((h) => h.text === CONVENTIONS);
  if (!heading) throw new Error(`${CANVAS} has no heading "${CONVENTIONS}"`);
  const end = all.find((h) => h.index > heading.index)?.index ?? text.split('\n').length;
  const opening = prose(text).filter(({ index }) => index > heading.index && index < end);
  return { heading, opening };
}

/** The opening's first paragraph: its first run of non-blank lines that aren't lone anchors. */
const firstParagraph = (opening) => {
  const lines = opening.filter(({ line }) => line.replace(/<a\s[^>]*>(?:\s*<\/a>)?/gi, '').trim() || !line.trim());
  const start = lines.findIndex(({ line }) => line.trim());
  if (start < 0) return [];
  const rest = lines.slice(start);
  const stop = rest.findIndex(({ line }) => !line.trim());
  return stop < 0 ? rest : rest.slice(0, stop);
};

const toSection = (line, anchors) => targets(line).filter((t) => {
  const link = resolve(t, CANVAS);
  return link && link.file === DESIGN && anchors.has(link.id);
});

test('#2339.6eaafe21 criterion 4: the canvas reference\'s "Conventions every primitive uses" opens with a link to the Principles section', () => {
  const section = principles(read(CHECKOUT, DESIGN));
  assert.ok(section, `${DESIGN} has no heading "Principles"`);
  const { heading, opening } = conventions(read(CHECKOUT, CANVAS));
  const first = firstParagraph(opening);
  const links = first.flatMap(({ line }) => toSection(line, section.anchors));
  assert.ok(links.length >= 1, `the first paragraph under ${CANVAS}:${heading.index + 1} "${CONVENTIONS}" has no link to the Principles section (#${[...section.anchors].join(' or #')}):\n${first.map(({ line }) => line).join('\n') || '(no paragraph before its first subheading)'}`);
});

test('#2339.6eaafe21 criterion 4: a planted canvas reference without the link fails the design links lane, naming the heading it belongs under', (t) => {
  const { repo, issues, section, standIn } = clean(t);
  const text = read(repo, CANVAS);
  const { heading, opening } = conventions(text);
  const lines = text.split('\n');
  // Every link from the heading's opening into the section becomes its label.
  for (const { index } of opening) {
    lines[index] = lines[index].replace(/(!?)\[([^\]]*)\]\(\s*<?([^\s)>]+)[^)]*\)/g, (whole, bang, label, target) => {
      const link = resolve(target, CANVAS);
      return link && link.file === DESIGN && section.anchors.has(link.id) ? label : whole;
    });
  }
  write(repo, CANVAS, lines.join('\n'));
  assert.equal(opening.flatMap(({ index }) => toSection(lines[index], section.anchors)).length, 0, 'the planted canvas reference still links the section');
  const run = runLane(repo, issues);
  assert.notEqual(run.status, 0, `the lane passed a canvas reference whose "${CONVENTIONS}" has no link to the Principles section${standIn ? ' (stand-in section)' : ''}: ${shown(run)}`);
  const at = new RegExp(`canvas-primitives\\.md(?::|,? lines? |#L)(?:\\d+,\\s?)*${heading.index + 1}(?!\\d)`);
  const named = run.lines.find((l) => l.toLowerCase().includes(CONVENTIONS.toLowerCase()) || l.includes(heading.id) || /#conventions\b/.test(l) || at.test(l));
  assert.ok(named, `the lane failed without naming "${CONVENTIONS}": ${shown(run)}`);
});

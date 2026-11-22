// Criterion 4 (#2339.6eaafe21): the canvas reference's link to the section lands, by the same lane. A planted canvas
// reference without the link fails, naming the heading it belongs under ("Conventions every primitive uses", which the
// Scope says opens with it). README: The surface.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { CANVAS, CANVAS_LINK, CHECKOUT, CONVENTIONS, DESIGN, failed, headings, makeCopy, namesHeading, passed, plantConventionsOpening, plantSection, plantedLines, principles, readRepo, resolveTarget, runLinksLane, writeRepo } from './helpers.mjs';

const ID = '#2339.6eaafe21';

test(`${ID} AC4 the canvas reference's "${CONVENTIONS}" opens with a link to the design's Principles section, and the design links lane passes on the real docs`, (t) => {
  const section = principles(readFileSync(join(CHECKOUT, DESIGN), 'utf8'));
  assert.ok(section, `${DESIGN} has no level-2 heading "Principles" for the canvas reference to link`);
  const canvas = readFileSync(join(CHECKOUT, CANVAS), 'utf8');
  const all = headings(canvas);
  const at = all.findIndex((h) => h.title === CONVENTIONS);
  assert.ok(at >= 0, `${CANVAS} has no heading "${CONVENTIONS}"`);
  const rows = canvas.split('\n').slice(all[at].number, all[at + 1].number - 1);
  const first = rows.find((row) => row.replace(/<a\s[^>]*>(?:\s*<\/a>)?/gi, '').trim());
  const links = [...(first ?? '').replace(/(`+).+?\1/g, '').matchAll(/\]\(\s*<?([^\s)>]+)/g)].map((m) => resolveTarget(m[1], CANVAS))
    .filter((l) => l?.file === DESIGN && section.anchors.includes(l.id));
  assert.equal(links.length, 1, `"${CONVENTIONS}" in ${CANVAS} doesn't open with one link to ${DESIGN}#${section.heading.slug} (or an <a id> of that heading: ${section.anchors.join(', ')}); its first line is: ${first ?? '(none before the next heading)'}`);

  const { repo, env } = makeCopy(t);
  const run = runLinksLane(repo, env);
  t.diagnostic(`the design links lane on the real docs:\n${run.output}`);
  assert.ok(passed(run), `the design links lane doesn't pass on the real docs:\n${run.output}`);
});

test(`${ID} AC4 a planted canvas reference whose "${CONVENTIONS}" has no link to the section fails the design links lane, naming that heading; with the link it passes`, (t) => {
  const { repo, env } = makeCopy(t);
  writeRepo(repo, DESIGN, plantSection(readRepo(repo, DESIGN), plantedLines(readRepo(repo, 'AGENTS.md'))));
  const canvas = readRepo(repo, CANVAS);
  writeRepo(repo, CANVAS, plantConventionsOpening(canvas, [CANVAS_LINK]));
  const twin = runLinksLane(repo, env);
  assert.ok(passed(twin), `the design links lane doesn't pass the planted canvas reference that opens "${CONVENTIONS}" with the link, so the planted fault below shows nothing:\n${twin.output}`);

  const planted = plantConventionsOpening(canvas, []);
  writeRepo(repo, CANVAS, planted);
  const heading = headings(planted).find((h) => h.title === CONVENTIONS);
  const run = runLinksLane(repo, env);
  assert.ok(failed(run), `the design links lane doesn't FAIL a canvas reference without the link to the Principles section:\n${run.output}`);
  assert.ok(namesHeading(run, heading), `the design links lane's output doesn't name the heading the link belongs under ("${CONVENTIONS}", #${heading.slug}, #${heading.ids.join(', #')} or ${CANVAS}:${heading.number}):\n${run.output}`);
});

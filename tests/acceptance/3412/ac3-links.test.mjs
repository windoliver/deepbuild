// AC3: each link in GLOSSARY.md lands; a planted link to a heading neither design doc has fails, naming the link.
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { join, posix } from 'node:path';
import { pathToFileURL } from 'node:url';
import { test } from 'node:test';
import { CANVAS, CHECKOUT, DESIGN, GLOSSARY, TERM, checkoutFile, failingLines, laneEnv, makeCopy, names, plantGlossary, runLintLane, summary } from './helpers.mjs';

const ID = '#3412.f32b0eaa';
const ANCHOR = 'zorvanthic-heading-3412';

test(`${ID} AC3: each link in GLOSSARY.md lands`, async () => {
  const glossary = checkoutFile(GLOSSARY);
  assert.ok(glossary !== undefined, `${GLOSSARY} is not at the repo root of the checkout`);
  // The design docs' anchors as the design links lane reads them (scripts/doc-links.mjs at the checkout).
  const { anchors } = await import(pathToFileURL(join(CHECKOUT, 'scripts', 'doc-links.mjs')).href);
  const links = [...glossary.replace(/(`+).+?\1/g, '').matchAll(/\]\(([^)\s]+)\)/g)].map((m) => m[1]).filter((l) => !/^[a-z]+:/i.test(l));
  assert.ok(links.length, `${GLOSSARY} holds no link into the repo`);
  const broken = links.filter((link) => {
    const [path, anchor] = link.split('#');
    const file = posix.normalize(path || GLOSSARY);
    if (!existsSync(join(CHECKOUT, file))) return true;
    return anchor !== undefined && file.endsWith('.md') && !anchors(join(CHECKOUT, file)).has(anchor);
  });
  assert.deepEqual(broken, [], `links in ${GLOSSARY} that land nowhere`);
});

for (const doc of [DESIGN, CANVAS]) {
  test(`${ID} AC3: a planted link to a heading neither design doc has (${doc}) fails, naming the link`, { timeout: 1_200_000 }, async (t) => {
    const { sandbox, repo } = makeCopy(t);
    const link = `${doc}#${ANCHOR}`;
    plantGlossary(repo, [`**${TERM}**:\nA fixture term the acceptance tests of this task plant, under [a heading no doc has](${link}).`], `change: a link to ${link}`);
    const lane = await runLintLane(repo, laneEnv(sandbox));
    assert.ok(!lane.missing, lane.missing);
    const named = failingLines(lane, (line) => names(line, ANCHOR));
    assert.ok(named.length, `no failing lint lane command names the link ${link}\n${summary(lane)}`);
  });
}

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CANVAS, CHECKOUT, HEADING, NAME, fixtureRow, laneEnv, makeCopy, namesList, newFailingLines, packRows, plantRows, read, runLintLane, section, summary } from './helpers.mjs';

const ID = '#3417.bdaf7f22';

const withoutPack = (s) => s.lines.filter((_, i) => !s.rows.some((r) => r.line === i && r.name === NAME));

function withTwo(s) {
  const lines = [...s.lines];
  const packs = s.rows.filter((r) => r.name === NAME);
  if (packs.length >= 2) return lines;
  if (packs.length === 1) {
    lines.splice(packs[0].line + 1, 0, lines[packs[0].line]);
    return lines;
  }
  const top = s.rows.filter((r) => r.heading.line === s.start);
  const last = (top.length ? top : s.rows).at(-1);
  const row = (means) => fixtureRow(last.width, NAME, means, 'package', 'A fixture row the acceptance tests of #3417 plant.');
  lines.splice(last.line + 1, 0, row('Fixture: canvas data and programs under a name and a version'), row('Fixture: the same word, listed a second time'));
  return lines;
}

let runs;
function lanes(t) {
  runs ??= (() => {
    const control = makeCopy(t);
    const none = makeCopy(t, { plant: (repo) => plantRows(repo, withoutPack) });
    const two = makeCopy(t, { plant: (repo) => plantRows(repo, withTwo) });
    const counts = { none: packRows(read(none.repo, CANVAS)).length, two: packRows(read(two.repo, CANVAS)).length };
    return Promise.all([control, none, two].map(({ sandbox, repo }) => runLintLane(repo, laneEnv(sandbox))))
      .then(([c, n, w]) => ({ control: c, none: n, two: w, counts }));
  })();
  return runs;
}

test(`${ID} AC1: One word per idea holds exactly one row named pack, with what it means, the words never to use for it and why`, () => {
  const s = section(read(CHECKOUT, CANVAS));
  assert.ok(s.start >= 0, `${CANVAS} has no heading "## ${HEADING}"`);
  const packs = s.rows.filter((r) => r.name === NAME);
  assert.equal(packs.length, 1, `${HEADING} holds ${packs.length} rows named ${NAME}: ${packs.map((r) => `line ${r.line + 1}`).join(', ')}`);
  const [row] = packs;
  assert.ok(row.means, `the ${NAME} row (line ${row.line + 1}) has no Means`);
  assert.ok(row.never && !/^none\.?$/i.test(row.never), `the ${NAME} row (line ${row.line + 1}) names no word never to call it: "${row.never ?? ''}"`);
  assert.ok(row.why, `the ${NAME} row (line ${row.line + 1}) has no Why`);
});

test(`${ID} AC1: a planted list with no row named pack fails the lint lane, naming the list`, { timeout: 3_600_000 }, async (t) => {
  const { control, none, counts } = await lanes(t);
  assert.ok(!none.missing, none.missing);
  assert.equal(counts.none, 0, 'the plant still holds a row named pack');
  const named = newFailingLines(none, control, namesList);
  assert.ok(named.length, `no failing lint lane command names ${HEADING} for a list with no row named ${NAME}\n${summary(none)}`);
});

test(`${ID} AC1: a planted list with two rows named pack fails the lint lane, naming the list`, { timeout: 3_600_000 }, async (t) => {
  const { control, two, counts } = await lanes(t);
  assert.ok(!two.missing, two.missing);
  assert.equal(counts.two, 2, 'the plant does not hold two rows named pack');
  const named = newFailingLines(two, control, namesList);
  assert.ok(named.length, `no failing lint lane command names ${HEADING} for a list with two rows named ${NAME}\n${summary(two)}`);
});

test(`${ID} AC1: the lint lane's check that fails those plants passes on the list as it is`, { timeout: 3_600_000 }, async (t) => {
  const { control, none, two } = await lanes(t);
  assert.ok(!control.missing, control.missing);
  const checks = [...new Set([...newFailingLines(none, control, namesList), ...newFailingLines(two, control, namesList)].map((l) => l.split(': ')[0]))];
  assert.ok(checks.length, `no lint lane command reads ${HEADING} for its ${NAME} row: neither plant made a failing command name the list`);
  for (const name of checks) {
    const run = control.runs.find((r) => r.name === name);
    assert.equal(run?.status, 0, `the lint lane's check (${name}) does not pass on ${HEADING} as it is:\n${run?.lines.join('\n')}`);
  }
});

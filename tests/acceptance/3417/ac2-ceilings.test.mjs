import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ANCHOR, CANVAS, CEILINGS, CHECKOUT, FIXTURE, HEADING, LIMIT, NAME, anchorOf, cleanEnv, commit, fixtureRow, git, headingSizes, laneCommands, laneEnv, makeCopy, names, read, runOne, section, write } from './helpers.mjs';

const ID = '#3417.fad053d0';
const OVER = 1234;

function ceilingsCommand(repo, env) {
  const { commands, missing } = laneCommands(repo, 'lint', env);
  return { missing, command: commands?.find((args) => args.some((a) => /(^|\/)doc-ceilings\.mjs$/.test(a))) };
}

test(`${ID} AC2: the doc ceilings check passes on the tree as it is`, { timeout: 1_200_000 }, async () => {
  const env = cleanEnv();
  const { missing, command } = ceilingsCommand(CHECKOUT, env);
  assert.ok(!missing, missing);
  assert.ok(command, 'the lint lane runs no scripts/doc-ceilings.mjs');
  const run = await runOne(CHECKOUT, env, command);
  assert.equal(run.status, 0, `the doc ceilings check fails:\n${run.lines.join('\n')}`);
  assert.ok(run.lines.some((l) => /^PASS doc-ceilings\b/.test(l)), `the doc ceilings check printed no PASS line:\n${run.lines.join('\n')}`);
});

test(`${ID} AC2: no ceiling in scripts/doc-ceilings.json is above the merge base's`, () => {
  const at = git(CHECKOUT, ['merge-base', 'HEAD', 'origin/main']).stdout.trim();
  const base = JSON.parse(git(CHECKOUT, ['show', `${at}:${CEILINGS}`]).stdout);
  const now = JSON.parse(read(CHECKOUT, CEILINGS));
  const above = Object.entries(now).filter(([key, ceiling]) => ceiling > (base[key] ?? LIMIT)).map(([key, ceiling]) => `${key}: ${ceiling}, at the merge base ${base[key] ?? `none (the limit, ${LIMIT})`}`);
  assert.deepEqual(above, [], `ceilings above the merge base's (${at.slice(0, 9)})`);
});

test(`${ID} AC2: a planted row that takes the section past its ceiling fails, naming the heading and the bytes over`, { timeout: 1_200_000 }, async (t) => {
  const { sandbox, repo } = makeCopy(t);
  const env = laneEnv(sandbox);
  const text = read(repo, CANVAS);
  const s = section(text);
  assert.ok(s.start >= 0 && s.rows.length, `${CANVAS} has no "## ${HEADING}" with a table`);
  const pack = s.rows.find((r) => r.name === NAME);
  const holder = pack?.heading ?? s.headings[0];
  const rows = s.rows.filter((r) => r.heading.line === holder.line);
  const after = (rows.length ? rows : s.rows).at(-1);
  const anchor = holder.line === s.start ? ANCHOR : anchorOf(repo, holder.line);
  const key = `${CANVAS}#${anchor}`;
  const sizes = headingSizes(repo);
  const ceiling = JSON.parse(read(repo, CEILINGS))[key] ?? LIMIT;
  const target = ceiling + OVER;
  const make = (fill) => fixtureRow(after.width, FIXTURE, 'A fixture row the acceptance tests of #3417 plant', 'ledger', `Fixture${fill}`);
  const pad = target - sizes[key] - Buffer.byteLength(make('')) - 1;
  const row = make(' fill'.repeat(Math.ceil(Math.max(pad, 0) / 5)).slice(0, Math.max(pad, 0)));
  const lines = text.split('\n');
  lines.splice(after.line + 1, 0, row);
  write(repo, CANVAS, lines.join('\n'));
  commit(repo, 'change: a row past the ceiling');
  const size = headingSizes(repo)[key];
  assert.equal(size, target, `the planted row takes ${key} to ${size} bytes, not ${target}`);

  const { missing, command } = ceilingsCommand(repo, env);
  assert.ok(!missing, missing);
  assert.ok(command, 'the lint lane runs no scripts/doc-ceilings.mjs');
  const run = await runOne(repo, env, command);
  assert.notEqual(run.status, 0, `the doc ceilings check passes a row that takes ${key} ${OVER} bytes past its ceiling:\n${run.lines.join('\n')}`);
  const forms = (n) => [String(n), n.toLocaleString('en-US')];
  const heading = (l) => names(l, anchor) || names(l, holder.text);
  const over = (l) => forms(OVER).some((n) => names(l, n)) || (forms(size).some((n) => names(l, n)) && forms(ceiling).some((n) => names(l, n)));
  assert.ok(run.lines.some((l) => heading(l) && over(l)), `no line of the doc ceilings check names ${key} and the ${OVER} bytes over its ceiling of ${ceiling}:\n${run.lines.join('\n')}`);
});

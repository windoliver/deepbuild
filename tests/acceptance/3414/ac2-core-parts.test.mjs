import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { DESIGN, PART, PLACES, checksOf, commit, failingLines, laneCommands, laneEnv, makeCopy, namesLine, plantFile, readIn, runCommands, summary, withPart } from './helpers.mjs';

const ID = '#3414.7a98bd4d';
const PLACE_WORDS = { scope: 'the scope section', blocks: 'Building blocks', diagram: 'the diagram' };
const cleanups = [];
after(() => { for (const clean of cleanups.reverse()) clean(); });
const cleanup = (fn) => cleanups.push(fn);

const naming = (line) => line.toLowerCase().includes(PART.split(' ')[0]);
const namesAPlace = (line, edited) => namesLine(line, DESIGN, edited) || Object.values(PLACES).some((p) => p.name.test(line));

async function editedRun(place, commands) {
  const { sandbox, repo } = makeCopy(cleanup);
  const env = laneEnv(sandbox);
  const { text, line } = withPart(readIn(repo, DESIGN), place);
  plantFile(repo, DESIGN, text);
  commit(repo, `change: ${PLACE_WORDS[place]} alone names one more part of the core`);
  const runs = await runCommands(repo, env, commands ?? laneCommands(repo, env, 'lint'));
  const found = failingLines(runs, naming);
  return { line, runs, found, named: found.filter((f) => namesAPlace(f.line, line)) };
}

let first;
const scopeRun = () => (first ??= editedRun('scope'));
const theCheck = async () => {
  const { found } = await scopeRun();
  return checksOf(found);
};

const editedAlone = (place) => async () => {
  const commands = place === 'scope' ? undefined : await theCheck();
  const { line, runs, found, named } = place === 'scope' ? await scopeRun() : await editedRun(place, commands.length ? commands : undefined);
  assert.ok(found.length, `no failing lint lane command names "${PART}", planted in ${PLACE_WORDS[place]} alone (${DESIGN}:${line})\n${summary(runs)}`);
  assert.ok(named.length, `the lines naming "${PART}" name no place (${PLACE_WORDS[place]}, Building blocks, the diagram, or ${DESIGN}:${line}):\n${found.map((f) => `${f.check}: ${f.line}`).join('\n')}`);
};

test(`${ID} AC2: the scope section edited alone fails the text check, naming the place and the part that differs`, { timeout: 1_800_000 }, editedAlone('scope'));
test(`${ID} AC2: Building blocks edited alone fails the text check, naming the place and the part that differs`, { timeout: 1_800_000 }, editedAlone('blocks'));
test(`${ID} AC2: the diagram edited alone fails the text check, naming the place and the part that differs`, { timeout: 1_800_000 }, editedAlone('diagram'));

test(`${ID} AC2: the scope section, Building blocks and the diagram as they are name the same parts of the core: the text check passes`, { timeout: 1_800_000 }, async () => {
  const checks = await theCheck();
  const { runs } = await scopeRun();
  assert.ok(checks.length, `no lint lane command reads the three places: one more part in the scope section alone made no failing command name "${PART}"\n${summary(runs)}`);
  const { sandbox, repo } = makeCopy(cleanup);
  commit(repo, 'change: nothing more');
  for (const place of Object.keys(PLACES)) assert.ok(PLACES[place].find(readIn(repo, DESIGN)), `${DESIGN} has no list of the core's parts in ${PLACE_WORDS[place]}`);
  const real = await runCommands(repo, laneEnv(sandbox), checks);
  assert.deepEqual(real.filter((r) => r.status !== 0).map((r) => r.name), [], `the text check fails on the design as it is:\n${summary(real)}`);
});

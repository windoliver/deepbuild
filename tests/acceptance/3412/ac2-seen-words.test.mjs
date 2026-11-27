// AC2: no word a person sees is a word to avoid. The check reads the words of States people see and the plain words of
// contracts/plain-words.json; a planted entry that lists "result" as a word to avoid fails, naming the term and the
// list that holds the word.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CHECKOUT, GLOSSARY, LIST_NAMES, TERM, checkoutFile, failingLines, laneEnv, makeCopy, names, plantGlossary, runLintLane, seenWords, summary } from './helpers.mjs';

const ID = '#3412.032a43e1';

/** The lists, by key of LIST_NAMES, that hold a word in this tree. */
function holders(root, word) {
  const seen = seenWords(root);
  return Object.keys(LIST_NAMES).filter((key) => seen[key].some((w) => w.toLowerCase() === word.toLowerCase()));
}

/** Plants an entry avoiding `word`; the failing lines must name the term and a list that holds the word. */
async function plantAvoid(t, word) {
  const { sandbox, repo } = makeCopy(t);
  const lists = holders(repo, word);
  assert.ok(lists.length, `no list in the copy holds "${word}", so the plant proves nothing`);
  plantGlossary(repo, [`**${TERM}**:\nA fixture term the acceptance tests of this task plant.\n_Avoid_: ${word}`], `change: avoid ${word}`);
  const lane = await runLintLane(repo, laneEnv(sandbox));
  assert.ok(!lane.missing, lane.missing);
  const named = failingLines(lane, (line) => names(line, TERM) && lists.some((key) => LIST_NAMES[key].some((n) => names(line, n))));
  assert.ok(named.length, `no failing lint lane command names "${TERM}" and ${lists.map((k) => LIST_NAMES[k][0]).join(' or ')}, the list holding "${word}", which the plant lists under Avoid\n${failingLines(lane, (l) => names(l, TERM)).join('\n')}\n${summary(lane)}`);
}

test(`${ID} AC2: no word a person sees is listed under Avoid in GLOSSARY.md`, () => {
  const glossary = checkoutFile(GLOSSARY);
  assert.ok(glossary !== undefined, `${GLOSSARY} is not at the repo root of the checkout`);
  const avoided = glossary.split('\n').filter((l) => /^_Avoid_:/.test(l))
    .flatMap((l) => l.replace(/^_Avoid_:/, '').split(/[,;]/)).map((w) => w.replace(/\(.*?\)/g, '').trim()).filter(Boolean);
  assert.ok(avoided.length, `${GLOSSARY} lists no word under Avoid`);
  const seen = seenWords(CHECKOUT);
  const clashes = avoided.filter((w) => [...seen.plain, ...seen.states].some((s) => s.toLowerCase() === w.toLowerCase()));
  assert.deepEqual(clashes, [], `${GLOSSARY} lists words a person sees under Avoid`);
});

test(`${ID} AC2: a planted entry that lists "result" as a word to avoid fails, naming the term and the list that holds the word`, { timeout: 1_200_000 }, async (t) => {
  await plantAvoid(t, 'result');
});

test(`${ID} AC2: the check reads the words of States people see: a planted entry that lists "queued" fails, naming the term and that list`, { timeout: 1_200_000 }, async (t) => {
  await plantAvoid(t, 'queued');
});

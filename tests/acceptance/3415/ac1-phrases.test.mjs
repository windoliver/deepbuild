import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DOCS, LIMIT, PHRASES, baseFile, lineOf, makeCopy, named, plant, read, runCheck, shown, write } from './helpers.mjs';

const ID = '#3415.2e31d57b';
const prose = (phrase) => `Zorvanthic fixture line: the ${phrase} waits beside the fixture ledger.`;

for (const doc of DOCS) {
  test(`${ID} AC1: a planted line of prose in ${doc} holding each of the five phrases fails, naming the file, the line and the phrase`, LIMIT, (t) => {
    const { sandbox, repo } = makeCopy(t);
    const { text } = plant(read(repo, doc), PHRASES.flatMap((phrase) => ['', prose(phrase)]));
    write(repo, doc, text);
    const run = runCheck(repo, sandbox);
    t.diagnostic(`exit ${run.status}\n${shown(run)}`);
    assert.notEqual(run.status, 0, `the check passes ${doc} with five planted lines of prose holding the phrases\n${shown(run)}`);
    const missing = PHRASES.filter((phrase) => {
      const [number] = lineOf(text, (line) => line === prose(phrase));
      return !named(run, doc, number, phrase).length;
    });
    assert.deepEqual(missing, [], `no failing line names ${doc}, the planted line and the phrase for these\n${shown(run)}`);
  });
}

test(`${ID} AC1: the same phrases inside code pass, where the same phrases in prose at the same place fail`, LIMIT, (t) => {
  const doc = DOCS[0];
  const spans = `Zorvanthic code line: ${PHRASES.map((phrase) => `\`${phrase}\``).join(', ')}.`;
  const fence = ['```', ...PHRASES.map((phrase) => `zorvanthic ${phrase}`), '```'];
  const code = makeCopy(t);
  const coded = plant(read(code.repo, doc), ['', spans, '', ...fence]);
  write(code.repo, doc, coded.text);
  const passed = runCheck(code.repo, code.sandbox);
  t.diagnostic(`code only: exit ${passed.status}\n${shown(passed)}`);
  assert.equal(passed.status, 0, `the check fails the phrases planted inside code in ${doc}\n${shown(passed)}`);
  const mixed = plant(read(code.repo, doc), ['', prose(PHRASES[0])]);
  write(code.repo, doc, mixed.text);
  const run = runCheck(code.repo, code.sandbox);
  t.diagnostic(`code and one line of prose: exit ${run.status}\n${shown(run)}`);
  const [proseLine] = lineOf(mixed.text, (line) => line === prose(PHRASES[0]));
  assert.ok(named(run, doc, proseLine, PHRASES[0]).length, `the check does not fail the planted line of prose beside the code, so it never read that place\n${shown(run)}`);
  const codeLines = lineOf(mixed.text, (line) => line === spans || PHRASES.some((phrase) => line === `zorvanthic ${phrase}`));
  const flagged = codeLines.filter((number) => named(run, doc, number).length);
  assert.deepEqual(flagged, [], `the check names planted lines of code\n${shown(run)}`);
});

test(`${ID} AC1: on the merge base's design docs the check fails, naming each phrase they hold in prose, and shows its count`, LIMIT, (t) => {
  const { sandbox, repo } = makeCopy(t);
  for (const doc of DOCS) write(repo, doc, baseFile(doc));
  const run = runCheck(repo, sandbox);
  t.diagnostic(`merge base docs: exit ${run.status}\n${shown(run)}`);
  assert.notEqual(run.status, 0, `the check passes the merge base's design docs\n${shown(run)}`);
  const findings = run.lines.filter((line) => DOCS.some((doc) => new RegExp(`${doc.replace('.', '\\.')}(?::\\d|\\D{1,12}line \\d)`).test(line)) && PHRASES.some((phrase) => new RegExp(phrase, 'i').test(line)));
  const unnamed = PHRASES.filter((phrase) => !findings.some((line) => new RegExp(`(?<![\\p{L}\\p{N}_])${phrase}(?![\\p{L}\\p{N}_])`, 'iu').test(line)));
  assert.deepEqual(unnamed, [], `no failing line names a doc's line and these phrases, which the merge base holds in prose\n${shown(run)}`);
  const places = new Set(findings.map((line) => line.match(/docs\/[\w-]+\.md(?::\d+|\D{1,12}line \d+)/)[0]));
  const all = run.lines.filter((line) => DOCS.some((doc) => new RegExp(`${doc.replace('.', '\\.')}(?::\\d|\\D{1,12}line \\d)`).test(line)));
  const counts = new Set([findings.length, places.size, all.length]);
  const numbers = run.out.replace(/docs\/[\w-]+\.md:\d+(?::\d+)?/g, '').replace(/line \d+/g, '').match(/(?<![\w.#-])\d+(?![\w.-])/g) ?? [];
  assert.ok(numbers.some((n) => counts.has(Number(n))), `the run shows no count of its ${findings.length} findings of the phrases (${places.size} places, ${all.length} lines naming a doc's line)\n${shown(run)}`);
});

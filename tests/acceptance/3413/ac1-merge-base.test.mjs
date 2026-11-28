import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DOCS, TEXT_CHECK, WORD, atBase, base, commit, lintCommand, makeCopy, namesLine, plantFile, prose, run, shown } from './helpers.mjs';

const ID = '#3413.e9cc44fd';

test(`${ID} AC1: the text check fails the merge base's docs, naming lines that say plug-in, with its count`, { timeout: 900_000 }, async (t) => {
  const { sandbox, repo } = makeCopy(t);
  const args = await lintCommand(repo, sandbox, TEXT_CHECK);
  assert.ok(args, `the lint lane in scripts/lanes.mjs runs no ${TEXT_CHECK}`);
  const hits = new Map();
  for (const doc of DOCS) {
    const text = atBase(doc);
    assert.ok(text !== undefined, `${doc} is not at the merge base ${base()}`);
    plantFile(repo, doc, text);
    hits.set(doc, [...prose(text)].filter(({ line }) => WORD.test(line.replace(/(`+).+?\1/g, '').replace(/\]\([^)]*\)/g, ''))).map(({ number }) => number));
    assert.ok(hits.get(doc).length, `${doc} at the merge base says plug-in in no prose line`);
  }
  commit(repo, `change: the three docs as the merge base ${base().slice(0, 9)} has them`);
  const r = await run(repo, sandbox, args);
  const named = new Map(DOCS.map((doc) => [doc, r.lines.filter((l) => hits.get(doc).some((n) => namesLine(l, doc, n)))]));
  const count = [...named.values()].reduce((sum, lines) => sum + lines.length, 0);
  t.diagnostic(`merge base ${base()}: ${r.command} exited ${r.status}; ${count} lines name a prose line that says plug-in (${DOCS.map((doc) => `${doc} ${named.get(doc).length} of ${hits.get(doc).length}`).join(', ')})`);
  assert.notEqual(r.status, 0, `the text check passes the merge base's docs, which say plug-in in ${DOCS.map((doc) => `${hits.get(doc).length} prose lines of ${doc}`).join(', ')}\n${shown(r)}`);
  for (const doc of DOCS) assert.ok(named.get(doc).length, `no line of the text check names ${doc} and a line of it that says plug-in at the merge base\n${shown(r)}`);
});

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { DOCS, MARKER, TEXT_CHECK, commit, insertBeforeSecondHeading, lintCommand, makeCopy, namesLine, plantFile, run, shown } from './helpers.mjs';

const ID = '#3413.e9cc44fd';

for (const doc of DOCS) {
  test(`${ID} AC1: a planted "a plug-in may" in the prose of ${doc} fails the text check, naming the file and the line, and the word in code passes`, { timeout: 900_000 }, async (t) => {
    const { sandbox, repo } = makeCopy(t);
    const args = await lintCommand(repo, sandbox, TEXT_CHECK);
    assert.ok(args, `the lint lane in scripts/lanes.mjs runs no ${TEXT_CHECK}`);
    const block = [
      `${MARKER}: a plug-in may stand in this planted sentence.`,
      '',
      `${MARKER} in code: \`a plug-in may\` and \`ext.<plugin>.<name>\`.`,
      '',
      '```text',
      `${MARKER} fenced: a plug-in may name ext.<plugin>.<name>`,
      '```',
    ];
    const { text, first } = insertBeforeSecondHeading(readFileSync(join(repo, doc), 'utf8'), block);
    const lines = { prose: first, span: first + 2, fenced: first + 5 };
    plantFile(repo, doc, text);
    commit(repo, `change: a plug-in planted in ${doc}`);
    const r = await run(repo, sandbox, args);
    assert.notEqual(r.status, 0, `the text check passes ${doc} with "a plug-in may" planted at line ${lines.prose}\n${shown(r)}`);
    assert.ok(r.lines.some((l) => namesLine(l, doc, lines.prose)), `no line of the text check names ${doc} and line ${lines.prose}, the planted prose\n${shown(r)}`);
    const named = r.lines.filter((l) => namesLine(l, doc, lines.span) || namesLine(l, doc, lines.fenced));
    assert.deepEqual(named, [], `the text check names a planted line where the word is in code (${doc}:${lines.span}, ${doc}:${lines.fenced})`);
  });
}

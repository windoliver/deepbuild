// #3139 AC3 (README: AC3): no base-failure or run record under tests/acceptance/ holds a home path. A record is a .txt or
// .log file under tests/acceptance/ that git lists, tracked or new and not ignored, outside a twins/ or fixtures/ folder:
// BASE-FAILURE.txt, BASE-RUN.txt, TWINS-RUN.txt and the like. A home path is one the secrets rule's own pattern finds, or
// the same home folder spelled with dashes as an agent's scratchpad and project folder names spell it, which the
// decision redacts too. An allowedFindings row excuses none: the decision redacts each record in place. Messages give
// each finding's file, line and kind, never its value.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { AC3, HOME, git, root } from './helpers.mjs';

// The secrets rule's home path pattern (`kinds` in scripts/repo-rules.mjs), written out: a macOS /Users/<name>/ that
// isn't Shared, a Linux /home/<name>/, and a Windows C:\Users\<name>\ that isn't Public.
const HOME_PATH = new RegExp(String.raw`(?<![\w.-])(?:\/Users\/(?!Shared\/)|\/home\/)[\w.-]+\/|(?<![\w.-])[A-Za-z]:(\\{1,2})Users\1(?!Public\1)[\w.-]+\1`, 'g');
// A macOS home folder spelled with dashes, as a scratchpad or project folder's name holds it: -Users-<name>-.
const DASHED = new RegExp(String.raw`(?<![\w.-])-Users-(?!Shared-)[A-Za-z0-9_]+-`, 'g');

/** Each home path in `text`, as its 1-based line and kind. */
const scan = (text) => text.split('\n').flatMap((line, index) => [
  ...[...line.matchAll(HOME_PATH)].map(() => ({ line: index + 1, kind: 'home path' })),
  ...[...line.matchAll(DASHED)].map(() => ({ line: index + 1, kind: 'home folder spelled with dashes' })),
]);

test(`${AC3} AC3: no base-failure or run record under tests/acceptance/ holds a home path`, () => {
  // The scan finds each form, built from parts so this file holds none, and passes each redacted form.
  const homes = [
    `    at holds (file://${HOME}dev/deepbuild/tests/acceptance/1/a.test.mjs:12:5)`,
    `{"bay":"<tmp>${['', 'home', 'fixture-user', ''].join('/')}1/base"}`,
    `cwd ${['C:', 'Users', 'fixture-user', ''].join('\\')}dev`,
    ` RUN  v5.0.5 /private/tmp/agent-1/${['', 'Users', 'fixture', 'user', 'dev'].join('-')}-worktrees`,
  ];
  for (const line of homes) assert.equal(scan(line).length, 1, `the scan misses a home path in a planted line (its value is left out here)`);
  for (const line of ['    at holds (file://~/dev/deepbuild/a.test.mjs:12:5)', '{"bay":"<tmp>/1/base"}', `${['', 'Users', 'Shared', ''].join('/')}fixtures`])
    assert.deepEqual(scan(line), [], `the scan finds a home path in a redacted line: ${line}`);

  const listed = new Set(git(root, 'ls-files', '-z', '--cached', '--others', '--exclude-standard', '--', 'tests/acceptance').split('\0').filter(Boolean));
  const records = [...listed].filter((path) => /\.(?:txt|log)$/.test(path) && !path.split('/').slice(2, -1).some((folder) => folder === 'twins' || folder === 'fixtures'));
  assert.ok(records.some((path) => path.endsWith('/BASE-FAILURE.txt')), 'no BASE-FAILURE.txt was read, so the scan read no record');
  const found = [];
  for (const path of records) {
    let text;
    try {
      text = readFileSync(join(root, path), 'utf8');
    } catch {
      continue; // deleted from the work tree, still in the index
    }
    if (text.includes('\0')) continue;
    for (const { line, kind } of scan(text)) found.push(`${path}:${line}: ${kind}`);
  }
  const files = new Set(found.map((finding) => finding.split(':')[0]));
  assert.equal(found.length, 0, `${found.length} home paths in ${files.size} of the ${records.length} records, the first 40:\n${found.slice(0, 40).join('\n')}`);
});

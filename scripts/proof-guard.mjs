// The test guard (#569): over each commit of the change, an edit that removes or changes a line of a
// test, golden or fixture carrying a criterion tag, or of your decisions, passes only as its own
// proposal you approved, and a tolerance in a tagged fixture only tightens.
import { spawnSync } from 'node:child_process';
import { basename, dirname, posix } from 'node:path';
import { blobId, git, isTestFile, literals, named, outsideTests, removedLines, resolveModule, show, sourceOf, spans, tagsIn, tagsWithImports, testImports, underTestPaths } from './proof-change.mjs';

const FIX = 'Send the edit as its own commit that touches only the files it names, and have the maintainer approve that commit with an SSH-signed tag under deep/approved/ naming each test or file (Approves: <path> › <test> or Approves: <path>); a looser tolerance lands only as a new case beside the old.';
// Your decisions: the four invariants in AGENTS.md, and each row of the tables under Decisions.
const DECISIONS = {
  'AGENTS.md': { heading: '## The four invariants', what: 'one of the four invariants', row: () => true },
  'docs/technical-design.md': { heading: '## Decisions', what: 'a row under Decisions', row: (line) => line.startsWith('|') },
};
// The proof lanes' own code, and lanes.mjs, which names the test paths: once main holds the lanes, the
// change runs its own copy of them, so an edit of them is an edit of the checks. So is an edit of a
// test runner's config, which can stub the code under test only where it finds the change.
const LANES_CODE = /^scripts\/(?:proof[^/]*|lanes)\.mjs$/;
const RUNNER_CONFIG = /(?:^|\/)(?:vitest|vite)\.(?:config|workspace)\.[cm]?[jt]s$/;

// The files under the test paths, other than tests, that the merge base's runner configs name by path
// from the config's folder, as setupFiles or globalSetup do, resolved as vite resolves them, and
// those each imports: they run in every test's process, so they are checks as the config is.
function namedByConfig(root, base) {
  const configs = git(root, ['ls-tree', '-r', '-z', '--name-only', base]).split('\0').filter((path) => RUNNER_CONFIG.test(path));
  return new Set(configs.flatMap((config) => {
    const text = show(root, base, config) ?? '';
    return literals(text).map(([from, to]) => resolveModule(root, base, posix.normalize(posix.join(posix.dirname(config), text.slice(from + 1, to - 1)))));
  }).filter((path) => underTestPaths(path) && !isTestFile(path)).flatMap((path) => [...testImports(root, base, path).keys()]));
}

export function guard({ root, change, issue }, approvals, say) {
  // With an issue, the guard keeps its tags; with none, every tag.
  const relevant = (text) => tagsIn(text).filter((tag) => !issue?.number || tag.startsWith(`#${issue.number}.`));
  let refused = 0;
  const lanesOnMain = show(root, change.base, 'scripts/proof-guard.mjs') !== null;
  const configNamed = lanesOnMain ? namedByConfig(root, change.base) : new Set();
  const isCheck = (path) => LANES_CODE.test(path) || RUNNER_CONFIG.test(path) || configNamed.has(path);
  const checkEdit = (path, how) => ({ detail: `${path}: ${LANES_CODE.test(path) ? "the proof lanes' own code" : RUNNER_CONFIG.test(path) ? "the test runner's config" : "a file the test runner's config names"} changed${how}` });
  for (const commit of change.commits) {
    const items = (commit.sha && approvals.get(commit.sha)) || [];
    const itemPath = (item) => item.split(' › ')[0];
    // Its own proposal: the commit touches nothing but the files its approval names.
    const own = items.length > 0 && commit.files.every(({ path }) => items.some((item) => itemPath(item) === path));
    const at = commit.sha ? `commit ${commit.sha.slice(0, 12)}` : 'uncommitted changes';
    const judge = (edit, ...keys) => {
      if (!edit.hard && own && keys.some((key) => items.includes(key))) say('PASS', 'guard', `${edit.detail}, by approved proposal (${at})`);
      else {
        refused += 1;
        say('FAIL', 'guard', `${edit.detail} (${at}${edit.hard ? '; refused even as an approved proposal' : own ? '; the approval names no such item' : items.length ? '; the approved commit carries more than the files it names' : ''})`, FIX);
      }
    };
    for (const path of commit.merge?.conflicts ?? []) for (const edit of conflictEdits(root, commit, path, relevant)) judge(edit, path, ...edit.test ? [named(path, edit.test)] : []);
    if (lanesOnMain) for (const path of (commit.merge?.conflicts ?? []).filter(isCheck)) judge(checkEdit(path, ' in resolving a merge conflict'), path);
    for (const file of commit.files) {
      if (commit.merge?.conflicts.includes(file.path)) continue;
      if (lanesOnMain && isCheck(file.path) && file.hunks.length) judge(checkEdit(file.path, ''), file.path);
      const before = show(root, commit.parent, file.path);
      if (before === null) {
        // An added file removes nothing, unless a module path may resolve to it in place of a file
        // beside it, which it then stands in for.
        for (const shadowed of shadows(root, commit, file.path)) {
          const how = `, shadowed by ${file.path}, added beside it`;
          if (lanesOnMain && isCheck(shadowed)) judge(checkEdit(shadowed, how), file.path, shadowed);
          for (const edit of fixtureEdits(root, commit, { path: shadowed, status: 'D', hunks: [] }, show(root, commit.parent, shadowed), relevant)) judge({ ...edit, detail: edit.detail.replace(`${shadowed}: deleted`, `${shadowed}: shadowed by ${file.path}, added beside it`) }, file.path, shadowed);
        }
        continue;
      }
      if (isTestFile(file.path)) for (const edit of testEdits(root, commit, file, before, relevant)) judge(edit, file.path, ...edit.test ? [named(file.path, edit.test)] : []);
      else if (underTestPaths(file.path)) for (const edit of fixtureEdits(root, commit, file, before, relevant)) judge(edit, file.path);
      if (DECISIONS[file.path]) for (const edit of decisionEdits(file, before, show(root, commit.sha, file.path) ?? '')) judge(edit, file.path, `${file.path}:${edit.line}`);
    }
  }
  if (!refused) say('PASS', 'guard', `${change.commits.length} commit${change.commits.length === 1 ? '' : 's'} checked: no guarded edit lacks its own approved proposal`);
}

/** The literals of the text that lie outside every test, whose white space is data a tagged test may compare. */
const literalsOutside = (text, tests) => literals(text).filter(([from, to]) => !tests.some((test) => test.from <= from && to - 1 <= test.to));

/** White space squeezed to one space, or to one newline where it held one: a newline ends a line comment and drives ASI. */
const squeeze = (text) => text.replace(/\s+/g, (space) => (space.includes('\n') ? '\n' : ' '));

/** The text outside every test with its white space squeezed, except inside literals, which stay as written. */
function squeezed(text, tests) {
  const outside = outsideTests(text, tests);
  let result = '', at = 0;
  for (const [from, to] of literalsOutside(text, tests).sort((a, b) => a[0] - b[0])) {
    if (from < at) continue;
    result += `${squeeze(outside.slice(at, from))}\0${outside.slice(from, to)}\0`;
    at = to;
  }
  return result + squeeze(outside.slice(at));
}

// A file both parents of a merge changed past git's merging is judged three ways, each side read
// where it held the file before any rename: each guarded part must stay as the side that changed it
// has it, as either side has it when both did, or as the merge base has it when neither did. The
// parts are a test file's tagged tests, skipped or not, and its lines outside every test, such as a
// helper they call; a decisions file's guarded lines; a tagged fixture's bytes. Anything else is
// the merge's own edit, and a raised tolerance or a second decisions heading is refused as ever.
function conflictEdits(root, commit, path, relevant) {
  const { parents: [ours, theirs], base } = commit.merge;
  // A side holds the file at its path, or where the base held it before the side that holds the
  // path renamed it there, read from that side's own history as git's merge read it.
  const at = (rev, file) => blobId(root, rev, file) !== null;
  const origin = at(base, path) ? path : [ours, theirs].filter((rev) => at(rev, path)).map((rev) => sourceOf(root, base, rev, path)).find((file) => file && at(base, file)) ?? null;
  const sides = [base, ours, theirs].map((rev) => ({ rev, from: at(rev, path) ? path : origin && at(rev, origin) ? origin : null })).concat({ rev: commit.sha, from: path });
  const texts = sides.map(({ rev, from }) => (from === null ? null : show(root, rev, from)));
  const kept = ([b, o, t, r]) => (o !== b && t !== b ? [o, t] : o !== b ? [o] : t !== b ? [t] : [b]).includes(r);
  if (isTestFile(path)) {
    const views = sides.map(({ rev, from }, index) => {
      const lines = (texts[index] ?? '').split('\n');
      const tests = texts[index] === null ? [] : spans(texts[index]);
      const tagsOf = tagReader(root, rev, from ?? path, relevant);
      const parts = new Map();
      for (const test of tests.filter((span) => span.leaf && tagsOf(span).length)) parts.set(test.name, [...(parts.get(test.name) ?? []), `${test.skipped}|${lines.slice(test.start - 1, test.end).join('\n')}`]);
      // White space aside, so a test that comes or goes leaves no trace here.
      const outside = squeezed(texts[index] ?? '', tests.filter((test) => test.leaf));
      return { parts: new Map([...parts].map(([name, list]) => [name, list.sort().join('\0')])), outside: texts[index] === null ? null : outside };
    });
    const names = [...new Set(views.flatMap(({ parts }) => [...parts.keys()]))];
    if (!names.length) return [];
    const all = relevant(texts.join(' '));
    const edits = names.filter((name) => !kept(views.map(({ parts }) => parts.get(name)))).map((name) => (name === null
      ? { test: null, detail: `${path}: a test named as it runs changed in resolving a merge conflict (criterion ${all.join(', ')})` }
      : { test: name, detail: `${named(path, name)}: ${views[3].parts.has(name) ? 'changed' : 'deleted'} in resolving a merge conflict (criterion ${relevant(name).join(', ')})` }));
    if (!kept(views.map(({ outside }) => outside))) edits.push({ test: null, detail: `${path}: lines outside its tests changed in resolving a merge conflict, which its tagged tests may read (criterion ${all.join(', ')})` });
    return edits;
  }
  const decisions = DECISIONS[path];
  if (decisions) {
    const guarded = (text) => {
      const lines = (text ?? '').split('\n');
      const start = lines.indexOf(decisions.heading);
      if (start < 0) return null;
      const end = lines.findIndex((line, index) => index > start && line.startsWith('## '));
      return lines.slice(start, end < 0 ? lines.length : end).filter((line, index) => index === 0 || decisions.row(line)).join('\n');
    };
    const edits = kept(texts.map(guarded)) ? [] : [{ line: 0, detail: `${path}: ${decisions.what} changed in resolving a merge conflict` }];
    if ((texts[3] ?? '').split('\n').filter((line) => line === decisions.heading).length > 1) edits.push({ hard: true, line: 0, detail: `${path}: a second "${decisions.heading}" heading, which would move the section the guard reads` });
    return edits;
  }
  if (!underTestPaths(path)) return [];
  const tags = [...new Set([...relevant(texts.join(' ')), ...[ours, theirs].flatMap((rev) => readersOf(root, rev, path, relevant).flatMap((reader) => reader.tags))])];
  if (!tags.length) return [];
  // A fixture of cases is judged case by case, so both sides' new cases can be kept together.
  const cases = texts.map((text) => (text === null ? [] : casesOf(text)));
  const parts = cases.every(Boolean) ? [...new Set(cases.flat().map((kase) => kase.case))].map((name) => cases.map((list) => list.find((kase) => kase.case === name)?.row)) : [sides.map(({ rev, from }) => (from === null ? null : blobId(root, rev, from)))];
  const edits = parts.every(kept) ? [] : [{ detail: `${path}: a merge conflict resolved otherwise than either side has it (criterion ${tags.join(', ')})` }];
  for (const side of [texts[1], texts[2]]) {
    if (!casesOf(side ?? '')) continue;
    if (texts[3] === null || !casesOf(texts[3])) edits.push({ hard: true, detail: `${path}: no longer reads as cases with a numeric tolerance each, so a raised bound can't be ruled out` });
    else edits.push(...caseEdits(commit, path, casesOf(side), casesOf(texts[3]), show(root, base, path), '').filter((edit) => edit.hard));
  }
  return edits;
}

// A test's relevant tags: those of its name, or, for a test named as it runs, those its file holds
// with the files it imports.
const tagReader = (root, rev, path, relevant) => {
  const held = relevant(tagsWithImports(root, rev, path).join(' '));
  return (test) => (test.name === null ? held : relevant(test.name));
};

// A removed or changed line inside a tagged test is an edit of that test, and so is a line inserted
// inside one, such as an early return; a removed line outside every test is an edit of each tagged
// test in the file. Other added lines, such as a new test, are free. A test whose name the guard
// can't read, such as one built in a loop, is guarded as carrying each tag its file holds.
function testEdits(root, commit, file, before, relevant) {
  const tests = spans(before);
  const tagsOf = tagReader(root, commit.parent, file.path, relevant);
  const tagged = tests.filter((test) => tagsOf(test).length);
  if (!tagged.length) return [];
  const hit = new Set();
  const covering = (line) => tests.filter((test) => test.start <= line && line <= test.end);
  const lines = file.status === 'D' ? before.split('\n').map((_, index) => index + 1) : removedLines(file);
  // A removed line holding code outside every test, such as a helper the tests read or one written
  // after a test on its line, edits every tagged test; a blank one, as a deleted test leaves, doesn't,
  // unless it lies inside a literal outside the tests, such as a blank line of an expected value.
  // The same holds for a suite's own text, outside the tests inside it. A line is judged by every
  // test whose text it holds, such as a tagged test ending on the line where an untagged one starts.
  const leaves = tests.filter((test) => test.leaf);
  const bare = outsideTests(before, leaves).split('\n');
  const starts = [0];
  for (const text of bare) starts.push(starts.at(-1) + text.length + 1);
  const data = literalsOutside(before, leaves);
  const blank = (line) => !/\S/.test(bare[line - 1] ?? '') && !data.some(([from, to]) => from < starts[line] && starts[line - 1] < to);
  const outside = outsideTests(before, tests).split('\n');
  for (const line of lines) {
    const cover = covering(line);
    const suite = cover.filter((test) => !test.leaf).sort((a, b) => b.from - a.from)[0];
    if (/\S/.test(outside[line - 1] ?? '') || (!suite && !blank(line))) for (const leaf of tagged.filter(({ leaf: isLeaf }) => isLeaf)) hit.add(leaf);
    for (const leaf of cover.filter((test) => test.leaf && tagsOf(test).length)) hit.add(leaf);
    if (!suite || blank(line)) continue;
    // A suite's own text, such as its describe.skip, a hook or a const, runs as the file is collected
    // and may set what any test reads, so it edits every tagged test, as code outside them does.
    if (tagsOf(suite).length) hit.add(suite);
    for (const leaf of tagged.filter(({ leaf: isLeaf }) => isLeaf)) hit.add(leaf);
  }
  // An insertion lands between old lines oldStart and oldStart + 1: inside a tagged test when both are.
  for (const { oldStart, removed, added } of file.hunks) {
    if (removed.length || !added.length) continue;
    const test = tagged.find((span) => span.leaf && span.start <= oldStart && oldStart + 1 <= span.end);
    if (test) hit.add(test);
  }
  const now = file.status === 'D' ? '' : show(root, commit.sha, file.path) ?? '';
  const after = file.status === 'D' ? [] : spans(now);
  // A tagged test gone from the file, or skipped now, is edited whatever lines moved, such as one
  // wrapped in a describe.skip of added lines or put under an if (false): fewer unskipped tests of its
  // name and text register after, though a hollow copy of its name may.
  const key = (text, test) => `${test.name}\0${text.slice(test.from, test.to + 1)}`;
  const running = (list, text, of) => list.filter((test) => test.leaf && !test.skipped && test.runs && key(text, test) === of).length;
  for (const test of tagged.filter(({ name, leaf, skipped, runs }) => name !== null && leaf && !skipped && runs)) if (running(after, now, key(before, test)) < running(tests, before, key(before, test))) hit.add(test);
  return [...hit].map((test) => {
    if (test.name === null) return { test: null, detail: `${file.path}:${test.start}: a test named as it runs ${file.status === 'D' ? 'deleted' : 'changed'} (criterion ${tagsOf(test).join(', ')})` };
    const kept = after.find(({ name }) => name === test.name);
    const what = !kept ? 'deleted' : kept.skipped && !test.skipped ? 'skipped' : 'changed';
    return { test: test.name, detail: `${named(file.path, test.name)}: ${what} (criterion ${relevant(test.name).join(', ')})` };
  });
}

// A golden, fixture or expected output under the test paths is guarded when it carries a tag, or a
// tagged test names its path. A JSON Lines fixture of cases with a tolerance is judged case by case.
function fixtureEdits(root, commit, file, before, relevant) {
  const readers = readersOf(root, commit.parent, file.path, relevant);
  const tags = [...new Set([...relevant(before), ...readers.flatMap((reader) => reader.tags)])];
  if (!tags.length) return [];
  const by = readers.length ? `; read by ${readers.map((test) => (test.name === null ? `a test of ${test.path} named as it runs` : named(test.path, test.name))).join(', ')}` : '';
  const after = file.status === 'D' ? null : show(root, commit.sha, file.path);
  // A file of bytes, such as an image golden, has no lines to compare: any change is an edit.
  const binary = `${before}${after ?? ''}`.includes('\0');
  // A fixture of cases that stops reading as one, such as a tolerance written as a string, could
  // hide a raised bound, so it is refused as a raise is.
  if (casesOf(before) && after !== null && !binary && !casesOf(after)) return [{ hard: true, detail: `${file.path}: no longer reads as cases with a numeric tolerance each, so a raised bound can't be ruled out${by} (criterion ${tags.join(', ')})` }];
  if (casesOf(before) && after !== null && !binary) return caseEdits(commit, file.path, casesOf(before), casesOf(after), show(root, commit.base, file.path), by);
  // Any line a golden gains changes what its tests compare, as a removed one does.
  const added = file.hunks.reduce((sum, { added: lines }) => sum + lines.length, 0);
  const count = (n, word) => `${n} line${n === 1 ? '' : 's'} ${word}`;
  const what = file.status === 'D' ? 'deleted' : binary ? 'changed' : removedLines(file).length ? count(removedLines(file).length, 'removed or changed') : added ? count(added, 'added') : null;
  return what ? [{ detail: `${file.path}: ${what}${by} (criterion ${tags.join(', ')})` }] : [];
}

const SCRIPTS = ['.js', '.mjs', '.cjs', '.jsx', '.ts', '.mts', '.cts', '.tsx'];
const SCRIPT = /\.[cm]?[jt]sx?$/;

// The scripts under the test paths, other than tests, that the commit's parent holds and an added
// script may stand in for: one of the same name with another script extension, as check.js for
// check.ts, or a folder's index the added file's name would resolve to first.
function shadows(root, commit, path) {
  if (!SCRIPT.test(path) || !underTestPaths(path) || isTestFile(path)) return [];
  const stem = path.replace(SCRIPT, '');
  const held = git(root, ['ls-tree', '-r', '-z', '--name-only', commit.parent, '--', posix.dirname(path)]).split('\0').filter(Boolean);
  return held.filter((other) => other !== path && SCRIPT.test(other) && !isTestFile(other) && [stem, `${stem}/index`].includes(other.replace(SCRIPT, '')));
}

// The tagged tests whose span, or whose file, names the fixture's path, from the repo root or the
// file's folder, and those whose file reaches it through other files under the test paths that name
// it, such as a helper a test imports.
function readersOf(root, rev, path, relevant, seen = new Set([path])) {
  // A module is imported by its stem, bare or with any script extension: ./load.js names load.ts.
  const stem = SCRIPT.test(path) ? path.replace(SCRIPT, '') : null;
  const grep = spawnSync('git', ['grep', '-l', '-F', '-e', basename(stem ?? path), '-e', basename(dirname(path)), rev, '--'], { cwd: root, encoding: 'utf8', maxBuffer: 1 << 28 });
  const readers = [];
  for (const hit of grep.stdout.split('\n').filter(Boolean)) {
    const file = hit.slice(rev.length + 1);
    if (seen.has(file) || !underTestPaths(file)) continue;
    const source = show(root, rev, file);
    const relative = posix.relative(dirname(file), path);
    const forms = (name) => (stem ? ['', ...SCRIPTS].map((ext) => name.replace(SCRIPT, ext)) : [name]);
    // The path as a delimited name, such as a string literal's content, never inside a longer name:
    // a.json is not data.json, and fixtures/a.json is not fixtures/old/a.json. A template may lead it
    // with a folder it computes, as `${here}/fixtures/a.json` does. A file in the reader's folder or
    // below it may also be named in pieces, by any tail of its path, as join(here, 'fixtures', 'a.json')
    // and fixture('parity/a.json') do, or by any tail of its folder ahead of a computed name, as
    // `fixtures/junit/${name}` and fixture(`parity/${name}`) do.
    const escape = (name) => name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const delimited = (name) => RegExp(`(?:^|['"\`(\\s,]|\\}/)${escape(name)}(?=$|['"\`)\\s,?#])`, 'm');
    const near = dirname(path) === dirname(file) || dirname(path).startsWith(`${dirname(file)}/`);
    const folder = posix.relative(dirname(file), dirname(path));
    const tails = (name) => name.split('/').map((_, at, parts) => parts.slice(at).join('/'));
    const mentions = (text) => [path, relative, `./${relative}`].flatMap(forms).some((name) => delimited(name).test(text))
      || (near && (tails(relative).some((tail) => delimited(tail).test(text))
        || (folder !== '' && tails(folder).some((tail) => RegExp(`(?:^|['"\`(\\s,]|\\}/)(?:\\./)?${escape(tail)}/\\$\\{`, 'm').test(text)))));
    if (!mentions(source)) continue;
    seen.add(file);
    if (!isTestFile(file)) {
      readers.push(...readersOf(root, rev, file, relevant, seen));
      continue;
    }
    const tagsOf = tagReader(root, rev, file, relevant);
    const tagged = spans(source).filter((span) => tagsOf(span).length);
    const lines = source.split('\n');
    const inSpan = tagged.filter((span) => mentions(lines.slice(span.start - 1, span.end).join('\n')));
    readers.push(...(inSpan.length ? inSpan : tagged.filter(({ leaf }) => leaf)).map((span) => ({ path: file, name: span.name, tags: tagsOf(span) })));
  }
  return readers;
}

// Cases of a JSON Lines fixture, each with its case name, criterion, tolerance as written and input,
// or null when the file isn't one.
function casesOf(text) {
  const rows = text.split('\n').filter((row) => row.trim());
  const cases = [];
  for (const row of rows) {
    let value;
    try {
      value = JSON.parse(row);
    } catch {
      return null;
    }
    const written = row.match(/"tolerance"\s*:\s*([^,}\s]+)/)?.[1];
    // A name given twice can't say which bound holds, so the file no longer reads as cases.
    if (typeof value?.case !== 'string' || typeof value.tolerance !== 'number' || !written || cases.some((kase) => kase.case === value.case)) return null;
    cases.push({ ...value, written, row });
  }
  return cases.length ? cases : null;
}

function caseEdits(commit, path, before, after, atBase, by) {
  const edits = [];
  const find = (list, name) => list.find((kase) => kase.case === name);
  const touched = new Set();
  for (const old of before) {
    const now = find(after, old.case);
    if (!now) {
      touched.add(old.criterion);
      edits.push({ detail: `${path}: case ${old.case} removed${by}` });
    } else if (now.tolerance > old.tolerance) {
      edits.push({ hard: true, detail: `${path}: case ${old.case}: tolerance raised from ${old.written} to ${now.written}${by}` });
    } else if (now.row !== old.row) {
      touched.add(old.criterion);
      edits.push({ detail: `${path}: case ${old.case}: changed${now.tolerance < old.tolerance ? `, tolerance lowered from ${old.written} to ${now.written}` : ''}${by}` });
    }
  }
  const baseCases = (atBase && casesOf(atBase)) || [];
  // A case dropped or changed while a looser one arrives, under any name or criterion, is a bound
  // loosened in place.
  const dropped = before.filter((old) => find(after, old.case)?.row !== old.row).map(({ tolerance }) => tolerance);
  const looser = after.filter((kase) => !find(before, kase.case) && dropped.length && kase.tolerance > Math.min(...dropped));
  for (const added of looser) edits.push({ hard: true, detail: `${path}: case ${added.case} (tolerance ${added.written}) arrives looser than a case the same commit drops or changes${by}` });
  for (const added of after.filter((kase) => !find(before, kase.case) && !looser.includes(kase))) {
    const tight = baseCases.filter((kase) => kase.criterion === added.criterion).sort((a, b) => a.tolerance - b.tolerance)[0];
    if (!tight || added.tolerance <= tight.tolerance) continue;
    // A looser bound lands only as a new case beside the old, proposed with both bounds and runs of
    // both on the same inputs, and never in the proposal that drops or changes the old.
    const message = commit.message.split('\n').map((line) => line.trim());
    const runs = message.slice(message.indexOf('Runs:') + 1);
    const missing = [
      !message.includes(`Old bound: ${tight.written}`) && `Old bound: ${tight.written}`,
      !message.includes(`New bound: ${added.written}`) && `New bound: ${added.written}`,
      (!message.includes('Runs:') || ![tight.case, added.case].every((name) => runs.some((line) => line.startsWith(`${name}:`)))) && `Runs: with a line for ${tight.case} and ${added.case}`,
      JSON.stringify(added.input) !== JSON.stringify(tight.input) && `the same input as ${tight.case}`,
    ].filter(Boolean);
    const detail = `${path}: case ${added.case} adds a looser bound for ${added.criterion}, from ${tight.written} to ${added.written}${by}`;
    if (touched.has(added.criterion)) edits.push({ hard: true, detail: `${detail}, in the proposal that also drops or changes a case of the same criterion` });
    else edits.push({ hard: missing.length > 0, detail: missing.length ? `${detail}; its proposal lacks ${missing.join(', ')}` : detail });
  }
  return edits;
}

// A removed or changed line among your decisions or their heading, one inserted between them, or a
// heading added inside their section, named by its line in the file before the commit. A second copy
// of the heading would let a later commit move the section the guard reads, so it is refused outright.
function decisionEdits(file, before, after) {
  const { heading, what, row } = DECISIONS[file.path];
  const lines = before.split('\n');
  const start = lines.indexOf(heading);
  if (start < 0) return [];
  const end = lines.findIndex((line, index) => index > start && line.startsWith('## '));
  const guarded = new Set([start + 1]);
  for (let index = start; index < (end < 0 ? lines.length : end); index += 1) if (row(lines[index])) guarded.add(index + 1);
  const inSection = (line) => line > start && line <= (end < 0 ? lines.length : end);
  const edits = [];
  for (const { oldStart, removed, added } of file.hunks) {
    const touched = removed.length ? removed.map((_, index) => oldStart + index) : [oldStart];
    const hit = touched.filter((number) => guarded.has(number) || (inSection(number) && added.some((line) => line.startsWith('## '))));
    for (const line of hit) edits.push({ line, detail: `${file.path}:${line}: ${what} ${removed.length ? 'changed' : 'added to'}` });
  }
  if (after.split('\n').filter((line) => line === heading).length > 1) edits.push({ hard: true, line: start + 1, detail: `${file.path}: a second "${heading}" heading, which would move the section the guard reads` });
  return edits;
}

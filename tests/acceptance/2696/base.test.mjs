// #2696 (blind): this checkout's build against the merge base's. The merge base is built once, in a scratch folder
// (helpers.mjs, trees), and every test here reads it: the count of built files that hold a character above U+00FF
// (AC1), every message in both builds (AC2), each built file's number of lines and the line an error thrown from
// packages/hub/dist/core.js names (AC3), and the core thread's heap after a start on #16's 30-day record (AC4).
// README.md says which of these fail on the merge base and which hold there until a planted wrong program breaks them.
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { builtFiles, childEnv, cleanup, coreHeap, highFiles, lineCount, messagesOf, MIN, NODE, REPO, run, seedHistory, shortTemp, shown, textOf, trees, where } from './helpers.mjs';

after(cleanup);
const LIMIT = { timeout: 30 * MIN };
const LOAD = fileURLToPath(new URL('./load.mjs', import.meta.url));
const some = (list, n = 5) => `${list.slice(0, n).join('\n')}${list.length > n ? `\n… and ${list.length - n} more` : ''}`;
const MB = 2 ** 20;
const mb = (bytes) => (bytes / MB).toFixed(3);

test('#2696.5a61170b after npm run build --workspaces no built file under packages/*/dist holds a character above U+00FF, where 53 or more do on the merge base', LIMIT, async () => {
  const { base, sha } = await trees();
  const before = highFiles(base);
  // The issue's own premise, read on the merge base's build: without it the count below would prove nothing.
  if (before.length < 53) throw Error(`BLOCKED: the merge base ${sha.slice(0, 9)} holds a character above U+00FF in ${before.length} built files, where the issue says 53 or more`);
  const texts = builtFiles(REPO).filter(({ text }) => text !== null);
  if (!texts.length) throw Error('BLOCKED: this checkout has no built file under packages/*/dist; run npm run build --workspaces');
  const now = highFiles(REPO);
  const message = now.length ? `${now.length} of the ${texts.length} built text files under packages/*/dist hold a character above U+00FF (${before.length} do on the merge base ${sha.slice(0, 9)}); the first is ${where(now[0])}` : '';
  assert.equal(now.length, 0, message);
});

/** What load.mjs read of a tree: each package entry's exported strings, and what the packages printed as they loaded. */
async function loaded(tree) {
  const folder = shortTemp(), out = join(folder, 'out.json'), home = join(folder, 'h');
  mkdirSync(home);
  const ran = await run(NODE, [LOAD, tree, out], { cwd: tree, env: childEnv({ HOME: home }), timeoutMs: 5 * MIN });
  if (ran.code !== 0 || !existsSync(out)) return { failed: shown(ran).split(tree).join('<tree>') };
  return { entries: JSON.parse(readFileSync(out, 'utf8')), printed: `${ran.stdout}\n${ran.stderr}`.split(tree).join('<tree>') };
}
/** What the built CLI prints for --help, in a home of its own. */
async function help(tree) {
  const home = join(shortTemp(), 'h');
  mkdirSync(home);
  const ran = await run(NODE, [join(tree, 'packages/cli/dist/main.js'), '--help'], { cwd: tree, env: childEnv({ HOME: home }), timeoutMs: 2 * MIN });
  return { code: ran.code, printed: `${ran.stdout}\n${ran.stderr}`.split(tree).join('<tree>') };
}

test('#2696.6fbf771a every message that holds a character above U+00FF reads the same in this build as in the merge base\'s, character for character, and both builds of each package load, export and print the same', LIMIT, async () => {
  const { base, head, sha } = await trees();
  const differences = [];
  // Every message the merge base's built files write, against the same file of this build, each as the engine reads it.
  let compared = 0;
  for (const { path, text } of builtFiles(base)) {
    if (text === null) continue;
    if (/\.[cm]?js$/.test(path)) {
      const before = messagesOf(path, text);
      if (!before.length) continue;
      compared += before.length;
      const mine = textOf(join(REPO, path));
      if (mine === null) { differences.push(`${path}: this build has no such text file, and the merge base's holds ${before.length} messages with such a character`); continue; }
      let now;
      try {
        now = messagesOf(path, mine);
      } catch (error) {
        differences.push(`${path}: a message of this build can't be read: ${String(error?.message).split('\n')[0]}`);
        continue;
      }
      for (let at = 0; at < Math.max(before.length, now.length); at++) {
        const was = before[at], is = now[at];
        if (was && is && was.kind === is.kind && JSON.stringify(was.value) === JSON.stringify(is.value)) continue;
        differences.push(was
          ? `${path}:${was.line}: the ${was.kind} ${JSON.stringify(was.value)} of the merge base ${is ? `reads ${JSON.stringify(is.value)} (a ${is.kind}, line ${is.line})` : 'has no counterpart'} in this build`
          : `${path}:${is.line}: this build has a ${is.kind} ${JSON.stringify(is.value)} more than the merge base`);
        break;
      }
    } else if (path.endsWith('.json') && /[^\u0000-ÿ]/u.test(text)) {
      compared += 1;
      const mine = textOf(join(REPO, path));
      let same = false;
      try { same = mine !== null && JSON.stringify(JSON.parse(mine)) === JSON.stringify(JSON.parse(text)); } catch { /* not JSON any more: a difference */ }
      if (!same) differences.push(`${path}: its JSON holds other values in this build than in the merge base's`);
    }
  }
  if (!compared) throw Error(`BLOCKED: the merge base ${sha.slice(0, 9)} has no message with a character above U+00FF in its built files, so nothing was compared`);

  // Both builds of each package, loaded: what each entry exports, and what loading them prints.
  const [was, is] = [await loaded(base), await loaded(head)];
  if (was.failed) throw Error(`BLOCKED: the merge base's packages did not load: ${was.failed}`);
  if (is.failed) differences.push(`this build's packages did not load, where the merge base's do: ${is.failed}`);
  else {
    for (const [id, entry] of Object.entries(was.entries)) {
      const mine = is.entries[id];
      if (!mine) differences.push(`${id}: no entry of this build`);
      else if (entry.loaded && !mine.loaded) differences.push(`${id}: loads on the merge base and not on this build: ${mine.error}`);
      else if (entry.loaded) {
        for (const key of new Set([...Object.keys(entry.strings), ...Object.keys(mine.strings)])) {
          if (entry.strings[key] !== mine.strings[key]) differences.push(`${id} ${key}: ${JSON.stringify(entry.strings[key])} on the merge base reads ${JSON.stringify(mine.strings[key])} in this build`);
        }
      }
    }
    if (was.printed !== is.printed) differences.push(`the packages print as they load, on the merge base ${JSON.stringify(was.printed.slice(0, 400))}, and in this build ${JSON.stringify(is.printed.slice(0, 400))}`);
  }
  const [helpWas, helpIs] = [await help(base), await help(head)];
  if (helpWas.code !== 0) throw Error(`BLOCKED: the merge base's deep --help exited ${helpWas.code}: ${helpWas.printed.slice(0, 400)}`);
  if (helpWas.code !== helpIs.code || helpWas.printed !== helpIs.printed) {
    const lines = helpIs.printed.split('\n');
    const at = helpWas.printed.split('\n').findIndex((line, index) => line !== lines[index]);
    differences.push(`deep --help prints ${JSON.stringify(helpWas.printed.split('\n')[at])} on the merge base and ${JSON.stringify(lines[at])} in this build (exit ${helpIs.code})`);
  }
  assert.equal(differences.length, 0, `${differences.length} strings differ from the merge base ${sha.slice(0, 9)}'s (${compared} messages with a character above U+00FF compared):\n${some(differences)}`);
});

test('#2696.534150b4 each built file has the same number of lines as on the merge base', LIMIT, async () => {
  const { base, sha } = await trees();
  const differences = [];
  let compared = 0;
  for (const { path, text } of builtFiles(base)) {
    if (text === null) continue;
    compared += 1;
    const mine = textOf(join(REPO, path));
    if (!existsSync(join(REPO, path))) differences.push(`${path}: built on the merge base (${lineCount(text)} lines) and not by this build`);
    else if (mine === null) differences.push(`${path}: text on the merge base (${lineCount(text)} lines) and no text in this build`);
    else if (lineCount(mine) !== lineCount(text)) differences.push(`${path}: ${lineCount(mine)} lines in this build, ${lineCount(text)} on the merge base`);
  }
  if (!compared) throw Error(`BLOCKED: the merge base ${sha.slice(0, 9)} built no text file under packages/*/dist`);
  assert.equal(differences.length, 0, `${differences.length} of the merge base ${sha.slice(0, 9)}'s ${compared} built text files differ in their number of lines:\n${some(differences)}`);
});

// Two errors thrown from the core, with no hub: the step of the test clock reads its parameter (a TypeError the
// engine raises on that line) and refuses a step that is no whole number (`throw refuse(…)`, its own statement).
// Both lines come after the core's first character above U+00FF, so a build that moved a line would move them.
const THROWS = `const { Core } = await import(process.argv[1]);
const lines = [];
for (const params of [undefined, { advance_ms: -1 }]) {
  try { Core.prototype.testClock.call({}, params); lines.push(null); } catch (error) {
    const frame = String(error?.stack).split('\\n').find((line) => /\\/packages\\/hub\\/dist\\/core\\.js:\\d+:\\d+/.test(line));
    lines.push(frame ? { error: String(error?.message).split('\\n')[0], line: Number(/core\\.js:(\\d+):\\d+/.exec(frame)[1]) } : null);
  }
}
console.log('\\n#2696 ' + JSON.stringify(lines));
process.exit(0);`;
async function thrown(tree) {
  const home = join(shortTemp(), 'h');
  mkdirSync(home);
  const file = join(tree, 'packages/hub/dist/core.js');
  const ran = await run(NODE, ['--input-type=module', '-e', THROWS, file], { cwd: tree, env: childEnv({ HOME: home }), timeoutMs: 2 * MIN });
  const found = /^#2696 (.*)$/m.exec(ran.stdout);
  return { lines: found ? JSON.parse(found[1]) : null, shown: shown(ran).split(tree).join('<tree>') };
}

test('#2696.534150b4 an error thrown from packages/hub/dist/core.js names the same line as on the merge base', LIMIT, async () => {
  const { base, head, sha } = await trees();
  const was = await thrown(base);
  if (!was.lines || was.lines.length !== 2 || was.lines.some((entry) => entry === null)) throw Error(`BLOCKED: the merge base ${sha.slice(0, 9)}'s core threw no error with a line of packages/hub/dist/core.js: ${was.shown}`);
  const firstHighLine = (textOf(join(base, 'packages/hub/dist/core.js')) ?? '').split('\n').findIndex((line) => /[^\u0000-ÿ]/u.test(line)) + 1;
  if (!firstHighLine || was.lines.some(({ line }) => line <= firstHighLine)) throw Error(`BLOCKED: the merge base's errors are thrown from lines ${was.lines.map(({ line }) => line).join(' and ')} of the core, not after its first character above U+00FF (line ${firstHighLine}), so they could not show a moved line`);
  const is = await thrown(head);
  const names = (lines) => (lines ? lines.map((entry) => (entry ? `"${entry.error}" from line ${entry.line}` : 'no error from the core')).join('; ') : 'nothing');
  assert.deepEqual(is.lines, was.lines, `an error thrown from packages/hub/dist/core.js names another line than on the merge base ${sha.slice(0, 9)}: this build throws ${names(is.lines)}; the merge base ${names(was.lines)}${is.lines ? '' : ` (${is.shown})`}`);
});

const median = (values) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];

test('#2696.be4d3304 after a start on the 30-day record the core thread\'s heap after two full collections is at least 1.2 MB under the merge base\'s', LIMIT, async () => {
  const { base, head, sha } = await trees();
  const seeded = join(shortTemp(), 'root');
  const events = await seedHistory(seeded, 30);
  if (events !== 90_600) throw Error(`BLOCKED: the 30-day record holds ${events} events, not #16 AC12's 90,600`);
  // Turn about, on one machine in one run, each hub on its own copy of the one record: five readings a side,
  // and the medians compared, since one reading in six came 1.4 MB low on a Mac at load 200.
  const readings = { base: [], head: [] };
  for (let round = 0; round < 5; round++) {
    readings.base.push(await coreHeap(base, seeded));
    readings.head.push(await coreHeap(head, seeded));
  }
  const was = median(readings.base), is = median(readings.head);
  const under = was - is;
  const list = (values) => values.map(mb).join(', ');
  console.log(`#2696 core thread heap after two full collections, MB: merge base ${sha.slice(0, 9)} ${list(readings.base)} (median ${mb(was)}); this build ${list(readings.head)} (median ${mb(is)}); ${mb(under)} under`);
  assert.ok(under >= 1.2 * MB, `the core thread's heap after two full collections is ${mb(is)} MB in this build (readings ${list(readings.head)}) and ${mb(was)} MB on the merge base ${sha.slice(0, 9)} (readings ${list(readings.base)}): ${mb(under)} MB under it, where the criterion asks for at least 1.2 MB`);
});

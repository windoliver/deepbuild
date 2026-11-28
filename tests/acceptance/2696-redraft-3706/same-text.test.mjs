import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { ABOVE, builtFiles, childEnv, cleanup, lineCount, listed, messagesOf, MIN, NODE, needBuiltCheckout, REPO, run, shortTemp, shown, textOf, unescapedTree } from './helpers.mjs';

after(cleanup);
const LIMIT = { timeout: 18 * MIN };
const LOAD = fileURLToPath(new URL('../2696/load.mjs', import.meta.url));
const AGAINST = 'this checkout built without its escape step';

test('#2696.534150b4 #3706.414a9c5f each built file has as many lines as this checkout built without its escape step', LIMIT, async () => {
  needBuiltCheckout();
  const { tree } = await unescapedTree();
  const differences = [];
  let compared = 0;
  for (const { path, text } of builtFiles(tree)) {
    if (text === null) continue;
    compared += 1;
    const mine = existsSync(join(REPO, path)) ? textOf(join(REPO, path)) : undefined;
    if (mine === undefined) differences.push(`${path}: built by ${AGAINST} (${lineCount(text)} lines) and not by this build`);
    else if (mine === null) differences.push(`${path}: text in ${AGAINST} (${lineCount(text)} lines) and no text in this build`);
    else if (lineCount(mine) !== lineCount(text)) differences.push(`${path}: ${lineCount(mine)} lines in this build, ${lineCount(text)} in ${AGAINST}`);
  }
  assert.equal(differences.length, 0, `${differences.length} of the ${compared} built text files differ in their number of lines from ${AGAINST}:\n${listed(differences)}`);
});

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

async function linesThrownFromCore(tree) {
  const home = join(shortTemp(), 'h');
  mkdirSync(home);
  const ran = await run(NODE, ['--input-type=module', '-e', THROWS, join(tree, 'packages/hub/dist/core.js')], { cwd: tree, env: childEnv({ HOME: home }), timeoutMs: 2 * MIN });
  const found = /^#2696 (.*)$/m.exec(ran.stdout);
  return { lines: found ? JSON.parse(found[1]) : null, shown: shown(ran).split(tree).join('<tree>') };
}

const named = (lines) => (lines ? lines.map((entry) => (entry ? `"${entry.error}" from line ${entry.line}` : 'no error from the core')).join('; ') : 'nothing');

test('#2696.534150b4 #3706.414a9c5f an error thrown from packages/hub/dist/core.js names the line it names in this checkout built without its escape step, a line after the core\'s first character above U+00FF', LIMIT, async () => {
  needBuiltCheckout();
  const { tree } = await unescapedTree();
  const was = await linesThrownFromCore(tree);
  if (!was.lines || was.lines.length !== 2 || was.lines.some((entry) => entry === null)) throw Error(`BLOCKED: built without its escape step, the core threw no error with a line of packages/hub/dist/core.js: ${was.shown}`);
  const firstAbove = (textOf(join(tree, 'packages/hub/dist/core.js')) ?? '').split('\n').findIndex((line) => ABOVE.test(line)) + 1;
  if (!firstAbove || was.lines.some(({ line }) => line <= firstAbove)) throw Error(`BLOCKED: built without its escape step, the core throws from lines ${was.lines.map(({ line }) => line).join(' and ')}, not after its first character above U+00FF (line ${firstAbove || 'none'}), so a moved line could not show`);
  const is = await linesThrownFromCore(REPO);
  assert.deepEqual(is.lines, was.lines, `an error thrown from packages/hub/dist/core.js names another line than in ${AGAINST}: this build throws ${named(is.lines)}; without the step ${named(was.lines)}${is.lines ? '' : ` (${is.shown})`}`);
});

async function exportedAndPrinted(tree) {
  const folder = shortTemp(), out = join(folder, 'out.json'), home = join(folder, 'h');
  mkdirSync(home);
  const ran = await run(NODE, [LOAD, tree, out], { cwd: tree, env: childEnv({ HOME: home }), timeoutMs: 5 * MIN });
  if (ran.code !== 0 || !existsSync(out)) return { failed: shown(ran).split(tree).join('<tree>') };
  return { entries: JSON.parse(readFileSync(out, 'utf8')), printed: `${ran.stdout}\n${ran.stderr}`.split(tree).join('<tree>') };
}

async function helpPrinted(tree) {
  const home = join(shortTemp(), 'h');
  mkdirSync(home);
  const ran = await run(NODE, [join(tree, 'packages/cli/dist/main.js'), '--help'], { cwd: tree, env: childEnv({ HOME: home }), timeoutMs: 2 * MIN });
  return { code: ran.code, printed: `${ran.stdout}\n${ran.stderr}`.split(tree).join('<tree>') };
}

function messageDifferences(tree) {
  const differences = [];
  let compared = 0;
  for (const { path, text } of builtFiles(tree)) {
    if (text === null) continue;
    if (/\.[cm]?js$/.test(path)) {
      const before = messagesOf(path, text);
      if (!before.length) continue;
      compared += before.length;
      const mine = existsSync(join(REPO, path)) ? textOf(join(REPO, path)) : null;
      if (mine === null) { differences.push(`${path}: this build has no such text file, where ${AGAINST} writes ${before.length} messages with a character above U+00FF`); continue; }
      let now;
      try { now = messagesOf(path, mine); } catch (error) { differences.push(`${path}: a message of this build cannot be read: ${String(error?.message).split('\n')[0]}`); continue; }
      const at = before.findIndex((was, index) => !now[index] || was.kind !== now[index].kind || JSON.stringify(was.value) !== JSON.stringify(now[index].value));
      if (at >= 0) differences.push(`${path}:${before[at].line}: the ${before[at].kind} ${JSON.stringify(before[at].value)} of ${AGAINST} ${now[at] ? `reads ${JSON.stringify(now[at].value)} (a ${now[at].kind}, line ${now[at].line})` : 'has no counterpart'} in this build`);
      else if (now.length > before.length) differences.push(`${path}:${now[before.length].line}: this build has a ${now[before.length].kind} ${JSON.stringify(now[before.length].value)} more than ${AGAINST}`);
    } else if (/\.json$/.test(path) && ABOVE.test(text)) {
      compared += 1;
      const mine = existsSync(join(REPO, path)) ? textOf(join(REPO, path)) : null;
      const same = (() => { try { return mine !== null && JSON.stringify(JSON.parse(mine)) === JSON.stringify(JSON.parse(text)); } catch { return false; } })();
      if (!same) differences.push(`${path}: its JSON holds other values in this build than in ${AGAINST}`);
    }
  }
  return { differences, compared };
}

test('#2696.6fbf771a #3706.c1a4b78e every message that holds a character above U+00FF reads the same, character for character, as in this checkout built without its escape step, and both builds of each package load, export and print the same', LIMIT, async () => {
  needBuiltCheckout();
  const { tree } = await unescapedTree();
  const { differences, compared } = messageDifferences(tree);
  if (!compared) throw Error(`BLOCKED: ${AGAINST} writes no message with a character above U+00FF, so nothing was compared`);
  const [was, is] = [await exportedAndPrinted(tree), await exportedAndPrinted(REPO)];
  if (was.failed) throw Error(`BLOCKED: the packages of ${AGAINST} did not load: ${was.failed}`);
  if (is.failed) differences.push(`this build's packages did not load, where those of ${AGAINST} do: ${is.failed}`);
  else {
    for (const [id, entry] of Object.entries(was.entries)) {
      const mine = is.entries[id];
      if (!mine) differences.push(`${id}: no entry of this build`);
      else if (entry.loaded && !mine.loaded) differences.push(`${id}: loads in ${AGAINST} and not in this build: ${mine.error}`);
      else if (entry.loaded) {
        for (const key of new Set([...Object.keys(entry.strings), ...Object.keys(mine.strings)])) {
          if (entry.strings[key] !== mine.strings[key]) differences.push(`${id} ${key}: ${JSON.stringify(entry.strings[key])} in ${AGAINST} reads ${JSON.stringify(mine.strings[key])} in this build`);
        }
      }
    }
    if (was.printed !== is.printed) differences.push(`the packages print as they load ${JSON.stringify(was.printed.slice(0, 400))} in ${AGAINST}, and ${JSON.stringify(is.printed.slice(0, 400))} in this build`);
  }
  const [helpWas, helpIs] = [await helpPrinted(tree), await helpPrinted(REPO)];
  if (helpWas.code !== 0) throw Error(`BLOCKED: deep --help of ${AGAINST} exited ${helpWas.code}: ${helpWas.printed.slice(0, 400)}`);
  if (helpWas.code !== helpIs.code || helpWas.printed !== helpIs.printed) {
    const lines = helpIs.printed.split('\n');
    const at = helpWas.printed.split('\n').findIndex((line, index) => line !== lines[index]);
    differences.push(`deep --help prints ${JSON.stringify(helpWas.printed.split('\n')[at])} in ${AGAINST} and ${JSON.stringify(lines[at])} in this build (exit ${helpIs.code})`);
  }
  assert.equal(differences.length, 0, `${differences.length} strings differ from ${AGAINST} (${compared} messages with a character above U+00FF compared):\n${listed(differences)}`);
});

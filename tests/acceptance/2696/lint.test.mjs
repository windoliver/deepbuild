// #2696 (blind): the lint lane on a built file a planted build left unescaped. The lane is `checks`' entry named lint
// in scripts/lanes.mjs, and its commands run here as the lane starts them: each from the checkout's root, one after
// another. The planted program is its output: one more built file in this checkout's packages/verdicts/dist whose
// line 23 holds a curly quote and an ellipsis, as a build with no escaping step leaves a message. The file is removed
// when the test ends, however it ends; nothing else in the checkout changes. cargo's commands (fmt, clippy) are left
// out: they read Rust sources, never a package's dist (README, Surfaces).
import assert from 'node:assert/strict';
import { existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { pathToFileURL } from 'node:url';
import { childEnv, cleanup, MIN, needBuilt, NODE, PACKAGE, put, REPO, run } from './helpers.mjs';

const PLANTED = `packages/${PACKAGE}/dist/planted-2696-unescaped.js`;
const LINE = 23;
const TEXT = [
  '// #2696: a built file a planted build left unescaped. Lines 2 to 22 are plain.',
  ...Array.from({ length: LINE - 2 }, (_, index) => `export const plain${index + 2} = 'line ${index + 2}';`),
  'export const message = \'Can’t reach the hub…\';',
  '',
].join('\n');
const unplant = () => rmSync(join(REPO, PLANTED), { force: true });
process.on('exit', unplant);
after(async () => {
  unplant();
  await cleanup();
});

test('#2696.ced33c08 the lint lane fails on a built file that a planted build left unescaped, naming it', { timeout: 40 * MIN }, async () => {
  needBuilt();
  const { checks } = await import(pathToFileURL(join(REPO, 'scripts/lanes.mjs')).href);
  const lint = checks.find(({ name }) => name === 'lint');
  if (!lint) throw Error('BLOCKED: scripts/lanes.mjs has no lane named lint among its checks');
  const commands = lint.commands.filter(([command]) => command === NODE || command === 'node');
  if (!commands.length) throw Error('BLOCKED: the lint lane runs no node command');
  if (existsSync(join(REPO, PLANTED))) unplant();
  const ran = [];
  let naming;
  try {
    put(join(REPO, PLANTED), TEXT);
    for (const [, ...args] of commands) {
      const result = await run(NODE, args, { cwd: REPO, env: childEnv(), timeoutMs: 10 * MIN });
      const output = `${result.stdout}\n${result.stderr}`;
      const lines = output.split('\n').filter((line) => line.includes(PLANTED));
      ran.push(`node ${args.join(' ')}: ${result.timedOut ? 'stopped at 10 minutes' : `exit ${result.code}`}${lines.length ? ', names the file' : ''}`);
      if (result.code !== 0 && result.code !== null && lines.length) {
        naming = { command: `node ${args.join(' ')}`, lines };
        break;
      }
    }
  } finally {
    unplant();
  }
  assert.ok(naming, `no command of the lint lane failed naming ${PLANTED}, a built file whose line ${LINE} holds U+2019 and U+2026; its ${ran.length} node commands ran:\n${ran.join('\n')}`);
  // "Naming the file and the line" (the issue's Scope): a line of the failing command's output that names the file holds the line's number.
  const numbered = naming.lines.some((line) => new RegExp(`(?<![\\d.])${LINE}(?![\\d.])`).test(line.split(PLANTED).join('')));
  assert.ok(numbered, `${naming.command} failed naming ${PLANTED} and not its line ${LINE}: ${naming.lines.slice(0, 3).join(' | ')}`);
});

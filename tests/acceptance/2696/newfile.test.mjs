// #2696 (blind): a new source file, built. The file goes into a scratch copy of this checkout (helpers.mjs,
// copyCheckout), never into the checkout, and is built there by its package's own build, `npm run build --workspace`,
// the step `npm run build --workspaces` runs for that package. AC5: the built files hold no character above U+00FF.
// AC2's wrong program: a step that escapes inside a raw template changes the template's value, and the last test
// names that string.
import assert from 'node:assert/strict';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { pathToFileURL } from 'node:url';
import { cleanup, codePoint, copyCheckout, firstHigh, MIN, needBuilt, PACKAGE, put, run, scratch, shown, textOf } from './helpers.mjs';

after(cleanup);
const LIMIT = { timeout: 30 * MIN };

// The messages, written here with escapes and into the source file as the characters themselves.
const QUOTED = 'Can\u2019t reach the hub: it said \u201Cnot ready\u201D';
const left = (n) => `\u201C${n}\u201D files left\u2026`;
const ASTRAL = 'done \u{1F389}';
// A raw template's value keeps each backslash: here \n, \t and \u0041 stay as written, beside two curly quotes and an ellipsis.
const RAW = 'C:\\new\\table \u201Craw\u201D\u2026 \\u0041';
const NAME = 'planted2696';
const SOURCE = [
  '// #2696: a new source file with curly quotes, an ellipsis and a character beyond U+FFFF in its messages.',
  `export const quoted = '${QUOTED}';`,
  'export const left = (n: number): string => `\u201C${n}\u201D files left\u2026`;',
  `export const astral = '${ASTRAL}';`,
  `export const raw = String.raw\`${RAW}\`;`,
  '',
].join('\n');

let made;
/** The copy with the new source file, its package built: the built files the source came to, by name. */
function built() {
  made ??= (async () => {
    needBuilt();
    const copy = copyCheckout(join(scratch('deep-2696-new-'), 'copy'));
    put(join(copy, 'packages', PACKAGE, 'src', `${NAME}.ts`), SOURCE);
    const ran = await run('npm', ['run', 'build', '--workspace', `packages/${PACKAGE}`], { cwd: copy, timeoutMs: 15 * MIN });
    if (ran.code !== 0) throw Error(`BLOCKED: packages/${PACKAGE} did not build with the new source file: ${shown(ran).split(copy).join('<copy>')}`);
    const dist = join(copy, 'packages', PACKAGE, 'dist');
    const files = readdirSync(dist).filter((name) => name.startsWith(`${NAME}.`)).sort();
    if (!existsSync(join(dist, `${NAME}.js`))) throw Error(`BLOCKED: the build wrote no packages/${PACKAGE}/dist/${NAME}.js for the new source file (it wrote ${files.join(', ') || 'nothing'})`);
    return { dist, files };
  })();
  return made;
}

test('#2696.ced33c08 a new source file with a curly quote in a message builds to a file with none', LIMIT, async () => {
  const { dist, files } = await built();
  const held = files.flatMap((name) => {
    const text = textOf(join(dist, name));
    const first = text === null ? null : firstHigh(text);
    return first ? [`packages/${PACKAGE}/dist/${name}:${first.line} holds ${codePoint(first.char)}`] : [];
  });
  assert.equal(held.length, 0, `the new source file's messages were built with their characters above U+00FF left in: ${held.join('; ')}`);
});

test('#2696.6fbf771a the new source file\'s messages read as written once built, a raw template\'s value among them', LIMIT, async () => {
  const { dist } = await built();
  let module;
  try {
    module = await import(pathToFileURL(join(dist, `${NAME}.js`)).href);
  } catch (error) {
    assert.fail(`the built packages/${PACKAGE}/dist/${NAME}.js does not load: ${String(error?.message).split('\n')[0]}`);
  }
  const read = { quoted: module.quoted, 'left(3)': module.left(3), astral: module.astral, raw: module.raw };
  const written = { quoted: QUOTED, 'left(3)': left(3), astral: ASTRAL, raw: RAW };
  const changed = Object.keys(written).filter((name) => read[name] !== written[name]).map((name) => `${name}: written ${JSON.stringify(written[name])}, built to ${JSON.stringify(read[name])}`);
  assert.equal(changed.length, 0, `the build changed the value of ${changed.length} of the new source file's strings: ${changed.join('; ')}`);
});

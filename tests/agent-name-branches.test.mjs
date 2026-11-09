// #1689: the hub never branches on an agent's name (design: One event log, with tables built from it; Five ways in).
// Each branch that is still there is listed in agent-name-branches.json by file and expression with its count, and
// the list only shrinks: a new branch fails, naming its file and line, and so does an entry the code no longer needs,
// so the list says exactly what is left to move into a cap or a fact its adapter declares.
import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const allowed = JSON.parse(readFileSync(new URL('./agent-name-branches.json', import.meta.url), 'utf8'));
const AGENTS = 'claude-code|claude|codex|pi|paseo|cursor|opencode|grok';
// An equality with an agent's name on either side: `meta.agent === 'codex'`, `'pi' !== agent`.
const BRANCH = new RegExp(`[\\w$.?!\\[\\]]+\\s*[!=]==?\\s*'(?:${AGENTS})'|'(?:${AGENTS})'\\s*[!=]==?\\s*[\\w$.?!\\[\\]]+`, 'g');
const sources = (dir) => readdirSync(dir).flatMap((name) => {
  const path = join(dir, name);
  if (statSync(path).isDirectory()) return sources(path);
  return /\.(ts|mts|mjs|js)$/.test(name) && !/\.test\.[mc]?[jt]s$/.test(name) ? [path] : [];
});

/** Every branch on an agent's name under `base`'s packages/hub/src, by file and expression, with each line it is on. */
export function branches(base) {
  const found = new Map();
  for (const file of sources(join(base, 'packages/hub/src'))) {
    readFileSync(file, 'utf8').split('\n').forEach((line, index) => {
      if (/^\s*(\/\/|\*|\/\*)/.test(line)) return;
      for (const [expression] of line.matchAll(BRANCH)) {
        const key = `${relative(base, file)} ${expression.replace(/\s+/g, ' ')}`;
        found.set(key, [...(found.get(key) ?? []), index + 1]);
      }
    });
  }
  return found;
}

/** What breaks the list: a branch past its count, by file and line, and an entry above what the code has. */
export function problems(found) {
  const out = [];
  for (const [key, lines] of found) {
    const [file, ...expression] = key.split(' ');
    const room = allowed[key] ?? 0;
    if (lines.length > room) out.push(`${file}:${lines.slice(room).join(',')} branches on an agent's name (${expression.join(' ')}); read a cap or a fact its adapter declares instead`);
  }
  for (const [key, count] of Object.entries(allowed)) {
    const now = found.get(key)?.length ?? 0;
    if (now < count) out.push(`agent-name-branches.json allows ${count} of "${key}" and the code has ${now}: lower it`);
  }
  return out;
}

test("the hub's branches on an agent's name are only those agent-name-branches.json lists", () => {
  assert.deepEqual(problems(branches(root)), []);
});

test('a planted branch on an agent\'s name fails, naming its file and line', (t) => {
  const copy = mkdtempSync(join(tmpdir(), 'deep-agent-name-'));
  t.after(() => rmSync(copy, { recursive: true, force: true }));
  cpSync(join(root, 'packages/hub/src'), join(copy, 'packages/hub/src'), { recursive: true });
  const file = join(copy, 'packages/hub/src/core.ts');
  const lines = readFileSync(file, 'utf8').split('\n');
  writeFileSync(file, [...lines, "const planted = (meta: { agent: string }) => meta.agent === 'codex';", ''].join('\n'));
  assert.deepEqual(problems(branches(copy)), [`packages/hub/src/core.ts:${lines.length + 1} branches on an agent's name (meta.agent === 'codex'); read a cap or a fact its adapter declares instead`]);
});

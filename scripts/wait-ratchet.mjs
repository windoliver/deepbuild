// The wait ratchet (#1604; technical design: Repo guards), run by the lint lane. A test waits for the event it needs,
// never for time to pass. In the test files (`testPaths` in scripts/lanes.mjs: JavaScript, TypeScript and Rust), a
// finding is a fixed wait: a `sleep(…)` call (`thread::sleep` included), `Atomics.wait`, or a `setTimeout` timer; or an
// assertion on the difference of two clock reads (`Date.now() - start`, `performance.now() - start`, Rust's
// `.elapsed()` or `Instant::now() - start`) on the line of an `assert` or `expect`. A timer that only bounds a wait, so
// all it can do is turn a hang into a failure, is allowed with its reason: a `// deadline: <why>` comment on its line or
// in the comment lines just above it. Strings and comments are not code, so a planted wait written as text is none.
// scripts/wait-ceilings.json lists today's files with their counts. A count may drop, and its ceiling drops with it in
// the same change; it never rises above its ceiling, a ceiling never rises above the merge base's with origin/main, and
// a file the merge base doesn't list starts at zero, so a suite drafted after this landed has none.
// One `FAIL waits: …` line per finding, or one PASS line; exit 1 on a finding.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { testPaths } from './lanes.mjs';
import { stripRust } from './rust-source.mjs';

const CEILINGS = 'scripts/wait-ceilings.json';
const SCRIPT = /\.(?:[cm]?[jt]s|[jt]sx)$/;
const WAITS = [
  [/(?<!\bfn\s+|\bfunction\s+)\bsleep\s*\(/g, 'sleep(…) is a fixed wait'],
  [/\bAtomics\s*\.\s*wait(?:Async)?\s*\(/g, 'Atomics.wait is a fixed wait'],
  [/\bsetTimeout\s*\(/g, 'a setTimeout timer is a fixed wait unless it only bounds one, marked // deadline: <why>'],
];
const CLOCK = /\b(?:Date|performance)\s*\.\s*now\s*\(\s*\)\s*-|\bInstant\s*::\s*now\s*\(\s*\)\s*-|\.\s*elapsed\s*\(\s*\)/g;
const ASSERTS = /\b(?:assert\w*|expect)\b/;
const DEADLINE = /\/\/\s*deadline:\s*\S/;

const root = fileURLToPath(new URL('../', import.meta.url));
const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 64 * 1024 * 1024 });
const parse = (text, from) => {
  const ceilings = JSON.parse(text);
  if (!ceilings || typeof ceilings !== 'object' || Array.isArray(ceilings) || !Object.values(ceilings).every((n) => Number.isInteger(n) && n > 0)) throw Error(`${from} isn't an object of whole numbers above 0`);
  return ceilings;
};
const glob = (pattern) => new RegExp(`^${pattern.split(/(\*\*\/|\/\*\*$|\*\*|\*)/).map((part) =>
  part === '**/' ? '(?:.*/)?' : part === '/**' ? '/.+' : part === '**' ? '.*' : part === '*' ? '[^/]*' : part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('')}$`);
const tests = testPaths.map(glob);

/** JavaScript or TypeScript with every string, template text, regex literal and (unless `keepComments`) comment blanked
 * to spaces, newlines kept, so lines and columns hold. Code inside a template's `${…}` stays code. */
function stripScript(source, { keepComments = false } = {}) {
  let out = '';
  let i = 0;
  const blank = (end) => {
    for (; i < end && i < source.length; i++) out += source[i] === '\n' ? '\n' : ' ';
  };
  const templates = []; // brace depth at each open `${`
  let depth = 0;
  const template = () => { // at the character after a backtick or a `}` that ends `${…}`
    while (i < source.length && source[i] !== '`' && !source.startsWith('${', i)) blank(i + (source[i] === '\\' ? 2 : 1));
    if (source[i] === '`') blank(i + 1);
    else if (i < source.length) { out += '${'; i += 2; templates.push(depth); depth++; }
  };
  while (i < source.length) {
    const c = source[i];
    if (source.startsWith('//', i)) {
      const end = source.indexOf('\n', i);
      if (keepComments) { out += source.slice(i, end < 0 ? source.length : end); i = end < 0 ? source.length : end; } else blank(end < 0 ? source.length : end);
    } else if (source.startsWith('/*', i)) {
      const end = source.indexOf('*/', i + 2);
      const stop = end < 0 ? source.length : end + 2;
      if (keepComments) { out += source.slice(i, stop); i = stop; } else blank(stop);
    } else if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < source.length && source[j] !== c && source[j] !== '\n') j += source[j] === '\\' ? 2 : 1;
      blank(j + 1);
    } else if (c === '`') {
      blank(i + 1);
      template();
    } else if (c === '}' && templates.length && templates.at(-1) === depth - 1) {
      depth = templates.pop();
      blank(i + 1);
      template();
    } else if (c === '/' && /(?:^|[(,=:[!&|?{};+\-*%<>~^]|\breturn|\btypeof|\bcase)\s*$/.test(out.slice(-12))) {
      // A regex literal where an expression starts; a class keeps a `/` from ending it.
      let j = i + 1;
      for (let inClass = false; j < source.length && source[j] !== '\n' && (inClass || source[j] !== '/'); j++) {
        if (source[j] === '\\') j++;
        else if (source[j] === '[') inClass = true;
        else if (source[j] === ']') inClass = false;
      }
      blank(j + 1);
    } else {
      if (c === '{') depth++;
      else if (c === '}') depth--;
      out += c;
      i++;
    }
  }
  return out;
}

/** Each finding in one file's text: its 1-based line, column and what it is. */
function findings(path, text) {
  const strip = path.endsWith('.rs') ? stripRust : stripScript;
  const code = strip(text).split('\n');
  const comments = strip(text, { keepComments: true }).split('\n');
  const marked = (index) => {
    if (DEADLINE.test(comments[index])) return true;
    for (let above = index - 1; above >= 0 && /^\s*(?:\/\/|\/\*|\*)/.test(comments[above]); above--) if (DEADLINE.test(comments[above])) return true;
    return false;
  };
  const found = [];
  code.forEach((line, index) => {
    for (const [pattern, why] of WAITS)
      for (const match of line.matchAll(pattern))
        if (!(pattern === WAITS[2][0] && marked(index))) found.push({ line: index + 1, column: match.index + 1, why });
    if (ASSERTS.test(line))
      for (const match of line.matchAll(CLOCK)) found.push({ line: index + 1, column: match.index + 1, why: 'an assertion on the difference of two clock reads judges how busy the machine is' });
  });
  return found;
}

let ceilings;
try {
  ceilings = parse(readFileSync(join(root, CEILINGS), 'utf8'), CEILINGS);
} catch (error) {
  console.log(`INVALID waits: ${CEILINGS} can't be read: ${error.message}\n  Fix: Restore ${CEILINGS}: a JSON object mapping each test file with a fixed wait to its count.`);
  process.exit(1);
}
// The base's ceilings, or null when there is no origin/main or the base predates the ratchet.
let base = null;
try {
  const at = git('merge-base', 'HEAD', 'origin/main').trim();
  if (git('ls-tree', '--name-only', at, '--', CEILINGS).trim()) base = parse(git('show', `${at}:${CEILINGS}`), `${CEILINGS} at the merge base`);
} catch {}

const out = [];
const fail = (line, fix) => out.push(`FAIL waits: ${line}\n  Fix: ${fix}`);
const EVENT = 'Wait for the event the test needs (a promise, `once(emitter, …)`, a channel), inject the clock where code reads time, or mark a timer that only bounds a wait with // deadline: <why>.';
const files = git('ls-files', '-z', '--cached', '--others', '--exclude-standard').split('\0')
  .filter((path) => (SCRIPT.test(path) || path.endsWith('.rs')) && tests.some((test) => test.test(path)));
const seen = new Set();
let total = 0;
for (const path of files.sort()) {
  let text;
  try {
    text = readFileSync(join(root, path), 'utf8');
  } catch {
    continue; // deleted from the work tree, still in the index
  }
  seen.add(path);
  const found = findings(path, text);
  total += found.length;
  const ceiling = ceilings[path] ?? 0;
  const bound = base ? Math.min(ceiling, base[path] ?? 0) : ceiling;
  const lines = found.map((f) => f.line).join(', ');
  if (found.length > bound && bound === 0) for (const f of found) fail(`${path}:${f.line}:${f.column}: ${f.why}`, EVENT);
  else if (found.length > bound) fail(`${path}: ${found.length} fixed waits (lines ${lines}), over its ceiling of ${bound}${bound < ceiling ? `, the merge base's` : ''}`, `${EVENT} A ceiling never rises.`);
  else if (found.length < ceiling) fail(`${path}: ${found.length} fixed waits, under its ceiling of ${ceiling}; lower it to ${found.length}`, found.length ? `Set its ceiling in ${CEILINGS} to ${found.length}.` : `Remove its entry from ${CEILINGS}.`);
}
for (const [path, ceiling] of Object.entries(ceilings))
  if (!seen.has(path)) fail(`${path}: not a test file the work tree holds, with a ceiling of ${ceiling}`, `Remove its entry from ${CEILINGS}.`);

// exitCode, not exit(): a long list of findings must reach a pipe in full.
if (out.length) console.log(out.join('\n'));
else console.log(`PASS waits: ${seen.size} test files, ${Object.keys(ceilings).length} of them listed with ${total} fixed wait${total === 1 ? '' : 's'} in all, each at its ceiling${base ? '' : '; no ceilings at a merge base with origin/main to compare with'}`);
process.exitCode = out.length ? 1 : 0;

// The wait ratchet (#1604; technical design: Repo guards), run by the lint lane. A test waits for the event it needs,
// never for time to pass. It reads the test files (`testPaths` in scripts/lanes.mjs: JavaScript, TypeScript and Rust).
// A finding is a fixed wait: a `sleep(…)` call (`thread::sleep`,
// `sleep_ms` and `park_timeout` included), `Atomics.wait`, a `setTimeout` or `setInterval` timer, or a call through a
// name `setTimeout` is imported or promisified as; or a clock difference (`Date.now() - start`, `performance.now() -
// start`, `process.hrtime`, Rust's `.elapsed()`, `.duration_since(…)` or `Instant::now() - start`), or a name bound to
// one, inside an assertion's parentheses (`assert…(`, `expect(`, `ok(`). A timer or clock check that only bounds a wait,
// so all it can do is turn a hang into a failure, is allowed with its reason: a `// deadline: <why>` comment on its line
// or in the `//` lines just above, one marker for one finding. Strings and comments are not code.
// scripts/wait-ceilings.json lists today's files with their counts. A count may drop, and its ceiling drops with it in
// the same change; it never rises above its ceiling, a ceiling never rises above the merge base's with origin/main, and
// a file the merge base doesn't list starts at zero, so a suite drafted after this landed has none.
// One `FAIL waits: …` line per finding, or one PASS line; exit 1 on a finding, 2 when git can't list the files.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { testPaths } from './lanes.mjs';
import { stripRust } from './rust-source.mjs';

const CEILINGS = 'scripts/wait-ceilings.json';
const SCRIPT = /\.(?:[cm]?[jt]s|[jt]sx)$/;
const SLEEP = [/(?<!\bfn\s+|\bfunction\s+)\b(?:sleep|sleep_ms|park_timeout(?:_ms)?)\s*\(/g, 'sleep(…) is a fixed wait'];
const ATOMICS = [/\bAtomics\s*\.\s*wait(?:Async)?\s*\(/g, 'Atomics.wait is a fixed wait'];
const TIMER = [/\bset(?:Timeout|Interval)\s*\(/g, 'a timer is a fixed wait unless it only bounds one, marked // deadline: <why>'];
const CLOCK = /\b(?:Date|performance)\s*\.\s*now\s*\(\s*\)\s*-|\bprocess\s*\.\s*hrtime\b|\bInstant\s*::\s*now\s*\(\s*\)\s*-|\.\s*(?:elapsed|duration_since)\s*\(/g;
const CLOCKED = 'an assertion on a clock difference judges how busy the machine is, unless it only bounds a wait, marked // deadline: <why>';
const ASSERT = /(?<![\w$])(?:\w*assert\w*(?:\s*\.\s*\w+)?\s*!?|(?<!\.\s*)(?:expect|ok))\s*\(/g;
const DEADLINE = /\/\/\s*deadline:\s*\S/;
// Character tests by code, not by RegExp: the stripper runs them on every character of every test file.
const isWord = (c) => (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') || c === '_' || c === '$';
const isSpace = (c) => c === ' ' || c === '\n' || c === '\t' || c === '\r';
const KEYWORDS = new Set(['return', 'typeof', 'case', 'await', 'yield', 'of', 'in', 'else', 'void', 'delete', 'new', 'throw', 'do', 'instanceof']);

const root = fileURLToPath(new URL('../', import.meta.url));
const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 64 * 1024 * 1024 });
const parse = (text, from) => {
  const ceilings = JSON.parse(text);
  if (!ceilings || typeof ceilings !== 'object' || Array.isArray(ceilings) || !Object.values(ceilings).every((n) => Number.isInteger(n) && n > 0)) throw Error(`${from} isn't an object of whole numbers above 0`);
  return ceilings;
};
// proof-change.mjs's testPattern says the same, but loading it loads TypeScript.
const glob = (pattern) => new RegExp(`^${pattern.split(/(\*\*\/|\/\*\*$|\*\*|\*)/).map((part) =>
  part === '**/' ? '(?:.*/)?' : part === '/**' ? '/.+' : part === '**' ? '.*' : part === '*' ? '[^/]*' : part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('')}$`);
const tests = testPaths.map(glob);

/** JavaScript or TypeScript with every string, template text, regex literal and (unless `keepComments`) comment blanked
 * to spaces, newlines kept, so lines and columns hold. Code inside a template's `${…}` stays code. A `/` starts a
 * regex where an expression starts: after an operator (not a postfix `++` or `--`), an opening bracket or a keyword. */
function stripScript(source, { keepComments = false } = {}) {
  let out = '';
  let i = 0;
  let prev = ''; // the last character of code, 'a' after a literal
  let word = ''; // the identifier or keyword that ends the code so far
  let postfix = false; // the code so far ends in ++ or --
  let apart = false; // white space or a comment since prev
  const blank = (end) => {
    for (; i < end && i < source.length; i++) out += source[i] === '\n' ? '\n' : ' ';
  };
  const literal = () => { prev = 'a'; word = ''; postfix = false; apart = false; };
  const comment = (end) => {
    apart = true;
    if (!keepComments) return blank(end);
    out += source.slice(i, end);
    i = end;
  };
  const templates = []; // brace depth at each open `${`
  let depth = 0;
  const template = () => { // at the character after a backtick or a `}` that ends `${…}`
    while (i < source.length && source[i] !== '`' && !source.startsWith('${', i)) blank(i + (source[i] === '\\' ? 2 : 1));
    if (source[i] === '`') { blank(i + 1); literal(); } else if (i < source.length) { out += '${'; i += 2; templates.push(depth); depth++; prev = '{'; word = ''; apart = false; }
  };
  while (i < source.length) {
    const c = source[i];
    if (source.startsWith('//', i)) {
      const end = source.indexOf('\n', i);
      comment(end < 0 ? source.length : end);
    } else if (source.startsWith('/*', i)) {
      const end = source.indexOf('*/', i + 2);
      comment(end < 0 ? source.length : end + 2);
    } else if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < source.length && source[j] !== c && source[j] !== '\n') j += source[j] === '\\' ? 2 : 1;
      blank(j + 1);
      literal();
    } else if (c === '`') {
      blank(i + 1);
      template();
    } else if (c === '}' && templates.length && templates.at(-1) === depth - 1) {
      depth = templates.pop();
      blank(i + 1);
      template();
    } else if (c === '/' && (prev === '' || (isWord(prev) ? KEYWORDS.has(word) : !')]}a'.includes(prev) && !postfix))) {
      let j = i + 1;
      for (let inClass = false; j < source.length && source[j] !== '\n' && (inClass || source[j] !== '/'); j++) {
        if (source[j] === '\\') j++;
        else if (source[j] === '[') inClass = true;
        else if (source[j] === ']') inClass = false;
      }
      blank(j + 1);
      while (/[a-z]/.test(source[i] ?? '')) blank(i + 1); // its flags
      literal();
    } else {
      if (c === '{') depth++;
      else if (c === '}') depth--;
      if (isSpace(c)) apart = true;
      else if (isWord(c)) {
        word = !apart && isWord(prev) ? word + c : c;
        prev = c; postfix = false; apart = false;
      } else {
        postfix = (c === '+' || c === '-') && prev === c && !apart;
        prev = c; word = ''; apart = false;
      }
      out += c;
      i++;
    }
  }
  return out;
}

/** Code with its strings blanked and comments kept, with its block comments blanked too (nested only in Rust, where
 * they nest), so a marker counts only from a `//` comment. With the strings gone, a `//` or `/*` can only start one. */
function lineComments(source, nest) {
  let out = '';
  for (let i = 0; i < source.length;) {
    if (source.startsWith('//', i)) {
      const end = source.indexOf('\n', i);
      out += source.slice(i, end < 0 ? source.length : end);
      i = end < 0 ? source.length : end;
    } else if (source.startsWith('/*', i)) {
      let depth = 0;
      do {
        if (source.startsWith('/*', i) && (nest || !depth)) { depth++; out += '  '; i += 2; } else if (source.startsWith('*/', i)) { depth--; out += '  '; i += 2; } else { out += source[i] === '\n' ? '\n' : ' '; i++; }
      } while (depth > 0 && i < source.length);
    } else out += source[i++];
  }
  return out;
}

/** Each finding in one file's text: its 1-based line, column and what it is. */
function findings(path, text) {
  const strip = path.endsWith('.rs') ? stripRust : stripScript;
  const joined = strip(text);
  const code = joined.split('\n');
  let comments; // read only where a marker could count
  const used = new Set(); // lines whose marker has bounded a finding
  const marked = (...indexes) => indexes.some((index) => {
    comments ??= lineComments(strip(text, { keepComments: true }), strip === stripRust).split('\n');
    let at = index;
    if (!DEADLINE.test(comments[at])) for (at = index - 1; at >= 0 && /^\s*\/\//.test(comments[at]) && !DEADLINE.test(comments[at]); at--);
    // A marker ending the line above marks that line's finding, not this one.
    if (at < 0 || used.has(at) || !DEADLINE.test(comments[at]) || (at !== index && !/^\s*\/\//.test(comments[at]))) return false;
    used.add(at);
    return true;
  });
  const found = [];
  const add = (index, column, why) => found.push({ line: index + 1, column: column + 1, why });

  // Names a timer is imported or promisified as, and names bound to a clock difference.
  const aliases = !/import\s*(?:[\w$]+\s*,\s*)?\{[^}]*\bsetTimeout\s+as|promisify/.test(joined) ? [] : [...joined.matchAll(/\bimport\s*(?:[\w$]+\s*,\s*)?\{[^}]*?\bsetTimeout\s+as\s+([\w$]+)|([\w$]+)\s*=\s*(?:\w+\s*\.\s*)?promisify\s*\(\s*setTimeout\s*\)/g)].map((m) => m[1] ?? m[2]);
  // Most files read no clock and wait on nothing: skip their scans.
  const timed = /now|elapsed|hrtime|duration_since/.test(joined);
  const waits = aliases.length || /sleep|park_timeout|Atomics|set(?:Timeout|Interval)/.test(joined);
  const clocks = [];
  if (timed) for (const line of code) {
    const bound = line.includes('=') && /\b(?:const|let(?:\s+mut)?|var)\s+([\w$]+)\s*(?::[^=]*)?=(?!=)(.*)$/.exec(line);
    if (bound && new RegExp(CLOCK.source).test(bound[2])) clocks.push(bound[1]);
  }
  const names = (list) => [...new Set(list)].map((name) => name.replaceAll('$', '\\$')).join('|');
  const alias = aliases.length ? [new RegExp(`(?<![.\\w$])(?:${names(aliases)})\\s*\\(`, 'g'), 'a call through a timer is a fixed wait'] : null;
  const clocked = new RegExp(`${CLOCK.source}${clocks.length ? `|(?<![.\\w$])(?:${names(clocks)})(?![\\w$])` : ''}`, 'g');

  // Where each assertion's parentheses run, as [line, from column, to column) spans.
  const spans = [];
  if (timed) code.forEach((line, index) => {
    if (!/assert|expect|ok\s*\(/.test(line)) return;
    for (const match of line.matchAll(ASSERT)) {
      let open = match.index + match[0].length - 1;
      for (let at = index; open !== -1;) {
        let depth = 0;
        for (let from = open; at < code.length; at++, from = 0) {
          let to = from;
          for (; to < code[at].length; to++) {
            depth += code[at][to] === '(' ? 1 : code[at][to] === ')' ? -1 : 0;
            if (!depth) break;
          }
          spans.push([at, from, to, index]);
          if (!depth) { open = to; break; }
        }
        // An expect's matcher takes the other side of the comparison: `expect(50).toBeGreaterThan(Date.now() - start)`.
        const chain = depth || !match[0].startsWith('expect') ? null : /^\s*(?:\.\s*(?:not|resolves|rejects)\s*)*\.\s*\w+\s*\(/.exec(code[at].slice(open + 1));
        open = chain ? open + chain[0].length : -1;
      }
    }
  });

  const counted = new Set(); // line:column of each clock finding, as spans overlap
  if (waits) code.forEach((line, index) => {
    const at = new Set(); // where each call's `(` is: a call through an alias named sleep matches twice
    for (const [pattern, why] of [...(alias ? [alias] : []), SLEEP, ATOMICS])
      for (const match of line.matchAll(pattern)) if (!at.has(match.index + match[0].length)) { at.add(match.index + match[0].length); add(index, match.index, why); }
    for (const match of line.matchAll(TIMER[0])) if (!marked(index)) add(index, match.index, TIMER[1]);
  });
  for (const [index, from, to, start] of spans) {
    for (const match of code[index].slice(from, to).matchAll(clocked)) {
      const key = `${index}:${from + match.index}`;
      if (counted.has(key)) continue;
      counted.add(key);
      if (!marked(index, start)) add(index, from + match.index, CLOCKED);
    }
  }
  return found.sort((a, b) => a.line - b.line || a.column - b.column);
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
let listing;
try {
  listing = git('ls-files', '-z', '--cached', '--others', '--exclude-standard').split('\0');
} catch (error) {
  console.log(`BLOCKED waits: git can't list the files under ${root}: ${error.message.split('\n')[0]}\n  Fix: Run the guard in a git checkout, with git on PATH.`);
  process.exit(2);
}

const out = [];
const fail = (line, fix) => out.push(`FAIL waits: ${line}\n  Fix: ${fix}`);
const EVENT = 'Wait for the event the test needs (a promise, `once(emitter, …)`, a channel), inject the clock where code reads time, or mark a timer or clock check that only bounds a wait with // deadline: <why>.';
const seen = new Set();
let total = 0;
for (const path of listing.sort()) {
  if (!(SCRIPT.test(path) || path.endsWith('.rs')) || !tests.some((pattern) => pattern.test(path))) continue;
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

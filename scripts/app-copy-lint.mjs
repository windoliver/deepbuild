#!/usr/bin/env node
// The app's words come from its table (#2403; crates/deep-app/src/copy.rs). In the lint lane this fails, naming the
// file and line, a literal the app draws that isn't in the table, and a sentence joined in code from a word of the
// table and anything else, a number above all: a count's sentence takes its number through the table's plural forms.
// A literal is drawn words when, with its `{…}` placeholders and escapes taken out, it holds a word of two letters or
// more and either two words or a capital: an id, a key or a single lower-case word is not. It is not drawn when it is
// the argument (directly or through format!) of a call that only logs, fails, matches or names a key — `eprintln!`,
// `panic!`, `expect`, `Err`, `ok_or`, `map_err`, `key_context`, `starts_with` and the like (NOT_DRAWN) — a match
// pattern or a comparison, or a json! key. Modules lib.rs builds only under a feature (fixtures, probes, checks) and
// test modules ship nothing and aren't read. A line keeps a literal only with a trailing
// `// copy-exception: <reason>`, or with that comment on a line of its own right above it. One `FAIL copy literal: <path>:<line>: ...` or `FAIL copy join: <path>:<line>: ...`
// line each, or `PASS copy`; exit 1 on a finding. It also fails a key the code draws that the English table lacks, and
// lists, without failing, each key a shipped language lacks or holds stale (`listed copy: …`), which draws its English.
//   node scripts/app-copy-lint.mjs [--root <dir>]
//     the lint lane's check, of the app's source under <dir> (the repo by default)
//   node scripts/app-copy-lint.mjs --release [--root <dir>]
//     the release check: each shipped language's missing, stale or misplaced-placeholder keys, one
//     `FAIL copy release: <language> <key>: ...` line each, or `PASS copy release`; exit 1 on a finding
//   node scripts/app-copy-lint.mjs confirm <language> <key> [<text>]
//     records the English the translation now reads right against: with <text> a translation written again (plural
//     forms as JSON), without it a person's confirmation that the one there still reads right
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { confirm, readTables, TABLES, unshown } from './copy-table.mjs';

const SOURCE = 'crates/deep-app/src';
/** Calls whose arguments never reach the screen: logs, failures, assertions, key contexts, text matching. */
const NOT_DRAWN = new Set([
  'eprintln!', 'println!', 'eprint!', 'print!', 'panic!', 'unreachable!', 'todo!', 'unimplemented!', 'assert!',
  'assert_eq!', 'assert_ne!', 'debug_assert!', 'debug_assert_eq!', 'compile_error!', 'include_str!', 'include_bytes!',
  'ns_string!', 'anyhow!', 'bail!', 'expect', 'Err', 'ok_or', 'ok_or_else', 'map_err', 'Protocol', 'HostError::new',
  'key_context', 'KeyBinding::new', 'with_documentation', 'starts_with', 'ends_with', 'contains', 'strip_prefix',
  'strip_suffix', 'split', 'split_once', 'rsplit', 'rsplitn', 'splitn', 'find', 'rfind', 'replace', 'trim_start_matches',
  'trim_end_matches', 'matches', 'arg', 'args', 'var', 'env', 'set_var', 'remove_var', 'soundNamed', 'objectForKey',
  'Command::new',
]);
const EXCEPTION = /\/\/ copy-exception: \S/;
/** Calls that only hand their argument on, so the call around them decides. */
const WRAPPERS = new Set(['Some', 'Ok', 'format!', 'concat!', 'String::from', 'Box::new', 'SharedString::from', 'from', 'into']);

/** The literals of Rust source outside comments, chars and test modules: `[{at, line, text}]`. */
function literals(src) {
  const out = [];
  const skip = [];
  for (const m of src.matchAll(/#\[cfg\(test\)\]\s*(?:#\[[^\]]*\]\s*)*(?:pub(?:\([^)]*\))?\s+)?mod\s+\w+\s*\{/g)) {
    let depth = 0;
    let j = m.index + m[0].length - 1;
    for (; j < src.length; j++) {
      if (src[j] === '{') depth++;
      else if (src[j] === '}' && --depth === 0) break;
    }
    skip.push([m.index, j]);
  }
  let i = 0;
  let line = 1;
  while (i < src.length) {
    const c = src[i];
    if (c === '\n') { line++; i++; continue; }
    if (c === '/' && src[i + 1] === '/') { while (i < src.length && src[i] !== '\n') i++; continue; }
    if (c === '/' && src[i + 1] === '*') {
      let depth = 1;
      i += 2;
      while (i < src.length && depth) {
        if (src[i] === '\n') line++;
        if (src[i] === '/' && src[i + 1] === '*') { depth++; i++; } else if (src[i] === '*' && src[i + 1] === '/') { depth--; i++; }
        i++;
      }
      continue;
    }
    if (c === '\'') {
      if (src[i + 1] === '\\') { i = src.indexOf('\'', i + 2) + 1; continue; }
      const close = src.indexOf('\'', i + 1);
      if (close > i && close - i <= 5 && !/\s/.test(src.slice(i + 1, close))) { i = close + 1; continue; }
      i++;
      continue;
    }
    const prev = src[i - 1] ?? '';
    const raw = c === 'r' && /^#*"/.test(src.slice(i + 1, i + 8)) && !/\w/.test(prev);
    const bytes = c === 'b' && (src[i + 1] === '"' || (src[i + 1] === 'r' && /^#*"/.test(src.slice(i + 2, i + 9)))) && !/\w/.test(prev);
    if (c === '"' || raw || bytes) {
      const at = i;
      const startLine = line;
      let text = '';
      let j = i + (bytes ? 1 : 0);
      if (src[j] === 'r') {
        j++;
        let hashes = 0;
        while (src[j] === '#') { hashes++; j++; }
        const end = `"${'#'.repeat(hashes)}`;
        const e = src.indexOf(end, j + 1);
        text = src.slice(j + 1, e);
        line += (text.match(/\n/g) ?? []).length;
        i = e + end.length;
      } else {
        j++;
        while (j < src.length && src[j] !== '"') {
          if (src[j] === '\\') { if (src[j + 1] === '\n') line++; text += src[j] + src[j + 1]; j += 2; continue; }
          if (src[j] === '\n') line++;
          text += src[j++];
        }
        i = j + 1;
      }
      if (!bytes && !skip.some(([a, b]) => at >= a && at <= b)) out.push({ at, end: i, line: startLine, text });
      continue;
    }
    i++;
  }
  return out;
}

/** Words a person reads: escapes out, a word of two letters or more beside a space (a phrase, or a piece of a
 *  sentence such as `" asks"` or `"{0} asks"`), or one capitalised word (a label). An id or a key has neither. */
export function drawnWords(text) {
  const bare = text.replace(/\\u\{[0-9a-fA-F]+\}|\\x[0-9a-fA-F]{2}|\\[rt0"'\\]/g, '').replace(/\\n/g, ' ').replace(/\{[^{}]*\}/g, '\u0000');
  if (!/[A-Za-z][A-Za-z'’]*[A-Za-z]/.test(bare)) return false;
  return /\s/.test(bare) || /(^|[^\w])[A-Z][a-z]/.test(bare);
}
/** The macros whose arguments after the first are pieces joined into one string. */
const JOINING = new Set(['format!', 'format_args!', 'concat!', 'write!', 'writeln!']);

/** The calls a position sits inside, innermost first: `format!`, `ok_or_else`, `HubError::Protocol`, … */
function enclosing(src, at) {
  const calls = [];
  let depth = 0;
  for (let k = at - 1; k >= 0 && calls.length < 4; k--) {
    const c = src[k];
    if (c === ')' || c === ']' || c === '}') depth++;
    else if (c === '(' || c === '[' || c === '{') {
      if (depth > 0) { depth--; continue; }
      // An attribute's argument (`#[name = "…"]`) names, never draws.
      if (c === '[' && /#!?\s*$/.test(src.slice(Math.max(0, k - 3), k))) return ['#[]', ...calls];
      // A closure's body (`|| { … }`) hands its value to the call around the closure; any other block ends the walk.
      if (c !== '(') { if (c === '{' && !/\|\s*$/.test(src.slice(Math.max(0, k - 40), k))) return calls; continue; }
      const name = src.slice(Math.max(0, k - 80), k).match(/([A-Za-z_][\w]*(?:::[A-Za-z_]\w*)*!?)\s*$/);
      calls.push(name ? name[1] : '');
    } else if (c === ';' && depth === 0) return calls;
  }
  return calls;
}

/** Why a literal at `at` is not drawn, or undefined. */
function notDrawn(src, lit) {
  const before = src.slice(Math.max(0, lit.at - 40), lit.at);
  const after = src.slice(lit.end, lit.end + 40);
  if (/^\s*(=>|\|\s*(r?#*")|if\b)/.test(after) || /(\|)\s*$/.test(before) && /^\s*(=>|\|)/.test(after)) return 'a match pattern';
  if (/(==|!=)\s*&?\s*(Some\(\s*)?$/.test(before.trimEnd()) || /^\s*\)?\s*(==|!=)/.test(after)) return 'a comparison';
  const calls = enclosing(src, lit.at);
  if (calls.includes('#[]')) return 'an attribute';
  if (/^\s*:/.test(after) && calls[0] === 'json!') return 'a json! key';
  // The two calls nearest the literal that do more than hand it on: an error's own constructor sits inside its Err.
  const deciding = calls.filter((c) => !WRAPPERS.has(c) && !WRAPPERS.has(c.split('::').pop())).slice(0, 2);
  const quiet = deciding.find((call) => NOT_DRAWN.has(call) || NOT_DRAWN.has(call.split('::').pop()) || NOT_DRAWN.has(call.split('::').slice(-2).join('::')));
  return quiet === undefined ? undefined : `inside ${quiet}`;
}

/** Each module lib.rs builds only under a feature: those files never ship, so never draw. */
function featureOnly(root) {
  const lib = readFileSync(join(root, SOURCE, 'lib.rs'), 'utf8');
  const out = new Set();
  for (const m of lib.matchAll(/#\[cfg\(([^\]]*)\)\]\s*(?:\/\/[^\n]*\n\s*|\/\/\/[^\n]*\n\s*)*pub mod (\w+);/g)) {
    if (/feature\s*=/.test(m[1]) && !/not\(/.test(m[1])) out.add(m[2]);
  }
  return out;
}

function rustFiles(dir) {
  const out = [];
  for (const name of readdirSync(dir).sort()) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...rustFiles(path));
    else if (name.endsWith('.rs')) out.push(path);
  }
  return out;
}

/** The lint's findings over the app's source under `root`. */
export function lint(root, tablesRoot) {
  const found = [];
  const gated = featureOnly(root);
  const { source } = readTables(tablesRoot);
  const top = join(root, SOURCE);
  for (const file of rustFiles(top)) {
    const rel = relative(root, file);
    const module = relative(top, file).split('/')[0].replace(/\.rs$/, '');
    // Feature-only modules, the probes and the files a module declares under #[cfg(test)] ship nothing.
    if (gated.has(module) || module === 'probes' || /(^|\/)tests\.rs$/.test(rel)) continue;
    const raw = readFileSync(file, 'utf8');
    const lines = raw.split('\n');
    const found_ = literals(raw);
    // The source with every literal's contents blanked, so a brace or a parenthesis inside a string is never code.
    let src = '';
    let from = 0;
    for (const lit of found_) {
      src += raw.slice(from, lit.at + 1) + raw.slice(lit.at + 1, lit.end - 1).replace(/[^\n]/g, ' ');
      from = lit.end - 1;
    }
    src += raw.slice(from);
    for (const lit of found_) {
      const text = lit.text;
      // Its exception: on its own line, or on a comment line right above it, where formatting never moves it.
      const above = lines[lit.line - 2] ?? '';
      const lineText = `${lines[lit.line - 1] ?? ''} ${/^\s*\/\//.test(above) ? above : ''}`;
      const keyed = src.slice(Math.max(0, lit.at - 24), lit.at).match(/copy::(?:text|fill|count|english)\(\s*$/);
      if (keyed) {
        if (!(text in source)) found.push(`FAIL copy literal: ${rel}:${lit.line}: the key "${text}" isn't in ${'crates/deep-app/copy/en.json'}: add its English there`);
        continue;
      }
      if (EXCEPTION.test(lineText) || notDrawn(src, lit)) continue;
      // A word handed to format! beside other pieces is a sentence joined in code, whatever its case.
      // The call whose parentheses hold the literal, through any block in its arguments (`if n == 1 { "ask" } …`).
      let opened = lit.at - 1;
      for (let depth = 0; opened >= 0; opened--) {
        if (src[opened] === ')') depth++;
        else if (src[opened] === '(' && depth-- === 0) break;
        else if (src[opened] === ';' && depth === 0) { opened = -1; break; }
      }
      const macro = opened > 0 ? (src.slice(Math.max(0, opened - 40), opened).match(/([A-Za-z_]\w*!?)\s*$/) ?? [])[1] : undefined;
      const indexed = /\[\s*$/.test(src.slice(Math.max(0, lit.at - 8), lit.at)) && /^\s*\]/.test(src.slice(lit.end, lit.end + 8));
      // Its format string: a piece joins a sentence when that string spaces its pieces apart, as words are; an id or a
      // file name (`"{}:{}"`, `"{}-{}.{}"`) joins with none.
      const template = found_.find((l) => l.at > opened && l.at < lit.at);
      const spaced = template !== undefined && /\s/.test(template.text.replace(/\{[^{}]*\}/g, ''));
      const piece = JOINING.has(macro) && !indexed && spaced && /[A-Za-z]{2}/.test(text);
      if (piece) {
        found.push(`FAIL copy join: ${rel}:${lit.line}: "${text.slice(0, 80)}" is a word joined into a sentence with ${macro}: put the whole sentence in the table, its numbers through {0} and plural forms`);
        continue;
      }
      if (!drawnWords(text)) continue;
      found.push(`FAIL copy literal: ${rel}:${lit.line}: "${text.slice(0, 80)}" is drawn outside the table: draw it with crate::copy from a key in crates/deep-app/copy/en.json, or end the line with // copy-exception: <reason> if no one reads it`);
    }
    // A sentence joined in code from a word of the table and anything else.
    for (const m of src.matchAll(/\b(format!|concat!|write!|push_str)\s*\(|\]\s*\.join\(|\+\s*(?:&\s*)?copy::|copy::(?:text|fill|count|english)\([^()]*(?:\([^()]*\))?[^()]*\)\s*\+/g)) {
      const line = src.slice(0, m.index).split('\n').length;
      if (EXCEPTION.test(lines[line - 1] ?? '')) continue;
      if (m[0].includes('+')) {
        found.push(`FAIL copy join: ${rel}:${line}: a word of the table is joined to another piece with +: put the whole sentence in the table, its numbers through {0} and plural forms`);
        continue;
      }
      let args;
      if (m[0].startsWith(']')) {
        // The array the join reads: back from its `]` to the `[` that opens it.
        let depth = 0;
        let k = m.index;
        for (; k >= 0; k--) {
          if (src[k] === ']') depth++;
          else if (src[k] === '[' && --depth === 0) break;
        }
        args = src.slice(k + 1, m.index);
      } else {
        const open = m.index + m[0].length - 1;
        let depth = 0;
        let k = open;
        for (; k < src.length; k++) {
          if (src[k] === '(') depth++;
          else if (src[k] === ')' && --depth === 0) break;
        }
        args = src.slice(open + 1, k);
      }
      if (/copy::(?:text|fill|count|english)\(/.test(args)) {
        found.push(`FAIL copy join: ${rel}:${line}: ${m[1] ?? 'join'} builds a sentence from a word of the table and other pieces: put the whole sentence in the table, its numbers through {0} and plural forms`);
      }
    }
  }
  return found;
}

const main = () => {
  const args = process.argv.slice(2);
  const at = args.indexOf('--root');
  const checkout = join(fileURLToPath(new URL('.', import.meta.url)), '..');
  const root = resolve(at >= 0 ? args[at + 1] : checkout);
  if (args[0] === 'confirm') {
    const [, language, key, text] = args.filter((_, i) => i !== at && i !== at + 1 || at < 0);
    if (!language || !key) {
      console.error('usage: app-copy-lint.mjs confirm <language> <key> [<text>]');
      process.exit(2);
    }
    confirm(root, language, key, text);
    console.log(`${language}'s ${key} now reads against its English as it is`);
    return;
  }
  if (!existsSync(join(root, SOURCE))) {
    console.error(`FAIL copy: no app source at ${join(root, SOURCE)}`);
    process.exit(1);
  }
  if (args.includes('--release')) {
    const found = unshown(readTables(root));
    for (const f of found) console.log(`FAIL copy release: ${f.language} ${f.key}: ${f.said}`);
    if (found.length) process.exit(1);
    console.log('PASS copy release');
    return;
  }
  const sourceAlone = readdirSync(join(root, SOURCE, '..')).join() === 'src';
  if (!existsSync(join(root, TABLES)) && !sourceAlone) {
    console.error(`FAIL copy: no copy tables at ${join(root, TABLES)}`);
    process.exit(1);
  }
  const tablesRoot = existsSync(join(root, TABLES)) ? root : checkout;
  if (tablesRoot !== root) console.log(`copy tables read from ${join(resolve(checkout), TABLES)}: ${root} holds the app's source alone`);
  const found = lint(root, tablesRoot);
  for (const line of found) console.log(line);
  // A key a shipped language lacks, or holds stale, draws its English: listed here, failed only by the release check.
  for (const f of unshown(readTables(tablesRoot))) console.log(`listed copy: ${f.language} ${f.key}: ${f.said}`);
  if (found.length) process.exit(1);
  console.log('PASS copy');
};

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();

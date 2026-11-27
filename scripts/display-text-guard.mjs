// The display-text guard (#1456), run by the lint lane through repo-rules.mjs: a session's state is read from codes,
// never from words a person reads, so words can be reworded safely. It fails a SQL `LIKE` on a reading's words in
// packages/hub/src/status.ts (a reading's code is `$.code`; earlier records' words are read in reading-codes.ts alone),
// and an `==` or `!=` one of whose sides is words in the language shown (`shown(…)`, `copy::text(…)`, `copy::fill(…)`,
// `copy::english(…)`) in crates/deep-app/src/states.rs. One `FAIL display text: <path>:<line>: ...` line per finding, or
// one `PASS display text` line; exit 1 on a finding. `--root <dir>` checks the two files under another checkout.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { stripRust } from './rust-source.mjs';

const STATUS = 'packages/hub/src/status.ts';
const STATES = 'crates/deep-app/src/states.rs';
/** A call of words in the language shown, with any path before it (`crate::copy::text`), never a method or a longer name. */
const SHOWN = /(?<![\w.])(?:\w+\s*::\s*)*(?:shown|copy\s*::\s*(?:text|fill|english))\s*\(/;
const OPEN = '([';
const CLOSE = ')]';

/**
 * The operand of the `==`/`!=` at `at` in `code`, on the side `step` (-1 before, 1 after): up to the bracket it sits in,
 * or the `;`, `,`, `{`, `}`, `&&`, `||` or `=>` that ends it.
 */
function operand(code, at, step) {
  let depth = 0;
  let i = step < 0 ? at - 1 : at + 2;
  for (; i >= 0 && i < code.length; i += step) {
    const c = code[i];
    if ((step < 0 ? CLOSE : OPEN).includes(c)) depth += 1;
    else if ((step < 0 ? OPEN : CLOSE).includes(c)) { if (depth === 0) break; depth -= 1; }
    else if (depth === 0 && (';,{}'.includes(c) || /^(&&|\|\||=>)$/.test(step < 0 ? code.slice(i - 1, i + 1) : code.slice(i, i + 2)))) break;
  }
  return step < 0 ? code.slice(i + 1, at) : code.slice(at + 2, i);
}
/** Each line of the Rust source `text` holding an `==` or `!=` one of whose operands calls for shown words, across line breaks too. */
function compared(text) {
  const code = stripRust(text);
  const lines = new Set();
  for (const m of code.matchAll(/[!=]=(?!=)/g)) {
    if (code[m.index - 1] === '=' || code[m.index - 1] === '!') continue;
    if (SHOWN.test(operand(code, m.index, -1)) || SHOWN.test(operand(code, m.index, 1))) lines.add(code.slice(0, m.index).split('\n').length);
  }
  return [...lines].sort((x, y) => x - y);
}

const at = process.argv.indexOf('--root');
if (at !== -1 && (!process.argv[at + 1] || process.argv[at + 1].startsWith('--'))) {
  console.log('BLOCKED display text: --root takes a folder\n  Fix: node scripts/display-text-guard.mjs [--root <checkout>]');
  process.exit(2);
}
const root = at === -1 ? fileURLToPath(new URL('../', import.meta.url)) : process.argv[at + 1];
const read = (path) => {
  try {
    return readFileSync(join(root, path), 'utf8');
  } catch (error) {
    console.log(`BLOCKED display text: ${path} can't be read (${error.code ?? error.message})\n  Fix: run it in a checkout that holds ${STATUS} and ${STATES}`);
    process.exit(2);
  }
};

const findings = [];
read(STATUS).split('\n').forEach((line, index) => {
  if (line.includes('$.reading') && /\bLIKE\b/i.test(line)) findings.push(`FAIL display text: ${STATUS}:${index + 1}: a LIKE on a reading's words decides by display text; read its code (\`$.code\`, readingCode in reading-codes.ts) instead`);
});
for (const line of compared(read(STATES))) findings.push(`FAIL display text: ${STATES}:${line}: a comparison against words in the language shown decides by display text; compare the code the hub sends (a state's word, cause or entry) instead`);
for (const line of findings) console.log(line);
if (!findings.length) console.log('PASS display text');
process.exitCode = findings.length ? 1 : 0;

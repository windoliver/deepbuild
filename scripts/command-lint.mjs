import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const CLI = 'packages/cli/src/main.ts';
const COUNT = 'scripts/command-count.json';
const DESIGN = 'docs/technical-design.md';
const WORDING = ['packages/hub/src/guards.ts', 'packages/hub/src/setup.ts'];
const ROW = /^\|\s*CLI\s*\|/;

const at = process.argv.indexOf('--root');
if (at !== -1 && (!process.argv[at + 1] || process.argv[at + 1].startsWith('--'))) {
  console.log('BLOCKED commands: --root takes a folder\n  Fix: node scripts/command-lint.mjs [--root <checkout>] [--write]');
  process.exit(2);
}
const root = at === -1 ? fileURLToPath(new URL('../', import.meta.url)) : process.argv[at + 1];
const read = (path) => readFileSync(join(root, path), 'utf8');
const fails = [];

const cli = read(CLI);
const block = (start) => {
  const from = cli.indexOf(start);
  return from < 0 ? '' : cli.slice(from, cli.indexOf('];\n', from));
};
const lines = [...block('const usage = [').matchAll(/^\s*'deep ([a-z][a-z0-9-]*(?: \| [a-z][a-z0-9-]*)*)/gm)].map((m) => m[1].split(' | '));
const words = [...new Set(lines.flat())];
const groups = [...block('const groups').matchAll(/^\s*\['([^']+)', \[([^\]]*)\]\]/gm)].map((m) => [...m[2].matchAll(/'([^']+)'/g)].map((n) => n[1]));
if (!words.length || groups.length < 2) fails.push(`FAIL commands: ${CLI} holds no usage table or no two groups to read`);

const count = JSON.parse(read(COUNT)).words ?? {};
for (const word of words) if (!Object.hasOwn(count, word)) fails.push(`FAIL commands: deep ${word} is a top-level word with no entry in ${COUNT}\n  Fix: name its issue there, saying why no existing command can hold it, or make it a form of one`);
for (const word of Object.keys(count)) if (!words.includes(word)) fails.push(`FAIL commands: ${COUNT} counts ${word}, which no usage line in ${CLI} names\n  Fix: take it out of ${COUNT}`);

const place = (names) => groups.slice(0, 2).flat().indexOf(names[0]);
const listed = [...new Set(lines.filter((names) => place(names) >= 0).sort((a, b) => place(a) - place(b)).flat())];
const design = read(DESIGN).split('\n');
const row = design.findIndex((line) => ROW.test(line));
const cell = (line) => line.split(/(?<!\\)\|/)[2] ?? '';
const named = row < 0 ? [] : [...new Set(cell(design[row]).replace(/`/g, '').split(/·|,/).flatMap((item) => (item.trim().replace(/^deep\s+/, '').split(/\s+/)[0] ?? '').split(/\\?\|/)).map((word) => word.trim()).filter((word) => /^[a-z][a-z0-9-]*$/.test(word)))];
const written = `\`deep ${listed.join(' · ')}\``;
if (process.argv.includes('--write') && row >= 0) {
  const cells = design[row].split(/(?<!\\)\|/);
  cells[2] = ` ${written} `;
  design[row] = cells.join('|');
  writeFileSync(join(root, DESIGN), design.join('\n'));
} else if (row < 0) {
  fails.push(`FAIL commands: ${DESIGN} holds no command row, a table row starting "| CLI |"`);
} else {
  for (const word of named.filter((one) => !listed.includes(one))) fails.push(`FAIL commands: ${DESIGN}:${row + 1} names ${word}, ${words.includes(word) ? 'which deep --help lists for developers' : 'which is no deep command'}\n  Fix: node scripts/command-lint.mjs --write`);
  for (const word of listed.filter((one) => !named.includes(one))) fails.push(`FAIL commands: ${DESIGN}:${row + 1} leaves out ${word}, which deep --help lists in its first two groups\n  Fix: node scripts/command-lint.mjs --write`);
}

for (const path of WORDING) {
  const file = ts.createSourceFile(path, read(path), ts.ScriptTarget.Latest, true);
  const visit = (node) => {
    if ((ts.isStringLiteralLike(node) || ts.isTemplateLiteralToken(node)) && /\s/.test(node.text) && /\brules?\b(?!\.[a-z])/i.test(node.text)) {
      const { line } = file.getLineAndCharacterOfPosition(node.getStart());
      fails.push(`FAIL commands: ${path}:${line + 1} calls guard entries rules: ${JSON.stringify(node.text.trim())}\n  Fix: say guard entries; rules are the rules a person wrote`);
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
}

console.log(fails.length ? fails.join('\n') : `PASS commands: ${words.length} top-level words, each counted; the design's command row names the ${listed.length} of the first two groups`);
process.exit(fails.length ? 1 : 0);

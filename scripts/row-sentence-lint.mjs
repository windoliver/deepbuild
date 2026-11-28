#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const SET = 'packages/hub/row-sentences.json';
const RULES = ['packages/hub/src/status.ts', 'packages/hub/src/watch.ts'];
const WORDS = 'contracts/plain-words.json';
const COPY = 'crates/deep-app/copy/en.json';
const FIX = `Say the sentence with say('<name>', ...fills) from a template of ${SET}, in words ${WORDS} doesn't list, and give the template its English under hub.<name> in ${COPY}.`;

const blocked = (why) => {
  console.log(`BLOCKED row sentences: ${why}\n  Fix: node scripts/row-sentence-lint.mjs [--root <checkout>], at a checkout holding ${RULES[0]}, ${WORDS} and ${COPY}`);
  process.exit(2);
};
const at = process.argv.indexOf('--root');
if (at !== -1 && (!process.argv[at + 1] || process.argv[at + 1].startsWith('--'))) blocked('--root takes a folder');
const root = at === -1 ? fileURLToPath(new URL('../', import.meta.url)) : process.argv[at + 1];
const read = (path) => {
  try { return readFileSync(join(root, path), 'utf8'); } catch (error) { return error.code === 'ENOENT' ? undefined : blocked(`${path} can't be read (${error.code ?? error.message})`); }
};
const needed = (path) => read(path) ?? blocked(`${path} isn't there`);
const json = (path) => {
  try { return JSON.parse(needed(path)); } catch (error) { return blocked(`${path} isn't JSON (${error.message})`); }
};

const listed = Object.entries(json(WORDS).words ?? {}).sort(([a], [b]) => b.length - a.length);
if (!listed.length) blocked(`${WORDS} lists no word`);
const english = json(COPY);

function holds(text, word) {
  const [t, w] = [text.toLowerCase(), word.toLowerCase()];
  const joins = (c) => c !== undefined && /[a-z0-9]/.test(c);
  for (let i = t.indexOf(w); i !== -1; i = t.indexOf(w, i + 1)) {
    let rest = t.slice(i + w.length);
    for (const ending of ['es', 's']) if (rest.startsWith(ending) && !joins(rest[ending.length])) { rest = rest.slice(ending.length); break; }
    if (!joins(t[i - 1]) && !joins(rest[0])) return true;
  }
  return false;
}
const wordsIn = (text) => listed.filter(([word]) => holds(text, word)).map(([word, plain]) => `"${word}", which reads "${plain}" on a plain surface`);

const parsed = (path, text) => ts.createSourceFile(path, text, ts.ScriptTarget.ES2023, true, ts.ScriptKind.TS);
const lineOf = (file, node) => file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1;
const nameOf = (property) => (ts.isIdentifier(property.name) || ts.isStringLiteral(property.name) ? property.name.text : undefined);
const unwrapped = (node) => (node && (ts.isAsExpression(node) || ts.isSatisfiesExpression(node) || ts.isParenthesizedExpression(node)) ? unwrapped(node.expression) : node);

const findings = [];
const templates = [];
const set = read(SET);
if (set === undefined) findings.push(`${SET}: the closed set of templates isn't there, so every row sentence is written outside it`);
else {
  let table;
  try { table = JSON.parse(set).templates; } catch (error) { blocked(`${SET} isn't JSON (${error.message})`); }
  if (!table || typeof table !== 'object' || Array.isArray(table) || !Object.keys(table).length) findings.push(`${SET}: holds no templates object of names to texts`);
  else for (const [name, text] of Object.entries(table)) {
    if (typeof text === 'string' && text.trim()) templates.push({ name, text });
    else findings.push(`template ${name} isn't one written string, so the set isn't closed`);
  }
}
const holes = (text) => new Set([...text.matchAll(/\{(\d+)\}/g)].map((hole) => hole[1])).size;
const known = new Map(templates.map(({ name, text }) => [name, holes(text)]));
for (const { name, text } of templates) {
  for (const word of wordsIn(text)) findings.push(`template ${name} "${text}" holds ${word}`);
  const drawn = english[`hub.${name}`];
  if (drawn === undefined) findings.push(`template ${name} "${text}" has no entry in the app's table: ${COPY} holds no hub.${name}, so the app can't draw it in the language shown`);
  else if (drawn !== text) findings.push(`template ${name} "${text}" isn't the English of its entry in the app's table: ${COPY}'s hub.${name} reads "${drawn}"`);
}

const says = (node) => ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'say';
function written(node, file, out) {
  if (says(node)) {
    for (const fill of node.arguments.slice(1)) written(fill, file, out);
    return;
  }
  if (ts.isStringLiteralLike(node)) out.push({ line: lineOf(file, node), text: node.text });
  else if (ts.isTemplateExpression(node)) out.push({ line: lineOf(file, node), text: [node.head.text, ...node.templateSpans.map((span) => span.literal.text)].join('{}') });
  ts.forEachChild(node, (child) => written(child, file, out));
}
const sentence = (text) => {
  const bare = text.replaceAll('{}', '\u0000');
  return /[A-Za-z][A-Za-z'’]*[A-Za-z]/.test(bare) && (/\s/.test(bare.trim()) || /(^|[^\w])[A-Z][a-z]/.test(bare));
};
let seen = 0;
for (const path of RULES) {
  const file = parsed(path, needed(path));
  ts.forEachChild(file, function visit(node) {
    if (ts.isObjectLiteralExpression(node)) {
      const fields = new Map(node.properties.filter(ts.isPropertyAssignment).map((property) => [nameOf(property), property.initializer]));
      const read = [
        ...(fields.has('waits_on') ? [fields.get('plain') ?? fields.get('why')] : []),
        ...(fields.has('fix') || fields.has('text') ? [fields.get('text'), fields.get('fix'), ...(fields.has('waits_on') ? [] : [fields.get('why')])] : []),
      ].filter(Boolean);
      for (const value of read) {
        seen += 1;
        const out = [];
        written(value, file, out);
        for (const { line, text } of out.filter(({ text }) => sentence(text))) {
          const words = wordsIn(text);
          findings.push(`${path}:${line}: "${text}" is a row sentence written outside the set of templates${words.length ? `, and holds ${words.join(' and ')}` : ''}`);
        }
      }
    }
    if (says(node)) {
      const [name, ...fills] = node.arguments;
      const place = `${path}:${lineOf(file, node)}`;
      if (!name || !ts.isStringLiteralLike(name)) findings.push(`${place}: say() is given no template's name as a written string, so the sentence it says can't be read`);
      else if (!known.has(name.text)) findings.push(`${place}: say('${name.text}') names no template of ${SET}`);
      else if (!fills.some(ts.isSpreadElement) && fills.length !== known.get(name.text)) findings.push(`${place}: say('${name.text}') gives ${fills.length} fills to a template that takes ${known.get(name.text)}`);
    }
    ts.forEachChild(node, visit);
  });
}
if (!seen) findings.push(`${RULES.join(' and ')}: no rule's why and no flag's words were found, so no row sentence was read`);

for (const finding of findings) console.log(`FAIL row sentences: ${finding}`);
if (findings.length) console.log(`  Fix: ${FIX}`);
else console.log(`PASS row sentences: ${templates.length} templates, each with its entry in the app's table and no listed word, and no row sentence written outside ${SET}`);
process.exitCode = findings.length ? 1 : 0;

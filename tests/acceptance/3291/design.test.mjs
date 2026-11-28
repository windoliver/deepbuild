import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { CHECKOUT } from './helpers.mjs';

const SECTION = '## How we know version 0 works';

function wrongProgramsEntry() {
  const lines = readFileSync(join(CHECKOUT, 'docs/technical-design.md'), 'utf8').split('\n');
  const start = lines.indexOf(SECTION);
  assert.notEqual(start, -1, `docs/technical-design.md has no "${SECTION}" section`);
  const end = lines.findIndex((line, at) => at > start && line.startsWith('## '));
  const section = lines.slice(start + 1, end === -1 ? undefined : end);
  const first = section.findIndex((line) => line.startsWith('- **Wrong programs'));
  assert.notEqual(first, -1, `"${SECTION}" has no "- **Wrong programs" entry`);
  const next = section.findIndex((line, at) => at > first && (line.startsWith('- **') || line.startsWith('#')));
  return section.slice(first, next === -1 ? undefined : next).join('\n');
}

function codeIn(text) {
  const fenced = [...text.matchAll(/^[ \t]*(`{3,})[^\n]*\n([\s\S]*?)^[ \t]*\1[ \t]*$/gm)].map((match) => match[2]);
  const inline = [...text.replace(/^[ \t]*`{3,}[\s\S]*?^[ \t]*`{3,}[ \t]*$/gm, '').matchAll(/(`+)([^`][\s\S]*?)\1/g)].map((match) => match[2]);
  return [...fenced, ...inline];
}

const isLines = (strings, least) => Array.isArray(strings) && strings.length >= least && strings.every((line) => typeof line === 'string' && !/[\r\n]/.test(line));

function lineFormExamples(text) {
  return codeIn(text).flatMap((code) => {
    let value;
    try { value = JSON.parse(code); } catch { return []; }
    if (!value || typeof value !== 'object' || Array.isArray(value) || !Object.keys(value).length) return [];
    const fits = Object.entries(value).every(([path, edits]) => /^[\w.-]+(?:\/[\w.-]+)*$/.test(path) && Array.isArray(edits) && edits.length >= 1
      && edits.every((edit) => edit && typeof edit === 'object' && Object.keys(edit).sort().join() === 'find,wrong' && isLines(edit.find, 1) && isLines(edit.wrong, 0) && edit.find.join('\n') !== edit.wrong.join('\n')));
    return fits ? [value] : [];
  });
}

test('#3291.84843b66 the design says in Wrong programs that a twin is kept as its wrong lines in lines.json, with an example of one find and its wrong lines', () => {
  const entry = wrongProgramsEntry();
  assert.match(entry, /lines\.json/, `the Wrong programs entry of "${SECTION}" does not name lines.json\n${entry}`);
  assert.match(entry, /\btwins?\b/, `the Wrong programs entry of "${SECTION}" does not speak of a twin\n${entry}`);
  assert.ok(lineFormExamples(entry).length, `the Wrong programs entry of "${SECTION}" holds no example of a lines.json: a JSON object from a repo path to edits, each {"find": [lines], "wrong": [lines]}\n${entry}`);
});

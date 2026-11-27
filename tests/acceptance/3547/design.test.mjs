// #3547, criterion 6: section 7a says when a shard leaves, in the words the script's own comment uses. Written blind
// from the issue at base 2edb19ff4, where neither says it; the wording is the implementer's (README, Criterion 6).
// Read as loosely as the sentence allows: the comments of scripts/shards.mjs and section 7a of docs/parallel-proof.md
// share a run of at least eight words in a row that names days or hours, the "when" of a shard that leaves.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path) => readFileSync(new URL(`../../../${path}`, import.meta.url), 'utf8');

/** Section 7a of docs/parallel-proof.md: from its heading to the next heading of any level. */
function section() {
  const lines = read('docs/parallel-proof.md').split('\n');
  const from = lines.findIndex((line) => /^#{1,6}\s+7a\./.test(line));
  assert.ok(from >= 0, 'docs/parallel-proof.md has no heading that starts "7a."');
  const to = lines.findIndex((line, index) => index > from && /^#{1,6}\s/.test(line));
  return lines.slice(from + 1, to < 0 ? lines.length : to).join('\n');
}

/** The script's own comments: each line of scripts/shards.mjs that starts with `//`, and each line of a block comment. */
function comments() {
  const found = [];
  let block = false;
  for (const raw of read('scripts/shards.mjs').split('\n')) {
    const line = raw.trim();
    if (block) {
      found.push(line.replace(/\*\/.*$/, '').replace(/^\*+\s?/, ''));
      block = !line.includes('*/');
    } else if (line.startsWith('//')) found.push(line.replace(/^\/+\s?/, ''));
    else if (line.startsWith('/*')) {
      found.push(line.replace(/^\/\*+\s?/, '').replace(/\*\/.*$/, ''));
      block = !line.includes('*/');
    }
  }
  return found.join('\n');
}

/** A text's words, lowercased, with its punctuation, markup and line breaks dropped. */
const words = (text) => text.toLowerCase().replaceAll('’', "'").split(/[^\p{L}\p{N}']+/u).filter(Boolean);

/** Each run of words two texts share that neither text carries on, longest first. */
function shared(a, b) {
  const runs = new Map();
  let above = new Uint16Array(b.length + 1);
  for (let i = 1; i <= a.length; i++) {
    const row = new Uint16Array(b.length + 1);
    for (let j = 1; j <= b.length; j++) if (a[i - 1] === b[j - 1]) row[j] = above[j - 1] + 1;
    for (let j = 1; j <= b.length; j++) {
      if (row[j] && !(i < a.length && j < b.length && a[i] === b[j])) runs.set(a.slice(i - row[j], i).join(' '), row[j]);
    }
    above = row;
  }
  return [...runs].sort(([, one], [, other]) => other - one).map(([run]) => run);
}

const WHEN = /(?:^| )(?:days?|hours?)(?: |$)/;
const LEAST = 8;

test("#3547.4edd3480 section 7a says when a shard leaves, in the words the script's own comment uses: the two share a run of at least eight words that names the days", { timeout: 30_000 }, () => {
  const doc = words(section()), script = words(comments());
  const saying = shared(script, doc).filter((run) => WHEN.test(run));
  const count = (list) => list.filter((word) => WHEN.test(word)).length;
  assert.ok(saying.length && saying[0].split(' ').length >= LEAST,
    `section 7a of docs/parallel-proof.md does not say when a shard leaves in the words of a comment of scripts/shards.mjs: the two share no run of ${LEAST} words in a row that names days or hours. `
    + `The script's comments name days or hours ${count(script)} times and section 7a ${count(doc)} times; the longest run they share that does: ${saying.length ? `"${saying[0]}" (${saying[0].split(' ').length} words)` : 'none'}`);
});

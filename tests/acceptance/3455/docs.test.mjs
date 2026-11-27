import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { root } from './helpers.mjs';

const NO_COMMENTS = /\bno comments?\b|\bwithout (?:any )?comments?\b|\bcomment-free\b/i;
const SUITE = /\bsuites?\b|\bsuite's\b|tests\/acceptance\/|\bblind\b|\bdraft/i;
const SUITE_WORD = /\bsuites?\b|\bsuite's\b/i;
const COMMENT = /\bcomments?\b/i;
const ZERO = /\bzero\b/i;
const sentences = (text) => text.split(/(?<=[.!?])\s+(?=[A-Z`*(])/);

function proofBullets() {
  const agents = readFileSync(join(root, 'AGENTS.md'), 'utf8');
  const proof = /^## Proof\s*$([\s\S]*?)(?=^## )/m.exec(agents);
  assert.ok(proof, 'AGENTS.md has no ## Proof section');
  return proof[1].split(/\n(?=- )/).map((bullet) => bullet.trim()).filter((bullet) => bullet.startsWith('- '));
}

function repoGuards() {
  const design = readFileSync(join(root, 'docs/technical-design.md'), 'utf8');
  const item = design.split('\n').find((line) => line.startsWith('- **Repo guards.**'));
  assert.ok(item, "docs/technical-design.md has no '- **Repo guards.**' item");
  return item;
}

test("#3455.b793fb52 AGENTS.md's Proof says a drafted suite holds no comments", () => {
  const bullets = proofBullets();
  const says = bullets.filter((bullet) => NO_COMMENTS.test(bullet) && SUITE.test(bullet));
  assert.ok(says.length > 0, `no bullet in AGENTS.md's Proof says a suite holds no comments (matched: a bullet with ${NO_COMMENTS} and ${SUITE}); its bullets:\n${bullets.join('\n')}`);
});

test("#3455.b793fb52 the design's Repo guards says a new suite starts at zero in the comment ratchet", () => {
  const found = sentences(repoGuards()).filter((sentence) => SUITE_WORD.test(sentence) && COMMENT.test(sentence) && ZERO.test(sentence));
  assert.ok(found.length > 0, `no sentence in the design's Repo guards names a suite, comments and zero together (matched: one sentence with ${SUITE_WORD}, ${COMMENT} and ${ZERO})`);
});

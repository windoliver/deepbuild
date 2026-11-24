// #3239 AC4: section 4 of docs/parallel-proof.md states the rule the issue's Design line gives: a budget is bare by the
// script's own setting (the four scripts start their cargos with RUSTC_WRAPPER empty), and a reference Mac may run the
// cache. Read at this checkout, from the section's heading to the next section's (README: AC4).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { CHECKOUT } from './helpers.mjs';

const ID = '#3239.cd5b51c3';
const SCRIPTS = ['perf.mjs', 'budget-window.mjs', 'benchmark.mjs', 'preflight.mjs'];

test(`${ID} AC4 section 4 states that the four scripts' builds are bare by their own RUSTC_WRAPPER setting and that a reference Mac may run the cache`, () => {
  const text = readFileSync(join(CHECKOUT, 'docs/parallel-proof.md'), 'utf8');
  const section = /^## 4\.[^\n]*\n[\s\S]*?(?=^## (?!4\.)|(?![\s\S]))/m.exec(text)?.[0];
  assert.ok(section, 'docs/parallel-proof.md has no section 4 (a "## 4." heading)');
  // Its blocks: a paragraph, or a bullet with the lines that continue it.
  const blocks = [];
  for (const line of section.split('\n')) {
    if (!line.trim() || /^\s*(?:[-*]|\d+\.)\s|^#/.test(line) || !blocks.length) blocks.push(line);
    else blocks[blocks.length - 1] += `\n${line}`;
  }
  const rule = blocks.filter((block) => /\bRUSTC_WRAPPER\b/.test(block) && SCRIPTS.every((name) => block.includes(name)));
  const empty = rule.filter((block) => /\bempty\b|RUSTC_WRAPPER=(?![\w"'$])/.test(block));
  const sentences = section.split(/(?<=[.!?:;])\s+/);
  const mayRun = sentences.filter((sentence) => /\breference Macs?\b/i.test(sentence) && /\b(?:may|can)\b/i.test(sentence) && /\b(?:sccache|cache|wrapper|rustc-wrapper)\b/i.test(sentence));
  const missing = [
    ...rule.length ? [] : [`no paragraph or bullet names RUSTC_WRAPPER together with ${SCRIPTS.join(', ')}: the rule that the four scripts start their cargos with it`],
    ...!rule.length || empty.length ? [] : ['the paragraph that names the four scripts and RUSTC_WRAPPER doesn\'t say it is set empty'],
    ...mayRun.length ? [] : ['no sentence says a reference Mac may run the cache: one naming the reference Mac, "may" or "can", and the cache, sccache or the wrapper'],
  ];
  const near = sentences.filter((sentence) => /\breference Mac|RUSTC_WRAPPER/.test(sentence)).map((sentence) => `  > ${sentence.trim().slice(0, 300)}`).join('\n');
  assert.deepEqual(missing, [], `section 4 doesn't state the rule:\n${missing.join('\n')}\nits sentences naming the reference Mac or RUSTC_WRAPPER:\n${near}`);
});

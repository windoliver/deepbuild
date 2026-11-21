// The body of the planted doc ceilings check for #2338's acceptance tests: a twin of scripts/doc-ceilings.mjs written by
// the blind test job from the issue, scripts/size-ratchet.mjs's rule and the README's surface alone, never from an
// implementation. The planted file beside it runs `main` with one fault, named in that file's own code, never chosen by
// an environment variable (design: Wrong programs). No test runs it without a fault; the README says how it was
// checked clean. Run from the repository root.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { headings } from './doc-links-copy.mjs';

const LIMIT = 16_384;
const CEILINGS = 'scripts/doc-ceilings.json';
const DOCS = ['docs/technical-design.md', 'docs/canvas-primitives.md'];
const comma = (n) => n.toLocaleString('en-US');

export function main(fault = {}) {
  const ceilings = JSON.parse(readFileSync(CEILINGS, 'utf8'));
  let base = null;
  if (!fault.noMergeBase) {
    try {
      const git = (...args) => execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
      const at = git('merge-base', 'HEAD', 'origin/main').trim();
      if (git('ls-tree', '--name-only', at, '--', CEILINGS).trim()) base = JSON.parse(git('show', `${at}:${CEILINGS}`));
    } catch {}
  }
  const findings = [];
  const seen = new Set();
  let read = 0;
  let over = 0;
  let largest = { key: '', size: -1 };
  for (const file of DOCS) {
    const { headings: all, size } = headings(readFileSync(file));
    for (const [i, heading] of all.entries()) {
      read++;
      const own = (all[i + 1]?.offset ?? size) - heading.offset;
      const key = `${file}#${heading.id}`;
      seen.add(key);
      if (own > largest.size) largest = { key, size: own };
      if (own > LIMIT) over++;
      const ceiling = ceilings[key];
      const was = base && (base[key] ?? LIMIT);
      if (ceiling === undefined) {
        if (own > LIMIT) findings.push(`FAIL doc-ceilings: ${key}: ${comma(own)} bytes of its own text, over ${comma(LIMIT)} with no ceiling`);
      } else if (own > ceiling) findings.push(`FAIL doc-ceilings: ${key}: ${comma(own)} bytes of its own text, over its ceiling of ${comma(ceiling)}`);
      else if (own <= LIMIT) findings.push(`FAIL doc-ceilings: ${key}: ${comma(own)} bytes, at most ${comma(LIMIT)}, under its ceiling of ${comma(ceiling)}; remove its entry`);
      else if (own < ceiling) findings.push(`FAIL doc-ceilings: ${key}: ${comma(own)} bytes, under its ceiling of ${comma(ceiling)}; lower it to ${comma(own)}`);
      else if (was !== null && ceiling > was) findings.push(`FAIL doc-ceilings: ${key}: its ceiling of ${comma(ceiling)} is above the merge base's ${comma(was)}`);
    }
  }
  for (const key of Object.keys(ceilings)) if (!seen.has(key)) findings.push(`FAIL doc-ceilings: ${key}: no such heading, with a ceiling of ${comma(ceilings[key])}`);
  if (findings.length) {
    console.log(findings.join('\n'));
    process.exit(1);
  }
  console.log(`PASS doc-ceilings: ${comma(read)} headings read, ${comma(over)} over the limit of ${comma(LIMIT)} bytes; the largest is ${largest.key}, ${comma(largest.size)} bytes`);
}

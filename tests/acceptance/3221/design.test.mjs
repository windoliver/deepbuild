// #3221 AC7: docs/parallel-proof.md sections 6, 7a and 13 each state the rule and the trust given up. The wording is
// the writer's, so each fact is matched loosely: the rule as one pool of job tokens, a core less one, that admitted
// runs' jobs take turns on, named for this issue; the trust given up as none in what a test proves and the disk an
// admitted run holds while it waits its turn (the issue's "Trust given up under (a)").
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { CHECKOUT } from './helpers.mjs';

const doc = readFileSync(join(CHECKOUT, 'docs/parallel-proof.md'), 'utf8');
/** A section's text, from its heading to the next heading of its level or above. */
function section(number) {
  const heading = new RegExp(`^(#{2,3}) ${number}\\. `, 'm');
  const at = doc.search(heading);
  assert.ok(at >= 0, `docs/parallel-proof.md has no section ${number}`);
  const level = doc.slice(at).match(heading)[1].length;
  const rest = doc.slice(doc.indexOf('\n', at) + 1);
  const end = rest.search(new RegExp(`^#{2,${level}} `, 'm'));
  return end < 0 ? rest : rest.slice(0, end);
}

const FACTS = {
  'this issue, #3221': /#3221\b/,
  'a pool': /\bpool\b/i,
  'job tokens': /\btokens?\b/i,
  'turns': /\bturns?\b/i,
  'the pool\'s size, a core less one': /\bcores? less one\b/i,
  'the trust given up': /\btrust\b[^.]*\bgive[sn]? up\b|\bgive[sn]? up\b[^.]*\btrust\b|\btrust\b[^.]*\bgiven up\b/i,
  'none in what a test proves': /\bwhat a test proves\b/i,
  'the disk an admitted run holds while it waits': /\bdisk\b/i,
};

for (const number of ['6', '7a', '13']) {
  test(`#3221.14b7a581 docs/parallel-proof.md section ${number} states the pool and its turns, and the trust they give up`, () => {
    const text = section(number);
    const missing = Object.entries(FACTS).filter(([, pattern]) => !pattern.test(text)).map(([fact]) => fact);
    assert.deepEqual(missing, [], `section ${number} doesn't state: ${missing.join(', ')}`);
  });
}

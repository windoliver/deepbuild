// #3297 AC6 (#3297.80732be9): docs/parallel-proof.md states which of (a) and (b) the owner chose: what the preflight's budget of
// 900 s bounds. The owner answered (a), the finishing run, on 2026-11-23.
//
// What states it is a paragraph or list item of the page, or a section where none does, that is of this decision (it names
// #3297, the finishing run or the day) and the owner, and that says they chose, decided or answered and then the letter. The
// planted pages are short ones that state no choice, or another.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const AC6 = '#3297.80732be9';
const PAGE = fileURLToPath(new URL('../../../docs/parallel-proof.md', import.meta.url));

/** The letters a text says were chosen, of (a) and (b): by a verb, or else by the first noun that has one after it. */
function letters(text) {
  const verbs = [...text.matchAll(/(?<!\bnot )(?<!n't )\b(?:chose|chosen|decided|answered|picked|ruled)\b[\s\S]{0,160}?\(([ab])\)/gi)].map(([, letter]) => letter);
  if (verbs.length) return verbs;
  const noun = text.match(/\b(?:decision|choice|answer|ruling)\b[\s\S]{0,160}?\(([ab])\)/i);
  return noun ? [noun[1]] : [];
}
/** The letters a page says the owner chose, in what it says of this decision. */
function chosen(page) {
  const of = (texts) => [...new Set(texts.filter((text) => /#3297\b|\bfinishing run\b|\b2026-11-23\b/i.test(text) && /\bowner\b/i.test(text) && /\b(?:budget|900 s|preflight|finishing)\b/i.test(text)).flatMap(letters))].sort();
  const found = of(page.split(/\n\s*\n|\n(?=\s*(?:[-*]|\d+\.)\s)/));
  return found.length ? found : of(page.split(/\n(?=#{2,4} )/));
}

test(`${AC6} docs/parallel-proof.md states that the owner chose (a), and not (b)`, () => {
  assert.deepEqual(chosen(readFileSync(PAGE, 'utf8')), ['a'], `the letters docs/parallel-proof.md says the owner chose for what the preflight's budget bounds`);
});

// The judge itself, so it passes on the merge base too.
test('guard: pages that state no choice, or another one, are told from pages that state (a)', () => {
  const design = '**The budget** times the finishing run. The machine time the fill took is a reading, printed after `Checks elapsed`.';
  const states = {
    'a paragraph of its own': [`${design}\n\n**Owner decision (2026-11-23: (a)).** What the budget of 900 s bounds is the finishing run.`, ['a']],
    'both options beside the answer': [`${design}\n\nWhat the budget of 900 s bounds was the owner's to say: (a) the finishing run, or (b) all of it. The owner chose (a) on 2026-11-23.`, ['a']],
    'the answer and what it leaves': [`${design}\n\n**Owner decision (answered on 2026-11-23: (a)).** The budget of 900 s bounds the finishing run, not all of it, fill and finish, which was (b).`, ['a']],
    'a list item': ['- **The preflight\'s budget (#3297, owner decision 2026-11-23: (a)).** It times the finishing run.', ['a']],
    'a heading and its answer apart': ['### 7b. The preflight (#3297)\n\nWhat the budget bounds was the owner\'s decision.\n\nAnswered on 2026-11-23: (a), the finishing run.', ['a']],
    'the design and no decision': [design, []],
    'both options and no answer': [`${design}\n\nA question to the owner on the preflight's budget (#3297): (a) the finishing run, or (b) all of it.`, []],
    '(b)': [`${design}\n\n**Owner decision (2026-11-23: (b)).** What the budget of 900 s bounds is all of it, fill and finish.`, ['b']],
    '(b) after both options': [`${design}\n\nAn owner decision on the preflight's budget (#3297): (a) the finishing run, or (b) all of it. The owner chose (b).`, ['b']],
    'both letters': ['The owner decided (#3297) the budget: (a).\n\nThe owner then chose (b) for the preflight on 2026-11-23.', ['a', 'b']],
    'another decision\'s (a)': ['**Answered on 2026-11-06: (a) on both.** The owner lists the skips the preflight reads.', []],
  };
  for (const [what, [page, said]] of Object.entries(states)) assert.deepEqual(chosen(page), said, `the letters a page with ${what} says the owner chose`);
});

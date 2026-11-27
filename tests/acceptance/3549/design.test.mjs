// #3549 criterion 7 (#3549.bf86e1ad): sections 6 and 13 of the parallel proof page state the admission, the turn,
// the ceiling and the trust given up, and the capacity table's build row reads as a ceiling. The wording is the
// writer's, so each fact is matched loosely, in each section: this issue's number, as every rule of those sections
// names its own; that a build is admitted; that an admitted build takes a turn; the ceiling of builds; and the trust
// given up, which the issue words as none in what a build produces. The ceiling's numbers, 4 on the Mac and 6 on the
// Linux machine (the owner's answer (a), as drafted), are read from each section's table.
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

// Each is matched inside one clause (no full stop or semicolon between its words), so a rule about runs doesn't answer
// for builds: the base's sections match none of them but the last's first half.
const FACTS = {
  'this issue, #3549': /#3549\b/,
  'the admission (a build is admitted, an admitted build)': /\badmitted builds?\b|(?<!caller's )\bbuilds?\b[^.;|\n]{0,200}\b(?:is|are) admitted\b|\bbuild(?:'s|s'|s)? admission\b|\badmi(?:t|ts|ssion of)\b[^.;|\n]{0,60}\bbuilds?\b/i,
  'the turn (an admitted build takes or waits for a turn)': /\badmitted builds?\b[^.;|\n]{0,300}\bturns?\b|\bturns?\b[^.;|\n]{0,300}\badmitted builds?\b|\b(?:a|each|every) build\b[^.;|\n]{0,160}\b(?:takes?|waits? for|has|gets?) (?:a|its) turn\b|\bbuilds\b[^.;|\n]{0,160}\b(?:take|wait for) (?:turns|a turn|their turns?)\b/i,
  'the ceiling (of builds)': /\bbuilds?\b[^.;|\n]{0,160}\bceiling\b|\bceiling\b[^.;|\n]{0,160}\bbuilds?\b/i,
  'the trust given up': /\btrust\b[^.]*\bgive[sn]? up\b|\bgive[sn]? up\b[^.]*\btrust\b|\btrust\b[^.]*\bgiven up\b/i,
  'none in what a build produces': /\bwhat a build produces\b/i,
};
/** The facts a section doesn't state. */
const missing = (text) => Object.entries(FACTS).filter(([, pattern]) => !pattern.test(text)).map(([fact]) => fact);
/** A table row's cells, for each row of `text` whose first cell matches `first`. */
const rows = (text, first) => text.split('\n').filter((line) => line.trim().startsWith('|')).map((line) => line.trim().split('|').slice(1, -1).map((cell) => cell.trim())).filter((cells) => first.test(cells[0] ?? ''));
/** Whether a row's Mac and Spark cells hold the ceiling's numbers: 4 and 6. */
const ceiling = (cells) => /(?<![\d.])4(?![\d.])/.test(cells[1] ?? '') && /(?<![\d.])6(?![\d.])/.test(cells[2] ?? '');

test('#3549.bf86e1ad docs/parallel-proof.md section 6 states the admission of a build, its turn, the ceiling and the trust given up, and the class table holds the ceiling of 4 and 6 for build', () => {
  const text = section('6');
  assert.deepEqual(missing(text), [], `section 6 doesn't state: ${missing(text).join('; ')}`);
  const [build, ...more] = rows(text, /^`?build`?$/i);
  assert.ok(build && !more.length, `section 6's class table has ${more.length + (build ? 1 : 0)} rows for the class build, not one`);
  assert.ok(ceiling(build), `section 6's class table gives build ${build[1]} on the Mac and ${build[2]} on the Spark, not the ceiling of 4 and 6: | ${build.join(' | ')} |`);
});

test('#3549.bf86e1ad docs/parallel-proof.md section 13 states the admission of a build, its turn, the ceiling and the trust given up, and the build row of the capacity table reads as a ceiling of 4 and 6', () => {
  const text = section('13');
  assert.deepEqual(missing(text), [], `section 13 doesn't state: ${missing(text).join('; ')}`);
  const [build, ...more] = rows(text, /^[^a-z]*(?:top-level |admitted )?builds?\b/i);
  assert.ok(build && !more.length, `section 13's capacity table has ${more.length + (build ? 1 : 0)} rows that start with builds, not one`);
  const row = `| ${build.join(' | ')} |`;
  assert.ok(ceiling(build), `the capacity table's build row gives ${build[1]} on the Mac and ${build[2]} on the Spark, not the ceiling of 4 and 6: ${row}`);
  assert.match(row, /\bceiling\b|\bat most\b|\bup to\b|\bno more than\b/i, `the capacity table's build row doesn't read as a ceiling (it says neither ceiling, at most, up to nor no more than): ${row}`);
});

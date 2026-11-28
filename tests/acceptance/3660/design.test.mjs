import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { CHECKOUT } from '../3549/helpers.mjs';

const doc = readFileSync(join(CHECKOUT, 'docs/parallel-proof.md'), 'utf8');

function section(number) {
  const heading = new RegExp(`^(#{2,3}) ${number}\\. `, 'm');
  const at = doc.search(heading);
  assert.ok(at >= 0, `docs/parallel-proof.md has no section ${number}`);
  const level = doc.slice(at).match(heading)[1].length;
  const rest = doc.slice(doc.indexOf('\n', at) + 1);
  const end = rest.search(new RegExp(`^#{2,${level}} `, 'm'));
  return end < 0 ? rest : rest.slice(0, end);
}

function bullet(text, title) {
  const lines = text.split('\n').filter((line) => line.startsWith(`- **${title}`));
  assert.equal(lines.length, 1, `docs/parallel-proof.md has ${lines.length} bullets starting "${title}" where one was looked for`);
  return lines[0];
}

const clauses = (text) => text.replace(/`[^`]*`/g, (code) => code.replaceAll('.', '·').replaceAll(';', '·')).split(/[.;](?:\s|$)/);
const UNBOUNDED = /\bno (?:wait )?limit\b|\bunbounded\b|\bwithout (?:a |any )?(?:limit|bound)\b|\bnot bounded\b|\bwith no (?:limit|bound|deadline)\b/i;
const BOUNDED = /--wait|--stall|\bstall\b|\bcaller(?:'s)?\b|\bdeadline\b|\bbound(?:s|ed)?\b|\btime left\b|\bhour\b/i;
const turnClauses = (text) => clauses(text).filter((clause) => /\bturns?\b/i.test(clause));

test('#3660.388d9ec0 docs/parallel-proof.md says an admitted build waits for its turn on its caller\'s bound: the grant-wait table\'s row, the "Builds on the pool" bullet, and section 7a\'s "The hour"', () => {
  const six = section('6');
  const rows = six.split('\n').filter((line) => /^\|\s*An admitted build, for its turn\b/i.test(line.trim()));
  assert.equal(rows.length, 1, `section 6's grant-wait table has ${rows.length} rows "An admitted build, for its turn", not one`);
  const wait = rows[0].trim().split('|').slice(1, -1).map((cell) => cell.trim())[1] ?? '';
  assert.doesNotMatch(wait, UNBOUNDED, `section 6's grant-wait table still gives an admitted build's turn no bound: ${rows[0].trim()}`);
  assert.match(wait, BOUNDED, `section 6's grant-wait table doesn't give an admitted build's turn its caller's bound (its --wait or --stall): ${rows[0].trim()}`);

  const pool = bullet(six, 'Builds on the pool');
  const unbounded = turnClauses(pool).filter((clause) => UNBOUNDED.test(clause));
  assert.deepEqual(unbounded, [], `section 6's "Builds on the pool" bullet still says the turn is waited for with no limit`);
  assert.doesNotMatch(pool, /\bstall\b[^.;]{0,80}\bbounds only the wait for admission\b/i, `section 6's "Builds on the pool" bullet still says a stall bounds only the wait for admission`);
  assert.ok(turnClauses(pool).some((clause) => /--wait|--stall|\bstall\b|\bcaller(?:'s)?\b|\bdeadline\b/i.test(clause)), `section 6's "Builds on the pool" bullet has no clause that puts the turn on the caller's --wait or --stall`);
  assert.match(pool, /#3660\b/, `section 6's "Builds on the pool" bullet doesn't name #3660`);

  const hour = bullet(section('7a'), 'The hour');
  const open = turnClauses(hour).filter((clause) => UNBOUNDED.test(clause));
  assert.deepEqual(open, [], `section 7a's "The hour" still says the wait for a turn is not bounded by the hour`);
  assert.ok(turnClauses(hour).some((clause) => /\bhour\b|\bbound\b|\btime left\b/i.test(clause)), `section 7a's "The hour" has no clause that bounds the rebuild's wait for its turn by the time left to the hour`);
});

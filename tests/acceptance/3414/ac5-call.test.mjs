import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { CHECKOUT, DESIGN, DOCS, GUIDE, PLACES, sha256 } from './helpers.mjs';

const ID = '#3414.2b712213';
const FOLDER = 'docs/evidence/3414/';
const RECORD = `${FOLDER}call.json`;
const TEXTS = [...DOCS, GUIDE];
const at = (path) => join(CHECKOUT, path);

function judge() {
  if (!existsSync(at(RECORD))) return ['INCONCLUSIVE', `no call is recorded at ${RECORD}`];
  let call;
  try { call = JSON.parse(readFileSync(at(RECORD), 'utf8')); } catch (e) { return ['INCONCLUSIVE', `${RECORD} is not JSON: ${e.message}`]; }
  const gaps = [];
  if (call?.criterion !== ID) gaps.push(`it names criterion ${JSON.stringify(call?.criterion)}, not ${ID}`);
  if (!(typeof call?.who === 'string' && call.who.trim())) gaps.push('it names no person in "who"');
  if (!(typeof call?.when === 'string' && !Number.isNaN(Date.parse(call.when)))) gaps.push('it has no ISO 8601 time in "when"');
  if (!['right', 'wrong'].includes(call?.call)) gaps.push(`its call is ${JSON.stringify(call?.call)}, not "right" or "wrong"`);
  const shown = Object.entries(call?.shown ?? {});
  if (!shown.length) gaps.push('it names nothing shown');
  for (const [path, hash] of shown) {
    if (!path.startsWith(FOLDER) || !existsSync(at(path))) gaps.push(`what it says was shown, ${path}, is not a file in ${FOLDER}`);
    else if (sha256(readFileSync(at(path))) !== hash) gaps.push(`${path} is not what was shown: its SHA-256 differs`);
  }
  for (const path of TEXTS) {
    if (call?.text?.[path] !== sha256(readFileSync(at(path)))) gaps.push(`the call was made on other text than ${path} as it is now`);
  }
  const list = PLACES.blocks.find(readFileSync(at(DESIGN), 'utf8'));
  const seen = shown.filter(([path]) => path.startsWith(FOLDER) && existsSync(at(path))).map(([path]) => readFileSync(at(path), 'utf8')).join('\n');
  if (!list) gaps.push(`${DESIGN}'s Building blocks holds no list of what the core holds`);
  else if (!seen.includes(list.line.trim())) gaps.push(`what was shown doesn't hold Building blocks' list of what the core holds (${DESIGN}:${list.index + 1})`);
  if (gaps.length) return ['INCONCLUSIVE', `${RECORD}: ${gaps.join('; ')}`];
  if (call.call === 'wrong') return ['FAIL', `the call (${call.who}, ${call.when}) says the list or a changed sentence is wrong`];
  return ['PASS', `the call (${call.who}, ${call.when}) says the list is right and every sentence still says what it said`];
}

test(`${ID} AC5: each changed line beside the line it replaced and the one list of what the core holds were shown, and the person's call that they are right is recorded on exactly this text`, () => {
  const [verdict, why] = judge();
  assert.equal(verdict, 'PASS', `${verdict}: ${why}`);
});

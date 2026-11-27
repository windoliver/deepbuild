// #3551, criterion 6 and the Scope's "Design" and "The schedule": sections 6 and 12a of docs/parallel-proof.md state
// the three cases, the two drafted spans and the hourly schedule, and the trust given up. The wording is the writer's,
// so each fact is matched loosely, by the issue's own words for it (README: Criterion 6). Read at this checkout, each
// section from its heading to the next heading of its level or above.
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
/** A section's blocks: a paragraph, or a bullet with the lines that continue it. */
function blocks(text) {
  const found = [];
  for (const line of text.split('\n')) {
    if (!line.trim() || /^\s*(?:[-*]|\d+\.)\s/.test(line) || !found.length) found.push(line);
    else found[found.length - 1] += `\n${line}`;
  }
  return found.filter((block) => block.trim());
}
const sentences = (text) => blocks(text).flatMap((block) => block.split(/(?<=[.!?])\s+/));
const every = (...patterns) => (text) => patterns.every((pattern) => pattern.test(text));

const SIX = /\b(?:6|six)(?:\s+(?:and|or)\s+(?:12|twelve))?\s+hours?\b|\b6\s?h\b/i;
const TWELVE = /\b(?:12|twelve)\s+hours?\b|\b12\s?h\b/i;
// The three cases, each as one sentence may state it.
const CASES = {
  'the empty case (a sentence that names a window, says "at once" and says no grant is held, as "no grant", "holds no", "nothing is held", "none is held" or "empty")':
    every(/\bwindows?\b/i, /\bat once\b|\bimmediately\b/i, /\bno grants?\b|\bholds no\b|\bnothing is held\b|\bnone (?:is |are )?held\b|\bempty\b/i),
  'the not-yet case (a sentence that says "leaves at once", "joins no line", "stops no grant", "stops nothing" or `INCONCLUSIVE window`)':
    (text) => /\bleaves at once\b|\bjoins no line\b|\bstops no (?:new )?grants?\b|\bstops nothing\b|INCONCLUSIVE window/i.test(text),
  'the overdue case (a sentence that says "overdue", or one that says "12 hours", "or more" and "waits" or "drains")':
    (text) => /\boverdue\b/i.test(text) || every(TWELVE, /\bor more\b/i, /\bwaits?\b|\bdrains?\b/i)(text),
};

/** A line that asks `throttle.mjs window` from a schedule: its five crontab fields, or `@hourly`, and whether they ask each hour. */
function schedules(text) {
  return text.split('\n').filter((line) => /throttle\.mjs window/.test(line)).flatMap((line) => {
    if (/^\s*@hourly\s/.test(line)) return [{ line: line.trim(), hourly: true }];
    const fields = line.trim().match(/^(\S+)\s+(\S+)\s+(\S+)\s+(\S+)\s+(\S+)\s+\S/);
    if (!fields || !fields.slice(1, 6).every((field) => /^[\d*,/-]+$/.test(field))) return [];
    const [, minute, hour, day, month, weekday] = fields;
    return [{ line: line.trim(), hourly: /^\d{1,2}$/.test(minute) && /^(?:\*|\*\/1|0-23)$/.test(hour) && [day, month, weekday].every((field) => field === '*') }];
  });
}

test('#3551.0d50f746 sections 6 and 12a of docs/parallel-proof.md state the three cases, the two drafted spans and the hourly schedule', () => {
  const six = section('6'), twelveA = section('12a');
  const missing = [];
  for (const [number, text] of [['6', six], ['12a', twelveA]]) {
    for (const [fact, stated] of Object.entries(CASES)) if (!sentences(text).some(stated)) missing.push(`section ${number} doesn't state ${fact}`);
  }
  const both = [...blocks(six), ...blocks(twelveA)];
  for (const [span, pattern] of [['6 hours', SIX], ['12 hours', TWELVE]]) {
    if (!both.some((block) => pattern.test(block) && /\bdrafted\b/i.test(block))) missing.push(`neither section states the span of ${span} as drafted (a paragraph or bullet that holds "${span}" and "drafted")`);
  }
  const asked = schedules(twelveA);
  if (!asked.some(({ hourly }) => hourly)) missing.push(`section 12a holds no crontab line that asks \`throttle.mjs window\` each hour (a minute, then \`* * * *\`)${asked.length ? `: it holds \`${asked.map(({ line }) => line).join('`, `')}\`` : ''}`);
  const fixed = [...schedules(six), ...asked].filter(({ hourly }) => !hourly);
  if (fixed.length) missing.push(`a crontab line still asks the window at fixed hours: \`${fixed.map(({ line }) => line).join('`, `')}\``);
  assert.ok(!missing.length, `docs/parallel-proof.md doesn't state what criterion 6 names:\n${missing.map((line) => `- ${line}`).join('\n')}`);
});

test('Scope, Design and The schedule: sections 6 and 12a state the trust the three cases give up, and section 12a still says the schedule is installed by hand, on a reference Mac', () => {
  const six = blocks(section('6')), twelveA = blocks(section('12a'));
  const trust = [...six, ...twelveA].filter(every(/\btrust\b/i, /\bgive[sn]?\s+up\b/i, /\bwindows?\b/i));
  assert.ok(trust.length, 'neither section 6 nor section 12a states the trust given up: a paragraph or bullet that holds "trust", "given up" (or "gives up", "give up") and names a window');
  assert.ok(twelveA.some(every(/\bby hand\b/i, /\breference Macs?\b/i)), 'section 12a no longer says the schedule is installed by hand, on a reference Mac: a paragraph or bullet that holds "by hand" and "reference Mac"');
});

// #2974 AC6 (README: The scenes): the design's threat table, under "Threats, and what stops each one" in
// docs/technical-design.md, names this threat, a held drain, and its mitigation: a row whose threat or mitigation names
// a drain, and whose mitigation says it lapses unless renewed, that you can see who holds it, and that promote lifts its own.
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CHECKOUT, assert } from './helpers.mjs';

test('#2974.5ff069d9 the design\'s threat table names a held drain and its mitigation', () => {
  const doc = readFileSync(join(CHECKOUT, 'docs', 'technical-design.md'), 'utf8');
  const section = doc.split(/^## Threats, and what stops each one\s*$/m)[1]?.split(/^#{1,2} /m)[0];
  assert.ok(section, 'BLOCKED: docs/technical-design.md has no "Threats, and what stops each one" section');
  const rows = section.split('\n').filter((l) => /^\|/.test(l) && !/^\|\s*-/.test(l)).map((l) => l.split('|').slice(1, -1).map((c) => c.trim())).filter((c) => c.length >= 2 && c[0] !== 'Threat');
  const row = rows.find(([threat, mitigation]) => /drain/i.test(`${threat} ${mitigation}`));
  assert.ok(row, `the threat table must name a held drain: no row's threat or mitigation names a drain (its threats: ${rows.map((r) => r[0]).join('; ')})`);
  const mitigation = row.slice(1).join(' ');
  assert.match(mitigation, /laps|lease|renew/i, `the held drain's row must say it lapses unless its caller renews it; it reads: ${mitigation}`);
  assert.match(mitigation, /status|health|show|see/i, `the held drain's row must say you can see a drain that holds, and who holds it; it reads: ${mitigation}`);
  assert.match(mitigation, /promote/i, `the held drain's row must say deep hub promote lifts its own drain; it reads: ${mitigation}`);
});

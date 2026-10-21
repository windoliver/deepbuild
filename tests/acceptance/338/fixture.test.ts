// Criterion 2 (#338.ed0f5115), its contracts half: every event of the Needs you fixture record validates
// against its kind's published schema through the contracts package's public entry, so the fixture is a
// record the hub could hold and not a shape of the view's own. The rows themselves are recomputed in
// spike.test.mjs. Run: npx vitest run tests/acceptance/338
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';
import { listSchemas, validate } from '../../../packages/contracts/src/index.ts';
import type { JsonValue } from '../../../packages/contracts/src/index.ts';

const ID = '#338.ed0f5115';
const REPO = join(fileURLToPath(new URL('.', import.meta.url)), '..', '..', '..');
const RECORD = 'docs/spikes/338/record.json';

interface Row { session_id: string; event: { kind: string; log_pos: number } & Record<string, JsonValue> }

function fixture(): Row[] {
  const recordPath = join(REPO, RECORD);
  if (!existsSync(recordPath)) throw Error(`no spike record at ${RECORD}: the spike hasn't been recorded`);
  const record = JSON.parse(readFileSync(recordPath, 'utf8'));
  const path = record?.needsYou?.fixture;
  if (typeof path !== 'string' || !existsSync(join(REPO, path))) throw Error(`needsYou.fixture ${JSON.stringify(path)} isn't a file`);
  return readFileSync(join(REPO, path), 'utf8').split('\n').filter((line) => line.trim()).map((line) => JSON.parse(line) as Row);
}

describe(`${ID} the fixture record of asks is made of catalogued events`, () => {
  test('every event validates against its kind\'s published schema, log_pos included', () => {
    const rows = fixture();
    expect(rows.length).toBeGreaterThan(0);
    const names = new Set(listSchemas().map((schema) => schema.name));
    const failures: string[] = [];
    rows.forEach(({ event }, index) => {
      const name = `${event.kind}@${event.v}`;
      if (!names.has(name)) { failures.push(`line ${index + 1}: ${name} isn't a published schema`); return; }
      const result = validate(name, event as JsonValue);
      if (!result.ok) failures.push(`line ${index + 1} (${name}, log_pos ${event.log_pos}): ${result.issues.map((issue) => `${issue.path} ${issue.code}`).join('; ')}`);
      if (typeof event.log_pos !== 'number') failures.push(`line ${index + 1}: no log_pos; the view is built as of a log position`);
    });
    expect(failures, failures.join('\n')).toEqual([]);
  });
});

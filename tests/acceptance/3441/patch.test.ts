import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { CARRIED_TABLE, patchRowFailures } from './judges.ts';

const REPO = fileURLToPath(new URL('../../../', import.meta.url));
const textOf = (path: string): string | null => (existsSync(`${REPO}${path}`) ? readFileSync(`${REPO}${path}`, 'utf8') : null);

describe('#3441 the caps\' rule is the carried GPUI patch\'s', () => {
  it('Scope of #3441: the carried-patch table holds a row of #3441 that lists vendor/gpui-pre/src/window.rs, each file it lists carries the mark of #3441, and it names its test and its removal condition', () => {
    const table = textOf(CARRIED_TABLE);
    if (table === null) expect.fail(`BLOCKED: ${CARRIED_TABLE} is not there; this is not a pass`);
    expect(patchRowFailures(table, textOf), 'the row of #3441 in the carried-patch table').toEqual([]);
  });
});

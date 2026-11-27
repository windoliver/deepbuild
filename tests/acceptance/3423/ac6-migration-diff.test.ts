import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { describe, expect, it } from 'vitest';
import { AC, REPO, TIMEOUT, callOf, mergeBase, recordPathsAt, showAt, type JsonObject } from './helpers.ts';

const isObj = (v: unknown): v is JsonObject => typeof v === 'object' && v !== null && !Array.isArray(v);

function makerProblem(maker: unknown): string | null {
  if (!isObj(maker)) return `maker is not an object: ${JSON.stringify(maker)}`;
  const keys = Object.keys(maker);
  if (keys.length === 1 && keys[0] === 'person') return typeof maker['person'] === 'string' && maker['person'].trim() ? null : 'maker.person is not a name';
  if (keys.length === 1 && keys[0] === 'agent') {
    const a = maker['agent'];
    if (!isObj(a) || !('model' in a) || !('session' in a)) return 'maker.agent lacks model or session';
    for (const k of ['model', 'session']) if (a[k] !== null && (typeof a[k] !== 'string' || !(a[k] as string).trim())) return `maker.agent.${k} is neither a string nor null`;
    return null;
  }
  return `maker is neither {person} nor {agent}: ${JSON.stringify(maker)}`;
}

describe(`${AC[6]} the migration of main's records`, () => {
  it(`${AC[6]} the change differs from the merge base only in the maker field; every call, hash and time is the same`, () => {
    const base = mergeBase();
    const paths = recordPathsAt(base);
    expect(paths.length, 'the merge base holds records').toBeGreaterThan(100);
    const problems: string[] = [];
    let migrated = 0;
    for (const path of paths) {
      const was = showAt(base, path);
      const file = join(REPO, path);
      if (!existsSync(file)) { problems.push(`${path}: the change deletes it`); continue; }
      const now = readFileSync(file, 'utf8');
      const before = JSON.parse(was) as JsonObject;
      if (callOf(before) === null && !('maker' in before)) { if (now !== was) problems.push(`${path}: holds no call, yet the change edits it`); continue; }
      let after: JsonObject;
      try { after = JSON.parse(now) as JsonObject; } catch (e) { problems.push(`${path}: not JSON in the change: ${(e as Error).message}`); continue; }
      migrated += 1;
      if ('maker' in before) { if (!isDeepStrictEqual(after, before)) problems.push(`${path}: already had its maker at the merge base, yet the change edits it`); continue; }
      if (!('maker' in after)) { problems.push(`${path}: the change adds no maker field`); continue; }
      const bad = makerProblem(after['maker']);
      if (bad) problems.push(`${path}: ${bad}`);
      const { maker, ...rest } = after;
      const expected: JsonObject = { ...before };
      if (before['by'] === 'you' && isObj(maker) && 'agent' in maker && !('by' in rest)) delete expected['by'];
      if (!isDeepStrictEqual(rest, expected)) {
        const changed = [...new Set([...Object.keys(rest), ...Object.keys(expected)])].filter((k) => !isDeepStrictEqual(rest[k], expected[k]));
        problems.push(`${path}: besides maker the change edits ${changed.join(', ')}`);
      }
    }
    expect(problems, `${problems.length} of the merge base's ${paths.length} records`).toEqual([]);
    expect(migrated, 'every record with a call was compared').toBeGreaterThanOrEqual(117);
  }, TIMEOUT);
});

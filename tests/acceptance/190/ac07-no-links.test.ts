// Criterion 7 (no upstream test): "A piece without links gets the same rewritten program hash, bake key and goldens
// as on the merge base, while a planted linker that runs on every program and adds an empty linking section changes
// that hash and fails, naming the piece"
//
// Through `deep-logic check`, `bake` and `golden` (#532's) of `plain`, a counter with no links (a whole module), by
// this checkout's binary and by the merge base's (`git merge-base HEAD main`, built from `git archive`; helpers:
// baseBin). The judgement compares the rewritten program hash, the bake key and the golden's bake key, step hashes
// and checkpoint hashes, each failure naming the piece. `linker_adds_linking_section` runs the linker on every
// program and adds an empty `linking` custom section to what it merges. It runs first, so the base fails fast.
import { describe, expect, it } from 'vitest';
import { AC, TIMEOUT, bakeCall, checkCall, goldenCall, goldenOf, logicBin, obj, onBase, onHost, prebuild, show, str, type JsonObject } from './helpers.ts';
import { plainPiece } from './libs.ts';

prebuild(() => { logicBin(); });

const ID = 'plain';
const STEPS = 120;
const calls = (): JsonObject[] => [checkCall(plainPiece()), bakeCall(plainPiece(), STEPS), goldenCall(plainPiece(), STEPS)];
interface Reading { hash: string; key: string; golden: string }
function read(replies: JsonObject[], what: string): Reading {
  expect(replies.map((r) => r['ok']), `${what}: check, bake and golden ran: ${show(replies.map((r) => r['ok'] === true ? 'ok' : r) as never)}`).toEqual([true, true, true]);
  const g = goldenOf(replies[2]!, `${what}: golden`);
  return {
    hash: str(obj(obj(replies[0]!['items'], `${what}: check.items`)[ID], `${what}: check.items.${ID}`)['hash'], `${what}: the rewritten program hash`),
    key: str(obj(replies[1]!['keys'], `${what}: bake.keys`)[ID], `${what}: the bake key`),
    golden: JSON.stringify([g.bake_key, g.step_hashes, g.checkpoint_hashes]),
  };
}
/** The criterion over one binary's readings against the merge base's, each failure naming the piece. */
function judge(got: Reading, base: Reading): string[] {
  const failures: string[] = [];
  if (got.hash !== base.hash) failures.push(`piece ${ID}: its rewritten program hash ${got.hash} isn't the merge base's ${base.hash}`);
  if (got.key !== base.key) failures.push(`piece ${ID}: its bake key ${got.key} isn't the merge base's ${base.key}`);
  if (got.golden !== base.golden) failures.push(`piece ${ID}: its golden isn't the merge base's`);
  return failures;
}

describe(`${AC[7]} a piece without links is untouched by the linker`, () => {
  it(`${AC[7]} a piece without links keeps the merge base's rewritten program hash, bake key and golden, and a planted linker that adds an empty linking section to every program changes that hash and fails, naming the piece`, () => {
    const planted = read(onHost(calls(), ['linker_adds_linking_section']), 'linker_adds_linking_section');
    const base = read(onBase(calls()), 'the merge base');
    const head = read(onHost(calls()), 'this checkout');
    const honest = judge(head, base);
    expect(honest, `the piece keeps the merge base's hash, key and golden:\n  ${honest.join('\n  ')}`).toEqual([]);
    expect(planted.hash, 'the planted linker changes the rewritten program hash').not.toBe(base.hash);
    const failures = judge(planted, base);
    expect(failures.some((f) => f.startsWith(`piece ${ID}: its rewritten program hash`)), `the criterion fails on the planted linker, naming the piece: ${failures.join('; ')}`).toBe(true);
  }, TIMEOUT);
});

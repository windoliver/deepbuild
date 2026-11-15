// #2538 AC2: with the three codes listed, `node scripts/conformance-lint.mjs` still passes its code mappings and
// kit checks (each code has a mapping and a planted fix text), and doctor.item@1's entry in
// packages/contracts/digests.json is its schema's digest. The lint is run once, for real, over the built packages.
// That every schema's digest is its own and that an unmapped code is named are #2146's and #313's tests; here only
// what the three codes add.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { kits, unmappedCodes } from '../../../packages/conformance/src/index.ts';
import { d1Digest, listSchemas } from '../../../packages/contracts/src/index.ts';
import { CODES, LINT_TIMEOUT_MS, listedCodes, REPO, runLint } from './helpers.ts';
import type { Lint } from './helpers.ts';

// The machine reading tests/acceptance/2146/README.md sets apart, read the same way here: environment@1's slot kit
// reads listening ports with lsof, and where that fails the lint prints this FAIL line and exits 1. It names no code
// mapping and no kit of codes, and nothing in the repo decides it.
const MACHINE_BLOCKED = /^FAIL slot kit environment@1: .* BLOCKED "the environment's listening ports can't be read \(lsof failed\)/;
const AC2 = '#2538.982ff19a AC2: `node scripts/conformance-lint.mjs` still passes its code mappings and kit checks with the three codes listed (each has a mapping and a planted fix text), and `doctor.item@1`\'s entry in `packages/contracts/digests.json` is its schema\'s digest';

describe(AC2, () => {
  let lint: Lint;
  beforeAll(() => { lint = runLint(); }, LINT_TIMEOUT_MS);

  it('#2538.982ff19a AC2: with the three codes in the schema file, the lint prints PASS for code mappings and for every kit, and nothing but a machine\'s unreadable ports fails it', () => {
    expect(lint.signal, lint.stderr).toBeNull();
    expect(lint.lines).toContain('PASS code mappings: every family code maps to a verdict');
    const kitLines = lint.lines.filter((line) => /^(PASS|FAIL) kit /.test(line));
    expect(kitLines.length).toBeGreaterThan(0);
    expect(kitLines.filter((line) => !line.startsWith('PASS '))).toEqual([]);
    // The lint reads the built package; the source it was built from names the same unmapped codes: none.
    expect(unmappedCodes().map((u) => `${u.family} ${u.code}`)).toEqual([]);
    const failing = lint.lines.filter((line) => !line.startsWith('PASS '));
    expect(failing.filter((line) => !MACHINE_BLOCKED.test(line))).toEqual([]);
    expect(lint.status, lint.stderr).toBe(failing.length ? 1 : 0);
    // "With the three codes listed": a lint that passes over a schema without them proves nothing of this criterion.
    expect(listedCodes()).toEqual(expect.arrayContaining([...CODES]));
  });

  it.each(CODES)('#2538.982ff19a AC2: the kit\'s planted entry for doctor %s carries a fix text of its own, not the fallback', (code) => {
    const planted = kits().flatMap((kit) => kit.planted).filter((p) => p.family === 'doctor' && p.code === code);
    expect(planted.map((p) => p.code)).toEqual([code]);
    const { fix, entry } = planted[0]!;
    expect(fix.trim().length).toBeGreaterThan(0);
    // What planted.ts writes for a code it has no text for, at the base.
    expect([`Resolve the ${code} item.`, 'See deep doctor.']).not.toContain(fix);
    expect(JSON.stringify(entry)).not.toContain('See deep doctor.');
  });

  it('#2538.982ff19a AC2: doctor.item@1\'s entry in packages/contracts/digests.json is the digest of the schema that lists the three codes', () => {
    const frozen = JSON.parse(readFileSync(join(REPO, 'packages', 'contracts', 'digests.json'), 'utf8')) as Record<string, string>;
    const published = listSchemas().find((e) => e.name === 'doctor.item@1');
    expect(published).toBeDefined();
    const codes = (published!.schema as { properties: { code: { enum: string[] } } }).properties.code.enum;
    // The published schema is the file on disk, and it lists the three codes: the digest is of that schema.
    expect(codes).toEqual(listedCodes());
    expect(codes).toEqual(expect.arrayContaining([...CODES]));
    expect(frozen['doctor.item@1']).toMatch(/^d1:[0-9a-f]{64}$/);
    expect(frozen['doctor.item@1']).toBe(d1Digest(published!.schema));
  });
});

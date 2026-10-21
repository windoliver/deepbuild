// AC1: each of the seven kinds' first fixture validates with the writer the issue names, and is refused
// with every other writer form, in TypeScript and through the Rust types.

import { beforeAll, describe, expect, it } from 'vitest';
import { validate } from '../../../packages/contracts/src/index.ts';
import { cargo, firstWith, NARROWED, othersThan, rustCheck } from './helpers.ts';

beforeAll(() => {
  // The Rust types are the crate's generated module; building the binary picks up whatever the schemas generated.
  cargo(['build', '--locked', '-q', '-p', 'deep-contracts', '--bin', 'deep-contracts']);
}, 600_000);

describe('AC1 a hook kind is written only by the hook, a reading only by the core (TypeScript validate)', () => {
  it.each(NARROWED.map((k) => [k.name, k.writer] as const))('AC1 %s: its first fixture validates with writer %s', (name, writer) => {
    const result = validate(name, firstWith(name, writer));
    expect(result.ok, `${name} by ${writer}: should be accepted ${result.ok ? '' : JSON.stringify(result.issues)}`).toBe(true);
  });

  it.each(NARROWED.map((k) => [k.name, k.writer] as const))('AC1 %s: refused, at /writer, with every writer form but %s', (name, writer) => {
    // A pattern left at `hook | app | cli | core | ext:<id>` takes app, cli, ext:x and the wrong one of hook
    // and core; a kind narrowed to the other of the two takes that one. Either lists them here.
    const accepted = othersThan(writer).filter((other) => validate(name, firstWith(name, other)).ok);
    expect(accepted, `${name}: writers it should refuse but accepts`).toEqual([]);
    for (const other of othersThan(writer)) {
      const result = validate(name, firstWith(name, other));
      if (result.ok) continue;
      expect(result.issues.map((i) => i.path), `${name} by ${other}: the refusal names /writer`).toContain('/writer');
    }
  });
});

describe('AC1 the same writers through the Rust types (deep-contracts check)', () => {
  it.each(NARROWED.map((k) => [k.name, k.writer] as const))('AC1 %s: Rust takes writer %s and refuses every other form', (name, writer) => {
    const others = othersThan(writer);
    const out = rustCheck(name, [firstWith(name, writer), ...others.map((other) => firstWith(name, other))]);
    expect(out[0], `${name} by ${writer}: Rust should take it`).toBe('ok');
    // Rust types generated from a schema that wasn't narrowed (or not regenerated after it was) take these.
    const accepted = others.filter((_, i) => !out[i + 1]!.startsWith('refused'));
    expect(accepted, `${name}: writers the Rust types should refuse but take`).toEqual([]);
  });
});

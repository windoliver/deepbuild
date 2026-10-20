import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { generateRust, generateTypeScript, listSchemas } from '../../../packages/contracts/src/index.ts';
import type { Schema, SchemaEntry } from '../../../packages/contracts/src/index.ts';
import { clone, isObject, REPO } from './helpers.ts';

const GENERATED_TS = join(REPO, 'packages', 'contracts', 'src', 'generated', 'types.ts');
const GENERATED_RS = join(REPO, 'crates', 'deep-contracts', 'src', 'generated.rs');

/** The schemas with one planted optional property added to the first object schema with listed properties. */
function withPlantedField(entries: SchemaEntry[]): { entries: SchemaEntry[]; schema: string } {
  const copy = clone(entries);
  for (const entry of copy) {
    const props = entry.schema.properties;
    if (entry.schema.type === 'object' && isObject(props)) {
      props.planted_field_311 = { type: 'string' };
      return { entries: copy, schema: entry.name };
    }
  }
  throw Error('no object schema with listed properties');
}

describe('AC3 types are generated from the schemas, never written by hand', () => {
  it('AC3 the committed TypeScript types are exactly what the generator writes from the published schemas', () => {
    expect(readFileSync(GENERATED_TS, 'utf8')).toBe(generateTypeScript(listSchemas()));
  });

  it('AC3 the committed Rust types are exactly what the generator writes from the same schemas', () => {
    expect(readFileSync(GENERATED_RS, 'utf8')).toBe(generateRust(listSchemas()));
  });

  it('AC3 the generators read the schemas: a planted field shows up in both outputs, and nowhere before', () => {
    const { entries, schema } = withPlantedField(listSchemas());
    expect(generateTypeScript(listSchemas())).not.toContain('planted_field_311');
    expect(generateRust(listSchemas())).not.toContain('planted_field_311');
    expect(generateTypeScript(entries), `planted in ${schema}`).toContain('planted_field_311');
    expect(generateRust(entries), `planted in ${schema}`).toContain('planted_field_311');
  });

  it('AC3 the hook request type the package exports carries every field of its schema', () => {
    const schema = listSchemas().find((e) => e.name === 'hook.request@1')?.schema as Schema;
    const source = readFileSync(GENERATED_TS, 'utf8');
    const fields = Object.keys(isObject(schema.properties) ? schema.properties : {});
    expect(fields).toEqual(expect.arrayContaining(['v', 'agent', 'event', 'seq', 'id', 'pid', 'ppid', 'matched', 'payload']));
    for (const field of fields) {
      expect(source, `hook.request@1's ${field}`).toMatch(new RegExp(`\\b${field}\\??:`));
    }
  });
});

describe('AC12 the generated types add nothing at runtime', () => {
  it('AC12 the generated TypeScript module compiles to no JavaScript statements', () => {
    const js = ts.transpileModule(readFileSync(GENERATED_TS, 'utf8'), {
      compilerOptions: { removeComments: true, module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2023 },
    }).outputText.trim();
    expect(['', 'export {};']).toContain(js);
  });
});

// deep_drive's schema is in the tool list every session loads, and the strict subset takes no $ref, so a locator is
// written out at each place one goes: its fields are described once, at the call's own locator.
import { describe, expect, it } from 'vitest';
import { toolList } from '../src/tools.js';

interface Schema { properties?: Record<string, Schema>; items?: Schema; description?: string }
/** Every locator under a schema, by its path: an object that takes a role, a handle and a label. */
function locators(schema: Schema, path = ''): [string, Schema][] {
  const fields = schema.properties ?? {};
  if ('role' in fields && 'handle' in fields && 'label' in fields) return [[path, schema]];
  return [...Object.entries(fields).flatMap(([name, field]) => locators(field, `${path}/${name}`)), ...(schema.items ? locators(schema.items, path) : [])];
}

describe('deep_drive\'s schema', () => {
  it('describes a locator\'s fields at the call\'s own locator, and lists the same fields bare wherever else one goes', () => {
    const [[first, described], ...rest] = locators(toolList().find((tool) => tool.name === 'deep_drive')!.inputSchema as Schema) as [[string, Schema], ...[string, Schema][]];
    expect([first, ...rest.map(([path]) => path)]).toEqual(['/locator', '/act/to', '/screenshot/highlight', '/screenshot/mask', '/record/mask']);
    expect(Object.values(described.properties!).filter((field) => !field.description)).toEqual([]);
    for (const [path, locator] of rest) {
      expect(Object.keys(locator.properties!), path).toEqual(Object.keys(described.properties!));
      expect(Object.values(locator.properties!).filter((field) => field.description), path).toEqual([]);
    }
  });
});

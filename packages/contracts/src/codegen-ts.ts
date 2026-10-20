import { isObject, type Schema, type SchemaEntry } from './json.js';

const words = (text: string): string[] => text.split(/[^A-Za-z0-9]+/).filter(Boolean);
const pascal = (text: string): string => words(text).map((w) => w[0]!.toUpperCase() + w.slice(1)).join('');

/** A schema name's type name: `hook.request@1` is HookRequest, and a version past 1 is suffixed (`…V2`). */
export function typeName(name: string): string {
  const [base = '', version = '1'] = name.split('@');
  return pascal(base) + (version === '1' ? '' : `V${pascal(version)}`);
}

const key = (k: string): string => (/^[A-Za-z_$][\w$]*$/.test(k) ? k : JSON.stringify(k));

function tsType(schema: Schema, root: string, indent: string): string {
  if (typeof schema.$ref === 'string') return root + pascal(schema.$ref.slice('#/$defs/'.length));
  if ('x-opaque' in schema) return 'unknown';
  if ('const' in schema) return JSON.stringify(schema.const);
  if (Array.isArray(schema.oneOf)) return (schema.oneOf as Schema[]).map((b) => tsType(b, root, indent)).join(' | ');
  if (Array.isArray(schema.type)) return `${tsType({ ...schema, type: schema.type.find((t) => t !== 'null')! }, root, indent)} | null`;
  switch (schema.type) {
    case 'string':
      if (Array.isArray(schema.enum)) return schema.enum.map((v) => JSON.stringify(v)).join(' | ');
      return schema.format === 'seq' ? 'bigint' : 'string';
    case 'integer':
    case 'number':
      return 'number';
    case 'boolean':
      return 'boolean';
    case 'array':
      return `Array<${tsType(schema.items as Schema, root, indent)}>`;
    case 'object': {
      if (!isObject(schema.properties)) return `{ [key: string]: ${tsType(schema.additionalProperties as Schema, root, indent)} }`;
      const required = new Set((schema.required ?? []) as string[]);
      const inner = `${indent}  `;
      const fields = Object.entries(schema.properties)
        .map(([k, s]) => `${inner}${key(k)}${required.has(k) ? '' : '?'}: ${tsType(s as Schema, root, inner)};\n`);
      return `{\n${fields.join('')}${indent}}`;
    }
    default:
      throw Error(`no TypeScript type for ${JSON.stringify(schema)}`);
  }
}

/** The TypeScript types of the given schemas, type-only, one export per schema and per definition. */
export function generateTypeScript(entries: readonly SchemaEntry[]): string {
  const out = ['// Generated from packages/contracts/schemas by generateTypeScript. Do not edit.\n'];
  for (const { name, schema } of entries) {
    const root = typeName(name);
    const defs = isObject(schema.$defs) ? schema.$defs : {};
    for (const [def, s] of Object.entries(defs)) out.push(`\nexport type ${root}${pascal(def)} = ${tsType(s as Schema, root, '')};\n`);
    const body = tsType(schema, root, '');
    const record = schema.type === 'object' && isObject(schema.properties);
    out.push(record ? `\n/** ${name} */\nexport interface ${root} ${body}\n` : `\n/** ${name} */\nexport type ${root} = ${body};\n`);
  }
  return out.join('');
}

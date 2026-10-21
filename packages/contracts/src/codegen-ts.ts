import { isObject, type Schema, type SchemaEntry } from './json.js';

const words = (text: string): string[] => text.split(/[^A-Za-z0-9]+/).filter(Boolean);
const pascal = (text: string): string => words(text).map((w) => w[0]!.toUpperCase() + w.slice(1)).join('');

/** A schema name's type name: `hook.request@1` is HookRequest, and a version past 1 is suffixed (`…V2`, `…V1_1`). */
export function typeName(name: string): string {
  const [base = '', version = '1'] = name.split('@');
  return pascal(base) + (version === '1' ? '' : `V${words(version).join('_')}`);
}

/** Names the generated TypeScript or Rust already uses: the types and traits it reaches by bare name. */
export const RESERVED_TYPES = new Set(['Self', 'Array', 'Value', 'Contract', 'String', 'Vec', 'Option', 'Result', 'Seq', 'Box', 'Some', 'None', 'Ok', 'Err']);

/** Records which schema each generated type name came from, refusing a name two schemas would share. */
export function nameClaims(): (type: string, schema: string) => void {
  const owners = new Map<string, string>();
  return (type, schema) => {
    if (!/^[A-Z][A-Za-z0-9_]*$/.test(type) || RESERVED_TYPES.has(type)) throw Error(`${schema}: its type name ${JSON.stringify(type)} is not an identifier the generated code can take; rename the schema`);
    const owner = owners.get(type);
    if (owner !== undefined) throw Error(`${schema}: its type ${type} is already ${owner}'s; rename one of them`);
    owners.set(type, schema);
  };
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
    case 'null':
      return 'null';
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
  const claim = nameClaims();
  for (const { name, schema } of entries) {
    const root = typeName(name);
    const defs = isObject(schema.$defs) ? schema.$defs : {};
    claim(root, name);
    for (const def of Object.keys(defs)) claim(root + pascal(def), name);
    for (const [def, s] of Object.entries(defs)) out.push(`\nexport type ${root}${pascal(def)} = ${tsType(s as Schema, root, '')};\n`);
    const body = tsType(schema, root, '');
    const record = schema.type === 'object' && isObject(schema.properties);
    const doc = name.replace(/\*\//g, '*\\/');
    out.push(record ? `\n/** ${doc} */\nexport interface ${root} ${body}\n` : `\n/** ${doc} */\nexport type ${root} = ${body};\n`);
  }
  return out.join('');
}

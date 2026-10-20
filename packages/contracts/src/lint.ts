import { isObject, segment, type JsonValue, type Schema, type SchemaEntry } from './json.js';
import { FORMATS } from './validate.js';

export interface LintProblem { schema: string; path: string; reason: string }

const ANNOTATIONS = ['title', 'description', 'examples', '$comment'];
const ROOT_ONLY = ['$defs', 'x-hash', 'x-feeds'];
/** The keywords each closed node type may use besides its annotations. */
const NODE_KEYWORDS: Record<string, string[]> = {
  string: ['type', 'pattern', 'minLength', 'maxLength', 'enum', 'format'],
  integer: ['type', 'minimum', 'maximum'],
  number: ['type', 'minimum', 'maximum'],
  boolean: ['type'],
  array: ['type', 'items', 'minItems', 'maxItems'],
  record: ['type', 'properties', 'required', 'additionalProperties'],
  map: ['type', 'propertyNames', 'additionalProperties'],
};
const NUMBER_KEYWORDS = ['minLength', 'maxLength', 'minimum', 'maximum', 'minItems', 'maxItems'];
const MAX_SAFE = Number.MAX_SAFE_INTEGER;

/**
 * The preflight's lint: every contract schema uses only the closed node types both generators map, and a
 * hashed schema (one with `x-hash`) types no integer that can pass 2^53 as a JSON number.
 */
export function lintSchemas(entries: readonly SchemaEntry[]): LintProblem[] {
  const problems: LintProblem[] = [];
  for (const { name, schema } of entries) {
    const flag = (path: string, reason: string): void => { problems.push({ schema: name, path, reason }); };
    const hashed = 'x-hash' in schema;
    const defs = isObject(schema.$defs) ? schema.$defs : {};

    const node = (value: JsonValue | undefined, path: string, root = false): void => {
      if (!isObject(value)) return flag(path, 'a schema here must be an object');
      const allowed = (keys: string[]) => {
        for (const key of Object.keys(value)) {
          if (ANNOTATIONS.includes(key) || keys.includes(key) || (root && ROOT_ONLY.includes(key))) continue;
          flag(path + segment(key), `keyword ${key} is not part of the closed node types`);
        }
        for (const key of NUMBER_KEYWORDS) if (key in value && typeof value[key] !== 'number') flag(path + segment(key), `${key} must be a number`);
      };
      if (typeof value.$ref === 'string') {
        allowed(['$ref']);
        if (!/^#\/\$defs\/[^/]+$/.test(value.$ref) || !isObject(defs[value.$ref.slice('#/$defs/'.length)])) flag(path + '/$ref', `${value.$ref} names no definition in $defs`);
        return;
      }
      if ('x-opaque' in value) {
        allowed(['x-opaque']);
        if (typeof value['x-opaque'] !== 'string') flag(path + '/x-opaque', 'an opaque value says why it is opaque');
        return;
      }
      if ('const' in value) return allowed(['const']);
      if ('oneOf' in value) return union(value.oneOf, path, allowed);
      let type = value.type;
      if (Array.isArray(type)) {
        if (type.length !== 2 || !type.includes('null') || type[0] === type[1]) return flag(path + '/type', 'a type list is one type beside null');
        type = type.find((t) => t !== 'null')!;
      }
      if (typeof type !== 'string') return flag(path, 'no closed node type: give type, const, oneOf or $ref');
      if (type === 'object') return object(value, path, allowed);
      const keywords = NODE_KEYWORDS[type];
      if (!keywords) return flag(path + '/type', `type ${type} is not a closed node type`);
      allowed(keywords);
      if (type === 'string') {
        if ('pattern' in value && typeof value.pattern !== 'string') flag(path + '/pattern', 'a pattern is a string');
        if ('enum' in value && !(Array.isArray(value.enum) && value.enum.length && value.enum.every((v) => typeof v === 'string'))) flag(path + '/enum', 'an enum lists strings');
        if ('format' in value && !(typeof value.format === 'string' && value.format in FORMATS)) flag(path + '/format', `format ${JSON.stringify(value.format)} is not a listed format`);
      }
      if (type === 'array') node(value.items, path + '/items');
      if (hashed && (type === 'integer' || type === 'number') && !(typeof value.maximum === 'number' && value.maximum <= MAX_SAFE)) {
        flag(path, 'a hashed integer that can pass 2^53 is a decimal string, or gives a maximum at most 2^53 - 1');
      }
    };

    const object = (value: Schema, path: string, allowed: (keys: string[]) => void): void => {
      if (isObject(value.properties)) {
        allowed(NODE_KEYWORDS.record!);
        if (value.additionalProperties !== false) flag(path + ('additionalProperties' in value ? '/additionalProperties' : ''), 'an object lists its properties and allows no others');
        const required = Array.isArray(value.required) ? value.required : [];
        if ('required' in value && !Array.isArray(value.required)) flag(path + '/required', 'required is a list');
        for (const key of required) if (typeof key !== 'string' || !(key in value.properties)) flag(path + '/required', `required names ${JSON.stringify(key)}, which is not a listed property`);
        for (const [key, child] of Object.entries(value.properties)) node(child, path + '/properties' + segment(key));
      } else if (isObject(value.propertyNames) && isObject(value.additionalProperties)) {
        allowed(NODE_KEYWORDS.map!);
        const names = value.propertyNames;
        if (Object.keys(names).some((k) => k !== 'pattern') || typeof names.pattern !== 'string') flag(path + '/propertyNames', "a map's keys take only a pattern");
        node(value.additionalProperties, path + '/additionalProperties');
      } else {
        allowed([...NODE_KEYWORDS.record!, 'propertyNames']);
        flag(path + (value.additionalProperties === true ? '/additionalProperties' : ''), 'an open object: list its properties with additionalProperties false, or make it a map with propertyNames');
      }
    };

    const union = (branches: JsonValue | undefined, path: string, allowed: (keys: string[]) => void): void => {
      allowed(['oneOf']);
      if (!Array.isArray(branches) || branches.length < 2) return flag(path + '/oneOf', 'a union has two or more branches');
      branches.forEach((branch, i) => node(branch, `${path}/oneOf/${i}`));
      const tagged = (b: JsonValue, key: string) => isObject(b) && isObject(b.properties) && isObject(b.properties[key]) && 'const' in b.properties[key]
        && Array.isArray(b.required) && b.required.includes(key);
      const first = branches[0];
      const tags = isObject(first) && isObject(first.properties) ? Object.keys(first.properties).filter((key) => branches.every((b) => tagged(b, key))) : [];
      if (tags.length !== 1) flag(path + '/oneOf', 'a union is told apart by exactly one required constant field');
    };

    node(schema, '', true);
    for (const [key, def] of Object.entries(defs)) node(def, '/$defs' + segment(key));
    if ('x-feeds' in schema && !(Array.isArray(schema['x-feeds']) && schema['x-feeds'].every((f) => typeof f === 'string'))) flag('/x-feeds', 'x-feeds lists projection names');
    const marker = schema['x-hash'];
    if ('x-hash' in schema && !(isObject(marker) && Array.isArray(marker.excludes) && marker.excludes.every((p) => typeof p === 'string' && p.startsWith('/')))) {
      flag('/x-hash', 'x-hash lists the JSON Pointers its hash leaves out, as excludes');
    }
  }
  return problems;
}

// Pure action and store schema rules, kept apart from load and call lifetimes.
import { isPlain, texts } from './host-shared.js';

/** An action's schemas, checked input, and the store kinds it changes or reads (#363). */
export interface Action {
  check: (input: unknown) => { ok: true } | { ok: false; path: string; code: string };
  declares: 'read' | 'change' | 'send';
  input: Record<string, unknown>;
  output: Record<string, unknown> | undefined;
  changes: string[];
  reads: string[];
  /** Why agents aren't offered it, or null. */
  leftOut: string | null;
}
const count = (v: unknown): boolean => Number.isSafeInteger(v) && (v as number) >= 0;
/** The keywords the validator checks or that annotate only, each with the value it reads. */
const CHECKED: Record<string, (v: unknown) => boolean> = {
  type: (v) => typeof v === 'string' || texts(v), properties: isPlain, required: texts, additionalProperties: (v) => typeof v === 'boolean' || isPlain(v),
  propertyNames: isPlain, items: isPlain, minItems: count, maxItems: count, minLength: count, maxLength: count,
  minimum: (v) => typeof v === 'number' && Number.isFinite(v), maximum: (v) => typeof v === 'number' && Number.isFinite(v),
  enum: texts, pattern: (v) => typeof v === 'string', format: (v) => typeof v === 'string', const: () => true, oneOf: Array.isArray,
  $ref: (v) => typeof v === 'string', $defs: isPlain, title: (v) => typeof v === 'string', description: (v) => typeof v === 'string',
};
/** What the validator reads beside $ref, oneOf or const: nothing but these. */
const ALONE = new Set(['$ref', 'oneOf', 'const', '$defs', 'title', 'description']);
/** The first rule in an action's input schema the host can't check. */
export function unchecked(schema: unknown, at = ''): string | undefined {
  const here = at || '/';
  if (!isPlain(schema)) return `${here} isn't a schema`;
  const s = schema;
  for (const [key, value] of Object.entries(s)) {
    if (!Object.hasOwn(CHECKED, key)) return `${here} uses ${key}`;
    if (!CHECKED[key]!(value)) return `${here} gives ${key} a value it can't use`;
  }
  if (['$ref', 'oneOf', 'const'].some((k) => k in s)) {
    const beside = Object.keys(s).find((k) => !ALONE.has(k));
    if (beside) return `${here} uses ${beside} beside $ref, oneOf or const, which is never read`;
  }
  if ('enum' in s && s.type !== 'string') return `${here} uses enum on a value that isn't text`;
  // A map is propertyNames' pattern with additionalProperties as each value's schema, and nothing else of an object.
  if ('propertyNames' in s) {
    const names = s.propertyNames as Record<string, unknown>;
    if ('properties' in s || 'required' in s) return `${here} uses properties or required on a map, which is never read`;
    if (typeof names.pattern !== 'string' || Object.keys(names).some((k) => k !== 'pattern' && !(k === 'type' && names.type === 'string'))) return `${here}/propertyNames uses more than a pattern`;
    if (!isPlain(s.additionalProperties)) return `${here} is a map without a schema for its values`;
  } else if (isPlain(s.additionalProperties)) {
    return `${here} uses additionalProperties as a schema without propertyNames`;
  }
  for (const [path, child] of inner(s, at)) {
    const found = unchecked(child, path);
    if (found) return found;
  }
  return undefined;
}
/** A failing input path, cut at the first key the input chose rather than its schema. */
export function declaredPath(schema: unknown, path: string): string {
  let node = schema as Record<string, unknown> | undefined;
  let kept = '';
  for (const raw of path.split('/').slice(1)) {
    const key = raw.replace(/~1/g, '/').replace(/~0/g, '~');
    const properties = node?.properties as Record<string, unknown> | undefined;
    if (properties && Object.hasOwn(properties, key)) node = properties[key] as Record<string, unknown>;
    else if (node?.items !== undefined && /^\d+$/.test(key)) node = node.items as Record<string, unknown>;
    else return `${kept}/*`;
    kept += `/${raw}`;
  }
  return kept;
}
const REJECTED: Record<string, string> = {
  minimum: 'a range', maximum: 'a range', minLength: 'a length', maxLength: 'a length', minItems: 'a length', maxItems: 'a length', oneOf: 'a union',
};
/** The schemas a schema holds, each with its path. */
function inner(s: Record<string, unknown>, at: string): [string, unknown][] {
  return [
    ...Object.entries((s.properties ?? {}) as Record<string, unknown>).map(([k, v]): [string, unknown] => [`${at}/properties/${k}`, v]),
    ...Object.entries((s.$defs ?? {}) as Record<string, unknown>).map(([k, v]): [string, unknown] => [`${at}/$defs/${k}`, v]),
    ...(Array.isArray(s.oneOf) ? s.oneOf.map((v, i): [string, unknown] => [`${at}/oneOf/${i}`, v]) : []),
    ...(s.items !== undefined ? [[`${at}/items`, s.items] as [string, unknown]] : []),
    ...(isPlain(s.additionalProperties) ? [[`${at}/additionalProperties`, s.additionalProperties] as [string, unknown]] : []),
  ];
}
export function rejected(schema: unknown, at = ''): string | null {
  if (!isPlain(schema)) return null;
  const keyword = Object.keys(schema).find((k) => Object.hasOwn(REJECTED, k));
  if (keyword) return `its input schema uses ${keyword} at ${at || '/'}, ${REJECTED[keyword]}, which one model API's strict tool schemas reject`;
  for (const [path, child] of inner(schema, at)) {
    const found = rejected(child, path);
    if (found) return found;
  }
  return null;
}
/** A field's scalar type, an integer counted as a number and null left out. */
function scalar(schema: unknown): string | undefined {
  const type = isPlain(schema) ? schema.type : undefined;
  const types = (Array.isArray(type) ? type : [type]).filter((t) => t !== 'null');
  return types.length === 1 && ['string', 'number', 'integer', 'boolean'].includes(types[0] as string) ? (types[0] === 'integer' ? 'number' : types[0] as string) : undefined;
}
function fields(schema: unknown, visit: (name: string, schema: unknown) => void): void {
  if (!isPlain(schema)) return;
  for (const [name, child] of Object.entries((schema.properties ?? {}) as Record<string, unknown>)) visit(name, child);
  for (const [, child] of inner(schema, '')) fields(child, visit);
}
/** Store readability, consistent field types, and meaningful outputs are checked at install. */
export function actionRules(actions: Map<string, Action>): string[] {
  const reasons: string[] = [];
  const readable = new Set([...actions.values()].flatMap((a) => (a.declares === 'read' ? a.reads : [])));
  for (const [name, a] of actions) {
    for (const kind of a.changes) if (!readable.has(kind)) reasons.push(`${name} changes ${kind}, which no action or reading lets an agent read; a change action's store kinds each need a read action that declares it reads them`);
  }
  const typed = new Map<string, { type: string; where: string }>();
  const clashes = new Set<string>();
  for (const [name, a] of actions) {
    for (const [side, schema] of [['input', a.input], ['output', a.output]] as const) {
      fields(schema, (field, child) => {
        const type = scalar(child);
        const seen = typed.get(field);
        if (type === undefined) return;
        if (!seen) typed.set(field, { type, where: `${name}'s ${side}` });
        else if (seen.type !== type && !clashes.has(field)) {
          clashes.add(field);
          reasons.push(`the field ${field} has two types across the piece's schemas, ${seen.type} in ${seen.where} and ${type} in ${name}'s ${side}; one field name has one type`);
        }
      });
    }
  }
  for (const [name, a] of actions) {
    const props = Object.entries((a.output?.properties ?? {}) as Record<string, unknown>).map(([field, child]) => ({ field, type: scalar(child) }));
    const flags = props.filter((p) => p.type === 'boolean').length;
    const words = props.filter((p) => p.type === 'string');
    const only = props.length > 0 && flags + words.length === props.length && flags <= 1 && words.length <= 1;
    if (only && (flags === 1 || /^(message|status)$/.test(words[0]!.field))) {
      reasons.push(`${name}'s output is only a success flag or a status message; return what it did, and raise an error when it fails`);
    }
  }
  return reasons;
}

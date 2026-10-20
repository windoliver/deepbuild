import { canonicalText } from './canonical.js';
import { nameClaims, RESERVED_TYPES, typeName } from './codegen-ts.js';
import { isObject, resolveRef, segment, unionTag, type Schema, type SchemaEntry } from './json.js';
import { compilePattern } from './pattern.js';

const KEYWORDS = new Set(['as', 'break', 'const', 'continue', 'crate', 'else', 'enum', 'extern', 'false', 'fn', 'for', 'if', 'impl', 'in',
  'let', 'loop', 'match', 'mod', 'move', 'mut', 'pub', 'ref', 'return', 'self', 'static', 'struct', 'super', 'trait', 'true', 'type',
  'unsafe', 'use', 'where', 'while', 'async', 'await', 'dyn', 'abstract', 'become', 'box', 'do', 'final', 'macro', 'override', 'priv',
  'typeof', 'unsized', 'virtual', 'yield', 'try']);

const pascal = (text: string): string => text.split(/[^A-Za-z0-9]+/).filter(Boolean)
  .map((w) => w[0]!.toUpperCase() + (w === w.toUpperCase() ? w.slice(1).toLowerCase() : w.slice(1))).join('') || 'Empty';
/** Names no raw identifier can take, so they get a trailing underscore instead. */
const NOT_RAW = new Set(['self', 'Self', 'super', 'crate', '_']);
const field = (key: string): string => {
  const ident = key.replace(/[^A-Za-z0-9_]/g, '_').replace(/^(?=[0-9])/, '_') || '_';
  return NOT_RAW.has(ident) ? `${ident}_` : KEYWORDS.has(ident) ? `r#${ident}` : ident;
};
/** One enum variant per value, each a valid identifier, numbered where two values read alike. */
const variants = (values: string[]): string[] => {
  const used = new Set<string>();
  return values.map((value) => {
    let base = pascal(value).replace(/^(?=[0-9])/, 'V');
    if (base === 'Self') base = 'Self_';
    let variant = base;
    for (let i = 2; used.has(variant); i++) variant = `${base}${i}`;
    used.add(variant);
    return variant;
  });
};
/** A Rust string literal for any text. */
const literal = (text: string): string => `"${[...text].map((c) => {
  if (c === '"' || c === '\\') return `\\${c}`;
  const code = c.codePointAt(0)!;
  return code < 0x20 || code > 0x7e ? `\\u{${code.toString(16)}}` : c;
}).join('')}"`;

/** A Rust f64 literal for a schema bound. */
const float = (n: number): string => {
  const text = String(n).replace('e+', 'e');
  return /[.e]/.test(text) ? text : `${text}.0`;
};
const bound = (schema: Schema, key: string, write: (n: number) => string): string =>
  (typeof schema[key] === 'number' ? `Some(${write(schema[key])})` : 'None');

/**
 * What every schema's types share: the items written so far, the type names they, or a schema, hold, and
 * the statics written for rules and patterns, by their text.
 */
interface Output { items: string[]; taken: Set<string>; reserved: Set<string>; statics: Map<string, string> }

/** Emits one schema's Rust types and their Contract impls into the shared output. */
class Module {
  /** The schema's own or a definition's type name while it is being emitted, which takes that name exactly. */
  private exact: string | undefined;

  constructor(private readonly root: Schema, private readonly rootName: string, private readonly schemaName: string, private readonly output: Output) {}

  get out(): string[] { return this.output.items; }

  /** The name of a static holding `text`, written once however many fields share it. */
  private shared(prefix: string, type: string, text: string): string {
    const key = `${type} = ${text}`;
    let name = this.output.statics.get(key);
    if (!name) {
      name = `${prefix}_${this.output.statics.size}`;
      this.output.statics.set(key, name);
      this.out.push(`static ${name}: ${type} = ${text};\n`);
    }
    return name;
  }

  private pattern(source: string): string {
    const program = compilePattern(source).map((inst) => {
      switch (inst.op) {
        case 'char': return `deep_contracts::Inst::Char(&[${inst.ranges.map(([lo, hi]) => `(${lo}, ${hi})`).join(', ')}])`;
        case 'split': return `deep_contracts::Inst::Split(${inst.x}, ${inst.y})`;
        case 'jmp': return `deep_contracts::Inst::Jmp(${inst.to})`;
        case 'match': return 'deep_contracts::Inst::Match';
      }
    });
    return this.shared('PATTERN', '&[deep_contracts::Inst]', `&[\n    ${program.join(',\n    ')},\n]`);
  }

  /**
   * The static rule for what a schema node says of its value beyond its type, or undefined when it says
   * nothing more or its type checks itself: a record, a union, an enum's or a constant's.
   */
  rule(schema: Schema): string | undefined {
    if (typeof schema.$ref === 'string') return this.rule(resolveRef(this.root, schema.$ref));
    if ('x-opaque' in schema || 'const' in schema || Array.isArray(schema.oneOf)) return undefined;
    if (Array.isArray(schema.type)) {
      const inner = this.rule({ ...schema, type: schema.type.find((t) => t !== 'null')! });
      return inner && this.shared('RULE', 'deep_contracts::Rule', `deep_contracts::Rule::Nullable(&${inner})`);
    }
    const count = (n: number) => String(n);
    let text: string | undefined;
    switch (schema.type) {
      case 'string': {
        const format = schema.format === 'ulid' ? 'Some(deep_contracts::Format::Ulid)' : 'None';
        const pattern = typeof schema.pattern === 'string' ? `Some(${this.pattern(schema.pattern)})` : 'None';
        if (format !== 'None' || pattern !== 'None' || 'minLength' in schema || 'maxLength' in schema) {
          text = `deep_contracts::Rule::String { min: ${bound(schema, 'minLength', count)}, max: ${bound(schema, 'maxLength', count)}, format: ${format}, pattern: ${pattern} }`;
        }
        break;
      }
      case 'integer':
      case 'number':
        if ('minimum' in schema || 'maximum' in schema) text = `deep_contracts::Rule::Number { min: ${bound(schema, 'minimum', float)}, max: ${bound(schema, 'maximum', float)} }`;
        break;
      case 'array': {
        const items = this.rule(schema.items as Schema);
        if (items || 'minItems' in schema || 'maxItems' in schema) {
          text = `deep_contracts::Rule::Array { min: ${bound(schema, 'minItems', count)}, max: ${bound(schema, 'maxItems', count)}, items: ${items ? `Some(&${items})` : 'None'} }`;
        }
        break;
      }
      case 'object':
        if (!isObject(schema.properties)) {
          const values = this.rule(schema.additionalProperties as Schema);
          text = `deep_contracts::Rule::Map { keys: ${this.pattern(String((schema.propertyNames as Schema).pattern))}, values: ${values ? `Some(&${values})` : 'None'} }`;
        }
        break;
    }
    return text && this.shared('RULE', 'deep_contracts::Rule', text);
  }
  private claim(name: string): string {
    const { taken, reserved } = this.output;
    if (name === this.exact) {
      this.exact = undefined;
      taken.add(name);
      return name;
    }
    let unique = name;
    for (let i = 2; taken.has(unique) || reserved.has(unique) || RESERVED_TYPES.has(unique); i++) unique = `${name}${i}`;
    taken.add(unique);
    return unique;
  }

  /** The Rust type for a schema node, emitting any named type it needs under `name`. */
  type(schema: Schema, name: string): string {
    if (typeof schema.$ref === 'string') return this.rootName + pascal(schema.$ref.slice('#/$defs/'.length));
    if ('x-opaque' in schema) return 'deep_contracts::Value';
    if ('const' in schema) return this.constant(canonicalText(schema.const!), name);
    if (Array.isArray(schema.oneOf)) return this.union(schema.oneOf as Schema[], name);
    if (Array.isArray(schema.type)) return `Option<${this.type({ ...schema, type: schema.type.find((t) => t !== 'null')! }, name)}>`;
    switch (schema.type) {
      case 'string':
        if (Array.isArray(schema.enum)) return this.enumeration(schema.enum.map(String), name);
        return schema.format === 'seq' ? 'deep_contracts::Seq' : 'String';
      case 'integer':
        return 'i64';
      case 'number':
        return 'f64';
      case 'boolean':
        return 'bool';
      case 'array':
        return `Vec<${this.type(schema.items as Schema, `${name}Item`)}>`;
      case 'object':
        if (!isObject(schema.properties)) return `std::collections::BTreeMap<String, ${this.type(schema.additionalProperties as Schema, `${name}Value`)}>`;
        return this.record(schema, name);
      default:
        throw Error(`no Rust type for ${JSON.stringify(schema)}`);
    }
  }

  private constant(text: string, wanted: string): string {
    const name = this.claim(wanted);
    this.out.push(`#[derive(Debug, Clone, PartialEq)]
pub struct ${name};

impl Contract for ${name} {
    fn from_json(value: &Value, at: &str) -> Result<Self, String> {
        deep_contracts::constant(value, at, ${literal(text)}).map(|()| Self)
    }
    fn to_json(&self) -> Value {
        deep_contracts::parse(${literal(text)}).expect("a constant is JSON")
    }
}
`);
    return name;
  }

  private enumeration(values: string[], wanted: string): string {
    const name = this.claim(wanted);
    const names = variants(values);
    const arms = values.map((value, i) => ({ value, variant: names[i]! }));
    this.out.push(`#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ${name} {
${arms.map((v) => `    ${v.variant},\n`).join('')}}

impl Contract for ${name} {
    fn from_json(value: &Value, at: &str) -> Result<Self, String> {
        match deep_contracts::string(value, at)? {
${arms.map((v) => `            ${literal(v.value)} => Ok(Self::${v.variant}),\n`).join('')}            other => Err(format!("{at}: {other:?} is not one of the listed values")),
        }
    }
    fn to_json(&self) -> Value {
        Value::String(match self {
${arms.map((v) => `            Self::${v.variant} => ${literal(v.value)},\n`).join('')}        }.to_string())
    }
}
`);
    return name;
  }

  private union(branches: Schema[], wanted: string): string {
    const name = this.claim(wanted);
    const tag = unionTag(branches);
    const consts = branches.map((branch) => ((branch.properties as Schema)[tag] as Schema).const!);
    const names = variants(consts.map(String));
    const arms = branches.map((branch, i) => ({
      text: canonicalText(consts[i]!), variant: names[i]!, type: this.type(branch, `${name}${names[i]}`),
    }));
    this.out.push(`#[derive(Debug, Clone, PartialEq)]
pub enum ${name} {
${arms.map((a) => `    ${a.variant}(${a.type}),\n`).join('')}}

impl Contract for ${name} {
    fn from_json(value: &Value, at: &str) -> Result<Self, String> {
        match deep_contracts::tag(value, at, ${literal(tag)})?.as_str() {
${arms.map((a) => `            ${literal(a.text)} => Ok(Self::${a.variant}(<${a.type} as Contract>::from_json(value, at)?)),\n`).join('')}            other => Err(format!("{at}{}: {other} is not a listed tag", ${literal(segment(tag))})),
        }
    }
    fn to_json(&self) -> Value {
        match self {
${arms.map((a) => `            Self::${a.variant}(inner) => inner.to_json(),\n`).join('')}        }
    }
}
`);
    return name;
  }

  private record(schema: Schema, wanted: string): string {
    const name = this.claim(wanted);
    const required = new Set((schema.required ?? []) as string[]);
    const idents = new Map<string, string>();
    const fields = Object.entries(schema.properties as Schema).map(([key, s]) => {
      const ident = field(key);
      const other = idents.get(ident);
      if (other !== undefined) throw Error(`${this.schemaName}: properties ${other} and ${key} would both be the Rust field ${ident}`);
      idents.set(ident, key);
      const inner = this.type(s as Schema, name + pascal(key));
      return { key, ident, required: required.has(key), type: required.has(key) ? inner : `Option<${inner}>`, rule: this.rule(s as Schema) };
    });
    const keys = fields.map((f) => literal(f.key)).join(', ');
    this.out.push(`#[derive(Debug, Clone, PartialEq)]
pub struct ${name} {
${fields.map((f) => `    pub ${f.ident}: ${f.type},\n`).join('')}}

impl Contract for ${name} {
    fn from_json(value: &Value, at: &str) -> Result<Self, String> {
        let members = deep_contracts::members(value, at, &[${keys}])?;
${fields.flatMap((f) => (f.rule ? [`        deep_contracts::check_member(members, at, ${literal(f.key)}, &${f.rule})?;\n`] : [])).join('')}        Ok(Self {
${fields.map((f) => `            ${f.ident}: deep_contracts::${f.required ? 'required' : 'optional'}(members, at, ${literal(f.key)})?,\n`).join('')}        })
    }
    fn to_json(&self) -> Value {
        let mut members = Vec::new();
${fields.map((f) => (f.required
    ? `        members.push((${literal(f.key)}.to_string(), self.${f.ident}.to_json()));\n`
    : `        if let Some(value) = &self.${f.ident} {\n            members.push((${literal(f.key)}.to_string(), value.to_json()));\n        }\n`)).join('')}        Value::Object(members)
    }
}
`);
    return name;
  }

  /** The schema's own type, its definitions first. */
  emit(): string {
    const defs = isObject(this.root.$defs) ? this.root.$defs : {};
    for (const [def, s] of Object.entries(defs)) this.named(s as Schema, this.rootName + pascal(def));
    return this.named(this.root, this.rootName);
  }

  private named(schema: Schema, name: string): string {
    this.exact = name;
    // A nullable root is an alias of Option over its own type, which takes the name `…Value`.
    const type = Array.isArray(schema.type)
      ? `Option<${this.type({ ...schema, type: schema.type.find((t) => t !== 'null')! }, `${name}Value`)}>`
      : this.type(schema, name);
    if (type !== name) {
      if (this.exact !== name) throw Error(`${this.schemaName}: the type ${name} would be written twice`);
      this.claim(name);
      this.out.push(`pub type ${name} = ${type};\n`);
    }
    return name;
  }
}

/**
 * The Rust types of the given schemas as one module of a crate that depends on `deep-contracts`, reaching
 * it only through `deep_contracts::` paths, with `roundtrip(schema, json)` decoding into a schema's type
 * and returning its RFC 8785 text.
 */
export function generateRust(entries: readonly SchemaEntry[]): string {
  // Each schema's own and definitions' names first, so no nested type takes one and two schemas never share one.
  const output: Output = { items: [], taken: new Set(), reserved: new Set(), statics: new Map() };
  const claim = nameClaims();
  for (const { name, schema } of entries) {
    const names = [typeName(name), ...Object.keys(isObject(schema.$defs) ? schema.$defs : {}).map((def) => typeName(name) + pascal(def))];
    for (const type of names) {
      claim(type, name);
      output.reserved.add(type);
    }
  }
  const arms = entries.map(({ name, schema }) => ({ name, type: new Module(schema, typeName(name), name, output).emit() }));
  return `// Generated from packages/contracts/schemas by generateRust. Do not edit.
use deep_contracts::{Contract, Value};

${output.items.join('\n')}
/// Decodes \`json\` into the generated type for \`schema\` and returns its RFC 8785 text.
pub fn roundtrip(schema: &str, json: &str) -> Result<String, String> {
    let value = deep_contracts::parse(json)?;
    let typed = match schema {
${arms.map((a) => `        ${literal(a.name)} => <${a.type} as Contract>::from_json(&value, "")?.to_json(),\n`).join('')}        _ => return Err(format!("no generated type for {schema}")),
    };
    Ok(deep_contracts::jcs(&typed))
}
`;
}

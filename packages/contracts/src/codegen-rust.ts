import { canonicalText } from './canonical.js';
import { typeName } from './codegen-ts.js';
import { isObject, type Schema, type SchemaEntry } from './json.js';

const KEYWORDS = new Set(['as', 'break', 'const', 'continue', 'crate', 'else', 'enum', 'extern', 'false', 'fn', 'for', 'if', 'impl', 'in',
  'let', 'loop', 'match', 'mod', 'move', 'mut', 'pub', 'ref', 'return', 'self', 'static', 'struct', 'super', 'trait', 'true', 'type',
  'unsafe', 'use', 'where', 'while', 'async', 'await', 'dyn', 'abstract', 'become', 'box', 'do', 'final', 'macro', 'override', 'priv',
  'typeof', 'unsized', 'virtual', 'yield', 'try']);

const pascal = (text: string): string => text.split(/[^A-Za-z0-9]+/).filter(Boolean)
  .map((w) => w[0]!.toUpperCase() + (w === w.toUpperCase() ? w.slice(1).toLowerCase() : w.slice(1))).join('') || 'Empty';
const field = (key: string): string => {
  const ident = key.replace(/[^A-Za-z0-9_]/g, '_').replace(/^(?=[0-9])/, '_') || '_';
  return KEYWORDS.has(ident) ? `r#${ident}` : ident;
};
/** A Rust string literal for any text. */
const literal = (text: string): string => `"${[...text].map((c) => {
  if (c === '"' || c === '\\') return `\\${c}`;
  const code = c.codePointAt(0)!;
  return code < 0x20 || code > 0x7e ? `\\u{${code.toString(16)}}` : c;
}).join('')}"`;

/** Emits one generated Rust module: a type per schema, its Contract impl, and `roundtrip` over them all. */
class Module {
  private readonly items: string[] = [];
  private readonly taken = new Set<string>();

  constructor(private readonly root: Schema, private readonly rootName: string, private readonly shared: Module | undefined = undefined) {}

  get out(): string[] { return this.shared ? this.shared.out : this.items; }
  private claim(name: string): string {
    const names = this.shared ? this.shared.taken : this.taken;
    let unique = name;
    for (let i = 2; names.has(unique); i++) unique = `${name}${i}`;
    names.add(unique);
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
    const used = new Set<string>();
    const variants = values.map((value) => {
      let variant = pascal(value).replace(/^(?=[0-9])/, 'V');
      for (let i = 2; used.has(variant); i++) variant = `${pascal(value)}${i}`;
      used.add(variant);
      return { value, variant };
    });
    this.out.push(`#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ${name} {
${variants.map((v) => `    ${v.variant},\n`).join('')}}

impl Contract for ${name} {
    fn from_json(value: &Value, at: &str) -> Result<Self, String> {
        match deep_contracts::string(value, at)? {
${variants.map((v) => `            ${literal(v.value)} => Ok(Self::${v.variant}),\n`).join('')}            other => Err(format!("{at}: {other:?} is not one of the listed values")),
        }
    }
    fn to_json(&self) -> Value {
        Value::String(match self {
${variants.map((v) => `            Self::${v.variant} => ${literal(v.value)},\n`).join('')}        }.to_string())
    }
}
`);
    return name;
  }

  private union(branches: Schema[], wanted: string): string {
    const name = this.claim(wanted);
    const tag = Object.keys(branches[0]!.properties as Schema)
      .find((key) => branches.every((b) => isObject(b.properties) && isObject(b.properties[key]) && 'const' in b.properties[key]))!;
    const arms = branches.map((branch) => {
      const text = canonicalText(((branch.properties as Schema)[tag] as Schema).const!);
      const variant = pascal(String(((branch.properties as Schema)[tag] as Schema).const));
      return { text, variant, type: this.type(branch, `${name}${variant}`) };
    });
    this.out.push(`#[derive(Debug, Clone, PartialEq)]
pub enum ${name} {
${arms.map((a) => `    ${a.variant}(${a.type}),\n`).join('')}}

impl Contract for ${name} {
    fn from_json(value: &Value, at: &str) -> Result<Self, String> {
        match deep_contracts::tag(value, at, ${literal(tag)})?.as_str() {
${arms.map((a) => `            ${literal(a.text)} => Ok(Self::${a.variant}(<${a.type} as Contract>::from_json(value, at)?)),\n`).join('')}            other => Err(format!("{at}/${tag}: {other} is not a listed tag")),
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
    const fields = Object.entries(schema.properties as Schema).map(([key, s]) => {
      const inner = this.type(s as Schema, name + pascal(key));
      return { key, ident: field(key), required: required.has(key), type: required.has(key) ? inner : `Option<${inner}>` };
    });
    const keys = fields.map((f) => literal(f.key)).join(', ');
    this.out.push(`#[derive(Debug, Clone, PartialEq)]
pub struct ${name} {
${fields.map((f) => `    pub ${f.ident}: ${f.type},\n`).join('')}}

impl Contract for ${name} {
    fn from_json(value: &Value, at: &str) -> Result<Self, String> {
        let members = deep_contracts::members(value, at, &[${keys}])?;
        Ok(Self {
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
    const type = this.type(schema, name);
    if (type !== name) {
      this.claim(name);
      this.out.push(`pub type ${name} = ${type};\n`);
    }
    return name;
  }

  static child(parent: Module, root: Schema, rootName: string): Module { return new Module(root, rootName, parent); }
}

/**
 * The Rust types of the given schemas as one module of a crate that depends on `deep-contracts`, reaching
 * it only through `deep_contracts::` paths, with `roundtrip(schema, json)` decoding into a schema's type
 * and returning its RFC 8785 text.
 */
export function generateRust(entries: readonly SchemaEntry[]): string {
  const top = new Module({}, '');
  const arms = entries.map(({ name, schema }) => ({ name, type: Module.child(top, schema, typeName(name)).emit() }));
  return `// Generated from packages/contracts/schemas by generateRust. Do not edit.
use deep_contracts::{Contract, Value};

${top.out.join('\n')}
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

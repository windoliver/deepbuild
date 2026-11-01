// Generates packages/adapters/src/codex-hooks.generated.ts from Codex's published hook schemas, kept unchanged in
// adapters/codex-schemas (#39). Run it again after copying a new version's schemas there.
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';

const ROOT = new URL('../', import.meta.url);
const DIR = new URL('adapters/codex-schemas/', ROOT);
const NAMES = {
  'session-start': 'SessionStart', 'user-prompt-submit': 'UserPromptSubmit', 'pre-tool-use': 'PreToolUse', 'permission-request': 'PermissionRequest', 'post-tool-use': 'PostToolUse', 'pre-compact': 'PreCompact',
  'post-compact': 'PostCompact', 'subagent-start': 'SubagentStart', 'subagent-stop': 'SubagentStop', stop: 'Stop', interrupt: 'Interrupt', 'session-end': 'SessionEnd',
};
const key = (name) => (/^[A-Za-z_$][\w$]*$/.test(name) ? name : JSON.stringify(name));

function typeOf(node, root, indent) {
  if (node === true || node === undefined || Object.keys(node).length === 0) return 'unknown';
  if (node.$ref) return typeOf(root.definitions[node.$ref.split('/').pop()], root, indent);
  if ('const' in node) return JSON.stringify(node.const);
  if (node.enum) return node.enum.map((v) => JSON.stringify(v)).join(' | ');
  for (const union of ['anyOf', 'oneOf']) if (node[union]) return [...new Set(node[union].map((n) => typeOf(n, root, indent)))].join(' | ');
  if (node.allOf) return node.allOf.map((n) => typeOf(n, root, indent)).join(' & ');
  if (Array.isArray(node.type)) return node.type.map((t) => typeOf({ ...node, type: t }, root, indent)).join(' | ');
  if (node.type === 'string') return 'string';
  if (node.type === 'integer' || node.type === 'number') return 'number';
  if (node.type === 'boolean') return 'boolean';
  if (node.type === 'null') return 'null';
  if (node.type === 'array') return `(${typeOf(node.items ?? true, root, indent)})[]`;
  if (node.type === 'object' || node.properties) {
    const required = new Set(node.required ?? []);
    const fields = Object.entries(node.properties ?? {}).map(([name, inner]) => `${indent}  ${key(name)}${required.has(name) ? '' : '?'}: ${typeOf(inner, root, `${indent}  `)};`);
    if (!fields.length) return 'Record<string, unknown>';
    return `{\n${fields.join('\n')}\n${indent}}`;
  }
  return 'unknown';
}

const lines = [
  '// Generated from Codex\'s published hook schemas, openai/codex rust-v0.160.0, codex-rs/hooks/schema/generated,',
  '// by scripts/codex-hook-types.mjs from the copies in adapters/codex-schemas. Do not edit by hand.',
  '// Copyright OpenAI, Apache License 2.0 (adapters/codex-schemas/NOTICE).',
  '',
];
for (const file of readdirSync(DIR).filter((f) => f.endsWith('.json')).sort()) {
  const [, hook, side] = /^(.+)\.command\.(input|output)\.schema\.json$/.exec(file);
  const schema = JSON.parse(readFileSync(new URL(file, DIR), 'utf8'));
  lines.push(`export type ${NAMES[hook]}${side === 'input' ? 'Input' : 'Output'} = ${typeOf(schema, schema, '')};`);
}
lines.push('');
writeFileSync(new URL('packages/adapters/src/codex-hooks.generated.ts', ROOT), lines.join('\n'));

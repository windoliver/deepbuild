// Writes dist/tools.json, the deep_* tools as `deep mcp` lists them, so the published package carries them and needs
// nothing of the workspace. pi checks a call's arguments before it runs, and the hub reads a nullable field left out
// as null, so only what the hub requires stays required.
import { mkdirSync, writeFileSync } from 'node:fs';
import { toolList } from '../hub/dist/tools.js';

const loose = (schema) => {
  if (Array.isArray(schema)) return schema.map(loose);
  if (typeof schema !== 'object' || schema === null) return schema;
  const out = Object.fromEntries(Object.entries(schema).map(([key, value]) => [key, key === 'required' ? value : loose(value)]));
  if (Array.isArray(schema.required)) out.required = schema.required.filter((name) => ![schema.properties?.[name]?.type].flat().includes('null'));
  return out;
};
mkdirSync(new URL('dist/', import.meta.url), { recursive: true });
writeFileSync(new URL('dist/tools.json', import.meta.url), `${JSON.stringify(toolList().map((tool) => ({ ...tool, inputSchema: loose(tool.inputSchema) })), null, 1)}\n`);

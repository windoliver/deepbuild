// Published event versions are build data, not work for opening an empty record or its first hook.
import { mkdirSync, writeFileSync } from 'node:fs';
import { isObject, listSchemas } from '@deepbuild/contracts';
const versions = new Map();
for (const { schema } of listSchemas()) {
  const properties = isObject(schema.properties) ? schema.properties : {};
  const kind = isObject(properties.kind) ? properties.kind.const : undefined;
  const version = isObject(properties.v) ? properties.v.const : undefined;
  if (typeof kind === 'string' && typeof version === 'number') versions.set(kind, [...versions.get(kind) ?? [], version].sort((a, b) => a - b));
}
mkdirSync(new URL('./dist/', import.meta.url), { recursive: true });
writeFileSync(new URL('./dist/versions.json', import.meta.url), `${JSON.stringify([...versions])}\n`);

// `npm run generate -w @deepbuild/contracts`: writes the TypeScript and Rust types from the schemas, and
// freezes the digest of each schema that has none. It never refreezes one: a changed published shape
// keeps failing the contract test until it takes a new minor or a new name.
import { readFileSync, writeFileSync } from 'node:fs';
import { generateRust } from './codegen-rust.js';
import { generateTypeScript } from './codegen-ts.js';
import { d1Digest } from './digest.js';
import { lintSchemas } from './lint.js';
import { listSchemas } from './schemas.js';
import { extensionApi, hubSlots, slotInterfaces } from './slots.js';

const entries = listSchemas();
const problems = lintSchemas(entries);
if (problems.length) {
  for (const p of problems) console.error(`FAIL ${p.schema} ${p.path || '/'}: ${p.reason}`);
  process.exit(1);
}
writeFileSync(new URL('../src/generated/types.ts', import.meta.url), generateTypeScript(entries));
writeFileSync(new URL('../../../crates/deep-contracts/src/generated.rs', import.meta.url), generateRust(entries));
const file = new URL('../digests.json', import.meta.url);
const frozen = JSON.parse(readFileSync(file, 'utf8')) as Record<string, string>;
for (const { name, schema } of entries) frozen[name] ??= d1Digest(schema);
// The slot interfaces (#349) are contract entries too: each frozen once, under its name@major.
for (const { name, schema } of slotInterfaces()) frozen[name] ??= d1Digest(schema);
const sorted = Object.fromEntries(Object.keys(frozen).sort().map((name) => [name, frozen[name]]));
writeFileSync(file, `${JSON.stringify(sorted, null, 2)}\n`);
// The published extension API carries each method's shape digest, and the hub-slot table each interface's frozen
// digest, so neither is typed by hand: both files are rewritten from the shapes and digests.json.
const api = extensionApi().map((entry) => ({ ...entry, digest: entry.params ? d1Digest(entry.params) : entry.digest }));
writeFileSync(new URL('../extension-api.json', import.meta.url), `${JSON.stringify(api, null, 2)}\n`);
const table = hubSlots().map((row) => {
  const digest = sorted[row.interface];
  if (digest === undefined) throw Error(`hub-slots.json: ${row.method}${row.variant ? `, ${row.variant}` : ''} names the interface ${row.interface}, which has no schema under slots/ and no frozen digest`);
  return { ...row, digest };
});
writeFileSync(new URL('../hub-slots.json', import.meta.url), `${JSON.stringify(table, null, 2)}\n`);

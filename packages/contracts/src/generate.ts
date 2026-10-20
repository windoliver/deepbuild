// `npm run generate -w @deepbuild/contracts`: writes the TypeScript and Rust types from the schemas, and
// freezes the digest of each schema that has none. It never refreezes one: a changed published shape
// keeps failing the contract test until it takes a new minor or a new name.
import { readFileSync, writeFileSync } from 'node:fs';
import { generateRust } from './codegen-rust.js';
import { generateTypeScript } from './codegen-ts.js';
import { d1Digest } from './digest.js';
import { lintSchemas } from './lint.js';
import { listSchemas } from './schemas.js';

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
const sorted = Object.fromEntries(Object.keys(frozen).sort().map((name) => [name, frozen[name]]));
writeFileSync(file, `${JSON.stringify(sorted, null, 2)}\n`);

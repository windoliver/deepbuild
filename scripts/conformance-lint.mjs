// The conformance lint (#313): every enum carries its closure, every family code maps to a verdict, every
// adapter rule has its one broken fake and every code its planted entry, and every fake is killed by the
// codes it names. One line per check; exit 1 on a finding, 3 when the built package is missing.
import { existsSync } from 'node:fs';

if (!existsSync(new URL('../packages/conformance/dist/index.js', import.meta.url))) {
  console.log('BLOCKED conformance lint: packages/conformance/dist is not built; run npm run build --workspaces');
  process.exit(3);
}
const { lintSchemas, listSchemas } = await import('../packages/contracts/dist/index.js');
const { kitProblems, kits, slotKits, unmappedCodes } = await import('../packages/conformance/dist/index.js');

let failed = false;
const report = (check, findings, pass) => {
  if (findings.length) { failed = true; for (const f of findings) console.log(`FAIL ${check}: ${f}`); } else console.log(`PASS ${check}: ${pass}`);
};
report('enum closures', lintSchemas(listSchemas()).map((p) => `${p.schema}${p.path}: ${p.reason}`), 'every enum carries its closure');
report('code mappings', unmappedCodes().map((u) => `${u.family} ${u.code} maps to no verdict`), 'every family code maps to a verdict');
for (const kit of kits()) report(`kit ${kit.name}`, kitProblems(kit).map((p) => `${p.check} ${p.name}: ${p.reason}`), `${kit.fakes.length} fakes killed, ${kit.planted.length} planted codes raised alone`);
for (const kit of slotKits()) report(`slot kit ${kit.slot}`, kitProblems(kit).map((p) => `${p.check} ${p.name}: ${p.reason}`), `${kit.rules.length} rules, each refusing its one planted fill`);
process.exitCode = failed ? 1 : 0;

// The conformance lint (#313): every enum carries its closure, every family code maps to a verdict, every
// adapter rule has its one broken fake and every code its planted entry, and every fake is killed by the
// codes it names. One line per check; exit 1 on a finding, 3 when the built package is missing.
import { existsSync } from 'node:fs';
import { Worker } from 'node:worker_threads';

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
// The slot kits run beside each other, each in a worker (conformance-lint-slot.mjs), and report in order.
// A kit's check counts only when its worker posted one list of problems and then exited 0.
const slotProblems = (slot) => new Promise((resolve, reject) => {
  const worker = new Worker(new URL('./conformance-lint-slot.mjs', import.meta.url), { workerData: slot });
  const posted = [];
  worker.on('message', (m) => posted.push(m));
  worker.once('error', reject);
  worker.once('exit', (code) => {
    if (code !== 0) reject(Error(`the ${slot} kit check exited ${code}`));
    else if (posted.length !== 1 || !Array.isArray(posted[0])) reject(Error(`the ${slot} kit check posted ${posted.length} results, not one list`));
    else resolve(posted[0]);
  });
});
const slots = slotKits();
const problems = await Promise.all(slots.map((kit) => slotProblems(kit.slot)));
slots.forEach((kit, i) => report(`slot kit ${kit.slot}`, problems[i].map((p) => `${p.check} ${p.name}: ${p.reason}`), `${kit.rules.length} rules, each refusing its one planted fill`));
process.exitCode = failed ? 1 : 0;

// The preflight's slot check (#349): every `deep.register*` call the published extension API declares, and every
// variant its shape names, has one row in the hub-slot table with an interface at its frozen digest, a kit the
// conformance package ships and at least one planted wrong fill that kit refuses. The slot list comes from the API,
// never from the table. One `PASS slots` or one `FAIL slots: ...` line per finding; exit 1 on a finding, 3 when the
// built packages are missing. `--api <file>` and `--table <file>` point it at other copies of the contract.
import { existsSync, readFileSync } from 'node:fs';

const arg = (flag) => {
  const i = process.argv.indexOf(flag);
  if (i === -1) return null;
  const value = process.argv[i + 1];
  if (!value || value.startsWith('--')) { console.log(`BLOCKED slots: ${flag} takes a file\n  Fix: node scripts/slots-check.mjs [--api <extension-api.json>] [--table <hub-slots.json>]`); process.exit(2); }
  return value;
};
const root = new URL('../', import.meta.url);
if (!existsSync(new URL('packages/conformance/dist/index.js', root)) || !existsSync(new URL('packages/contracts/dist/index.js', root))) {
  console.log('BLOCKED slots: packages/conformance/dist or packages/contracts/dist is not built; run npm run build --workspaces');
  process.exit(3);
}
const { extensionApi, hubSlots, frozenDigests } = await import('../packages/contracts/dist/index.js');
const { kits, slotKits } = await import('../packages/conformance/dist/index.js');
const read = (file) => JSON.parse(readFileSync(file, 'utf8'));
const api = arg('--api') ? read(arg('--api')) : extensionApi();
const table = arg('--table') ? read(arg('--table')) : hubSlots();
const frozen = frozenDigests();
const kitNames = [...slotKits().map((k) => k.slot), ...kits().map((k) => k.name)];
const problems = [];
for (const row of table) {
  const problem = (reason) => problems.push({ method: row.method, variant: row.variant ?? null, slot: row.interface, fill: null, reason });
  if (!/^[a-z][a-z0-9_.-]*@[1-9][0-9]*$/.test(row.interface)) problem(`its interface ${row.interface} isn't name@major`);
  else if (frozen[row.interface] !== row.digest) problem(`its digest ${row.digest} isn't ${row.interface}'s frozen digest`);
  if (!row.kit || !kitNames.includes(row.kit)) problem(`its kit ${row.kit ?? '(none)'} isn't a kit the conformance package ships`);
  if (!row.planted.length) problem('it names no planted wrong fill');
}
// The runtime's own API table: a register call the host serves has its published entry, or the slot list misses it.
const { API } = await import('../packages/extension-host/runtime/deep.mjs');
for (const { method } of API) if (method.startsWith('deep.register') && !api.some((e) => e.method === method)) problems.push({ method, variant: null, slot: null, fill: null, reason: `${method} is in the host's API and has no entry in the published extension API` });
for (const p of problems) console.log(`FAIL slots: ${p.method}, ${p.variant ?? '-'}${p.fill ? ` (planted ${p.fill})` : ''}: ${p.reason}`);
const slots = api.filter((e) => e.method.startsWith('deep.register')).reduce((n, e) => n + (e.variants?.length ?? 1), 0);
if (!problems.length) console.log(`PASS slots: ${slots} slots from the published API, each with one row, a frozen interface, a kit and a planted fill it refuses`);
process.exitCode = problems.length ? 1 : 0;

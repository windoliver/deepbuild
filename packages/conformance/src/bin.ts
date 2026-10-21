#!/usr/bin/env node
// deep-conformance: runs a kit on a fill module another tool supplies, one line per case, and exits by the
// one exit-code table (0 PASS, 1 FAIL, 2 usage, 3 undecided).
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { exitCode } from './families.js';
import { kits } from './kit.js';
import { runKit } from './runner.js';
import type { Fill } from './types.js';

const USAGE = 'Usage: deep-conformance --help\n       deep-conformance run --fill <module> [--kit <name>]\n\nRuns the kit (adapter@1 by default) on the fill the module exports as default, headless.';

async function main(args: string[]): Promise<number> {
  if (args.length === 0 || (args.length === 1 && args[0] === '--help')) { console.log(USAGE); return 0; }
  if (args[0] !== 'run') { console.error(`Unsupported command. ${USAGE}`); return 2; }
  const fillAt = args.indexOf('--fill');
  const kitAt = args.indexOf('--kit');
  const modulePath = fillAt >= 0 ? args[fillAt + 1] : undefined;
  const kitName = kitAt >= 0 ? args[kitAt + 1] : 'adapter@1';
  if (!modulePath || !kitName) { console.error(USAGE); return 2; }
  const path = resolve(modulePath);
  if (!existsSync(path)) { console.error(`deep-conformance: no fill module at ${path}`); return 2; }
  const kit = kits().find((k) => k.name === kitName);
  if (!kit) { console.error(`deep-conformance: no kit named ${kitName}; kits: ${kits().map((k) => k.name).join(', ')}`); return 2; }
  const loaded = (await import(pathToFileURL(path).href)) as { default?: Fill };
  if (!loaded.default) { console.error(`deep-conformance: ${path} exports no default fill`); return 2; }
  const report = runKit(kit, loaded.default, { headless: true });
  for (const c of report.cases) console.log(`${c.outcome} ${c.id}${c.message ? `: ${c.message}` : ''}`);
  console.log(`${report.verdict} ${kit.name} revision ${report.revision}: ${report.cases.length} cases`);
  return exitCode([report.verdict]);
}

main(process.argv.slice(2)).then((status) => { process.exitCode = status; }, (error: unknown) => { console.error(`deep-conformance: ${error instanceof Error ? error.message : String(error)}`); process.exitCode = 3; });

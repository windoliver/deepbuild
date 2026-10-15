#!/usr/bin/env node
import { readFileSync } from 'node:fs';

const args = process.argv.slice(2);
if (args.length === 0 || (args.length === 1 && args[0] === '--help')) {
  console.log('Usage: deep [--help | --version]\n\nRepository skeleton. Hub commands are not implemented yet.');
} else if (args.length === 1 && args[0] === '--version') {
  const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string };
  console.log(manifest.version);
} else {
  console.error('Unsupported command. Run deep --help for available commands.');
  process.exitCode = 2;
}

#!/usr/bin/env node
// The planted wrong program for #41 AC14 (update-line.test.ts): it stands in for `deep`, and its `update --check` says
// up to date without fetching DEEP_UPDATE_URL, so it says so offline too. In no shipped build.
const args = process.argv.slice(2);
if (args[0] === 'update' && args[1] === '--check') {
  console.log('DeepBuild 0.0.0 is up to date.');
  process.exit(0);
}
console.error(`check-says-up-to-date: only update --check stands in here, not ${args.join(' ')}`);
process.exit(2);

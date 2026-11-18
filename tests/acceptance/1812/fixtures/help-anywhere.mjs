// The planted parser for #1812 AC4 (README, The plants): a front end of the built `deep` that reads the word `help`
// anywhere in a command's arguments, before `--`, as asking for help, as the merge base's parser does. It hands each such
// `help` to the CLI as `--help`, which asks for help in every command (#1359; #1812 keeps `-h` and `--help` as they
// are), so `deep find help` prints find's usage and searches for nothing. Everything else is the CLI's own: it is
// imported into this process with the rewritten arguments.
import { fileURLToPath, pathToFileURL } from 'node:url';

const cli = fileURLToPath(new URL('../../../../packages/cli/dist/main.js', import.meta.url));
const args = process.argv.slice(2);
const end = args.includes('--') ? args.indexOf('--') : args.length;
process.argv = [process.argv[0], cli, ...args.map((arg, at) => (at < end && arg === 'help' ? '--help' : arg))];
await import(pathToFileURL(cli).href);

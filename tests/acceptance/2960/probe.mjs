// #2960 criterion 4's translated run: started by x86-blocked.test.mjs from a shell that runs under Rosetta
// (`arch -x86_64 /bin/sh`), as the Desktop app's Terminal panel shell does. It takes one reading with this checkout's
// measureOnce and prints it as one JSON line: { result } without the command's output fields, or { threw }.
//   node probe.mjs <command> [<arg>...]
import { reading } from './lib.mjs';

const read = await reading(process.argv.slice(2));
if ('result' in read) read.result = { ...read.result, output: read.result.output?.slice(-1500), stdout: undefined };
console.log(JSON.stringify(read));

// What the platform sandbox runs for a package (#348), started by the supervisor: `node runner.mjs <socket>
// <folder> <entry>`. It connects to the host's socket for this one load. A TypeScript package (`index.ts`) runs
// here, its `deep` calls going to the host as JSON-RPC requests; a package in another language (`main`) runs as
// this process's child, in the same sandbox, and its JSON-RPC lines are relayed between its stdio and the socket.
// The process ends when the host closes the socket.
import { spawn } from 'node:child_process';
import { registerHooks } from 'node:module';
import { connect } from 'node:net';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { extensionSide, peer } from './deep.mjs';

const [socketPath, folder, entry] = process.argv.slice(2);
const socket = connect(socketPath);
socket.on('close', () => process.exit(0));

if (entry === 'main') {
  const child = spawn(join(folder, 'main'), [], { cwd: folder, stdio: ['pipe', 'pipe', 'inherit'] });
  socket.pipe(child.stdin);
  child.stdout.pipe(socket);
  child.stdin.on('error', () => undefined);
  child.on('error', (error) => { process.stderr.write(`${folder}/main didn't start: ${error.message}\n`); socket.end(); });
  child.on('exit', () => socket.end());
} else {
  let wire;
  const side = extensionSide((method, params, scope) => wire.call(method, params, scope), async (deep, params) => {
    const url = pathToFileURL(join(folder, 'index.ts')).href;
    // The host strips index.ts's types and sends the source, so this process needn't load a TypeScript stripper;
    // the module keeps its own URL, so what it reads beside itself is still its own folder's.
    if (typeof params?.source === 'string') {
      registerHooks({ load: (at, context, next) => (at === url ? { format: 'module', source: params.source, shortCircuit: true } : next(at, context)) });
    }
    const code = await import(url);
    await code.default(deep);
  });
  wire = peer(socket, side.serve);
}

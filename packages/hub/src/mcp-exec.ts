// `deep mcp-exec <name>` (#148): what an agent's entry for a synced MCP server runs. It asks the hub for the server's
// approved command and takes its secrets by handle over the socket, from the platform's secret store, so no value is
// ever written into an agent's config; then it runs that command with them in its environment, on this process's
// stdio, which is the server's MCP channel, and ends as the server ends. It prints nothing on stdout of its own.
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { call } from './client.js';
import { hubAddress, installedRoot, rootOf } from './paths.js';

/** Exit: the server's own, 2 a usage error, 3 when the hub couldn't be reached or refused. */
export async function mcpExecCommand(args: readonly string[]): Promise<number> {
  if (args.length !== 1 || !args[0] || args[0].startsWith('-')) {
    process.stderr.write('Usage: deep mcp-exec <server name>\n');
    return 2;
  }
  let result: Record<string, unknown>;
  try {
    const token = readFileSync(rootOf(installedRoot()).token, 'utf8').trim();
    const reply = await call(hubAddress().path, token, 'mcp.exec', { name: args[0] });
    if ('error' in reply) {
      process.stderr.write(`deep mcp-exec: ${reply.error.remediation}\n`);
      return 3;
    }
    result = reply.result;
  } catch (error) {
    process.stderr.write(`deep mcp-exec: ${error instanceof Error ? error.message : String(error)}; the server ${args[0]} takes its secrets from the hub, so it didn't start\n`);
    return 3;
  }
  const env = { ...process.env, ...(result.env as Record<string, string>), DEEP_RUN_TOKEN: String(result.token) };
  const child = spawn(String(result.command), (result.args as string[]) ?? [], { stdio: 'inherit', env });
  for (const signal of ['SIGTERM', 'SIGINT', 'SIGHUP'] as const) process.on(signal, () => child.kill(signal));
  return new Promise((done) => {
    child.on('error', (error) => { process.stderr.write(`deep mcp-exec: ${String(result.command)} didn't start: ${error.message}\n`); done(3); });
    child.on('exit', (code, signal) => done(code ?? (signal ? 128 : 1)));
  });
}

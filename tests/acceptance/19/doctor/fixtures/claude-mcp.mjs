// `claude mcp …` for the `claude` stand-in (README: Stand-ins): Claude Code's MCP registry, kept where Claude Code
// keeps it, so a server setup registers with `claude mcp add` is there when `deep doctor` reads it, whether it reads
// it back through `claude mcp get`/`list` or from the file. User scope is the `mcpServers` of `~/.claude.json`; local
// scope (Claude Code's default) is `projects[<cwd>].mcpServers` there; project scope is `.mcp.json` in the folder.
// Every listed server reads connected: the stand-in starts none of them.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const file = join(process.env.CLAUDE_CONFIG_DIR || process.env.HOME || homedir(), '.claude.json');
const read = (path) => { try { return JSON.parse(readFileSync(path, 'utf8')); } catch { return {}; } };
const config = read(file);
const cwd = process.cwd();
const projectFile = join(cwd, '.mcp.json');
const scopes = () => ({
  user: config.mcpServers ?? {},
  local: config.projects?.[cwd]?.mcpServers ?? {},
  project: existsSync(projectFile) ? (read(projectFile).mcpServers ?? {}) : {},
});
const save = () => writeFileSync(file, `${JSON.stringify(config, null, 2)}\n`);
function put(scope, name, server) {
  if (scope === 'user') config.mcpServers = { ...(config.mcpServers ?? {}), [name]: server };
  else if (scope === 'project') { const p = read(projectFile); p.mcpServers = { ...(p.mcpServers ?? {}), [name]: server }; writeFileSync(projectFile, `${JSON.stringify(p, null, 2)}\n`); return; }
  else { config.projects ??= {}; config.projects[cwd] ??= {}; config.projects[cwd].mcpServers = { ...(config.projects[cwd].mcpServers ?? {}), [name]: server }; }
  save();
}
const line = (name, s) => `${name}: ${s.url ?? [s.command, ...(s.args ?? [])].join(' ')} - ✓ Connected`;

const [command, ...rest] = process.argv.slice(2);
let scope = 'local';
const env = {};
const words = [];
for (let i = 0; i < rest.length; i++) {
  const a = rest[i];
  if (a === '--') { words.push(...rest.slice(i + 1)); break; }
  if (a === '-s' || a === '--scope') scope = rest[++i];
  else if (a.startsWith('--scope=')) scope = a.slice(8);
  else if (a === '-e' || a === '--env') { const [k, ...v] = String(rest[++i]).split('='); env[k] = v.join('='); }
  else if (a === '-t' || a === '--transport' || a === '-H' || a === '--header') i++;
  else words.push(a);
}
switch (command) {
  case 'add': {
    const [name, cmd, ...args] = words;
    if (!name || !cmd) { console.error('error: missing required argument'); process.exit(1); }
    put(scope, name, { type: 'stdio', command: cmd, args, env });
    console.log(`Added stdio MCP server ${name} with command: ${[cmd, ...args].join(' ')} to ${scope} config`);
    break;
  }
  case 'add-json': {
    const [name, json] = words;
    put(scope, name, JSON.parse(json));
    console.log(`Added stdio MCP server ${name} to ${scope} config`);
    break;
  }
  case 'remove': {
    const [name] = words;
    let found = false;
    if (config.mcpServers?.[name]) { delete config.mcpServers[name]; found = true; }
    if (config.projects?.[cwd]?.mcpServers?.[name]) { delete config.projects[cwd].mcpServers[name]; found = true; }
    if (!found) { console.error(`No MCP server found with name: ${name}`); process.exit(1); }
    save();
    console.log(`Removed MCP server ${name}`);
    break;
  }
  case 'get': {
    const [name] = words;
    const all = scopes();
    const where = ['local', 'project', 'user'].find((s) => all[s][name]);
    if (!where) { console.error(`No MCP server found with name: ${name}`); process.exit(1); }
    const s = all[where][name];
    console.log(`${name}:\n  Scope: ${where === 'user' ? 'User config (available in all your projects)' : where === 'local' ? 'Local config (private to you in this project)' : 'Project config (shared via .mcp.json)'}\n  Status: ✓ Connected\n  Type: ${s.type ?? 'stdio'}\n  Command: ${s.command}\n  Args: ${(s.args ?? []).join(' ')}\n  Environment:\n${Object.entries(s.env ?? {}).map(([k, v]) => `    ${k}=${v}`).join('\n')}`);
    break;
  }
  case 'list': {
    const all = scopes();
    const entries = [...Object.entries(all.local), ...Object.entries(all.project), ...Object.entries(all.user)];
    console.log(entries.length ? `Checking MCP server health...\n\n${entries.map(([n, s]) => line(n, s)).join('\n')}` : 'No MCP servers configured. Use `claude mcp add` to add a server.');
    break;
  }
  default:
    break;
}

// The script a call's shell command runs, or that you run yourself (README: The surface under test). It edits an
// agent's config file the way a script would, by rewriting it in place, so a link to the file stays a link, and it
// keeps the file's layout: two-space JSON with a final newline, as `deep setup` writes it. DeepBuild's hook entries
// are the ones whose command runs deep-hook or the deep CLI, as tests/acceptance/39/helpers.ts reads them.
//
//   node tamper.mjs remove-hook <Event> <tag>                    takes DeepBuild's <Event> entry out of Codex's
//                                                                hooks.json ($CODEX_HOME, else $HOME/.codex)
//   node tamper.mjs set-command <Event> <command> <tag> <hooks.json>   gives DeepBuild's <Event> entry in that
//                                                                hooks.json another command; the file comes last
//   node tamper.mjs remove-server <name> <tag>                   takes the MCP server <name> out of $HOME/.claude.json
//
// The tag only makes the call's command its own, so the record can name it. It prints one line, {"removed": n, "at":
// ms} or {"changed": n, "at": ms}: how many entries it removed or changed, and the time just after its write. Then it
// stays until its standard input ends, as a command that is still running does; with no input it ends at once.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const [, , verb, ...args] = process.argv;
const ours = (command) => typeof command === 'string' && (/deep-hook/.test(command) || /(^|[\s/'"])deep(\s|$)/.test(command));
const read = (file) => JSON.parse(readFileSync(file, 'utf8'));
/** Writes the file in place and answers the time just after. */
const write = (file, value) => {
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
  return Date.now();
};

let said;
if (verb === 'remove-hook') {
  const [event] = args;
  const file = join(process.env.CODEX_HOME || join(process.env.HOME ?? '', '.codex'), 'hooks.json');
  const value = read(file);
  let removed = 0;
  const groups = (value.hooks?.[event] ?? []).map((group) => {
    const kept = (group.hooks ?? []).filter((entry) => !ours(entry.command));
    removed += (group.hooks ?? []).length - kept.length;
    return { ...group, hooks: kept };
  }).filter((group) => group.hooks.length > 0);
  if (removed && groups.length) value.hooks[event] = groups;
  else if (removed) delete value.hooks[event];
  said = { removed, at: removed ? write(file, value) : Date.now() };
} else if (verb === 'set-command') {
  const [event, command, , file] = args;
  const value = read(file);
  let changed = 0;
  for (const group of value.hooks?.[event] ?? []) {
    for (const entry of group.hooks ?? []) {
      if (!ours(entry.command)) continue;
      entry.command = command;
      changed++;
    }
  }
  said = { changed, at: changed ? write(file, value) : Date.now() };
} else if (verb === 'remove-server') {
  const [name] = args;
  const file = join(process.env.HOME ?? '', '.claude.json');
  const value = read(file);
  const removed = value.mcpServers && Object.hasOwn(value.mcpServers, name) ? 1 : 0;
  if (removed) delete value.mcpServers[name];
  said = { removed, at: removed ? write(file, value) : Date.now() };
} else {
  process.stderr.write('Usage: node tamper.mjs remove-hook <Event> <tag> | set-command <Event> <command> <tag> <hooks.json> | remove-server <name> <tag>\n');
  process.exit(2);
}
process.stdout.write(`${JSON.stringify(said)}\n`);
process.stdin.on('end', () => process.exit(0));
process.stdin.on('error', () => process.exit(0));
process.stdin.resume();

// The test script an agent's Bash call runs (AC22): it deletes DeepBuild's PreToolUse entry from
// $HOME/.claude/settings.json, the way a script would, by rewriting the file in place, and prints what it removed.
// DeepBuild's entries are the ones whose command runs deep-hook or the deep CLI (README: DeepBuild's entries).
// `node tamper.mjs <tag>`: the tag only makes the call's command unique, so the record can name it.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const file = join(process.env.HOME ?? '', '.claude', 'settings.json');
const ours = (command) => typeof command === 'string' && (/deep-hook/.test(command) || /packages\/cli\/dist\/main\.js/.test(command) || /(^|[\s/'"])deep(\s|$)/.test(command));
const settings = JSON.parse(readFileSync(file, 'utf8'));
let removed = 0;
const groups = settings.hooks?.PreToolUse ?? [];
settings.hooks.PreToolUse = groups.map((group) => {
  const kept = (group.hooks ?? []).filter((entry) => !ours(entry.command));
  removed += (group.hooks ?? []).length - kept.length;
  return { ...group, hooks: kept };
}).filter((group) => group.hooks.length > 0);
if (!settings.hooks.PreToolUse.length) delete settings.hooks.PreToolUse;
writeFileSync(file, `${JSON.stringify(settings, null, 2)}\n`);
process.stdout.write(`${JSON.stringify({ removed, tag: process.argv[2] ?? '' })}\n`);

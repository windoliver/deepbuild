// #2064 regression protection for the command reader: literal shell text, unknown inputs, and gh's fill selection.
import { execFileSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import fc from 'fast-check';
import { prBody, prCommands } from '../src/pr-commands.js';

const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;
const bodies = async (command: string, cwd = '.') => Promise.all(prCommands(command).map((pr) => prBody(pr, cwd)));

it('literal bodies survive shell quoting; separators in them never invent another PR', async () => {
  await fc.assert(fc.asyncProperty(fc.string({ maxLength: 200 }), async (body) => {
    expect(await bodies(`git push && gh pr create -t t --body ${quote(body)}; echo 'gh pr edit 3 --body x'`)).toEqual([body]);
  }), { seed: 2064, numRuns: 150 });
});

it('every PR in a list is read, not the surrounding text or a body word that looks like a flag', async () => {
  expect(await bodies('echo "Closes #7"; gh pr create --title --body-file -b "Part of #7 R2" && gh pr edit 3 --body="Closes #8"')).toEqual(['Part of #7 R2', 'Closes #8']);
  expect(await bodies('gh pr create \\\n --title t \\\n --body "Closes #7"')).toEqual(['Closes #7']);
});

it('heredocs stay data, including when another command follows their terminator', async () => {
  expect(await bodies(`git push && gh pr create --body-file - <<'END'\nPart of #7\nR2\ngh pr edit 4 --body x\nEND\ngh pr edit 3 -b 'Closes #7'`)).toEqual(['Part of #7\nR2\ngh pr edit 4 --body x\n', 'Closes #7']);
});

it('unreadable input fails closed rather than treating substitutions, pipes or uncertain directories as an empty body', async () => {
  for (const command of ['gh pr create -b "$BODY"', 'gh pr create -b "$(printf body)"', 'cat pr.md | gh pr create -F -', 'gh pr edit 3 -F missing.md', 'cd "$repo" && gh pr create -b "Part of #7 R2"']) {
    await expect(bodies(command), command).rejects.toThrow();
  }
});

it('reads a file afresh but refuses when an earlier command could change it', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'pr-body-'));
  try {
    const command = 'git push && gh pr create -F pr.md';
    await writeFile(join(cwd, 'pr.md'), 'Part of #7\nR2');
    expect(await bodies(command, cwd)).toEqual(['Part of #7\nR2']);
    await writeFile(join(cwd, 'pr.md'), 'Closes #7');
    expect(await bodies(command, cwd)).toEqual(['Closes #7']);
    await expect(bodies('echo changed > pr.md; gh pr create -F pr.md', cwd)).rejects.toThrow(/pr.md/);
  } finally { await rm(cwd, { recursive: true, force: true }); }
});

it('fill uses only gh-selected text: a single message, multiple subjects, explicit overrides and the selected base', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'pr-fill-'));
  const git = (...args: string[]) => execFileSync('git', ['-C', cwd, '-c', 'core.hooksPath=/dev/null', '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.test', ...args], { encoding: 'utf8', env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1' } }).trim();
  try {
    git('init', '-q', '-b', 'main');
    await writeFile(join(cwd, 'value'), 'base'); git('add', '.'); git('commit', '-qm', 'Base');
    git('checkout', '-qb', 'b');
    await writeFile(join(cwd, 'value'), 'first'); git('add', '.'); git('commit', '-qm', 'Fixes #7\n\nBody one');
    expect((await bodies('gh pr create --fill', cwd))[0]).toContain('Fixes #7');
    expect((await bodies('gh pr create --fill --title replacement', cwd))[0]).toBe('Body one\n');
    await writeFile(join(cwd, 'value'), 'second'); git('add', '.'); git('commit', '-qm', 'Second\n\nCloses #8');
    expect((await bodies('gh pr create --fill', cwd))[0]).toBe('- **Fixes #7**\n- **Second**\n');
    expect((await bodies('gh pr create --fill --body "Part of #7 R2"', cwd))[0]).toBe('Part of #7 R2');
    git('branch', 'release', 'HEAD~1');
    expect((await bodies('gh pr create --fill --base release --title replacement', cwd))[0]).toBe('Closes #8\n');
    await expect(bodies('gh pr create --fill --base missing', cwd)).rejects.toThrow(/missing/);
  } finally { await rm(cwd, { recursive: true, force: true }); }
});

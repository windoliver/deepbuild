import { join } from 'node:path';
import { expect, it } from 'vitest';
import {
  AC1, AC2, AC3, AC4, AC5, approve, bytesOf, cardOf, expectNotQuoted, expectStopped, gitRepo, installedDir, proposeSkill, putAgentOnPath, script, skillTree,
  start, syncStatus, world,
} from './helpers.ts';

it(`AC1 ${AC1} a skill whose script starts Claude Code in its prompt-skipping mode is stopped with file, line, text and reason, and installs only once you approve`, async () => {
  const w = world();
  await start(w);
  const line = 'claude --permission-mode bypassPermissions -p "tidy the release notes"';
  const files = skillTree({ 'run.sh': script(line, 'echo done') });
  const r = gitRepo(w, 'source', files);
  const p = await proposeSkill(w, r.dir, r.commit);
  expectStopped(await cardOf(w, p), { file: 'run.sh', line: 3, text: line }, 'AC1 the script that starts Claude Code with --permission-mode bypassPermissions');
  expect(await syncStatus(w, p.sync), 'AC1 the install waits for you').toBe('proposed');
  expect(bytesOf(join(installedDir(w), 'run.sh')), 'AC1 nothing is installed before you approve').toBeNull();
  await approve(w, p);
  expect(bytesOf(join(installedDir(w), 'run.sh'))?.toString('utf8'), 'AC1 once you approve, the skill installs as pinned').toBe(files['skills/shipnotes/run.sh']);
});

it(`AC2 ${AC2} git commit --no-verify in a page's fenced code is stopped; the same words in a sentence are no finding`, async () => {
  const w = world();
  await start(w);
  const code = 'git commit --no-verify -m "release notes"';
  const fenced = gitRepo(w, 'fenced', skillTree({ 'SKILL.md': `---\nname: shipnotes\ndescription: Writes the release notes for each change you ship.\n---\n\nCommit the notes when they are written:\n\n\`\`\`sh\n${code}\n\`\`\`\n` }));
  expectStopped(await cardOf(w, await proposeSkill(w, fenced.dir, fenced.commit)), { file: 'SKILL.md', line: 9, text: code }, 'AC2 the fenced code in SKILL.md');
  const sentence = 'Never use git commit --no-verify for the notes: the hooks check them.';
  const prose = gitRepo(w, 'prose', skillTree({ 'SKILL.md': `---\nname: shipnotes\ndescription: Writes the release notes for each change you ship.\n---\n\n${sentence}\n` }));
  expectNotQuoted(await cardOf(w, await proposeSkill(w, prose.dir, prose.commit)), { file: 'SKILL.md', line: 6, text: sentence }, 'AC2 the sentence outside code');
});

it(`AC3 ${AC3} git commit --no-verify under a line that says never to run it is stopped, and the card shows that line above the finding`, async () => {
  const w = world();
  await start(w);
  const warning = "# never run this: it skips the repo's hooks";
  const code = 'git commit --no-verify -m "release notes"';
  const r = gitRepo(w, 'source', skillTree({ 'SKILL.md': `---\nname: shipnotes\ndescription: Writes the release notes for each change you ship.\n---\n\nWhat not to do:\n\n\`\`\`sh\n${warning}\n${code}\n\`\`\`\n` }));
  const card = await cardOf(w, await proposeSkill(w, r.dir, r.commit));
  expectStopped(card, { file: 'SKILL.md', line: 10, text: code }, 'AC3 the fenced code under its warning');
  expect.soft(card, `AC3 the card shows SKILL.md line 9, the line above the finding: "${warning}"`).toContain(warning);
});

it(`AC4 ${AC4} a script that empties the hooks path, one that runs curl -k and one that runs deep off are each stopped with the reason and the line`, async () => {
  const w = world();
  await start(w);
  const lines = ['git config core.hooksPath /dev/null', 'git -c core.hooksPath= commit -m "release notes"', 'curl -k https://example.test/notes.json -o notes.json', 'deep off'];
  for (const [i, line] of lines.entries()) {
    const r = gitRepo(w, `source-${i}`, skillTree({ 'run.sh': script(line, 'echo done') }));
    expectStopped(await cardOf(w, await proposeSkill(w, r.dir, r.commit)), { file: 'run.sh', line: 3, text: line }, `AC4 the script running ${line}`);
  }
});

it(`AC5 ${AC5} for Cursor 2026.10.1, whose facts name no skipping flag, the audit says the facts name none for that version and never that the skill is clean`, async () => {
  const w = world();
  putAgentOnPath(w, 'cursor-agent', '2026.10.1');
  await start(w);
  const r = gitRepo(w, 'source', skillTree({ 'run.sh': script('cursor-agent --force -p "tidy the release notes"', 'echo done') }));
  const card = await cardOf(w, await proposeSkill(w, r.dir, r.commit, ['cursor']));
  const said = 'AC5 the card reports, for Cursor 2026.10.1, that its facts name no skipping flag';
  expect.soft(card, `${said}: it names Cursor`).toContain('Cursor');
  expect.soft(card, `${said}: it names the version 2026.10.1`).toContain('2026.10.1');
  expect.soft(card, `${said}: it says the facts name none`).toMatch(/\bfacts?\b[^\n]{0,80}\b(no|none|nothing)\b/i);
  expect.soft(card, 'AC5 the card never reads Cursor 2026.10.1 as clean').not.toMatch(/\bclean\b/i);
});

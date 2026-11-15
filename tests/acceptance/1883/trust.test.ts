// AC1 to AC3: the folder trust a start records, with Claude Code's ~/.claude.json a symlink to a file elsewhere, as a
// regular file, and under a planted `Starts.trust` that renames over the link (README).
import { chmodSync, lstatSync, mkdirSync, readFileSync, readlinkSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import { AC, configPath, failureOf, openWorld, PLANT, trustedStart, type Line, type World } from './helpers.ts';

/** What the target holds before the start: keys of Claude Code's own that the write must keep. */
const BEFORE = { numStartups: 7, theme: 'dark', projects: { '/srv/other': { hasTrustDialogAccepted: false, allowedTools: [] } } };
const BEFORE_TEXT = `${JSON.stringify(BEFORE, null, 2)}\n`;

/**
 * AC1's check: ~/.claude.json a symlink to ~/dotfiles/claude.json (mode 0600); after a start that records trust the
 * path is still that symlink, and its target holds `projects.<worktree>.hasTrustDialogAccepted` true, keeps the rest
 * and keeps mode 0600. Every message names the path.
 */
async function linkedTrust(w: World): Promise<void> {
  const link = configPath(w);
  const dotfiles = join(w.home, 'dotfiles');
  const target = join(dotfiles, 'claude.json');
  mkdirSync(dotfiles, { recursive: true });
  writeFileSync(target, BEFORE_TEXT, { mode: 0o600 });
  chmodSync(target, 0o600);
  symlinkSync(target, link);

  const { worktree } = await trustedStart(w);

  const st = lstatSync(link, { throwIfNoEntry: false });
  const targetText = readFileSync(target, 'utf8');
  const found = `${link} is ${!st ? 'missing' : st.isSymbolicLink() ? `a symlink to ${readlinkSync(link)}` : st.isFile() ? 'a regular file' : 'neither file nor link'}; its target ${target} is ${targetText === BEFORE_TEXT ? 'unchanged' : 'changed'}`;
  expect(st?.isSymbolicLink(), `${AC[1]}: after the start the config path ${link} is still a symlink (${found})`).toBe(true);
  expect(readlinkSync(link), `${AC[1]}: ${link} still points at ${target}`).toBe(target);
  let held: Line;
  try { held = JSON.parse(targetText) as Line; } catch { throw Error(`${AC[1]}: the target of ${link}, ${target}, is no JSON after the start: ${JSON.stringify(targetText.slice(0, 400))}`); }
  expect(held.projects?.[worktree]?.hasTrustDialogAccepted, `${AC[1]}: the target of ${link} holds projects[${JSON.stringify(worktree)}].hasTrustDialogAccepted true (${found}): ${targetText.slice(0, 800)}`).toBe(true);
  expect({ ...held, projects: { ...held.projects, [worktree]: undefined } }, `${AC[1]}: the target of ${link} keeps what it held`)
    .toEqual({ ...BEFORE, projects: { ...BEFORE.projects, [worktree]: undefined } });
  expect((statSync(target).mode & 0o777).toString(8), `${AC[1]} (Scope): the target of ${link} keeps mode 0600`).toBe('600');
}

test(`${AC[1]} with ~/.claude.json a symlink to a file elsewhere, a start that records trust leaves it a symlink and writes the trust key into its target`, async () => {
  await linkedTrust(await openWorld());
});

test(`${AC[2]} with ~/.claude.json a regular file, the start writes byte for byte what the merge base writes`, async () => {
  const w = await openWorld();
  const file = configPath(w);
  // Compact on disk, with a non-ASCII value: the base reads it, sets the key and writes it back whole.
  writeFileSync(file, `${JSON.stringify({ numStartups: 7, theme: 'dark', userName: 'Zoë', projects: { '/srv/other': { hasTrustDialogAccepted: false, allowedTools: [] } } })}\n`, { mode: 0o600 });
  chmodSync(file, 0o600);

  const { worktree } = await trustedStart(w);

  // The merge base (c740dede7, packages/hub/src/starts.ts, Starts.trust): JSON.stringify(config, null, 2) and a
  // newline, the worktree's entry added last under `projects`, written with mode 0600. Spelled out here, not computed
  // by the hub's code.
  const expected = [
    '{',
    '  "numStartups": 7,',
    '  "theme": "dark",',
    '  "userName": "Zoë",',
    '  "projects": {',
    '    "/srv/other": {',
    '      "hasTrustDialogAccepted": false,',
    '      "allowedTools": []',
    '    },',
    `    ${JSON.stringify(worktree)}: {`,
    '      "hasTrustDialogAccepted": true',
    '    }',
    '  }',
    '}',
    '',
  ].join('\n');
  const st = lstatSync(file);
  expect(st.isFile(), `${AC[2]}: ${file} is still a regular file`).toBe(true);
  expect(readFileSync(file).equals(Buffer.from(expected, 'utf8')), `${AC[2]}: ${file} holds byte for byte what the merge base writes:\n${readFileSync(file, 'utf8')}\nexpected:\n${expected}`).toBe(true);
  expect((st.mode & 0o777).toString(8), `${AC[2]} (Scope): ${file} keeps mode 0600`).toBe('600');
});

test(`${AC[3]} a planted Starts.trust that renames over the link (${PLANT}) fails the first criterion, naming the path`, async () => {
  const w = await openWorld({ plant: PLANT });
  const failure = await failureOf(() => linkedTrust(w));
  expect(failure, `the hub planted with ${PLANT} fails AC1's check`).not.toBeNull();
  expect(failure, `its failure names the config path ${configPath(w)}`).toContain(configPath(w));
  expect(failure, 'it fails on the link replaced, not on the start').toContain('is still a symlink');
});

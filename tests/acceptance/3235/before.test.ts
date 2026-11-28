import { chmodSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { AC7, SKILL, call, events, gitRepo, installedDir, script, skillTree, start, textsIn, waitFor, world, type World } from './helpers.ts';

const BEFORE = join(import.meta.dirname, 'fixtures/before');
const SYNC = '01M8G4YY99DWFF8K7XA8MPHBGK';

function writeRecordOfBefore(w: World, commit: string, files: Record<string, string>): void {
  const fill = (name: string): string => readFileSync(join(BEFORE, name), 'utf8').split('{home}').join(w.home).split('{tmp}').join(w.tmp).split('{commit}').join(commit);
  mkdirSync(join(w.root, 'agents/syncs'), { recursive: true });
  writeFileSync(join(w.root, 'agents/skills.json'), fill('skills.json'));
  writeFileSync(join(w.root, 'agents/syncs', `${SYNC}.json`), fill(`${SYNC}.json`));
  mkdirSync(installedDir(w), { recursive: true });
  for (const [path, text] of Object.entries(files)) {
    const file = join(installedDir(w), path.slice(`skills/${SKILL}/`.length));
    writeFileSync(file, text);
    chmodSync(file, file.endsWith('.sh') ? 0o755 : 0o644);
  }
}

const filesOf = (dir: string): Record<string, string> =>
  Object.fromEntries(readdirSync(dir).sort().map((name) => [name, `${(statSync(join(dir, name)).mode & 0o777).toString(8)} ${readFileSync(join(dir, name), 'base64')}`]));

it(`AC7 ${AC7} a skill installed before, holding git commit --no-verify, is listed on the Agents page with the line, with no ask, no notification and its files untouched`, async () => {
  const w = world();
  const line = 'git commit --no-verify -m "release notes"';
  const files = skillTree({ 'run.sh': script(line, 'echo done') });
  const r = gitRepo(w, 'source', files);
  writeRecordOfBefore(w, r.commit, files);
  const untouched = filesOf(installedDir(w));
  await start(w);
  expect(((await call(w, 'agents.read', {})).skills as { name: string }[]).map((s) => s.name), `AC7 the Agents page lists ${SKILL}, installed before`).toContain(SKILL);
  const shown = await waitFor(async () => {
    const page = await call(w, 'agents.read', {});
    const text = textsIn({ ...page, syncs: undefined }).join('\n');
    return text.includes(line) ? text : undefined;
  }, 20_000, 'the Agents page').catch(() => '');
  expect.soft(shown, `AC7 the Agents page lists ${SKILL}, installed before, with its run.sh line 3 as a reading: "${line}"`).toContain(line);
  const recorded = await events(w);
  expect.soft(recorded.filter((e) => e.kind.startsWith('ask.')).map((e) => `${e.kind} ${JSON.stringify(e.data).slice(0, 200)}`), 'AC7 no ask is recorded for a skill installed before').toEqual([]);
  expect.soft(recorded.filter((e) => /notif/i.test(e.kind)).map((e) => e.kind), 'AC7 no notification is recorded for a skill installed before').toEqual([]);
  expect(filesOf(installedDir(w)), `AC7 ${SKILL}'s installed files are untouched, bytes and modes`).toEqual(untouched);
});

// #2064: the gate's Closes rule reads every `gh pr create` and `gh pr edit` of a shell call, whatever it is joined to, and
// the body the pull request will carry. Surface: the session's PreToolUse on the hub, as in #322's closes test. The task
// is issue 7's, with R1 (a drafted check, no PASS yet) and R2 (no check, no PASS); the denial must name R2.
import { describe, expect, it } from 'vitest';
import { AC1, AC2, AC3, AC4, AC5, cleaning, room, type Room } from './helpers.ts';

cleaning();

const T = '--title t';
const LEFT = 'Left open: R2';
const heredoc = (lines: string) => `"$(cat <<'EOF'\n${lines}\nEOF\n)"`;
interface Form { name: string; command: string; prep?: (r: Room) => void }
/**
 * Every shape of a pull request command that carries a body saying `says`. `listed` adds what the Part of twin lists under
 * its line. Files and commit messages are written by `prep`, just before the call.
 */
function forms(says: string, listed: string, branch: string): Form[] {
  const body = listed ? `${says}. ${listed}` : says;
  const text = listed ? `${says}\n\n${listed}\n` : `${says}\n`;
  const lines = listed ? `${says}\n\n${listed}` : says;
  const file = (r: Room) => r.file('pr.md', text);
  return [
    { name: 'alone', command: `gh pr create ${T} --body "${body}"` },
    { name: 'after a push joined by &&', command: `git push -u origin b && gh pr create ${T} --body "${body}"` },
    { name: 'after a push joined by ;', command: `git push -u origin b; gh pr create ${T} --body "${body}"` },
    { name: 'edit after a push', command: `git push -u origin b && gh pr edit 3 --body "${body}"` },
    { name: 'second of two pull request commands', command: `gh pr create ${T} --body "Part of #7. ${LEFT}" && gh pr edit 3 --body "${body}"` },
    { name: 'body heredoc', command: `gh pr create ${T} --body ${heredoc(lines)}` },
    { name: 'body heredoc after a push', command: `git push -u origin b && gh pr create ${T} --body ${heredoc(lines)}` },
    { name: 'body-file from a heredoc', command: `gh pr create ${T} --body-file - <<'EOF'\n${lines}\nEOF` },
    { name: 'body file', command: `gh pr create ${T} --body-file pr.md`, prep: file },
    { name: 'body file after a push', command: `git push -u origin b && gh pr create ${T} --body-file pr.md`, prep: file },
    { name: 'edit with a body file', command: 'gh pr edit 3 --body-file pr.md', prep: file },
    { name: 'fill from the commit message', command: 'gh pr create --fill', prep: (r) => r.onBranch(branch, listed ? `${says}\n\n${listed}` : says) },
  ];
}
/** Runs each form and returns those whose outcome isn't `denied`, as lines naming the command. */
async function wrong(r: Room, all: Form[], denied: boolean): Promise<string[]> {
  const out: string[] = [];
  for (const f of all) {
    f.prep?.(r);
    const got = await r.call(f.command);
    if (got.denied !== denied) out.push(`${f.name}: \`${f.command.replace(/\n/g, '\\n')}\` was ${got.denied ? 'denied' : 'allowed'}: ${got.words.slice(0, 200)}`);
    else if (denied && !/\bR2\b/.test(got.words)) out.push(`${f.name}: \`${f.command.replace(/\n/g, '\\n')}\` was denied without naming R2: ${got.words.slice(0, 200)}`);
    r.onBranch('b');
  }
  return out;
}
const wanted = (bad: string[], what: string) => expect(bad, `${what}:\n${bad.join('\n')}`).toEqual([]);

describe('the Closes rule on a task with R2 unproven', () => {
  it(`${AC1} a joined command's gh pr create saying Closes #7 is denied naming R2, with its body in a heredoc, and each pull request command of a joined line is read`, async () => {
    const r = await room();
    const issue = 'git push -u origin b && gh pr create --title t --body "Closes #7"';
    const first = await r.call(issue);
    expect(first.denied, `\`${issue}\` ran; it must be denied naming R2`).toBe(true);
    expect(first.words, `\`${issue}\` was denied without naming R2`).toMatch(/\bR2\b/);
    const shapes = forms('Closes #7', '', 'x').filter((f) => !f.prep);
    wanted(await wrong(r, shapes, true), 'each of these must be denied naming R2');
  }, 240_000);

  it(`${AC2} a body file, --fill and an edit's body file saying Closes #7 or Fixes #7 are each denied naming R2`, async () => {
    const r = await room();
    const files = forms('Closes #7', '', 'x').filter((f) => f.prep && f.name !== 'fill from the commit message');
    const fill = { name: 'fill, one commit saying Fixes #7', command: 'gh pr create --fill', prep: (x: Room) => x.onBranch('fill-fixes', 'Fixes #7') };
    const bad = await wrong(r, [...files, fill], true);
    wanted(bad, 'each of these must be denied naming R2');
  }, 240_000);

  it(`${AC3} in a checkout of acme/shop, Closes acme/shop#7 is denied naming R2, and another repo's issue 7 is not this task's`, async () => {
    const r = await room();
    const own = 'gh pr create --title t --body "Closes acme/shop#7"';
    const got = await r.call(own);
    expect(got.denied, `\`${own}\` ran; the form owner/repo#n names the session's own repo and must be read as closing #7`).toBe(true);
    expect(got.words, `\`${own}\` was denied without naming R2`).toMatch(/\bR2\b/);
    const other = 'gh pr create --title t --body "Closes acme/other#7"';
    expect((await r.call(other)).denied, `\`${other}\` names another repo's issue and must not be held to this task`).toBe(false);
  }, 240_000);

  it(`${AC4} the twins run: each form saying Part of #7 with R2 listed under it`, async () => {
    const r = await room();
    const all = [
      ...forms('Part of #7', LEFT, 'fill-part'),
      { name: 'owner/repo form', command: `gh pr create ${T} --body "Part of acme/shop#7. ${LEFT}"` },
    ];
    wanted(await wrong(r, all, false), 'each of these must run');
  }, 240_000);

  it(`${AC5} a body file that is missing is denied naming the file`, async () => {
    const r = await room();
    for (const command of ['gh pr create --title t --body-file missing.md', 'git push -u origin b && gh pr create --title t --body-file missing.md']) {
      const got = await r.call(command);
      expect(got.denied, `\`${command}\` ran; a body it can't read must be refused`).toBe(true);
      expect(got.words, `\`${command}\` was denied without naming missing.md`).toContain('missing.md');
    }
  }, 240_000);
});

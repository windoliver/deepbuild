// #2064 AC4's other twin: once every requirement of the task passed, each form saying Closes #7 runs.
import { expect, it } from 'vitest';
import { AC4, cleaning, room } from './helpers.ts';

cleaning();

const T = '--title t';
const heredoc = "\"$(cat <<'EOF'\nCloses #7\nEOF\n)\"";

it(`${AC4} with every requirement passed, gh pr create and gh pr edit saying Closes #7 run, alone, joined, from a heredoc, a body file and --fill`, async () => {
  const r = await room({ passing: true });
  r.file('pr.md', 'Closes #7\n');
  const all: [string, string, string?][] = [
    ['alone', `gh pr create ${T} --body "Closes #7"`],
    ['joined', `git push -u origin b && gh pr create ${T} --body "Closes #7"`],
    ['edit joined', 'git push -u origin b && gh pr edit 3 --body "Closes #7"'],
    ['heredoc', `gh pr create ${T} --body ${heredoc}`],
    ['body file', `gh pr create ${T} --body-file pr.md`],
    ['edit with a body file', 'gh pr edit 3 --body-file pr.md'],
    ['owner/repo form', `gh pr create ${T} --body "Closes acme/shop#7"`],
    ['fill', 'gh pr create --fill', 'fill-done'],
  ];
  const bad: string[] = [];
  for (const [name, command, branch] of all) {
    if (branch) r.onBranch(branch, 'Closes #7');
    const got = await r.call(command);
    if (got.denied) bad.push(`${name}: \`${command.replace(/\n/g, '\\n')}\` was denied: ${got.words.slice(0, 300)}`);
    r.onBranch('b');
  }
  expect(bad, bad.join('\n')).toEqual([]);
}, 400_000);
